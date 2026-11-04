// 评论里的表情：B站自带的表情代码（[doge]、[热词系列_再给一集]、颜文字）。见 docs/评论表情-设计.md
//
// 表情面板（账号里有哪些系列）缓存在 emotes.json：设置页点「刷新」时拉，平时每天自动拉一次。
// 主人在设置页开关系列（emotePkgs）、标「常用」（emotePicks）。常用的写进她的工具说明；
// 发之前 tidyEmotes 按「当前」设置清理正文：不在已启用系列里的代码去掉、超过上限的去掉。
// 工具说明是插件加载时生成的：设置改了要重启 DSH 才更新（loadedSig / emoteStale）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const EMOTE_FILE = path.join(DATA_DIR, 'emotes.json');
export const EMOTE_IMG_DIR = path.join(DATA_DIR, 'emote-img');
const REFRESH_MS = 24 * 3600_000;
// 方括号里像表情代码的：不含空白和方括号，1~24 个字（[热词系列_再给一集]、[doge]）
const CODE_RE = /\[[^[\]\s]{1,24}\]/g;

// 面板拉不到时的兜底：默认常用里的小表情（大家都有的小黄脸、tv_小电视）
export const BUILTIN = Object.freeze({
  1: { id: 1, text: '小黄脸', size: 1, kind: 'image' },
  2: { id: 2, text: 'tv_小电视', size: 1, kind: 'image' },
  4: { id: 4, text: '颜文字', size: 1, kind: 'text' },
  53: { id: 53, text: '热词系列一', size: 2, kind: 'image' },
});

