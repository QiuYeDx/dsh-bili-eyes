// dsh-qq 桥接（h-D-ACE/dsh-qq）适配：插件自己当门卫，不用另起服务。
// 用法：设置里「门卫来源」选 dsh-qq，填桥接目录。插件从桥接目录读：
//   config.json        主人 QQ（ownerQQ）、OneBot 地址和令牌（snowluma.httpUrl / accessToken）、控制台端口（consolePort）
//   state/console-token 控制台令牌（config.json 里没写时）
//   state/sessions.json 桥接会话 → DSH 会话 id 的对照表
// 门卫的三件事：
//   context        DSH 会话 id → 桥接会话 key：private:<主人QQ> 可信，群和别人的私聊不可信
//   ownerMessages  用 OneBot 取主人的原话（和她的私聊；草稿在群里起的，再加上那个群）
//   notify         改写桥接里停用的定时任务（「B站收件箱」「B站推荐」，没有就建）再立即运行，让她在主人私聊里醒来；
//                  桥接不通时用 OneBot 直接私聊主人一句，至少消息不丢
import fs from 'node:fs';
import path from 'node:path';

const INBOX = { name: 'B站收件箱', marker: '【新消息】', fallback: '【B站收件箱】', base: [
  'B站小号的收件箱有新消息（见下面【新消息】，由 B站插件填写）。先调用 bili_inbox 看看待处理的。',
  '值得回的评论用 bili_comment（带 inbox 编号）回一句，像真人一样短、友善，别吵架、别聊隐私；要先问主人时，用自己的话私聊问一句，主人同意了（怎么说都行）再调用 bili_confirm。主人在 B站给你的私信，直接在这里回主人就好。',
  '处理完用 bili_inbox 标记 done，不打算理的标记 ignore。不用每条都跟主人汇报，挑有意思的说一两句。这个任务平时不定时运行。',
].join('\n') };
const RECOMMEND = { name: 'B站推荐', marker: '【推荐】', fallback: '【B站推荐】', base: '你刚才自己逛 B站，逛到一条想推荐给主人的视频（见下面【推荐】，由 B站插件填写）。用你自己的口吻在私聊里告诉主人：讲了什么、你为什么觉得主人会喜欢，附上链接；一两条消息就够，别照抄推荐语。这个任务平时不定时运行。' };

const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim();
const readJson = (f, fallback = {}) => { try { return JSON.parse(readText(f)); } catch { return fallback; } };

