// 评论引擎、守评论区、收件箱提速：分类和规则、额度和间隔、未读数轮询、安静时段。全部用假的 B站 / 模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-engine-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS } = await import('../src/config.js');
const { parseVerdicts, plan, fitLength, processBatch, reportLines, sendReport, loadEngine, saveEngine, engineCount, buildPrompt } = await import('../src/engine.js');
const { videoList, togglePatch, bvList } = await import('../src/guard.js');
const { pollInbox, engineItem } = await import('../src/interact.js');
const { saveCredential } = await import('../src/credential.js');
const { loadInbox, saveInbox, feedItem, byWake } = await import('../src/inbox.js');
const { request: realRequest, readAudit } = await import('../src/act.js');

const cfgOf = (o = {}) => ({ ...DEFAULTS, ownerMid: 42, ...o });
const NOW = Date.UTC(2026, 9, 31, 6, 0, 0);
const item = (k, o = {}) => ({ key: `r${k}`, source: 'guard', oid: '100', type: 1, root: `r${k}`, parent: `r${k}`, rpid: `r${k}`, at: NOW - 60_000, user: { mid: 1000 + k, name: `路人${k}` }, text: `评论${k}`, bvid: 'BV1xx411c7mD', title: '主人的视频', ...o });
const askWith = (arr) => async () => JSON.stringify(arr);
const freshSt = () => ({ ...loadEngine(path.join(tmp, 'none.json')) });

test('模型的判断：认得出的留下，认不出的丢掉；不认识的类别当成不回', () => {
  const v = parseVerdicts('好的：[{"k":1,"cat":"question","reply":"在设置里搜","why":"问怎么装"},{"k":9,"cat":"chat"},{"k":2,"cat":"奇怪"},{"k":1,"cat":"chat"}]', 3);
  assert.equal(v.length, 2);
  assert.equal(v[0].cat, 'question');
  assert.equal(v[1].cat, 'skip');
  assert.deepEqual(parseVerdicts('不是 JSON', 2), []);
});

test('分类 → 要做什么：按设置走，闲聊按概率', () => {
  const cfg = cfgOf();
  assert.equal(plan(cfg, { cat: 'question', reply: '答案' }).act, 'write');
  assert.equal(plan(cfg, { cat: 'question', reply: '' }).act, 'notify');   // 没把握
  assert.equal(plan(cfgOf({ engAnswer: 'notify' }), { cat: 'question', reply: '答案' }).act, 'notify');
  assert.equal(plan(cfgOf({ engAnswer: 'skip' }), { cat: 'question', reply: '答案' }).act, 'skip');
  assert.equal(plan(cfg, { cat: 'chat', reply: '哈哈' }, { chance: 30, rand: () => 0.1 }).act, 'write');
  assert.equal(plan(cfg, { cat: 'chat', reply: '哈哈' }, { chance: 30, rand: () => 0.5 }).act, 'skip');
  assert.equal(plan(cfgOf({ engChat: 'skip' }), { cat: 'chat', reply: '哈哈' }, { chance: 100 }).act, 'skip');
  assert.equal(plan(cfg, { cat: 'owner' }).act, 'notify');
  assert.equal(plan(cfgOf({ engOwner: 'skip' }), { cat: 'owner' }).act, 'skip');
  assert.equal(plan(cfg, { cat: 'skip' }).act, 'skip');
});

test('超长的回复在标点处截短，截不出像样的一句就放弃', () => {
  assert.equal(fitLength('短句。', 10), '短句。');
  assert.equal(fitLength('第一句话说完了。第二句话太长太长太长太长', 12), '第一句话说完了。');
  assert.equal(fitLength('一口气说完没有任何标点的超长的一句话', 10), '');
});

test('提示词：身份、称呼、口吻、字数和问答备忘都拼进去', () => {
  const p = buildPrompt(cfgOf({ engIdentity: '女仆小鲸鱼', engOwnerName: '秋夜大人', autoSurfVoice: '爱用颜文字', engMaxLen: 80 }), [item(1)], { notes: { BV1xx411c7mD: '安装：设置里搜 dsh-bili-eyes' } });
  assert.match(p.system, /女仆小鲸鱼/);
  assert.match(p.system, /秋夜大人/);
  assert.match(p.system, /爱用颜文字/);
  assert.match(p.system, /80 字以内/);
  assert.match(p.user, /问答备忘：安装/);
  assert.match(p.user, /\[1\] 路人1：评论1/);
});

