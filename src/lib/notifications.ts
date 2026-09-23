import { pool } from '../db';

export type NotificationType =
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'FILE_UPLOADED'
  | 'INVITE_ACCEPTED'
  | 'ESTIMATE_CREATED'
  | 'ESTIMATE_STATUS_CHANGED'
  | 'ESTIMATE_CLIENT_RESPONDED'
  | 'INVOICE_CREATED'
  | 'INVOICE_STATUS_CHANGED'
  | 'INVOICE_PAID'
  | 'LEAD_CREATED'
  | 'LEAD_ASSIGNED'
  | 'JOB_ASSIGNED';

export type NotificationEntityType =
  | 'task'
  | 'lead'
  | 'job'
  | 'invite'
  | 'estimate'
  | 'invoice';

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
        dedupe_key,
        company_id
      )
      SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, u.company_id
      FROM users u
      WHERE u.id = $1
      ON CONFLICT (company_id, dedupe_key)
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

/** Notify the new assignee. Skips self-assignment and unchanged assignees. */
export async function notifyAssigneeChange(input: {
  actorUserId: string;
  assignedTo: string | null | undefined;
  previousAssignedTo?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: number;
  metadata?: Record<string, unknown> | null;
}) {
  const next = input.assignedTo ?? null;
  if (!next || next === input.actorUserId) return;
  if (
    input.previousAssignedTo !== undefined &&
    next === (input.previousAssignedTo ?? null)
  ) {
    return;
  }

  return createNotification({
    userId: next,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? null,
  });
}
