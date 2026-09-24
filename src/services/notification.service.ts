import { pool } from '../db';

export class NotificationNotFoundError extends Error {
  constructor(message = 'Notification not found.') {
    super(message);
    this.name = 'NotificationNotFoundError';
  }
}

export async function getNotifications(
  userId: string,
  options: { limit: number; offset?: number; unreadOnly?: boolean }
) {
  const limit = options.limit;
  const offset = options.offset ?? 0;
  const unreadOnly = Boolean(options.unreadOnly);
  const where = unreadOnly
    ? `WHERE user_id = $1 AND read_at IS NULL`
    : `WHERE user_id = $1`;

  const countResult = await pool.query(
    `
          SELECT COUNT(*)::int AS count
          FROM notifications
          ${where}
        `,
    [userId]
  );

  const { rows } = await pool.query(
    `
          SELECT id, type, title, message, entity_type, entity_id, metadata, read_at, created_at
          FROM notifications
          ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $2
          OFFSET $3
        `,
    [userId, limit, offset]
  );

  const total = countResult.rows[0]?.count ?? 0;

  return {
    notifications: rows,
    total,
    hasMore: offset + rows.length < total,
  };
}

export async function getUnreadCount(userId: string) {
  const { rows } = await pool.query(
    `
          SELECT COUNT(*)::int AS count
          FROM notifications
          WHERE user_id = $1
            AND read_at IS NULL
          `,
    [userId]
  );
  return rows[0]?.count ?? 0;
}

export async function readNotification(notificationId: number, userId: string) {
  const { rows } = await pool.query(
    `
      UPDATE notifications
      SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = $1
        AND user_id = $2
      RETURNING id, read_at
      `,
    [notificationId, userId]
  );

  if (!rows.length) {
    throw new NotificationNotFoundError();
  }

  return rows[0];
}

export async function readAll(userId: string) {
  const { rowCount } = await pool.query(
    `
          UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
            AND read_at IS NULL
          `,
    [userId]
  );

  return rowCount ?? 0;
}

export async function deleteNotification(
  userId: string,
  notificationId: number
) {
  const { rows } = await pool.query(
    `
      DELETE FROM notifications
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
    [notificationId, userId]
  );

  if (!rows.length) {
    throw new NotificationNotFoundError();
  }

  return rows[0].id;
}

export async function deleteAllRead(userId: string) {
  const { rowCount } = await pool.query(
    `
          DELETE FROM notifications
          WHERE user_id = $1
            AND read_at IS NOT NULL
          `,
    [userId]
  );

  return rowCount ?? 0;
}
