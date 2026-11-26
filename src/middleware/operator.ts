import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db';
import { cfAccessConfig, verifyCfAccess, type CfAccessIdentity } from '../lib/cfAccess';
import { isLoopback, normalizeIp, recordLoginEvent } from '../lib/loginEvents';
import {
  operatorEnabled,
  operatorRequestToken,
  verifyOperatorToken,
} from '../lib/operatorSessions';
import { clientIp } from '../lib/rateLimit';

declare global {
  namespace Express {
    interface Request {
      operator?: { operatorId: string; email: string; sessionId: string };
      cfAccess?: CfAccessIdentity;
    }
  }
}

/** A refusal that doesn't say the operator surface exists. */
function notFound(res: Response) {
  return res.status(404).json({ ok: false, error: 'Not found' });
}

/**
 * The gate in front of every /operator route, before any sign-in:
 *   - off (404) without OPERATOR_JWT_SECRET;
 *   - with Cloudflare Access configured, a valid Access assertion is required;
 *   - without it (development and tests only; production refuses to boot
 *     that way), only a loopback client gets through.
 */
export function operatorGate(req: Request, res: Response, next: NextFunction) {
  if (!operatorEnabled()) return notFound(res);

  const config = cfAccessConfig();
  if (!config) {
    if (process.env.NODE_ENV === 'production') return notFound(res);
    if (isLoopback(normalizeIp(clientIp(req)))) return next();
    return notFound(res);
  }

  void (async () => {
    try {
      const identity = await verifyCfAccess(req, config);
      if (!identity) {
        recordLoginEvent(req, {
          event: 'login_failed',
          reason: 'access_denied',
          scope: 'operator',
        });
        return notFound(res);
      }
      req.cfAccess = identity;
      next();
    } catch (error) {
      next(error);
    }
  })();
}

/** A signed-in operator, whose session hasn't ended and who isn't disabled. */
export function requireOperator(req: Request, res: Response, next: NextFunction) {
  const token = operatorRequestToken(req);
  const payload = token ? verifyOperatorToken(token) : null;
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Not signed in' });
  }

  void (async () => {
    try {
      const result = await pool.query(
        `SELECT o.id, o.email
         FROM operators o
         JOIN operator_sessions s
           ON s.operator_id = o.id AND s.id = $2::uuid
          AND s.ended_at IS NULL AND s.expires_at > now()
         WHERE o.id = $1 AND o.disabled_at IS NULL
         LIMIT 1`,
        [payload.operatorId, payload.sid]
      );
      const row = result.rows[0];
      if (!row) return res.status(401).json({ ok: false, error: 'Not signed in' });
      req.operator = { operatorId: row.id, email: row.email, sessionId: payload.sid };
      next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Not signed in' });
    }
  })();
}
