// 评论带表情：表情面板缓存、清理正文、给她看的说明、改了要重启；表情包的存储、能不能带、上传和发送。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-eyes-emote-'));
process.env.DSH_HOME = tmp;
const { DEFAULTS } = await import('../src/config.js');
const E = await import('../src/emote.js');
const S = await import('../src/sticker.js');
const { prepareText } = await import('../src/interact.js');
const { request, readAudit, setVerifyDelay } = await import('../src/act.js');
const { BiliClient } = await import('../src/bili-api.js');
const { buildPrompt } = await import('../src/engine.js');
const { toolSpecs } = await import('../src/index.js');
setVerifyDelay(0);

const cfgWith = (o = {}) => ({ ...DEFAULTS, ...o });
// 账号的表情面板（和 B站返回的结构一样，只留用到的字段）
const PANEL = {
  packages: [
    { id: 1, text: '小黄脸', type: 1, emote: [{ text: '[doge]', url: 'https://i0.hdslb.com/bfs/emote/a.png', meta: { size: 1 } }, { text: '[笑哭]', url: 'https://i0.hdslb.com/bfs/emote/b.png', meta: { size: 1 } }, { text: '[吃瓜]', url: 'https://i0.hdslb.com/bfs/emote/c.png', meta: { size: 1 } }, { text: '[星星眼]', url: 'https://i0.hdslb.com/bfs/emote/d.png', meta: { size: 1 } }] },
    { id: 53, text: '热词系列一', type: 1, emote: [{ text: '[热词系列_再给一集]', url: 'https://i0.hdslb.com/bfs/emote/e.png', meta: { size: 2 } }] },
    { id: 4, text: '颜文字', type: 4, emote: [{ text: '_(:з」∠)_', url: '_(:з」∠)_', meta: { size: 1 } }] },
    { id: 900, text: '2233娘', type: 1, emote: [{ text: '[2233娘_卖萌]', url: 'https://i0.hdslb.com/bfs/emote/f.png', meta: { size: 2 } }] },
  ],
};
const panelClient = (panel = PANEL) => ({ request: async (url) => { assert.match(url, /emote\/user\/panel\/web\?business=reply/); return panel; } });

test('表情面板：精简成系列；第一次拉不算「新」，之后新出现的才算；拉失败保留上次的', async () => {
  const file = path.join(tmp, 'emotes-a.json');
  const first = await E.refreshEmotes(panelClient({ packages: PANEL.packages.slice(0, 3) }), { file, now: 1000 });
  assert.deepEqual(first.packages.map((p) => [p.id, p.kind, p.size]), [[1, 'image', 1], [53, 'image', 2], [4, 'text', 1]]);
  assert.deepEqual(first.fresh, []);
  const second = await E.refreshEmotes(panelClient(), { file, now: 2000 });
  assert.deepEqual(second.fresh, [900], '新领的系列标「新」');
  await assert.rejects(E.refreshEmotes({ request: async () => { throw new Error('登录失效'); } }, { file, now: 3000 }));
  const kept = E.loadEmotes(file);
  assert.equal(kept.packages.length, 4);
  assert.equal(kept.error, '登录失效');
  assert.deepEqual(E.clearFresh(file).fresh, []);
});

test('清理正文：认不出的、没开的系列、超过上限的去掉，说清为什么；「不用」全去掉；半截代码去掉', async () => {
  const file = path.join(tmp, 'emotes-b.json');
  const cache = await E.refreshEmotes(panelClient(), { file, now: 1000 });
  const cfg = cfgWith({ emotePkgs: '1,4,53', emoteMax: 2 });
  let r = E.tidyEmotes('哈哈[doge] 这也太[狗头]了[笑哭][吃瓜]', cfg, { cache });
  assert.equal(r.text, '哈哈[doge] 这也太了[笑哭]');
  assert.deepEqual(r.dropped.map((d) => d.code), ['[狗头]', '[吃瓜]']);
  assert.match(r.dropped[0].why, /不是 B站表情/);
  assert.match(r.dropped[1].why, /最多 2 个/);
  r = E.tidyEmotes('好耶[2233娘_卖萌]', cfg, { cache });
  assert.equal(r.text, '好耶');
  assert.match(r.dropped[0].why, /2233娘.*没开/);
  assert.match(E.droppedNote(r.dropped), /\[2233娘_卖萌\] 没发出去/);
  assert.equal(E.tidyEmotes('好[doge]', cfgWith({ emoteMode: 'off' }), { cache }).text, '好');
  assert.equal(E.tidyEmotes('真不错[星星', cfg, { cache }).text, '真不错', '截断留下的半截代码');
  assert.equal(E.tidyEmotes('第[1]名', cfg, { cache }).text, '第名', '方括号里像代码的都算');
  // 面板从没拉到过：只认「常用」里的
  const none = { at: 0, packages: [], seen: [], fresh: [], error: '' };
  assert.equal(E.tidyEmotes('[doge][狗头]', cfgWith(), { cache: none }).text, '[doge]');
});

