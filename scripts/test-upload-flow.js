// 多用户后台集成测试：覆盖鉴权/上传/权限/管理员/真实类型嗅探
// 运行：node scripts/test-upload-flow.js （需先 npm run build + 本机 MySQL sbimg 库）
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');
const http = require('http');

// ===== mock R2（替换 dist/r2/client 缓存）=====
const r2Store = new Map();
const mockR2 = {
  putObject: async (key, body) => { r2Store.set(key, body); },
  getObjectStream: async (key) => {
    if (!r2Store.has(key)) { const e = new Error('nf'); e.name='NoSuchKey'; e.$metadata={httpStatusCode:404}; throw e; }
    return { stream: Readable.from(r2Store.get(key)), mime: 'image/png', size: r2Store.get(key).length };
  },
  deleteObject: async (key) => { r2Store.delete(key); },
  R2Error: class extends Error { constructor(m,c,s){super(m);this.code=c;this.status=s;} },
};
const r2Abs = require.resolve(path.join(process.cwd(), 'dist', 'r2', 'client.js'));
require.cache[r2Abs] = { id: r2Abs, filename: r2Abs, loaded: true, exports: mockR2, paths: [], children: [], parent: null };

// ===== 环境变量 =====
Object.assign(process.env, {
  PORT: '3125', BASE_URL: 'http://localhost:3125',
  MAX_SIZE_MB: '20', RATE_LIMIT_PER_MIN: '1000',
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'sbimg',
  DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'sbimg', DB_PASSWORD: 'sbimgpw123', DB_NAME: 'sbimg',
  SESSION_SECRET: 'test-secret-at-least-16-chars!!', TRUST_PROXY: '0', COOKIE_SECURE: 'false',
  INIT_ADMIN_USER: 'admin', INIT_ADMIN_PASS: 'adminpass123',
  ALLOW_REGISTER: 'true', REGISTER_LIMIT_PER_10MIN: '1000',
});

let server, baseUrl = 'http://localhost:3125';
let cookieA = '', cookieB = ''; // 两个用户的 session cookie
let tokenA = '', tokenB = '';
let imgIdA, imgIdB;

function assert(cond, msg){ if(!cond){ console.error('断言失败:', msg); throw new Error('断言失败: '+msg); } }

