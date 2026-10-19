import { pool } from '../db';

type EntityType = 'lead' | 'job';

function sameAssignee(left?: string | null, right?: string | null) {
  return (left ?? null) === (right ?? null);
}

export async function recordInitialAssignment({
  companyId,
  entityType,
  entityId,
  userId,
  assignedAt,
}: {
  companyId: string;
  entityType: EntityType;
  entityId: number;
  userId: string | null;
  assignedAt: string | Date;
}) {
  await pool.query(
    `
    INSERT INTO assignment_events (
      company_id, entity_type, entity_id, user_id, assigned_at
    )
    VALUES ($1, $2, $3, $4, $5)
    `,
    [companyId, entityType, entityId, userId, assignedAt]
  );
}

/**
 * Appends the new assignee. The first change on a record that predates this
 * table also stores the previous assignee at the record's created_at, so
 * earlier outcomes stay with the person who held it.
 */
export async function recordAssignmentChange({
  companyId,
  entityType,
  entityId,
  previousUserId,
  nextUserId,
  entityCreatedAt,
  assignedAt,
}: {
  companyId: string;
  entityType: EntityType;
  entityId: number;
  previousUserId: string | null;
  nextUserId: string | null;
  entityCreatedAt: string | Date;
  assignedAt: string | Date;
}) {
  if (sameAssignee(previousUserId, nextUserId)) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `
      SELECT 1
      FROM assignment_events
      WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3
      LIMIT 1
      `,
      [companyId, entityType, entityId]
    );

    if ((existing.rowCount ?? 0) === 0) {
      await client.query(
        `
        INSERT INTO assignment_events (
          company_id, entity_type, entity_id, user_id, assigned_at
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [companyId, entityType, entityId, previousUserId, entityCreatedAt]
      );
    }

    await client.query(
      `
      INSERT INTO assignment_events (
        company_id, entity_type, entity_id, user_id, assigned_at
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [companyId, entityType, entityId, nextUserId, assignedAt]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordLeadStatusChange({
  companyId,
  leadId,
  fromStatus,
  toStatus,
  changedAt,
}: {
  companyId: string;
  leadId: number;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string | Date;
}) {
  await pool.query(
    `
    INSERT INTO lead_status_events (
      company_id, lead_id, from_status, to_status, changed_at
    )
    VALUES ($1, $2, $3, $4, $5)
    `,
    [companyId, leadId, fromStatus, toStatus, changedAt]
  );
}
