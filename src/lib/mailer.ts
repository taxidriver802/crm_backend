import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const mailFrom = process.env.MAIL_FROM;

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 8000);

const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass && mailFrom);

if (!smtpConfigured) {
  console.warn(
    '[mailer] Missing SMTP configuration. Invite emails will fail until env vars are set.'
  );
}

export const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: smtpConfigured
    ? {
        user: smtpUser,
        pass: smtpPass,
      }
    : undefined,
  connectionTimeout: SMTP_TIMEOUT_MS,
  greetingTimeout: SMTP_TIMEOUT_MS,
  socketTimeout: SMTP_TIMEOUT_MS,
});

function formatFrom(fromName?: string) {
  if (!fromName || !mailFrom) return mailFrom;
  const match = mailFrom.match(/<([^>]+)>/);
  const address = (match ? match[1] : mailFrom).trim();
  const safeName = fromName.replace(/[\r\n"]/g, '').trim();
  if (!safeName || !address) return mailFrom;
  return `"${safeName}" <${address}>`;
}

export async function sendMail({
  to,
  subject,
  html,
  text,
  fromName,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}) {
  if (!smtpConfigured) {
    throw new Error('SMTP is not configured');
  }

  return transporter.sendMail({
    from: formatFrom(fromName),
    to,
    subject,
    html,
    text,
  });
}
