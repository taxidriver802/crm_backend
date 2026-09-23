import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createLeadSchema,
  updateLeadSchema,
} from '../validators/leads.schemas';
import * as leadsService from '../services/leads.service';
import { requestScope } from '../lib/tenant';

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

function viewAllRequested(req: { query: { view?: unknown } }) {
  return req.query.view === 'all';
}

// GET /leads/summary
leadsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(
      req,
      viewAllRequested(req)
    );
    const summary = await leadsService.getLeadSummary(userId, {
      includeAll,
      companyId,
    });

    res.json({
      ok: true,
      ...summary,
    });
  })
);

// GET /leads?status=New&q=john&limit=50&offset=0
leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(
      req,
      viewAllRequested(req)
    );

    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const assignedTo =
      typeof req.query.assignedTo === 'string'
        ? req.query.assignedTo
        : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const leads = await leadsService.getLeads(userId, {
      status,
      assignedTo,
      q,
      includeAll,
      companyId,
      limit,
      offset,
    });

    res.json({ ok: true, leads });
  })
);

// GET /leads/:id
leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const lead = await leadsService.getLeadById(userId, id, {
        includeAll,
        companyId,
      });
      res.json({ ok: true, lead });
    } catch (error) {
      if (error instanceof leadsService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// DELETE /leads/:id
leadsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await leadsService.deleteLead(userId, id, {
        includeAll,
        companyId,
      });
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof leadsService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// POST /leads
leadsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, companyId } = requestScope(req);
    const role = req.user?.role;

    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const lead = await leadsService.createLead(userId, parsed.data, {
        role,
        companyId,
      });
      res.status(201).json({ ok: true, lead });
    } catch (error) {
      if (error instanceof leadsService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof leadsService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /leads/:id
leadsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const role = req.user?.role;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const lead = await leadsService.updateLead(userId, id, parsed.data, {
        includeAll,
        actorRole: role,
        companyId,
      });

      if (!lead) {
        return res
          .status(400)
          .json({ ok: false, error: 'No fields to update' });
      }

      res.json({ ok: true, lead });
    } catch (error) {
      if (error instanceof leadsService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof leadsService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof leadsService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
