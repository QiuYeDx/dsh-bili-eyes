import test from 'node:test';
import assert from 'node:assert/strict';
import { netError, errText, NetError } from '../src/net.js';
import net from 'node:net';
import { BiliClient, BiliError } from '../src/bili-api.js';

// undici 的样子：TypeError('fetch failed')，原因挂在 cause 上
const failed = (cause) => Object.assign(new TypeError('fetch failed'), { cause });
const sys = (code, extra = {}) => Object.assign(new Error(`${code} something`), { code, ...extra });

test('fetch failed 按 cause 翻成人话，带上连的地址', () => {
  const dns = netError(failed(sys('ENOTFOUND', { hostname: 'api.bilibili.com' })));
  assert.ok(dns instanceof NetError);
  assert.equal(dns.code, 'ENOTFOUND');
  assert.equal(dns.host, 'api.bilibili.com');
  assert.match(dns.message, /^连不上 api\.bilibili\.com：域名解析失败（ENOTFOUND）。/);

  const reset = netError(failed(sys('ECONNRESET')), 'https://api.bilibili.com/x/web-interface/view?bvid=BV1');
  assert.match(reset.message, /连不上 api\.bilibili\.com：连接被中途断开（ECONNRESET）。.*代理/);

  const timeout = netError(failed(Object.assign(new Error('Connect Timeout Error (attempted address: api.bilibili.com:443, timeout: 10000ms)'), { code: 'UND_ERR_CONNECT_TIMEOUT' })));
  assert.equal(timeout.host, 'api.bilibili.com');
  assert.match(timeout.message, /连接超时（UND_ERR_CONNECT_TIMEOUT）/);

  const cert = netError(failed(sys('UNABLE_TO_VERIFY_LEAF_SIGNATURE')), 'https://api.bilibili.com/');
  assert.match(cert.message, /HTTPS 证书校验失败.*HTTPS 扫描/);

  // IPv4 / IPv6 都失败时是 AggregateError
  const agg = netError(failed(new AggregateError([sys('ECONNREFUSED'), sys('ECONNREFUSED')])), 'http://127.0.0.1:3300/x');
  assert.match(agg.message, /连不上 127\.0\.0\.1:3300：对方拒绝连接（ECONNREFUSED）。本机的这个服务没在运行/);

  const slow = netError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 'https://api.bilibili.com/x');
  assert.match(slow.message, /等了太久没响应（TimeoutError）/);

  const unknown = netError(failed(sys('EWEIRD')), 'https://api.bilibili.com/x');
  assert.match(unknown.message, /^连不上 api\.bilibili\.com（EWEIRD）：EWEIRD something$/);
});

test('不是网络错误的不动', () => {
  assert.equal(netError(new BiliError('啥', -400)), null);
  assert.equal(netError(new Error('普通错误')), null);
  assert.equal(netError(new SyntaxError('Unexpected token <')), null);
  assert.equal(netError(null), null);
  assert.equal(errText(new Error('普通错误')), '普通错误');
});

test('真的连不上：本机没人监听的端口', async () => {
  // 先占一个端口再放掉，保证没人监听（不能用 1 这类端口：fetch 规范直接拦，报的是 bad port）
  const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address(); await new Promise((r) => srv.close(r));
  const url = `http://127.0.0.1:${port}/`;
  const e = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch((x) => x);
  const n = netError(e, url);
  assert.ok(n, String(e));
  assert.equal(n.code, 'ECONNREFUSED');
  assert.ok(n.message.startsWith(`连不上 127.0.0.1:${port}：对方拒绝连接`), n.message);
});

test('B站客户端连不上时抛 NetError，不是一句 fetch failed', async () => {
  const client = new BiliClient({ minIntervalMs: 0, fetchImpl: async () => { throw failed(sys('ENOTFOUND', { hostname: 'api.bilibili.com' })); } });
  await assert.rejects(client.request('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD'), (e) => e instanceof NetError && /域名解析失败/.test(e.message));
  await assert.rejects(client.nav(), (e) => e instanceof NetError && e.host === 'api.bilibili.com');
  // 接口返回错误码还是 BiliError
  const ok = new BiliClient({ minIntervalMs: 0, fetchImpl: async () => new Response(JSON.stringify({ code: -404, message: '啥都木有' })) });
  await assert.rejects(ok.request('https://api.bilibili.com/x/web-interface/view?bvid=BV1'), (e) => e instanceof BiliError && e.message === '啥都木有');
});
