import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool, ImageRow } from '../db/pool';
import { deleteObject } from '../r2/client';

function toRow(p: RowDataPacket): ImageRow {
  return p as unknown as ImageRow;
}

export interface ListResult {
  total: number;
  page: number;
  size: number;
  items: ImageRow[];
}

export interface ListScope {
  userId: number | null; // null = 全部（管理员）
  targetUserId?: number | null; // 管理员查指定用户
  includeDisabled?: boolean; // 管理员可看禁用图片
}

export async function listImages(
  scope: ListScope,
  page = 1,
  size = 30,
): Promise<ListResult> {
  page = Math.max(1, Math.floor(page));
  size = Math.min(100, Math.max(1, Math.floor(size)));
  const offset = (page - 1) * size;

  const where: string[] = [];
  const params: unknown[] = [];

  if (scope.targetUserId !== undefined) {
    // 管理员显式查指定用户（含 NULL 用 IS）
    where.push(scope.targetUserId === null ? '`user_id` IS NULL' : '`user_id` = ?');
    if (scope.targetUserId !== null) params.push(scope.targetUserId);
  } else if (scope.userId !== null) {
    // 普通用户只看自己
    where.push('`user_id` = ?');
    params.push(scope.userId);
  }
  // 非管理员默认排除禁用图片
  if (!scope.includeDisabled) {
    where.push('`disabled` = 0');
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM \`images\` ${whereSql}`,
    params,
  );
  const total = countRows[0].c as number;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM \`images\` ${whereSql} ORDER BY \`id\` DESC LIMIT ? OFFSET ?`,
    [...params, size, offset],
  );

  return { total, page, size, items: rows.map(toRow) };
}

export async function getImageById(id: number): Promise<ImageRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `images` WHERE `id` = ? LIMIT 1',
    [id],
  );
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export async function getImageByKey(key: string): Promise<ImageRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `images` WHERE `key` = ? LIMIT 1',
    [key],
  );
  return rows.length > 0 ? toRow(rows[0]) : null;
}

/** 查询用户已用存储（字节），排除禁用图片 */
export async function getUserStorage(userId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COALESCE(SUM(`size`), 0) AS total FROM `images` WHERE `user_id` = ? AND `disabled` = 0',
    [userId],
  );
  return rows[0].total as number;
}

/** 删除鉴权：本人删自己的，管理员删任意 */
export function canDelete(
  image: ImageRow,
  user: { id: number; role: string },
): boolean {
  if (user.role === 'admin') return true;
  return image.user_id === user.id;
}

export async function deleteImageById(id: number): Promise<boolean> {
  const row = await getImageById(id);
  if (!row) return false;
  // 先删 R2 对象，再删库记录
  await deleteObject(row.key);
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM `images` WHERE `id` = ?',
    [id],
  );
  return result.affectedRows > 0;
}
