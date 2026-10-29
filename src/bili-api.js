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

const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const stripHtml = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITY[m])
  .trim();
/** "12:34" / "1:02:03" → 秒 */
export function parseClock(s) {
  const parts = String(s ?? '').split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
/** 搜索结果的一条 → 精简字段（标题里的 <em> 高亮去掉） */
export function parseSearchItem(r) {
  return {
    bvid: r.bvid,
    title: stripHtml(r.title),
    author: stripHtml(r.author),
    seconds: parseClock(r.duration),
    play: Number(r.play) || 0,
    danmaku: Number(r.video_review) || 0,
    pubdate: Number(r.pubdate) || 0,
    desc: stripHtml(r.description).replace(/\s+/g, ' '),
  };
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

  /**
   * 站内搜视频。order: totalrank 综合 / click 最多播放 / pubdate 最新 / dm 最多弹幕 / stow 最多收藏；
   * duration: 0 不限 / 1 十分钟以下 / 2 十到三十分钟 / 3 三十到六十分钟 / 4 一小时以上。
   */
  async searchVideos(keyword, { order = 'totalrank', duration = 0, page = 1 } = {}) {
    await this.ensureBuvid();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const d = await this.signed('https://api.bilibili.com/x/web-interface/wbi/search/type', { search_type: 'video', keyword, order, duration, page });
      if (Array.isArray(d?.result)) return { total: d.numResults ?? 0, items: d.result.filter((r) => r.bvid).map(parseSearchItem) };
      if (!d?.v_voucher) return { total: 0, items: [] };
      // 风控（返回 v_voucher 而不是结果）：换一个设备 id 再试一次
      delete this.cookies.buvid3;
      delete this.cookies.buvid4;
      await this.ensureBuvid();
    }
    throw new BiliError('B站搜索这会儿被风控拦了，过一会儿再搜', 'v_voucher');
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
