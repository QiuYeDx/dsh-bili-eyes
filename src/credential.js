// B站登录（扫码）：登录信息存在 $DSH_HOME/bili-eyes/credential.json，并导出一份 cookies.txt 给 yt-dlp。
// 只用于只读接口（AI 字幕、AI 总结、高画质）。请用 B站小号登录。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { UA } from './bili-api.js';

export const CREDENTIAL_FILE = path.join(DATA_DIR, 'credential.json');
export const COOKIES_TXT = path.join(DATA_DIR, 'cookies.txt');
const KEEP = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

export function loadCredential(file = CREDENTIAL_FILE) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return c?.cookies?.SESSDATA ? c : null;
  } catch { return null; }
}

export function saveCredential(cred, file = CREDENTIAL_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cred, null, 1), { mode: 0o600 });
  writeCookiesTxt(cred, COOKIES_TXT);
}

export function removeCredential() {
  for (const f of [CREDENTIAL_FILE, COOKIES_TXT]) fs.rmSync(f, { force: true });
}

/** Netscape cookies.txt（yt-dlp 读这个拿 1080P）。 */
export function writeCookiesTxt(cred, file = COOKIES_TXT) {
  const expires = Math.floor(Date.now() / 1000) + 180 * 86400;
  const lines = ['# Netscape HTTP Cookie File', '# 由 dsh-bili-eyes 生成，勿外传'];
  for (const [k, v] of Object.entries(cred.cookies)) {
    if (v) lines.push(['.bilibili.com', 'TRUE', '/', 'TRUE', String(expires), k, v].join('\t'));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
}

// ── 扫码登录（B站网页端二维码接口）────────────────────────────────────────
const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode';

export async function qrGenerate(fetchImpl = fetch) {
  const r = await fetchImpl(`${PASSPORT}/generate`, { headers: { 'user-agent': UA } });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`生成二维码失败：${j.message}`);
  return { url: j.data.url, key: j.data.qrcode_key };
}

/** 轮询一次。返回 {state:'waiting'|'scanned'|'expired'|'ok', cookies?, refreshToken?} */
export async function qrPoll(key, fetchImpl = fetch) {
  const r = await fetchImpl(`${PASSPORT}/poll?qrcode_key=${encodeURIComponent(key)}`, { headers: { 'user-agent': UA } });
  const j = await r.json();
  const code = j.data?.code;
  if (code === 86101) return { state: 'waiting' };
  if (code === 86090) return { state: 'scanned' };
  if (code === 86038) return { state: 'expired' };
  if (code !== 0) throw new Error(`扫码登录出错：${j.data?.message ?? j.message ?? code}`);
  const cookies = {};
  for (const sc of r.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    if (KEEP.includes(name)) cookies[name] = pair.slice(i + 1).trim();
  }
  // 兜底：成功时 data.url 的查询串里也带着这几个值
  if (!cookies.SESSDATA && j.data?.url) {
    const u = new URL(j.data.url);
    for (const k of KEEP) if (u.searchParams.get(k)) cookies[k] = u.searchParams.get(k);
  }
  if (!cookies.SESSDATA) throw new Error('扫码成功但没拿到登录信息');
  return { state: 'ok', cookies, refreshToken: j.data?.refresh_token ?? '' };
}
