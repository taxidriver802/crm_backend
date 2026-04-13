-- Phase 12.3: Invoicing tables

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  estimate_id INTEGER REFERENCES estimates (id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  share_token_hash TEXT,
  share_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoices_status_check CHECK (
    status IN ('Draft', 'Sent', 'Paid', 'Overdue')
  ),
  CONSTRAINT invoices_subtotal_check CHECK (subtotal >= 0),
  CONSTRAINT invoices_tax_total_check CHECK (tax_total >= 0),
  CONSTRAINT invoices_discount_total_check CHECK (discount_total >= 0),
  CONSTRAINT invoices_grand_total_check CHECK (grand_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job_id ON invoices (job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id ON invoices (estimate_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices (user_id, invoice_number);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoice_line_items_quantity_check CHECK (quantity >= 0),
  CONSTRAINT invoice_line_items_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT invoice_line_items_line_total_check CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_sort_order ON invoice_line_items (invoice_id, sort_order);

-- Widen notification type and entity_type constraints for invoice events
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
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
    'INVOICE_PAID'
  )
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_entity_type_check CHECK (
  entity_type IS NULL
  OR entity_type IN ('task', 'lead', 'job', 'invite', 'estimate', 'invoice')
);
