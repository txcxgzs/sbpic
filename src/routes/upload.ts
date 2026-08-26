import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireApiToken } from '../middleware/auth';
import { uploadRateLimiter, uploadUserLimiter } from '../middleware/rateLimit';
import { uploadConcurrency } from '../middleware/concurrency';
import { uploadImage, buildLinks, UploadError } from '../services/upload';

const router = Router();

// 内存存储，文件不落盘
// multer 的 fileSize 设一个硬上限（100MB）做传输层兜底；
// 实际大小限制由 uploadImage 内部读后台 settings 的 max_size_mb 强制
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

function pickFile(req: Request): Express.Multer.File | null {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
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

const fieldsHandler = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);

async function handleUpload(req: Request, res: Response): Promise<void> {
  // 未验证邮箱用户不能上传（需邮箱激活后使用）
  if (!req.user!.email_verified) {
    res.status(403).json({ error: '邮箱未验证，请先激活邮箱后再上传' });
    return;
  }
  const file = pickFile(req);
  if (!file) {
    res.status(400).json({ error: '未检测到上传文件，字段名应为 file 或 image' });
    return;
  }

  try {
    const result = await uploadImage(file.buffer, file.mimetype, file.originalname, req.user!.id);
    const links = buildLinks(result.url);

    // 纯文本模式：兼容 ShareX 纯文本 / curl
    const acceptText = (req.headers.accept ?? '').includes('text/plain');
    const wantText = req.query.format === 'text' || acceptText;
    if (wantText) {
      res.type('text/plain').send(result.url);
      return;
    }

    res.json({
      ...links,
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

// 多端点兼容：API token 鉴权 + 频率限制 + 并发控制 + 字段解析
const endpoints = ['/upload', '/api/upload', '/api/v1/upload'];
for (const path of endpoints) {
  router.post(
    path,
    requireApiToken,
    uploadRateLimiter,
    uploadUserLimiter,
    uploadConcurrency,
    fieldsHandler,
    handleUpload,
  );
}

export default router;
