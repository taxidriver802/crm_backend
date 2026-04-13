import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import * as automationService from '../services/automation.service';

export const automationRouter = Router();

automationRouter.use(requireAuth);
automationRouter.use(requireRole('owner', 'admin'));

function parseId(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const id = Number(v);
  return Number.isFinite(id) ? id : null;
}

// GET /automation/templates
automationRouter.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, templates: automationService.RULE_TEMPLATES });
  })
);

// GET /automation/rules
automationRouter.get(
  '/rules',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const rules = await automationService.listRules(userId);
    res.json({ ok: true, rules });
  })
);

// GET /automation/rules/:id
automationRouter.get(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const rule = await automationService.getRuleById(userId, id);
      res.json({ ok: true, rule });
    } catch (error) {
      if (error instanceof automationService.AutomationRuleNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /automation/rules
automationRouter.post(
  '/rules',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const {
      name,
      description,
      trigger_event,
      conditions,
      action_type,
      action_config,
      enabled,
    } = req.body;

    if (!name || !trigger_event || !action_type) {
      return res.status(400).json({
        ok: false,
        error: 'name, trigger_event, and action_type are required',
      });
    }

    const rule = await automationService.createRule(userId, {
      name,
      description,
      trigger_event,
      conditions,
      action_type,
      action_config,
      enabled,
    });
    res.status(201).json({ ok: true, rule });
  })
);

// POST /automation/rules/from-template/:templateId
automationRouter.post(
  '/rules/from-template/:templateId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const templateId = req.params.templateId;
    const template = automationService.RULE_TEMPLATES.find(
      (t) => t.template_id === templateId
    );

    if (!template) {
      return res.status(404).json({ ok: false, error: 'Template not found' });
    }

    const rule = await automationService.createRule(userId, {
      name: template.name,
      description: template.description,
      trigger_event: template.trigger_event,
      conditions: template.conditions,
      action_type: template.action_type,
      action_config: template.action_config,
    });
    res.status(201).json({ ok: true, rule });
  })
);

// PATCH /automation/rules/:id
automationRouter.patch(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const rule = await automationService.updateRule(userId, id, req.body);
      res.json({ ok: true, rule });
    } catch (error) {
      if (error instanceof automationService.AutomationRuleNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /automation/rules/:id
automationRouter.delete(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const deletedId = await automationService.deleteRule(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof automationService.AutomationRuleNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /automation/evaluate (manual trigger for testing)
automationRouter.post(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const { trigger_event, context } = req.body;

    if (!trigger_event) {
      return res
        .status(400)
        .json({ ok: false, error: 'trigger_event is required' });
    }

    const executed = await automationService.evaluateRules(
      userId,
      trigger_event,
      context || {}
    );
    res.json({ ok: true, executed_rules: executed });
  })
);
