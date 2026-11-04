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
import { reconcileJobAfterPayment } from './jobs.service';
import {
  applyOwnOrAssignedJob,
  applyTenantScope,
  tenantScope,
  type TenantScope,
} from '../lib/tenant';

type ScopeOpts = { includeAll?: boolean; companyId?: string };

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

/** The invoice is in a state where the requested change would break the ledger. */
export class InvoiceStateError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceStateError';
  }
}

export class InvoiceInputError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceInputError';
  }
}

export class PaymentNotFoundError extends Error {
  status = 404;
  constructor(message = 'Payment not found') {
    super(message);
    this.name = 'PaymentNotFoundError';
  }
}

export const INVOICE_STATUSES = [
  'Draft',
  'Sent',
  'Partially Paid',
  'Paid',
  'Overdue',
  'Void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses a person may set. The rest follow from payments and due date. */
export const MANUAL_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'Draft',
  'Sent',
  'Paid',
  'Void',
];

export const INVOICE_KINDS = ['standard', 'deposit', 'final'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const PAYMENT_METHODS = [
  'check',
  'card',
  'cash',
  'ach',
  'financing',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return (
    typeof value === 'string' &&
    (INVOICE_STATUSES as readonly string[]).includes(value)
  );
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === 'string' &&
    (PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

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
  payment_method: PaymentMethod;
}>;

export type CreateInvoiceLineItemInput = {
  name: string;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  sort_order?: number | null;
};

export type UpdateInvoiceLineItemInput = Partial<CreateInvoiceLineItemInput>;

export type RecordPaymentInput = {
  amount: number | string;
  method?: PaymentMethod | null;
  reference?: string | null;
  notes?: string | null;
  received_at?: string | null;
};

export type FromEstimateOptions = ScopeOpts & {
  due_date?: string | null;
  kind?: 'deposit' | 'final' | null;
  deposit_percent?: number | null;
  deposit_amount?: number | null;
};

const INVOICE_SELECT = `
  SELECT
    i.id,
    i.user_id,
    i.job_id,
    i.estimate_id,
    i.invoice_number,
    i.status,
    i.kind,
    i.subtotal,
    i.tax_total,
    i.discount_total,
    i.prior_billed_total,
    i.grand_total,
    i.amount_paid,
    i.due_date,
    i.paid_at,
    i.sent_at,
    i.voided_at,
    i.notes,
    i.share_token_hash,
    i.share_expires_at,
    i.created_at,
    i.updated_at,
    i.company_id,

    e.title AS estimate_title,

    j.title AS job_title,
    j.status AS job_status,
    j.address AS job_address,
    j.lead_id AS job_lead_id,
    j.assigned_to AS job_assigned_to,
    j.user_id AS job_user_id,

    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name,
    l.email AS lead_email
  FROM invoices i
  INNER JOIN jobs j ON j.id = i.job_id
  LEFT JOIN leads l ON l.id = j.lead_id
  LEFT JOIN estimates e ON e.id = i.estimate_id
`;

function buildLeadName(row: any) {
  const first = String(row.lead_first_name || '').trim();
  const last = String(row.lead_last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (row.job_lead_id != null) return `Lead #${row.job_lead_id}`;
  return null;
}

function balanceOf(row: { grand_total?: unknown; amount_paid?: unknown; status?: unknown }) {
  if (row.status === 'Void') return 0;
  return Math.max(
    0,
    normalizeMoney(Number(row.grand_total ?? 0) - Number(row.amount_paid ?? 0))
  );
}

function normalizePayment(row: any) {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    job_id: row.job_id,
    amount: Number(row.amount ?? 0),
    method: row.method,
    reference: row.reference ?? null,
    notes: row.notes ?? null,
    received_at: row.received_at,
    created_at: row.created_at,
    recorded_by:
      row.recorded_by_user_id != null
        ? {
            id: row.recorded_by_user_id,
            name:
              `${row.recorder_first_name || ''} ${row.recorder_last_name || ''}`.trim() ||
              null,
          }
        : null,
  };
}

function normalizeInvoice(row: any, lineItems: any[] = [], payments: any[] = []) {
  return {
    id: row.id,
    user_id: row.user_id,
    company_id: row.company_id as string,
    job_id: row.job_id,
    estimate_id: row.estimate_id,
    estimate_title: row.estimate_title ?? null,
    invoice_number: row.invoice_number,
    status: row.status as InvoiceStatus,
    kind: (row.kind ?? 'standard') as InvoiceKind,
    subtotal: Number(row.subtotal ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    discount_total: Number(row.discount_total ?? 0),
    prior_billed_total: Number(row.prior_billed_total ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    amount_paid: Number(row.amount_paid ?? 0),
    balance_due: balanceOf(row),
    due_date: row.due_date,
    paid_at: row.paid_at,
    sent_at: row.sent_at ?? null,
    voided_at: row.voided_at ?? null,
    notes: row.notes,
    share_expires_at: row.share_expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    locked: row.status === 'Void' || Number(row.amount_paid ?? 0) > 0,
    job: {
      id: row.job_id,
      title: row.job_title ?? `Job #${row.job_id}`,
      status: row.job_status ?? null,
      address: row.job_address ?? null,
      lead_id: row.job_lead_id ?? null,
      lead_name: buildLeadName(row),
    },
    line_items: lineItems.map(normalizeLineItem),
    payments: payments.map(normalizePayment),
  };
}

export type NormalizedInvoice = ReturnType<typeof normalizeInvoice>;

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
  if (result.rowCount === 0) throw new JobNotFoundError();
  return scope;
}

async function ensureInvoiceBelongsToUser(
  userId: string,
  invoiceId: number,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [invoiceId];
  const where: string[] = ['id = $1'];
  applyOwnOrAssignedJob(where, params, scope);
  const result = await pool.query(
    `SELECT id FROM invoices WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();
  return scope;
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

async function getInvoicePaymentsRaw(invoiceId: number) {
  const result = await pool.query(
    `SELECT p.*, u.first_name AS recorder_first_name, u.last_name AS recorder_last_name
     FROM invoice_payments p
     LEFT JOIN users u ON u.id = p.recorded_by_user_id
     WHERE p.invoice_id = $1
     ORDER BY p.received_at ASC, p.id ASC`,
    [invoiceId]
  );
  return result.rows;
}

async function nextInvoiceNumber(): Promise<string> {
  const seq = await pool.query(`SELECT nextval('invoice_number_seq') AS val`);
  const num = Number(seq.rows[0].val);
  return `INV-${String(num).padStart(4, '0')}`;
}

/** subtotal + tax − discount − previous billing, never below zero. */
async function recalculateTotals(
  client: any,
  invoiceId: number,
  scope: TenantScope
) {
  const totalsRes = await client.query(
    `SELECT COALESCE(SUM(line_total), 0)::numeric AS subtotal
     FROM invoice_line_items WHERE invoice_id = $1`,
    [invoiceId]
  );
  const subtotal = normalizeMoney(totalsRes.rows[0]?.subtotal ?? 0);

  const invoiceRes = await client.query(
    `SELECT tax_total, discount_total, prior_billed_total FROM invoices
     WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [invoiceId, scope.companyId]
  );
  if (invoiceRes.rowCount === 0) throw new InvoiceNotFoundError();

  const taxTotal = normalizeMoney(invoiceRes.rows[0].tax_total ?? 0);
  const discountTotal = normalizeMoney(invoiceRes.rows[0].discount_total ?? 0);
  const priorBilled = normalizeMoney(invoiceRes.rows[0].prior_billed_total ?? 0);

  const totals = calculateEstimateTotals({
    subtotal,
    tax_total: taxTotal,
    discount_total: discountTotal,
  });
  const grand = Math.max(0, normalizeMoney(totals.grand_total - priorBilled));

  await client.query(
    `UPDATE invoices
     SET subtotal = $3, grand_total = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2`,
    [invoiceId, scope.companyId, totals.subtotal, grand]
  );
}

/**
 * Recomputes amount_paid from the ledger and derives status:
 * Draft and Void stay put; otherwise Paid when the balance is zero, Overdue
 * when past due with a balance, Partially Paid when something has come in,
 * Sent otherwise. Runs inside the caller's transaction.
 */
async function syncPaymentState(client: any, invoiceId: number, companyId: string) {
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS paid, MAX(received_at) AS last_received
     FROM invoice_payments WHERE invoice_id = $1`,
    [invoiceId]
  );
  const paid = normalizeMoney(sumRes.rows[0]?.paid ?? 0);
  const lastReceived = sumRes.rows[0]?.last_received ?? null;

  const invRes = await client.query(
    `SELECT status, grand_total, due_date, sent_at FROM invoices
     WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [invoiceId, companyId]
  );
  if (invRes.rowCount === 0) throw new InvoiceNotFoundError();
  const inv = invRes.rows[0];
  const grand = normalizeMoney(inv.grand_total ?? 0);

  let status: InvoiceStatus = inv.status;
  let sentAt = inv.sent_at;
  if (status !== 'Void') {
    if (status === 'Draft' && paid > 0) {
      // Money arrived, so the bill was presented.
      status = 'Sent';
    }
    if (status !== 'Draft') {
      sentAt = sentAt ?? new Date();
      const pastDue =
        inv.due_date != null && new Date(inv.due_date).getTime() < Date.now();
      if (grand - paid <= 0.004 && (paid > 0 || grand === 0)) status = 'Paid';
      else if (pastDue) status = 'Overdue';
      else if (paid > 0) status = 'Partially Paid';
      else status = 'Sent';
    }
  }

  await client.query(
    `UPDATE invoices
     SET amount_paid = $3,
         status = $4,
         sent_at = $5,
         paid_at = CASE WHEN $4 = 'Paid' THEN COALESCE($6::timestamptz, paid_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId, paid, status, sentAt, lastReceived]
  );

  return { previousStatus: inv.status as InvoiceStatus, status, paid };
}

function assertLineItemsEditable(invoice: NormalizedInvoice) {
  if (invoice.status === 'Void') {
    throw new InvoiceStateError('A void invoice cannot be edited.');
  }
  if (invoice.amount_paid > 0) {
    throw new InvoiceStateError(
      'Payments have been recorded on this invoice, so its lines are locked. Void it and reissue, or remove the payments first.'
    );
  }
}

// ─── LIST ──────────────────────────────────────────────

export type ListInvoicesFilters = ScopeOpts & {
  status?: InvoiceStatus;
  due?: string;
  balance?: 'open';
};

export async function listInvoices(userId: string, filters: ListInvoicesFilters = {}) {
  const scope = await tenantScope(userId, filters);
  const params: any[] = [scope.companyId];
  const where: string[] = ['i.company_id = $1'];
  if (!scope.includeAll) {
    params.push(scope.userId);
    where.push(`i.user_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`i.status = $${params.length}`);
  }
  if (filters.balance === 'open') {
    where.push(`i.status IN ('Sent', 'Partially Paid', 'Overdue')`);
  }
  if (filters.due === 'this_week') {
    where.push(
      `i.due_date IS NOT NULL AND i.due_date >= NOW() AND i.due_date <= NOW() + INTERVAL '7 days'`
    );
  } else if (filters.due === 'overdue') {
    where.push(
      `i.due_date IS NOT NULL AND i.due_date < NOW() AND i.status NOT IN ('Paid', 'Void', 'Draft')`
    );
  }

  const result = await pool.query(
    `${INVOICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC LIMIT 200`,
    params
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    status: row.status,
    kind: row.kind ?? 'standard',
    subtotal: Number(row.subtotal ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    amount_paid: Number(row.amount_paid ?? 0),
    balance_due: balanceOf(row),
    due_date: row.due_date,
    paid_at: row.paid_at,
    sent_at: row.sent_at ?? null,
    job_id: row.job_id,
    job_title: row.job_title,
    job_status: row.job_status,
    lead_name: buildLeadName(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

// ─── CRUD ──────────────────────────────────────────────

export async function getInvoicesByJobId(
  userId: string,
  jobId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureJobBelongsToUser(jobId, userId, options);
  const params: any[] = [jobId];
  const where: string[] = ['i.job_id = $1'];
  applyTenantScope(where, params, scope, { alias: 'i', companyOnly: true });
  const result = await pool.query(
    `${INVOICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC`,
    params
  );
  return result.rows.map((r: any) => normalizeInvoice(r, [], []));
}

export async function getInvoiceById(
  userId: string,
  id: number,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['i.id = $1'];
  applyOwnOrAssignedJob(where, params, scope, { alias: 'i' });
  const result = await pool.query(
    `${INVOICE_SELECT} WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();
  const [lineItems, payments] = await Promise.all([
    getInvoiceLineItemsRaw(id),
    getInvoicePaymentsRaw(id),
  ]);
  return normalizeInvoice(result.rows[0], lineItems, payments);
}

async function getInvoiceForCompany(id: number, companyId: string) {
  const result = await pool.query(
    `${INVOICE_SELECT} WHERE i.id = $1 AND i.company_id = $2 LIMIT 1`,
    [id, companyId]
  );
  if (result.rowCount === 0) throw new InvoiceNotFoundError();
  const [lineItems, payments] = await Promise.all([
    getInvoiceLineItemsRaw(id),
    getInvoicePaymentsRaw(id),
  ]);
  return normalizeInvoice(result.rows[0], lineItems, payments);
}

export async function createInvoice(
  userId: string,
  input: CreateInvoiceInput,
  options: ScopeOpts = {}
) {
  await ensureJobBelongsToUser(input.job_id, userId, options);
  const status = input.status ?? 'Draft';
  if (status !== 'Draft' && status !== 'Sent') {
    throw new InvoiceInputError(
      'A new invoice starts as Draft or Sent. Payments set the rest.'
    );
  }
  const invoiceNumber = await nextInvoiceNumber();

  const result = await pool.query(
    `INSERT INTO invoices (
       user_id, job_id, estimate_id, invoice_number, status, due_date, notes,
       kind, sent_at, company_id
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, 'standard',
       CASE WHEN $5 = 'Sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
       u.company_id
     FROM users u
     WHERE u.id = $1
     RETURNING id`,
    [
      userId,
      input.job_id,
      input.estimate_id ?? null,
      invoiceNumber,
      status,
      input.due_date ?? null,
      input.notes ?? null,
    ]
  );

  const invoice = await getInvoiceById(userId, result.rows[0].id, options);

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
      kind: invoice.kind,
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

/**
 * Bills an approved estimate.
 *
 *   kind 'deposit' — one line for a percentage (or fixed amount) of the
 *                    estimate. At most one live deposit per estimate.
 *   kind 'final'   — the full scope, less any deposit already billed on the
 *                    same estimate. At most one live final per estimate;
 *                    asking again returns the existing one.
 */
export async function createInvoiceFromEstimate(
  userId: string,
  estimateId: number,
  options: FromEstimateOptions = {}
) {
  const scope = await tenantScope(userId, options);
  const kind = options.kind === 'deposit' ? 'deposit' : 'final';

  const estParams: any[] = [estimateId];
  const estWhere = [`e.id = $1`, `e.status = 'Approved'`];
  applyOwnOrAssignedJob(estWhere, estParams, scope, { alias: 'e' });
  const estRes = await pool.query(
    `SELECT e.* FROM estimates e
     INNER JOIN jobs j ON j.id = e.job_id
     WHERE ${estWhere.join(' AND ')}
     LIMIT 1`,
    estParams
  );
  if (estRes.rowCount === 0) throw new EstimateNotFoundError();
  const est = estRes.rows[0];
  const estimateTotal = normalizeMoney(est.grand_total ?? 0);

  const priorRes = await pool.query(
    `SELECT id, kind, grand_total FROM invoices
     WHERE estimate_id = $1 AND company_id = $2 AND status <> 'Void'
     ORDER BY created_at ASC, id ASC`,
    [estimateId, scope.companyId]
  );
  const liveFinal = priorRes.rows.find((row: any) => row.kind !== 'deposit');
  const liveDeposits = priorRes.rows.filter((row: any) => row.kind === 'deposit');
  const depositBilled = normalizeMoney(
    liveDeposits.reduce((sum: number, row: any) => sum + Number(row.grand_total || 0), 0)
  );

  if (kind === 'final' && liveFinal) {
    return getInvoiceById(userId, liveFinal.id, options);
  }
  if (kind === 'deposit') {
    if (liveFinal) {
      throw new InvoiceStateError(
        'This estimate already has a final invoice. Record payments against it instead.'
      );
    }
    if (liveDeposits.length > 0) {
      return getInvoiceById(userId, liveDeposits[0].id, options);
    }
  }

  let depositAmount = 0;
  let depositLabel = '';
  if (kind === 'deposit') {
    if (options.deposit_amount != null && Number.isFinite(Number(options.deposit_amount))) {
      depositAmount = normalizeMoney(options.deposit_amount);
      depositLabel = `Deposit on ${est.title}`;
    } else {
      const percent = Number(options.deposit_percent ?? 30);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new InvoiceInputError('Deposit percent must be between 1 and 100.');
      }
      depositAmount = normalizeMoney((estimateTotal * percent) / 100);
      depositLabel = `${normalizeMoney(percent)}% deposit on ${est.title}`;
    }
    if (depositAmount <= 0) {
      throw new InvoiceInputError('The deposit must be more than $0.');
    }
    if (depositAmount > estimateTotal + 0.004) {
      throw new InvoiceInputError('The deposit cannot be more than the estimate total.');
    }
  }

  const invoiceNumber = await nextInvoiceNumber();

  const client = await pool.connect();
  let invoiceId: number;
  try {
    await client.query('BEGIN');

    if (kind === 'deposit') {
      const invRes = await client.query(
        `INSERT INTO invoices (
           user_id, job_id, estimate_id, invoice_number, status, kind,
           subtotal, tax_total, discount_total, grand_total,
           due_date, notes, company_id
         )
         SELECT $1, $2, $3, $4, 'Draft', 'deposit', $5, 0, 0, $5, $6, $7, u.company_id
         FROM users u
         WHERE u.id = $1
         RETURNING id`,
        [
          userId,
          est.job_id,
          estimateId,
          invoiceNumber,
          depositAmount,
          options.due_date ?? null,
          `Deposit due before work is scheduled. Applied to the final invoice for ${est.title}.`,
        ]
      );
      invoiceId = invRes.rows[0].id;
      await client.query(
        `INSERT INTO invoice_line_items (
           invoice_id, name, description, quantity, unit_price, line_total, sort_order, company_id
         )
         SELECT $1, 'Deposit', $2, 1, $3, $3, 0, i.company_id
         FROM invoices i WHERE i.id = $1`,
        [invoiceId, depositLabel, depositAmount]
      );
    } else {
      const grand = Math.max(0, normalizeMoney(estimateTotal - depositBilled));
      const invRes = await client.query(
        `INSERT INTO invoices (
           user_id, job_id, estimate_id, invoice_number, status, kind,
           subtotal, tax_total, discount_total, prior_billed_total, grand_total,
           due_date, notes, company_id
         )
         SELECT $1, $2, $3, $4, 'Draft', 'final', $5, $6, $7, $8, $9, $10, $11, u.company_id
         FROM users u
         WHERE u.id = $1
         RETURNING id`,
        [
          userId,
          est.job_id,
          estimateId,
          invoiceNumber,
          est.subtotal,
          est.tax_total,
          est.discount_total,
          depositBilled,
          grand,
          options.due_date ?? null,
          est.notes,
        ]
      );
      invoiceId = invRes.rows[0].id;

      const items = await client.query(
        `SELECT * FROM estimate_line_items WHERE estimate_id = $1 ORDER BY sort_order, id`,
        [estimateId]
      );
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO invoice_line_items (
             invoice_id, name, description, quantity, unit_price, line_total, sort_order, company_id
           )
           SELECT $1, $2, $3, $4, $5, $6, $7, i.company_id
           FROM invoices i
           WHERE i.id = $1`,
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
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const invoice = await getInvoiceById(userId, invoiceId, options);
  const label = kind === 'deposit' ? 'Deposit invoice' : 'Final invoice';

  await createJobActivity({
    userId,
    jobId: invoice.job_id,
    type: 'INVOICE_CREATED',
    title: `${label} created`,
    message:
      kind === 'deposit'
        ? `${invoice.invoice_number}: ${depositLabel}`
        : depositBilled > 0
          ? `${invoice.invoice_number} for ${est.title}, less $${depositBilled.toFixed(2)} deposit billed`
          : `${invoice.invoice_number} generated from ${est.title}`,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      estimateId,
      kind,
      priorBilled: depositBilled,
    },
  });

  await createNotification({
    userId,
    type: 'INVOICE_CREATED',
    title: `${label} generated`,
    message: `${invoice.invoice_number} created from approved estimate for ${invoice.job?.title ?? `Job #${invoice.job_id}`}.`,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      jobId: invoice.job_id,
      invoiceNumber: invoice.invoice_number,
      estimateId,
      kind,
    },
  });

  trackEvent('invoice_created', {
    userId,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: { from_estimate: estimateId, kind },
  });

  return invoice;
}

export async function updateInvoice(
  userId: string,
  id: number,
  updates: UpdateInvoiceInput,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, id, options);
  const existing = await getInvoiceById(userId, id, options);

  const hasStatus = 'status' in updates && updates.status !== undefined;
  const hasDue = 'due_date' in updates;
  const hasNotes = 'notes' in updates;
  if (!hasStatus && !hasDue && !hasNotes) throw new Error('No fields to update');

  const target = hasStatus ? (updates.status as InvoiceStatus) : null;
  if (target && target !== existing.status) {
    if (!MANUAL_INVOICE_STATUSES.includes(target)) {
      throw new InvoiceInputError(
        `${target} is set automatically from payments and the due date.`
      );
    }
    if (existing.status === 'Void') {
      throw new InvoiceStateError('A void invoice cannot change status.');
    }
    if ((target === 'Draft' || target === 'Void') && existing.amount_paid > 0) {
      throw new InvoiceStateError(
        `Payments have been recorded on this invoice. Remove them before moving it to ${target}.`
      );
    }
  }

  // "Mark paid" is a payment of the remaining balance, so the ledger and the
  // status never disagree.
  if (target === 'Paid' && existing.status !== 'Paid') {
    if (hasDue || hasNotes) {
      await updateInvoiceFields(id, scope.companyId, updates);
    }
    if (existing.balance_due <= 0.004) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE invoices SET sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP),
             status = CASE WHEN status = 'Draft' THEN 'Sent' ELSE status END
           WHERE id = $1 AND company_id = $2`,
          [id, scope.companyId]
        );
        await syncPaymentState(client, id, scope.companyId);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return getInvoiceById(userId, id, options);
    }
    const { invoice } = await recordPayment(
      userId,
      id,
      {
        amount: existing.balance_due,
        method: updates.payment_method ?? 'other',
        notes: 'Marked paid',
      },
      options
    );
    return invoice;
  }

  const client = await pool.connect();
  let previousStatus = existing.status;
  try {
    await client.query('BEGIN');
    const setParts: string[] = [];
    const values: any[] = [id, scope.companyId];
    if (hasDue) {
      values.push(updates.due_date ?? null);
      setParts.push(`due_date = $${values.length}`);
    }
    if (hasNotes) {
      values.push(updates.notes ?? null);
      setParts.push(`notes = $${values.length}`);
    }
    if (target && target !== existing.status) {
      values.push(target);
      setParts.push(`status = $${values.length}`);
      if (target === 'Sent') setParts.push('sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP)');
      if (target === 'Draft') setParts.push('sent_at = NULL');
      if (target === 'Void') setParts.push('voided_at = CURRENT_TIMESTAMP');
    }
    setParts.push('updated_at = CURRENT_TIMESTAMP');
    const result = await client.query(
      `UPDATE invoices SET ${setParts.join(', ')} WHERE id = $1 AND company_id = $2 RETURNING id`,
      values
    );
    if (result.rowCount === 0) throw new InvoiceNotFoundError();
    await syncPaymentState(client, id, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const updated = await getInvoiceById(userId, id, options);
  const statusChanged = updated.status !== previousStatus;

  await createJobActivity({
    userId,
    jobId: updated.job_id,
    type:
      updated.status === 'Void' && statusChanged
        ? 'INVOICE_VOIDED'
        : statusChanged
          ? 'INVOICE_STATUS_CHANGED'
          : 'INVOICE_UPDATED',
    title:
      updated.status === 'Void' && statusChanged
        ? 'Invoice voided'
        : statusChanged
          ? 'Invoice status updated'
          : 'Invoice updated',
    message: statusChanged
      ? `${updated.invoice_number} changed from ${previousStatus} → ${updated.status}`
      : `${updated.invoice_number} was updated`,
    entityType: 'invoice',
    entityId: updated.id,
    metadata: {
      invoiceId: updated.id,
      invoiceNumber: updated.invoice_number,
      previousStatus,
      newStatus: updated.status,
    },
  });

  if (statusChanged) {
    await createNotification({
      userId,
      type: 'INVOICE_STATUS_CHANGED',
      title: 'Invoice status updated',
      message: `${updated.invoice_number}: ${previousStatus} → ${updated.status}`,
      entityType: 'invoice',
      entityId: updated.id,
      metadata: {
        jobId: updated.job_id,
        previousStatus,
        newStatus: updated.status,
      },
    });
  }

  await reconcileJobAfterPayment({
    jobId: updated.job_id,
    companyId: scope.companyId,
    actorUserId: userId,
  });

  return updated;
}

async function updateInvoiceFields(
  id: number,
  companyId: string,
  updates: UpdateInvoiceInput
) {
  const setParts: string[] = [];
  const values: any[] = [id, companyId];
  if ('due_date' in updates) {
    values.push(updates.due_date ?? null);
    setParts.push(`due_date = $${values.length}`);
  }
  if ('notes' in updates) {
    values.push(updates.notes ?? null);
    setParts.push(`notes = $${values.length}`);
  }
  if (setParts.length === 0) return;
  setParts.push('updated_at = CURRENT_TIMESTAMP');
  await pool.query(
    `UPDATE invoices SET ${setParts.join(', ')} WHERE id = $1 AND company_id = $2`,
    values
  );
}

export async function deleteInvoice(
  userId: string,
  id: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, id, options);
  const existing = await getInvoiceById(userId, id, options);
  if (existing.payments.length > 0) {
    throw new InvoiceStateError(
      'This invoice has payments recorded. Void it instead, or remove the payments first.'
    );
  }
  const result = await pool.query(
    `DELETE FROM invoices WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, scope.companyId]
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

// ─── PAYMENTS ──────────────────────────────────────────

const METHOD_LABEL: Record<PaymentMethod, string> = {
  check: 'check',
  card: 'card',
  cash: 'cash',
  ach: 'bank transfer',
  financing: 'financing',
  other: 'payment',
};

function usd(value: number) {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function notifyJobPeople(input: {
  actorUserId: string;
  invoice: NormalizedInvoice;
  jobAssignedTo: string | null;
  jobUserId: string | null;
  paidInFull: boolean;
  amount: number;
}) {
  const recipients = new Set<string>();
  const owner = input.jobAssignedTo ?? input.jobUserId;
  if (owner && owner !== input.actorUserId) recipients.add(owner);
  if (input.invoice.user_id && input.invoice.user_id !== input.actorUserId) {
    recipients.add(input.invoice.user_id);
  }
  for (const recipient of recipients) {
    await createNotification({
      userId: recipient,
      type: input.paidInFull ? 'INVOICE_PAID' : 'INVOICE_STATUS_CHANGED',
      title: input.paidInFull ? 'Invoice paid in full' : 'Payment received',
      message: `${usd(input.amount)} received on ${input.invoice.invoice_number} for ${input.invoice.job.title}.`,
      entityType: 'invoice',
      entityId: input.invoice.id,
      metadata: {
        jobId: input.invoice.job_id,
        amount: input.amount,
        balanceDue: input.invoice.balance_due,
      },
    });
  }
}

export async function recordPayment(
  userId: string,
  invoiceId: number,
  input: RecordPaymentInput,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  const existing = await getInvoiceById(userId, invoiceId, options);

  const amount = normalizeMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new InvoiceInputError('Payment amount must be more than $0.');
  }
  if (existing.status === 'Void') {
    throw new InvoiceStateError('Payments cannot be recorded on a void invoice.');
  }
  if (amount > existing.balance_due + 0.004) {
    throw new InvoiceStateError(
      `That is more than the ${usd(existing.balance_due)} balance due on ${existing.invoice_number}.`
    );
  }
  const method = input.method && isPaymentMethod(input.method) ? input.method : 'other';
  let receivedAt: Date = new Date();
  if (input.received_at) {
    const parsed = new Date(input.received_at);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvoiceInputError('Received date is not a valid date.');
    }
    receivedAt = parsed;
  }

  const jobRow = await pool.query(
    `SELECT assigned_to, user_id FROM jobs WHERE id = $1 AND company_id = $2`,
    [existing.job_id, scope.companyId]
  );

  const client = await pool.connect();
  let paymentId: number;
  let state: Awaited<ReturnType<typeof syncPaymentState>>;
  try {
    await client.query('BEGIN');
    // Re-check the balance under a row lock: two people recording payments on
    // the same invoice at once must not both pass the check and overpay.
    const locked = await client.query(
      `SELECT status, grand_total, amount_paid FROM invoices
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [invoiceId, scope.companyId]
    );
    if (locked.rowCount === 0) throw new InvoiceNotFoundError();
    const lockedBalance = balanceOf(locked.rows[0]);
    if (locked.rows[0].status === 'Void') {
      throw new InvoiceStateError('Payments cannot be recorded on a void invoice.');
    }
    if (amount > lockedBalance + 0.004) {
      throw new InvoiceStateError(
        `That is more than the ${usd(lockedBalance)} balance due on ${existing.invoice_number}.`
      );
    }
    const ins = await client.query(
      `INSERT INTO invoice_payments (
         company_id, invoice_id, job_id, recorded_by_user_id,
         amount, method, reference, notes, received_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        scope.companyId,
        invoiceId,
        existing.job_id,
        userId,
        amount,
        method,
        input.reference?.trim() || null,
        input.notes?.trim() || null,
        receivedAt,
      ]
    );
    paymentId = ins.rows[0].id;
    state = await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const invoice = await getInvoiceById(userId, invoiceId, options);
  const paidInFull = invoice.status === 'Paid';
  const ref = input.reference?.trim() ? ` #${input.reference.trim()}` : '';

  await createJobActivity({
    userId,
    jobId: invoice.job_id,
    type: 'PAYMENT_RECORDED',
    title: paidInFull ? 'Paid in full' : 'Payment received',
    message: `${usd(amount)} by ${METHOD_LABEL[method]}${ref} on ${invoice.invoice_number} — ${usd(invoice.balance_due)} left`,
    entityType: 'payment',
    entityId: paymentId,
    metadata: {
      paymentId,
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      amount,
      method,
      balanceDue: invoice.balance_due,
      newStatus: invoice.status,
      previousStatus: state.previousStatus,
    },
  });

  if (paidInFull && state.previousStatus !== 'Paid') {
    await createJobActivity({
      userId,
      jobId: invoice.job_id,
      type: 'INVOICE_PAID',
      title: 'Invoice paid',
      message: `${invoice.invoice_number} is paid in full`,
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        newStatus: 'Paid',
        previousStatus: state.previousStatus,
      },
    });
    trackEvent('invoice_marked_paid', {
      userId,
      entityType: 'invoice',
      entityId: invoice.id,
    });
  }
  trackEvent('payment_recorded', {
    userId,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: { amount, method },
  });

  await notifyJobPeople({
    actorUserId: userId,
    invoice,
    jobAssignedTo: jobRow.rows[0]?.assigned_to ?? null,
    jobUserId: jobRow.rows[0]?.user_id ?? null,
    paidInFull,
    amount,
  });

  const job = await reconcileJobAfterPayment({
    jobId: invoice.job_id,
    companyId: scope.companyId,
    actorUserId: userId,
  });

  return {
    invoice,
    payment: invoice.payments.find((p) => p.id === paymentId) ?? null,
    job: { id: job.id, status: job.status, money: job.money },
  };
}

export async function deletePayment(
  userId: string,
  invoiceId: number,
  paymentId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  const existing = await getInvoiceById(userId, invoiceId, options);
  const payment = existing.payments.find((p) => p.id === paymentId);
  if (!payment) throw new PaymentNotFoundError();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM invoice_payments WHERE id = $1 AND invoice_id = $2 AND company_id = $3`,
      [paymentId, invoiceId, scope.companyId]
    );
    await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const invoice = await getInvoiceById(userId, invoiceId, options);

  await createJobActivity({
    userId,
    jobId: invoice.job_id,
    type: 'PAYMENT_REMOVED',
    title: 'Payment removed',
    message: `${usd(payment.amount)} removed from ${invoice.invoice_number} — ${usd(invoice.balance_due)} now due`,
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      paymentId,
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      amount: payment.amount,
      method: payment.method,
      receivedAt: payment.received_at,
      newStatus: invoice.status,
    },
  });

  const job = await reconcileJobAfterPayment({
    jobId: invoice.job_id,
    companyId: scope.companyId,
    actorUserId: userId,
  });

  return { invoice, job: { id: job.id, status: job.status, money: job.money } };
}

// ─── LINE ITEMS ────────────────────────────────────────

export async function addInvoiceLineItem(
  userId: string,
  invoiceId: number,
  input: CreateInvoiceLineItemInput,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  assertLineItemsEditable(await getInvoiceById(userId, invoiceId, options));
  const { quantity, unit_price, line_total } = calculateLineItem({
    quantity: input.quantity,
    unit_price: input.unit_price,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO invoice_line_items (
         invoice_id, name, description, quantity, unit_price, line_total, sort_order, company_id
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, i.company_id
       FROM invoices i
       WHERE i.id = $1`,
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
    await recalculateTotals(client, invoiceId, scope);
    await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getInvoiceById(userId, invoiceId, options);
}

export async function updateInvoiceLineItem(
  userId: string,
  invoiceId: number,
  lineItemId: number,
  updates: UpdateInvoiceLineItemInput,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  assertLineItemsEditable(await getInvoiceById(userId, invoiceId, options));

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

  if ('name' in updates && updates.name !== undefined) {
    values.push(updates.name ?? existing.name);
    setParts.push(`name = $${values.length}`);
  }
  if ('description' in updates && updates.description !== undefined) {
    values.push(updates.description ?? null);
    setParts.push(`description = $${values.length}`);
  }
  if ('quantity' in updates && updates.quantity !== undefined) {
    values.push(quantity);
    setParts.push(`quantity = $${values.length}`);
  }
  if ('unit_price' in updates && updates.unit_price !== undefined) {
    values.push(unit_price);
    setParts.push(`unit_price = $${values.length}`);
  }
  if ('sort_order' in updates && updates.sort_order !== undefined) {
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
    await recalculateTotals(client, invoiceId, scope);
    await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getInvoiceById(userId, invoiceId, options);
}

export async function deleteInvoiceLineItem(
  userId: string,
  invoiceId: number,
  lineItemId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  assertLineItemsEditable(await getInvoiceById(userId, invoiceId, options));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delRes = await client.query(
      `DELETE FROM invoice_line_items WHERE id = $1 AND invoice_id = $2 RETURNING id`,
      [lineItemId, invoiceId]
    );
    if (delRes.rowCount === 0) throw new InvoiceLineItemNotFoundError();
    await recalculateTotals(client, invoiceId, scope);
    await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
    return delRes.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── OVERDUE SWEEP ─────────────────────────────────────

/**
 * Moves open invoices past their due date to Overdue. Used by the reminder
 * job; partially paid invoices go overdue too.
 */
export async function markOverdueInvoices() {
  const result = await pool.query(
    `UPDATE invoices
     SET status = 'Overdue', updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('Sent', 'Partially Paid')
       AND due_date IS NOT NULL
       AND due_date < NOW()
       AND grand_total - amount_paid > 0.004
     RETURNING id, user_id, invoice_number, job_id, grand_total, amount_paid`
  );
  return result.rows;
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
  invoiceId: number,
  options: ScopeOpts = {}
) {
  const scope = await ensureInvoiceBelongsToUser(userId, invoiceId, options);
  const existing = await getInvoiceById(userId, invoiceId, options);
  if (existing.status === 'Void') {
    throw new InvoiceStateError('A void invoice cannot be shared.');
  }
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Sharing a draft sends it.
    await client.query(
      `UPDATE invoices
       SET share_token_hash = $1, share_expires_at = $2, updated_at = CURRENT_TIMESTAMP,
           status = CASE WHEN status = 'Draft' THEN 'Sent' ELSE status END,
           sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP)
       WHERE id = $3 AND company_id = $4`,
      [hash, expires, invoiceId, scope.companyId]
    );
    await syncPaymentState(client, invoiceId, scope.companyId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const invoice = await getInvoiceById(userId, invoiceId, options);
  if (existing.status === 'Draft' && invoice.status !== 'Draft') {
    await createJobActivity({
      userId,
      jobId: invoice.job_id,
      type: 'INVOICE_STATUS_CHANGED',
      title: 'Invoice sent',
      message: `${invoice.invoice_number} changed from Draft → ${invoice.status}`,
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        previousStatus: 'Draft',
        newStatus: invoice.status,
      },
    });
  }
  return { token: raw, share_expires_at: expires, invoice };
}

export async function getInvoiceByShareToken(rawToken: string) {
  const hash = sha256(String(rawToken).trim());
  const result = await pool.query(
    `${INVOICE_SELECT}
     WHERE i.share_token_hash = $1
       AND i.status <> 'Void'
       AND (i.share_expires_at IS NULL OR i.share_expires_at > CURRENT_TIMESTAMP)
     LIMIT 1`,
    [hash]
  );
  if (result.rowCount === 0) throw new InvalidShareTokenError();
  const id = result.rows[0].id;
  const [lineItems, payments] = await Promise.all([
    getInvoiceLineItemsRaw(id),
    getInvoicePaymentsRaw(id),
  ]);
  return normalizeInvoice(result.rows[0], lineItems, payments);
}

/** What a client may see: no internal notes on payments, no recorder names. */
export function toPublicInvoice(invoice: NormalizedInvoice) {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    kind: invoice.kind,
    estimate_title: invoice.estimate_title,
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    discount_total: invoice.discount_total,
    prior_billed_total: invoice.prior_billed_total,
    grand_total: invoice.grand_total,
    amount_paid: invoice.amount_paid,
    balance_due: invoice.balance_due,
    due_date: invoice.due_date,
    paid_at: invoice.paid_at,
    sent_at: invoice.sent_at,
    notes: invoice.notes,
    job: {
      title: invoice.job.title,
      address: invoice.job.address,
      lead_name: invoice.job.lead_name,
    },
    line_items: invoice.line_items.map((li) => ({
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      line_total: li.line_total,
    })),
    payments: invoice.payments.map((p) => ({
      amount: p.amount,
      method: p.method,
      received_at: p.received_at,
    })),
  };
}

export async function getInvoiceCompanyId(invoiceId: number) {
  const res = await pool.query(`SELECT company_id FROM invoices WHERE id = $1`, [
    invoiceId,
  ]);
  return (res.rows[0]?.company_id as string | undefined) ?? null;
}

// ─── PDF ───────────────────────────────────────────────

function toPdfPayload(invoice: NormalizedInvoice) {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    kind: invoice.kind,
    notes: invoice.notes,
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    discount_total: invoice.discount_total,
    prior_billed_total: invoice.prior_billed_total,
    grand_total: invoice.grand_total,
    amount_paid: invoice.amount_paid,
    balance_due: invoice.balance_due,
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
    payments: invoice.payments.map((p) => ({
      amount: p.amount,
      method: p.method,
      received_at: p.received_at,
    })),
  };
}

export async function renderInvoicePdf(
  userId: string,
  invoiceId: number,
  options: ScopeOpts = {}
) {
  const invoice = await getInvoiceById(userId, invoiceId, options);
  return buildInvoicePdfBuffer(toPdfPayload(invoice));
}

export async function renderInvoicePdfByShareToken(rawToken: string) {
  const invoice = await getInvoiceByShareToken(rawToken);
  return buildInvoicePdfBuffer(toPdfPayload(invoice));
}

/** Portal-scoped PDF: the invoice must belong to the portal's job and be sent. */
export async function renderInvoicePdfForPortal(
  jobId: number,
  companyId: string,
  invoiceId: number
) {
  const invoice = await getInvoiceForCompany(invoiceId, companyId);
  if (invoice.job_id !== jobId || invoice.status === 'Draft' || invoice.status === 'Void') {
    throw new InvoiceNotFoundError();
  }
  return buildInvoicePdfBuffer(toPdfPayload(invoice));
}
