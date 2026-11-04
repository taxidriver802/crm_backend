import { pool } from '../db';
import { tenantPredicate, tenantScope } from '../lib/tenant';
import { JOB_STATUSES } from '../lib/jobLifecycle';

export {
  getTeamPerformance,
  getUserPerformance,
  parsePerformanceWindow,
} from './teamPerformance.service';

type ReportScope = { includeAll?: boolean; companyId?: string };

export async function getLeadFunnel(userId: string, options: ReportScope = {}) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const where = tenantPredicate(params, scope, { assignedWork: true });
  const result = await pool.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM leads
    WHERE ${where}
    GROUP BY status
    ORDER BY count DESC, status ASC
    `,
    params
  );
  return result.rows;
}

export async function getEstimateOutcomes(
  userId: string,
  options: ReportScope = {}
) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const where = tenantPredicate(params, scope);
  const byStatusResult = await pool.query(
    `
    SELECT
      status,
      COUNT(*)::int AS count,
      COALESCE(SUM(grand_total), 0)::float AS total
    FROM estimates
    WHERE ${where}
    GROUP BY status
    ORDER BY
      CASE status
        WHEN 'Draft' THEN 1
        WHEN 'Sent' THEN 2
        WHEN 'Approved' THEN 3
        WHEN 'Rejected' THEN 4
        ELSE 999
      END
    `,
    params
  );

  const approvedParams: unknown[] = [];
  const approvedWhere = tenantPredicate(approvedParams, scope);
  const approvedRevenueResult = await pool.query(
    `
    SELECT COALESCE(SUM(grand_total), 0)::float AS approved_revenue
    FROM estimates
    WHERE ${approvedWhere} AND status = 'Approved'
    `,
    approvedParams
  );

  const totalCount = byStatusResult.rows.reduce(
    (sum, row) => sum + Number(row.count || 0),
    0
  );
  const approvedCount =
    byStatusResult.rows.find((row) => row.status === 'Approved')?.count ?? 0;

  return {
    byStatus: byStatusResult.rows,
    approvedRevenue: approvedRevenueResult.rows[0]?.approved_revenue ?? 0,
    approvedRate:
      totalCount > 0 ? Number(approvedCount) / Number(totalCount) : 0,
  };
}

export async function getJobPipeline(userId: string, options: ReportScope = {}) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const where = tenantPredicate(params, scope, { assignedWork: true });
  const result = await pool.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM jobs
    WHERE ${where}
    GROUP BY status
    `,
    params
  );
  // Lifecycle order, not popularity: the report reads left to right as
  // first contact to paid.
  const order = (status: string) => {
    const index = (JOB_STATUSES as readonly string[]).indexOf(status);
    return index === -1 ? 999 : index;
  };
  return result.rows.sort((a, b) => order(a.status) - order(b.status));
}

/**
 * Money after the sale. Monthly: work signed (approved estimates), billed
 * (invoices sent) and collected (payments received). Plus receivables aging
 * on what is still owed, bucketed by days past due.
 */
export async function getCollections(userId: string, options: ReportScope = {}) {
  const scope = await tenantScope(userId, options);
  const jobParams: unknown[] = [];
  const jobWhere = tenantPredicate(jobParams, scope, {
    alias: 'j',
    assignedWork: true,
  });

  const monthly = await pool.query(
    `
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', NOW()) - INTERVAL '11 months',
        date_trunc('month', NOW()),
        INTERVAL '1 month'
      ) AS month
    ),
    visible_jobs AS (
      SELECT j.id FROM jobs j WHERE ${jobWhere}
    ),
    signed AS (
      SELECT date_trunc('month', e.approved_at) AS month, SUM(e.grand_total) AS amount
      FROM estimates e
      WHERE e.job_id IN (SELECT id FROM visible_jobs)
        AND e.status = 'Approved' AND e.approved_at IS NOT NULL
      GROUP BY 1
    ),
    billed AS (
      SELECT date_trunc('month', i.sent_at) AS month, SUM(i.grand_total) AS amount
      FROM invoices i
      WHERE i.job_id IN (SELECT id FROM visible_jobs)
        AND i.status NOT IN ('Draft', 'Void') AND i.sent_at IS NOT NULL
      GROUP BY 1
    ),
    collected AS (
      SELECT date_trunc('month', p.received_at) AS month, SUM(p.amount) AS amount
      FROM invoice_payments p
      INNER JOIN invoices i ON i.id = p.invoice_id AND i.status <> 'Void'
      WHERE p.job_id IN (SELECT id FROM visible_jobs)
      GROUP BY 1
    )
    SELECT
      to_char(m.month, 'YYYY-MM') AS month_key,
      COALESCE(s.amount, 0)::float AS signed,
      COALESCE(b.amount, 0)::float AS billed,
      COALESCE(c.amount, 0)::float AS collected
    FROM months m
    LEFT JOIN signed s ON s.month = m.month
    LEFT JOIN billed b ON b.month = m.month
    LEFT JOIN collected c ON c.month = m.month
    ORDER BY m.month ASC
    `,
    jobParams
  );

  const agingParams: unknown[] = [];
  const agingWhere = tenantPredicate(agingParams, scope, {
    alias: 'j',
    assignedWork: true,
  });
  const aging = await pool.query(
    `
    SELECT
      CASE
        WHEN i.due_date IS NULL OR i.due_date >= NOW() THEN 'current'
        WHEN i.due_date >= NOW() - INTERVAL '30 days' THEN '1_30'
        WHEN i.due_date >= NOW() - INTERVAL '60 days' THEN '31_60'
        WHEN i.due_date >= NOW() - INTERVAL '90 days' THEN '61_90'
        ELSE '90_plus'
      END AS bucket,
      COUNT(*)::int AS count,
      COALESCE(SUM(GREATEST(i.grand_total - i.amount_paid, 0)), 0)::float AS amount
    FROM invoices i
    INNER JOIN jobs j ON j.id = i.job_id
    WHERE ${agingWhere}
      AND i.status IN ('Sent', 'Partially Paid', 'Overdue')
    GROUP BY 1
    `,
    agingParams
  );

  const buckets = ['current', '1_30', '31_60', '61_90', '90_plus'].map((key) => {
    const row = aging.rows.find((r) => r.bucket === key);
    return {
      bucket: key,
      count: Number(row?.count ?? 0),
      amount: Number(row?.amount ?? 0),
    };
  });

  return {
    monthly: monthly.rows,
    aging: buckets,
    outstanding_total: buckets.reduce((sum, b) => sum + b.amount, 0),
  };
}

export async function getMonthlyTrends(
  userId: string,
  options: ReportScope = {}
) {
  const scope = await tenantScope(userId, options);
  const leadParams: unknown[] = [];
  const leadWhere = tenantPredicate(leadParams, scope, { assignedWork: true });
  const leadsResult = await pool.query(
    `
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') AS month_key,
      COUNT(*)::int AS count
    FROM leads
    WHERE ${leadWhere}
      AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at) ASC
    `,
    leadParams
  );

  const estimateParams: unknown[] = [];
  const estimateWhere = tenantPredicate(estimateParams, scope);
  const estimatesResult = await pool.query(
    `
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') AS month_key,
      COUNT(*)::int AS count
    FROM estimates
    WHERE ${estimateWhere}
      AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at) ASC
    `,
    estimateParams
  );

  return {
    leads: leadsResult.rows,
    estimates: estimatesResult.rows,
  };
}
