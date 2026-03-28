import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listNotificationsSchema,
  markNotificationReadParamsSchema,
} from '../validators/notification.schemas';
import * as notificationService from '../services/notification.service';

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
    const rows = await notificationService.getNotifications(
      userId,
      limit,
      unreadOnly
    );
    res.json({ notifications: rows });
  })
);

notificationRouter.get(
  '/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const rows = await notificationService.getUnreadCount(userId);
    res.json({ count: rows });
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

    const rows = await notificationService.readNotification(id, userId);

    res.json({ notification: rows });
  })
);

notificationRouter.patch(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const rowCount = await notificationService.readAll(userId);
    res.json({ updated: rowCount });
  })
);

notificationRouter.delete(
  '/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const rowCount = await notificationService.deleteAllRead(userId);
    res.json({ deleted: rowCount });
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
    const rows = await notificationService.deleteNotification(userId, id);
    res.json({ deletedId: rows });
  })
);
