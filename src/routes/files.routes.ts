import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { upload } from '../lib/upload';
import fs from 'fs';
import path from 'path';

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

    if (leadId != null) {
      const leadResult = await pool.query(
        `
        SELECT id
        FROM leads
        WHERE id = $1
        `,
        [leadId]
      );

      if (!leadResult.rowCount) {
        return res.status(404).json({
          ok: false,
          error: 'Lead not found',
        });
      }
    }

    const { originalname, filename, mimetype, size } = req.file;

    const result = await pool.query(
      `
      INSERT INTO files (
        uploaded_by_user_id,
        original_name,
        storage_key,
        mime_type,
        size_bytes,
        lead_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [req.user.userId, originalname, filename, mimetype, size, leadId]
    );

    res.status(201).json({
      ok: true,
      file: result.rows[0],
    });
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

    const params: any[] = [];
    let whereClause = '';

    if (leadId != null) {
      params.push(leadId);
      whereClause = `WHERE f.lead_id = $1`;
    }

    const result = await pool.query(
      `
      SELECT
        f.*,
        u.first_name,
        u.last_name
      FROM files f
      LEFT JOIN users u ON u.id = f.uploaded_by_user_id
      ${whereClause}
      ORDER BY f.created_at DESC
      `,
      params
    );

    res.json({
      ok: true,
      files: result.rows,
    });
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

    const result = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    const file = result.rows[0];

    if (!file) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }

    const filePath = path.join(process.cwd(), 'uploads', file.storage_key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await pool.query(`DELETE FROM files WHERE id = $1`, [id]);

    res.json({ ok: true });
  })
);
