import { createHash } from 'crypto';

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 从原始文件名提取小写扩展名（不含点），无则返回空串 */
export function extFromName(name: string | undefined): string {
  if (!name) return '';
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** 由 MIME 推断扩展名（兜底） */
export function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return '';
  }
}

/** 允许的图片 MIME 与扩展白名单 */
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);
