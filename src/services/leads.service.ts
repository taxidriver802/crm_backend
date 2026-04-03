import { pool } from '../db';

export class LeadNotFoundError extends Error {
  constructor(message = 'Lead not found') {
    super(message);
    this.name = 'LeadNotFoundError';
  }
}

export type GetLeadsFilters = {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CreateLeadInput = {
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

export async function getLeadSummary(userId: string) {
  const [totalResult, byStatusResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM leads WHERE user_id = $1`, [
      userId,
    ]),
    pool.query(
      `
      SELECT status, COUNT(*)::int AS count
      FROM leads
      WHERE user_id = $1
      GROUP BY status
      ORDER BY count DESC;
      `,
      [userId]
    ),
  ]);

  return {
    total: totalResult.rows[0].total,
    byStatus: byStatusResult.rows,
  };
}

export async function getLeads(userId: string, filters: GetLeadsFilters) {
  const params: any[] = [userId];
  const where: string[] = ['t.user_id = $1'];

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

  params.push(filters.limit ?? 50);
  params.push(filters.offset ?? 0);

  const sql = `
    SELECT t.*
    FROM leads t
    WHERE ${where.join(' AND ')}
    ORDER BY t.created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getLeadById(userId: string, id: number) {
  const result = await pool.query(
    `SELECT * FROM leads WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0];
}

export async function createLead(userId: string, input: CreateLeadInput) {
  const result = await pool.query(
    `
    INSERT INTO leads (
      user_id, first_name, last_name, email, phone, source, status,
      budget_min, budget_max, notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *;
    `,
    [
      userId,
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

  return result.rows[0];
}

export async function updateLead(
  userId: string,
  id: number,
  updates: UpdateLeadInput
) {
  const keys = Object.keys(updates) as (keyof UpdateLeadInput)[];

  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }

  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  const sql = `
    UPDATE leads
    SET ${setParts.join(', ')}
    WHERE user_id = $1 AND id = $2
    RETURNING *;
  `;

  const result = await pool.query(sql, values);

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0];
}

export async function deleteLead(userId: string, id: number) {
  const result = await pool.query(
    `DELETE FROM leads WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new LeadNotFoundError();
  }

  return result.rows[0].id;
}
