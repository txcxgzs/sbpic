# 烧饼图床 (sbimg)

对接 Cloudflare R2 存储的自托管图床，支持多用户。后端跑在你自己的服务器上，图片存到 R2，用户与图片元数据存到 MySQL。

## 特性

- **多用户后台**：管理员 + 普通用户两级权限，服务端 session，开放注册（可关）
- **邮箱验证注册**：注册需填邮箱，收到验证链接激活后才能上传；支持改邮箱后重新验证
- **Turnstile 人机验证**：注册表单集成 Cloudflare Turnstile，防止机器人批量注册
- **应用层抗 CC**：分层限流（全局/上传/图片访问/注册/登录）+ 登录失败封禁 + 上传并发控制 + helmet 安全头
- **安全上传**：magic bytes 真实类型嗅探，伪造类型无法绕过；已移除 SVG 杜绝同源 XSS
- 拖拽 / 点击 / 剪贴板粘贴上传，多文件批量
- 哈希去重：相同图片只存一份，重复上传直接返回已有链接
- URL / Markdown / HTML / BBCode 多格式链接一键复制
- 图片按用户归属，普通用户只能看/删自己的，管理员可管全部
- 用户 API token 上传（兼容 PicGo / ShareX / curl），图片公开访问
- 启动自动建表 + 自动建初始管理员，无需手动迁移

## 技术栈

Node.js + Express + TypeScript，MySQL（用户/元数据/session），Cloudflare R2（图片存储，S3 兼容 SDK）。
密码 bcrypt 哈希，session 存 MySQL（express-session + express-mysql-session）。
邮件用 nodemailer（SMTP，兼容 Brevo 及任意 SMTP 服务商），人机验证用 Cloudflare Turnstile。

## 目录结构

```
sbimg/
├── src/
│   ├── index.ts            # 入口
│   ├── config.ts           # 环境变量 + zod 校验
│   ├── db/                 # 连接池 / 建表迁移（幂等加列）
│   ├── r2/client.ts        # R2 (S3) 封装
│   ├── middleware/         # session 鉴权 / API token / 分层限流 / 并发控制 / 安全头 / 错误处理
│   ├── services/           # auth(注册登录验证) / users(用户CRUD) / hash / upload / images / mail / turnstile
│   ├── routes/             # auth / account / admin / upload / images / view / page
│   ├── types/              # 第三方模块类型声明
│   └── views/index.html   # 管理页面（登录/注册/Turnstile/控制台/管理）
├── scripts/
│   ├── copy-assets.js      # 构建后复制静态资源
│   └── test-upload-flow.js # 集成测试（多用户全流程）
├── package.json
└── tsconfig.json
```

## 部署

### 前置条件

- Node.js 18+（开发用 22）
- MySQL 5.7+ / 8.0+
- Cloudflare R2 桶 + API Token

### 宝塔面板部署（推荐）

宝塔用户按这个顺序来，别一上来就 clone：

#### 1. 先建站点（宝塔 → 网站 → 添加站点）

填你的域名，PHP 版本选「纯静态」即可（应用走 Node 内部端口，站点只做反向代理）。建好后你会得到 `/www/wwwroot/你的域名/` 目录。

#### 2. 再建数据库（宝塔 → 数据库 → 添加数据库）

起个库名（比如 `sbimg`），设密码，编码选 `utf8mb4`。**记下数据库名、用户名、密码**。

#### 3. clone 到站点根目录

SSH 进服务器：

```bash
cd /www/wwwroot/你的域名
git clone https://github.com/txcxgzs/sbpic.git sbimg
cd sbimg
npm run setup
```

`npm run setup` 会先列出需要准备好的东西让你确认，再交互式引导填写配置（回车用默认值）：安装依赖 → 填 R2/MySQL/域名（可选 root 自动建库）→ 生成 `.env`（含随机 SESSION_SECRET）→ 编译。

> 如果已 clone 到别处（如 `/root/sbimg`），可以挪过来：`mv /root/sbimg /www/wwwroot/你的域名/sbimg && cd /www/wwwroot/你的域名/sbimg`，再 `npm run setup`。

#### 4. 启动

```bash
npm run deploy              # 编译 + 启动/重启（自动检测 PM2，没有则 nohup 后台跑）
npm run deploy -- status    # 查看运行状态
npm run deploy -- logs      # 查看日志
npm run deploy -- stop      # 停止
```

#### 5. 配置反向代理（宝塔 → 网站 → 站点设置 → 反向代理）

