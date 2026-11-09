-- Phase 14.3: Product events for analytics

CREATE TABLE IF NOT EXISTS product_events (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_events_name ON product_events (event_name);
CREATE INDEX IF NOT EXISTS idx_product_events_user ON product_events (user_id);
CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_created ON product_events (event_name, created_at DESC);
