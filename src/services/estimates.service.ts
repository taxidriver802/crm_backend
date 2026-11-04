import crypto from 'crypto';
import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { createJobActivity } from './jobActivity.service';
import { buildEstimatePdfBuffer } from '../lib/estimatePdf';
import {
  calculateLineItem,
  normalizeMoney,
  calculateEstimateTotals,
} from './estimateCalculations';
import { evaluateRules } from './automation.service';
import { trackEvent } from './productEvents.service';
import { getEstimateTemplateById } from './estimateTemplates.service';
import {
  applyOwnOrAssignedJob,
  applyTenantScope,
  tenantScope,
} from '../lib/tenant';
import { advanceJobFromEstimate } from './jobs.service';

type ScopeOpts = { includeAll?: boolean; companyId?: string };

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

export class EstimateNotDraftError extends Error {
  constructor(message = 'Templates can only be applied to draft estimates') {
    super(message);
    this.name = 'EstimateNotDraftError';
  }
}

/** Approved scope is the agreement with the client; it does not change in place. */
export class EstimateLockedError extends Error {
  status = 409;
  constructor(
    message = 'This estimate is approved, so its scope is locked. Add a change order for new or different work.'
  ) {
    super(message);
    this.name = 'EstimateLockedError';
  }
}

export class EstimateAlreadyAnsweredError extends Error {
  status = 409;
  constructor(
    message = 'You have already responded to this estimate. Contact us if something changed and we will send a new link.'
  ) {
    super(message);
    this.name = 'EstimateAlreadyAnsweredError';
  }
}

export class EstimateBilledError extends Error {
  status = 409;
  constructor(
    message = 'This estimate has been invoiced. Void its invoices before changing or deleting it.'
  ) {
    super(message);
    this.name = 'EstimateBilledError';
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
    e.share_expires_at,
    e.client_responded_at,
    e.client_response_note,
    e.created_at,
    e.updated_at,
    e.sent_at,
    e.approved_at,
    e.change_order_of,
    e.company_id,
    parent.title AS change_order_of_title,

    j.title AS job_title,
    j.status AS job_status,
    j.address AS job_address,
    j.lead_id AS job_lead_id,

    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM estimates e
  INNER JOIN jobs j ON j.id = e.job_id
  LEFT JOIN leads l ON l.id = j.lead_id
  LEFT JOIN estimates parent ON parent.id = e.change_order_of
`;

function buildLeadName(row: any) {
  const first = String(row.lead_first_name || '').trim();
  const last = String(row.lead_last_name || '').trim();
  const full = `${first} ${last}`.trim();

  if (full) return full;
  if (row.job_lead_id != null) return `Lead #${row.job_lead_id}`;
  return null;
}

function normalizeEstimate(row: any, lineItems: any[] = [], invoices: any[] = []) {
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
    share_expires_at: row.share_expires_at ?? null,
    client_responded_at: row.client_responded_at ?? null,
    client_response_note: row.client_response_note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sent_at: row.sent_at ?? null,
    approved_at: row.approved_at ?? null,
    change_order_of: row.change_order_of ?? null,
    change_order_of_title: row.change_order_of_title ?? null,
    locked: row.status === 'Approved',
    company_id: row.company_id ?? null,

    job: {
      id: row.job_id,
      title: row.job_title ?? `Job #${row.job_id}`,
      status: row.job_status ?? null,
      address: row.job_address ?? null,
      lead_id: row.job_lead_id ?? null,
      lead_name: buildLeadName(row),
    },

    line_items: lineItems.map(normalizeEstimateLineItem),
    /** Live (non-void) invoices billed from this estimate. */
    invoices: invoices.map((inv: any) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      kind: inv.kind,
      status: inv.status,
      grand_total: Number(inv.grand_total ?? 0),
    })),
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

async function ensureJobBelongsToUser(
  jobId: number,
  userId: string,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [jobId];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });
  const result = await pool.query(
    `SELECT id FROM jobs WHERE ${where.join(' AND ')}`,
    params
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
  return scope;
}

