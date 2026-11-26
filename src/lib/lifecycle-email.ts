import { renderAccountEmail } from './account-email';

/**
 * The emails a company's owner gets as its account moves through the
 * states (PLAN_operator.md §3), in the shared account-email layout.
 *
 * - entering a state: past_due ("payment missed"), suspended (read-only,
 *   export your data), pending_deletion ("deleting on {date}"), on_hold;
 * - a reminder before a state's timer runs out (REMINDER_DAYS);
 * - deleted, to billing_email (else the owner) once the rows are gone.
 *
 * Billing doesn't exist yet, so "pay" means replying to the email.
 */
export type LifecycleEmailKind =
  | 'past_due'
  | 'suspended'
  | 'pending_deletion'
  | 'on_hold'
  | 'reminder'
  | 'deleted';

export type LifecycleEmailInput = {
  kind: LifecycleEmailKind;
  firstName?: string | null;
  companyName: string;
  companySlug?: string | null;
  /** suspended: it came from a trial, not a missed payment. */
  fromTrial?: boolean;
  /** reminder: the state whose timer is running out, and how many days are left. */
  status?: string;
  daysLeft?: number;
  /** The state's timer: when the next thing happens. */
  dueAt?: Date | string | null;
  /** A sign-in link carrying the slug. */
  signInUrl?: string | null;
  paletteId?: string | null;
  markId?: string | null;
  logoUrl?: string | null;
};

export function formatEmailDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function inDays(days: number) {
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

type Copy = { subject: string; heading: string; paragraphs: string[]; button?: string };

function copyFor(input: LifecycleEmailInput): Copy {
  const company = input.companyName;
  const date = formatEmailDate(input.dueAt);
  switch (input.kind) {
    case 'past_due':
      return {
        subject: `Payment missed for ${company}`,
        heading: 'We missed a payment',
        paragraphs: [
          `${company}’s latest payment didn’t come through. Your team keeps full access for now.`,
          date
            ? `If it isn’t paid by ${date}, the CRM becomes read-only. Reply to this email to sort it out.`
            : 'Reply to this email to sort it out.',
        ],
      };
    case 'suspended':
      return {
        subject: `${company} is read-only`,
        heading: `${company} is read-only`,
        paragraphs: [
          input.fromTrial
            ? `Your trial has ended. Your team can still sign in and see everything, but can’t make changes.`
            : `${company}’s account is unpaid. Your team can still sign in and see everything, but can’t make changes.`,
          'As the owner, you can export the company’s data from Settings at any time.',
          date
            ? `On ${date} the workspace closes and nobody can sign in. Reply to this email to keep it going.`
            : 'Reply to this email to keep it going.',
        ],
        button: 'Sign in',
      };
    case 'pending_deletion':
      return {
        subject: `${company} will be deleted${date ? ` on ${date}` : ''}`,
        heading: 'Your workspace is closed',
        paragraphs: [
          `Nobody at ${company} can use the CRM now. Your clients’ links say it’s no longer available.`,
          date
            ? `On ${date} the company and everything in it will be deleted.`
            : 'The company and everything in it will be deleted.',
          'As the owner, you can sign in to ask for a final export of your data. Reply to this email if you’d like the workspace back.',
        ],
        button: 'Sign in',
      };
    case 'on_hold':
      return {
        subject: `${company} is on hold`,
        heading: `${company} is on hold`,
        paragraphs: [
          `${company}’s workspace has been put on hold. Nobody can sign in, and your clients’ links are unavailable for now.`,
          'Reply to this email and we’ll explain what happens next.',
        ],
      };
    case 'reminder':
      return reminderCopy(input, company, date);
    case 'deleted':
      return {
        subject: `${company} has been deleted`,
        heading: 'Your data has been deleted',
        paragraphs: [
          `${company} and everything in it has been deleted from Joist.`,
          'Copies in our backups expire within 14 days. After that, nothing is left.',
        ],
      };
  }
}

function reminderCopy(input: LifecycleEmailInput, company: string, date: string | null): Copy {
  const days = input.daysLeft ?? 0;
  const when = inDays(days);
  const on = date ? ` on ${date}` : '';
  switch (input.status) {
    case 'trial':
      return {
        subject: `Your trial ends ${when}`,
        heading: `Your trial ends ${when}`,
        paragraphs: [
          `${company}’s free trial ends${on}. After that the CRM becomes read-only until the account is paid.`,
          'Reply to this email to keep it going.',
        ],
      };
    case 'past_due':
      return {
        subject: `Reminder: payment missed for ${company}`,
        heading: 'Payment still missing',
        paragraphs: [
          `${company}’s payment is still missing. The CRM becomes read-only ${when}${on}.`,
          'Reply to this email to sort it out.',
        ],
      };
    case 'suspended':
      return {
        subject: `${company} closes ${when}`,
        heading: `Your workspace closes ${when}`,
        paragraphs: [
          `${company} has been read-only. It closes${on}, and then nobody can sign in.`,
          'As the owner, you can export the company’s data from Settings until then. Reply to this email to keep it going.',
        ],
        button: 'Sign in',
      };
    case 'pending_deletion':
    default:
      return {
        subject: `${company} will be deleted ${when}`,
        heading: `Deleting ${when}`,
        paragraphs: [
          `${company} and everything in it will be deleted${on}.`,
          'As the owner, you can still sign in to ask for a final export. Reply to this email if you’d like the workspace back.',
        ],
        button: 'Sign in',
      };
  }
}

export function buildLifecycleEmail(input: LifecycleEmailInput) {
  const copy = copyFor(input);
  return renderAccountEmail({
    subject: copy.subject,
    heading: copy.heading,
    firstName: input.firstName,
    paragraphs: copy.paragraphs,
    button: copy.button && input.signInUrl ? { label: copy.button, url: input.signInUrl } : null,
    footnote: input.companySlug && copy.button ? [{ text: 'Company login id:', strong: input.companySlug }] : [],
    companyName: input.companyName,
    paletteId: input.paletteId,
    markId: input.markId,
    logoUrl: input.logoUrl,
  });
}
