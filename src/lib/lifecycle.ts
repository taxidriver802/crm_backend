/**
 * A company's account lifecycle (PLAN_operator.md §3): which states exist,
 * which moves are allowed, how long each state lasts before its timer moves
 * it on, and what each state lets staff and clients do.
 *
 * Durations live here, in one place, so they can change without a
 * migration. The timers only record when a move is due; nothing moves a
 * company on its own until the lifecycle job (a later step).
 */

export const COMPANY_STATUSES = [
  'pending',
  'denied',
  'trial',
  'active',
  'past_due',
  'suspended',
  'pending_deletion',
  'on_hold',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export function isCompanyStatus(value: unknown): value is CompanyStatus {
  return typeof value === 'string' && (COMPANY_STATUSES as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days each state lasts before its timer is due. Null: no timer. */
export const STATE_DAYS: Record<CompanyStatus, number | null> = {
  pending: null,
  denied: null,
  trial: 30,
  active: null,
  past_due: 7,
  suspended: 30,
  pending_deletion: 30,
  on_hold: null,
};

/** A company restored from pending_deletion to suspended gets this long to pay. */
export const RESTORED_SUSPENDED_DAYS = 14;

/**
 * The moves an operator may make. on_hold is entered from any live state
 * and left only by release (back to the state it came from), so it is not
 * listed here as a target or a source.
 */
const MOVES: Record<CompanyStatus, readonly CompanyStatus[]> = {
  pending: ['trial', 'denied'],
  denied: ['trial'],
  trial: ['active', 'past_due', 'suspended', 'pending_deletion'],
  active: ['past_due', 'suspended', 'pending_deletion'],
  past_due: ['active', 'suspended', 'pending_deletion'],
  suspended: ['active', 'trial', 'pending_deletion'],
  pending_deletion: ['active', 'suspended'],
  on_hold: [],
};

/** States that can be put on hold. */
export const HOLDABLE: readonly CompanyStatus[] = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'pending_deletion',
];

export function canMove(from: CompanyStatus, to: CompanyStatus): boolean {
  return MOVES[from].includes(to);
}

export function allowedMoves(from: CompanyStatus): readonly CompanyStatus[] {
  return MOVES[from];
}

export function timerFor(status: CompanyStatus, now = new Date(), days?: number): Date | null {
  const length = days ?? STATE_DAYS[status];
  return length == null ? null : new Date(now.getTime() + length * DAY_MS);
}

// ─── What each state allows ────────────────────────────────────────────────

/** Staff in the CRM: everything, reading only, or nothing. */
export type StaffAccess = 'full' | 'read_only' | 'none';

export function staffAccess(status: string): StaffAccess {
  switch (status) {
    case 'trial':
    case 'active':
    case 'past_due':
      return 'full';
    case 'suspended':
      return 'read_only';
    default:
      return 'none';
  }
}

/** Client links (estimates, invoices, portal, intake). */
export type ClientAccess = 'full' | 'view_only' | 'unavailable';

export function clientAccess(status: string): ClientAccess {
  switch (status) {
    case 'trial':
    case 'active':
    case 'past_due':
      return 'full';
    case 'suspended':
      return 'view_only';
    default:
      return 'unavailable';
  }
}

/** What a company's staff are told when they can't get in. */
export function staffRefusal(status: string, nextStatusAt?: Date | string | null) {
  const when = nextStatusAt ? new Date(nextStatusAt).toISOString().slice(0, 10) : null;
  switch (status) {
    case 'pending':
      return 'This company is waiting for approval. You will get an email when it is ready.';
    case 'denied':
      return 'This company was not approved.';
    case 'pending_deletion':
      return when
        ? `This company's workspace is closed and will be deleted on ${when}.`
        : "This company's workspace is closed and will be deleted.";
    case 'on_hold':
      return "This company's workspace is on hold. Contact support.";
    case 'suspended':
      return "This company's workspace is read-only while its account is suspended.";
    default:
      return "This company's workspace is not available.";
  }
}

export const CLIENT_NOT_TAKING_RESPONSES =
  "This company isn't taking online responses right now. Please contact them directly.";
export const CLIENT_UNAVAILABLE = 'This page is no longer available.';

/**
 * SQL for "this company's account is in use", for background jobs:
 * reminders and notifications go only to companies with full access.
 * `alias` is the table whose company_id is checked.
 */
export function liveCompanySql(alias: string) {
  return `EXISTS (SELECT 1 FROM companies lc_c WHERE lc_c.id = ${alias}.company_id AND lc_c.status IN ('trial', 'active', 'past_due'))`;
}
