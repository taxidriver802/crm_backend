import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as reportsService from '../services/reports.service';
import { requestScope } from '../lib/tenant';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get(
  '/lead-funnel',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const data = await reportsService.getLeadFunnel(userId, {
      includeAll,
      companyId,
    });
    res.json({ ok: true, data });
  })
);

reportsRouter.get(
  '/estimate-outcomes',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const data = await reportsService.getEstimateOutcomes(userId, {
      includeAll,
      companyId,
    });
    res.json({ ok: true, ...data });
  })
);

reportsRouter.get(
  '/job-pipeline',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const data = await reportsService.getJobPipeline(userId, {
      includeAll,
      companyId,
    });
    res.json({ ok: true, data });
  })
);

reportsRouter.get(
  '/trends',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const period =
      typeof req.query.period === 'string' ? req.query.period : 'monthly';

    if (period !== 'monthly') {
      return res.status(400).json({ ok: false, error: 'Unsupported period' });
    }

    const data = await reportsService.getMonthlyTrends(userId, {
      includeAll,
      companyId,
    });
    res.json({ ok: true, ...data });
  })
);
