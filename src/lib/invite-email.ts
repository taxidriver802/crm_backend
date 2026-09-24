import { isCompanyMarkId } from './companySlug';
import { resolveEmailTheme } from './print-theme';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role;
}

function companyInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

/** Stroke icons match crm_frontend/src/components/icons.js. */
const MARK_PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-7h4v7"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  spark: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  invoice:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
};

function safeHttpUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return escapeHtml(url);
  } catch {
    return null;
  }
}

function companyIconHtml({
  companyName,
  markId,
  logoUrl,
  accent,
  accentSoft,
  onAccent,
}: {
  companyName: string;
  markId?: string | null;
  logoUrl?: string | null;
  accent: string;
  accentSoft: string;
  onAccent: string;
}) {
  const safeLogo = safeHttpUrl(logoUrl);
  if (safeLogo) {
    return `<img src="${safeLogo}" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border:0;border-radius:8px;object-fit:cover;" />`;
  }

  const paths =
    markId && markId !== 'product' && isCompanyMarkId(markId)
      ? MARK_PATHS[markId]
      : null;

  if (paths) {
    return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${accentSoft};border-radius:8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
            ${paths}
          </svg>
        </td>
      </tr>
    </table>`;
  }

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
    <tr>
      <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${accent};color:${onAccent};border-radius:8px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;line-height:36px;">
        ${escapeHtml(companyInitials(companyName))}
      </td>
    </tr>
  </table>`;
}

export function buildInviteEmail({
  firstName,
  inviterName,
  inviteUrl,
  companyName,
  companySlug,
  role,
  expiresHours = 24,
  paletteId,
  markId,
  logoUrl,
}: {
  firstName: string;
  inviterName?: string;
  inviteUrl: string;
  companyName: string;
  companySlug?: string | null;
  role: string;
  expiresHours?: number;
  paletteId?: string | null;
  markId?: string | null;
  logoUrl?: string | null;
}) {
  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(companyName);
  const safeRole = escapeHtml(roleLabel(role));
  const safeInviter = inviterName ? escapeHtml(inviterName) : 'your team';
  const safeSlug = companySlug ? escapeHtml(companySlug) : '';
  const slugNote = safeSlug
    ? `Company login id: ${companySlug}. You’ll go straight to your dashboard after setup. Save this id — you’ll need it the next time you sign in, including on another computer.`
    : '';

  const subject = `You’ve been invited to join ${companyName}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `${inviterName || 'Your team'} invited you to join ${companyName} as ${roleLabel(role)}.`,
    ``,
    slugNote,
    slugNote ? `` : null,
    `Set up your account here:`,
    inviteUrl,
    ``,
    `This invite link expires in ${expiresHours} hours and can only be used once.`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const safeInviteUrl = inviteUrl.replace(/&/g, '&amp;');
  const t = resolveEmailTheme(paletteId);
  const icon = companyIconHtml({
    companyName,
    markId,
    logoUrl,
    accent: t.accent,
    accentSoft: t.accentSoft,
    onAccent: t.onAccent,
  });

  const slugBlock = safeSlug
    ? `
        <div style="margin: 0 0 20px; padding: 12px 14px; background: ${t.accentSoft}; border: 1px solid ${t.rule}; border-radius: 8px;">
          <div style="font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.muted};">
            Company login id
          </div>
          <div style="margin-top: 4px; font-size: 16px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: ${t.ink};">
            ${safeSlug}
          </div>
          <p style="margin: 6px 0 0; font-size: 13px; color: ${t.muted};">
            You’ll go straight to your dashboard after setup. Save this id — you’ll need it the next time you sign in, including on another computer.
          </p>
        </div>`
    : '';

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
              ${safeCompany}
            </td>
          </tr>
        </table>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: ${t.ink};">
          You’ve been invited
        </h1>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0;">Hi ${safeFirstName},</p>
        <p>${safeInviter} invited you to join <strong>${safeCompany}</strong> as <strong>${safeRole}</strong>.</p>
        ${slugBlock}
        <p style="margin-top: 0;">Click below to set your password and activate your account.</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
          <tr>
            <td style="border-radius: 10px; background: ${t.accent}; text-align: center;">
              <a
                href="${safeInviteUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="background: ${t.accent}; border: 1px solid ${t.accent}; border-radius: 10px; color: ${t.onAccent}; display: inline-block; font-size: 14px; font-weight: 600; line-height: 1; padding: 14px 20px; text-decoration: none;"
              >
                Set Up Your Account
              </a>
            </td>
          </tr>
        </table>

        <p style="font-size: 14px; color: ${t.muted};">
          If the button does not work, use this link:
        </p>

        <p style="font-size: 14px; word-break: break-all;">
          <a href="${safeInviteUrl}" target="_blank" rel="noopener noreferrer" style="color: ${t.accent}; text-decoration: underline;">
            ${safeInviteUrl}
          </a>
        </p>

        <p style="font-size: 13px; color: ${t.muted}; margin-top: 24px;">
          This invite link expires in ${expiresHours} hours and can only be used once.
        </p>
      </div>
    </div>
  </div>
`;
  return { subject, text, html };
}
