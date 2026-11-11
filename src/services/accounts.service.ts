import { loadPublicBrandingByCompanyId } from '../lib/companySlug';
import { buildInviteEmail } from '../lib/invite-email';
import { sendMail } from '../lib/mailer';
import { RESET_LIFETIME_MINUTES } from '../lib/passwordResets';
import { buildResetEmail } from '../lib/reset-email';

/** One lifetime for every invite link, first send and Resend alike. */
export const INVITE_LIFETIME_HOURS = 7 * 24;

export function inviteExpiry(now = Date.now()) {
  return new Date(now + INVITE_LIFETIME_HOURS * 60 * 60 * 1000);
}

export function personName(row: {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}) {
  return (
    [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
    row.email
  );
}

async function companyBrand(companyId: string, appBaseUrl: string) {
  const branding = await loadPublicBrandingByCompanyId(companyId);
  return {
    companyName: branding?.name || 'CRM',
    companySlug: branding?.slug ?? null,
    paletteId: branding?.palette_id ?? null,
    markId: branding?.mark_id ?? null,
    logoUrl: branding?.logo_url
      ? `${appBaseUrl.replace(/\/$/, '')}/api${branding.logo_url}`
      : null,
  };
}

/** Emails an invite link. Throws when mail isn't configured or can't be sent. */
export async function sendInviteEmail(input: {
  to: string;
  firstName: string;
  role: string;
  inviterName: string;
  inviteUrl: string;
  companyId: string;
  appBaseUrl: string;
}) {
  const brand = await companyBrand(input.companyId, input.appBaseUrl);
  const message = buildInviteEmail({
    firstName: input.firstName,
    inviterName: input.inviterName,
    inviteUrl: input.inviteUrl,
    companyName: brand.companyName,
    companySlug: brand.companySlug,
    role: input.role,
    expiresHours: INVITE_LIFETIME_HOURS,
    paletteId: brand.paletteId,
    markId: brand.markId,
    logoUrl: brand.logoUrl,
  });
  await sendMail({
    to: input.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    fromName: brand.companyName,
  });
}

/** Emails a reset link. Throws when mail isn't configured or can't be sent. */
export async function sendResetEmail(input: {
  to: string;
  firstName: string;
  resetUrl: string;
  via: 'forgot' | 'staff';
  senderName?: string | null;
  companyId: string;
  appBaseUrl: string;
}) {
  const brand = await companyBrand(input.companyId, input.appBaseUrl);
  const message = buildResetEmail({
    firstName: input.firstName,
    email: input.to,
    resetUrl: input.resetUrl,
    companyName: brand.companyName,
    companySlug: brand.companySlug,
    via: input.via,
    senderName: input.senderName,
    expiresHours: RESET_LIFETIME_MINUTES / 60,
    paletteId: brand.paletteId,
    markId: brand.markId,
    logoUrl: brand.logoUrl,
  });
  await sendMail({
    to: input.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    fromName: brand.companyName,
  });
}
