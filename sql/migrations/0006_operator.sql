-- The operator: one account above every company, and each company's account
-- with Joist (status, plan, trial, billing contact). PLAN_operator.md §4.
-- Forward-only. Existing companies become 'active' and existing active
-- people with a password count as email-verified, so nothing changes for a
-- company already on the host.
--
-- What this adds:
--   - companies: lifecycle status and its timer, plan, trial, billing email,
--     private operator notes;
--   - users.email_verified_at, and email_verifications for sign-up links;
--   - company_exports, for the self-serve and final exports;
--   - operators and operator_sessions: the operator signs in apart from every
--     company, with their own token secret (OPERATOR_JWT_SECRET);
--   - operator_events and company_tombstones: no foreign key to companies on
--     purpose, so the account history outlives a deleted company;
--   - login_events.scope, so operator sign-ins share the security log.
--
-- "deleted" is not a status: the company row is gone and its tombstone is the
-- record.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  -- When the lifecycle timer moves the company on. NULL: no timer.
  ADD COLUMN IF NOT EXISTS next_status_at timestamptz,
  -- on_hold returns to this state, with this much left on its clock.
  ADD COLUMN IF NOT EXISTS held_from_status text,
  ADD COLUMN IF NOT EXISTS held_remaining interval,
  -- Shown to the company's staff where the state explains itself.
  ADD COLUMN IF NOT EXISTS status_reason text,
  -- Free text until plans are decided.
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  -- The operator's own notes. Never sent to the company.
  ADD COLUMN IF NOT EXISTS operator_notes text;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_status_check CHECK (status IN (
    'pending', 'denied', 'trial', 'active', 'past_due',
    'suspended', 'pending_deletion', 'on_hold'
  )),
  ADD CONSTRAINT companies_held_from_status_check CHECK (
    (status = 'on_hold') = (held_from_status IS NOT NULL)
    AND (held_from_status IS NULL OR held_from_status IN (
      'trial', 'active', 'past_due', 'suspended', 'pending_deletion'
    ))
  ),
  ADD CONSTRAINT companies_account_lengths_check CHECK (
    (status_reason IS NULL OR length(status_reason) <= 500)
    AND (plan IS NULL OR length(plan) <= 60)
    AND (billing_email IS NULL OR length(billing_email) <= 320)
    AND (operator_notes IS NULL OR length(operator_notes) <= 10000)
  );

CREATE INDEX IF NOT EXISTS idx_companies_status ON public.companies (status);
CREATE INDEX IF NOT EXISTS idx_companies_next_status_at
  ON public.companies (next_status_at)
  WHERE next_status_at IS NOT NULL;

-- The owner's email proof. Employees prove theirs by accepting an emailed
-- invite; one whose link was copied by hand (no mail on the host) stays
-- unverified.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

UPDATE public.users
SET email_verified_at = password_set_at
WHERE status = 'active'
  AND password_set_at IS NOT NULL
  AND email_verified_at IS NULL;

-- Single-use sign-up verification links. Only the token's SHA-256 is kept.
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user
  ON public.email_verifications (user_id, created_at DESC);

-- Company exports. The operator approves a final export but never reads it;
-- the link goes to the owner's verified email.
CREATE TABLE IF NOT EXISTS public.company_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  -- An operator id. No foreign key: the row keeps it if the operator goes.
  approved_by uuid,
  token_hash text UNIQUE,
  expires_at timestamptz,
  byte_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_exports_kind_check CHECK (kind IN ('self_serve', 'final')),
  CONSTRAINT company_exports_status_check CHECK (status IN (
    'requested', 'approved', 'denied', 'built', 'sent', 'downloaded', 'expired'
  ))
);
CREATE INDEX IF NOT EXISTS idx_company_exports_company
  ON public.company_exports (company_id, created_at DESC);

-- The operator. Not a company user: no company_id, a different token secret,
-- and a session table of its own.
CREATE TABLE IF NOT EXISTS public.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  -- Second factor; a later step.
  totp_secret text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_lower_email
  ON public.operators (lower(email));

CREATE TABLE IF NOT EXISTS public.operator_sessions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text,
  CONSTRAINT operator_sessions_ended_reason_check CHECK (
    ended_reason IS NULL OR ended_reason IN ('signed_out', 'password_changed', 'disabled')
  )
);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator
  ON public.operator_sessions (operator_id);

-- What happened to each company's account, by the operator or the lifecycle
-- timer (operator_id NULL). Kept after the company is deleted.
CREATE TABLE IF NOT EXISTS public.operator_events (
  id bigserial PRIMARY KEY,
  operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  company_id uuid,
  -- A snapshot, readable after the company is gone.
  company_slug text,
  event text NOT NULL,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operator_events_company
  ON public.operator_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_events_created
  ON public.operator_events (created_at DESC);

-- What is kept of a deleted company: who it was, its dates and its path, and
-- the slug held back so nobody inherits its old client links.
CREATE TABLE IF NOT EXISTS public.company_tombstones (
  company_id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  owner_name text,
  owner_email text,
  billing_email text,
  created_at timestamptz,
  approved_at timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  -- An operator id. No foreign key, like operator_events.
  deleted_by uuid,
  status_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_export_sent boolean NOT NULL DEFAULT false,
  slug_reserved_until timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_tombstones_slug
  ON public.company_tombstones (slug);

-- Operator sign-ins share the security log. Company rows keep scope 'company'.
ALTER TABLE public.login_events
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'company';

ALTER TABLE public.login_events
  ADD CONSTRAINT login_events_scope_check CHECK (scope IN ('company', 'operator'));

-- One more failure reason: an operator request without a valid Cloudflare
-- Access assertion.
ALTER TABLE public.login_events DROP CONSTRAINT IF EXISTS login_events_reason_check;
ALTER TABLE public.login_events
  ADD CONSTRAINT login_events_reason_check CHECK (reason IS NULL OR reason IN (
    'unknown_company', 'unknown_email', 'inactive', 'no_password', 'bad_password',
    'rate_limited_account', 'rate_limited_ip', 'access_denied'
  ));
