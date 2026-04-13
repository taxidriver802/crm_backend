import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import * as portalService from '../services/portal.service';

export const portalRouter = Router();
export const publicPortalRouter = Router();

// ─── AUTHENTICATED (generate / revoke portal links) ───

portalRouter.use(requireAuth);
portalRouter.use(requireRole('owner', 'admin'));

portalRouter.post(
  '/generate/:jobId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    try {
      const result = await portalService.generatePortalToken(userId, jobId);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      if (error.message === 'Job not found') {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

portalRouter.delete(
  '/revoke/:jobId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    await portalService.revokePortalToken(userId, jobId);
    res.json({ ok: true });
  })
);

// ─── PUBLIC (customer-facing, no auth) ─────────────────

publicPortalRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }

    try {
      const data = await portalService.getPortalData(token);
      res.json({ ok: true, portal: data });
    } catch (error) {
      if (error instanceof portalService.PortalTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
