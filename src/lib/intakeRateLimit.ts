import { LIMITS, check, record, resetRateLimits, type LimitResult } from './rateLimit';

/**
 * Public intake: at most 5 submissions per client address in 15 minutes, and
 * at most 30 per intake link in an hour. The link cap replaces the old
 * global cap, which let one company's flooded form shut every company's
 * form for an hour.
 */
export function checkIntakeRateLimit(ip: string, linkToken: string): LimitResult {
  const byIp = check(LIMITS.intakeIp, ip || 'unknown');
  if (!byIp.allowed) return byIp;
  const byLink = check(LIMITS.intakeLink, linkToken);
  if (!byLink.allowed) return byLink;
  record(LIMITS.intakeIp, ip || 'unknown');
  record(LIMITS.intakeLink, linkToken);
  return { allowed: true, retryAfterSec: 0 };
}

/** Test helper */
export function resetIntakeRateLimit() {
  resetRateLimits();
}
