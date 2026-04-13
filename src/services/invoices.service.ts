import crypto from 'crypto';
import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { createJobActivity } from './jobActivity.service';
import { buildInvoicePdfBuffer } from '../lib/invoicePdf';
import {
  calculateLineItem,
  normalizeMoney,
  calculateEstimateTotals,
} from './estimateCalculations';
import { trackEvent } from './productEvents.service';

export class InvoiceNotFoundError extends Error {
  constructor(message = 'Invoice not found') {
    super(message);
    this.name = 'InvoiceNotFoundError';
  }
}

export class InvoiceLineItemNotFoundError extends Error {
  constructor(message = 'Invoice line item not found') {
    super(message);
    this.name = 'InvoiceLineItemNotFoundError';
  }
}

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export class EstimateNotFoundError extends Error {
  constructor(message = 'Estimate not found or not approved') {
    super(message);
    this.name = 'EstimateNotFoundError';
  }
}

export class InvoiceAlreadyExistsError extends Error {
  constructor(
    public existingInvoiceId: number,
    message = 'An invoice already exists for this estimate'
  ) {
    super(message);
    this.name = 'InvoiceAlreadyExistsError';
  }
}

export type InvoiceStatus = 'Draft' | 'Sent' | 'Paid' | 'Overdue';

export type CreateInvoiceInput = {
  job_id: number;
  estimate_id?: number | null;
  status?: InvoiceStatus;
  due_date?: string | null;
  notes?: string | null;
};

export type UpdateInvoiceInput = Partial<{
  status: InvoiceStatus;
  due_date: string | null;
  notes: string | null;
}>;

export type CreateInvoiceLineItemInput = {
  name: string;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  sort_order?: number | null;
};

export type UpdateInvoiceLineItemInput = Partial<CreateInvoiceLineItemInput>;

const INVOICE_SELECT = `
  SELECT
    i.id,
    i.user_id,
    i.job_id,
    i.estimate_id,
    i.invoice_number,
    i.status,
    i.subtotal,
    i.tax_total,
    i.discount_total,
    i.grand_total,
    i.due_date,
    i.paid_at,
    i.notes,
    i.share_token_hash,
    i.share_expires_at,
    i.created_at,
    i.updated_at,

    j.title AS job_title,
    j.status AS job_status,
    j.address AS job_address,
    j.lead_id AS job_lead_id,

    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM invoices i
  INNER JOIN jobs j ON j.id = i.job_id
  LEFT JOIN leads l ON l.id = j.lead_id
`;

