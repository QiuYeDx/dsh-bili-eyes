// 写操作：点赞/收藏、评论/回复、私信主人、发动态。要不要发、发给谁、发几条都在这里决定。
//
// 每次写都按这个顺序：档位（off/approve/auto）→ 全部停下 / 风控暂停 → 内容检查 → 额度 → 可信判断。
//   auto + 可信会话 → 直接发；否则起草（drafts.json，编号 #n），等主人同意后由 bili_confirm 或设置页发出。
// 所有写操作（含起草、拒绝、失败）记进 actions.jsonl。硬上限写在代码里，模型改不了。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { clip } from './look.js';
import { sessionContext, ownerMessages } from './gate.js';

export const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
export const ACTIONS_FILE = path.join(DATA_DIR, 'actions.jsonl');

export class ActError extends Error {}

export const KIND_TEXT = { like: '点赞', fav: '点赞+收藏', comment: '评论', reply: '回复', dm: '私信', post: '动态' };
const MODE_KEY = { like: 'likeMode', fav: 'likeMode', comment: 'commentMode', reply: 'commentMode', dm: 'dmMode', post: 'postMode' };
const QUOTA_KEY = { like: 'likePerDay', fav: 'likePerDay', comment: 'commentPerDay', reply: 'replyPerDay', dm: 'dmPerDay', post: 'postPerDay' };
const MAX_LEN = { comment: 300, reply: 300, dm: 500, post: 500 };
const LIGHT = new Set(['like', 'fav']);           // 轻操作：间隔只要 5 秒
const HIDDEN_PAUSE_MS = 2 * 3600_000;           // 评论被设成「仅自己可见」后，写操作暂停 2 小时（接着发只会更糟）
const SENT = new Set(['ok', 'hidden']);          // 算「发出去了」的状态（计额度、判重复）
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RISK_CODES = new Set([-352, -412, -509, 12015]);   // 风控类：自动暂停写操作 30 分钟
const ERROR_HINT = {
  '-101': '登录失效了，要重新扫码登录',
  '-111': '登录信息里的 csrf 不对，重新扫码登录',
  '-352': '被 B站风控拦了',
  '-412': '请求太频繁被拦了',
  '-509': '请求太频繁',
  12002: '这个视频的评论区关了',
  12015: 'B站要求验证码（风控）',
  12051: '重复评论',
};

// ── 存储 ──────────────────────────────────────────────────────────────────
export function loadDrafts(file = DRAFTS_FILE) {
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return { next: Number(s.next) || 1, list: Array.isArray(s.list) ? s.list : [], pausedUntil: Number(s.pausedUntil) || 0, pauseReason: String(s.pauseReason ?? '') }; }
  catch { return { next: 1, list: [], pausedUntil: 0, pauseReason: '' }; }
}
export function saveDrafts(d, file = DRAFTS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const keep = d.list.filter((x) => x.status === 'pending').concat(d.list.filter((x) => x.status !== 'pending').slice(-100));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...d, list: keep }, null, 1));
  fs.renameSync(tmp, file);
}

