// 集成测试：在加载 service 前，用内存 mock 替换 dist/r2/client.js 的缓存
// 运行：node scripts/test-upload-flow.js  （需先 npm run build）
const Module = require('module');
const path = require('path');
const { Readable } = require('stream');

const r2Store = new Map();
const mockR2 = {
  putObject: async (key, body) => { r2Store.set(key, body); },
  getObjectStream: async (key) => {
    if (!r2Store.has(key)) {
      const e = new Error('对象不存在');
      e.name = 'NoSuchKey';
      e.$metadata = { httpStatusCode: 404 };
      throw e;
    }
    const s = Readable.from(r2Store.get(key));
    return { stream: s, mime: 'image/png', size: r2Store.get(key).length };
  },
  deleteObject: async (key) => { r2Store.delete(key); },
  R2Error: class extends Error {
    constructor(m, c, s) {
      super(m);
      this.code = c;
      this.status = s;
    }
  },
};

// 先加载一次真实模块拿到其绝对路径，再用 mock 占据缓存
const r2Abs = require.resolve(path.join(process.cwd(), 'dist', 'r2', 'client.js'));
require.cache[r2Abs] = {
  id: r2Abs,
  filename: r2Abs,
  loaded: true,
  exports: mockR2,
  paths: [],
  children: [],
  parent: null,
};

// 环境变量
process.env.PORT = '3124';
process.env.BASE_URL = 'http://localhost:3124';
process.env.ADMIN_TOKEN = 'testtoken123456';
process.env.MAX_SIZE_MB = '20';
process.env.RATE_LIMIT_PER_MIN = '30';
process.env.R2_ACCOUNT_ID = 'test';
process.env.R2_ACCESS_KEY_ID = 'test';
process.env.R2_SECRET_ACCESS_KEY = 'test';
process.env.R2_BUCKET = 'sbimg';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'sbimg';
process.env.DB_PASSWORD = 'sbimgpw123';
process.env.DB_NAME = 'sbimg';

const { pool } = require(path.join(process.cwd(), 'dist', 'db', 'pool'));
const { uploadImage, buildLinks, buildDeleteUrl } = require(path.join(process.cwd(), 'dist', 'services', 'upload'));
const { listImages, getImageById, deleteImageById } = require(path.join(process.cwd(), 'dist', 'services', 'images'));

const png1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0N8AAAAASUVORK5CYII=',
  'base64',
);
const png2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  let failed = false;
  try {
    await pool.query('DELETE FROM images');

    console.log('--- 1. 首次上传 png1 ---');
    const r1 = await uploadImage(png1, 'image/png', 'a.png');
    console.log('id:', r1.id, 'duplicated:', r1.duplicated, 'size:', r1.size, 'w/h:', r1.width + 'x' + r1.height);
    console.log('url:', r1.url);
    assert(r1.duplicated === false, '首次应非重复');
    assert(r1.width === 1 && r1.height === 1, '尺寸应为 1x1');

    console.log('--- 2. 重复上传同一 png1（去重） ---');
    const r2 = await uploadImage(png1, 'image/png', 'a-copy.png');
    console.log('id:', r2.id, 'duplicated:', r2.duplicated);
    assert(r2.duplicated === true, '应命中去重');
    assert(r2.id === r1.id, '应返回同一 id');
    assert(r2Store.size === 1, 'R2 不应重复写入');

    console.log('--- 3. 上传不同 png2 ---');
    const r3 = await uploadImage(png2, 'image/png', 'b.png');
    console.log('id:', r3.id, 'duplicated:', r3.duplicated, 'w/h:', r3.width + 'x' + r3.height);
    assert(r3.duplicated === false, '不同文件非重复');
    assert(r3.id !== r1.id, '应有新 id');

    console.log('--- 4. 链接格式 ---');
    const links = buildLinks(r1.url);
    console.log('markdown:', links.markdown);
    console.log('bbcode:', links.bbcode);
    assert(links.markdown === `![](${r1.url})`, 'markdown 格式');
    console.log('delete_url:', buildDeleteUrl(r1.id));

    console.log('--- 5. 列表 ---');
    const list = await listImages(1, 30);
    console.log('total:', list.total, 'items:', list.items.length);
    assert(list.total === 2, '应有 2 条记录');
    assert(list.items[0].id > list.items[1].id, '应按 id 倒序');

    console.log('--- 6. 详情 ---');
    const det = await getImageById(r1.id);
    assert(det && det.hash === r1.hash, '详情 hash 匹配');

    console.log('--- 7. view 流（mock R2） ---');
    const v = await mockR2.getObjectStream(r1.key);
    const chunks = [];
    for await (const c of v.stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    assert(buf.equals(png1), 'view 流应返回原始数据');
    console.log('view 返回', buf.length, '字节 OK');

    console.log('--- 8. 删除 ---');
    const ok = await deleteImageById(r1.id);
    assert(ok === true, '删除应成功');
    assert(!r2Store.has(r1.key), 'R2 对象应被删除');
    const after = await listImages(1, 30);
    assert(after.total === 1, '删除后应剩 1 条');

    console.log('--- 9. 删除后重新上传 png1 ---');
    const r9 = await uploadImage(png1, 'image/png', 'a.png');
    console.log('duplicated:', r9.duplicated, 'new id:', r9.id);
    assert(r9.duplicated === false, '删除后应重新写入');

    console.log('\n=== 全部测试通过 ===');
  } catch (e) {
    console.error('测试失败:', e);
    failed = true;
  } finally {
    try {
      await pool.query('DELETE FROM images');
    } catch {}
    await pool.end();
    process.exit(failed ? 1 : 0);
  }
})();

function assert(cond, msg) {
  if (!cond) {
    console.error('断言失败:', msg);
    throw new Error('断言失败: ' + msg);
  }
}