async function ensureEstimateBelongsToUser(
  userId: string,
  estimateId: number,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [estimateId];
  const where: string[] = ['e.id = $1'];
  applyOwnOrAssignedJob(where, params, scope, { alias: 'e' });
  const result = await pool.query(
    `
      SELECT e.id
      FROM estimates e
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }
  return scope;
}

async function assertScopeEditable(estimateId: number) {
  const res = await pool.query(`SELECT status FROM estimates WHERE id = $1`, [
    estimateId,
  ]);
  if (res.rows[0]?.status === 'Approved') {
    throw new EstimateLockedError();
  }
}

async function liveInvoiceCount(estimateId: number) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM invoices WHERE estimate_id = $1 AND status <> 'Void'`,
    [estimateId]
  );
  return Number(res.rows[0]?.count) || 0;
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
  userId: string,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
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
      WHERE id = $1 AND company_id = $2
      LIMIT 1
    `,
    [estimateId, scope.companyId]
  );

  if (estimateRes.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const taxTotal = normalizeMoney(estimateRes.rows[0].tax_total ?? 0);
  const discountTotal = normalizeMoney(estimateRes.rows[0].discount_total ?? 0);

  const totals = calculateEstimateTotals({
    subtotal,
    tax_total: taxTotal,
    discount_total: discountTotal,
  });

  await client.query(
    `
      UPDATE estimates
      SET
        subtotal = $3,
        grand_total = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND company_id = $2
    `,
    [estimateId, scope.companyId, totals.subtotal, totals.grand_total]
  );
}

export async function getEstimatesByJobId(
  userId: string,
  jobId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureJobBelongsToUser(jobId, userId, options);

  const params: any[] = [jobId];
  const where: string[] = ['e.job_id = $1'];
  applyTenantScope(where, params, scope, { alias: 'e', companyOnly: true });
  const result = await pool.query(
    `
      ${ESTIMATE_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC
    `,
    params
  );

  return result.rows.map((row: any) => normalizeEstimate(row, []));
}

export async function getEstimateById(
  userId: string,
  id: number,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['e.id = $1'];
  applyOwnOrAssignedJob(where, params, scope, { alias: 'e' });
  const result = await pool.query(
    `
      ${ESTIMATE_SELECT}
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const [lineItems, invoices] = await Promise.all([
    getEstimateLineItemsRaw(id),
    pool.query(
      `SELECT id, invoice_number, kind, status, grand_total FROM invoices
       WHERE estimate_id = $1 AND status <> 'Void'
       ORDER BY created_at ASC, id ASC`,
      [id]
    ),
  ]);
  return normalizeEstimate(result.rows[0], lineItems, invoices.rows);
}

export async function createEstimate(
  userId: string,
  input: CreateEstimateInput,
  options: ScopeOpts = {}
) {
  await ensureJobBelongsToUser(input.job_id, userId, options);

  const result = await pool.query(
    `
      INSERT INTO estimates (
        user_id,
        job_id,
        title,
        status,
        notes,
        sent_at,
        company_id
      )
      SELECT $1, $2, $3, $4, $5,
        CASE WHEN $4 = 'Sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
        u.company_id
      FROM users u
      WHERE u.id = $1
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

  const estimate = await getEstimateById(userId, result.rows[0].id, options);

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

  await createNotification({
    userId,
    type: 'ESTIMATE_CREATED',
    title: 'New estimate',
    message: `${estimate.title} was created for ${estimate.job?.title ?? `Job #${estimate.job_id}`}.`,
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      jobId: estimate.job_id,
      estimateTitle: estimate.title,
    },
  });

  return estimate;
}

export async function updateEstimate(
  userId: string,
  id: number,
  updates: UpdateEstimateInput,
  options: ScopeOpts = {}
) {
  const existing = await getEstimateById(userId, id, options);

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

  const leavingApproved =
    existing.status === 'Approved' &&
    'status' in updates &&
    updates.status !== 'Approved';
  if (leavingApproved && (await liveInvoiceCount(id)) > 0) {
    throw new EstimateBilledError();
  }

  const setParts: string[] = [];
  const scope = await tenantScope(userId, options);
  const values: any[] = [id];

  for (const key of keys) {
    values.push((updates as any)[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push('updated_at = CURRENT_TIMESTAMP');
  if (updates.status === 'Sent' && !existing.sent_at) {
    setParts.push('sent_at = CURRENT_TIMESTAMP');
  }
  if (updates.status === 'Approved' && existing.status !== 'Approved') {
    setParts.push('approved_at = CURRENT_TIMESTAMP');
  } else if (leavingApproved) {
    setParts.push('approved_at = NULL');
  }
  const where: string[] = ['id = $1'];
  applyTenantScope(where, values, scope, { companyOnly: true });

  const result = await pool.query(
    `
      UPDATE estimates
      SET ${setParts.join(', ')}
      WHERE ${where.join(' AND ')}
      RETURNING id
    `,
    values
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  const updated = await getEstimateById(userId, id, options);

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

  if (statusChanged) {
    await createNotification({
      userId,
      type: 'ESTIMATE_STATUS_CHANGED',
      title: 'Estimate status updated',
      message: `${updated.title}: ${existing.status} → ${updated.status}`,
      entityType: 'estimate',
      entityId: updated.id,
      metadata: {
        jobId: updated.job_id,
        previousStatus: existing.status,
        newStatus: updated.status,
      },
    });

    if (updated.status === 'Sent') {
      await advanceJobFromEstimate({
        jobId: updated.job_id,
        companyId: scope.companyId,
        actorUserId: userId,
        to: 'Proposal Sent',
        reason: `${updated.title} sent`,
      });
    }

    if (updated.status === 'Approved') {
      await advanceJobFromEstimate({
        jobId: updated.job_id,
        companyId: scope.companyId,
        actorUserId: userId,
        to: 'Sold',
        reason: `${updated.title} approved`,
      });
      trackEvent('estimate_approved', {
        userId,
        entityType: 'estimate',
        entityId: updated.id,
      });
      evaluateRules(userId, 'ESTIMATE_APPROVED', {
        job_id: updated.job_id,
        estimate_id: updated.id,
        estimate_title: updated.title,
        entity_type: 'estimate',
        entity_id: updated.id,
      }).catch((err) => console.error('Automation evaluation failed:', err));
    }
  }

  return updated;
}

export async function deleteEstimate(
  userId: string,
  id: number,
  options: ScopeOpts = {}
) {
  const existing = await getEstimateById(userId, id, options);
  if ((await liveInvoiceCount(id)) > 0) {
    throw new EstimateBilledError();
  }
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope, { companyOnly: true });

  const result = await pool.query(
    `
      DELETE FROM estimates
      WHERE ${where.join(' AND ')}
      RETURNING id
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new EstimateNotFoundError();
  }

  await createJobActivity({
    userId,
    jobId: existing.job_id,
    type: 'ESTIMATE_DELETED',
    title: 'Estimate deleted',
    message: `${existing.title} was deleted`,
    entityType: 'estimate',
    entityId: existing.id,
    metadata: {
      estimateId: existing.id,
      estimateTitle: existing.title,
    },
  });

  return result.rows[0].id;
}

export async function addEstimateLineItem(
  userId: string,
  estimateId: number,
  input: CreateEstimateLineItemInput,
  options: ScopeOpts = {}
) {
  await ensureEstimateBelongsToUser(userId, estimateId, options);
  await assertScopeEditable(estimateId);

  const { quantity, unit_price, line_total } = calculateLineItem({
    quantity: input.quantity,
    unit_price: input.unit_price,
  });

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
          source,
          company_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, e.company_id
        FROM estimates e
        WHERE e.id = $1
      `,
      [
        estimateId,
        input.name,
        input.description ?? null,
        quantity,
        unit_price,
        line_total,
        input.sort_order ?? 0,
        input.source ?? 'manual',
      ]
    );

    await recalculateEstimateTotals(client, estimateId, userId, options);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getEstimateById(userId, estimateId, options);
}

export async function applyTemplateToEstimate(
  userId: string,
  estimateId: number,
  templateId: number,
  options: ScopeOpts = {}
) {
  const existing = await getEstimateById(userId, estimateId, options);
  if (existing.status !== 'Draft') {
    throw new EstimateNotDraftError();
  }

  const scope = await tenantScope(userId, options);
  const template = await getEstimateTemplateById(templateId, scope.companyId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxSortRes = await client.query(
      `
      SELECT COALESCE(MAX(sort_order), -1)::int AS max_sort
      FROM estimate_line_items
      WHERE estimate_id = $1
      `,
      [estimateId]
    );
    let nextSort = Number(maxSortRes.rows[0]?.max_sort ?? -1) + 1;

    for (const line of template.line_items) {
      const { quantity, unit_price, line_total } = calculateLineItem({
        quantity: line.quantity,
        unit_price: line.unit_price,
      });
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
          source,
          company_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, 'manual', e.company_id
        FROM estimates e
        WHERE e.id = $1
        `,
        [
          estimateId,
          line.name,
          line.description ?? null,
          quantity,
          unit_price,
          line_total,
          nextSort,
        ]
      );
      nextSort += 1;
    }

    await recalculateEstimateTotals(client, estimateId, userId, options);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const updated = await getEstimateById(userId, estimateId, options);

  await createJobActivity({
    userId,
    jobId: existing.job_id,
    type: 'ESTIMATE_UPDATED',
    title: 'Estimate updated',
    message: `${existing.title} was updated`,
    entityType: 'estimate',
    entityId: estimateId,
    metadata: {
      estimateId,
      templateId,
      templateName: template.name,
    },
  });

  return updated;
}

