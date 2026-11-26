-- The registration gate, step 6 of PLAN_operator.md.
--
-- registered_via records how a company signed up: through the approval
-- queue, with a sign-up code (which skips the queue once the owner's email
-- is confirmed), or on a dev host with registration open. NULL for every
-- company that existed before this step.
--
-- superseded_at on a verification link: "Resend" makes a new link and the
-- older ones stop working, the way a newer reset link supersedes the last.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS registered_via text;
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_registered_via_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_registered_via_check
  CHECK (registered_via IS NULL OR registered_via IN ('approval', 'invite_code', 'open'));

ALTER TABLE public.email_verifications
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
