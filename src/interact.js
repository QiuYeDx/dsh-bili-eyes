// 工具层：把模型给的参数（链接、rpid、收件箱编号）换成写操作要的参数，交给 act.js；收件箱轮询也在这里。
import { loadConfig, DEFAULTS } from './config.js';
import { loadCredential } from './credential.js';
import { InputError, makeClient, resolveVideo, clip } from './look.js';
import { request, confirm, checkText, loadDrafts, readAudit, ownFollows, ownFavs, ActError } from './act.js';
import { resolveUp } from './feed.js';
import { watchedUp } from './seen-ups.js';
import { parseInput } from './url.js';
import { nativeApprover } from './gate.js';
import { ensureDevice } from './device.js';
import { loadInbox, saveInbox, checkInbox, deliver, inQuiet, formatInbox, markItems, byWake } from './inbox.js';
import { loadEngine, saveEngine, processBatch, reportLines, sendReport, engineLock } from './engine.js';

// bili_comments 返回过的评论：rpid → {root, oid, user}。回复时靠它找到楼层（楼中楼的 root 不是它自己）。
const seenComments = new Map();
export function rememberComments(oid, list) {
  for (const c of list) {
    seenComments.set(String(c.rpid), { root: c.root && c.root !== '0' ? String(c.root) : String(c.rpid), oid: String(oid), user: c.user });
    if (seenComments.size > 2000) seenComments.delete(seenComments.keys().next().value);
  }
}

// 主人的昵称（@ 要用），缓存一小时
let ownerCache = { mid: 0, name: '', at: 0 };
export async function ownerName(client, cfg) {
  if (!cfg.ownerMid) return '';
  if (ownerCache.mid === cfg.ownerMid && Date.now() - ownerCache.at < 3600_000 && ownerCache.name) return ownerCache.name;
  const c = await client.card(cfg.ownerMid);
  ownerCache = { mid: cfg.ownerMid, name: c.name, at: Date.now() };
  return c.name;
}

/** 工具执行上下文里的会话 id（不同版本字段名不一样，挨个试）。 */
export function sessionIdOf(exec) {
  const s = exec?.agent?.session ?? exec?.session;
  for (const k of ['id', 'sessionId', 'key']) if (s && typeof s[k] === 'string' && s[k]) return s[k];
  return '';
}

/** 写操作用的客户端：已登录，并补齐设备标识（见 device.js）。 */
export async function writeClient(cfg) {
  const cred = loadCredential();
  if (!cred) throw new InputError('B站没登录，先在设置页扫码登录（建议用小号）');
  const client = makeClient({ ...cfg, useLogin: true }).client;
  await ensureDevice(client);
  return client;
}

const opts = (cfg, client, exec, extra = {}) => ({ cfg, client, sessionId: sessionIdOf(exec), session: exec?.agent?.session ?? null, approve: nativeApprover(exec), via: 'tool', ...extra });

async function afterSent(r, inboxId) {
  if (r.status === 'sent' && inboxId) { const st = loadInbox(); if (markItems(st, [inboxId], 'done')) saveInbox(st); }
  return r;
}

export async function likeTool(args, exec, { cfg = loadConfig() } = {}) {
  if (args.fav) return favTool({ url: args.url, like: true }, exec, { cfg });   // 老写法：点赞 + 收藏
  const client = await writeClient(cfg);
  const { v, url } = await resolveVideo(args.url, client);
  return request({ kind: 'like', payload: { aid: v.aid }, preview: `点赞《${clip(v.title, 40)}》`, target: { bvid: v.bvid, title: v.title, oid: String(v.aid), url } }, opts(cfg, client, exec));
}

/**
 * 收藏 / 取消收藏。收藏放进设置里的收藏夹（favFolder）；取消只能取消她自己收藏的（审计记录，或者在她的收藏夹里）。
 * like=true 时收藏前先点赞。
 */
