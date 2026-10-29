// 只认 B站视频：完整链接、手机链接、b23 短链、BV 号、av 号，也能从一段分享文字里把链接抠出来。
// 不接受本机路径和任何其他网站 —— 这个工具会被 QQ 群聊里的模型调用。

const BV_RE = /BV[0-9A-Za-z]{10}/;
const VIDEO_HOSTS = new Set(['www.bilibili.com', 'bilibili.com', 'm.bilibili.com']);
const SHORT_HOSTS = new Set(['b23.tv', 'bili2233.cn']);
const ALL_HOSTS = [...VIDEO_HOSTS, ...SHORT_HOSTS];

export class InputError extends Error {}

function fromUrl(u) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new InputError('只支持 http(s) 链接');
  const host = u.hostname.toLowerCase();
  const page = Number(u.searchParams.get('p')) || 1;
  if (VIDEO_HOSTS.has(host)) {
    const bv = u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (bv) return { kind: 'video', bvid: bv[1], page };
    const av = u.pathname.match(/^\/video\/av(\d+)\/?$/i);
    if (av) return { kind: 'video', aid: Number(av[1]), page };
    throw new InputError('这个 B站链接不是视频页（只支持 /video/BV… 或 /video/av…）');
  }
  if (SHORT_HOSTS.has(host)) {
    if (!/^\/[0-9A-Za-z]{4,16}\/?$/.test(u.pathname)) throw new InputError('b23 短链格式不对');
    return { kind: 'short', url: `https://${host}${u.pathname.replace(/\/$/, '')}` };
  }
  throw new InputError(`只能看 B站视频（${ALL_HOSTS.join('、')}），这个链接是 ${host}`);
}

/** 解析模型传进来的 url 参数。返回 {kind:'video', bvid|aid, page} 或 {kind:'short', url}。 */
export function parseInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new InputError('没有给链接');
  if (/^[a-zA-Z]:[\\/]|^\\\\|^\/|^file:/i.test(text)) throw new InputError('只能看 B站视频链接，不能读本机文件');
  if (/^BV[0-9A-Za-z]{10}$/.test(text)) return { kind: 'video', bvid: text, page: 1 };
  const av = text.match(/^av(\d+)$/i);
  if (av) return { kind: 'video', aid: Number(av[1]), page: 1 };
  // 一段分享文字：「【标题-哔哩哔哩】 https://b23.tv/xxx」
  const urls = text.match(/https?:\/\/[^\s<>"'，。】）)]+/gi) ?? [];
  if (urls.length === 0) {
    const bv = text.match(BV_RE);
    if (bv) return { kind: 'video', bvid: bv[0], page: 1 };
    throw new InputError('没找到 B站链接或 BV 号');
  }
  let lastError;
  for (const s of urls) {
    try { return fromUrl(new URL(s)); } catch (e) { lastError = e; }
  }
  throw lastError instanceof InputError ? lastError : new InputError('链接格式不对');
}

/** 跟随 b23 短链：手动处理重定向，只允许跳到 B站域名（防止借短链访问本机或内网）。 */
export async function resolveShort(shortUrl, { fetchImpl = fetch, userAgent } = {}) {
  let url = shortUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    const r = await fetchImpl(url, { redirect: 'manual', headers: userAgent ? { 'user-agent': userAgent } : {}, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get('location');
    if (!loc) throw new InputError('短链没有跳转到视频（可能已失效）');
    const next = new URL(loc, url);
    const host = next.hostname.toLowerCase();
    if (!ALL_HOSTS.includes(host)) throw new InputError(`短链跳到了 B站以外的地址（${host}），不看`);
    if (VIDEO_HOSTS.has(host)) return fromUrl(next);
    url = next.href;
  }
  throw new InputError('短链跳转次数太多');
}

export function canonicalUrl({ bvid, page = 1 }) {
  return `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`;
}
