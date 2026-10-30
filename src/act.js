// 写操作：点赞/收藏、评论/回复、私信主人、发动态、关注/取关。要不要发、发给谁、发几条都在这里决定。
//
// 每次写都按这个顺序：档位（off/approve/auto）→ 全部停下 / 风控暂停 → 内容检查 → 额度 → 可信判断。
//   auto + 可信会话 → 直接发；可信会话里「先问主人」且用内置门卫 → 弹 DSH 原生审批卡片，主人点允许就发；
//   其余起草（drafts.json，编号 #n），等主人同意后由 bili_confirm 或设置页发出。
// 所有写操作（含起草、拒绝、失败）记进 actions.jsonl。硬上限写在代码里，模型改不了。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, saveConfig } from './config.js';
import { clip } from './look.js';
import { sessionContext, ownerMessages, gateKind } from './gate.js';

export const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
export const ACTIONS_FILE = path.join(DATA_DIR, 'actions.jsonl');

export class ActError extends Error {}

export const KIND_TEXT = { like: '点赞', fav: '点赞+收藏', comment: '评论', reply: '回复', dm: '私信', post: '动态', follow: '关注', unfollow: '取关' };
const MODE_KEY = { like: 'likeMode', fav: 'likeMode', comment: 'commentMode', reply: 'commentMode', dm: 'dmMode', post: 'postMode', follow: 'followMode', unfollow: 'followMode' };
const QUOTA_KEY = { like: 'likePerDay', fav: 'likePerDay', comment: 'commentPerDay', reply: 'replyPerDay', dm: 'dmPerDay', post: 'postPerDay', follow: 'followPerDay', unfollow: 'followPerDay' };
// 关注：两次之间至少 10 分钟，每天最多 10 个（设置里只能调低）；取关最高只到「先问主人」
const FOLLOW = new Set(['follow', 'unfollow']);
const FOLLOW_GAP_S = 600;
const FOLLOW_HARD_CAP = 10;
export const FOLLOW_TAG = '小鲸鱼的关注';
const FOLLOW_STOP = new Set([22002, 22003, 22013, 40061]);   // 只是这一个人关注不了，不暂停
// 「没发：…」对关注、点赞读着别扭：按操作说「没关注」「没点赞」
export const NOT_DONE = { like: '没点赞', fav: '没点赞收藏', comment: '没发评论', reply: '没回复', dm: '没发私信', post: '没发动态', follow: '没关注', unfollow: '没取关' };
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
  22001: '不能关注自己',
  22002: '对方的隐私设置不让关注',
  22003: '对方在黑名单里',
  22009: '关注数到上限了',
  22013: '对方账号已注销',
  40061: '用户不存在',
};

// ── 存储 ──────────────────────────────────────────────────────────────────
export function loadDrafts(file = DRAFTS_FILE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { next: Number(s.next) || 1, list: Array.isArray(s.list) ? s.list : [], pausedUntil: Number(s.pausedUntil) || 0, pauseReason: String(s.pauseReason ?? ''), followPausedUntil: Number(s.followPausedUntil) || 0, followPauseReason: String(s.followPauseReason ?? '') };
  } catch { return { next: 1, list: [], pausedUntil: 0, pauseReason: '', followPausedUntil: 0, followPauseReason: '' }; }
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
const BILI_VIDEO_URL = /https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}\/?/g;

/**
 * 检查正文；返回清理后的正文。ownerName：@ 只允许 @ 这个名字。
 * mention=true 时在开头加「@主人 」（回复楼中楼时 B站 会自己加「回复 @某某」，所以楼中楼里不让手打别的 @）。
 */