test('处理一批：主人、自己、太久的直接跳过；问题直接回，带上引擎自己的档位、额度和间隔', async () => {
  const calls = [];
  const fakeRequest = async (req) => { calls.push(req); return { status: 'sent', text: '回复发出去了' }; };
  const st = freshSt();
  const items = [item(1, { user: { mid: 42, name: '主人' } }), item(2, { user: { mid: 7, name: '她' } }), item(3, { at: NOW - 100 * 3600_000 }), item(4, { text: '怎么装？' })];
  const res = await processBatch(items, { cfg: cfgOf({ guardMode: 'auto' }), ask: askWith([{ k: 1, cat: 'question', reply: '在 DSH 设置里搜 dsh-bili-eyes 就能装～', why: '问安装' }]), client: {}, selfMid: 7, st, now: NOW, deps: { request: fakeRequest } });
  const by = Object.fromEntries(res.results.map((r) => [r.key, r]));
  assert.equal(by.r1.action, 'skipped');
  assert.equal(by.r2.action, 'skipped');
  assert.match(by.r3.why, /超过 72 小时/);
  assert.equal(by.r4.action, 'replied');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].modeKey, 'guardMode');
  assert.equal(calls[0].maxPerParent, DEFAULTS.engRounds);
  assert.equal(calls[0].gapSeconds, DEFAULTS.engGapSeconds);
  assert.equal(calls[0].quota.max, DEFAULTS.engPerDay);
  assert.equal(calls[0].target.engine, 'guard');
  assert.equal(st.decisions.length, 4);
});

test('「只告诉主人」档位：本来要回的改成转告；额度共用时不带单独额度', async () => {
  const calls = [];
  const st = freshSt();
  const res = await processBatch([item(1)], { cfg: cfgOf({ guardMode: 'notify' }), ask: askWith([{ k: 1, cat: 'question', reply: '答案～' }]), client: {}, st, now: NOW, deps: { request: async (r) => { calls.push(r); return { status: 'sent' }; } } });
  assert.equal(res.results[0].action, 'notified');
  assert.equal(calls.length, 0);
  await processBatch([item(2)], { cfg: cfgOf({ guardMode: 'auto', engQuotaShared: true }), ask: askWith([{ k: 1, cat: 'question', reply: '答案～' }]), client: {}, st, now: NOW, deps: { request: async (r) => { calls.push(r); return { status: 'sent' }; } } });
  assert.equal(calls[0].quota, undefined);
});

test('起草、离上一次太近（留着下次）、被拦（停下不再发）', async () => {
  const st = freshSt();
  const outs = [{ status: 'draft', draft: { id: 5 } }, { status: 'refused', wait: 30, text: '太近' }];
  let i = 0;
  const res = await processBatch([item(1), item(2)], { cfg: cfgOf({ guardMode: 'approve' }), ask: askWith([{ k: 1, cat: 'question', reply: '答案一～' }, { k: 2, cat: 'question', reply: '答案二～' }]), client: {}, st, now: NOW, deps: { request: async () => outs[i++] } });
  assert.equal(res.results[0].action, 'draft');
  assert.equal(res.results[0].draft, 5);
  assert.equal(res.results[1].action, 'held');
  assert.ok(!st.decisions.some((d) => d.key === 'r2'), 'held 的不记成最终结果');

  let sent = 0;
  const res2 = await processBatch([item(3), item(4)], { cfg: cfgOf({ guardMode: 'auto' }), ask: askWith([{ k: 1, cat: 'question', reply: '答案～' }, { k: 2, cat: 'question', reply: '答案～' }]), client: {}, st, now: NOW, deps: { request: async () => { sent += 1; return { status: 'failed', text: '风控' }; } } });
  assert.equal(sent, 1, '第一条被拦后不再发第二条');
  assert.equal(res2.results[0].action, 'failed');
});

