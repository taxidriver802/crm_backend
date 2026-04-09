import { pool } from '../db';

export type NotificationType =
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'FILE_UPLOADED'
  | 'INVITE_ACCEPTED';

export type NotificationEntityType = 'task' | 'lead' | 'job' | 'invite';

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: NotificationEntityType | null;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};

export async function createNotification(input: CreateNotificationInput) {
  const {
    userId,
    type,
    title,
    message,
    entityType = null,
    entityId = null,
    metadata = null,
    dedupeKey = null,
  } = input;

  const { rows } = await pool.query(
    `
      INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        entity_type,
        entity_id,
        metadata,
        dedupe_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
      RETURNING *
    `,
    [
      userId,
      type,
      title,
      message,
      entityType,
      entityId,
      metadata ? JSON.stringify(metadata) : null,
      dedupeKey,
    ]
  );

  return rows[0] ?? null;
}
