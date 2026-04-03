import { pool } from '../db';
import { createNotification } from '../lib/notifications';

export class TaskNotFoundError extends Error {
  constructor(message = 'Task not found') {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskOwnershipError';
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

async function ensureJobBelongsToUser(jobId: number, userId: string) {
  const result = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );

  if (result.rowCount === 0) {
    throw new JobNotFoundError();
  }
}

async function ensureLeadBelongsToUser(leadId: number, userId: string) {
  const result = await pool.query(
    `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
    [leadId, userId]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
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

const TASK_SELECT = `
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
    l.last_name AS lead_last_name,
    jl.id AS job_lead_id,
    jl.first_name AS job_lead_first_name,
    jl.last_name AS job_lead_last_name,

    j.title AS job_title,
    j.status AS job_status,
    j.address AS job_address
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
LEFT JOIN jobs j ON j.id = t.job_id
LEFT JOIN leads jl ON jl.id = j.lead_id
`;

function buildLeadName(row: any) {
  const first = String(row.lead_first_name || '').trim();
  const last = String(row.lead_last_name || '').trim();
  const full = `${first} ${last}`.trim();

  if (full) return full;
  if (row.lead_id != null) return `Lead #${row.lead_id}`;
  return null;
}

function normalizeTask(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    lead_id: row.lead_id,
    job_id: row.job_id,
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,

    // keep legacy fields for current UI so you do not break pages immediately
    lead_first_name: row.lead_first_name,
    lead_last_name: row.lead_last_name,
    job_title: row.job_title,
    job_status: row.job_status,
    job_address: row.job_address,

    // new normalized relationship fields
    lead:
      row.lead_id != null
        ? {
            id: row.lead_id,
            name: buildLeadName(row),
            first_name: row.lead_first_name ?? null,
            last_name: row.lead_last_name ?? null,
          }
        : null,

    job_lead:
      row.job_lead_id != null
        ? {
            id: row.job_lead_id,
            name: `${row.job_lead_first_name || ''} ${row.job_lead_last_name || ''}`.trim(),
            first_name: row.job_lead_first_name ?? null,
            last_name: row.job_lead_last_name ?? null,
          }
        : null,

    job:
      row.job_id != null
        ? {
            id: row.job_id,
            title: row.job_title ?? `Job #${row.job_id}`,
            status: row.job_status ?? null,
            address: row.job_address ?? null,
          }
        : null,
  };
}

function normalizeTasks(rows: any[]) {
  return rows.map(normalizeTask);
}

export async function getTaskSummary(userId: string) {
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
        ${TASK_SELECT}
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
        ${TASK_SELECT}
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
        ${TASK_SELECT}
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
    overdueTasks: normalizeTasks(overdueTasks.rows),
    dueTodayTasks: normalizeTasks(dueTodayTasks.rows),
    nextUp: normalizeTasks(upcomingResult.rows),
  };
}

export async function getTasks(userId: string, filters: GetTasksFilters) {
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
    ${TASK_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return normalizeTasks(result.rows);
}

export async function createTask(userId: string, input: CreateTaskInput) {
  if (input.lead_id != null) {
    await ensureLeadBelongsToUser(input.lead_id, userId);
  }

  if (input.job_id != null) {
    await ensureJobBelongsToUser(input.job_id, userId);
  }

  if (!input.lead_id && !input.job_id) {
    throw new TaskOwnershipError('Task must be attached to a lead or a job');
  }

  if (input.lead_id && input.job_id) {
    throw new TaskOwnershipError('Task cannot belong to both a lead and a job');
  }

  let dueDateValue: string | null = null;

  if (input.due_date) {
    const d = new Date(input.due_date);
    if (isNaN(d.getTime())) {
      throw new Error('Invalid due_date');
    }
    dueDateValue = d.toISOString();
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
      dueDateValue,
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

  return getTaskById(userId, task.id);
}

export async function getTaskById(userId: string, id: number) {
  const result = await pool.query(
    `
    ${TASK_SELECT}
    WHERE t.user_id = $1 AND t.id = $2
    LIMIT 1
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  return normalizeTask(result.rows[0]);
}

export async function getTasksByJobId(userId: string, jobId: number) {
  await ensureJobBelongsToUser(jobId, userId);

  const result = await pool.query(
    `
    ${TASK_SELECT}
    WHERE t.user_id = $1 AND t.job_id = $2
    ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC, t.created_at DESC
    `,
    [userId, jobId]
  );

  return normalizeTasks(result.rows);
}

export async function updateTask(
  userId: string,
  id: number,
  updates: UpdateTaskInput
) {
  const keys = Object.keys(updates) as (keyof UpdateTaskInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  if ('lead_id' in updates || 'job_id' in updates) {
    throw new Error('Task ownership cannot be changed after creation');
  }

  if (updates.lead_id != null) {
    await ensureLeadBelongsToUser(updates.lead_id, userId);
  }

  if (updates.job_id != null) {
    await ensureJobBelongsToUser(updates.job_id, userId);
  }

  /*   const existingTaskResult = await pool.query(
    `SELECT user_id, title FROM tasks WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );

  if (existingTaskResult.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  const existingTask = existingTaskResult.rows[0]; */

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    let value = updates[key];

    if (key === 'due_date') {
      if (value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) {
          throw new Error('Invalid due_date');
        }
        value = d.toISOString();
      } else {
        value = null;
      }
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

  if (result.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  const updatedTask = result.rows[0];

  if (updates.status === 'Completed') {
    await createNotification({
      userId,
      type: 'TASK_COMPLETED',
      title: 'Task completed',
      message: `Task completed: ${updatedTask.title}`,
      entityType: 'task',
      entityId: updatedTask.id,
    });
  }

  return getTaskById(userId, updatedTask.id);
}

export async function deleteTask(userId: string, id: number) {
  const result = await pool.query(
    `DELETE FROM tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new TaskNotFoundError();
  }

  return result.rows[0].id;
}
