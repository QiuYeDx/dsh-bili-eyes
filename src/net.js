// 网络错误翻成人话。
// Node 的 fetch 连不上时只抛一句 `TypeError: fetch failed`，真正的原因（DNS、被断开、超时、证书）在 cause 里，
// 不翻出来的话主人只看到「fetch failed」，没法排查。这里把 cause 链里的错误码认出来，说清是连哪个地址、卡在哪一步、该查什么。

/** 连不上（不是对方回了错误）：message 就是给人看的一句话，code 是原始错误码，host 是连的地址 */
export class NetError extends Error {
  constructor(message, { code = '', host = '' } = {}) { super(message); this.name = 'NetError'; this.code = code; this.host = host; }
}

const PROXY_HINT = 'Node 的请求不走系统代理，浏览器能打开 B站不代表这里能连上；开着代理 / VPN（尤其全局或 TUN 模式）的，把 *.bilibili.com、*.hdslb.com 设成直连再试';
const isLocal = (host) => /^(127\.|localhost|\[?::1\]?)/i.test(host);

function chainOf(e) {
  const out = []; const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x); out.push(x);
    if (Array.isArray(x.errors)) x.errors.forEach(walk);   // AggregateError：IPv4 / IPv6 都试过
    walk(x.cause);
  };
  walk(e);
  return out;
}

function hostOf(url, chain) {
  try { if (url) return new URL(url).host; } catch { /* 不是完整地址 */ }
  for (const x of chain) {
    if (x.hostname) return String(x.hostname);
    const m = /attempted address(?:es)?: ([^,)\s]+)/.exec(String(x.message ?? ''));
    if (m) return m[1].replace(/:443$/, '');
  }
  return '';
}

/** [原因, 建议]；不认识的码返回 null */
function explain(code, host) {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') return ['域名解析失败', '检查网络和 DNS；改过 hosts、用了加速器或代理的，看看是不是把这个域名解析坏了'];
  if (code === 'ECONNREFUSED') return ['对方拒绝连接', isLocal(host) ? '本机的这个服务没在运行，或者端口不对' : `被防火墙或代理拒绝了。${PROXY_HINT}`];
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET' || code === 'ECONNABORTED') return ['连接被中途断开', `多半是代理 / VPN、防火墙或杀毒软件掐断的。${PROXY_HINT}`];
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return ['连接超时', `网络不通，或者被代理 / 防火墙吞掉了。${PROXY_HINT}`];
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN') return ['网络不可达', '这台电脑现在没联网，或者路由不通'];
  if (code === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return ['等了太久没响应', '网络太慢或者被限速；过一会儿再试，一直这样就查网络和代理'];
  if (/^(CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|ERR_TLS_|ERR_SSL_)/.test(code)) return ['HTTPS 证书校验失败', '多半是杀毒软件的「HTTPS 扫描」或者代理替换了证书；把 DSH 加进白名单，或者关掉 HTTPS 扫描'];
  return null;
}

/**
 * 是网络错误就返回 NetError（message 是一句人话），不是就返回 null。
 * @param {unknown} e  fetch 抛出来的错误
 * @param {string} [url]  请求的地址（错误本身常常不带）
 */
export function netError(e, url = '') {
  if (e instanceof NetError) return e;
  if (!e || typeof e !== 'object') return null;
  const chain = chainOf(e);
  const fetchFailed = e.name === 'TypeError' && /^(fetch failed|terminated)$/.test(String(e.message));
  const coded = chain.find((x) => typeof x.code === 'string' && explain(x.code, ''));
  const timeout = chain.find((x) => x.name === 'TimeoutError');
  if (!fetchFailed && !coded && !timeout) return null;
  const host = hostOf(url, chain);
  const code = coded?.code ?? (timeout ? 'TimeoutError' : chain.find((x) => typeof x.code === 'string')?.code ?? '');
  const why = explain(code, host);
  const where = host ? `连不上 ${host}` : '连不上网络';
  const text = why ? `${where}：${why[0]}（${code}）。${why[1]}` : `${where}${code ? `（${code}）` : ''}：${chain.at(-1)?.message || e.message}`;
  return new NetError(text, { code, host });
}

/** 错误的人话：网络错误翻译过，别的原样 */
export const errText = (e, url) => netError(e, url)?.message ?? String(e?.message ?? e);