export async function favTool(args, exec, { cfg = loadConfig() } = {}) {
  const kind = args.action === 'remove' ? 'unfav' : 'fav';
  const client = await writeClient(cfg);
  const { v, url } = await resolveVideo(args.url, client);
  const why = clip(String(args.why ?? '').replace(/\s+/g, ' ').trim(), 60);
  const rel = await client.archiveRelation(v.aid).catch(() => null);
  if (kind === 'fav' && rel?.favorite && (!args.like || rel.like)) return { status: 'refused', text: `《${clip(v.title, 30)}》已经收藏过了${args.like ? '，也赞过了' : ''}` };
  if (kind === 'unfav' && rel && !rel.favorite) return { status: 'refused', text: `《${clip(v.title, 30)}》本来就没收藏` };
  let own = false; let folderId = ''; let folder = '';
  if (kind === 'unfav') {
    const f = ownFavs(readAudit(2000)).find((x) => x.aid === Number(v.aid));
    if (f) { own = true; folderId = f.folderId; folder = f.folder; }
    else if (cfg.favFolder) {
      // 审计只留最近的记录：再看她的收藏夹里有没有
      try {
        const fo = (await client.favFolders()).find((x) => x.title === cfg.favFolder);
        if (fo && (await client.favFolderVideos(fo.id, 20)).some((x) => x.aid === Number(v.aid))) { own = true; folderId = String(fo.id); folder = fo.title; }
      } catch { /* 查不到就按不是她收藏的处理 */ }
    }
  }
  const payload = kind === 'fav' ? { aid: v.aid, ...(args.like ? { like: true } : {}) } : { aid: v.aid, folderId, folder };
  const preview = `${kind === 'fav' ? (args.like ? '点赞并收藏' : '收藏') : '取消收藏'}《${clip(v.title, 40)}》${why ? `：${why}` : ''}`;
  return request({ kind, payload, preview, target: { bvid: v.bvid, title: v.title, oid: String(v.aid), url, why }, own }, opts(cfg, client, exec));
}

