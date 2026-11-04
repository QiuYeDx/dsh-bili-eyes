// 谁叫的：认人（谁发了视频、谁引用回复、谁 @ 她）、按表定档位、每人额度、包住工具；dsh-qq 适配的 recentMessages。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-origin-'));
process.env.DSH_HOME = tmp;
const { av2bv, bvidOf, findAsker, judge, guarded, offText, quotaUsed } = await import('../src/origin.js');
const { DEFAULTS, askLevelFor, askGroupPresets, validateConfig, ASK_PRESETS } = await import('../src/config.js');
const { toRecent, dshQqGate } = await import('../src/adapters/dsh-qq.js');

const BV_A = 'BV17x411w7KC';   // = av170001
const BV_B = 'BV1xx411c7mD';   // = av2
const resolve = async (url) => (url.endsWith('/abcd') ? { kind: 'video', bvid: BV_A } : url.endsWith('/av2x') ? { kind: 'video', aid: 2 } : Promise.reject(new Error('dead')));
const cfgWith = (o = {}) => ({ ...DEFAULTS, ...o });
const preset = (id) => ASK_PRESETS.find((p) => p[0] === id)[2];
const table = (id) => { const p = preset(id); return { askLookOwner: p.owner, askLookFriend: p.friend, askLookOther: p.other, askLookUnknown: p.unknown, askSurfOwner: p.owner, askSurfFriend: p.friend, askSurfOther: p.other, askSurfUnknown: p.unknown }; };
const msg = (id, uid, text, extra = {}) => ({ id, at: 1000 + Number(id), sender: { id: uid, name: `n${uid}`, isOwner: uid === '10001' }, text, links: [], replyTo: '', atSelf: false, ...extra });

test('视频编号：av 换算成 BV，短链跟出来，认不出返回空', async () => {
  assert.equal(av2bv(170001), BV_A);
  assert.equal(av2bv(2), BV_B);
  assert.equal(await bvidOf(BV_A), BV_A);
  assert.equal(await bvidOf('https://www.bilibili.com/video/av2'), BV_B);
  assert.equal(await bvidOf('【标题】 https://b23.tv/abcd', { resolve }), BV_A);
  assert.equal(await bvidOf('https://b23.tv/av2x', { resolve }), BV_B);
  assert.equal(await bvidOf('https://b23.tv/dead', { resolve }), '');
  assert.equal(await bvidOf('随便说点什么'), '');
});

test('认人：谁发的视频就是谁叫的；几个人沾边按最宽的算', async () => {
  const cfg = cfgWith({ ...table('friends'), askFriendQQ: '30003' });
  const chat = { type: 'group', id: '555' };
  // 别人发的 → 别人
  let r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat, messages: [msg('1', '20002', `看这个 ${BV_A}`)], resolve });
  assert.deepEqual([r.asker, r.how, r.who.name], ['other', 'posted', 'n20002']);
  // 别人发的短链，主人引用回复并 @ 她 → 按最宽算主人
  const msgs = [msg('1', '20002', '好笑', { links: ['https://b23.tv/abcd'] }), msg('2', '10001', '看看', { replyTo: '1', atSelf: true })];
  r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat, messages: msgs, resolve });
  assert.deepEqual([r.asker, r.how], ['owner', 'replied']);
  // 引用回复但没 @ 她：不算叫她
  r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat, messages: [msgs[0], { ...msgs[1], atSelf: false }], resolve });
  assert.equal(r.asker, 'other');
  // 熟人发的 av 号也认得
  r = await findAsker(cfg, { row: 'look', bvid: BV_B, chat, messages: [msg('3', '30003', '经典 av2')], resolve });
  assert.deepEqual([r.asker, r.how], ['friend', 'posted']);
});

