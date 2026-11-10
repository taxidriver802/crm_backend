import { pool } from '../db';
import { normalizeMoney } from './estimateCalculations';
import { createJobActivity } from './jobActivity.service';
import { createNotification } from '../lib/notifications';
import {
  applyTenantScope,
  tenantScope,
  type TenantScope,
} from '../lib/tenant';

type ScopeOpts = { includeAll?: boolean; companyId?: string };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<any> };

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'ach', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  other: 'Payment',
};

export type InvoiceSettlementStatus =
  | 'Draft'
  | 'Sent'
  | 'Partial'
  | 'Paid'
  | 'Overdue';

export class PaymentError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
  }
}

export type RecordPaymentInput = {
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  received_at?: string | null;
  invoice_id?: number | null;
};

export type PaymentRecord = {
  id: number;
  job_id: number;
  invoice_id: number | null;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  received_at: string;
  created_at: string;
  user_id: string;
};

export function money(value: unknown): number {
  return normalizeMoney(value);
}

function formatMoney(value: number): string {
  const amount = money(value);
  const text = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-$${text}` : `$${text}`;
}

export function mapPaymentRow(row: any): PaymentRecord {
  return {
    id: Number(row.id),
    job_id: Number(row.job_id),
    invoice_id: row.invoice_id == null ? null : Number(row.invoice_id),
    amount: money(row.amount),
    method: row.method,
    reference: row.reference ?? null,
    note: row.note ?? null,
    received_at: row.received_at,
    created_at: row.created_at,
    user_id: row.user_id,
  };
}

export function deriveSettlement(input: {
  status: string;
  grandTotal: number;
  amountPaid: number;
  dueDate: string | Date | null;
  now?: Date;
}): { status: InvoiceSettlementStatus; paidAt: 'set' | 'clear' | 'keep' } {
  const totalCents = Math.round(money(input.grandTotal) * 100);
  const paidCents = Math.round(money(input.amountPaid) * 100);
  const balanceCents = totalCents - paidCents;
  const due = input.dueDate ? new Date(input.dueDate) : null;
  const now = input.now ?? new Date();
  const pastDue =
    due != null && !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();

  const fullyCovered = paidCents > 0 && paidCents >= totalCents;
  const zeroMarked = totalCents === 0 && paidCents === 0 && input.status === 'Paid';

  if (fullyCovered || zeroMarked) {
    return { status: 'Paid', paidAt: 'set' };
  }

  if (input.status === 'Draft') {
    return { status: 'Draft', paidAt: 'keep' };
  }

  if (paidCents > 0 && balanceCents > 0) {
    return { status: pastDue ? 'Overdue' : 'Partial', paidAt: 'clear' };
  }

  if (pastDue && balanceCents > 0) {
    return { status: 'Overdue', paidAt: 'clear' };
  }

  if (
    (input.status === 'Paid' || input.status === 'Partial') &&
    paidCents <= 0
  ) {
    return { status: pastDue ? 'Overdue' : 'Sent', paidAt: 'clear' };
  }

  return {
    status: input.status as InvoiceSettlementStatus,
    paidAt: 'keep',
  };
}

async function ensureJob(jobId: number, userId: string, options: ScopeOpts = {}) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [jobId];
  const where = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });
  const result = await pool.query(
    `SELECT id, contract_estimate_id FROM jobs WHERE ${where.join(' AND ')}`,
    params
  );
  if (result.rowCount === 0) throw new PaymentError('Job not found', 404);
  return { scope, contractEstimateId: result.rows[0].contract_estimate_id as number | null };
}

async function assertOpenContract(scope: TenantScope, jobId: number, contractEstimateId: number | null) {
  if (contractEstimateId == null) {
    throw new PaymentError(
      'Approve an estimate before recording a payment. That approval is the contract.'
    );
  }
  const result = await pool.query(
    `SELECT status FROM estimates WHERE id = $1 AND company_id = $2 AND job_id = $3`,
    [contractEstimateId, scope.companyId, jobId]
  );
  if (result.rowCount === 0 || result.rows[0].status !== 'Approved') {
    throw new PaymentError(
      'Approve an estimate before recording a payment. That approval is the contract.'
    );
  }
}

function parseReceivedAt(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PaymentError('received_at is not a valid date');
  }
  return date;
}

async function sumPaid(invoiceId: number, db: Queryable = pool): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1`,
    [invoiceId]
  );
  return money(result.rows[0]?.paid ?? 0);
}

