import 'dotenv/config';
import { z } from 'zod';

const boolStr = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

/**
 * 引导配置：仅启动必需项（DB 连接、session、端口、初始管理员）走 .env。
 * 业务配置（R2 / 邮件 / Turnstile / 限流 / 站点 URL 等）全部在后台「系统设置」管理，
 * 存 MySQL settings 表，运行时动态读取，改完即时生效。见 src/services/settings.ts。
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8321),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default('sbimg'),

  // session / 鉴权
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET 至少 16 个字符'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  COOKIE_SECURE: boolStr.default('true'),

  // 初始管理员（首次启动时若 users 表为空自动创建）
  INIT_ADMIN_USER: z.string().default('admin'),
  INIT_ADMIN_PASS: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('环境变量校验失败:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,

  db: {
    host: parsed.data.DB_HOST,
    port: parsed.data.DB_PORT,
    user: parsed.data.DB_USER,
    password: parsed.data.DB_PASSWORD,
    name: parsed.data.DB_NAME,
  },

  session: {
    secret: parsed.data.SESSION_SECRET,
    trustProxy: parsed.data.TRUST_PROXY,
    cookieSecure: parsed.data.COOKIE_SECURE,
  },

  initAdminUser: parsed.data.INIT_ADMIN_USER,
  initAdminPass: parsed.data.INIT_ADMIN_PASS,
};

export type Config = typeof config;
