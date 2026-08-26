import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSetting, registerRebuilder } from '../services/settings';

export class R2Error extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 500,
  ) {
    super(message);
  }
}

let client: S3Client | null = null;
let cachedEndpoint = '';

/** 懒构建 / 按需重建 S3Client：凭证或 Account ID 变更后由 rebuilder 重置 */
function getR2Client(): S3Client {
  const accountId = getSetting('r2_account_id');
  const accessKey = getSetting('r2_access_key_id');
  const secretKey = getSetting('r2_secret_access_key');
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  // 凭证或 endpoint 变了 → 丢弃旧 client 下次重建
  if (client && endpoint === cachedEndpoint) {
    return client;
  }

  if (!accountId || !accessKey || !secretKey) {
    throw new R2Error('R2 未配置，请在后台「系统设置」填写 R2 凭据', 'R2_NOT_CONFIGURED', 500);
  }

  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
  cachedEndpoint = endpoint;
  return client;
}

/** admin 保存 R2 配置后触发：丢弃缓存，下次请求自动用新凭证重建 */
export function resetR2Client(): void {
  client = null;
  cachedEndpoint = '';
}

registerRebuilder(resetR2Client);

function r2Bucket(): string {
  const b = getSetting('r2_bucket');
  if (!b) throw new R2Error('R2 桶名未配置', 'R2_NOT_CONFIGURED', 500);
  return b;
}

export async function putObject(
  key: string,
  body: Buffer,
  mime: string,
): Promise<void> {
  const c = getR2Client();
  await c.send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Body: body,
      ContentType: mime,
    }),
  );
}

export async function getObjectStream(key: string): Promise<{
  stream: Readable;
  mime: string | undefined;
  size: number | undefined;
}> {
  const c = getR2Client();
  let res;
  try {
    res = await c.send(
      new GetObjectCommand({ Bucket: r2Bucket(), Key: key }),
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (name === 'NoSuchKey' || status === 404) {
      throw new R2Error('对象不存在', 'NOT_FOUND', 404);
    }
    throw err;
  }
  if (!res.Body) {
    throw new R2Error('对象体为空', 'EMPTY_BODY', 404);
  }
  return {
    stream: res.Body as Readable,
    mime: res.ContentType,
    size: res.ContentLength,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const c = getR2Client();
  try {
    await c.send(
      new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }),
    );
  } catch (err) {
    // R2 delete 对不存在的 key 本身幂等；其他错误仅记日志，不阻断库记录清理
    console.error('[r2] delete 失败', key, err);
  }
}
