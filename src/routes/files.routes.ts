import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { upload } from '../lib/upload';
import * as filesService from '../services/files.service';

export const filesRouter = Router();

function parseOptionalInt(value: unknown) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) ? num : null;
}

function canManageFiles(role?: string) {
  return role === 'owner' || role === 'admin';
}

/**
 * POST /files
 * Upload file
 * Accepts optional lead_id
 */
filesRouter.post(
  '/',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const leadId = parseOptionalInt(req.body.lead_id);

    if (req.user?.role === 'agent') {
      return res.status(403).json({
        ok: false,
        error: 'You do not have permission to upload files',
      });
    }

    if (req.body.lead_id != null && leadId == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid lead_id',
      });
    }

    try {
      const file = await filesService.createFile({
        uploadedByUserId: req.user.userId,
        originalName: req.file.originalname,
        storageKey: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        leadId,
      });

      res.status(201).json({
        ok: true,
        file,
      });
    } catch (error) {
      if (error instanceof filesService.LeadNotFoundError) {
        return res.status(404).json({
          ok: false,
          error: error.message,
        });
      }

      throw error;
    }
  })
);

/**
 * GET /files
 * Optional query param: lead_id
 */
filesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const leadId = parseOptionalInt(req.query.lead_id);

    if (req.query.lead_id != null && leadId == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid lead_id',
      });
    }

    try {
      const files = await filesService.getFiles(leadId);

      res.json({
        ok: true,
        files,
      });
    } catch (error) {
      if (error instanceof filesService.LeadNotFoundError) {
        return res.status(404).json({
          ok: false,
          error: error.message,
        });
      }

      throw error;
    }
  })
);

/**
 * DELETE /files/:id
 */
filesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: any, res) => {
    if (!canManageFiles(req.user?.role)) {
      return res.status(403).json({
        ok: false,
        error: 'You do not have permission to delete files',
      });
    }

    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid file id' });
    }

    try {
      await filesService.deleteFile(id);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof filesService.FileNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
