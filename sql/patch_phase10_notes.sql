-- Phase 10.1: notes / communication log
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notes_entity_type_check CHECK (entity_type IN ('lead', 'job'))
);

CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);

CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at DESC);
