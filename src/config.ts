import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN 至少 8 个字符'),

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
  adminToken: parsed.data.ADMIN_TOKEN,
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
};

export type Config = typeof config;