function req(method, urlPath, { body, headers, cookie } = {}){
  return new Promise((resolve, reject) => {
    let data = null;
    if (body) {
      if (Buffer.isBuffer(body)) data = body;
      else data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
    const h = { ...(headers||{}) };
    if (data) { h['Content-Type'] = h['Content-Type'] || 'application/json'; h['Content-Length'] = data.length; }
    if (cookie) h['Cookie'] = cookie;
    const r = http.request({ host:'127.0.0.1', port:'3125', method, path:urlPath, headers:h }, res => {
      const setCookie = res.headers['set-cookie'];
      let chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
        resolve({ status: res.statusCode, json: j, text: txt, setCookie });
      });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function cookieFrom(setCookie){ return (setCookie||[]).map(c=>c.split(';')[0]).join('; '); }

function multipart(fields){
  const boundary = '----sbimgtest' + Math.random().toString(16).slice(2);
  let buf = Buffer.alloc(0);
  const push = b => buf = Buffer.concat([buf, b]);
  for (const [name, val] of Object.entries(fields)) {
    push(Buffer.from(`--${boundary}\r\n`));
    if (val.filename) {
      push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${val.filename}"\r\nContent-Type: ${val.contentType||'application/octet-stream'}\r\n\r\n`));
      push(Buffer.isBuffer(val.data) ? val.data : Buffer.from(val.data));
      push(Buffer.from('\r\n'));
    } else {
      push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`));
    }
  }
  push(Buffer.from(`--${boundary}--\r\n`));
  return { body: buf, contentType: `multipart/form-data; boundary=${boundary}` };
}

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0N8AAAAASUVORK5CYII=', 'base64');
// 伪装成 png 的文本（magic bytes 不属于任何图片格式）
const FAKE_PNG = Buffer.from('this-is-plain-text-not-an-image');

(async () => {
  let failed = false;
  try {
    // 先单独跑 migrate 建表，清空数据，确保 ensureInitialAdmin 能建初始 admin
    const { pool } = require(path.join(process.cwd(), 'dist', 'db', 'pool'));
    const { migrate } = require(path.join(process.cwd(), 'dist', 'db', 'migrate'));
    await migrate();
    await pool.query('DELETE FROM images');
    await pool.query('DELETE FROM users');
    // 启动服务（ensureInitialAdmin 会建初始 admin）
    require(path.join(process.cwd(), 'dist', 'index.js'));
    await new Promise((r) => setTimeout(r, 1800)); // 等启动 + 建初始 admin

    console.log('--- 1. 初始管理员存在 ---');
    const me0 = await req('GET', '/api/auth/me', {});
    assert(me0.status === 401, '未登录应 401');
    let r = await req('POST', '/api/auth/login', { body: { username:'admin', password:'adminpass123' } });
    assert(r.status === 200, 'admin 登录应 200, got '+r.status+' '+r.text);
    cookieA = cookieFrom(r.setCookie);
    assert(r.json.username === 'admin' && r.json.role === 'admin', 'admin 信息');
    tokenA = r.json.api_token;

    console.log('--- 2. 注册普通用户 userA ---');
    r = await req('POST', '/api/auth/register', { body: { username:'usera', password:'userapass1' } });
    assert(r.status === 200, '注册 userA 应 200, got '+r.status+' '+r.text);
    cookieB = cookieFrom(r.setCookie);
    assert(r.json.role === 'user', 'userA 应为 user 角色');
    tokenB = r.json.api_token;

    console.log('--- 3. 注册校验：短密码 ---');
    r = await req('POST', '/api/auth/register', { body: { username:'userc', password:'123' } });
    assert(r.status === 400, '短密码应 400');

    console.log('--- 4. userA 用 API token 上传 PNG（真实类型嗅探通过）---');
    const mp = multipart({ file: { filename:'a.png', contentType:'image/png', data: PNG1 } });
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp.contentType } });
    assert(r.status === 200, '上传应 200, got '+r.status+' '+r.text);
    assert(r.json.url && r.json.url.includes('/i/images/'), '返回 url');
    assert(r.json.duplicated === false, '首次非去重');
    assert(r.json.width === 1 && r.json.height === 1, '尺寸 1x1');
    imgIdA = r.json.id;

    console.log('--- 5. 伪造类型：把文本伪���成 png 应被拒（magic bytes）---');
    const mp2 = multipart({ file: { filename:'a.png', contentType:'image/png', data: FAKE_PNG } });
    r = await req('POST', '/upload', { body: mp2.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp2.contentType } });
    assert(r.status === 415, '伪类型应 415, got '+r.status+' '+r.text);

    console.log('--- 6. 重复上传同一 PNG → 去重 ---');
    const mp3 = multipart({ file: { filename:'a-copy.png', contentType:'image/png', data: PNG1 } });
    r = await req('POST', '/upload', { body: mp3.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp3.contentType } });
    assert(r.status === 200 && r.json.duplicated === true, '应去重');
    assert(r.json.id === imgIdA, '返回同一 id');

    console.log('--- 7. 上传无 token → 401 ---');
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Content-Type':mp.contentType } });
    assert(r.status === 401, '无 token 应 401');

    console.log('--- 8. userA 列表只看到自己的 ---');
    r = await req('GET', '/api/images', { cookie: cookieB });
    assert(r.status === 200 && r.json.items.length === 1, 'userA 应看到 1 张');

    console.log('--- 9. admin 看全部（?all=1）含 userA 的图 ---');
    r = await req('GET', '/api/images?all=1', { cookie: cookieA });
    assert(r.status === 200 && r.json.total >= 1, 'admin all 应看到全部');

    console.log('--- 10. 权限隔离：userA 不能删别人的图（这里造一张 admin 的图）---');
    // admin 直接上传一张
    const mp4 = multipart({ file: { filename:'adm.png', contentType:'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64') } });
    r = await req('POST', '/upload', { body: mp4.body, headers: { 'Authorization':'Bearer '+tokenA, 'Content-Type':mp4.contentType } });
    imgIdB = r.json.id;
    assert(r.status === 200, 'admin 上传应 200');
    // userA 尝试删 admin 的图
    r = await req('DELETE', '/api/images/'+imgIdB, { cookie: cookieB });
    assert(r.status === 403, 'userA 删 admin 图应 403, got '+r.status);

    console.log('--- 11. admin 可删任意图 ---');
    r = await req('DELETE', '/api/images/'+imgIdB, { cookie: cookieA });
    assert(r.status === 200, 'admin 删除应 200, got '+r.status+' '+r.text);
    // 删除后该 key 不应在 R2
    assert(!Array.from(r2Store.keys()).some(k => k.includes('91Jpz')), 'R2 对象应已删除');

    console.log('--- 12. 管理员用户管理 ---');
    r = await req('GET', '/api/admin/users', { cookie: cookieA });
    assert(r.status === 200 && r.json.items.length >= 2, 'admin 应看到至少2个用户');
    // 普通用户不能访问
    r = await req('GET', '/api/admin/users', { cookie: cookieB });
    assert(r.status === 403, 'userA 访问 admin API 应 403');
    // admin 重置 userA token
    const usersList = (await req('GET','/api/admin/users',{cookie:cookieA})).json.items;
    const uidA = usersList.find(u => u.username === 'usera').id;
    r = await req('POST', '/api/admin/users/'+uidA+'/reset-token', { cookie: cookieA });
    assert(r.status === 200 && r.json.api_token, '重置 token 应成功');
    // 旧 token 失效
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp.contentType } });
    assert(r.status === 401, '旧 token 应已失效');

    console.log('--- 13. 改密码后登录 ---');
    r = await req('POST', '/api/account/password', { cookie: cookieB, body: { oldPassword:'userapass1', newPassword:'newpass123' } });
    // cookieB 的 session 仍有效（同会话），但重新登录需用新密码
    r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'userapass1' } });
    assert(r.status === 401, '旧密码登录应失败');
    r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'newpass123' } });
    assert(r.status === 200, '新密码登录应成功');

    console.log('\n=== 全部测试通过 ===');
  } catch (e) {
    console.error('测试失败:', e);
    failed = true;
  } finally {
    try {
      const { pool } = require(path.join(process.cwd(), 'dist', 'db', 'pool'));
      await pool.query('DELETE FROM images'); await pool.query('DELETE FROM users');
      await pool.end();
    } catch {}
    process.exit(failed ? 1 : 0);
  }
})();
