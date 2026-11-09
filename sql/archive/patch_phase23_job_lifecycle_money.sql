-- Phase 23: the job carries the work from first contact to paid and closed.
--
-- Before this patch the job's status list was a sales pipeline that ended at
-- "Closed Won" — the moment production actually starts. Nothing after the
-- sale had a state, invoices were a Paid/not-paid flag with no payments, and
-- a won job dropped out of health, workload and the dashboard.
--
-- This patch:
--   1. Renames the terminal sales states (Closed Won -> Sold, Closed Lost -> Lost)
--      and adds production and billing states after Sold. Existing won jobs
--      whose invoices are all paid become Closed; the rest become Sold so
--      they reappear as open work.
--   2. Adds lifecycle milestones on jobs (sold_at, work_completed_at,
--      closed_at, lost_at, lost_reason).
--   3. Adds a payments ledger (invoice_payments). Invoice status is derived
--      from payments + due date; amount_paid is maintained in the same
--      transaction as every payment write.
--   4. Adds invoice kinds (standard / deposit / final) and prior_billed_total
--      so a final invoice can subtract the deposit already billed.
--   5. Adds approved_at and change_order_of on estimates. Approved estimates
--      are locked by the service; scope changes go into a change order.
--
-- Idempotent. Safe to re-run.

-- =========================================================
-- JOBS — lifecycle
-- =========================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_completed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Won jobs: closed when every invoice is paid, otherwise back into open work.
UPDATE jobs j
SET status = CASE
    WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id)
     AND NOT EXISTS (
       SELECT 1 FROM invoices i WHERE i.job_id = j.id AND i.status <> 'Paid'
     )
    THEN 'Closed'
    ELSE 'Sold'
  END,
  sold_at = COALESCE(j.sold_at, j.status_changed_at),
  closed_at = CASE
    WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id)
     AND NOT EXISTS (
       SELECT 1 FROM invoices i WHERE i.job_id = j.id AND i.status <> 'Paid'
     )
    THEN COALESCE(j.closed_at, j.status_changed_at)
    ELSE j.closed_at
  END
WHERE j.status = 'Closed Won';

UPDATE jobs
SET status = 'Lost',
    lost_at = COALESCE(lost_at, status_changed_at)
WHERE status = 'Closed Lost';

-- Keep history readable under the new names.
UPDATE job_activity
SET metadata = jsonb_set(metadata, '{toStatus}', to_jsonb(
      CASE metadata->>'toStatus' WHEN 'Closed Won' THEN 'Sold' ELSE 'Lost' END
    ))
WHERE type = 'JOB_STATUS_CHANGED'
  AND metadata ? 'toStatus'
  AND metadata->>'toStatus' IN ('Closed Won', 'Closed Lost');

UPDATE job_activity
SET metadata = jsonb_set(metadata, '{fromStatus}', to_jsonb(
      CASE metadata->>'fromStatus' WHEN 'Closed Won' THEN 'Sold' ELSE 'Lost' END
    ))
WHERE type = 'JOB_STATUS_CHANGED'
  AND metadata ? 'fromStatus'
  AND metadata->>'fromStatus' IN ('Closed Won', 'Closed Lost');

UPDATE job_activity
SET message = replace(replace(message, 'Closed Won', 'Sold'), 'Closed Lost', 'Lost')
WHERE type = 'JOB_STATUS_CHANGED'
  AND (message LIKE '%Closed Won%' OR message LIKE '%Closed Lost%');

UPDATE automation_rules
SET conditions = jsonb_set(conditions, '{to_status}', to_jsonb(
      CASE conditions->>'to_status' WHEN 'Closed Won' THEN 'Sold' ELSE 'Lost' END
    ))
WHERE conditions->>'to_status' IN ('Closed Won', 'Closed Lost');

UPDATE automation_rules
SET conditions = jsonb_set(conditions, '{from_status}', to_jsonb(
      CASE conditions->>'from_status' WHEN 'Closed Won' THEN 'Sold' ELSE 'Lost' END
    ))
WHERE conditions->>'from_status' IN ('Closed Won', 'Closed Lost');

UPDATE saved_views
SET filters = jsonb_set(filters, '{status}', to_jsonb(
      CASE filters->>'status' WHEN 'Closed Won' THEN 'Sold' ELSE 'Lost' END
    ))
WHERE entity_type = 'jobs'
  AND filters->>'status' IN ('Closed Won', 'Closed Lost');

-- Status was free text. New writes must use the lifecycle vocabulary;
-- NOT VALID keeps any legacy custom value readable instead of failing.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs
ADD CONSTRAINT jobs_status_check CHECK (
  status IN (
    'New',
    'Contacted',
    'Appointment Scheduled',
    'Proposal Sent',
    'Sold',
    'Work Scheduled',
    'In Progress',
    'Work Complete',
    'Closed',
    'Lost'
  )
) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs (company_id, status);

-- =========================================================
-- ESTIMATES — approval time + change orders
-- =========================================================
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS change_order_of INTEGER REFERENCES estimates (id) ON DELETE SET NULL;

UPDATE estimates
SET approved_at = COALESCE(client_responded_at, updated_at, created_at)
WHERE status = 'Approved' AND approved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_change_order_of ON estimates (change_order_of);

-- =========================================================
-- INVOICES — kinds, prior billing, derived payment state
-- =========================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS prior_billed_total NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_kind_check;
ALTER TABLE invoices
ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('standard', 'deposit', 'final'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_prior_billed_total_check;
ALTER TABLE invoices
ADD CONSTRAINT invoices_prior_billed_total_check CHECK (prior_billed_total >= 0);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amount_paid_check;
ALTER TABLE invoices
ADD CONSTRAINT invoices_amount_paid_check CHECK (amount_paid >= 0);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices
ADD CONSTRAINT invoices_status_check CHECK (
  status IN ('Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void')
);

UPDATE invoices
SET sent_at = COALESCE(sent_at, created_at)
WHERE status <> 'Draft' AND sent_at IS NULL;

-- =========================================================
-- INVOICE PAYMENTS — the ledger
-- =========================================================
CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  recorded_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  notes TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoice_payments_amount_check CHECK (amount > 0),
  CONSTRAINT invoice_payments_method_check CHECK (
    method IN ('check', 'card', 'cash', 'ach', 'financing', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_job ON invoice_payments (job_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_company_received
  ON invoice_payments (company_id, received_at DESC);

-- Invoices already marked Paid had no payment rows. Record one so the
-- ledger and the status agree from day one.
INSERT INTO invoice_payments (
  company_id, invoice_id, job_id, recorded_by_user_id, amount, method, notes, received_at
)
SELECT
  i.company_id,
  i.id,
  i.job_id,
  i.user_id,
  i.grand_total,
  'other',
  'Recorded before payment tracking',
  COALESCE(i.paid_at, i.updated_at, i.created_at)
FROM invoices i
WHERE i.status = 'Paid'
  AND i.grand_total > 0
  AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id);

UPDATE invoices i
SET amount_paid = COALESCE(
  (SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id),
  0
);
