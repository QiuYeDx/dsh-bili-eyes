// 「关于」页：版本比较、检查更新（假的 npm）、CHANGELOG 取段。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-update-'));
process.env.DSH_HOME = tmp;
const { cmpVer, checkUpdate, updateState, changelogFor, PKG } = await import('../src/update.js');

test('版本比较', () => {
  assert.ok(cmpVer('0.7.0', '0.6.0') > 0);
  assert.ok(cmpVer('0.10.0', '0.9.9') > 0);
  assert.equal(cmpVer('v0.6.0', '0.6.0'), 0);
  assert.ok(cmpVer('0.7.0-rc.1', '0.7.0') < 0);
  assert.ok(cmpVer('0.7.0-rc.2', '0.7.0-rc.1') > 0);
});

const fakeNpm = (versions) => async (url) => {
  const host = new URL(url).host;
  const v = versions[host];
  if (v instanceof Error) throw v;
  return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: v }, time: { [v]: '2026-11-02T10:00:00.000Z' } }) };
};

test('检查更新：取两个源里高的那个，结果记下来', async () => {
  const s = await checkUpdate({ fetchImpl: fakeNpm({ 'registry.npmjs.org': '99.1.0', 'registry.npmmirror.com': '99.0.0' }), now: () => 1000 });
  assert.equal(s.latest, '99.1.0');
  assert.equal(s.registry, 'https://registry.npmjs.org');
  assert.equal(s.newer, true);
  assert.equal(s.current, PKG.version);
  assert.equal(s.publishedAt, Date.parse('2026-11-02T10:00:00.000Z'));
  assert.equal(updateState(1000 + 3600_000).stale, false);
  assert.equal(updateState(1000 + 13 * 3600_000).stale, true);
});

test('检查更新：都连不上时报错，留着上次查到的版本，30 分钟后再试', async () => {
  const s = await checkUpdate({ fetchImpl: fakeNpm({ 'registry.npmjs.org': new Error('ECONNRESET'), 'registry.npmmirror.com': new Error('ENOTFOUND') }), now: () => 5000 });
  assert.match(s.error, /连不上 npm：ECONNRESET；ENOTFOUND/);
  assert.equal(s.latest, '99.1.0');
  assert.equal(updateState(5000 + 10 * 60_000).stale, false);
  assert.equal(updateState(5000 + 31 * 60_000).stale, true);
  const ok = await checkUpdate({ fetchImpl: fakeNpm({ 'registry.npmjs.org': PKG.version, 'registry.npmmirror.com': new Error('x') }), now: () => 9000 });
  assert.equal(ok.error, '');
  assert.equal(ok.newer, false);
});

test('CHANGELOG 取当前版本那一节，源码目录再加「未发布」', () => {
  const text = '# 更新记录\n\n说明\n\n## [未发布]\n\n### 新增\n\n- 甲\n\n## [1.2.0] - 2026-10-30\n\n第一个版本。\n\n### 修复\n\n- **乙**：`x`\n\n## [1.1.0] - 2026-10-29\n\n- 丙\n\n[未发布]: https://example.com/a\n[1.2.0]: https://example.com/b\n';
  assert.deepEqual(changelogFor('1.2.0', { text }), [{ version: '1.2.0', date: '2026-10-30', lines: ['第一个版本。', '### 修复', '- **乙**：`x`'] }]);
  assert.deepEqual(changelogFor('1.2.0', { text, withUnreleased: true }).map((x) => x.version), ['', '1.2.0']);
  assert.deepEqual(changelogFor('1.1.0', { text }), [{ version: '1.1.0', date: '2026-10-29', lines: ['- 丙'] }]);
  assert.deepEqual(changelogFor('9.9.9', { text }), []);
  assert.ok(changelogFor(PKG.version).length === 1, '仓库里的 CHANGELOG 要有当前版本这一节');
});
