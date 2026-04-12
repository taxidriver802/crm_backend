import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getAbcIntegrationStatus,
  searchAbcAccounts,
  searchAbcItems,
  getAbcBranches,
  getAbcInvoicesHistory,
  createAbcOrder,
} from '../integrations/abc/abc.service';
import {
  abcSearchAccountsSchema,
  abcSearchItemsSchema,
  abcCreateOrderSchema,
  abcInvoicesHistoryQuerySchema,
} from '../integrations/abc/abc.schemas';

export const abcRouter = Router();

abcRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      integration: getAbcIntegrationStatus(),
    });
  })
);

/** Sample item search for pricing connectivity (Phase 9.5 MVP). */
abcRouter.get(
  '/pricing-sample',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q =
      typeof req.query.q === 'string' && req.query.q.trim()
        ? req.query.q.trim()
        : 'roof';
    try {
      const data = await searchAbcItems({ query: q });
      res.json({ ok: true, query: q, data });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'ABC pricing request failed';
      res.status(502).json({ ok: false, error: message });
    }
  })
);

abcRouter.post(
  '/search/accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = abcSearchAccountsSchema.parse(req.body);
    const data = await searchAbcAccounts(input);
    res.json({ ok: true, data });
  })
);

abcRouter.post(
  '/search/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = abcSearchItemsSchema.parse(req.body);
    const data = await searchAbcItems(input);
    res.json({ ok: true, data });
  })
);

abcRouter.get(
  '/branches',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const data = await getAbcBranches();
    res.json({ ok: true, data });
  })
);

abcRouter.get(
  '/invoices/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { billToAccount } = abcInvoicesHistoryQuerySchema.parse(req.query);
    const data = await getAbcInvoicesHistory(billToAccount);
    res.json({ ok: true, data });
  })
);

abcRouter.post(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = abcCreateOrderSchema.parse(req.body);
    const data = await createAbcOrder(input);
    res.json({ ok: true, data });
  })
);
