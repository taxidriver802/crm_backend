import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { upload } from '../lib/upload';
import { requestScope } from '../lib/tenant';
import { updateCompanySchema } from '../validators/company.schemas';
import { publicCompany } from '../lib/companySlug';
import { absoluteUploadPath } from '../services/files.service';

export const companyRouter = Router();

const LOGO_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

async function loadCompany(companyId: string) {
  const result = await pool.query(
    `
    SELECT id, name, slug, palette_id, mark_id, logo_storage_key
    FROM companies
    WHERE id = $1
    LIMIT 1
    `,
    [companyId]
  );
  return result.rows[0] || null;
}

companyRouter.use(requireAuth);

companyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const row = await loadCompany(companyId);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }
    res.json({ ok: true, company: publicCompany(row) });
  })
);

companyRouter.patch(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const parsed = updateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const { companyId } = requestScope(req);
    const current = await loadCompany(companyId);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const name = parsed.data.name ?? current.name;
    const palette_id = parsed.data.palette_id ?? current.palette_id;
    const mark_id = parsed.data.mark_id ?? current.mark_id;
    let logo_storage_key = current.logo_storage_key;

    if (parsed.data.clear_logo && current.logo_storage_key) {
      try {
        const filePath = absoluteUploadPath(current.logo_storage_key);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore missing files
      }
      logo_storage_key = null;
    }

    const result = await pool.query(
      `
      UPDATE companies
      SET
        name = $2,
        palette_id = $3,
        mark_id = $4,
        logo_storage_key = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, slug, palette_id, mark_id, logo_storage_key
      `,
      [companyId, name, palette_id, mark_id, logo_storage_key]
    );

    res.json({ ok: true, company: publicCompany(result.rows[0]) });
  })
);

companyRouter.post(
  '/logo',
  requireRole('owner', 'admin'),
  upload.single('file'),
  asyncHandler(async (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }
    if (!LOGO_TYPES.has(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore
      }
      return res.status(400).json({ ok: false, error: 'Logo must be an image' });
    }

    const { companyId } = requestScope(req);
    const current = await loadCompany(companyId);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const storageKey = `${companyId}/${req.file.filename}`;

    if (current.logo_storage_key && current.logo_storage_key !== storageKey) {
      try {
        const filePath = absoluteUploadPath(current.logo_storage_key);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }

    const result = await pool.query(
      `
      UPDATE companies
      SET logo_storage_key = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, slug, palette_id, mark_id, logo_storage_key
      `,
      [companyId, storageKey]
    );

    res.status(201).json({ ok: true, company: publicCompany(result.rows[0]) });
  })
);
