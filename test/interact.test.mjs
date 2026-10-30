// 冲浪与互动：写操作规则、草稿与同意、收件箱、门卫、写接口的请求格式、bili_surf 的流程。全部用假的 B站 / 门卫。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-act-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS } = await import('../src/config.js');
const { checkText, judge, request, confirm, readAudit, todayCounts, deleteSent, ActError } = await import('../src/act.js');
const { feedItem, dmItem, checkInbox, deliver, inQuiet, formatInbox, markItems, notifyText } = await import('../src/inbox.js');
const { sessionContext, ownerMessages } = await import('../src/gate.js');
const { BiliClient } = await import('../src/bili-api.js');
const { pickCandidates, parseJsonArray, choose } = await import('../src/surf.js');

let n = 0;
const files = () => { n += 1; return { draftsFile: path.join(tmp, `d${n}.json`), auditFile: path.join(tmp, `a${n}.jsonl`) }; };
const cfgOf = (o = {}) => ({ ...DEFAULTS, ownerMid: 42, ...o });
function fakeClient() {
  const calls = [];
  const rec = (name, ret = {}) => async (arg) => { calls.push([name, arg]); return ret; };
  return {
    calls,
    likeVideo: rec('like'), favVideo: rec('fav'), defaultFavFolder: async () => 7,
    addComment: rec('comment', { rpid: 999, rpid_str: '999' }), sendDm: rec('dm'), postDynamic: rec('post', { dyn_id_str: '555' }), delComment: rec('del'),
  };
}
const commentReq = (oid = '100') => ({ kind: 'comment', payload: { oid, type: 1, root: '0', parent: '0', text: '好看！' }, preview: '评论', target: { oid, bvid: 'BV1xx411c7mD' } });
// 假门卫：按 action 返回
const gate = (handlers) => ({ fetchImpl: async (_url, init) => { const b = JSON.parse(init.body); const h = handlers[b.action]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; return { ok: true, json: async () => h(b) }; } });

test('正文检查：链接、长数字、@ 别人都不行；mention 加上 @主人', () => {
  assert.throws(() => checkText('comment', '看这个 https://b23.tv/x'), ActError);
  assert.throws(() => checkText('comment', '我 QQ 12345678'), /5 位以上/);
  assert.throws(() => checkText('comment', '@路人 你好', { ownerName: '主人号' }), /只能 @ 主人/);
  assert.throws(() => checkText('comment', 'x'.repeat(301)), /300/);
  assert.equal(checkText('comment', '这个好看', { ownerName: '主人号', mention: true }), '@主人号 这个好看');
  assert.equal(checkText('comment', '@主人号 快看', { ownerName: '主人号', mention: true }), '@主人号 快看');
  assert.throws(() => checkText('comment', '好看', { mention: true }), /UID 还没设置/);
});

test('主人表态：新的优先，带编号只认那条，长句不算', () => {
  const m = (at, text) => ({ at, text });
  assert.equal(judge([m(1, '发'), m(2, '算了不发')], 3), 'no');
  assert.equal(judge([m(1, '不发'), m(2, '可以')], 3), 'yes');
  assert.equal(judge([m(1, '发 #2')], 3), null);
  assert.equal(judge([m(1, '发 #3')], 3), 'yes');
  assert.equal(judge([m(1, '今天好累啊，晚上吃了火锅，你觉得怎么样呢，要不要也去吃一次看看呀')], 3), null);
  assert.equal(judge([m(1, '你看着办吧')], 3), null);
});

test('档位：off 拒绝；auto 且没配门卫直接发；approve 起草', async () => {
  const f = files(); const client = fakeClient();
  assert.equal((await request(commentReq(), { cfg: cfgOf(), client, ...f })).status, 'refused');
  const sent = await request(commentReq(), { cfg: cfgOf({ commentMode: 'auto' }), client, ...f });
  assert.equal(sent.status, 'sent');
  assert.equal(client.calls[0][0], 'comment');
  const f2 = files();
  const d = await request(commentReq(), { cfg: cfgOf({ commentMode: 'approve' }), client, ...f2 });
  assert.equal(d.status, 'draft');
  assert.equal(d.draft.id, 1);
  assert.match(d.text, /设置页/);
  const again = await request(commentReq(), { cfg: cfgOf({ commentMode: 'approve' }), client, ...f2 });
  assert.equal(again.draft.id, 1, '同样的内容不重复起草');
});

