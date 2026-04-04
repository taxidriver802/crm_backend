import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createTaskSchema,
  updateTaskSchema,
} from '../validators/tasks.schemas';
import * as tasksService from '../services/tasks.service';

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

// GET /tasks/summary
tasksRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const summary = await tasksService.getTaskSummary(userId);

    res.json({ ok: true, ...summary });
  })
);

// GET /tasks?status=Pending&dueBefore=...&leadId=2&limit=50&offset=0
tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const dueBefore =
      typeof req.query.dueBefore === 'string' ? req.query.dueBefore : undefined;
    const leadId =
      typeof req.query.leadId === 'string'
        ? Number(req.query.leadId)
        : undefined;
    const jobId =
      typeof req.query.jobId === 'string' ? Number(req.query.jobId) : undefined;

    const linkedTo =
      typeof req.query.linkedTo === 'string' ? req.query.linkedTo : undefined;

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const tasks = await tasksService.getTasks(userId, {
      status,
      leadId,
      jobId,
      dueBefore,
      q,
      linkedTo,
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

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const task = await tasksService.createTask(userId, parsed.data);
      res.status(201).json({ ok: true, task });
    } catch (error) {
      if (error instanceof tasksService.LeadNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof tasksService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
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
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const task = await tasksService.getTaskById(userId, id);
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
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const task = await tasksService.updateTask(userId, id, parsed.data);

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

      throw error;
    }
  })
);

// DELETE /tasks/:id
tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await tasksService.deleteTask(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof tasksService.TaskNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
