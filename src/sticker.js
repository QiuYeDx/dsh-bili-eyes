// 表情包图片：主人在设置页上传的图，评论时可以带一张（bili_comment 的 sticker 参数）。见 docs/评论表情-设计.md「第二层」
//
// 图放在 DATA_DIR/stickers/，清单在 stickers.json。真正发出去时才上传到 B站图床（起草时不传），
// 按 sha256 记住传过的地址，同一张图只传一次。带图的评论被设成「仅自己可见」时，表情包自动停用 24 小时。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const STICKER_FILE = path.join(DATA_DIR, 'stickers.json');
export const STICKER_DIR = path.join(DATA_DIR, 'stickers');
export const MAX_STICKERS = 30;
export const MAX_BYTES = 2 * 1024 * 1024;
export const HIDDEN_PAUSE_MS = 24 * 3600_000;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export class StickerError extends Error {}

// ── 存储 ──────────────────────────────────────────────────────────────────
/** {list:[{id, name, when, file, type, width, height, bytes, sha, url, uploaded:{url,width,height,size}|null, at}], next, pausedUntil, pauseReason} */
export function loadStickers(file = STICKER_FILE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { list: Array.isArray(s.list) ? s.list : [], next: Number(s.next) || 1, pausedUntil: Number(s.pausedUntil) || 0, pauseReason: String(s.pauseReason ?? '') };
  } catch { return { list: [], next: 1, pausedUntil: 0, pauseReason: '' }; }
}
export function saveStickers(st, file = STICKER_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 1));
  fs.renameSync(tmp, file);
}

