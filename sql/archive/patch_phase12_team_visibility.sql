-- Phase 12.1: team visibility + assignment support
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads (assigned_to);

CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON jobs (assigned_to);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks (assigned_to);
