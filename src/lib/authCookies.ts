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

  return {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_WEEK_MS,
  };
}
