import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { trackEvent } from './productEvents.service';

export class AutomationRuleNotFoundError extends Error {
  constructor(message = 'Automation rule not found') {
    super(message);
    this.name = 'AutomationRuleNotFoundError';
  }
}

export type TriggerEvent =
  | 'ESTIMATE_APPROVED'
  | 'LEAD_INACTIVE'
  | 'JOB_STATUS_CHANGED'
  | 'TASK_COMPLETED';

export type ActionType =
  | 'CREATE_TASKS'
  | 'CREATE_FOLLOW_UP_TASK'
  | 'SEND_NOTIFICATION'
  | 'UPDATE_STATUS';

export type CreateRuleInput = {
  name: string;
  description?: string | null;
  trigger_event: TriggerEvent;
  conditions?: Record<string, unknown>;
  action_type: ActionType;
  action_config?: Record<string, unknown>;
  enabled?: boolean;
};

export type UpdateRuleInput = Partial<{
  name: string;
  description: string | null;
  trigger_event: TriggerEvent;
  conditions: Record<string, unknown>;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  enabled: boolean;
}>;

function normalizeRule(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    trigger_event: row.trigger_event,
    conditions: row.conditions || {},
    action_type: row.action_type,
    action_config: row.action_config || {},
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listRules(userId: string) {
  const result = await pool.query(
    `SELECT * FROM automation_rules WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(normalizeRule);
}

export async function getRuleById(userId: string, id: number) {
  const result = await pool.query(
    `SELECT * FROM automation_rules WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId]
  );
  if (result.rowCount === 0) throw new AutomationRuleNotFoundError();
  return normalizeRule(result.rows[0]);
}

export async function createRule(userId: string, input: CreateRuleInput) {
  const result = await pool.query(
    `INSERT INTO automation_rules (
       user_id, name, description, trigger_event, conditions, action_type, action_config, enabled
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
     RETURNING *`,
    [
      userId,
      input.name,
      input.description ?? null,
      input.trigger_event,
      JSON.stringify(input.conditions ?? {}),
      input.action_type,
      JSON.stringify(input.action_config ?? {}),
      input.enabled ?? true,
    ]
  );
  return normalizeRule(result.rows[0]);
}

export async function updateRule(
  userId: string,
  id: number,
  updates: UpdateRuleInput
) {
  await getRuleById(userId, id);

  const setParts: string[] = [];
  const values: any[] = [id, userId];

  if ('name' in updates) {
    values.push(updates.name);
    setParts.push(`name = $${values.length}`);
  }
  if ('description' in updates) {
    values.push(updates.description ?? null);
    setParts.push(`description = $${values.length}`);
  }
  if ('trigger_event' in updates) {
    values.push(updates.trigger_event);
    setParts.push(`trigger_event = $${values.length}`);
  }
  if ('conditions' in updates) {
    values.push(JSON.stringify(updates.conditions ?? {}));
    setParts.push(`conditions = $${values.length}::jsonb`);
  }
  if ('action_type' in updates) {
    values.push(updates.action_type);
    setParts.push(`action_type = $${values.length}`);
  }
  if ('action_config' in updates) {
    values.push(JSON.stringify(updates.action_config ?? {}));
    setParts.push(`action_config = $${values.length}::jsonb`);
  }
  if ('enabled' in updates) {
    values.push(updates.enabled);
    setParts.push(`enabled = $${values.length}`);
  }

  if (setParts.length === 0) throw new Error('No fields to update');
  setParts.push('updated_at = CURRENT_TIMESTAMP');

  const result = await pool.query(
    `UPDATE automation_rules SET ${setParts.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
    values
  );
  if (result.rowCount === 0) throw new AutomationRuleNotFoundError();
  return normalizeRule(result.rows[0]);
}

export async function deleteRule(userId: string, id: number) {
  await getRuleById(userId, id);
  const result = await pool.query(
    `DELETE FROM automation_rules WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (result.rowCount === 0) throw new AutomationRuleNotFoundError();
  return result.rows[0].id;
}

// ─── RULE TEMPLATES ────────────────────────────────────

export const RULE_TEMPLATES = [
  {
    template_id: 'estimate_approved_tasks',
    name: 'Auto-create tasks when estimate approved',
    description:
      'When an estimate is approved, automatically create standard tasks on the job.',
    trigger_event: 'ESTIMATE_APPROVED' as TriggerEvent,
    action_type: 'CREATE_TASKS' as ActionType,
    conditions: {},
    action_config: {
      tasks: [
        {
          title: 'Order materials',
          description: 'Based on approved estimate line items',
        },
        { title: 'Schedule crew', description: 'Coordinate team availability' },
        { title: 'Confirm start date with client', description: '' },
      ],
    },
  },
  {
    template_id: 'lead_follow_up',
    name: 'Follow up on inactive leads',
    description:
      'When a lead has no activity for N days, create a follow-up task.',
    trigger_event: 'LEAD_INACTIVE' as TriggerEvent,
    action_type: 'CREATE_FOLLOW_UP_TASK' as ActionType,
    conditions: { inactive_days: 7 },
    action_config: {
      task_title: 'Follow up with {lead_name}',
      task_description: 'This lead has been inactive for {inactive_days} days.',
    },
  },
  {
    template_id: 'job_complete_notify',
    name: 'Notify owner when job completed',
    description:
      'When a job status changes to "Closed Won", send a notification.',
    trigger_event: 'JOB_STATUS_CHANGED' as TriggerEvent,
    action_type: 'SEND_NOTIFICATION' as ActionType,
    conditions: { to_status: 'Closed Won' },
    action_config: {
      title: 'Job completed',
      message: '{job_title} has been marked as Closed Won.',
    },
  },
  {
    template_id: 'task_complete_update',
    name: 'Update job status when all tasks done',
    description:
      'When the last task on a job is completed, optionally advance the job status.',
    trigger_event: 'TASK_COMPLETED' as TriggerEvent,
    action_type: 'SEND_NOTIFICATION' as ActionType,
    conditions: { all_tasks_complete: true },
    action_config: {
      title: 'All tasks done',
      message: 'All tasks on {job_title} are now complete.',
    },
  },
];

// ─── AUTOMATION ENGINE ─────────────────────────────────

export async function evaluateRules(
  userId: string,
  triggerEvent: TriggerEvent,
  context: Record<string, any>
) {
  const result = await pool.query(
    `SELECT * FROM automation_rules
     WHERE user_id = $1 AND trigger_event = $2 AND enabled = true
     ORDER BY id`,
    [userId, triggerEvent]
  );

  const executed: number[] = [];

  for (const row of result.rows) {
    const rule = normalizeRule(row);
    const matched = matchesConditions(rule, context);
    if (!matched) continue;

    try {
      await executeAction(userId, rule, context);
      executed.push(rule.id);
      trackEvent('automation_rule_triggered', {
        userId,
        entityType: 'automation_rule',
        entityId: rule.id,
        metadata: { rule_name: rule.name, trigger_event: triggerEvent },
      });
    } catch (err) {
      console.error(`Automation rule ${rule.id} (${rule.name}) failed:`, err);
    }
  }

  return executed;
}

function matchesConditions(
  rule: ReturnType<typeof normalizeRule>,
  context: Record<string, any>
): boolean {
  const cond = rule.conditions || {};

  if (rule.trigger_event === 'JOB_STATUS_CHANGED' && cond.to_status) {
    if (context.to_status !== cond.to_status) return false;
  }

  if (rule.trigger_event === 'TASK_COMPLETED' && cond.all_tasks_complete) {
    if (!context.all_tasks_complete) return false;
  }

  if (rule.trigger_event === 'LEAD_INACTIVE' && cond.inactive_days) {
    if ((context.inactive_days ?? 0) < cond.inactive_days) return false;
  }

  return true;
}

function interpolate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  );
}

