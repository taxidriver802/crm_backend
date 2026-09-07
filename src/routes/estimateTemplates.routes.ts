import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createEstimateTemplateSchema,
  updateEstimateTemplateSchema,
  createTemplateLineItemSchema,
  updateTemplateLineItemSchema,
} from '../validators/estimateTemplates.schemas';
import * as templatesService from '../services/estimateTemplates.service';

export const estimateTemplatesRouter = Router();

estimateTemplatesRouter.use(requireAuth);

function parseId(value: string | string[] | undefined) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized == null || normalized === '') return null;
  const id = Number(normalized);
  return Number.isFinite(id) ? id : null;
}

function handleTemplateError(res: any, error: unknown) {
  if (error instanceof templatesService.EstimateTemplateNotFoundError) {
    return res.status(404).json({ ok: false, error: error.message });
  }
  if (error instanceof templatesService.EstimateTemplateLineItemNotFoundError) {
    return res.status(404).json({ ok: false, error: error.message });
  }
  if (error instanceof templatesService.EstimateTemplateNameTakenError) {
    return res.status(409).json({ ok: false, error: error.message });
  }
  throw error;
}

estimateTemplatesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await templatesService.listEstimateTemplates();
    res.json({ ok: true, templates });
  })
);

estimateTemplatesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const template = await templatesService.getEstimateTemplateById(id);
      res.json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.post(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const parsed = createEstimateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    try {
      const template = await templatesService.createEstimateTemplate(parsed.data);
      res.status(201).json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.patch(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    const parsed = updateEstimateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    try {
      const template = await templatesService.updateEstimateTemplate(
        id,
        parsed.data
      );
      res.json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.delete(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const deletedId = await templatesService.deleteEstimateTemplate(id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.post(
  '/:id/line-items',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    const parsed = createTemplateLineItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    try {
      const template = await templatesService.addTemplateLineItem(id, parsed.data);
      res.status(201).json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.patch(
  '/:id/line-items/:lineItemId',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);
    if (id == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    const parsed = updateTemplateLineItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    try {
      const template = await templatesService.updateTemplateLineItem(
        id,
        lineItemId,
        parsed.data
      );
      res.json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);

estimateTemplatesRouter.delete(
  '/:id/line-items/:lineItemId',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);
    if (id == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const template = await templatesService.deleteTemplateLineItem(
        id,
        lineItemId
      );
      res.json({ ok: true, template });
    } catch (error) {
      handleTemplateError(res, error);
    }
  })
);
