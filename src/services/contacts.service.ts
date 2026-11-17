/**
 * Contacts: the person or household behind leads and jobs
 * (crm_frontend/docs/research/contacts-plan.md, step 2).
 *
 * Who sees what (owner decision, plan section 9):
 *   - Every member of a company sees and edits every contact's details:
 *     name, phones, emails, addresses.
 *   - Leads and jobs stay scoped as today. On a contact, a viewer gets the
 *     leads and jobs they can open; the rest show only as a count per rep.
 *   - Money (lifetime value, owed) adds up only the jobs the viewer can open.
 *   - Only owners and admins give a contact to another rep; anyone may take
 *     an unowned contact, the same rule as leads.
 */
import { pool } from '../db';
import {
  CONTACT_KINDS,
  PARTNER_KINDS,
  contactName,
  contactNameSql,
  contactStatusLateralSql,
  contactStatusSql,
  groupOf,
  isOpenLeadStatus,
  sqlKindList,
  type ContactKind,
  type ContactStatus,
} from '../lib/contacts';
import { JOB_MONEY_LATERAL_SQL, WON_STATUSES, phaseOf, sqlStatusList } from '../lib/jobLifecycle';
import { tenantPredicate, type TenantScope } from '../lib/tenant';

type Queryable = { query: (text: string, values?: unknown[]) => Promise<any> };

export class ContactNotFoundError extends Error {
  status = 404;
  constructor(message = 'Contact not found') {
    super(message);
    this.name = 'ContactNotFoundError';
  }
}

export class ContactMergedError extends Error {
  status = 409;
  mergedIntoId: number;
  constructor(mergedIntoId: number) {
    super(`This contact was merged into contact #${mergedIntoId}`);
    this.name = 'ContactMergedError';
    this.mergedIntoId = mergedIntoId;
  }
}

export class ContactAssigneeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactAssigneeError';
    this.status = status;
  }
}

export type ContactFields = {
  kind?: ContactKind;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  mailing_address?: string | null;
  preferred_contact_method?: string | null;
  source?: string | null;
  assigned_to?: string | null;
};

const EDITABLE_FIELDS = [
  'kind',
  'first_name',
  'last_name',
  'display_name',
  'company_name',
  'phone',
  'email',
  'address',
  'mailing_address',
  'preferred_contact_method',
  'source',
  'assigned_to',
] as const;

function blankToNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isManager(role?: string) {
  return role === 'owner' || role === 'admin';
}

function userName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim() || null;
}

async function validateAssignee(
  assignedTo: string | null | undefined,
  scope: TenantScope,
  role: string | undefined
) {
  if (assignedTo == null) return;
  if (!isManager(role) && assignedTo !== scope.userId) {
    throw new ContactAssigneeError('Only an owner or admin can give a contact to someone else', 403);
  }
  const found = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND status = 'active' AND company_id = $2 LIMIT 1`,
    [assignedTo, scope.companyId]
  );
  if (found.rowCount === 0) throw new ContactAssigneeError('Assignee not found', 404);
}

// ---------------------------------------------------------------------------
// Writing contacts. Leads and jobs call these too, inside their own
// transactions, so they take a client.
// ---------------------------------------------------------------------------

/** Inserts a contact and returns its id. Blank strings are stored as NULL. */
export async function insertContact(
  db: Queryable,
  companyId: string,
  createdBy: string | null,
  fields: ContactFields
): Promise<number> {
  const result = await db.query(
    `INSERT INTO contacts (
       company_id, user_id, assigned_to, kind, first_name, last_name, display_name,
       company_name, phone, email, address, mailing_address, preferred_contact_method, source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      companyId,
      createdBy,
      fields.assigned_to ?? null,
      fields.kind ?? 'homeowner',
      blankToNull(fields.first_name),
      blankToNull(fields.last_name),
      blankToNull(fields.display_name),
      blankToNull(fields.company_name),
      blankToNull(fields.phone),
      blankToNull(fields.email),
      blankToNull(fields.address),
      blankToNull(fields.mailing_address),
      blankToNull(fields.preferred_contact_method),
      blankToNull(fields.source),
    ]
  );
  return result.rows[0].id as number;
}

