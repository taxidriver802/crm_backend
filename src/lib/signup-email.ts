import { renderAccountEmail } from './account-email';

/**
 * The sign-up emails (PLAN_operator.md §7), in the shared account-email
 * layout.
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
  const footnote: { text: string; strong?: string }[] = [];
  if (copy.closing) footnote.push({ text: copy.closing });
  if (input.kind === 'welcome' && input.companySlug) {
    footnote.push({ text: 'Company login id:', strong: input.companySlug });
  }
  return renderAccountEmail({
    subject: copy.subject,
    heading: copy.heading,
    firstName: input.firstName,
    paragraphs: copy.paragraphs,
    button: copy.button && input.url ? { label: copy.button, url: input.url } : null,
    footnote,
    companyName: input.companyName,
    paletteId: input.paletteId,
    markId: input.markId,
    logoUrl: input.logoUrl,
  });
}
