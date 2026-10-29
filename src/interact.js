// 工具层：把模型给的参数（链接、rpid、收件箱编号）换成写操作要的参数，交给 act.js；收件箱轮询也在这里。
import { loadConfig } from './config.js';
import { loadCredential } from './credential.js';
import { InputError, makeClient, resolveVideo, clip } from './look.js';
import { request, confirm, checkText, loadDrafts, ActError } from './act.js';
import { loadInbox, saveInbox, checkInbox, deliver, inQuiet, formatInbox, markItems } from './inbox.js';

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

function writeClient(cfg) {
  const cred = loadCredential();
  if (!cred) throw new InputError('B站没登录，先在设置页扫码登录（建议用小号）');
  return makeClient({ ...cfg, useLogin: true }).client;
}

const opts = (cfg, client, exec, extra = {}) => ({ cfg, client, sessionId: sessionIdOf(exec), via: 'tool', ...extra });

async function afterSent(r, inboxId) {
  if (r.status === 'sent' && inboxId) { const st = loadInbox(); if (markItems(st, [inboxId], 'done')) saveInbox(st); }
  return r;
}

export async function likeTool(args, exec, { cfg = loadConfig() } = {}) {
  const client = writeClient(cfg);
  const { v, url } = await resolveVideo(args.url, client);
  const kind = args.fav ? 'fav' : 'like';
  return request({ kind, payload: { aid: v.aid }, preview: `《${clip(v.title, 40)}》`, target: { bvid: v.bvid, title: v.title, oid: String(v.aid), url } }, opts(cfg, client, exec));
}

export async function commentTool(args, exec, { cfg = loadConfig() } = {}) {
  const client = writeClient(cfg);
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
  const client = writeClient(cfg);
  let text;
  try { text = checkText('dm', args.text, { ownerName: await ownerName(client, cfg).catch(() => '') }); } catch (e) { if (e instanceof ActError) return { status: 'refused', text: `没发：${e.message}` }; throw e; }
  return request({ kind: 'dm', payload: { to: cfg.ownerMid, text }, preview: `私信主人：${clip(text, 60)}`, target: { to: String(cfg.ownerMid) } }, opts(cfg, client, exec));
}

export async function postTool(args, exec, { cfg = loadConfig() } = {}) {
  const client = writeClient(cfg);
  let text;
  try { text = checkText('post', args.text, { ownerName: await ownerName(client, cfg).catch(() => '') }); } catch (e) { if (e instanceof ActError) return { status: 'refused', text: `没发：${e.message}` }; throw e; }
  if (text.includes('@')) return { status: 'refused', text: '没发：动态里不 @ 人' };
  return request({ kind: 'post', payload: { text }, preview: `动态：${clip(text, 60)}`, target: {} }, opts(cfg, client, exec));
}

export async function confirmTool(args, exec, { cfg = loadConfig() } = {}) {
  const id = Math.round(Number(String(args.draft ?? '').replace(/^#/, '')));
  if (!(id > 0)) throw new InputError('draft 是草稿编号（#后面的数字）');
  const decision = args.decision === 'drop' ? 'drop' : 'send';
  const client = decision === 'send' ? writeClient(cfg) : null;
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
/**
 * 查一次并转达。force=true（设置页「现在查一次」）时不看开关、间隔和安静时段。
 * 返回 {checked, added, delivered, baseline, error?}
 */
export async function pollInbox({ force = false, cfg = loadConfig(), now = Date.now(), log = () => {} } = {}) {
  if (polling) return { checked: false, reason: '正在查' };
  const st = loadInbox();
  if (!force) {
    if (!cfg.inboxOn) return { checked: false, reason: '没开' };
    if (inQuiet(cfg.inboxQuiet, new Date(now))) return { checked: false, reason: '安静时段' };
    if (now - st.lastCheck < cfg.inboxIntervalSeconds * 1000) return { checked: false, reason: '还没到时间' };
  }
  const cred = loadCredential();
  if (!cred) { st.lastCheck = now; st.lastError = 'B站没登录'; saveInbox(st); return { checked: false, error: st.lastError }; }
  polling = true;
  try {
    const client = makeClient({ ...cfg, useLogin: true }).client;
    const r = await checkInbox(client, { cfg, selfMid: Number(cred.cookies.DedeUserID) || 0, state: st, now });
    const delivered = await deliver(st, cfg, { now });
    saveInbox(st);
    if (r.added.length) log(`收件箱：新消息 ${r.added.length} 条，转达 ${delivered} 条`);
    return { checked: true, added: r.added.length, delivered, baseline: r.baseline };
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
export function makeAsk(llm, exec, cfg, host = null) {
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
  if (!target) return null;
  return async ({ system, user, maxTokens = 800 }) => {
    let out = '';
    for await (const chunk of llm.stream({ provider: target.provider, model: target.model, system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], maxTokens, temperature: 0.3 })) {
      if (chunk?.type === 'text-delta') out += chunk.text;
      if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error(chunk.reason.failure?.message || chunk.reason.failure?.code || chunk.reason.kind);
      }
    }
    return out;
  };
}
