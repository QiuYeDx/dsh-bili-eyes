// 权限表：按「这类操作 × 对谁」分档、「主人开口才做」、老配置迁移、评论引擎查表。全部用假的 B站 / 门卫。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-perm-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS, migrateLegacy, permFor, permKey, friendSet, loadConfig, saveConfig, validateConfig, FIELDS, PERM_ROWS } = await import('../src/config.js');
const { request, readAudit, loadDrafts, setVerifyDelay } = await import('../src/act.js');
const { replyAudience, videoAudience, videoUp } = await import('../src/audience.js');
const { processBatch } = await import('../src/engine.js');

setVerifyDelay(1);
let n = 0;
const files = () => { n += 1; return { draftsFile: path.join(tmp, `d${n}.json`), auditFile: path.join(tmp, `a${n}.jsonl`) }; };
const cfgOf = (o = {}) => ({ ...DEFAULTS, ownerMid: 42, ...o });
const client = () => ({ addComment: async () => ({ rpid_str: '9' }), likeVideo: async () => {}, commentState: async () => 0 });
const reply = (audience, oid = '1') => ({ kind: 'reply', payload: { oid, type: 1, root: '5', parent: '5', text: '好呀' }, preview: '回复', target: { oid, root: '5', parent: '5' }, audience });
const gate = (handlers) => ({ fetchImpl: async (_url, init) => { const b = JSON.parse(init.body); const h = handlers[b.action]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; return { ok: true, json: async () => h(b) }; } });
// 反馈里要的：自己人随便，别人一律不碰
const onlyOwn = { permLikeOwn: 'auto', permCommentOwn: 'auto', permReplyOwn: 'auto', permFollowOwn: 'auto', permDm: 'auto' };

test('权限表：每类操作对应的格子；没有这一列按「外面的人」算', () => {
  assert.equal(permKey('like', 'own'), 'permLikeOwn');
  assert.equal(permKey('fav', 'out'), 'permLikeOut');
  assert.equal(permKey('like', 'home'), 'permLikeOut');
  assert.equal(permKey('reply', 'home'), 'permReplyHome');
  assert.equal(permKey('unfollow', 'own'), 'permFollowOwn');
  assert.equal(permKey('post', 'own'), 'permPost');
  assert.equal(permKey('dm', 'out'), 'permDm');
  // 判断不出是哪个对象：几格里取最严的
  const cfg = cfgOf({ permReplyOwn: 'auto', permReplyHome: 'approve', permReplyOut: 'off' });
  assert.equal(permFor(cfg, 'reply', ['own', 'home']).mode, 'approve');
  assert.equal(permFor(cfg, 'reply', ['own', 'home', 'out']).key, 'permReplyOut');
  assert.equal(permFor(cfg, 'reply', 'own').label, '回复 · 自己人');
  // 设置页的字段和 PERM_ROWS 一一对应
  const keys = PERM_ROWS.flatMap((r) => Object.values(r.cols));
  assert.deepEqual(FIELDS.filter((f) => f.group === 'perm').map((f) => f.key), keys);
});

test('自己人：主人 + 其他自己人；对象由 B站上的事实判断', async () => {
  const cfg = cfgOf({ friendMids: '100, 200\n300，abc' });
  assert.deepEqual([...friendSet(cfg)].sort((a, b) => a - b), [42, 100, 200, 300]);
  assert.equal(videoAudience(cfg, 200), 'own');
  assert.equal(videoAudience(cfg, 9), 'out');
  assert.equal(replyAudience(cfg, { mid: 42, upMid: 9 }), 'own', '在别人视频下回主人也算自己人');
  assert.equal(replyAudience(cfg, { mid: 9, upMid: 42 }), 'home');
  assert.equal(replyAudience(cfg, { mid: 9, upMid: 8 }), 'out');
  assert.deepEqual(replyAudience(cfg, { mid: 9, upMid: null }), ['home', 'out']);
  assert.deepEqual(replyAudience(cfg, { mid: 0, upMid: 8 }), ['own', 'out']);
  assert.match(validateConfig({ ...cfg, friendMids: '12 ab' }).join(), /只写 UID/);
  let views = 0;
  const c = { view: async ({ aid }) => { views += 1; return { owner: { mid: aid === 5 ? 42 : 0 } }; } };
  assert.equal(await videoUp(c, 5), 42);
  assert.equal(await videoUp(c, 5), 42);
  assert.equal(views, 1, '查过的视频记住');
});

