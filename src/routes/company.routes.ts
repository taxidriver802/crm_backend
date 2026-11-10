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
import { removeUploadedLogo } from '../lib/companyLogo';

export const companyRouter = Router();

/**
 * Logos are raster images only. A logo is served publicly on the app's own
 * origin, and an SVG can carry script, so SVG (and GIF, which mail clients
 * and the brand tile do not need) are refused. The type is read from the
 * file's first bytes; the type the browser declared is not trusted.
 */
const LOGO_REFUSED =
  'Logo must be a PNG, JPEG or WebP image. SVG and GIF are not accepted.';

function sniffLogoType(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(12);
    const read = fs.readSync(fd, head, 0, 12, 0);
    const bytes = head.subarray(0, read);
    if (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

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
      removeUploadedLogo(current.logo_storage_key);
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
    if (!sniffLogoType(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore
      }
      return res.status(400).json({ ok: false, error: LOGO_REFUSED });
    }

    const { companyId } = requestScope(req);
    const current = await loadCompany(companyId);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const storageKey = `${companyId}/${req.file.filename}`;

    if (current.logo_storage_key && current.logo_storage_key !== storageKey) {
      removeUploadedLogo(current.logo_storage_key);
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
