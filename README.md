# 烧饼图床 (sbimg)

对接 Cloudflare R2 存储的自托管图床，支持多用户。后端跑在你自己的服务器上，图片存到 R2，用户与图片元数据存到 MySQL。

## 特性

- **多用户后台**：管理员 + 普通用户两级权限，服务端 session，开放注册（可关）
- **安全上传**：magic bytes 真实类型嗅探，伪造类型无法绕过；已移除 SVG 杜绝同源 XSS
- 拖拽 / 点击 / 剪贴板粘贴上传，多文件批量
- 哈希去重：相同图片只存一份，重复上传直接返回已有链接
- URL / Markdown / HTML / BBCode 多格式链接一键复制
- 图片按用户归属，普通用户只能看/删自己的，管理员可管全部
- 用户 API token 上传（兼容 PicGo / ShareX / curl），图片公开访问
- 单文件大小 + 每 IP 上传频率限制，注册频率限制
- 启动自动建表 + 自动建初始管理员，无需手动迁移

## 技术栈

Node.js + Express + TypeScript，MySQL（用户/元数据/session），Cloudflare R2（图片存储，S3 兼容 SDK）。
密码 bcrypt 哈希，session 存 MySQL（express-session + express-mysql-session）。

## 目录结构

```
sbimg/
├── src/
│   ├── index.ts            # 入口
│   ├── config.ts           # 环境变量 + zod 校验
│   ├── db/                 # 连接池 / 建表迁移（幂等加列）
│   ├── r2/client.ts        # R2 (S3) 封装
│   ├── middleware/         # session 鉴权 / API token / 频率限制 / 错误处理
│   ├── services/           # auth(注册登录) / users(用户CRUD) / hash / upload / images
│   ├── routes/             # auth / account / admin / upload / images / view / page
│   ├── types/              # 第三方模块类型声明
│   └── views/index.html   # 管理页面（登录/控制台/管理）
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

### 1. 获取 R2 凭据

1. Cloudflare 控制台 → R2 → 创建一个 bucket（如 `sbimg`）
2. R2 → 管理 R2 API 令牌 → 创建 API 令牌，权限选「对象读和写」
3. 记下 `Account ID`、`Access Key ID`、`Secret Access Key`

### 2. 准备 MySQL

```sql
CREATE DATABASE sbimg CHARACTER SET utf8mb4;
CREATE USER 'sbimg'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON sbimg.* TO 'sbimg'@'localhost';
FLUSH PRIVILEGES;
```

表会在服务启动时自动创建，无需手动建表。

### 3. 安装与配置

```bash
git clone <repo> sbimg
cd sbimg
npm install
cp .env.example .env
```

编辑 `.env`：

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，默认 3000 |
| `BASE_URL` | 对外访问域名（用于生成链接，不要带末尾斜杠） |
| `MAX_SIZE_MB` | 单文件大小上限（MB），默认 20 |
| `RATE_LIMIT_PER_MIN` | 每 IP 每分钟上传次数上限，默认 30 |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | R2 凭据 |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | MySQL 连接信息 |
| `SESSION_SECRET` | session 加密密钥，至少 16 字符，请改成长随机串 |
| `TRUST_PROXY` | 信任的反代跳数：直连 0，一层反代 1，Cloudflare+nginx 2 |
| `COOKIE_SECURE` | 生产 HTTPS 设 true，cookie 才带 secure |
| `INIT_ADMIN_USER` `INIT_ADMIN_PASS` | 初始管理员账号；密码留空则启动随机生成并打印到控制台 |
| `ALLOW_REGISTER` | 是否开放注册，true/false |
| `REGISTER_LIMIT_PER_10MIN` | 每 IP 每 10 分钟注册次数上限 |

### 4. 构建与运行

```bash
npm run build
npm start
```

开发模式（热重载）：

```bash
npm run dev
```

首次启动若 `users` 表为空，会自动创建初始管理员。若 `INIT_ADMIN_PASS` 留空，随机密码会打印到控制台，**请登录后立即改密码**。

### 5. 守护进程（PM2）

```bash
npm install -g pm2
pm2 start dist/index.js --name sbimg
pm2 save && pm2 startup
```

### 6. Nginx 反代（可选）

```nginx
server {
    listen 80;
    server_name img.example.com;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

记得设 `TRUST_PROXY=1`（单层反代）使频率限制取真实 IP。生产 HTTPS 下设 `COOKIE_SECURE=true`。

## 认证模型

- **管理后台**：浏览器登录，httpOnly cookie session（7 天）。登录态用于页面操作和图片管理 API。
- **外部上传**：用各用户的 API Token，放在请求头 `Authorization: Bearer <token>`。Token 在后台「账户」页查看/重置。
- **图片访问**：`GET /i/*` 公开，无需鉴权。

权限：普通用户只能看/删自己上传的图；管理员可看全部、删任意、管理用户。

## API

### 鉴权（session）

```
POST   /api/auth/login     {username, password}   登录，建 session
POST   /api/auth/register  {username, password}   注册并自动登录（受 ALLOW_REGISTER 开关）
POST   /api/auth/logout                            登出
GET    /api/auth/me                                当前登录用户信息
```

注册限制：用户名 3-32 位 `^[a-zA-Z0-9_]+$`，密码 ≥8 位，按 IP 限频。

### 账户（登录态）

```
POST /api/account/password          {oldPassword, newPassword}   改自己密码
POST /api/account/regenerate-token                              重置自己的 API token（旧 token 立即失效）
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
GET    /api/admin/users                     用户列表（含上传数量）
POST   /api/admin/users                     {username, password, role} 建用户
DELETE /api/admin/users/:id                 删用户（其图片转无主，不连带删除）
POST   /api/admin/users/:id/reset-token     重置某用户 API token
POST   /api/admin/users/:id/password        {newPassword} 改某用户密码
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

覆盖：登录/注册/校验、API token 上传、真实类型嗅探、去重、权限隔离、管理员删除/用户管理、改密码等 13 项。

## 安全说明

- 上传用 magic bytes（file-type）做真实类型嗅探，仅允许 jpg/png/gif/webp/bmp，伪造 Content-Type 无法绕过
- 已移除 SVG 上传，杜绝内联 SVG 的同源 XSS
- 图片响应带 `X-Content-Type-Options: nosniff` 和 `Content-Disposition: inline`
- API token 用 `timingSafeEqual` 比较，防时序攻击
- session cookie 为 httpOnly + sameSite=lax，生产可开 secure
- 上传/删除 token 不再出现在 URL query 中，避免泄露到日志/Referer
- 密码 bcrypt 哈希存储
- 单文件大小限制 + 按 IP 频率限制

## License

MIT