test('认人：消息里没有这个视频时看是谁 @ 她；私聊算对方；都没有算说不清', async () => {
  const cfg = cfgWith();
  const chat = { type: 'group', id: '555' };
  const msgs = [msg('1', '20002', '@她 搜个视频', { atSelf: true }), msg('2', '10001', '@她 你看看', { atSelf: true })];
  let r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat, messages: msgs, resolve });
  assert.deepEqual([r.asker, r.how], ['owner', 'woke']);
  r = await findAsker(cfg, { row: 'surf', bvid: '', chat, messages: [msgs[0]], resolve });
  assert.deepEqual([r.asker, r.how], ['other', 'woke']);
  r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat: { type: 'private', id: '20002' }, messages: [], resolve });
  assert.deepEqual([r.asker, r.how, r.who.id], ['other', 'private', '20002']);
  r = await findAsker(cfg, { row: 'look', bvid: BV_A, chat, messages: [], resolve });
  assert.deepEqual([r.asker, r.how, r.who], ['unknown', 'none', null]);
});

test('表和预设：个别群换预设；群号写法要对', () => {
  const cfg = cfgWith({ ...table('brief'), askGroups: '55555:owner，66666：friends\n77777:nope' });
  assert.equal(askLevelFor(cfg, 'look', 'other'), 'brief');
  assert.equal(askLevelFor(cfg, 'look', 'other', '88888'), 'brief');
  assert.equal(askLevelFor(cfg, 'look', 'friend', '55555'), 'off');
  assert.equal(askLevelFor(cfg, 'surf', 'owner', '55555'), 'full');
  assert.equal(askLevelFor(cfg, 'look', 'other', '66666'), 'off');
  assert.deepEqual([...askGroupPresets(cfg).keys()], ['55555', '66666']);
  assert.deepEqual(validateConfig(cfgWith({ askGroups: '12345:owner, 67890:brief' })), []);
  assert.equal(validateConfig(cfgWith({ askGroups: '12345 只看主人' })).length, 1);
  assert.equal(validateConfig(cfgWith({ askLookOther: 'maybe' })).length, 1);
});

test('judge：主人私聊直接算主人；门卫答不上算说不清', async () => {
  const cfg = cfgWith(table('owner'));
  const trusted = { sessionContext: async () => ({ trusted: true, label: '主人私聊' }), recentMessages: async () => assert.fail('不该再查消息') };
  assert.deepEqual(Object.values(await judge(cfg, 's', { row: 'look', bvid: BV_A, deps: trusted })).slice(0, 4), ['owner', null, 'trusted', 'full']);
  const noGate = { sessionContext: async () => ({ trusted: false, label: 'QQ 群' }), recentMessages: async () => null };
  const r = await judge(cfg, 's', { row: 'look', bvid: BV_A, deps: noGate });
  assert.deepEqual([r.asker, r.how, r.level], ['unknown', 'nogate', 'off']);
});

function deps(messages, { chat = { type: 'group', id: '555' }, file } = {}) {
  return { sessionContext: async () => ({ trusted: false, label: 'QQ 群' }), recentMessages: async () => ({ chat, messages }), resolve, file };
}
const fakeLook = () => {
  const calls = [];
  const fn = async (args, opts) => { calls.push({ args, opts }); return { text: args.brief ? '简介' : '分镜', pngs: args.brief ? [] : ['png'], cached: false }; };
  return { fn, calls };
};
const whoOf = (exec) => ({ sessionId: exec.sid, session: null });

