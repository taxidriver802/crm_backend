import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { upload } from '../lib/upload';
import * as filesService from '../services/files.service';
import { updateFileSchema } from '../validators/files.schemas';

export const filesRouter = Router();

function parseOptionalInt(value: unknown) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) ? num : null;
}

function parseOptionalBoolean(value: unknown) {
  if (value == null) return undefined;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

function parseFileCategory(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'before' || raw === 'after' || raw === 'other') return raw;
  return undefined;
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
    const jobId = parseOptionalInt(req.body.job_id);

    if (req.body.lead_id != null && leadId == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid lead_id',
      });
    }

    if (req.body.job_id != null && jobId == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid job_id',
      });
    }

    const captionRaw =
      req.body.caption == null ? undefined : String(req.body.caption);
    const caption =
      captionRaw == null ? undefined : captionRaw.trim() ? captionRaw.trim() : null;

    const categoryProvided =
      req.body.category != null && String(req.body.category).trim() !== '';
    const category = parseFileCategory(req.body.category);
    if (categoryProvided && !category) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid category',
      });
    }

    const clientVisibleProvided =
      req.body.client_visible != null &&
      String(req.body.client_visible).trim() !== '';
    const clientVisible = parseOptionalBoolean(req.body.client_visible);
    if (clientVisibleProvided && clientVisible == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid client_visible',
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
        jobId,
        caption,
        category: category ?? null,
        clientVisible: clientVisible ?? null,
      });

      res.status(201).json({
        ok: true,
        file,
      });
    } catch (error) {
      if (
        error instanceof filesService.LeadNotFoundError ||
        error instanceof filesService.JobNotFoundError
      ) {
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
    const userId = req.user?.userId;
    if (!userId) {
      throw new filesService.UserNotProvidedError();
    }

    const leadId = parseOptionalInt(req.query.lead_id);
    const jobId = parseOptionalInt(req.query.job_id);

    if (req.query.lead_id != null && leadId == null) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid lead_id',
      });
    }

    try {
      const files = await filesService.getFiles(userId, leadId, jobId);

      res.json({
        ok: true,
        files,
      });
    } catch (error) {
      if (
        error instanceof filesService.LeadNotFoundError ||
        error instanceof filesService.JobNotFoundError
      ) {
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
 * PATCH /files/:id
 * Metadata only: caption, category, client_visible
 */
filesRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req: any, res) => {
    const fileId = Number(req.params.id);
    const userId = String(req.user?.userId || '');
    if (!userId) {
      throw new filesService.UserNotProvidedError();
    }

    if (!Number.isInteger(fileId)) {
      return res.status(400).json({ ok: false, error: 'Invalid file id' });
    }

    const parsed = updateFileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const updates: filesService.UpdateFileInput = {};
    if ('caption' in parsed.data) {
      const caption = parsed.data.caption;
      updates.caption =
        caption == null ? null : caption.trim() ? caption.trim() : null;
    }
    if ('category' in parsed.data) {
      updates.category = parsed.data.category;
    }
    if ('client_visible' in parsed.data) {
      updates.client_visible = parsed.data.client_visible;
    }

    try {
      const file = await filesService.updateFile(userId, fileId, updates);
      res.json({ ok: true, file });
    } catch (error) {
      if (error instanceof filesService.FileNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
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

    const fileId = Number(req.params.id);
    const userId = String(req.user.userId);
    if (!userId) {
      throw new filesService.UserNotProvidedError();
    }

    if (!Number.isInteger(fileId)) {
      return res.status(400).json({ ok: false, error: 'Invalid file id' });
    }

    try {
      await filesService.deleteFile(userId, fileId);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof filesService.FileNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
