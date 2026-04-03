import { pool } from '../db';

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

export type GetJobsFilters = {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CreateJobInput = {
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
    l.last_name AS lead_last_name
  FROM jobs j
  LEFT JOIN leads l ON l.id = j.lead_id
`;

export async function getJobs(userId: string, filters: GetJobsFilters = {}) {
  const params: any[] = [userId];
  const where: string[] = ['j.user_id = $1'];

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

  params.push(filters.limit ?? 50);
  params.push(filters.offset ?? 0);

  const sql = `
    ${JOB_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY j.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return result.rows.map(normalizeJob);
}

export async function getJobById(userId: string, id: number) {
  const result = await pool.query(
    `
    ${JOB_SELECT}
    WHERE j.user_id = $1 AND j.id = $2
    LIMIT 1
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return normalizeJob(result.rows[0]);
}

export async function createJob(userId: string, input: CreateJobInput) {
  await ensureLeadBelongsToUser(input.lead_id, userId);

  const result = await pool.query(
    `
    INSERT INTO jobs (user_id, lead_id, title, description, status, address)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
    `,
    [
      userId,
      input.lead_id,
      input.title,
      input.description ?? null,
      input.status ?? 'New',
      input.address ?? null,
    ]
  );

  return getJobById(userId, result.rows[0].id);
}

export async function updateJob(
  userId: string,
  id: number,
  updates: UpdateJobInput
) {
  if ('lead_id' in updates) {
    throw new JobOwnershipError(
      'Job ownership cannot be changed after creation'
    );
  }

  const keys = Object.keys(updates) as (keyof UpdateJobInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  const sql = `
    UPDATE jobs
    SET ${setParts.join(', ')}
    WHERE user_id = $1 AND id = $2
    RETURNING *;
  `;

  const result = await pool.query(sql, values);

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return getJobById(userId, result.rows[0].id);
}

export async function deleteJob(userId: string, id: number) {
  const result = await pool.query(
    `DELETE FROM jobs WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return result.rows[0].id;
}
