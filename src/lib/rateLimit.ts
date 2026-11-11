import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Sliding-window counters kept in memory.
 *
 * One backend process serves a host at this stage (docs/guide/hosting.md),
 * so memory is enough; a restart clears every counter. Keys are hashed, so
 * no email, slug or public token is held here in the clear.
 */

export type Limit = {
  /** Stable name; part of every key, and of the 429 log line. */
  name: string;
  max: number;
  windowMs: number;
};

const MINUTE = 60 * 1000;

/**
 * Every limit on the public surface. Sign-in counts failures only, so people
 * signing in normally (and the QA suite) never meet it; the account limit
 * also blocks the right password while it holds, or guessing could go on.
 */
export const LIMITS = {
  loginAccount: { name: 'login-account', max: 10, windowMs: 15 * MINUTE },
  loginIp: { name: 'login-ip', max: 50, windowMs: 15 * MINUTE },
  register: { name: 'register-ip', max: 10, windowMs: 60 * MINUTE },
  acceptInvite: { name: 'accept-invite-ip', max: 20, windowMs: 15 * MINUTE },
  inviteValidate: { name: 'invite-validate-ip', max: 60, windowMs: 15 * MINUTE },
  publicRead: { name: 'public-read-ip', max: 300, windowMs: 15 * MINUTE },
  publicAnswer: { name: 'public-answer-ip', max: 30, windowMs: 15 * MINUTE },
  intakeIp: { name: 'intake-ip', max: 5, windowMs: 15 * MINUTE },
  intakeLink: { name: 'intake-link', max: 30, windowMs: 60 * MINUTE },
  forgotIp: { name: 'forgot-ip', max: 10, windowMs: 60 * MINUTE },
  forgotAccount: { name: 'forgot-account', max: 3, windowMs: 60 * MINUTE },
  resetValidate: { name: 'reset-validate-ip', max: 60, windowMs: 15 * MINUTE },
  resetPassword: { name: 'reset-password-ip', max: 20, windowMs: 15 * MINUTE },
  // Wrong current passwords, per signed-in person: a stolen session can't
  // be used to guess the password behind it.
  changePassword: { name: 'change-password-user', max: 10, windowMs: 15 * MINUTE },
} satisfies Record<string, Limit>;

const hits = new Map<string, number[]>();
let writesSinceSweep = 0;
const SWEEP_EVERY = 1000;
const LONGEST_WINDOW = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));

function storeKey(limit: Limit, key: string) {
  const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `${limit.name}:${digest}`;
}

function recent(id: string, windowMs: number, now: number) {
  const kept = (hits.get(id) ?? []).filter((at) => now - at < windowMs);
  if (kept.length) hits.set(id, kept);
  else hits.delete(id);
  return kept;
}

function sweep(now: number) {
  for (const [id, times] of hits) {
    if (!times.some((at) => now - at < LONGEST_WINDOW)) hits.delete(id);
  }
}

export type LimitResult = { allowed: boolean; retryAfterSec: number };

/** Whether one more attempt is allowed, without counting it. */
export function check(limit: Limit, key: string, now = Date.now()): LimitResult {
  const times = recent(storeKey(limit, key), limit.windowMs, now);
  if (times.length < limit.max) return { allowed: true, retryAfterSec: 0 };
  const oldest = times[0] ?? now;
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
  };
}

/** Count one attempt. */
export function record(limit: Limit, key: string, now = Date.now()) {
  const id = storeKey(limit, key);
  const times = recent(id, limit.windowMs, now);
  times.push(now);
  hits.set(id, times);
  writesSinceSweep += 1;
  if (writesSinceSweep >= SWEEP_EVERY) {
    writesSinceSweep = 0;
    sweep(now);
  }
}

/** Check, and count the attempt when it is allowed. */
export function consume(limit: Limit, key: string, now = Date.now()): LimitResult {
  const result = check(limit, key, now);
  if (result.allowed) record(limit, key, now);
  return result;
}

/** Forget one key (a successful sign-in clears that account's failures). */
export function clear(limit: Limit, key: string) {
  hits.delete(storeKey(limit, key));
}

/** Test helper: forget every counter. */
export function resetRateLimits() {
  hits.clear();
  writesSinceSweep = 0;
}

/** The client's address as Express resolved it under `trust proxy`. */
export function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function tooManyRequests(res: Response, result: LimitResult, limit: Limit) {
  console.warn(JSON.stringify({ level: 'warn', event: 'rate_limited', limit: limit.name }));
  res.setHeader('Retry-After', String(result.retryAfterSec || 60));
  return res.status(429).json({
    ok: false,
    error: 'Too many attempts. Please wait a few minutes and try again.',
  });
}

/** Middleware: count every request from one client address against `limit`. */
export function limitByIp(limit: Limit) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = consume(limit, clientIp(req));
    if (!result.allowed) return tooManyRequests(res, result, limit);
    next();
  };
}
