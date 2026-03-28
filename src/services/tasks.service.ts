import { pool } from '../db';
import { createNotification } from '../lib/notifications';

export class TaskNotFoundError extends Error {
  constructor(message = 'Task not found') {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

export class LeadNotFoundError extends Error {
  constructor(message = 'Lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

async function ensureJobBelongsToUser(jobId: number, userId: number) {
  const result = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
}

export type GetTasksFilters = {
  status?: string;
  leadId?: number;
  jobId?: number;
  dueBefore?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CreateTaskInput = {
  lead_id?: number | null;
  job_id?: number | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status?: string | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput>;

async function ensureLeadBelongsToUser(leadId: number, userId: number) {
  const result = await pool.query(
    `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
    [leadId, userId]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }
}

export async function getTaskSummary(userId: number) {
  const [countsResult, overdueTasks, dueTodayTasks, upcomingResult] =
    await Promise.all([
      pool.query(
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
      ),
      pool.query(
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
      ),
      pool.query(
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
      ),
      pool.query(
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
      ),
    ]);

  return {
    counts: countsResult.rows[0],
    overdueTasks: overdueTasks.rows,
    dueTodayTasks: dueTodayTasks.rows,
    nextUp: upcomingResult.rows,
  };
}

export async function getTasks(userId: number, filters: GetTasksFilters) {
  const params: any[] = [userId];
  const where: string[] = ['t.user_id = $1'];

  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }

  if (Number.isFinite(filters.leadId)) {
    params.push(filters.leadId);
    where.push(`t.lead_id = $${params.length}`);
  }

  if (Number.isFinite(filters.jobId)) {
    params.push(filters.jobId);
    where.push(`t.job_id = $${params.length}`);
  }

  if (filters.dueBefore) {
    params.push(filters.dueBefore);
    where.push(`t.due_date <= $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(t.title ILIKE ${p} OR t.description ILIKE ${p})`);
  }

  params.push(filters.limit ?? 50);
  params.push(filters.offset ?? 0);

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
  return result.rows;
}

export async function createTask(userId: number, input: CreateTaskInput) {
  if (input.lead_id != null) {
    await ensureLeadBelongsToUser(input.lead_id, userId);
  }

  if (input.job_id != null) {
    await ensureJobBelongsToUser(input.job_id, userId);
  }

  const result = await pool.query(
    `
    INSERT INTO tasks (user_id, lead_id, job_id, title, description, due_date, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
    `,
    [
      userId,
      input.lead_id ?? null,
      input.job_id ?? null,
      input.title,
      input.description ?? null,
      input.due_date ? new Date(input.due_date).toISOString() : null,
      input.status ?? 'Pending',
    ]
  );

  const task = result.rows[0];

  if (task.user_id) {
    await createNotification({
      userId: task.user_id,
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      message: `You were assigned: ${task.title}`,
      entityType: 'task',
      entityId: task.id,
    });
  }

  return task;
}

export async function getTaskById(userId: number, id: number) {
  const result = await pool.query(
    `
    SELECT
      t.id,
      t.user_id,
      t.lead_id,
      t.job_id,
      t.title,
      t.description,
      t.due_date,
      t.status,
      t.created_at,
      t.updated_at,
      l.first_name AS lead_first_name,
      l.last_name AS lead_last_name
    FROM tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE t.user_id = $1 AND t.id = $2
    LIMIT 1
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  return result.rows[0];
}

export async function getTasksByJobId(userId: number, jobId: number) {
  await ensureJobBelongsToUser(jobId, userId);

  const result = await pool.query(
    `
    SELECT
      t.*,
      l.first_name AS lead_first_name,
      l.last_name AS lead_last_name
    FROM tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE t.user_id = $1 AND t.job_id = $2
    ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC
    `,
    [userId, jobId]
  );

  return result.rows;
}

export async function updateTask(
  userId: number,
  id: number,
  updates: UpdateTaskInput
) {
  const keys = Object.keys(updates) as (keyof UpdateTaskInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  if (updates.lead_id != null) {
    await ensureLeadBelongsToUser(updates.lead_id, userId);
  }

  if (updates.job_id != null) {
    await ensureJobBelongsToUser(updates.job_id, userId);
  }
  const existingTaskResult = await pool.query(
    `SELECT user_id, title FROM tasks WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );

  if (existingTaskResult.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  const existingTask = existingTaskResult.rows[0];

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    let value = updates[key];

    if (key === 'due_date') {
      value = value ? new Date(value).toISOString() : null;
    }

    values.push(value ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  const sql = `
    UPDATE tasks
    SET ${setParts.join(', ')}
    WHERE user_id = $1 AND id = $2
    RETURNING *;
  `;

  const result = await pool.query(sql, values);
  const updatedTask = result.rows[0];

  if (updatedTask.user_id && updatedTask.user_id !== existingTask.user_id) {
    await createNotification({
      userId: updatedTask.user_id,
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      message: `You were assigned: ${updatedTask.title}`,
      entityType: 'task',
      entityId: updatedTask.id,
    });
  }

  return updatedTask;
}

export async function deleteTask(userId: number, id: number) {
  const result = await pool.query(
    `DELETE FROM tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  return result.rows[0].id;
}
