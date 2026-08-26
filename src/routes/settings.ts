import { Router, Request, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { getPublicSettings, saveSettings, SECRET_KEYS } from '../services/settings';

const router = Router();

// 获取全部配置（secret 项脱敏：只回 has_value，不回明文）
router.get('/api/admin/settings', requireLogin, requireAdmin, (_req: Request, res: Response) => {
  res.json({ settings: getPublicSettings() });
});

// 批量保存配置
// secret 类字段：传空串或 '__unchanged__' 表示不改（保持原值）
router.post('/api/admin/settings', requireLogin, requireAdmin, async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: '请求体需为 JSON 对象' });
    return;
  }
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue;
    if (SECRET_KEYS.has(key)) {
      // secret 字段：空串或占位符 → 跳过
      if (!value || value === '__unchanged__') continue;
    }
    updates[key] = value;
  }
  try {
    await saveSettings(updates);
    res.json({ success: true, settings: getPublicSettings() });
  } catch (err) {
    console.error('[settings] 保存失败', err);
    res.status(500).json({ error: '保存配置失败' });
  }
});

export default router;
