import crypto from 'crypto';

/**
 * How a new company gets in (PLAN_operator.md §7), from REGISTRATION_MODE:
 *
 * - `approval` (the default): the owner confirms their email, then the
 *   company waits in the operator's queue.
 * - `invite_code`: the same, but a sign-up code from REGISTRATION_INVITE_CODES
 *   skips the queue once the email is confirmed. Without a code, sign-up
 *   still goes to the queue.
 * - `closed`: nobody can sign up.
 * - `open`: the company is active at once and the owner is signed in, as
 *   before the gate. Development and tests only; production refuses it.
 *
 * Read on every request, so a test can switch it.
 */
export const REGISTRATION_MODES = ['approval', 'invite_code', 'closed', 'open'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

type Env = Record<string, string | undefined>;

function rawMode(env: Env) {
  return (env.REGISTRATION_MODE ?? '').trim().toLowerCase();
}

export function isRegistrationMode(value: string): value is RegistrationMode {
  return (REGISTRATION_MODES as readonly string[]).includes(value);
}

/** The mode in force. An unknown value falls back to approval (production refuses one). */
export function registrationMode(env: Env = process.env): RegistrationMode {
  const raw = rawMode(env);
  return isRegistrationMode(raw) ? raw : 'approval';
}

/** Problems with REGISTRATION_MODE for a production boot; mail is checked by the caller. */
export function registrationConfigProblems(env: Env, mailConfigured: boolean): string[] {
  const problems: string[] = [];
  const raw = rawMode(env);
  if (raw && !isRegistrationMode(raw)) {
    problems.push(
      `REGISTRATION_MODE must be one of approval, invite_code or closed (got "${raw}").`
    );
    return problems;
  }
  const mode = registrationMode(env);
  if (mode === 'open') {
    problems.push(
      'REGISTRATION_MODE=open lets anyone create a working company. It is for development only: use approval, invite_code or closed.'
    );
  }
  if ((mode === 'approval' || mode === 'invite_code') && !mailConfigured) {
    problems.push(
      `REGISTRATION_MODE=${mode} sends a link to confirm each new owner's email. Configure mail (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM) or set REGISTRATION_MODE=closed.`
    );
  }
  if (mode === 'invite_code' && inviteCodes(env).length === 0) {
    problems.push('REGISTRATION_MODE=invite_code needs at least one code in REGISTRATION_INVITE_CODES.');
  }
  return problems;
}

/** The sign-up codes, comma-separated in REGISTRATION_INVITE_CODES. */
export function inviteCodes(env: Env = process.env): string[] {
  return (env.REGISTRATION_INVITE_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
}

function digest(value: string) {
  return crypto.createHash('sha256').update(value).digest();
}

/** Whether a sign-up code is one of the configured ones, compared in constant time. */
export function inviteCodeMatches(code: unknown, env: Env = process.env): boolean {
  if (typeof code !== 'string' || !code.trim()) return false;
  const given = digest(code.trim());
  let found = false;
  for (const known of inviteCodes(env)) {
    if (crypto.timingSafeEqual(given, digest(known))) found = true;
  }
  return found;
}
