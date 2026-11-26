import fs from 'fs';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as exportsService from '../services/companyExport.service';

/**
 * The owner's exports (PLAN_operator.md §3). Owner only. Reachable while
 * the company is suspended (read-only) and pending deletion (no other
 * access): src/middleware/auth.ts lets this mount through.
 */
export const companyExportRouter = Router();
companyExportRouter.use(requireAuth);

function owner(req: any) {
  return { userId: req.user.userId, role: req.user.role, companyId: req.user.companyId };
}

function handle(run: (req: any, res: any) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await run(req, res);
    } catch (error) {
      if (error instanceof exportsService.ExportError) {
        return res.status(error.status).json({ ok: false, error: error.message });
      }
      throw error;
    }
  });
}

// GET /company-export
companyExportRouter.get(
  '/',
  handle(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ ok: false, error: 'Only the company’s owner can export its data.' });
    }
    res.json({ ok: true, exports: await exportsService.listExports(req.user.companyId) });
  })
);

// POST /company-export  — the owner exports now
companyExportRouter.post(
  '/',
  handle(async (req, res) => {
    res.status(201).json({ ok: true, export: await exportsService.requestSelfServe(owner(req)) });
  })
);

// POST /company-export/final  { password } — while pending deletion
companyExportRouter.post(
  '/final',
  handle(async (req, res) => {
    const exp = await exportsService.requestFinal(owner(req), req.body?.password);
    res.status(201).json({ ok: true, export: exp });
  })
);

// GET /company-export/:id/download
companyExportRouter.get(
  '/:id/download',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ ok: false, error: 'Export not found' });
    const { file, filename } = await exportsService.openDownload(owner(req), id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  })
);
