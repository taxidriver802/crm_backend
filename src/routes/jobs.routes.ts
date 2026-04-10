import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { createJobSchema, updateJobSchema } from '../validators/jobs.schemas';
import * as jobsService from '../services/jobs.service';
import * as tasksService from '../services/tasks.service';
import * as activityService from '../services/jobActivity.service';

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

// GET /jobs?status=New&q=roof&limit=50&offset=0
jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const jobs = await jobsService.getJobs(userId, {
      status,
      q,
      limit,
      offset,
    });

    res.json({ ok: true, jobs });
  })
);

// POST /jobs
jobsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const job = await jobsService.createJob(userId, parsed.data);

    res.status(201).json({ ok: true, job });
  })
);

// GET /jobs/:id
jobsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const job = await jobsService.getJobById(userId, id);
      res.json({ ok: true, job });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// GET /jobs/:id/tasks
jobsRouter.get(
  '/:id/tasks',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const tasks = await tasksService.getTasksByJobId(userId, id);
      res.json({ ok: true, tasks });
    } catch (error) {
      if (
        error instanceof tasksService.JobNotFoundError ||
        error instanceof jobsService.JobNotFoundError
      ) {
        return res.status(404).json({ ok: false, error: 'Job not found' });
      }

      throw error;
    }
  })
);

// GET /jobs/:id/activity
jobsRouter.get(
  '/:id/activity',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    let limit = parseInt(req.query.limit as string, 10);
    if (isNaN(limit) || limit <= 0) {
      limit = 50;
    }

    const result = await activityService.getJobActivitiesByJob(
      userId,
      id,
      limit
    );

    res.json({ ok: true, result });
  })
);

// PATCH /jobs/:id
jobsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const job = await jobsService.updateJob(userId, id, parsed.data);

      res.json({ ok: true, job });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// DELETE /jobs/:id
jobsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await jobsService.deleteJob(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