test('包住工具：不看就不调用、给她一句话；只看简介传 brief；逛降成快速逛；不是她调用的不管', async () => {
  const posts = [msg('1', '20002', `看 ${BV_A}`)];
  const cfg = cfgWith(table('friends'));
  const l = fakeLook();
  const g = guarded('look', l.fn, { whoOf, loadConfig: () => cfg, deps: deps(posts) });
  let r = await g({ url: BV_A }, { source: 'tool', exec: { sid: 'g1' } });
  assert.equal(l.calls.length, 0);
  assert.match(r.text, /^【没看】这个视频是n20002发的，主人设置了这个群里别人叫的视频不看/);
  assert.match(r.text, /别再调用 bili_look/);
  // 设置页试看（source ui）不管表
  await g({ url: BV_A }, { source: 'ui' });
  assert.equal(l.calls.length, 1);
  // 只看简介
  const cfg2 = cfgWith(table('brief'));
  const g2 = guarded('look', l.fn, { whoOf, loadConfig: () => cfg2, deps: deps(posts) });
  r = await g2({ url: BV_A }, { source: 'tool', exec: { sid: 'g2' } });
  assert.equal(l.calls.at(-1).args.brief, true);
  assert.equal(l.calls.at(-1).opts.origin.level, 'brief');
  assert.equal(l.calls.at(-1).opts.origin.who, 'n20002');
  // 逛：别人 @ 她叫她逛 → 快速逛
  const s = fakeLook();
  const gs = guarded('surf', s.fn, { whoOf, loadConfig: () => cfg2, deps: deps([msg('5', '20002', '逛逛', { atSelf: true })]) });
  await gs({ direction: '猫' }, { source: 'tool', exec: { sid: 'g3' } });
  assert.equal(s.calls[0].args.mode, 'quick');
});

test('包住工具：放大看沿用看的时候的判断', async () => {
  const cfg = cfgWith(table('brief'));
  const l = fakeLook(); const z = fakeLook();
  const d = deps([msg('1', '20002', `看 ${BV_A}`)]);
  await guarded('look', l.fn, { whoOf, loadConfig: () => cfg, deps: d })({ url: BV_A }, { source: 'tool', exec: { sid: 'z1' } });
  const gz = guarded('zoom', z.fn, { whoOf, loadConfig: () => cfg, deps: { ...d, recentMessages: async () => assert.fail('沿用，不再查') } });
  const r = await gz({ url: BV_A, from: 0, to: 5 }, { source: 'tool', exec: { sid: 'z1' } });
  assert.equal(z.calls.length, 0);
  assert.match(r.text, /^【没放大看】这个视频只能看简介/);
  // 主人发的：看过就能放大
  const own = deps([msg('1', '10001', `看 ${BV_B}`)]);
  await guarded('look', l.fn, { whoOf, loadConfig: () => cfg, deps: own })({ url: BV_B }, { source: 'tool', exec: { sid: 'z2' } });
  await guarded('zoom', z.fn, { whoOf, loadConfig: () => cfg, deps: own })({ url: BV_B, from: 0, to: 5 }, { source: 'tool', exec: { sid: 'z2' } });
  assert.equal(z.calls.length, 1);
});

test('每人每天额度：超了降成只看简介，看过的（缓存）不算', async () => {
  const file = path.join(tmp, 'quota.json');
  const cfg = cfgWith({ askOtherPerDay: 2 });
  let cached = false;
  const calls = [];
  const fn = async (args) => { calls.push(args); return { text: 'x', pngs: [], cached }; };
  const g = guarded('look', fn, { whoOf, loadConfig: () => cfg, deps: deps([msg('1', '20002', `${BV_A} ${BV_B}`)], { file }) });
  await g({ url: BV_A }, { source: 'tool', exec: { sid: 'q1' } });
  cached = true;
  await g({ url: BV_A }, { source: 'tool', exec: { sid: 'q2' } });
  assert.equal(quotaUsed('20002', { file }), 1);
  cached = false;
  await g({ url: BV_B }, { source: 'tool', exec: { sid: 'q3' } });
  const r = await g({ url: BV_A }, { source: 'tool', exec: { sid: 'q4' } });
  assert.equal(calls.at(-1).brief, true);
  assert.match(r.text, /今天已经让你看了 2 个/);
});

