// 语音识别配置：写 asr.json 时保留别的字段、key 不回传、测试按钮的几种结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-asr-'));
process.env.DSH_HOME = tmp;
const { asrView, saveAsr, clearAsr, testAsr, silentWav, SILICONFLOW } = await import('../src/asr-config.js');
let n = 0;
const file = () => path.join(tmp, `asr${(n += 1)}.json`);

test('硅基流动：要 key；key 不会回到页面；保留 hotwords 这类本页不管的字段', () => {
  const f = file();
  assert.throws(() => saveAsr({ mode: 'siliconflow' }, f), /API Key/);
  fs.writeFileSync(f, JSON.stringify({ hotwords: '位错 滑移', terms: { a: 'b' }, manage: { start: ['x'] } }));
  const v = saveAsr({ mode: 'siliconflow', key: 'sk-secret' }, f);
  assert.deepEqual([v.mode, v.configured, v.hasKey, v.model], ['siliconflow', true, true, SILICONFLOW.model]);
  assert.ok(!JSON.stringify(v).includes('sk-secret'));
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual([raw.key, raw.hotwords, raw.terms.a, raw.manage], ['sk-secret', '位错 滑移', 'b', undefined]);
  // key 留空 = 保持原来的
  saveAsr({ mode: 'siliconflow', key: '' }, f);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).key, 'sk-secret');
});

test('本机服务：地址和模型必填，启动命令可选；本机地址不填 key 也算配好了', () => {
  const f = file();
  assert.throws(() => saveAsr({ mode: 'custom', baseUrl: 'not a url', model: 'm' }, f), /http/);
  assert.throws(() => saveAsr({ mode: 'custom', baseUrl: 'http://127.0.0.1:8771/v1', model: '' }, f), /模型/);
  const v = saveAsr({ mode: 'custom', baseUrl: 'http://127.0.0.1:8771/v1/', model: 'SenseVoiceSmall', start: ['python.exe', 'asr_server.py', '--port', '8771'] }, f);
  assert.deepEqual([v.mode, v.configured, v.baseUrl, v.start.length], ['custom', true, 'http://127.0.0.1:8771/v1', 4]);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).manage.idleMs, 600_000);
  saveAsr({ mode: 'custom', baseUrl: 'http://127.0.0.1:8771/v1', model: 'SenseVoiceSmall', start: [] }, f);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).manage, undefined);
});

test('清除配置：改名成 .bak，不直接删', () => {
  const f = file();
  saveAsr({ mode: 'siliconflow', key: 'k' }, f);
  assert.equal(clearAsr(f).configured, false);
  assert.ok(fs.existsSync(`${f}.bak`));
});

test('测试按钮：能用 / key 不对 / 本机服务没开（有自动启动）', async () => {
  assert.equal(silentWav().length, 44 + 16000 * 2);
  const f = file();
  assert.equal((await testAsr({ file: f })).message, '还没配置');
  saveAsr({ mode: 'siliconflow', key: 'k' }, f);
  let sent;
  const ok = await testAsr({ file: f, fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, status: 200, text: async () => '{"text":""}' }; } });
  assert.equal(ok.ok, true);
  assert.equal(sent.url, `${SILICONFLOW.baseUrl}/audio/transcriptions`);
  assert.equal(sent.init.headers.authorization, 'Bearer k');
  assert.match((await testAsr({ file: f, fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) })).message, /Key 不对/);
  const g = file();
  saveAsr({ mode: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'm', start: ['x'] }, g);
  assert.match((await testAsr({ file: g, fetchImpl: async () => { throw new TypeError('fetch failed'); } })).message, /自动启动/);
});
