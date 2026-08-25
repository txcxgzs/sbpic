import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function extractToken(req: Request): string | null {
  // Authorization: Bearer xxx
  const auth = req.headers.authorization;
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  // query ?token=
  if (typeof req.query.token === 'string' && req.query.token) {
    return req.query.token;
  }
  // multipart/text-body 字段需 multer/text 解析后才有，这里先兜底
  if (typeof req.body?.token === 'string' && req.body.token) {
    return req.body.token;
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token || !safeEqual(token, config.adminToken)) {
    res.status(401).json({ error: '未授权: token 无效或缺失' });
    return;
  }
  next();
}
