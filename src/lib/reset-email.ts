import { POWERED_BY } from './brand';
import { companyIconHtml, escapeHtml, lifetimeLabel } from './invite-email';
import { resolveEmailTheme } from './print-theme';

/**
 * The reset-link email, in the company's brand like the invite: the company
 * owns the email, and Joist is one "Powered by" line under it.
 *
 * `via` changes the opening: Forgot ("someone asked"), or an owner or admin
 * who sent it ("Dana sent you…").
 */
export function buildResetEmail({
  firstName,
  email,
  resetUrl,
  companyName,
  companySlug,
  via,
  senderName,
  expiresHours = 1,
  paletteId,
  markId,
  logoUrl,
}: {
  firstName: string;
  email: string;
  resetUrl: string;
  companyName: string;
  companySlug?: string | null;
  via: 'forgot' | 'staff';
  senderName?: string | null;
  expiresHours?: number;
  paletteId?: string | null;
  markId?: string | null;
  logoUrl?: string | null;
}) {
  const lifetime = lifetimeLabel(expiresHours);
  const subject = `Set a new password for ${companyName}`;
  const opening =
    via === 'forgot'
      ? `Someone asked to reset the password for ${email} at ${companyName}. If it was you, set a new one below. If it wasn’t, ignore this email: your password stays as it is.`
      : `${senderName || 'Your team'} sent you a link to set a new password for ${email} at ${companyName}.`;
  const closing = `This link expires in ${lifetime} and can only be used once. Setting a new password signs you out on every other device.`;
  const slugLine = companySlug ? `Company login id: ${companySlug}` : null;

  const text = [
    `Hi ${firstName},`,
    ``,
    opening,
    ``,
    `Set a new password here:`,
    resetUrl,
    ``,
    closing,
    slugLine ? `` : null,
    slugLine,
    ``,
    `—`,
    POWERED_BY,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const t = resolveEmailTheme(paletteId);
  const icon = companyIconHtml({
    companyName,
    markId,
    logoUrl,
    accent: t.accent,
    accentSoft: t.accentSoft,
    onAccent: t.onAccent,
  });
  const safeUrl = resetUrl.replace(/&/g, '&amp;');
  const safeSlug = companySlug ? escapeHtml(companySlug) : '';

  const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: ${t.ink}; background: ${t.paper}; padding: 32px;">
    <div style="max-width: 600px; margin: 0 auto; background: ${t.surface}; border: 1px solid ${t.rule}; border-radius: 10px; overflow: hidden;">
      <div style="height: 4px; background: ${t.accent};"></div>
      <div style="padding: 24px 24px 8px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td valign="middle" style="padding-right: 12px;">
              ${icon}
            </td>
            <td valign="middle" style="font-size: 14px; font-weight: 700; color: ${t.ink};">
              ${escapeHtml(companyName)}
            </td>
          </tr>
        </table>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: ${t.ink};">
          Set a new password
        </h1>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0;">Hi ${escapeHtml(firstName)},</p>
        <p>${escapeHtml(opening)}</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
          <tr>
            <td style="border-radius: 10px; background: ${t.accent}; text-align: center;">
              <a
                href="${safeUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="background: ${t.accent}; border: 1px solid ${t.accent}; border-radius: 10px; color: ${t.onAccent}; display: inline-block; font-size: 14px; font-weight: 600; line-height: 1; padding: 14px 20px; text-decoration: none;"
              >
                Set a new password
              </a>
            </td>
          </tr>
        </table>

        <p style="font-size: 14px; color: ${t.muted};">
          If the button does not work, use this link:
        </p>

        <p style="font-size: 14px; word-break: break-all;">
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: ${t.accent}; text-decoration: underline;">
            ${safeUrl}
          </a>
        </p>

        <p style="font-size: 13px; color: ${t.muted}; margin-top: 24px;">
          ${escapeHtml(closing)}${safeSlug ? `<br />Company login id: <strong>${safeSlug}</strong>` : ''}
        </p>
      </div>
    </div>
    <p style="max-width: 600px; margin: 12px auto 0; text-align: center; font-size: 11px; color: ${t.muted};">
      ${POWERED_BY}
    </p>
  </div>
`;
  return { subject, text, html };
}
