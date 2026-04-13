import { pool } from '../db';

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
  actorRole?: string
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
    WHERE id = $1 AND status = 'active'
    LIMIT 1
    `,
    [assignedTo]
  );

  if (assignee.rowCount === 0) {
    throw new AssigneeNotFoundError();
  }
}

export async function getLeadSummary(
  userId: string,
  options: { includeAll?: boolean } = {}
) {
  const scopeWhere = options.includeAll ? 'TRUE' : 'user_id = $1';
  const params = options.includeAll ? [] : [userId];

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

  if (!filters.includeAll) {
    params.push(userId);
    where.push(`t.user_id = $${params.length}`);
  }

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
  options: { includeAll?: boolean } = {}
) {
  const params: any[] = [id];
  const where: string[] = ['t.id = $1'];
  if (!options.includeAll) {
    params.push(userId);
    where.push(`t.user_id = $${params.length}`);
  }

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
  actor: { role?: string } = {}
) {
  await validateAssignee(input.assigned_to, userId, actor.role);

  const result = await pool.query(
    `
    INSERT INTO leads (
      user_id, assigned_to, first_name, last_name, email, phone, source, status,
      budget_min, budget_max, notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    ]
  );

  return getLeadById(userId, result.rows[0].id, {
    includeAll: actor.role === 'owner' || actor.role === 'admin',
  });
}

export async function updateLead(
  userId: string,
  id: number,
  updates: UpdateLeadInput,
  options: { includeAll?: boolean; actorRole?: string } = {}
) {
  if ('assigned_to' in updates) {
    await validateAssignee(updates.assigned_to, userId, options.actorRole);
  }

  const keys = Object.keys(updates) as (keyof UpdateLeadInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  const setParts: string[] = [];
  const values: any[] = [id];

  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  let whereClause = 'id = $1';
  if (!options.includeAll) {
    values.push(userId);
    whereClause += ` AND user_id = $${values.length}`;
  }

  const sql = `
    UPDATE leads
    SET ${setParts.join(', ')}
    WHERE ${whereClause}
    RETURNING id;
  `;

  const result = await pool.query(sql, values);

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return getLeadById(userId, result.rows[0].id, {
    includeAll: options.includeAll,
  });
}

export async function deleteLead(
  userId: string,
  id: number,
  options: { includeAll?: boolean } = {}
) {
  const params: any[] = [id];
  let whereClause = 'id = $1';
  if (!options.includeAll) {
    params.push(userId);
    whereClause += ` AND user_id = $${params.length}`;
  }

  const result = await pool.query(
    `DELETE FROM leads WHERE ${whereClause} RETURNING id`,
    params
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0].id;
}
