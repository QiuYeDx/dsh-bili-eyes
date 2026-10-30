// 门卫：回答「这个会话是不是主人本人」「主人说过什么」，并转达收件箱。按顺序用第一个有的：
//   1. 进程内服务：跑在 DSH 里的桥接插件 ctx.set('biliEyesGate', {...}) 提供
//   2. HTTP 门卫：设置里的 gateUrl（本机接口）
//   3. 内置：按会话的 agentPreset / cwd 推断是不是桥接会话。这是推断，不是认证；
//      可信会话的「先问主人」走 DSH 原生审批卡片，不可信的只能在设置页同意。
// 协议（动作、字段、返回值）见 docs/门卫协议.md。门卫没响应、返回不对时一律按「不可信 / 没同意 / 没转达」处理。
export const PROTOCOL = 1;
export const SERVICE_NAME = 'biliEyesGate';
export const DEFAULT_UNTRUSTED_PRESETS = 'qq|wechat|weixin|wx|onebot|napcat|bot|group';
const TIMEOUT_MS = 3000;

// ── 宿主（index.js 在 apply 时绑上；命令行和测试里没有）────────────────────
let host = null;
export function bindHost(ctx) { host = ctx; return () => { if (host === ctx) host = null; }; }
const hostGet = (name) => { try { return host?.get?.(name) ?? null; } catch { return null; } };

function headersOf(cfg) {
  const h = { 'content-type': 'application/json' };
  const raw = String(cfg.gateHeader ?? '');
  const i = raw.indexOf(':');
  if (i > 0) h[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  return h;
}

export async function gateCall(cfg, body, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!cfg.gateUrl) throw new Error('没配门卫');
  const r = await fetchImpl(cfg.gateUrl, { method: 'POST', headers: headersOf(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`门卫返回 HTTP ${r.status}`);
  return r.json();
}

/** 现在用的是哪种门卫：'service' | 'http' | 'builtin'。 */
export function gateKind(cfg, opts = {}) {
  if (opts.service ?? hostGet(SERVICE_NAME)) return 'service';
  return cfg.gateUrl ? 'http' : 'builtin';
}

async function call(cfg, body, opts = {}) {
  const svc = opts.service ?? hostGet(SERVICE_NAME);
  if (svc) {
    if (typeof svc[body.action] !== 'function') throw new Error(`门卫服务不支持 ${body.action}`);
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('门卫服务超时')), opts.timeoutMs ?? TIMEOUT_MS); });
    try { return await Promise.race([svc[body.action](body), timeout]); } finally { clearTimeout(timer); }
  }
  return gateCall(cfg, body, opts);
}

// ── 会话 ──────────────────────────────────────────────────────────────────
/**
 * 工具调用的会话 → {sessionId, chain:[header…]}（从自己一路到根会话）。
 * who 可以是会话 id 字符串，或 {sessionId, session}（session = exec.agent.session）。
 */
export function sessionInfo(who, sessions = hostGet('sessions')) {
  if (typeof who === 'string' || who == null) return { sessionId: String(who ?? ''), chain: [] };
  let s = who.session ?? null;
  const chain = [];
  const seen = new Set();
  while (s?.header && !seen.has(s.header.id) && chain.length < 16) {
    seen.add(s.header.id);
    chain.push(s.header);
    const parent = s.header.parentSession;
    if (!parent) break;
    try { s = sessions?.get?.(parent) ?? null; } catch { s = null; }
    if (!s) { chain.push({ id: parent }); break; }   // 父会话不在内存里：只知道 id
  }
  return { sessionId: String(who.sessionId ?? chain[0]?.id ?? ''), chain };
}

/** 发给门卫的会话说明（v1 起每个请求都带；旧门卫会忽略多出来的字段）。 */
function sessionFields(chain) {
  const self = chain[0] ?? {};
  const root = chain.at(-1) ?? {};
  return { agentPreset: self.agentPreset ?? root.agentPreset ?? '', cwd: self.cwd ?? root.cwd ?? '', parentSession: self.parentSession ?? '', rootSession: root.id ?? '' };
}

/**
 * 内置判定：会话链上任何一层的 agentPreset 像桥接（规则可配），或 cwd 在不可信目录下，就不可信。
 * 其余当成主人在本机用 DSH。返回 {trusted, label, reason}。
 */