test('同一视频只评论一次、每日额度、两次之间的间隔、全部停下', async () => {
  const f = files(); const client = fakeClient();
  const cfg = cfgOf({ commentMode: 'auto', likeMode: 'auto', likePerDay: 1, writeGapSeconds: 60 });
  const t0 = Date.now();
  assert.equal((await request(commentReq('1'), { cfg, client, now: t0, ...f })).status, 'sent');
  assert.match((await request(commentReq('1'), { cfg, client, now: t0 + 120_000, ...f })).text, /已经评论过/);
  assert.match((await request(commentReq('2'), { cfg, client, now: t0 + 1000, ...f })).text, /太近/);
  assert.equal((await request(commentReq('2'), { cfg, client, now: t0 + 61_000, ...f })).status, 'sent');
  const like = { kind: 'like', payload: { aid: 5 }, preview: 'x', target: { oid: '5' } };
  assert.equal((await request(like, { cfg, client, now: t0 + 70_000, ...f })).status, 'sent');
  assert.match((await request({ ...like, kind: 'fav' }, { cfg, client, now: t0 + 80_000, ...f })).text, /额度用完/);
  assert.match((await request(commentReq('3'), { cfg: { ...cfg, writePaused: true }, client, ...f })).text, /全部停下/);
  assert.equal(todayCounts(readAudit(100, f.auditFile), t0 + 90_000).comment, 2);
});

test('门卫：群聊不可信 → auto 也起草；主人同意后 bili_confirm 发出；主人说不发就丢掉', async () => {
  const f = files(); const client = fakeClient();
  const cfg = cfgOf({ commentMode: 'auto', gateUrl: 'http://127.0.0.1:1/gate' });
  let said = [];
  const g = gate({ context: (b) => ({ trusted: b.sessionId === 'priv', label: b.sessionId === 'priv' ? '主人私聊' : '群' }), ownerMessages: () => ({ messages: said }) });
  const d = await request(commentReq('10'), { cfg, client, sessionId: 'grp', gateOpts: g, ...f });
  assert.equal(d.status, 'draft');
  assert.match(d.text, /bili_confirm/);
  // 主人还没说话
  assert.match((await confirm(d.draft.id, 'send', { cfg, client, sessionId: 'grp', gateOpts: g, ...f })).text, /还没看到主人同意/);
  said = [{ at: Date.now() + 10, text: '可以' }];
  const ok = await confirm(d.draft.id, 'send', { cfg, client, sessionId: 'grp', gateOpts: g, ...f });
  assert.equal(ok.status, 'sent');
  // 私聊可信 → 直接发
  assert.equal((await request(commentReq('11'), { cfg: { ...cfg, writeGapSeconds: 10 }, client, sessionId: 'priv', gateOpts: g, now: Date.now() + 20_000, ...f })).status, 'sent');
  // 不发
  const d2 = await request(commentReq('12'), { cfg, client, sessionId: 'grp', gateOpts: g, ...f });
  said = [{ at: Date.now() + 10, text: '别发了' }];
  assert.match((await confirm(d2.draft.id, 'send', { cfg, client, sessionId: 'grp', gateOpts: g, ...f })).text, /丢掉/);
});

test('门卫没响应：按不可信处理，确认也拒绝', async () => {
  const cfg = cfgOf({ gateUrl: 'http://127.0.0.1:1/gate' });
  const dead = { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } };
  const c = await sessionContext(cfg, 's', dead);
  assert.equal(c.trusted, false);
  assert.equal(await ownerMessages(cfg, 's', 0, dead), null);
  assert.equal((await sessionContext(cfgOf(), 's')).trusted, true, '没配门卫时都可信');
});

test('草稿：设置页同意直接发；过期作废；没配门卫时模型确认不了', async () => {
  const f = files(); const client = fakeClient();
  const cfg = cfgOf({ commentMode: 'approve' });
  const d = await request(commentReq('20'), { cfg, client, ...f });
  assert.match((await confirm(d.draft.id, 'send', { cfg, client, ...f })).text, /没接门卫/);
  assert.equal((await confirm(d.draft.id, 'send', { cfg, client, via: 'ui', ...f })).status, 'sent');
  const d2 = await request(commentReq('21'), { cfg, client, ...f });
  assert.match((await confirm(d2.draft.id, 'send', { cfg, client, via: 'ui', now: Date.now() + 61 * 60_000, ...f })).text, /过期/);
});

