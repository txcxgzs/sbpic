import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const denyMsg = (msg: string) => ({ error: msg });

// 全局限流：按 IP，防扫描
export const globalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: config.limits.globalPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  message: denyMsg('请求过于频繁'),
});

// 上传限流：按 IP
export const uploadRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: config.limits.uploadPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:up`,
  message: denyMsg('上传过于频繁，请稍后再试'),
});

// 上传限流：按用户（需在 requireApiToken 之后挂载）
export const uploadUserLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: config.limits.uploadPerUserPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user?.id ?? req.ip}`,
  message: denyMsg('上传过于频繁，请稍后再试'),
});

// 注册限流：按 IP，每 10 分钟 N 次
export const registerLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: config.registerLimitPer10Min,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:reg`,
  message: denyMsg('注册过于频繁，请稍后再试'),
});

// 登录限流：按 IP+username
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const u = (req.body?.username as string) || 'anon';
    return `${req.ip}:login:${u}`;
  },
  message: denyMsg('登录尝试过于频繁，请稍后再试'),
});

// 验证邮件重发限流：按 user，每 10 分钟 1 次
export const resendVerifyLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user?.id ?? req.ip}:resend`,
  message: denyMsg('验证邮件已发送，请 10 分钟后再试'),
});

// 图片访问限流：按 IP，较宽松
export const viewLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: config.limits.viewPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:view`,
  message: denyMsg('访问过于频繁'),
});

// ===== 登录失败封禁（内存 Map + TTL，进程级）=====
const failMap = new Map<string, { count: number; banUntil: number }>();

function getBanKey(ip: string, username: string): string {
  return `${ip}:${username}`;
}

/** 记录一次登录失败；返回是否被封禁 */
export function recordLoginFailure(ip: string, username: string): boolean {
  const key = getBanKey(ip, username);
  const now = Date.now();
  const rec = failMap.get(key);
  if (rec && rec.banUntil > now) return true; // 已在封禁期
  // 之前被封过且已过封禁期 → 重新计数；未被封过（banUntil=0）→ 累加
  let count = rec ? (rec.banUntil > 0 ? 0 : rec.count) : 0;
  count += 1;
  if (count >= config.limits.loginFailThreshold) {
    const banUntil = now + config.limits.loginBanMinutes * 60 * 1000;
    failMap.set(key, { count, banUntil });
    console.warn(`[rateLimit] IP ${ip} 登录用户 ${username} 失败 ${count} 次，封禁 ${config.limits.loginBanMinutes} 分钟`);
    return true;
  }
  failMap.set(key, { count, banUntil: 0 });
  return false;
}

/** 清除登录失败计数（登录成功时调用） */
export function clearLoginFailure(ip: string, username: string): void {
  failMap.delete(getBanKey(ip, username));
}

/** 检查是否处于封禁期 */
export function isLoginBanned(ip: string, username: string): boolean {
  const rec = failMap.get(getBanKey(ip, username));
  if (!rec) return false;
  return rec.banUntil > Date.now();
}
