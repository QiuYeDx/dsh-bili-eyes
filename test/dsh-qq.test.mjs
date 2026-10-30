// dsh-qq 适配：门卫（会话对照、主人原话、叫醒她）和三个桥接补丁。桥接目录、OneBot、桥接控制台都是假的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-dshqq-'));
process.env.DSH_HOME = tmp;
const { dshQqGate, bridgeSettings } = await import('../src/adapters/dsh-qq.js');
const { patchStatus, applyPatches } = await import('../src/adapters/dsh-qq-patch.js');
const { gateKind, sessionContext } = await import('../src/gate.js');
const { DEFAULTS } = await import('../src/config.js');

function bridgeDir() {
  const dir = fs.mkdtempSync(path.join(tmp, 'bridge-'));
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ownerQQ: '10001', consolePort: 3300, snowluma: { httpUrl: 'http://ob/', accessToken: 'k' } }));
  fs.writeFileSync(path.join(dir, 'state', 'console-token'), 'ct\n');
  fs.writeFileSync(path.join(dir, 'state', 'sessions.json'), JSON.stringify({ sessions: { 'private:10001': 's-owner', 'private:20002': 's-other', 'group:555': 's-grp' } }));
  return dir;
}
/** 假的 OneBot + 桥接控制台：按路径回答，记下所有请求。 */
function fakeNet({ schedulerDown = false } = {}) {
  const calls = []; const tasks = [];
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method ?? 'GET', body, headers: init.headers });
    const u = new URL(url);
    if (u.host === 'ob') {
      if (u.pathname === '/get_friend_msg_history') return ok({ status: 'ok', data: { messages: [
        { time: 100, sender: { user_id: 10001 }, message: [{ type: 'text', data: { text: '旧的' } }] },
        { time: 200, sender: { user_id: 10001 }, message: [{ type: 'text', data: { text: '可以' } }] },
        { time: 210, sender: { user_id: 3606805829 }, message: [{ type: 'text', data: { text: '她自己说的' } }] },
      ] } });
      if (u.pathname === '/get_group_msg_history') return ok({ status: 'ok', data: { messages: [
        { time: 220, sender: { user_id: 20002 }, message: [{ type: 'text', data: { text: '群友：发' } }] },
        { time: 230, sender: { user_id: 10001 }, message: [{ type: 'text', data: { text: '关注吧' } }] },
      ] } });
      if (u.pathname === '/send_private_msg') return ok({ status: 'ok', data: { message_id: 1 } });
    }
    if (schedulerDown) throw new Error('ECONNREFUSED');
    if (u.pathname === '/api/scheduler') return ok({ tasks });
    if (u.pathname === '/api/scheduler/tasks' && init.method === 'POST') { const t = { id: tasks.length + 1, enabled: false, ...body }; tasks.push(t); return ok({ task: t }); }
    const m = /\/api\/scheduler\/tasks\/(\d+)(\/run)?$/.exec(u.pathname);
    if (m && !m[2]) { Object.assign(tasks[Number(m[1]) - 1], body); return ok({}); }
    if (m && m[2]) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, tasks, fetchImpl };
}

test('dsh-qq：读桥接设置；缺主人 QQ 或令牌时说清楚', () => {
  const dir = bridgeDir();
  const s = bridgeSettings(dir);
  assert.deepEqual([s.ok, s.ownerQQ, s.consoleToken, s.oneBotHttp], [true, '10001', 'ct', 'http://ob']);
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  fs.rmSync(path.join(dir, 'state', 'console-token'));
  assert.equal(bridgeSettings(dir).problems.length, 2);
  assert.equal(bridgeSettings(path.join(tmp, 'nope')).ok, false);
});

test('dsh-qq 门卫：只有主人私聊可信；只取主人的原话（群友和她自己说的不算）', async () => {
  const dir = bridgeDir(); const net = fakeNet();
  const g = dshQqGate({ qqBridgeDir: dir }, { fetchImpl: net.fetchImpl });
  assert.deepEqual(await g.context({ sessionId: 's-owner' }), { trusted: true, label: '主人私聊' });
  assert.equal((await g.context({ sessionId: 's-grp' })).trusted, false);
  assert.equal((await g.context({ sessionId: 's-other' })).label, '别人的私聊');
  assert.equal((await g.context({ sessionId: 'whatever' })).trusted, false);
  const priv = await g.ownerMessages({ sessionId: 's-owner', since: 150_000 });
  assert.deepEqual(priv.messages.map((m) => m.text), ['可以']);
  const grp = await g.ownerMessages({ sessionId: 's-grp', since: 0 });
  assert.deepEqual(grp.messages.map((m) => m.text).sort(), ['关注吧', '可以', '旧的'].sort());
  assert.equal(net.calls.find((c) => c.url.includes('get_friend')).headers.authorization, 'Bearer k');
});

