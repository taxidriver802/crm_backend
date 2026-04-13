-- Phase 12.2: saved views
CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saved_views_entity_type_check CHECK (
    entity_type IN ('leads', 'jobs', 'tasks')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_user_entity_name ON saved_views (
  user_id,
  entity_type,
  lower(name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user_entity ON saved_views (
  user_id,
  entity_type
);