let auditLines = -1;
export function audit(entry, file = ACTIONS_FILE) {
  const e = { id: crypto.randomBytes(4).toString('hex'), at: Date.now(), ...entry };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
    auditLines = auditLines < 0 ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : auditLines + 1;
    if (auditLines > 2000) {
      const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-1500);
      fs.writeFileSync(file, `${keep.join('\n')}\n`);
      auditLines = keep.length;
    }
  } catch { /* 审计写不进去不影响操作本身 */ }
  return e;
}
export function readAudit(limit = 500, file = ACTIONS_FILE) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit).reverse()
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** 今天每类成功了几次。 */
export function todayCounts(entries, now = Date.now()) {
  const today = dayOf(now); const out = {};
  for (const e of entries) if (SENT.has(e.status) && dayOf(e.at) === today) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

// ── 内容检查 ──────────────────────────────────────────────────────────────
const URL_RE = /(https?:\/\/|www\.|b23\.tv|bili2233|\.(com|cn|net|top|xyz|cc)\b)/i;

/**
 * 检查正文；返回清理后的正文。ownerName：@ 只允许 @ 这个名字。
 * mention=true 时在开头加「@主人 」（回复楼中楼时 B站 会自己加「回复 @某某」，所以楼中楼里不让手打别的 @）。
 */
export function checkText(kind, text, { ownerName = '', mention = false } = {}) {
  let t = String(text ?? '').replace(/\r/g, '').trim();
  if (!t) throw new ActError('正文是空的');
  if (t.length > MAX_LEN[kind]) throw new ActError(`${KIND_TEXT[kind]}最多 ${MAX_LEN[kind]} 个字（现在 ${t.length} 个）`);
  if (URL_RE.test(t)) throw new ActError('正文里不能带链接或网址');
  if (/\d{5,}/.test(t)) throw new ActError('正文里不能有 5 位以上的连续数字（防止带出 QQ 号、手机号、UID）');
  const ats = [...t.matchAll(/@([^\s@，。！？,.!?：:]+)/g)].map((m) => m[1]);
  const others = ats.filter((n) => !ownerName || n !== ownerName);
  if (others.length) throw new ActError(`@ 只能 @ 主人${ownerName ? `（${ownerName}）` : '（主人 UID 还没设置）'}，不能 @ ${others.join('、')}`);
  if (mention) {
    if (!ownerName) throw new ActError('主人的 B站 UID 还没设置，不能 @ 主人');
    if (!ats.includes(ownerName)) t = `@${ownerName} ${t}`;
    if (t.length > MAX_LEN[kind]) throw new ActError(`加上 @ 后超过 ${MAX_LEN[kind]} 个字`);
  }
  return t;
}

// ── 主人的话：同意 / 不同意 ────────────────────────────────────────────────
const NO_RE = /(不发|别发|不要发|不用发|算了|不用了|取消|不行|不可以|别了|不准|驳回|不同意)/;
const YES_RE = /^(发|发吧|发呗|发出去|可以|可以发|行|好|好的|好滴|嗯|嗯嗯|ok|okk|同意|批准|准了|去吧|没问题|冲|就这样)(\s*#?\d+)?[!！。.~～]*$/i;
const YES_IN = /(可以发|发吧|发出去|同意发|就这么发|批准)/;

/**
 * 主人在草稿之后说的话里，有没有对这条草稿表态。消息按时间从新到旧看，第一条表态的算数。
 * 带编号（「发 #3」「3 不发」）的只对那条草稿有效；不带编号的对最新的草稿有效（由调用方保证）。
 * 返回 'yes' | 'no' | null。
 */
export function judge(messages, draftId) {
  const sorted = [...messages].sort((a, b) => b.at - a.at);
  for (const m of sorted) {
    const t = String(m.text ?? '').trim();
    if (!t || t.length > 40) continue;
    const num = /#?\s*(\d{1,4})\b/.exec(t);
    if (num && Number(num[1]) !== Number(draftId)) continue;
    if (NO_RE.test(t)) return 'no';
    if (YES_RE.test(t) || YES_IN.test(t)) return 'yes';
  }
  return null;
}

// ── 执行 ──────────────────────────────────────────────────────────────────
function explain(e) {
  const code = e?.code;
  const hint = ERROR_HINT[String(code)];
  return `${hint ? `${hint}：` : ''}${e?.message ?? e}${code != null && typeof code === 'number' ? `（代码 ${code}）` : ''}`;
}

let verifyDelayMs = 2000;
/** 测试用：发评论后隔多久查可见性。 */
export function setVerifyDelay(ms) { verifyDelayMs = ms; }

/**
 * 发完之后用自己的视角查这条评论的状态，查几次（刚发出去可能还在审核）。
 * 0 = 别人看得到；17 = 仅自己可见；null = 查不到。
 */
async function verifyCommentState(client, { oid, type, rpid, root }) {
  if (!rpid || !client.commentState) return null;
  let state = null;
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) await sleep(verifyDelayMs * i);   // 2s → 再等 2s → 再等 4s
    try { state = await client.commentState({ oid, type, rpid, root }); } catch { state = null; }
    if (state != null && Number(state) === 0) return 0;
  }
  return state == null ? null : Number(state);
}

/** 真正发请求。返回 {rpid?, info, state?, hidden?}。 */
async function perform(client, d) {
  const p = d.payload;
  if (d.kind === 'like' || d.kind === 'fav') {
    try { await client.likeVideo(p.aid); }
    catch (e) { if (e?.code !== 65006) throw e; }   // 65006 = 已经赞过
    if (d.kind === 'fav') await client.favVideo(p.aid, await client.defaultFavFolder());
    return { info: d.kind === 'fav' ? '已点赞并收藏' : '已点赞' };
  }
  if (d.kind === 'comment' || d.kind === 'reply') {
    const r = await client.addComment({ oid: p.oid, type: p.type, message: p.text, root: p.root, parent: p.parent, atNameToMid: p.atNameToMid });
    const rpid = String(r?.rpid_str ?? r?.rpid ?? '');
    // B站接受了不等于别人看得到：发评论接口返回的 reply.state 是 0（乐观值），实际可能被设成
    // 「仅自己可见」（state 17，风控或审核中），接口照样返回成功。只能发完用自己的视角再查一遍。
    const state = await verifyCommentState(client, { oid: p.oid, type: p.type, rpid, root: d.kind === 'reply' ? p.root : 0 });
    return { rpid, state, hidden: state != null && state !== 0, info: state === 0 ? '已发出（已确认公开）' : '已发出' };
  }
  if (d.kind === 'dm') { await client.sendDm({ receiverMid: p.to, text: p.text }); return { info: '已发出' }; }
  if (d.kind === 'post') { const r = await client.postDynamic(p.text); return { rpid: String(r?.dyn_id_str ?? ''), info: '已发出' }; }
  throw new ActError(`不认识的操作 ${d.kind}`);
}