/** Updates the named fields of a contact in a company. Returns false if it isn't there. */
export async function updateContactFields(
  db: Queryable,
  companyId: string,
  contactId: number,
  fields: ContactFields
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [contactId, companyId];
  for (const key of EDITABLE_FIELDS) {
    if (!(key in fields)) continue;
    const raw = (fields as Record<string, unknown>)[key];
    values.push(key === 'kind' || key === 'assigned_to' ? (raw ?? null) : blankToNull(raw));
    sets.push(`${key} = $${values.length}`);
  }
  if (sets.length === 0) return true;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  const result = await db.query(
    `UPDATE contacts SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
    values
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * A live contact in the company: a merged one is refused, naming the contact
 * it went into. Locks nothing.
 */
export async function requireLiveContact(db: Queryable, companyId: string, contactId: number) {
  const result = await db.query(
    `SELECT id, merged_into_id, first_name, last_name, display_name, company_name,
            phone, email, address, preferred_contact_method
     FROM contacts WHERE id = $1 AND company_id = $2`,
    [contactId, companyId]
  );
  const row = result.rows[0];
  if (!row) throw new ContactNotFoundError();
  if (row.merged_into_id != null) throw new ContactMergedError(row.merged_into_id);
  return row as {
    id: number;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    company_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    preferred_contact_method: string | null;
  };
}

/**
 * The lead's contact, made from the lead the way migration 0004 does when it
 * has none (a lead written by code that predates contacts). Returns its id.
 */
export async function ensureLeadContact(db: Queryable, companyId: string, leadId: number) {
  const lead = (
    await db.query(
      `SELECT id, contact_id, user_id, assigned_to, first_name, last_name, email, phone,
              preferred_contact_method, source, created_at, updated_at
       FROM leads WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [leadId, companyId]
    )
  ).rows[0];
  if (!lead) return null;
  if (lead.contact_id != null) return lead.contact_id as number;

  const address = (
    await db.query(
      `SELECT address FROM jobs
       WHERE lead_id = $1 AND company_id = $2 AND COALESCE(btrim(address), '') <> ''
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [leadId, companyId]
    )
  ).rows[0]?.address;
  const named = blankToNull(lead.first_name) || blankToNull(lead.last_name);
  const contactId = await insertContact(db, companyId, lead.user_id, {
    assigned_to: lead.assigned_to,
    first_name: lead.first_name,
    last_name: lead.last_name,
    display_name: named ? null : `Lead #${lead.id}`,
    phone: lead.phone,
    email: lead.email,
    address: address ?? null,
    preferred_contact_method: lead.preferred_contact_method,
    source: lead.source,
  });
  await db.query(
    `UPDATE contacts SET legacy_lead_id = $1, created_at = $2, updated_at = $3 WHERE id = $4`,
    [lead.id, lead.created_at, lead.updated_at, contactId]
  );
  await db.query(`UPDATE leads SET contact_id = $1 WHERE id = $2`, [contactId, lead.id]);
  await db.query(
    `UPDATE jobs SET contact_id = $1 WHERE lead_id = $2 AND company_id = $3 AND contact_id IS NULL`,
    [contactId, lead.id, companyId]
  );
  return contactId;
}

// ---------------------------------------------------------------------------
// Reading contacts.
// ---------------------------------------------------------------------------

/**
 * One row per contact with its name, rep, status chip, last activity and the
 * money of the jobs the viewer can open. `params` already holds what `where`
 * refers to; the visibility predicate for money is appended here.
 */
function contactRowsSql(params: unknown[], scope: TenantScope, where: string) {
  const visibleJobs = tenantPredicate(params, scope, { alias: 'vj', assignedWork: true });
  return `
    SELECT
      c.*,
      ${contactNameSql('c')} AS name,
      au.first_name AS assigned_first_name,
      au.last_name AS assigned_last_name,
      au.email AS assigned_email,
      sx.job_count,
      sx.lead_count,
      sx.customer_since,
      ${contactStatusSql('c')} AS status,
      GREATEST(c.updated_at, sx.work_updated_at, nx.last_note_at) AS last_activity_at,
      COALESCE(mx.lifetime_value, 0) AS lifetime_value,
      COALESCE(mx.owed, 0) AS owed
    FROM contacts c
    LEFT JOIN users au ON au.id = c.assigned_to
    ${contactStatusLateralSql('c')}
    LEFT JOIN LATERAL (
      SELECT MAX(n.created_at) AS last_note_at
      FROM notes n
      WHERE n.company_id = c.company_id
        AND (
          (n.entity_type = 'contact' AND n.entity_id = c.id)
          OR (n.entity_type = 'lead' AND n.entity_id IN (
                SELECT l.id FROM leads l WHERE l.contact_id = c.id AND l.company_id = c.company_id))
          OR (n.entity_type = 'job' AND n.entity_id IN (
                SELECT j.id FROM jobs j WHERE j.contact_id = c.id AND j.company_id = c.company_id))
        )
    ) nx ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        SUM(money_est.contract_total) FILTER (
          WHERE j.status IN (${sqlStatusList(WON_STATUSES)})
        ) AS lifetime_value,
        SUM(money_inv.outstanding_total) AS owed
      FROM jobs j
      ${JOB_MONEY_LATERAL_SQL}
      WHERE j.contact_id = c.id AND j.company_id = c.company_id
        AND EXISTS (SELECT 1 FROM jobs vj WHERE vj.id = j.id AND ${visibleJobs})
    ) mx ON TRUE
    WHERE ${where}
  `;
}

