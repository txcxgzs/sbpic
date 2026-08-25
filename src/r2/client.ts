import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { config } from '../config';

export class R2Error extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 500,
  ) {
    super(message);
  }
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

export async function putObject(
  key: string,
  body: Buffer,
  mime: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
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
  let res;
  try {
    res = await client.send(
      new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }),
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
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }),
    );
  } catch (err) {
    // R2 delete 对不存在的 key 本身幂等；其他错误仅记日志，不阻断库记录清理
    console.error('[r2] delete 失败', key, err);
  }
}
