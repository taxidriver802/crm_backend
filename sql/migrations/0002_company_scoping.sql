-- Rows can't land in another company (EXPERIMENT_SAAS.md step 3,
-- prospects 3 and 6). Forward-only. It rewrites no existing business row:
-- every number already issued, every company_id already stored, stays.
--
-- Written so it can run twice (the Jest suite re-runs this text inside a
-- rolled-back transaction to test it).

-- 1. company_id has no default. ---------------------------------------------
-- Every company_id column used to default to Rooftop Realty, so an insert
-- that forgot its company filed the row under Rooftop, silently. Now it fails
-- with a not-null error.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'company_id'
      AND column_default LIKE '%crm_default_company_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id DROP DEFAULT', col.table_name);
  END LOOP;
END $$;

-- Without CASCADE: this fails if anything still depends on the function.
DROP FUNCTION IF EXISTS public.crm_default_company_id();

-- 2. Each company numbers its own invoices. ---------------------------------
-- One global sequence numbered every company's invoices, so a new company's
-- first invoice came after everything Rooftop had issued. Each company now
-- has a counter, continuing from its own highest INV-number. The counter row
-- is locked by the invoice transaction that takes the next number.
CREATE TABLE IF NOT EXISTS public.company_invoice_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_number integer NOT NULL CHECK (last_number >= 0)
);

INSERT INTO public.company_invoice_counters (company_id, last_number)
SELECT c.id,
       COALESCE(MAX(substring(i.invoice_number FROM '^INV-([0-9]{1,9})$')::integer), 0)
FROM public.companies c
LEFT JOIN public.invoices i ON i.company_id = c.id
GROUP BY c.id
ON CONFLICT (company_id) DO NOTHING;

DROP SEQUENCE IF EXISTS public.invoice_number_seq;

-- 3. At most one live deposit and one live final per estimate. --------------
-- createInvoiceFromEstimate now locks the estimate before it checks; this
-- index is the backstop. A database that already holds a duplicate stops
-- here, naming it: void one of the two, then run the migration again.
DO $$
DECLARE
  dup record;
BEGIN
  SELECT estimate_id, kind, string_agg(invoice_number, ', ' ORDER BY id) AS numbers
  INTO dup
  FROM public.invoices
  WHERE estimate_id IS NOT NULL AND kind IN ('deposit', 'final') AND status <> 'Void'
  GROUP BY estimate_id, kind
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Estimate % has more than one live % invoice (%). Void the extra one, then run db:migrate again.',
      dup.estimate_id, dup.kind, dup.numbers;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_live_per_estimate_kind
  ON public.invoices (estimate_id, kind)
  WHERE estimate_id IS NOT NULL AND kind IN ('deposit', 'final') AND status <> 'Void';

-- 4. A new database has no company until someone registers. -----------------
-- The baseline's starting rows create Rooftop Realty (and its estimate
-- templates) in every new database, on any host. Remove that row while
-- nobody uses it: no user and no record anywhere belongs to it. A database
-- where Rooftop Realty has people or data keeps it, untouched.
DO $$
DECLARE
  builtin constant uuid := 'c0000000-0000-4000-8000-000000000001';
  col record;
  used boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = builtin) THEN
    RETURN;
  END IF;
  FOR col IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'company_id'
      AND table_name NOT IN (
        'estimate_templates', 'estimate_template_line_items', 'company_invoice_counters'
      )
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE company_id = $1)', col.table_name)
      INTO used
      USING builtin;
    EXIT WHEN used;
  END LOOP;
  IF NOT used THEN
    DELETE FROM public.estimate_template_line_items WHERE company_id = builtin;
    DELETE FROM public.estimate_templates WHERE company_id = builtin;
    DELETE FROM public.company_invoice_counters WHERE company_id = builtin;
    DELETE FROM public.companies WHERE id = builtin;
  END IF;
END $$;
