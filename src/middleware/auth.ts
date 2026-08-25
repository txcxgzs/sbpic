import { Request, Response, NextFunction } from 'express';
import { UserRow } from '../db/pool';
import { getUserByApiToken } from '../services/auth';

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
async function attachSessionUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.session.userId) {
    const { getUserById } = await import('../services/auth');
    const user = await getUserById(req.session.userId);
    if (user) {
      req.user = user;
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
  req.user = user;
  next();
}

export {
  attachSessionUser,
  requireLogin,
  requireAdmin,
  requireApiToken,
};