test('只和自己人：回主人直接发；回陌生人直接拒绝，不起草', async () => {
  const f = files(); const cfg = cfgOf(onlyOwn);
  const own = await request(reply('own'), { cfg, client: client(), via: 'tool', ...f });
  assert.equal(own.status, 'sent');
  for (const aud of ['home', 'out', ['own', 'out']]) {
    const r = await request(reply(aud, String(Math.random())), { cfg, client: client(), via: 'tool', ...f, now: Date.now() + 3600_000 });
    assert.equal(r.status, 'refused', String(aud));
    assert.match(r.text, /不用起草，也不用问主人/);
  }
  assert.equal(loadDrafts(f.draftsFile).list.length, 0, '一条草稿都没有');
  const like = await request({ kind: 'like', payload: { aid: 1 }, preview: '点赞', target: {}, audience: 'out' }, { cfg, client: client(), ...files() });
  assert.match(like.text, /点赞、收藏 · 外面的人」是关着的/);
});

test('主人开口才做：主人开口要就发；她自己想做不做、也不起草；后台一律不做', async () => {
  const cfg = cfgOf({ permReplyOut: 'asked', gateUrl: 'http://127.0.0.1:1/g' });
  const asked = gate({ context: () => ({ trusted: true, label: '主人私聊' }), ownerMessages: () => ({ messages: [{ at: Date.now() - 60_000, text: '帮我回一下他' }] }) });
  const f = files();
  const r = await request(reply('out'), { cfg, client: client(), sessionId: 's', gateOpts: asked, ...f });
  assert.equal(r.status, 'sent');
  assert.equal(readAudit(5, f.auditFile)[0].how, 'owner-asked');
  const quiet = gate({ context: () => ({ trusted: true, label: '主人私聊' }), ownerMessages: () => ({ messages: [{ at: Date.now() - 60_000, text: '今天吃什么' }] }) });
  const g = files();
  const r2 = await request(reply('out'), { cfg, client: client(), sessionId: 's', gateOpts: quiet, ...g });
  assert.equal(r2.status, 'refused');
  assert.match(r2.text, /主人开口才做/);
  assert.equal(loadDrafts(g.draftsFile).list.length, 0);
  const bg = await request(reply('out'), { cfg, client: client(), via: 'background', ...files() });
  assert.equal(bg.status, 'refused');
});

test('主人开口才做 + 内置门卫：本机会话弹卡片，允许才发；没人答也不起草', async () => {
  const cfg = cfgOf({ permCommentOut: 'asked' });
  const session = { header: { id: 't', agentPreset: 'default' } };
  const req = (oid) => ({ kind: 'comment', payload: { oid, type: 1, root: '0', parent: '0', text: '好看' }, preview: '评论', target: { oid } });
  const ok = await request(req('40'), { cfg, client: client(), session, sessionId: 't', approve: async () => 'allowed-once', ...files() });
  assert.equal(ok.status, 'sent');
  const f = files();
  const none = await request(req('41'), { cfg, client: client(), session, sessionId: 't', approve: async () => 'unavailable', ...f });
  assert.equal(none.status, 'refused');
  assert.equal(loadDrafts(f.draftsFile).list.length, 0);
});

test('关注自己人：直接做不要求最近看过', async () => {
  const c = { cookies: { DedeUserID: '1' }, modifyRelation: async () => {}, relation: async () => ({ attribute: 2 }), relationTags: async () => [{ tagid: 9, name: DEFAULTS.followTag }], addToRelationTag: async () => {} };
  const r = await request({ kind: 'follow', payload: { mid: 42 }, preview: '关注主人', target: { mid: '42' }, watched: false, audience: 'own' }, { cfg: cfgOf({ permFollowOwn: 'auto' }), client: c, ...files() });
  assert.equal(r.status, 'sent');
  const out = await request({ kind: 'follow', payload: { mid: 77 }, preview: '关注', target: { mid: '77' }, watched: false, audience: 'out' }, { cfg: cfgOf({ permFollowOut: 'auto' }), client: c, ...files() });
  assert.equal(out.status, 'draft', '别的 UP 主没看过还是要先问');
});