/**
 * 写操作的入口。
 * @param {object} req {kind, payload, preview, target}：payload 是发请求要的参数，preview 是给人看的一句话，target 记进审计
 * @param {object} o {cfg, client, sessionId, via:'tool'|'ui', draftsFile, auditFile, now}
 * @returns {Promise<{status:'sent'|'draft'|'refused'|'failed', text:string, draft?:object}>}
 */
export async function request(req, { cfg, client, sessionId = '', via = 'tool', draftsFile = DRAFTS_FILE, auditFile = ACTIONS_FILE, now = Date.now(), gateOpts } = {}) {
  const { kind } = req;
  const mode = cfg[MODE_KEY[kind]];
  const refuse = (why) => { audit({ kind, status: 'refused', target: req.target, text: req.payload?.text, error: why }, auditFile); return { status: 'refused', text: `没发：${why}` }; };
  if (mode === 'off') return refuse(`主人没开「${KIND_TEXT[kind]}」（设置页 → 互动）`);
  if (cfg.writePaused) return refuse('主人在设置页按了「全部停下」');
  const drafts = loadDrafts(draftsFile);
  if (drafts.pausedUntil > now) return refuse(`${drafts.pauseReason || '刚才被 B站风控拦过'}，写操作暂停到 ${new Date(drafts.pausedUntil).toLocaleTimeString()}`);

  const entries = readAudit(2000, auditFile);
  const quota = cfg[QUOTA_KEY[kind]];
  const used = (todayCounts(entries, now)[kind] ?? 0) + (kind === 'fav' ? todayCounts(entries, now).like ?? 0 : kind === 'like' ? todayCounts(entries, now).fav ?? 0 : 0);
  if (used >= quota) return refuse(`今天的「${KIND_TEXT[kind]}」额度用完了（${used}/${quota}）`);
  if (kind === 'comment' && entries.some((e) => e.kind === 'comment' && SENT.has(e.status) && e.target?.oid === String(req.payload.oid))) return refuse('这个视频下面我已经评论过了（同一个视频只发一条顶层评论）');
  if (kind === 'reply' && entries.filter((e) => e.kind === 'reply' && SENT.has(e.status) && e.target?.parent === String(req.payload.parent)).length >= 2) return refuse('这条评论我已经回过两次了');
  const pendingSame = drafts.list.find((x) => x.status === 'pending' && x.kind === kind && JSON.stringify(x.payload) === JSON.stringify(req.payload));
  if (pendingSame) return { status: 'draft', draft: pendingSame, text: `这条已经起草过了（#${pendingSame.id}），还在等主人同意。` };

  const ctx = await sessionContext(cfg, sessionId, gateOpts);
  if (mode === 'auto' && (ctx.trusted || via === 'ui')) {
    return send({ kind, payload: req.payload, preview: req.preview, target: req.target }, { cfg, client, entries, now, auditFile, draftsFile, how: via === 'ui' ? 'ui' : 'auto' });
  }
  // 起草
  const draft = { id: drafts.next, kind, payload: req.payload, preview: req.preview, target: req.target, createdAt: now, sessionId: String(sessionId), where: ctx.label, status: 'pending' };
  drafts.next += 1;
  drafts.list.push(draft);
  saveDrafts(drafts, draftsFile);
  audit({ kind, status: 'draft', draft: draft.id, target: req.target, text: req.payload?.text, where: ctx.label }, auditFile);
  const how = cfg.gateUrl
    ? '先问主人要不要发（把要发的内容告诉主人），主人明确同意后调用 bili_confirm({draft: 编号})；主人说不发就调用 bili_confirm({draft: 编号, decision: "drop"})。'
    : '要主人在 DSH 设置页「B站看视频 → 互动 → 待同意」里点同意才会发出。';
  return { status: 'draft', draft, text: `已起草 #${draft.id}（${KIND_TEXT[kind]}：${clip(req.preview, 80)}），还没发出去。${how}` };
}

