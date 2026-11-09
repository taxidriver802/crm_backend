-- Phase 13.3: Customer portal tokens

CREATE TABLE IF NOT EXISTS portal_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_tokens_job ON portal_tokens (job_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_hash ON portal_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_user ON portal_tokens (user_id);
