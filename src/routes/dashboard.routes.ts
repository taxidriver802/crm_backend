import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as dashboardService from '../services/dashboard.service';
import * as activityService from '../services/jobActivity.service';
import { canViewAll, requestScope } from '../lib/tenant';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(
      req,
      req.query.view === 'all'
    );
    const data = await dashboardService.getDashboardData(userId, {
      includeAll,
      companyId,
    });

    res.json({
      ok: true,
      ...data,
    });
  })
);

dashboardRouter.get(
  '/workload',
  asyncHandler(async (req, res) => {
    if (!canViewAll(req.user?.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    }

    const { companyId } = requestScope(req);
    const workload = await dashboardService.getWorkload(companyId);
    res.json({ ok: true, workload });
  })
);

dashboardRouter.get(
  '/activities',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const data = await activityService.getJobActivitiesByUser(userId, {
      includeAll,
      companyId,
    });

    res.json({ ok: true, activity: data });
  })
);