export async function listPaymentsForInvoice(invoiceId: number) {
  const result = await pool.query(
    `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY received_at ASC, id ASC`,
    [invoiceId]
  );
  return result.rows.map(mapPaymentRow);
}

export async function syncInvoiceSettlement(
  invoiceId: number,
  companyId: string,
  db: Queryable = pool
) {
  const invoiceRes = await db.query(
    `SELECT id, status, grand_total, due_date, paid_at
     FROM invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId]
  );
  if (invoiceRes.rowCount === 0) return;
  const invoice = invoiceRes.rows[0];
  const amountPaid = await sumPaid(invoiceId, db);
  const next = deriveSettlement({
    status: invoice.status,
    grandTotal: money(invoice.grand_total),
    amountPaid,
    dueDate: invoice.due_date,
  });

  const alreadyPaidAt = invoice.paid_at != null;
  if (
    next.status === invoice.status &&
    (next.paidAt === 'keep' ||
      (next.paidAt === 'set' && alreadyPaidAt) ||
      (next.paidAt === 'clear' && !alreadyPaidAt))
  ) {
    return;
  }

  await db.query(
    `UPDATE invoices
     SET status = $3,
         paid_at = CASE
           WHEN $4 = 'set' THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
           WHEN $4 = 'clear' THEN NULL
           ELSE paid_at
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId, next.status, next.paidAt]
  );
}

async function loadInvoice(invoiceId: number, jobId: number, companyId: string) {
  const result = await pool.query(
    `SELECT id, invoice_number, status, grand_total, job_id
     FROM invoices
     WHERE id = $1 AND job_id = $2 AND company_id = $3`,
    [invoiceId, jobId, companyId]
  );
  if (result.rowCount === 0) throw new PaymentError('Invoice not found on this job', 404);
  return result.rows[0];
}

