import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { uploadRateLimiter } from '../middleware/rateLimit';
import { config } from '../config';
import { uploadImage, buildLinks, buildDeleteUrl, UploadError } from '../services/upload';

const router = Router();

// 内存存储，文件不落盘；大小上限由 config 控制
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: config.maxSizeBytes },
});

// 取上传文件：兼容字段名 file / image
function pickFile(req: Request): Express.Multer.File | null {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  // multer.fields 模式
  if (req.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
    const groups = req.files as Record<string, Express.Multer.File[]>;
    for (const key of ['file', 'image']) {
      if (groups[key] && groups[key].length > 0) return groups[key][0];
    }
    const first = Object.values(groups)[0];
    if (first && first.length > 0) return first[0];
  }
  return null;
}

// 同时接收 file 与 image 字段（任一即可）
const fieldsHandler = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);

async function handleUpload(req: Request, res: Response): Promise<void> {
  const file = pickFile(req);
  if (!file) {
    res.status(400).json({ error: '未检测到上传文件，字段名应为 file 或 image' });
    return;
  }

  try {
    const result = await uploadImage(file.buffer, file.mimetype, file.originalname);
    const links = buildLinks(result.url);
    const deleteUrl = buildDeleteUrl(result.id);

    // 纯文本模式：兼容 ShareX 纯文本 / curl
    const acceptText = (req.headers.accept ?? '').includes('text/plain');
    const wantText = req.query.format === 'text' || acceptText;
    if (wantText) {
      res.type('text/plain').send(result.url);
      return;
    }

    res.json({
      ...links,
      delete_url: deleteUrl,
      id: result.id,
      hash: result.hash,
      size: result.size,
      mime: result.mime,
      width: result.width,
      height: result.height,
      duplicated: result.duplicated,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

// 多端点兼容：鉴权 + 频率限制 + 字段解析 + 处理
const endpoints = ['/upload', '/api/upload', '/api/v1/upload'];
for (const path of endpoints) {
  router.post(
    path,
    requireAuth,
    uploadRateLimiter,
    fieldsHandler,
    handleUpload,
  );
}

export default router;
