/**
 * Contacts: the person or household a company deals with
 * (crm_frontend/docs/research/contacts-plan.md). The one place that says
 * what a contact's kind, name and status mean, so the contacts API, the
 * lead and job pages, estimates, invoices and the portal all agree.
 */
import { PRODUCTION_STATUSES, SELLING_STATUSES, WON_STATUSES, sqlStatusList } from './jobLifecycle';

// ---------------------------------------------------------------------------
// Kinds. A fixed list (plan section 3.4). The app's behaviour depends only on
// the group: a client owns leads and jobs and is billed; a partner is linked
// to jobs with a role and has no status of its own.
// ---------------------------------------------------------------------------

export const CLIENT_KINDS = ['homeowner', 'business', 'property_manager'] as const;
export const PARTNER_KINDS = ['adjuster', 'realtor', 'tenant', 'vendor', 'other'] as const;
export const CONTACT_KINDS = [...CLIENT_KINDS, ...PARTNER_KINDS] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];
export type ContactGroup = 'client' | 'partner';

export function groupOf(kind: string | null | undefined): ContactGroup {
  return (PARTNER_KINDS as readonly string[]).includes(String(kind ?? '')) ? 'partner' : 'client';
}

/** SQL literal list of a kind constant. Only ever the constants above. */
export function sqlKindList(kinds: readonly string[]) {
  return kinds.map((kind) => `'${kind}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Names. A household's display name ("Helen & Mark Brooks") wins; then
// "first last"; then the company name (an adjuster's carrier); then
// "Contact #N".
// ---------------------------------------------------------------------------

export function contactNameSql(alias: string) {
  return `COALESCE(
    NULLIF(btrim(${alias}.display_name), ''),
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(${alias}.first_name), ''), NULLIF(btrim(${alias}.last_name), ''))), ''),
    NULLIF(btrim(${alias}.company_name), ''),
    CASE WHEN ${alias}.id IS NOT NULL THEN 'Contact #' || ${alias}.id END
  )`;
}

export function contactName(row: {
  id?: number | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}) {
  const display = String(row.display_name ?? '').trim();
  if (display) return display;
  const full = [row.first_name, row.last_name]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  const company = String(row.company_name ?? '').trim();
  if (company) return company;
  return row.id != null ? `Contact #${row.id}` : null;
}

// ---------------------------------------------------------------------------
// Lead stages. Which lead statuses are finished, defined once next to the
// stages the Leads page uses today (New, Contacted, Qualified, Closed,
// Inactive) and the board the owner has asked for (New → Sold, Lost exit).
// Every other status is an open inquiry.
// ---------------------------------------------------------------------------

export const FINISHED_LEAD_STATUSES = ['Closed', 'Inactive', 'Sold', 'Lost'] as const;
export const LOST_LEAD_STATUSES = ['Inactive', 'Lost'] as const;

export function isOpenLeadStatus(status: string | null | undefined) {
  return !(FINISHED_LEAD_STATUSES as readonly string[]).includes(String(status ?? ''));
}

function literalList(values: readonly string[]) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Status chip. Worked out from the contact's leads and jobs, never stored.
// The first rule that applies wins (plan section 5.2):
//   customer       a job between Sold and Work Complete
//   lead           an open lead, or a job still being sold, and no active job
//   past_customer  won jobs, all closed, nothing open
//   lost           lost or inactive leads, or lost jobs, and nothing above
//   null           a partner, or nothing to go on
// It reads every lead and job of the contact, whoever's they are: the chip
// says where the relationship stands, not who is working it.
// ---------------------------------------------------------------------------

const ACTIVE_JOB_STATUSES = [...PRODUCTION_STATUSES, 'Work Complete'] as const;

/**
 * The columns the chip is worked out from, as a LATERAL join on contact
 * `alias`. Adds sx.has_active_job, sx.has_selling_job, sx.has_won_job,
 * sx.has_lost_job, sx.has_open_lead, sx.has_lost_lead, sx.job_count,
 * sx.lead_count, sx.customer_since, sx.work_updated_at.
 */
export function contactStatusLateralSql(alias: string) {
  return `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(jx.has_active_job, FALSE) AS has_active_job,
      COALESCE(jx.has_selling_job, FALSE) AS has_selling_job,
      COALESCE(jx.has_won_job, FALSE) AS has_won_job,
      COALESCE(jx.has_lost_job, FALSE) AS has_lost_job,
      COALESCE(lx.has_open_lead, FALSE) AS has_open_lead,
      COALESCE(lx.has_lost_lead, FALSE) AS has_lost_lead,
      COALESCE(jx.job_count, 0) AS job_count,
      COALESCE(lx.lead_count, 0) AS lead_count,
      jx.customer_since,
      GREATEST(jx.updated_at, lx.updated_at) AS work_updated_at
    FROM (
      SELECT
        BOOL_OR(j.status IN (${sqlStatusList(ACTIVE_JOB_STATUSES)})) AS has_active_job,
        BOOL_OR(j.status IN (${sqlStatusList(SELLING_STATUSES)})) AS has_selling_job,
        BOOL_OR(j.status IN (${sqlStatusList(WON_STATUSES)})) AS has_won_job,
        BOOL_OR(j.status = 'Lost') AS has_lost_job,
        COUNT(*)::int AS job_count,
        MIN(j.sold_at) AS customer_since,
        MAX(j.updated_at) AS updated_at
      FROM jobs j
      WHERE j.contact_id = ${alias}.id AND j.company_id = ${alias}.company_id
    ) jx,
    (
      SELECT
        BOOL_OR(l.status NOT IN (${literalList(FINISHED_LEAD_STATUSES)})) AS has_open_lead,
        BOOL_OR(l.status IN (${literalList(LOST_LEAD_STATUSES)})) AS has_lost_lead,
        COUNT(*)::int AS lead_count,
        MAX(l.updated_at) AS updated_at
      FROM leads l
      WHERE l.contact_id = ${alias}.id AND l.company_id = ${alias}.company_id
    ) lx
  ) sx ON TRUE`;
}

/** The chip, from the lateral above. NULL for partners. */
export function contactStatusSql(alias: string) {
  return `CASE
    WHEN ${alias}.kind IN (${sqlKindList(PARTNER_KINDS)}) THEN NULL
    WHEN sx.has_active_job THEN 'customer'
    WHEN sx.has_open_lead OR sx.has_selling_job THEN 'lead'
    WHEN sx.has_won_job THEN 'past_customer'
    WHEN sx.has_lost_lead OR sx.has_lost_job THEN 'lost'
    ELSE NULL
  END`;
}

export type ContactStatus = 'customer' | 'lead' | 'past_customer' | 'lost';
export const CONTACT_STATUSES: readonly ContactStatus[] = [
  'customer',
  'lead',
  'past_customer',
  'lost',
];
