import { pool } from '../db';

export async function getLeadFunnel(userId: string) {
  const result = await pool.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM leads
    WHERE user_id = $1
    GROUP BY status
    ORDER BY count DESC, status ASC
    `,
    [userId]
  );
  return result.rows;
}

export async function getEstimateOutcomes(userId: string) {
  const byStatusResult = await pool.query(
    `
    SELECT
      status,
      COUNT(*)::int AS count,
      COALESCE(SUM(grand_total), 0)::float AS total
    FROM estimates
    WHERE user_id = $1
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
    [userId]
  );

  const approvedRevenueResult = await pool.query(
    `
    SELECT COALESCE(SUM(grand_total), 0)::float AS approved_revenue
    FROM estimates
    WHERE user_id = $1 AND status = 'Approved'
    `,
    [userId]
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

export async function getJobPipeline(userId: string) {
  const result = await pool.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM jobs
    WHERE user_id = $1
    GROUP BY status
    ORDER BY count DESC, status ASC
    `,
    [userId]
  );
  return result.rows;
}

export async function getMonthlyTrends(userId: string) {
  const leadsResult = await pool.query(
    `
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') AS month_key,
      COUNT(*)::int AS count
    FROM leads
    WHERE user_id = $1
      AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at) ASC
    `,
    [userId]
  );

  const estimatesResult = await pool.query(
    `
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') AS month_key,
      COUNT(*)::int AS count
    FROM estimates
    WHERE user_id = $1
      AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at) ASC
    `,
    [userId]
  );

  return {
    leads: leadsResult.rows,
    estimates: estimatesResult.rows,
  };
}