test('风控错误：自动暂停 30 分钟', async () => {
  const f = files();
  const client = { ...fakeClient(), addComment: async () => { const e = new Error('风控'); e.code = -352; throw e; } };
  const cfg = cfgOf({ commentMode: 'auto' });
  assert.equal((await request(commentReq('30'), { cfg, client, ...f })).status, 'failed');
  assert.match((await request(commentReq('31'), { cfg, client, now: Date.now() + 120_000, ...f })).text, /暂停/);
});

test('删除自己发的评论', async () => {
  const f = files(); const client = fakeClient();
  await request(commentReq('40'), { cfg: cfgOf({ commentMode: 'auto' }), client, ...f });
  const e = readAudit(10, f.auditFile).find((x) => x.status === 'ok');
  assert.equal(e.rpid, '999');
  await deleteSent(e.id, { client, auditFile: f.auditFile });
  assert.deepEqual(client.calls.at(-1), ['del', { oid: '40', type: 1, rpid: '999' }]);
});

// ── 写接口的请求格式 ───────────────────────────────────────────────────────
function recordingClient() {
  const reqs = [];
  const fetchImpl = async (url, init = {}) => {
    reqs.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers });
    if (String(url).includes('/nav')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { wbi_img: { img_url: 'https://x/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://x/6789abcdefghijklmnopqrstuvwxyzAB.png' } } }) };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { rpid: 1 } }) };
  };
  return { reqs, client: new BiliClient({ cookies: { SESSDATA: 's', bili_jct: 'CSRF', DedeUserID: '77' }, minIntervalMs: 0, fetchImpl }) };
}

test('写接口：评论、楼中楼、@、点赞、私信、动态的请求格式', async () => {
  const { reqs, client } = recordingClient();
  await client.addComment({ oid: 100, type: 1, message: '@主人号 hi', root: '5', parent: '6', atNameToMid: { 主人号: 42 } });
  let r = reqs.at(-1);
  assert.equal(r.method, 'POST');
  assert.match(r.url, /x\/v2\/reply\/add\?/);
  const query = new URL(r.url).searchParams;
  assert.equal(query.get('web_location'), '1550101');
  assert.match(query.get('w_rid'), /^[0-9a-f]{32}$/);
  assert.equal(query.get('dm_img_list'), '[]');
  assert.match(query.get('dm_img_str'), /^[A-K]{2}$/);
  assert.match(query.get('dm_img_inter'), /"wh":\[0,0,0\]/);
  const form = new URLSearchParams(r.body);
  assert.equal(form.get('csrf'), 'CSRF');
  assert.equal(form.get('csrf_token'), 'CSRF');
  assert.equal(form.get('root'), '5');
  assert.equal(form.get('parent'), '6');
  assert.deepEqual(JSON.parse(form.get('at_name_to_mid')), { 主人号: 42 });
  assert.equal(r.headers.origin, 'https://www.bilibili.com');
  // 末尾不能带斜杠：带了 B站会把评论设成仅自己可见
  assert.equal(r.headers.referer, 'https://www.bilibili.com');
  await client.addComment({ oid: 100, message: 'top' });
  assert.equal(new URLSearchParams(reqs.at(-1).body).get('root'), null, '顶层评论不带 root');
  await client.likeVideo(9);
  assert.equal(new URLSearchParams(reqs.at(-1).body).get('like'), '1');
  await client.sendDm({ receiverMid: 42, text: '你好', devId: 'DEV' });
  r = reqs.at(-1);
  assert.match(r.url, /send_msg\?.*w_sender_uid=77.*w_rid=/);
  const dm = new URLSearchParams(r.body);
  assert.equal(dm.get('msg[receiver_id]'), '42');
  assert.equal(JSON.parse(dm.get('msg[content]')).content, '你好');
  assert.equal(dm.get('csrf_token'), 'CSRF');
  await client.postDynamic('今天逛到好东西');
  r = reqs.at(-1);
  assert.match(r.url, /create\/dyn\?platform=web&csrf=CSRF/);
  assert.equal(JSON.parse(r.body).dyn_req.content.contents[0].raw_text, '今天逛到好东西');
  const noLogin = new BiliClient({ cookies: {}, fetchImpl: async () => { throw new Error('不该请求'); } });
  assert.throws(() => noLogin.likeVideo(1), /没登录/);
});

