// 把非 TS 静态资源复制到 dist，供运行时读取
const fs = require('fs');
const path = require('path');

const pairs = [['src/views/index.html', 'dist/views/index.html']];

for (const [src, dest] of pairs) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[assets] ${src} -> ${dest}`);
}
