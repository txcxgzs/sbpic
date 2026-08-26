import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getSetting, getSettingBool } from '../services/settings';

const router = Router();

// page.js 位于 dist/routes/，views 位于 dist/views/
const HTML_PATH = join(__dirname, '..', 'views', 'index.html');

function getPage(): string {
  // 小文件直接读盘，避免缓存导致改前端不生效
  return readFileSync(HTML_PATH, 'utf8');
}

router.get('/', (_req: Request, res: Response) => {
  res.type('text/html').send(getPage());
});

// 公开站点信息：公告 + 协议启用状态（未登录也可访问，用于首页展示）
router.get('/api/site/info', (_req: Request, res: Response) => {
  res.json({
    announcement_enabled: getSettingBool('announcement_enabled'),
    announcement_text: getSetting('announcement_text'),
    agreement_enabled: getSettingBool('agreement_enabled'),
  });
});

// 公开用户协议全文（点击「用户协议」链接时加载）
router.get('/api/site/agreement', (_req: Request, res: Response) => {
  res.json({
    enabled: getSettingBool('agreement_enabled'),
    text: getSetting('agreement_text'),
  });
});

// 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
