import { pool } from '../db';
import { createNotification } from '../lib/notifications';

const TASK_NOTIFICATION_SELECT = `
  SELECT
    t.id,
    t.user_id,
    t.lead_id,
    t.job_id,
    t.title,
    t.due_date,
    t.status,

    l.first_name AS lead_first_name,
    l.last_name AS lead_last_name,

    j.title AS job_title,
    j.address AS job_address,
    j.lead_id AS job_lead_id,

    jl.first_name AS job_lead_first_name,
    jl.last_name AS job_lead_last_name
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
  LEFT JOIN jobs j ON j.id = t.job_id
  LEFT JOIN leads jl ON jl.id = j.lead_id
`;

function buildName(first?: string | null, last?: string | null) {
  return `${first || ''} ${last || ''}`.trim() || null;
}

function getContextLabel(task: any) {
  if (task.job_id != null) {
    return task.job_address || task.job_title || `Job #${task.job_id}`;
  }

  const leadName = buildName(task.lead_first_name, task.lead_last_name);
  if (leadName) return leadName;
  if (task.lead_id != null) return `Lead #${task.lead_id}`;

  return null;
}

function getEntityType(task: any): 'job' | 'lead' | 'task' {
  if (task.job_id != null) return 'job';
  if (task.lead_id != null) return 'lead';
  return 'task';
}

function getEntityId(task: any) {
  if (task.job_id != null) return task.job_id;
  if (task.lead_id != null) return task.lead_id;
  return task.id;
}

function buildMessage(kind: 'dueSoon' | 'overdue', task: any) {
  const context = getContextLabel(task);

  if (kind === 'dueSoon') {
    return context
      ? `${task.title} is due soon for ${context}`
      : `${task.title} is due soon`;
  }

  return context
    ? `${task.title} is overdue for ${context}`
    : `${task.title} is overdue`;
}

export async function runTaskNotificationJob() {
  // 🔥 Due soon (next 24 hours)
  const dueSoon = await pool.query(`
  ${TASK_NOTIFICATION_SELECT}
  WHERE t.status <> 'Completed'
    AND t.due_date IS NOT NULL
    AND t.due_date >= NOW()
    AND t.due_date <= NOW() + INTERVAL '24 hours'
`);

  for (const task of dueSoon.rows) {
    await createNotification({
      userId: task.user_id,
      type: 'TASK_DUE_SOON',
      title: 'Task due soon',
      message: buildMessage('dueSoon', task),
      entityType: getEntityType(task),
      entityId: getEntityId(task),
      metadata: {
        taskId: task.id,
        taskTitle: task.title,
        dueDate: task.due_date,
        leadId: task.lead_id,
        leadName: buildName(task.lead_first_name, task.lead_last_name),
        jobId: task.job_id,
        jobTitle: task.job_title ?? null,
        jobAddress: task.job_address ?? null,
        jobLeadId: task.job_lead_id ?? null,
        jobLeadName: buildName(
          task.job_lead_first_name,
          task.job_lead_last_name
        ),
      },
      dedupeKey: `due_soon:${task.id}:${task.due_date}`,
    });
  }

  // 🔥 Overdue
  const overdue = await pool.query(`
  ${TASK_NOTIFICATION_SELECT}
  WHERE t.status <> 'Completed'
    AND t.due_date IS NOT NULL
    AND t.due_date < NOW()
`);

  for (const task of overdue.rows) {
    await createNotification({
      userId: task.user_id,
      type: 'TASK_OVERDUE',
      title: 'Task overdue',
      message: buildMessage('overdue', task),

      entityType: getEntityType(task),
      entityId: getEntityId(task),
      metadata: {
        taskId: task.id,
        taskTitle: task.title,
        dueDate: task.due_date,
        leadId: task.lead_id,
        leadName: buildName(task.lead_first_name, task.lead_last_name),
        jobId: task.job_id,
        jobTitle: task.job_title ?? null,
        jobAddress: task.job_address ?? null,
        jobLeadId: task.job_lead_id ?? null,
        jobLeadName: buildName(
          task.job_lead_first_name,
          task.job_lead_last_name
        ),
      },
      dedupeKey: `overdue:${task.id}:${task.due_date}`,
    });
  }
}