function buildLeadName(row: any) {
  const first = String(row.lead_first_name || '').trim();
  const last = String(row.lead_last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (row.job_lead_id != null) return `Lead #${row.job_lead_id}`;
  return null;
}

function normalizeInvoice(row: any, lineItems: any[] = []) {
  return {
    id: row.id,
    user_id: row.user_id,
    job_id: row.job_id,
    estimate_id: row.estimate_id,
    invoice_number: row.invoice_number,
    status: row.status,
    subtotal: Number(row.subtotal ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    discount_total: Number(row.discount_total ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    due_date: row.due_date,
    paid_at: row.paid_at,
    notes: row.notes,
    share_expires_at: row.share_expires_at ?? null,
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
    line_items: lineItems.map(normalizeLineItem),
  };
}

function normalizeLineItem(row: any) {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    name: row.name,
    description: row.description,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    line_total: Number(row.line_total ?? 0),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureJobBelongsToUser(jobId: number, userId: string) {
  const result = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  if (result.rowCount === 0) throw new JobNotFoundError();
}

async function ensureInvoiceBelongsToUser(userId: string, invoiceId: number) {
  const result = await pool.query(
    `SELECT id FROM invoices WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [invoiceId, userId]
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();
}

async function getInvoiceLineItemsRaw(invoiceId: number) {
  const result = await pool.query(
    `SELECT * FROM invoice_line_items
     WHERE invoice_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [invoiceId]
  );
  return result.rows;
}

async function nextInvoiceNumber(userId: string): Promise<string> {
  const seq = await pool.query(`SELECT nextval('invoice_number_seq') AS val`);
  const num = Number(seq.rows[0].val);
  return `INV-${String(num).padStart(4, '0')}`;
}

async function recalculateTotals(
  client: any,
  invoiceId: number,
  userId: string
) {
  const totalsRes = await client.query(
    `SELECT COALESCE(SUM(line_total), 0)::numeric AS subtotal
     FROM invoice_line_items WHERE invoice_id = $1`,
    [invoiceId]
  );
  const subtotal = normalizeMoney(totalsRes.rows[0]?.subtotal ?? 0);

  const invoiceRes = await client.query(
    `SELECT tax_total, discount_total FROM invoices
     WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [invoiceId, userId]
  );
  if (invoiceRes.rowCount === 0) throw new InvoiceNotFoundError();

  const taxTotal = normalizeMoney(invoiceRes.rows[0].tax_total ?? 0);
  const discountTotal = normalizeMoney(invoiceRes.rows[0].discount_total ?? 0);

  const totals = calculateEstimateTotals({
    subtotal,
    tax_total: taxTotal,
    discount_total: discountTotal,
  });

  await client.query(
    `UPDATE invoices
     SET subtotal = $3, grand_total = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2`,
    [invoiceId, userId, totals.subtotal, totals.grand_total]
  );
}

// ─── CRUD ──────────────────────────────────────────────

export async function getInvoicesByJobId(userId: string, jobId: number) {
  await ensureJobBelongsToUser(jobId, userId);
  const result = await pool.query(
    `${INVOICE_SELECT} WHERE i.user_id = $1 AND i.job_id = $2 ORDER BY i.created_at DESC`,
    [userId, jobId]
  );
  return result.rows.map((r: any) => normalizeInvoice(r, []));
}

export async function getInvoiceById(userId: string, id: number) {
  const result = await pool.query(
    `${INVOICE_SELECT} WHERE i.user_id = $1 AND i.id = $2 LIMIT 1`,
    [userId, id]
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();
  const lineItems = await getInvoiceLineItemsRaw(id);
  return normalizeInvoice(result.rows[0], lineItems);
}

export async function createInvoice(userId: string, input: CreateInvoiceInput) {
  await ensureJobBelongsToUser(input.job_id, userId);
  const invoiceNumber = await nextInvoiceNumber(userId);

  const result = await pool.query(
    `INSERT INTO invoices (
       user_id, job_id, estimate_id, invoice_number, status, due_date, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      input.job_id,
      input.estimate_id ?? null,
      invoiceNumber,
      input.status ?? 'Draft',
      input.due_date ?? null,
      input.notes ?? null,
    ]
  );

  const invoice = await getInvoiceById(userId, result.rows[0].id);

  await createJobActivity({
    userId,
    jobId: invoice.job_id,
    type: 'INVOICE_CREATED',
    title: 'Invoice created',
    message: `${invoice.invoice_number} was created`,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
    },
  });

  await createNotification({
    userId,
    type: 'INVOICE_CREATED',
    title: 'New invoice',
    message: `${invoice.invoice_number} created for ${invoice.job?.title ?? `Job #${invoice.job_id}`}.`,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      jobId: invoice.job_id,
      invoiceNumber: invoice.invoice_number,
    },
  });

  trackEvent('invoice_created', {
    userId,
    entityType: 'invoice',
    entityId: invoice.id,
  });

  return invoice;
}

export async function createInvoiceFromEstimate(
  userId: string,
  estimateId: number,
  options?: { due_date?: string | null }
) {
  // Idempotency: return existing invoice if one was already created from this estimate
  const existing = await pool.query(
    `SELECT id FROM invoices WHERE user_id = $1 AND estimate_id = $2 LIMIT 1`,
    [userId, estimateId]
  );
  if (existing.rowCount! > 0) {
    return getInvoiceById(userId, existing.rows[0].id);
  }

  const estRes = await pool.query(
    `SELECT e.*, j.id AS jid FROM estimates e
     INNER JOIN jobs j ON j.id = e.job_id
     WHERE e.id = $1 AND e.user_id = $2 AND e.status = 'Approved'
     LIMIT 1`,
    [estimateId, userId]
  );
  if (estRes.rowCount === 0) throw new EstimateNotFoundError();
  const est = estRes.rows[0];

  const invoiceNumber = await nextInvoiceNumber(userId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `INSERT INTO invoices (
         user_id, job_id, estimate_id, invoice_number, status,
         subtotal, tax_total, discount_total, grand_total,
         due_date, notes
       ) VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        userId,
        est.job_id,
        estimateId,
        invoiceNumber,
        est.subtotal,
        est.tax_total,
        est.discount_total,
        est.grand_total,
        options?.due_date ?? null,
        est.notes,
      ]
    );
    const invoiceId = invRes.rows[0].id;

    const items = await pool.query(
      `SELECT * FROM estimate_line_items WHERE estimate_id = $1 ORDER BY sort_order, id`,
      [estimateId]
    );

    for (const item of items.rows) {
      await client.query(
        `INSERT INTO invoice_line_items (
           invoice_id, name, description, quantity, unit_price, line_total, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          invoiceId,
          item.name,
          item.description,
          item.quantity,
          item.unit_price,
          item.line_total,
          item.sort_order,
        ]
      );
    }

    await client.query('COMMIT');

    const invoice = await getInvoiceById(userId, invoiceId);

    await createJobActivity({
      userId,
      jobId: invoice.job_id,
      type: 'INVOICE_CREATED',
      title: 'Invoice created from estimate',
      message: `${invoice.invoice_number} generated from estimate #${estimateId}`,
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        estimateId,
      },
    });

    await createNotification({
      userId,
      type: 'INVOICE_CREATED',
      title: 'Invoice generated',
      message: `${invoice.invoice_number} created from approved estimate for ${invoice.job?.title ?? `Job #${invoice.job_id}`}.`,
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        jobId: invoice.job_id,
        invoiceNumber: invoice.invoice_number,
        estimateId,
      },
    });

    trackEvent('invoice_created', {
      userId,
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: { from_estimate: estimateId },
    });

    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateInvoice(
  userId: string,
  id: number,
  updates: UpdateInvoiceInput
) {
  const existing = await getInvoiceById(userId, id);

  const allowedKeys = ['status', 'due_date', 'notes'] as const;
  const keys = allowedKeys.filter((k) => k in updates);
  if (keys.length === 0) throw new Error('No fields to update');

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    values.push((updates as any)[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  const markPaid =
    'status' in updates &&
    updates.status === 'Paid' &&
    existing.status !== 'Paid';

  if (markPaid) {
    setParts.push(`paid_at = CURRENT_TIMESTAMP`);
  }

  setParts.push('updated_at = CURRENT_TIMESTAMP');

  const result = await pool.query(
    `UPDATE invoices SET ${setParts.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING id`,
    values
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();

  const updated = await getInvoiceById(userId, id);
  const statusChanged =
    'status' in updates && updates.status !== existing.status;

  await createJobActivity({
    userId,
    jobId: updated.job_id,
    type: statusChanged ? 'INVOICE_STATUS_CHANGED' : 'INVOICE_UPDATED',
    title: statusChanged ? 'Invoice status updated' : 'Invoice updated',
    message: statusChanged
      ? `${updated.invoice_number} changed from ${existing.status} → ${updated.status}`
      : `${updated.invoice_number} was updated`,
    entityType: 'invoice',
    entityId: updated.id,
    metadata: {
      invoiceId: updated.id,
      invoiceNumber: updated.invoice_number,
      previousStatus: existing.status,
      newStatus: updated.status,
    },
  });

  if (statusChanged) {
    const nType = markPaid ? 'INVOICE_PAID' : 'INVOICE_STATUS_CHANGED';
    await createNotification({
      userId,
      type: nType,
      title: markPaid ? 'Invoice paid' : 'Invoice status updated',
      message: `${updated.invoice_number}: ${existing.status} → ${updated.status}`,
      entityType: 'invoice',
      entityId: updated.id,
      metadata: {
        jobId: updated.job_id,
        previousStatus: existing.status,
        newStatus: updated.status,
      },
    });

    if (markPaid) {
      trackEvent('invoice_marked_paid', {
        userId,
        entityType: 'invoice',
        entityId: updated.id,
      });
    }
  }

  return updated;
}

export async function deleteInvoice(userId: string, id: number) {
  const existing = await getInvoiceById(userId, id);
  const result = await pool.query(
    `DELETE FROM invoices WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();

  await createJobActivity({
    userId,
    jobId: existing.job_id,
    type: 'INVOICE_DELETED',
    title: 'Invoice deleted',
    message: `${existing.invoice_number} was deleted`,
    entityType: 'invoice',
    entityId: existing.id,
    metadata: {
      invoiceId: existing.id,
      invoiceNumber: existing.invoice_number,
    },
  });

  return result.rows[0].id;
}

// ─── LINE ITEMS ────────────────────────────────────────

export async function addInvoiceLineItem(
  userId: string,
  invoiceId: number,
  input: CreateInvoiceLineItemInput
) {
  await ensureInvoiceBelongsToUser(userId, invoiceId);
  const { quantity, unit_price, line_total } = calculateLineItem({
    quantity: input.quantity,
    unit_price: input.unit_price,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO invoice_line_items (
         invoice_id, name, description, quantity, unit_price, line_total, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        invoiceId,
        input.name,
        input.description ?? null,
        quantity,
        unit_price,
        line_total,
        input.sort_order ?? 0,
      ]
    );
    await recalculateTotals(client, invoiceId, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getInvoiceById(userId, invoiceId);
}

export async function updateInvoiceLineItem(
  userId: string,
  invoiceId: number,
  lineItemId: number,
  updates: UpdateInvoiceLineItemInput
) {
  await ensureInvoiceBelongsToUser(userId, invoiceId);

  const existingRes = await pool.query(
    `SELECT * FROM invoice_line_items WHERE id = $1 AND invoice_id = $2 LIMIT 1`,
    [lineItemId, invoiceId]
  );
  if (existingRes.rowCount === 0) throw new InvoiceLineItemNotFoundError();
  const existing = existingRes.rows[0];

  const nextQty = 'quantity' in updates ? updates.quantity : existing.quantity;
  const nextPrice =
    'unit_price' in updates ? updates.unit_price : existing.unit_price;
  const { quantity, unit_price, line_total } = calculateLineItem({
    quantity: nextQty,
    unit_price: nextPrice,
  });

  const setParts: string[] = [];
  const values: any[] = [lineItemId, invoiceId];

  if ('name' in updates) {
    values.push(updates.name ?? existing.name);
    setParts.push(`name = $${values.length}`);
  }
  if ('description' in updates) {
    values.push(updates.description ?? null);
    setParts.push(`description = $${values.length}`);
  }
  if ('quantity' in updates) {
    values.push(quantity);
    setParts.push(`quantity = $${values.length}`);
  }
  if ('unit_price' in updates) {
    values.push(unit_price);
    setParts.push(`unit_price = $${values.length}`);
  }
  if ('sort_order' in updates) {
    values.push(updates.sort_order ?? 0);
    setParts.push(`sort_order = $${values.length}`);
  }
  values.push(line_total);
  setParts.push(`line_total = $${values.length}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE invoice_line_items SET ${setParts.join(', ')} WHERE id = $1 AND invoice_id = $2`,
      values
    );
    await recalculateTotals(client, invoiceId, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getInvoiceById(userId, invoiceId);
}

export async function deleteInvoiceLineItem(
  userId: string,
  invoiceId: number,
  lineItemId: number
) {
  await ensureInvoiceBelongsToUser(userId, invoiceId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delRes = await client.query(
      `DELETE FROM invoice_line_items WHERE id = $1 AND invoice_id = $2 RETURNING id`,
      [lineItemId, invoiceId]
    );
    if (delRes.rowCount === 0) throw new InvoiceLineItemNotFoundError();
    await recalculateTotals(client, invoiceId, userId);
    await client.query('COMMIT');
    return delRes.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── SHARE TOKEN ───────────────────────────────────────

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class InvalidShareTokenError extends Error {
  constructor(message = 'Invalid or expired link') {
    super(message);
    this.name = 'InvalidShareTokenError';
  }
}

export async function rotateInvoiceShareToken(
  userId: string,
  invoiceId: number
) {
  await ensureInvoiceBelongsToUser(userId, invoiceId);
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    `UPDATE invoices
     SET share_token_hash = $1, share_expires_at = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND user_id = $4`,
    [hash, expires, invoiceId, userId]
  );
  const invoice = await getInvoiceById(userId, invoiceId);
  return { token: raw, share_expires_at: expires, invoice };
}

export async function getInvoiceByShareToken(rawToken: string) {
  const hash = sha256(String(rawToken).trim());
  const result = await pool.query(
    `${INVOICE_SELECT}
     WHERE i.share_token_hash = $1
       AND (i.share_expires_at IS NULL OR i.share_expires_at > CURRENT_TIMESTAMP)
     LIMIT 1`,
    [hash]
  );
  if (result.rowCount === 0) throw new InvalidShareTokenError();
  const id = result.rows[0].id;
  const lineItems = await getInvoiceLineItemsRaw(id);
  return normalizeInvoice(result.rows[0], lineItems);
}

// ─── PDF ───────────────────────────────────────────────

function toPdfPayload(invoice: ReturnType<typeof normalizeInvoice>) {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    notes: invoice.notes,
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    discount_total: invoice.discount_total,
    grand_total: invoice.grand_total,
    due_date: invoice.due_date,
    paid_at: invoice.paid_at,
    job_title: invoice.job.title,
    job_address: invoice.job.address,
    lead_name: invoice.job.lead_name,
    line_items: invoice.line_items.map((li: any) => ({
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      line_total: li.line_total,
    })),
  };
}

export async function renderInvoicePdf(userId: string, invoiceId: number) {
  const invoice = await getInvoiceById(userId, invoiceId);
  return buildInvoicePdfBuffer(toPdfPayload(invoice));
}

export async function renderInvoicePdfByShareToken(rawToken: string) {
  const invoice = await getInvoiceByShareToken(rawToken);
  return buildInvoicePdfBuffer(toPdfPayload(invoice));
}
