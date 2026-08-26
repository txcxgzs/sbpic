import { Router, Request, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { listImages, getImageById, deleteImageById, canDelete } from '../services/images';
import { ImageRow } from '../db/pool';
import { getSetting } from '../services/settings';

const router = Router();

function rowToApi(row: ImageRow) {
  return {
    id: row.id,
    key: row.key,
    url: `${getSetting('base_url')}/i/${row.key}`,
    hash: row.hash,
    original_name: row.original_name,
    size: row.size,
    mime: row.mime,
    width: row.width,
    height: row.height,
    user_id: row.user_id,
    disabled: !!row.disabled,
    created_at: row.created_at,
  };
}

// 列表（分页）：普通用户只看自己；管理员默认看自己，?all=1 看全部，?user_id= 看指定
router.get('/api/images', requireLogin, async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const size = Number(req.query.size ?? 30);
  const user = req.user!;
  const isAdmin = user.role === 'admin';

  let scope;
  if (isAdmin) {
    if (req.query.all === '1') {
      // 管理员看全部时含禁用图片，便于审查
      scope = { userId: null, includeDisabled: true };
    } else if (req.query.user_id !== undefined) {
      const target = req.query.user_id === 'null' ? null : Number(req.query.user_id);
      scope = { userId: null, targetUserId: Number.isFinite(target) ? target : null, includeDisabled: true };
    } else {
      scope = { userId: user.id }; // 管理员默认也只看自己，避免误操作
    }
  } else {
    scope = { userId: user.id };
  }

  const result = await listImages(scope, page, size);
  res.json({
    total: result.total,
    page: result.page,
    size: result.size,
    items: result.items.map(rowToApi),
  });
});

// 单条详情：本人或管理员可看
router.get('/api/images/:id', requireLogin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  const row = await getImageById(id);
  if (!row) {
    res.status(404).json({ error: '图片不存在' });
    return;
  }
  const user = req.user!;
  if (user.role !== 'admin' && row.user_id !== user.id) {
    res.status(403).json({ error: '无权查看' });
    return;
  }
  res.json(rowToApi(row));
});

// 删除：本人删自己的，管理员删任意
router.delete('/api/images/:id', requireLogin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  const row = await getImageById(id);
  if (!row) {
    res.status(404).json({ error: '图片不存在' });
    return;
  }
  if (!canDelete(row, req.user!)) {
    res.status(403).json({ error: '无权删除' });
    return;
  }
  await deleteImageById(id);
  res.json({ success: true });
});

export default router;
