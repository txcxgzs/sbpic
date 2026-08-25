# 烧饼图床 (sbimg)

对接 Cloudflare R2 存储的自托管图床。后端跑在你自己的服务器上，图片存到 R2，元数据存到本地 MySQL。

## 特性

- 拖拽 / 点击 / 剪贴板粘贴上传，多文件批量
- 哈希去重：相同图片只存一份，重复上传直接返回已有链接
- 多格式链接一键复制：URL / Markdown / HTML / BBCode
- 图片列表分页查看、删除（同步删除 R2 对象）
- 通用 JSON API，兼容 PicGo、ShareX、curl 等客户端
- 单一管理 Token 鉴权，写操作受保护
- 单文件大小 + 每 IP 上传频率限制
- 启动自动建表，无需手动迁移

## 技术栈

Node.js + Express + TypeScript，MySQL（元数据），Cloudflare R2（图片存储，S3 兼容 SDK）。

## 目录结构

```
sbimg/
├── src/
│   ├── index.ts            # 入口
│   ├── config.ts           # 环境变量 + zod 校验
│   ├── db/                 # 连接池 / 建表迁移
│   ├── r2/client.ts        # R2 (S3) 封装
│   ├── middleware/         # auth / 频率限制 / 错误处理
│   ├── services/           # 哈希 / 上传业务 / 图片管理
│   ├── routes/             # 上传 / 图片代理 / 管理 API / 页面
│   └── views/index.html    # 管理页面
├── scripts/
│   ├── copy-assets.js      # 构建后复制静态资源
│   └── test-upload-flow.js # 上传链路集成测试
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
git clone https://github.com/txcxgzs/spic.git sbimg
cd sbimg
npm install
cp .env.example .env
```

编辑 `.env`，按需填写：

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，默认 3000 |
| `BASE_URL` | 对外访问域名（用于生成链接，不要带末尾斜杠） |
| `ADMIN_TOKEN` | 管理 Token，上传/删除/管理 API 鉴权用，请改成长随机串 |
| `MAX_SIZE_MB` | 单文件大小上限（MB），默认 20 |
| `RATE_LIMIT_PER_MIN` | 每 IP 每分钟上传次数上限，默认 30 |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key |
| `R2_BUCKET` | R2 桶名 |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | MySQL 连接信息 |

### 4. 构建与运行

```bash
npm run build
npm start          # 生产运行：node dist/index.js
```

开发模式（热重载）：

```bash
npm run dev
```

### 5. 守护进程（推荐 PM2）

```bash
npm install -g pm2
pm2 start dist/index.js --name sbimg
pm2 save
pm2 startup
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

图片访问默认走服务器代理 R2（带宽走服务器）。如需省带宽，可改用 R2 公开直链：在 R2 桶开启公开访问并绑定自定义域名，然后修改 `BASE_URL` 为 R2 公开域名即可（view 路由仍可保留作兼容）。

## API

所有写操作需在请求头 `Authorization: Bearer <ADMIN_TOKEN>`、query `?token=` 或表单字段 `token` 中携带 Token。图片访问（`GET /i/*`）与管理页面无需 Token。

### 上传图片

```
POST /upload
POST /api/upload
POST /api/v1/upload
```

表单字段名 `file` 或 `image` 均可。响应默认 JSON：

```json
{
  "url": "http://img.example.com/i/images/1d/xxx.png",
  "markdown": "![](http://img.example.com/i/images/1d/xxx.png)",
  "html": "<img src=\"http://img.example.com/i/images/1d/xxx.png\" />",
  "bbcode": "[img]http://img.example.com/i/images/1d/xxx.png[/img]",
  "delete_url": "http://img.example.com/api/images/1?token=...",
  "id": 1,
  "hash": "...",
  "size": 12345,
  "mime": "image/png",
  "width": 1920,
  "height": 1080,
  "duplicated": false
}
```

- 想要纯文本响应（兼容 ShareX 纯文本模式 / curl）：带 `?format=text` 或请求头 `Accept: text/plain`，将只返回 URL 文本。
- PicGo / ShareX 等客户端用 JSON 中的 `url` 字段（`$json:url$`）即可。

curl 示例：

```bash
curl -X POST -H "Authorization: Bearer <TOKEN>" -F "file=@photo.png" http://img.example.com/upload
```

### 访问图片

```
GET /i/:key
```

从 R2 流式返回图片，带长缓存头。

### 图片列表 / 详情 / 删除

```
GET  /api/images?page=1&size=30&token=<TOKEN>   # 分页列表
GET  /api/images/:id?token=<TOKEN>              # 单条详情
DELETE /api/images/:id?token=<TOKEN>            # 删除（同步删 R2 对象）
```

## 客户端配置

### PicGo

- 图床设为自定义图床，API 地址 `http://img.example.com/upload`，POST 参数名 `file`，JSON 路径 `url`，请求头 `Authorization: Bearer <TOKEN>`。

### ShareX

自定义上传：

```
请求类型: POST
URL: http://img.example.com/upload
表单字段名: file
请求头: Authorization: Bearer <TOKEN>
响应类型: 文本（或 JSON + $json:url$）
```

## 测试

构建后可运行上传链路集成测试（需本机 MySQL，会用 `sbimg` 库并自动清理）：

```bash
npm run build
node scripts/test-upload-flow.js
```

## 安全说明

- 上传 MIME 白名单：jpg / png / gif / webp / bmp / svg
- 单文件大小限制 + 按 IP 频率限制
- Token 使用 `crypto.timingSafeEqual` 比较，防时序攻击
- 文件名仅取扩展名，对象 key 以哈希为准，避免路径注入

## License

MIT
