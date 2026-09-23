import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { COMPANY_SLUG_RE, publicCompanyBranding } from '../lib/companySlug';
import { absoluteUploadPath } from '../services/files.service';

export const publicCompaniesRouter = Router();

const COMPANY_SELECT = `
  SELECT id, name, slug, palette_id, mark_id, logo_storage_key
  FROM companies
`;

publicCompaniesRouter.get(
  '/:slug/logo',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!COMPANY_SLUG_RE.test(slug)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const result = await pool.query(
      `${COMPANY_SELECT} WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    const row = result.rows[0];
    if (!row?.logo_storage_key) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    try {
      const filePath = absoluteUploadPath(row.logo_storage_key);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      res.sendFile(filePath);
    } catch {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
  })
);

publicCompaniesRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!COMPANY_SLUG_RE.test(slug)) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const result = await pool.query(
      `${COMPANY_SELECT} WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({
      ok: true,
      company: publicCompanyBranding(result.rows[0]),
    });
  })
);
