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
import { issueCsrfToken } from '../middleware/auth';
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

// 重新生成 session 并绑定用户（防 session fixation）
// 回调风格：regenerate 完成后发响应（regenerate 内部会 save session）
function bindSession(req: Request, res: Response, userId: number, send: () => void): void {
  req.session.regenerate(() => {
    req.session.userId = userId;
    issueCsrfToken(res);
    send();
  });
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
  // 禁用检查
  if (user.disabled) {
    res.status(403).json({ error: '账号已被禁用' });
    return;
  }
  clearLoginFailure(ip, username);
  bindSession(req, res, user.id, () => res.json(publicUser(user)));
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
      bindSession(req, res, user.id, () => res.json({
        ...publicUser(user),
        verification_sent: true,
        message: '注册成功，请查收邮件完成验证',
      }));
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
    bindSession(req, res, user.id, () => res.json(publicUser(user)));
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ── Claude 风格内联 HTML 页面 ──
function safeUrl(raw: string): string {
  // 允许 http/https 开头的 URL；阻断 javascript: 等危险 scheme
  const u = String(raw).trim();
  if (/^https?:\/\//i.test(u)) return escapeHtml(u);
  return '/';
}

function claudePage(title: string, bodyHtml: string): string {
  const appUrl = getSetting('app_url');
  const homeHref = safeUrl(appUrl);
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · 烧饼图床</title>
<style>
  :root{--canvas:#faf9f5;--ink:#141413;--body:#3d3d3a;--muted:#6c6a64;--coral:#cc785c;--coral-d:#a9583e;--card:#efe9de;--soft:#f5f0e8;--dark:#181715;--hair:#e6dfd8;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:var(--canvas);color:var(--body);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .wrap{max-width:480px;width:100%;text-align:center}
  .badge{display:inline-block;font-family:Georgia,'Cormorant Garamond',serif;font-weight:400;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--coral);margin-bottom:24px}
  h1{font-family:Georgia,'Cormorant Garamond',serif;font-weight:400;letter-spacing:-.02em;color:var(--ink);font-size:36px;line-height:1.15;margin-bottom:16px}
  p{font-size:16px;color:var(--muted);line-height:1.6;margin-bottom:12px}
  a.cta{display:inline-block;margin-top:20px;padding:11px 28px;background:var(--coral);color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:500;transition:background .15s}
  a.cta:hover{background:var(--coral-d)}
  .footer{margin-top:40px;font-size:12px;color:var(--muted)}
</style></head><body>
<div class="wrap">
  <div class="badge">烧饼图床</div>
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
  <p><a class="cta" href="${homeHref}">返回图床</a></p>
  <div class="footer">sbimg · 自托管图床</div>
</div></body></html>`;
}

// 邮箱激活
router.get('/api/auth/verify-email', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  try {
    const user = await verifyEmailByToken(token);
    res.type('text/html').send(
      claudePage('邮箱验证成功', `<p>账号 <b>${escapeHtml(user.username)}</b> 已激活，现在可以上传图片了。</p>`),
    );
  } catch (err) {
    const msg = err instanceof AuthError ? err.message : '验证失败';
    res
      .status(err instanceof AuthError ? err.status : 500)
      .type('text/html')
      .send(claudePage('验证失败', `<p>${escapeHtml(msg)}</p>`));
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
    res.clearCookie('csrf_token');
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
