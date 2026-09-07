type Hit = { at: number };

const ipHits = new Map<string, Hit[]>();
let globalHits: Hit[] = [];

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_GLOBAL = 60;

function prune(hits: Hit[], windowMs: number, now: number) {
  return hits.filter((hit) => now - hit.at < windowMs);
}

export function checkIntakeRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const key = ip || 'unknown';

  const prior = prune(ipHits.get(key) || [], WINDOW_MS, now);
  globalHits = prune(globalHits, GLOBAL_WINDOW_MS, now);

  if (prior.length >= MAX_PER_IP) {
    const oldest = prior[0]?.at ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  if (globalHits.length >= MAX_GLOBAL) {
    return { allowed: false, retryAfterSec: 60 };
  }

  prior.push({ at: now });
  globalHits.push({ at: now });
  ipHits.set(key, prior);
  return { allowed: true };
}

/** Test helper */
export function resetIntakeRateLimit() {
  ipHits.clear();
  globalHits = [];
}
