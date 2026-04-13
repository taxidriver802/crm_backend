import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { createJobSchema, updateJobSchema } from '../validators/jobs.schemas';
import * as jobsService from '../services/jobs.service';
import * as tasksService from '../services/tasks.service';
import * as activityService from '../services/jobActivity.service';
import * as jobMeasurementsService from '../services/jobMeasurements.service';

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

function canViewAll(role?: string) {
  return role === 'owner' || role === 'admin';
}

// GET /jobs?status=New&q=roof&limit=50&offset=0
jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const includeAll = req.query.view === 'all' && canViewAll(req.user?.role);

    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const assignedTo =
      typeof req.query.assignedTo === 'string'
        ? req.query.assignedTo
        : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const jobs = await jobsService.getJobs(userId, {
      status,
      assignedTo,
      q,
      includeAll,
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
    const role = req.user?.role;

    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const job = await jobsService.createJob(userId, parsed.data, { role });
      res.status(201).json({ ok: true, job });
    } catch (error) {
      if (error instanceof jobsService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof jobsService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /jobs/:id
jobsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const includeAll = canViewAll(req.user?.role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const job = await jobsService.getJobById(userId, id, { includeAll });
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
    const includeAll = canViewAll(req.user?.role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const tasks = await tasksService.getTasksByJobId(userId, id, {
        includeAll,
      });
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
    const role = req.user?.role;
    const includeAll = canViewAll(role);
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

    res.json({
      ok: true,
      activity: result.activity,
      hasMore: result.hasMore,
    });
  })
);

// GET /jobs/:id/measurements
jobsRouter.get(
  '/:id/measurements',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const measurements = await jobMeasurementsService.listJobMeasurements(
        userId,
        id
      );
      res.json({ ok: true, measurements });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /jobs/:id/measurements
jobsRouter.post(
  '/:id/measurements',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const label =
      typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) {
      return res.status(400).json({ ok: false, error: 'label is required' });
    }

    const value = Number(req.body?.value);
    if (!Number.isFinite(value)) {
      return res
        .status(400)
        .json({ ok: false, error: 'value must be a number' });
    }

    const unit = typeof req.body?.unit === 'string' ? req.body.unit.trim() : '';
    const sort_order =
      req.body?.sort_order != null ? Number(req.body.sort_order) : 0;

    try {
      const measurement = await jobMeasurementsService.createJobMeasurement(
        userId,
        id,
        {
          label,
          value,
          unit,
          sort_order: Number.isFinite(sort_order) ? sort_order : 0,
        }
      );
      res.status(201).json({ ok: true, measurement });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /jobs/:id/measurements/:measurementId
jobsRouter.patch(
  '/:id/measurements/:measurementId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    const measurementId = Number(req.params.measurementId);

    if (!Number.isFinite(id) || !Number.isFinite(measurementId)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const updates: {
      label?: string;
      value?: number;
      unit?: string;
      sort_order?: number;
    } = {};

    if (req.body?.label !== undefined) {
      if (typeof req.body.label !== 'string' || !req.body.label.trim()) {
        return res.status(400).json({ ok: false, error: 'Invalid label' });
      }
      updates.label = req.body.label;
    }
    if (req.body?.value !== undefined) {
      const value = Number(req.body.value);
      if (!Number.isFinite(value)) {
        return res.status(400).json({ ok: false, error: 'Invalid value' });
      }
      updates.value = value;
    }
    if (req.body?.unit !== undefined) {
      updates.unit = typeof req.body.unit === 'string' ? req.body.unit : '';
    }
    if (req.body?.sort_order !== undefined) {
      const so = Number(req.body.sort_order);
      updates.sort_order = Number.isFinite(so) ? so : 0;
    }

    try {
      const measurement = await jobMeasurementsService.updateJobMeasurement(
        userId,
        id,
        measurementId,
        updates
      );
      res.json({ ok: true, measurement });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof jobMeasurementsService.MeasurementNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /jobs/:id/measurements/:measurementId
jobsRouter.delete(
  '/:id/measurements/:measurementId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    const measurementId = Number(req.params.measurementId);

    if (!Number.isFinite(id) || !Number.isFinite(measurementId)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await jobMeasurementsService.deleteJobMeasurement(
        userId,
        id,
        measurementId
      );
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof jobMeasurementsService.MeasurementNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /jobs/:id
jobsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const role = req.user?.role;
    const includeAll = canViewAll(role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const parsed = updateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const job = await jobsService.updateJob(userId, id, parsed.data, {
        includeAll,
        actorRole: role,
      });

      res.json({ ok: true, job });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof jobsService.AssigneeNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof jobsService.AssignmentPermissionError) {
        return res.status(403).json({ ok: false, error: error.message });
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
    const includeAll = canViewAll(req.user?.role);
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await jobsService.deleteJob(userId, id, { includeAll });
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof jobsService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
