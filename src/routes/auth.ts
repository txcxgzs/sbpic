import { Router, Request, Response } from 'express';
import {
  getUserByUsername,
  verifyPassword,
  createUser,
  AuthError,
  USERNAME_RE,
  MIN_PASSWORD,
  EMAIL_RE,
  createAndSendVerification,
  verifyEmailByToken,
  resetEmailVerification,
} from '../services/auth';
import { verifyTurnstileToken, turnstileSiteKey, turnstileEnabled } from '../services/turnstile';
import { getSetting, getSettingBool } from '../services/settings';
import {
  registerLimiter,
  loginLimiter,
  resendVerifyLimiter,
  recordLoginFailure,
  clearLoginFailure,
  isLoginBanned,
} from '../middleware/rateLimit';

const router = Router();

// 前端获取 Turnstile site key（用于渲染 widget）
router.get('/api/auth/turnstile-key', (_req: Request, res: Response) => {
  res.json({ enabled: turnstileEnabled(), siteKey: turnstileSiteKey() });
});

function publicUser(u: {
  id: number;
  username: string;
  role: string;
  api_token: string;
  email: string | null;
  email_verified: number;
}) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    api_token: u.api_token,
    email: u.email,
    email_verified: !!u.email_verified,
  };
}

// 登录
router.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '用户名和密码必填' });
    return;
  }
  // 封禁检查
  const ip = req.ip || '';
  if (isLoginBanned(ip, username)) {
    res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
    return;
  }
  const user = await getUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    const banned = recordLoginFailure(ip, username);
    res.status(401).json({
      error: banned ? '登录失败次数过多，请稍后再试' : '用户名或密码错误',
    });
    return;
  }
  clearLoginFailure(ip, username);
  req.session.userId = user.id;
  res.json(publicUser(user));
});

// 注册（开放，可由后台配置关闭；邮箱验证激活）
router.post('/api/auth/register', registerLimiter, async (req: Request, res: Response) => {
  if (!getSettingBool('allow_register')) {
    res.status(403).json({ error: '已关闭注册' });
    return;
  }
  const { username, password, email, turnstileToken } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || typeof email !== 'string') {
    res.status(400).json({ error: '用户名、邮箱和密码必填' });
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
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: '邮箱格式不正确' });
    return;
  }

  // Turnstile 人机验证
  const ts = await verifyTurnstileToken(turnstileToken, req.ip || '');
  if (!ts.ok) {
    res.status(400).json({ error: ts.error || '人机验证失败' });
    return;
  }

  try {
    // 邮件启用：创建未验证用户并发激活邮件
    if (getSettingBool('mail_enabled')) {
      const { isEmailTakenByVerified } = await import('../services/auth');
      if (await isEmailTakenByVerified(email)) {
        res.status(409).json({ error: '该邮箱已被使用' });
        return;
      }
      const user = await createUser({ username, password, role: 'user', email, emailVerified: 0 });
      await createAndSendVerification(user.id, email);
      req.session.userId = user.id;
      res.json({
        ...publicUser(user),
        verification_sent: true,
        message: '注册成功，请查收邮件完成验证',
      });
      return;
    }
    // 邮件未启用：直接创建已验证用户（应急本地用），仍记录其填写的邮箱
    const user = await createUser({
      username,
      password,
      role: 'user',
      email,
      emailVerified: 1,
    });
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

// 邮箱激活
router.get('/api/auth/verify-email', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  try {
    const user = await verifyEmailByToken(token);
    res.type('text/html').send(
      `<div style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:24px;text-align:center;color:#222;">
        <h2>邮箱验证成功</h2>
        <p>账号 <b>${escapeHtml(user.username)}</b> 已激活，现在可以上传图片了。</p>
        <p><a href="${getSetting('app_url')}/">返回图床</a></p>
      </div>`,
    );
  } catch (err) {
    const msg = err instanceof AuthError ? err.message : '验证失败';
    res.status(err instanceof AuthError ? err.status : 500).type('text/html').send(
      `<div style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:24px;text-align:center;color:#222;">
        <h2>验证失败</h2><p>${escapeHtml(msg)}</p>
        <p><a href="${getSetting('app_url')}/">返回</a></p>
      </div>`,
    );
  }
});

// 重发验证邮件（已登录未验证用户）
router.post(
  '/api/auth/resend-verification',
  resendVerifyLimiter,
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: '未登录' });
      return;
    }
    if (req.user.email_verified) {
      res.status(400).json({ error: '邮箱已验证' });
      return;
    }
    if (!req.user.email) {
      res.status(400).json({ error: '未设置邮箱' });
      return;
    }
    await createAndSendVerification(req.user.id, req.user.email);
    res.json({ success: true, message: '验证邮件已发送' });
  },
);

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

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

export default router;
