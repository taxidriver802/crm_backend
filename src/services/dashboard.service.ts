import { pool } from '../db';
import { getTaskSummary } from './tasks.service';

export async function getDashboardData(userId: string) {
  const [
    leadsTotalResult,
    leadsByStatusResult,
    taskSummary,
    jobsTotalResult,
    jobsByStatusResult,
    estimatesTotalResult,
    estimatesByStatusResult,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM leads WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM leads
        WHERE user_id = $1
        GROUP BY status
        ORDER BY
          CASE status
            WHEN 'New' THEN 1
            WHEN 'Contacted' THEN 2
            WHEN 'Showing Scheduled' THEN 3
            WHEN 'Under Contract' THEN 4
            WHEN 'Closed' THEN 5
            WHEN 'Lost' THEN 6
            ELSE 999
          END ASC,
          status ASC;
        `,
      [userId]
    ),
    getTaskSummary(userId),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM jobs WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM jobs
        WHERE user_id = $1
        GROUP BY status
        ORDER BY
          CASE status
            WHEN 'New' THEN 1
            WHEN 'Contacted' THEN 2
            WHEN 'Appointment Scheduled' THEN 3
            WHEN 'Proposal Sent' THEN 4
            WHEN 'Closed Won' THEN 5
            WHEN 'Closed Lost' THEN 6
            ELSE 999
          END ASC,
          status ASC;
        `,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM estimates WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
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
          END ASC,
          status ASC;
        `,
      [userId]
    ),
  ]);

  return {
    leads: {
      total: leadsTotalResult.rows[0].total,
      byStatus: leadsByStatusResult.rows,
    },
    jobs: {
      total: jobsTotalResult.rows[0].total,
      byStatus: jobsByStatusResult.rows,
    },
    estimates: {
      total: estimatesTotalResult.rows[0].total,
      byStatus: estimatesByStatusResult.rows,
    },
    tasks: taskSummary,
  };
}
