import net from 'net';
import type { Request } from 'express';
import { pool } from '../db';
import { clientIp } from './rateLimit';

/**
 * Login history (migration 0005): the operator's security log of sign-ins,
 * failed attempts, sign-outs and password events, with the client address
 * and user agent. See docs/guide/login-history.md.
 *
 * Writing it must never break or slow a sign-in, so recordLoginEvent() does
 * not wait for the insert and swallows any error into one log line. It always
 * writes on the pool, never inside a route's transaction: a failed insert
 * there would abort the transaction, and a rollback would lose the row.
 */

export type LoginEventName =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'logout_elsewhere'
  | 'password_reset_requested'
  | 'password_reset'
  | 'password_changed';

export type LoginFailReason =
  | 'unknown_company'
  | 'unknown_email'
  | 'inactive'
  | 'no_password'
  | 'bad_password'
  | 'rate_limited_account'
  | 'rate_limited_ip';

export type LoginMethod = 'password' | 'register' | 'invite' | 'reset';

export type LoginEvent = {
  event: LoginEventName;
  reason?: LoginFailReason;
  method?: LoginMethod;
  companyId?: string | null;
  userId?: string | null;
  companySlug?: string | null;
  email?: string | null;
  sessionId?: string | null;
};

const MAX_SLUG = 100;
const MAX_EMAIL = 320;
const MAX_USER_AGENT = 512;
const DEFAULT_KEEP_DAYS = 180;

/** A lower-cased, trimmed, length-capped copy; null when empty. */
function normalizeText(value: string | null | undefined, max: number) {
  const text = (value ?? '').trim().toLocaleLowerCase().slice(0, max);
  return text || null;
}

/**
 * The address as Postgres `inet` takes it: IPv4-mapped IPv6 becomes plain
 * IPv4, a zone id is dropped, and anything that isn't an address is null.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  let value = (raw ?? '').trim();
  if (value.toLowerCase().startsWith('::ffff:') && net.isIPv4(value.slice(7))) {
    value = value.slice(7);
  }
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  return net.isIP(value) ? value : null;
}

export function isLoopback(ip: string | null): boolean {
  return Boolean(ip && (ip === '::1' || /^127\./.test(ip)));
}

export function normalizeUserAgent(raw: string | undefined): string | null {
  // Postgres text can't hold NUL; nothing else needs cleaning for storage.
  const text = (raw ?? '').replace(/\u0000/g, '').slice(0, MAX_USER_AGENT).trim();
  return text || null;
}

let warnedLoopback = false;

/**
 * Behind a proxy that passes the client's address on, a sign-in never comes
 * from loopback in production. If one does, the chain is losing
 * X-Forwarded-For: every visitor then shares one address here and in the
 * per-address rate limits. Said once per process.
 */
function warnIfLoopback(ip: string | null) {
  if (warnedLoopback || process.env.NODE_ENV !== 'production' || !isLoopback(ip)) return;
  warnedLoopback = true;
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'client_ip_loopback',
      message:
        'A sign-in resolved to a loopback address. The proxy chain is not passing X-Forwarded-For; see docs/guide/hosting.md "Client addresses".',
    })
  );
}

function logWriteFailure(error: unknown) {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'login_event_write_failed',
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

const pending = new Set<Promise<void>>();

/** Records one event without waiting for it. Never throws. */
export function recordLoginEvent(req: Request, entry: LoginEvent): void {
  let params: unknown[];
  try {
    const ip = normalizeIp(clientIp(req));
    warnIfLoopback(ip);
    params = [
      entry.event,
      entry.reason ?? null,
      entry.method ?? null,
      entry.companyId ?? null,
      entry.userId ?? null,
      normalizeText(entry.companySlug, MAX_SLUG),
      normalizeText(entry.email, MAX_EMAIL),
      entry.sessionId ?? null,
      ip,
      normalizeUserAgent(req.get('user-agent')),
    ];
  } catch (error) {
    logWriteFailure(error);
    return;
  }

  let write: Promise<void>;
  try {
    write = pool
      .query(
        `INSERT INTO login_events
           (event, reason, method, company_id, user_id, company_slug,
            email_attempted, session_id, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        params
      )
      .then(() => undefined, logWriteFailure);
  } catch (error) {
    logWriteFailure(error);
    return;
  }
  pending.add(write);
  write.finally(() => pending.delete(write));
}

/** Waits for every write started so far (tests, and a clean shutdown). */
export async function settleLoginEvents(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/** LOGIN_EVENTS_KEEP_DAYS as a whole number of days (default 180). */
export function loginEventsKeepDays(env: Record<string, string | undefined> = process.env) {
  const raw = (env.LOGIN_EVENTS_KEEP_DAYS ?? '').trim();
  if (!raw) return DEFAULT_KEEP_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    console.warn(
      `[login-events] LOGIN_EVENTS_KEEP_DAYS=${JSON.stringify(raw)} is not a whole number of days; keeping ${DEFAULT_KEEP_DAYS}.`
    );
    return DEFAULT_KEEP_DAYS;
  }
  return days;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * Deletes rows older than `keepDays`, a batch at a time so a large backlog
 * never holds one long lock. Returns how many rows went.
 */
export async function pruneLoginEvents({
  keepDays = loginEventsKeepDays(),
  now = new Date(),
  batchSize = 5000,
  db = pool,
}: {
  keepDays?: number;
  now?: Date;
  batchSize?: number;
  db?: Queryable;
} = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000);
  let removed = 0;
  for (;;) {
    const result = await db.query(
      `DELETE FROM login_events
       WHERE id IN (
         SELECT id FROM login_events WHERE created_at < $1 ORDER BY id LIMIT $2
       )`,
      [cutoff, batchSize]
    );
    removed += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < batchSize) return removed;
  }
}
