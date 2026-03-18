function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildInviteEmail({
  firstName,
  inviterName,
  inviteUrl,
  appName = 'CRM',
  role,
  expiresHours = 24,
}: {
  firstName: string;
  inviterName?: string;
  inviteUrl: string;
  appName?: string;
  role: string;
  expiresHours?: number;
}) {
  const safeFirstName = escapeHtml(firstName);
  const safeRole = escapeHtml(role);
  const safeInviter = inviterName ? escapeHtml(inviterName) : 'your team';

  const subject = `You’ve been invited to join ${appName}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `${safeInviter} invited you to join ${appName} as ${role}.`,
    ``,
    `Set up your account here:`,
    inviteUrl,
    ``,
    `This invite link expires in ${expiresHours} hours and can only be used once.`,
  ].join('\n');

  const safeInviteUrl = inviteUrl.replace(/&/g, '&amp;');

  const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; background: #f8fafc; padding: 32px;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
      <div style="padding: 24px 24px 8px;">
        <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280;">
          Rooftop Realty CRM
        </div>
        <h1 style="margin: 8px 0 0; font-size: 24px; color: #111827;">
          You’ve been invited
        </h1>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0;">Hi ${safeFirstName},</p>
        <p>${safeInviter} invited you to join <strong>Rooftop Realty</strong> as <strong>${safeRole}</strong>.</p>
        <p>Click below to set your password and activate your account.</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
          <tr>
            <td style="border-radius: 10px; background: #111827; text-align: center;">
              <a
                href="${safeInviteUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="background: #111827; border: 1px solid #111827; border-radius: 10px; color: #ffffff; display: inline-block; font-size: 14px; font-weight: 600; line-height: 1; padding: 14px 20px; text-decoration: none;"
              >
                Set Up Your Account
              </a>
            </td>
          </tr>
        </table>

        <p style="font-size: 14px; color: #4b5563;">
          If the button does not work, use this link:
        </p>

        <p style="font-size: 14px; word-break: break-all;">
          <a href="${safeInviteUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">
            ${safeInviteUrl}
          </a>
        </p>

        <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">
          This invite link expires in 24 hours and can only be used once.
        </p>
      </div>
    </div>
  </div>
`;
  return { subject, text, html };
}
