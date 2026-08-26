import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

// CSP：允许内联脚本/样式（前端单页需要）+ Cloudflare Turnstile 脚本；
// 图片允许 data/blob/https（外链图床、内联预览）；其余默认 self。
// /i/* 图片代理路由会在响应时覆盖头。
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/** 错误响应不缓存 */
export function noStoreOnError(_req: Request, res: Response, next: NextFunction): void {
  const send = res.send;
  res.send = function (this: Response, body?: unknown): Response {
    if (res.statusCode >= 400) {
      res.setHeader('Cache-Control', 'no-store');
    }
    return send.call(this, body);
  } as typeof res.send;
  next();
}
