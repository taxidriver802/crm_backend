import { pool } from '../db';
import { exportApproved } from '../lib/exportQueue';
import { companyDecided } from '../lib/companyNotices';
import {
  allowedMoves,
  canMove,
  HOLDABLE,
  isCompanyStatus,
  RESTORED_SUSPENDED_DAYS,
  timerFor,
  type CompanyStatus,
} from '../lib/lifecycle';

/**
 * The one way a company's account changes (PLAN_operator.md §6). Every
 * change locks the company row, checks the move against src/lib/lifecycle.ts,
 * sets its timer, and writes an operator_events row, in one transaction.
 *
 * Reads and writes only the companies table and operator_events, and reads
 * whether the owner confirmed their email: no company's work (the operator's "counts, never content" rule; see
 * test/operator.companies.test.ts).
 */

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export class AccountChangeError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'AccountChangeError';
    this.status = status;
  }
}

export type Actor = { operatorId: string | null };

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  status: CompanyStatus;
  next_status_at: Date | null;
  held_from_status: CompanyStatus | null;
  held_remaining: { days?: number; hours?: number; minutes?: number; seconds?: number; milliseconds?: number } | null;
};

const MAX_REASON = 500;

function cleanReason(reason: unknown, required: boolean): string | null {
  const text = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON) : '';
  if (required && !text) throw new AccountChangeError('Give a reason for this change.', 400);
  return text || null;
}

async function lockCompany(db: Queryable, companyId: string): Promise<CompanyRow> {
  const { rows } = await db.query(
    `SELECT id, slug, name, status, next_status_at, held_from_status, held_remaining
     FROM companies WHERE id = $1 FOR UPDATE`,
    [companyId]
  );
  if (!rows[0]) throw new AccountChangeError('Company not found', 404);
  return rows[0];
}

