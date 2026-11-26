import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { requestToken, verifyToken } from '../lib/sessions';
import { staffAccess, staffRefusal } from '../lib/lifecycle';

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
      /** The signed-in person's company account state (src/lib/lifecycle.ts). */
      companyAccount?: { status: string; nextStatusAt: Date | null };
    }
  }
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What the company's account state allows (PLAN_operator.md §3):
 * - full access (trial, active, past_due): everything;
 * - read-only (suspended): reading, plus signing out, the person's own
 *   settings and marking notifications read;
 * - none (pending, denied, pending_deletion, on_hold): signing out only.
 * Sessions are not ended: when the account is restored, people are back in.
 */
function accountRefusal(req: Request, status: string, nextStatusAt: Date | null) {
  const mount = req.baseUrl || '';
  const signingOut = mount === '/auth' && req.path === '/logout';
  const access = staffAccess(status);
  if (access === 'full' || signingOut) return null;
  if (access === 'none') {
    return { code: `company_${status}`, error: staffRefusal(status, nextStatusAt) };
  }
  if (READS.has(req.method) || ['/auth', '/me', '/notifications'].includes(mount)) return null;
  // Money still goes where it needs to (Q7): a payment a client made can be
  // recorded against its invoice while the account is suspended.
  if (mount === '/invoices' && req.method === 'POST' && /^\/\d+\/payments\/?$/.test(req.path)) return null;
  return { code: 'company_read_only', error: staffRefusal(status, nextStatusAt) };
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
        SELECT u.id, u.email, u.role, u.status, u.company_id,
               c.status AS company_status, c.next_status_at AS company_next_status_at
        FROM users u
        JOIN user_sessions s
          ON s.user_id = u.id AND s.id = $2::uuid AND s.ended_at IS NULL
        JOIN companies c ON c.id = u.company_id
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
      req.companyAccount = {
        status: row.company_status,
        nextStatusAt: row.company_next_status_at,
      };
      const refusal = accountRefusal(req, row.company_status, row.company_next_status_at);
      if (refusal) return res.status(403).json({ ok: false, ...refusal });
      next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
  })();
}
