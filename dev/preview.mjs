// 本地预览：不启动 DSH 也能调界面。用的是同一套接口代码和真实配置（~/.dsh/bili-eyes.json）。
// 注意：「这一小时」的用量只统计本进程；试看会真的去看视频。
// 用法：node dev/preview.mjs [--port 3396]  →  http://127.0.0.1:3396
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApiHandler, API_ROUTE } from '../src/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--port');
const port = (i > 0 && Number(process.argv[i + 1])) || 3396;
const api = makeApiHandler({ registered: () => true });

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === API_ROUTE) return api(req, res);
  if (pathname === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(fs.readFileSync(path.join(HERE, '..', 'src', 'client.js')));
  }
  if (pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(fs.readFileSync(path.join(HERE, 'preview.html')));
  }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => console.log(`B站伙伴 设置页预览：http://127.0.0.1:${port}`));
