import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as dashboardService from '../services/dashboard.service';
import * as activityService from '../services/jobActivity.service';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const data = await dashboardService.getDashboardData(userId);

    res.json({
      ok: true,
      ...data,
    });
  })
);

dashboardRouter.get(
  '/activities',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const data = await activityService.getJobActivitiesByUser(userId);

    res.json({ ok: true, activity: data });
  })
);
