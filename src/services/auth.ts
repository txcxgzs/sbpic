import { randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool, UserRow } from '../db/pool';
import { config } from '../config';
import { sendVerificationEmail } from './mail';

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
export const MIN_PASSWORD = 8;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const VERIFY_TTL_HOURS = 24;

function toUser(p: RowDataPacket): UserRow {
  return p as unknown as UserRow;
}

export function newApiToken(): string {
  return randomBytes(32).toString('hex');
}

export function newRandomPassword(): string {
  return randomBytes(12).toString('base64url');
}

export function newVerifyToken(): string {
  return randomBytes(32).toString('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `users` WHERE `id` = ? LIMIT 1',
    [id],
  );
  return rows.length > 0 ? toUser(rows[0]) : null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `users` WHERE `username` = ? LIMIT 1',
    [username],
  );
  return rows.length > 0 ? toUser(rows[0]) : null;
}

export async function getUserByApiToken(token: string): Promise<UserRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `users` WHERE `api_token` = ? LIMIT 1',
    [token],
  );
  if (rows.length === 0) return null;
  const row = toUser(rows[0]);
  return safeEqual(row.api_token, token) ? row : null;
}

/** 检查 email 是否已被「已验证」用户占用 */
export async function isEmailTakenByVerified(email: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM `users` WHERE `email` = ? AND `email_verified` = 1 LIMIT 1',
    [email],
  );
  return rows.length > 0;
}

export interface CreateUserOpts {
  username: string;
  password: string;
  role?: 'admin' | 'user';
  email?: string | null;
  emailVerified?: number;
}

export async function createUser(opts: CreateUserOpts): Promise<UserRow> {
  const { username, password, role = 'user', email = null, emailVerified = 0 } = opts;
  if (!USERNAME_RE.test(username)) {
    throw new AuthError('用户名需为 3-32 位字母数字下划线');
  }
  if (password.length < MIN_PASSWORD) {
    throw new AuthError(`密码至少 ${MIN_PASSWORD} 位`);
  }
  if (await getUserByUsername(username)) {
    throw new AuthError('用户名已存在', 409);
  }
  if (email && !EMAIL_RE.test(email)) {
    throw new AuthError('邮箱格式不正确');
  }
  const hash = await hashPassword(password);
  const token = newApiToken();
  await pool.query(
    'INSERT INTO `users` (`username`, `password_hash`, `role`, `api_token`, `email`, `email_verified`) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, role, token, email, emailVerified],
  );
  return (await getUserByUsername(username))!;
}

export async function countUsers(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM `users`');
  return rows[0].c as number;
}

/** 创建邮箱验证记录并发送邮件 */
export async function createAndSendVerification(userId: number, email: string): Promise<void> {
  const token = newVerifyToken();
  const expires = new Date(Date.now() + VERIFY_TTL_HOURS * 3600 * 1000);
  await pool.query(
    'INSERT INTO `email_verifications` (`user_id`, `token`, `email`, `expires_at`) VALUES (?, ?, ?, ?)',
    [userId, token, email, expires],
  );
  const link = `${config.mail.appUrl}/api/auth/verify-email?token=${token}`;
  const ok = await sendVerificationEmail(email, link);
  if (!ok) {
    console.warn(`[auth] 验证邮件未发出，用户 ${userId} 的链接：${link}`);
  }
}

/** 校验激活 token，返回用户或抛错 */
export async function verifyEmailByToken(token: string): Promise<UserRow> {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new AuthError('无效的验证链接', 400);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `email_verifications` WHERE `token` = ? LIMIT 1',
    [token],
  );
  if (rows.length === 0) throw new AuthError('验证链接无效', 404);
  const v = rows[0] as { user_id: number; expires_at: Date; consumed: number; email: string };
  if (v.consumed) throw new AuthError('该链接已被使用', 410);
  if (new Date(v.expires_at).getTime() < Date.now()) {
    throw new AuthError('验证链接已过期，请重新发送', 410);
  }
  // 激活时检查邮箱是否已被他人已验证占用
  if (await isEmailTakenByVerified(v.email)) {
    throw new AuthError('该邮箱已被其他账号使用', 409);
  }
  await pool.query<ResultSetHeader>(
    'UPDATE `email_verifications` SET `consumed` = 1 WHERE `token` = ?',
    [token],
  );
  await pool.query<ResultSetHeader>(
    'UPDATE `users` SET `email_verified` = 1, `email` = ? WHERE `id` = ?',
    [v.email, v.user_id],
  );
  const user = await getUserById(v.user_id);
  if (!user) throw new AuthError('用户不存在', 404);
  return user;
}

/** 重置用户邮箱为未验证并清理其验证记录 */
export async function resetEmailVerification(userId: number, newEmail: string): Promise<void> {
  await pool.query('UPDATE `users` SET `email` = ?, `email_verified` = 0 WHERE `id` = ?', [
    newEmail,
    userId,
  ]);
  await pool.query('DELETE FROM `email_verifications` WHERE `user_id` = ?', [userId]);
}

/** 管理员手动标记用户已验证 */
export async function adminMarkVerified(userId: number): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  await pool.query<ResultSetHeader>(
    'UPDATE `users` SET `email_verified` = 1 WHERE `id` = ?',
    [userId],
  );
}

/** 启动时确保至少有一个管理员 */
export async function ensureInitialAdmin(): Promise<void> {
  const total = await countUsers();
  if (total > 0) return;
  const username = config.initAdminUser || 'admin';
  const password = config.initAdminPass || newRandomPassword();
  await createUser({ username, password, role: 'admin', email: null, emailVerified: 1 });
  if (config.initAdminPass) {
    console.log(`[init] 已创建管理员账号: ${username}（使用 INIT_ADMIN_PASS 指定的密码）`);
  } else {
    console.log('========================================');
    console.log('[init] 已创建初始管理员账号');
    console.log(`  用户名: ${username}`);
    console.log(`  密码:   ${password}`);
    console.log('请登录后立即修改密码！本提示不会再次显示。');
    console.log('========================================');
  }
}
