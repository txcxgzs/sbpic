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
    default:
      return '';
  }
}

/**
 * file-type 嗅探出的 MIME → 标准化 MIME（用于入库和 R2 ContentType）。
 * 仅允许 jpg/png/gif/webp/bmp（已移除 svg，杜绝同源 XSS）。
 */
export function normalizeSniffedMime(raw: string): string | null {
  switch (raw) {
    case 'image/jpeg':
      return 'image/jpeg';
    case 'image/png':
      return 'image/png';
    case 'image/gif':
      return 'image/gif';
    case 'image/webp':
      return 'image/webp';
    case 'image/bmp':
      return 'image/bmp';
    default:
      return null;
  }
}

/** 由真实 MIME 取扩展名 */
export function extFromStandardMime(mime: string): string {
  return extFromMime(mime);
}
