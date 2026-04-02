import { pool } from '../db';
import fs from 'fs';
import path from 'path';

export class FileNotFoundError extends Error {
  constructor(message = 'File not found') {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

export class LeadNotFoundError extends Error {
  constructor(message = 'Lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export type CreateFileInput = {
  uploadedByUserId: number;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  leadId?: number | null;
  jobId?: number | null;
};

async function ensureLeadExists(leadId: number) {
  const result = await pool.query(
    `
    SELECT id
    FROM leads
    WHERE id = $1
    `,
    [leadId]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }
}

async function ensureJobExists(jobId: number) {
  const result = await pool.query(`SELECT id FROM jobs WHERE id = $1`, [jobId]);

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
}

export async function createFile(input: CreateFileInput) {
  if (input.leadId != null) {
    await ensureLeadExists(input.leadId);
  }

  if (input.jobId != null) {
    await ensureJobExists(input.jobId);
  }

  const result = await pool.query(
    `
    INSERT INTO files (
      uploaded_by_user_id,
      original_name,
      storage_key,
      mime_type,
      size_bytes,
      lead_id,
      job_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      input.uploadedByUserId,
      input.originalName,
      input.storageKey,
      input.mimeType,
      input.sizeBytes,
      input.leadId ?? null,
      input.jobId ?? null,
    ]
  );

  return result.rows[0];
}

export async function getFiles(leadId?: number | null, jobId?: number | null) {
  if (leadId != null) {
    await ensureLeadExists(leadId);
  }

  if (jobId != null) {
    await ensureJobExists(jobId);
  }

  const params: any[] = [];
  let whereClause = '';

  if (leadId != null) {
    params.push(leadId);
    whereClause = `WHERE f.lead_id = $1`;
  } else if (jobId != null) {
    params.push(jobId);
    whereClause = `WHERE f.job_id = $1`;
  }

  const result = await pool.query(
    `
    SELECT
      f.*,
      u.first_name,
      u.last_name
    FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by_user_id
    ${whereClause}
    ORDER BY f.created_at DESC
    `,
    params
  );

  return result.rows;
}

export async function deleteFile(id: number) {
  const result = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
  const file = result.rows[0];

  if (!file) {
    throw new FileNotFoundError();
  }

  const filePath = path.join(process.cwd(), 'uploads', file.storage_key);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await pool.query(`DELETE FROM files WHERE id = $1`, [id]);

  return file;
}
