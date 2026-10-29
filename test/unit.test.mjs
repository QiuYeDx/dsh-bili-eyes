import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, resolveShort, canonicalUrl, InputError } from '../src/url.js';
import { wbiMixinKey, wbiSign, dmParams } from '../src/bili-api.js';
import { parseDanmaku, danmakuStats, normalizeDanmaku } from '../src/danmaku.js';
import { compactCells, cellsFor, fitCells, isAd, sheetsFor, timeoutFor, formatFind, find, FIND_NOTE } from '../src/look.js';
import { parseSearchItem, parseClock } from '../src/bili-api.js';

test('搜索结果解析与清单', async () => {
  assert.deepEqual([parseClock('12:34'), parseClock('1:02:03'), parseClock('0:5'), parseClock('--')], [754, 3723, 5, 0]);
  const item = parseSearchItem({ bvid: 'BV1Hgx76SEqb', title: '比超便宜更便宜的<em class="keyword">dsh</em>看视频插件！&amp;', author: '苍穹晓雷', duration: '1:43', play: 30000, video_review: 8, pubdate: 1793145600, description: '一行\n简介' });
  assert.deepEqual(item, { bvid: 'BV1Hgx76SEqb', title: '比超便宜更便宜的dsh看视频插件！&', author: '苍穹晓雷', seconds: 103, play: 30000, danmaku: 8, pubdate: 1793145600, desc: '一行 简介' });
  const text = formatFind('dsh 插件', { order: 'views', duration: 'short', total: 1234, items: [item] });
  assert.ok(text.startsWith(FIND_NOTE));
  assert.match(text, /最多播放，10 分钟以内，共约 1234 个结果/);
  assert.match(text, /1\. 比超便宜更便宜的dsh看视频插件！& —— 苍穹晓雷 · 1:43 · 播放 3\.0万/);
  assert.match(text, /https:\/\/www\.bilibili\.com\/video\/BV1Hgx76SEqb/);
  assert.equal(parseSearchItem({ bvid: 'BV1', title: 'a&#x27;b&#39;c&lt;', duration: '0:1' }).title, "a'b'c<");
  assert.match(formatFind('不存在的东西', {}), /没找到/);
  await assert.rejects(find({ query: '' }), /搜索词/);
  await assert.rejects(find({ query: '字'.repeat(51) }), /50/);
});

test('parseInput：各种 B站写法', () => {
  assert.deepEqual(parseInput('BV1SPaQ65Esg'), { kind: 'video', bvid: 'BV1SPaQ65Esg', page: 1 });
  assert.deepEqual(parseInput('av170001'), { kind: 'video', aid: 170001, page: 1 });
  assert.deepEqual(parseInput('https://www.bilibili.com/video/BV1SPaQ65Esg/?spm_id_from=333&p=3'), { kind: 'video', bvid: 'BV1SPaQ65Esg', page: 3 });
  assert.deepEqual(parseInput('https://m.bilibili.com/video/BV1SPaQ65Esg'), { kind: 'video', bvid: 'BV1SPaQ65Esg', page: 1 });
  assert.deepEqual(parseInput('【关刀和梯子都是可莉的-哔哩哔哩】 https://b23.tv/Gxf72A8?share_medium=android'), { kind: 'short', url: 'https://b23.tv/Gxf72A8' });
  assert.deepEqual(parseInput('[卡片·哔哩哔哩] 某个视频 https://b23.tv/D4DPgVL'), { kind: 'short', url: 'https://b23.tv/D4DPgVL' });
  assert.deepEqual(parseInput('看看这个 BV1Hgx76SEqb 好好笑'), { kind: 'video', bvid: 'BV1Hgx76SEqb', page: 1 });
});

test('parseInput：拒绝本机路径和其他网站', () => {
  for (const bad of ['C:\\Users\\a\\secret.mp4', 'D:/x.mkv', '\\\\nas\\share\\a.mp4', '/etc/passwd', 'file:///C:/a.mp4',
    'https://www.youtube.com/watch?v=abc', 'http://127.0.0.1:3300/api/status', 'https://evil.com/bilibili.com/video/BV1SPaQ65Esg',
    'https://www.bilibili.com/read/cv123', 'ftp://b23.tv/abcd', '']) {
    assert.throws(() => parseInput(bad), InputError, bad);
  }
});

test('resolveShort：只跟随到 B站域名', async () => {
  const fake = (map) => async (url) => ({ headers: { get: (h) => (h === 'location' ? map[url] ?? null : null) } });
  assert.deepEqual(
    await resolveShort('https://b23.tv/abcd', { fetchImpl: fake({ 'https://b23.tv/abcd': 'https://www.bilibili.com/video/BV1SPaQ65Esg?p=2&share_source=qq' }) }),
    { kind: 'video', bvid: 'BV1SPaQ65Esg', page: 2 },
  );
  await assert.rejects(resolveShort('https://b23.tv/abcd', { fetchImpl: fake({ 'https://b23.tv/abcd': 'http://127.0.0.1:3299/' }) }), /B站以外/);
  await assert.rejects(resolveShort('https://b23.tv/abcd', { fetchImpl: fake({}) }), /失效/);
  assert.equal(canonicalUrl({ bvid: 'BV1SPaQ65Esg', page: 2 }), 'https://www.bilibili.com/video/BV1SPaQ65Esg?p=2');
});

