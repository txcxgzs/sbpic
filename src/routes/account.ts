import { Router, Request, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import { resetApiToken, setPassword } from '../services/users';
import { verifyPassword } from '../services/auth';

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

export default router;
