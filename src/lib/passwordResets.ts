import crypto from 'crypto';
import { pool } from '../db';

/**
 * Reset links (migration 0003), shaped like invite links: the token is 32
 * random bytes, only its SHA-256 is stored, it lasts an hour and works once.
 * A newer link for the same person supersedes the older ones.
 *
 * scripts/reset-link.js (the operator's command) writes the same rows; keep
 * the two in step.
 */

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export const RESET_LIFETIME_MINUTES = 60;

export type ResetVia = 'forgot' | 'staff' | 'operator';

export type ResetStatus =
  | 'valid'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'superseded';

export function hashResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function resetUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, '')}/reset-password?token=${token}`;
}

/** A new reset link for this person; any open one stops working. */
export async function createPasswordReset(
  db: Queryable,
  input: {
    userId: string;
    companyId: string;
    via: ResetVia;
    requestedBy?: string | null;
  }
): Promise<{ token: string; expiresAt: Date }> {
  await db.query(
    `UPDATE password_resets SET superseded_at = now()
     WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
    [input.userId]
  );
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO password_resets (user_id, company_id, token_hash, via, requested_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))
     RETURNING expires_at`,
    [
      input.userId,
      input.companyId,
      hashResetToken(token),
      input.via,
      input.requestedBy ?? null,
      RESET_LIFETIME_MINUTES,
    ]
  );
  return { token, expiresAt: rows[0].expires_at };
}

export type ResetLookup = {
  status: ResetStatus;
  reset?: {
    id: string;
    user_id: string;
    company_id: string;
    via: ResetVia;
    expires_at: Date;
    email: string;
    first_name: string;
    role: string;
    company_name: string;
    company_slug: string;
  };
};

/**
 * What a reset token is worth now. With `lock`, the reset row is held
 * FOR UPDATE, so two submissions of one link can't both use it.
 */
export async function lookupReset(
  token: string,
  db: Queryable = pool,
  { lock = false }: { lock?: boolean } = {}
): Promise<ResetLookup> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return { status: 'invalid' };
  const { rows } = await db.query(
    `SELECT r.id, r.user_id, r.company_id, r.via, r.expires_at, r.used_at, r.superseded_at,
            u.email, u.first_name, u.role, u.status AS user_status,
            c.name AS company_name, c.slug AS company_slug
     FROM password_resets r
     JOIN users u ON u.id = r.user_id AND u.company_id = r.company_id
     JOIN companies c ON c.id = r.company_id
     WHERE r.token_hash = $1
     ${lock ? 'FOR UPDATE OF r' : ''}`,
    [hashResetToken(token)]
  );
  const row = rows[0];
  if (!row || row.user_status !== 'active') return { status: 'invalid' };
  if (row.used_at) return { status: 'used' };
  if (row.superseded_at) return { status: 'superseded' };
  if (new Date(row.expires_at) <= new Date()) return { status: 'expired' };
  return {
    status: 'valid',
    reset: {
      id: row.id,
      user_id: row.user_id,
      company_id: row.company_id,
      via: row.via,
      expires_at: row.expires_at,
      email: row.email,
      first_name: row.first_name,
      role: row.role,
      company_name: row.company_name,
      company_slug: row.company_slug,
    },
  };
}
