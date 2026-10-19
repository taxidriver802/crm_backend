import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as reportsService from '../services/reports.service';
import { canViewAll, requestScope } from '../lib/tenant';

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

const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

reportsRouter.get(
  '/team',
  asyncHandler(async (req, res) => {
    if (!canViewAll(req.user?.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    }

    const windowDays = reportsService.parsePerformanceWindow(req.query.window);
    if (!windowDays) {
      return res.status(400).json({ ok: false, error: 'Unsupported window' });
    }

    const { companyId } = requestScope(req);
    const data = await reportsService.getTeamPerformance(companyId, windowDays);
    res.json({ ok: true, ...data });
  })
);

reportsRouter.get(
  '/team/:userId',
  asyncHandler(async (req, res) => {
    if (!canViewAll(req.user?.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    }

    const rawUserId = req.params.userId;
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    if (!userId || !USER_ID.test(userId)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    const windowDays = reportsService.parsePerformanceWindow(req.query.window);
    if (!windowDays) {
      return res.status(400).json({ ok: false, error: 'Unsupported window' });
    }

    const { companyId } = requestScope(req);
    const data = await reportsService.getUserPerformance(
      companyId,
      userId,
      windowDays
    );
    if (!data) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    res.json({ ok: true, ...data });
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
