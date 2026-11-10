-- Phase 23: the accepted estimate is the job contract, later approvals
-- are change orders, and money received is a ledger instead of a Paid flag.
--
-- Safe to re-run. Earlier patches replace the notification type check, so
-- this patch puts PAYMENT_RECORDED back after those statements.

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS kind TEXT;

UPDATE estimates
SET kind = 'proposal'
WHERE kind IS NULL;

ALTER TABLE estimates
ALTER COLUMN kind SET DEFAULT 'proposal';

ALTER TABLE estimates
ALTER COLUMN kind SET NOT NULL;

ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_kind_check;

ALTER TABLE estimates
ADD CONSTRAINT estimates_kind_check CHECK (kind IN ('proposal', 'change_order'));

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS contract_estimate_id INTEGER;

ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_contract_estimate_id_fkey;

ALTER TABLE estimates
ADD CONSTRAINT estimates_contract_estimate_id_fkey
FOREIGN KEY (contract_estimate_id) REFERENCES estimates (id) ON DELETE RESTRICT;

ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_not_own_contract_check;

ALTER TABLE estimates
ADD CONSTRAINT estimates_not_own_contract_check CHECK (
  contract_estimate_id IS NULL
  OR contract_estimate_id <> id
);

-- Credits live on change orders. Proposals stay non-negative in the service.
ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_subtotal_check;

ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_grand_total_check;

ALTER TABLE estimate_line_items
DROP CONSTRAINT IF EXISTS estimate_line_items_unit_price_check;

ALTER TABLE estimate_line_items
DROP CONSTRAINT IF EXISTS estimate_line_items_line_total_check;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS contract_estimate_id INTEGER;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS contracted_at TIMESTAMPTZ;

ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_contract_estimate_id_fkey;

ALTER TABLE jobs
ADD CONSTRAINT jobs_contract_estimate_id_fkey
FOREIGN KEY (contract_estimate_id) REFERENCES estimates (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_contract_estimate_id ON jobs (contract_estimate_id);

CREATE INDEX IF NOT EXISTS idx_estimates_contract_estimate_id ON estimates (contract_estimate_id);

CREATE INDEX IF NOT EXISTS idx_estimates_job_kind ON estimates (job_id, kind, status);

ALTER TABLE invoices
DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices
ADD CONSTRAINT invoices_status_check CHECK (
  status IN ('Draft', 'Sent', 'Partial', 'Paid', 'Overdue')
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT crm_default_company_id () REFERENCES companies (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  invoice_id INTEGER REFERENCES invoices (id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  note TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_amount_check CHECK (amount > 0),
  CONSTRAINT payments_method_check CHECK (method IN ('cash', 'check', 'card', 'ach', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_payments_company_id ON payments (company_id);

CREATE INDEX IF NOT EXISTS idx_payments_job_id ON payments (job_id, received_at, id);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoice_id);

-- Historical Paid invoices become ledger rows so balance math matches the flag.
INSERT INTO payments (
  company_id,
  user_id,
  job_id,
  invoice_id,
  amount,
  method,
  note,
  received_at
)
SELECT
  i.company_id,
  i.user_id,
  i.job_id,
  i.id,
  i.grand_total,
  'other',
  'Opened from a paid invoice',
  COALESCE(i.paid_at, i.updated_at, CURRENT_TIMESTAMP)
FROM invoices i
WHERE i.status = 'Paid'
  AND i.grand_total > 0
  AND NOT EXISTS (
    SELECT 1
    FROM payments p
    WHERE p.invoice_id = i.id
  );

-- The earliest approved estimate on a job becomes its contract.
UPDATE jobs j
SET
  contract_estimate_id = picked.id,
  contracted_at = COALESCE(
    j.contracted_at,
    picked.client_responded_at,
    picked.updated_at,
    picked.created_at
  )
FROM (
  SELECT DISTINCT ON (job_id)
    id,
    job_id,
    client_responded_at,
    updated_at,
    created_at
  FROM estimates
  WHERE status = 'Approved'
  ORDER BY job_id, COALESCE(client_responded_at, updated_at, created_at), id
) picked
WHERE j.id = picked.job_id
  AND j.contract_estimate_id IS NULL;

-- Any other approved estimate on that job is a change order.
UPDATE estimates e
SET
  kind = 'change_order',
  contract_estimate_id = j.contract_estimate_id,
  updated_at = CURRENT_TIMESTAMP
FROM jobs j
WHERE e.job_id = j.id
  AND j.contract_estimate_id IS NOT NULL
  AND e.id <> j.contract_estimate_id
  AND e.status = 'Approved'
  AND (
    e.kind IS DISTINCT FROM 'change_order'
    OR e.contract_estimate_id IS DISTINCT FROM j.contract_estimate_id
  );

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_ASSIGNED',
    'TASK_COMPLETED',
    'FILE_UPLOADED',
    'INVITE_ACCEPTED',
    'ESTIMATE_CREATED',
    'ESTIMATE_STATUS_CHANGED',
    'ESTIMATE_CLIENT_RESPONDED',
    'INVOICE_CREATED',
    'INVOICE_STATUS_CHANGED',
    'INVOICE_PAID',
    'LEAD_CREATED',
    'LEAD_ASSIGNED',
    'JOB_ASSIGNED',
    'PAYMENT_RECORDED'
  )
);
