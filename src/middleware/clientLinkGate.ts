import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { CLIENT_NOT_TAKING_RESPONSES, CLIENT_UNAVAILABLE, clientAccess } from '../lib/lifecycle';

/**
 * The links a company sends its clients follow the company's account state
 * (PLAN_operator.md §3, Q7):
 * - trial, active, past_due: as usual;
 * - suspended: clients can still open and download what they were sent,
 *   but can't answer an estimate or send an intake form (403);
 * - anything else: the link is gone (410).
 *
 * The token is the first path segment under each mount. A token that
 * matches nothing passes through, so the route answers as it always has.
 */
const LOOKUPS: Record<string, string> = {
  estimates: `SELECT company_id FROM estimates WHERE share_token_hash = $1 LIMIT 1`,
  invoices: `SELECT company_id FROM invoices WHERE share_token_hash = $1 LIMIT 1`,
  portal: `SELECT company_id FROM portal_tokens WHERE token_hash = $1 LIMIT 1`,
  intake: `SELECT company_id FROM intake_tokens WHERE token_hash = $1 LIMIT 1`,
};

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function clientLinkGate(kind: keyof typeof LOOKUPS) {
  const sql = LOOKUPS[kind];
  return (req: Request, res: Response, next: NextFunction) => {
    const token = decodeURIComponent(req.path.split('/')[1] || '').trim();
    if (!token) return next();
    void (async () => {
      try {
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const found = await pool.query(sql, [hash]);
        const companyId = found.rows[0]?.company_id;
        if (!companyId) return next();
        const { rows } = await pool.query(`SELECT status FROM companies WHERE id = $1`, [companyId]);
        const access = clientAccess(rows[0]?.status ?? '');
        if (access === 'full') return next();
        if (access === 'view_only') {
          if (READS.has(req.method)) return next();
          return res
            .status(403)
            .json({ ok: false, code: 'client_view_only', error: CLIENT_NOT_TAKING_RESPONSES });
        }
        return res.status(410).json({ ok: false, code: 'client_unavailable', error: CLIENT_UNAVAILABLE });
      } catch (error) {
        next(error);
      }
    })();
  };
}
