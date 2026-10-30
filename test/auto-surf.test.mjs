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
  assert.deepEqual(parseDecision('看不懂', 3), { comments: [], recommend: null });
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
