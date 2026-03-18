export function getAppBaseUrl(req: any) {
  const explicitBaseUrl = req.headers['x-app-base-url'];
  if (explicitBaseUrl) return explicitBaseUrl;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (req.headers.origin) return req.headers.origin;

  return process.env.APP_BASE_URL || 'http://localhost:3000';
}
