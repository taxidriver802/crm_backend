-- Contacts: the person or household a company deals with
-- (crm_frontend/docs/research/contacts-plan.md, step 1). Forward-only.
--
-- A lead becomes one inquiry from a contact, and a job keeps its own site
-- address. This adds the contact tables and copies one contact from each
-- existing lead. It changes no id and no existing value: every lead, job,
-- task, note, file, portal token, pin and saved view stays as it is. The
-- lead's own name, phone and email stay as the "as submitted" record.
--
-- contact_id is optional on leads and jobs for now. Code that sets it on
-- every create ships next; a later migration makes it required.
--
-- Written so it can run twice (the Jest suite re-runs this text inside a
-- rolled-back transaction to test it).

-- 1. Match keys. ---------------------------------------------------------------
-- One function per key. Generated columns use them, so the app, this
-- backfill and search always agree on what "the same phone" means.
--
-- Everything inside is schema-qualified: a restore recomputes generated
-- columns with an empty search_path.
--
-- Changing a function later doesn't recompute stored keys. A migration that
-- changes one must also touch the rows (UPDATE … SET address = address).

-- Digits only; an extension ("x22", "ext. 22") is dropped, and so is the
-- leading 1 of an 11-digit US number. (612) 555-0147 → 6125550147.
CREATE OR REPLACE FUNCTION public.crm_phone_key(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN d = '' THEN NULL
           WHEN pg_catalog.length(d) = 11 AND pg_catalog.left(d, 1) = '1'
             THEN pg_catalog.substr(d, 2)
           ELSE d
         END
  FROM (
    SELECT pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(
               COALESCE(raw, ''),
               '\s*(x|ext\.?|extension)\s*[0-9]+\s*$', '', 'i'),
             '[^0-9]', '', 'g') AS d
  ) s
$$;