export function checkText(kind, text, { ownerName = '', mention = false } = {}) {
  let t = String(text ?? '').replace(/\r/g, '').trim();
  if (!t) throw new ActError('正文是空的');
  if (t.length > MAX_LEN[kind]) throw new ActError(`${KIND_TEXT[kind]}最多 ${MAX_LEN[kind]} 个字（现在 ${t.length} 个）`);
  // 私信只发给主人：允许带 B站视频链接（推荐视频要用），别的链接照样不行
  const body = kind === 'dm' ? t.replace(BILI_VIDEO_URL, '') : t;
  if (URL_RE.test(body)) throw new ActError(kind === 'dm' ? '私信里只能带 B站视频链接' : '正文里不能带链接或网址');
  if (/\d{5,}/.test(body)) throw new ActError('正文里不能有 5 位以上的连续数字（防止带出 QQ 号、手机号、UID）');
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
// 主人怎么说都行，不要求固定的词：「发」「可以」「嗯」「关注吧」「是滴 关注吧」「点吧」都算同意。
// 判断方法：短句（30 字内），去掉语气词、标点、表情、草稿编号后，剩下的只由「同意的词 + 这类操作的动词 + 无关紧要的虚词」组成。
// 「好看」「你看着办吧」这类剩下别的字的，不算表态。先看拒绝，再看同意。
const NO_RE = /(不发|别发|不要|不用|算了|取消|不行|不可以|别了|不准|驳回|不同意|先别|等等|等一下|再说|再想想|不关注|别关注|不点|别点|不评论|别评论|不回|别回|别取关|不取关|no\b|nope)/i;
const YES_WORDS = ['发出去', '发吧', '发', '可以', '行', '好的', '好', '嗯', '是的', '是', '对的', '对', '没问题', '同意', '批准', '准了', '去吧', '去', '冲', 'okay', 'okk', 'ok', 'yes', 'go', '就这样', '就这么办', '确认', '按', '搞', '弄', '整'];
const FILLER = ['一下', '下', '给我', '帮我', '就', '快', '赶紧', '那就', '那', '这个', '它', '他', '她', '吧', '呗'];
export const ACTION_WORDS = {
  like: ['点赞', '点', '赞'], fav: ['点赞', '收藏', '点', '赞', '收'],
  comment: ['评论', '回复', '回', '留言', '评'], reply: ['回复', '回', '评论'],
  dm: ['私信', '发私信'], post: ['发动态', '动态'],
  follow: ['关注', '关', '粉'], unfollow: ['取关', '取消关注', '不关注', '别关注'],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const yesRe = (kind) => new RegExp(`^(?:${[...(ACTION_WORDS[kind] ?? []), ...YES_WORDS, ...FILLER].sort((a, b) => b.length - a.length).map(esc).join('|')})+$`, 'i');

/** 一句话是不是在同意（kind：草稿是哪类操作，用来认「关注吧」「点吧」这种直接说动作的）。 */
export function isYes(text, kind) {
  const core = String(text ?? '').toLowerCase()
    .replace(/#?\s*\d{1,4}\s*号?/g, '')                       // 草稿编号
    .replace(/[^\p{Script=Han}a-z]/gu, '')                     // 标点、空格、表情、颜文字
    .replace(/[吧呗啊呀哈嘛啦哦噢喔呢滴哒的了嘞咯捏]/g, (c) => (c === '吧' || c === '呗' ? c : ''));  // 语气词（吧、呗 留给 FILLER）
  return Boolean(core) && yesRe(kind).test(core);
}

/**
 * 主人在草稿之后说的话里，有没有对这条草稿表态。消息按时间从新到旧看，第一条表态的算数。
 * 带编号（「发 #3」「3 不发」）的只对那条草稿有效；不带编号的对最新的草稿有效（由调用方保证）。
 * 返回 'yes' | 'no' | null。
 */
export function judge(messages, draftId, kind = '') {
  const sorted = [...messages].sort((a, b) => b.at - a.at);
  for (const m of sorted) {
    const t = String(m.text ?? '').trim();
    if (!t || t.length > 30) continue;
    const num = /#\s*(\d{1,4})\b|(?:^|\s)(\d{1,4})\s*号?(?=\s|$)/.exec(t);
    const n = num ? Number(num[1] ?? num[2]) : null;
    if (n != null && n !== Number(draftId)) continue;
    // 取关时「不关注了」是同意，不是拒绝
    if (NO_RE.test(kind === 'unfollow' ? t.replace(/取消关注|不关注了?/g, '') : t)) return 'no';
    if (/[?？]/.test(t)) continue;   // 「嗯？」「发？」是在问，不是同意
    if (isYes(t, kind)) return 'yes';
  }
  return null;
}

// 主人自己开口要她做的：点名了这类操作的词（只用两个字以上的、或不会误会的）
const OWNER_ASK_MS = 5 * 60_000;
const ASK_WORDS = {
  like: ['点赞', '赞', '收藏'], fav: ['点赞', '赞', '收藏'], comment: ['评论', '留言'], reply: ['回复', '回一下', '回他', '回她', '回个'],
  dm: ['私信'], post: ['动态'], follow: ['关注'], unfollow: ['取关', '取消关注'],
};
/** 主人最近的话里，有没有一句是在要她做这类操作。有就返回那句话。 */
export function ownerAsked(messages, kind) {
  const words = ASK_WORDS[kind] ?? [];
  for (const m of [...messages].sort((a, b) => b.at - a.at)) {
    const t = String(m.text ?? '').trim();
    if (!t || t.length > 40 || /[?？]/.test(t)) continue;
    if (NO_RE.test(kind === 'unfollow' ? t.replace(/取消关注|不关注了?/g, '') : t)) continue;
    if (/(别|不要|不用|不准|不许|没让|不是让|禁止)/.test(t)) continue;   // 「别乱关注」「不要点赞」
    if (words.some((w) => t.includes(w))) return t;
  }
  return null;
}

/** 给模型看的：这类操作，主人怎么回算同意（举例，不是规定）。 */
export function yesExamples(kind) {
  const verb = { like: '点吧', fav: '点吧', comment: '发吧', reply: '回吧', dm: '发吧', post: '发吧', follow: '关注吧', unfollow: '取关吧' }[kind] ?? '发吧';
  return `「可以」「嗯」「${verb}」`;
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

/**
 * 关注 / 取关，发完核实（评论被悄悄藏起来过，关注也照样查）：隔 1.5、3、6 秒各查一次关系。
 * 关注成功后放进「小鲸鱼的关注」分组（没有就建）；分组失败不影响关注本身。
 */
async function performFollow(client, d) {
  const mid = Number(d.payload.mid);
  const follow = d.kind === 'follow';
  try { await client.modifyRelation(mid, follow ? 1 : 2); }
  catch (e) { if (!(follow && e?.code === 22014)) throw e; }   // 22014 = 已经关注过
  let attr = null;
  for (const wait of [verifyDelayMs * 0.75, verifyDelayMs * 1.5, verifyDelayMs * 3]) {
    await sleep(wait);
    try { attr = (await client.relation(mid)).attribute; } catch { attr = null; }
    if (follow ? attr === 2 || attr === 6 : attr === 0) break;
  }
  const confirmed = follow ? attr === 2 || attr === 6 : attr === 0;
  let tagNote = '';
  if (follow && confirmed) {
    try {
      const tag = (await client.relationTags()).find((t) => t.name === FOLLOW_TAG);
      const tagid = tag ? Number(tag.tagid) : await client.createRelationTag(FOLLOW_TAG);
      await client.addToRelationTag(mid, tagid);
    } catch (e) { tagNote = `（没放进「${FOLLOW_TAG}」分组：${e?.message ?? e}）`; }
  }
  return { unconfirmed: !confirmed, state: attr, info: confirmed ? `${KIND_TEXT[d.kind]}好了（B站上已核实）${tagNote}` : `${KIND_TEXT[d.kind]}请求 B站 接受了，但查不到关系变化` };
}

/** 真正发请求。返回 {rpid?, info, state?, hidden?}。 */
async function perform(client, d) {
  const p = d.payload;
  if (d.kind === 'like' || d.kind === 'fav') {
    try { await client.likeVideo(p.aid); }
    catch (e) { if (e?.code !== 65006) throw e; }   // 65006 = 已经赞过
    if (d.kind === 'fav') await client.favVideo(p.aid, await client.defaultFavFolder());
    return { info: d.kind === 'fav' ? '点赞并收藏好了' : '点赞好了' };
  }
  if (d.kind === 'comment' || d.kind === 'reply') {
    const r = await client.addComment({ oid: p.oid, type: p.type, message: p.text, root: p.root, parent: p.parent, atNameToMid: p.atNameToMid });
    const rpid = String(r?.rpid_str ?? r?.rpid ?? '');
    // B站接受了不等于别人看得到：发评论接口返回的 reply.state 是 0（乐观值），实际可能被设成
    // 「仅自己可见」（state 17，风控或审核中），接口照样返回成功。只能发完用自己的视角再查一遍。
    const state = await verifyCommentState(client, { oid: p.oid, type: p.type, rpid, root: d.kind === 'reply' ? p.root : 0 });
    return { rpid, state, hidden: state != null && state !== 0, info: state === 0 ? `${KIND_TEXT[d.kind]}发出去了（已确认别人看得到）` : `${KIND_TEXT[d.kind]}发出去了` };
  }
  if (d.kind === 'dm') { await client.sendDm({ receiverMid: p.to, text: p.text }); return { info: '私信发出去了' }; }
  if (FOLLOW.has(d.kind)) return performFollow(client, d);
  if (d.kind === 'post') { const r = await client.postDynamic(p.text); return { rpid: String(r?.dyn_id_str ?? ''), info: '动态发出去了' }; }
  throw new ActError(`不认识的操作 ${d.kind}`);
}

/**
 * 写操作的入口。
 * @param {object} req {kind, payload, preview, target}：payload 是发请求要的参数，preview 是给人看的一句话，target 记进审计
 * @param {object} o {cfg, client, sessionId, via:'tool'|'ui', draftsFile, auditFile, now}
 * @returns {Promise<{status:'sent'|'draft'|'refused'|'failed', text:string, draft?:object}>}
 */
export async function request(req, { cfg, client, sessionId = '', session = null, approve = null, via = 'tool', draftsFile = DRAFTS_FILE, auditFile = ACTIONS_FILE, now = Date.now(), gateOpts } = {}) {
  const { kind } = req;
  let mode = cfg[MODE_KEY[kind]];
  if (kind === 'unfollow' && mode === 'auto') mode = 'approve';   // 取关永远先问主人
  const refuse = (why) => { audit({ kind, status: 'refused', target: req.target, text: req.payload?.text, error: why }, auditFile); return { status: 'refused', text: `${NOT_DONE[kind]}：${why}` }; };
  if (mode === 'off') return refuse(`主人没开「${KIND_TEXT[kind]}」（设置页 → 互动）`);
  if (cfg.writePaused) return refuse('主人在设置页按了「全部停下」');
  const drafts = loadDrafts(draftsFile);
  if (drafts.pausedUntil > now) return refuse(`${drafts.pauseReason || '刚才被 B站风控拦过'}，写操作暂停到 ${new Date(drafts.pausedUntil).toLocaleTimeString()}`);
  if (FOLLOW.has(kind) && drafts.followPausedUntil > now) return refuse(`${drafts.followPauseReason || '关注被 B站拦过'}，关注暂停到 ${new Date(drafts.followPausedUntil).toLocaleString()}`);

  const entries = readAudit(2000, auditFile);
  if (kind === 'unfollow' && !req.own) return refuse('只能取关她自己关注的人（号上原来就有的关注不能动）');
  const quota = FOLLOW.has(kind) ? Math.min(FOLLOW_HARD_CAP, cfg[QUOTA_KEY[kind]]) : cfg[QUOTA_KEY[kind]];
  const used = (todayCounts(entries, now)[kind] ?? 0) + (kind === 'fav' ? todayCounts(entries, now).like ?? 0 : kind === 'like' ? todayCounts(entries, now).fav ?? 0 : 0);
  if (used >= quota) return refuse(`今天的「${KIND_TEXT[kind]}」额度用完了（${used}/${quota}）`);
  if (kind === 'comment' && entries.some((e) => e.kind === 'comment' && SENT.has(e.status) && e.target?.oid === String(req.payload.oid))) return refuse('这个视频下面我已经评论过了（同一个视频只发一条顶层评论）');
  if (kind === 'reply' && entries.filter((e) => e.kind === 'reply' && SENT.has(e.status) && e.target?.parent === String(req.payload.parent)).length >= 2) return refuse('这条评论我已经回过两次了');
  const pendingSame = drafts.list.find((x) => x.status === 'pending' && x.kind === kind && JSON.stringify(x.payload) === JSON.stringify(req.payload));
  if (pendingSame) return { status: 'draft', draft: pendingSame, text: `这条已经起草过了（#${pendingSame.id}），还在等主人同意。` };

  // 后台「自己逛」没有会话：开没开、开到哪一档是主人在设置里定的，按可信算
  const ctx = via === 'background' ? { trusted: true, label: '自己逛（后台）', gate: 'background' } : await sessionContext(cfg, session ? { sessionId, session } : sessionId, gateOpts);
  // 关注「直接发」只对她最近真看过的 UP 主：就算会话可信，这一轮也可能是逛的时候被评论带偏的
  const autoOk = mode === 'auto' && (kind !== 'follow' || req.watched || via === 'ui');
  if (autoOk && (ctx.trusted || via === 'ui')) {
    return send({ kind, payload: req.payload, preview: req.preview, target: req.target }, { cfg, client, entries, now, auditFile, draftsFile, how: via === 'ui' ? 'ui' : 'auto' });
  }
  // 主人刚刚自己要她做这件事（「在 b站关注我一下」「帮我点个赞」）：这句话本身就是同意，不用再问一遍。
  // 只认门卫给的主人原话（群友说的不算），5 分钟内、不是问句、没有否定、点名了这类操作。
  if ((ctx.gate === 'http' || ctx.gate === 'service') && via === 'tool') {
    const recent = await ownerMessages(cfg, session ? { sessionId, session } : sessionId, now - OWNER_ASK_MS, gateOpts);
    const asked = recent && ownerAsked(recent, kind);
    if (asked) return send({ kind, payload: req.payload, preview: req.preview, target: { ...req.target, asked: clip(asked, 40) } }, { cfg, client, entries, now, auditFile, draftsFile, how: 'owner-asked' });
  }
  // 内置门卫 + 可信会话：直接在 DSH 里弹审批卡片（同一轮里等主人点）
  if (ctx.gate === 'builtin' && ctx.trusted && approve) {
    const outcome = await approve(`B站${KIND_TEXT[kind]}：${clip(req.preview, 120)}`);
    if (outcome === 'allowed-once') return send({ kind, payload: req.payload, preview: req.preview, target: req.target }, { cfg, client, entries, now, auditFile, draftsFile, how: 'card' });
    if (outcome === 'rejected') {
      audit({ kind, status: 'rejected', target: req.target, text: req.payload?.text, how: 'card' }, auditFile);
      return { status: 'refused', text: `主人在审批卡片上点了拒绝，${NOT_DONE[kind]}。别换个说法再试。` };
    }
    // 'cancelled' / 'unavailable'（没有窗口能弹卡片）：照常起草
  }
  // 起草
  const draft = { id: drafts.next, kind, payload: req.payload, preview: req.preview, target: req.target, createdAt: now, sessionId: String(sessionId), where: ctx.label, status: 'pending' };
  drafts.next += 1;
  drafts.list.push(draft);
  saveDrafts(drafts, draftsFile);
  audit({ kind, status: 'draft', draft: draft.id, target: req.target, text: req.payload?.text, where: ctx.label }, auditFile);
  const how = ctx.gate !== 'builtin'
    ? `用你自己的话问主人一句（说清楚要${KIND_TEXT[kind]}什么）。主人回一句同意的话就行，比如${yesExamples(kind)}，不用说特定的词，也别要求主人说某个词；主人同意后调用 bili_confirm({draft: ${draft.id}})。主人说不要就调用 bili_confirm({draft: ${draft.id}, decision: "drop"})。`
    : '要主人在 DSH 设置页「B站看视频 → 互动 → 待同意」里点同意才会发出，跟主人说一声就好。';
  const why = mode === 'auto' && kind === 'follow' && !req.watched ? '最近 14 天没看过这个 UP 主的视频，所以要先问主人。' : '';
  return { status: 'draft', draft, text: `还没${KIND_TEXT[kind]}，先起草了 #${draft.id}：${clip(req.preview, 80)}。${why}${how}` };
}

/** 发出（不再检查档位和可信，只检查间隔和风控）。 */
async function send(d, { cfg, client, entries = readAudit(2000), now = Date.now(), auditFile = ACTIONS_FILE, draftsFile = DRAFTS_FILE, how = 'auto', draftId = null }) {
  const gap = LIGHT.has(d.kind) || (FOLLOW.has(d.kind) && how === 'ui') ? 5 : cfg.writeGapSeconds;
  const last = entries.find((e) => e.status === 'ok' && (LIGHT.has(d.kind) || !LIGHT.has(e.kind)));
  // 关注之间另有 10 分钟间隔；主人在设置页手动取关不受它限制
  const lastFollow = FOLLOW.has(d.kind) && how !== 'ui' ? entries.find((e) => FOLLOW.has(e.kind) && SENT.has(e.status)) : null;
  const waitFor = (e, g) => (e && now - e.at < g * 1000 ? Math.ceil((g * 1000 - (now - e.at)) / 1000) : 0);
  const wait = Math.max(waitFor(last, gap), waitFor(lastFollow, FOLLOW_GAP_S));
  if (wait > 0) {
    return { status: 'refused', text: `${NOT_DONE[d.kind]}：离上一次${waitFor(lastFollow, FOLLOW_GAP_S) ? '关注' : '写操作'}太近，${wait} 秒后再试${draftId ? `（草稿 #${draftId} 还留着）` : ''}` };
  }
  try {
    const r = await perform(client, d);
    if (r.unconfirmed) {
      audit({ kind: d.kind, status: 'unconfirmed', how, draft: draftId, target: d.target, state: r.state }, auditFile);
      pauseFollow(draftsFile, now + 24 * 3600_000, `上一次${KIND_TEXT[d.kind]}没核实到`);
      return { status: 'failed', text: `${r.info}（关系状态 ${r.state ?? '查不到'}）。照实告诉主人，别说「${KIND_TEXT[d.kind]}好了」；关注先暂停 24 小时。` };
    }
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
    return { status: 'sent', text: `${r.info}：${clip(d.preview, 80)}${unsure}`, rpid: r.rpid };
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
    let extra = RISK_CODES.has(e?.code) ? '，写操作先暂停 30 分钟' : '';
    if (FOLLOW.has(d.kind)) {
      if (e?.code === 22009) {
        try { saveConfig({ followMode: 'off' }); } catch { /* 改不了配置也要告诉主人 */ }
        extra = '。关注数到上限了，已经把「关注」关掉，告诉主人';
      } else if (!FOLLOW_STOP.has(e?.code)) {
        pauseFollow(draftsFile, now + 6 * 3600_000, `${KIND_TEXT[d.kind]}被 B站拦过（${why}）`);
        extra += '，关注先暂停 6 小时';
      }
    }
    return { status: 'failed', text: `B站拒绝了，${NOT_DONE[d.kind]}：${why}。别反复重试${extra}。` };
  }
}

function pauseFollow(draftsFile, until, reason) {
  const drafts = loadDrafts(draftsFile);
  drafts.followPausedUntil = until;
  drafts.followPauseReason = reason;
  saveDrafts(drafts, draftsFile);
}

/** 她关注的人：审计里关注成功、之后没取关的。[{mid, name, at, why}]，新的在前。 */
export function ownFollows(entries) {
  const out = new Map();
  for (const e of [...entries].reverse()) {   // 旧 → 新
    const mid = Number(e.target?.mid);
    if (!mid || !SENT.has(e.status)) continue;
    if (e.kind === 'follow') out.set(mid, { mid, name: e.target.name ?? '', at: e.at, why: e.target.why ?? '' });
    if (e.kind === 'unfollow') out.delete(mid);
  }
  return [...out.values()].reverse();
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
  if (cfg.writePaused) return { status: 'refused', text: `${NOT_DONE[d.kind]}：主人在设置页按了「全部停下」` };
  if (cfg[MODE_KEY[d.kind]] === 'off') return { status: 'refused', text: `${NOT_DONE[d.kind]}：主人把「${KIND_TEXT[d.kind]}」关了` };
  if (drafts.pausedUntil > now) return { status: 'refused', text: `${NOT_DONE[d.kind]}：写操作暂停到 ${new Date(drafts.pausedUntil).toLocaleTimeString()}（${drafts.pauseReason || '刚被风控拦过'}）` };
  let how = 'ui';
  if (via !== 'ui') {
    if (gateKind(cfg, gateOpts) === 'builtin') return { status: 'refused', text: `没法确认主人同意了：没接门卫。草稿 #${d.id} 要主人在设置页里点同意。` };
    const msgs = await ownerMessages(cfg, sessionId || d.sessionId, d.createdAt, gateOpts);
    if (!msgs) return { status: 'refused', text: '门卫没响应，没法确认主人同意了，草稿先留着。' };
    // 不带编号的表态只对最新那条待同意的草稿有效
    const newest = Math.max(...drafts.list.filter((x) => x.status === 'pending').map((x) => x.id));
    const relevant = d.id === newest ? msgs : msgs.filter((m) => /\d/.test(m.text));
    const verdict = judge(relevant, d.id, d.kind);
    if (verdict === 'no') {
      finish('rejected', 'owner');
      audit({ kind: d.kind, status: 'rejected', draft: d.id, target: d.target, text: d.payload?.text, how: 'owner' }, auditFile);
      return { status: 'refused', text: `主人说不要，草稿 #${d.id} 丢掉了，没${KIND_TEXT[d.kind]}。` };
    }
    if (verdict !== 'yes') {
      const said = msgs.filter((m) => m.text.trim()).slice(-2).map((m) => `「${clip(m.text, 30)}」`).join('、');
      return { status: 'refused', text: `还没看到主人表态（草稿 #${d.id} 之后${said ? `主人说的是：${said}，看不出是同意还是不同意` : '主人还没说话'}）。先等主人回话，或者再用自己的话问一句；${d.id === newest ? '' : `有好几条草稿时让主人带上编号（比如「#${d.id} 可以」）；`}别跟主人说只认某个词，主人说${yesExamples(d.kind)}都算。` };
    }
    how = 'owner';
  }
  const r = await send(d, { cfg, client, now, auditFile, draftsFile, how, draftId: d.id });
  if (r.status === 'sent' || r.status === 'hidden') finish('sent', r.rpid ?? '');
  else if (r.status === 'failed') finish('failed', r.text);
  return r;
}

/** 设置页：主人直接取关她关注的某个人（不看档位，只看是不是她关注的）。 */
export async function ownerUnfollow(mid, { cfg, client, auditFile = ACTIONS_FILE, draftsFile = DRAFTS_FILE, now = Date.now() } = {}) {
  const f = ownFollows(readAudit(2000, auditFile)).find((x) => x.mid === Number(mid));
  if (!f) throw new ActError('这个人不是她关注的');
  return send({ kind: 'unfollow', payload: { mid: f.mid }, preview: `取关「${f.name}」`, target: { mid: String(f.mid), name: f.name, why: '主人在设置页取关' } }, { cfg, client, now, auditFile, draftsFile, how: 'ui' });
}

/** 设置页「再核实一次」：她关注的人现在还在关注吗。返回 {checked, missing:[名字]}。 */
export async function recheckFollows({ client, auditFile = ACTIONS_FILE } = {}) {
  const list = ownFollows(readAudit(2000, auditFile));
  const missing = [];
  for (const f of list) {
    const attr = (await client.relation(f.mid).catch(() => ({ attribute: -1 }))).attribute;
    if (attr === 0) missing.push(f.name || String(f.mid));
  }
  return { checked: list.length, missing };
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