async function recordEvent(
  db: Queryable,
  company: Pick<CompanyRow, 'id' | 'slug'>,
  actor: Actor,
  event: string,
  from: string | null,
  to: string | null,
  detail: Record<string, unknown>
) {
  await db.query(
    `INSERT INTO operator_events (operator_id, company_id, company_slug, event, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor.operatorId, company.id, company.slug, event, from, to, JSON.stringify(detail)]
  );
}

async function inTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function intervalMs(value: CompanyRow['held_remaining']): number {
  if (!value) return 0;
  return (
    (value.days ?? 0) * 86400000 +
    (value.hours ?? 0) * 3600000 +
    (value.minutes ?? 0) * 60000 +
    (value.seconds ?? 0) * 1000 +
    (value.milliseconds ?? 0)
  );
}

export type StatusChange = {
  to: CompanyStatus;
  reason?: unknown;
  /** trial only: its length in days (default from lifecycle.ts). */
  trialDays?: number;
  /** suspended only: days before it moves on (default from lifecycle.ts). */
  days?: number;
  event?: string;
  /** pending or denied → trial: the operator saw that the owner's email isn't confirmed. */
  confirmUnverified?: boolean;
  /** → denied: email the owner that the company wasn't approved. */
  notify?: boolean;
};

/**
 * Moves a company to another state. Approving (pending → trial) and the
 * routine moves need no reason; anything that takes access away does.
 */
export async function setCompanyStatus(companyId: string, change: StatusChange, actor: Actor) {
  if (!isCompanyStatus(change.to) || change.to === 'on_hold') {
    throw new AccountChangeError('Unknown status', 400);
  }
  let decision: 'approved' | 'denied' | null = null;
  const result = await inTransaction(async (db) => {
    const company = await lockCompany(db, companyId);
    if (company.status === change.to) {
      throw new AccountChangeError(`The company is already ${change.to}.`);
    }
    if (!canMove(company.status, change.to)) {
      const allowed = allowedMoves(company.status);
      throw new AccountChangeError(
        allowed.length
          ? `A ${company.status} company can move to ${allowed.join(', ')}, not ${change.to}.`
          : `A ${company.status} company can't be moved this way.`
      );
    }
    const approving = change.to === 'trial' && (company.status === 'pending' || company.status === 'denied');
    if (approving && change.confirmUnverified !== true) {
      const { rows: owners } = await db.query(
        `SELECT email_verified_at FROM users
         WHERE company_id = $1 AND role = 'owner'
         ORDER BY created_at ASC LIMIT 1`,
        [company.id]
      );
      if (owners[0] && !owners[0].email_verified_at) {
        throw new AccountChangeError(
          "The owner hasn't confirmed their email address. Confirm you want to approve anyway."
        );
      }
    }
    const takesAccess = ['denied', 'suspended', 'pending_deletion', 'past_due'].includes(change.to);
    const reason = cleanReason(change.reason, takesAccess);

    const now = new Date();
    let trialEndsAt: Date | null = null;
    let next: Date | null;
    if (change.to === 'trial') {
      const days = Number.isInteger(change.trialDays) && change.trialDays! > 0 ? change.trialDays : undefined;
      trialEndsAt = timerFor('trial', now, days);
      next = trialEndsAt;
    } else if (change.to === 'suspended' && Number.isInteger(change.days) && change.days! > 0) {
      next = timerFor('suspended', now, change.days);
    } else {
      next = timerFor(change.to, now);
    }

    const { rows } = await db.query(
      `UPDATE companies SET
         status = $2,
         status_changed_at = now(),
         next_status_at = $3,
         status_reason = $4,
         trial_ends_at = COALESCE($5, trial_ends_at),
         approved_at = CASE WHEN $2 = 'trial' AND approved_at IS NULL THEN now() ELSE approved_at END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, status, next_status_at`,
      [company.id, change.to, next, reason, trialEndsAt]
    );

    const event =
      change.event ??
      (company.status === 'pending' && change.to === 'trial'
        ? 'approved'
        : change.to === 'denied'
          ? 'denied'
          : company.status === 'pending_deletion'
            ? 'restored'
            : 'status_changed');
    await recordEvent(db, company, actor, event, company.status, change.to, {
      ...(reason ? { reason } : {}),
      ...(next ? { next_status_at: next.toISOString() } : {}),
      ...(approving && change.confirmUnverified ? { owner_unverified: true } : {}),
      ...(change.to === 'denied' && company.status === 'pending' ? { notified: change.notify === true } : {}),
    });
    if (approving) decision = 'approved';
    else if (change.to === 'denied' && company.status === 'pending') decision = 'denied';
    return rows[0];
  });
  // After the commit: the welcome or denial email.
  if (decision) companyDecided({ companyId: result.id, decision, notify: change.notify === true });
  return result;
}

/** Approve a pending company: it starts its trial. */
export function approveCompany(
  companyId: string,
  actor: Actor,
  trialDays?: number,
  options: { confirmUnverified?: boolean } = {}
) {
  return setCompanyStatus(
    companyId,
    { to: 'trial', trialDays, confirmUnverified: options.confirmUnverified },
    actor
  );
}

/** Deny a pending company. `notify` emails the owner (never the reason). */
export function denyCompany(companyId: string, actor: Actor, reason: unknown, notify = false) {
  return setCompanyStatus(companyId, { to: 'denied', reason, notify }, actor);
}

/** Back from pending_deletion: to suspended with time to pay (default), or straight to active. */
export function restoreCompany(companyId: string, actor: Actor, to: unknown, reason: unknown) {
  const target = to === 'active' ? 'active' : 'suspended';
  return setCompanyStatus(
    companyId,
    { to: target, reason, days: target === 'suspended' ? RESTORED_SUSPENDED_DAYS : undefined, event: 'restored' },
    actor
  );
}

