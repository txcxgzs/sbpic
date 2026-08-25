import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { listImages, deleteImageById, getImageById } from '../services/images';
import { ImageRow } from '../db/pool';
import { config } from '../config';

const router = Router();

function rowToApi(row: ImageRow) {
  return {
    id: row.id,
    key: row.key,
    url: `${config.baseUrl}/i/${row.key}`,
    hash: row.hash,
    original_name: row.original_name,
    size: row.size,
    mime: row.mime,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
  };
}

// 列表（分页）
router.get('/api/images', requireAuth, async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const size = Number(req.query.size ?? 30);
  const result = await listImages(page, size);
  res.json({
    total: result.total,
    page: result.page,
    size: result.size,
    items: result.items.map((r) => rowToApi(r)),
  });
});

// 单条详情
router.get('/api/images/:id', requireAuth, async (req: Request, res: Response) => {
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
  res.json(rowToApi(row));
});

// 删除
router.delete('/api/images/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '无效的 id' });
    return;
  }
  const ok = await deleteImageById(id);
  if (!ok) {
    res.status(404).json({ error: '图片不存在' });
    return;
  }
  res.json({ success: true });
});

export default router;
