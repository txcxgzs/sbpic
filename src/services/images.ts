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

export async function listImages(page = 1, size = 30): Promise<ListResult> {
  page = Math.max(1, Math.floor(page));
  size = Math.min(100, Math.max(1, Math.floor(size)));
  const offset = (page - 1) * size;

  const [countRows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM `images`',
  );
  const total = countRows[0].c as number;

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `images` ORDER BY `id` DESC LIMIT ? OFFSET ?',
    [size, offset],
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
