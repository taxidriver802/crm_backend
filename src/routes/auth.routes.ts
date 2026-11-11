import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';

import {
  registerSchema,
  loginSchema,
  acceptInviteSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../validators/auth.schemas';

import { authCookieOptions } from '../lib/authCookies';
import {
  insertCompanyWithSlug,
  isPgUniqueViolation,
  publicCompany,
  slugifyCompanyName,
} from '../lib/companySlug';
import {
  LIMITS,
  check,
  clear,
  clientIp,
  consume,
  limitByIp,
  record,
  tooManyRequests,
} from '../lib/rateLimit';
import {
  endAllSessions,
  endOtherSessions,
  requestToken,
  startSession,
  verifyToken,
} from '../lib/sessions';
import { recordAccountEvent } from '../lib/accountEvents';
import {
  createPasswordReset,
  lookupReset,
  resetUrl,
} from '../lib/passwordResets';
import { isMailConfigured } from '../lib/mailer';
import { configuredAppBaseUrl } from '../utils/appBase';
import { sendResetEmail } from '../services/accounts.service';

export const authRouter = Router();

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

/** The key sign-in failures are counted under: company slug and email. */
function accountKey(companySlug: string, email: string) {
  return `${companySlug}|${email.toLocaleLowerCase()}`;
}

// POST /auth/register
authRouter.post(
  '/register',
  limitByIp(LIMITS.register),
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
          first_name, last_name, email, password_hash, role, status, company_id,
          password_set_at, last_login_at
        )
        VALUES ($1, $2, $3, $4, 'owner', 'active', $5, now(), now())
        RETURNING id, email, first_name, last_name, role, status, company_id
        `,
        [first_name, last_name, normalEmail, password_hash, company.id]
      );

      await client.query('COMMIT');

      const user = result.rows[0];
      await startSession(res, user);

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

    // Failed sign-ins are counted per account (company + email) and per
    // client address. While either limit holds, every attempt is refused,
    // the right password included, so guessing cannot continue behind it.
    const key = accountKey(company_slug, normalEmail);
    const ip = clientIp(req);
    const byAccount = check(LIMITS.loginAccount, key);
    if (!byAccount.allowed) {
      return tooManyRequests(res, byAccount, LIMITS.loginAccount);
    }
    const byIp = check(LIMITS.loginIp, ip);
    if (!byIp.allowed) {
      return tooManyRequests(res, byIp, LIMITS.loginIp);
    }
    const invalidCredentials = () => {
      record(LIMITS.loginAccount, key);
      record(LIMITS.loginIp, ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    };

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
      return invalidCredentials();
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
      return invalidCredentials();
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return invalidCredentials();
    }

    const matches = await bcrypt.compare(password, user.password_hash);

    if (!matches) {
      // Only a real person in this company has a history to write to.
      await recordAccountEvent({
        companyId: user.company_id,
        userId: user.id,
        event: 'sign_in_failed',
      });
      return invalidCredentials();
    }

    clear(LIMITS.loginAccount, key);

    await startSession(res, user);
    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [
      user.id,
    ]);
    await recordAccountEvent({
      companyId: user.company_id,
      userId: user.id,
      event: 'signed_in',
    });

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
  limitByIp(LIMITS.acceptInvite),
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

    await recordAccountEvent({
      companyId: user.company_id,
      userId: user.id,
      event: 'invite_accepted',
    });
    await startSession(res, { ...authUser, company_id: user.company_id });

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

// POST /auth/logout
// Ends this browser's session, and only it, then clears the cookie. Works
// without a live session too, so a browser holding an ended one can always
// clear it (the frontend calls this on any 401).
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = requestToken(req);
    const payload = token ? verifyToken(token) : null;
    if (payload?.sid && /^[0-9a-f-]{36}$/i.test(payload.sid)) {
      const ended = await pool.query(
        `UPDATE user_sessions SET ended_at = now(), ended_reason = 'signed_out'
         WHERE id = $1 AND ended_at IS NULL
         RETURNING user_id, company_id`,
        [payload.sid]
      );
      if (ended.rowCount) {
        await recordAccountEvent({
          companyId: ended.rows[0].company_id,
          userId: ended.rows[0].user_id,
          event: 'signed_out',
        });
      }
    }

    res.clearCookie('access_token', authCookieOptions());
    res.json({ ok: true });
  })
);

// POST /auth/sessions/end-others
// "Sign out everywhere else": every session of this person but this one.
authRouter.post(
  '/sessions/end-others',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, companyId, sessionId } = req.user!;
    const ended = await endOtherSessions(userId, sessionId, 'signed_out_elsewhere');
    await recordAccountEvent({
      companyId,
      userId,
      event: 'signed_out_elsewhere',
      detail: { sessions: ended },
    });
    res.json({ ok: true, ended });
  })
);

// POST /auth/change-password
// The current password is required. This browser stays signed in; every
// other session of this person ends.
authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const { userId, companyId, sessionId } = req.user!;

    const limit = check(LIMITS.changePassword, userId);
    if (!limit.allowed) {
      return tooManyRequests(res, limit, LIMITS.changePassword);
    }

    const { rows } = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1 AND company_id = $2`,
      [userId, companyId]
    );
    const hash = rows[0]?.password_hash as string | undefined;
    const matches = hash
      ? await bcrypt.compare(parsed.data.current_password, hash)
      : false;
    if (!matches) {
      record(LIMITS.changePassword, userId);
      return res
        .status(400)
        .json({ ok: false, error: 'Your current password isn’t right.' });
    }

    const password_hash = await bcrypt.hash(parsed.data.new_password, 10);
    const client = await pool.connect();
    let ended = 0;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users
         SET password_hash = $1, password_set_at = now(), updated_at = now()
         WHERE id = $2`,
        [password_hash, userId]
      );
      ended = await endOtherSessions(userId, sessionId, 'password_changed', client);
      // A reset link still open would undo this change.
      await client.query(
        `UPDATE password_resets SET superseded_at = now()
         WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
        [userId]
      );
      await recordAccountEvent(
        {
          companyId,
          userId,
          event: 'password_changed',
          detail: { other_sessions_ended: ended },
        },
        client
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    clear(LIMITS.changePassword, userId);

    res.json({ ok: true, other_sessions_ended: ended });
  })
);

