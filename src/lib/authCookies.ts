import type { CookieOptions } from 'express';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function authCookieOptions(): CookieOptions {
  const crossSite = process.env.AUTH_COOKIE_CROSS_SITE === 'true';

  if (crossSite) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: ONE_WEEK_MS,
    };
  }

  // Production is served over HTTPS (docs/guide/hosting.md), so the cookie
  // never travels over plain HTTP there. Local development stays on http.
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_WEEK_MS,
  };
}
