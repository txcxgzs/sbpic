import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool, UserRow } from '../db/pool';
import { newApiToken, getUserById, AuthError } from './auth';

function toUser(p: RowDataPacket): UserRow {
  return p as unknown as UserRow;
}

export interface UserWithCount extends UserRow {
  image_count: number;
}

export async function listUsers(): Promise<UserWithCount[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.*, IFNULL(c.cnt, 0) AS image_count
     FROM \`users\` u
     LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM \`images\` GROUP BY user_id) c
       ON c.user_id = u.id
     ORDER BY u.id ASC`,
  );
  return rows.map((r) => toUser(r) as UserWithCount);
}

export async function resetApiToken(userId: number): Promise<string> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  const token = newApiToken();
  await pool.query('UPDATE `users` SET `api_token` = ? WHERE `id` = ?', [token, userId]);
  return token;
}

export async function setPassword(userId: number, newPlain: string): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  if (newPlain.length < 8) throw new AuthError('密码至少 8 位');
  // 动态引入避免与 auth 循环
  const { hashPassword } = await import('./auth');
  const hash = await hashPassword(newPlain);
  await pool.query('UPDATE `users` SET `password_hash` = ? WHERE `id` = ?', [hash, userId]);
}

export async function deleteUser(userId: number): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  // 其图片转无主，不连带删除；清理其邮箱验证记录
  await pool.query('UPDATE `images` SET `user_id` = NULL WHERE `user_id` = ?', [userId]);
  await pool.query('DELETE FROM `email_verifications` WHERE `user_id` = ?', [userId]);
  await pool.query('DELETE FROM `users` WHERE `id` = ?', [userId]);
}

export async function disableUser(userId: number): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  if (user.role === 'admin') throw new AuthError('不能禁用管理员', 400);
  // 禁用用户 + 其名下图片全部禁用（保留数据，禁止公开访问）
  await pool.query('UPDATE `users` SET `disabled` = 1 WHERE `id` = ?', [userId]);
  await pool.query('UPDATE `images` SET `disabled` = 1 WHERE `user_id` = ?', [userId]);
}

export async function enableUser(userId: number): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new AuthError('用户不存在', 404);
  // 启用用户 + 恢复其名下图片访问
  await pool.query('UPDATE `users` SET `disabled` = 0 WHERE `id` = ?', [userId]);
  await pool.query('UPDATE `images` SET `disabled` = 0 WHERE `user_id` = ?', [userId]);
}
