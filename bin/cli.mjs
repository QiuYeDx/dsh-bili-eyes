#!/usr/bin/env node
// dsh-bili-eyes 命令行：
//   login            扫码登录 B站（请用小号），登录信息存在 $DSH_HOME/bili-eyes/
//   status           看登录状态与配置
//   logout           删除登录信息
//   look <链接> [--from 秒] [--to 秒] [--out 目录]   不经过 DSH 跑一次，分镜图存成 PNG
//   zoom <链接> --from 秒 --to 秒 [--cells n] [--out 目录]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { BiliClient } from '../src/bili-api.js';
import { loadConfig, CONFIG_FILE, DATA_DIR } from '../src/config.js';
import { loadCredential, saveCredential, removeCredential, qrGenerate, qrPoll, CREDENTIAL_FILE } from '../src/credential.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

async function login() {
  const { url, key } = await qrGenerate();
  console.log('用 B站 App（建议小号）扫下面的二维码并确认登录：\n');
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  const png = path.join(DATA_DIR, 'login-qr.png');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  await QRCode.toFile(png, url, { width: 360, margin: 2 });
  console.log(`终端里的二维码扫不了的话，打开图片：${png}`);
  if (process.platform === 'win32' && !process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', png], { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 170_000;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await qrPoll(key);
    if (r.state !== last) {
      if (r.state === 'scanned') console.log('已扫码，请在手机上点「确认登录」…');
      last = r.state;
    }
    if (r.state === 'expired') throw new Error('二维码过期了，重新运行 login');
    if (r.state === 'ok') {
      const nav = await new BiliClient({ cookies: r.cookies }).nav();
      saveCredential({ cookies: r.cookies, refreshToken: r.refreshToken, uname: nav.uname ?? '', mid: nav.mid ?? 0, savedAt: new Date().toISOString() });
      fs.rmSync(png, { force: true });
      console.log(`登录成功：${nav.uname ?? '(未知昵称)'}。登录信息：${CREDENTIAL_FILE}（相当于账号密码，别外传）`);
      return;
    }
  }
  throw new Error('等太久了，重新运行 login');
}

async function status() {
  const cfg = loadConfig();
  const cred = loadCredential();
  let state = '未登录';
  if (cred) {
    const nav = await new BiliClient({ cookies: cred.cookies }).nav().catch(() => ({}));
    state = nav.isLogin ? `已登录：${nav.uname}（${cred.savedAt?.slice(0, 10)} 扫码）` : '登录已过期，请重新运行 login';
  }
  const out = { login: state, config: fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : `${CONFIG_FILE}（不存在，用默认值）`, settings: cfg };
  console.log(process.argv.includes('--json') ? JSON.stringify(out) : `B站：${state}\n配置：${out.config}\n${JSON.stringify(cfg, null, 1)}`);
  if (!cred || !state.startsWith('已登录')) process.exitCode = 2;
}

async function runLook(kind) {
  const { look, lookZoom } = await import('../src/look.js');
  const url = positional[0];
  const args = { url };
  if (opt('from') != null) args.from = Number(opt('from'));
  if (opt('to') != null) args.to = Number(opt('to'));
  if (opt('cells') != null) args.cells = Number(opt('cells'));
  if (opt('detail')) args.detail = opt('detail');
  const t = Date.now();
  const r = kind === 'zoom' ? await lookZoom(args, { log: (m) => console.error(m) }) : await look(args, { log: (m) => console.error(m) });
  const outDir = opt('out') || '.';
  fs.mkdirSync(outDir, { recursive: true });
  r.pngs.forEach((buf, i) => {
    const f = path.join(outDir, `bili-${kind}-${i + 1}.png`);
    fs.writeFileSync(f, buf);
    console.error(`分镜图：${f}`);
  });
  console.log(r.text);
  console.error(`\n用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒${r.cached ? '（缓存）' : ''}，文字 ${r.text.length} 字`);
}

try {
  if (cmd === 'login') await login();
  else if (cmd === 'status') await status();
  else if (cmd === 'logout') { removeCredential(); console.log('已删除登录信息'); }
  else if (cmd === 'look' || cmd === 'zoom') await runLook(cmd);
  else { console.log('用法：dsh-bili-eyes login | status [--json] | logout | look <链接> [--from s --to s --detail low|med --out dir] | zoom <链接> --from s --to s [--cells n]'); process.exitCode = 1; }
} catch (e) {
  console.error(`出错：${e.message}`);
  process.exitCode = 1;
}