/** A hard stop for abuse or a security problem. The state's clock stops. */
export async function holdCompany(companyId: string, actor: Actor, reason: unknown) {
  return inTransaction(async (db) => {
    const company = await lockCompany(db, companyId);
    if (!HOLDABLE.includes(company.status)) {
      throw new AccountChangeError(`A ${company.status} company can't be put on hold.`);
    }
    const text = cleanReason(reason, true);
    const remainingMs = company.next_status_at
      ? Math.max(0, new Date(company.next_status_at).getTime() - Date.now())
      : null;
    await db.query(
      `UPDATE companies SET
         status = 'on_hold',
         held_from_status = $2,
         held_remaining = CASE WHEN $3::bigint IS NULL THEN NULL ELSE make_interval(secs => $3::bigint / 1000.0) END,
         next_status_at = NULL,
         status_reason = $4,
         status_changed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [company.id, company.status, remainingMs, text]
    );
    await recordEvent(db, company, actor, 'held', company.status, 'on_hold', { reason: text });
    return { id: company.id, status: 'on_hold' };
  });
}

/** Lift a hold: back to the state it came from, with the time it had left. */
export async function releaseCompany(companyId: string, actor: Actor, reason: unknown) {
  return inTransaction(async (db) => {
    const company = await lockCompany(db, companyId);
    if (company.status !== 'on_hold' || !company.held_from_status) {
      throw new AccountChangeError('The company is not on hold.');
    }
    const text = cleanReason(reason, false);
    const remaining = intervalMs(company.held_remaining);
    const next = company.held_remaining ? new Date(Date.now() + remaining) : null;
    await db.query(
      `UPDATE companies SET
         status = $2,
         held_from_status = NULL,
         held_remaining = NULL,
         next_status_at = $3,
         status_reason = NULL,
         status_changed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [company.id, company.held_from_status, next]
    );
    await recordEvent(db, company, actor, 'released', 'on_hold', company.held_from_status, {
      ...(text ? { reason: text } : {}),
    });
    return { id: company.id, status: company.held_from_status };
  });
}

/** Push a timer out (a longer trial, more grace), by days from when it was due. */
export async function extendTimer(companyId: string, actor: Actor, days: unknown, reason: unknown) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw new AccountChangeError('Extend by 1 to 365 days.', 400);
  }
  return inTransaction(async (db) => {
    const company = await lockCompany(db, companyId);
    if (!company.next_status_at) throw new AccountChangeError('This company has no timer to extend.');
    const text = cleanReason(reason, false);
    const next = new Date(new Date(company.next_status_at).getTime() + n * 86400000);
    await db.query(
      `UPDATE companies SET
         next_status_at = $2,
         trial_ends_at = CASE WHEN status = 'trial' THEN $2 ELSE trial_ends_at END,
         updated_at = now()
       WHERE id = $1`,
      [company.id, next]
    );
    await recordEvent(db, company, actor, 'extended', company.status, company.status, {
      days: n,
      next_status_at: next.toISOString(),
      ...(text ? { reason: text } : {}),
    });
    return { id: company.id, next_status_at: next };
  });
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AccountEdit = {
  name?: unknown;
  slug?: unknown;
  confirm_slug?: unknown;
  plan?: unknown;
  billing_email?: unknown;
  operator_notes?: unknown;
};