/** 一行一个表情代码（颜文字里可能有逗号，所以用换行分开）。 */
export const splitPicks = (s) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
export const pkgIdsOf = (s) => new Set(String(s ?? '').split(/[,，\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0));

// ── 面板缓存 ────────────────────────────────────────────────────────────────
/** {at, packages:[{id, text, size, kind, url, emotes:[{text, url, size}]}], seen:[id], error} */
export function loadEmotes(file = EMOTE_FILE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { at: Number(s.at) || 0, packages: Array.isArray(s.packages) ? s.packages : [], seen: Array.isArray(s.seen) ? s.seen.map(Number) : [], fresh: Array.isArray(s.fresh) ? s.fresh.map(Number) : [], error: String(s.error ?? '') };
  } catch { return { at: 0, packages: [], seen: [], fresh: [], error: '' }; }
}
function saveEmotes(st, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

/** B站表情面板 → 精简的系列列表。 */
export function parsePanel(d) {
  return (d?.packages ?? []).filter((p) => Array.isArray(p.emote) && p.emote.length).map((p) => {
    const emotes = p.emote.map((e) => ({ text: String(e.text ?? ''), url: /^https?:/.test(String(e.url ?? '')) ? String(e.url) : '', size: Number(e.meta?.size) || 1 })).filter((e) => e.text);
    const big = emotes.filter((e) => e.size >= 2).length > emotes.length / 2;
    return { id: Number(p.id), text: String(p.text ?? ''), size: big ? 2 : 1, kind: Number(p.type) === 4 || emotes.every((e) => !e.url) ? 'text' : 'image', url: String(p.url ?? ''), emotes };
  }).filter((p) => p.id > 0);
}

/**
 * 重新拉账号的表情面板。fresh = 这次才出现的系列（第一次拉不算「新」）。
 * 拉失败时保留上次的结果，只记下错误。
 */
export async function refreshEmotes(client, { file = EMOTE_FILE, now = Date.now() } = {}) {
  const old = loadEmotes(file);
  try {
    const packages = parsePanel(await client.request('https://api.bilibili.com/x/emote/user/panel/web?business=reply'));
    if (!packages.length) throw new Error('表情面板是空的（登录失效？）');
    const seen = new Set(old.seen);
    const first = !old.at;
    const fresh = first ? [] : [...new Set([...old.fresh.filter((id) => packages.some((p) => p.id === id)), ...packages.filter((p) => !seen.has(p.id)).map((p) => p.id)])];
    const st = { at: now, packages, seen: [...new Set([...seen, ...packages.map((p) => p.id)])], fresh, error: '' };
    saveEmotes(st, file);
    return st;
  } catch (e) {
    const st = { ...old, error: String(e?.message ?? e), errorAt: now };
    saveEmotes(st, file);
    throw e;
  }
}

/** 设置页看过了：去掉「新」标记。 */
export function clearFresh(file = EMOTE_FILE) {
  const st = loadEmotes(file);
  if (!st.fresh.length) return st;
  st.fresh = [];
  saveEmotes(st, file);
  return st;
}

let refreshing = null;
/** 缓存超过一天就在后台拉一次（不等结果，不报错）。 */
export function refreshIfStale(getClient, { file = EMOTE_FILE, now = Date.now() } = {}) {
  const st = loadEmotes(file);
  if (refreshing || now - st.at < REFRESH_MS || now - (st.errorAt ?? 0) < 3600_000) return;
  refreshing = Promise.resolve().then(getClient).then((c) => refreshEmotes(c, { file, now })).catch(() => {}).finally(() => { refreshing = null; });
}

// ── 能用哪些 ──────────────────────────────────────────────────────────────
/**
 * 现在能用的表情：已启用系列里的所有代码（code → {pkg, size, kind}）。
 * 面板从来没拉到过：退回「常用」里方括号的那些（默认常用都是大家都有的）。
 */
export function allowedCodes(cfg, cache = loadEmotes()) {
  const on = pkgIdsOf(cfg.emotePkgs);
  const map = new Map();
  if (cache.packages.length) {
    for (const p of cache.packages) {
      if (!on.has(p.id)) continue;
      for (const e of p.emotes) map.set(e.text, { pkg: p.text, size: e.size, kind: p.kind });
    }
  } else {
    for (const t of splitPicks(cfg.emotePicks)) map.set(t, { pkg: '', size: /^\[热词/.test(t) ? 2 : 1, kind: t.startsWith('[') ? 'image' : 'text' });
  }
  return map;
}

/** 所有系列里的代码（启用没启用都算），用来说清楚去掉的原因。 */
function knownCodes(cache) {
  const map = new Map();
  for (const p of cache.packages) for (const e of p.emotes) map.set(e.text, p.text);
  return map;
}

/**
 * 发之前清理正文里的表情代码。
 * - 「不用」：方括号代码全部去掉。
 * - 不在已启用系列里的去掉（[狗头] 不是 B站表情，会原样显示成方括号文字）。
 * - 超过「一条最多几个」的从后面去掉。
 * 截断留下的半截代码（「[星星」）也去掉。返回 {text, dropped:[{code, why}], codes:n}。
 */
export function tidyEmotes(text, cfg, { cache = loadEmotes() } = {}) {
  let t = String(text ?? '').replace(/\[[^[\]\s]{0,24}$/, '');
  const dropped = [];
  const off = cfg.emoteMode === 'off';
  const allowed = off ? new Map() : allowedCodes(cfg, cache);
  const known = knownCodes(cache);
  let kept = 0;
  t = t.replace(CODE_RE, (code) => {
    if (off) { dropped.push({ code, why: '主人设置了不用表情' }); return ''; }
    if (!allowed.has(code)) {
      dropped.push({ code, why: known.has(code) ? `「${known.get(code)}」这包主人没开` : '不是 B站表情' });
      return '';
    }
    if (kept >= cfg.emoteMax) { dropped.push({ code, why: `一条最多 ${cfg.emoteMax} 个表情` }); return ''; }
    kept += 1;
    return code;
  });
  if (dropped.length) t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  return { text: t, dropped, codes: kept };
}

/** 去掉的表情，告诉她一句（拼在工具结果后面）。 */
export function droppedNote(dropped) {
  if (!dropped?.length) return '';
  const why = [...new Set(dropped.map((d) => d.why))].join('；');
  return `（${dropped.map((d) => d.code).join(' ')} 没发出去：${why}。下次用说明里列的表情。）`;
}

/** 正文去掉表情代码后还剩字吗（顶层评论必须有字）。 */
export function hasWords(text) {
  return String(text ?? '').replace(CODE_RE, '').replace(/[\s\p{P}\p{S}]/gu, '').length > 0;
}

// ── 给她看的说明 ──────────────────────────────────────────────────────────
const MODE_HINT = {
  few: '偶尔点缀一下，别每条都用，一条一两个就够，放句尾',
  many: '可以常用，像平时聊天那样',
};

/**
 * 「能用的表情」：已启用系列里标了「常用」的，按系列分行。没有就返回空串。
 * forTool：工具说明（带上「不能只发表情」的规矩）；否则是给评论引擎、自己逛的提示词。
 */
export function emoteGuide(cfg, { cache = loadEmotes(), forTool = true } = {}) {
  if (cfg.emoteMode === 'off') return forTool ? '' : '不要用 B站表情代码（方括号那种），会被去掉。';
  const allowed = allowedCodes(cfg, cache);
  const picks = splitPicks(cfg.emotePicks).filter((t) => allowed.has(t) || (!t.startsWith('[') && kaomojiOn(cfg, cache, t)));
  if (!picks.length) return '';
  const byPkg = new Map();
  for (const t of picks) {
    const a = allowed.get(t) ?? { pkg: '颜文字', size: 1, kind: 'text' };
    const key = a.kind === 'text' ? '颜文字' : a.size >= 2 ? '大表情（单独发一个就像发表情包，只在回复别人时用）' : '小表情';
    if (!byPkg.has(key)) byPkg.set(key, []);
    byPkg.get(key).push(t);
  }
  const order = ['小表情', '大表情（单独发一个就像发表情包，只在回复别人时用）', '颜文字'];
  const lines = order.filter((k) => byPkg.has(k)).map((k) => `  ${k}：${byPkg.get(k).join(' ')}`);
  return [
    `表情（把代码原样写进正文就会显示成表情；${MODE_HINT[cfg.emoteMode] ?? MODE_HINT.few}；一条最多 ${cfg.emoteMax} 个；顶层评论要有字，回复别人时可以只回一个表情）：`,
    ...lines,
    '只用这里列的；别自己编（比如 [狗头] 不是 B站表情，会被去掉）。',
  ].join('\n');
}

/** 拼进提示词：有内容就另起一行。 */
export const promptLine = (guide) => (guide ? `\n${guide}` : '');

function kaomojiOn(cfg, cache, t) {
  const on = pkgIdsOf(cfg.emotePkgs);
  if (!cache.packages.length) return on.has(4);
  return cache.packages.some((p) => on.has(p.id) && p.kind === 'text' && p.emotes.some((e) => e.text === t));
}

// ── 说明跟着设置走 ────────────────────────────────────────────────────────
// 工具说明是注册工具时生成的。记下那时的表情设置（含表情面板），之后不一样了，
// index.js 就把评论、私信、动态三个工具重新注册一遍（她下一次请求模型时就看到新的）；
// 重新注册失败时 emoteStale 一直为真，设置页提醒重启。
const SIG_KEYS = ['emoteMode', 'emoteMax', 'emotePkgs', 'emotePicks', 'stickerOn', 'stickerPerDay'];
let loadedSig = null;
export function emoteSig(cfg, stickers = [], cacheAt = loadEmotes().at) {
  const s = JSON.stringify([SIG_KEYS.map((k) => cfg[k]), stickers.map((x) => [x.name, x.when]), cacheAt]);
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}
export function markLoaded(cfg, stickers = []) { loadedSig = emoteSig(cfg, stickers); }
/** 设置和插件加载时不一样了吗（没加载过 = 不知道，不提醒）。 */
export function emoteStale(cfg, stickers = []) { return loadedSig != null && loadedSig !== emoteSig(cfg, stickers); }

// ── 设置页显示表情图 ──────────────────────────────────────────────────────
/** 表情图：只取 B站图床上的，缓存到本地。返回 {buf, type} 或 null。 */
export async function emoteImage(url, { dir = EMOTE_IMG_DIR, fetchImpl = fetch } = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !/^i\d\.hdslb\.com$/.test(u.hostname) || !u.pathname.startsWith('/bfs/')) return null;
  const file = path.join(dir, `${crypto.createHash('sha1').update(u.href).digest('hex')}.webp`);
  try { return { buf: fs.readFileSync(file), type: 'image/webp' }; } catch { /* 还没缓存 */ }
  // 列表里用小图（B站图床支持 @56w_56h.webp 这类缩放后缀）
  const r = await fetchImpl(`${u.href}@56w_56h.webp`, { headers: { referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 512 * 1024) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, buf);
  return { buf, type: 'image/webp' };
}
