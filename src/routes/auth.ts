import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import {
  getUserByUsername,
  verifyPassword,
  createUser,
  AuthError,
  USERNAME_RE,
  MIN_PASSWORD,
} from '../services/auth';

const router = Router();

// 注册限流：按 IP，每 10 分钟 N 次
const registerLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: config.registerLimitPer10Min,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '注册过于频繁，请稍后再试' },
});

function publicUser(u: { id: number; username: string; role: string; api_token: string }) {
  return { id: u.id, username: u.username, role: u.role, api_token: u.api_token };
}

// 登录
router.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '用户名和密码必填' });
    return;
  }
  const user = await getUserByUsername(username);
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  req.session.userId = user.id;
  res.json(publicUser(user));
});

// 注册（开放，可由 env 关闭）
router.post('/api/auth/register', registerLimiter, async (req: Request, res: Response) => {
  if (!config.allowRegister) {
    res.status(403).json({ error: '已关闭注册' });
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '用户名和密码必填' });
    return;
  }
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: '用户名需为 3-32 位字母数字下划线' });
    return;
  }
  if (password.length < MIN_PASSWORD) {
    res.status(400).json({ error: `密码至少 ${MIN_PASSWORD} 位` });
    return;
  }
  try {
    const user = await createUser(username, password, 'user');
    req.session.userId = user.id;
    res.json(publicUser(user));
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 登出
router.post('/api/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('sbimg_sid');
    res.json({ success: true });
  });
});

// 当前登录用户
router.get('/api/auth/me', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  res.json(publicUser(req.user));
});

export default router;
