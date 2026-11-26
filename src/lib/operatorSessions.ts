import crypto from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

/**
 * Operator sessions (migration 0006). The operator is not a company user:
 *   - tokens are signed with OPERATOR_JWT_SECRET, never JWT_SECRET, and carry
 *     `aud: 'operator'`, which company tokens never do;
 *   - the cookie is `joist_op`, set only on the operator hostname (host-only),
 *     SameSite=Strict, and lives 12 hours;
 *   - each token names an operator_sessions row, which sign-out ends.
 *
 * Without OPERATOR_JWT_SECRET the operator surface is off: every /operator
 * route answers 404.
 */

export const OPERATOR_COOKIE = 'joist_op';
export const OPERATOR_AUDIENCE = 'operator';
const SESSION_HOURS = 12;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export type OperatorTokenPayload = { operatorId: string; sid: string };

export function operatorSecret(env: Record<string, string | undefined> = process.env) {
  const value = (env.OPERATOR_JWT_SECRET ?? '').trim();
  return value || null;
}

export function operatorEnabled() {
  return operatorSecret() !== null;
}

function requireSecret() {
  const value = operatorSecret();
  if (!value) throw new Error('OPERATOR_JWT_SECRET is missing');
  return value;
}

export function operatorCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  };
}

/** Writes an operator_sessions row and signs its token. */
export async function createOperatorSession(
  operatorId: string,
  db: Queryable = pool
): Promise<{ sid: string; token: string }> {
  const sid = crypto.randomUUID();
  const token = jwt.sign({ operatorId, sid }, requireSecret(), {
    audience: OPERATOR_AUDIENCE,
    expiresIn: `${SESSION_HOURS}h`,
  });
  const { exp } = jwt.decode(token) as { exp: number };
  await db.query(
    `INSERT INTO operator_sessions (id, operator_id, expires_at)
     VALUES ($1, $2, to_timestamp($3))`,
    [sid, operatorId, exp]
  );
  await db.query(
    `DELETE FROM operator_sessions
     WHERE operator_id = $1
       AND (expires_at < now() - interval '30 days' OR ended_at < now() - interval '30 days')`,
    [operatorId]
  );
  return { sid, token };
}

export function setOperatorCookie(res: Response, token: string) {
  res.cookie(OPERATOR_COOKIE, token, operatorCookieOptions());
}

export function clearOperatorCookie(res: Response) {
  const { maxAge: _maxAge, ...options } = operatorCookieOptions();
  res.clearCookie(OPERATOR_COOKIE, options);
}

/** The operator token a request carries. Cookie only: no Bearer header. */
export function operatorRequestToken(req: Request): string | undefined {
  return (req as any).cookies?.[OPERATOR_COOKIE] as string | undefined;
}

/** The claims when signature, audience and expiry hold; null otherwise. */
export function verifyOperatorToken(token: string): OperatorTokenPayload | null {
  const secret = operatorSecret();
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret, {
      audience: OPERATOR_AUDIENCE,
    }) as Partial<OperatorTokenPayload>;
    if (!payload.operatorId || !payload.sid) return null;
    return { operatorId: payload.operatorId, sid: payload.sid };
  } catch {
    return null;
  }
}

export async function endOperatorSession(
  sid: string,
  reason: 'signed_out' | 'password_changed' | 'disabled',
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query(
    `UPDATE operator_sessions SET ended_at = now(), ended_reason = $2
     WHERE id = $1 AND ended_at IS NULL`,
    [sid, reason]
  );
  return result.rowCount > 0;
}
