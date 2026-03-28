import { pool } from '../db';

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export type GetJobsFilters = {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CreateJobInput = {
  title: string;
  description?: string | null;
  status?: string | null;
  address?: string | null;
};

export type UpdateJobInput = Partial<CreateJobInput>;

export async function getJobs(userId: number, filters: GetJobsFilters = {}) {
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
    SELECT j.*
    FROM jobs j
    WHERE ${where.join(' AND ')}
    ORDER BY j.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getJobById(userId: number, id: number) {
  const result = await pool.query(
    `SELECT * FROM jobs WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return result.rows[0];
}

export async function createJob(userId: number, input: CreateJobInput) {
  const result = await pool.query(
    `
    INSERT INTO jobs (user_id, title, description, status, address)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [
      userId,
      input.title,
      input.description ?? null,
      input.status ?? 'New',
      input.address ?? null,
    ]
  );

  return result.rows[0];
}

export async function updateJob(
  userId: number,
  id: number,
  updates: UpdateJobInput
) {
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

  return result.rows[0];
}

export async function deleteJob(userId: number, id: number) {
  const result = await pool.query(
    `DELETE FROM jobs WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }

  return result.rows[0].id;
}