export function judgeBuiltin(cfg, chain) {
  if (!chain.length) return { trusted: true, label: '本机', reason: '拿不到会话信息（不是从 DSH 会话里调用的）' };
  let re;
  try { re = new RegExp(cfg.untrustedPresets || DEFAULT_UNTRUSTED_PRESETS, 'i'); } catch { re = new RegExp(DEFAULT_UNTRUSTED_PRESETS, 'i'); }
  const dirs = String(cfg.untrustedCwd ?? '').split(/\r?\n/).map((x) => x.trim().replace(/[\\/]+$/, '').toLowerCase()).filter(Boolean);
  for (const h of chain) {
    if (h.agentPreset && re.test(h.agentPreset)) return { trusted: false, label: `桥接会话（${h.agentPreset}）`, reason: `agentPreset「${h.agentPreset}」符合桥接规则` };
    const cwd = String(h.cwd ?? '').replace(/[\\/]+$/, '').toLowerCase();
    const hit = cwd && dirs.find((d) => cwd === d || cwd.startsWith(`${d}\\`) || cwd.startsWith(`${d}/`));
    if (hit) return { trusted: false, label: '桥接会话', reason: `工作目录在「${hit}」下` };
  }
  const preset = chain.find((h) => h.agentPreset)?.agentPreset;
  return { trusted: true, label: preset ? `本机会话（${preset}）` : '本机会话', reason: '不像桥接会话' };
}

// 最近的判定（设置页「安装检查」里显示）
const recentJudged = [];
export function recentJudgments() { return [...recentJudged]; }
function remember(info, r) {
  const id = info.sessionId;
  const i = recentJudged.findIndex((x) => x.sessionId === id);
  if (i >= 0) recentJudged.splice(i, 1);
  recentJudged.unshift({ sessionId: id, ...sessionFields(info.chain), trusted: r.trusted, label: r.label, reason: r.reason ?? '', gate: r.gate, at: Date.now() });
  recentJudged.length = Math.min(recentJudged.length, 12);
}

/** 这个会话可信吗（是不是主人本人）。{trusted, label, gate:'service'|'http'|'builtin'} */
export async function sessionContext(cfg, who, opts = {}) {
  const info = sessionInfo(who, opts.sessions);
  const kind = gateKind(cfg, opts);
  let r;
  if (kind === 'builtin') r = { ...judgeBuiltin(cfg, info.chain), gate: kind };
  else {
    try {
      const j = await call(cfg, { action: 'context', sessionId: info.sessionId, session: sessionFields(info.chain) }, opts);
      r = { trusted: j?.trusted === true, label: String(j?.label ?? ''), gate: kind };
    } catch (e) {
      r = { trusted: false, label: `门卫没响应（${e?.message ?? e}）`, gate: kind };
    }
  }
  if (info.sessionId && info.sessionId !== 'gate-test') remember(info, r);
  return r;
}

/** since 之后主人说过的话，[{at, text}]；拿不到（或内置门卫）返回 null。 */
export async function ownerMessages(cfg, who, since, opts = {}) {
  if (gateKind(cfg, opts) === 'builtin') return null;
  const info = sessionInfo(who, opts.sessions);
  try {
    const j = await call(cfg, { action: 'ownerMessages', sessionId: info.sessionId, since: Number(since) || 0, session: sessionFields(info.chain) }, opts);
    if (!Array.isArray(j?.messages)) return null;
    return j.messages.map((m) => ({ at: Number(m.at) || 0, text: String(m.text ?? '') })).filter((m) => m.at >= since);
  } catch { return null; }
}

/**
 * 转达给主人。kind：inbox 收件箱新消息（默认）/ recommend 她自己逛到、想推荐给主人的视频。
 * 成功返回 true；内置门卫没处转达，返回 false。
 */
export async function notify(cfg, text, items, opts = {}) {
  if (gateKind(cfg, opts) === 'builtin') return false;
  try { return (await call(cfg, { action: 'notify', kind: opts.kind ?? 'inbox', text, items }, opts))?.ok === true; } catch { return false; }
}

/** 握手：{protocol, actions, name}。v0 门卫（没有 hello）返回 {protocol:0}。 */
export async function hello(cfg, opts = {}) {
  const kind = gateKind(cfg, opts);
  if (kind === 'builtin') return { protocol: PROTOCOL, actions: ['context'], name: '内置', kind };
  try {
    const j = await call(cfg, { action: 'hello', protocol: PROTOCOL }, opts);
    return { protocol: Number(j?.protocol) || 0, actions: Array.isArray(j?.actions) ? j.actions : [], name: String(j?.name ?? ''), kind };
  } catch { return { protocol: 0, actions: [], name: '', kind }; }
}

/**
 * DSH 原生审批卡片（内置门卫、可信会话用）。返回 ask(text) → 'allowed-once'|'rejected'|'cancelled'|'unavailable'；
 * 宿主没有审批服务时返回 null。
 */
export function nativeApprover(exec, approval = hostGet('approval')) {
  if (!approval?.request || !exec?.agent) return null;
  return async (text) => {
    try {
      return await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: text, displayReason: text, signal: exec.signal });
    } catch { return 'unavailable'; }
  };
}