export async function updateEstimateLineItem(
  userId: string,
  estimateId: number,
  lineItemId: number,
  updates: UpdateEstimateLineItemInput,
  options: ScopeOpts = {}
) {
  await ensureEstimateBelongsToUser(userId, estimateId, options);
  await assertScopeEditable(estimateId);

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
    'quantity' in updates ? updates.quantity : existing.quantity;

  const nextUnitPrice =
    'unit_price' in updates ? updates.unit_price : existing.unit_price;

  const { quantity, unit_price, line_total } = calculateLineItem({
    quantity: nextQuantity,
    unit_price: nextUnitPrice,
  });

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

  if ('source' in updates) {
    values.push(updates.source ?? 'manual');
    setParts.push(`source = $${values.length}`);
  }

  values.push(line_total);
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

    await recalculateEstimateTotals(client, estimateId, userId, options);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getEstimateById(userId, estimateId, options);
}

export async function deleteEstimateLineItem(
  userId: string,
  estimateId: number,
  lineItemId: number,
  options: ScopeOpts = {}
) {
  await ensureEstimateBelongsToUser(userId, estimateId, options);
  await assertScopeEditable(estimateId);

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

    await recalculateEstimateTotals(client, estimateId, userId, options);

    await client.query('COMMIT');

    return deleteRes.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A change order is a new draft estimate on the same job that points at the
 * approved estimate it changes. When the client approves it, its total joins
 * the job's contract value; the original stays as approved.
 */
export async function createChangeOrder(
  userId: string,
  estimateId: number,
  input: { title?: string | null; notes?: string | null } = {},
  options: ScopeOpts = {}
) {
  const parent = await getEstimateById(userId, estimateId, options);
  if (parent.status !== 'Approved') {
    throw new EstimateBilledError(
      'Change orders are for approved estimates. Edit this estimate directly.'
    );
  }
  const scope = await tenantScope(userId, options);
  const title = input.title?.trim() || `Change order: ${parent.title}`;
  const result = await pool.query(
    `
    INSERT INTO estimates (user_id, job_id, title, status, notes, change_order_of, company_id)
    VALUES ($1, $2, $3, 'Draft', $4, $5, $6)
    RETURNING id
    `,
    [userId, parent.job_id, title, input.notes ?? null, parent.id, scope.companyId]
  );
  const estimate = await getEstimateById(userId, result.rows[0].id, options);

  await createJobActivity({
    userId,
    jobId: estimate.job_id,
    type: 'ESTIMATE_CREATED',
    title: 'Change order started',
    message: `${estimate.title} (changes ${parent.title})`,
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      estimateId: estimate.id,
      estimateTitle: estimate.title,
      changeOrderOf: parent.id,
    },
  });

  return estimate;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class InvalidShareTokenError extends Error {
  constructor(message = 'Invalid or expired link') {
    super(message);
    this.name = 'InvalidShareTokenError';
  }
}

export async function rotateEstimateShareToken(
  userId: string,
  estimateId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureEstimateBelongsToUser(userId, estimateId, options);
  const before = await getEstimateById(userId, estimateId, options);
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  // Sharing a draft that the client has not answered yet is sending it.
  const sending = before.status === 'Draft' && !before.client_responded_at;
  await pool.query(
    `
    UPDATE estimates
    SET share_token_hash = $1,
        share_expires_at = $2,
        status = CASE WHEN $5 THEN 'Sent' ELSE status END,
        sent_at = CASE WHEN $5 THEN COALESCE(sent_at, CURRENT_TIMESTAMP) ELSE sent_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND company_id = $4
    `,
    [hash, expires, estimateId, scope.companyId, sending]
  );
  const estimate = await getEstimateById(userId, estimateId, options);
  if (sending) {
    await createJobActivity({
      userId,
      jobId: estimate.job_id,
      type: 'ESTIMATE_STATUS_CHANGED',
      title: 'Estimate sent',
      message: `${estimate.title} changed from Draft → Sent`,
      entityType: 'estimate',
      entityId: estimate.id,
      metadata: {
        estimateId: estimate.id,
        previousStatus: 'Draft',
        newStatus: 'Sent',
        via: 'share_link',
      },
    });
    await advanceJobFromEstimate({
      jobId: estimate.job_id,
      companyId: scope.companyId,
      actorUserId: userId,
      to: 'Proposal Sent',
      reason: `${estimate.title} shared with the client`,
    });
  }
  return { token: raw, share_expires_at: expires, estimate };
}

export class EstimateResendNotApplicableError extends Error {
  constructor(message = 'Resend is not available for this estimate') {
    super(message);
    this.name = 'EstimateResendNotApplicableError';
  }
}

/**
 * After client declines or asks for revision: clear their response, set status to Sent,
 * rotate share token so the next link is a fresh round for the client.
 */
export async function resendEstimateToClient(
  userId: string,
  estimateId: number,
  options: ScopeOpts = {}
) {
  const existing = await getEstimateById(userId, estimateId, options);

  if (!existing.client_responded_at) {
    throw new EstimateResendNotApplicableError(
      'There is no client response to clear. Use Copy share link to send a link.'
    );
  }

  if (existing.status !== 'Draft' && existing.status !== 'Rejected') {
    throw new EstimateResendNotApplicableError(
      'Resend after response is only for estimates that are in Draft (revision requested) or Rejected. Use Copy share link otherwise.'
    );
  }

  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const scope = await tenantScope(userId, options);
  await pool.query(
    `
    UPDATE estimates
    SET
      share_token_hash = $1,
      share_expires_at = $2,
      client_responded_at = NULL,
      client_response_note = NULL,
      status = 'Sent',
      sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND company_id = $4
    `,
    [hash, expires, estimateId, scope.companyId]
  );

  const estimate = await getEstimateById(userId, estimateId, options);

  await createJobActivity({
    userId,
    jobId: estimate.job_id,
    type: 'ESTIMATE_RESENT_TO_CLIENT',
    title: 'Estimate resent to client',
    message: `${estimate.title}: share link refreshed after client response was cleared`,
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      estimateId: estimate.id,
      estimateTitle: estimate.title,
    },
  });

  return { token: raw, share_expires_at: expires, estimate };
}

