import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { searchWorkspace } from '../services/search.service';

export const searchRouter = Router();

searchRouter.use(requireAuth);

// GET /search?q=term
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ ok: true, leads: [], jobs: [], tasks: [] });
    }

    const results = await searchWorkspace(req.user!.userId, q, 5);
    return res.json({ ok: true, ...results });
  })
);