test('正文检查：顶层评论不能只发表情，回复可以；去掉的表情告诉她', () => {
  const cfg = cfgWith();
  assert.throws(() => prepareText('comment', '[doge][笑哭]', cfg), /顶层评论要有字/);
  assert.equal(prepareText('reply', '[doge]', cfg).text, '[doge]');
  const r = prepareText('comment', '笑死[狗头]', cfg);
  assert.equal(r.text, '笑死');
  assert.match(r.note, /\[狗头\]/);
  assert.throws(() => prepareText('reply', '[狗头]', cfg), /正文是空的/);
});

test('给她看的说明：只列开着的系列里标了常用的，按大小分行；不用就不写', async () => {
  const cache = await E.refreshEmotes(panelClient(), { file: path.join(tmp, 'emotes-c.json'), now: 1000 });
  const cfg = cfgWith({ emotePkgs: '1,4,53', emotePicks: ['[doge]', '[热词系列_再给一集]', '_(:з」∠)_', '[2233娘_卖萌]', '[不存在]'].join('\n') });
  const g = E.emoteGuide(cfg, { cache });
  assert.match(g, /小表情：\[doge\]/);
  assert.match(g, /大表情.*\[热词系列_再给一集\]/);
  assert.match(g, /颜文字：_\(:з」∠\)_/);
  assert.doesNotMatch(g, /2233娘|不存在/);
  assert.match(g, /一条最多 3 个/);
  assert.equal(E.emoteGuide(cfgWith({ emoteMode: 'off' }), { cache }), '');
  assert.match(E.emoteGuide(cfgWith({ emoteMode: 'off' }), { cache, forTool: false }), /不要用/);
  assert.match(E.emoteGuide(cfgWith({ emoteMode: 'many' }), { cache }), /可以常用/);
});

test('评论引擎的提示词和工具说明里带上表情；表情包开了才有 sticker 参数', () => {
  const cfg = cfgWith();
  assert.match(buildPrompt(cfg, [{ text: 'hi', user: { name: 'a' } }]).system, /表情/);
  assert.doesNotMatch(buildPrompt(cfgWith({ emoteMode: 'off' }), []).system, /小表情/);
  const specs = toolSpecs(cfg, []);
  assert.match(specs.comment.description, /\[doge\]/);
  assert.match(specs.dm.description, /\[doge\]/);
  assert.equal('sticker' in specs.comment.parameters, false);
  const on = toolSpecs(cfgWith({ stickerOn: true }), [{ name: '无语', when: '看到离谱操作时' }]);
  assert.ok(on.comment.parameters.sticker);
  assert.match(on.comment.description, /无语 —— 看到离谱操作时/);
});

test('改了要重启：和加载时的设置比；改回原样就不提醒', () => {
  const cfg = cfgWith();
  assert.equal(E.emoteStale(cfg), false, '没加载过不提醒');
  E.markLoaded(cfg, []);
  assert.equal(E.emoteStale(cfg, []), false);
  assert.equal(E.emoteStale({ ...cfg, emotePkgs: '1' }, []), true);
  assert.equal(E.emoteStale({ ...cfg, emoteMax: 5 }, []), true);
  assert.equal(E.emoteStale(cfg, [{ name: '无语', when: '' }]), true, '表情包也算');
  assert.equal(E.emoteStale({ ...cfg, writePaused: true }, []), false, '别的设置不算');
});

// ── 表情包 ────────────────────────────────────────────────────────────────
const png = (w, h) => { const b = Buffer.alloc(40); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);

test('图片尺寸：png、gif、jpeg；认不出的返回空', () => {
  assert.deepEqual(S.imageInfo(png(96, 64)), { type: 'image/png', width: 96, height: 64 });
  assert.deepEqual(S.imageInfo(gif), { type: 'image/gif', width: 32, height: 16 });
  assert.deepEqual(S.imageInfo(jpg), { type: 'image/jpeg', width: 64, height: 48 });
  assert.equal(S.imageInfo(Buffer.from('hello world, not an image')), null);
});

