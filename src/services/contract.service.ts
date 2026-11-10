import { pool } from '../db';
import { createJobActivity } from './jobActivity.service';
import { createNotification } from '../lib/notifications';
import { applyTenantScope, tenantScope } from '../lib/tenant';
import { mapPaymentRow, money, type PaymentRecord } from './payments.service';

type ScopeOpts = { includeAll?: boolean; companyId?: string };

export class ContractError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = 'ContractError';
    this.status = status;
  }
}

export type JobMoney = {
  has_contract: boolean;
  contract: {
    estimate_id: number;
    title: string;
    total: number;
    contracted_at: string | null;
  } | null;
  change_orders: {
    id: number;
    title: string;
    status: string;
    grand_total: number;
  }[];
  contract_total: number;
  collected: number;
  still_owed: number;
  invoiced: number;
  invoice_balance: number;
  unbilled: number;
  payments: PaymentRecord[];
  invoices: {
    id: number;
    invoice_number: string;
    status: string;
    grand_total: number;
    amount_paid: number;
    balance_due: number;
    due_date: string | null;
  }[];
};

async function ensureJob(jobId: number, userId: string, options: ScopeOpts = {}) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [jobId];
  const where = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });
  const result = await pool.query(
    `SELECT id, contract_estimate_id, contracted_at FROM jobs WHERE ${where.join(' AND ')}`,
    params
  );
  if (result.rowCount === 0) throw new ContractError('Job not found', 404);
  return { scope, job: result.rows[0] };
}

export async function assertCanLeaveApproval(companyId: string, estimateId: number) {
  const job = await pool.query(
    `SELECT id FROM jobs WHERE company_id = $1 AND contract_estimate_id = $2`,
    [companyId, estimateId]
  );
  if (job.rowCount === 0) return;

  const children = await pool.query(
    `SELECT id FROM estimates
     WHERE company_id = $1 AND contract_estimate_id = $2 AND status = 'Approved'
     LIMIT 1`,
    [companyId, estimateId]
  );
  if ((children.rowCount ?? 0) > 0) {
    throw new ContractError(
      'The contract cannot be reopened while an approved change order is still on the job.'
    );
  }
}

export async function clearContractPointer(companyId: string, estimateId: number) {
  await pool.query(
    `UPDATE jobs
     SET contract_estimate_id = NULL,
         contracted_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE company_id = $1 AND contract_estimate_id = $2`,
    [companyId, estimateId]
  );
}

export async function prepareContractDelete(companyId: string, estimateId: number) {
  const children = await pool.query(
    `SELECT id FROM estimates
     WHERE company_id = $1 AND contract_estimate_id = $2
     LIMIT 1`,
    [companyId, estimateId]
  );
  if ((children.rowCount ?? 0) > 0) {
    throw new ContractError(
      'Delete the change orders on this contract before deleting it.'
    );
  }
  await clearContractPointer(companyId, estimateId);
}

/** First approved estimate becomes the contract. Later approvals revise it. */
export async function onEstimateApproved(companyId: string, estimateId: number) {
  const estRes = await pool.query(
    `SELECT id, job_id, status FROM estimates WHERE id = $1 AND company_id = $2`,
    [estimateId, companyId]
  );
  if (estRes.rowCount === 0 || estRes.rows[0].status !== 'Approved') return;
  const jobId = estRes.rows[0].job_id as number;

  const jobRes = await pool.query(
    `SELECT contract_estimate_id FROM jobs WHERE id = $1 AND company_id = $2`,
    [jobId, companyId]
  );
  let holderId = (jobRes.rows[0]?.contract_estimate_id ?? null) as number | null;

  if (holderId != null) {
    const holder = await pool.query(
      `SELECT status FROM estimates WHERE id = $1 AND company_id = $2`,
      [holderId, companyId]
    );
    if (holder.rowCount === 0 || holder.rows[0].status !== 'Approved') {
      holderId = null;
    }
  }

  if (holderId == null || holderId === estimateId) {
    await pool.query(
      `UPDATE jobs
       SET contract_estimate_id = $2,
           contracted_at = COALESCE(contracted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND company_id = $3`,
      [jobId, estimateId, companyId]
    );
    await pool.query(
      `UPDATE estimates
       SET kind = 'proposal',
           contract_estimate_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND company_id = $2
         AND (kind IS DISTINCT FROM 'proposal' OR contract_estimate_id IS NOT NULL)`,
      [estimateId, companyId]
    );
    return;
  }

  await pool.query(
    `UPDATE estimates
     SET kind = 'change_order',
         contract_estimate_id = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2`,
    [estimateId, companyId, holderId]
  );
}

