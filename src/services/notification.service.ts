import { pool } from '../db';

export class NotificationNotFoundError extends Error {
  constructor(message = 'Notification not found.') {
    super(message);
    this.name = 'NotificationNotFoundError';
  }
}

export async function getNotifications(
  userId: number,
  limit: number,
  unreadOnly: boolean
) {
  const values = [userId, limit];
  let sql = `
          SELECT id, type, title, message, entity_type, entity_id, metadata, read_at, created_at
          FROM notifications
          WHERE user_id = $1
        `;

  if (unreadOnly) {
    sql += ` AND read_at IS NULL`;
  }

  sql += `
          ORDER BY created_at DESC
          LIMIT $2
        `;

  const { rows } = await pool.query(sql, values);

  return rows;
}

export async function getUnreadCount(userId: number) {
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

export async function readNotification(notificationId: number, userId: number) {
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

export async function readAll(userId: number) {
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
  userId: number,
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

export async function deleteAllRead(userId: number) {
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
