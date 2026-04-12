import { Router } from 'express';
import crypto from 'crypto';

import { pool } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { inviteUserSchema } from '../validators/users.schemas';

import requireOwnerOrAdmin from '../middleware/utils';
import { buildInviteEmail } from '../lib/invite-email';
import { sendMail } from '../lib/mailer';
import { getAppBaseUrl } from '../utils/appBase';

export const usersRouter = Router();

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

    const inviterId = req.user!.userId;
    const { first_name, last_name, email, role } = parsed.data;

    // get inviter for permission + branding copy
    const inviterResult = await pool.query(
      `
      SELECT id, first_name, last_name, email, role, status
      FROM users
      WHERE id = $1
      `,
      [inviterId]
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
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
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

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const appBaseUrl = getAppBaseUrl(req);
    const inviteUrl = `${appBaseUrl}/accept-invite?token=${inviteToken}`;

    let user;

    await pool.query(
      `
  UPDATE users
  SET invite_superseded_at = NOW()
  WHERE LOWER(email) = LOWER($1)
    AND status = 'invited'
    AND invite_token_hash IS NOT NULL
`,
      [email]
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
          invited_at
        )
        VALUES ($1, $2, $3, $4, 'invited', $5, $6, NOW())
        RETURNING id, first_name, last_name, email, role, status, invite_expires_at
        `,
        [
          first_name,
          last_name,
          email.toLowerCase(),
          role,
          inviteTokenHash,
          expiresAt,
        ]
      );

      user = insertResult.rows[0];
    }

    let emailSent = false;
    let emailError: string | null = null;

    try {
      const inviterName =
        [inviter.first_name, inviter.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || inviter.email;

      const message = buildInviteEmail({
        firstName: user.first_name,
        inviterName,
        inviteUrl,
        appName: 'Rooftop Realty',
        role: user.role,
        expiresHours: 24,
      });

      await sendMail({
        to: user.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      emailSent = true;
    } catch (err) {
      console.error('[users/invite] failed to send invite email:', err);
      emailError = 'Invite created, but email could not be sent';
    }

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
  asyncHandler(async (req, res) => {
    const token = req.query.token as string;

    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }

    const tokenHash = sha256(token);

    const result = await pool.query(
      `
      SELECT id, email, role, status, invite_expires_at,
             invite_revoked_at, invite_superseded_at
      FROM users
      WHERE invite_token_hash = $1
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
    });
  })
);

// POST /users/invite/:id/resend
usersRouter.post(
  '/invite/:id/resend',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (req, res) => {
    const userId = req.params.id;

    const userResult = await pool.query(
      `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER($1)
      AND status = 'invited'
      AND invite_token_hash IS NOT NULL
      `,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    if (user.status === 'active') {
      return res.status(400).json({ ok: false, error: 'User already active' });
    }

    // invalidate old invite
    await pool.query(
      `
      UPDATE users
      SET invite_superseded_at = NOW()
      WHERE id = $1
      `,
      [userId]
    );

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = sha256(inviteToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
      WHERE id = $3
      RETURNING *
      `,
      [inviteTokenHash, expiresAt, userId]
    );

    const updatedUser = updateResult.rows[0];

    const inviteUrl = `${getAppBaseUrl(req)}/accept-invite?token=${inviteToken}`;

    /* await sendMail({
      to: updatedUser.email,
      subject: 'You’ve been invited',
      html: `<a href="${inviteUrl}">Accept Invite</a>`,
    }); */

    return res.json({
      ok: true,
      user: updatedUser,
      invite_url: inviteUrl,
    });
  })
);

// GET /users
usersRouter.get(
  '/',
  requireAuth,
  requireOwnerOrAdmin,
  asyncHandler(async (_req, res) => {
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
      ORDER BY created_at DESC, id DESC
      `
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
      WHERE id = $1
      `,
      [targetId]
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
        WHERE role = 'owner'
        `
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
        WHERE role = 'owner' AND status = 'active'
        `
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

    res.json({
      ok: true,
      user: result.rows[0],
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
      WHERE id = $1
      `,
      [targetId]
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
        WHERE role = 'owner'
        `
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
