import type { Request, Response, NextFunction } from 'express';

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res
        .status(403)
        .json({ ok: false, error: 'Insufficient permissions' });
    }
    next();
  };
}
