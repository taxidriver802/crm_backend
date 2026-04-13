import { pool } from '../db';

export class SavedViewNotFoundError extends Error {
  constructor(message = 'Saved view not found') {
    super(message);
    this.name = 'SavedViewNotFoundError';
  }
}

export class SavedViewConflictError extends Error {
  constructor(message = 'A saved view with this name already exists') {
    super(message);
    this.name = 'SavedViewConflictError';
  }
}

type SavedViewEntity = 'leads' | 'jobs' | 'tasks';

type CreateSavedViewInput = {
  entity_type: SavedViewEntity;
  name: string;
  filters: Record<string, unknown>;
};

type UpdateSavedViewInput = {
  name?: string;
  filters?: Record<string, unknown>;
};

function isPgUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export async function listSavedViews(
  userId: string,
  entityType: SavedViewEntity
) {
  const result = await pool.query(
    `
    SELECT id, user_id, entity_type, name, filters, created_at, updated_at
    FROM saved_views
    WHERE user_id = $1
      AND entity_type = $2
    ORDER BY updated_at DESC, id DESC
    `,
    [userId, entityType]
  );

  return result.rows;
}

export async function createSavedView(
  userId: string,
  input: CreateSavedViewInput
) {
  try {
    const result = await pool.query(
      `
      INSERT INTO saved_views (user_id, entity_type, name, filters)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, user_id, entity_type, name, filters, created_at, updated_at
      `,
      [
        userId,
        input.entity_type,
        input.name,
        JSON.stringify(input.filters || {}),
      ]
    );

    return result.rows[0];
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new SavedViewConflictError();
    }
    throw error;
  }
}

export async function updateSavedView(
  userId: string,
  id: number,
  updates: UpdateSavedViewInput
) {
  const keys = Object.keys(updates) as (keyof UpdateSavedViewInput)[];
  if (keys.length === 0) {
    throw new Error('No fields to update');
  }

  const setParts: string[] = [];
  const values: any[] = [userId, id];

  for (const key of keys) {
    if (key === 'filters') {
      values.push(JSON.stringify(updates.filters || {}));
      setParts.push(`filters = $${values.length}::jsonb`);
    } else {
      values.push(updates[key]);
      setParts.push(`${key} = $${values.length}`);
    }
  }

  setParts.push('updated_at = CURRENT_TIMESTAMP');

  try {
    const result = await pool.query(
      `
      UPDATE saved_views
      SET ${setParts.join(', ')}
      WHERE user_id = $1
        AND id = $2
      RETURNING id, user_id, entity_type, name, filters, created_at, updated_at
      `,
      values
    );

    if (result.rowCount === 0) {
      throw new SavedViewNotFoundError();
    }

    return result.rows[0];
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new SavedViewConflictError();
    }
    throw error;
  }
}

export async function deleteSavedView(userId: string, id: number) {
  const result = await pool.query(
    `
    DELETE FROM saved_views
    WHERE user_id = $1
      AND id = $2
    RETURNING id
    `,
    [userId, id]
  );

  if (result.rowCount === 0) {
    throw new SavedViewNotFoundError();
  }

  return result.rows[0].id;
}