/** 图片的类型和宽高（只认 png / jpeg / gif / webp）。认不出返回 null。 */
export function imageInfo(buf) {
  const b = Buffer.from(buf);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { type: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { type: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { type: 'image/webp', width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { type: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'image/jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  return null;
}

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function checkMeta(st, { name, when }, selfId = null) {
  const n = cleanName(name); const w = cleanName(when);
  if (!n) throw new StickerError('要起个名字');
  if (n.length > 8) throw new StickerError('名字最多 8 个字');
  if (/[[\]【】]/.test(n)) throw new StickerError('名字里不能有方括号');
  if (w.length > 30) throw new StickerError('「什么时候用」最多 30 个字');
  if (st.list.some((x) => x.name === n && x.id !== selfId)) throw new StickerError(`已经有叫「${n}」的表情包了`);
  return { name: n, when: w };
}

/** 加一张。data 是图片的 base64（或 Buffer）。 */
export function addSticker({ name, when, data }, { file = STICKER_FILE, dir = STICKER_DIR, now = Date.now() } = {}) {
  const st = loadStickers(file);
  if (st.list.length >= MAX_STICKERS) throw new StickerError(`最多 ${MAX_STICKERS} 张`);
  const meta = checkMeta(st, { name, when });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new StickerError('图片是空的');
  if (buf.length > MAX_BYTES) throw new StickerError(`图片最大 2 MB（这张 ${(buf.length / 1048576).toFixed(1)} MB）`);
  const info = imageInfo(buf);
  if (!info || !TYPES[info.type]) throw new StickerError('只支持 png、jpg、gif、webp');
  if (!info.width || !info.height) throw new StickerError('读不出图片的尺寸');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (st.list.some((x) => x.sha === sha)) throw new StickerError(`这张图已经加过了（「${st.list.find((x) => x.sha === sha).name}」）`);
  const id = st.next;
  const fileName = `${id}-${sha.slice(0, 10)}.${TYPES[info.type]}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
  const item = { id, ...meta, file: fileName, type: info.type, width: info.width, height: info.height, bytes: buf.length, sha, uploaded: null, at: now };
  st.list.push(item);
  st.next = id + 1;
  saveStickers(st, file);
  return item;
}

export function updateSticker(id, patch, { file = STICKER_FILE } = {}) {
  const st = loadStickers(file);
  const item = st.list.find((x) => x.id === Number(id));
  if (!item) throw new StickerError('没有这张表情包');
  Object.assign(item, checkMeta(st, { name: patch.name ?? item.name, when: patch.when ?? item.when }, item.id));
  saveStickers(st, file);
  return item;
}

export function removeSticker(id, { file = STICKER_FILE, dir = STICKER_DIR } = {}) {
  const st = loadStickers(file);
  const item = st.list.find((x) => x.id === Number(id));
  if (!item) throw new StickerError('没有这张表情包');
  st.list = st.list.filter((x) => x !== item);
  saveStickers(st, file);
  try { fs.rmSync(path.join(dir, item.file), { force: true }); } catch { /* 删不掉就留着 */ }
}

export function stickerBytes(item, { dir = STICKER_DIR } = {}) {
  return fs.readFileSync(path.join(dir, path.basename(item.file)));
}

/** 主人手动恢复（或者到时间了）。 */
export function resumeStickers({ file = STICKER_FILE } = {}) {
  const st = loadStickers(file);
  st.pausedUntil = 0; st.pauseReason = '';
  saveStickers(st, file);
}
export function pauseStickers(reason, { file = STICKER_FILE, now = Date.now(), ms = HIDDEN_PAUSE_MS } = {}) {
  const st = loadStickers(file);
  st.pausedUntil = now + ms; st.pauseReason = reason;
  saveStickers(st, file);
}

// ── 用 ────────────────────────────────────────────────────────────────────
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** 今天发出去的带表情包的评论（含被隐藏的）。 */
export function stickersToday(entries, now = Date.now()) {
  const today = dayOf(now);
  return entries.filter((e) => (e.status === 'ok' || e.status === 'hidden') && e.target?.sticker && dayOf(e.at) === today).length;
}

/**
 * 她要带的表情包能不能带。返回 {sticker:{id, name}|null, note}：不能带时 sticker 为 null，note 说为什么（文字照常发）。
 */
export function pickSticker(name, cfg, { kind = 'comment', entries = [], file = STICKER_FILE, now = Date.now() } = {}) {
  const n = cleanName(name);
  if (!n) return { sticker: null, note: '' };
  if (!cfg.stickerOn) return { sticker: null, note: '（表情包没带上：主人没开表情包，只发了文字）' };
  // B站：楼中楼不能带图（实测返回 -400「子评论不能带图」）
  if (kind !== 'comment') return { sticker: null, note: '（表情包没带上：B站 回复别人（楼中楼）不能带图，只有顶层评论能带；只发了文字）' };
  const st = loadStickers(file);
  if (st.pausedUntil > now) return { sticker: null, note: `（表情包没带上：${st.pauseReason || '暂停中'}，表情包停用到 ${new Date(st.pausedUntil).toLocaleString()}；只发了文字）` };
  const item = st.list.find((x) => x.name === n);
  if (!item) return { sticker: null, note: `（没有叫「${n}」的表情包，只发了文字。能用的：${st.list.map((x) => x.name).join('、') || '没有'}）` };
  const used = stickersToday(entries, now);
  if (used >= cfg.stickerPerDay) return { sticker: null, note: `（表情包今天的额度用完了（${used}/${cfg.stickerPerDay}），只发了文字）` };
  return { sticker: { id: item.id, name: item.name }, note: '' };
}

/** 发评论前：拿到这张图在 B站图床的地址（传过就用记下的，没传过现在传）。 */
export async function uploadedSticker(client, ref, { file = STICKER_FILE, dir = STICKER_DIR } = {}) {
  const st = loadStickers(file);
  const item = st.list.find((x) => x.id === Number(ref?.id));
  if (!item) throw new StickerError(`表情包「${ref?.name ?? ''}」已经被删了`);
  if (item.uploaded?.url) return item.uploaded;
  const up = await client.uploadImage(stickerBytes(item, { dir }), { name: item.file, type: item.type });
  item.uploaded = { url: up.url, width: up.width || item.width, height: up.height || item.height, size: up.size };
  saveStickers(st, file);
  return item.uploaded;
}

/** 给她看的说明：能用的表情包（名字 + 什么时候用）。没开或没有就返回空串。 */
export function stickerGuide(cfg, list = loadStickers().list) {
  if (!cfg.stickerOn || !list.length) return '';
  return [
    `表情包（偶尔用；只能用在顶层评论，回复别人时 B站 不让带图；一条最多一张，每天最多 ${cfg.stickerPerDay} 条；sticker 填名字）：`,
    ...list.map((x) => `  ${x.name}${x.when ? ` —— ${x.when}` : ''}`),
  ].join('\n');
}
