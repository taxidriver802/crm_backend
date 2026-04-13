import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createTaskSchema,
  updateTaskSchema,
} from '../validators/tasks.schemas';
import * as tasksService from '../services/tasks.service';
import type { TaskDuePreset } from '../services/tasks.service';

export const tasksRouter = Router();

function canViewAll(role?: string) {
  return role === 'owner' || role === 'admin';
}

function parseDuePresetQuery(
  query: Record<string, unknown>
): TaskDuePreset | undefined {
  const raw = typeof query.duePreset === 'string' ? query.duePreset.trim() : '';
  if (raw === 'overdue' || raw === 'due_today' || raw === 'next_7_days') {
    return raw;
  }

  const due = typeof query.due === 'string' ? query.due.trim() : '';
  if (due === 'overdue') return 'overdue';
  if (due === 'today') return 'due_today';

  const range = typeof query.range === 'string' ? query.range.trim() : '';
  if (range === '7') return 'next_7_days';

  return undefined;
}

tasksRouter.use(requireAuth);

// GET /tasks/summary
tasksRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const includeAll = req.query.view === 'all' && canViewAll(req.user?.role);
    const summary = await tasksService.getTaskSummary(userId, { includeAll });

    res.json({ ok: true, ...summary });
  })
);

// GET /tasks?status=Pending&dueBefore=...&duePreset=overdue|due_today|next_7_days&due=today&range=7&leadId=2&limit=50&offset=0
tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const role = req.user?.role;
    const includeAll = req.query.view === 'all' && canViewAll(role);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const dueBefore =
      typeof req.query.dueBefore === 'string' ? req.query.dueBefore : undefined;
    const dateFrom =
      typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo =
      typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
    const leadId =
      typeof req.query.leadId === 'string'
        ? Number(req.query.leadId)
        : undefined;
    const jobId =
      typeof req.query.jobId === 'string' ? Number(req.query.jobId) : undefined;

    const linkedTo =
      typeof req.query.linkedTo === 'string' ? req.query.linkedTo : undefined;
    const assignedTo =
      typeof req.query.assignedTo === 'string'
        ? req.query.assignedTo
        : undefined;

    const duePreset = parseDuePresetQuery(req.query as Record<string, unknown>);

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const tasks = await tasksService.getTasks(userId, {
      status,
      leadId,
      jobId,
      dueBefore,
      dateFrom,
      dateTo,
      duePreset,
      q,
      linkedTo,
      assignedTo,
      includeAll,
      limit,
      offset,
    });

    res.json({ ok: true, tasks });
  })
);

// POST /tasks
tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const role = req.user?.role;

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const task = await tasksService.createTask(userId, parsed.data, { role });
      res.status(201).json({ ok: true, task });
    } catch (error) {
      if (error instanceof tasksService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof tasksService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof tasksService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof tasksService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// GET /tasks/:id
tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const includeAll = canViewAll(req.user?.role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const task = await tasksService.getTaskById(userId, id, { includeAll });
      res.json({ ok: true, task });
    } catch (error) {
      if (error instanceof tasksService.TaskNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// PATCH /tasks/:id
tasksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const role = req.user?.role;
    const includeAll = canViewAll(role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const task = await tasksService.updateTask(userId, id, parsed.data, {
        includeAll,
        actorRole: role,
      });

      res.json({ ok: true, task });
    } catch (error) {
      if (error instanceof tasksService.TaskNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof tasksService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof tasksService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof tasksService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof tasksService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// DELETE /tasks/:id
tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const includeAll = canViewAll(req.user?.role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await tasksService.deleteTask(userId, id, {
        includeAll,
      });
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof tasksService.TaskNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
