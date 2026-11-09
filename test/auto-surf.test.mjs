// 自己逛：时间表、模型决定的解析、评论 / @ 主人 / 私信 / 门卫转达的去向。B站、模型、门卫都是假的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-auto-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS } = await import('../src/config.js');
const { planSlots, currentWindow, ensurePlan, dueSlot, parseDecision, autoSurfOnce, pollAutoSurf, loadAuto } = await import('../src/auto-surf.js');
const { checkText } = await import('../src/act.js');

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('时间表：随机放 n 个时刻，彼此隔够；放不下就少放', () => {
  const s = planSlots(0, 600, 3, 100, seq(0.9, 0.1, 0.5));
  assert.equal(s.length, 3);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i] - s[i - 1] >= 100);
  assert.ok(s.at(-1) <= 600);
  assert.equal(planSlots(0, 150, 5, 100).length, 2);
  assert.deepEqual(planSlots(0, 100, 0, 10), []);
});

test('时间段：跨午夜时，凌晨那一截算前一天', () => {
  const c = currentWindow('22:00-02:00', at(2026, 10, 31, 1, 30));
  assert.equal(c.key, '2026-10-30');
  assert.equal(c.win[1], at(2026, 10, 31, 2));
  assert.equal(currentWindow('14:00-22:30', at(2026, 10, 30, 9)).key, '2026-10-30');
  assert.equal(currentWindow('bad', Date.now()), null);
});

test('计划：同一天改了次数会重排，已经跑过的照算；到点才跑，时间段过了不补', () => {
  const cfg = { ...DEFAULTS, autoSurfOn: true, autoSurfWindow: '14:00-22:00', autoSurfMin: 2, autoSurfMax: 2, autoSurfGapMinutes: 60 };
  const now = at(2026, 10, 30, 13);
  let st = ensurePlan({ day: '', plan: '', slots: [], done: [], runs: [] }, cfg, now, seq(0.5));
  assert.equal(st.slots.length, 2);
  assert.ok(st.slots.every((t) => t >= at(2026, 10, 30, 14) && t <= at(2026, 10, 30, 22)));
  assert.equal(dueSlot(st, cfg, now), null);
  const first = st.slots[0];
  assert.equal(dueSlot(st, cfg, first + 1000), first);
  st = { ...st, done: [first] };
  st = ensurePlan(st, { ...cfg, autoSurfMin: 3, autoSurfMax: 3 }, first + 1000, seq(0.3));
  assert.equal(st.slots.length, 3);
  assert.ok(st.slots.includes(first));
  assert.equal(dueSlot(st, cfg, at(2026, 10, 30, 23)), null, '时间段过了不补');
});

test('模型决定：只认编号在范围内的', () => {
  const d = parseDecision('好的\n{"comments":[{"i":2,"text":"这个转场太顺了"},{"i":9,"text":"x"}],"recommend":{"i":1,"why":"你肯定喜欢","comment":"快来看"}}', 3);
  assert.deepEqual(d.comments, [{ i: 2, text: '这个转场太顺了' }]);
  assert.equal(d.recommend.i, 1);
  assert.equal(parseDecision('{"comments":[],"recommend":null}', 3).recommend, null);
  assert.deepEqual(parseDecision('看不懂', 3), { comments: [], recommend: null, likes: [], favs: [], post: null });
});

test('私信主人可以带 B站视频链接，别的链接和长数字还是不行', () => {
  assert.ok(checkText('dm', '这个好看\n《x》https://www.bilibili.com/video/BV1SPaQ65Esg'));
  assert.throws(() => checkText('dm', '看 https://example.com'), /只能带 B站视频链接/);
  assert.throws(() => checkText('comment', 'https://www.bilibili.com/video/BV1SPaQ65Esg'), /链接/);
});

function fakes({ decision, gateOk = true } = {}) {
  const calls = { request: [], notify: [] };
  const items = [{ bvid: 'BV1aaaaaaaaa', title: '视频一', author: 'UP1', note: '讲了 A' }, { bvid: 'BV1bbbbbbbbb', title: '视频二', author: 'UP2', note: '讲了 B' }];
  return {
    calls,
    ask: async () => JSON.stringify(decision),
    deps: {
      surf: async () => ({ items, text: '逛了一圈', meta: { steps: 5 } }),
      request: async (req, o) => { calls.request.push({ req, via: o.via }); return { status: 'sent', text: 'ok' }; },
      notify: async (_cfg, text, its, o) => { calls.notify.push({ text, its, kind: o.kind }); return gateOk; },
      writeClient: async () => ({ view: async ({ bvid }) => ({ aid: bvid === 'BV1aaaaaaaaa' ? 11 : 22 }) }),
      ownerName: async () => '秋夜殿下',
    },
  };
}

