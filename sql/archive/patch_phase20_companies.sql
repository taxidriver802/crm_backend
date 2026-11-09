-- Phase 20: companies + denormalized company_id (multi-tenant schema)
--
-- Default company id (single-tenant backfill / insert default):
--   c0000000-0000-4000-8000-000000000001  slug = rooftop
--
-- Idempotent. Does not change application query scoping (Phase 2).
-- One-owner-per-company unique index is deferred: tests still create
-- multiple owners on the default company.

-- =========================================================
-- COMPANIES
-- =========================================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  palette_id TEXT NOT NULL DEFAULT 'rooftop',
  mark_id TEXT NOT NULL DEFAULT 'product',
  logo_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT companies_slug_check CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug ON companies (slug);

INSERT INTO companies (id, name, slug, palette_id)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'Rooftop Realty',
  'rooftop',
  'rooftop'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO companies (id, name, slug, palette_id)
SELECT
  gen_random_uuid (),
  'Rooftop Realty',
  'rooftop',
  'rooftop'
WHERE NOT EXISTS (
  SELECT 1 FROM companies WHERE slug = 'rooftop'
);

CREATE OR REPLACE FUNCTION crm_default_company_id ()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT id FROM companies WHERE slug = 'rooftop' LIMIT 1),
    'c0000000-0000-4000-8000-000000000001'::uuid
  );
$$;

-- =========================================================
-- USERS
-- =========================================================
ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE users
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE users
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE users
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id);

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_email_key;

DROP INDEX IF EXISTS users_email_key;

DROP INDEX IF EXISTS idx_users_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_lower_email
  ON users (company_id, lower(email));

-- =========================================================
-- TABLES WITH user_id
-- =========================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'leads',
    'jobs',
    'tasks',
    'estimates',
    'invoices',
    'notes',
    'job_activity',
    'saved_views',
    'notifications',
    'portal_tokens',
    'automation_rules',
    'intake_tokens',
    'product_events',
    'supplier_connections',
    'supplier_accounts',
    'supplier_orders'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE',
      tbl
    );
    EXECUTE format(
      'UPDATE %I t SET company_id = u.company_id FROM users u WHERE u.id = t.user_id AND t.company_id IS NULL',
      tbl
    );
    EXECUTE format(
      'UPDATE %I SET company_id = crm_default_company_id() WHERE company_id IS NULL',
      tbl
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT crm_default_company_id()',
      tbl
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL',
      tbl
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (company_id)',
      'idx_' || tbl || '_company_id',
      tbl
    );
  END LOOP;
END $$;

-- =========================================================
-- FILES (uploaded_by_user_id is nullable)
-- =========================================================
ALTER TABLE files
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE files f
SET company_id = u.company_id
FROM users u
WHERE u.id = f.uploaded_by_user_id
  AND f.company_id IS NULL;

UPDATE files f
SET company_id = l.company_id
FROM leads l
WHERE l.id = f.lead_id
  AND f.company_id IS NULL;

UPDATE files f
SET company_id = j.company_id
FROM jobs j
WHERE j.id = f.job_id
  AND f.company_id IS NULL;

UPDATE files
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE files
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE files
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_company_id ON files (company_id);

-- =========================================================
-- ESTIMATE TEMPLATES (no user_id today)
-- =========================================================
ALTER TABLE estimate_templates
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE estimate_templates
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE estimate_templates
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE estimate_templates
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_templates_company_id
  ON estimate_templates (company_id);

DROP INDEX IF EXISTS idx_estimate_templates_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_templates_company_lower_name
  ON estimate_templates (company_id, lower(name));

-- =========================================================
-- CHILD ROWS (inherit from parent)
-- =========================================================
ALTER TABLE job_measurements
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE job_measurements m
SET company_id = j.company_id
FROM jobs j
WHERE j.id = m.job_id
  AND m.company_id IS NULL;

UPDATE job_measurements
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE job_measurements
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE job_measurements
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_measurements_company_id
  ON job_measurements (company_id);

ALTER TABLE estimate_line_items
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE estimate_line_items li
SET company_id = e.company_id
FROM estimates e
WHERE e.id = li.estimate_id
  AND li.company_id IS NULL;

UPDATE estimate_line_items
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE estimate_line_items
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE estimate_line_items
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_company_id
  ON estimate_line_items (company_id);

ALTER TABLE invoice_line_items
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE invoice_line_items li
SET company_id = i.company_id
FROM invoices i
WHERE i.id = li.invoice_id
  AND li.company_id IS NULL;

UPDATE invoice_line_items
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE invoice_line_items
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE invoice_line_items
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_company_id
  ON invoice_line_items (company_id);

ALTER TABLE estimate_template_line_items
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

UPDATE estimate_template_line_items li
SET company_id = t.company_id
FROM estimate_templates t
WHERE t.id = li.template_id
  AND li.company_id IS NULL;

UPDATE estimate_template_line_items
SET company_id = crm_default_company_id ()
WHERE company_id IS NULL;

ALTER TABLE estimate_template_line_items
ALTER COLUMN company_id SET DEFAULT crm_default_company_id ();

ALTER TABLE estimate_template_line_items
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_template_line_items_company_id
  ON estimate_template_line_items (company_id);

-- =========================================================
-- WEBHOOKS (tenant filled in when processed)
-- =========================================================
ALTER TABLE supplier_webhook_events
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_supplier_webhook_events_company_id
  ON supplier_webhook_events (company_id);

-- =========================================================
-- REPLACE SYSTEM-WIDE UNIQUES
-- =========================================================
DROP INDEX IF EXISTS idx_invoices_number;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_company_number
  ON invoices (company_id, invoice_number);

DROP INDEX IF EXISTS idx_intake_tokens_singleton;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_tokens_company_singleton
  ON intake_tokens (company_id)
  WHERE singleton = TRUE;

DROP INDEX IF EXISTS idx_notifications_dedupe_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_company_dedupe_key
  ON notifications (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

DROP INDEX IF EXISTS idx_supplier_accounts_provider_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_accounts_company_provider_external
  ON supplier_accounts (company_id, provider, external_account_id);

-- QuickBooks still uses ON CONFLICT (user_id, provider). Keep that unique
-- until connections move to per-company in a later phase.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_connections_user_provider
  ON supplier_connections (user_id, provider);