export async function recordPayment(
  userId: string,
  jobId: number,
  input: RecordPaymentInput,
  options: ScopeOpts = {}
) {
  const { scope, contractEstimateId } = await ensureJob(jobId, userId, options);
  await assertOpenContract(scope, jobId, contractEstimateId);

  const amount = money(input.amount);
  if (!(amount > 0)) throw new PaymentError('Amount must be greater than zero.');
  const method: PaymentMethod = input.method ?? 'other';
  if (!PAYMENT_METHODS.includes(method)) throw new PaymentError('Invalid payment method');
  const receivedAt = parseReceivedAt(input.received_at ?? null);
  const invoiceId = input.invoice_id ?? null;
  const reference = input.reference?.trim() || null;
  const note = input.note?.trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let invoiceNumber: string | null = null;
    if (invoiceId != null) {
      const locked = await client.query(
        `SELECT id, invoice_number, status, grand_total
         FROM invoices
         WHERE id = $1 AND job_id = $2 AND company_id = $3
         FOR UPDATE`,
        [invoiceId, jobId, scope.companyId]
      );
      if (locked.rowCount === 0) throw new PaymentError('Invoice not found on this job', 404);
      const invoice = locked.rows[0];
      if (invoice.status === 'Draft') {
        throw new PaymentError(
          'Send the invoice before recording a payment against it. A deposit can be recorded on the job.'
        );
      }
      const paid = await sumPaid(invoiceId, client);
      const balance = money(money(invoice.grand_total) - paid);
      if (balance <= 0) {
        throw new PaymentError(
          'That invoice is already paid. Record extra money as a deposit on the job.'
        );
      }
      invoiceNumber = invoice.invoice_number;
    }

    const inserted = await client.query(
      `INSERT INTO payments (
         company_id, user_id, job_id, invoice_id, amount, method, reference, note, received_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_TIMESTAMP))
       RETURNING *`,
      [
        scope.companyId,
        userId,
        jobId,
        invoiceId,
        amount,
        method,
        reference,
        note,
        receivedAt,
      ]
    );
    if (invoiceId != null) {
      await syncInvoiceSettlement(invoiceId, scope.companyId, client);
    }
    await client.query('COMMIT');

    const payment = mapPaymentRow(inserted.rows[0]);
    const label = METHOD_LABEL[method];
    const where = invoiceNumber ? ` on ${invoiceNumber}` : ' on the job';
    await createJobActivity({
      userId,
      jobId,
      type: 'PAYMENT_RECORDED',
      title: invoiceId ? 'Payment recorded' : 'Deposit recorded',
      message: `${label} payment of ${formatMoney(amount)} recorded${where}.`,
      entityType: invoiceId ? 'invoice' : 'job',
      entityId: invoiceId ?? jobId,
      metadata: {
        paymentId: payment.id,
        amount,
        method,
        invoiceId,
        jobId,
      },
    });
    await createNotification({
      userId,
      type: 'PAYMENT_RECORDED',
      title: invoiceId ? 'Payment recorded' : 'Deposit recorded',
      message: `${label} payment of ${formatMoney(amount)} recorded${where}.`,
      entityType: invoiceId ? 'invoice' : 'job',
      entityId: invoiceId ?? jobId,
      metadata: { jobId, invoiceId, amount, method },
    });
    return payment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function applyPayment(
  userId: string,
  jobId: number,
  paymentId: number,
  invoiceId: number,
  options: ScopeOpts = {}
) {
  const { scope } = await ensureJob(jobId, userId, options);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const paymentRes = await client.query(
      `SELECT * FROM payments
       WHERE id = $1 AND job_id = $2 AND company_id = $3
       FOR UPDATE`,
      [paymentId, jobId, scope.companyId]
    );
    if (paymentRes.rowCount === 0) throw new PaymentError('Payment not found', 404);
    const payment = paymentRes.rows[0];
    if (payment.invoice_id != null) {
      throw new PaymentError('This payment is already applied to an invoice.');
    }

    const invoiceRes = await client.query(
      `SELECT id, invoice_number, status, grand_total
       FROM invoices
       WHERE id = $1 AND job_id = $2 AND company_id = $3
       FOR UPDATE`,
      [invoiceId, jobId, scope.companyId]
    );
    if (invoiceRes.rowCount === 0) throw new PaymentError('Invoice not found on this job', 404);
    const invoice = invoiceRes.rows[0];
    if (invoice.status === 'Draft') {
      throw new PaymentError('Send the invoice before applying a deposit to it.');
    }

    const paid = await sumPaid(invoiceId, client);
    const balance = money(money(invoice.grand_total) - paid);
    if (balance <= 0) throw new PaymentError('That invoice has no balance left.');

    const amount = money(payment.amount);
    if (amount <= balance + 0.001) {
      await client.query(`UPDATE payments SET invoice_id = $2 WHERE id = $1`, [
        paymentId,
        invoiceId,
      ]);
    } else {
      await client.query(
        `UPDATE payments SET amount = $2, invoice_id = $3 WHERE id = $1`,
        [paymentId, balance, invoiceId]
      );
      await client.query(
        `INSERT INTO payments (
           company_id, user_id, job_id, invoice_id, amount, method, reference, note, received_at
         )
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)`,
        [
          payment.company_id,
          payment.user_id,
          jobId,
          money(amount - balance),
          payment.method,
          payment.reference,
          payment.note,
          payment.received_at,
        ]
      );
    }

    await syncInvoiceSettlement(invoiceId, scope.companyId, client);
    await client.query('COMMIT');

    await createJobActivity({
      userId,
      jobId,
      type: 'PAYMENT_RECORDED',
      title: 'Deposit applied',
      message: `${formatMoney(Math.min(amount, balance))} applied to ${invoice.invoice_number}.`,
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { paymentId, invoiceId, jobId, amount: Math.min(amount, balance) },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePayment(
  userId: string,
  jobId: number,
  paymentId: number,
  options: ScopeOpts = {}
) {
  const { scope } = await ensureJob(jobId, userId, options);
  const existing = await pool.query(
    `SELECT * FROM payments WHERE id = $1 AND job_id = $2 AND company_id = $3`,
    [paymentId, jobId, scope.companyId]
  );
  if (existing.rowCount === 0) throw new PaymentError('Payment not found', 404);
  const payment = existing.rows[0];

  await pool.query(`DELETE FROM payments WHERE id = $1 AND company_id = $2`, [
    paymentId,
    scope.companyId,
  ]);
  if (payment.invoice_id != null) {
    await syncInvoiceSettlement(Number(payment.invoice_id), scope.companyId);
  }

  await createJobActivity({
    userId,
    jobId,
    type: 'PAYMENT_RECORDED',
    title: 'Payment removed',
    message: `${formatMoney(money(payment.amount))} payment was removed.`,
    entityType: payment.invoice_id ? 'invoice' : 'job',
    entityId: payment.invoice_id ?? jobId,
    metadata: { paymentId, jobId, invoiceId: payment.invoice_id, amount: money(payment.amount) },
  });
}

/**
 * Applies unapplied job deposits to the invoice, then records whatever
 * balance is still open so Mark paid and the ledger agree.
 */
export async function settleInvoiceAsPaid(
  userId: string,
  invoiceId: number,
  options: ScopeOpts = {}
) {
  const scope = await tenantScope(userId, options);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceRes = await client.query(
      `SELECT id, job_id, invoice_number, status, grand_total, company_id
       FROM invoices
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [invoiceId, scope.companyId]
    );
    if (invoiceRes.rowCount === 0) throw new PaymentError('Invoice not found', 404);
    const invoice = invoiceRes.rows[0];

    const loose = await client.query(
      `SELECT * FROM payments
       WHERE job_id = $1 AND company_id = $2 AND invoice_id IS NULL
       ORDER BY received_at ASC, id ASC
       FOR UPDATE`,
      [invoice.job_id, scope.companyId]
    );

    let paid = await sumPaid(invoiceId, client);
    for (const payment of loose.rows) {
      const balance = money(money(invoice.grand_total) - paid);
      if (balance <= 0) break;
      const amount = money(payment.amount);
      if (amount <= balance + 0.001) {
        await client.query(`UPDATE payments SET invoice_id = $2 WHERE id = $1`, [
          payment.id,
          invoiceId,
        ]);
        paid = money(paid + amount);
      } else {
        await client.query(
          `UPDATE payments SET amount = $2, invoice_id = $3 WHERE id = $1`,
          [payment.id, balance, invoiceId]
        );
        await client.query(
          `INSERT INTO payments (
             company_id, user_id, job_id, invoice_id, amount, method, reference, note, received_at
           )
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)`,
          [
            payment.company_id,
            payment.user_id,
            invoice.job_id,
            money(amount - balance),
            payment.method,
            payment.reference,
            payment.note,
            payment.received_at,
          ]
        );
        paid = money(paid + balance);
      }
    }

    const remainder = money(money(invoice.grand_total) - paid);
    if (remainder > 0) {
      await client.query(
        `INSERT INTO payments (
           company_id, user_id, job_id, invoice_id, amount, method, note, received_at
         )
         VALUES ($1, $2, $3, $4, $5, 'other', 'Marked paid', CURRENT_TIMESTAMP)`,
        [scope.companyId, userId, invoice.job_id, invoiceId, remainder]
      );
    }

    await syncInvoiceSettlement(invoiceId, scope.companyId, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function invoiceAmountPaid(invoiceId: number): Promise<number> {
  return sumPaid(invoiceId);
}
