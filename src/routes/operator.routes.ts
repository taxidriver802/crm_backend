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
import * as operatorService from '../services/operator.service';
import * as account from '../services/companyAccount.service';

/**
 * The operator surface (PLAN_operator.md §5–6). Mounted at /operator; the
 * browser reaches it as /api/operator on the operator hostname only.
 * Every route sits behind operatorGate. Step 3 is read-only: the overview,
 * the company list and one company. Actions come in step 4.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /operator/overview
operatorRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await operatorService.overview()) });
  })
);

const listQuery = z.object({
  status: z.enum(operatorService.COMPANY_STATUSES).optional(),
  q: z.string().max(100).optional(),
});

// GET /operator/companies?status=&q=
operatorRouter.get(
  '/companies',
  asyncHandler(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Unknown status or search' });
    }
    res.json({ ok: true, companies: await operatorService.listCompanies(parsed.data) });
  })
);

// GET /operator/companies/:id
operatorRouter.get(
  '/companies/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ ok: false, error: 'Company not found' });
    const company = await operatorService.getCompany(id);
    if (!company) return res.status(404).json({ ok: false, error: 'Company not found' });
    res.json({ ok: true, company });
  })
);

// ─── Changing a company's account (PLAN_operator.md §6) ────────────────────
// Every change goes through src/services/companyAccount.service.ts, which
// checks the move, sets its timer and records it in operator_events.

function companyId(req: { params: Record<string, unknown> }) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new account.AccountChangeError('Company not found', 404);
  return id;
}

function actor(req: { operator?: { operatorId: string } }): account.Actor {
  return { operatorId: req.operator?.operatorId ?? null };
}

/** Runs a change, answers with the company as it now is. */
function change(run: (req: any) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await run(req);
    } catch (error) {
      if (error instanceof account.AccountChangeError) {
        return res.status(error.status).json({ ok: false, error: error.message });
      }
      throw error;
    }
    const company = await operatorService.getCompany(String(req.params.id));
    res.json({ ok: true, company });
  });
}

const body = (req: any) => (req.body && typeof req.body === 'object' ? req.body : {});

// POST /operator/companies/:id/approve  { trial_days?, confirm_unverified? }
// An owner who hasn't confirmed their email needs confirm_unverified: true.
operatorRouter.post(
  '/companies/:id/approve',
  change((req) =>
    account.approveCompany(companyId(req), actor(req), body(req).trial_days, {
      confirmUnverified: body(req).confirm_unverified === true,
    })
  )
);

// POST /operator/companies/:id/deny  { reason, notify? }
// notify: true emails the owner that the company wasn't approved.
operatorRouter.post(
  '/companies/:id/deny',
  change((req) =>
    account.denyCompany(companyId(req), actor(req), body(req).reason, body(req).notify === true)
  )
);

// POST /operator/companies/:id/status  { to, reason?, confirm_unverified? }
operatorRouter.post(
  '/companies/:id/status',
  change((req) =>
    account.setCompanyStatus(
      companyId(req),
      {
        to: body(req).to,
        reason: body(req).reason,
        confirmUnverified: body(req).confirm_unverified === true,
      },
      actor(req)
    )
  )
);

// POST /operator/companies/:id/restore  { to: 'suspended' | 'active', reason? }
operatorRouter.post(
  '/companies/:id/restore',
  change(async (req) => {
    const id = companyId(req);
    const current = await operatorService.getCompany(id);
    if (current?.status !== 'pending_deletion') {
      throw new account.AccountChangeError('Only a company pending deletion can be restored.');
    }
    return account.restoreCompany(id, actor(req), body(req).to, body(req).reason);
  })
);

// POST /operator/companies/:id/extend  { days, reason? }
operatorRouter.post(
  '/companies/:id/extend',
  change((req) => account.extendTimer(companyId(req), actor(req), body(req).days, body(req).reason))
);

// POST /operator/companies/:id/hold  { reason }
operatorRouter.post(
  '/companies/:id/hold',
  change((req) => account.holdCompany(companyId(req), actor(req), body(req).reason))
);

// POST /operator/companies/:id/release  { reason? }
operatorRouter.post(
  '/companies/:id/release',
  change((req) => account.releaseCompany(companyId(req), actor(req), body(req).reason))
);

// PATCH /operator/companies/:id  { name?, slug?, confirm_slug?, plan?, billing_email?, operator_notes? }
operatorRouter.patch(
  '/companies/:id',
  change((req) => account.editCompany(companyId(req), actor(req), body(req)))
);

// GET /operator/exports — final export requests waiting for you
operatorRouter.get(
  '/exports',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, requests: await operatorService.listExportRequests() });
  })
);

function exportChange(run: (id: string, req: any) => Promise<{ company_id: string }>) {
  return asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ ok: false, error: 'Export request not found' });
    let done;
    try {
      done = await run(id, req);
    } catch (error) {
      if (error instanceof account.AccountChangeError) {
        return res.status(error.status).json({ ok: false, error: error.message });
      }
      throw error;
    }
    res.json({ ok: true, company: await operatorService.getCompany(done.company_id) });
  });
}

// POST /operator/exports/:id/approve  { reason? }
operatorRouter.post(
  '/exports/:id/approve',
  exportChange((id, req) => account.approveExport(id, actor(req), body(req).reason))
);

// POST /operator/exports/:id/deny  { reason }
operatorRouter.post(
  '/exports/:id/deny',
  exportChange((id, req) => account.denyExport(id, actor(req), body(req).reason))
);
