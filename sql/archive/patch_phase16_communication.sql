-- Phase 16: communication log on notes + lead qualification fields

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'note';

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'internal';

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS follow_up_task_id INTEGER REFERENCES tasks (id) ON DELETE SET NULL;

ALTER TABLE notes
DROP CONSTRAINT IF EXISTS notes_type_check;

ALTER TABLE notes
ADD CONSTRAINT notes_type_check
CHECK (type IN ('call', 'text', 'email', 'in_person', 'note'));

ALTER TABLE notes
DROP CONSTRAINT IF EXISTS notes_direction_check;

ALTER TABLE notes
ADD CONSTRAINT notes_direction_check
CHECK (direction IN ('inbound', 'outbound', 'internal'));

CREATE INDEX IF NOT EXISTS idx_notes_entity_created
  ON notes (entity_type, entity_id, created_at DESC);

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS service_type TEXT;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS urgency TEXT;
