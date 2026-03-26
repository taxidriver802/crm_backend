import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listNotificationsSchema,
  markNotificationReadParamsSchema,
} from '../validators/notification.schemas';

export const notificationRouter = Router();

notificationRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = listNotificationsSchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query params',
        details: parsed.error.flatten(),
      });
    }

    const { limit, unreadOnly } = parsed.data;
    const userId = req.user!.userId;

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

    res.json({ notifications: rows });
  })
);

notificationRouter.get(
  '/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const { rows } = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE user_id = $1
        AND read_at IS NULL
      `,
      [userId]
    );

    res.json({ count: rows[0]?.count ?? 0 });
  })
);

notificationRouter.patch(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = markNotificationReadParamsSchema.safeParse(req.params);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid notification id',
        details: parsed.error.flatten(),
      });
    }

    const { id } = parsed.data;
    const userId = req.user!.userId;

    const { rows } = await pool.query(
      `
      UPDATE notifications
      SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = $1
        AND user_id = $2
      RETURNING id, read_at
      `,
      [id, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ notification: rows[0] });
  })
);

notificationRouter.patch(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const { rowCount } = await pool.query(
      `
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND read_at IS NULL
      `,
      [userId]
    );

    res.json({ updated: rowCount ?? 0 });
  })
);

notificationRouter.delete(
  '/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const { rowCount } = await pool.query(
      `
      DELETE FROM notifications
      WHERE user_id = $1
        AND read_at IS NOT NULL
      `,
      [userId]
    );

    res.json({ deleted: rowCount ?? 0 });
  })
);

notificationRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = markNotificationReadParamsSchema.safeParse(req.params);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid notification id',
        details: parsed.error.flatten(),
      });
    }

    const userId = req.user!.userId;
    const { id } = parsed.data;

    const { rows } = await pool.query(
      `
      DELETE FROM notifications
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ deletedId: rows[0].id });
  })
);
