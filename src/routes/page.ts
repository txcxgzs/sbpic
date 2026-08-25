import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

// page.js 位于 dist/routes/，views 位于 dist/views/
const HTML_PATH = join(__dirname, '..', 'views', 'index.html');

let cached: string | null = null;

function getPage(): string {
  if (cached) return cached;
  cached = readFileSync(HTML_PATH, 'utf8');
  return cached;
}

router.get('/', (_req: Request, res: Response) => {
  res.type('text/html').send(getPage());
});

// 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