添加反向代理，目标 URL 填 `http://127.0.0.1:8321`（应用默认监听 8321，避开常用端口冲突）。

#### 6. 编辑 .env 对齐域名与 HTTPS

```bash
# 在项目目录编辑 .env，确认这几项
BASE_URL=https://你的域名
APP_URL=https://你的域名
TRUST_PROXY=1
COOKIE_SECURE=true   # HTTPS 下设 true
```

改完 `npm run deploy` 重启生效。SSL 在宝塔站点设置 → SSL 里申请并开启。

> 首次启动若 `users` 表为空，自动创建初始管理员；`INIT_ADMIN_PASS` 留空则随机密码打印到控制台，**请登录后立即改密码**。
> 开发模式（热重载）：`npm run dev`

### 手动部署（非宝塔）

#### 1. 获取 R2 凭据

1. Cloudflare 控制台 → R2 → 创建一个 bucket（如 `sbimg`）
2. R2 → 管理 R2 API 令牌 → 创建 API 令牌，权限选「对象读和写」
3. 记下 `Account ID`、`Access Key ID`、`Secret Access Key`

#### 2. 准备 MySQL

```sql
CREATE DATABASE sbimg CHARACTER SET utf8mb4;
CREATE USER 'sbimg'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON sbimg.* TO 'sbimg'@'localhost';
FLUSH PRIVILEGES;
```

表会在服务启动时自动创建，无需手动建表。

#### 3. 安装 + 启动

```bash
git clone <repo> sbimg
cd sbimg
npm run setup    # 交互式引导，生成 .env 并编译
npm run deploy   # 启动/重启
```

> 也可手动：`npm install` → `cp .env.example .env` 编辑配置 → `npm run build`。完整环境变量说明见 `.env.example` 注释。

#### 4. PM2 开机自启（可选）

```bash
npm install -g pm2
npm run deploy            # 用 PM2 启动
pm2 startup               # 按提示执行输出的一行命令注册开机自启
```

#### 5. Nginx 反代

应用默认监听 `8321` 端口，通过反代对外提供服务。

