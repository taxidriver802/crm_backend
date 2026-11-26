import fs from 'fs';
import path from 'path';
import { pool } from '../db';
import { companyBrand } from './accounts.service';
import { ownerOf, sendDeniedEmail, sendWelcomeEmail } from './signup.service';
import { archivePath } from './companyExport.service';
import type { CompanyChange, CompanyDeletion } from '../lib/companyNotices';
import { buildLifecycleEmail, type LifecycleEmailInput } from '../lib/lifecycle-email';
import { isMailConfigured, sendMail } from '../lib/mailer';
import { uploadsRoot } from '../lib/uploadsDir';
import { configuredAppBaseUrl } from '../utils/appBase';

/**
 * What follows a company's account change (PLAN_operator.md §3, §7): the
 * owner's email for the new state, and, after a delete, its files and the
 * "deleted" email. Wired to lib/companyNotices in app.ts. Nothing here
 * throws: a failed email is logged.
 */

const STATE_EMAILS = new Set(['past_due', 'suspended', 'pending_deletion', 'on_hold']);

async function sendLifecycle(
  companyId: string,
  input: Omit<LifecycleEmailInput, 'companyName' | 'companySlug' | 'firstName' | 'paletteId' | 'markId' | 'logoUrl' | 'signInUrl'>
): Promise<boolean> {
  if (!isMailConfigured()) return false;
  try {
    const owner = await ownerOf(companyId);
    if (!owner) return false;
    const base = configuredAppBaseUrl();
    const brand = await companyBrand(companyId, base);
    const message = buildLifecycleEmail({
      ...input,
      firstName: owner.first_name,
      companyName: brand.companyName,
      companySlug: brand.companySlug,
      signInUrl: brand.companySlug ? `${base}/login?company=${encodeURIComponent(brand.companySlug)}` : null,
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
        event: 'lifecycle_email_failed',
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return false;
  }
}

/** After any account change: the email that state sends, if any. */
export async function onCompanyChange(change: CompanyChange) {
  const approving = change.to === 'trial' && (change.from === 'pending' || change.from === 'denied');
  if (approving) return sendWelcomeEmail(change.companyId);
  if (change.to === 'denied' && change.from === 'pending') {
    if (change.notify) await sendDeniedEmail(change.companyId);
    return;
  }
  if (STATE_EMAILS.has(change.to)) {
    await sendLifecycle(change.companyId, {
      kind: change.to as LifecycleEmailInput['kind'],
      fromTrial: change.from === 'trial',
      dueAt: change.nextStatusAt ?? null,
    });
  }
}

/** A reminder that a state's timer runs out in `daysLeft` days. Whether it went. */
export function sendTimerReminder(companyId: string, status: string, daysLeft: number, dueAt: Date) {
  return sendLifecycle(companyId, { kind: 'reminder', status, daysLeft, dueAt });
}

/** After a delete: its uploads and export archives go, then the email. */
export async function onCompanyDeletion(deletion: CompanyDeletion) {
  const folder = path.join(uploadsRoot(), deletion.companyId);
  // Only ever a folder named for this company, directly under the uploads root.
  if (/^[0-9a-f-]{36}$/i.test(deletion.companyId) && path.dirname(folder) === uploadsRoot()) {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
  for (const id of deletion.exportIds) {
    await fs.promises.rm(archivePath(id), { force: true });
  }

  if (!deletion.to || !isMailConfigured()) return;
  try {
    const message = buildLifecycleEmail({
      kind: 'deleted',
      firstName: deletion.firstName,
      companyName: deletion.name,
      paletteId: deletion.paletteId,
      markId: deletion.markId,
    });
    await sendMail({ to: deletion.to, ...message, fromName: deletion.name });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'deleted_email_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/** The company's name and slug, for the operator's ping. */
export async function companyLabel(companyId: string) {
  const { rows } = await pool.query(`SELECT name, slug FROM companies WHERE id = $1`, [companyId]);
  return rows[0] ? `${rows[0].name} (${rows[0].slug})` : companyId;
}
