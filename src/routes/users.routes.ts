import { Router } from 'express';
import crypto from 'crypto';

import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { inviteUserSchema } from '../validators/users.schemas';

import requireOwnerOrAdmin from '../middleware/utils';
import { getAppBaseUrl } from '../utils/appBase';
import { requestScope } from '../lib/tenant';
import { LIMITS, limitByIp } from '../lib/rateLimit';
import { isMailConfigured } from '../lib/mailer';
import { listAccountEvents, recordAccountEvent } from '../lib/accountEvents';
import { createPasswordReset, resetUrl } from '../lib/passwordResets';
import { endAllSessions } from '../lib/sessions';
import {
  inviteExpiry,
  personName,
  sendInviteEmail,
  sendResetEmail,
} from '../services/accounts.service';

export const usersRouter = Router();

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | undefined): boolean {
  return Boolean(value && UUID_RE.test(value));
}

// POST /users/invite
usersRouter.post(
  '/invite',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const parsed = inviteUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten(),
      });
    }

    const { userId: inviterId, companyId } = requestScope(req);
    const { first_name, last_name, email, role } = parsed.data;

    // get inviter for permission + branding copy
    const inviterResult = await pool.query(
      `
      SELECT id, first_name, last_name, email, role, status, company_id
      FROM users
      WHERE id = $1 AND company_id = $2
      `,
      [inviterId, companyId]
    );

    const inviter = inviterResult.rows[0];

    if (!inviter) {
      return res.status(401).json({ ok: false, error: 'Invalid inviter' });
    }

    if (!['owner', 'admin'].includes(inviter.role)) {
      return res
        .status(403)
        .json({ ok: false, error: 'Not allowed to invite users' });
    }

    const existingUserResult = await pool.query(
      `
      SELECT id, email, status
      FROM users
      WHERE company_id = $1 AND LOWER(email) = LOWER($2)
      `,
      [companyId, email]
    );

    if (
      existingUserResult.rowCount &&
      existingUserResult.rows[0].status === 'active'
    ) {
      return res.status(409).json({
        ok: false,
        error: 'A user with that email already exists',
      });
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = sha256(inviteToken);

    const expiresAt = inviteExpiry();
    const appBaseUrl = getAppBaseUrl(req);
    const inviteUrl = `${appBaseUrl}/accept-invite?token=${inviteToken}`;

    let user;

    await pool.query(
      `
  UPDATE users
  SET invite_superseded_at = NOW()
  WHERE company_id = $1
    AND LOWER(email) = LOWER($2)
    AND status = 'invited'
    AND invite_token_hash IS NOT NULL
`,
      [companyId, email]
    );

    if (existingUserResult.rowCount) {
      const updateResult = await pool.query(
        `
        UPDATE users
        SET
          first_name = $1,
          last_name = $2,
          role = $3,
          status = 'invited',
          invite_token_hash = $4,
          invite_expires_at = $5,
          invited_at = NOW(),
          invite_revoked_at = NULL,
          invite_superseded_at = NULL,
          password_set_at = NULL,
          updated_at = NOW()
        WHERE id = $6
        RETURNING id, first_name, last_name, email, role, status, invite_expires_at
        `,
        [
          first_name,
          last_name,
          role,
          inviteTokenHash,
          expiresAt,
          existingUserResult.rows[0].id,
        ]
      );

      user = updateResult.rows[0];
    } else {
      const insertResult = await pool.query(
        `
        INSERT INTO users (
          first_name,
          last_name,
          email,
          role,
          status,
          invite_token_hash,
          invite_expires_at,
          invited_at,
          company_id
        )
        VALUES ($1, $2, $3, $4, 'invited', $5, $6, NOW(), $7)
        RETURNING id, first_name, last_name, email, role, status, invite_expires_at
        `,
        [
          first_name,
          last_name,
          email.toLowerCase(),
          role,
          inviteTokenHash,
          expiresAt,
          companyId,
        ]
      );

      user = insertResult.rows[0];
    }

    let emailSent = false;
    let emailError: string | null = null;

    try {
      await sendInviteEmail({
        to: user.email,
        firstName: user.first_name,
        role: user.role,
        inviterName: personName(inviter),
        inviteUrl,
        companyId,
        appBaseUrl,
      });
      emailSent = true;
    } catch (err) {
      if (isMailConfigured()) {
        console.error('[users/invite] failed to send invite email:', err);
      }
      emailError = isMailConfigured()
        ? 'Invite created, but email could not be sent'
        : 'This Joist can’t send email yet';
    }

    await recordAccountEvent({
      companyId,
      userId: user.id,
      actorId: inviterId,
      event: 'invite_sent',
      detail: { emailed: emailSent },
    });

    return res.status(201).json({
      ok: true,
      user,
      email_sent: emailSent,
      email_error: emailError,
      invite_url: inviteUrl, // keep fallback during rollout
    });
  })
);

