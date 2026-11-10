/**
 * The address people use to reach Joist, for links that leave the app
 * (invites today).
 *
 * In production it is always APP_BASE_URL, which the boot check requires:
 * a link built from request headers could point at whatever host a request
 * claimed to come from. Outside production, the admin's own browser origin
 * (sent as X-App-Base-Url) keeps LAN and tunnel addresses working.
 */
export function getAppBaseUrl(req: any): string {
  const configured = process.env.APP_BASE_URL?.trim();

  if (process.env.NODE_ENV === 'production' && configured) {
    return configured.replace(/\/+$/, '');
  }

  const explicitBaseUrl = req.headers['x-app-base-url'];
  if (explicitBaseUrl) return explicitBaseUrl;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (req.headers.origin) return req.headers.origin;

  return configured || 'http://localhost:3000';
}
