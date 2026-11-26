/**
 * What a production boot refuses.
 *
 * Development and tests keep their defaults. Under NODE_ENV=production the
 * backend will not start on a configuration that only works on a trusted
 * LAN: links built from request headers, a cookie sent over plain HTTP, a
 * short signing secret, or an integration that uses one account for every
 * company on the host. See docs/guide/hosting.md.
 */

import { registrationConfigProblems } from '../lib/registration';

type Env = Record<string, string | undefined>;

const MIN_JWT_SECRET_BYTES = 32;

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function setKeys(env: Env, prefix: string): string[] {
  return Object.keys(env)
    .filter((key) => key.startsWith(prefix) && (env[key] ?? '').trim() !== '')
    .sort();
}

export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Every reason this environment is unsafe to serve in production. */
export function productionConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];

  if (!isHttpsUrl(env.APP_BASE_URL)) {
    problems.push(
      'APP_BASE_URL must be the https:// address people use to reach Joist. Invite links are built from it.'
    );
  }

  if (!isHttpsUrl(env.FRONTEND_URL)) {
    problems.push('FRONTEND_URL must be the https:// address of the frontend.');
  }

  const secret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(secret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    problems.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes (for example: openssl rand -hex 32).`
    );
  }

  const quickbooks = setKeys(env, 'QB_');
  if (quickbooks.length) {
    problems.push(
      `QuickBooks must stay off on a shared host until it works per company. Unset ${quickbooks.join(', ')}.`
    );
  }

  const abc = setKeys(env, 'ABC_');
  if (abc.length) {
    problems.push(
      `ABC Supply uses one account for every company on the host. Unset ${abc.join(', ')}.`
    );
  }

  if (env.AUTH_COOKIE_CROSS_SITE === 'true') {
    problems.push(
      'AUTH_COOKIE_CROSS_SITE=true is not supported in production. Serve the API through the frontend\'s /api rewrite on the same site.'
    );
  }

  // The operator surface (PLAN_operator.md §5) is off until
  // OPERATOR_JWT_SECRET is set. Once it is on, it must have its own strong
  // secret and sit behind Cloudflare Access.
  const operatorSecret = (env.OPERATOR_JWT_SECRET ?? '').trim();
  if (operatorSecret) {
    if (Buffer.byteLength(operatorSecret, 'utf8') < MIN_JWT_SECRET_BYTES) {
      problems.push(
        `OPERATOR_JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes (for example: openssl rand -hex 32).`
      );
    }
    if (operatorSecret === secret.trim()) {
      problems.push('OPERATOR_JWT_SECRET must differ from JWT_SECRET.');
    }
    const team = (env.OPERATOR_CF_ACCESS_TEAM_DOMAIN ?? '').trim();
    const aud = (env.OPERATOR_CF_ACCESS_AUD ?? '').trim();
    if (!team || !aud) {
      problems.push(
        'The operator surface needs Cloudflare Access: set OPERATOR_CF_ACCESS_TEAM_DOMAIN and OPERATOR_CF_ACCESS_AUD, or unset OPERATOR_JWT_SECRET.'
      );
    }
  }

  // The registration gate (PLAN_operator.md §7) needs mail to confirm each
  // new owner's email, and never runs open.
  const mailConfigured = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every(
    (key) => (env[key] ?? '').trim() !== ''
  );
  problems.push(...registrationConfigProblems(env, mailConfigured));

  if ((env.TRUST_PROXY ?? '').trim().toLowerCase() === 'true') {
    problems.push(
      'TRUST_PROXY=true trusts any X-Forwarded-For a client sends. Use loopback, a hop count, or the proxy addresses.'
    );
  }

  return problems;
}

/** Throws with every problem listed when production config is unsafe. */
export function assertProductionConfig(env: Env = process.env): void {
  if (!isProduction(env)) return;
  const problems = productionConfigProblems(env);
  if (problems.length) {
    throw new Error(
      `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }
}

/**
 * Express "trust proxy" from TRUST_PROXY. Default: loopback, because the
 * frontend's /api rewrite connects from the same host and passes the TLS
 * proxy's X-Forwarded-For through unchanged.
 */
export function trustProxySetting(env: Env = process.env): boolean | number | string {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (!raw) return 'loopback';
  const lower = raw.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
