import crypto from 'crypto';

/**
 * Time-based one-time codes (RFC 6238, the kind authenticator apps make):
 * HMAC-SHA1, 30-second steps, 6 digits, on Node's crypto with no new
 * dependency. A code from the step before or after is accepted, for clock
 * drift; the caller keeps the last step used so no code works twice.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const DRIFT_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret: 20 random bytes, as base32 (what an authenticator app takes). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * The step a code belongs to, or null when it matches none near now, or
 * only a step at or before `lastStep` (already used).
 */
export function verifyTotp(
  secret: string,
  code: unknown,
  { now = Date.now(), lastStep = null }: { now?: number; lastStep?: number | null } = {}
): number | null {
  if (typeof code !== 'string') return null;
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = totpStep(now);
  let found: number | null = null;
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits)) && found === null) {
      found = step;
    }
  }
  if (found === null) return null;
  if (lastStep != null && found <= lastStep) return null;
  return found;
}

/** The otpauth:// link an authenticator app reads (as a QR code or a tap). */
export function totpUri(secret: string, account: string, issuer = 'Joist operator') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Secrets at rest: AES-256-GCM, keyed from OPERATOR_JWT_SECRET through
 * HKDF. A database copy alone doesn't give the codes. Changing that secret
 * makes the stored one unreadable: clear it with
 * `npm run operator:create -- you@example.com --reset --clear-totp` and set
 * it up again.
 */
function totpKey(): Buffer {
  const secret = (process.env.OPERATOR_JWT_SECRET ?? '').trim();
  if (!secret) throw new Error('OPERATOR_JWT_SECRET is not set');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'joist-operator', 'totp-secret', 32));
}

export function sealTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', totpKey(), iv);
  const sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), sealed.toString('base64')].join(':');
}

/** The secret, or null when it can't be read (another key, or tampered with). */
export function openTotpSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, sealed] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !sealed) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', totpKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
