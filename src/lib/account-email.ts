import { POWERED_BY } from './brand';
import { companyIconHtml, escapeHtml } from './invite-email';
import { resolveEmailTheme } from './print-theme';

/**
 * The layout every account email shares (sign-up, lifecycle, deletion),
 * like the invite and reset emails: the company's mark and colours at the
 * top, "Powered by Joist" under it.
 */
export type AccountEmail = {
  subject: string;
  heading: string;
  firstName?: string | null;
  paragraphs: string[];
  /** A button and its link, shown with the link spelled out under it. */
  button?: { label: string; url: string } | null;
  /** Small print: a closing line, the company login id. */
  footnote?: { text: string; strong?: string }[];
  companyName: string;
  paletteId?: string | null;
  markId?: string | null;
  logoUrl?: string | null;
};

export function renderAccountEmail(input: AccountEmail) {
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hello,';
  const footnote = input.footnote ?? [];

  const text = [
    greeting,
    ``,
    ...input.paragraphs.flatMap((p) => [p, ``]),
    input.button ? `${input.button.label}: ${input.button.url}` : null,
    input.button ? `` : null,
    ...footnote.flatMap((f) => [`${f.text}${f.strong ? ` ${f.strong}` : ''}`, ``]),
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
  const safeUrl = input.button ? input.button.url.replace(/&/g, '&amp;') : '';
  const button = input.button
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
                ${escapeHtml(input.button.label)}
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
  const small = footnote
    .map((f) => `${escapeHtml(f.text)}${f.strong ? ` <strong>${escapeHtml(f.strong)}</strong>` : ''}`)
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
          ${escapeHtml(input.heading)}
        </h1>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0;">${escapeHtml(greeting)}</p>
        ${input.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n        ')}
        ${button}
        ${small ? `<p style="font-size: 13px; color: ${t.muted}; margin-top: 24px;">${small}</p>` : ''}
      </div>
    </div>
    <p style="max-width: 600px; margin: 12px auto 0; text-align: center; font-size: 11px; color: ${t.muted};">
      ${POWERED_BY}
    </p>
  </div>
`;
  return { subject: input.subject, text, html };
}
