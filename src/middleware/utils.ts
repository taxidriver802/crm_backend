import { pool } from '../db';

export default async function requireOwnerOrAdmin(
  req: any,
  res: any,
  next: any
) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
    }

    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    const role = result.rows[0]?.role;

    console.log('db role', role);

    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}
