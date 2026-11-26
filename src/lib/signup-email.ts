import { POWERED_BY } from './brand';
import { companyIconHtml, escapeHtml } from './invite-email';
import { resolveEmailTheme } from './print-theme';

/**
 * The sign-up emails (PLAN_operator.md §7), laid out like the invite and
 * reset emails: the company's mark and colours at the top, "Powered by
 * Joist" under it.
 *
 * - verify: confirm the owner's email, with a single-use link.
 * - received: the email is confirmed and the company is waiting for review.
 * - welcome: the company was approved; a sign-in link carries its slug.
 * - denied: the company was not approved. The operator's reason is theirs
 *   and is never in it.
 */
export type SignupEmailKind = 'verify' | 'received' | 'welcome' | 'denied';

export type SignupEmailInput = {
  kind: SignupEmailKind;
  firstName: string;
  companyName: string;
  companySlug?: string | null;
  /** verify: the confirm link. welcome: the sign-in link. */
  url?: string | null;
  expiresHours?: number;
  trialDays?: number | null;
  paletteId?: string | null;
  markId?: string | null;
  logoUrl?: string | null;
};

type Copy = {
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: string;
  closing?: string;
};

function copyFor(input: SignupEmailInput): Copy {
  const company = input.companyName;
  switch (input.kind) {
    case 'verify':
      return {
        subject: `Confirm your email for ${company}`,
        heading: 'Confirm your email',
        paragraphs: [
          `Thanks for signing up ${company}. Confirm this is your email address, and we’ll review the company.`,
        ],
        button: 'Confirm email',
        closing: `This link expires in ${input.expiresHours ?? 24} hours and can only be used once. If you didn’t sign up, ignore this email.`,
      };
    case 'received':
      return {
        subject: `${company} is waiting for review`,
        heading: 'Thanks, your email is confirmed',
        paragraphs: [
          `${company} is waiting for review. We’ll email you when it’s ready, usually within a working day.`,
        ],
      };
    case 'welcome':
      return {
        subject: `${company} is ready`,
        heading: `${company} is ready`,
        paragraphs: [
          input.trialDays
            ? `Your company was approved. Your ${input.trialDays}-day trial starts now.`
            : 'Your company was approved.',
          'Sign in with the email and password you chose when you signed up.',
        ],
        button: 'Sign in',
      };
    case 'denied':
      return {
        subject: `About your sign-up for ${company}`,
        heading: 'Your sign-up wasn’t approved',
        paragraphs: [
          `We weren’t able to approve ${company}. Its staff can’t sign in.`,
          'If you think this is a mistake, reply to this email.',
        ],
      };
  }
}

export function buildSignupEmail(input: SignupEmailInput) {
  const copy = copyFor(input);
  const slugLine = input.companySlug ? `Company login id: ${input.companySlug}` : null;
  const showSlug = input.kind === 'welcome' && slugLine;

  const text = [
    `Hi ${input.firstName},`,
    ``,
    ...copy.paragraphs.flatMap((p) => [p, ``]),
    copy.button && input.url ? `${copy.button}: ${input.url}` : null,
    copy.button && input.url ? `` : null,
    copy.closing ?? null,
    copy.closing ? `` : null,
    showSlug ? slugLine : null,
    showSlug ? `` : null,
    `—`,
    POWERED_BY,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const t = resolveEmailTheme(input.paletteId);
  const icon = companyIconHtml({
    companyName: input.companyName,
    markId: input.markId,
    logoUrl: input.logoUrl,
    accent: t.accent,
    accentSoft: t.accentSoft,
    onAccent: t.onAccent,
  });
  const safeUrl = input.url ? input.url.replace(/&/g, '&amp;') : '';
  const button =
    copy.button && safeUrl
      ? `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
          <tr>
            <td style="border-radius: 10px; background: ${t.accent}; text-align: center;">
              <a
                href="${safeUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="background: ${t.accent}; border: 1px solid ${t.accent}; border-radius: 10px; color: ${t.onAccent}; display: inline-block; font-size: 14px; font-weight: 600; line-height: 1; padding: 14px 20px; text-decoration: none;"
              >
                ${escapeHtml(copy.button)}
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
        </p>`
      : '';
  const footnote = [
    copy.closing ? escapeHtml(copy.closing) : null,
    showSlug ? `Company login id: <strong>${escapeHtml(input.companySlug!)}</strong>` : null,
  ]
    .filter(Boolean)
    .join('<br />');

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
              ${escapeHtml(input.companyName)}
            </td>
          </tr>
        </table>
        <h1 style="margin: 16px 0 0; font-size: 24px; color: ${t.ink};">
          ${escapeHtml(copy.heading)}
        </h1>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0;">Hi ${escapeHtml(input.firstName)},</p>
        ${copy.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n        ')}
        ${button}
        ${footnote ? `<p style="font-size: 13px; color: ${t.muted}; margin-top: 24px;">${footnote}</p>` : ''}
      </div>
    </div>
    <p style="max-width: 600px; margin: 12px auto 0; text-align: center; font-size: 11px; color: ${t.muted};">
      ${POWERED_BY}
    </p>
  </div>
`;
  return { subject: copy.subject, text, html };
}