test('dsh-qq 转达：没有唤醒任务就建一个停用的，改写指令再运行；桥接不通就直接私聊主人', async () => {
  const dir = bridgeDir(); const net = fakeNet();
  const g = dshQqGate({ qqBridgeDir: dir }, { fetchImpl: net.fetchImpl });
  assert.deepEqual(await g.notify({ kind: 'recommend', text: '《x》https://www.bilibili.com/video/BV1', items: [{ title: 'x' }] }), { ok: true });
  assert.equal(net.tasks.length, 1);
  assert.deepEqual([net.tasks[0].name, net.tasks[0].enabled, net.tasks[0].targets[0]], ['B站推荐', false, 'private:10001']);
  assert.match(net.tasks[0].instruction, /【推荐】\n《x》/);
  assert.ok(net.calls.some((c) => c.url.endsWith('/tasks/1/run')));
  // 第二次复用同一个任务，旧的推荐内容被换掉
  await g.notify({ kind: 'recommend', text: '第二条' });
  assert.equal(net.tasks.length, 1);
  assert.doesNotMatch(net.tasks[0].instruction, /《x》/);
  // 收件箱用另一个任务
  await g.notify({ kind: 'inbox', text: '新消息', items: [1, 2] });
  assert.deepEqual(net.tasks.map((t) => t.name), ['B站推荐', 'B站收件箱']);
  // 桥接不通：直接私聊主人
  const down = fakeNet({ schedulerDown: true });
  const g2 = dshQqGate({ qqBridgeDir: dir }, { fetchImpl: down.fetchImpl });
  assert.deepEqual(await g2.notify({ kind: 'inbox', text: '新消息' }), { ok: true });
  assert.equal(down.calls.at(-1).body.message, '【B站收件箱】\n新消息');
});

test('门卫来源：dsh-qq 要填了目录才生效；builtin 不问任何人', async () => {
  assert.equal(gateKind({ ...DEFAULTS, gateMode: 'dsh-qq', qqBridgeDir: '' }), 'builtin');
  assert.equal(gateKind({ ...DEFAULTS, gateMode: 'dsh-qq', qqBridgeDir: 'x' }), 'dsh-qq');
  assert.equal(gateKind({ ...DEFAULTS, gateMode: 'builtin', gateUrl: 'http://127.0.0.1:1/g' }), 'builtin');
  assert.equal(gateKind({ ...DEFAULTS, gateUrl: 'http://127.0.0.1:1/g' }), 'http');
  const dir = bridgeDir();
  const r = await sessionContext({ ...DEFAULTS, gateMode: 'dsh-qq', qqBridgeDir: dir }, 's-owner');
  assert.deepEqual([r.trusted, r.gate], [true, 'dsh-qq']);
});

function fakeBridgeSrc() {
  const dir = fs.mkdtempSync(path.join(tmp, 'src-'));
  fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, 'plugins', 'qq-agent-presets'), { recursive: true });
  const bridge = ['function segmentsToText(segs) {', '    switch (d.type) {', "      case 'json': out.push('[卡片消息]'); break;", '    }', '}', 'async function reportAgentError(key, error, label, { silent = false } = {}) {', '    if (!silent) await sendToQQ(key, agentErrorUserText(d, { audited: shouldAuditKey(key) }));', '}', ''].join('\r\n');
  const restrict = ['const SAFE_EXACT = new Set([', "  'read_file',", "  'todo_write',", ']);', ''].join('\r\n');
  fs.writeFileSync(path.join(dir, 'src', 'bridge.js'), bridge);
  fs.writeFileSync(path.join(dir, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs'), restrict);
  return { dir, bridge, restrict };
}

test('桥接补丁：打上、重复打不变、还原后和原文件一字不差；不像桥接的目录直接报错', () => {
  const { dir, bridge, restrict } = fakeBridgeSrc();
  assert.deepEqual([patchStatus(dir).card, patchStatus(dir).errors, patchStatus(dir).whitelist.missing.length], ['original', 'original', 13]);
  assert.ok(applyPatches(dir).every((s) => s.result === 'done'));
  const st = patchStatus(dir);
  assert.deepEqual([st.card, st.errors, st.whitelist.missing.length], ['patched', 'patched', 0]);
  assert.ok(applyPatches(dir).every((s) => s.result === 'skip'));
  const patched = fs.readFileSync(path.join(dir, 'src', 'bridge.js'), 'utf8');
  assert.ok(!/[^\r]\n/.test(patched), '保留原文件的换行（CRLF）');
  applyPatches(dir, { revert: true });
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'bridge.js'), 'utf8'), bridge);
  assert.equal(fs.readFileSync(path.join(dir, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs'), 'utf8'), restrict);
  assert.ok(fs.existsSync(path.join(dir, 'src', 'bridge.js.bak-bili-eyes')));
  assert.throws(() => applyPatches(path.join(tmp, 'empty')), /不像 dsh-qq 桥接/);
});

test('桥接补丁：桥接版本变了（找不到要改的行）就跳过并报出来，不硬改', () => {
  const { dir } = fakeBridgeSrc();
  fs.writeFileSync(path.join(dir, 'src', 'bridge.js'), '// 新版本，代码全变了\n');
  const steps = applyPatches(dir);
  assert.deepEqual(steps.filter((s) => s.result === 'fail').map((s) => s.item), ['card', 'errors']);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'bridge.js'), 'utf8'), '// 新版本，代码全变了\n');
});
