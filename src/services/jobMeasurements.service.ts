import { pool } from '../db';
import * as jobsService from './jobs.service';

export class MeasurementNotFoundError extends Error {
  constructor(message = 'Measurement not found') {
    super(message);
    this.name = 'MeasurementNotFoundError';
  }
}

function normalizeRow(row: any) {
  return {
    id: row.id,
    job_id: row.job_id,
    label: row.label,
    value: Number(row.value ?? 0),
    unit: row.unit ?? '',
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listJobMeasurements(userId: string, jobId: number) {
  await jobsService.getJobById(userId, jobId);
  const result = await pool.query(
    `
    SELECT * FROM job_measurements
    WHERE job_id = $1
    ORDER BY sort_order ASC, id ASC
    `,
    [jobId]
  );
  return result.rows.map(normalizeRow);
}

export async function createJobMeasurement(
  userId: string,
  jobId: number,
  input: { label: string; value: number; unit?: string; sort_order?: number }
) {
  await jobsService.getJobById(userId, jobId);
  const result = await pool.query(
    `
    INSERT INTO job_measurements (job_id, label, value, unit, sort_order)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      jobId,
      input.label.trim(),
      input.value,
      input.unit?.trim() ?? '',
      input.sort_order ?? 0,
    ]
  );
  return normalizeRow(result.rows[0]);
}

export async function updateJobMeasurement(
  userId: string,
  jobId: number,
  measurementId: number,
  input: Partial<{
    label: string;
    value: number;
    unit: string;
    sort_order: number;
  }>
) {
  await jobsService.getJobById(userId, jobId);
  const existing = await pool.query(
    `SELECT id FROM job_measurements WHERE id = $1 AND job_id = $2`,
    [measurementId, jobId]
  );
  if (existing.rowCount === 0) {
    throw new MeasurementNotFoundError();
  }

  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (input.label !== undefined) {
    fields.push(`label = $${i++}`);
    values.push(input.label.trim());
  }
  if (input.value !== undefined) {
    fields.push(`value = $${i++}`);
    values.push(input.value);
  }
  if (input.unit !== undefined) {
    fields.push(`unit = $${i++}`);
    values.push(input.unit.trim());
  }
  if (input.sort_order !== undefined) {
    fields.push(`sort_order = $${i++}`);
    values.push(input.sort_order);
  }

  if (fields.length === 0) {
    const r = await pool.query(`SELECT * FROM job_measurements WHERE id = $1`, [
      measurementId,
    ]);
    return normalizeRow(r.rows[0]);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(measurementId);

  const result = await pool.query(
    `
    UPDATE job_measurements
    SET ${fields.join(', ')}
    WHERE id = $${i}
    RETURNING *
    `,
    values
  );

  return normalizeRow(result.rows[0]);
}

export async function deleteJobMeasurement(
  userId: string,
  jobId: number,
  measurementId: number
) {
  await jobsService.getJobById(userId, jobId);
  const result = await pool.query(
    `DELETE FROM job_measurements WHERE id = $1 AND job_id = $2 RETURNING id`,
    [measurementId, jobId]
  );
  if (result.rowCount === 0) {
    throw new MeasurementNotFoundError();
  }
  return measurementId;
}