export async function createChangeOrder(
  userId: string,
  jobId: number,
  input: { title?: string | null; notes?: string | null },
  options: ScopeOpts = {}
) {
  const { scope } = await ensureJob(jobId, userId, options);
  const title = (input.title || 'Change order').trim();
  if (!title) throw new ContractError('Title is required', 400);

  const inserted = await pool.query(
    `INSERT INTO estimates (
       user_id, job_id, title, status, notes, kind, contract_estimate_id, company_id
     )
     SELECT $1, j.id, $3, 'Draft', $4, 'change_order', j.contract_estimate_id, j.company_id
     FROM jobs j
     INNER JOIN estimates contract ON contract.id = j.contract_estimate_id
     WHERE j.id = $2
       AND j.company_id = $5
       AND contract.status = 'Approved'
     RETURNING id, job_id`,
    [userId, jobId, title, input.notes?.trim() || null, scope.companyId]
  );
  if (inserted.rowCount === 0) {
    throw new ContractError(
      'Approve an estimate before writing a change order. That approval is the contract.'
    );
  }

  const id = Number(inserted.rows[0].id);
  await createJobActivity({
    userId,
    jobId,
    type: 'ESTIMATE_CREATED',
    title: 'Change order created',
    message: `${title} was created`,
    entityType: 'estimate',
    entityId: id,
    metadata: { estimateId: id, estimateTitle: title, kind: 'change_order' },
  });
  await createNotification({
    userId,
    type: 'ESTIMATE_CREATED',
    title: 'Change order created',
    message: `${title} was added to the job contract.`,
    entityType: 'estimate',
    entityId: id,
    metadata: { jobId, estimateTitle: title, kind: 'change_order' },
  });
  return id;
}

export async function getJobMoney(
  userId: string,
  jobId: number,
  options: ScopeOpts = {}
): Promise<JobMoney> {
  const { scope, job } = await ensureJob(jobId, userId, options);

  const estimates = await pool.query(
    `SELECT id, title, status, kind, grand_total, contract_estimate_id
     FROM estimates
     WHERE job_id = $1 AND company_id = $2
     ORDER BY created_at ASC, id ASC`,
    [jobId, scope.companyId]
  );

  const holder = job.contract_estimate_id
    ? estimates.rows.find(
        (row: any) =>
          Number(row.id) === Number(job.contract_estimate_id) && row.status === 'Approved'
      )
    : null;

  const changeOrders = holder
    ? estimates.rows.filter(
        (row: any) =>
          row.kind === 'change_order' &&
          Number(row.contract_estimate_id) === Number(holder.id)
      )
    : [];

  const approvedChanges = changeOrders.filter((row: any) => row.status === 'Approved');
  const contractTotal = holder
    ? money(
        money(holder.grand_total) +
          approvedChanges.reduce((sum: number, row: any) => sum + money(row.grand_total), 0)
      )
    : 0;

  const paymentRes = await pool.query(
    `SELECT * FROM payments
     WHERE job_id = $1 AND company_id = $2
     ORDER BY received_at ASC, id ASC`,
    [jobId, scope.companyId]
  );
  const payments = paymentRes.rows.map(mapPaymentRow);
  const collected = money(payments.reduce((sum, payment) => sum + payment.amount, 0));

  const invoiceRes = await pool.query(
    `SELECT i.id, i.invoice_number, i.status, i.grand_total, i.due_date,
            COALESCE((
              SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id
            ), 0) AS amount_paid
     FROM invoices i
     WHERE i.job_id = $1 AND i.company_id = $2
     ORDER BY i.created_at DESC, i.id DESC`,
    [jobId, scope.companyId]
  );

  let invoiced = 0;
  let invoiceBalance = 0;
  const invoices = invoiceRes.rows.map((row: any) => {
    const total = money(row.grand_total);
    const paid = money(row.amount_paid);
    const balance = money(total - paid);
    if (row.status !== 'Draft') {
      invoiced = money(invoiced + total);
      invoiceBalance = money(invoiceBalance + balance);
    }
    return {
      id: Number(row.id),
      invoice_number: row.invoice_number as string,
      status: row.status as string,
      grand_total: total,
      amount_paid: paid,
      balance_due: balance,
      due_date: row.due_date ?? null,
    };
  });

  return {
    has_contract: Boolean(holder),
    contract: holder
      ? {
          estimate_id: Number(holder.id),
          title: holder.title,
          total: money(holder.grand_total),
          contracted_at: job.contracted_at ?? null,
        }
      : null,
    change_orders: changeOrders.map((row: any) => ({
      id: Number(row.id),
      title: row.title,
      status: row.status,
      grand_total: money(row.grand_total),
    })),
    contract_total: contractTotal,
    collected,
    still_owed: holder ? money(contractTotal - collected) : 0,
    invoiced: money(invoiced),
    invoice_balance: money(invoiceBalance),
    unbilled: holder ? money(contractTotal - invoiced) : 0,
    payments,
    invoices,
  };
}
