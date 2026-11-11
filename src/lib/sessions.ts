import crypto from 'crypto';
import type { Request, Response } from 'express';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { pool } from '../db';
import { authCookieOptions } from './authCookies';

/**
 * Sessions: one user_sessions row per sign-in (migration 0003).
 *
 * The auth token carries its row's id (`sid`), and requireAuth refuses a
 * token whose row has ended. Sign out ends that row only; a password change
 * ends the person's other rows; a reset, or disabling the account, ends all.
 */

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  company_id: string;
};

export type EndReason =
  | 'signed_out'
  | 'signed_out_elsewhere'
  | 'password_changed'
  | 'password_reset'
  | 'disabled';

export type TokenPayload = {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
  sid?: string;
};

function secret(): Secret {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET is missing');
  return value;
}

/** Starts a session for this person and sets its token as the auth cookie. */
export async function startSession(
  res: Response,
  user: SessionUser,
  db: Queryable = pool
): Promise<string> {
  const sid = crypto.randomUUID();
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
  };
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      sid,
    },
    secret(),
    options
  );
  const { exp } = jwt.decode(token) as { exp: number };
  await db.query(
    `INSERT INTO user_sessions (id, user_id, company_id, expires_at)
     VALUES ($1, $2, $3, to_timestamp($4))`,
    [sid, user.id, user.company_id, exp]
  );
  // Rows long past their use go when the same person next signs in.
  await db.query(
    `DELETE FROM user_sessions
     WHERE user_id = $1
       AND (expires_at < now() - interval '30 days' OR ended_at < now() - interval '30 days')`,
    [user.id]
  );
  res.cookie('access_token', token, authCookieOptions());
  return sid;
}

/** The token a request carries: a Bearer header, else the auth cookie. */
export function requestToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return (req as any).cookies?.access_token as string | undefined;
}

/** The token's claims when its signature and expiry hold; null otherwise. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, secret()) as TokenPayload;
  } catch {
    return null;
  }
}

/** Ends one session. True when it was still live. */
export async function endSession(
  sid: string,
  reason: EndReason,
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query(
    `UPDATE user_sessions SET ended_at = now(), ended_reason = $2
     WHERE id = $1 AND ended_at IS NULL`,
    [sid, reason]
  );
  return result.rowCount > 0;
}

/** Ends every live session of this person except `keepSid`. Returns how many. */
export async function endOtherSessions(
  userId: string,
  keepSid: string,
  reason: EndReason,
  db: Queryable = pool
): Promise<number> {
  const result = await db.query(
    `UPDATE user_sessions SET ended_at = now(), ended_reason = $3
     WHERE user_id = $1 AND id <> $2 AND ended_at IS NULL`,
    [userId, keepSid, reason]
  );
  return result.rowCount;
}

/** Ends every live session of this person. Returns how many. */
export async function endAllSessions(
  userId: string,
  reason: EndReason,
  db: Queryable = pool
): Promise<number> {
  const result = await db.query(
    `UPDATE user_sessions SET ended_at = now(), ended_reason = $2
     WHERE user_id = $1 AND ended_at IS NULL`,
    [userId, reason]
  );
  return result.rowCount;
}
