-- Company exports, step 5 of PLAN_operator.md.
--
-- The archive is built in the background, so an export can be 'building'
-- or 'failed'. The owner downloads it while signed in (the link is not
-- emailed): downloaded_at and download_count record that, and the file is
-- removed when it expires. deny_reason is the operator's, kept for the
-- account history.

ALTER TABLE public.company_exports
  DROP CONSTRAINT IF EXISTS company_exports_status_check;
ALTER TABLE public.company_exports
  ADD CONSTRAINT company_exports_status_check CHECK (status IN (
    'requested', 'approved', 'building', 'built', 'failed', 'denied',
    'sent', 'downloaded', 'expired'
  ));

ALTER TABLE public.company_exports
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS built_at timestamptz,
  ADD COLUMN IF NOT EXISTS downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deny_reason text;

CREATE INDEX IF NOT EXISTS idx_company_exports_open
  ON public.company_exports (status)
  WHERE status IN ('requested', 'approved', 'building');
