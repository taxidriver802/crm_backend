import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import * as events from '../services/productEvents.service';

export const productMetricsRouter = Router();

productMetricsRouter.use(requireAuth);
productMetricsRouter.use(requireRole('owner', 'admin'));

productMetricsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    const [counts, funnel, automation] = await Promise.all([
      events.getEventCounts(days),
      events.getConversionFunnel(days),
      events.getAutomationStats(days),
    ]);
    res.json({ ok: true, days, counts, funnel, automation });
  })
);

productMetricsRouter.get(
  '/timeline/:eventName',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    const eventName = Array.isArray(req.params.eventName) ? req.params.eventName[0] : req.params.eventName;
    const timeline = await events.getEventTimeline(eventName, days);
    res.json({ ok: true, event_name: eventName, days, timeline });
  })
);
