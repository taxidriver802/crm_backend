import crypto from 'crypto';
import { pool } from '../db';

/**
 * Links that confirm a new owner's email (PLAN_operator.md §7), shaped like
 * reset links: 32 random bytes, only the SHA-256 stored, single-use. They
 * last a day, and a newer link for the same person supersedes the older
 * ones.
 */

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export const VERIFY_LIFETIME_HOURS = 24;

export type VerifyStatus = 'valid' | 'invalid' | 'expired' | 'used' | 'superseded';

export function hashVerifyToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, '')}/verify-email?token=${token}`;
}

/** A new link for this person; any open one stops working. */
export async function createEmailVerification(
  db: Queryable,
  input: { userId: string; companyId: string }
): Promise<{ token: string; expiresAt: Date }> {
  await db.query(
    `UPDATE email_verifications SET superseded_at = now()
     WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
    [input.userId]
  );
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO email_verifications (user_id, company_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))
     RETURNING expires_at`,
    [input.userId, input.companyId, hashVerifyToken(token), VERIFY_LIFETIME_HOURS]
  );
  return { token, expiresAt: rows[0].expires_at };
}

export type VerifyLookup = {
  status: VerifyStatus;
  /** Set for a used link too, so a second click can say the email is already confirmed. */
  verification?: {
    id: string;
    user_id: string;
    company_id: string;
    email: string;
    first_name: string;
    email_verified_at: Date | null;
    company_slug: string;
    company_status: string;
    registered_via: string | null;
  };
};

/** What a verification token is worth now. With `lock`, the row is held FOR UPDATE. */
export async function lookupVerification(
  token: string,
  db: Queryable = pool,
  { lock = false }: { lock?: boolean } = {}
): Promise<VerifyLookup> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return { status: 'invalid' };
  const { rows } = await db.query(
    `SELECT v.id, v.user_id, v.company_id, v.expires_at, v.used_at, v.superseded_at,
            u.email, u.first_name, u.email_verified_at,
            c.slug AS company_slug, c.status AS company_status, c.registered_via
     FROM email_verifications v
     JOIN users u ON u.id = v.user_id AND u.company_id = v.company_id
     JOIN companies c ON c.id = v.company_id
     WHERE v.token_hash = $1
     ${lock ? 'FOR UPDATE OF v' : ''}`,
    [hashVerifyToken(token)]
  );
  const row = rows[0];
  if (!row) return { status: 'invalid' };
  const verification = {
    id: row.id,
    user_id: row.user_id,
    company_id: row.company_id,
    email: row.email,
    first_name: row.first_name,
    email_verified_at: row.email_verified_at,
    company_slug: row.company_slug,
    company_status: row.company_status,
    registered_via: row.registered_via,
  };
  if (row.used_at) return { status: 'used', verification };
  if (row.superseded_at) return { status: 'superseded' };
  if (new Date(row.expires_at) <= new Date()) return { status: 'expired' };
  return { status: 'valid', verification };
}
