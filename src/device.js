// 设备标识：浏览器访问 B站时总会带 buvid3 / buvid4 / b_nut / _uuid，登录后还有 bili_ticket。
// 扫码登录只拿到账号 cookie（SESSDATA 等），以前写操作只带这几个，像一个「没有设备的客户端」，
// 评论容易被风控设成「仅自己可见」。这里生成一套固定的设备标识存起来（$DSH_HOME/bili-eyes/device.json），
// 之后每次都带同一套；bili_ticket 有效期 3 天，剩不到 1 天就换新的。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const DEVICE_FILE = path.join(DATA_DIR, 'device.json');
const DEVICE_KEYS = ['buvid3', 'buvid4', 'b_nut', '_uuid', 'bili_ticket', 'bili_ticket_expires'];

export function loadDevice(file = DEVICE_FILE) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Object.fromEntries(DEVICE_KEYS.filter((k) => d[k]).map((k) => [k, String(d[k])])); }
  catch { return {}; }
}
function saveDevice(d, file = DEVICE_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
    fs.renameSync(tmp, file);
  } catch { /* 存不下来下次再生成，不影响这次请求 */ }
}

/** 网页端 _uuid 的格式：大写 UUID + 时间戳后 5 位 + "infoc" */
export function makeUuid(now = Date.now()) {
  return `${crypto.randomUUID().toUpperCase()}${String(now % 100000).padStart(5, '0')}infoc`;
}

/** bili_ticket 的签名：HMAC-SHA256(key="XgwSnGZ1p", "ts" + 秒级时间戳)（见 bilibili-API-collect） */
export function ticketSign(ts) {
  return crypto.createHmac('sha256', 'XgwSnGZ1p').update(`ts${ts}`).digest('hex');
}

/** 带上设备 cookie 的 cookies 副本（不改原对象）。 */
export function withDevice(cookies, device = loadDevice()) {
  const out = { ...cookies };
  for (const k of ['buvid3', 'buvid4', 'b_nut', '_uuid', 'bili_ticket']) if (device[k] && !out[k]) out[k] = device[k];
  return out;
}

/**
 * 补齐设备标识并写进 client.cookies：缺 buvid 就去要一个，缺 _uuid / b_nut 就生成，
 * 登录了且 bili_ticket 快过期就换新的。都是尽力而为，失败不影响后面的请求。
 */
export async function ensureDevice(client, { file = DEVICE_FILE, now = Date.now() } = {}) {
  const d = loadDevice(file);
  let changed = false;
  if (!d.buvid3 || !d.buvid4) {
    try {
      const r = await client.request('https://api.bilibili.com/x/frontend/finger/spi');
      if (r?.b_3) { d.buvid3 = r.b_3; d.buvid4 = r.b_4 ?? ''; changed = true; }
    } catch { /* 拿不到就先不带 */ }
  }
  if (!d.b_nut) { d.b_nut = String(Math.floor(now / 1000)); changed = true; }
  if (!d._uuid) { d._uuid = makeUuid(now); changed = true; }
  const csrf = client.cookies?.bili_jct;
  if (csrf && (!d.bili_ticket || Number(d.bili_ticket_expires || 0) * 1000 - now < 86400_000)) {
    try {
      const ts = Math.floor(now / 1000);
      const r = await client.request(`https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket?key_id=ec02&hexsign=${ticketSign(ts)}&context%5Bts%5D=${ts}&csrf=${csrf}`, { method: 'POST', form: {} });
      if (r?.ticket) { d.bili_ticket = r.ticket; d.bili_ticket_expires = String(Number(r.created_at || ts) + Number(r.ttl || 259200)); changed = true; }
    } catch { /* 拿不到 ticket 也能发，只是更像机器 */ }
  }
  if (changed) saveDevice(d, file);
  client.cookies = withDevice(client.cookies, d);
  return d;
}
