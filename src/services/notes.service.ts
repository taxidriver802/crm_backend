import { pool } from '../db';

export type NoteEntityType = 'lead' | 'job';

export type CreateNoteInput = {
  entity_type: NoteEntityType;
  entity_id: number;
  body: string;
};

export class NoteNotFoundError extends Error {
  constructor(message = 'Note not found') {
    super(message);
    this.name = 'NoteNotFoundError';
  }
}

export class NoteEntityNotFoundError extends Error {
  constructor(message = 'Entity not found') {
    super(message);
    this.name = 'NoteEntityNotFoundError';
  }
}

async function ensureEntityBelongsToUser(
  userId: string,
  entityType: NoteEntityType,
  entityId: number
) {
  if (entityType === 'lead') {
    const result = await pool.query(
      `SELECT id FROM leads WHERE id = $1 AND user_id = $2`,
      [entityId, userId]
    );
    if (result.rowCount === 0) {
      throw new NoteEntityNotFoundError('Lead not found');
    }
    return;
  }

  const result = await pool.query(
    `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`,
    [entityId, userId]
  );
  if (result.rowCount === 0) {
    throw new NoteEntityNotFoundError('Job not found');
  }
}

export async function listNotes(
  userId: string,
  entityType: NoteEntityType,
  entityId: number
) {
  await ensureEntityBelongsToUser(userId, entityType, entityId);

  const result = await pool.query(
    `
    SELECT
      n.id,
      n.user_id,
      n.entity_type,
      n.entity_id,
      n.body,
      n.created_at,
      n.updated_at,
      u.first_name AS author_first_name,
      u.last_name AS author_last_name
    FROM notes n
    JOIN users u ON u.id = n.user_id
    WHERE n.entity_type = $1 AND n.entity_id = $2
    ORDER BY n.created_at DESC, n.id DESC
    `,
    [entityType, entityId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author_name:
      `${row.author_first_name ?? ''} ${row.author_last_name ?? ''}`.trim(),
  }));
}

export async function createNote(userId: string, input: CreateNoteInput) {
  await ensureEntityBelongsToUser(userId, input.entity_type, input.entity_id);

  const result = await pool.query(
    `
    INSERT INTO notes (user_id, entity_type, entity_id, body)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [userId, input.entity_type, input.entity_id, input.body]
  );

  const created = result.rows[0];
  const authorResult = await pool.query(
    `SELECT first_name, last_name FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const author = authorResult.rows[0];

  return {
    ...created,
    author_name:
      `${author?.first_name ?? ''} ${author?.last_name ?? ''}`.trim(),
  };
}

export async function deleteNote(userId: string, id: number) {
  const existingResult = await pool.query(
    `
    SELECT id, user_id
    FROM notes
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  if (existingResult.rowCount === 0) {
    throw new NoteNotFoundError();
  }

  const existing = existingResult.rows[0];
  const isAdmin = await pool.query(
    `SELECT role FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const actorRole = isAdmin.rows[0]?.role;
  const canDelete =
    existing.user_id === userId ||
    actorRole === 'owner' ||
    actorRole === 'admin';

  if (!canDelete) {
    throw new NoteNotFoundError();
  }

  await pool.query(`DELETE FROM notes WHERE id = $1`, [id]);
  return id;
}
