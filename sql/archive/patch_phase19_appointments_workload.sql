-- Phase 19: task-based appointments (kind, end_at, location)

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task';

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE tasks
SET kind = 'task'
WHERE kind IS NULL OR kind = '';

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_kind_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_kind_check
CHECK (kind IN ('task', 'appointment'));

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_end_at_after_due_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_end_at_after_due_check
CHECK (
  end_at IS NULL
  OR due_date IS NULL
  OR end_at > due_date
);

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_appointment_requires_due_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_appointment_requires_due_check
CHECK (
  kind <> 'appointment'
  OR due_date IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_kind_due_date
  ON tasks (user_id, kind, due_date);
