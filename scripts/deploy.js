#!/usr/bin/env node
/**
 * 烧饼图床一键部署脚本
 * 用法：
 *   npm run deploy          # 编译 + 启动/重启（自动选 PM2 或 nohup）
 *   npm run deploy -- status  # 查看运行状态
 *   npm run deploy -- stop    # 停止服务
 *   npm run deploy -- logs    # 查看日志
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const NAME = 'sbimg';

function log(msg) { console.log(`\x1b[36m[deploy]\x1b[0m ${msg}`); }
function ok(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); }

function run(cmd, opts = {}) {
  try { return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', cwd: root, ...opts }); }
  catch (e) { if (!opts.silent) err(`命令失败: ${cmd}`); process.exit(1); }
}

function has(cmd) {
  try { execSync(isWin ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function hasPM2() {
  try { execSync('pm2 --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const action = process.argv[2] || 'start';

// ===== status =====
if (action === 'status') {
  if (hasPM2()) { try { execSync('pm2 status ' + NAME, { stdio: 'inherit' }); } catch { err('PM2 未运行'); } }
  else {
    log('未检测到 PM2。查找 node dist/index.js 进程：');
    try { run(isWin ? 'powershell -Command "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like \'*dist/index.js*\'} | Select-Object ProcessId,CommandLine"' : 'ps aux | grep "dist/index.js" | grep -v grep', { silent: false }); }
    catch { log('无运行中的进程'); }
  }
  process.exit(0);
}

// ===== stop =====
if (action === 'stop') {
  if (hasPM2()) { try { execSync('pm2 stop ' + NAME, { stdio: 'inherit' }); ok('已停止 (PM2)'); } catch { log('PM2 中无此进程'); } }
  else {
    try {
      execSync(isWin ? 'powershell -Command "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like \'*dist/index.js*\'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"' : 'pkill -f "node dist/index.js"', { stdio: 'ignore' });
      ok('已停止');
    } catch { log('无运行中的进程'); }
  }
  process.exit(0);
}

// ===== logs =====
if (action === 'logs') {
  if (hasPM2()) { try { execSync('pm2 logs ' + NAME, { stdio: 'inherit' }); } catch { err('PM2 未运行'); } }
  else {
    const logPath = path.join(root, 'sbimg.log');
    if (!fs.existsSync(logPath)) { err('日志文件不存在: ' + logPath); process.exit(1); }
    run(isWin ? 'type ' + logPath : 'tail -f ' + logPath);
  }
  process.exit(0);
}

// ===== start / restart =====
if (action !== 'start' && action !== 'restart') {
  err(`未知命令: ${action}\n用法: npm run deploy [-- start|stop|status|logs]`);
  process.exit(1);
}

// 1. 检查 .env
log('检查配置...');
const envFile = path.join(root, '.env');
if (!fs.existsSync(envFile)) {
  err('未找到 .env 文件。请先复制 .env.example 并填写：\n  cp .env.example .env');
  process.exit(1);
}

// 2. 安装依赖（build 需要 typescript/@types，装完整依赖）
log('安装依赖...');
run('npm ci', { silent: true });
ok('依赖就绪');

// 3. 编译
log('编译 TypeScript...');
run('npm run build', { silent: true });
ok('编译完成');

// 3.5 清理 dev 依赖（减小体积，可选）
log('精简生产依赖...');
run('npm prune --omit=dev', { silent: true });
ok('已精简');

// 4. 启动
if (action === 'restart') {
  log('停止旧进程...');
  if (hasPM2()) { try { execSync('pm2 stop ' + NAME, { stdio: 'ignore' }); } catch {} }
  else { try { execSync('pkill -f "node dist/index.js"', { stdio: 'ignore' }); } catch {} }
}

if (hasPM2()) {
  log('使用 PM2 启动...');
  execSync(`pm2 start dist/index.js --name ${NAME}`, { stdio: 'inherit', cwd: root });
  execSync('pm2 save', { stdio: 'ignore' });
  ok('已启动 (PM2)');
  console.log('');
  log('常用命令：');
  console.log('  npm run deploy -- status   查看状态');
  console.log('  npm run deploy -- logs     查看日志');
  console.log('  npm run deploy -- stop     停止');
  console.log('  pm2 startup                开机自启（按提示执行输出的一行）');
} else {
  log('未检测到 PM2，使用 nohup 后台启动...');
  const logPath = path.join(root, 'sbimg.log');
  if (!isWin) {
    const child = spawn('node', ['dist/index.js'], {
      cwd: root, detached: true, stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env }
    });
    child.unref();
  } else {
    // Windows 用 start 后台
    execSync('start /B node dist/index.js', { cwd: root, stdio: 'ignore' });
  }
  ok('已后台启动');
  console.log('');
  log(`日志文件: ${logPath}`);
  log('建议安装 PM2 获得更好的进程管理：npm install -g pm2');
}

console.log('');
ok('部署完成！');
