import { Request, Response, NextFunction } from 'express';
import { R2Error } from '../r2/client';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: '资源不存在' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof R2Error) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: '服务器内部错误' });
}