-- Trimmed and lowercased. Helen.Brooks@Example.com → helen.brooks@example.com.
CREATE OR REPLACE FUNCTION public.crm_email_key(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(pg_catalog.lower(pg_catalog.btrim(raw)), '')
$$;

-- One address word in its short form: street → st, north → n,
-- apartment → #. Anything else comes back as it is.
CREATE OR REPLACE FUNCTION public.crm_address_word(word text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE word
    WHEN 'street' THEN 'st'      WHEN 'str' THEN 'st'
    WHEN 'avenue' THEN 'ave'     WHEN 'av' THEN 'ave'
    WHEN 'road' THEN 'rd'
    WHEN 'lane' THEN 'ln'
    WHEN 'court' THEN 'ct'
    WHEN 'drive' THEN 'dr'
    WHEN 'boulevard' THEN 'blvd'
    WHEN 'place' THEN 'pl'
    WHEN 'circle' THEN 'cir'
    WHEN 'terrace' THEN 'ter'
    WHEN 'parkway' THEN 'pkwy'
    WHEN 'highway' THEN 'hwy'
    WHEN 'trail' THEN 'trl'
    WHEN 'square' THEN 'sq'
    WHEN 'crossing' THEN 'xing'
    WHEN 'cove' THEN 'cv'
    WHEN 'alley' THEN 'aly'
    WHEN 'north' THEN 'n'        WHEN 'south' THEN 's'
    WHEN 'east' THEN 'e'         WHEN 'west' THEN 'w'
    WHEN 'northeast' THEN 'ne'   WHEN 'northwest' THEN 'nw'
    WHEN 'southeast' THEN 'se'   WHEN 'southwest' THEN 'sw'
    WHEN 'apartment' THEN '#'    WHEN 'apt' THEN '#'
    WHEN 'unit' THEN '#'         WHEN 'suite' THEN '#'
    WHEN 'ste' THEN '#'
    WHEN 'saint' THEN 'st'
    WHEN 'mount' THEN 'mt'
    WHEN 'fort' THEN 'ft'
    ELSE word
  END
$$;

-- An address, keyed so the same place typed two ways matches:
--   house number, street and unit, then the 5-digit ZIP;
--   with no ZIP, house number, street, unit and city.
-- "7 Juniper Court, Plymouth, MN 55447" → "7 juniper ct 55447".
-- Dropping the city when there is a ZIP means "Saint Paul" and "St Paul"
-- can't make two contacts. Exact keys don't catch typos ("Junipr Ct"); that
-- is a later step if duplicates still appear.
--
-- With commas, the first part is the street, a following part that starts
-- with a unit word is the unit, and the part after that is the city. With
-- no commas, the street ends at its first street-type word.
CREATE OR REPLACE FUNCTION public.crm_address_key(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  cleaned text;
  zip text;
  parts text[];
  words text[];
  street text[] := '{}';
  city text[] := '{}';
  part text;
  i integer;
  stop integer;
  next_part integer := 2;
BEGIN
  IF raw IS NULL OR pg_catalog.btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  -- The last 5-digit number, leaving out the house number at the start.
  zip := pg_catalog.substring(
    pg_catalog.regexp_replace(raw, '^\s*[0-9]+', ''),
    '.*\m([0-9]{5})(?:-[0-9]{4})?\M');

  -- Lowercase; a ZIP+4 loses its +4; '#' stands alone, so "Apt 4", "Unit 4"
  -- and "#4" all become "# 4"; other punctuation becomes a space.
  cleaned := pg_catalog.lower(raw);
  cleaned := pg_catalog.regexp_replace(cleaned, '\m([0-9]{5})-[0-9]{4}\M', '\1', 'g');
  cleaned := pg_catalog.regexp_replace(cleaned, '#', ' # ', 'g');
  cleaned := pg_catalog.regexp_replace(cleaned, '[^a-z0-9#,]+', ' ', 'g');

  -- Each comma-separated part, in short words, with the ZIP taken out.
  parts := '{}';
  FOREACH part IN ARRAY pg_catalog.string_to_array(cleaned, ',') LOOP
    SELECT COALESCE(pg_catalog.array_agg(public.crm_address_word(w) ORDER BY n), '{}')
      INTO words
      FROM pg_catalog.regexp_split_to_table(pg_catalog.btrim(part), '\s+')
           WITH ORDINALITY AS t(w, n)
     WHERE w <> '' AND (zip IS NULL OR n = 1 OR w !~ '^[0-9]{5}([0-9]{4})?$');
    IF pg_catalog.cardinality(words) > 0 THEN
      parts := parts || pg_catalog.array_to_string(words, ' ');
    END IF;
  END LOOP;

  IF pg_catalog.cardinality(parts) = 0 THEN
    RETURN NULL;
  END IF;

  IF pg_catalog.cardinality(parts) > 1 THEN
    street := pg_catalog.string_to_array(parts[1], ' ');
    IF parts[2] LIKE '#%' THEN
      street := street || pg_catalog.string_to_array(parts[2], ' ');
      next_part := 3;
    END IF;
    IF pg_catalog.cardinality(parts) >= next_part THEN
      city := pg_catalog.string_to_array(parts[next_part], ' ');
    END IF;
  ELSE
    words := pg_catalog.string_to_array(parts[1], ' ');
    stop := NULL;
    FOR i IN 2 .. pg_catalog.cardinality(words) LOOP
      IF words[i] IN ('st', 'ave', 'rd', 'ln', 'ct', 'dr', 'blvd', 'pl', 'cir', 'ter',
                      'pkwy', 'hwy', 'trl', 'sq', 'xing', 'cv', 'aly', 'way') THEN
        stop := i;
        EXIT;
      END IF;
    END LOOP;
    IF stop IS NULL THEN
      street := words;
    ELSE
      -- A direction after the street type ("Main St NE") and a unit stay.
      IF stop < pg_catalog.cardinality(words)
         AND words[stop + 1] IN ('n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw') THEN
        stop := stop + 1;
      END IF;
      IF stop + 1 < pg_catalog.cardinality(words) AND words[stop + 1] = '#' THEN
        stop := stop + 2;
      END IF;
      street := words[1:stop];
      city := words[stop + 1:];
    END IF;
  END IF;

  IF zip IS NOT NULL THEN
    RETURN pg_catalog.array_to_string(street, ' ') || ' ' || zip;
  END IF;

  -- No ZIP: the city, without a trailing state ("minneapolis mn").
  IF pg_catalog.cardinality(city) > 1 AND pg_catalog.length(city[pg_catalog.cardinality(city)]) = 2 THEN
    city := city[1:pg_catalog.cardinality(city) - 1];
  END IF;
  IF pg_catalog.cardinality(city) = 0 THEN
    RETURN pg_catalog.array_to_string(street, ' ');
  END IF;
  RETURN pg_catalog.array_to_string(street || city, ' ');
END
$$;

-- 2. Contacts. -------------------------------------------------------------------
-- kind is one of a fixed list (the plan's section 3.4). The app groups them:
--   Client:  homeowner, business, property_manager
--   Partner: adjuster, realtor, tenant, vendor, other
-- display_name is for households ("Helen & Mark Brooks"); blank means
-- "first last". legacy_lead_id names the lead a contact was copied from.
-- merged_into_id is set when an owner merges this contact into another; the
-- row stays so its URL can forward.
CREATE TABLE IF NOT EXISTS public.contacts (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'homeowner',
  first_name text,
  last_name text,
  display_name text,
  company_name text,
  phone text,
  phone_key text GENERATED ALWAYS AS (public.crm_phone_key(phone)) STORED,
  email text,
  email_key text GENERATED ALWAYS AS (public.crm_email_key(email)) STORED,
  address text,
  address_key text GENERATED ALWAYS AS (public.crm_address_key(address)) STORED,
  mailing_address text,
  preferred_contact_method text,
  source text,
  merged_into_id integer,
  archived_at timestamptz,
  legacy_lead_id integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- What other tables point at, so a row can't name another company's contact.
  CONSTRAINT contacts_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT contacts_kind_check CHECK (kind IN (
    'homeowner', 'business', 'property_manager',
    'adjuster', 'realtor', 'tenant', 'vendor', 'other'
  )),
  CONSTRAINT contacts_has_a_name CHECK (
    COALESCE(btrim(display_name), '') <> ''
    OR COALESCE(btrim(first_name), '') <> ''
    OR COALESCE(btrim(last_name), '') <> ''
    OR COALESCE(btrim(company_name), '') <> ''
  ),
  CONSTRAINT contacts_merged_into_fkey FOREIGN KEY (company_id, merged_into_id)
    REFERENCES public.contacts (company_id, id),
  CONSTRAINT contacts_not_merged_into_itself CHECK (merged_into_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company_phone_key
  ON public.contacts (company_id, phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_email_key
  ON public.contacts (company_id, email_key) WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_address_key
  ON public.contacts (company_id, address_key) WHERE address_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_name
  ON public.contacts (company_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to
  ON public.contacts (assigned_to);

-- More phones and emails for a contact, each with a label and the person it
-- belongs to ("Mark · mobile"). The contact's primary phone and email stay on
-- the contact row.
CREATE TABLE IF NOT EXISTS public.contact_methods (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id integer NOT NULL,
  kind text NOT NULL,
  value text NOT NULL,
  value_key text GENERATED ALWAYS AS (
    CASE kind
      WHEN 'phone' THEN public.crm_phone_key(value)
      ELSE public.crm_email_key(value)
    END
  ) STORED,
  label text,
  person_name text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contact_methods_contact_fkey FOREIGN KEY (company_id, contact_id)
    REFERENCES public.contacts (company_id, id) ON DELETE CASCADE,
  CONSTRAINT contact_methods_kind_check CHECK (kind IN ('phone', 'email')),
  CONSTRAINT contact_methods_value_check CHECK (btrim(value) <> ''),
  CONSTRAINT contact_methods_label_check CHECK (
    label IS NULL OR label IN ('mobile', 'home', 'work', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_contact_methods_contact
  ON public.contact_methods (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_methods_company_kind_key
  ON public.contact_methods (company_id, kind, value_key) WHERE value_key IS NOT NULL;

-- 3. People on a job besides its client. --------------------------------------------
-- An adjuster, a tenant, a co-owner…, each with a role. One adjuster
-- contact is reused across many jobs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_company_id_id
  ON public.jobs (company_id, id);

CREATE TABLE IF NOT EXISTS public.job_contacts (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id integer NOT NULL,
  contact_id integer NOT NULL,
  role text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id, contact_id),
  CONSTRAINT job_contacts_job_fkey FOREIGN KEY (company_id, job_id)
    REFERENCES public.jobs (company_id, id) ON DELETE CASCADE,
  CONSTRAINT job_contacts_contact_fkey FOREIGN KEY (company_id, contact_id)
    REFERENCES public.contacts (company_id, id) ON DELETE CASCADE,
  CONSTRAINT job_contacts_role_check CHECK (role IN (
    'co_owner', 'adjuster', 'property_manager', 'tenant', 'realtor', 'vendor', 'other'
  ))
);

CREATE INDEX IF NOT EXISTS idx_job_contacts_contact
  ON public.job_contacts (contact_id);

-- 4. Leads, jobs and tasks name a contact. ---------------------------------------
-- A contact that still has leads or jobs can't be deleted (merge or archive
-- it instead). Deleting a lead no longer takes the client off its jobs:
-- jobs.contact_id stays.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_id integer;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_contact_fkey;
ALTER TABLE public.leads ADD CONSTRAINT leads_contact_fkey
  FOREIGN KEY (company_id, contact_id) REFERENCES public.contacts (company_id, id);
CREATE INDEX IF NOT EXISTS idx_leads_contact_id ON public.leads (contact_id);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS contact_id integer;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_contact_fkey;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_contact_fkey
  FOREIGN KEY (company_id, contact_id) REFERENCES public.contacts (company_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_contact_id ON public.jobs (contact_id);

-- The site address, keyed like a contact's, for search and duplicate warnings.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS address_key text
  GENERATED ALWAYS AS (public.crm_address_key(address)) STORED;
CREATE INDEX IF NOT EXISTS idx_jobs_company_address_key
  ON public.jobs (company_id, address_key) WHERE address_key IS NOT NULL;

-- A task or appointment can belong to a contact itself ("Call Helen in
-- March about gutters"): exactly one of lead, job or contact.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS contact_id integer;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_contact_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_contact_fkey
  FOREIGN KEY (company_id, contact_id) REFERENCES public.contacts (company_id, id)
  ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON public.tasks (contact_id);
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_exactly_one_owner_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_exactly_one_owner_check
  CHECK (num_nonnulls(lead_id, job_id, contact_id) = 1);

-- Notes (calls, texts, emails, notes) can be on a contact, and saved views
-- can be of contacts.
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_entity_type_check;
ALTER TABLE public.notes ADD CONSTRAINT notes_entity_type_check
  CHECK (entity_type IN ('lead', 'job', 'contact'));

ALTER TABLE public.saved_views DROP CONSTRAINT IF EXISTS saved_views_entity_type_check;
ALTER TABLE public.saved_views ADD CONSTRAINT saved_views_entity_type_check
  CHECK (entity_type IN ('leads', 'jobs', 'tasks', 'contacts'));

-- 5. One contact from each lead. ----------------------------------------------------
-- Nothing is merged: two leads for the same person become two contacts, and
-- an owner reviews possible duplicates later. The name, phone, email,
-- preferred contact method, source, rep, creator and dates come from the
-- lead. Leads have no address, so the home address is the lead's newest job
-- address. A lead with no name at all gets "Lead #N" as its display name.
-- A re-run skips leads already copied (legacy_lead_id).
INSERT INTO public.contacts (
  company_id, user_id, assigned_to, kind,
  first_name, last_name, display_name,
  phone, email, address,
  preferred_contact_method, source, legacy_lead_id,
  created_at, updated_at
)
SELECT
  l.company_id, l.user_id, l.assigned_to, 'homeowner',
  NULLIF(btrim(l.first_name), ''),
  NULLIF(btrim(l.last_name), ''),
  CASE
    WHEN COALESCE(btrim(l.first_name), '') = '' AND COALESCE(btrim(l.last_name), '') = ''
      THEN 'Lead #' || l.id
  END,
  NULLIF(btrim(l.phone), ''),
  NULLIF(btrim(l.email), ''),
  (
    SELECT j.address
    FROM public.jobs j
    WHERE j.lead_id = l.id
      AND j.company_id = l.company_id
      AND COALESCE(btrim(j.address), '') <> ''
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT 1
  ),
  l.preferred_contact_method,
  l.source,
  l.id,
  l.created_at,
  l.updated_at
FROM public.leads l
WHERE l.contact_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.legacy_lead_id = l.id)
ORDER BY l.id;

UPDATE public.leads l
SET contact_id = c.id
FROM public.contacts c
WHERE c.legacy_lead_id = l.id
  AND c.company_id = l.company_id
  AND l.contact_id IS NULL;

-- Each job's client is its lead's contact.
UPDATE public.jobs j
SET contact_id = l.contact_id
FROM public.leads l
WHERE j.lead_id = l.id
  AND l.company_id = j.company_id
  AND l.contact_id IS NOT NULL
  AND j.contact_id IS NULL;

-- A job whose lead was deleted gets a placeholder contact, "Client of job
-- #N", with the job's address, for an owner to rename or merge. Find them
-- with: SELECT * FROM contacts WHERE display_name LIKE 'Client of job #%'.
DO $$
DECLARE
  job record;
  new_id integer;
BEGIN
  FOR job IN
    SELECT id, company_id, user_id, assigned_to, address, created_at
    FROM public.jobs
    WHERE contact_id IS NULL
    ORDER BY id
  LOOP
    INSERT INTO public.contacts (
      company_id, user_id, assigned_to, kind, display_name, address, created_at
    ) VALUES (
      job.company_id, job.user_id, job.assigned_to, 'homeowner',
      'Client of job #' || job.id, NULLIF(btrim(job.address), ''), job.created_at
    )
    RETURNING id INTO new_id;
    UPDATE public.jobs SET contact_id = new_id WHERE id = job.id;
  END LOOP;
END $$;
