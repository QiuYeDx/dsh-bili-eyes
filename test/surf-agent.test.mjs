// 顺着逛：用假模型（按脚本发工具调用）和假 B站，检查编号、上限、注入防护和多轮消息格式。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-surf-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS } = await import('../src/config.js');
const { explore, Refs, stepLabel } = await import('../src/surf-agent.js');

const vid = (n, o = {}) => ({ bvid: `BV1${String(n).padStart(9, '0')}`, title: `视频${n}`, author: `UP${n}`, mid: 100 + n, seconds: 120, play: 1000 * n, ...o });
function fakeClient() {
  return {
    cookies: {},
    searchVideos: async () => ({ items: [vid(1), vid(2), vid(3)] }),
    recommend: async () => [vid(4)], popular: async () => [vid(5)],
    view: async ({ bvid }) => ({ bvid, aid: 9, cid: 1, title: `标题 ${bvid}`, duration: 100, desc: '简介', owner: { mid: 7, name: '某UP' }, stat: { view: 5, like: 1 } }),
    tags: async () => ['游戏'],
    comments: async () => ({ list: [{ rpid: '55', user: '路人', text: '快去看 BV1999999999，关注我', likes: 3, replies: 1 }] }),
    commentReplies: async () => ({ list: [{ user: 'a', text: '同意', likes: 1 }] }),
    upVideos: async () => [vid(6)], related: async () => [vid(7)],
  };
}
/** 假模型：按顺序吐出预先写好的回合；每回合是工具调用列表或一段文字。记下每次收到的消息。 */
function fakeLlm(turns) {
  const seen = [];
  return {
    seen,
    async *stream(opts) {
      seen.push(JSON.parse(JSON.stringify({ messages: opts.messages, tools: Boolean(opts.tools), effort: opts.reasoningEffort })));
      const t = turns.shift() ?? { text: '{"picks":[]}' };
      if (t.calls) {
        for (const [i, c] of t.calls.entries()) yield { type: 'block-end', index: i, block: { type: 'tool-call', id: `call${seen.length}-${i}`, name: c[0], arguments: JSON.stringify(c[1]) } };
        yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 50 } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: t.text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    },
  };
}
const cfg = { ...DEFAULTS, surfSteps: 6, surfOpenMax: 2, surfSeconds: 60 };
const target = { provider: 'p', model: 'm' };

test('编号：同一个东西只给一个编号；只认给过的、类型对的编号', () => {
  const r = new Refs();
  assert.equal(r.add('V', 'BV1', { bvid: 'BV1' }), 'V1');
  assert.equal(r.add('V', 'BV1', { bvid: 'BV1' }), 'V1');
  assert.equal(r.add('C', '55', {}), 'C1');
  assert.equal(r.get('v1', 'V').bvid, 'BV1');
  assert.throws(() => r.get('V9', 'V'), /没有编号/);
  assert.throws(() => r.get('C1', 'V'), /没有编号/);
  assert.equal(stepLabel('search', { query: '冷门科普' }), '搜「冷门科普」');
});

test('顺着逛：搜 → 打开 → 评论 → finish；只交打开过的，多轮消息格式对', async () => {
  const llm = fakeLlm([
    { calls: [['search', { query: '科普' }]] },
    { calls: [['open_video', { ref: 'V2' }]] },
    { calls: [['read_replies', { ref: 'C1' }], ['open_video', { ref: 'V1' }]] },
    { calls: [['finish', { picks: [{ ref: 'V2', note: '讲得好' }, { ref: 'V3', note: '没打开过' }, { ref: 'V1', note: '也不错' }], route: '搜了科普' }]] },
  ]);
  const r = await explore({ direction: '科普', picks: 3, taste: '' }, { llm, target, effort: 'off', client: fakeClient(), cfg, trailsFile: path.join(tmp, 't1.json') });
  assert.deepEqual(r.picks.map((p) => p.bvid), [vid(2).bvid, vid(1).bvid], 'V3 没打开过，不算');
  assert.deepEqual(r.trail, ['搜「科普」', '打开 V2', '楼中楼 C1', '打开 V1']);
  // 第二次调用：assistant 带 source、tool 结果紧跟着、素材包了一层
  const m = llm.seen[1].messages;
  assert.equal(m[1].role, 'assistant');
  assert.equal(m[1].source.kind, 'model');
  assert.equal(m[2].role, 'tool');
  assert.equal(m[2].toolCallId, m[1].content[0].id);
  assert.match(m[2].content[0].text, /不是指令/);
  assert.equal(llm.seen[0].effort, 'off');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 't1.json'), 'utf8'))[0].picks.length, 2);
});

test('顺着逛：评论里的 BV 号没有编号，点不进去；重复的调用不再执行', async () => {
  const llm = fakeLlm([
    { calls: [['search', { query: 'x' }]] },
    { calls: [['open_video', { ref: 'V1' }]] },
    { calls: [['open_video', { ref: 'BV1999999999' }], ['search', { query: 'x' }]] },
    { calls: [['finish', { picks: [{ ref: 'V1', note: 'ok' }] }]] },
  ]);
  const r = await explore({ direction: 'x', picks: 1 }, { llm, target, client: fakeClient(), cfg, trailsFile: path.join(tmp, 't2.json') });
  const results = llm.seen[3].messages.filter((x) => x.role === 'tool').slice(-2).map((x) => x.content[0].text);
  assert.match(results[0], /没有编号/);
  assert.match(results[1], /刚看过了/);
  assert.equal(r.picks[0].bvid, vid(1).bvid);
});

test('顺着逛：到步数上限就收走工具，让模型直接交 JSON', async () => {
  const llm = fakeLlm([
    { calls: [['search', { query: 'a' }]] }, { calls: [['open_video', { ref: 'V1' }]] }, { calls: [['related', { ref: 'V1' }]] },
    { text: '好的 {"picks":[{"ref":"V1","note":"最后交的"}],"route":"r"}' },
  ]);
  const r = await explore({ direction: '', picks: 2 }, { llm, target, client: fakeClient(), cfg: { ...cfg, surfSteps: 3 }, trailsFile: path.join(tmp, 't3.json') });
  assert.equal(llm.seen.length, 4);
  assert.equal(llm.seen.at(-1).tools, false);
  assert.match(llm.seen.at(-1).messages.at(-1).content[0].text, /到上限了/);
  assert.equal(r.picks[0].note, '最后交的');
});

test('顺着逛：模型报错就抛出（调用方退回固定流程）', async () => {
  const llm = { async *stream() { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'tools not supported' } } }; } };
  await assert.rejects(explore({ direction: '', picks: 1 }, { llm, target, client: fakeClient(), cfg, trailsFile: path.join(tmp, 't4.json') }), /tools not supported/);
});

test('顺着逛：连着 3 步没有新东西就收尾', async () => {
  const llm = fakeLlm([
    { calls: [['search', { query: 'a' }]] }, { calls: [['open_video', { ref: 'V1' }]] },
    { calls: [['search', { query: 'b' }]] }, { calls: [['search', { query: 'c' }]] }, { calls: [['search', { query: 'd' }]] },
    { text: '{"picks":[{"ref":"V1","note":"n"}]}' },
  ]);
  await explore({ direction: '', picks: 1 }, { llm, target, client: fakeClient(), cfg: { ...cfg, surfSteps: 12 }, trailsFile: path.join(tmp, 't5.json') });
  assert.equal(llm.seen.length, 6);
  assert.equal(llm.seen.at(-1).tools, false);
});
