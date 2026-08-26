import { Router, Request, Response } from 'express';
import { getObjectStream, R2Error } from '../r2/client';
import { viewLimiter } from '../middleware/rateLimit';
import { getImageByKey } from '../services/images';

const router = Router();

// GET /i/*  —— key 可能含 '/'，用通配匹配
router.get('/i/*', viewLimiter, async (req: Request, res: Response) => {
  const key = req.params[0];
  if (!key) {
    res.status(404).send('Not Found');
    return;
  }

  // 先查库：未入库的 key 拒绝服务；禁用图片禁止公开访问
  const row = await getImageByKey(key);
  if (!row) {
    res.status(404).send('Not Found');
    return;
  }
  if (row.disabled) {
    res.status(403).send('Forbidden');
    return;
  }

  let stream;
  try {
    const r = await getObjectStream(key);
    stream = r.stream;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    if (r.mime) res.setHeader('Content-Type', r.mime);
    if (r.size) res.setHeader('Content-Length', r.size);
  } catch (err) {
    if (err instanceof R2Error) {
      res.status(err.status).send(err.message);
      return;
    }
    console.error('[view] error', err);
    res.status(500).send('服务器错误');
    return;
  }

  // 流式回写；出错时安全收尾，避免 write after end
  stream.on('error', (e) => {
    console.error('[view] stream error', e);
    if (!res.headersSent) {
      res.status(500).send('读取失败');
    }
    stream.destroy();
    if (!res.writableEnded) res.end();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

export default router;
