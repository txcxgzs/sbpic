import { Router, Request, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { listUsers, resetApiToken, setPassword, deleteUser } from '../services/users';
import { createUser, AuthError, adminMarkVerified } from '../services/auth';

const router = Router();

function publicUser(u: {
  id: number;
  username: string;
  role: string;
  api_token: string;
  email: string | null;
  email_verified: number;
  created_at: Date;
  image_count?: number;
}) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    api_token: u.api_token,
    email: u.email,
    email_verified: !!u.email_verified,
    created_at: u.created_at,
    image_count: u.image_count ?? 0,
  };
}

// 用户列表（含上传数量）
router.get('/api/admin/users', requireLogin, requireAdmin, async (_req: Request, res: Response) => {
  const users = await listUsers();
  res.json({ items: users.map(publicUser) });
});

// 管理员建号
router.post('/api/admin/users', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const { username, password, role, email } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '用户名和密码必填' });
    return;
  }
  const r = role === 'admin' ? 'admin' : 'user';
  try {
    const user = await createUser({
      username,
      password,
      role: r,
      email: typeof email === 'string' ? email : null,
      emailVerified: r === 'admin' ? 1 : 0, // 管理员建号默认已验证
    });
    res.json(publicUser({ ...user, image_count: 0 }));
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 删除用户（图片转无主，清理验证记录）
router.delete('/api/admin/users/:id', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  if (id === req.user!.id) {
    res.status(400).json({ error: '不能删除自己' });
    return;
  }
  try {
    await deleteUser(id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 重置某用户 API token
router.post('/api/admin/users/:id/reset-token', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  try {
    const token = await resetApiToken(id);
    res.json({ api_token: token });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 改某用户密码
router.post('/api/admin/users/:id/password', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string') {
    res.status(400).json({ error: '新密码必填' });
    return;
  }
  try {
    await setPassword(id, newPassword);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// 管理员手动标记用户已验证（应急）
router.post('/api/admin/users/:id/verify', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  try {
    await adminMarkVerified(id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
