import express from 'express';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import { config } from './config';
import { pool } from './db/pool';
import { migrate } from './db/migrate';
import { ensureInitialAdmin } from './services/auth';
import { notFound, errorHandler } from './middleware/errorHandler';
import { attachSessionUser } from './middleware/auth';
import { globalLimiter } from './middleware/rateLimit';
import { securityHeaders, noStoreOnError } from './middleware/securityHeaders';
import pageRouter from './routes/page';
import viewRouter from './routes/view';
import uploadRouter from './routes/upload';
import imagesRouter from './routes/images';
import authRouter from './routes/auth';
import accountRouter from './routes/account';
import adminRouter from './routes/admin';

async function main(): Promise<void> {
  await migrate();
  await ensureInitialAdmin();

  const app = express();

  // 信任反代：按部署层级配置，使 req.ip 取真实客户端 IP
  app.set('trust proxy', config.session.trustProxy);

  // 安全头（防点击劫持、类型嗅探等）
  app.use(securityHeaders);
  // 全局限流（按 IP，防扫描）
  app.use(globalLimiter);
  // 错误响应不缓存
  app.use(noStoreOnError);

  app.use(express.json());

  // session 存 MySQL
  const MySQLStoreFactory = MySQLStore(session);
  const sessionStore = new MySQLStoreFactory({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 7 * 24 * 60 * 60 * 1000,
  } as any);

  app.use(
    session({
      name: 'sbimg_sid',
      secret: config.session.secret,
      store: sessionStore,
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.session.cookieSecure,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // 每个请求尝试用 session 填充 req.user
  app.use(attachSessionUser);

  // 路由
  app.use(pageRouter);       // / 和 /health
  app.use(viewRouter);       // /i/*
  app.use(authRouter);       // /api/auth/*
  app.use(accountRouter);    // /api/account/*
  app.use(adminRouter);      // /api/admin/*
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
