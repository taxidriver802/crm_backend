CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- USERS
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'active',
  invite_token_hash TEXT,
  invite_expires_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  password_set_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  invite_revoked_at TIMESTAMPTZ,
  invite_superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_role_check CHECK (role IN ('owner', 'admin', 'agent')),
  CONSTRAINT users_status_check CHECK (status IN ('invited', 'active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

CREATE INDEX IF NOT EXISTS idx_users_invite_expires_at ON users (invite_expires_at);

-- =========================================================
-- LEADS
-- Contacts / opportunities
-- =========================================================
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users (id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  budget_min NUMERIC,
  budget_max NUMERIC,
  notes TEXT,
  service_type TEXT,
  preferred_contact_method TEXT,
  urgency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE leads
SET status_changed_at = COALESCE(status_changed_at, updated_at, created_at, CURRENT_TIMESTAMP)
WHERE status_changed_at IS NULL;

ALTER TABLE leads
ALTER COLUMN status_changed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE leads
ALTER COLUMN status_changed_at SET NOT NULL;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS service_type TEXT;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS urgency TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads (user_id);

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads (assigned_to);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);

CREATE INDEX IF NOT EXISTS idx_leads_user_status_changed_at
  ON leads (user_id, status, status_changed_at);

CREATE INDEX IF NOT EXISTS idx_leads_name ON leads (last_name, first_name);

-- =========================================================
-- JOBS
-- Workspaces / active work layer
-- =========================================================
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users (id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE jobs
SET status_changed_at = COALESCE(status_changed_at, updated_at, created_at, CURRENT_TIMESTAMP)
WHERE status_changed_at IS NULL;

ALTER TABLE jobs
ALTER COLUMN status_changed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE jobs
ALTER COLUMN status_changed_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);

CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON jobs (assigned_to);

CREATE INDEX IF NOT EXISTS idx_jobs_lead_id ON jobs (lead_id);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status_changed_at
  ON jobs (user_id, status, status_changed_at);

-- =========================================================
-- JOBS ACTIVITY
-- Memory of work
-- =========================================================
CREATE TABLE IF NOT EXISTS job_activity (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_activity_job_id ON job_activity (job_id);

CREATE INDEX IF NOT EXISTS idx_job_activity_user_id ON job_activity (user_id);

CREATE INDEX IF NOT EXISTS idx_job_activity_created_at ON job_activity (created_at DESC);

-- =========================================================
-- TASKS
-- Units of work
-- Current intended rule:
-- task belongs to exactly one owner: lead OR job
-- =========================================================
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users (id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads (id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  kind TEXT NOT NULL DEFAULT 'task',
  end_at TIMESTAMPTZ,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tasks_exactly_one_owner_check CHECK (
    (
      lead_id IS NOT NULL
      AND job_id IS NULL
    )
    OR (
      lead_id IS NULL
      AND job_id IS NOT NULL
    )
  ),
  CONSTRAINT tasks_kind_check CHECK (kind IN ('task', 'appointment')),
  CONSTRAINT tasks_end_at_after_due_check CHECK (
    end_at IS NULL
    OR due_date IS NULL
    OR end_at > due_date
  ),
  CONSTRAINT tasks_appointment_requires_due_check CHECK (
    kind <> 'appointment'
    OR due_date IS NOT NULL
  )
);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task';

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS location TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks (assigned_to);

CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON tasks (lead_id);

CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks (job_id);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

CREATE INDEX IF NOT EXISTS idx_tasks_user_kind_due_date
  ON tasks (user_id, kind, due_date);

-- =========================================================
-- FILES
-- Documents / assets
-- Preferred model:
--   lead_id OR job_id OR neither (global)
-- task_id kept for legacy compatibility / transition safety
-- =========================================================
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  uploaded_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  lead_id INTEGER REFERENCES leads (id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  -- Legacy / transitional compatibility
  task_id INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  caption TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  client_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT files_category_check CHECK (category IN ('before', 'after', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_files_uploaded_by_user_id ON files (uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_files_lead_id ON files (lead_id);

CREATE INDEX IF NOT EXISTS idx_files_job_id ON files (job_id);

CREATE INDEX IF NOT EXISTS idx_files_task_id ON files (task_id);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at);

ALTER TABLE files
ADD COLUMN IF NOT EXISTS caption TEXT;

ALTER TABLE files
ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE files
SET category = COALESCE(category, 'other')
WHERE category IS NULL;

ALTER TABLE files
ALTER COLUMN category SET DEFAULT 'other';

ALTER TABLE files
ALTER COLUMN category SET NOT NULL;

ALTER TABLE files
DROP CONSTRAINT IF EXISTS files_category_check;

ALTER TABLE files
ADD CONSTRAINT files_category_check
CHECK (category IN ('before', 'after', 'other'));

ALTER TABLE files
ADD COLUMN IF NOT EXISTS client_visible BOOLEAN;

UPDATE files
SET client_visible = COALESCE(client_visible, TRUE)
WHERE client_visible IS NULL;

ALTER TABLE files
ALTER COLUMN client_visible SET DEFAULT TRUE;

ALTER TABLE files
ALTER COLUMN client_visible SET NOT NULL;

-- =========================================================
-- ESTIMATES
-- =========================================================
CREATE TABLE IF NOT EXISTS estimates (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  share_token_hash TEXT,
  share_expires_at TIMESTAMPTZ,
  client_responded_at TIMESTAMPTZ,
  client_response_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT estimates_status_check CHECK (
    status IN ('Draft', 'Sent', 'Approved', 'Rejected')
  ),
  CONSTRAINT estimates_subtotal_check CHECK (subtotal >= 0),
  CONSTRAINT estimates_tax_total_check CHECK (tax_total >= 0),
  CONSTRAINT estimates_discount_total_check CHECK (discount_total >= 0),
  CONSTRAINT estimates_grand_total_check CHECK (grand_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_estimates_user_id ON estimates (user_id);

CREATE INDEX IF NOT EXISTS idx_estimates_job_id ON estimates (job_id);

CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates (status);

CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON estimates (created_at DESC);

-- =========================================================
-- ESTIMATE_LINE_ITEMS
-- =========================================================
CREATE TABLE IF NOT EXISTS estimate_line_items (
  id SERIAL PRIMARY KEY,
  estimate_id INTEGER NOT NULL REFERENCES estimates (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT estimate_line_items_source_check CHECK (source IN ('manual', 'abc_supply')),
  CONSTRAINT estimate_line_items_quantity_check CHECK (quantity >= 0),
  CONSTRAINT estimate_line_items_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT estimate_line_items_line_total_check CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate_id ON estimate_line_items (estimate_id);

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_sort_order ON estimate_line_items (estimate_id, sort_order);

-- =========================================================
-- ESTIMATE TEMPLATES (copy-on-apply line packages)
-- =========================================================
CREATE TABLE IF NOT EXISTS estimate_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_templates_name
  ON estimate_templates (lower(name));

CREATE TABLE IF NOT EXISTS estimate_template_line_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES estimate_templates (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT estimate_template_line_items_quantity_check CHECK (quantity >= 0),
  CONSTRAINT estimate_template_line_items_unit_price_check CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_estimate_template_line_items_template_sort
  ON estimate_template_line_items (template_id, sort_order);

-- =========================================================
-- JOB_MEASUREMENTS (Phase 9 — manual scope / quantities)
-- =========================================================
CREATE TABLE IF NOT EXISTS job_measurements (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_measurements_job_id ON job_measurements (job_id);

-- =========================================================
-- NOTES
-- User-authored communication log attached to lead or job
-- =========================================================
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  direction TEXT NOT NULL DEFAULT 'internal',
  follow_up_task_id INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notes_entity_type_check CHECK (entity_type IN ('lead', 'job')),
  CONSTRAINT notes_type_check CHECK (type IN ('call', 'text', 'email', 'in_person', 'note')),
  CONSTRAINT notes_direction_check CHECK (direction IN ('inbound', 'outbound', 'internal'))
);

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS direction TEXT;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS follow_up_task_id INTEGER REFERENCES tasks (id) ON DELETE SET NULL;

UPDATE notes
SET type = COALESCE(type, 'note')
WHERE type IS NULL;

UPDATE notes
SET direction = COALESCE(direction, 'internal')
WHERE direction IS NULL;

ALTER TABLE notes
ALTER COLUMN type SET DEFAULT 'note';

ALTER TABLE notes
ALTER COLUMN direction SET DEFAULT 'internal';

ALTER TABLE notes
ALTER COLUMN type SET NOT NULL;

ALTER TABLE notes
ALTER COLUMN direction SET NOT NULL;

ALTER TABLE notes
DROP CONSTRAINT IF EXISTS notes_type_check;

ALTER TABLE notes
ADD CONSTRAINT notes_type_check
CHECK (type IN ('call', 'text', 'email', 'in_person', 'note'));

ALTER TABLE notes
DROP CONSTRAINT IF EXISTS notes_direction_check;

ALTER TABLE notes
ADD CONSTRAINT notes_direction_check
CHECK (direction IN ('inbound', 'outbound', 'internal'));

CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);

CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_entity_created
  ON notes (entity_type, entity_id, created_at DESC);

-- =========================================================
-- SAVED_VIEWS
-- User-saved filter presets for list pages
-- =========================================================
CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saved_views_entity_type_check CHECK (
    entity_type IN ('leads', 'jobs', 'tasks')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_user_entity_name ON saved_views (
  user_id,
  entity_type,
  lower(name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user_entity ON saved_views (
  user_id,
  entity_type
);

-- =========================================================
-- INVOICES
-- =========================================================
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

-- =========================================================
-- INVOICE_LINE_ITEMS
-- =========================================================
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

-- =========================================================
-- PRODUCT EVENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS product_events (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_events_name ON product_events (event_name);
CREATE INDEX IF NOT EXISTS idx_product_events_user ON product_events (user_id);
CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_created ON product_events (event_name, created_at DESC);

-- =========================================================
-- PORTAL TOKENS
-- =========================================================
CREATE TABLE IF NOT EXISTS portal_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_tokens_job ON portal_tokens (job_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_hash ON portal_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_user ON portal_tokens (user_id);

-- =========================================================
-- AUTOMATION RULES
-- =========================================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT automation_rules_trigger_check CHECK (
    trigger_event IN (
      'ESTIMATE_APPROVED',
      'LEAD_INACTIVE',
      'JOB_STATUS_CHANGED',
      'TASK_COMPLETED',
      'JOB_CREATED'
    )
  ),
  CONSTRAINT automation_rules_action_check CHECK (
    action_type IN (
      'CREATE_TASKS',
      'CREATE_FOLLOW_UP_TASK',
      'SEND_NOTIFICATION',
      'UPDATE_STATUS'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules (trigger_event);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules (enabled);

-- =========================================================
-- INTAKE TOKENS (public website lead capture)
-- =========================================================
CREATE TABLE IF NOT EXISTS intake_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  singleton BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT intake_tokens_singleton_true CHECK (singleton = TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_tokens_singleton
  ON intake_tokens (singleton);

CREATE INDEX IF NOT EXISTS idx_intake_tokens_hash ON intake_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_intake_tokens_user ON intake_tokens (user_id);

-- =========================================================
-- NOTIFICATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  metadata JSONB,
  dedupe_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_type_check CHECK (
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
      'LEAD_CREATED'
    )
  ),
  CONSTRAINT notifications_entity_type_check CHECK (
    entity_type IS NULL
    OR entity_type IN ('task', 'lead', 'job', 'invite', 'estimate', 'invoice')
  )
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_at ON notifications (user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key ON notifications (dedupe_key)
WHERE
  dedupe_key IS NOT NULL;

-- =========================================================
-- SUPPLIER CONNECTIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_connections (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- example: 'abc_supply'
  status TEXT NOT NULL DEFAULT 'disconnected',
  api_base_url TEXT,
  account_identifier TEXT,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_connections_user_provider ON supplier_connections (user_id, provider);

-- =========================================================
-- SUPPLIER ACCOUNTS
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  sold_to_number TEXT,
  bill_to_number TEXT,
  ship_to_number TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_accounts_user_id ON supplier_accounts (user_id);

CREATE INDEX IF NOT EXISTS idx_supplier_accounts_provider ON supplier_accounts (provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_accounts_provider_external ON supplier_accounts (provider, external_account_id);

-- =========================================================
-- SUPPLIER ORDERS
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_orders (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads (id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_order_id TEXT,
  external_order_status TEXT,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_user_id ON supplier_orders (user_id);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_lead_id ON supplier_orders (lead_id);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_provider ON supplier_orders (provider);

-- =========================================================
-- SUPPLIER WEBHOOK EVENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT,
  external_event_id TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_webhook_events_provider ON supplier_webhook_events (provider);

CREATE INDEX IF NOT EXISTS idx_supplier_webhook_events_processed ON supplier_webhook_events (processed);
