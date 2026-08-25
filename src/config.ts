import 'dotenv/config';
import { z } from 'zod';

const boolStr = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),

  MAX_SIZE_MB: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default('sbimg'),

  // session / 鉴权
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET 至少 16 个字符'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  COOKIE_SECURE: boolStr.default('false'),

  // 初始管理员
  INIT_ADMIN_USER: z.string().default('admin'),
  INIT_ADMIN_PASS: z.string().default(''),

  // 注册
  ALLOW_REGISTER: boolStr.default('true'),
  REGISTER_LIMIT_PER_10MIN: z.coerce.number().int().positive().default(3),

  // 邮件
  MAIL_ENABLED: boolStr.default('true'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  APP_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ''))
    .default('http://localhost:3000'),

  // Turnstile
  TURNSTILE_ENABLED: boolStr.default('true'),
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),

  // 限流参数
  GLOBAL_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
  UPLOAD_LIMIT_PER_MIN: z.coerce.number().int().positive().default(100),
  UPLOAD_LIMIT_PER_USER_PER_MIN: z.coerce.number().int().positive().default(60),
  VIEW_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  LOGIN_FAIL_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOGIN_BAN_MINUTES: z.coerce.number().int().positive().default(15),
  UPLOAD_CONCURRENCY: z.coerce.number().int().positive().default(20),
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
  baseUrl: parsed.data.BASE_URL,
  maxSizeBytes: parsed.data.MAX_SIZE_MB * 1024 * 1024,
  rateLimitPerMin: parsed.data.RATE_LIMIT_PER_MIN,

  r2: {
    accountId: parsed.data.R2_ACCOUNT_ID,
    accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
    secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
    bucket: parsed.data.R2_BUCKET,
  },

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

  allowRegister: parsed.data.ALLOW_REGISTER,
  registerLimitPer10Min: parsed.data.REGISTER_LIMIT_PER_10MIN,

  mail: {
    enabled: parsed.data.MAIL_ENABLED,
    host: parsed.data.SMTP_HOST,
    port: parsed.data.SMTP_PORT,
    user: parsed.data.SMTP_USER,
    pass: parsed.data.SMTP_PASS,
    from: parsed.data.SMTP_FROM,
    appUrl: parsed.data.APP_URL,
  },

  turnstile: {
    enabled: parsed.data.TURNSTILE_ENABLED,
    siteKey: parsed.data.TURNSTILE_SITE_KEY,
    secretKey: parsed.data.TURNSTILE_SECRET_KEY,
  },

  limits: {
    globalPerMin: parsed.data.GLOBAL_LIMIT_PER_MIN,
    uploadPerMin: parsed.data.UPLOAD_LIMIT_PER_MIN,
    uploadPerUserPerMin: parsed.data.UPLOAD_LIMIT_PER_USER_PER_MIN,
    viewPerMin: parsed.data.VIEW_LIMIT_PER_MIN,
    loginFailThreshold: parsed.data.LOGIN_FAIL_THRESHOLD,
    loginBanMinutes: parsed.data.LOGIN_BAN_MINUTES,
    uploadConcurrency: parsed.data.UPLOAD_CONCURRENCY,
  },
};

export type Config = typeof config;
