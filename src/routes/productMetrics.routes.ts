import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import * as events from '../services/productEvents.service';
import { requestScope } from '../lib/tenant';

export const productMetricsRouter = Router();

productMetricsRouter.use(requireAuth);
productMetricsRouter.use(requireRole('owner', 'admin'));

productMetricsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    const { companyId } = requestScope(req);
    const [counts, funnel, automation] = await Promise.all([
      events.getEventCounts(days, companyId),
      events.getConversionFunnel(days, companyId),
      events.getAutomationStats(days, companyId),
    ]);
    res.json({ ok: true, days, counts, funnel, automation });
  })
);

productMetricsRouter.get(
  '/timeline/:eventName',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    const { companyId } = requestScope(req);
    const eventName = Array.isArray(req.params.eventName) ? req.params.eventName[0] : req.params.eventName;
    const timeline = await events.getEventTimeline(eventName, days, companyId);
    res.json({ ok: true, event_name: eventName, days, timeline });
  })
);
