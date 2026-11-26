-- Login history: who signed in, or tried to, from which address and device.
-- Forward-only, and it changes no existing row.
--
-- Numbered 0005, not 0004: 0004 is the contacts migration on another line of
-- work. The runner applies files in name order and allows gaps, and the two
-- tables don't depend on each other.
--
-- This is the operator's security log, kept apart from account_events (0003):
--   - it covers the whole host, including attempts that match no company or
--     no person (unknown slug, unknown email), so company_id and user_id may
--     be empty;
--   - it keeps the client address and user agent, which account history
--     deliberately does not;
--   - rows are pruned after LOGIN_EVENTS_KEEP_DAYS (default 180) by the
--     backend's daily job.
-- No password, token, reset link or cookie is ever stored. session_id is the
-- user_sessions row id, which can't sign anyone in by itself.
CREATE TABLE IF NOT EXISTS public.login_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  -- Why an attempt failed. Only on login_failed.
  reason text,
  -- How a session started. Only on login_success.
  method text,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- As attempted: lower-cased, trimmed and cut short.
  company_slug text,
  email_attempted text,
  -- The session a success started, or a logout ended. No foreign key:
  -- old session rows are deleted.
  session_id uuid,
  -- req.ip under `trust proxy`; empty when it isn't a valid address.
  ip inet,
  user_agent text,
  CONSTRAINT login_events_event_check CHECK (event IN (
    'login_success', 'login_failed', 'logout', 'logout_elsewhere',
    'password_reset_requested', 'password_reset', 'password_changed'
  )),
  CONSTRAINT login_events_reason_check CHECK (reason IS NULL OR reason IN (
    'unknown_company', 'unknown_email', 'inactive', 'no_password', 'bad_password',
    'rate_limited_account', 'rate_limited_ip'
  )),
  CONSTRAINT login_events_method_check CHECK (method IS NULL OR method IN (
    'password', 'register', 'invite', 'reset'
  )),
  CONSTRAINT login_events_lengths_check CHECK (
    (company_slug IS NULL OR length(company_slug) <= 100)
    AND (email_attempted IS NULL OR length(email_attempted) <= 320)
    AND (user_agent IS NULL OR length(user_agent) <= 512)
  )
);

CREATE INDEX IF NOT EXISTS idx_login_events_created
  ON public.login_events (created_at);

CREATE INDEX IF NOT EXISTS idx_login_events_by_user
  ON public.login_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Alerting on repeated failures reads only these.
CREATE INDEX IF NOT EXISTS idx_login_events_failed
  ON public.login_events (created_at)
  WHERE event = 'login_failed';