```nginx
server {
    listen 80;
    server_name img.example.com;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:8321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

记得设 `TRUST_PROXY=1`（单层反代）使频率限制取真实 IP。生产 HTTPS 下设 `COOKIE_SECURE=true`。

## 认证模型

- **管理后台**：浏览器登录，httpOnly cookie session（7 天）。登录态用于页面操作和图片管理 API。
- **外部上传**：用各用户的 API Token，放在请求头 `Authorization: Bearer <token>`。Token 在后台「账户」页查看/重置。**未验证邮箱用户不能上传**。
- **图片访问**：`GET /i/*` 公开，无需鉴权。

权限：普通用户只能看/删自己上传的图；管理员可看全部、删任意、管理用户、手动验证用户邮箱。

### 邮箱验证

- 注册需填邮箱，`MAIL_ENABLED=true` 时创建未验证用户并发验证邮件，用户点链接激活后才能上传
- `MAIL_ENABLED=false` 时注册直接创建已验证用户（本地调试/应急用）
- 邮箱唯一性在「激活时」由程序层检查（同一邮箱可有未验证的待激活记录，但只能有一个已验证）
- 已登录未验证用户可点「重发验证邮件」（限频 10 分钟一次）
- 管理员可在用户表手动标记已验证（应急）
- 改邮箱后需重新验证，验证前旧邮箱仍可用

### Turnstile 人机验证

- 仅在注册表单启用，防止机器人批量注册
- `TURNSTILE_ENABLED=false` 或未填 SITE_KEY 时不渲染 widget、不校验
- 前端从 `/api/auth/turnstile-key` 获取 site key 决定是否渲染

## API

### 鉴权（session）

```
GET    /api/auth/turnstile-key           获取 Turnstile site key（enabled + siteKey）
POST   /api/auth/login     {username, password}   登录，建 session
POST   /api/auth/register  {username, email, password, turnstileToken}  注册（受 ALLOW_REGISTER + Turnstile + 邮箱验证）
GET    /api/auth/verify-email?token=xxx   邮箱激活（返回 HTML 成功/失败页）
POST   /api/auth/resend-verification      已登录未验证用户重发验证邮件（限频）
POST   /api/auth/logout                            登出
GET    /api/auth/me                                当前登录用户信息（含 email、email_verified）
```

注册限制：用户名 3-32 位 `^[a-zA-Z0-9_]+$`，密码 ≥8 位，邮箱需合法且未被已验证用户占用，按 IP 限频。
登录失败超过阈值后封禁该 IP+用户名组合（内存 Map，进程级，重启清空）。

### 账户（登录态）

```
POST /api/account/password          {oldPassword, newPassword}   改自己密码
POST /api/account/regenerate-token                              重置自己的 API token（旧 token 立即失效）
POST /api/account/email              {newEmail}                 修改邮箱（改后需重新验证，需 MAIL_ENABLED）
```

### 上传（API token）

```
POST /upload
POST /api/upload
POST /api/v1/upload
```

请求头 `Authorization: Bearer <API_TOKEN>`，表单字段名 `file` 或 `image`。响应默认 JSON：

```json
{
  "url": "http://img.example.com/i/images/1d/xxx.png",
  "markdown": "![](...)",
  "html": "<img src=\"...\" />",
  "bbcode": "[img]...[/img]",
  "id": 1, "hash": "...", "size": 12345, "mime": "image/png",
  "width": 1920, "height": 1080, "duplicated": false
}
```

纯文本模式（ShareX / curl）：带 `?format=text` 或 `Accept: text/plain`，只返回 URL。

curl 示例：

```bash
curl -X POST -H "Authorization: Bearer <API_TOKEN>" -F "file=@photo.png" http://img.example.com/upload
```

### 图片访问

```
GET /i/:key   公开，从 R2 流式返回，带长缓存 + nosniff + Content-Disposition: inline
```

### 图片管理（登录态）

```
GET    /api/images?page=&size=             我的图片（管理员 ?all=1 看全部，?user_id= 看指定）
GET    /api/images/:id                      详情（本人/管理员）
DELETE /api/images/:id                      删除（本人删自己的，管理员删任意，同步删 R2）
```

### 用户管理（管理员）

```
GET    /api/admin/users                     用户列表（含邮箱、验证状态、上传数量）
POST   /api/admin/users                     {username, password, role, email} 建用户
DELETE /api/admin/users/:id                 删用户（其图片转无主，不连带删除；清理验证记录）
POST   /api/admin/users/:id/reset-token     重置某用户 API token
POST   /api/admin/users/:id/password        {newPassword} 改某用户密码
POST   /api/admin/users/:id/verify           手动标记用户邮箱已验证（应急）
```

## 客户端配置

### PicGo

自定义图床，API 地址 `http://img.example.com/upload`，POST 参数名 `file`，JSON 路径 `url`，请求头 `Authorization: Bearer <你的API_TOKEN>`。

### ShareX

```
请求类型: POST
URL: http://img.example.com/upload
表单字段名: file
请求头: Authorization: Bearer <你的API_TOKEN>
响应类型: 文本（或 JSON + $json:url$）
```

## 测试

构建后可运行多用户全流程集成测试（需本机 MySQL，会自动建表/建管理员/清理）：

```bash
npm run build
node scripts/test-upload-flow.js
```

覆盖：登录/注册/邮箱验证/校验、API token 上传、真实类型嗅探、去重、权限隔离、管理员删除/用户管理/手动验证、改密码、未验证上传拦截、Turnstile 端点、登录失败封禁等 19 项。

## 安全说明

- 上传用 magic bytes（file-type）做真实类型嗅探，仅允许 jpg/png/gif/webp/bmp，伪造 Content-Type 无法绕过
- 已移除 SVG 上传，杜绝内联 SVG 的同源 XSS
- 图片响应带 `X-Content-Type-Options: nosniff` 和 `Content-Disposition: inline`
- API token 用 `timingSafeEqual` 比较，防时序攻击
- session cookie 为 httpOnly + sameSite=lax，生产可开 secure
- 上传/删除 token 不再出现在 URL query 中，避免泄露到日志/Referer
- 密码 bcrypt 哈希存储
- **分层限流**：全局（防扫描）/ 上传按 IP + 按用户 / 图片访问 / 注册 / 登录，各维度独立计数
- **登录失败封禁**：连续失败超阈值封禁该 IP+用户名组合，防撞库
- **上传并发控制**：限制同时处理的上传请求数，超出返 503，避免大并发打爆内存与 R2
- **helmet 安全头**：防点击劫持（X-Frame-Options DENY）、类型嗅探、referrer 策略
- **错误响应不缓存**：4xx/5xx 设 `Cache-Control: no-store`，防错误页被 CDN 缓存
- **Turnstile 人机验证**：注册防机器人批量注册
- **邮箱验证激活**：未验证用户不能上传，防滥用

## License

MIT
