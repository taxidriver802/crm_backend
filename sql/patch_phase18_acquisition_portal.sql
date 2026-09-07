-- Phase 18: public intake tokens + JOB_CREATED automation trigger + LEAD_CREATED notification

CREATE TABLE IF NOT EXISTS intake_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  singleton BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intake_tokens_singleton_true CHECK (singleton = TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_tokens_singleton
  ON intake_tokens (singleton);

CREATE INDEX IF NOT EXISTS idx_intake_tokens_hash
  ON intake_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_intake_tokens_user
  ON intake_tokens (user_id);

ALTER TABLE automation_rules
DROP CONSTRAINT IF EXISTS automation_rules_trigger_check;

ALTER TABLE automation_rules
ADD CONSTRAINT automation_rules_trigger_check
CHECK (
  trigger_event IN (
    'ESTIMATE_APPROVED',
    'LEAD_INACTIVE',
    'JOB_STATUS_CHANGED',
    'TASK_COMPLETED',
    'JOB_CREATED'
  )
);

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_ASSIGNED',
    'TASK_COMPLETED',
    'FILE_UPLOADED',
    'INVITE_ACCEPTED',
    'ESTIMATE_CREATED',
    'ESTIMATE_STATUS_CHANGED',
    'ESTIMATE_CLIENT_RESPONDED',
    'INVOICE_CREATED',
    'INVOICE_STATUS_CHANGED',
    'INVOICE_PAID',
    'LEAD_CREATED'
  )
);
