import { Router, Request, Response } from 'express';
import { getObjectStream, R2Error } from '../r2/client';

const router = Router();

// GET /i/*  —— key 可能含 '/'，用通配匹配
router.get('/i/*', async (req: Request, res: Response) => {
  const key = req.params[0];
  if (!key) {
    res.status(404).send('Not Found');
    return;
  }

  try {
    const { stream, mime, size } = await getObjectStream(key);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (mime) res.setHeader('Content-Type', mime);
    if (size) res.setHeader('Content-Length', size);
    stream.on('error', (e) => {
      if (!res.headersSent) {
        res.status(500).send('读取失败');
      } else {
        res.end();
      }
      console.error('[view] stream error', e);
    });
    stream.pipe(res);
  } catch (err) {
    if (err instanceof R2Error) {
      res.status(err.status).send(err.message);
      return;
    }
    console.error('[view] error', err);
    res.status(500).send('服务器错误');
  }
});

export default router;
