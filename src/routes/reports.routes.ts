import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as reportsService from '../services/reports.service';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get(
  '/lead-funnel',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const data = await reportsService.getLeadFunnel(userId);
    res.json({ ok: true, data });
  })
);

reportsRouter.get(
  '/estimate-outcomes',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const data = await reportsService.getEstimateOutcomes(userId);
    res.json({ ok: true, ...data });
  })
);

reportsRouter.get(
  '/job-pipeline',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const data = await reportsService.getJobPipeline(userId);
    res.json({ ok: true, data });
  })
);

reportsRouter.get(
  '/trends',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const period =
      typeof req.query.period === 'string' ? req.query.period : 'monthly';

    if (period !== 'monthly') {
      return res.status(400).json({ ok: false, error: 'Unsupported period' });
    }

    const data = await reportsService.getMonthlyTrends(userId);
    res.json({ ok: true, ...data });
  })
);
