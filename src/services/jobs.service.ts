import { pool } from '../db';
import * as activityService from '../services/jobActivity.service';
import { evaluateRules } from './automation.service';

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
  assignedTo?: string;
  q?: string;
  includeAll?: boolean;
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

export type UpdateJobInput = Partial<Omit<CreateJobInput, 'lead_id'>>;

async function ensureLeadBelongsToUser(leadId: number, userId: string) {
  const result = await pool.query(
    `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
    [leadId, userId]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }
}

function normalizeJob(row: any) {
  const leadName =
    `${row.lead_first_name || ''} ${row.lead_last_name || ''}`.trim();

  return {
    id: row.id,
    user_id: row.user_id,
    lead_id: row.lead_id,
    title: row.title,
    description: row.description,
    status: row.status,
    address: row.address,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

const JOB_SELECT = `
  SELECT
    j.*,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name,
    au.first_name AS assigned_first_name,
    au.last_name AS assigned_last_name,
    au.email AS assigned_email
  FROM jobs j
  LEFT JOIN leads l ON l.id = j.lead_id
  LEFT JOIN users au ON au.id = j.assigned_to
`;

async function validateAssignee(
  assignedTo: string | null | undefined,
  actorUserId: string,
  actorRole?: string
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
    WHERE id = $1 AND status = 'active'
    LIMIT 1
    `,
    [assignedTo]
  );

  if (assignee.rowCount === 0) {
    throw new AssigneeNotFoundError();
  }
}

export async function getJobs(userId: string, filters: GetJobsFilters = {}) {
  const params: any[] = [];
  const where: string[] = [];

  if (!filters.includeAll) {
    params.push(userId);
    where.push(`j.user_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    where.push(`j.status = $${params.length}`);
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
  options: { includeAll?: boolean } = {}
) {
  const params: any[] = [id];
  const where: string[] = ['j.id = $1'];
  if (!options.includeAll) {
    params.push(userId);
    where.push(`j.user_id = $${params.length}`);
  }

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

export async function createJob(
  userId: string,
  input: CreateJobInput,
  actor: { role?: string } = {}
) {
  await ensureLeadBelongsToUser(input.lead_id, userId);
  await validateAssignee(input.assigned_to, userId, actor.role);

  const result = await pool.query(
    `
    INSERT INTO jobs (
      user_id,
      assigned_to,
      lead_id,
      title,
      description,
      status,
      address
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
    `,
    [
      userId,
      input.assigned_to ?? null,
      input.lead_id,
      input.title,
      input.description ?? null,
      input.status ?? 'New',
      input.address ?? null,
    ]
  );

  const job = result.rows[0];

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

  return getJobById(userId, job.id, {
    includeAll: actor.role === 'owner' || actor.role === 'admin',
  });
}

export async function updateJob(
  userId: string,
  id: number,
  updates: UpdateJobInput & { lead_id?: number | null },
  options: { includeAll?: boolean; actorRole?: string } = {}
) {
  const existingJob = await getJobById(userId, id, {
    includeAll: options.includeAll,
  });

  if ('lead_id' in updates) {
    if (updates.lead_id !== existingJob.lead_id) {
      throw new JobOwnershipError(
        'Job ownership cannot be changed after creation'
      );
    }

    delete updates.lead_id;
  }

  const keys = Object.keys(updates) as (keyof UpdateJobInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  if ('assigned_to' in updates) {
    await validateAssignee(updates.assigned_to, userId, options.actorRole);
  }

  const setParts: string[] = [];
  const values: any[] = [id];

  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  let whereClause = 'id = $1';
  if (!options.includeAll) {
    values.push(userId);
    whereClause += ` AND user_id = $${values.length}`;
  }

  const sql = `
    UPDATE jobs
    SET ${setParts.join(', ')}
    WHERE ${whereClause}
    RETURNING *;
  `;

  const result = await pool.query(sql, values);

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  const updatedJob = result.rows[0];

  if (updates.status && updates.status !== existingJob.status) {
    await activityService.createJobActivity({
      userId,
      jobId: id,
      type: 'JOB_STATUS_CHANGED',
      title: 'Status changed',
      message: `${existingJob.status} → ${updates.status}`,
      entityType: 'job',
      entityId: id,
      metadata: {
        fromStatus: existingJob.status,
        toStatus: updates.status,
        jobTitle: existingJob.title,
      },
    });

    evaluateRules(userId, 'JOB_STATUS_CHANGED', {
      job_id: id,
      job_title: existingJob.title,
      from_status: existingJob.status,
      to_status: updates.status,
      entity_type: 'job',
      entity_id: id,
    }).catch((err) => console.error('Automation evaluation failed:', err));
  }

  return getJobById(userId, updatedJob.id, { includeAll: options.includeAll });
}

export async function deleteJob(
  userId: string,
  id: number,
  options: { includeAll?: boolean } = {}
) {
  const params: any[] = [id];
  let whereClause = 'id = $1';
  if (!options.includeAll) {
    params.push(userId);
    whereClause += ` AND user_id = $${params.length}`;
  }

  const result = await pool.query(
    `DELETE FROM jobs WHERE ${whereClause} RETURNING id`,
    params
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return result.rows[0].id;
}