// POST /auth/forgot-password
// Answers the same whether or not the account exists, and does its work
// after answering, so neither the reply nor its timing tells. `mail` says
// only whether this host can send email at all.
authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const { company_slug, email } = parsed.data;

    const byIp = consume(LIMITS.forgotIp, clientIp(req));
    if (!byIp.allowed) return tooManyRequests(res, byIp, LIMITS.forgotIp);
    const key = accountKey(company_slug, email);
    const byAccount = consume(LIMITS.forgotAccount, key);
    if (!byAccount.allowed) {
      return tooManyRequests(res, byAccount, LIMITS.forgotAccount);
    }

    const mail = isMailConfigured();
    res.json({ ok: true, mail });

    void (async () => {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.company_id
         FROM users u
         JOIN companies c ON c.id = u.company_id
         WHERE c.slug = $1 AND LOWER(u.email) = LOWER($2)
           AND u.status = 'active' AND u.password_hash IS NOT NULL
         LIMIT 1`,
        [company_slug, email]
      );
      const user = rows[0];
      if (!user) return;

      if (!mail) {
        // Nothing can be sent; the history tells an owner or admin to
        // send a link.
        await recordAccountEvent({
          companyId: user.company_id,
          userId: user.id,
          event: 'reset_requested',
          detail: { emailed: false },
        });
        return;
      }

      const { token } = await createPasswordReset(pool, {
        userId: user.id,
        companyId: user.company_id,
        via: 'forgot',
      });
      const base = configuredAppBaseUrl();
      let emailed = true;
      try {
        await sendResetEmail({
          to: user.email,
          firstName: user.first_name,
          resetUrl: resetUrl(base, token),
          via: 'forgot',
          companyId: user.company_id,
          appBaseUrl: base,
        });
      } catch (error) {
        emailed = false;
        console.error('[auth/forgot-password] reset email failed:', error);
      }
      await recordAccountEvent({
        companyId: user.company_id,
        userId: user.id,
        event: 'reset_requested',
        detail: { emailed },
      });
    })().catch((error) => {
      console.error('[auth/forgot-password] failed:', error);
    });
  })
);

// GET /auth/reset-password/validate?token=
authRouter.get(
  '/reset-password/validate',
  limitByIp(LIMITS.resetValidate),
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const found = await lookupReset(token);
    if (found.status !== 'valid' || !found.reset) {
      return res.json({ ok: false, status: found.status });
    }
    const reset = found.reset;
    res.json({
      ok: true,
      status: 'valid',
      email: reset.email,
      first_name: reset.first_name,
      company_name: reset.company_name,
      company_slug: reset.company_slug,
      expires_at: reset.expires_at,
    });
  })
);

const RESET_REFUSED: Record<string, string> = {
  invalid: 'This link isn’t valid.',
  expired: 'This link has expired.',
  used: 'This link has already been used.',
  superseded: 'A newer link was sent; use that one.',
};

// POST /auth/reset-password
// Sets the new password, ends every session the person had, and signs this
// browser in. The link works once: the row is locked while it is used.
authRouter.post(
  '/reset-password',
  limitByIp(LIMITS.resetPassword),
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const password_hash = await bcrypt.hash(parsed.data.password, 10);

    const client = await pool.connect();
    let reset;
    try {
      await client.query('BEGIN');
      const found = await lookupReset(parsed.data.token, client, { lock: true });
      if (found.status !== 'valid' || !found.reset) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          status: found.status,
          error: RESET_REFUSED[found.status] ?? RESET_REFUSED.invalid,
        });
      }
      reset = found.reset;
      await client.query(
        `UPDATE users
         SET password_hash = $1, password_set_at = now(), updated_at = now(),
             last_login_at = now()
         WHERE id = $2`,
        [password_hash, reset.user_id]
      );
      await client.query(
        `UPDATE password_resets SET used_at = now() WHERE id = $1`,
        [reset.id]
      );
      await client.query(
        `UPDATE password_resets SET superseded_at = now()
         WHERE user_id = $1 AND id <> $2 AND used_at IS NULL AND superseded_at IS NULL`,
        [reset.user_id, reset.id]
      );
      const ended = await endAllSessions(reset.user_id, 'password_reset', client);
      await recordAccountEvent(
        {
          companyId: reset.company_id,
          userId: reset.user_id,
          event: 'password_reset',
          detail: { via: reset.via, sessions_ended: ended },
        },
        client
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // Earlier wrong guesses don't keep the person out after a reset.
    clear(LIMITS.loginAccount, accountKey(reset.company_slug, reset.email));

    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, status, company_id
       FROM users WHERE id = $1`,
      [reset.user_id]
    );
    await startSession(res, rows[0]);

    res.json({
      ok: true,
      user: publicUser(rows[0]),
      company: await loadCompany(reset.company_id),
    });
  })
);
