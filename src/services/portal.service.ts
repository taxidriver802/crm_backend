import crypto from 'crypto';
import { pool } from '../db';
import { trackEvent } from './productEvents.service';

export class PortalTokenError extends Error {
  constructor(message = 'Invalid or expired portal link') {
    super(message);
    this.name = 'PortalTokenError';
  }
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function generatePortalToken(
  userId: string,
  jobId: number
): Promise<{ token: string; expires_at: Date }> {
  const jobRes = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  if (jobRes.rowCount === 0) throw new Error('Job not found');

  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO portal_tokens (user_id, job_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id) DO UPDATE SET
       token_hash = $3, expires_at = $4, updated_at = CURRENT_TIMESTAMP`,
    [userId, jobId, hash, expiresAt]
  );

  return { token: raw, expires_at: expiresAt };
}

export async function getPortalData(rawToken: string) {
  const hash = sha256(String(rawToken).trim());

  const tokenRes = await pool.query(
    `SELECT * FROM portal_tokens
     WHERE token_hash = $1
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     LIMIT 1`,
    [hash]
  );
  if (tokenRes.rowCount === 0) throw new PortalTokenError();

  const { job_id, user_id } = tokenRes.rows[0];

  const jobRes = await pool.query(
    `SELECT j.id, j.title, j.description, j.status, j.address, j.created_at,
            l.first_name AS lead_first_name, l.last_name AS lead_last_name,
            l.email AS lead_email, l.phone AS lead_phone
     FROM jobs j
     LEFT JOIN leads l ON l.id = j.lead_id
     WHERE j.id = $1`,
    [job_id]
  );
  if (jobRes.rowCount === 0) throw new PortalTokenError();
  const job = jobRes.rows[0];

  const estimatesRes = await pool.query(
    `SELECT id, title, status, grand_total, created_at, updated_at
     FROM estimates WHERE job_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [job_id, user_id]
  );

  const invoicesRes = await pool.query(
    `SELECT id, invoice_number, status, grand_total, due_date, paid_at, created_at
     FROM invoices WHERE job_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [job_id, user_id]
  );

  const filesRes = await pool.query(
    `SELECT id, original_name, mime_type, size_bytes, storage_key, created_at
     FROM files WHERE job_id = $1
     ORDER BY created_at DESC`,
    [job_id]
  );

  const leadName = [job.lead_first_name, job.lead_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  trackEvent('portal_viewed', {
    userId: user_id,
    entityType: 'job',
    entityId: job_id,
  });

  return {
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      status: job.status,
      address: job.address,
      created_at: job.created_at,
      lead_name: leadName || null,
      lead_email: job.lead_email,
      lead_phone: job.lead_phone,
    },
    estimates: estimatesRes.rows.map((e: any) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      grand_total: Number(e.grand_total ?? 0),
      created_at: e.created_at,
      updated_at: e.updated_at,
    })),
    invoices: invoicesRes.rows.map((i: any) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      status: i.status,
      grand_total: Number(i.grand_total ?? 0),
      due_date: i.due_date,
      paid_at: i.paid_at,
      created_at: i.created_at,
    })),
    files: filesRes.rows.map((f: any) => ({
      id: f.id,
      original_name: f.original_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      storage_key: f.storage_key,
      created_at: f.created_at,
    })),
  };
}

export async function revokePortalToken(userId: string, jobId: number) {
  await pool.query(
    `DELETE FROM portal_tokens WHERE job_id = $1 AND user_id = $2`,
    [jobId, userId]
  );
}
