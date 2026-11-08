import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import { requestScope } from '../lib/tenant';
import * as preferencesService from '../services/preferences.service';

/** GET/PATCH/DELETE /me/preferences — the signed-in user's own workspace. */
export const meRouter = Router();
meRouter.use(requireAuth);

function sendError(res: any, error: unknown) {
  if (error instanceof preferencesService.PreferencesInvalidError) {
    return res
      .status(400)
      .json({ ok: false, error: error.message, details: error.details });
  }
  if (error instanceof preferencesService.PreferencesTooLargeError) {
    return res.status(413).json({ ok: false, error: error.message });
  }
  throw error;
}

meRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const { userId, companyId } = requestScope(req);
    const data = await preferencesService.getPreferences(userId, companyId);
    res.json({ ok: true, ...data });
  })
);

meRouter.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
    const { userId, companyId } = requestScope(req);
    try {
      const data = await preferencesService.updatePreferences(
        userId,
        companyId,
        req.body ?? {}
      );
      res.json({ ok: true, ...data });
    } catch (error) {
      sendError(res, error);
    }
  })
);

meRouter.delete(
  '/preferences',
  asyncHandler(async (req, res) => {
    const { userId, companyId } = requestScope(req);
    const data = await preferencesService.resetPreferences(userId, companyId);
    res.json({ ok: true, ...data });
  })
);

/** GET/PATCH /company/workspace-defaults — what new and un-customized users get. */
export const workspaceDefaultsRouter = Router();
workspaceDefaultsRouter.use(requireAuth);

workspaceDefaultsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const defaults = await preferencesService.getWorkspaceDefaults(companyId);
    res.json({ ok: true, defaults });
  })
);

workspaceDefaultsRouter.patch(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    try {
      const defaults = await preferencesService.updateWorkspaceDefaults(
        companyId,
        req.body ?? {}
      );
      res.json({ ok: true, defaults });
    } catch (error) {
      sendError(res, error);
    }
  })
);