test('逛完：自发评论 + 推荐（评论 @ 主人和自发评论是同一条视频时合成一条）+ 私信 + 门卫转达', async () => {
  const f = fakes({ decision: { comments: [{ i: 1, text: '这期讲得真清楚' }], recommend: { i: 1, why: '你肯定爱看', comment: '快来看' } } });
  const cfg = { ...DEFAULTS, ownerMid: 42, autoSurfComment: true, autoSurfRecommend: 'notify,comment,dm', gateUrl: 'http://127.0.0.1:1/g' };
  const r = await autoSurfOnce({ cfg, ask: f.ask, deps: f.deps });
  assert.ok(r.ok, r.error);
  const comments = f.calls.request.filter((c) => c.req.kind === 'comment');
  assert.equal(comments.length, 1, '同一条视频只发一条顶层评论');
  assert.equal(comments[0].req.payload.text, '@秋夜殿下 这期讲得真清楚');
  assert.deepEqual(comments[0].req.payload.atNameToMid, { 秋夜殿下: 42 });
  assert.equal(comments[0].via, 'background');
  const dm = f.calls.request.find((c) => c.req.kind === 'dm');
  assert.match(dm.req.payload.text, /https:\/\/www\.bilibili\.com\/video\/BV1aaaaaaaaa/);
  assert.equal(f.calls.notify[0].kind, 'recommend');
  assert.deepEqual(r.recommend.ways, { comment: 'sent', dm: 'sent', notify: 'ok' });
});

test('逛完：没接门卫就跳过转达；不评论也不推荐的配置就不调模型', async () => {
  const f = fakes({ decision: { comments: [], recommend: { i: 2, why: '好看', comment: '' } } });
  const r = await autoSurfOnce({ cfg: { ...DEFAULTS, ownerMid: 42, autoSurfComment: false, autoSurfRecommend: 'notify' }, ask: f.ask, deps: f.deps });
  assert.equal(r.recommend.ways.notify, 'no-gate');
  assert.equal(f.calls.notify.length, 0);
  let asked = 0;
  const g = fakes({ decision: {} });
  await autoSurfOnce({ cfg: { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '' }, ask: async () => { asked += 1; return '{}'; }, deps: g.deps });
  assert.equal(asked, 0);
});

test('到点才跑，跑完记进状态', async () => {
  const file = path.join(tmp, 'auto.json');
  const cfg = { ...DEFAULTS, autoSurfOn: true, autoSurfWindow: '00:00-23:59', autoSurfMin: 1, autoSurfMax: 1, autoSurfGapMinutes: 10, autoSurfComment: false, autoSurfRecommend: '' };
  const start = at(2026, 10, 30, 0, 0);
  assert.equal(await pollAutoSurf({ cfg, ask: () => null, now: start, file }), null);
  const slot = loadAuto(file).slots[0];
  const rec = await pollAutoSurf({ cfg, ask: () => null, now: slot + 1, file });
  assert.match(rec.error, /没有可用的模型/);
  const st = loadAuto(file);
  assert.deepEqual(st.done, [slot]);
  assert.equal(st.runs.length, 1);
  assert.equal(await pollAutoSurf({ cfg, ask: () => null, now: slot + 2, file }), null, '同一个时刻不跑第二次');
});

test('模型决定：点赞、收藏、动态也只认编号在范围内的；收藏最多 1 条', () => {
  const d = parseDecision('{"comments":[],"recommend":null,"likes":[1,2,2,9],"favs":[{"i":2,"why":"以后再看"},{"i":1,"why":"x"}],"post":{"i":1,"text":"今天刷到一个讲得超清楚的科普"}}', 2);
  assert.deepEqual(d.likes, [1, 2]);
  assert.deepEqual(d.favs, [{ i: 2, why: '以后再看' }]);
  assert.equal(d.post.i, 1);
  assert.equal(parseDecision('{"post":{"i":5,"text":"x"}}', 2).post, null);
});