/** Edits the account fields. A slug change needs confirm_slug to repeat it. */
export async function editCompany(companyId: string, actor: Actor, edit: AccountEdit) {
  const sets: string[] = [];
  const params: unknown[] = [companyId];
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  return inTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, slug, name, plan, billing_email, operator_notes FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId]
    );
    const before = rows[0];
    if (!before) throw new AccountChangeError('Company not found', 404);

    const text = (value: unknown, max: number, field: string, required = false) => {
      if (value === undefined) return undefined;
      if (value !== null && typeof value !== 'string') throw new AccountChangeError(`${field} must be text.`, 400);
      const trimmed = (value ?? '').trim();
      if (required && !trimmed) throw new AccountChangeError(`${field} can't be empty.`, 400);
      if (trimmed.length > max) throw new AccountChangeError(`${field} is too long.`, 400);
      return trimmed || null;
    };

    const name = text(edit.name, 200, 'Name', true);
    const plan = text(edit.plan, 60, 'Plan');
    const billing = text(edit.billing_email, 320, 'Billing email');
    if (billing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing)) {
      throw new AccountChangeError('Billing email is not an email address.', 400);
    }
    const notes = text(edit.operator_notes, 10000, 'Notes');
    let slug = text(edit.slug, 100, 'Slug', true);
    if (slug !== undefined) {
      slug = slug!.toLowerCase();
      if (!SLUG_RE.test(slug)) throw new AccountChangeError('Slugs use lowercase letters, numbers and hyphens.', 400);
      if (slug !== before.slug && edit.confirm_slug !== slug) {
        throw new AccountChangeError(
          'Changing the slug changes how this company signs in. Repeat the new slug to confirm.',
          400
        );
      }
      const reserved = await db.query(
        `SELECT 1 FROM company_tombstones WHERE slug = $1 AND slug_reserved_until > now()
         UNION ALL SELECT 1 FROM companies WHERE slug = $1 AND id <> $2`,
        [slug, companyId]
      );
      if (reserved.rowCount) throw new AccountChangeError('That slug is taken.');
    }

    const fields: Array<[string, unknown]> = [
      ['name', name],
      ['slug', slug],
      ['plan', plan],
      ['billing_email', billing],
      ['operator_notes', notes],
    ];
    for (const [column, value] of fields) {
      if (value === undefined || value === before[column]) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
      // Notes are private and can be long: record that they changed, not what they say.
      changed[column] =
        column === 'operator_notes' ? { from: null, to: null } : { from: before[column], to: value };
    }
    if (!sets.length) return { id: companyId, changed: [] };

    await db.query(`UPDATE companies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    await recordEvent(db, before, actor, 'edited', null, null, { changed });
    return { id: companyId, changed: Object.keys(changed) };
  });
}

// ─── Final exports (PLAN_operator.md §3) ───────────────────────────────────
// The operator approves or denies a closing company's request. The archive
// is built by the system for the owner; nothing here reads it.

async function lockExportRequest(db: Queryable, exportId: string) {
  const { rows } = await db.query(
    `SELECT x.id, x.status, x.kind, c.id AS company_id, c.slug
     FROM company_exports x JOIN companies c ON c.id = x.company_id
     WHERE x.id = $1 FOR UPDATE OF x`,
    [exportId]
  );
  const row = rows[0];
  if (!row) throw new AccountChangeError('Export request not found', 404);
  if (row.kind !== 'final' || row.status !== 'requested') {
    throw new AccountChangeError('This export request has already been handled.');
  }
  return row;
}

export async function approveExport(exportId: string, actor: Actor, reason: unknown) {
  const text = cleanReason(reason, false);
  const result = await inTransaction(async (db) => {
    const row = await lockExportRequest(db, exportId);
    await db.query(
      `UPDATE company_exports SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
       WHERE id = $1`,
      [row.id, actor.operatorId]
    );
    await recordEvent(db, { id: row.company_id, slug: row.slug }, actor, 'export_approved', null, null, {
      export_id: row.id,
      ...(text ? { reason: text } : {}),
    });
    return { id: row.id, company_id: row.company_id };
  });
  exportApproved();
  return result;
}

export async function denyExport(exportId: string, actor: Actor, reason: unknown) {
  const text = cleanReason(reason, true);
  return inTransaction(async (db) => {
    const row = await lockExportRequest(db, exportId);
    await db.query(
      `UPDATE company_exports SET status = 'denied', deny_reason = $2, updated_at = now() WHERE id = $1`,
      [row.id, text]
    );
    await recordEvent(db, { id: row.company_id, slug: row.slug }, actor, 'export_denied', null, null, {
      export_id: row.id,
      reason: text,
    });
    return { id: row.id, company_id: row.company_id };
  });
}
