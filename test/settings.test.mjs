import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-test-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS, FIELDS, validateConfig, saveConfig, loadConfig, applyEnv } = await import('../src/config.js');
const { record, readHistory, clearHistory } = await import('../src/history.js');
const { sameOrigin, clearDir, dirStats, toolVersion } = await import('../src/api.js');

test('设置字段覆盖全部配置项，默认值合法', () => {
  assert.deepEqual(FIELDS.map((f) => f.key).sort(), Object.keys(DEFAULTS).sort());
  assert.deepEqual(validateConfig({ ...DEFAULTS }), []);
});

test('保存配置：校验、只写非默认值、路径统一成正斜杠', () => {
  const file = path.join(tmp, 'cfg.json');
  assert.throws(() => saveConfig({ maxPerHour: 0 }, file), /每小时最多新看几个视频/);
  assert.throws(() => saveConfig({ cacheDir: 'relative/dir' }, file), /绝对路径/);
  assert.throws(() => saveConfig({ ffmpegPath: 'C:/Windows/notepad.exe' }, file), /ffmpeg/);
  assert.equal(fs.existsSync(file), false);
  const next = saveConfig({ maxPerHour: 40, danmaku: false, cacheDir: 'E:\\cache\\bili', bogus: 1 }, file);
  assert.equal(next.cacheDir, 'E:/cache/bili');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { maxPerHour: 40, danmaku: false, cacheDir: 'E:/cache/bili' });
  saveConfig({ maxPerHour: DEFAULTS.maxPerHour }, file);
  assert.equal(loadConfig(file).maxPerHour, DEFAULTS.maxPerHour);
  assert.equal('maxPerHour' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
});

test('清空路径后撤掉自己设过的环境变量，不动外部的', () => {
  const env = { DSH_FFMPEG_PATH: 'C:/outside/ffmpeg.exe' };
  applyEnv({ ...DEFAULTS, cacheDir: 'E:/c' }, env);
  assert.equal(env.DSH_VIDEO_CACHE_DIR, 'E:/c');
  applyEnv({ ...DEFAULTS }, env);
  assert.equal(env.DSH_VIDEO_CACHE_DIR, undefined);
  assert.equal(env.DSH_FFMPEG_PATH, 'C:/outside/ffmpeg.exe');
});

test('最近看过：新的在前，超过上限截断', () => {
  const file = path.join(tmp, 'h.jsonl');
  for (let i = 0; i < 405; i += 1) record({ kind: 'look', title: `v${i}` }, file);
  const list = readHistory(1000, file);
  assert.ok(list.length <= 400 && list.length >= 300);
  assert.equal(list[0].title, 'v404');
  clearHistory(file);
  assert.deepEqual(readHistory(10, file), []);
});

test('接口：只接受同源，清理拒绝过短路径', async () => {
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' } }), true);
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:1', origin: 'http://evil.example' } }), false);
  assert.equal(sameOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
  assert.throws(() => clearDir(path.parse(tmp).root), /路径太短/);
  const dir = path.join(tmp, 'cache-x');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'a.bin'), Buffer.alloc(10));
  assert.deepEqual([dirStats(dir).files, dirStats(dir).bytes], [1, 10]);
  assert.equal(clearDir(dir).files, 1);
  assert.equal(dirStats(dir).files, 0);
  assert.deepEqual(await toolVersion('ffmpeg', 'C:/Windows/notepad.exe'), { ok: false, error: '不是 ffmpeg' });
});

test('设置页脚本能解析（client.js 是直接下发给浏览器的，语法错了整页白屏）', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(src));
});
