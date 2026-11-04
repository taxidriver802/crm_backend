import { pool } from '../db';
import { daysInStatus } from '../lib/aging';
import { computeJobHealth } from '../lib/jobHealth';
import {
  JOB_MONEY_COLUMNS_SQL,
  JOB_MONEY_LATERAL_SQL,
  JOB_PHASES,
  JOB_STATUSES,
  assertTransition,
  buildJobMoney,
  computeNextStep,
  isJobPhase,
  isJobStatus,
  initialMilestoneColumns,
  isSettled,
  milestoneUpdates,
  phaseOf,
  statusesForPhase,
  InvalidJobStatusError,
  JobTransitionError,
  type JobMoney,
  type JobPhase,
  type JobStatus,
} from '../lib/jobLifecycle';
import { notifyAssigneeChange } from '../lib/notifications';
import { applyTenantScope, tenantPredicate, tenantScope } from '../lib/tenant';
import * as activityService from '../services/jobActivity.service';
import { evaluateRules } from './automation.service';
import {
  recordAssignmentChange,
  recordInitialAssignment,
} from './performanceHistory.service';

export { JobTransitionError, InvalidJobStatusError };

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export class LeadNotFoundError extends Error {
  constructor(message = 'Lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

export class JobOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobOwnershipError';
  }
}

export class AssigneeNotFoundError extends Error {
  constructor(message = 'Assignee not found') {
    super(message);
    this.name = 'AssigneeNotFoundError';
  }
}

export class AssignmentPermissionError extends Error {
  constructor(message = 'Not allowed to assign to that user') {
    super(message);
    this.name = 'AssignmentPermissionError';
  }
}

export type GetJobsFilters = {
  status?: string;
  phase?: string;
  assignedTo?: string;
  q?: string;
  leadId?: number;
  includeAll?: boolean;
  companyId?: string;
  limit?: number;
  offset?: number;
};

export type CreateJobInput = {
  assigned_to?: string | null;
  lead_id: number;
  title: string;
  description?: string | null;
  status?: string | null;
  address?: string | null;
};

export type UpdateJobInput = Partial<Omit<CreateJobInput, 'lead_id'>> & {
  lost_reason?: string | null;
};

async function ensureLeadBelongsToUser(
  leadId: number,
  userId: string,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [leadId];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });
  const result = await pool.query(
    `SELECT id FROM leads WHERE ${where.join(' AND ')}`,
    params
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }
}

function normalizeJob(row: any) {
  const leadName =
    `${row.lead_first_name || ''} ${row.lead_last_name || ''}`.trim();
  const money = buildJobMoney(row);
  const nextStep = computeNextStep({
    status: row.status,
    money,
    estimateCount: Number(row.estimate_count) || 0,
    draftEstimateCount: Number(row.draft_estimate_count) || 0,
    sentAwaitingCount: Number(row.sent_awaiting_count) || 0,
    nextAppointmentAt: row.next_appointment_at ?? null,
  });

  return {
    id: row.id,
    user_id: row.user_id,
    lead_id: row.lead_id,
    title: row.title,
    description: row.description,
    status: row.status,
    phase: phaseOf(row.status),
    address: row.address,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status_changed_at: row.status_changed_at ?? null,
    days_in_status: daysInStatus(row.status_changed_at),
    sold_at: row.sold_at ?? null,
    work_completed_at: row.work_completed_at ?? null,
    closed_at: row.closed_at ?? null,
    lost_at: row.lost_at ?? null,
    lost_reason: row.lost_reason ?? null,
    next_appointment_at: row.next_appointment_at ?? null,
    money,
    next_step: nextStep,
    health: computeJobHealth({
      status: row.status,
      statusChangedAt: row.status_changed_at,
      overdueTaskCount: row.overdue_task_count,
      overdueInvoiceCount: row.overdue_invoice_count,
      sentAwaitingCount: row.sent_awaiting_count,
      upcomingAppointmentCount: row.upcoming_appointment_count,
      money,
    }),
    assigned_to: row.assigned_to,
    assigned_user:
      row.assigned_to != null
        ? {
            id: row.assigned_to,
            first_name: row.assigned_first_name ?? null,
            last_name: row.assigned_last_name ?? null,
            email: row.assigned_email ?? null,
          }
        : null,
    lead:
      row.lead_id != null
        ? {
            id: row.lead_id,
            name: leadName || `Lead #${row.lead_id}`,
            first_name: row.lead_first_name ?? null,
            last_name: row.lead_last_name ?? null,
          }
        : null,
  };
}