// GET /users/invites/validate
usersRouter.get(
  '/invites/validate',
  limitByIp(LIMITS.inviteValidate),
  asyncHandler(async (req, res) => {
    const token = req.query.token as string;

    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }

    const tokenHash = sha256(token);

    const result = await pool.query(
      `
      SELECT u.id, u.email, u.role, u.status, u.invite_expires_at,
             u.invite_revoked_at, u.invite_superseded_at,
             c.name AS company_name, c.slug AS company_slug
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.invite_token_hash = $1
      `,
      [tokenHash]
    );

    const user = result.rows[0];

    if (!user) {
      return res.json({ ok: false, status: 'invalid' });
    }

    if (user.status === 'active') {
      return res.json({ ok: false, status: 'already_used' });
    }

    if (user.invite_revoked_at) {
      return res.json({ ok: false, status: 'revoked' });
    }

    if (user.invite_superseded_at) {
      return res.json({ ok: false, status: 'superseded' });
    }

    if (!user.invite_expires_at) {
      return res.json({ ok: false, status: 'invalid' });
    }

    if (new Date(user.invite_expires_at) < new Date()) {
      return res.json({ ok: false, status: 'expired' });
    }

    return res.json({
      ok: true,
      email: user.email,
      role: user.role,
      expires_at: user.invite_expires_at,
      status: 'valid',
      company_name: user.company_name ?? null,
      company_slug: user.company_slug ?? null,
    });
  })
);

// POST /users/invite/:id/resend
// A new link replaces the old one, so Resend always hands one over: by
// email when this host can send it, otherwise as a link to copy.
usersRouter.post(
  '/invite/:id/resend',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const { userId: actorId, companyId } = requestScope(req);
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    if (!isValidUuid(rawId)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = sha256(inviteToken);
    const expiresAt = inviteExpiry();

    const updateResult = await pool.query(
      `
      UPDATE users
      SET
        invite_token_hash = $1,
        invite_expires_at = $2,
        invited_at = NOW(),
        invite_superseded_at = NULL,
        invite_revoked_at = NULL,
        updated_at = NOW()
      WHERE id = $3::uuid
        AND company_id = $4
        AND status = 'invited'
      RETURNING id, first_name, last_name, email, role, status, invited_at, invite_expires_at
      `,
      [inviteTokenHash, expiresAt, rawId, companyId]
    );

    const user = updateResult.rows[0];
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const appBaseUrl = getAppBaseUrl(req);
    const inviteUrl = `${appBaseUrl}/accept-invite?token=${inviteToken}`;

    const actor = (
      await pool.query(
        `SELECT first_name, last_name, email FROM users WHERE id = $1`,
        [actorId]
      )
    ).rows[0];

    // "Copy invite link" makes a new link without emailing it.
    const sendEmail = req.body?.send_email !== false;
    let emailSent = false;
    let emailError: string | null = null;
    if (sendEmail) {
      try {
        await sendInviteEmail({
          to: user.email,
          firstName: user.first_name,
          role: user.role,
          inviterName: actor ? personName(actor) : 'Your team',
          inviteUrl,
          companyId,
          appBaseUrl,
        });
        emailSent = true;
      } catch (err) {
        if (isMailConfigured()) {
          console.error(
            '[users/invite/resend] failed to send invite email:',
            err
          );
        }
        emailError = isMailConfigured()
          ? 'The new link was made, but the email could not be sent'
          : 'This Joist can’t send email yet';
      }
    }

    await recordAccountEvent({
      companyId,
      userId: user.id,
      actorId,
      event: 'invite_resent',
      detail: { emailed: emailSent },
    });

    return res.json({
      ok: true,
      user,
      email_sent: emailSent,
      email_error: emailError,
      invite_url: inviteUrl,
    });
  })
);

