-- Clearing refused sign-ups (denied, and pending ones never confirmed).
--
-- A denied company now has a timer (STATE_DAYS.denied in src/lib/lifecycle.ts):
-- the lifecycle job clears it when that runs out, unless it is approved
-- first. Denied companies from before this get theirs from when they were
-- denied. One denied long ago is cleared on the job's next run.
--
-- company_tombstones.cleared: the job or "Remove now" cleared it (no email,
-- slug free), as opposed to the operator deleting a closed account.

-- 45 × 24 hours, as timerFor() counts, not calendar days (which shift by an
-- hour across a clock change).
UPDATE public.companies
SET next_status_at = status_changed_at + interval '1080 hours'
WHERE status = 'denied' AND next_status_at IS NULL;

ALTER TABLE public.company_tombstones
  ADD COLUMN IF NOT EXISTS cleared boolean NOT NULL DEFAULT false;