test('她拿到的话：说清是谁、为什么，别再试', () => {
  const o = { asker: 'other', who: { id: '2', name: '小明' }, how: 'posted', chat: { type: 'group', id: '1' }, level: 'off' };
  assert.equal(offText('look', o), '【没看】这个视频是小明发的，主人设置了这个群里别人叫的视频不看（看视频很费额度）。一句话带过就好，比如「这个我就不点开啦」；别再调用 bili_look 看这个视频。');
  assert.match(offText('surf', { ...o, how: 'woke' }), /^【没逛】这次是小明叫的你，主人设置了这个群里别人叫的不逛/);
  assert.match(offText('look', { asker: 'unknown', who: null, how: 'nogate', chat: null }), /^【没看】这个视频说不清是谁叫你看的，主人设置了说不清是谁叫的视频不看/);
});

test('dsh-qq：消息记录只留带链接、@ 她、引用回复的；分享卡片里的链接也拿出来', () => {
  const card = { type: 'json', data: { data: JSON.stringify({ prompt: '[QQ小程序]哔哩哔哩', meta: { detail_1: { title: '哔哩哔哩', desc: '标题', qqdocurl: 'https://b23.tv/abcd?share_source=qq&amp;x=1' } } }) } };
  const list = [
    { message_id: 1, time: 100, sender: { user_id: 20002, card: '小明' }, message: [{ type: 'text', data: { text: '闲聊' } }] },
    { message_id: 2, time: 101, sender: { user_id: 20002, nickname: '小明' }, message: [card] },
    { message_id: 3, time: 102, sender: { user_id: 999 }, message: [{ type: 'text', data: { text: '我是她' } }] },
    { message_id: 4, time: 103, sender: { user_id: 10001 }, message: [{ type: 'reply', data: { id: '3' } }, { type: 'text', data: { text: '嗯' } }] },
    { message_id: 5, time: 104, sender: { user_id: 30003 }, message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ' 看 BV17x411w7KC' } }] },
    { message_id: 6, time: 105, sender: { user_id: 30003 }, message: [{ type: 'reply', data: { id: '2' } }, { type: 'text', data: { text: '+1' } }] },
  ];
  const r = toRecent(list, { ownerQQ: '10001', selfId: '999', since: 100_500 });
  assert.deepEqual(r.map((m) => m.id), ['2', '4', '5', '6']);
  assert.deepEqual(r[0].links, ['https://b23.tv/abcd?share_source=qq&x=1']);
  assert.deepEqual([r[1].sender.isOwner, r[1].atSelf, r[1].replyTo], [true, true, '3']);
  assert.equal(r[2].atSelf, true);
  assert.deepEqual([r[3].atSelf, r[3].replyTo], [false, '2']);
});

test('dsh-qq 门卫：recentMessages 按会话取群或私聊的记录，自己的 QQ 问 get_login_info', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'bridge-'));
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ownerQQ: '10001', snowluma: { httpUrl: 'http://ob' } }));
  fs.writeFileSync(path.join(dir, 'state', 'sessions.json'), JSON.stringify({ sessions: { 'group:555': 's-grp', 'private:20002': 's-p' } }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); calls.push(u.pathname);
    const data = u.pathname === '/get_login_info' ? { user_id: 999 }
      : { messages: [{ message_id: 7, time: 200, sender: { user_id: 20002 }, message: [{ type: 'at', data: { qq: '999' } }] }] };
    return { ok: true, status: 200, json: async () => ({ status: 'ok', data }) };
  };
  const g = dshQqGate({ qqBridgeDir: dir }, { fetchImpl });
  assert.equal((await g.hello()).protocol, 2);
  const r = await g.recentMessages({ sessionId: 's-grp', since: 0 });
  assert.deepEqual(r.chat, { type: 'group', id: '555' });
  assert.equal(r.messages[0].atSelf, true);
  assert.equal((await g.recentMessages({ sessionId: 's-p', since: 0 })).chat.type, 'private');
  assert.deepEqual(calls, ['/get_group_msg_history', '/get_login_info', '/get_friend_msg_history']);
  assert.deepEqual(await g.recentMessages({ sessionId: 'nope' }), { chat: null, messages: [] });
});