test('表情包：加、改、删；名字不能重复、不能太长；同一张图不能加两次；只认图片', () => {
  const o = { file: path.join(tmp, 'st-a.json'), dir: path.join(tmp, 'st-a') };
  const a = S.addSticker({ name: '无语', when: '看到离谱操作时', data: png(96, 96).toString('base64') }, o);
  assert.equal(a.width, 96);
  assert.ok(fs.existsSync(path.join(o.dir, a.file)));
  assert.throws(() => S.addSticker({ name: '无语', data: gif }, o), /已经有叫/);
  assert.throws(() => S.addSticker({ name: '另一个', data: png(96, 96) }, o), /已经加过了/);
  assert.throws(() => S.addSticker({ name: '这个名字有点太长了', data: gif }, o), /8 个字/);
  assert.throws(() => S.addSticker({ name: '[x]', data: gif }, o), /方括号/);
  assert.throws(() => S.addSticker({ name: '文本', data: Buffer.from('not an image at all') }, o), /只支持/);
  assert.throws(() => S.addSticker({ name: '太大', data: Buffer.concat([png(1, 1), Buffer.alloc(S.MAX_BYTES)]) }, o), /2 MB/);
  S.updateSticker(a.id, { when: '被离谱到' }, o);
  assert.equal(S.loadStickers(o.file).list[0].when, '被离谱到');
  S.removeSticker(a.id, o);
  assert.equal(S.loadStickers(o.file).list.length, 0);
  assert.equal(fs.existsSync(path.join(o.dir, a.file)), false);
});

test('能不能带：没开、停用中、没这张、额度用完时只发文字并说清楚', () => {
  const file = path.join(tmp, 'st-b.json');
  S.addSticker({ name: '好耶', when: '', data: gif }, { file, dir: path.join(tmp, 'st-b') });
  const cfg = cfgWith({ stickerOn: true, stickerPerDay: 1 });
  assert.match(S.pickSticker('好耶', cfgWith(), { file }).note, /主人没开/);
  assert.deepEqual(S.pickSticker('好耶', cfg, { file }).sticker?.name, '好耶');
  assert.match(S.pickSticker('好耶', cfg, { file, kind: 'reply' }).note, /楼中楼.*不能带图/);
  assert.match(S.pickSticker('不存在', cfg, { file }).note, /没有叫「不存在」.*能用的：好耶/);
  const now = Date.now();
  assert.match(S.pickSticker('好耶', cfg, { file, now, entries: [{ status: 'ok', at: now, target: { sticker: '好耶' } }] }).note, /额度用完/);
  S.pauseStickers('被藏了', { file, now });
  assert.match(S.pickSticker('好耶', cfg, { file, now }).note, /被藏了/);
  S.resumeStickers({ file });
  assert.ok(S.pickSticker('好耶', cfg, { file, now }).sticker);
  assert.equal(S.pickSticker('', cfg, { file }).sticker, null);
});

test('上传：同一张图只传一次（记住 B站 的地址）', async () => {
  const o = { file: path.join(tmp, 'st-c.json'), dir: path.join(tmp, 'st-c') };
  const item = S.addSticker({ name: '震惊', when: '', data: png(10, 20) }, o);
  let uploads = 0;
  const client = { uploadImage: async (buf, meta) => { uploads += 1; assert.equal(meta.type, 'image/png'); assert.ok(buf.length); return { url: 'https://i0.hdslb.com/bfs/new_dyn/x.png', width: 10, height: 20, size: 0.1 }; } };
  const a = await S.uploadedSticker(client, { id: item.id, name: '震惊' }, o);
  const b = await S.uploadedSticker(client, { id: item.id, name: '震惊' }, o);
  assert.equal(uploads, 1);
  assert.deepEqual(a, b);
  await assert.rejects(S.uploadedSticker(client, { id: 999, name: '没了' }, o), /被删了/);
});

