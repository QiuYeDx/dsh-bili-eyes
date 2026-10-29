// 门卫（可选）：插件不知道「主人是谁、这条消息从哪个聊天来」，交给本机的一个 HTTP 接口回答。
//   POST gateUrl  {action:'context', sessionId}              → {trusted, label}
//   POST gateUrl  {action:'ownerMessages', sessionId, since} → {messages:[{at, text}]}
//   POST gateUrl  {action:'notify', text, items}             → {ok}
// 门卫没响应、返回不对时一律按「不可信 / 没同意 / 没转达」处理。没配门卫时：会话都当可信（单人用的桌面 DSH），
// 但草稿只能在设置页同意。
const TIMEOUT_MS = 3000;

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

/** 这个会话可信吗（是不是主人本人）。{trusted, label, gate} */
export async function sessionContext(cfg, sessionId, opts) {
  if (!cfg.gateUrl) return { trusted: true, label: '', gate: false };
  try {
    const j = await gateCall(cfg, { action: 'context', sessionId: String(sessionId ?? '') }, opts);
    return { trusted: j?.trusted === true, label: String(j?.label ?? ''), gate: true };
  } catch (e) {
    return { trusted: false, label: `门卫没响应（${e?.message ?? e}）`, gate: true };
  }
}

/** since 之后主人说过的话，[{at, text}]；拿不到返回 null。 */
export async function ownerMessages(cfg, sessionId, since, opts) {
  if (!cfg.gateUrl) return null;
  try {
    const j = await gateCall(cfg, { action: 'ownerMessages', sessionId: String(sessionId ?? ''), since: Number(since) || 0 }, opts);
    if (!Array.isArray(j?.messages)) return null;
    return j.messages.map((m) => ({ at: Number(m.at) || 0, text: String(m.text ?? '') })).filter((m) => m.at >= since);
  } catch { return null; }
}

/** 转达收件箱。成功返回 true。 */
export async function notify(cfg, text, items, opts) {
  if (!cfg.gateUrl) return false;
  try { return (await gateCall(cfg, { action: 'notify', text, items }, opts))?.ok === true; } catch { return false; }
}