function normalizeContact(row: any) {
  return {
    id: row.id,
    kind: row.kind as ContactKind,
    group: groupOf(row.kind),
    name: row.name ?? contactName(row),
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    display_name: row.display_name ?? null,
    company_name: row.company_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    mailing_address: row.mailing_address ?? null,
    preferred_contact_method: row.preferred_contact_method ?? null,
    source: row.source ?? null,
    status: (row.status ?? null) as ContactStatus | null,
    assigned_to: row.assigned_to ?? null,
    assigned_user:
      row.assigned_to != null
        ? {
            id: row.assigned_to,
            first_name: row.assigned_first_name ?? null,
            last_name: row.assigned_last_name ?? null,
            email: row.assigned_email ?? null,
          }
        : null,
    job_count: Number(row.job_count ?? 0),
    lead_count: Number(row.lead_count ?? 0),
    lifetime_value: Number(row.lifetime_value ?? 0),
    owed: Number(row.owed ?? 0),
    customer_since: row.customer_since ?? null,
    last_activity_at: row.last_activity_at ?? row.updated_at ?? null,
    merged_into_id: row.merged_into_id ?? null,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type ContactSummary = ReturnType<typeof normalizeContact>;

export type ContactTab = 'all' | 'customers' | 'open_leads' | 'past_customers' | 'partners';
export type ContactSort = 'last_activity' | 'name' | 'created';

export type ListContactsFilters = {
  tab?: ContactTab;
  kind?: string;
  assignedTo?: string;
  q?: string;
  place?: string;
  includeArchived?: boolean;
  sort?: ContactSort;
  limit?: number;
  offset?: number;
};

const TAB_STATUS: Partial<Record<ContactTab, ContactStatus>> = {
  customers: 'customer',
  open_leads: 'lead',
  past_customers: 'past_customer',
};

/** The contacts list: every contact in the company, one page at a time. */
export async function listContacts(scope: TenantScope, filters: ListContactsFilters = {}) {
  const params: unknown[] = [scope.companyId];
  const where = ['c.company_id = $1', 'c.merged_into_id IS NULL'];
  if (!filters.includeArchived) where.push('c.archived_at IS NULL');

  if (filters.tab === 'partners') {
    where.push(`c.kind IN (${sqlKindList(PARTNER_KINDS)})`);
  }
  if (filters.kind && (CONTACT_KINDS as readonly string[]).includes(filters.kind)) {
    params.push(filters.kind);
    where.push(`c.kind = $${params.length}`);
  }
  if (filters.assignedTo === 'unassigned') {
    where.push('c.assigned_to IS NULL');
  } else if (filters.assignedTo) {
    params.push(filters.assignedTo);
    where.push(`c.assigned_to = $${params.length}::uuid`);
  }
  const q = filters.q?.trim();
  if (q) {
    params.push(`%${q}%`);
    const like = `$${params.length}`;
    const matches = [
      `${contactNameSql('c')} ILIKE ${like}`,
      `c.email ILIKE ${like}`,
      `c.address ILIKE ${like}`,
      `c.company_name ILIKE ${like}`,
    ];
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) {
      params.push(`%${digits}%`);
      const p = `$${params.length}`;
      matches.push(
        `c.phone_key LIKE ${p}`,
        `EXISTS (SELECT 1 FROM contact_methods m WHERE m.contact_id = c.id AND m.kind = 'phone' AND m.value_key LIKE ${p})`
      );
    }
    where.push(`(${matches.join(' OR ')})`);
  }
  const place = filters.place?.trim();
  if (place) {
    params.push(`%${place}%`);
    where.push(`c.address ILIKE $${params.length}`);
  }

  const inner = contactRowsSql(params, scope, where.join(' AND '));
  const outerWhere: string[] = [];
  const tabStatus = filters.tab ? TAB_STATUS[filters.tab] : undefined;
  if (tabStatus) {
    params.push(tabStatus);
    outerWhere.push(`x.status = $${params.length}`);
  }
  const order =
    filters.sort === 'name'
      ? 'lower(x.name) ASC, x.id ASC'
      : filters.sort === 'created'
        ? 'x.created_at DESC, x.id DESC'
        : 'x.last_activity_at DESC NULLS LAST, x.id DESC';

  params.push(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  params.push(Math.max(filters.offset ?? 0, 0));
  const result = await pool.query(
    `SELECT x.*, COUNT(*) OVER ()::int AS total_count
     FROM (${inner}) x
     ${outerWhere.length ? `WHERE ${outerWhere.join(' AND ')}` : ''}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    contacts: result.rows.map(normalizeContact),
    total: result.rows[0]?.total_count ?? (await countOnly()),
  };

  // An empty page still says how many there are (offset past the end).
  async function countOnly() {
    if ((filters.offset ?? 0) === 0) return 0;
    const counted = await pool.query(
      `SELECT COUNT(*)::int AS n FROM (${inner}) x ${
        outerWhere.length ? `WHERE ${outerWhere.join(' AND ')}` : ''
      }`,
      params.slice(0, params.length - 2)
    );
    return counted.rows[0].n as number;
  }
}

async function loadContactRow(scope: TenantScope, id: number) {
  const params: unknown[] = [scope.companyId, id];
  const result = await pool.query(
    contactRowsSql(params, scope, 'c.company_id = $1 AND c.id = $2'),
    params
  );
  if (result.rowCount === 0) throw new ContactNotFoundError();
  return result.rows[0];
}

function leadLabel(lead: { service_type?: string | null; source?: string | null; created_at?: Date | string | null; id: number }) {
  const parts = [blankToNull(lead.service_type) ?? 'Inquiry'];
  if (blankToNull(lead.source)) parts.push(String(lead.source).trim());
  if (lead.created_at) {
    parts.push(
      new Date(lead.created_at).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    );
  }
  return parts.join(' · ');
}

function jobLabel(job: { title?: string | null; address?: string | null; id: number }) {
  return [blankToNull(job.title) ?? `Job #${job.id}`, blankToNull(job.address)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The contact's leads and jobs, split into what the viewer can open and what
 * they can't. Every lead and job of the contact counts toward the status
 * chip; only the visible ones come back with details.
 */
async function loadWork(scope: TenantScope, contactId: number) {
  const leadParams: unknown[] = [contactId, scope.companyId];
  const leadVisible = tenantPredicate(leadParams, scope, { alias: 'l', assignedWork: true });
  const leads = (
    await pool.query(
      `SELECT l.id, l.status, l.service_type, l.source, l.urgency, l.created_at, l.updated_at,
              l.status_changed_at, l.assigned_to, au.first_name AS assigned_first_name,
              au.last_name AS assigned_last_name, (${leadVisible}) AS visible
       FROM leads l
       LEFT JOIN users au ON au.id = l.assigned_to
       WHERE l.contact_id = $1 AND l.company_id = $2
       ORDER BY l.created_at DESC, l.id DESC`,
      leadParams
    )
  ).rows;

  const jobParams: unknown[] = [contactId, scope.companyId];
  const jobVisible = tenantPredicate(jobParams, scope, { alias: 'j', assignedWork: true });
  const jobs = (
    await pool.query(
      `SELECT j.id, j.title, j.status, j.address, j.address_key, j.lead_id, j.created_at,
              j.updated_at, j.sold_at, j.assigned_to, au.first_name AS assigned_first_name,
              au.last_name AS assigned_last_name, (${jobVisible}) AS visible,
              money_est.contract_total, money_inv.outstanding_total
       FROM jobs j
       LEFT JOIN users au ON au.id = j.assigned_to
       ${JOB_MONEY_LATERAL_SQL}
       WHERE j.contact_id = $1 AND j.company_id = $2
       ORDER BY j.created_at DESC, j.id DESC`,
      jobParams
    )
  ).rows;

  return { leads, jobs };
}

/**
 * Other reps' work on a contact, as a count per rep with no links: what an
 * agent sees in place of leads and jobs they can't open. The owner's
 * direction is a line like "2 jobs · Jason Cox (rep)"; the details are
 * settled with the record page (plan section 9).
 */
function otherWork(leads: any[], jobs: any[]) {
  const byRep = new Map<
    string,
    { rep: { id: string; name: string | null } | null; leads: number; jobs: number }
  >();
  const add = (row: any, field: 'leads' | 'jobs') => {
    const key = row.assigned_to ?? 'unassigned';
    if (!byRep.has(key)) {
      byRep.set(key, {
        rep:
          row.assigned_to != null
            ? { id: row.assigned_to, name: userName(row.assigned_first_name, row.assigned_last_name) }
            : null,
        leads: 0,
        jobs: 0,
      });
    }
    byRep.get(key)![field] += 1;
  };
  for (const lead of leads) if (!lead.visible) add(lead, 'leads');
  for (const job of jobs) if (!job.visible) add(job, 'jobs');
  return [...byRep.values()];
}

/** A contact's record page: details, its work, its people and what's next. */
export async function getContact(scope: TenantScope, id: number) {
  const row = await loadContactRow(scope, id);
  const contact = normalizeContact(row);

  const [methods, work] = await Promise.all([
    pool.query(
      `SELECT id, kind, value, label, person_name, created_at
       FROM contact_methods WHERE contact_id = $1 AND company_id = $2
       ORDER BY kind, id`,
      [id, scope.companyId]
    ),
    loadWork(scope, id),
  ]);

  const visibleLeads = work.leads.filter((lead) => lead.visible);
  const visibleJobs = work.jobs.filter((job) => job.visible);
  const visibleLeadIds = visibleLeads.map((lead) => lead.id);
  const visibleJobIds = visibleJobs.map((job) => job.id);

  // Properties: the distinct site addresses of the jobs the viewer can open.
  const properties = new Map<string, { address: string; job_ids: number[] }>();
  for (const job of visibleJobs) {
    const key = job.address_key ?? blankToNull(job.address)?.toLowerCase();
    if (!key) continue;
    if (!properties.has(key)) properties.set(key, { address: job.address, job_ids: [] });
    properties.get(key)!.job_ids.push(job.id);
  }

  // People. For a client: the partners linked to its jobs. For a partner:
  // the jobs it is linked to. Either way, only jobs the viewer can open.
  let people: any[];
  if (contact.group === 'partner') {
    const params: unknown[] = [id, scope.companyId];
    const visible = tenantPredicate(params, scope, { alias: 'j', assignedWork: true });
    people = (
      await pool.query(
        `SELECT jc.role, jc.note, j.id AS job_id, j.title AS job_title, j.address AS job_address
         FROM job_contacts jc
         JOIN jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
         WHERE jc.contact_id = $1 AND jc.company_id = $2 AND ${visible}
         ORDER BY jc.created_at`,
        params
      )
    ).rows;
  } else {
    people = (
      await pool.query(
        `SELECT jc.role, jc.note, jc.contact_id, ${contactNameSql('p')} AS name, p.kind,
                p.company_name, p.phone, j.id AS job_id, j.title AS job_title
         FROM job_contacts jc
         JOIN contacts p ON p.id = jc.contact_id AND p.company_id = jc.company_id
         JOIN jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
         WHERE jc.company_id = $1 AND jc.job_id = ANY($2::int[])
         ORDER BY jc.created_at`,
        [scope.companyId, visibleJobIds]
      )
    ).rows;
  }

  // Up next: open tasks on the contact and on its leads and jobs that the
  // viewer can see on their own task list.
  const taskParams: unknown[] = [id, visibleLeadIds, visibleJobIds];
  const taskVisible = tenantPredicate(taskParams, scope, { alias: 't', assignedWork: true });
  const upNext = (
    await pool.query(
      `SELECT t.id, t.title, t.kind, t.status, t.due_date, t.end_at, t.location,
              t.lead_id, t.job_id, t.contact_id, t.assigned_to,
              au.first_name AS assigned_first_name, au.last_name AS assigned_last_name,
              (t.due_date IS NOT NULL AND COALESCE(t.end_at, t.due_date) < NOW()) AS overdue
       FROM tasks t
       LEFT JOIN users au ON au.id = t.assigned_to
       WHERE (t.contact_id = $1 OR t.lead_id = ANY($2::int[]) OR t.job_id = ANY($3::int[]))
         AND t.status <> 'Completed'
         AND ${taskVisible}
       ORDER BY t.due_date ASC NULLS LAST, t.id ASC
       LIMIT 20`,
      taskParams
    )
  ).rows;

  const leadById = new Map(visibleLeads.map((lead) => [lead.id, lead]));
  const jobById = new Map(visibleJobs.map((job) => [job.id, job]));

  return {
    contact,
    methods: methods.rows,
    leads: visibleLeads.map((lead) => ({
      id: lead.id,
      label: leadLabel(lead),
      status: lead.status,
      open: isOpenLeadStatus(lead.status),
      service_type: lead.service_type ?? null,
      source: lead.source ?? null,
      created_at: lead.created_at,
      assigned_user: lead.assigned_to
        ? { id: lead.assigned_to, name: userName(lead.assigned_first_name, lead.assigned_last_name) }
        : null,
    })),
    jobs: visibleJobs.map((job) => ({
      id: job.id,
      title: job.title,
      label: jobLabel(job),
      status: job.status,
      phase: phaseOf(job.status),
      address: job.address ?? null,
      lead_id: job.lead_id ?? null,
      contract_total: Number(job.contract_total ?? 0),
      owed: Number(job.outstanding_total ?? 0),
      created_at: job.created_at,
      assigned_user: job.assigned_to
        ? { id: job.assigned_to, name: userName(job.assigned_first_name, job.assigned_last_name) }
        : null,
    })),
    other_work: otherWork(work.leads, work.jobs),
    properties: [...properties.values()],
    people:
      contact.group === 'partner'
        ? people.map((link: any) => ({
            role: link.role,
            note: link.note ?? null,
            job: { id: link.job_id, title: link.job_title, address: link.job_address ?? null },
          }))
        : people.map((link: any) => ({
            role: link.role,
            note: link.note ?? null,
            contact: {
              id: link.contact_id,
              name: link.name,
              kind: link.kind,
              company_name: link.company_name ?? null,
              phone: link.phone ?? null,
            },
            job: { id: link.job_id, title: link.job_title },
          })),
    up_next: upNext.map((task: any) => ({
      id: task.id,
      title: task.title,
      kind: task.kind,
      status: task.status,
      due_date: task.due_date,
      end_at: task.end_at ?? null,
      location: task.location ?? null,
      overdue: Boolean(task.overdue),
      on:
        task.contact_id != null
          ? { type: 'contact', id: task.contact_id, label: contact.name }
          : task.job_id != null
            ? { type: 'job', id: task.job_id, label: jobLabel(jobById.get(task.job_id) ?? { id: task.job_id }) }
            : { type: 'lead', id: task.lead_id, label: leadLabel(leadById.get(task.lead_id) ?? { id: task.lead_id }) },
      assigned_user: task.assigned_to
        ? { id: task.assigned_to, name: userName(task.assigned_first_name, task.assigned_last_name) }
        : null,
    })),
  };
}

export async function createContact(scope: TenantScope, role: string | undefined, input: ContactFields) {
  await validateAssignee(input.assigned_to, scope, role);
  const id = await insertContact(pool, scope.companyId, scope.userId, input);
  return getContact(scope, id);
}

export async function updateContact(
  scope: TenantScope,
  role: string | undefined,
  id: number,
  input: ContactFields
) {
  await requireLiveContact(pool, scope.companyId, id);
  if ('assigned_to' in input) {
    const current: string | null =
      (await pool.query(`SELECT assigned_to FROM contacts WHERE id = $1`, [id])).rows[0]
        ?.assigned_to ?? null;
    const next = input.assigned_to ?? null;
    // An agent may take a contact nobody has, or let go of their own;
    // moving one between reps is for owners and admins.
    if (next !== current && !isManager(role) && current != null && current !== scope.userId) {
      throw new ContactAssigneeError('Only an owner or admin can change another rep’s contact', 403);
    }
    if (next !== current) await validateAssignee(next, scope, role);
  }
  const found = await updateContactFields(pool, scope.companyId, id, input);
  if (!found) throw new ContactNotFoundError();
  return getContact(scope, id);
}

// ---------------------------------------------------------------------------
// Possible duplicates: warn, don't block (plan section 7). Checked across the
// whole company, since every member sees every contact.
// ---------------------------------------------------------------------------

export async function findMatches(
  scope: TenantScope,
  input: { phone?: string | null; email?: string | null; address?: string | null; exclude?: number | null }
) {
  const keys = (
    await pool.query(
      `SELECT public.crm_phone_key($1) AS phone_key, public.crm_email_key($2) AS email_key,
              public.crm_address_key($3) AS address_key`,
      [blankToNull(input.phone), blankToNull(input.email), blankToNull(input.address)]
    )
  ).rows[0] as { phone_key: string | null; email_key: string | null; address_key: string | null };

  if (!keys.phone_key && !keys.email_key && !keys.address_key) return [];

  const result = await pool.query(
    `SELECT c.id, ${contactNameSql('c')} AS name, c.kind, c.address, c.phone, c.email,
            (c.phone_key = $2 OR EXISTS (
               SELECT 1 FROM contact_methods m
               WHERE m.contact_id = c.id AND m.kind = 'phone' AND m.value_key = $2)) AS same_phone,
            (c.email_key = $3 OR EXISTS (
               SELECT 1 FROM contact_methods m
               WHERE m.contact_id = c.id AND m.kind = 'email' AND m.value_key = $3)) AS same_email,
            (c.address_key = $4 OR EXISTS (
               SELECT 1 FROM jobs j
               WHERE j.contact_id = c.id AND j.company_id = c.company_id AND j.address_key = $4)) AS same_address
     FROM contacts c
     WHERE c.company_id = $1
       AND c.merged_into_id IS NULL
       AND c.archived_at IS NULL
       AND ($5::int IS NULL OR c.id <> $5)
       AND (
         ($2::text IS NOT NULL AND (c.phone_key = $2 OR EXISTS (
            SELECT 1 FROM contact_methods m WHERE m.contact_id = c.id AND m.kind = 'phone' AND m.value_key = $2)))
         OR ($3::text IS NOT NULL AND (c.email_key = $3 OR EXISTS (
            SELECT 1 FROM contact_methods m WHERE m.contact_id = c.id AND m.kind = 'email' AND m.value_key = $3)))
         OR ($4::text IS NOT NULL AND (c.address_key = $4 OR EXISTS (
            SELECT 1 FROM jobs j WHERE j.contact_id = c.id AND j.company_id = c.company_id AND j.address_key = $4)))
       )
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT 3`,
    [scope.companyId, keys.phone_key, keys.email_key, keys.address_key, input.exclude ?? null]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    address: row.address ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    same: [
      ...(row.same_phone ? ['phone'] : []),
      ...(row.same_email ? ['email'] : []),
      ...(row.same_address ? ['address'] : []),
    ],
  }));
}

// ---------------------------------------------------------------------------
// History: one feed across the contact and the leads and jobs the viewer can
// open, newest first, 50 at a time (plan section 5.3).
// ---------------------------------------------------------------------------

export const HISTORY_KINDS = ['calls', 'notes', 'status', 'money', 'files', 'jobs'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export class HistoryCursorError extends Error {
  status = 400;
  constructor() {
    super('Invalid cursor');
    this.name = 'HistoryCursorError';
  }
}

// A cursor is the last entry's time to the microsecond (a JS Date would round
// to the millisecond and skip entries) and its key: 2026-11-17T12:00:00.123456Z|n000000000042.
function parseCursor(cursor?: string | null) {
  if (!cursor) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([a-z]\d{12})$/.exec(cursor);
  if (!match || Number.isNaN(new Date(match[1]).getTime())) throw new HistoryCursorError();
  return { when: match[1], key: match[2] };
}

export async function getContactHistory(
  scope: TenantScope,
  id: number,
  options: { kind?: HistoryKind; cursor?: string | null; limit?: number } = {}
) {
  await loadContactRow(scope, id);
  const work = await loadWork(scope, id);
  const leads = work.leads.filter((lead) => lead.visible);
  const jobs = work.jobs.filter((job) => job.visible);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const cursor = parseCursor(options.cursor);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const params: unknown[] = [
    scope.companyId,
    id,
    leads.map((lead) => lead.id),
    jobs.map((job) => job.id),
    options.kind ?? null,
    cursor?.when ?? null,
    cursor?.key ?? null,
    limit + 1,
  ];

  const result = await pool.query(
    `SELECT h.*, u.first_name AS actor_first_name, u.last_name AS actor_last_name,
            to_char(h.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_text
     FROM (
       SELECT n.created_at AS at, 'n' || lpad(n.id::text, 12, '0') AS key,
              CASE WHEN n.type = 'note' THEN 'notes' ELSE 'calls' END AS kind,
              n.type AS subtype, n.direction, NULL::text AS title, n.body,
              n.entity_type AS on_type, n.entity_id AS on_id, n.user_id AS actor_id, n.id AS source_id
       FROM notes n
       WHERE n.company_id = $1
         AND ((n.entity_type = 'contact' AND n.entity_id = $2)
           OR (n.entity_type = 'lead' AND n.entity_id = ANY($3::int[]))
           OR (n.entity_type = 'job' AND n.entity_id = ANY($4::int[])))
       UNION ALL
       SELECT l.created_at, 'l' || lpad(l.id::text, 12, '0'), 'status', 'lead_created', NULL,
              'Lead created', NULL, 'lead', l.id, l.user_id, l.id
       FROM leads l
       WHERE l.company_id = $1 AND l.id = ANY($3::int[])
       UNION ALL
       SELECT e.changed_at, 's' || lpad(e.id::text, 12, '0'), 'status', 'lead_status', NULL,
              concat_ws(' → ', e.from_status, e.to_status), NULL, 'lead', e.lead_id, NULL, e.id
       FROM lead_status_events e
       WHERE e.company_id = $1 AND e.lead_id = ANY($3::int[])
       UNION ALL
       SELECT a.created_at, 'a' || lpad(a.id::text, 12, '0'),
              CASE
                WHEN a.type = 'JOB_STATUS_CHANGED' THEN 'status'
                WHEN a.type LIKE 'ESTIMATE\\_%' OR a.type LIKE 'INVOICE\\_%' OR a.type LIKE 'PAYMENT\\_%' THEN 'money'
                ELSE 'jobs'
              END,
              a.type, NULL, a.title, a.message, 'job', a.job_id, a.user_id, a.id
       FROM job_activity a
       WHERE a.company_id = $1 AND a.job_id = ANY($4::int[])
         -- Notes, tasks and files come from their own tables (or Up next).
         AND a.type <> 'COMMUNICATION_LOGGED'
         AND a.type NOT LIKE 'TASK\\_%'
         AND a.type NOT LIKE 'FILE\\_%'
       UNION ALL
       SELECT f.created_at, 'f' || lpad(f.id::text, 12, '0'), 'files', f.category, NULL,
              f.original_name, f.caption,
              CASE WHEN f.job_id IS NOT NULL THEN 'job' ELSE 'lead' END,
              COALESCE(f.job_id, f.lead_id), f.uploaded_by_user_id, f.id
       FROM files f
       WHERE f.company_id = $1 AND (f.job_id = ANY($4::int[]) OR f.lead_id = ANY($3::int[]))
     ) h
     LEFT JOIN users u ON u.id = h.actor_id
     WHERE ($5::text IS NULL OR h.kind = $5)
       AND ($6::timestamptz IS NULL OR (h.at, h.key) < ($6::timestamptz, $7::text))
     ORDER BY h.at DESC, h.key DESC
     LIMIT $8`,
    params
  );

  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    entries: rows.map((row: any) => ({
      id: row.key,
      kind: row.kind as HistoryKind,
      subtype: row.subtype ?? null,
      direction: row.direction ?? null,
      title: row.title ?? null,
      body: row.body ?? null,
      at: row.at,
      actor: row.actor_id
        ? { id: row.actor_id, name: userName(row.actor_first_name, row.actor_last_name) }
        : null,
      on:
        row.on_type === 'contact'
          ? { type: 'contact', id: row.on_id, label: 'Contact' }
          : row.on_type === 'job'
            ? { type: 'job', id: row.on_id, label: jobLabel(jobById.get(row.on_id) ?? { id: row.on_id }) }
            : { type: 'lead', id: row.on_id, label: leadLabel(leadById.get(row.on_id) ?? { id: row.on_id }) },
      source_id: row.source_id,
    })),
    next_cursor:
      result.rows.length > limit && last ? `${last.at_text}|${last.key}` : null,
  };
}
