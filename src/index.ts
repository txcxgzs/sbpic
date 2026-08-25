import express from 'express';
import { config } from './config';
import { migrate } from './db/migrate';
import { notFound, errorHandler } from './middleware/errorHandler';
import pageRouter from './routes/page';
import viewRouter from './routes/view';
import uploadRouter from './routes/upload';
import imagesRouter from './routes/images';

async function main(): Promise<void> {
  await migrate();

  const app = express();

  // 信任反代，使 req.ip 取真实客户端 IP（用于频率限制）
  app.set('trust proxy', 1);

  app.use(express.json());

  // 路由
  app.use(pageRouter);       // / 和 /health
  app.use(viewRouter);       // /i/*
  app.use(uploadRouter);     // /upload /api/upload /api/v1/upload
  app.use(imagesRouter);     // /api/images

  // 兜底
  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[sbimg] 服务已启动: http://localhost:${config.port}`);
    console.log(`[sbimg] 对外域名: ${config.baseUrl}`);
  });
}

main().catch((err) => {
  console.error('[sbimg] 启动失败:', err);
  process.exit(1);
});
