import { pool } from '../db';

export type jobActivityType = {
  userId: string;
  jobId: number;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: number | null;
  metadata?: string | null;
};

export async function createJobActivity({
  userId,
  jobId,
  type,
  title,
  message,
  entityType = null,
  entityId = null,
  metadata = null,
}: jobActivityType) {
  const { rows } = await pool.query(
    `
    INSERT INTO job_activity (
      user_id,
      job_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING *;
    `,
    [
      userId,
      jobId,
      type,
      title,
      message,
      entityType,
      entityId,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  console.log(rows);

  return rows[0];
}

export async function getJobActivitiesByUser(userId: string) {
  const { rows } = await pool.query(
    `
        SELECT * FROM job_activity
        WHERE user_id = $1
        ORDER BY created_at DESC;
        `,
    [userId]
  );

  return rows;
}

export async function getJobActivitiesByJob(userId: string, jobId: number) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM job_activity
    WHERE user_id = $1 AND job_id = $2
    ORDER BY created_at DESC
    `,
    [userId, jobId]
  );

  return rows;
}
