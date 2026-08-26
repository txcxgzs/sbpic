// 多用户后台集成测试：覆盖鉴权/上传/权限/管理员/真实类型嗅探/邮箱验证/Turnstile
// 运行：node scripts/test-upload-flow.js （需先 npm run build + 本机 MySQL sbimg 库）
//
// 测试策略：
//   - MAIL_ENABLED=false：注册直接创建「已验证」用户，便于跑上传/权限用例
//   - TURNSTILE_ENABLED=false：注册不校验人机验证
//   - 另起一组用例单独验证「未验证用户不能上传」「管理员手动验证」「邮箱激活流程」
const path = require('path');
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

// ===== 环境变量（仅启动必需项；R2/邮件/Turnstile/限流等由 settings 表初始化默认值）=====
Object.assign(process.env, {
  PORT: '3125',
  DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'sbimg', DB_PASSWORD: 'sbimgpw123', DB_NAME: 'sbimg',
  SESSION_SECRET: 'test-secret-at-least-16-chars!!', TRUST_PROXY: '0', COOKIE_SECURE: 'false',
  INIT_ADMIN_USER: 'admin', INIT_ADMIN_PASS: 'adminpass123',
});

let cookieA = '', cookieB = '';
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
    // CSRF：状态变更请求自动从 cookie 提取 csrf_token 放入 header
    if (cookie && ['POST','PUT','PATCH','DELETE'].includes(method.toUpperCase())) {
      const m = cookie.match(/csrf_token=([^;]+)/);
      if (m && !h['X-CSRF-Token']) h['X-CSRF-Token'] = m[1];
    }
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
const FAKE_PNG = Buffer.from('this-is-plain-text-not-an-image');

