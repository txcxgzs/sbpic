import { Request, Response, NextFunction } from 'express';
import { getSettingNum } from '../services/settings';

/**
 * 上传并发信号量：限制同时处理的上传请求数，避免大并发打爆内存与 R2。
 * 超出立即返回 503 + Retry-After。
 */
let inflight = 0;

export function uploadConcurrency(req: Request, res: Response, next: NextFunction): void {
  const maxConcurrent = getSettingNum('upload_concurrency', 20);
  if (inflight >= maxConcurrent) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: '服务器繁忙，请稍后再试' });
    return;
  }
  inflight++;
  res.on('close', () => {
    if (inflight > 0) inflight--;
  });
  next();
}