export async function commentTool(args, exec, { cfg = loadConfig() } = {}) {
  const client = await writeClient(cfg);
  const name = await ownerName(client, cfg).catch(() => '');
  let kind = 'comment'; let target; let payload; let who = ''; let inboxId = '';
  if (args.inbox) {
    inboxId = String(args.inbox).trim();
    const item = loadInbox().items.find((x) => x.id === inboxId);
    if (!item) throw new InputError(`收件箱里没有 ${inboxId}`);
    if (item.kind === 'dm') throw new InputError('这是私信，不是评论；主人的私信用 bili_dm 回');
    if (!item.target || item.target.oid === '0') throw new InputError('这条消息缺少回复需要的信息，没法回');
    kind = 'reply'; who = item.user.name;
    payload = { oid: item.target.oid, type: item.target.type, root: item.target.root, parent: item.target.parent, inbox: inboxId };
    target = { ...payload, title: item.where.title, url: item.where.uri, to: who };
  } else {
    const { v, url } = await resolveVideo(args.url, client);
    const rpid = String(args.rpid ?? '').replace(/^#/, '').trim();
    if (rpid) {
      if (!/^\d{1,20}$/.test(rpid)) throw new InputError('rpid 是评论前面 # 后的那串数字');
      const known = seenComments.get(rpid);
      kind = 'reply'; who = known?.user ?? '';
      payload = { oid: String(v.aid), type: 1, root: known && known.oid === String(v.aid) ? known.root : rpid, parent: rpid };
    } else payload = { oid: String(v.aid), type: 1, root: '0', parent: '0' };
    target = { ...payload, bvid: v.bvid, title: v.title, url, to: who };
  }
  try { payload.text = checkText(kind, args.text, { ownerName: name, mention: Boolean(args.mention) }); } catch (e) { if (e instanceof ActError) return { status: 'refused', text: `没发：${e.message}` }; throw e; }
  if (name && payload.text.includes(`@${name}`)) payload.atNameToMid = { [name]: cfg.ownerMid };
  const preview = `${kind === 'reply' ? `回复${who ? ` ${who}` : ''}` : `在《${clip(target.title, 30)}》下评论`}：${clip(payload.text, 60)}`;
  return afterSent(await request({ kind, payload, preview, target }, opts(cfg, client, exec)), inboxId);
}

export async function dmTool(args, exec, { cfg = loadConfig() } = {}) {
  if (!cfg.ownerMid) return { status: 'refused', text: '没发：主人的 B站 UID 还没设置（设置页 → 互动），私信只能发给主人' };
  const client = await writeClient(cfg);
  let text;
  try { text = checkText('dm', args.text, { ownerName: await ownerName(client, cfg).catch(() => '') }); } catch (e) { if (e instanceof ActError) return { status: 'refused', text: `没发：${e.message}` }; throw e; }
  return request({ kind: 'dm', payload: { to: cfg.ownerMid, text }, preview: `私信主人：${clip(text, 60)}`, target: { to: String(cfg.ownerMid) } }, opts(cfg, client, exec));
}

export async function postTool(args, exec, { cfg = loadConfig() } = {}) {
  const client = await writeClient(cfg);
  let text;
  try { text = checkText('post', args.text, { ownerName: await ownerName(client, cfg).catch(() => '') }); } catch (e) { if (e instanceof ActError) return { status: 'refused', text: `没发：${e.message}` }; throw e; }
  if (text.includes('@')) return { status: 'refused', text: '没发：动态里不 @ 人' };
  return request({ kind: 'post', payload: { text }, preview: `动态：${clip(text, 60)}`, target: {} }, opts(cfg, client, exec));
}

/**
 * up 可以是 UID、昵称、空间链接，或者视频链接 / BV 号（取 UP 主）。返回 {mid, name}。
 */
export async function resolveFollowTarget(client, up) {
  const s = String(up ?? '').trim();
  if (!s) throw new InputError('要给 up：UID、昵称、空间链接或视频链接');
  const space = /space\.bilibili\.com\/(\d{1,19})/.exec(s);
  if (space) return resolveUp(client, space[1]);
  let video = null;
  try { video = parseInput(s); } catch { video = null; }
  if (video && (video.kind === 'short' || video.kind === 'video') && !/^\d{1,19}$/.test(s)) {
    const { v } = await resolveVideo(s, client);
    return { mid: Number(v.owner?.mid), name: v.owner?.name ?? '' };
  }
  return resolveUp(client, s);
}

export async function followTool(args, exec, { cfg = loadConfig() } = {}) {
  const kind = args.action === 'unfollow' ? 'unfollow' : 'follow';
  const why = String(args.why ?? '').replace(/\s+/g, ' ').trim();
  if (!why) throw new InputError('要写 why：为什么关注 / 取关（一句话，会记下来给主人看）');
  if (why.length > 60) throw new InputError('why 最多 60 个字');
  const client = await writeClient(cfg);
  const u = await resolveFollowTarget(client, args.up);
  if (!(u?.mid > 0)) throw new InputError('没找到这个 UP 主');
  if (u.mid === Number(client.cookies.DedeUserID)) return { status: 'refused', text: '没关注：不能关注自己' };
  const attr = (await client.relation(u.mid).catch(() => ({ attribute: -1 }))).attribute;
  if (kind === 'follow' && (attr === 2 || attr === 6)) return { status: 'refused', text: `已经关注「${u.name}」了` };
  if (kind === 'unfollow' && attr === 0) return { status: 'refused', text: `本来就没关注「${u.name}」` };
  const seen = watchedUp(u.mid);
  let own = false;
  if (kind === 'unfollow') {
    own = ownFollows(readAudit(2000)).some((f) => f.mid === u.mid);
    if (!own) {
      // 审计只留最近的记录：再看她的分组里有没有这个人
      try {
        const tag = (await client.relationTags()).find((t) => t.name === (cfg.followTag || DEFAULTS.followTag));
        if (tag) own = (await client.relationTagMembers(tag.tagid)).some((m) => m.mid === u.mid);
      } catch { /* 查不到就按不是她关注的处理 */ }
    }
  }
  const preview = `${kind === 'follow' ? '关注' : '取关'} UP 主「${u.name}」：${clip(why, 40)}${seen ? `（看过他的《${clip(seen.title, 20)}》）` : ''}`;
  return request({ kind, payload: { mid: u.mid }, preview, target: { mid: String(u.mid), name: u.name, why }, watched: Boolean(seen), own }, opts(cfg, client, exec));
}

export async function confirmTool(args, exec, { cfg = loadConfig() } = {}) {
  const id = Math.round(Number(String(args.draft ?? '').replace(/^#/, '')));
  if (!(id > 0)) throw new InputError('draft 是草稿编号（#后面的数字）');
  const decision = args.decision === 'drop' ? 'drop' : 'send';
  const client = decision === 'send' ? await writeClient(cfg) : null;
  const r = await confirm(id, decision, opts(cfg, client, exec));
  if (r.status === 'sent') {
    const d = loadDrafts().list.find((x) => x.id === id);
    if (d?.payload?.inbox) await afterSent(r, d.payload.inbox);
  }
  return r;
}

export async function inboxTool(args) {
  const st = loadInbox();
  const action = ['done', 'ignore'].includes(args.action) ? args.action : 'list';
  if (action === 'list') return { status: 'ok', text: formatInbox(st) };
  const n = markItems(st, args.ids, action === 'done' ? 'done' : 'ignored');
  saveInbox(st);
  return { status: 'ok', text: `标记了 ${n} 条为${action === 'done' ? '处理完' : '忽略'}。` };
}

// ── 收件箱轮询 ────────────────────────────────────────────────────────────
let polling = false;
const STATUS_AFTER = { replied: 'done', draft: 'notified', notified: 'notified', skipped: 'ignored', failed: 'ignored' };

/** 收件箱条目 → 评论引擎的条目 */
export function engineItem(x) {
  return { key: x.id, source: 'inbox', inbox: x.id, oid: x.target.oid, type: x.target.type, root: x.target.root, parent: x.target.parent, rpid: x.target.parent, at: x.at, user: x.user, text: x.text, mine: x.mine, bvid: x.where?.bvid ?? '', title: x.where?.title ?? '', url: x.where?.uri ?? '' };
}

/** 把还没处理的回复 / @ 交给评论引擎，结果写回收件箱条目。返回处理了几条。 */
async function handleWithEngine(st, cfg, { getAsk, now, selfMid, log, deps = {} }) {
  const items = st.items.filter((x) => x.status === 'new' && !byWake(x, cfg)).slice(0, 12);
  if (!items.length) return 0;
  return engineLock(async () => {
    const est = loadEngine();
    const client = await (deps.writeClient ?? writeClient)(cfg);
    const name = await ownerName(client, cfg).catch(() => '');
    const res = await processBatch(items.map(engineItem), { cfg, ask: getAsk?.() ?? null, client, selfMid, ownerName: name, st: est, now, deps });
    for (const r of res.results) {
      const x = st.items.find((i) => i.id === r.key);
      if (!x) continue;
      x.engine = { action: r.action, why: r.why ?? '', reply: r.reply ?? '', draft: r.draft ?? null, at: now };
      if (STATUS_AFTER[r.action]) x.status = STATUS_AFTER[r.action];
    }
    const lines = reportLines(res.results, cfg.inboxReport);
    if (lines.length) await sendReport(lines, { cfg, st: est, now });
    saveEngine(est);
    const n = res.results.filter((r) => r.action !== 'held').length;
    if (n) log(`收件箱：评论引擎处理了 ${n} 条`);
    return n;
  });
}

/**
 * 看一次。先看未读数（很轻），数字变了、或者到了兜底时间才拉完整列表。
 * 安静时段按 inboxQuietMode：skip 不查 / hold 照查但先攒着 / normal 照常。
 * force=true（设置页「现在查一次」）时不看开关、间隔和安静时段，也不攒。
 * 返回 {checked, full, added, delivered, handled, baseline, error?}
 */
export async function pollInbox({ force = false, cfg = loadConfig(), now = Date.now(), log = () => {}, getAsk = null, deps = {} } = {}) {
  if (polling) return { checked: false, reason: '正在查' };
  const st = loadInbox();
  const quiet = inQuiet(cfg.inboxQuiet, new Date(now));
  if (!force) {
    if (!cfg.inboxOn) return { checked: false, reason: '没开' };
    if (quiet && cfg.inboxQuietMode === 'skip') return { checked: false, reason: '安静时段' };
    if (now - (st.lastPoll || 0) < cfg.inboxPollSeconds * 1000) return { checked: false, reason: '还没到时间' };
  }
  const cred = loadCredential();
  if (!cred) { st.lastPoll = now; st.lastCheck = now; st.lastError = 'B站没登录'; saveInbox(st); return { checked: false, error: st.lastError }; }
  polling = true;
  try {
    const client = deps.client ?? makeClient({ ...cfg, useLogin: true }).client;
    st.lastPoll = now;
    const key = (u) => (u ? `${u.reply}/${u.at}/${cfg.inboxDm ? u.dm : '-'}` : null);
    let full = force || !st.baseline || now - st.lastCheck >= cfg.inboxIntervalSeconds * 1000;
    if (!full) {
      const k = key(await client.unread().catch(() => null));
      if (!k || k !== st.unread) full = true;
    }
    let r = { added: [], baseline: false };
    if (full) {
      r = await checkInbox(client, { cfg, selfMid: Number(cred.cookies.DedeUserID) || 0, state: st, now });
      st.unread = key(await client.unread().catch(() => null));
    }
    const hold = quiet && cfg.inboxQuietMode === 'hold' && !force;
    let delivered = 0; let handled = 0;
    if (!hold) {
      delivered = await deliver(st, cfg, { now });
      if (cfg.inboxReplyMode !== 'wake') handled = await handleWithEngine(st, cfg, { getAsk, now, selfMid: Number(cred.cookies.DedeUserID) || 0, log, deps });
    }
    st.lastError = '';
    saveInbox(st);
    if (r.added.length) log(`收件箱：新消息 ${r.added.length} 条，转达 ${delivered} 条${hold ? '（安静时段，先攒着）' : ''}`);
    return { checked: true, full, added: r.added.length, delivered, handled, hold, baseline: r.baseline };
  } catch (e) {
    st.lastCheck = now; st.lastError = clip(e?.message ?? e, 160);
    saveInbox(st);
    return { checked: false, error: st.lastError };
  } finally { polling = false; }
}

// ── 模型调用（bili_surf 用）────────────────────────────────────────────────
/**
 * 拼一个 ask({system, user, maxTokens}) → Promise<string>。
 * 模型：设置里的 surfModel → 调用它的会话正在用的 → 宿主默认；都没有返回 null（surf 会退回不用模型）。
 */
/** 用哪个模型：设置里的 surfModel → 调用它的会话正在用的 → 宿主默认。都没有返回 null。 */
export function modelTarget(llm, exec, cfg, host = null) {
  if (!llm?.stream) return null;
  let target = null;
  const m = /^([^\s/]+)\/(\S+)$/.exec(cfg.surfModel || '');
  if (m) target = { provider: m[1], model: m[2] };
  if (!target) {
    try { const c = exec?.agent?.session?.requestHeader?.()?.config; if (c?.provider && c?.model) target = { provider: c.provider, model: c.model }; } catch { /* 拿不到就下一个 */ }
  }
  if (!target) {
    try { const o = exec?.agent?.options; if (o?.provider && o?.model) target = { provider: o.provider, model: o.model }; } catch { /* 同上 */ }
  }
  if (!target) {
    try { const sel = host?.get?.('agentDefaultModel')?.currentSelection?.(); if (sel?.provider && sel?.model) target = { provider: sel.provider, model: sel.model }; } catch { /* 同上 */ }
  }
  return target;
}

/**
 * 这个模型最省的思考档位（挑选、总结、顺着逛都不需要深度思考）。模型没有思考档位时返回 undefined（不传）。
 * 适配器默认是 high，不传会白花思考 token。
 */
export async function lowestEffort(llm, target) {
  try {
    const info = await llm.resolveModelInfo?.(target.provider, target.model);
    const ids = (info?.reasoning?.efforts ?? []).map((e) => e.id);
    return ['off', 'none', 'minimal', 'low'].find((x) => ids.includes(x));
  } catch { return undefined; }
}

export function makeAsk(llm, exec, cfg, host = null) {
  const target = modelTarget(llm, exec, cfg, host);
  if (!target) return null;
  let effort;   // 第一次调用时查
  const ask = async ({ system, user, maxTokens = 800, timeoutMs = 90_000 }) => {
    if (effort === undefined) effort = (await lowestEffort(llm, target)) ?? null;
    let out = '';
    const signal = AbortSignal.timeout(timeoutMs);
    for await (const chunk of llm.stream({ provider: target.provider, model: target.model, system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], maxTokens, temperature: 0.3, signal, ...(effort ? { reasoningEffort: effort } : {}) })) {
      if (chunk?.type === 'text-delta') out += chunk.text;
      if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error(chunk.reason.failure?.message || chunk.reason.failure?.code || chunk.reason.kind);
      }
    }
    return out;
  };
  // bili_surf 的「顺着逛」要自己多轮调模型：把模型服务和目标挂在 ask 上带过去
  ask.llm = llm;
  ask.target = target;
  ask.effort = async () => { if (effort === undefined) effort = (await lowestEffort(llm, target)) ?? null; return effort ?? undefined; };
  return ask;
}