test('发评论：pictures 是 JSON 字符串；上传接口的字段对', async () => {
  const reqs = [];
  const fetchImpl = async (url, init = {}) => {
    const body = typeof init.body === 'function' ? init.body() : init.body;
    reqs.push({ url: String(url), body });
    if (String(url).includes('/nav')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { wbi_img: { img_url: 'https://x/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://x/6789abcdefghijklmnopqrstuvwxyzAB.png' } } }) };
    if (String(url).includes('upload_bfs')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { image_url: 'https://i0.hdslb.com/bfs/new_dyn/abc.png', image_width: 96, image_height: 96, img_size: 3.8 } }) };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { rpid: 1 } }) };
  };
  const client = new BiliClient({ cookies: { SESSDATA: 's', bili_jct: 'CSRF', DedeUserID: '77' }, minIntervalMs: 0, fetchImpl });
  const up = await client.uploadImage(png(96, 96), { name: 'a.png', type: 'image/png' });
  assert.deepEqual(up, { url: 'https://i0.hdslb.com/bfs/new_dyn/abc.png', width: 96, height: 96, size: 3.8 });
  const fd = reqs.at(-1).body;
  assert.ok(fd instanceof FormData);
  assert.equal(fd.get('category'), 'daily');
  assert.equal(fd.get('biz'), 'new_dyn');
  assert.equal(fd.get('csrf'), 'CSRF');
  assert.ok(fd.get('file_up') instanceof Blob);
  await client.addComment({ oid: 100, message: '[doge]', root: '5', parent: '5', pictures: [up] });
  const form = new URLSearchParams(reqs.at(-1).body);
  assert.equal(typeof form.get('pictures'), 'string');
  assert.deepEqual(JSON.parse(form.get('pictures')), [{ img_src: up.url, img_width: 96, img_height: 96, img_size: 3.8 }]);
  await client.addComment({ oid: 100, message: 'x' });
  assert.equal(new URLSearchParams(reqs.at(-1).body).get('pictures'), null);
});

test('带表情包的评论：发的时候才传图；被设成仅自己可见就停用表情包；传不上只发文字', async () => {
  S.addSticker({ name: '比心', when: '', data: png(5, 5) });   // 默认位置（DSH_HOME 是临时目录）
  const ref = S.loadStickers().list.find((x) => x.name === '比心');
  const calls = [];
  const client = {
    uploadImage: async () => ({ url: 'https://i0.hdslb.com/bfs/new_dyn/h.png', width: 5, height: 5, size: 0.1 }),
    addComment: async (a) => { calls.push(a); return { rpid: 1, rpid_str: '1' }; },
    commentState: async () => 17,
  };
  const auditFile = path.join(tmp, 'a-st.jsonl'); const draftsFile = path.join(tmp, 'd-st.json');
  const cfg = cfgWith({ permCommentOut: 'auto', permReplyOut: 'auto', stickerOn: true });
  const req = { kind: 'comment', payload: { oid: '1', type: 1, root: '0', parent: '0', text: '好耶', sticker: { id: ref.id, name: '比心' } }, preview: '评论', target: { oid: '1', sticker: '比心' } };
  const r = await request(req, { cfg, client, via: 'ui', auditFile, draftsFile });
  assert.equal(r.status, 'hidden');
  assert.match(r.text, /表情包停用 24 小时/);
  assert.equal(calls[0].pictures[0].url, 'https://i0.hdslb.com/bfs/new_dyn/h.png');
  assert.ok(S.loadStickers().pausedUntil > Date.now());
  assert.equal(readAudit(5, auditFile)[0].target.sticker, '比心');
  // 传不上（一张还没传过的图）：照样发文字，结果里说一声
  const fresh = S.addSticker({ name: '新图', when: '', data: png(6, 6) });
  const bad = { ...client, uploadImage: async () => { throw new Error('4100001'); }, commentState: async () => 0 };
  S.resumeStickers();
  const r2 = await request({ ...req, payload: { ...req.payload, oid: '2', sticker: { id: fresh.id, name: '新图' } }, target: { oid: '2' } }, { cfg, client: bad, via: 'ui', auditFile: path.join(tmp, 'a-st2.jsonl'), draftsFile: path.join(tmp, 'd-st2.json') });
  assert.equal(r2.status, 'sent');
  assert.match(r2.text, /没传上去.*只发了文字/);
  assert.equal(calls.at(-1).pictures, null);
  // 楼中楼：B站 不让带图（实测 -400「子评论不能带图」），不传图、只发文字
  let uploads = 0;
  const r3 = await request({ kind: 'reply', payload: { oid: '3', type: 1, root: '9', parent: '9', text: '好耶', sticker: { id: ref.id, name: '比心' } }, preview: '回复', target: { oid: '3' } }, { cfg, client: { ...client, uploadImage: async () => { uploads += 1; return {}; }, commentState: async () => 0 }, via: 'ui', auditFile: path.join(tmp, 'a-st3.jsonl'), draftsFile: path.join(tmp, 'd-st3.json') });
  assert.equal(r3.status, 'sent');
  assert.match(r3.text, /楼中楼 B站 不让带图/);
  assert.equal(uploads, 0);
  assert.equal(calls.at(-1).pictures, null);
});

