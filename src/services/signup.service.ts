import { pool } from '../db';
import { companyBrand } from './accounts.service';
import { createEmailVerification, VERIFY_LIFETIME_HOURS, verifyUrl } from '../lib/emailVerifications';
import { isMailConfigured, sendMail } from '../lib/mailer';
import { notifyOperator } from '../lib/operatorNotify';
import { isProduction } from '../config/production';
import { buildSignupEmail, SignupEmailKind } from '../lib/signup-email';
import { configuredAppBaseUrl } from '../utils/appBase';

/**
 * The emails around the registration gate (PLAN_operator.md §7). Each one
 * goes to the company's owner. None of them throws: a failed email is
 * logged, and the owner can ask for the verify link again.
 */

type Owner = { id: string; email: string; first_name: string; company_id: string };

export async function ownerOf(companyId: string): Promise<Owner | null> {
  const { rows } = await pool.query(
    `SELECT id, email, first_name, company_id FROM users
     WHERE company_id = $1 AND role = 'owner'
     ORDER BY created_at ASC LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}

async function send(
  kind: SignupEmailKind,
  owner: Owner,
  extra: { url?: string; trialDays?: number | null } = {}
): Promise<boolean> {
  if (!isMailConfigured()) return false;
  const base = configuredAppBaseUrl();
  try {
    const brand = await companyBrand(owner.company_id, base);
    const message = buildSignupEmail({
      kind,
      firstName: owner.first_name,
      companyName: brand.companyName,
      companySlug: brand.companySlug,
      url: extra.url,
      trialDays: extra.trialDays,
      expiresHours: VERIFY_LIFETIME_HOURS,
      paletteId: brand.paletteId,
      markId: brand.markId,
      logoUrl: brand.logoUrl,
    });
    await sendMail({ to: owner.email, ...message, fromName: brand.companyName });
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'signup_email_failed',
        kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return false;
  }
}

/**
 * Makes a new verify link for this owner and emails it. Without mail, a dev
 * host logs the link so sign-up can still be tried; production refuses to
 * start that way (config/production.ts).
 */
export async function sendVerifyLink(owner: Owner): Promise<boolean> {
  const { token } = await createEmailVerification(pool, {
    userId: owner.id,
    companyId: owner.company_id,
  });
  const url = verifyUrl(configuredAppBaseUrl(), token);
  if (!isMailConfigured()) {
    if (!isProduction() && process.env.NODE_ENV !== 'test') {
      console.info(`[signup] mail is off; confirm ${owner.email} at ${url}`);
    }
    return false;
  }
  return send('verify', owner, { url });
}

/** After the email is confirmed and the company waits for review. */
export async function afterVerifiedPending(companyId: string) {
  const owner = await ownerOf(companyId);
  if (!owner) return;
  await send('received', owner);
  const { rows } = await pool.query(`SELECT name, slug FROM companies WHERE id = $1`, [companyId]);
  const company = rows[0];
  if (!company) return;
  const operatorUrl = (process.env.OPERATOR_URL ?? '').trim().replace(/\/+$/, '');
  await notifyOperator({
    title: 'New company to review',
    message: `${company.name} (${company.slug}) confirmed its email and is waiting for approval.`,
    url: operatorUrl ? `${operatorUrl}/operator/companies/${companyId}` : undefined,
  });
}

/** Approved: the welcome email, with a sign-in link carrying the slug. */
export async function sendWelcomeEmail(companyId: string) {
  const owner = await ownerOf(companyId);
  if (!owner) return;
  const { rows } = await pool.query(
    `SELECT slug, trial_ends_at, approved_at FROM companies WHERE id = $1`,
    [companyId]
  );
  const company = rows[0];
  if (!company) return;
  const url = `${configuredAppBaseUrl()}/login?company=${encodeURIComponent(company.slug)}`;
  const trialDays =
    company.trial_ends_at && company.approved_at
      ? Math.round(
          (new Date(company.trial_ends_at).getTime() - new Date(company.approved_at).getTime()) /
            86400000
        )
      : null;
  await send('welcome', owner, { url, trialDays });
}

/** Denied, when the operator asked to tell the owner. Never the reason. */
export async function sendDeniedEmail(companyId: string) {
  const owner = await ownerOf(companyId);
  if (owner) await send('denied', owner);
}