test('硬规则：每个视频每小时的上限、主人回过的楼不插嘴', async () => {
  const st = freshSt();
  st.decisions = [1, 2, 3].map((k) => ({ id: `guard-x${k}`, action: 'replied', oid: '100', at: NOW - 10 * 60_000 }));
  const res = await processBatch([item(1)], { cfg: cfgOf({ guardMode: 'auto' }), ask: askWith([{ k: 1, cat: 'question', reply: '答案～' }]), client: {}, st, now: NOW, deps: { request: async () => ({ status: 'sent' }) } });
  assert.equal(res.results[0].action, 'held');
  assert.match(res.results[0].why, /这一小时已经回了 3 条/);

  const st2 = freshSt();
  const client = { commentReplies: async () => ({ list: [{ mid: 42 }] }) };
  const res2 = await processBatch([item(2, { replies: 1 })], { cfg: cfgOf({ guardMode: 'auto' }), ask: askWith([{ k: 1, cat: 'chat', reply: '哈哈～' }]), client, st: st2, now: NOW, rand: () => 0, deps: { request: async () => ({ status: 'sent' }) } });
  assert.match(res2.results[0].why, /主人已经回过/);
});

test('没有模型时整批留着下次处理', async () => {
  const st = freshSt();
  const res = await processBatch([item(1)], { cfg: cfgOf({ guardMode: 'auto' }), ask: null, client: {}, st, now: NOW });
  assert.equal(res.results[0].action, 'held');
  assert.equal(st.decisions.length, 0);
});

