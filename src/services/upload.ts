import { Readable } from 'stream';
import { RowDataPacket } from 'mysql2';
import { config } from '../config';
import { pool, ImageRow } from '../db/pool';
import { putObject } from '../r2/client';
import { sha256, extFromName, extFromStandardMime, normalizeSniffedMime } from './hash';
import imageSize from 'image-size';

import { fromBuffer as fileTypeFromBuffer } from 'file-type';

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface UploadResult {
  id: number;
  key: string;
  url: string;
  hash: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  original_name: string | null;
  duplicated: boolean;
}

function toRow(p: RowDataPacket): ImageRow {
  return p as unknown as ImageRow;
}

function buildKey(hash: string, ext: string): string {
  return `images/${hash.slice(0, 2)}/${hash}${ext ? '.' + ext : ''}`;
}

function buildUrl(key: string): string {
  return `${config.baseUrl}/i/${key}`;
}

export async function uploadImage(
  fileBuffer: Buffer,
  uploadedMime: string,
  originalName: string | undefined,
  userId: number | null,
): Promise<UploadResult> {
  if (fileBuffer.length > config.maxSizeBytes) {
    throw new UploadError(
      `文件过大: ${fileBuffer.length} 字节，上限 ${config.maxSizeBytes} 字节`,
      413,
    );
  }

  // 真实类型嗅探（不信任客户端 mimetype）
  const sniffed = await fileTypeFromBuffer(fileBuffer);
  const realMime = sniffed ? normalizeSniffedMime(sniffed.mime) : null;
  if (!realMime) {
    throw new UploadError('不支持的图片类型（仅允许 jpg/png/gif/webp/bmp）', 415);
  }

  const hash = sha256(fileBuffer);
  const ext = extFromName(originalName) || extFromStandardMime(realMime);
  const key = buildKey(hash, ext);

  // 去重：哈希已存在则直接返回（保留原归属，不夺取）
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM `images` WHERE `hash` = ? LIMIT 1',
    [hash],
  );
  if (existing.length > 0) {
    const row = toRow(existing[0]);
    return {
      id: row.id,
      key: row.key,
      url: buildUrl(row.key),
      hash: row.hash,
      size: row.size,
      mime: row.mime,
      width: row.width,
      height: row.height,
      original_name: row.original_name,
      duplicated: true,
    };
  }

  // 尺寸探测（已确认是真实图片，畸形文件由 try/catch 兜底）
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dim = imageSize(fileBuffer);
    if (dim.width && dim.height) {
      width = dim.width;
      height = dim.height;
    }
  } catch {
    // 极少数畸形文件无法解析尺寸，忽略
  }

  // 写 R2（用真实 MIME 作 ContentType）
  await putObject(key, fileBuffer, realMime);

  // 写库（key 唯一约束兜底并发上传同一哈希）
  try {
    const [result] = await pool.query<RowDataPacket[]>(
      'INSERT INTO `images` (`key`, `hash`, `original_name`, `size`, `mime`, `width`, `height`, `user_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [key, hash, originalName ?? null, fileBuffer.length, realMime, width, height, userId],
    );
    const insertId = (result as unknown as ResultSetHeaderLike).insertId;
    return {
      id: insertId,
      key,
      url: buildUrl(key),
      hash,
      size: fileBuffer.length,
      mime: realMime,
      width,
      height,
      original_name: originalName ?? null,
      duplicated: false,
    };
  } catch (err) {
    // 并发下另一请求先入库：删掉刚上传的对象并回查
    await safeDelete(key);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM `images` WHERE `hash` = ? LIMIT 1',
      [hash],
    );
    if (rows.length > 0) {
      const row = toRow(rows[0]);
      return {
        id: row.id,
        key: row.key,
        url: buildUrl(row.key),
        hash: row.hash,
        size: row.size,
        mime: row.mime,
        width: row.width,
        height: row.height,
        original_name: row.original_name,
        duplicated: true,
      };
    }
    throw err;
  }
}

interface ResultSetHeaderLike {
  insertId: number;
  [k: string]: unknown;
}

async function safeDelete(key: string): Promise<void> {
  try {
    const { deleteObject } = await import('../r2/client');
    await deleteObject(key);
  } catch {
    // 忽略删除失败
  }
}

/** 组装各格式链接 */
export function buildLinks(url: string): {
  url: string;
  markdown: string;
  html: string;
  bbcode: string;
} {
  return {
    url,
    markdown: `![](${url})`,
    html: `<img src="${url}" />`,
    bbcode: `[img]${url}[/img]`,
  };
}

export { Readable };
