import { pool } from '../db';
import { daysInStatus } from '../lib/aging';
import { notifyAssigneeChange } from '../lib/notifications';
import { contactNameSql, groupOf } from '../lib/contacts';
import { applyTenantScope, tenantPredicate, tenantScope } from '../lib/tenant';
import {
  ensureLeadContact,
  insertContact,
  requireLiveContact,
  updateContactFields,
} from './contacts.service';
import { trackEvent } from './productEvents.service';
import {
  recordAssignmentChange,
  recordInitialAssignment,
  recordLeadStatusChange,
} from './performanceHistory.service';

export class LeadNotFoundError extends Error {
  constructor(message = 'Lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

export class AssigneeNotFoundError extends Error {
  constructor(message = 'Assignee not found') {
    super(message);
    this.name = 'AssigneeNotFoundError';
  }
}

export class AssignmentPermissionError extends Error {
  constructor(message = 'Not allowed to assign to that user') {
    super(message);
    this.name = 'AssignmentPermissionError';
  }
}

export type GetLeadsFilters = {
  status?: string;
  assignedTo?: string;
  q?: string;
  includeAll?: boolean;
  companyId?: string;
  limit?: number;
  offset?: number;
};

export type CreateLeadInput = {
  assigned_to?: string | null;
  /** An existing contact this inquiry is from. Without it, one is made. */
  contact_id?: number | null;
  /** The contact's home address, when a new contact is made. */
  address?: string | null;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  notes?: string | null;
  service_type?: string | null;
  preferred_contact_method?: string | null;
  urgency?: string | null;
};

export type UpdateLeadInput = Partial<Omit<CreateLeadInput, 'contact_id' | 'address'>>;

/**
 * The person's fields. A lead keeps its own copy as the "as submitted"
 * record of what came in; the screens and the API show the contact's, and an
 * edit changes the contact (plan section 3.3).
 */
const PERSON_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'preferred_contact_method',
] as const;

const LEAD_SELECT = `
  SELECT
    t.*,
    au.first_name AS assigned_first_name,
    au.last_name AS assigned_last_name,
    au.email AS assigned_email,
    c.first_name AS contact_first_name,
    c.last_name AS contact_last_name,
    c.email AS contact_email,
    c.phone AS contact_phone,
    c.preferred_contact_method AS contact_preferred_contact_method,
    c.kind AS contact_kind,
    c.address AS contact_address,
    ${contactNameSql('c')} AS contact_name
  FROM leads t
  LEFT JOIN users au ON au.id = t.assigned_to
  LEFT JOIN contacts c ON c.id = t.contact_id AND c.company_id = t.company_id
`;

function normalizeLead(row: any) {
  const {
    contact_first_name,
    contact_last_name,
    contact_email,
    contact_phone,
    contact_preferred_contact_method,
    contact_kind,
    contact_address,
    contact_name,
    ...lead
  } = row;
  const hasContact = lead.contact_id != null;
  // A contact with no first or last name (a household or company name only)
  // still gives the older screens something to show.
  const contactFirst =
    contact_first_name ?? (contact_last_name ? '' : (contact_name ?? ''));
  return {
    ...lead,
    first_name: hasContact ? contactFirst : lead.first_name,
    last_name: hasContact ? (contact_last_name ?? '') : lead.last_name,
    email: hasContact ? (contact_email ?? null) : lead.email,
    phone: hasContact ? (contact_phone ?? null) : lead.phone,
    preferred_contact_method: hasContact
      ? (contact_preferred_contact_method ?? null)
      : lead.preferred_contact_method,
    name:
      (hasContact ? contact_name : null) ??
      (`${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || `Lead #${lead.id}`),
    submitted: {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      preferred_contact_method: lead.preferred_contact_method ?? null,
    },
    contact: hasContact
      ? {
          id: lead.contact_id,
          name: contact_name,
          kind: contact_kind,
          group: groupOf(contact_kind),
          phone: contact_phone ?? null,
          email: contact_email ?? null,
          address: contact_address ?? null,
        }
      : null,
    status_changed_at: row.status_changed_at ?? null,
    days_in_status: daysInStatus(row.status_changed_at),
    assigned_user:
      row.assigned_to != null
        ? {
            id: row.assigned_to,
            first_name: row.assigned_first_name ?? null,
            last_name: row.assigned_last_name ?? null,
            email: row.assigned_email ?? null,
          }
        : null,
  };
}

async function validateAssignee(
  assignedTo: string | null | undefined,
  actorUserId: string,
  actorRole: string | undefined,
  companyId: string
) {
  if (assignedTo == null) return;

  const canAssignTeam = actorRole === 'owner' || actorRole === 'admin';
  if (!canAssignTeam && assignedTo !== actorUserId) {
    throw new AssignmentPermissionError();
  }

  const assignee = await pool.query(
    `
    SELECT id
    FROM users
    WHERE id = $1 AND status = 'active' AND company_id = $2
    LIMIT 1
    `,
    [assignedTo, companyId]
  );

  if (assignee.rowCount === 0) {
    throw new AssigneeNotFoundError();
  }
}

export async function getLeadSummary(
  userId: string,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: unknown[] = [];
  const scopeWhere = tenantPredicate(params, scope, { assignedWork: true });

  const [totalResult, byStatusResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM leads WHERE ${scopeWhere}`,
      params
    ),
    pool.query(
      `
      SELECT status, COUNT(*)::int AS count
      FROM leads
      WHERE ${scopeWhere}
      GROUP BY status
      ORDER BY count DESC;
      `,
      params
    ),
  ]);

  return {
    total: totalResult.rows[0].total,
    byStatus: byStatusResult.rows,
  };
}

export async function getLeads(userId: string, filters: GetLeadsFilters) {
  const params: any[] = [];
  const where: string[] = [];
  const scope = await tenantScope(userId, filters);
  applyTenantScope(where, params, scope, { alias: 't', assignedWork: true });

  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(
      `(${contactNameSql('c')} ILIKE ${p} OR c.email ILIKE ${p} OR c.phone ILIKE ${p}
        OR t.first_name ILIKE ${p} OR t.last_name ILIKE ${p} OR t.email ILIKE ${p} OR t.phone ILIKE ${p})`
    );
  }

  if (filters.assignedTo === 'unassigned') {
    where.push(`t.assigned_to IS NULL`);
  } else if (filters.assignedTo) {
    params.push(filters.assignedTo);
    where.push(`t.assigned_to = $${params.length}`);
  }

  params.push(filters.limit ?? 50);
  params.push(filters.offset ?? 0);

  const sql = `
    ${LEAD_SELECT}
    WHERE ${where.length > 0 ? where.join(' AND ') : 'TRUE'}
    ORDER BY t.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return result.rows.map(normalizeLead);
}

export async function getLeadById(
  userId: string,
  id: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const params: any[] = [id];
  const where: string[] = ['t.id = $1'];
  const scope = await tenantScope(userId, options);
  applyTenantScope(where, params, scope, { alias: 't', assignedWork: true });

  const result = await pool.query(
    `
    ${LEAD_SELECT}
    WHERE ${where.join(' AND ')}
    LIMIT 1
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return normalizeLead(result.rows[0]);
}

export async function createLead(
  userId: string,
  input: CreateLeadInput,
  actor: { role?: string; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, actor);
  await validateAssignee(input.assigned_to, userId, actor.role, scope.companyId);

  // One inquiry from a contact: the one named, or a new one made from what
  // was typed. The lead keeps what was typed as its "as submitted" record.
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    let contactId: number;
    let submitted: {
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
      preferred_contact_method: string | null;
    };
    if (input.contact_id != null) {
      const contact = await requireLiveContact(client, scope.companyId, input.contact_id);
      contactId = contact.id;
      submitted = {
        first_name: input.first_name ?? contact.first_name ?? '',
        last_name: input.last_name ?? contact.last_name ?? '',
        email: input.email ?? contact.email,
        phone: input.phone ?? contact.phone,
        preferred_contact_method:
          input.preferred_contact_method ?? contact.preferred_contact_method,
      };
    } else {
      submitted = {
        first_name: input.first_name ?? '',
        last_name: input.last_name ?? '',
        email: input.email ?? null,
        phone: input.phone ?? null,
        preferred_contact_method: input.preferred_contact_method ?? null,
      };
      contactId = await insertContact(client, scope.companyId, userId, {
        ...submitted,
        address: input.address ?? null,
        source: input.source ?? null,
        assigned_to: input.assigned_to ?? null,
      });
    }

    result = await client.query(
      `
      INSERT INTO leads (
        user_id, assigned_to, first_name, last_name, email, phone, source, status,
        budget_min, budget_max, notes, service_type, preferred_contact_method, urgency,
        company_id, contact_id
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, u.company_id, $16
      FROM users u
      WHERE u.id = $1 AND u.company_id = $15
      RETURNING *;
      `,
      [
        userId,
        input.assigned_to ?? null,
        submitted.first_name,
        submitted.last_name,
        submitted.email,
        submitted.phone,
        input.source ?? null,
        input.status ?? 'New',
        input.budget_min ?? null,
        input.budget_max ?? null,
        input.notes ?? null,
        input.service_type ?? null,
        submitted.preferred_contact_method,
        input.urgency ?? null,
        scope.companyId,
        contactId,
      ]
    );

    if (result.rowCount === 0) {
      throw new LeadNotFoundError();
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const lead = await getLeadById(userId, result.rows[0].id, {
    includeAll: actor.role === 'owner' || actor.role === 'admin',
    companyId: scope.companyId,
  });

  trackEvent('lead_created', { userId, entityType: 'lead', entityId: lead.id });

  await recordInitialAssignment({
    companyId: scope.companyId,
    entityType: 'lead',
    entityId: lead.id,
    userId: lead.assigned_to ?? null,
    assignedAt: lead.created_at,
  });

  await notifyAssigneeChange({
    actorUserId: userId,
    assignedTo: lead.assigned_to,
    type: 'LEAD_ASSIGNED',
    title: 'New lead assigned',
    message: `${lead.name} was assigned to you`,
    entityType: 'lead',
    entityId: lead.id,
  });

  return lead;
}

export async function updateLead(
  userId: string,
  id: number,
  updates: UpdateLeadInput,
  options: { includeAll?: boolean; actorRole?: string; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const existingLead = await getLeadById(userId, id, {
    includeAll: options.includeAll,
    companyId: scope.companyId,
  });

  if ('assigned_to' in updates) {
    await validateAssignee(
      updates.assigned_to,
      userId,
      options.actorRole,
      scope.companyId
    );
  }

  const keys = Object.keys(updates) as (keyof UpdateLeadInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  // The person's fields change the contact (and so every lead and job of
  // that contact); the lead's "as submitted" copy stays as it came in.
  const personKeys = keys.filter((key) =>
    (PERSON_FIELDS as readonly string[]).includes(key)
  );
  const leadKeys = keys.filter(
    (key) => !(PERSON_FIELDS as readonly string[]).includes(key)
  );

  const statusChanged =
    'status' in updates &&
    updates.status != null &&
    updates.status !== existingLead.status;

  const setParts: string[] = [];
  const values: any[] = [id];

  for (const key of leadKeys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  if (statusChanged) {
    setParts.push(`status_changed_at = CURRENT_TIMESTAMP`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  const where: string[] = ['id = $1'];
  applyTenantScope(where, values, scope, { assignedWork: true });

  const sql = `
    UPDATE leads
    SET ${setParts.join(', ')}
    WHERE ${where.join(' AND ')}
    RETURNING id;
  `;

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await client.query(sql, values);
    if (result.rowCount === 0) {
      throw new LeadNotFoundError();
    }
    if (personKeys.length > 0) {
      const contactId = await ensureLeadContact(client, scope.companyId, id);
      const personUpdates = Object.fromEntries(
        personKeys.map((key) => [key, updates[key] ?? null])
      );
      if (contactId != null) {
        await updateContactFields(client, scope.companyId, contactId, personUpdates);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const updated = await getLeadById(userId, result.rows[0].id, {
    includeAll: options.includeAll,
    companyId: scope.companyId,
  });

  if (
    'assigned_to' in updates &&
    (updates.assigned_to ?? null) !== (existingLead.assigned_to ?? null)
  ) {
    await recordAssignmentChange({
      companyId: scope.companyId,
      entityType: 'lead',
      entityId: updated.id,
      previousUserId: existingLead.assigned_to ?? null,
      nextUserId: updated.assigned_to ?? null,
      entityCreatedAt: existingLead.created_at,
      assignedAt: updated.updated_at,
    });
  }

  if (statusChanged && updated.status) {
    await recordLeadStatusChange({
      companyId: scope.companyId,
      leadId: updated.id,
      fromStatus: existingLead.status,
      toStatus: updated.status,
      changedAt: updated.status_changed_at,
    });
  }

  await notifyAssigneeChange({
    actorUserId: userId,
    assignedTo: updated.assigned_to,
    previousAssignedTo: existingLead.assigned_to ?? null,
    type: 'LEAD_ASSIGNED',
    title: 'New lead assigned',
    message: `${updated.name} was assigned to you`,
    entityType: 'lead',
    entityId: updated.id,
  });

  return updated;
}

export async function deleteLead(
  userId: string,
  id: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });

  const result = await pool.query(
    `DELETE FROM leads WHERE ${where.join(' AND ')} RETURNING id`,
    params
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0].id;
}
