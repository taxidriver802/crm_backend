import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const leadsTotal = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leads WHERE user_id = $1`,
      [userId]
    );

    const leadsByStatus = await pool.query(
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
);

    const taskCounts = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date < NOW())::int AS overdue,
        COUNT(*) FILTER (
          WHERE status <> 'Completed'
            AND due_date >= date_trunc('day', NOW())
            AND due_date < date_trunc('day', NOW()) + INTERVAL '1 day'
        )::int AS due_today,
        COUNT(*) FILTER (
          WHERE status <> 'Completed'
            AND due_date >= NOW()
            AND due_date <= NOW() + INTERVAL '7 days'
        )::int AS next_7_days
      FROM tasks
      WHERE user_id = $1;
      `,
      [userId]
    );

    const overdueTasks = await pool.query(
        `
        SELECT
          t.*,
          l.first_name AS lead_first_name,
          l.last_name AS lead_last_name
        FROM tasks t
        JOIN leads l ON l.id = t.lead_id
        WHERE t.user_id = $1
            AND t.status <> 'Completed'
            AND t.due_date IS NOT NULL
            AND t.due_date < NOW()
        ORDER BY t.due_date ASC
        LIMIT 10;
        `,
        [userId]
    );

    const dueTodayTasks = await pool.query( 
        `
        SELECT
          t.*,
          l.first_name AS lead_first_name,
          l.last_name AS lead_last_name
        FROM tasks t
        JOIN leads l ON l.id = t.lead_id
        WHERE t.user_id = $1
            AND t.status <> 'Completed'
            AND t.due_date IS NOT NULL
            AND t.due_date >= date_trunc('day', NOW())
            AND t.due_date < date_trunc('day', NOW()) + INTERVAL '1 day'
        ORDER BY t.due_date ASC
        LIMIT 10;
        `,
        [userId]
    );

    const nextUp = await pool.query(
      `
      SELECT
        t.*,
        l.first_name AS lead_first_name,
        l.last_name AS lead_last_name
      FROM tasks t
      JOIN leads l ON l.id = t.lead_id
      WHERE t.user_id = $1
        AND t.status <> 'Completed'
        AND t.due_date IS NOT NULL
        AND t.due_date >= NOW()
      ORDER BY t.due_date ASC
      LIMIT 10;
      `,
      [userId]
    );

    res.json({
      ok: true,
      leads: {
        total: leadsTotal.rows[0].total,
        byStatus: leadsByStatus.rows,
      },
      tasks: {
        counts: taskCounts.rows[0],
        overdueTasks: overdueTasks.rows,
        dueTodayTasks: dueTodayTasks.rows,
        nextUp: nextUp.rows,
},
    });
  })
);