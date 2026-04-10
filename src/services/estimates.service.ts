import { pool } from '../db';
import { createJobActivity } from './jobActivity.service';

export class EstimateNotFoundError extends Error {
  constructor(message = 'Estimate not found') {
    super(message);
    this.name = 'EstimateNotFoundError';
  }
}

export class EstimateLineItemNotFoundError extends Error {
  constructor(message = 'Estimate line item not found') {
    super(message);
    this.name = 'EstimateLineItemNotFoundError';
  }
}

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export class EstimateOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EstimateOwnershipError';
  }
}

export type CreateEstimateInput = {
  job_id: number;
  title: string;
  status?: 'Draft' | 'Sent' | 'Approved' | 'Rejected' | null;
  notes?: string | null;
};

export type UpdateEstimateInput = Partial<{
  title: string;
  status: 'Draft' | 'Sent' | 'Approved' | 'Rejected';
  notes: string | null;
  job_id: number | null;
}>;

export type CreateEstimateLineItemInput = {
  name: string;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  sort_order?: number | null;
  source?: 'manual' | 'abc_supply' | null;
};

export type UpdateEstimateLineItemInput = Partial<CreateEstimateLineItemInput>;

const ESTIMATE_SELECT = `
  SELECT
    e.id,
    e.user_id,
    e.job_id,
    e.title,
    e.status,
    e.subtotal,
    e.tax_total,
    e.discount_total,
    e.grand_total,
    e.notes,
    e.created_at,
    e.updated_at,

    j.title AS job_title,
    j.status AS job_status,
    j.address AS job_address,
    j.lead_id AS job_lead_id,

    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM estimates e
  INNER JOIN jobs j ON j.id = e.job_id
  LEFT JOIN leads l ON l.id = j.lead_id
`;

