import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as estimatesService from '../services/estimates.service';

export const estimatesRouter = Router();

function parseId(value: string | string[] | undefined) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized == null || normalized === '') return null;
  const id = Number(normalized);
  return Number.isFinite(id) ? id : null;
}

function parseOptionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized == null || normalized === '') return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function parseString(value: unknown) {
  if (typeof value === 'string') return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  ) {
    return value[0];
  }
  return undefined;
}

function parseEstimateStatus(
  value: unknown
): 'Draft' | 'Sent' | 'Approved' | 'Rejected' | undefined {
  const stringValue = parseString(value);
  return isEstimateStatus(stringValue) ? stringValue : undefined;
}

function parseLineItemSource(
  value: unknown
): 'manual' | 'abc_supply' | undefined {
  const stringValue = parseString(value);
  return isLineItemSource(stringValue) ? stringValue : undefined;
}

function isEstimateStatus(
  value: unknown
): value is 'Draft' | 'Sent' | 'Approved' | 'Rejected' {
  return (
    value === 'Draft' ||
    value === 'Sent' ||
    value === 'Approved' ||
    value === 'Rejected'
  );
}

function isLineItemSource(value: unknown): value is 'manual' | 'abc_supply' {
  return value === 'manual' || value === 'abc_supply';
}

estimatesRouter.use(requireAuth);

// GET /estimates/job/:jobId
estimatesRouter.get(
  '/job/:jobId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = parseId(req.params.jobId);

    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    try {
      const estimates = await estimatesService.getEstimatesByJobId(
        userId,
        jobId
      );
      res.json({ ok: true, estimates });
    } catch (error) {
      if (error instanceof estimatesService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /estimates
estimatesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = parseOptionalNumber(req.body.job_id);

    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'job_id is required' });
    }

    const title = parseString(req.body.title);
    if (!title) {
      return res.status(400).json({ ok: false, error: 'title is required' });
    }

    const status = parseEstimateStatus(req.body.status);
    if (req.body.status && !status) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    try {
      const estimate = await estimatesService.createEstimate(userId, {
        job_id: jobId,
        title: title.trim(),
        status,
        notes: parseString(req.body.notes) ?? null,
      });

      res.status(201).json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /estimates/:id
estimatesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);

    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    try {
      const estimate = await estimatesService.getEstimateById(userId, id);
      res.json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /estimates/:id
estimatesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);

    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    const status = parseEstimateStatus(req.body.status);
    if (req.body.status && !status) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    try {
      const estimate = await estimatesService.updateEstimate(userId, id, {
        title: parseString(req.body.title)?.trim(),
        status,
        notes: req.body.notes === null ? null : parseString(req.body.notes),
        job_id:
          req.body.job_id === null
            ? null
            : parseOptionalNumber(req.body.job_id),
      });

      res.json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof estimatesService.EstimateOwnershipError) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// DELETE /estimates/:id
estimatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);

    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    try {
      const deletedId = await estimatesService.deleteEstimate(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);


// POST /estimates/:id/line-items
estimatesRouter.post(
  '/:id/line-items',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const estimateId = parseId(req.params.id);

    if (estimateId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    const name = parseString(req.body.name);
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    const source = parseLineItemSource(req.body.source);
    if (req.body.source && !source) {
      return res.status(400).json({ ok: false, error: 'Invalid source' });
    }

    try {
      const estimate = await estimatesService.addEstimateLineItem(
        userId,
        estimateId,
        {
          name: name.trim(),
          description: parseString(req.body.description) ?? null,
          quantity: req.body.quantity,
          unit_price: req.body.unit_price,
          sort_order: parseOptionalNumber(req.body.sort_order),
          source,
        }
      );

      res.status(201).json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /estimates/:id/line-items/:lineItemId
estimatesRouter.patch(
  '/:id/line-items/:lineItemId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const estimateId = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);

    if (estimateId == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const source = parseLineItemSource(req.body.source);
    if (req.body.source && !source) {
      return res.status(400).json({ ok: false, error: 'Invalid source' });
    }

    try {
      const estimate = await estimatesService.updateEstimateLineItem(
        userId,
        estimateId,
        lineItemId,
        {
          name: parseString(req.body.name)?.trim(),
          description:
            req.body.description === null
              ? null
              : parseString(req.body.description),
          quantity: req.body.quantity,
          unit_price: req.body.unit_price,
          sort_order: parseOptionalNumber(req.body.sort_order),
          source,
        }
      );

      res.json({ ok: true, estimate });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof estimatesService.EstimateLineItemNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);

// DELETE /estimates/:id/line-items/:lineItemId
estimatesRouter.delete(
  '/:id/line-items/:lineItemId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const estimateId = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);

    if (estimateId == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await estimatesService.deleteEstimateLineItem(
        userId,
        estimateId,
        lineItemId
      );

      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof estimatesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      if (error instanceof estimatesService.EstimateLineItemNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }

      throw error;
    }
  })
);