(async () => {
  let failed = false;
  try {
    const { pool } = require(path.join(process.cwd(), 'dist', 'db', 'pool'));
    const { migrate } = require(path.join(process.cwd(), 'dist', 'db', 'migrate'));
    const { saveSettings } = require(path.join(process.cwd(), 'dist', 'services', 'settings'));
    await migrate();
    // 测试用：放宽限流 + 校准 base_url/邮件/Turnstile（这些配置已从 .env 移到 settings 表）
    await saveSettings({
      base_url: 'http://localhost:3125', app_url: 'http://localhost:3125',
      mail_enabled: 'false', turnstile_enabled: 'false',
      allow_register: 'true', register_limit_per_10min: '1000',
      global_limit_per_min: '1000', upload_limit_per_min: '1000',
      upload_limit_per_user_per_min: '1000', view_limit_per_min: '1000',
      upload_concurrency: '1000',
      user_storage_quota_mb: '0',
      r2_account_id: 'test', r2_access_key_id: 'test', r2_secret_access_key: 'test', r2_bucket: 'sbimg',
    });
    await pool.query('DELETE FROM images');
    await pool.query('DELETE FROM email_verifications');
    await pool.query('DELETE FROM users');
    require(path.join(process.cwd(), 'dist', 'index.js'));
    await new Promise((r) => setTimeout(r, 1800));

    console.log('--- 1. 初始管理员存在 ---');
    let r = await req('GET', '/api/auth/me', {});
    assert(r.status === 401, '未登录应 401');
    r = await req('POST', '/api/auth/login', { body: { username:'admin', password:'adminpass123' } });
    assert(r.status === 200, 'admin 登录应 200, got '+r.status+' '+r.text);
    cookieA = cookieFrom(r.setCookie);
    assert(r.json.username === 'admin' && r.json.role === 'admin', 'admin 信息');
    assert(r.json.email_verified === true, 'admin 应已验证');
    tokenA = r.json.api_token;

    console.log('--- 2. 注册普通用户 userA（MAIL_ENABLED=false → 直接已验证）---');
    r = await req('POST', '/api/auth/register', { body: { username:'usera', email:'usera@test.com', password:'userapass1' } });
    assert(r.status === 200, '注册 userA 应 200, got '+r.status+' '+r.text);
    cookieB = cookieFrom(r.setCookie);
    assert(r.json.role === 'user', 'userA 应为 user 角色');
    assert(r.json.email_verified === true, 'MAIL_ENABLED=false 注册即已验证');
    tokenB = r.json.api_token;

    console.log('--- 3. 注册校验：短密码 ---');
    r = await req('POST', '/api/auth/register', { body: { username:'userc', email:'c@test.com', password:'123' } });
    assert(r.status === 400, '短密码应 400');

    console.log('--- 4. 注册校验：邮箱格式 ---');
    r = await req('POST', '/api/auth/register', { body: { username:'userd', email:'not-an-email', password:'validpass1' } });
    assert(r.status === 400, '邮箱格式错应 400');

    console.log('--- 5. userA 用 API token 上传 PNG（真实类型嗅探通过）---');
    let mp = multipart({ file: { filename:'a.png', contentType:'image/png', data: PNG1 } });
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp.contentType } });
    assert(r.status === 200, '上传应 200, got '+r.status+' '+r.text);
    assert(r.json.url && r.json.url.includes('/i/images/'), '返回 url');
    assert(r.json.duplicated === false, '首次非去重');
    assert(r.json.width === 1 && r.json.height === 1, '尺寸 1x1');
    imgIdA = r.json.id;

    console.log('--- 6. 伪造类型：把文本伪装成 png 应被拒（magic bytes）---');
    const mp2 = multipart({ file: { filename:'a.png', contentType:'image/png', data: FAKE_PNG } });
    r = await req('POST', '/upload', { body: mp2.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp2.contentType } });
    assert(r.status === 415, '伪类型应 415, got '+r.status+' '+r.text);

    console.log('--- 7. 重复上传同一 PNG → 去重 ---');
    const mp3 = multipart({ file: { filename:'a-copy.png', contentType:'image/png', data: PNG1 } });
    r = await req('POST', '/upload', { body: mp3.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp3.contentType } });
    assert(r.status === 200 && r.json.duplicated === true, '应去重');
    assert(r.json.id === imgIdA, '返回同一 id');

    console.log('--- 8. 上传无 token → 401 ---');
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Content-Type':mp.contentType } });
    assert(r.status === 401, '无 token 应 401');

    console.log('--- 9. userA 列表只看到自己的 ---');
    r = await req('GET', '/api/images', { cookie: cookieB });
    assert(r.status === 200 && r.json.items.length === 1, 'userA 应看到 1 张');

    console.log('--- 10. admin 看全部（?all=1）含 userA 的图 ---');
    r = await req('GET', '/api/images?all=1', { cookie: cookieA });
    assert(r.status === 200 && r.json.total >= 1, 'admin all 应看到全部');

    console.log('--- 11. 权限隔离：userA 不能删别人的图 ---');
    const mp4 = multipart({ file: { filename:'adm.png', contentType:'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64') } });
    r = await req('POST', '/upload', { body: mp4.body, headers: { 'Authorization':'Bearer '+tokenA, 'Content-Type':mp4.contentType } });
    imgIdB = r.json.id;
    assert(r.status === 200, 'admin 上传应 200');
    r = await req('DELETE', '/api/images/'+imgIdB, { cookie: cookieB });
    assert(r.status === 403, 'userA 删 admin 图应 403, got '+r.status);

    console.log('--- 12. admin 可删任意图 ---');
    r = await req('DELETE', '/api/images/'+imgIdB, { cookie: cookieA });
    assert(r.status === 200, 'admin 删除应 200, got '+r.status+' '+r.text);
    assert(!Array.from(r2Store.keys()).some(k => k.includes('91Jpz')), 'R2 对象应已删除');

    console.log('--- 13. 管理员用户管理 + 手动验证 ---');
    r = await req('GET', '/api/admin/users', { cookie: cookieA });
    assert(r.status === 200 && r.json.items.length >= 2, 'admin 应看到至少2个用户');
    assert(r.json.items.some(u => u.email === 'usera@test.com'), '用户列表应含邮箱');
    assert(r.json.items.some(u => 'email_verified' in u), '用户列表应含验证状态');
    // 普通用户不能访问
    r = await req('GET', '/api/admin/users', { cookie: cookieB });
    assert(r.status === 403, 'userA 访问 admin API 应 403');

    console.log('--- 14. admin 重置 userA token，旧 token 失效 ---');
    const usersList = (await req('GET','/api/admin/users',{cookie:cookieA})).json.items;
    const uidA = usersList.find(u => u.username === 'usera').id;
    r = await req('POST', '/api/admin/users/'+uidA+'/reset-token', { cookie: cookieA });
    assert(r.status === 200 && r.json.api_token, '重置 token 应成功');
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp.contentType } });
    assert(r.status === 401, '旧 token 应已失效');
    // 获取新 token（重置后需重新登录拿新 token）
    r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'userapass1' } });
    assert(r.status === 200, 'userA 重新登录应成功');
    tokenB = r.json.api_token;
    cookieB = cookieFrom(r.setCookie);

    console.log('--- 15. 改密码后登录 ---');
    r = await req('POST', '/api/account/password', { cookie: cookieB, body: { oldPassword:'userapass1', newPassword:'newpass123' } });
    assert(r.status === 200, '改密码应成功, got '+r.status+' '+r.text);
    r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'userapass1' } });
    assert(r.status === 401, '旧密码登录应失败');
    r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'newpass123' } });
    assert(r.status === 200, '新密码登录应成功');
    cookieB = cookieFrom(r.setCookie);
    tokenB = r.json.api_token;

    console.log('--- 16. 未验证用户不能上传 ---');
    // admin 直接建一个未验证用户（role=user → emailVerified=0）
    r = await req('POST', '/api/admin/users', { cookie: cookieA, body: { username:'unverified1', email:'unv@test.com', password:'unverifiedpass1', role:'user' } });
    assert(r.status === 200, 'admin 建未验证用户应成功, got '+r.status+' '+r.text);
    assert(r.json.email_verified === false, 'admin 建普通用户应未验证');
    const unvToken = r.json.api_token;
    // 未验证用户上传应被拒
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+unvToken, 'Content-Type':mp.contentType } });
    assert(r.status === 403, '未验证用户上传应 403, got '+r.status+' '+r.text);

    console.log('--- 17. 管理员手动验证后可上传 ---');
    const usersList2 = (await req('GET','/api/admin/users',{cookie:cookieA})).json.items;
    const unvId = usersList2.find(u => u.username === 'unverified1').id;
    r = await req('POST', '/api/admin/users/'+unvId+'/verify', { cookie: cookieA });
    assert(r.status === 200, '管理员手动验证应成功, got '+r.status+' '+r.text);
    // 手动验证后该 token 上传应通过
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+unvToken, 'Content-Type':mp.contentType } });
    assert(r.status === 200, '手动验证后上传应 200, got '+r.status+' '+r.text);

    console.log('--- 18. Turnstile key 端点（关闭时 enabled=false）---');
    r = await req('GET', '/api/auth/turnstile-key', {});
    assert(r.status === 200, 'turnstile-key 应 200');
    assert(r.json.enabled === false, 'TURNSTILE_ENABLED=false 应返回 enabled:false');

    console.log('--- 19. 登录失败封禁（连续失败后封禁）---');
    // 连续用错误密码登录同一用户名（注意 loginLimiter 按 IP+username 限 10/分钟，阈值 5 次封禁）
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      r = await req('POST', '/api/auth/login', { body: { username:'usera', password:'wrongpassword' } });
      lastStatus = r.status;
    }
    assert(lastStatus === 429, '连续失败后应 429 封禁, got '+lastStatus);

    console.log('--- 20. 禁用用户后图片不可访问 ---');
    // admin 登录拿新 cookie（前面的可能因封禁影响）
    r = await req('POST', '/api/auth/login', { body: { username:'admin', password:'adminpass123' } });
    assert(r.status === 200, 'admin 重新登录应成功');
    cookieA = cookieFrom(r.setCookie);
    const usersList3 = (await req('GET','/api/admin/users',{cookie:cookieA})).json.items;
    const uidA2 = usersList3.find(u => u.username === 'usera').id;
    // userA 有图片（之前上传过），先获取一张的 key
    const userImages = (await req('GET','/api/images?all=1&user_id='+uidA2,{cookie:cookieA})).json;
    assert(userImages.items.length > 0, 'userA 应有图片');
    const testImg = userImages.items[0];
    // 禁用前图片可访问
    r = await req('GET', '/i/'+testImg.key, {});
    assert(r.status === 200, '禁用前图片应可访问, got '+r.status);
    // 禁用用户
    r = await req('POST', '/api/admin/users/'+uidA2+'/disable', { cookie: cookieA });
    assert(r.status === 200, '禁用用户应成功, got '+r.status+' '+r.text);
    // 禁用后图片不可访问（403）
    r = await req('GET', '/i/'+testImg.key, {});
    assert(r.status === 403, '禁用后图片应 403, got '+r.status);
    // 禁用用户的 API token 上传应被拒（403）
    r = await req('POST', '/upload', { body: mp.body, headers: { 'Authorization':'Bearer '+tokenB, 'Content-Type':mp.contentType } });
    assert(r.status === 403, '禁用用户 API token 上传应 403, got '+r.status+' '+r.text);

    console.log('--- 21. 启用用户后图片恢复访问 ---');
    r = await req('POST', '/api/admin/users/'+uidA2+'/enable', { cookie: cookieA });
    assert(r.status === 200, '启用用户应成功, got '+r.status+' '+r.text);
    // 启用后图片可访问
    r = await req('GET', '/i/'+testImg.key, {});
    assert(r.status === 200, '启用后图片应可访问, got '+r.status);

    console.log('--- 22. 存储配额查询 ---');
    // 设置配额为 1MB
    await saveSettings({ user_storage_quota_mb: '1' });
    // admin 查存储用量
    r = await req('GET', '/api/account/storage', { cookie: cookieA });
    assert(r.status === 200, '存储查询应 200');
    assert(r.json.quota_mb === 1, '配额应为 1MB, got '+r.json.quota_mb);
    assert(r.json.unlimited === false, '配额 1MB 时 unlimited 应为 false');
    // 设置为 0（不限制）
    await saveSettings({ user_storage_quota_mb: '0' });
    r = await req('GET', '/api/account/storage', { cookie: cookieA });
    assert(r.status === 200, '存储查询应 200');
    assert(r.json.unlimited === true, '配额 0 时 unlimited 应为 true');

    console.log('--- 23. CSRF 防护：错误 token 的 POST 应被拒 ---');
    // 登录获取 csrf token cookie
    r = await req('POST', '/api/auth/login', { body: { username:'admin', password:'adminpass123' } });
    const fullCookie = cookieFrom(r.setCookie);
    const csrfMatch = fullCookie.match(/csrf_token=([^;]+)/);
    assert(csrfMatch, '登录应返回 csrf_token cookie');
    // 发 POST 带 csrf cookie 但故意发错误的 X-CSRF-Token
    r = await req('POST', '/api/account/password', { cookie: fullCookie, headers: { 'X-CSRF-Token': 'wrong-token' }, body: { oldPassword:'adminpass123', newPassword:'newadmin123' } });
    assert(r.status === 403, '错误 CSRF token 应 403, got '+r.status+' '+r.text);

    console.log('\n=== 全部测试通过 ===');
  } catch (e) {
    console.error('测试失败:', e);
    failed = true;
  } finally {
    try {
      const { pool } = require(path.join(process.cwd(), 'dist', 'db', 'pool'));
      await pool.query('DELETE FROM images');
      await pool.query('DELETE FROM email_verifications');
      await pool.query('DELETE FROM users');
      await pool.end();
    } catch {}
    process.exit(failed ? 1 : 0);
  }
})();