test('老配置迁移：行为不变；已经有权限表的不再推；存一次老键就没了', () => {
  const all = migrateLegacy({ likeMode: 'auto', commentMode: 'auto', dmMode: 'auto', postMode: 'auto', followMode: 'auto', guardMode: 'auto', inboxReplyMode: 'auto' });
  for (const f of FIELDS.filter((x) => x.group === 'perm')) assert.equal(all[f.key], 'auto', f.key);
  assert.equal(all.guardMode, 'on');
  assert.equal(all.inboxReplyMode, 'engine');
  assert.equal('commentMode' in all, false);
  const mixed = migrateLegacy({ commentMode: 'approve', guardMode: 'auto', inboxReplyMode: 'notify' });
  assert.equal(mixed.permReplyHome, 'auto', '守评论区那格跟着守评论区');
  assert.equal(mixed.permReplyOut, 'approve');
  assert.equal(mixed.permCommentOut, 'approve');
  assert.equal(mixed.inboxReplyMode, 'notify');
  const inbox = migrateLegacy({ inboxReplyMode: 'approve' });
  assert.equal(inbox.permReplyHome, 'approve');
  assert.equal(inbox.permReplyOut, 'approve');
  assert.equal(inbox.permCommentOut, 'off');
  assert.deepEqual(migrateLegacy({ permReplyOwn: 'auto', commentMode: 'auto' }), { permReplyOwn: 'auto' });
  assert.deepEqual(migrateLegacy({ guardMode: 'notify', maxPerHour: 5 }), { guardMode: 'notify', maxPerHour: 5 });

  const file = path.join(tmp, 'legacy.json');
  fs.writeFileSync(file, JSON.stringify({ commentMode: 'auto', guardMode: 'approve' }));
  const cfg = loadConfig(file);
  assert.equal(cfg.permReplyHome, 'approve');
  assert.equal(cfg.permCommentOwn, 'auto');
  assert.equal(cfg.guardMode, 'on');
  assert.deepEqual(validateConfig(cfg), []);
  saveConfig({ maxPerHour: 31 }, file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.commentMode, undefined);
  assert.equal(saved.permCommentOut, 'auto');
  assert.equal(loadConfig(file).permReplyHome, 'approve');
});

test('0.6.0 留下的草稿（记的是老档位名）：那格关了就发不出去', async () => {
  const { confirm, saveDrafts } = await import('../src/act.js');
  const f = files();
  saveDrafts({ next: 2, list: [{ id: 1, kind: 'reply', payload: { oid: '1', type: 1, root: '5', parent: '5', text: 'x' }, preview: 'x', target: {}, createdAt: Date.now(), status: 'pending', modeKey: 'guardMode' }], pausedUntil: 0 }, f.draftsFile);
  const r = await confirm(1, 'send', { cfg: cfgOf({ guardMode: 'on' }), client: client(), via: 'ui', ...f });
  assert.match(r.text, /回复 · 外面的人/);
  const sent = await confirm(1, 'send', { cfg: cfgOf({ guardMode: 'on', permReplyOut: 'approve' }), client: client(), via: 'ui', ...f });
  assert.equal(sent.status, 'sent');
});

test('评论引擎：那格回不了就不回；「要主人处理的」也跳过时连模型都不问', async () => {
  const item = (k, o = {}) => ({ key: `r${k}`, source: 'guard', oid: 1, type: 1, root: String(k), parent: String(k), rpid: String(k), at: Date.now(), user: { mid: 1000 + k, name: `路人${k}` }, text: '怎么装？', bvid: 'BV1xx411c7mD', title: 't', ownerVideo: true, ...o });
  const st = { decisions: [], notes: {}, guard: { videos: {}, pending: [], seen: {} } };
  const calls = [];
  const deps = { request: async (req) => { calls.push(req); return { status: 'sent', text: 'ok' }; } };
  const ask = async () => JSON.stringify([{ k: 1, cat: 'question', reply: '在设置里装', why: '问安装' }]);
  const off = await processBatch([item(1)], { cfg: cfgOf({ guardMode: 'on' }), ask, client: {}, st, deps });
  assert.equal(off.results[0].action, 'skipped');
  assert.match(off.results[0].why, /回复 · 主人评论区里的别人」是「关」/);
  assert.equal(calls.length, 0);
  let asked = 0;
  const skip = await processBatch([item(2)], { cfg: cfgOf({ guardMode: 'on', engOwner: 'skip', permReplyHome: 'asked' }), ask: async () => { asked += 1; return '[]'; }, client: {}, st, deps });
  assert.equal(skip.results[0].action, 'skipped');
  assert.equal(asked, 0);
  // 自己人在主人评论区里说话：按「自己人」那格
  const friend = await processBatch([item(3, { user: { mid: 300, name: '小号' } })], { cfg: cfgOf({ guardMode: 'on', friendMids: '300', permReplyOwn: 'auto' }), ask, client: {}, st, deps });
  assert.equal(friend.results[0].action, 'replied');
  assert.equal(calls[0].audience, 'own');
});
