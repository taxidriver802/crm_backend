import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { requestToken, verifyToken } from '../lib/sessions';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
        companyId: string;
        /** The user_sessions row this request's token names. */
        sessionId: string;
      };
    }
  }
}

/**
 * A request is signed in when its token's signature holds, the token names a
 * session (`sid`) that hasn't ended, and its person is still active.
 * Signing out, a password change or reset, or disabling the account ends
 * sessions (src/lib/sessions.ts); a token signed before sessions existed
 * names none and is refused.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = requestToken(req);

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing token' });
  }

  void (async () => {
    try {
      const payload = verifyToken(token);
      if (!payload?.userId || !payload.sid) {
        return res.status(401).json({ ok: false, error: 'Invalid token' });
      }
      const result = await pool.query(
        `
        SELECT u.id, u.email, u.role, u.status, u.company_id
        FROM users u
        JOIN user_sessions s
          ON s.user_id = u.id AND s.id = $2::uuid AND s.ended_at IS NULL
        WHERE u.id = $1
        LIMIT 1
        `,
        [payload.userId, payload.sid]
      );
      const row = result.rows[0];

      if (!row || row.status !== 'active' || !row.company_id) {
        return res.status(401).json({ ok: false, error: 'Invalid token' });
      }

      req.user = {
        userId: row.id,
        email: row.email,
        role: row.role,
        companyId: row.company_id,
        sessionId: payload.sid,
      };
      next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
  })();
}
