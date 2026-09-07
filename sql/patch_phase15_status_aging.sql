-- Phase 15: pipeline aging — when status last changed on leads and jobs

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE leads
SET status_changed_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE status_changed_at IS NULL;

ALTER TABLE leads
ALTER COLUMN status_changed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE leads
ALTER COLUMN status_changed_at SET NOT NULL;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE jobs
SET status_changed_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE status_changed_at IS NULL;

ALTER TABLE jobs
ALTER COLUMN status_changed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE jobs
ALTER COLUMN status_changed_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_user_status_changed_at
  ON leads (user_id, status, status_changed_at);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status_changed_at
  ON jobs (user_id, status, status_changed_at);
