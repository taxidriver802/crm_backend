-- Phase 24: the workspace remembers how each person works.
--
-- Before this patch every display choice (theme, accent, sidebar state, list
-- view mode) lived in one browser's localStorage, so a user who moved from the
-- office desktop to a phone in the truck started over. This patch stores:
--
--   user_preferences.preferences  one JSON document per user: appearance,
--                                 navigation (order, hidden items, pins),
--                                 home widgets, list columns/sort, record
--                                 section layout. Validated by Zod in
--                                 src/validators/preferences.schemas.ts.
--   companies.workspace_defaults  the same shape, set by an owner/admin, used
--                                 for anyone who has not chosen for themselves.
--
-- Effective preferences = workspace defaults overlaid with the user's own.
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_company ON user_preferences (company_id);

ALTER TABLE companies
ADD COLUMN IF NOT EXISTS workspace_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;
