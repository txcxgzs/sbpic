import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { UserRow } from '../db/pool';
import { getUserByApiToken } from '../services/auth';
import { config } from '../config';

// 扩展 express-session 的 SessionData
declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

// 扩展 Request，挂载当前用户
declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

/** 从 Authorization: Bearer <token> 取 API token */
function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  return null;
}

/** 已登录 session 用户 → req.user；未登录则继续（可选鉴权） */
async function attachSessionUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.session.userId) {
    const { getUserById } = await import('../services/auth');
    const user = await getUserById(req.session.userId);
    if (user) {
      if (user.disabled) {
        // 账号已被禁用：销毁 session，不再挂载用户
        req.session.destroy(() => {});
        next();
        return;
      }
      req.user = user;
      // 已登录但缺少 csrf_token cookie（旧 session 升级到 CSRF 版本）：
      // 自动补发，避免所有 POST 被 403 拦截。
      if (!req.cookies?.csrf_token) {
        issueCsrfToken(res);
      }
    } else {
      // 用户被删，清 session
      req.session.destroy(() => {});
    }
  }
  next();
}

/** 要求已登录（session） */
function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  next();
}

/** 要求管理员 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

/** 要求 API token（上传端点用），解析出 user 挂到 req.user */
async function requireApiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: '未授权：缺少 Bearer token' });
    return;
  }
  const user = await getUserByApiToken(token);
  if (!user) {
    res.status(401).json({ error: '未授权：token 无效' });
    return;
  }
  if (user.disabled) {
    res.status(403).json({ error: '账号已被禁用' });
    return;
  }
  req.user = user;
  next();
}

// ── CSRF 双重提交 Cookie ──────────────────────────────────
// 登录成功后调用：生成 token 并写 httpOnly=false cookie（前端 JS 可读）
export function issueCsrfToken(res: Response): string {
  const token = randomBytes(24).toString('hex');
  res.cookie('csrf_token', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.session.cookieSecure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

// 不需要 CSRF 校验的路径：
// - 登录/注册/turnstile-key：登录前无 CSRF cookie
// - 上传端点：Bearer token 鉴权（Authorization header 跨域被 CORS 预检拦截，不受 CSRF 影响）
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/turnstile-key',
  '/upload',
  '/api/upload',
  '/api/v1/upload',
]);

/** CSRF 中间件：对状态变更请求（POST/PUT/PATCH/DELETE）校验 X-CSRF-Token === cookie */
function csrfCheck(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  // 登录/注册端点在签发 CSRF cookie 之前，无法校验
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }
  // Bearer token 鉴权的上传端点不受 CSRF 影响（Authorization header 跨域会被 CORS 预检拦截）
  if (req.headers.authorization) {
    next();
    return;
  }
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'];
  // 必须同时有 cookie 和 header 且相等
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: 'CSRF 校验失败' });
    return;
  }
  next();
}

export {
  attachSessionUser,
  requireLogin,
  requireAdmin,
  requireApiToken,
  csrfCheck,
};
