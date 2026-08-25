import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

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

// 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