// POST /users/invite/:id/revoke
usersRouter.post(
  '/invite/:id/revoke',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    if (!isValidUuid(rawId)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        invite_revoked_at = NOW(),
        invite_token_hash = NULL,
        invite_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND company_id = $2
        AND status = 'invited'
        AND invite_revoked_at IS NULL
      RETURNING id
      `,
      [rawId, companyId]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ ok: false, error: 'Invite not found or already processed' });
    }

    await recordAccountEvent({
      companyId,
      userId: rawId,
      actorId: requestScope(req).userId,
      event: 'invite_revoked',
    });

    return res.json({ ok: true });
  })
);

// GET /users
usersRouter.get(
  '/',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const result = await pool.query(
      `
      SELECT
        id,
        first_name,
        last_name,
        email,
        role,
        status,
        created_at,
        invited_at,
        invite_expires_at,
        password_set_at,
        last_login_at,
        invite_revoked_at,
        invite_superseded_at
      FROM users
      WHERE company_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [companyId]
    );

    res.json({
      ok: true,
      users: result.rows,
    });
  })
);

// PATCH /users/:id
usersRouter.patch(
  '/:id',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req: any, res) => {
    const actorId = req.user?.userId;
    const actorRole = req.user?.role;
    const { companyId } = requestScope(req);
    const targetId = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid user id',
      });
    }

    const { role, status } = req.body as {
      role?: 'owner' | 'admin' | 'agent';
      status?: 'invited' | 'active' | 'disabled';
    };

    if (!role && !status) {
      return res.status(400).json({
        ok: false,
        error: 'No valid fields provided',
      });
    }

    if (role && !['owner', 'admin', 'agent'].includes(role)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid role',
      });
    }

    if (status && !['invited', 'active', 'disabled'].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid status',
      });
    }

    const existingResult = await pool.query(
      `
      SELECT id, role, status
      FROM users
      WHERE id = $1 AND company_id = $2
      `,
      [targetId, companyId]
    );

    const existingUser = existingResult.rows[0];

    if (!existingUser) {
      return res.status(404).json({
        ok: false,
        error: 'User not found',
      });
    }

    if (targetId === actorId && status === 'disabled') {
      return res.status(400).json({
        ok: false,
        error: 'You cannot disable your own account',
      });
    }

    if (actorRole !== 'owner' && role === 'owner') {
      return res.status(403).json({
        ok: false,
        error: 'Only owners can assign owner role',
      });
    }

    if (
      actorRole !== 'owner' &&
      existingUser.role === 'owner' &&
      role &&
      role !== 'owner'
    ) {
      return res.status(403).json({
        ok: false,
        error: 'Only owners can change another owner',
      });
    }

    if (actorRole !== 'owner' && existingUser.role === 'owner' && status) {
      return res.status(403).json({
        ok: false,
        error: 'Only owners can change another owner',
      });
    }

    if (existingUser.role === 'owner' && role && role !== 'owner') {
      const ownerCountResult = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE role = 'owner' AND company_id = $1
        `,
        [companyId]
      );

      const ownerCount = ownerCountResult.rows[0]?.count ?? 0;

      if (ownerCount <= 1) {
        return res.status(400).json({
          ok: false,
          error: 'You cannot remove the last owner',
        });
      }
    }

    if (existingUser.role === 'owner' && status === 'disabled') {
      const ownerCountResult = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE role = 'owner' AND status = 'active' AND company_id = $1
        `,
        [companyId]
      );

      const activeOwnerCount = ownerCountResult.rows[0]?.count ?? 0;

      if (activeOwnerCount <= 1) {
        return res.status(400).json({
          ok: false,
          error: 'You cannot disable the last active owner',
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        role = COALESCE($1, role),
        status = COALESCE($2, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING
        id,
        first_name,
        last_name,
        email,
        role,
        status,
        created_at,
        invited_at,
        password_set_at,
        last_login_at
      `,
      [role ?? null, status ?? null, targetId]
    );

    const updated = result.rows[0];
    if (role && role !== existingUser.role) {
      await recordAccountEvent({
        companyId,
        userId: targetId,
        actorId,
        event: 'role_changed',
        detail: { from: existingUser.role, to: role },
      });
    }
    if (status && status !== existingUser.status) {
      // A disabled account's sessions end now: enabling it again later
      // must not bring an old cookie back to life.
      if (status === 'disabled') await endAllSessions(targetId, 'disabled');
      await recordAccountEvent({
        companyId,
        userId: targetId,
        actorId,
        event: 'status_changed',
        detail: { from: existingUser.status, to: status },
      });
    }

    res.json({
      ok: true,
      user: updated,
    });
  })
);

// DELETE /users/:id
usersRouter.delete(
  '/:id',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req: any, res) => {
    const actorId = req.user?.userId;
    const actorRole = req.user?.role;
    const { companyId } = requestScope(req);
    const targetId = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid user id',
      });
    }

    if (targetId === actorId) {
      return res.status(400).json({
        ok: false,
        error: 'You cannot delete your own account',
      });
    }

    const existingResult = await pool.query(
      `
      SELECT id, role, status, email
      FROM users
      WHERE id = $1 AND company_id = $2
      `,
      [targetId, companyId]
    );

    const existingUser = existingResult.rows[0];

    if (!existingUser) {
      return res.status(404).json({
        ok: false,
        error: 'User not found',
      });
    }

    if (existingUser.role === 'owner' && actorRole !== 'owner') {
      return res.status(403).json({
        ok: false,
        error: 'Only owners can delete owners',
      });
    }

    if (!['invited', 'disabled'].includes(existingUser.status)) {
      return res.status(400).json({
        ok: false,
        error: 'Only invited or disabled users can be deleted',
      });
    }

    if (existingUser.role === 'owner') {
      const ownerCountResult = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE role = 'owner' AND company_id = $1
        `,
        [companyId]
      );

      const ownerCount = ownerCountResult.rows[0]?.count ?? 0;

      if (ownerCount <= 1) {
        return res.status(400).json({
          ok: false,
          error: 'You cannot delete the last owner',
        });
      }
    }

    await pool.query(
      `
      DELETE FROM users
      WHERE id = $1
      `,
      [targetId]
    );

    res.json({
      ok: true,
      message: 'User deleted successfully',
    });
  })
);