export type NormalizedJob = ReturnType<typeof normalizeJob>;

const JOB_SELECT = `
  SELECT
    j.*,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name,
    au.first_name AS assigned_first_name,
    au.last_name AS assigned_last_name,
    au.email AS assigned_email,
    COALESCE(ot.overdue_task_count, 0) AS overdue_task_count,
    COALESCE(inv.overdue_invoice_count, 0) AS overdue_invoice_count,
    COALESCE(est.sent_awaiting_count, 0) AS sent_awaiting_count,
    COALESCE(est.estimate_count, 0) AS estimate_count,
    COALESCE(est.draft_estimate_count, 0) AS draft_estimate_count,
    COALESCE(appt.upcoming_appointment_count, 0) AS upcoming_appointment_count,
    appt.next_appointment_at,
    ${JOB_MONEY_COLUMNS_SQL}
  FROM jobs j
  LEFT JOIN leads l ON l.id = j.lead_id
  LEFT JOIN users au ON au.id = j.assigned_to
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS overdue_task_count
    FROM tasks t
    WHERE t.job_id = j.id
      AND t.status <> 'Completed'
      AND t.due_date IS NOT NULL
      AND COALESCE(t.end_at, t.due_date) < NOW()
  ) ot ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS overdue_invoice_count
    FROM invoices i
    WHERE i.job_id = j.id
      AND i.status = 'Overdue'
  ) inv ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE e.status = 'Sent' AND e.client_responded_at IS NULL
      )::int AS sent_awaiting_count,
      COUNT(*)::int AS estimate_count,
      COUNT(*) FILTER (WHERE e.status = 'Draft')::int AS draft_estimate_count
    FROM estimates e
    WHERE e.job_id = j.id
  ) est ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS upcoming_appointment_count,
      MIN(t.due_date) AS next_appointment_at
    FROM tasks t
    WHERE t.job_id = j.id
      AND t.kind = 'appointment'
      AND t.status <> 'Completed'
      AND COALESCE(t.end_at, t.due_date) >= NOW()
  ) appt ON TRUE
  ${JOB_MONEY_LATERAL_SQL}
`;

async function validateAssignee(
  assignedTo: string | null | undefined,
  actorUserId: string,
  actorRole: string | undefined,
  companyId: string
) {
  if (assignedTo == null) return;

  const canAssignTeam = actorRole === 'owner' || actorRole === 'admin';
  if (!canAssignTeam && assignedTo !== actorUserId) {
    throw new AssignmentPermissionError();
  }

  const assignee = await pool.query(
    `
    SELECT id
    FROM users
    WHERE id = $1 AND status = 'active' AND company_id = $2
    LIMIT 1
    `,
    [assignedTo, companyId]
  );

  if (assignee.rowCount === 0) {
    throw new AssigneeNotFoundError();
  }
}

