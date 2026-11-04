// 谁叫的：群里这个视频是谁叫她看的（主人 / 熟人 / 别人 / 说不清），再按设置里「谁叫的」表定看不看、怎么看。
// 按 QQ 上的事实判断（门卫给的消息记录：谁发了这个视频、谁引用回复了它、谁 @ 她），不听模型怎么说。
// 见 docs/群聊省额度-设计.md。只管她调用的工具；设置页试看、自己逛、守评论区、收件箱不经过这里。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ASK_LEVELS, askLevelFor, friendQQs } from './config.js';
import { sessionContext, recentMessages } from './gate.js';
import { parseInput, resolveShort } from './url.js';
import { record } from './history.js';

export const ORIGIN_WINDOW_MS = 30 * 60_000;   // 只看最近 30 分钟的消息
const MAX_RESOLVE = 8;                           // 一次最多跟几个 b23 短链（要联网）
const ASKER_TEXT = { owner: '主人', friend: '熟人', other: '别人', unknown: '说不清' };
const HOW_TEXT = { trusted: '主人本人的会话', posted: '发了这个视频', replied: '引用回复了这个视频', woke: '叫她的', private: '私聊里', none: '找不到是谁', nogate: '门卫认不出人' };

// ── 视频编号 ──────────────────────────────────────────────────────────────
// av 号 → BV 号（B站公开的换算方法），这样 av 链接和 BV 链接能对上
const XOR_CODE = 23442827791579n;
const MAX_AID = 1n << 51n;
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
export function av2bv(aid) {
  const out = ['B', 'V', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
  let i = out.length - 1;
  let t = (MAX_AID | BigInt(aid)) ^ XOR_CODE;
  while (t > 0n) { out[i] = ALPHABET[Number(t % 58n)]; t /= 58n; i -= 1; }
  [out[3], out[9]] = [out[9], out[3]];
  [out[4], out[7]] = [out[7], out[4]];
  return out.join('');
}

const shortCache = new Map();   // 短链 → BV 号（'' = 跟不出来）
/** 一段文字或一个链接 → BV 号；认不出返回 ''。短链要联网，结果记下来。 */
export async function bvidOf(input, { resolve = resolveShort } = {}) {
  let t;
  try { t = parseInput(input); } catch { return ''; }
  if (t.kind === 'short') {
    if (!shortCache.has(t.url)) {
      let bv = '';
      try { const r = await resolve(t.url, { userAgent: 'Mozilla/5.0' }); bv = r.bvid ?? (r.aid ? av2bv(r.aid) : ''); } catch { /* 跟不出来 */ }
      shortCache.set(t.url, bv);
      if (shortCache.size > 300) shortCache.delete(shortCache.keys().next().value);
    }
    return shortCache.get(t.url);
  }
  return t.bvid ?? (t.aid ? av2bv(t.aid) : '');
}

/** 一条消息里出现的所有视频（BV 号集合）。budget.n 限制联网跟短链的次数。 */
export async function videosIn(msg, { resolve = resolveShort, budget = { n: MAX_RESOLVE } } = {}) {
  const out = new Set();
  const text = String(msg.text ?? '');
  for (const m of text.matchAll(/BV[0-9A-Za-z]{10}/g)) out.add(m[0]);
  for (const m of text.matchAll(/\bav(\d{1,16})\b/gi)) out.add(av2bv(m[1]));
  const links = new Set([...(msg.links ?? []), ...(text.match(/https?:\/\/[^\s<>"'，。】）)]+/gi) ?? [])]);
  for (const link of links) {
    let t;
    try { t = parseInput(link); } catch { continue; }
    if (t.kind === 'short' && !shortCache.has(t.url)) {
      if (budget.n <= 0) continue;
      budget.n -= 1;
    }
    const bv = await bvidOf(link, { resolve });
    if (bv) out.add(bv);
  }
  return out;
}

// ── 认人 ──────────────────────────────────────────────────────────────────
/** 这个人算哪一类：主人 / 熟人 / 别人。 */
export function askerOf(cfg, sender) {
  if (sender?.isOwner) return 'owner';
  if (sender?.trusted || friendQQs(cfg).has(String(sender?.id ?? ''))) return 'friend';
  return 'other';
}

const rank = (level) => ASK_LEVELS.indexOf(level);

/**
 * 从消息记录里找出是谁叫的。返回 {asker, who:{id,name}|null, how}。
 *   1. 谁的消息里有这个视频（posted）
 *   2. 谁引用回复了那条消息、同时 @ 她（replied）
 *   几个人都沾边时按最宽的算：只要有一个能看的人发过或叫过，就当是他叫的
 *   3. 消息里没出现过这个视频（她自己搜到、刷到的）：最近一条 @ 她的是谁（woke）
 *   4. 私聊里找不到：就是私聊的对方（private）
 */
export async function findAsker(cfg, { row, bvid, chat, messages, resolve }) {
  const groupId = chat?.type === 'group' ? chat.id : '';
  const cands = [];
  if (bvid) {
    const budget = { n: MAX_RESOLVE };
    const posts = [];
    for (const m of messages) if ((await videosIn(m, { resolve, budget })).has(bvid)) posts.push(m);
    const postIds = new Set(posts.map((m) => m.id).filter(Boolean));
    for (const m of posts) cands.push({ m, how: 'posted' });
    for (const m of messages) if (m.replyTo && postIds.has(m.replyTo) && m.atSelf) cands.push({ m, how: 'replied' });
  }
  if (cands.length) {
    let best = null;
    for (const c of cands) {
      const asker = askerOf(cfg, c.m.sender);
      const level = askLevelFor(cfg, row, asker, groupId);
      if (!best || rank(level) > rank(best.level)) best = { asker, level, who: { id: c.m.sender.id, name: c.m.sender.name || c.m.sender.id }, how: c.how };
    }
    return { asker: best.asker, who: best.who, how: best.how };
  }
  const woke = [...messages].filter((m) => m.atSelf).sort((a, b) => b.at - a.at)[0];
  if (woke) return { asker: askerOf(cfg, woke.sender), who: { id: woke.sender.id, name: woke.sender.name || woke.sender.id }, how: 'woke' };
  if (chat?.type === 'private' && chat.id) {
    const name = messages.find((m) => m.sender.id === chat.id)?.sender.name || chat.id;
    return { asker: askerOf(cfg, { id: chat.id }), who: { id: chat.id, name }, how: 'private' };
  }
  return { asker: 'unknown', who: null, how: 'none' };
}

/**
 * 这次是谁叫的、该怎么看。who = {sessionId, session}（门卫认会话用）。
 * 返回 {asker, who, how, level, chat, label}；level 是表里的档位（额度另算，见 guarded）。
 */
export async function judge(cfg, who, { row, bvid = '', deps = {} } = {}) {
  const ctxOf = deps.sessionContext ?? sessionContext;
  const recent = deps.recentMessages ?? recentMessages;
  const ctx = await ctxOf(cfg, who);
  if (ctx.trusted) return { asker: 'owner', who: null, how: 'trusted', level: askLevelFor(cfg, row, 'owner'), chat: null, label: ctx.label };
  const r = await recent(cfg, who, (deps.now ?? Date.now()) - ORIGIN_WINDOW_MS);
  if (!r) return { asker: 'unknown', who: null, how: 'nogate', level: askLevelFor(cfg, row, 'unknown'), chat: null, label: ctx.label };
  const found = await findAsker(cfg, { row, bvid, chat: r.chat, messages: r.messages, resolve: deps.resolve });
  const groupId = r.chat?.type === 'group' ? r.chat.id : '';
  return { ...found, level: askLevelFor(cfg, row, found.asker, groupId), chat: r.chat, label: ctx.label };
}

// ── 每人每天的额度 ────────────────────────────────────────────────────────
export const QUOTA_FILE = path.join(DATA_DIR, 'ask-quota.json');
const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function readQuota(file, now) {
  try { const q = JSON.parse(fs.readFileSync(file, 'utf8')); if (q.day === today(now) && q.counts) return q; } catch { /* 没有或坏了 */ }
  return { day: today(now), counts: {} };
}
export function quotaUsed(id, { file = QUOTA_FILE, now } = {}) { return Number(readQuota(file, now).counts[String(id)]) || 0; }
export function quotaTake(id, { file = QUOTA_FILE, now } = {}) {
  if (process.env.NODE_TEST_CONTEXT && file === QUOTA_FILE) return;
  const q = readQuota(file, now);
  q.counts[String(id)] = (Number(q.counts[String(id)]) || 0) + 1;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(q)); } catch { /* 记不下来不影响看 */ }
}
/** 这个人每天的上限（0 = 不限）。主人和说不清的不限。 */
export const dailyLimit = (cfg, asker) => (asker === 'friend' ? cfg.askFriendPerDay : asker === 'other' ? cfg.askOtherPerDay : 0);

// ── 她拿到的话 ────────────────────────────────────────────────────────────
const whoText = (o) => (o.asker === 'owner' ? '主人' : o.who?.name ?? '');
export function describe(o) {
  if (o.how === 'trusted') return '主人';
  if (!o.who) return `${ASKER_TEXT[o.asker]}（${HOW_TEXT[o.how] ?? o.how}）`;
  return `${o.who.name}（${ASKER_TEXT[o.asker]} · ${HOW_TEXT[o.how] ?? o.how}）`;
}
function source(o) {
  if (!o.who) return '这个视频说不清是谁叫你看的';
  if (o.how === 'posted') return `这个视频是${whoText(o)}发的`;
  if (o.how === 'replied') return `这个视频是${whoText(o)}叫你看的`;
  if (o.how === 'private') return `这是${whoText(o)}私聊里让你看的`;
  return `这次是${whoText(o)}叫的你`;
}
const scope = (o, verb) => (o.chat?.type === 'group' ? `主人设置了这个群里${ASKER_TEXT[o.asker] === '说不清' ? '说不清是谁叫的' : `${ASKER_TEXT[o.asker]}叫的`}${verb}` : `主人设置了${ASKER_TEXT[o.asker] === '说不清' ? '说不清是谁叫的' : `${ASKER_TEXT[o.asker]}叫的`}${verb}`);
export function offText(row, o) {
  if (row === 'surf') return `【没逛】${source(o).replace('这个视频', '这次逛 B站')}，${scope(o, '不逛')}（逛一圈很费额度）。一句话带过就好，比如「今天先不逛啦」；别再调用 bili_surf。`;
  if (row === 'zoom') return `【没放大看】这个视频${o.level === 'brief' ? '只能看简介' : '不看'}（${scope(o, o.level === 'brief' ? '只看简介' : '不看')}），没有画面可以放大。别再调用 bili_look_zoom 看它。`;
  return `【没看】${source(o)}，${scope(o, '视频不看')}（看视频很费额度）。一句话带过就好，比如「这个我就不点开啦」；别再调用 bili_look 看这个视频。`;
}
const QUOTA_NOTE = (o, limit) => `（${o.who?.name ?? '这个人'}今天已经让你看了 ${limit} 个，后面的只看简介）`;

// ── 包住工具 ──────────────────────────────────────────────────────────────
const decided = new Map();   // 会话|BV → 档位：放大看沿用看的时候的判断
const DECIDED_MS = 6 * 3600_000;
const remember = (k, o) => { decided.set(k, { o, at: Date.now() }); if (decided.size > 500) decided.delete(decided.keys().next().value); };
const recall = (k) => { const d = decided.get(k); return d && Date.now() - d.at < DECIDED_MS ? d.o : null; };

/**
 * 给工具套上「谁叫的」：row = look / zoom / surf。fn(args, opts) 是原来的实现（look、lookZoom、surf）。
 * 只在 opts.source === 'tool'（她调用的）时管；whoOf(opts.exec) 给出门卫要的会话。
 */
export function guarded(row, fn, { whoOf, loadConfig, deps = {} } = {}) {
  return async (args = {}, opts = {}) => {
    if (opts.source !== 'tool') return fn(args, opts);
    const cfg = opts.cfg ?? loadConfig();
    const who = whoOf(opts.exec);
    const sid = typeof who === 'string' ? who : who?.sessionId ?? '';
    const bvid = row === 'surf' ? '' : await bvidOf(args.url, { resolve: deps.resolve });
    if (row === 'zoom' && bvid && sid) {
      const before = recall(`${sid}|${bvid}`);
      if (before?.level === 'full') return fn(args, { ...opts, origin: before.ask });
      if (before) return { text: offText('zoom', before), pngs: [] };
    }
    let o;
    try { o = await judge(cfg, who, { row: row === 'zoom' ? 'look' : row, bvid, deps }); } catch { o = { asker: 'unknown', who: null, how: 'nogate', level: askLevelFor(cfg, row === 'zoom' ? 'look' : row, 'unknown'), chat: null }; }
    let level = o.level;
    let note = '';
    const limit = dailyLimit(cfg, o.asker);
    if (level === 'full' && limit > 0 && o.who && row !== 'surf' && quotaUsed(o.who.id, deps) >= limit) { level = 'brief'; note = QUOTA_NOTE(o, limit); }
    const ask = { asker: o.asker, who: o.who?.name ?? '', how: o.how, level, ...(o.chat?.type === 'group' ? { group: o.chat.id } : {}) };
    if (row !== 'surf' && bvid && sid) remember(`${sid}|${bvid}`, { ...o, level, ask });
    if (level === 'off' || (row === 'zoom' && level !== 'full')) {
      record({ kind: row, source: 'tool', ok: true, skipped: true, title: bvid || String(args.direction || '随便逛逛'), ...(bvid ? { bvid } : {}), ask });
      return { text: offText(row, { ...o, level }), pngs: [] };
    }
    const nextArgs = level === 'brief' ? (row === 'surf' ? { ...args, mode: 'quick' } : { ...args, brief: true }) : args;
    const r = await fn(nextArgs, { ...opts, origin: ask });
    if (row === 'look' && level === 'full' && !r.cached && limit > 0 && o.who) quotaTake(o.who.id, deps);
    return note ? { ...r, text: `${r.text}\n${note}` } : r;
  };
}
