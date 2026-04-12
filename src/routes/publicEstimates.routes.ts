import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as estimatesService from '../services/estimates.service';

export const publicEstimatesRouter = Router();

publicEstimatesRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }

    try {
      const estimate = await estimatesService.getEstimateByShareToken(token);
      res.json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.InvalidShareTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

publicEstimatesRouter.get(
  '/:token/pdf',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }

    try {
      const buf = await estimatesService.renderEstimatePdfByShareToken(token);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="estimate.pdf"');
      res.send(buf);
    } catch (error) {
      if (error instanceof estimatesService.InvalidShareTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

publicEstimatesRouter.post(
  '/:token/respond',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }

    const decision = req.body?.decision;
    if (
      decision !== 'approve' &&
      decision !== 'reject' &&
      decision !== 'revision'
    ) {
      return res.status(400).json({ ok: false, error: 'Invalid decision' });
    }

    const note =
      typeof req.body?.note === 'string' && req.body.note.trim()
        ? req.body.note.trim()
        : null;

    try {
      const estimate = await estimatesService.respondToEstimateShare(
        token,
        decision,
        note
      );
      res.json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.InvalidShareTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
