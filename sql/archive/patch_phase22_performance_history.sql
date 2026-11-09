-- Phase 22: per-user performance history.
-- Assignment and lead-status events start when this patch is applied.
-- Existing rows are not backfilled; reports fall back to the current assignee
-- until a record gets its first event.

CREATE TABLE IF NOT EXISTS assignment_events (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assignment_events_entity_type_check CHECK (entity_type IN ('lead', 'job'))
);

CREATE INDEX IF NOT EXISTS idx_assignment_events_lookup
  ON assignment_events (company_id, entity_type, entity_id, assigned_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS lead_status_events (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lead_status_events_lead
  ON lead_status_events (company_id, lead_id, changed_at, id);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION crm_assignee_at_outcome(
  p_company_id UUID,
  p_entity_type TEXT,
  p_entity_id INTEGER,
  p_at TIMESTAMPTZ,
  p_current UUID
) RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM assignment_events ae
      WHERE ae.company_id = p_company_id
        AND ae.entity_type = p_entity_type
        AND ae.entity_id = p_entity_id
        AND ae.assigned_at <= p_at
    )
    THEN (
      SELECT ae.user_id
      FROM assignment_events ae
      WHERE ae.company_id = p_company_id
        AND ae.entity_type = p_entity_type
        AND ae.entity_id = p_entity_id
        AND ae.assigned_at <= p_at
      ORDER BY ae.assigned_at DESC, ae.id DESC
      LIMIT 1
    )
    ELSE p_current
  END;
$$;