/** 发出（不再检查档位和可信，只检查间隔和风控）。 */
async function send(d, { cfg, client, entries = readAudit(2000), now = Date.now(), auditFile = ACTIONS_FILE, draftsFile = DRAFTS_FILE, how = 'auto', draftId = null }) {
  const gap = LIGHT.has(d.kind) ? 5 : cfg.writeGapSeconds;
  const last = entries.find((e) => e.status === 'ok' && (LIGHT.has(d.kind) || !LIGHT.has(e.kind)));
  if (last && now - last.at < gap * 1000) {
    const wait = Math.ceil((gap * 1000 - (now - last.at)) / 1000);
    return { status: 'refused', text: `没发：离上一次写操作太近，${wait} 秒后再试${draftId ? `（草稿 #${draftId} 还留着）` : ''}` };
  }
  try {
    const r = await perform(client, d);
    if (r.hidden) {
      audit({ kind: d.kind, status: 'hidden', how, draft: draftId, target: d.target, text: d.payload?.text, rpid: r.rpid ?? '', state: r.state }, auditFile);
      const drafts = loadDrafts(draftsFile);
      drafts.pausedUntil = now + HIDDEN_PAUSE_MS;
      drafts.pauseReason = '上一条评论被 B站设成了仅自己可见';
      saveDrafts(drafts, draftsFile);
      return { status: 'hidden', rpid: r.rpid, text: `${KIND_TEXT[d.kind]}发出去了，但 B站把它设成了「仅自己可见」（风控或审核，状态 ${r.state}），别人看不到，被 @ 的人也收不到通知。照实告诉主人，别说「发好了」，也别换个说法重发；写操作先暂停 2 小时。` };
    }
    audit({ kind: d.kind, status: 'ok', how, draft: draftId, target: d.target, text: d.payload?.text, rpid: r.rpid ?? '', state: r.state ?? null }, auditFile);
    const unsure = r.state == null && (d.kind === 'comment' || d.kind === 'reply') ? '（没能确认别人看不看得到）' : '';
    return { status: 'sent', text: `${KIND_TEXT[d.kind]}${r.info}：${clip(d.preview, 80)}${unsure}`, rpid: r.rpid };
  } catch (e) {
    if (e instanceof ActError) throw e;
    if (RISK_CODES.has(e?.code)) {
      const drafts = loadDrafts(draftsFile);
      drafts.pausedUntil = now + 30 * 60_000;
      drafts.pauseReason = '刚才被 B站风控拦过';
      saveDrafts(drafts, draftsFile);
    }
    const why = explain(e);
    audit({ kind: d.kind, status: 'fail', how, draft: draftId, target: d.target, text: d.payload?.text, error: why }, auditFile);
    return { status: 'failed', text: `B站没让发：${why}。别反复重试${RISK_CODES.has(e?.code) ? '，写操作先暂停 30 分钟' : ''}。` };
  }
}

/**
 * 处理一条草稿。decision：'send' 发出 / 'drop' 丢掉。
 * via='tool' 时，发出前要门卫确认主人在草稿之后表过态（judge）；via='ui' 时直接按 decision 执行。
 */
export async function confirm(draftId, decision, { cfg, client, sessionId = '', via = 'tool', draftsFile = DRAFTS_FILE, auditFile = ACTIONS_FILE, now = Date.now(), gateOpts } = {}) {
  const drafts = loadDrafts(draftsFile);
  const d = drafts.list.find((x) => x.id === Number(draftId));
  if (!d) return { status: 'refused', text: `没有草稿 #${draftId}` };
  if (d.status !== 'pending') return { status: 'refused', text: `草稿 #${d.id} 已经${{ sent: '发出了', rejected: '丢掉了', expired: '过期了', failed: '发失败了' }[d.status] ?? '处理过了'}` };
  const finish = (status, result) => { d.status = status; d.result = result; d.doneAt = now; saveDrafts(drafts, draftsFile); };
  if (now - d.createdAt > cfg.draftMinutes * 60_000) { finish('expired', ''); return { status: 'refused', text: `草稿 #${d.id} 过期了（超过 ${cfg.draftMinutes} 分钟），要发就重新起草` }; }
  if (decision === 'drop') {
    finish('rejected', via);
    audit({ kind: d.kind, status: 'rejected', draft: d.id, target: d.target, text: d.payload?.text, how: via }, auditFile);
    return { status: 'refused', text: `草稿 #${d.id} 丢掉了` };
  }
  if (cfg.writePaused) return { status: 'refused', text: '没发：主人在设置页按了「全部停下」' };
  if (cfg[MODE_KEY[d.kind]] === 'off') return { status: 'refused', text: `没发：主人把「${KIND_TEXT[d.kind]}」关了` };
  if (drafts.pausedUntil > now) return { status: 'refused', text: `没发：写操作暂停到 ${new Date(drafts.pausedUntil).toLocaleTimeString()}（${drafts.pauseReason || '刚被风控拦过'}）` };
  let how = 'ui';
  if (via !== 'ui') {
    if (!cfg.gateUrl) return { status: 'refused', text: `没法确认主人同意了：没配门卫。草稿 #${d.id} 要主人在设置页里点同意。` };
    const msgs = await ownerMessages(cfg, sessionId || d.sessionId, d.createdAt, gateOpts);
    if (!msgs) return { status: 'refused', text: '门卫没响应，没法确认主人同意了，草稿先留着。' };
    // 不带编号的表态只对最新那条待同意的草稿有效
    const newest = Math.max(...drafts.list.filter((x) => x.status === 'pending').map((x) => x.id));
    const relevant = d.id === newest ? msgs : msgs.filter((m) => /\d/.test(m.text));
    const verdict = judge(relevant, d.id);
    if (verdict === 'no') {
      finish('rejected', 'owner');
      audit({ kind: d.kind, status: 'rejected', draft: d.id, target: d.target, text: d.payload?.text, how: 'owner' }, auditFile);
      return { status: 'refused', text: `主人说不发，草稿 #${d.id} 丢掉了` };
    }
    if (verdict !== 'yes') return { status: 'refused', text: `还没看到主人同意（草稿 #${d.id} 之后主人没说「发 / 可以」之类的话${d.id === newest ? '' : `；有好几条草稿时要带编号，比如「发 #${d.id}」`}）。先别发，等主人回话。` };
    how = 'owner';
  }
  const r = await send(d, { cfg, client, now, auditFile, draftsFile, how, draftId: d.id });
  if (r.status === 'sent' || r.status === 'hidden') finish('sent', r.rpid ?? '');
  else if (r.status === 'failed') finish('failed', r.text);
  return r;
}

/** 设置页：删掉一条自己发的评论（审计里那条 ok 的记录）。 */
export async function deleteSent(auditId, { client, auditFile = ACTIONS_FILE } = {}) {
  const e = readAudit(2000, auditFile).find((x) => x.id === auditId && SENT.has(x.status));
  if (!e) throw new ActError('找不到这条记录');
  if (!(e.kind === 'comment' || e.kind === 'reply') || !e.rpid) throw new ActError('只有评论和回复能在这里删');
  await client.delComment({ oid: e.target.oid, type: e.target.type ?? 1, rpid: e.rpid });
  audit({ kind: 'delete', status: 'ok', ref: e.id, target: e.target, text: e.text }, auditFile);
  return { deleted: e.id };
}

/**
 * 设置页「再查一次」：把最近 7 天「仅自己可见」的评论重新查一遍，变公开了就记一条 visible。
 * 返回 {checked, nowVisible}。
 */
export async function recheckHidden({ client, auditFile = ACTIONS_FILE, now = Date.now() } = {}) {
  const entries = readAudit(2000, auditFile);
  const gone = deletedIds(entries);
  const seen = visibleIds(entries);
  let checked = 0; let nowVisible = 0;
  for (const e of entries) {
    if (e.status !== 'hidden' || !e.rpid || gone.has(e.id) || seen.has(e.id) || now - e.at > 7 * 86400_000) continue;
    checked += 1;
    const state = await client.commentState({ oid: e.target.oid, type: e.target.type ?? 1, rpid: e.rpid, root: e.kind === 'reply' ? e.target.root : 0 }).catch(() => null);
    if (state === 0) { audit({ kind: 'visible', status: 'ok', ref: e.id, target: e.target, text: e.text }, auditFile); nowVisible += 1; }
  }
  return { checked, nowVisible };
}

/** 后来变公开了的审计记录 id 集合。 */
export function visibleIds(entries) {
  return new Set(entries.filter((e) => e.kind === 'visible' && e.status === 'ok').map((e) => e.ref));
}

/** 设置页：已删除的审计记录 id 集合。 */
export function deletedIds(entries) {
  return new Set(entries.filter((e) => e.kind === 'delete' && e.status === 'ok').map((e) => e.ref));
}
