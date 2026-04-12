-- Phase 9: estimate sharing / client response + job measurements
ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS share_token_hash TEXT,
ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS client_responded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS client_response_note TEXT;

CREATE TABLE IF NOT EXISTS job_measurements (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_measurements_job_id ON job_measurements (job_id);
