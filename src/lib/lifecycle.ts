/**
 * A company's account lifecycle (PLAN_operator.md §3): which states exist,
 * which moves are allowed, how long each state lasts before its timer moves
 * it on, and what each state lets staff and clients do.
 *
 * Durations live here, in one place, so they can change without a
 * migration. The timers record when a move is due; the hourly lifecycle job
 * (src/jobs/lifecycle.ts) makes it.
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
  // Cleared by the lifecycle job unless approved first (CLEARED_STATES).
  denied: 45,
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
 * Where each state's timer moves a company. A trial that ends unpaid skips
 * past_due (nothing was ever owed). pending_deletion has no move: when its
 * timer runs out the company is "ready to delete", and only the operator
 * deletes it.
 */
export const TIMER_MOVES: Partial<Record<CompanyStatus, CompanyStatus>> = {
  trial: 'suspended',
  past_due: 'suspended',
  suspended: 'pending_deletion',
};

/** Why the timer moved a company, kept as the state's reason. */
export const TIMER_REASONS: Partial<Record<CompanyStatus, string>> = {
  trial: 'The trial ended.',
  past_due: 'Payment was not made in time.',
  suspended: 'The account stayed unpaid.',
};

/**
 * Reminder emails, in days before a state's timer runs out (§3). Each goes
 * once per timer: extending the timer sends them again.
 */
export const REMINDER_DAYS: Partial<Record<CompanyStatus, readonly number[]>> = {
  trial: [7, 1],
  // "payment missed" on day 0, a reminder on day 5 of 7.
  past_due: [2],
  suspended: [7],
  pending_deletion: [7, 1],
};

/** How long a deleted company's slug stays reserved. */
export const SLUG_RESERVED_DAYS = 180;

/**
 * Companies the lifecycle job clears by itself, with no operator step and no
 * email: a refused sign-up never had an account worth keeping.
 *
 * - denied: when its timer (STATE_DAYS.denied) runs out.
 * - pending, only while the owner hasn't confirmed their email:
 *   PENDING_UNCONFIRMED_DAYS after sign-up. A confirmed sign-up is waiting
 *   for the operator and stays. pending has no timer column for this, so
 *   confirming needs no change to it.
 */
export const PENDING_UNCONFIRMED_DAYS = 14;

/** How long a cleared company's slug stays reserved. 0: free at once. */
export const CLEARED_SLUG_RESERVED_DAYS = 0;

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
