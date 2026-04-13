import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const userId = (req as any).user?.userId ?? 'anonymous';
  const route = `${req.method} ${req.originalUrl}`;
  const errName = err?.name || 'UnknownError';
  const errMsg = err?.message || 'No message';

  console.error(
    JSON.stringify({
      level: 'error',
      route,
      user_id: userId,
      error_name: errName,
      error_message: errMsg,
      stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
      timestamp: new Date().toISOString(),
    })
  );

  if (res.headersSent) return;

  const status = typeof err?.status === 'number' ? err.status : 500;
  const clientMessage = status >= 500 ? 'Internal Server Error' : errMsg;

  return res.status(status).json({ ok: false, error: clientMessage });
}
