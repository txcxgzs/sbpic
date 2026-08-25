import { randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';
import { pool, UserRow } from '../db/pool';
import { config } from '../config';

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

function toUser(p: RowDataPacket): UserRow {
  return p as unknown as UserRow;
}

export function newApiToken(): string {
  return randomBytes(32).toString('hex');
}

export function newRandomPassword(): string {
  return randomBytes(12).toString('base64url');
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
  // 用等值查询拿行，再 timingSafeEqual 比较，避免时序泄露
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `users` WHERE `api_token` = ? LIMIT 1',
    [token],
  );
  if (rows.length === 0) return null;
  const row = toUser(rows[0]);
  return safeEqual(row.api_token, token) ? row : null;
}

export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user' = 'user',
): Promise<UserRow> {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError('用户名需为 3-32 位字母数字下划线');
  }
  if (password.length < MIN_PASSWORD) {
    throw new AuthError(`密码至少 ${MIN_PASSWORD} 位`);
  }
  if (await getUserByUsername(username)) {
    throw new AuthError('用户名已存在', 409);
  }
  const hash = await hashPassword(password);
  const token = newApiToken();
  await pool.query(
    'INSERT INTO `users` (`username`, `password_hash`, `role`, `api_token`) VALUES (?, ?, ?, ?)',
    [username, hash, role, token],
  );
  return (await getUserByUsername(username))!;
}

export async function countUsers(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM `users`');
  return rows[0].c as number;
}

/** 启动时确保至少有一个管理员 */
export async function ensureInitialAdmin(): Promise<void> {
  const total = await countUsers();
  if (total > 0) return;
  const username = config.initAdminUser || 'admin';
  const password = config.initAdminPass || newRandomPassword();
  await createUser(username, password, 'admin');
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
