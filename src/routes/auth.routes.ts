import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';

import crypto from 'crypto';
import {
  registerSchema,
  loginSchema,
  acceptInviteSchema,
} from '../validators/auth.schemas';

import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';

export const authRouter = Router();

function signToken(userId: string, email: string, role: string): string {
  const secret: Secret = process.env.JWT_SECRET!;

  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
  };

  return jwt.sign({ userId, email, role }, secret, options);
}

// POST /auth/register
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM users'
    );
    const isFirstUser = rows[0].count === 0;

    const role = isFirstUser ? 'owner' : 'agent';

    const { first_name, last_name, email, password } = parsed.data;

    const normalEmail = email.toLocaleLowerCase();

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
      normalEmail,
    ]);

    if (existing.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Email already in use',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING id, email, first_name, last_name, role;
      `,
      [first_name, last_name, normalEmail, password_hash, role]
    );

    const user = result.rows[0];
    const token = signToken(user.id, user.email, user.role);

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: true, // MUST be true for https (ngrok)
      sameSite: 'none', // MUST be none for cross-site
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({ ok: true, user });
  })
);

// POST /auth/login
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { email, password } = parsed.data;

    const normalEmail = email.toLocaleLowerCase();

    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, role, status FROM users WHERE email = $1`,
      [normalEmail]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res
        .status(403)
        .json({ ok: false, error: 'Account is not active' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);

    if (!matches)
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    const token = signToken(user.id, user.email, user.role);

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        status: user.status,
      },
    });
  })
);

// POST /auth/accept-invite
authRouter.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const parsed = acceptInviteSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten(),
      });
    }

    const { token, password } = parsed.data;

    const inviteTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const result = await pool.query(
      `
      SELECT
        id,
        email,
        first_name,
        last_name,
        role,
        status,
        invite_expires_at
      FROM users
      WHERE invite_token_hash = $1
      LIMIT 1
      `,
      [inviteTokenHash]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid invite token',
      });
    }

    if (user.status !== 'invited') {
      return res.status(400).json({
        ok: false,
        error: 'Invite is no longer valid',
      });
    }

    if (
      !user.invite_expires_at ||
      new Date(user.invite_expires_at) < new Date()
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invite has expired',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      `
      UPDATE users
      SET
        password_hash = $1,
        status = 'active',
        invite_token_hash = NULL,
        invite_expires_at = NULL,
        password_set_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP,
        last_login_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [password_hash, user.id]
    );

    const authUser = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      status: 'active',
    };

    const tokenJwt = signToken(authUser.id, authUser.email, authUser.role);

    res.cookie('access_token', tokenJwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      ok: true,
      user: authUser,
    });
  })
);

// GET /auth/me
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, status
      FROM users
      WHERE id = $1`,
      [userId]
    );

    res.json({ ok: true, user: result.rows[0] });
  })
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });

  res.json({ ok: true });
});
