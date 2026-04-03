import { pool } from '../db';
import { getTaskSummary } from './tasks.service';

export async function getDashboardData(userId: string) {
  const [leadsTotalResult, leadsByStatusResult, taskSummary] =
    await Promise.all([
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
    ]);

  return {
    leads: {
      total: leadsTotalResult.rows[0].total,
      byStatus: leadsByStatusResult.rows,
    },
    tasks: taskSummary,
  };
}