/** 从桥接目录读出门卫要用的设置。读不到的项留空，problems 里写原因。 */
export function bridgeSettings(dir) {
  const problems = [];
  if (!dir || !fs.existsSync(path.join(dir, 'config.json'))) return { ok: false, problems: ['桥接目录里没有 config.json'] };
  const cfg = readJson(path.join(dir, 'config.json'));
  let consoleToken = String(cfg.consoleToken ?? '').trim();
  if (!consoleToken) try { consoleToken = readText(path.join(dir, 'state', 'console-token')); } catch { /* 下面报 */ }
  const s = {
    dir,
    ownerQQ: String(cfg.ownerQQ ?? '').trim(),
    consolePort: Number(cfg.consolePort) || 3300,
    oneBotHttp: String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/$/, ''),
    oneBotToken: String(cfg.snowluma?.accessToken ?? ''),
    consoleToken,
  };
  if (!/^\d{5,12}$/.test(s.ownerQQ)) problems.push('config.json 里没有主人 QQ（ownerQQ）');
  if (!consoleToken) problems.push('找不到控制台令牌（config.json 的 consoleToken 或 state/console-token）：收件箱和推荐没法叫醒她');
  return { ok: problems.length === 0, problems, ...s };
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}, fetchImpl = fetch) {
  const r = await fetchImpl(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error ?? ''}`.trim());
  return j;
}

/** 桥接会话表里，这个 DSH 会话对应的 key（private:QQ / group:群号）；找不到返回 ''。 */
export function bridgeKeyOf(dir, sessionId) {
  const st = readJson(path.join(dir, 'state', 'sessions.json'));
  for (const [k, v] of Object.entries(st.sessions ?? {})) if (v === sessionId) return k;
  return '';
}

const msgText = (m) => (m?.message ?? []).filter((x) => x.type === 'text').map((x) => x.data?.text ?? '').join('').trim();

/**
 * 门卫服务（和 biliEyesGate 进程内服务同一套方法）。
 * @param {{qqBridgeDir:string}} cfg
 * @param {{log?:Function, fetchImpl?:typeof fetch}} o
 */
export function dshQqGate(cfg, { log = () => {}, fetchImpl = fetch } = {}) {
  const dir = cfg.qqBridgeDir;
  const settings = () => bridgeSettings(dir);
  const f = (url, opts) => fetchJson(url, opts, fetchImpl);
  const oneBot = async (s, action, body) => {
    const j = await f(`${s.oneBotHttp}/${action}`, { method: 'POST', body, headers: s.oneBotToken ? { authorization: `Bearer ${s.oneBotToken}` } : {}, timeoutMs: 8000 });
    if (j?.status !== 'ok' && j?.retcode !== 0) throw new Error(`OneBot ${action} 失败：${j?.message ?? j?.wording ?? j?.retcode}`);
    return j.data;
  };
  const qqToOwner = async (s, text) => {
    if (!s.ownerQQ) return false;
    try { await oneBot(s, 'send_private_msg', { user_id: Number(s.ownerQQ), message: text }); return true; } catch (e) { log(`QQ 私聊主人失败：${e.message}`); return false; }
  };
  // 改写停用的定时任务再运行一次，叫醒她（任务按名字找，没有就建一个停用的）
  const wake = async (s, t, text) => {
    const H = { 'x-console-token': s.consoleToken };
    const api = `http://127.0.0.1:${s.consolePort}/api/scheduler`;
    let task = ((await f(api, { headers: H })).tasks ?? []).find((x) => x.name === t.name);
    if (!task) {
      if (!s.ownerQQ) throw new Error('不知道主人的 QQ');
      const r = await f(`${api}/tasks`, { method: 'POST', headers: H, body: { name: t.name, kind: 'ai', instruction: t.base, targets: [`private:${s.ownerQQ}`], schedule: { type: 'daily', times: ['03:33'] }, enabled: false } });
      task = r?.task ?? r;
      if (!task?.id) throw new Error(`建不了定时任务「${t.name}」`);
      if (task.enabled) await f(`${api}/tasks/${task.id}`, { method: 'PATCH', body: { enabled: false }, headers: H });
      log(`dsh-qq：建了停用的定时任务「${t.name}」，只用来叫醒她`);
    }
    const head = String(task.instruction || t.base).split(`\n${t.marker}`)[0].trimEnd();
    await f(`${api}/tasks/${task.id}`, { method: 'PATCH', body: { instruction: `${head}\n${t.marker}\n${text}`.slice(0, 1000) }, headers: H });
    await f(`${api}/tasks/${task.id}/run`, { method: 'POST', body: {}, headers: H, timeoutMs: 15_000 });
  };

  return {
    async hello() { return { protocol: 1, actions: ['hello', 'context', 'ownerMessages', 'notify'], name: 'dsh-qq 适配（插件内置）' }; },
    async context({ sessionId }) {
      const s = settings();
      if (sessionId === 'gate-test') return { trusted: false, label: s.ownerQQ ? `dsh-qq 桥接（主人 QQ ${s.ownerQQ.slice(0, 3)}…）` : 'dsh-qq 桥接（没读到主人 QQ）' };
      const key = bridgeKeyOf(dir, String(sessionId ?? ''));
      if (s.ownerQQ && key === `private:${s.ownerQQ}`) return { trusted: true, label: '主人私聊' };
      if (key.startsWith('group:')) return { trusted: false, label: 'QQ 群' };
      if (key.startsWith('private:')) return { trusted: false, label: '别人的私聊' };
      return { trusted: false, label: '不是主人私聊' };
    },
    async ownerMessages({ sessionId, since }) {
      const s = settings();
      if (!s.ownerQQ) return { messages: [] };
      const out = [];
      const take = (list) => {
        for (const m of list ?? []) {
          if (String(m.sender?.user_id ?? m.user_id) !== s.ownerQQ) continue;
          const at = Number(m.time) * 1000;
          if (at >= (Number(since) || 0)) out.push({ at, text: msgText(m) });
        }
      };
      take((await oneBot(s, 'get_friend_msg_history', { user_id: Number(s.ownerQQ), count: 20 }))?.messages);
      const key = bridgeKeyOf(dir, String(sessionId ?? ''));
      if (key.startsWith('group:')) take((await oneBot(s, 'get_group_msg_history', { group_id: Number(key.slice(6)), count: 30 }))?.messages);
      return { messages: out.filter((m) => m.text) };
    },
    async notify({ kind, text, items }) {
      const s = settings();
      const t = kind === 'recommend' ? RECOMMEND : INBOX;
      const body = String(text ?? '').slice(0, kind === 'recommend' ? 600 : 700);
      try {
        await wake(s, t, body);
        log(kind === 'recommend' ? `dsh-qq：已叫醒她推荐给主人（${items?.[0]?.title ?? ''}）` : `dsh-qq：已叫醒她处理收件箱（${Array.isArray(items) ? items.length : '?'} 条）`);
        return { ok: true };
      } catch (e) {
        log(`dsh-qq：叫醒失败（${e.message}），改为直接私聊主人`);
        return { ok: await qqToOwner(s, `${t.fallback}\n${body}`) };
      }
    },
  };
}

/** 设置页「检查」：读得到设置吗、OneBot 在线吗、控制台连得上吗。 */
export async function checkBridge(dir, { fetchImpl = fetch } = {}) {
  const s = bridgeSettings(dir);
  if (!s.dir) return { ok: false, problems: s.problems };
  const problems = [...s.problems];
  let oneBot = false; let consoleOk = false;
  try { const j = await fetchJson(`${s.oneBotHttp}/get_status`, { method: 'POST', body: {}, headers: s.oneBotToken ? { authorization: `Bearer ${s.oneBotToken}` } : {}, timeoutMs: 4000 }, fetchImpl); oneBot = j?.data?.online === true; } catch { /* 下面报 */ }
  if (!oneBot) problems.push(`OneBot（${s.oneBotHttp}）连不上或 QQ 不在线：认不出主人说的话，也没法直接私聊主人`);
  if (s.consoleToken) {
    try { await fetchJson(`http://127.0.0.1:${s.consolePort}/api/scheduler`, { headers: { 'x-console-token': s.consoleToken } }, fetchImpl); consoleOk = true; } catch { problems.push(`桥接控制台（端口 ${s.consolePort}）连不上：桥接没在运行？收件箱和推荐会改成直接私聊主人`); }
  }
  const sessions = Object.keys(readJson(path.join(dir, 'state', 'sessions.json')).sessions ?? {}).length;
  return { ok: problems.length === 0, problems, ownerQQ: s.ownerQQ ? `${s.ownerQQ.slice(0, 3)}…${s.ownerQQ.slice(-2)}` : '', oneBot, console: consoleOk, sessions };
}