// ── 收件箱 ────────────────────────────────────────────────────────────────
const replyIt = (id, mid = 9) => ({ id, user: { mid, nickname: `u${mid}` }, item: { subject_id: 100, root_id: 0, source_id: 500 + id, business_id: 1, title: '某视频', uri: 'https://www.bilibili.com/video/BV1xx411c7mD', source_content: `回复${id}`, target_reply_content: '我的评论' }, reply_time: 1000 + id });

test('收件箱：第一次只记基线，之后只收新的；目标参数对', async () => {
  let replies = [replyIt(1), replyIt(2)];
  const client = { replyFeed: async () => ({ items: replies }), atFeed: async () => ({ items: [] }), dmSessions: async () => ({ session_list: [] }) };
  const cfg = cfgOf({ inboxDm: false });
  const st = { baseline: null, items: [], notifiedAt: [], lastCheck: 0, lastError: '' };
  const first = await checkInbox(client, { cfg, selfMid: 77, state: st });
  assert.equal(first.baseline, true);
  assert.equal(first.added.length, 0);
  replies = [replyIt(3, 42), ...replies];
  const r = await checkInbox(client, { cfg, selfMid: 77, state: st });
  assert.equal(r.added.length, 1);
  const x = r.added[0];
  assert.equal(x.id, 'r3');
  assert.equal(x.owner, true);
  assert.deepEqual(x.target, { oid: '100', type: 1, root: '503', parent: '503' });
  assert.match(formatInbox(st), /\[r3\] 回复 · u42（主人）在《某视频》回复了我（我说的是：我的评论）：回复3/);
  assert.equal((await checkInbox(client, { cfg, selfMid: 77, state: st })).added.length, 0, '不重复');
  assert.equal(markItems(st, ['r3'], 'done'), 1);
  assert.match(formatInbox(st), /没有待处理/);
});

test('收件箱：私信只要文字/图片/分享，自己发的不算', async () => {
  assert.equal(dmItem({ msg_type: 10, content: '{"title":"系统"}' }), null);
  assert.equal(dmItem({ msg_type: 1, content: '{"content":"在吗"}', sender_uid: 42, msg_seqno: 3, timestamp: 5 }, 42).owner, true);
  const now = 1_700_000_000_000;
  const msgs = [{ msg_seqno: 2, sender_uid: 42, msg_type: 1, content: '{"content":"新的"}', timestamp: now / 1000 + 10 }, { msg_seqno: 1, sender_uid: 77, msg_type: 1, content: '{"content":"我发的"}', timestamp: now / 1000 + 5 }];
  const client = { replyFeed: async () => ({ items: [] }), atFeed: async () => ({ items: [] }), dmSessions: async () => ({ session_list: [{ talker_id: 42, unread_count: 1, last_msg: { msg_type: 1 } }] }), dmMessages: async () => ({ messages: msgs }) };
  const st = { baseline: { reply: 0, at: 0, dmSince: now / 1000, dm: {} }, items: [], notifiedAt: [], lastCheck: 0, lastError: '' };
  const r = await checkInbox(client, { cfg: cfgOf(), selfMid: 77, state: st, now });
  assert.deepEqual(r.added.map((x) => x.text), ['新的']);
});

test('收件箱：转达按每小时上限节流，门卫失败不标记', async () => {
  const st = { items: [feedItem('reply', replyIt(1)), feedItem('at', replyIt(2))], notifiedAt: [] };
  const cfg = cfgOf({ gateUrl: 'http://127.0.0.1:1/gate', inboxNotifyPerHour: 1 });
  assert.equal(await deliver(st, cfg, { notifyImpl: async () => false }), 0);
  assert.equal(st.items[0].status, 'new');
  let text = '';
  assert.equal(await deliver(st, cfg, { notifyImpl: async (_c, t) => { text = t; return true; } }), 2);
  assert.match(text, /收到 2 条新消息/);
  st.items.push(feedItem('reply', replyIt(3)));
  assert.equal(await deliver(st, cfg, { notifyImpl: async () => true }), 0, '这一小时已经转达过一次');
  assert.match(notifyText([st.items[1]]), /@ 了我/);
});

