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
import { authCookieOptions } from '../lib/authCookies';
import {
  insertCompanyWithSlug,
  isPgUniqueViolation,
  publicCompany,
  slugifyCompanyName,
} from '../lib/companySlug';

export const authRouter = Router();

function signToken(
  userId: string,
  email: string,
  role: string,
  companyId: string
): string {
  const secret: Secret = process.env.JWT_SECRET!;

  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
  };

  return jwt.sign({ userId, email, role, companyId }, secret, options);
}

function publicUser(row: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
}) {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    status: row.status,
  };
}

async function loadCompany(companyId: string) {
  const result = await pool.query(
    `
    SELECT id, name, slug, palette_id, mark_id, logo_storage_key
    FROM companies
    WHERE id = $1
    LIMIT 1
    `,
    [companyId]
  );
  return result.rows[0] ? publicCompany(result.rows[0]) : null;
}

// POST /auth/register
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { first_name, last_name, email, password, company_name, slug, mark_id, palette_id } =
      parsed.data;
    const normalEmail = email.toLocaleLowerCase();
    const desiredSlug = slug ?? slugifyCompanyName(company_name);

    if (!desiredSlug) {
      return res.status(400).json({
        ok: false,
        error: 'company_name must include letters or numbers',
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const company = await insertCompanyWithSlug(client, {
        name: company_name,
        slug: desiredSlug,
        exactSlug: Boolean(slug),
        mark_id,
        palette_id,
      });

      const result = await client.query(
        `
        INSERT INTO users (
          first_name, last_name, email, password_hash, role, status, company_id
        )
        VALUES ($1, $2, $3, $4, 'owner', 'active', $5)
        RETURNING id, email, first_name, last_name, role, status, company_id
        `,
        [first_name, last_name, normalEmail, password_hash, company.id]
      );

      await client.query('COMMIT');

      const user = result.rows[0];
      const token = signToken(user.id, user.email, user.role, user.company_id);

      res.cookie('access_token', token, authCookieOptions());

      res.status(201).json({
        ok: true,
        user: publicUser(user),
        company: publicCompany(company),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        isPgUniqueViolation(error) ||
        (error as { status?: number }).status === 409
      ) {
        return res.status(409).json({
          ok: false,
          error: 'Company slug already in use',
        });
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

// POST /auth/login
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { email, password, company_slug } = parsed.data;
    const normalEmail = email.toLocaleLowerCase();

    const companyResult = await pool.query(
      `
      SELECT id, name, slug, palette_id, mark_id, logo_storage_key
      FROM companies
      WHERE slug = $1
      LIMIT 1
      `,
      [company_slug]
    );

    if (!companyResult.rowCount) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const companyRow = companyResult.rows[0];

    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, role, status, company_id
       FROM users
       WHERE company_id = $1 AND LOWER(email) = LOWER($2) AND status = 'active'
       LIMIT 1`,
      [companyRow.id, normalEmail]
    );

    if (!result.rowCount) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);

    if (!matches)
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    const token = signToken(user.id, user.email, user.role, user.company_id);

    res.cookie('access_token', token, authCookieOptions());

    res.json({
      ok: true,
      user: publicUser(user),
      company: publicCompany(companyRow),
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
        company_id,
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
      status: 'active' as const,
    };

    const tokenJwt = signToken(
      authUser.id,
      authUser.email,
      authUser.role,
      user.company_id
    );

    res.cookie('access_token', tokenJwt, authCookieOptions());

    res.status(200).json({
      ok: true,
      user: authUser,
      company: await loadCompany(user.company_id),
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
      `
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.status,
        u.company_id,
        c.name AS company_name,
        c.slug AS company_slug,
        c.palette_id,
        c.mark_id,
        c.logo_storage_key
      FROM users u
      INNER JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1
      `,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    res.json({
      ok: true,
      user: publicUser(row),
      company: publicCompany({
        id: row.company_id,
        name: row.company_name,
        slug: row.company_slug,
        palette_id: row.palette_id,
        mark_id: row.mark_id,
        logo_storage_key: row.logo_storage_key,
      }),
    });
  })
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('access_token', authCookieOptions());

  res.json({ ok: true });
});
