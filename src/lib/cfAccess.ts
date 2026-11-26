import crypto from 'crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Cloudflare Access in front of the operator hostname (PLAN_operator.md §5).
 *
 * Cloudflare puts a signed assertion on every request it lets through to
 * operator.<domain>: the `Cf-Access-Jwt-Assertion` header, and the
 * `CF_Authorization` cookie. The backend checks the signature against the
 * team's published keys, the application's audience tag and the issuer, so a
 * request that reached the origin some other way (the CRM's own hostname,
 * the LAN) is refused even though it can name the same /api/operator path.
 *
 * Configuration:
 *   OPERATOR_CF_ACCESS_TEAM_DOMAIN  e.g. yourteam.cloudflareaccess.com
 *   OPERATOR_CF_ACCESS_AUD          the Access application's AUD tag
 */

type Env = Record<string, string | undefined>;

export type CfAccessConfig = { teamDomain: string; audience: string };

export function cfAccessConfig(env: Env = process.env): CfAccessConfig | null {
  const teamDomain = (env.OPERATOR_CF_ACCESS_TEAM_DOMAIN ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const audience = (env.OPERATOR_CF_ACCESS_AUD ?? '').trim();
  if (!teamDomain || !audience) return null;
  return { teamDomain, audience };
}

const KEY_TTL_MS = 60 * 60 * 1000;
const MIN_REFETCH_MS = 60 * 1000;

type KeySet = { fetchedAt: number; keys: Map<string, crypto.KeyObject> };

const keyCache = new Map<string, KeySet>();
const lastFetchAttempt = new Map<string, number>();

/** For tests: use these keys for a team instead of fetching them. */
let keySource: ((teamDomain: string) => Promise<Map<string, crypto.KeyObject>>) | null = null;

export function setCfAccessKeySourceForTests(
  source: ((teamDomain: string) => Promise<Map<string, crypto.KeyObject>>) | null
) {
  keySource = source;
  keyCache.clear();
  lastFetchAttempt.clear();
}

async function fetchKeys(teamDomain: string): Promise<Map<string, crypto.KeyObject>> {
  if (keySource) return keySource(teamDomain);
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`certs answered ${response.status}`);
  const body = (await response.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (typeof jwk.kid !== 'string') continue;
    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as any, format: 'jwk' }));
  }
  return keys;
}

async function keyFor(teamDomain: string, kid: string): Promise<crypto.KeyObject | null> {
  const now = Date.now();
  const cached = keyCache.get(teamDomain);
  const fresh = cached && now - cached.fetchedAt < KEY_TTL_MS;
  if (fresh && cached.keys.has(kid)) return cached.keys.get(kid)!;

  // Unknown kid or stale set: fetch again, but not more than once a minute,
  // so junk assertions can't make the backend hammer Cloudflare.
  const last = lastFetchAttempt.get(teamDomain) ?? 0;
  if (fresh && now - last < MIN_REFETCH_MS) return null;
  lastFetchAttempt.set(teamDomain, now);
  try {
    const keys = await fetchKeys(teamDomain);
    keyCache.set(teamDomain, { fetchedAt: now, keys });
    return keys.get(kid) ?? null;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'cf_access_certs_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return cached?.keys.get(kid) ?? null;
  }
}

/** The assertion a request carries: the header, else the Access cookie. */
export function cfAccessAssertion(req: Request): string | undefined {
  const header = req.get('cf-access-jwt-assertion');
  if (header) return header;
  return (req as any).cookies?.CF_Authorization as string | undefined;
}

export type CfAccessIdentity = { email: string | null; subject: string | null };

/** The verified identity, or null when the assertion is missing or doesn't hold. */
export async function verifyCfAccess(
  req: Request,
  config: CfAccessConfig
): Promise<CfAccessIdentity | null> {
  const token = cfAccessAssertion(req);
  if (!token) return null;
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid || decoded?.header?.alg !== 'RS256') return null;
  const key = await keyFor(config.teamDomain, kid);
  if (!key) return null;
  try {
    const claims = jwt.verify(token, key, {
      algorithms: ['RS256'],
      audience: config.audience,
      issuer: `https://${config.teamDomain}`,
    }) as { email?: string; sub?: string };
    return { email: claims.email ?? null, subject: claims.sub ?? null };
  } catch {
    return null;
  }
}
