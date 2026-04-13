import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createSavedViewSchema,
  savedViewEntitySchema,
  updateSavedViewSchema,
} from '../validators/savedViews.schemas';
import * as savedViewsService from '../services/savedViews.service';

export const savedViewsRouter = Router();

savedViewsRouter.use(requireAuth);

savedViewsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const parsedEntity = savedViewEntitySchema.safeParse(req.query.entityType);
    if (!parsedEntity.success) {
      return res.status(400).json({ ok: false, error: 'Invalid entityType' });
    }

    const views = await savedViewsService.listSavedViews(
      userId,
      parsedEntity.data
    );
    res.json({ ok: true, views });
  })
);

savedViewsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const parsed = createSavedViewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const view = await savedViewsService.createSavedView(userId, parsed.data);
      res.status(201).json({ ok: true, view });
    } catch (error) {
      if (error instanceof savedViewsService.SavedViewConflictError) {
        return res.status(409).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

savedViewsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateSavedViewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const view = await savedViewsService.updateSavedView(
        userId,
        id,
        parsed.data
      );
      res.json({ ok: true, view });
    } catch (error) {
      if (error instanceof savedViewsService.SavedViewNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof savedViewsService.SavedViewConflictError) {
        return res.status(409).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

savedViewsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await savedViewsService.deleteSavedView(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof savedViewsService.SavedViewNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
