import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createTaskSchema,
  updateTaskSchema,
} from '../validators/tasks.schemas';

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

// GET /tasks/summary
tasksRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const countsResult = await pool.query(
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

    const upcomingResult = await pool.query(
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

    res.json({
      ok: true,
      counts: countsResult.rows[0],
      overdueTasks: overdueTasks.rows,
      dueTodayTasks: dueTodayTasks.rows,
      nextUp: upcomingResult.rows,
    });
  })
);

// GET /tasks?status=Pending&dueBefore=2026-03-10T00:00:00.000Z&leadId=2&limit=50&offset=0
tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;

    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const dueBefore =
      typeof req.query.dueBefore === 'string' ? req.query.dueBefore : undefined;
    const leadId =
      typeof req.query.leadId === 'string'
        ? Number(req.query.leadId)
        : undefined;

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const params: any[] = [userId];
    const where: string[] = ['t.user_id = $1'];

    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }

    if (Number.isFinite(leadId)) {
      params.push(leadId);
      where.push(`t.lead_id = $${params.length}`);
    }

    if (dueBefore) {
      params.push(dueBefore);
      where.push(`t.due_date <= $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(t.title ILIKE ${p} OR t.description ILIKE ${p})`);
    }

    params.push(limit);
    params.push(offset);

    const sql = `
  SELECT
    t.*,
    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE ${where.join(' AND ')}
  ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC
  LIMIT $${params.length - 1}
  OFFSET $${params.length};
`;

    const result = await pool.query(sql, params);
    res.json({ ok: true, tasks: result.rows });
  })
);

// POST /tasks
tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const d = parsed.data;

    // Ensure lead belongs to this user (prevents cross-user task creation)
    const leadCheck = await pool.query(
      `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
      [d.lead_id, userId]
    );
    if (leadCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Lead not found' });
    }

    const result = await pool.query(
      `
      INSERT INTO tasks (user_id, lead_id, title, description, due_date, status)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *;
      `,
      [
        userId,
        d.lead_id,
        d.title,
        d.description ?? null,
        d.due_date ? new Date(d.due_date).toISOString() : null,
        d.status ?? 'Pending',
      ]
    );

    res.status(201).json({ ok: true, task: result.rows[0] });
  })
);

// GET /tasks/:id
tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query(
      `
      SELECT
        t.*,
        l.first_name AS lead_first_name,
        l.last_name  AS lead_last_name
      FROM tasks t
      LEFT JOIN leads l ON l.id = t.lead_id
      WHERE t.user_id = $1 AND t.id = $2
      LIMIT 1;
      `,
      [userId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Task not found' });
    }

    res.json({ ok: true, task: result.rows[0] });
  })
);

// PATCH /tasks/:id
tasksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const updates = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];

    if (keys.length === 0)
      return res.status(400).json({ ok: false, error: 'No fields to update' });

    const setParts: string[] = [];
    const values: any[] = [userId, id];

    for (const key of keys) {
      let value: any = (updates as any)[key];

      if (key === 'due_date') {
        value = value ? new Date(value as string).toISOString() : null;
      }

      if (key === 'lead_id') {
        const check = await pool.query(
          `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
          [value, userId]
        );
        if (check.rowCount === 0) {
          return res.status(404).json({ ok: false, error: 'Lead not found' });
        }
      }

      values.push(value ?? null);
      setParts.push(`${key} = $${values.length}`);
    }

    // bump updated_at once (ONLY if column exists)
    setParts.push(`updated_at = CURRENT_TIMESTAMP`);

    const sql = `
      UPDATE tasks
      SET ${setParts.join(', ')}
      WHERE user_id = $1 AND id = $2
      RETURNING *;
    `;

    const result = await pool.query(sql, values);
    if (result.rowCount === 0)
      return res.status(404).json({ ok: false, error: 'Task not found' });

    res.json({ ok: true, task: result.rows[0] });
  })
);

// DELETE /tasks/:id
tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query(
      `DELETE FROM tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ ok: false, error: 'Task not found' });

    res.json({ ok: true, deletedId: result.rows[0].id });
  })
);
