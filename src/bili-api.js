// B站公开接口（只读）：视频信息、标签、热评、弹幕、字幕、AI 总结、登录状态。
// 不实现任何写操作（评论、点赞、投币、弹幕、私信）。
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

export class BiliError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** WBI 签名：img_key + sub_key 按固定表打乱取前 32 位，参数排序后拼上算 md5。 */
export function wbiMixinKey(imgUrl, subUrl) {
  const key = (u) => u.split('/').pop().split('.')[0];
  const raw = key(imgUrl) + key(subUrl);
  return MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32);
}
export function wbiSign(params, mixinKey, now = Math.floor(Date.now() / 1000)) {
  const p = { ...params, wts: now };
  const query = Object.keys(p).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${crypto.createHash('md5').update(query + mixinKey).digest('hex')}`;
}

export class BiliClient {
  /** @param {{cookies?: Record<string,string>, minIntervalMs?: number, fetchImpl?: typeof fetch}} opts */
  constructor({ cookies = {}, minIntervalMs = 350, fetchImpl = fetch } = {}) {
    this.cookies = { ...cookies };
    this.minIntervalMs = minIntervalMs;
    this.fetchImpl = fetchImpl;
    this.queue = Promise.resolve();
    this.lastAt = 0;
    this.mixin = null;
    this.mixinAt = 0;
  }

  cookieHeader() {
    return Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // 串行 + 最小间隔：B站对匿名请求限流很紧（412）
  async request(url, { raw = false } = {}) {
    const run = async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const r = await this.fetchImpl(url, {
          headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: this.cookieHeader() },
          signal: AbortSignal.timeout(12_000),
        });
        if (r.status === 412 && attempt === 0) { await new Promise((res) => setTimeout(res, 2500)); continue; }
        if (!r.ok) throw new BiliError(`B站接口 HTTP ${r.status}`, r.status);
        if (raw) return Buffer.from(await r.arrayBuffer());
        const j = await r.json();
        if (j.code !== 0) throw new BiliError(j.message || `B站接口错误 ${j.code}`, j.code);
        return j.data;
      }
      throw new BiliError('B站接口限流（412），稍后再试', 412);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async ensureBuvid() {
    if (this.cookies.buvid3) return;
    try {
      const d = await this.request('https://api.bilibili.com/x/frontend/finger/spi');
      if (d?.b_3) this.cookies.buvid3 = d.b_3;
      if (d?.b_4) this.cookies.buvid4 = d.b_4;
    } catch { /* 拿不到也能用大部分接口 */ }
  }

  async nav() {
    // 未登录时 nav 返回 code -101，但 data 里照样有 wbi_img，所以这里不走 request() 的 code 检查
    const r = await this.fetchImpl('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json();
    return j.data ?? {};
  }

  async mixinKey() {
    if (this.mixin && Date.now() - this.mixinAt < 10 * 60_000) return this.mixin;
    const d = await this.nav();
    if (!d.wbi_img) throw new BiliError('拿不到 WBI 密钥');
    this.mixin = wbiMixinKey(d.wbi_img.img_url, d.wbi_img.sub_url);
    this.mixinAt = Date.now();
    return this.mixin;
  }

  async signed(base, params) {
    return this.request(`${base}?${wbiSign(params, await this.mixinKey())}`);
  }

  view({ bvid, aid }) {
    return this.request(`https://api.bilibili.com/x/web-interface/view?${bvid ? `bvid=${bvid}` : `aid=${aid}`}`);
  }

  async tags(bvid) {
    try { return (await this.request(`https://api.bilibili.com/x/tag/archive/tags?bvid=${bvid}`)).map((t) => t.tag_name); } catch { return []; }
  }

  /** 热评（含置顶）。 */
  async hotComments(aid, n = 5) {
    const d = await this.request(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3&ps=${Math.max(n, 5)}`);
    const pick = (x) => ({ user: x.member?.uname ?? '', likes: x.like ?? 0, text: String(x.content?.message ?? '').replace(/\s+/g, ' ').trim() });
    return {
      pinned: (d?.top_replies ?? []).map(pick),
      hot: (d?.replies ?? []).slice(0, n).map(pick),
      total: d?.cursor?.all_count ?? null,
    };
  }

  /** 弹幕 XML（服务端是 raw deflate）。 */
  async danmakuXml(cid) {
    const buf = await this.request(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, { raw: true });
    try { return zlib.inflateRawSync(buf).toString('utf8'); } catch { return buf.toString('utf8'); }
  }

  /** 字幕列表（AI 字幕基本都要登录才看得到）。 */
  async subtitles(bvid, cid) {
    const d = await this.signed('https://api.bilibili.com/x/player/wbi/v2', { bvid, cid });
    return { list: d?.subtitle?.subtitles ?? [], needLogin: d?.need_login_subtitle === true };
  }

  /** 下载一条字幕正文：subtitle_url 是带时效的签名地址，拿到就立刻下载。 */
  async subtitleBody(subtitleUrl) {
    const url = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl;
    const r = await this.fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new BiliError(`字幕下载失败 HTTP ${r.status}`, r.status);
    const j = await r.json();
    return (j.body ?? []).map((x) => ({ start: x.from, end: x.to, text: String(x.content ?? '').trim() })).filter((x) => x.text);
  }

  /** 官方 AI 总结（要登录；有的视频没有）。 */
  async aiSummary(bvid, cid, upMid) {
    const d = await this.signed('https://api.bilibili.com/x/web-interface/view/conclusion/get', { bvid, cid, up_mid: upMid });
    const m = d?.model_result;
    if (!m || !m.summary) return null;
    return {
      summary: m.summary,
      outline: (m.outline ?? []).map((o) => ({ title: o.title, at: o.timestamp })),
    };
  }
}
