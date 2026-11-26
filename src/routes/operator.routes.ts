import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { recordLoginEvent } from '../lib/loginEvents';
import {
  clearOperatorCookie,
  createOperatorSession,
  endOperatorSession,
  operatorRequestToken,
  setOperatorCookie,
  verifyOperatorToken,
} from '../lib/operatorSessions';
import { check, clientIp, LIMITS, record, tooManyRequests } from '../lib/rateLimit';
import { operatorGate, requireOperator } from '../middleware/operator';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * The operator surface (PLAN_operator.md §5–6). Mounted at /operator; the
 * browser reaches it as /api/operator on the operator hostname only.
 * Every route sits behind operatorGate. This step has sign-in only; the
 * company list and actions come next.
 */
export const operatorRouter = Router();

operatorRouter.use(operatorGate);

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

// Compared against when the email is unknown, so a miss takes as long as a
// wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// POST /operator/auth/login
operatorRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Email and password are required' });
    }
    const email = parsed.data.email.toLocaleLowerCase();
    const ip = clientIp(req);
    const attempt = { email, scope: 'operator' as const };

    const byAccount = check(LIMITS.operatorLoginAccount, email);
    if (!byAccount.allowed) {
      recordLoginEvent(req, { ...attempt, event: 'login_failed', reason: 'rate_limited_account' });
      return tooManyRequests(res, byAccount, LIMITS.operatorLoginAccount);
    }
    const byIp = check(LIMITS.operatorLoginIp, ip);
    if (!byIp.allowed) {
      recordLoginEvent(req, { ...attempt, event: 'login_failed', reason: 'rate_limited_ip' });
      return tooManyRequests(res, byIp, LIMITS.operatorLoginIp);
    }

    const found = await pool.query(
      `SELECT id, email, password_hash, disabled_at FROM operators
       WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );
    const operator = found.rows[0];
    const matches = await bcrypt.compare(
      parsed.data.password,
      operator?.password_hash ?? DUMMY_HASH
    );

    const reason = !operator
      ? 'unknown_email'
      : operator.disabled_at
        ? 'inactive'
        : !matches
          ? 'bad_password'
          : null;
    if (reason) {
      recordLoginEvent(req, { ...attempt, event: 'login_failed', reason });
      record(LIMITS.operatorLoginAccount, email);
      record(LIMITS.operatorLoginIp, ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const session = await createOperatorSession(operator.id);
    await pool.query(`UPDATE operators SET last_login_at = now() WHERE id = $1`, [operator.id]);
    setOperatorCookie(res, session.token);
    recordLoginEvent(req, {
      ...attempt,
      event: 'login_success',
      method: 'password',
      sessionId: session.sid,
    });
    res.json({ ok: true, operator: { id: operator.id, email: operator.email } });
  })
);

// POST /operator/auth/logout: ends this session. Answers ok when there was none.
operatorRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    const token = operatorRequestToken(req);
    const payload = token ? verifyOperatorToken(token) : null;
    if (payload && (await endOperatorSession(payload.sid, 'signed_out'))) {
      recordLoginEvent(req, { event: 'logout', scope: 'operator', sessionId: payload.sid });
    }
    clearOperatorCookie(res);
    res.json({ ok: true });
  })
);

// GET /operator/auth/me
operatorRouter.get(
  '/auth/me',
  requireOperator,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, email, last_login_at, created_at FROM operators WHERE id = $1`,
      [req.operator!.operatorId]
    );
    res.json({ ok: true, operator: result.rows[0] });
  })
);

// Everything below needs a signed-in operator.
operatorRouter.use(requireOperator);
