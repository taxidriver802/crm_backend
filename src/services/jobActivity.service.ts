import { pool } from '../db';
import { applyTenantScope, tenantScope } from '../lib/tenant';

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
    | 'FILE_DELETED'
    | 'INVOICE_CREATED'
    | 'INVOICE_UPDATED'
    | 'INVOICE_STATUS_CHANGED'
    | 'INVOICE_DELETED'
    | 'INVOICE_PAID'
    | 'COMMUNICATION_LOGGED';
  title: string;
  message?: string | null;
  entityType?: 'job' | 'task' | 'file' | 'estimate' | 'invoice' | 'note' | null;
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
      metadata,
      company_id
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, u.company_id
    FROM users u
    WHERE u.id = $1
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
export async function getJobActivitiesByUser(
  userId: string,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const where: string[] = [];
  applyTenantScope(where, params, scope);
  const { rows } = await pool.query(
    `
        SELECT * FROM job_activity
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC;
        `,
    params
  );

  return rows;
}

export async function getJobActivitiesByJob(
  userId: string,
  jobId: number,
  limit: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [jobId];
  const where: string[] = ['job_id = $1'];
  applyTenantScope(where, params, scope);
  params.push(limit + 1);
  const { rows } = await pool.query(
    `
    SELECT *
    FROM job_activity
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params
  );
  const hasMore = rows.length > limit;
  const activity = hasMore ? rows.slice(0, limit) : rows;

  return { activity, hasMore };
}
