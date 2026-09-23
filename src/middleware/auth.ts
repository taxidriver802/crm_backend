import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

type JwtPayload = {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
        companyId: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  // cookie-parser adds `req.cookies`
  const cookieToken = (req as any).cookies?.access_token as string | undefined;

  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing token' });
  }

  void (async () => {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET is missing');

      const payload = jwt.verify(token, secret) as JwtPayload;
      const result = await pool.query(
        `
        SELECT id, email, role, status, company_id
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [payload.userId]
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
      };
      next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
  })();
}
