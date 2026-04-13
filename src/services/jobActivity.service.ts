import { pool } from '../db';

export type JobActivityMetadata = Record<string, unknown> | null;

export type CreateJobActivityInput = {
  userId: string;
  jobId: number;
  type:
    | 'JOB_CREATED'
    | 'JOB_STATUS_CHANGED'
    | 'ESTIMATE_CREATED'
    | 'ESTIMATE_UPDATED'
    | 'ESTIMATE_STATUS_CHANGED'
    | 'ESTIMATE_CLIENT_RESPONDED'
    | 'ESTIMATE_DELETED'
    | 'ESTIMATE_RESENT_TO_CLIENT'
    | 'TASK_CREATED'
    | 'TASK_COMPLETED'
    | 'TASK_REOPENED'
    | 'TASK_UPDATED'
    | 'FILE_UPLOADED'
    | 'FILE_DELETED';
  title: string;
  message?: string | null;
  entityType?: 'job' | 'task' | 'file' | 'estimate' | null;
  entityId?: number | null;
  metadata?: JobActivityMetadata;
};

export async function createJobActivity({
  userId,
  jobId,
  type,
  title,
  message = null,
  entityType = null,
  entityId = null,
  metadata = null,
}: CreateJobActivityInput) {
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
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

export async function getJobActivitiesByJob(
  userId: string,
  jobId: number,
  limit: number
) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM job_activity
    WHERE user_id = $1 AND job_id = $2
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [userId, jobId, limit + 1]
  );
  const hasMore = rows.length > limit;
  const activity = hasMore ? rows.slice(0, limit) : rows;

  return { activity, hasMore };
}
