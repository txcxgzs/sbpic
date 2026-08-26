import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db/pool';

/**
 * 动态配置层：配置项存 MySQL settings 表（key-value），运行时从内存缓存读取。
 * 与 config.ts（.env 引导配置）互补：DB/session/port 等启动必需项仍在 .env，
 * R2/邮件/Turnstile/限流等业务配置全部在这里管理，后台界面可改、即时生效。
 */

/** 配置项默认值（首次建表时写入，也是 getSetting 的兜底） */
export const SETTING_DEFAULTS: Record<string, string> = {
  // Cloudflare R2
  r2_account_id: '',
  r2_access_key_id: '',
  r2_secret_access_key: '',
  r2_bucket: 'sbimg',
  // 邮件 SMTP
  mail_enabled: 'false',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  app_url: 'http://localhost:8321',
  // Turnstile
  turnstile_enabled: 'false',
  turnstile_site_key: '',
  turnstile_secret_key: '',
  // 站点与注册
  allow_register: 'true',
  register_limit_per_10min: '3',
  max_size_mb: '20',
  user_storage_quota_mb: '0',
  base_url: 'http://localhost:8321',
  // 限流
  global_limit_per_min: '300',
  upload_limit_per_min: '100',
  upload_limit_per_user_per_min: '60',
  view_limit_per_min: '600',
  login_fail_threshold: '5',
  login_ban_minutes: '15',
  upload_concurrency: '20',
};

/** secret 类配置项：GET 接口不回明文，只回 has_value 标记 */
export const SECRET_KEYS = new Set([
  'r2_secret_access_key',
  'smtp_pass',
  'turnstile_secret_key',
]);

let cache: Record<string, string> = { ...SETTING_DEFAULTS };
let loaded = false;

/** 启动时调用：从 DB 加载全部配置到内存缓存 */
export async function loadSettings(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT `key`, `value` FROM `settings`',
  );
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    const k = r.key as string;
    if (k in SETTING_DEFAULTS) {
      map[k] = (r.value as string) ?? '';
    }
  }
  cache = map;
  loaded = true;
}

/** 读取一个配置项（字符串），未设置则返回 fallback */
export function getSetting(key: string, fallback?: string): string {
  const v = cache[key];
  if (v === undefined || v === null || v === '') {
    return fallback !== undefined ? fallback : (SETTING_DEFAULTS[key] ?? '');
  }
  return v;
}

/** 读取数值型配置项 */
export function getSettingNum(key: string, fallback: number): number {
  const v = Number(getSetting(key, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
}

/** 读取布尔型配置项（'true'/'1' → true） */
export function getSettingBool(key: string): boolean {
  return getSetting(key) === 'true' || getSetting(key) === '1';
}

/** 是否已加载 */
export function settingsLoaded(): boolean {
  return loaded;
}

/** 批量保存配置：写库 + 刷新缓存 + 触发 rebuilder */
export async function saveSettings(obj: Record<string, string>): Promise<void> {
  const conn = await pool.getConnection();
  try {
    for (const [key, value] of Object.entries(obj)) {
      if (!(key in SETTING_DEFAULTS)) continue; // 只允许已定义的 key
      // URL 类配置校验：必须 http/https 开头
      if ((key === 'base_url' || key === 'app_url') && value) {
        if (!/^https?:\/\//i.test(value)) {
          throw new Error(`${key} 必须以 http:// 或 https:// 开头`);
        }
      }
      await conn.query<ResultSetHeader>(
        'INSERT INTO `settings` (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, value],
      );
      cache[key] = value;
    }
  } finally {
    conn.release();
  }
  // 触发所有注册的重建回调（R2 client / mail transporter 等）
  for (const fn of rebuilders) {
    try {
      fn();
    } catch (err) {
      console.error('[settings] rebuilder 异常', err);
    }
  }
}

/** 获取全部配置（含 secret 的明文，仅后端内部使用） */
export function getAllSettings(): Record<string, string> {
  return { ...cache };
}

/** 获取全部配置（前端安全视图：secret 项脱敏为 has_value 标记） */
export function getPublicSettings(): Record<string, { value: string; has_value: boolean; is_secret: boolean }> {
  const out: Record<string, { value: string; has_value: boolean; is_secret: boolean }> = {};
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    const raw = cache[key] ?? '';
    const isSecret = SECRET_KEYS.has(key);
    out[key] = {
      value: isSecret ? '' : raw,
      has_value: !!raw,
      is_secret: isSecret,
    };
  }
  return out;
}

// ===== rebuilder 注册机制：模块注册自己的重建函数，saveSettings 后统一触发 =====
const rebuilders: Array<() => void> = [];

export function registerRebuilder(fn: () => void): void {
  rebuilders.push(fn);
}