test('逛完：权限表能在后台做才问点赞 / 收藏 / 动态；做了的记下来，「先问主人」的草稿经门卫转达', async () => {
  const off = { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '', autoSurfLike: true, autoSurfFav: true, autoSurfPost: true };
  const { decideParts } = await import('../src/auto-surf.js');
  assert.deepEqual(decideParts(off), { comments: 0, recommend: false, likes: false, favs: false, post: false }, '权限表默认全关：不问');
  assert.equal(decideParts({ ...off, permLikeOut: 'asked' }).likes, false, '「主人开口才做」后台做不了');

  const f = fakes({ decision: { likes: [1, 2], favs: [{ i: 2, why: '留给主人看' }], post: { i: 1, text: '今天刷到的视频一讲得好清楚' } } });
  let sys = '';
  const ask = async (q) => { sys = q.system; return f.ask(); };
  f.deps.request = async (req, o) => {
    f.calls.request.push({ req, via: o.via });
    return req.kind === 'fav' ? { status: 'draft', draft: { id: 7, preview: req.preview }, text: '起草了' } : { status: 'sent', text: 'ok' };
  };
  f.deps.readAudit = () => [];
  const cfg = { ...off, permLikeOwn: 'auto', permLikeOut: 'approve', permPost: 'auto', gateUrl: 'http://127.0.0.1:1/g' };
  const r = await autoSurfOnce({ cfg, ask, deps: f.deps });
  assert.ok(r.ok, r.error);
  assert.match(sys, /likes/); assert.match(sys, /favs/); assert.match(sys, /post/);
  assert.doesNotMatch(sys, /comments：/, '没开评论就不问评论');
  const kinds = f.calls.request.map((c) => c.req.kind);
  assert.deepEqual(kinds, ['like', 'like', 'fav', 'post']);
  assert.ok(f.calls.request.every((c) => c.via === 'background'));
  assert.equal(f.calls.request[0].req.payload.aid, 11);
  assert.equal(f.calls.request[3].req.target.auto, true, '动态记上是自己逛发的（每天一条靠它数）');
  assert.deepEqual(r.likes.map((x) => x.status), ['sent', 'sent']);
  assert.equal(r.favs[0].status, 'draft');
  assert.equal(r.post.status, 'sent');
  assert.deepEqual(r.drafts, { ids: [7], notify: 'ok' });
  const n = f.calls.notify.find((x) => x.kind === 'drafts');
  assert.match(n.text, /#7 收藏《视频二》/);
});

test('自己逛的动态每天最多一条；没接门卫时草稿只留在「待同意」', async () => {
  const { postedToday } = await import('../src/auto-surf.js');
  const now = Date.now();
  assert.equal(postedToday([{ kind: 'post', status: 'ok', at: now - 1000, target: { auto: true } }], now), true);
  assert.equal(postedToday([{ kind: 'post', status: 'ok', at: now - 1000, target: {} }], now), false, '聊天里她自己发的不算');
  const f = fakes({ decision: { likes: [1], post: { i: 1, text: '今天又刷到好东西了' } } });
  f.deps.readAudit = () => [{ kind: 'post', status: 'ok', at: now - 1000, target: { auto: true } }];
  f.deps.request = async (req, o) => { f.calls.request.push({ req, via: o.via }); return { status: 'draft', draft: { id: 3, preview: req.preview }, text: '起草了' }; };
  const r = await autoSurfOnce({ cfg: { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '', autoSurfPost: true, permLikeOut: 'approve', permLikeOwn: 'approve', permPost: 'auto' }, ask: f.ask, deps: f.deps });
  assert.deepEqual(f.calls.request.map((c) => c.req.kind), ['like'], '今天发过了，不再发动态');
  assert.deepEqual(r.drafts, { ids: [3], notify: 'no-gate' });
  assert.equal(f.calls.notify.length, 0);
});

test('一圈里连着点赞、收藏：等够间隔再发，不再被「太近」拦下', async () => {
  const f = fakes({ decision: { likes: [1, 2], favs: [{ i: 2, why: '想留着' }] } });
  const slept = [];
  f.deps.sleep = async (ms) => { slept.push(ms); };
  const seen = new Set();
  f.deps.request = async (req) => {
    const key = `${req.kind}:${req.payload.aid}`;
    f.calls.request.push(key);
    if (!seen.has(key)) { seen.add(key); return { status: 'refused', wait: 4, text: '离上一次写操作太近，4 秒后再试' }; }
    return { status: 'sent', text: 'ok' };
  };
  const cfg = { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '', permLikeOut: 'auto', permLikeOwn: 'auto' };
  const r = await autoSurfOnce({ cfg, ask: f.ask, deps: f.deps });
  assert.deepEqual(r.likes.map((x) => x.status), ['sent', 'sent']);
  assert.equal(r.favs[0].status, 'sent');
  assert.deepEqual(f.calls.request, ['like:11', 'like:11', 'like:22', 'like:22', 'fav:22', 'fav:22']);
  assert.deepEqual(slept, [5000, 5000, 5000]);
});

test('等太久、或者不是间隔的拒绝，不重试', async () => {
  for (const refused of [{ status: 'refused', wait: 3600, text: '太近' }, { status: 'refused', text: '额度用完了' }]) {
    const f = fakes({ decision: { likes: [1] } });
    const slept = [];
    f.deps.sleep = async (ms) => { slept.push(ms); };
    f.deps.request = async (req) => { f.calls.request.push(req.kind); return refused; };
    const cfg = { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '', autoSurfFav: false, permLikeOut: 'auto', permLikeOwn: 'auto' };
    const r = await autoSurfOnce({ cfg, ask: f.ask, deps: f.deps });
    assert.equal(r.likes[0].status, 'refused');
    assert.deepEqual(f.calls.request, ['like']);
    assert.deepEqual(slept, []);
  }
});

test('一直被拦也只重试两次', async () => {
  const f = fakes({ decision: { likes: [1] } });
  const slept = [];
  f.deps.sleep = async (ms) => { slept.push(ms); };
  f.deps.request = async (req) => { f.calls.request.push(req.kind); return { status: 'refused', wait: 5, text: '太近' }; };
  const cfg = { ...DEFAULTS, autoSurfComment: false, autoSurfRecommend: '', autoSurfFav: false, permLikeOut: 'auto', permLikeOwn: 'auto' };
  const r = await autoSurfOnce({ cfg, ask: f.ask, deps: f.deps });
  assert.equal(r.likes[0].status, 'refused');
  assert.equal(f.calls.request.length, 3);
  assert.equal(slept.length, 2);
});