test('告诉主人：auto 只说回了的和要主人看的；all 连跳过的也说；超出每小时次数就攒着', async () => {
  const results = [
    { action: 'replied', user: { name: '甲' }, text: '好看', reply: '谢谢～', title: '视频' },
    { action: 'notified', user: { name: '乙' }, text: '有 bug', note: '他说装不上', url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    { action: 'skipped', user: { name: '丙' }, text: '广告', why: '广告' },
    { action: 'draft', user: { name: '丁' }, text: '问题', reply: '答案', draft: 3 },
  ];
  assert.equal(reportLines(results, 'auto').length, 3);
  assert.equal(reportLines(results, 'all').length, 4);
  assert.equal(reportLines(results, 'none').length, 2, '转告和草稿总会说');

  const st = freshSt();
  const sent = [];
  const cfg = cfgOf({ gateMode: 'auto', gateUrl: 'http://127.0.0.1:1/gate', inboxNotifyPerHour: 1 });
  assert.equal(await sendReport(['· 一行'], { cfg, st, now: NOW, notifyImpl: async (_c, text, _i, o) => { sent.push([text, o.kind]); return true; } }), true);
  assert.match(sent[0][0], /不是过期提醒/);
  assert.equal(sent[0][1], 'comments');
  assert.equal(await sendReport(['· 第二行'], { cfg, st, now: NOW + 1000, notifyImpl: async () => true }), false);
  assert.deepEqual(st.pendingReport, ['· 第二行']);
});

test('引擎单独的额度：只数引擎回的、今天的', () => {
  const entries = [
    { kind: 'reply', status: 'ok', at: NOW, target: { engine: 'guard' } },
    { kind: 'reply', status: 'hidden', at: NOW, target: { engine: 'inbox' } },
    { kind: 'reply', status: 'ok', at: NOW, target: {} },
    { kind: 'reply', status: 'ok', at: NOW - 2 * 86400_000, target: { engine: 'guard' } },
  ];
  assert.equal(engineCount(entries, NOW), 2);
});

test('act.request：引擎带的档位、单独额度和每楼次数生效', async () => {
  const auditFile = path.join(tmp, 'a-eng.jsonl'); const draftsFile = path.join(tmp, 'd-eng.json');
  const client = { addComment: async () => ({ rpid_str: '9' }) };
  const base = { kind: 'reply', payload: { oid: '1', type: 1, root: '5', parent: '5', text: '好呀' }, preview: 'x', target: { oid: '1', root: '5', parent: '5', engine: 'guard' }, modeKey: 'guardMode', modeLabel: '守评论区' };
  const cfg = cfgOf({ commentMode: 'off', guardMode: 'off' });
  const r1 = await realRequest(base, { cfg, client, via: 'background', auditFile, draftsFile });
  assert.match(r1.text, /守评论区/);
  const r2 = await realRequest({ ...base, quota: { max: 0, count: () => 0, label: '守评论区回复' } }, { cfg: cfgOf({ guardMode: 'auto' }), client, via: 'background', auditFile, draftsFile });
  assert.match(r2.text, /守评论区回复」额度用完/);
  const r3 = await realRequest({ ...base, maxPerParent: 0 }, { cfg: cfgOf({ guardMode: 'auto' }), client, via: 'background', auditFile, draftsFile });
  assert.match(r3.text, /回过 0 次/);
  const r4 = await realRequest(base, { cfg: cfgOf({ guardMode: 'approve' }), client, via: 'background', auditFile, draftsFile });
  assert.equal(r4.status, 'draft');
  assert.equal(r4.draft.modeKey, 'guardMode');
});

test('盯哪些投稿：新投稿自动加入、天数、手动加、排除；勾选改的是配置', () => {
  const st = freshSt();
  const nowS = NOW / 1000;
  st.guard.videos = {
    BV1aaaaaaaaa: { bvid: 'BV1aaaaaaaaa', title: '新的', pubdate: nowS - 86400, owner: true },
    BV1bbbbbbbbb: { bvid: 'BV1bbbbbbbbb', title: '旧的', pubdate: nowS - 90 * 86400, owner: true },
    BV1ccccccccc: { bvid: 'BV1ccccccccc', title: '别人的', pubdate: nowS, owner: false },
  };
  const cfg = cfgOf({ guardDays: 30, guardVideos: 'BV1bbbbbbbbb', guardExclude: '' });
  const list = videoList(cfg, st, NOW);
  const w = Object.fromEntries(list.map((v) => [v.bvid, v.watched]));
  assert.deepEqual(w, { BV1aaaaaaaaa: true, BV1bbbbbbbbb: true });
  // 取消勾选自动加入的 → 写进排除；取消手动加的 → 从手动列表删掉
  assert.deepEqual(togglePatch(cfg, st, 'BV1aaaaaaaaa', false, NOW), { guardExclude: 'BV1aaaaaaaaa', guardVideos: 'BV1bbbbbbbbb' });
  assert.deepEqual(togglePatch(cfg, st, 'BV1bbbbbbbbb', false, NOW), { guardExclude: '', guardVideos: '' });
  // 关了「新投稿自动加入」时勾选 → 加进手动列表
  assert.deepEqual(togglePatch(cfgOf({ guardAutoNew: false }), st, 'BV1aaaaaaaaa', true, NOW), { guardExclude: '', guardVideos: 'BV1aaaaaaaaa' });
  assert.deepEqual(bvList('BV1aaaaaaaaa，BV1aaaaaaaaa\nBV1bbbbbbbbb'), ['BV1aaaaaaaaa', 'BV1bbbbbbbbb']);
});

// ── 收件箱轮询 ──
saveCredential({ cookies: { SESSDATA: 's', bili_jct: 'j', DedeUserID: '7' } });
function inboxClient({ unread = { reply: 1, at: 0, dm: 0 }, replies = [] } = {}) {
  const calls = [];
  return {
    calls,
    unread: async () => { calls.push('unread'); return typeof unread === 'function' ? unread() : unread; },
    replyFeed: async () => { calls.push('reply'); return { items: replies }; },
    atFeed: async () => { calls.push('at'); return { items: [] }; },
    dmSessions: async () => { calls.push('dm'); return { session_list: [] }; },
  };
}
const replyIt = (id, text = '你说得对') => ({ id, reply_time: NOW / 1000 - 30, user: { mid: 500, nickname: '路人' }, item: { source_id: 900 + id, root_id: 800, subject_id: 100, business_id: 1, source_content: text, target_reply_content: '她之前说的话', title: '某视频', uri: 'https://www.bilibili.com/video/BV1xx411c7mD' } });

test('收件箱：未读数没变就不拉列表，变了才拉；兜底时间到了也拉', async () => {
  const cfg = cfgOf({ inboxOn: true, inboxQuiet: '', inboxReplyMode: 'wake', inboxPollSeconds: 20, inboxIntervalSeconds: 600 });
  const c = inboxClient();
  let r = await pollInbox({ cfg, now: NOW, deps: { client: c } });
  assert.equal(r.full, true, '第一次（没基线）一定完整查');
  c.calls.length = 0;
  r = await pollInbox({ cfg, now: NOW + 30_000, deps: { client: c } });
  assert.equal(r.full, false);
  assert.deepEqual(c.calls, ['unread']);
  r = await pollInbox({ cfg, now: NOW + 40_000, deps: { client: c } });
  assert.equal(r.reason, '还没到时间');
  const c2 = inboxClient({ unread: { reply: 2, at: 0, dm: 0 } });
  r = await pollInbox({ cfg, now: NOW + 60_000, deps: { client: c2 } });
  assert.equal(r.full, true, '未读数变了');
  r = await pollInbox({ cfg, now: NOW + 700_000, deps: { client: c2 } });
  assert.equal(r.full, true, '兜底时间到了');
});

test('收件箱：安静时段 hold 照查不处理，skip 不查；评论交给引擎，私信照旧', async () => {
  const st = loadInbox(); st.items = []; st.baseline = { reply: 0, at: 0, dmSince: 0, dm: {} }; st.lastPoll = 0; st.lastCheck = 0; saveInbox(st);
  const c = inboxClient({ unread: { reply: 5, at: 0, dm: 0 }, replies: [replyIt(1)] });
  const quietNow = new Date(NOW); quietNow.setHours(3, 0, 0, 0);
  const qcfg = cfgOf({ inboxOn: true, inboxQuiet: '00:30-07:30', inboxQuietMode: 'skip', inboxReplyMode: 'auto' });
  assert.equal((await pollInbox({ cfg: qcfg, now: quietNow.getTime(), deps: { client: c } })).reason, '安静时段');

  const calls = [];
  const deps = { client: c, writeClient: async () => ({ card: async () => ({ name: '主人' }) }), request: async (req) => { calls.push(req); return { status: 'sent', text: 'ok' }; } };
  const getAsk = () => askWith([{ k: 1, cat: 'chat', reply: '嘿嘿谢谢～' }]);
  const r1 = await pollInbox({ cfg: { ...qcfg, inboxQuietMode: 'hold', inboxChatChance: 100 }, now: quietNow.getTime(), getAsk, deps });
  assert.equal(r1.hold, true);
  assert.equal(r1.added, 1);
  assert.equal(calls.length, 0, '安静时段先攒着');
  assert.equal(loadInbox().items[0].status, 'new');

  const day = new Date(NOW); day.setHours(9, 0, 0, 0);
  const r2 = await pollInbox({ cfg: { ...qcfg, inboxQuietMode: 'hold', inboxChatChance: 100 }, now: day.getTime(), getAsk, deps });
  assert.equal(r2.handled, 1);
  assert.equal(calls[0].modeKey, 'inboxReplyMode');
  assert.equal(calls[0].payload.inbox, 'r1');
  const it = loadInbox().items[0];
  assert.equal(it.status, 'done');
  assert.equal(it.engine.action, 'replied');
});

test('收件箱条目 → 引擎条目：回复要的参数都带上', () => {
  const x = feedItem('reply', replyIt(3), 42);
  const e = engineItem(x);
  assert.equal(e.parent, '903');
  assert.equal(e.root, '800');
  assert.equal(e.oid, '100');
  assert.equal(e.mine, '她之前说的话');
  assert.equal(e.source, 'inbox');
});

test('主人的回复和 @ 不进评论引擎，叫醒她自己处理（引擎会把主人的评论当成不用回）', () => {
  const cfg = cfgOf({ inboxReplyMode: 'auto', ownerMid: 500 });
  const own = feedItem('at', replyIt(4, '@她 看看这个'), 500);
  assert.equal(own.owner, true);
  assert.equal(byWake(own, cfg), true);
  assert.equal(byWake({ ...own, owner: false }, cfg), true, '没有 owner 标记也按 UID 认');
  assert.equal(byWake(feedItem('reply', replyIt(5), 42), { ...cfg, ownerMid: 77 }), false, '别人的评论照旧交给引擎');
});