test('安静时段：可跨午夜', () => {
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuiet('00:30-07:30', at(3, 0)), true);
  assert.equal(inQuiet('00:30-07:30', at(8, 0)), false);
  assert.equal(inQuiet('23:00-07:00', at(23, 30)), true);
  assert.equal(inQuiet('23:00-07:00', at(12, 0)), false);
  assert.equal(inQuiet('', at(3, 0)), false);
});

// ── 冲浪 ──────────────────────────────────────────────────────────────────
const v = (bvid, play = 1, seconds = 100) => ({ bvid, title: bvid, author: 'up', seconds, play, danmaku: 0, pubdate: 0, desc: '' });

test('冲浪：候选交错合并、去重、去掉逛过的和太长的', () => {
  const out = pickCandidates([[v('a'), v('b'), v('c', 1, 99999)], [v('b'), v('d'), v('e')]], { seen: { e: 1 }, maxSeconds: 3600, limit: 10 });
  assert.deepEqual(out.map((x) => x.bvid), ['a', 'b', 'd']);
});

test('冲浪：模型挑选；输出不对时按播放量挑', async () => {
  const cands = [v('a', 5), v('b', 50), v('c', 500), v('d', 1)];
  assert.deepEqual(parseJsonArray('好的：[{"i":2,"why":"有趣"}] 完'), [{ i: 2, why: '有趣' }]);
  const picked = await choose(cands, { ask: async () => '[{"i":4,"why":"冷门"},{"i":4},{"i":9},{"i":1,"why":"好"}]', picks: 2 });
  assert.deepEqual(picked.map((p) => p.x.bvid), ['d', 'a']);
  const fallback = await choose(cands, { ask: async () => '我不知道', picks: 2 });
  assert.deepEqual(fallback.map((p) => p.x.bvid), ['c', 'b']);
  const failing = await choose(cands, { ask: async () => { throw new Error('模型挂了'); }, picks: 1 });
  assert.deepEqual(failing.map((p) => p.x.bvid), ['c']);
});

// ── 评论被设成「仅自己可见」 ───────────────────────────────────────────────
const { setVerifyDelay, recheckHidden } = await import('../src/act.js');
const { withDevice, makeUuid, ticketSign, ensureDevice } = await import('../src/device.js');
setVerifyDelay(0);

test('仅自己可见：照实说、记成 hidden、算额度、暂停写操作', async () => {
  const f = files();
  const client = { ...fakeClient(), commentState: async () => 17 };
  const cfg = cfgOf({ commentMode: 'auto' });
  const r = await request(commentReq('50'), { cfg, client, ...f });
  assert.equal(r.status, 'hidden');
  assert.match(r.text, /仅自己可见/);
  assert.match(r.text, /别说「发好了」/);
  const e = readAudit(10, f.auditFile)[0];
  assert.equal(e.status, 'hidden');
  assert.equal(todayCounts(readAudit(10, f.auditFile)).comment, 1);
  assert.match((await request(commentReq('51'), { cfg, client, now: Date.now() + 120_000, ...f })).text, /仅自己可见.*暂停/);
  assert.match((await request(commentReq('50'), { cfg, client, now: Date.now() + 3 * 3600_000, ...f })).text, /已经评论过/, '隐藏的也算评论过');
});

test('返回里没带状态时自己查一次：公开就说已确认，查不到就说没确认', async () => {
  const f = files(); const f2 = files();
  const pub = { ...fakeClient(), commentState: async (q) => { assert.equal(q.rpid, '999'); return 0; } };
  assert.match((await request(commentReq('60'), { cfg: cfgOf({ commentMode: 'auto' }), client: pub, ...f })).text, /已确认公开/);
  const unknown = { ...fakeClient(), commentState: async () => null };
  assert.match((await request(commentReq('61'), { cfg: cfgOf({ commentMode: 'auto' }), client: unknown, ...f2 })).text, /没能确认/);
});

