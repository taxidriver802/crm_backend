-- A way back in, and sessions that end (EXPERIMENT_SAAS.md step 4,
-- prospect 4). Forward-only, and it changes no existing row.
--
-- Every token signed in before this migration names no session, so it stops
-- working: each person signs in once more after the upgrade.

-- 1. Sessions: one row per sign-in. ------------------------------------------
-- The auth cookie's token names its row. Sign out ends that row only; a
-- password change ends the person's other rows; a reset, or disabling the
-- account, ends them all. A token whose row has ended is refused, however
-- long its signature still has to run.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text,
  CONSTRAINT user_sessions_ended_reason_check CHECK (
    ended_reason IS NULL OR ended_reason IN (
      'signed_out', 'signed_out_elsewhere', 'password_changed', 'password_reset', 'disabled'
    )
  ),
  CONSTRAINT user_sessions_ended_together CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_live_by_user
  ON public.user_sessions (user_id)
  WHERE ended_at IS NULL;

-- 2. Reset links. ---------------------------------------------------------------
-- Shaped like invite links: only the SHA-256 of the token is stored, it
-- lasts an hour and works once. A newer link for the same person supersedes
-- the older ones. `via` says who asked: the person (Forgot), an owner or
-- admin (a link they copy or that is emailed), or the operator's command.
CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  via text NOT NULL,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  superseded_at timestamptz,
  CONSTRAINT password_resets_via_check CHECK (via IN ('forgot', 'staff', 'operator'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_open_by_user
  ON public.password_resets (user_id)
  WHERE used_at IS NULL AND superseded_at IS NULL;

-- 3. Account history. ------------------------------------------------------------
-- What happened to a person's account, and who did it (actor_id is empty
-- when it was the person themselves, or the operator's command). No IP
-- addresses or user agents are kept. Shown to owners and admins on the
-- Users page.
CREATE TABLE IF NOT EXISTS public.account_events (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_events_event_check CHECK (event IN (
    'signed_in', 'sign_in_failed', 'signed_out', 'signed_out_elsewhere',
    'password_changed', 'reset_requested', 'reset_link_issued', 'password_reset',
    'role_changed', 'status_changed',
    'invite_sent', 'invite_resent', 'invite_revoked', 'invite_accepted'
  ))
);

CREATE INDEX IF NOT EXISTS idx_account_events_by_user
  ON public.account_events (user_id, created_at DESC, id DESC);
