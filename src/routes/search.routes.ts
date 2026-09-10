import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { searchWorkspace } from '../services/search.service';

export const searchRouter = Router();

searchRouter.use(requireAuth);

const EMPTY_SEARCH = {
  leads: [],
  jobs: [],
  tasks: [],
  invoices: [],
  estimates: [],
  files: [],
  users: [],
  related: {
    leads: [],
    jobs: [],
    tasks: [],
    invoices: [],
    estimates: [],
    files: [],
    users: [],
  },
};

function parseTypes(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function parseContextType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['lead', 'job', 'task', 'invoice', 'estimate'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function parseContextId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

// GET /search?q=term&types=leads,jobs&status=New&assigned=me&contextType=job&contextId=12
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const types = parseTypes(req.query.types);
    const status =
      typeof req.query.status === 'string' && req.query.status.trim()
        ? req.query.status.trim()
        : null;
    const assigned =
      typeof req.query.assigned === 'string' && req.query.assigned.trim()
        ? req.query.assigned.trim().toLowerCase()
        : null;
    const contextType = parseContextType(req.query.contextType);
    const contextId = parseContextId(req.query.contextId);

    const hasFilters = types.length > 0 || Boolean(status) || Boolean(assigned);
    const hasContext = Boolean(contextType && contextId);
    if (!q && !hasFilters && !hasContext) {
      return res.json({ ok: true, ...EMPTY_SEARCH });
    }

    const role = req.user?.role;
    const includeUsers = role === 'owner' || role === 'admin';

    const results = await searchWorkspace(req.user!.userId, q, 5, {
      includeUsers,
      types,
      status,
      assigned,
      contextType,
      contextId,
    });
    return res.json({ ok: true, ...results });
  })
);
