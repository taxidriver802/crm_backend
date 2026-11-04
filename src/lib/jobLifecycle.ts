/**
 * Job lifecycle: the one place that defines what a job's status means.
 *
 * A job moves from first contact to paid and closed:
 *
 *   selling     New → Contacted → Appointment Scheduled → Proposal Sent
 *   production  Sold → Work Scheduled → In Progress
 *   billing     Work Complete
 *   closed      Closed            (work done, nothing owed)
 *   lost        Lost              (off-path; can be reopened into selling)
 *
 * Services, SQL filters, health, dashboard queues and the portal all read
 * from here so a status never means two different things in two places.
 */

export const JOB_STATUSES = [
  'New',
  'Contacted',
  'Appointment Scheduled',
  'Proposal Sent',
  'Sold',
  'Work Scheduled',
  'In Progress',
  'Work Complete',
  'Closed',
  'Lost',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobPhase = 'selling' | 'production' | 'billing' | 'closed' | 'lost';

export const JOB_PHASES: readonly JobPhase[] = [
  'selling',
  'production',
  'billing',
  'closed',
  'lost',
];

const PHASE_BY_STATUS: Record<JobStatus, JobPhase> = {
  New: 'selling',
  Contacted: 'selling',
  'Appointment Scheduled': 'selling',
  'Proposal Sent': 'selling',
  Sold: 'production',
  'Work Scheduled': 'production',
  'In Progress': 'production',
  'Work Complete': 'billing',
  Closed: 'closed',
  Lost: 'lost',
};

export const SELLING_STATUSES = statusesIn('selling');
export const PRODUCTION_STATUSES = statusesIn('production');
/** Every status that means the client said yes (Sold through Closed). */
export const WON_STATUSES: readonly JobStatus[] = [
  'Sold',
  'Work Scheduled',
  'In Progress',
  'Work Complete',
  'Closed',
];
export const TERMINAL_STATUSES: readonly JobStatus[] = ['Closed', 'Lost'];
export const OPEN_STATUSES: readonly JobStatus[] = JOB_STATUSES.filter(
  (status) => !TERMINAL_STATUSES.includes(status)
);

function statusesIn(phase: JobPhase): readonly JobStatus[] {
  return JOB_STATUSES.filter((status) => PHASE_BY_STATUS[status] === phase);
}

export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === 'string' &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function isJobPhase(value: unknown): value is JobPhase {
  return (
    typeof value === 'string' && (JOB_PHASES as readonly string[]).includes(value)
  );
}

export function phaseOf(status: string | null | undefined): JobPhase {
  return isJobStatus(status) ? PHASE_BY_STATUS[status] : 'selling';
}

export function statusesForPhase(phase: JobPhase | 'open'): readonly JobStatus[] {
  if (phase === 'open') return OPEN_STATUSES;
  return statusesIn(phase);
}

export function isWonStatus(status: string | null | undefined) {
  return (WON_STATUSES as readonly string[]).includes(String(status ?? ''));
}

export function isOpenStatus(status: string | null | undefined) {
  return !(TERMINAL_STATUSES as readonly string[]).includes(String(status ?? ''));
}

/**
 * SQL literal list for status constants, e.g. `'Closed', 'Lost'`.
 * Only ever called with the constant arrays above — never user input.
 */
export function sqlStatusList(statuses: readonly JobStatus[]) {
  return statuses.map((status) => `'${status.replace(/'/g, "''")}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Money snapshot used by health, next step and the close gate.
// ---------------------------------------------------------------------------

export type JobMoney = {
  /** Sum of approved estimates (base scope + approved change orders). */
  contract_total: number;
  /** Non-void, non-draft invoices. */
  invoiced_total: number;
  /** Draft invoices — billed on paper, not yet sent. */
  draft_total: number;
  /** Payments recorded against this job's invoices. */
  collected_total: number;
  /** invoiced − collected on open invoices; what the client owes today. */
  outstanding_total: number;
  /** Outstanding on invoices past their due date. */
  overdue_total: number;
  /** Approved scope with no invoice yet (draft or sent). */
  unbilled_total: number;
  deposit_invoiced: boolean;
  draft_invoice_count: number;
  open_invoice_count: number;
};

export const EMPTY_MONEY: JobMoney = {
  contract_total: 0,
  invoiced_total: 0,
  draft_total: 0,
  collected_total: 0,
  outstanding_total: 0,
  overdue_total: 0,
  unbilled_total: 0,
  deposit_invoiced: false,
  draft_invoice_count: 0,
  open_invoice_count: 0,
};

function money(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

export function buildJobMoney(row: Record<string, unknown>): JobMoney {
  const contract = money(row.contract_total);
  const invoiced = money(row.invoiced_total);
  const draft = money(row.draft_total);
  const collected = money(row.collected_total);
  const outstanding = money(row.outstanding_total);
  return {
    contract_total: contract,
    invoiced_total: invoiced,
    draft_total: draft,
    collected_total: collected,
    outstanding_total: Math.max(0, outstanding),
    overdue_total: Math.max(0, money(row.overdue_total)),
    unbilled_total: Math.max(0, money(contract - invoiced - draft)),
    deposit_invoiced: Boolean(row.deposit_invoiced),
    draft_invoice_count: Number(row.draft_invoice_count) || 0,
    open_invoice_count: Number(row.open_invoice_count) || 0,
  };
}

/**
 * Per-job money aggregates as LATERAL joins on `j`. Shared by the job list,
 * job detail, dashboard queues and the portal so the numbers agree.
 */
export const JOB_MONEY_LATERAL_SQL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(e.grand_total), 0)::numeric AS contract_total
    FROM estimates e
    WHERE e.job_id = j.id AND e.company_id = j.company_id AND e.status = 'Approved'
  ) money_est ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(i.grand_total) FILTER (WHERE i.status NOT IN ('Draft', 'Void')), 0)::numeric AS invoiced_total,
      COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'Draft'), 0)::numeric AS draft_total,
      COALESCE(SUM(i.amount_paid) FILTER (WHERE i.status <> 'Void'), 0)::numeric AS collected_total,
      COALESCE(SUM(GREATEST(i.grand_total - i.amount_paid, 0)) FILTER (
        WHERE i.status IN ('Sent', 'Partially Paid', 'Overdue')
      ), 0)::numeric AS outstanding_total,
      COALESCE(SUM(GREATEST(i.grand_total - i.amount_paid, 0)) FILTER (
        WHERE i.status = 'Overdue'
      ), 0)::numeric AS overdue_total,
      COALESCE(BOOL_OR(i.kind = 'deposit' AND i.status <> 'Void'), FALSE) AS deposit_invoiced,
      COUNT(*) FILTER (WHERE i.status = 'Draft')::int AS draft_invoice_count,
      COUNT(*) FILTER (WHERE i.status IN ('Sent', 'Partially Paid', 'Overdue'))::int AS open_invoice_count
    FROM invoices i
    WHERE i.job_id = j.id AND i.company_id = j.company_id
  ) money_inv ON TRUE
`;

export const JOB_MONEY_COLUMNS_SQL = `
  money_est.contract_total,
  money_inv.invoiced_total,
  money_inv.draft_total,
  money_inv.collected_total,
  money_inv.outstanding_total,
  money_inv.overdue_total,
  money_inv.deposit_invoiced,
  money_inv.draft_invoice_count,
  money_inv.open_invoice_count
`;

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export class JobTransitionError extends Error {
  status = 409;
  blockers: string[];
  constructor(message: string, blockers: string[] = []) {
    super(message);
    this.name = 'JobTransitionError';
    this.blockers = blockers;
  }
}

export class InvalidJobStatusError extends Error {
  status = 400;
  constructor(value: unknown) {
    super(
      `Invalid job status "${String(value)}". Use one of: ${JOB_STATUSES.join(', ')}.`
    );
    this.name = 'InvalidJobStatusError';
  }
}

/** Reasons a job cannot be closed yet. Empty means it can. */
export function closeBlockers(m: JobMoney): string[] {
  const blockers: string[] = [];
  if (m.outstanding_total > 0.004) {
    blockers.push(
      `$${m.outstanding_total.toFixed(2)} is still owed on ${m.open_invoice_count} open invoice${m.open_invoice_count === 1 ? '' : 's'}. Record the payment first.`
    );
  }
  if (m.draft_invoice_count > 0) {
    blockers.push(
      `${m.draft_invoice_count} draft invoice${m.draft_invoice_count === 1 ? ' has' : 's have'} not been sent. Send or delete ${m.draft_invoice_count === 1 ? 'it' : 'them'}.`
    );
  }
  // Unbilled approved work does not block a manual close (the owner may have
  // agreed to less at the end); it is recorded on the close activity instead
  // and it does block the automatic close on final payment.
  return blockers;
}

/** True when a Work Complete job is fully billed and fully paid. */
export function isSettled(m: JobMoney) {
  return (
    m.outstanding_total <= 0.004 &&
    m.draft_invoice_count === 0 &&
    m.unbilled_total <= 0.004 &&
    m.invoiced_total > 0
  );
}

/**
 * Validates a manual status change. Automatic moves (approval → Sold,
 * paid in full → Closed) go through the same rules with `automatic: true`.
 */
export function assertTransition(input: {
  from: string;
  to: string;
  role?: string;
  money: JobMoney;
}) {
  if (!isJobStatus(input.to)) throw new InvalidJobStatusError(input.to);
  if (input.from === input.to) return;

  if (input.to === 'Closed') {
    if (input.from === 'Lost') {
      throw new JobTransitionError(
        'A lost job cannot be closed. Reopen it first.'
      );
    }
    const blockers = closeBlockers(input.money);
    if (blockers.length > 0) {
      throw new JobTransitionError(
        'This job cannot be closed while money is still open.',
        blockers
      );
    }
  }

  if (input.from === 'Closed') {
    const canReopen = input.role === 'owner' || input.role === 'admin';
    if (!canReopen) {
      throw new JobTransitionError(
        'Only an owner or admin can reopen a closed job.'
      );
    }
  }

  if (input.to === 'Lost' && input.money.collected_total > 0.004) {
    throw new JobTransitionError(
      'Money has been collected on this job. Refund or remove the payments before marking it lost.'
    );
  }
}

/** Milestone column updates for a status change, as SQL SET fragments. */
export function milestoneUpdates(from: string, to: string): string[] {
  const sets: string[] = [];
  const toPhase = phaseOf(to);
  if (isWonStatus(to)) {
    sets.push('sold_at = COALESCE(sold_at, CURRENT_TIMESTAMP)');
  }
  if (to === 'Work Complete' || to === 'Closed') {
    sets.push('work_completed_at = COALESCE(work_completed_at, CURRENT_TIMESTAMP)');
  }
  if (to === 'Closed') {
    sets.push('closed_at = CURRENT_TIMESTAMP');
  } else if (from === 'Closed') {
    sets.push('closed_at = NULL');
  }
  if (to === 'Lost') {
    sets.push('lost_at = CURRENT_TIMESTAMP');
  } else if (from === 'Lost') {
    sets.push('lost_at = NULL', 'lost_reason = NULL');
  }
  if (toPhase === 'selling' && from !== 'Lost' && isWonStatus(from)) {
    // Moving a won job back into selling un-sells it.
    sets.push('sold_at = NULL', 'work_completed_at = NULL');
  }
  return sets;
}

/** Milestone columns stamped when a job is created directly in `status`. */
export function initialMilestoneColumns(status: JobStatus): string[] {
  const columns: string[] = [];
  if (isWonStatus(status)) columns.push('sold_at');
  if (status === 'Work Complete') columns.push('work_completed_at');
  if (status === 'Lost') columns.push('lost_at');
  return columns;
}

// ---------------------------------------------------------------------------
// Next step — what has to happen for this job to move forward.
// ---------------------------------------------------------------------------

export type NextStepAction =
  | 'schedule_visit'
  | 'create_estimate'
  | 'send_estimate'
  | 'await_client'
  | 'request_deposit'
  | 'schedule_work'
  | 'start_work'
  | 'complete_work'
  | 'final_invoice'
  | 'send_invoice'
  | 'collect_payment'
  | 'close_job'
  | 'none';

export type NextStep = {
  action: NextStepAction;
  label: string;
  detail: string | null;
  /** When the action is a status move, the status it moves to. */
  to_status: JobStatus | null;
};

export type NextStepContext = {
  status: string;
  money: JobMoney;
  estimateCount: number;
  draftEstimateCount: number;
  sentAwaitingCount: number;
  nextAppointmentAt: string | Date | null;
};

function usd(value: number) {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function computeNextStep(ctx: NextStepContext): NextStep {
  const status = ctx.status;
  const m = ctx.money;
  const step = (
    action: NextStepAction,
    label: string,
    detail: string | null = null,
    to_status: JobStatus | null = null
  ): NextStep => ({ action, label, detail, to_status });

  if (status === 'Lost') return step('none', 'Lost', null);
  if (status === 'Closed') return step('none', 'Paid and closed', null);

  // Money owed always comes first once anything is billed.
  if (m.overdue_total > 0.004) {
    return step(
      'collect_payment',
      `Collect ${usd(m.overdue_total)} overdue`,
      'An invoice on this job is past due.'
    );
  }

  switch (status) {
    case 'New':
    case 'Contacted':
      if (ctx.estimateCount === 0) {
        return step(
          'schedule_visit',
          'Schedule a site visit',
          'See the job before you price it.',
          'Appointment Scheduled'
        );
      }
      break;
    case 'Appointment Scheduled':
      if (ctx.estimateCount === 0) {
        return step('create_estimate', 'Build the estimate', null);
      }
      break;
    default:
      break;
  }

  if (phaseOf(status) === 'selling') {
    if (ctx.sentAwaitingCount > 0) {
      return step(
        'await_client',
        'Waiting on the client',
        'The estimate is out. Follow up if it has been quiet.'
      );
    }
    if (ctx.draftEstimateCount > 0) {
      return step(
        'send_estimate',
        'Send the estimate',
        'A draft estimate is ready to share.',
        'Proposal Sent'
      );
    }
    return step('create_estimate', 'Build the estimate', null);
  }

  if (status === 'Sold') {
    if (m.contract_total > 0 && !m.deposit_invoiced && m.collected_total <= 0) {
      return step(
        'request_deposit',
        'Request a deposit',
        `${usd(m.contract_total)} approved. Bill the deposit before you order material.`
      );
    }
    return step(
      'schedule_work',
      'Schedule the work',
      'Put the crew on the calendar.',
      'Work Scheduled'
    );
  }

  if (status === 'Work Scheduled') {
    const when = ctx.nextAppointmentAt
      ? new Date(ctx.nextAppointmentAt).toISOString()
      : null;
    return step(
      'start_work',
      'Start the work',
      when ? `Scheduled ${when.slice(0, 10)}.` : 'No visit is on the calendar yet.',
      'In Progress'
    );
  }

  if (status === 'In Progress') {
    return step(
      'complete_work',
      'Mark the work complete',
      'Do the walkthrough, then move to billing.',
      'Work Complete'
    );
  }

  // Work Complete — billing.
  if (m.unbilled_total > 0.004) {
    return step(
      'final_invoice',
      'Send the final invoice',
      `${usd(m.unbilled_total)} of approved work is not invoiced.`
    );
  }
  if (m.draft_invoice_count > 0) {
    return step(
      'send_invoice',
      'Send the draft invoice',
      `${usd(m.draft_total)} is drafted but not sent.`
    );
  }
  if (m.outstanding_total > 0.004) {
    return step(
      'collect_payment',
      `Collect ${usd(m.outstanding_total)} balance`,
      'Record the payment when it arrives. The job closes when the balance is zero.'
    );
  }
  return step('close_job', 'Close the job', 'Nothing is owed.', 'Closed');
}

// ---------------------------------------------------------------------------
// Customer-facing view of the lifecycle (portal).
// ---------------------------------------------------------------------------

export const CUSTOMER_STEPS = [
  'Estimate',
  'Approved',
  'Scheduled',
  'In progress',
  'Complete',
  'Paid',
] as const;

export function customerStage(status: string): {
  step: number;
  label: string;
  steps: readonly string[];
} {
  switch (status) {
    case 'Proposal Sent':
      return { step: 0, label: 'Your estimate is ready to review', steps: CUSTOMER_STEPS };
    case 'Sold':
      return { step: 1, label: 'Approved — we are getting you on the schedule', steps: CUSTOMER_STEPS };
    case 'Work Scheduled':
      return { step: 2, label: 'Your work is scheduled', steps: CUSTOMER_STEPS };
    case 'In Progress':
      return { step: 3, label: 'Work is underway', steps: CUSTOMER_STEPS };
    case 'Work Complete':
      return { step: 4, label: 'Work is complete', steps: CUSTOMER_STEPS };
    case 'Closed':
      return { step: 5, label: 'Paid in full — thank you', steps: CUSTOMER_STEPS };
    case 'Lost':
      return { step: -1, label: 'This project is closed', steps: [] };
    default:
      return { step: 0, label: 'We are preparing your estimate', steps: CUSTOMER_STEPS };
  }
}