function toNumber(value: unknown, fallback = 0) {
  if (value == null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error('Invalid numeric value');
  return num;
}

function normalizeMoney(value: unknown) {
  return Number(toNumber(value, 0).toFixed(2));
}

function buildLeadName(row: any) {
  const first = String(row.lead_first_name || '').trim();
  const last = String(row.lead_last_name || '').trim();
  const full = `${first} ${last}`.trim();

  if (full) return full;
  if (row.job_lead_id != null) return `Lead #${row.job_lead_id}`;
  return null;
}

function normalizeEstimate(row: any, lineItems: any[] = []) {
  return {
    id: row.id,
    user_id: row.user_id,
    job_id: row.job_id,
    title: row.title,
    status: row.status,
    subtotal: Number(row.subtotal ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    discount_total: Number(row.discount_total ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,

    job: {
      id: row.job_id,
      title: row.job_title ?? `Job #${row.job_id}`,
      status: row.job_status ?? null,
      address: row.job_address ?? null,
      lead_id: row.job_lead_id ?? null,
      lead_name: buildLeadName(row),
    },

    line_items: lineItems.map(normalizeEstimateLineItem),
  };
}

function normalizeEstimateLineItem(row: any) {
  return {
    id: row.id,
    estimate_id: row.estimate_id,
    name: row.name,
    description: row.description,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    line_total: Number(row.line_total ?? 0),
    sort_order: row.sort_order,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureJobBelongsToUser(jobId: number, userId: string) {
  const result = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
}

async function ensureEstimateBelongsToUser(userId: string, estimateId: number) {
  const result = await pool.query(
    `
      SELECT e.id
      FROM estimates e
      WHERE e.id = $1 AND e.user_id = $2
      LIMIT 1
    `,
    [estimateId, userId]
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }
}

async function getEstimateLineItemsRaw(estimateId: number) {
  const result = await pool.query(
    `
      SELECT
        id,
        estimate_id,
        name,
        description,
        quantity,
        unit_price,
        line_total,
        sort_order,
        source,
        created_at,
        updated_at
      FROM estimate_line_items
      WHERE estimate_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [estimateId]
  );

  return result.rows;
}

async function recalculateEstimateTotals(
  client: any,
  estimateId: number,
  userId: string
) {
  const totalsRes = await client.query(
    `
      SELECT
        COALESCE(SUM(line_total), 0)::numeric AS subtotal
      FROM estimate_line_items
      WHERE estimate_id = $1
    `,
    [estimateId]
  );

  const subtotal = normalizeMoney(totalsRes.rows[0]?.subtotal ?? 0);

  const estimateRes = await client.query(
    `
      SELECT tax_total, discount_total
      FROM estimates
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [estimateId, userId]
  );

  if (estimateRes.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const taxTotal = normalizeMoney(estimateRes.rows[0].tax_total ?? 0);
  const discountTotal = normalizeMoney(estimateRes.rows[0].discount_total ?? 0);
  const grandTotal = normalizeMoney(subtotal + taxTotal - discountTotal);

  await client.query(
    `
      UPDATE estimates
      SET
        subtotal = $3,
        grand_total = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `,
    [estimateId, userId, subtotal, grandTotal]
  );
}

export async function getEstimatesByJobId(userId: string, jobId: number) {
  await ensureJobBelongsToUser(jobId, userId);

  const result = await pool.query(
    `
      ${ESTIMATE_SELECT}
      WHERE e.user_id = $1 AND e.job_id = $2
      ORDER BY e.created_at DESC
    `,
    [userId, jobId]
  );

  return result.rows.map((row: any) => normalizeEstimate(row, []));
}

export async function getEstimateById(userId: string, id: number) {
  const result = await pool.query(
    `
      ${ESTIMATE_SELECT}
      WHERE e.user_id = $1 AND e.id = $2
      LIMIT 1
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const lineItems = await getEstimateLineItemsRaw(id);
  return normalizeEstimate(result.rows[0], lineItems);
}

export async function createEstimate(
  userId: string,
  input: CreateEstimateInput
) {
  await ensureJobBelongsToUser(input.job_id, userId);

  const result = await pool.query(
    `
      INSERT INTO estimates (
        user_id,
        job_id,
        title,
        status,
        notes
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [
      userId,
      input.job_id,
      input.title,
      input.status ?? 'Draft',
      input.notes ?? null,
    ]
  );

  const estimate = await getEstimateById(userId, result.rows[0].id);

  await createJobActivity({
    userId,
    jobId: estimate.job_id,
    type: 'ESTIMATE_CREATED',
    title: 'Estimate created',
    message: `${estimate.title} was created`,
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      estimateId: estimate.id,
      estimateTitle: estimate.title,
    },
  });

  return estimate;
}

export async function updateEstimate(
  userId: string,
  id: number,
  updates: UpdateEstimateInput
) {
  const existing = await getEstimateById(userId, id);

  if ('job_id' in updates && updates.job_id !== existing.job_id) {
    throw new EstimateOwnershipError(
      'Estimate job ownership cannot be changed after creation'
    );
  }

  const allowedKeys = ['title', 'status', 'notes'] as const;
  const keys = allowedKeys.filter((key) => key in updates);

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    values.push((updates as any)[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push('updated_at = CURRENT_TIMESTAMP');

  const result = await pool.query(
    `
      UPDATE estimates
      SET ${setParts.join(', ')}
      WHERE user_id = $1 AND id = $2
      RETURNING id
    `,
    values
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const updated = await getEstimateById(userId, id);

  const statusChanged =
    'status' in updates && updates.status !== existing.status;

  await createJobActivity({
    userId,
    jobId: updated.job_id,
    type: statusChanged ? 'ESTIMATE_STATUS_CHANGED' : 'ESTIMATE_UPDATED',
    title: statusChanged ? 'Estimate status updated' : 'Estimate updated',
    message: statusChanged
      ? `${updated.title} changed from ${existing.status} → ${updated.status}`
      : `${updated.title} was updated`,
    entityType: 'estimate',
    entityId: updated.id,
    metadata: {
      estimateId: updated.id,
      previousStatus: existing.status,
      newStatus: updated.status,
    },
  });

  return updated;
}

export async function deleteEstimate(userId: string, id: number) {
  const result = await pool.query(
    `
      DELETE FROM estimates
      WHERE user_id = $1 AND id = $2
      RETURNING id
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  return result.rows[0].id;
}

export async function addEstimateLineItem(
  userId: string,
  estimateId: number,
  input: CreateEstimateLineItemInput
) {
  await ensureEstimateBelongsToUser(userId, estimateId);

  const quantity = normalizeMoney(toNumber(input.quantity, 1));
  const unitPrice = normalizeMoney(toNumber(input.unit_price, 0));
  const lineTotal = normalizeMoney(quantity * unitPrice);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        INSERT INTO estimate_line_items (
          estimate_id,
          name,
          description,
          quantity,
          unit_price,
          line_total,
          sort_order,
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        estimateId,
        input.name,
        input.description ?? null,
        quantity,
        unitPrice,
        lineTotal,
        input.sort_order ?? 0,
        input.source ?? 'manual',
      ]
    );

    await recalculateEstimateTotals(client, estimateId, userId);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getEstimateById(userId, estimateId);
}

export async function updateEstimateLineItem(
  userId: string,
  estimateId: number,
  lineItemId: number,
  updates: UpdateEstimateLineItemInput
) {
  await ensureEstimateBelongsToUser(userId, estimateId);

  const existingRes = await pool.query(
    `
      SELECT *
      FROM estimate_line_items
      WHERE id = $1 AND estimate_id = $2
      LIMIT 1
    `,
    [lineItemId, estimateId]
  );

  if (existingRes.rowCount === 0) {
    throw new EstimateLineItemNotFoundError();
  }

  const existing = existingRes.rows[0];

  const nextQuantity =
    'quantity' in updates
      ? normalizeMoney(toNumber(updates.quantity, 0))
      : Number(existing.quantity);

  const nextUnitPrice =
    'unit_price' in updates
      ? normalizeMoney(toNumber(updates.unit_price, 0))
      : Number(existing.unit_price);

  const nextLineTotal = normalizeMoney(nextQuantity * nextUnitPrice);

  const setParts: string[] = [];
  const values: any[] = [lineItemId, estimateId];

  if ('name' in updates) {
    values.push(updates.name ?? existing.name);
    setParts.push(`name = $${values.length}`);
  }

  if ('description' in updates) {
    values.push(updates.description ?? null);
    setParts.push(`description = $${values.length}`);
  }

  if ('quantity' in updates) {
    values.push(nextQuantity);
    setParts.push(`quantity = $${values.length}`);
  }

  if ('unit_price' in updates) {
    values.push(nextUnitPrice);
    setParts.push(`unit_price = $${values.length}`);
  }

  if ('sort_order' in updates) {
    values.push(updates.sort_order ?? 0);
    setParts.push(`sort_order = $${values.length}`);
  }

  if ('source' in updates) {
    values.push(updates.source ?? 'manual');
    setParts.push(`source = $${values.length}`);
  }

  values.push(nextLineTotal);
  setParts.push(`line_total = $${values.length}`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE estimate_line_items
        SET ${setParts.join(', ')}
        WHERE id = $1 AND estimate_id = $2
      `,
      values
    );

    await recalculateEstimateTotals(client, estimateId, userId);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getEstimateById(userId, estimateId);
}

export async function deleteEstimateLineItem(
  userId: string,
  estimateId: number,
  lineItemId: number
) {
  await ensureEstimateBelongsToUser(userId, estimateId);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const deleteRes = await client.query(
      `
        DELETE FROM estimate_line_items
        WHERE id = $1 AND estimate_id = $2
        RETURNING id
      `,
      [lineItemId, estimateId]
    );

    if (deleteRes.rowCount === 0) {
      throw new EstimateLineItemNotFoundError();
    }

    await recalculateEstimateTotals(client, estimateId, userId);

    await client.query('COMMIT');

    return deleteRes.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
