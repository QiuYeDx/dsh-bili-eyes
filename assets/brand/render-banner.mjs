// 把 assets/brand/banner.html 渲染成 README 顶部的横幅 assets/banner.webp（2 倍图，圆角外透明）。
// 用 WebP（质量 95）：和 PNG 看不出差别，体积约 1/7；PNG 压成 256 色会让渐变出色带。
// 图标从 assets/icon.svg 嵌进去，改了图标或横幅文字后重跑一次就行：
//   node assets/brand/render-banner.mjs
// 用无界面的 Chrome（新 headless 模式，不弹窗口）和一个用完就删的临时配置目录，不碰你自己的 Chrome。
// Chrome 不在默认位置时用环境变量 CHROME 指定。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.dirname(HERE);
const OUT = path.join(ASSETS, 'banner.webp');
const W = 1280; const H = 400; const SCALE = 2;

const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!chrome) { console.error('找不到 Chrome，用环境变量 CHROME 指定路径'); process.exit(1); }

// 图标嵌进模板，写一个临时页面
const page = path.join(os.tmpdir(), `bili-eyes-banner-${process.pid}.html`);
const html = fs.readFileSync(path.join(HERE, 'banner.html'), 'utf8')
  .replace('<!-- ICON -->', fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8'));
fs.writeFileSync(page, html);

const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-banner-chrome-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill();
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']); } }
  fs.rmSync(page, { force: true });
};

try {
  let targets;
  for (let i = 0; i < 100 && !targets; i += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
  }
  const target = targets?.find((t) => t.type === 'page');
  if (!target) throw new Error('Chrome 没起来');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });   // 圆角外透明
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await sleep(1500);
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
  const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 95, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  ws.close();
  console.log(`已生成 ${path.relative(process.cwd(), OUT)}（${W * SCALE}×${H * SCALE}，${Math.round(fs.statSync(OUT).size / 1024)} KB）`);
} catch (e) {
  console.error('生成失败：', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