test('接口返回的 reply.state 是乐观值：它说 0 也要自己查，查到 17 就算 hidden', async () => {
  const f = files();
  const client = { ...fakeClient(), addComment: async () => ({ rpid: 7, rpid_str: '7', reply: { state: 0 } }), commentState: async () => 17 };
  const r = await request(commentReq('62'), { cfg: cfgOf({ commentMode: 'auto' }), client, ...f });
  assert.equal(r.status, 'hidden');
  assert.match(r.text, /仅自己可见/);
});

test('刚发出去还在审核：查几次，变公开了就算成功', async () => {
  const f = files();
  const seq = [17, 17, 0];
  const client = { ...fakeClient(), commentState: async () => seq.shift() };
  const r = await request(commentReq('63'), { cfg: cfgOf({ commentMode: 'auto' }), client, ...f });
  assert.equal(r.status, 'sent');
  assert.match(r.text, /已确认公开/);
});

test('楼中楼查可见性时带上它所在的楼', async () => {
  const f = files(); let asked = null;
  const client = { ...fakeClient(), commentState: async (q) => { asked = q; return 17; } };
  const req = { kind: 'reply', payload: { oid: '70', type: 1, root: '500', parent: '501', text: '同意' }, preview: '回复', target: { oid: '70', root: '500', parent: '501' } };
  assert.equal((await request(req, { cfg: cfgOf({ commentMode: 'auto' }), client, ...f })).status, 'hidden');
  assert.deepEqual(asked, { oid: '70', type: 1, rpid: '999', root: '500' });
});

test('再查一次：变公开的记成 visible，删过的不查', async () => {
  const f = files();
  let calls = 0;
  // 第一次发完查 3 次都是 17 → 记成 hidden；之后再查变成 0 → visible
  const client = { ...fakeClient(), commentState: async () => (++calls <= 3 ? 17 : 0) };
  await request(commentReq('80'), { cfg: cfgOf({ commentMode: 'auto' }), client, ...f });
  const r = await recheckHidden({ client, auditFile: f.auditFile });
  assert.deepEqual(r, { checked: 1, nowVisible: 1 });
  assert.deepEqual(await recheckHidden({ client, auditFile: f.auditFile }), { checked: 0, nowVisible: 0 });
});

test('发评论带上网页端的字段；设备标识固定、ticket 签名正确', async () => {
  const { reqs, client } = recordingClient();
  await client.addComment({ oid: 1, message: 'hi' });
  const form = new URLSearchParams(reqs.at(-1).body);
  assert.equal(form.get('gaia_source'), 'main_web');
  assert.equal(form.get('plat'), '1');
  assert.deepEqual(JSON.parse(form.get('statistics')), { appId: 100, platform: 5 });
  assert.match(makeUuid(1_700_000_012_345), /^[0-9A-F-]{36}12345infoc$/);
  assert.equal(ticketSign(1700000000), require('node:crypto').createHmac('sha256', 'XgwSnGZ1p').update('ts1700000000').digest('hex'));
  assert.deepEqual(withDevice({ SESSDATA: 's', buvid3: 'mine' }, { buvid3: 'dev', _uuid: 'u' }), { SESSDATA: 's', buvid3: 'mine', _uuid: 'u' });
  const file = path.join(tmp, 'device.json');
  const calls = [];
  const fake = { cookies: { SESSDATA: 's', bili_jct: 'c' }, request: async (url) => { calls.push(url); return url.includes('spi') ? { b_3: 'B3', b_4: 'B4' } : { ticket: 'T', created_at: 100, ttl: 259200 }; } };
  await ensureDevice(fake, { file, now: 100_000 });
  assert.equal(fake.cookies.buvid3, 'B3');
  assert.equal(fake.cookies.bili_ticket, 'T');
  assert.match(calls[1], /GenWebTicket\?key_id=ec02&hexsign=[0-9a-f]{64}&context%5Bts%5D=100&csrf=c/);
  const again = { cookies: { SESSDATA: 's', bili_jct: 'c' }, request: async () => { throw new Error('不该再请求'); } };
  await ensureDevice(again, { file, now: 100_000 });
  assert.equal(again.cookies.buvid3, 'B3', '第二次直接用存下来的');
});