test('WBI 签名（bilibili-API-collect 文档里的例子）', () => {
  const mixin = wbiMixinKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png');
  assert.equal(mixin, 'ea1db124af3c7062474693fa704f4ff8');
  assert.equal(wbiSign({ foo: '114', bar: '514', zab: 1919810 }, mixin, 1702204169), 'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
});

test('评论的 dm 反爬参数（和 bilibili-api-python 的 _enc_dm 形状一致）', () => {
  assert.deepEqual(dmParams(() => 0), {
    dm_img_list: '[]',
    dm_img_str: 'AB',
    dm_cover_img_str: 'AB',
    dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
  });
  const rnd = dmParams();
  assert.match(rnd.dm_img_str, /^[A-K]{2}$/);
  assert.match(rnd.dm_cover_img_str, /^[A-K]{2}$/);
  const q = new URLSearchParams(wbiSign({ ...rnd, web_location: 1550101 }, 'x'.repeat(32), 1700000000));
  assert.equal(q.get('web_location'), '1550101');
  assert.match(q.get('w_rid'), /^[0-9a-f]{32}$/);
});

test('弹幕统计', () => {
  const xml = ['<i>', ...Array.from({ length: 40 }, (_, i) => `<d p="${i < 25 ? 30 + i * 0.2 : i * 3},1,25,16777215,0,0,x,${i}">${i % 2 ? '哈哈哈哈哈' : '前方高能&amp;注意'}</d>`), '</i>'].join('');
  const items = parseDanmaku(xml);
  assert.equal(items.length, 40);
  assert.equal(items[0].text.includes('&amp;'), false);
  assert.equal(normalizeDanmaku('哈哈哈哈哈哈'), '哈哈哈');
  const s = danmakuStats(items, { duration: 120 });
  assert.equal(s.count, 40);
  assert.ok(s.top.some((x) => x.text === '哈哈哈'));
  assert.ok(s.peaks.length >= 1 && s.peaks[0].from === '0:30');
  assert.deepEqual(danmakuStats(items.slice(0, 8), { duration: 120 }).peaks, [], '弹幕太少不算高能时段');
});

test('精简格子清单与格数', () => {
  const text = compactCells({ transcript: { source: 'asr' }, sheets: [{ cells: [{ i: 1, t_start: 0, t_end: 9.5, text: '你好。今天聊聊这个。' }, { i: 2, t_start: 9.5, t_end: 75, text: '', sub: 3 }] }] }, 120);
  assert.match(text, /^格1 0:00–0:10：「你好。今天聊聊这个。」\n格2 0:10–1:15（这一格里拼了 9 张小图）$/);
  assert.match(compactCells({ transcript: { source: 'no-key' }, sheets: [] }, 60), /没有台词/);
  assert.deepEqual([cellsFor(49), cellsFor(103), cellsFor(600), cellsFor(3000)], [6, 9, 12, 16]);
});

test('字数预算：每一格都在，先缩台词', () => {
  const cells = Array.from({ length: 12 }, (_, i) => ({ i: i + 1, t_start: i * 50, t_end: i * 50 + 50, text: '这是一句很长的台词'.repeat(20) }));
  const r = { transcript: { source: 'file' }, sheets: [{ cells }] };
  for (const room of [5000, 1500, 900, 300]) {
    const m = fitCells(r, room, 120);
    assert.equal((m.match(/^格\d+/gm) ?? []).length, 12, `room=${room} 时 12 格都要在`);
  }
  assert.ok(fitCells(r, 900, 120).length <= 900);
});

test('置顶广告识别', () => {
  assert.equal(isAd('https://b23.tv/mall-xxx 毫不夸张，按摩仪惊艳到！'), true);
  assert.equal(isAd('好耶，第一次伍孚刺杀失败'), false);
  assert.equal(isAd('https://b23.tv/abc'), true, '连续调用也稳定（没有 lastIndex 串状态）');
  assert.equal(isAd('评论区抽奖，下单同款'), true);
});

test('长视频分几张图、超时放宽', () => {
  assert.deepEqual([sheetsFor(49), sheetsFor(900), sheetsFor(1747), sheetsFor(3600), sheetsFor(7200)], [1, 1, 2, 4, 4]);
  assert.equal(sheetsFor(1747, { secondsPerCell: 30, maxSheets: 4 }), 4);
  assert.deepEqual([timeoutFor(60), timeoutFor(1747), timeoutFor(7200)], [150, 308, 600]);
  const r = { transcript: { source: 'file' }, sheets: [{ sheet: 1, cells: [{ i: 1, t_start: 0, t_end: 60, text: 'a' }] }, { sheet: 2, cells: [{ i: 2, t_start: 60, t_end: 120, text: 'b' }] }] };
  assert.match(compactCells(r, 60), /—— 第 1 张图 ——\n格1 .*\n—— 第 2 张图 ——\n格2 /);
});
