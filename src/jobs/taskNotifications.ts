import { pool } from '../db';
import { createNotification } from '../lib/notifications';

export async function runTaskNotificationJob() {
  // 🔥 Due soon (next 24 hours)
  const dueSoon = await pool.query(`
    SELECT *
    FROM tasks
    WHERE status <> 'Completed'
      AND due_date IS NOT NULL
      AND due_date >= NOW()
      AND due_date <= NOW() + INTERVAL '24 hours'
  `);

  for (const task of dueSoon.rows) {
    await createNotification({
      userId: task.user_id,
      type: 'TASK_DUE_SOON',
      title: 'Task due soon',
      message: `${task.title} is due soon`,
      entityType: 'task',
      entityId: task.id,
      dedupeKey: `due_soon:${task.id}:${task.due_date}`,
    });
  }

  // 🔥 Overdue
  const overdue = await pool.query(`
    SELECT *
    FROM tasks
    WHERE status <> 'Completed'
      AND due_date IS NOT NULL
      AND due_date < NOW()
  `);

  for (const task of overdue.rows) {
    await createNotification({
      userId: task.user_id,
      type: 'TASK_OVERDUE',
      title: 'Task overdue',
      message: `${task.title} is overdue`,
      entityType: 'task',
      entityId: task.id,
      dedupeKey: `overdue:${task.id}:${task.due_date}`,
    });
  }
}
