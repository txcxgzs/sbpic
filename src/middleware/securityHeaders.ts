import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

// 管理页面等前端需要内联脚本，故 CSP 不限制脚本（图床小项目，平衡安全与可用）；
// 关键是防点击劫持和类型嗅探。图片代理 /i/* 路由会自行覆盖头。
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
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