// POST /users/:id/reset-link
// An owner or admin sends someone a link to set a new password: emailed
// when this host can send mail, otherwise handed back to copy. Owners can
// do this for anyone in the company, admins for agents and admins. Nobody
// does it for themselves (Change password in Preferences is for that).
// The person stays signed in until the new password is set; then every
// session they had ends.
usersRouter.post(
  '/:id/reset-link',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const { userId: actorId, companyId } = requestScope(req);
    const actorRole = req.user!.role;
    const targetId = String(req.params.id);
    if (!isValidUuid(targetId)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, status
       FROM users WHERE id = $1 AND company_id = $2`,
      [targetId, companyId]
    );
    const target = rows[0];
    if (!target) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (target.id === actorId) {
      return res.status(400).json({
        ok: false,
        error:
          'To change your own password, use Change password in Preferences.',
      });
    }
    if (target.role === 'owner' && actorRole !== 'owner') {
      return res.status(403).json({
        ok: false,
        error: 'Only an owner can reset an owner’s password.',
      });
    }
    if (target.status !== 'active') {
      return res.status(400).json({
        ok: false,
        error:
          target.status === 'invited'
            ? 'They haven’t set a password yet. Resend their invite instead.'
            : 'Turn this account back on before sending a reset link.',
      });
    }

    const { token, expiresAt } = await createPasswordReset(pool, {
      userId: target.id,
      companyId,
      via: 'staff',
      requestedBy: actorId,
    });
    const appBaseUrl = getAppBaseUrl(req);
    const url = resetUrl(appBaseUrl, token);

    let emailSent = false;
    let emailError: string | null = null;
    if (isMailConfigured()) {
      const actor = (
        await pool.query(
          `SELECT first_name, last_name, email FROM users WHERE id = $1`,
          [actorId]
        )
      ).rows[0];
      try {
        await sendResetEmail({
          to: target.email,
          firstName: target.first_name,
          resetUrl: url,
          via: 'staff',
          senderName: actor ? personName(actor) : null,
          companyId,
          appBaseUrl,
        });
        emailSent = true;
      } catch (err) {
        console.error('[users/reset-link] failed to send reset email:', err);
        emailError = 'The link was made, but the email could not be sent';
      }
    } else {
      emailError = 'This Joist can’t send email yet';
    }

    await recordAccountEvent({
      companyId,
      userId: target.id,
      actorId,
      event: 'reset_link_issued',
      detail: { emailed: emailSent },
    });

    // Once it has been emailed, the link is the person's alone.
    return res.status(201).json({
      ok: true,
      email_sent: emailSent,
      email_error: emailError,
      expires_at: expiresAt,
      ...(emailSent ? {} : { reset_url: url }),
    });
  })
);

// GET /users/:id/events
// The person's newest account events, for the Users page.
usersRouter.get(
  '/:id/events',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const targetId = String(req.params.id);
    if (!isValidUuid(targetId)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }
    const found = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
      [targetId, companyId]
    );
    if (!found.rowCount) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    res.json({
      ok: true,
      events: await listAccountEvents(companyId, targetId),
    });
  })
);
