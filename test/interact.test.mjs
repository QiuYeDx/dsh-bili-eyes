// 冲浪与互动：写操作规则、草稿与同意、收件箱、门卫、写接口的请求格式、bili_surf 的流程。全部用假的 B站 / 门卫。
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
  assert.match((await confirm(d.draft.id, 'send', { cfg, client, ...f })).text, /没配门卫/);
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
  assert.match(r.url, /x\/v2\/reply\/add$/);
  const form = new URLSearchParams(r.body);
  assert.equal(form.get('csrf'), 'CSRF');
  assert.equal(form.get('root'), '5');
  assert.equal(form.get('parent'), '6');
  assert.deepEqual(JSON.parse(form.get('at_name_to_mid')), { 主人号: 42 });
  assert.equal(r.headers.origin, 'https://www.bilibili.com');
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
