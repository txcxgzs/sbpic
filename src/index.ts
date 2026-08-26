import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import MySQLStore from 'express-mysql-session';
import { config } from './config';
import { pool } from './db/pool';
import { migrate } from './db/migrate';
import { ensureInitialAdmin } from './services/auth';
import { loadSettings } from './services/settings';
import { notFound, errorHandler } from './middleware/errorHandler';
import { attachSessionUser, csrfCheck } from './middleware/auth';
import { globalLimiter } from './middleware/rateLimit';
import { securityHeaders, noStoreOnError } from './middleware/securityHeaders';
import pageRouter from './routes/page';
import viewRouter from './routes/view';
import uploadRouter from './routes/upload';
import imagesRouter from './routes/images';
import authRouter from './routes/auth';
import accountRouter from './routes/account';
import adminRouter from './routes/admin';
import settingsRouter from './routes/settings';

async function main(): Promise<void> {
  await migrate();
  await loadSettings();
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
  app.use(cookieParser());

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
  // CSRF 校验（状态变更请求需 X-CSRF-Token 与 cookie 一致）
  app.use(csrfCheck);

  // 路由
  app.use(pageRouter);       // / 和 /health
  app.use(viewRouter);       // /i/*
  app.use(authRouter);       // /api/auth/*
  app.use(accountRouter);    // /api/account/*
  app.use(adminRouter);      // /api/admin/*
  app.use(settingsRouter);   // /api/admin/settings
  app.use(uploadRouter);     // /upload /api/upload /api/v1/upload
  app.use(imagesRouter);     // /api/images

  // 兜底
  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[sbimg] 服务已启动: http://localhost:${config.port}`);
    console.log('[sbimg] 业务配置（R2/邮件/Turnstile/限流等）请在后台「系统设置」页面配置');
  });
}

main().catch((err) => {
  console.error('[sbimg] 启动失败:', err);
  process.exit(1);
});
