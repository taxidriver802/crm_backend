import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { createJobActivity } from './jobActivity.service';

export type NoteEntityType = 'lead' | 'job';
export type NoteType = 'call' | 'text' | 'email' | 'in_person' | 'note';
export type NoteDirection = 'inbound' | 'outbound' | 'internal';

export type CreateNoteInput = {
  entity_type: NoteEntityType;
  entity_id: number;
  body: string;
  type?: NoteType;
  direction?: NoteDirection;
  follow_up_date?: string;
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

export class InvalidFollowUpDateError extends Error {
  constructor(message = 'Invalid follow_up_date') {
    super(message);
    this.name = 'InvalidFollowUpDateError';
  }
}

const NOTE_SELECT = `
  SELECT
    n.id,
    n.user_id,
    n.entity_type,
    n.entity_id,
    n.body,
    n.type,
    n.direction,
    n.follow_up_task_id,
    n.created_at,
    n.updated_at,
    u.first_name AS author_first_name,
    u.last_name AS author_last_name,
    t.id AS follow_up_task_pk,
    t.title AS follow_up_task_title,
    t.due_date AS follow_up_task_due_date,
    t.status AS follow_up_task_status
  FROM notes n
  JOIN users u ON u.id = n.user_id
  LEFT JOIN tasks t ON t.id = n.follow_up_task_id
`;

function commTypeLabel(type: string) {
  if (type === 'in_person') return 'in person';
  return type || 'note';
}

function commActivityTitle(type: string, direction: string) {
  const dir = direction ? direction.charAt(0).toUpperCase() + direction.slice(1) : 'Internal';
  return `${dir} ${commTypeLabel(type)}`;
}

function mapNote(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    body: row.body,
    type: row.type ?? 'note',
    direction: row.direction ?? 'internal',
    follow_up_task_id: row.follow_up_task_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author_name:
      `${row.author_first_name ?? ''} ${row.author_last_name ?? ''}`.trim(),
    follow_up_task: row.follow_up_task_pk
      ? {
          id: row.follow_up_task_pk,
          title: row.follow_up_task_title,
          due_date: row.follow_up_task_due_date,
          status: row.follow_up_task_status,
        }
      : null,
  };
}

async function loadEntityForUser(
  userId: string,
  entityType: NoteEntityType,
  entityId: number
) {
  if (entityType === 'lead') {
    const result = await pool.query(
      `SELECT id, first_name, last_name FROM leads WHERE id = $1 AND user_id = $2`,
      [entityId, userId]
    );
    if (result.rowCount === 0) {
      throw new NoteEntityNotFoundError('Lead not found');
    }
    const row = result.rows[0];
    const name =
      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || `Lead #${row.id}`;
    return { name };
  }

  const result = await pool.query(
    `SELECT id, title FROM jobs WHERE id = $1 AND user_id = $2`,
    [entityId, userId]
  );
  if (result.rowCount === 0) {
    throw new NoteEntityNotFoundError('Job not found');
  }
  const row = result.rows[0];
  return { name: row.title || `Job #${row.id}` };
}

async function fetchNoteById(id: number) {
  const result = await pool.query(
    `
    ${NOTE_SELECT}
    WHERE n.id = $1
    LIMIT 1
    `,
    [id]
  );
  if (result.rowCount === 0) {
    throw new NoteNotFoundError();
  }
  return mapNote(result.rows[0]);
}

export async function listNotes(
  userId: string,
  entityType: NoteEntityType,
  entityId: number
) {
  await loadEntityForUser(userId, entityType, entityId);

  const result = await pool.query(
    `
    ${NOTE_SELECT}
    WHERE n.entity_type = $1 AND n.entity_id = $2
    ORDER BY n.created_at DESC, n.id DESC
    `,
    [entityType, entityId]
  );

  return result.rows.map(mapNote);
}

export async function createNote(userId: string, input: CreateNoteInput) {
  const entity = await loadEntityForUser(
    userId,
    input.entity_type,
    input.entity_id
  );

  const type = input.type ?? 'note';
  const direction = input.direction ?? 'internal';
  let followUpDue: Date | null = null;

  if (input.follow_up_date) {
    followUpDue = new Date(input.follow_up_date);
    if (Number.isNaN(followUpDue.getTime())) {
      throw new InvalidFollowUpDateError();
    }
  }

  const client = await pool.connect();
  let noteId: number;
  let followUpTask:
    | { id: number; title: string; due_date: Date | string | null; status: string }
    | null = null;

  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      `
      INSERT INTO notes (user_id, entity_type, entity_id, body, type, direction)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [userId, input.entity_type, input.entity_id, input.body, type, direction]
    );
    noteId = inserted.rows[0].id;

    if (followUpDue) {
      const taskTitle = `Follow up: ${commTypeLabel(type)} with ${entity.name}`;
      const taskResult = await client.query(
        `
        INSERT INTO tasks (
          user_id,
          assigned_to,
          lead_id,
          job_id,
          title,
          description,
          due_date,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, title, due_date, status
        `,
        [
          userId,
          null,
          input.entity_type === 'lead' ? input.entity_id : null,
          input.entity_type === 'job' ? input.entity_id : null,
          taskTitle,
          input.body.slice(0, 200),
          followUpDue.toISOString(),
          'Pending',
        ]
      );
      const createdTask = taskResult.rows[0];
      if (!createdTask) {
        throw new Error('Failed to create follow-up task');
      }
      followUpTask = createdTask;
      await client.query(
        `
        UPDATE notes
        SET follow_up_task_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [createdTask.id, noteId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (input.entity_type === 'job') {
    const snippet =
      input.body.length > 160 ? `${input.body.slice(0, 157)}...` : input.body;
    await createJobActivity({
      userId,
      jobId: input.entity_id,
      type: 'COMMUNICATION_LOGGED',
      title: commActivityTitle(type, direction),
      message: snippet,
      entityType: 'note',
      entityId: noteId,
      metadata: {
        noteId,
        commType: type,
        direction,
      },
    });

    if (followUpTask) {
      await createJobActivity({
        userId,
        jobId: input.entity_id,
        type: 'TASK_CREATED',
        title: 'Task created',
        message: followUpTask.title,
        entityType: 'task',
        entityId: followUpTask.id,
        metadata: {
          taskTitle: followUpTask.title,
          status: followUpTask.status,
          dueDate: followUpTask.due_date,
        },
      });
    }
  }

  if (followUpTask) {
    await createNotification({
      userId,
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      message: followUpTask.title,
      entityType: 'task',
      entityId: followUpTask.id,
      metadata: {
        taskId: followUpTask.id,
        taskTitle: followUpTask.title,
      },
    });
  }

  return fetchNoteById(noteId);
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