// ── 关注 ──────────────────────────────────────────────────────────────────
function followClient({ attr = 2, failWith = null } = {}) {
  const calls = [];
  const tags = [];
  return {
    calls,
    cookies: { DedeUserID: '1' },
    modifyRelation: async (mid, act) => { calls.push(['modify', mid, act]); if (failWith) { const e = new Error('x'); e.code = failWith; throw e; } },
    relation: async () => ({ attribute: attr }),
    relationTags: async () => tags,
    createRelationTag: async (name) => { calls.push(['tag', name]); tags.push({ tagid: 9, name }); return 9; },
    addToRelationTag: async (mid, tagid) => { calls.push(['addTag', mid, tagid]); },
  };
}
const followReq = (o = {}) => ({ kind: 'follow', payload: { mid: 77 }, preview: '关注', target: { mid: '77', name: 'UP', why: '好看' }, watched: true, ...o });

test('关注：直接发只对看过的 UP 主；发完核实并放进她的分组', async () => {
  const { setVerifyDelay } = await import('../src/act.js');
  setVerifyDelay(1);
  const f = files(); const client = followClient();
  const cfg = cfgOf({ followMode: 'auto' });
  const notSeen = await request(followReq({ watched: false, payload: { mid: 76 }, target: { mid: '76' } }), { cfg, client, ...f });
  assert.equal(notSeen.status, 'draft');
  assert.match(notSeen.text, /14 天没看过/);
  const r = await request(followReq(), { cfg, client, ...f });
  assert.equal(r.status, 'sent');
  assert.match(r.text, /已关注（已核实）/);
  assert.deepEqual(client.calls.map((c) => c[0]), ['modify', 'tag', 'addTag']);
  // 10 分钟内不能再关注
  const again = await request(followReq({ payload: { mid: 78 }, target: { mid: '78' } }), { cfg, client, ...f, now: Date.now() + 60_000 });
  assert.match(again.text, /关注太近/);
});

test('关注：核实不到就记 unconfirmed、关注暂停 24 小时；22009 关掉关注', async () => {
  const f = files();
  const r = await request(followReq(), { cfg: cfgOf({ followMode: 'auto' }), client: followClient({ attr: 0 }), ...f });
  assert.equal(r.status, 'failed');
  assert.match(r.text, /暂停 24 小时/);
  assert.equal(readAudit(10, f.auditFile)[0].status, 'unconfirmed');
  const later = await request(followReq(), { cfg: cfgOf({ followMode: 'auto' }), client: followClient(), ...f, now: Date.now() + 3600_000 });
  assert.match(later.text, /关注暂停到/);
  const g = files();
  const full = await request(followReq(), { cfg: cfgOf({ followMode: 'auto' }), client: followClient({ failWith: 22009 }), ...g });
  assert.match(full.text, /已经把「关注」关掉/);
  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig().followMode, 'off');
  const h = files();
  const priv = await request(followReq(), { cfg: cfgOf({ followMode: 'auto' }), client: followClient({ failWith: 22002 }), ...h });
  assert.doesNotMatch(priv.text, /暂停/);
});

test('取关：只能取关她自己关注的；直接发也要先问主人', async () => {
  const f = files(); const client = followClient({ attr: 0 });
  const cfg = cfgOf({ followMode: 'auto' });
  const notOwn = await request({ ...followReq(), kind: 'unfollow', own: false }, { cfg, client, ...f });
  assert.equal(notOwn.status, 'refused');
  assert.match(notOwn.text, /自己关注的人/);
  const own = await request({ ...followReq(), kind: 'unfollow', own: true }, { cfg, client, ...f });
  assert.equal(own.status, 'draft');
});

test('她的关注：关注成功、之后取关的不算', async () => {
  const { ownFollows } = await import('../src/act.js');
  const e = (at, kind, mid, status = 'ok') => ({ at, kind, status, target: { mid: String(mid), name: `u${mid}` } });
  const list = ownFollows([e(5, 'unfollow', 2), e(4, 'follow', 3, 'fail'), e(3, 'follow', 2), e(2, 'follow', 1), e(1, 'like', 9)]);
  assert.deepEqual(list.map((x) => x.mid), [1]);
});

