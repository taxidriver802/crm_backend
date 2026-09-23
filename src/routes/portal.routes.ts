import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import * as portalService from '../services/portal.service';
import { requestScope } from '../lib/tenant';
import { FileNotFoundError } from '../services/files.service';
import fs from 'fs';

export const portalRouter = Router();
export const publicPortalRouter = Router();

// ─── AUTHENTICATED (generate / revoke portal links) ───

portalRouter.use(requireAuth);
portalRouter.use(requireRole('owner', 'admin'));

portalRouter.post(
  '/generate/:jobId',
  asyncHandler(async (req, res) => {
    const { userId, companyId } = requestScope(req);
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    try {
      const result = await portalService.generatePortalToken(userId, jobId, {
        companyId,
      });
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
    const { userId, companyId } = requestScope(req);
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    await portalService.revokePortalToken(userId, jobId, { companyId });
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

publicPortalRouter.get(
  '/:token/files/:fileId',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    const fileId = Number(req.params.fileId);
    if (!token || !Number.isInteger(fileId)) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }

    try {
      const { file, filePath } = await portalService.getPortalFile(
        token,
        fileId
      );
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'File not found' });
      }
      if (file.mime_type) {
        res.type(file.mime_type);
      }
      res.sendFile(filePath);
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