export async function getEstimateByShareToken(rawToken: string) {
  const hash = sha256(String(rawToken).trim());
  const result = await pool.query(
    `
    ${ESTIMATE_SELECT}
    WHERE e.share_token_hash = $1
      AND (e.share_expires_at IS NULL OR e.share_expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
    `,
    [hash]
  );
  if (result.rowCount === 0) {
    throw new InvalidShareTokenError();
  }
  const id = result.rows[0].id;
  const lineItems = await getEstimateLineItemsRaw(id);
  return normalizeEstimate(result.rows[0], lineItems);
}

export async function respondToEstimateShare(
  rawToken: string,
  decision: 'approve' | 'reject' | 'revision',
  note: string | null
) {
  const before = await getEstimateByShareToken(rawToken);
  const hash = sha256(String(rawToken).trim());
  if (before.client_responded_at || before.status === 'Approved') {
    throw new EstimateAlreadyAnsweredError();
  }

  let status: 'Approved' | 'Rejected' | 'Draft';
  if (decision === 'approve') status = 'Approved';
  else if (decision === 'reject') status = 'Rejected';
  else status = 'Draft';

  const updateRes = await pool.query(
    `
    UPDATE estimates
    SET
      status = $2,
      client_responded_at = CURRENT_TIMESTAMP,
      client_response_note = $3,
      approved_at = CASE WHEN $2 = 'Approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE share_token_hash = $1 AND client_responded_at IS NULL
    `,
    [hash, status, note?.trim() || null]
  );

  if (updateRes.rowCount === 0) {
    throw new InvalidShareTokenError();
  }

  const trimmedNote = note?.trim() || null;
  const decisionLabel =
    decision === 'approve'
      ? 'approved the estimate'
      : decision === 'reject'
        ? 'declined the estimate'
        : 'requested a revision';

  await createJobActivity({
    userId: before.user_id,
    jobId: before.job_id,
    type: 'ESTIMATE_CLIENT_RESPONDED',
    title: 'Client responded',
    message: `${before.title}: Client ${decisionLabel}.`,
    entityType: 'estimate',
    entityId: before.id,
    metadata: {
      estimateId: before.id,
      estimateTitle: before.title,
      decision,
      note: trimmedNote,
      previousStatus: before.status,
      newStatus: status,
    },
  });

  await createNotification({
    userId: before.user_id,
    type: 'ESTIMATE_CLIENT_RESPONDED',
    title: 'Client responded',
    message: `${before.title}: Client ${decisionLabel}.`,
    entityType: 'estimate',
    entityId: before.id,
    metadata: {
      jobId: before.job_id,
      decision,
      previousStatus: before.status,
      newStatus: status,
    },
  });

  if (status === 'Approved' && before.company_id) {
    await advanceJobFromEstimate({
      jobId: before.job_id,
      companyId: before.company_id,
      actorUserId: before.user_id,
      to: 'Sold',
      reason: `client approved ${before.title}`,
    });
    trackEvent('estimate_approved', {
      userId: before.user_id,
      entityType: 'estimate',
      entityId: before.id,
      metadata: { by: 'client' },
    });
    evaluateRules(before.user_id, 'ESTIMATE_APPROVED', {
      job_id: before.job_id,
      estimate_id: before.id,
      estimate_title: before.title,
      entity_type: 'estimate',
      entity_id: before.id,
    }).catch((err) => console.error('Automation evaluation failed:', err));
  }

  return getEstimateByShareToken(rawToken);
}

function toPdfPayload(estimate: ReturnType<typeof normalizeEstimate>) {
  return {
    title: estimate.title,
    status: estimate.status,
    notes: estimate.notes,
    subtotal: estimate.subtotal,
    tax_total: estimate.tax_total,
    discount_total: estimate.discount_total,
    grand_total: estimate.grand_total,
    job_title: estimate.job.title,
    job_address: estimate.job.address,
    lead_name: estimate.job.lead_name,
    line_items: estimate.line_items.map((li: any) => ({
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      line_total: li.line_total,
    })),
  };
}

export async function renderEstimatePdfForUser(
  userId: string,
  estimateId: number,
  options: ScopeOpts = {}
) {
  const estimate = await getEstimateById(userId, estimateId, options);
  return buildEstimatePdfBuffer(toPdfPayload(estimate));
}

export async function renderEstimatePdfByShareToken(rawToken: string) {
  const estimate = await getEstimateByShareToken(rawToken);
  return buildEstimatePdfBuffer(toPdfPayload(estimate));
}
