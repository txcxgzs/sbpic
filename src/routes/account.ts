import { Router, Request, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import { resetApiToken, setPassword } from '../services/users';
import {
  verifyPassword,
  resetEmailVerification,
  createAndSendVerification,
  EMAIL_RE,
  isEmailTakenByVerified,
  AuthError,
} from '../services/auth';
import { getSettingBool, getSettingNum } from '../services/settings';
import { getUserStorage } from '../services/images';

const router = Router();

// 修改自己密码
router.post('/api/account/password', requireLogin, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body ?? {};
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: '旧密码和新密码必填' });
    return;
  }
  const user = req.user!;
  if (!(await verifyPassword(oldPassword, user.password_hash))) {
    res.status(401).json({ error: '旧密码错误' });
    return;
  }
  try {
    await setPassword(user.id, newPassword);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 重置自己的 API token
router.post('/api/account/regenerate-token', requireLogin, async (req: Request, res: Response) => {
  const token = await resetApiToken(req.user!.id);
  res.json({ api_token: token });
});

// 修改邮箱（改后需重新验证）
router.post('/api/account/email', requireLogin, async (req: Request, res: Response) => {
  const { newEmail } = req.body ?? {};
  if (typeof newEmail !== 'string' || !EMAIL_RE.test(newEmail)) {
    res.status(400).json({ error: '邮箱格式不正确' });
    return;
  }
  if (!getSettingBool('mail_enabled')) {
    res.status(400).json({ error: '邮件功能未启用，无法修改邮箱' });
    return;
  }
  if (await isEmailTakenByVerified(newEmail)) {
    res.status(409).json({ error: '该邮箱已被使用' });
    return;
  }
  const user = req.user!;
  await resetEmailVerification(user.id, newEmail);
  await createAndSendVerification(user.id, newEmail);
  res.json({ success: true, message: '验证邮件已发送到新邮箱' });
});

// 存储用量
router.get('/api/account/storage', requireLogin, async (req: Request, res: Response) => {
  const used = await getUserStorage(req.user!.id);
  const quotaMb = getSettingNum('user_storage_quota_mb', 0);
  res.json({
    used_bytes: used,
    used_mb: +(used / 1024 / 1024).toFixed(2),
    quota_mb: quotaMb,
    unlimited: quotaMb === 0,
  });
});

export default router;
