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

export class UserNotProvidedError extends Error {
  constructor(message = 'User not provided') {
    super(message);
    this.name = 'UserNotProvidedError';
  }
}

export class FileOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOwnershipError';
  }
}

export type CreateFileInput = {
  uploadedByUserId: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  leadId?: number | null;
  jobId?: number | null;
};

async function ensureLeadBelongsToUser(leadId: number, userId: string) {
  const result = await pool.query(
    `
    SELECT id
    FROM leads
    WHERE id = $1 AND user_id = $2
    `,
    [leadId, userId]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }
}

async function ensureJobBelongsToUser(jobId: number, userId: string) {
  const result = await pool.query(
    `
    SELECT id
    FROM jobs
    WHERE id = $1 AND user_id = $2
    `,
    [jobId, userId]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
}

export async function createFile(input: CreateFileInput) {
  const { uploadedByUserId, leadId = null, jobId = null } = input;

  if (!uploadedByUserId) {
    throw new UserNotProvidedError();
  }

  if (leadId != null && jobId != null) {
    throw new FileOwnershipError('File cannot belong to both a lead and a job');
  }

  if (leadId != null) {
    await ensureLeadBelongsToUser(leadId, uploadedByUserId);
  }

  if (jobId != null) {
    await ensureJobBelongsToUser(jobId, uploadedByUserId);
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
    RETURNING *;
    `,
    [
      uploadedByUserId,
      input.originalName,
      input.storageKey,
      input.mimeType,
      input.sizeBytes,
      leadId,
      jobId,
    ]
  );

  return result.rows[0];
}

export async function getFiles(
  userId: string,
  leadId?: number | null,
  jobId?: number | null
) {
  if (!userId) {
    throw new UserNotProvidedError();
  }

  if (leadId != null && jobId != null) {
    throw new FileOwnershipError(
      'Files cannot be requested for both a lead and a job'
    );
  }

  if (leadId != null) {
    await ensureLeadBelongsToUser(leadId, userId);
  }

  if (jobId != null) {
    await ensureJobBelongsToUser(jobId, userId);
  }

  const params: any[] = [userId];
  const where: string[] = ['f.uploaded_by_user_id = $1'];

  if (leadId != null) {
    params.push(leadId);
    where.push(`f.lead_id = $${params.length}`);
  } else if (jobId != null) {
    params.push(jobId);
    where.push(`f.job_id = $${params.length}`);
  }

  const result = await pool.query(
    `
    SELECT
      f.*,
      u.first_name,
      u.last_name
    FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY f.created_at DESC
    `,
    params
  );

  return result.rows;
}

export async function deleteFile(userId: string, id: number) {
  if (!userId) {
    throw new UserNotProvidedError();
  }

  const result = await pool.query(
    `
    SELECT *
    FROM files
    WHERE id = $1 AND uploaded_by_user_id = $2
    `,
    [id, userId]
  );

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
