import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { canRead, loadGuide, summarize } from '../lib/helpGuide';

/**
 * Help: the user guide, served as articles to signed-in staff. Each person
 * gets only the articles their role can act on; asking for another one is
 * answered as if it did not exist, so search, links and a typed URL all
 * agree.
 */
export const helpRouter = Router();

helpRouter.use(requireAuth);

helpRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const role = req.user?.role;
    const articles = loadGuide()
      .articles.filter((article) => canRead(article, role))
      .map(summarize);
    res.json({ ok: true, articles });
  })
);

helpRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '');
    const article = loadGuide().articles.find((a) => a.id === id);
    if (!article || !canRead(article, req.user?.role)) {
      return res.status(404).json({ ok: false, error: 'No help article by that name.' });
    }
    res.json({ ok: true, article });
  })
);