export async function getJobSummary(
  userId: string,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const scopeWhere = tenantPredicate(params, scope, { assignedWork: true });

  const [totalResult, byStatusResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM jobs WHERE ${scopeWhere}`,
      params
    ),
    pool.query(
      `
      SELECT status, COUNT(*)::int AS count
      FROM jobs
      WHERE ${scopeWhere}
      GROUP BY status
      ORDER BY count DESC;
      `,
      params
    ),
  ]);

  const byPhase = JOB_PHASES.map((phase) => ({
    phase,
    count: byStatusResult.rows
      .filter((row) => phaseOf(row.status) === phase)
      .reduce((sum, row) => sum + Number(row.count || 0), 0),
  }));

  return {
    total: totalResult.rows[0].total,
    byStatus: byStatusResult.rows,
    byPhase,
  };
}

export async function getJobs(userId: string, filters: GetJobsFilters = {}) {
  const params: any[] = [];
  const where: string[] = [];
  const scope = await tenantScope(userId, filters);
  applyTenantScope(where, params, scope, { alias: 'j', assignedWork: true });

  if (filters.status) {
    params.push(filters.status);
    where.push(`j.status = $${params.length}`);
  }

  if (filters.phase && (isJobPhase(filters.phase) || filters.phase === 'open')) {
    params.push(statusesForPhase(filters.phase as JobPhase | 'open'));
    where.push(`j.status = ANY($${params.length}::text[])`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(
      `(j.title ILIKE ${p} OR j.description ILIKE ${p} OR j.address ILIKE ${p})`
    );
  }

  if (filters.assignedTo === 'unassigned') {
    where.push(`j.assigned_to IS NULL`);
  } else if (filters.assignedTo) {
    params.push(filters.assignedTo);
    where.push(`j.assigned_to = $${params.length}`);
  }

  if (Number.isFinite(filters.leadId)) {
    params.push(filters.leadId);
    where.push(`j.lead_id = $${params.length}`);
  }

  params.push(filters.limit ?? 50);
  params.push(filters.offset ?? 0);

  const sql = `
    ${JOB_SELECT}
    WHERE ${where.length > 0 ? where.join(' AND ') : 'TRUE'}
    ORDER BY j.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return result.rows.map(normalizeJob);
}

export async function getJobById(
  userId: string,
  id: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const params: any[] = [id];
  const where: string[] = ['j.id = $1'];
  const scope = await tenantScope(userId, options);
  applyTenantScope(where, params, scope, { alias: 'j', assignedWork: true });

  const result = await pool.query(
    `
    ${JOB_SELECT}
    WHERE ${where.join(' AND ')}
    LIMIT 1
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return normalizeJob(result.rows[0]);
}

/** Job row without a viewer check. Callers must already hold company access. */
async function getJobForCompany(jobId: number, companyId: string) {
  const result = await pool.query(
    `${JOB_SELECT} WHERE j.id = $1 AND j.company_id = $2 LIMIT 1`,
    [jobId, companyId]
  );
  if (result.rowCount === 0) throw new JobNotFoundError();
  return normalizeJob(result.rows[0]);
}

export async function getJobMoney(
  jobId: number,
  companyId: string
): Promise<JobMoney> {
  return (await getJobForCompany(jobId, companyId)).money;
}

/**
 * The single writer for job status. Manual edits (updateJob) and automatic
 * moves (estimate approved → Sold, paid in full → Closed, payment removed →
 * reopened) all pass through here so milestones, activity and automation
 * fire the same way.
 */
export async function transitionJobStatus(input: {
  jobId: number;
  companyId: string;
  actorUserId: string;
  actorRole?: string;
  to: JobStatus;
  automatic?: boolean;
  reason?: string | null;
  lostReason?: string | null;
}) {
  const job = await getJobForCompany(input.jobId, input.companyId);
  const from = job.status;
  if (from === input.to) return job;

  if (!input.automatic) {
    assertTransition({
      from,
      to: input.to,
      role: input.actorRole,
      money: job.money,
    });
  }

  const sets = [
    'status = $3',
    'status_changed_at = CURRENT_TIMESTAMP',
    'updated_at = CURRENT_TIMESTAMP',
    ...milestoneUpdates(from, input.to),
  ];
  const values: unknown[] = [input.jobId, input.companyId, input.to];
  if (input.to === 'Lost') {
    values.push(input.lostReason?.trim() || null);
    sets.push(`lost_reason = $${values.length}`);
  }

  await pool.query(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
    values
  );

  const metadata: Record<string, unknown> = {
    fromStatus: from,
    toStatus: input.to,
    jobTitle: job.title,
    automatic: Boolean(input.automatic),
  };
  if (input.reason) metadata.reason = input.reason;
  if (input.to === 'Lost' && input.lostReason) {
    metadata.lostReason = input.lostReason.trim();
  }
  if (input.to === 'Closed' && job.money.unbilled_total > 0.004) {
    metadata.unbilledAtClose = job.money.unbilled_total;
  }

  const suffix = input.reason ? ` — ${input.reason}` : '';
  await activityService.createJobActivity({
    userId: input.actorUserId,
    jobId: input.jobId,
    type: 'JOB_STATUS_CHANGED',
    title: input.automatic ? 'Status moved automatically' : 'Status changed',
    message: `${from} → ${input.to}${suffix}`,
    entityType: 'job',
    entityId: input.jobId,
    metadata,
  });

  evaluateRules(input.actorUserId, 'JOB_STATUS_CHANGED', {
    job_id: input.jobId,
    job_title: job.title,
    from_status: from,
    to_status: input.to,
    entity_type: 'job',
    entity_id: input.jobId,
  }).catch((err) => console.error('Automation evaluation failed:', err));

  return getJobForCompany(input.jobId, input.companyId);
}

/**
 * Forward-only automatic moves driven by the estimate:
 *   sharing / sending an estimate → Proposal Sent (from an earlier selling stage)
 *   approving an estimate         → Sold (from any selling stage)
 * A job already past the target is left alone.
 */
export async function advanceJobFromEstimate(input: {
  jobId: number;
  companyId: string;
  actorUserId: string;
  to: 'Proposal Sent' | 'Sold';
  reason: string;
}) {
  const job = await getJobForCompany(input.jobId, input.companyId);
  if (phaseOf(job.status) !== 'selling') return job;
  if (input.to === 'Proposal Sent' && job.status === 'Proposal Sent') return job;
  return transitionJobStatus({
    jobId: input.jobId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    to: input.to,
    automatic: true,
    reason: input.reason,
  });
}

/**
 * Called after every payment write. A Work Complete job that is fully
 * billed and fully paid closes itself; a Closed job that owes money again
 * (payment removed) reopens to Work Complete.
 */
export async function reconcileJobAfterPayment(input: {
  jobId: number;
  companyId: string;
  actorUserId: string;
}) {
  const job = await getJobForCompany(input.jobId, input.companyId);
  if (job.status === 'Work Complete' && isSettled(job.money)) {
    return transitionJobStatus({
      ...input,
      to: 'Closed',
      automatic: true,
      reason: 'paid in full',
    });
  }
  if (job.status === 'Closed' && job.money.outstanding_total > 0.004) {
    return transitionJobStatus({
      ...input,
      to: 'Work Complete',
      automatic: true,
      reason: 'a payment was removed',
    });
  }
  return job;
}

export async function createJob(
  userId: string,
  input: CreateJobInput,
  actor: { role?: string; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, {
    companyId: actor.companyId,
    includeAll: actor.role === 'owner' || actor.role === 'admin',
  });
  await ensureLeadBelongsToUser(input.lead_id, userId, scope);
  await validateAssignee(input.assigned_to, userId, actor.role, scope.companyId);

  const initialStatus = input.status ?? 'New';
  if (!isJobStatus(initialStatus)) {
    throw new InvalidJobStatusError(initialStatus);
  }
  if (initialStatus === 'Closed') {
    throw new JobTransitionError(
      'A job cannot start closed. Create it, bill it, and it closes when paid.'
    );
  }
  // A job entered after the sale (work already agreed) keeps honest milestones.
  const milestoneSql = initialMilestoneColumns(initialStatus);

  const result = await pool.query(
    `
    INSERT INTO jobs (
      user_id,
      assigned_to,
      lead_id,
      title,
      description,
      status,
      address,
      company_id${milestoneSql.map((column) => `,\n      ${column}`).join('')}
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, u.company_id${milestoneSql
      .map(() => ', CURRENT_TIMESTAMP')
      .join('')}
    FROM users u
    WHERE u.id = $1
    RETURNING *;
    `,
    [
      userId,
      input.assigned_to ?? null,
      input.lead_id,
      input.title,
      input.description ?? null,
      initialStatus,
      input.address ?? null,
    ]
  );

  const job = result.rows[0];
  if (!job) {
    throw new JobNotFoundError();
  }

  await activityService.createJobActivity({
    userId,
    jobId: job.id,
    type: 'JOB_CREATED',
    title: 'Job created',
    message: input.title,
    entityType: 'job',
    entityId: job.id,
    metadata: {
      jobTitle: input.title,
      leadId: input.lead_id,
      status: job.status,
      address: job.address,
    },
  });

  evaluateRules(userId, 'JOB_CREATED', {
    job_id: job.id,
    job_title: input.title,
    lead_id: input.lead_id,
    status: job.status,
  }).catch((err) => console.error('JOB_CREATED automation failed:', err));

  const created = await getJobById(userId, job.id, {
    includeAll: actor.role === 'owner' || actor.role === 'admin',
    companyId: scope.companyId,
  });

  await recordInitialAssignment({
    companyId: scope.companyId,
    entityType: 'job',
    entityId: created.id,
    userId: created.assigned_to ?? null,
    assignedAt: created.created_at,
  });

  await notifyAssigneeChange({
    actorUserId: userId,
    assignedTo: created.assigned_to,
    type: 'JOB_ASSIGNED',
    title: 'New job assigned',
    message: `${created.title} was assigned to you`,
    entityType: 'job',
    entityId: created.id,
  });

  return created;
}

export async function updateJob(
  userId: string,
  id: number,
  updates: UpdateJobInput & { lead_id?: number | null },
  options: { includeAll?: boolean; actorRole?: string; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const existingJob = await getJobById(userId, id, {
    includeAll: options.includeAll,
    companyId: scope.companyId,
  });

  if ('lead_id' in updates) {
    if (updates.lead_id !== existingJob.lead_id) {
      throw new JobOwnershipError(
        'Job ownership cannot be changed after creation'
      );
    }

    delete updates.lead_id;
  }

  const nextStatus = updates.status ?? null;
  const lostReason = updates.lost_reason;
  delete updates.status;
  delete updates.lost_reason;

  const statusChanging = nextStatus != null && nextStatus !== existingJob.status;
  if (nextStatus != null && !isJobStatus(nextStatus)) {
    throw new InvalidJobStatusError(nextStatus);
  }

  const keys = (Object.keys(updates) as (keyof UpdateJobInput)[]).filter(
    (key) => (updates as any)[key] !== undefined
  );

  if (keys.length === 0 && !statusChanging) {
    if (nextStatus != null || lostReason !== undefined) {
      return existingJob;
    }
    throw new Error('No fields to update');
  }

  if ('assigned_to' in updates) {
    await validateAssignee(
      updates.assigned_to,
      userId,
      options.actorRole,
      scope.companyId
    );
  }

  // Validate the move before writing anything else so a blocked close does
  // not half-apply the rest of the edit.
  if (statusChanging) {
    assertTransition({
      from: existingJob.status,
      to: nextStatus as string,
      role: options.actorRole,
      money: existingJob.money,
    });
  }

  if (keys.length > 0) {
    const setParts: string[] = [];
    const values: any[] = [id];

    for (const key of keys) {
      values.push((updates as any)[key] ?? null);
      setParts.push(`${key} = $${values.length}`);
    }

    setParts.push(`updated_at = CURRENT_TIMESTAMP`);

    const where: string[] = ['id = $1'];
    applyTenantScope(where, values, scope, { assignedWork: true });

    const result = await pool.query(
      `
      UPDATE jobs
      SET ${setParts.join(', ')}
      WHERE ${where.join(' AND ')}
      RETURNING id;
      `,
      values
    );

    if (result.rowCount === 0) {
      throw new JobNotFoundError();
    }
  }

  if (statusChanging) {
    await transitionJobStatus({
      jobId: id,
      companyId: scope.companyId,
      actorUserId: userId,
      actorRole: options.actorRole,
      to: nextStatus as JobStatus,
      lostReason: lostReason ?? null,
    });
  }

  const updated = await getJobById(userId, id, {
    includeAll: options.includeAll,
    companyId: scope.companyId,
  });

  if (
    'assigned_to' in updates &&
    (updates.assigned_to ?? null) !== (existingJob.assigned_to ?? null)
  ) {
    await recordAssignmentChange({
      companyId: scope.companyId,
      entityType: 'job',
      entityId: updated.id,
      previousUserId: existingJob.assigned_to ?? null,
      nextUserId: updated.assigned_to ?? null,
      entityCreatedAt: existingJob.created_at,
      assignedAt: updated.updated_at,
    });
  }

  await notifyAssigneeChange({
    actorUserId: userId,
    assignedTo: updated.assigned_to,
    previousAssignedTo: existingJob.assigned_to ?? null,
    type: 'JOB_ASSIGNED',
    title: 'New job assigned',
    message: `${updated.title} was assigned to you`,
    entityType: 'job',
    entityId: updated.id,
  });

  return updated;
}

export async function deleteJob(
  userId: string,
  id: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });

  const result = await pool.query(
    `DELETE FROM jobs WHERE ${where.join(' AND ')} RETURNING id`,
    params
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return result.rows[0].id;
}

export const JOB_LIFECYCLE = {
  statuses: JOB_STATUSES,
  phases: JOB_PHASES,
};