async function executeAction(
  userId: string,
  rule: ReturnType<typeof normalizeRule>,
  context: Record<string, any>
) {
  const config = rule.action_config || {};

  switch (rule.action_type) {
    case 'CREATE_TASKS': {
      const tasks = (config.tasks as any[]) || [];
      const jobId = context.job_id;
      if (!jobId) break;

      for (const t of tasks) {
        await pool.query(
          `INSERT INTO tasks (user_id, job_id, title, description, status)
           VALUES ($1, $2, $3, $4, 'Pending')`,
          [
            userId,
            jobId,
            interpolate(t.title || 'Auto task', context),
            interpolate(t.description || '', context),
          ]
        );
      }
      break;
    }

    case 'CREATE_FOLLOW_UP_TASK': {
      const leadId = context.lead_id;
      const jobId = context.job_id;
      if (!leadId && !jobId) break;

      const title = interpolate(
        (config.task_title as string) || 'Follow up',
        context
      );
      const description = interpolate(
        (config.task_description as string) || '',
        context
      );

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3);

      if (jobId) {
        await pool.query(
          `INSERT INTO tasks (user_id, job_id, title, description, due_date, status)
           VALUES ($1, $2, $3, $4, $5, 'Pending')`,
          [userId, jobId, title, description, dueDate.toISOString()]
        );
      } else {
        await pool.query(
          `INSERT INTO tasks (user_id, lead_id, title, description, due_date, status)
           VALUES ($1, $2, $3, $4, $5, 'Pending')`,
          [userId, leadId, title, description, dueDate.toISOString()]
        );
      }
      break;
    }

    case 'SEND_NOTIFICATION': {
      const title = interpolate(
        (config.title as string) || 'Automation',
        context
      );
      const message = interpolate((config.message as string) || '', context);

      await createNotification({
        userId,
        type: 'TASK_ASSIGNED',
        title,
        message,
        entityType: context.entity_type || null,
        entityId: context.entity_id || null,
      });
      break;
    }

    case 'UPDATE_STATUS': {
      const newStatus = config.new_status as string;
      if (!newStatus || !context.job_id) break;
      await pool.query(
        `UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3`,
        [newStatus, context.job_id, userId]
      );
      break;
    }
  }
}
