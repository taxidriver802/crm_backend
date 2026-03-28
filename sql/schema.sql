CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,

  -- nullable so invited users can exist before setting a password
  password_hash TEXT,

  role TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'active',

  invite_token_hash TEXT,
  invite_expires_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  password_set_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'admin', 'agent')),

  CONSTRAINT users_status_check
    CHECK (status IN ('invited', 'active', 'disabled'))
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS invite_revoked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS invite_superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_invite_expires_at ON users (invite_expires_at);

-- LEADS
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,

  source TEXT,
  status TEXT NOT NULL DEFAULT 'New',

  budget_min NUMERIC,
  budget_max NUMERIC,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads (user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);

-- search
CREATE INDEX IF NOT EXISTS idx_leads_name ON leads (last_name, first_name);

-- TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Pending',

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks (job_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON tasks (lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

-- JOBS
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);


-- SUPPLIER CONNECTIONS
CREATE TABLE IF NOT EXISTS supplier_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'abc_supply'
  status TEXT NOT NULL DEFAULT 'disconnected',
  api_base_url TEXT,
  account_identifier TEXT,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SUPPLIER ACCOUNTS
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  sold_to_number TEXT,
  bill_to_number TEXT,
  ship_to_number TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SUPPLIER ORDERS
CREATE TABLE IF NOT EXISTS supplier_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_order_id TEXT,
  external_order_status TEXT,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SUPPLIER WEBHOOK EVENTS
CREATE TABLE IF NOT EXISTS supplier_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT,
  external_event_id TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

/* Supplier Connections */
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_connections_user_provider
ON supplier_connections (user_id, provider);

/* Supplier Accounts */
CREATE INDEX IF NOT EXISTS idx_supplier_accounts_user_id
ON supplier_accounts (user_id);

CREATE INDEX IF NOT EXISTS idx_supplier_accounts_provider
ON supplier_accounts (provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_accounts_provider_external
ON supplier_accounts (provider, external_account_id);

/* Supplier Orders */
CREATE INDEX IF NOT EXISTS idx_supplier_orders_user_id
ON supplier_orders (user_id);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_lead_id
ON supplier_orders (lead_id);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_provider
ON supplier_orders (provider);

/* Supplier Webhook Events */
CREATE INDEX IF NOT EXISTS idx_supplier_webhook_events_provider
ON supplier_webhook_events (provider);

CREATE INDEX IF NOT EXISTS idx_supplier_webhook_events_processed
ON supplier_webhook_events (processed);

-- Files
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,

  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,

  entity_type TEXT,
  entity_id INTEGER,

  metadata JSONB,

  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_at
ON notifications (user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_type
ON notifications (type);

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_ASSIGNED',
  'INVITE_ACCEPTED'
));

ALTER TABLE notifications
ADD CONSTRAINT notifications_entity_type_check
CHECK (
  entity_type IS NULL OR entity_type IN ('task', 'lead', 'invite')
);

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
ON notifications (dedupe_key)
WHERE dedupe_key IS NOT NULL;
