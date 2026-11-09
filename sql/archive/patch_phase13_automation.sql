-- Phase 13.1: Workflow automation rules

CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT automation_rules_trigger_check CHECK (
    trigger_event IN (
      'ESTIMATE_APPROVED',
      'LEAD_INACTIVE',
      'JOB_STATUS_CHANGED',
      'TASK_COMPLETED'
    )
  ),
  CONSTRAINT automation_rules_action_check CHECK (
    action_type IN (
      'CREATE_TASKS',
      'CREATE_FOLLOW_UP_TASK',
      'SEND_NOTIFICATION',
      'UPDATE_STATUS'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules (trigger_event);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules (enabled);
