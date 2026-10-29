// B站接口：视频信息、标签、评论、弹幕、字幕、AI 总结、登录状态、推荐与动态、收件箱，
// 以及少数写操作（点赞、收藏、评论、删评论、私信、纯文字动态）。
// 写操作只在这里发请求；要不要发、发给谁、发几条由 act.js 决定。不实现投币、关注、拉黑、改资料、上传。
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

/** 推荐 / 热门 / 排行里的一条稿件 → 和搜索结果同样的字段 */
export function parseArchive(a) {
  return {
    bvid: a.bvid,
    title: stripHtml(a.title),
    author: a.owner?.name ?? '',
    mid: Number(a.owner?.mid) || 0,
    seconds: Number(a.duration) || 0,
    play: Number(a.stat?.view) || 0,
    danmaku: Number(a.stat?.danmaku) || 0,
    pubdate: Number(a.pubdate) || 0,
    desc: stripHtml(a.desc).replace(/\s+/g, ' '),
  };
}
// 动态里的数字可能写成「1.2万」
const dynNum = (v) => {
  const t = String(v ?? '').replace(/,/g, '');
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return Math.round(t.includes('亿') ? n * 1e8 : t.includes('万') ? n * 1e4 : n);
};
/** 动态里的投稿视频（关注动态、UP 主动态）→ 同样的字段；不是视频的返回 null */
export function parseDynArchive(item) {
  const a = item?.modules?.module_dynamic?.major?.archive;
  if (!a?.bvid) return null;
  const au = item.modules.module_author ?? {};
  return {
    bvid: a.bvid,
    title: stripHtml(a.title),
    author: au.name ?? '',
    mid: Number(au.mid) || 0,
    seconds: parseClock(a.duration_text),
    play: dynNum(a.stat?.play),
    danmaku: dynNum(a.stat?.danmaku),
    pubdate: Number(au.pub_ts) || 0,
    desc: stripHtml(a.desc).replace(/\s+/g, ' '),
  };
}
/** 一条评论 → 精简字段（rpid 回复时要用） */
export function parseComment(r) {
  return {
    rpid: String(r.rpid_str ?? r.rpid),
    root: String(r.root_str ?? r.root ?? 0),
    user: r.member?.uname ?? '',
    mid: Number(r.mid ?? r.member?.mid) || 0,
    likes: Number(r.like) || 0,
    replies: Number(r.rcount) || 0,
    at: (Number(r.ctime) || 0) * 1000,
    text: String(r.content?.message ?? '').replace(/\s+/g, ' ').trim(),
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
  async request(url, { raw = false, method = 'GET', form = null, json = null } = {}) {
    const run = async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      const headers = { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: this.cookieHeader() };
      if (method !== 'GET') headers.origin = 'https://www.bilibili.com';
      let body;
      if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      else if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const r = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(12_000) });
        if (r.status === 412 && attempt === 0 && method === 'GET') { await new Promise((res) => setTimeout(res, 2500)); continue; }
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

  // ── 列表：推荐、热门、排行、关注动态、UP 主投稿 ─────────────────────────────
  /** 首页推荐：登录后按这个账号的口味推荐。 */
  async recommend(n = 12) {
    await this.ensureBuvid();
    const d = await this.signed('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd', { fresh_type: 4, ps: Math.min(30, Math.max(n, 6)), fresh_idx: 1, fresh_idx_1h: 1, brush: 1 });
    return (d?.item ?? []).filter((x) => x.goto === 'av' && x.bvid).map(parseArchive);
  }

  async popular(n = 20) {
    const d = await this.request(`https://api.bilibili.com/x/web-interface/popular?ps=${Math.min(50, Math.max(n, 1))}&pn=1`);
    return (d?.list ?? []).map(parseArchive);
  }

  /** 全站排行（rid=0）；新接口要 WBI 签名，旧的不签也能用，先签。 */
  async ranking() {
    let d;
    try { d = await this.signed('https://api.bilibili.com/x/web-interface/ranking/v2', { rid: 0, type: 'all' }); }
    catch { d = await this.request('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all'); }
    return (d?.list ?? []).map(parseArchive);
  }

  /** 关注的 UP 主最近发的视频（要登录）。 */
  async followingVideos() {
    const d = await this.request('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1');
    return (d?.items ?? []).map(parseDynArchive).filter(Boolean);
  }

  /** 某个 UP 主最近的投稿：空间投稿接口风控很重，用动态接口代替（只取视频）。 */
  async upVideos(mid) {
    const d = await this.request(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${Number(mid)}&features=itemOpusStyle`);
    return (d?.items ?? []).map(parseDynArchive).filter(Boolean);
  }

  /** 按昵称找 UP 主：同名优先，否则取搜索第一个。返回 {mid, name, fans} 或 null。 */
  async findUser(name) {
    await this.ensureBuvid();
    const d = await this.signed('https://api.bilibili.com/x/web-interface/wbi/search/type', { search_type: 'bili_user', keyword: name });
    const list = (d?.result ?? []).map((u) => ({ mid: Number(u.mid), name: stripHtml(u.uname), fans: Number(u.fans) || 0 }));
    return list.find((u) => u.name === name) ?? list[0] ?? null;
  }

  /** 用户名片：{mid, name}。 */
  async card(mid) {
    const d = await this.request(`https://api.bilibili.com/x/web-interface/card?mid=${Number(mid)}`);
    return { mid: Number(mid), name: d?.card?.name ?? '' };
  }

  // ── 评论 ──────────────────────────────────────────────────────────────
  /** 评论区：sort hot 按热度 / new 按时间。type 1 = 视频。 */
  async comments(oid, { sort = 'hot', n = 10, type = 1 } = {}) {
    const d = await this.request(`https://api.bilibili.com/x/v2/reply/main?type=${type}&oid=${oid}&mode=${sort === 'new' ? 2 : 3}&ps=${Math.min(20, Math.max(n, 1))}`);
    return {
      pinned: (d?.top_replies ?? []).map(parseComment),
      list: (d?.replies ?? []).slice(0, n).map(parseComment),
      total: d?.cursor?.all_count ?? null,
      upMid: Number(d?.upper?.mid) || 0,
    };
  }

  /** 某条评论下面的楼中楼。 */
  async commentReplies(oid, root, { n = 10, type = 1 } = {}) {
    const d = await this.request(`https://api.bilibili.com/x/v2/reply/reply?type=${type}&oid=${oid}&root=${root}&ps=${Math.min(20, Math.max(n, 1))}&pn=1`);
    return { root: d?.root ? parseComment(d.root) : null, list: (d?.replies ?? []).map(parseComment), total: d?.page?.count ?? null };
  }

  // ── 收件箱 ────────────────────────────────────────────────────────────
  /** 回复我的（最新在前）。 */
  replyFeed() { return this.request('https://api.bilibili.com/x/msgfeed/reply?platform=web&build=0&mobi_app=web'); }
  /** @ 我的（最新在前）。 */
  atFeed() { return this.request('https://api.bilibili.com/x/msgfeed/at?platform=web&build=0&mobi_app=web'); }
  /** 私信会话列表（含系统通知）。 */
  dmSessions() { return this.request('https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2&build=0&mobi_app=web'); }
  /** 和某人的最近私信（新的在前）。 */
  dmMessages(talkerId, n = 20) { return this.request(`https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=${Number(talkerId)}&session_type=1&size=${n}&build=0&mobi_app=web`); }

  // ── 写操作（都要登录；csrf = cookie 里的 bili_jct）─────────────────────────
  csrf() {
    if (!this.cookies.bili_jct || !this.cookies.SESSDATA) throw new BiliError('没登录（或登录信息里缺 bili_jct），先在设置页扫码登录', 'no-login');
    return this.cookies.bili_jct;
  }

  likeVideo(aid) {
    return this.request('https://api.bilibili.com/x/web-interface/archive/like', { method: 'POST', form: { aid, like: 1, csrf: this.csrf() } });
  }

  /** 默认收藏夹的 id（标题带「默认」的那个；找不到就用第一个）。 */
  async defaultFavFolder() {
    const d = await this.request(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?type=2&up_mid=${Number(this.cookies.DedeUserID)}`);
    const list = d?.list ?? [];
    const f = list.find((x) => /默认/.test(x.title)) ?? list[0];
    if (!f) throw new BiliError('这个账号没有收藏夹', 'no-fav');
    return Number(f.id);
  }

  favVideo(aid, folderId) {
    return this.request('https://api.bilibili.com/x/v3/fav/resource/deal', { method: 'POST', form: { rid: aid, type: 2, add_media_ids: folderId, del_media_ids: '', csrf: this.csrf() } });
  }

  /** 发评论；给 root（和 parent）就是楼中楼。atNameToMid: {昵称: mid}，让正文里的「@昵称」变成真的 @。 */
  addComment({ oid, type = 1, message, root = 0, parent = 0, atNameToMid = null }) {
    // 和网页端发评论时带的字段一致（少了这些更像脚本）
    const form = { oid, type, message, plat: 1, ordering: 'heat', jsonp: 'jsonp', gaia_source: 'main_web', statistics: JSON.stringify({ appId: 100, platform: 5 }), csrf: this.csrf() };
    if (root && String(root) !== '0') { form.root = root; form.parent = parent && String(parent) !== '0' ? parent : root; }
    if (atNameToMid && Object.keys(atNameToMid).length) form.at_name_to_mid = JSON.stringify(atNameToMid);
    return this.request('https://api.bilibili.com/x/v2/reply/add', { method: 'POST', form });
  }

  /**
   * 用这个账号自己的视角查一条评论的状态：0 = 正常公开；17 = 仅自己可见（风控 / 审核中）；
   * 查不到返回 null。楼中楼要给 root（它所在的那一楼）。
   */
  async commentState({ oid, type = 1, rpid, root = 0 }) {
    const isRoot = !root || String(root) === '0' || String(root) === String(rpid);
    for (let pn = 1; pn <= (isRoot ? 1 : 3); pn += 1) {
      const d = await this.request(`https://api.bilibili.com/x/v2/reply/detail?type=${type}&oid=${oid}&root=${isRoot ? rpid : root}&ps=20&pn=${pn}`);
      if (isRoot) return d?.root ? Number(d.root.state) : null;
      const hit = [...(d?.root?.replies ?? []), ...(d?.replies ?? [])].find((x) => String(x.rpid) === String(rpid));
      if (hit) return Number(hit.state);
      if (!(d?.replies ?? []).length) break;
    }
    return null;
  }

  delComment({ oid, type = 1, rpid }) {
    return this.request('https://api.bilibili.com/x/v2/reply/del', { method: 'POST', form: { oid, type, rpid, csrf: this.csrf() } });
  }

  /** 发一条文字私信。新接口要求查询串里带 WBI 签名的发送者、接收者、设备号。 */
  async sendDm({ receiverMid, text, devId = crypto.randomUUID().toUpperCase() }) {
    const csrf = this.csrf();
    const sender = Number(this.cookies.DedeUserID);
    const q = wbiSign({ w_sender_uid: sender, w_receiver_id: Number(receiverMid), w_dev_id: devId }, await this.mixinKey());
    return this.request(`https://api.vc.bilibili.com/web_im/v1/web_im/send_msg?${q}`, {
      method: 'POST',
      form: {
        'msg[sender_uid]': sender, 'msg[receiver_type]': 1, 'msg[receiver_id]': Number(receiverMid),
        'msg[msg_type]': 1, 'msg[msg_status]': 0, 'msg[dev_id]': devId, 'msg[timestamp]': Math.floor(Date.now() / 1000),
        'msg[new_face_version]': 0, 'msg[content]': JSON.stringify({ content: text }),
        from_firework: 0, build: 0, mobi_app: 'web', csrf_token: csrf, csrf,
      },
    });
  }

  /** 发一条纯文字动态。 */
  postDynamic(text) {
    const csrf = this.csrf();
    const uid = Number(this.cookies.DedeUserID);
    return this.request(`https://api.bilibili.com/x/dynamic/feed/create/dyn?platform=web&csrf=${csrf}`, {
      method: 'POST',
      json: {
        dyn_req: {
          content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
          scene: 1,
          attach_card: null,
          upload_id: `${uid}_${Math.floor(Date.now() / 1000)}_${Math.floor(1000 + Math.random() * 9000)}`,
          meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
        },
      },
    });
  }
}
