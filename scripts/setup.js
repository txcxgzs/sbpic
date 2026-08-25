#!/usr/bin/env node
/**
 * 烧饼图床首次安装脚本
 * 用法: npm run setup
 * 完成：装依赖 → 检测 MySQL → 建库建用户 → 生成 .env → 编译 → 启动
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function log(msg) { console.log(`\x1b[36m[setup]\x1b[0m ${msg}`); }
function ok(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m⚠\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q, def) {
  return new Promise(res => {
    const prompt = def ? `\x1b[36m[setup]\x1b[0m ${q} \x1b[90m[${def}]\x1b[0m: ` : `\x1b[36m[setup]\x1b[0m ${q}: `;
    rl.question(prompt, a => res((a.trim() || def || '').trim()));
  });
}
function askPass(q) {
  return new Promise(res => {
    process.stdout.write(`\x1b[36m[setup]\x1b[0m ${q}: `);
    process.stdin.setRawMode?.(true);
    let pw = '';
    process.stdin.on('data', function handler(c) {
      if (c[0] === 13 || c[0] === 10) {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', handler);
        console.log('');
        res(pw);
      } else if (c[0] === 3) { process.exit(0); }
      else { pw += c.toString(); }
    });
  });
}

(async () => {
  console.log('');
  log('=== 烧饼图床 首次安装 ===');
  console.log('');

  // 1. 装依赖
  log('安装依赖...');
  try { execSync('npm ci', { stdio: 'inherit', cwd: root }); ok('依赖安装完成'); }
  catch { err('依赖安装失败，请检查网络或手动 npm install'); process.exit(1); }

  // 2. .env 是否已存在
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    const overwrite = await ask('.env 已存在，是否覆盖？(y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      log('保留现有 .env，跳过配置');
      rl.close();
      return buildAndRun();
    }
  }

  // 3. 收集配置
  console.log('');
  log('请填写配置（回车使用默认值）：');
  console.log('');
  const dbHost = await ask('MySQL 地址', '127.0.0.1');
  const dbPort = await ask('MySQL 端口', '3306');
  const dbName = await ask('数据库名', 'sbimg');
  const dbUser = await ask('数据库用户名', 'sbimg');
  const dbPass = await askPass('数据库密码');
  const useRoot = await ask('是否用 root 自动建库建用户？(y/N)', 'N');

  let rootPass = '';
  if (useRoot.toLowerCase() === 'y') {
    rootPass = await askPass('MySQL root 密码');
  }

  const port = await ask('服务端口', '3000');
  const baseUrl = await ask('对外访问域名', `http://localhost:${port}`);
  const r2Account = await ask('R2 Account ID');
  const r2AccessKey = await ask('R2 Access Key ID');
  const r2Secret = await askPass('R2 Secret Access Key');
  const r2Bucket = await ask('R2 Bucket', 'sbimg');

  const adminUser = await ask('初始管理员用户名', 'admin');
  const adminPassChoice = await ask('初始管理员密码（留空自动生成）', '');

  console.log('');

  // 4. 自动建库
  if (useRoot.toLowerCase() === 'y' && rootPass) {
    log('自动创建数据库和用户...');
    try {
      const sql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4; CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPass}'; GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'%'; FLUSH PRIVILEGES;`;
      execSync(`mysql -h ${dbHost} -P ${dbPort} -u root -p'${rootPass}' -e "${sql}"`, { stdio: 'pipe' });
      ok('数据库和用户已创建');
    } catch (e) {
      warn('自动建库失败（可能 root 密码有误或 mysql 命令不可用），请手动建库');
      console.log('  手动执行：');
      console.log(`  mysql -u root -p -e "CREATE DATABASE ${dbName} CHARACTER SET utf8mb4; CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}'; GRANT ALL ON ${dbName}.* TO '${dbUser}'@'localhost';"`);
    }
  }

  // 5. 生成 .env
  log('生成 .env ...');
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const env = `# 烧饼图床配置 - 由 setup 脚本生成

PORT=${port}
BASE_URL=${baseUrl}
APP_URL=${baseUrl}
MAX_SIZE_MB=20

# Cloudflare R2
R2_ACCOUNT_ID=${r2Account}
R2_ACCESS_KEY_ID=${r2AccessKey}
R2_SECRET_ACCESS_KEY=${r2Secret}
R2_BUCKET=${r2Bucket}

# MySQL
DB_HOST=${dbHost}
DB_PORT=${dbPort}
DB_USER=${dbUser}
DB_PASSWORD=${dbPass}
DB_NAME=${dbName}

# 会话
SESSION_SECRET=${sessionSecret}
TRUST_PROXY=1
COOKIE_SECURE=false

# 初始管理员
INIT_ADMIN_USER=${adminUser}
INIT_ADMIN_PASS=${adminPassChoice}

# 注册
ALLOW_REGISTER=true
REGISTER_LIMIT_PER_10MIN=3

# 邮件（按需开启）
MAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Turnstile（按需开启）
TURNSTILE_ENABLED=false
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
`;
  fs.writeFileSync(envFile, env, 'utf8');
  ok('.env 已生成');
  rl.close();

  await buildAndRun();
})();

async function buildAndRun() {
  // 6. 编译
  log('编译...');
  try { execSync('npm run build', { stdio: 'inherit', cwd: root }); ok('编译完成'); }
  catch { err('编译失败'); process.exit(1); }

  // 7. 提示启动
  console.log('');
  ok('安装完成！');
  console.log('');
  log('启动方式：');
  console.log('  npm run deploy          # 一键启动/重启');
  console.log('  npm start               # 前台运行');
  console.log('  npm run deploy -- logs    # 查看日志');
  console.log('  npm run deploy -- stop    # 停止');
  console.log('');
  log('如需开启邮件验证/Turnstile，编辑 .env 后 npm run deploy 重启');
  process.exit(0);
}
