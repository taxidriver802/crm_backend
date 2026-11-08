import { pool } from '../db';
import {
  preferencesPatchSchema,
  preferencesSchema,
  type Preferences,
} from '../validators/preferences.schemas';

/** A preference document is configuration, not data. Keep it small. */
export const MAX_PREFERENCES_BYTES = 12 * 1024;

export class PreferencesInvalidError extends Error {
  status = 400;
  details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'PreferencesInvalidError';
    this.details = details;
  }
}

export class PreferencesTooLargeError extends Error {
  status = 413;
  constructor() {
    super('Preferences are too large to save.');
    this.name = 'PreferencesTooLargeError';
  }
}

type Section = keyof Preferences;
const SECTIONS: Section[] = ['appearance', 'nav', 'home', 'lists', 'records'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies a PATCH to a stored document.
 *
 *   section: null              clears the section (back to the company default)
 *   section: { key: value }    merges one level into the section
 *   lists/records: { jobs: x } replaces that entry; { jobs: null } clears it
 *
 * Arrays (nav order, pins, widgets, columns) are always replaced whole, so a
 * client sends the list it wants, not a diff.
 */
export function applyPreferencesPatch(
  current: Preferences,
  patch: Record<string, unknown>
): Preferences {
  const next: Record<string, unknown> = { ...current };
  for (const section of SECTIONS) {
    if (!(section in patch)) continue;
    const value = patch[section];
    if (value === null) {
      delete next[section];
      continue;
    }
    if (!isPlainObject(value)) continue;
    const base = isPlainObject(next[section]) ? { ...(next[section] as object) } : {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null && (section === 'lists' || section === 'records')) {
        delete (base as Record<string, unknown>)[key];
      } else if (entry !== undefined) {
        (base as Record<string, unknown>)[key] = entry;
      }
    }
    if (Object.keys(base).length === 0) delete next[section];
    else next[section] = base;
  }
  return next as Preferences;
}

/** Workspace defaults overlaid with the user's own choices, one level deep. */
export function resolveEffective(
  defaults: Preferences,
  user: Preferences
): Preferences {
  const out: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    const d = defaults[section];
    const u = user[section];
    if (isPlainObject(d) && isPlainObject(u)) out[section] = { ...d, ...u };
    else if (u !== undefined) out[section] = u;
    else if (d !== undefined) out[section] = d;
  }
  return out as Preferences;
}

/** Drops anything that no longer validates (e.g. a removed widget id). */
function sanitize(raw: unknown): Preferences {
  if (!isPlainObject(raw)) return {};
  const parsed = preferencesSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const kept: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    if (!(section in raw)) continue;
    const one = preferencesSchema.safeParse({ [section]: raw[section] });
    if (one.success && one.data[section] !== undefined) {
      kept[section] = one.data[section];
    }
  }
  return kept as Preferences;
}

function assertSize(doc: Preferences) {
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_PREFERENCES_BYTES) {
    throw new PreferencesTooLargeError();
  }
}

function parsePatch(input: unknown) {
  const parsed = preferencesPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new PreferencesInvalidError(
      'Those preferences are not valid.',
      parsed.error.flatten()
    );
  }
  return parsed.data as Record<string, unknown>;
}

async function loadUserDoc(userId: string): Promise<Preferences> {
  const res = await pool.query(
    `SELECT preferences FROM user_preferences WHERE user_id = $1`,
    [userId]
  );
  return sanitize(res.rows[0]?.preferences);
}

export async function getWorkspaceDefaults(companyId: string): Promise<Preferences> {
  const res = await pool.query(
    `SELECT workspace_defaults FROM companies WHERE id = $1`,
    [companyId]
  );
  return sanitize(res.rows[0]?.workspace_defaults);
}

export async function getPreferences(userId: string, companyId: string) {
  const [preferences, defaults] = await Promise.all([
    loadUserDoc(userId),
    getWorkspaceDefaults(companyId),
  ]);
  return {
    preferences,
    defaults,
    effective: resolveEffective(defaults, preferences),
  };
}

export async function updatePreferences(
  userId: string,
  companyId: string,
  input: unknown
) {
  const patch = parsePatch(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT preferences FROM user_preferences WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const current = sanitize(res.rows[0]?.preferences);
    const next = applyPreferencesPatch(current, patch);
    assertSize(next);
    await client.query(
      `INSERT INTO user_preferences (user_id, company_id, preferences, updated_at)
       VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
         SET preferences = EXCLUDED.preferences,
             company_id = EXCLUDED.company_id,
             updated_at = CURRENT_TIMESTAMP`,
      [userId, companyId, JSON.stringify(next)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getPreferences(userId, companyId);
}

export async function resetPreferences(userId: string, companyId: string) {
  await pool.query(`DELETE FROM user_preferences WHERE user_id = $1`, [userId]);
  return getPreferences(userId, companyId);
}

export async function updateWorkspaceDefaults(companyId: string, input: unknown) {
  const patch = parsePatch(input);
  const current = await getWorkspaceDefaults(companyId);
  const next = applyPreferencesPatch(current, patch);
  assertSize(next);
  await pool.query(
    `UPDATE companies SET workspace_defaults = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [companyId, JSON.stringify(next)]
  );
  return next;
}