test('设置页接口：上传表情包要走 ?upload=sticker；表情包图能取到；改了表情会提醒重启', async () => {
  const { makeApiHandler } = await import('../src/api.js');
  const { Readable } = await import('node:stream');
  const api = makeApiHandler({ registered: () => true });
  const call = (method, url, body) => new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, url, headers: { host: 'localhost' } });
    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; this.headers = h ?? {}; }, end(b) { resolve({ status: this.status, headers: this.headers, body: b }); } };
    api(req, res);
  });
  const data = png(12, 12).toString('base64');
  let r = await call('POST', '/api/bili-eyes', { action: 'stickerAdd', name: '偷看', when: '', data });
  assert.equal(r.status, 400, '普通请求不能上传');
  r = await call('POST', '/api/bili-eyes?upload=sticker', { action: 'saveConfig', config: {} });
  assert.equal(r.status, 400, '大请求只能用来上传');
  r = await call('POST', '/api/bili-eyes?upload=sticker', { action: 'stickerAdd', name: '偷看', when: '想围观时', data });
  assert.equal(r.status, 200);
  const view = JSON.parse(r.body);
  const item = view.stickers.find((x) => x.name === '偷看');
  assert.equal(item.width, 12);
  r = await call('GET', `/api/bili-eyes?view=img&src=sticker&id=${item.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal((await call('GET', '/api/bili-eyes?view=img&url=https://evil.example/x.png')).status, 404, '只代理 B站图床');
  E.markLoaded(cfgWith(), []);
  const ov = JSON.parse((await call('GET', '/api/bili-eyes?view=emotes')).body);
  assert.equal(ov.stale, true, '加了表情包就要提醒重启');
});

test('设置改了不用重启：评论、私信、动态马上重新注册，说明和参数跟着变', async () => {
  const stub = path.join(tmp, 'define-tool.mjs');
  fs.writeFileSync(stub, 'export const defineTool = (d) => d;');
  process.env.DSH_TOOLS_PATH = stub;
  const { apply } = await import('../src/index.js');
  const { saveConfig } = await import('../src/config.js');
  saveConfig({ stickerOn: false });
  const tools = new Map(); let disposed = 0; let handler = null;
  const ctx = {
    tools: { register: (d) => { assert.equal(tools.has(d.name), false, `${d.name} 没先注销就又注册了`); tools.set(d.name, d); return () => { disposed += 1; tools.delete(d.name); }; } },
    inject: (deps, fn) => { if (deps[0] === 'webServer') fn({ webServer: { register: (r) => { handler = r.handler; return () => {} } } }); },
  };
  const dispose = await apply(ctx);
  try {
    assert.equal(tools.size, 14);
    assert.equal('sticker' in tools.get('bili_comment').parameters, false);
    for (let i = 0; i < 50 && !handler; i += 1) await new Promise((r) => setTimeout(r, 20));
    const { Readable } = await import('node:stream');
    const post = (body) => new Promise((resolve) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))]);
      Object.assign(req, { method: 'POST', url: '/api/bili-eyes', headers: { host: 'localhost' } });
      handler(req, { writeHead(s) { this.s = s; }, end(b) { resolve({ status: this.s, body: JSON.parse(b) }); } });
    });
    const r = await post({ action: 'saveConfig', config: { stickerOn: true } });
    assert.equal(r.status, 200);
    assert.equal(disposed, 3, '只重新注册评论、私信、动态');
    const comment = tools.get('bili_comment');
    assert.ok(comment.parameters.sticker, '打开表情包后马上有 sticker 参数');
    assert.match(comment.description, /比心/);
    assert.equal(tools.size, 14);
    assert.equal(E.emoteStale((await import('../src/config.js')).loadConfig(), S.loadStickers().list), false);
    await post({ action: 'saveConfig', config: { writeGapSeconds: 61 } });
    assert.equal(disposed, 3, '别的设置不触发重新注册');
  } finally {
    dispose();
    saveConfig({ stickerOn: false, writeGapSeconds: DEFAULTS.writeGapSeconds });
  }
});
