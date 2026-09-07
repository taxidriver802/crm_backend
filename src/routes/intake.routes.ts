import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import { publicIntakeSubmitSchema } from '../validators/intake.schemas';
import { checkIntakeRateLimit } from '../lib/intakeRateLimit';
import * as intakeService from '../services/intake.service';

export const intakeRouter = Router();
export const publicIntakeRouter = Router();

intakeRouter.use(requireAuth);
intakeRouter.use(requireRole('owner', 'admin'));

intakeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = await intakeService.getIntakeStatus(req.user!.userId);
    res.json({ ok: true, intake: status });
  })
);

intakeRouter.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const result = await intakeService.generateIntakeToken(req.user!.userId);
    res.status(201).json({ ok: true, ...result });
  })
);

intakeRouter.post(
  '/regenerate',
  asyncHandler(async (req, res) => {
    const result = await intakeService.regenerateIntakeToken(req.user!.userId);
    res.json({ ok: true, ...result });
  })
);

intakeRouter.post(
  '/enable',
  asyncHandler(async (req, res) => {
    try {
      const result = await intakeService.enableIntakeToken(req.user!.userId);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof intakeService.IntakeTokenNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

intakeRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const result = await intakeService.disableIntakeToken(req.user!.userId);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof intakeService.IntakeTokenNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

publicIntakeRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : null) ||
      req.ip ||
      'unknown';

    const rate = checkIntakeRateLimit(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec || 60));
      return res.status(429).json({
        ok: false,
        error: 'Too many requests. Please try again later.',
      });
    }

    const parsed = publicIntakeSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Unable to submit',
      });
    }

    try {
      const result = await intakeService.submitPublicIntake(token, parsed.data);
      return res.status(201).json({
        ok: true,
        ignored: Boolean(result.ignored),
      });
    } catch (error) {
      if (
        error instanceof intakeService.IntakeTokenNotFoundError ||
        error instanceof intakeService.IntakeDisabledError
      ) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      console.error('Public intake submit failed:', error);
      return res.status(400).json({ ok: false, error: 'Unable to submit' });
    }
  })
);
