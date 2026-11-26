-- Timers, deletion and the operator's second factor, step 7 of
-- PLAN_operator.md.
--
-- company_notices: each email or ping the lifecycle job sends about a
-- company's timer, so it goes once. due_at is the timer it was about:
-- extending the timer re-arms its reminders.
--
-- operators: a TOTP secret is set up first as pending, and becomes the
-- secret once a code from it is entered. totp_last_step stops one code
-- being used twice. Both secrets are encrypted with a key derived from
-- OPERATOR_JWT_SECRET.
--
-- login_events: TOTP as a sign-in method, and a wrong code as a reason.

CREATE TABLE IF NOT EXISTS public.company_notices (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  notice text NOT NULL,
  due_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_notices_once UNIQUE (company_id, notice, due_at)
);

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS totp_pending_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS totp_last_step bigint;

ALTER TABLE public.login_events DROP CONSTRAINT IF EXISTS login_events_reason_check;
ALTER TABLE public.login_events
  ADD CONSTRAINT login_events_reason_check CHECK (reason IS NULL OR reason IN (
    'unknown_company', 'unknown_email', 'inactive', 'no_password', 'bad_password',
    'rate_limited_account', 'rate_limited_ip', 'access_denied', 'bad_totp'
  ));
ALTER TABLE public.login_events DROP CONSTRAINT IF EXISTS login_events_method_check;
ALTER TABLE public.login_events
  ADD CONSTRAINT login_events_method_check CHECK (method IS NULL OR method IN (
    'password', 'register', 'invite', 'reset', 'totp'
  ));