test('关注接口：不带 WBI、字段和空间页一致', async () => {
  const seen = [];
  const c = new BiliClient({ cookies: { SESSDATA: 's', bili_jct: 'j', DedeUserID: '1' }, minIntervalMs: 0, fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) }; } });
  await c.modifyRelation(77, 1);
  const { url, init } = seen[0];
  assert.match(url, /x\/relation\/modify\?statistics=/);
  assert.doesNotMatch(url, /w_rid/);
  const form = new URLSearchParams(init.body);
  assert.equal(form.get('fid'), '77');
  assert.equal(form.get('act'), '1');
  assert.equal(form.get('csrf'), 'j');
  assert.equal(form.get('gaia_source'), 'web_main');
  assert.equal(JSON.parse(form.get('extend_content')).entity_id, 77);
});

// ── 内置门卫 ──────────────────────────────────────────────────────────────
test('内置门卫：沿父会话找到根，桥接 preset / 不可信目录判成不可信', async () => {
  const { sessionInfo, judgeBuiltin } = await import('../src/gate.js');
  const root = { header: { id: 'r', agentPreset: 'qq-chat-group' } };
  const sub = { header: { id: 's', parentSession: 'r', origin: 'subagent' } };
  const sessions = { get: (id) => ({ r: root }[id]) };
  const info = sessionInfo({ session: sub }, sessions);
  assert.deepEqual(info.chain.map((h) => h.id), ['s', 'r']);
  assert.equal(judgeBuiltin(cfgOf(), info.chain).trusted, false);
  assert.equal(judgeBuiltin(cfgOf(), [{ id: 'a', agentPreset: 'default' }]).trusted, true);
  assert.equal(judgeBuiltin(cfgOf({ untrustedCwd: 'E:\\fish\\qq\n' }), [{ id: 'a', cwd: 'e:\\fish\\qq\\work' }]).trusted, false);
  assert.equal(judgeBuiltin(cfgOf({ untrustedCwd: 'E:/fish/qq' }), [{ id: 'a', cwd: 'E:/fish/qq2' }]).trusted, true, '前缀相同但不是子目录');
  assert.equal(judgeBuiltin(cfgOf({ untrustedPresets: 'zzz' }), [{ id: 'a', agentPreset: 'qq-chat' }]).trusted, true);
});

test('内置门卫：可信会话弹审批卡片，允许就发、拒绝不发、没人答就起草；桥接会话直接起草', async () => {
  const cfg = cfgOf({ commentMode: 'approve' });
  const trusted = { header: { id: 't', agentPreset: 'default' } };
  const bridge = { header: { id: 'b', agentPreset: 'qq-chat' } };
  for (const [answer, status] of [['allowed-once', 'sent'], ['rejected', 'refused'], ['unavailable', 'draft']]) {
    const f = files(); const asked = [];
    const r = await request(commentReq('30'), { cfg, client: fakeClient(), session: trusted, sessionId: 't', approve: async (t) => { asked.push(t); return answer; }, ...f });
    assert.equal(r.status, status, answer);
    assert.match(asked[0], /B站评论/);
  }
  const f = files(); let asked = 0;
  const r = await request(commentReq('31'), { cfg, client: fakeClient(), session: bridge, sessionId: 'b', approve: async () => { asked += 1; return 'allowed-once'; }, ...f });
  assert.equal(r.status, 'draft');
  assert.equal(asked, 0, '桥接会话里不弹卡片（群里谁都能点）');
  const auto = await request(commentReq('32'), { cfg: cfgOf({ commentMode: 'auto' }), client: fakeClient(), session: bridge, sessionId: 'b', ...files() });
  assert.equal(auto.status, 'draft', '桥接会话里「直接发」也只起草');
});

test('进程内门卫服务优先于 HTTP，并带上会话说明', async () => {
  const { sessionContext, hello } = await import('../src/gate.js');
  const seen = [];
  const service = { context: async (b) => { seen.push(b); return { trusted: true, label: '主人私聊' }; }, hello: async () => ({ protocol: 1, actions: ['context'], name: 'test' }) };
  const r = await sessionContext(cfgOf({ gateUrl: 'http://127.0.0.1:1/x' }), { sessionId: 's', session: { header: { id: 's', agentPreset: 'qq-chat', cwd: 'E:\q' } } }, { service });
  assert.deepEqual([r.trusted, r.gate], [true, 'service']);
  assert.equal(seen[0].session.agentPreset, 'qq-chat');
  assert.equal((await hello(cfgOf(), { service })).protocol, 1);
});
