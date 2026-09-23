import { pool } from '../db';
import { daysInStatus } from '../lib/aging';
import { applyTenantScope, tenantPredicate, tenantScope } from '../lib/tenant';
import { trackEvent } from './productEvents.service';

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
  first_name: string;
  last_name: string;
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

export type UpdateLeadInput = Partial<CreateLeadInput>;

const LEAD_SELECT = `
  SELECT
    t.*,
    au.first_name AS assigned_first_name,
    au.last_name AS assigned_last_name,
    au.email AS assigned_email
  FROM leads t
  LEFT JOIN users au ON au.id = t.assigned_to
`;

function normalizeLead(row: any) {
  return {
    ...row,
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
  const scopeWhere = tenantPredicate(params, scope);

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
  applyTenantScope(where, params, scope, { alias: 't' });

  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(
      `(t.first_name ILIKE ${p} OR t.last_name ILIKE ${p} OR t.email ILIKE ${p} OR t.phone ILIKE ${p})`
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
  applyTenantScope(where, params, scope, { alias: 't' });

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

  const result = await pool.query(
    `
    INSERT INTO leads (
      user_id, assigned_to, first_name, last_name, email, phone, source, status,
      budget_min, budget_max, notes, service_type, preferred_contact_method, urgency,
      company_id
    )
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, u.company_id
    FROM users u
    WHERE u.id = $1
    RETURNING *;
    `,
    [
      userId,
      input.assigned_to ?? null,
      input.first_name,
      input.last_name,
      input.email ?? null,
      input.phone ?? null,
      input.source ?? null,
      input.status ?? 'New',
      input.budget_min ?? null,
      input.budget_max ?? null,
      input.notes ?? null,
      input.service_type ?? null,
      input.preferred_contact_method ?? null,
      input.urgency ?? null,
    ]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  const lead = await getLeadById(userId, result.rows[0].id, {
    includeAll: actor.role === 'owner' || actor.role === 'admin',
    companyId: scope.companyId,
  });

  trackEvent('lead_created', { userId, entityType: 'lead', entityId: lead.id });

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

  const statusChanged =
    'status' in updates &&
    updates.status != null &&
    updates.status !== existingLead.status;

  const setParts: string[] = [];
  const values: any[] = [id];

  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  if (statusChanged) {
    setParts.push(`status_changed_at = CURRENT_TIMESTAMP`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  const where: string[] = ['id = $1'];
  applyTenantScope(where, values, scope);

  const sql = `
    UPDATE leads
    SET ${setParts.join(', ')}
    WHERE ${where.join(' AND ')}
    RETURNING id;
  `;

  const result = await pool.query(sql, values);

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return getLeadById(userId, result.rows[0].id, {
    includeAll: options.includeAll,
    companyId: scope.companyId,
  });
}

export async function deleteLead(
  userId: string,
  id: number,
  options: { includeAll?: boolean; companyId?: string } = {}
) {
  const scope = await tenantScope(userId, options);
  const params: any[] = [id];
  const where: string[] = ['id = $1'];
  applyTenantScope(where, params, scope);

  const result = await pool.query(
    `DELETE FROM leads WHERE ${where.join(' AND ')} RETURNING id`,
    params
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0].id;
}
