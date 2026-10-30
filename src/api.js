// 设置页用的本地接口（挂在 DSH 的 webServer 上，同源；开发预览服务器也复用这个 handler）。
//   GET  /api/bili-eyes?view=overview|config|inbox|act
//   POST /api/bili-eyes {action, ...}   保存配置、扫码登录、清缓存、试看、刷列表、逛一圈、查收件箱、处理草稿…
// 只接受同源请求，请求体 ≤ 16 KB。登录信息（cookies）永远不经过这个接口返回。
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { BiliClient } from './bili-api.js';
import { loadConfig, saveConfig, DEFAULTS, FIELDS, CONFIG_FILE, DATA_DIR, DSH_HOME } from './config.js';
import { loadCredential, saveCredential, removeCredential, qrGenerate, qrPoll } from './credential.js';
import { readHistory, clearHistory } from './history.js';
import { look, lookZoom, find, usage, resetLoginCache, makeClient, InputError } from './look.js';
import { BiliError } from './bili-api.js';
import { feed } from './feed.js';
import { surf } from './surf.js';
import { loadTrails } from './surf-agent.js';
import { loadAuto, ensurePlan, autoSurfNow } from './auto-surf.js';
import { loadInbox, saveInbox, markItems } from './inbox.js';
import { pollInbox, ownerName, writeClient } from './interact.js';
import { loadDrafts, readAudit, todayCounts, confirm, deleteSent, deletedIds, visibleIds, recheckHidden, ownFollows, ownerUnfollow, recheckFollows, ownFavs, ownerUnfav, KIND_TEXT, ActError, sleep } from './act.js';
import { sessionContext, gateKind, hello, recentJudgments } from './gate.js';
import { ALL_TOOLS } from './tool-list.js';
import { checkBridge } from './adapters/dsh-qq.js';
import { loadEngine, saveEngine, engineLock, engineCount, ACTION_TEXT, CATS } from './engine.js';
import { pollGuard, videoList, togglePatch } from './guard.js';
import { asrView, saveAsr, clearAsr, testAsr } from './asr-config.js';
import { patchStatus, applyPatches } from './adapters/dsh-qq-patch.js';
import { mediaBins, mediaDirOf, resetFfmpegCheck } from './media.js';
import { installFfmpeg, installState } from './ffmpeg-fetch.js';

export const API_ROUTE = '/api/bili-eyes';
export const TOOL_NAMES = ALL_TOOLS;
const RESULT_CACHE = path.join(DATA_DIR, 'cache');
const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 16384) { reject(new Error('请求太大')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('请求不是 JSON')); } });
    req.on('error', reject);
  });
}

// ── 小工具 ────────────────────────────────────────────────────────────────
/** 目录总大小（最多数 20000 个文件，够用且不会卡住）。 */
export function dirStats(dir) {
  let bytes = 0; let files = 0;
  const walk = (d) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files >= 20000) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += fs.statSync(p).size; files += 1; } catch { /* 忽略 */ } }
    }
  };
  if (dir && fs.existsSync(dir)) walk(dir);
  return { dir, bytes, files };
}

/** 清理目录内容：只清这几个插件自己的目录，而且拒绝盘符根目录这类过短的路径。 */
export function clearDir(dir) {
  const abs = path.resolve(dir);
  if (abs.split(/[\\/]/).filter(Boolean).length < 2) throw new Error(`路径太短，不清理：${abs}`);
  const before = dirStats(abs);
  if (fs.existsSync(abs)) for (const e of fs.readdirSync(abs)) fs.rmSync(path.join(abs, e), { recursive: true, force: true });
  return before;
}

function checkWritableDir(dir) {
  try {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, error: '要是绝对路径' };
    const existed = fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { ok: true, existed };
  } catch (e) {
    return { ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? '没有写入权限' : e.message };
  }
}

/** 跑一下 yt-dlp / ffmpeg / ffprobe 看版本。只允许文件名是 yt-dlp / ffmpeg / ffprobe 的程序。 */
export function toolVersion(kind, file) {
  const name = { ytdlp: 'yt-dlp', ffprobe: 'ffprobe' }[kind] ?? 'ffmpeg';
  const exe = file || name;
  if (file && !new RegExp(`^${name}(\\.exe)?$`, 'i').test(path.basename(file))) return Promise.resolve({ ok: false, error: `不是 ${name}` });
  return new Promise((resolve) => {
    execFile(exe, [kind === 'ytdlp' ? '--version' : '-version'], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.code === 'ENOENT' ? (file ? '文件不存在' : '在 PATH 上找不到') : String(err.message).slice(0, 120) });
      const first = String(stdout).split('\n')[0].trim();
      resolve({ ok: true, version: kind === 'ytdlp' ? first : (first.match(/version (\S+)/)?.[1] ?? first) });
    });
  });
}

function asrInfo() {
  const file = path.join(DSH_HOME, 'asr.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return { ok: Boolean(c.baseUrl), file, baseUrl: c.baseUrl ?? '', model: c.model ?? '', managed: Array.isArray(c.manage?.start) };
  } catch { return { ok: false, file }; }
}

// 登录状态：查一次 B站接口，缓存 60 秒
let loginCache = { at: 0, value: null };
async function loginInfo(force = false) {
  if (!force && loginCache.value && Date.now() - loginCache.at < 60_000) return loginCache.value;
  const cred = loadCredential();
  let value;
  if (!cred) value = { state: 'none' };
  else {
    try {
      const nav = await new BiliClient({ cookies: cred.cookies }).nav();
      value = nav.isLogin
        ? { state: 'ok', uname: nav.uname ?? cred.uname ?? '', mid: nav.mid ?? cred.mid ?? 0, vip: Boolean(nav.vipStatus), level: nav.level_info?.current_level ?? null, savedAt: cred.savedAt ?? '' }
        : { state: 'expired', uname: cred.uname ?? '', savedAt: cred.savedAt ?? '' };
    } catch (e) {
      value = { state: 'unknown', uname: cred.uname ?? '', savedAt: cred.savedAt ?? '', error: String(e.message).slice(0, 120) };
    }
  }
  loginCache = { at: Date.now(), value };
  return value;
}

// 扫码登录：二维码的 key 只留在服务端，界面只拿到图片
let pendingLogin = null;

const dataUrl = (buf) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;

// ── 视图 ──────────────────────────────────────────────────────────────────
function cacheInfo(cfg) {
  return {
    results: dirStats(RESULT_CACHE),
    storyboard: cfg.cacheDir ? dirStats(cfg.cacheDir) : { dir: '', bytes: 0, files: 0 },
    media: cfg.mediaDir ? dirStats(cfg.mediaDir) : { dir: '', bytes: 0, files: 0 },
    mediaMaxMb: cfg.mediaMaxMb,
    cacheHours: cfg.cacheHours,
  };
}

// 列表的筛选和分页：days（0 = 全部）、limit（一次给几条，「加载更多」就加大）
const daysSince = (q) => { const d = Number(q.get('days')); return d > 0 ? Date.now() - d * 86400_000 : 0; };
const limitOf = (q, def = 50) => Math.min(500, Math.max(10, Number(q.get('limit')) || def));
const pick = (q, k) => String(q.get(k) ?? '').trim();

async function getView(view, ctx, q = new URLSearchParams()) {
  const cfg = loadConfig();
  if (view === 'overview') {
    const bins = mediaBins(cfg);
    const [login, ytdlp, ffmpeg, ffprobe] = await Promise.all([loginInfo(), toolVersion('ytdlp', cfg.ytdlpPath), toolVersion('ffmpeg', bins.ffmpegPath === 'ffmpeg' ? '' : bins.ffmpegPath), toolVersion('ffprobe', bins.ffprobePath === 'ffprobe' ? '' : bins.ffprobePath)]);
    const asr = asrInfo();
    const gk = gateKind(cfg);
    const judged = recentJudgments();
    const media = ffmpeg.ok && ffprobe.ok;
    const dl = installState();
    const onC = (p) => /^[a-z]:/i.test(p) && p[0].toLowerCase() === 'c';
    const registered = ctx.registered();
    const loginText = { ok: `B站已登录：${login.uname}`, expired: 'B站登录已过期', unknown: '暂时查不到 B站登录状态', none: 'B站没登录' }[login.state];
    return {
      version: PKG.version,
      login,
      usage: usage(cfg),
      cache: cacheInfo(cfg),
      checks: [
        { id: 'tools', ok: registered, label: registered ? `${TOOL_NAMES.length} 个工具已注册：${TOOL_NAMES.join('、')}` : '工具没注册', hint: registered ? '' : (ctx.registerError?.() || '在 DSH 里启用 dsh-bili-eyes 后彻底重启 DSH') },
        { id: 'ytdlp', ok: ytdlp.ok, optional: true, label: ytdlp.ok ? `yt-dlp ${ytdlp.version}` : `没有 yt-dlp：${ytdlp.error}`, hint: ytdlp.ok ? '' : '可选：插件自己能从 B站 下视频；装了 yt-dlp（winget install yt-dlp.yt-dlp）可以当后备' },
        { id: 'ffmpeg', ok: media, label: media ? `ffmpeg ${ffmpeg.version}，ffprobe ${ffprobe.version}` : `${ffmpeg.ok ? 'ffprobe' : 'ffmpeg'} 不可用：${(ffmpeg.ok ? ffprobe : ffmpeg).error}`, hint: media ? '' : '缺了它看不了画面，只有标题、简介、评论、字幕这些文字。点「下载」自动装到 DSH 的工具目录（约 50 MB），或者自己装好后在「设置 → 存储」里指定', install: !media || dl.running ? dl : null },
        { id: 'login', ok: login.state === 'ok', optional: true, label: login.state === 'ok' && login.level != null ? `${loginText}（LV${login.level}）` : loginText, hint: login.state === 'ok' ? (login.level === 0 ? 'LV0 不能发评论：去 B站 App 答题转正' : '') : '可选：不登录也能看视频；登录后才有 AI 字幕、AI 总结、1080P 放大、个性化推荐、关注动态、收件箱和写操作（建议用小号）' },
        { id: 'owner', ok: cfg.ownerMid > 0, optional: true, label: cfg.ownerMid > 0 ? `主人 UID：${cfg.ownerMid}` : '没设置主人的 B站 UID', hint: cfg.ownerMid > 0 ? '' : '可选：设置后她才能 @ 主人、私信主人、转达主人的私信（「互动 → 设置」）' },
        { id: 'gate', ok: true, optional: gk === 'builtin', label: { service: '门卫：桥接插件提供', 'dsh-qq': `门卫：dsh-qq 桥接（${cfg.qqBridgeDir}）`, http: `门卫：${cfg.gateUrl}`, builtin: '门卫：内置（按会话的 agentPreset / 工作目录判断）' }[gk], hint: (gk === 'builtin' ? '内置门卫只是推断：本机会话「先问主人」时弹 DSH 审批卡片；桥接会话只能起草、在「互动 → 待同意」里同意；收件箱没处转达。接 QQ 等桥接时最好让桥接提供门卫（docs/门卫协议.md）。' : '') + (judged.length ? ` 最近的会话：${judged.slice(0, 4).map((j) => `${j.label}${j.trusted ? '✓' : '✗'}`).join('，')}` : '') },
        { id: 'inbox', ok: cfg.inboxOn, optional: true, label: cfg.inboxOn ? `收件箱：每 ${cfg.inboxIntervalSeconds} 秒查一次${cfg.inboxQuiet ? `，${cfg.inboxQuiet} 不查` : ''}` : '收件箱没开', hint: cfg.inboxOn ? (gk === 'builtin' ? '没接门卫：新消息不会主动转达，她下次用 B站工具时会提一句' : '') : '可选：在「收件箱 → 设置」里打开后，别人回复、@、私信会转达给她' },
        { id: 'disk', ok: !onC(mediaDirOf(cfg)), optional: true, label: `下载的视频放在 ${mediaDirOf(cfg)}`, hint: onC(mediaDirOf(cfg)) ? '在系统盘：视频多了占地方，可以在「设置 → 存储」换到别的盘' : '' },
        { id: 'asr', ok: asr.ok, optional: true, label: asr.ok ? `语音识别：${asr.baseUrl}${asr.model ? `（${asr.model}）` : ''}${asr.managed ? '，用到时自动拉起' : ''}` : '没配置语音识别', hint: asr.ok ? '' : '可选：没有字幕的视频就没有台词。在「设置 → 语音识别」里配：硅基流动填个 API Key 就行，也可以用本机服务' },
      ],
      todo: (() => {
        const drafts = loadDrafts().list.filter((x) => x.status === 'pending' && Date.now() - x.createdAt <= cfg.draftMinutes * 60_000).length;
        const inbox = loadInbox().items.filter((x) => x.status === 'new' || x.status === 'notified').length;
        const auto = cfg.autoSurfOn ? ensurePlan(loadAuto(), cfg, Date.now()) : null;
        const next = auto ? auto.slots.find((t) => !auto.done.includes(t) && t > Date.now()) ?? null : null;
        const counts = todayCounts(readAudit(500));
        return { drafts, inbox, inboxOn: cfg.inboxOn, autoSurf: { on: cfg.autoSurfOn, next }, writes: Object.entries(counts).filter(([k]) => k !== 'delete' && k !== 'visible').reduce((a, [, b]) => a + b, 0), counts };
      })(),
      configFile: CONFIG_FILE,
    };
  }
  if (view === 'history') {
    const from = daysSince(q); const kind = pick(q, 'kind'); const source = pick(q, 'source');
    const all = readHistory(1000).filter((e) => e.at >= from && (!kind || e.kind === kind) && (!source || e.source === source));
    const limit = limitOf(q);
    return { items: all.slice(0, limit), total: all.length };
  }
  if (view === 'actlog') {
    const entries = readAudit(2000);
    const gone = deletedIds(entries); const shown = visibleIds(entries);
    const from = daysSince(q); const kind = pick(q, 'kind'); const status = pick(q, 'status');
    const all = entries.filter((e) => e.kind !== 'delete' && e.kind !== 'visible' && e.at >= from && (!kind || e.kind === kind) && (!status || e.status === status));
    const limit = limitOf(q);
    return {
      items: all.slice(0, limit).map((e) => ({ ...e, deleted: gone.has(e.id), nowVisible: shown.has(e.id) })),
      total: all.length,
      hiddenOpen: entries.some((e) => e.status === 'hidden' && !gone.has(e.id) && !shown.has(e.id) && Date.now() - e.at < 7 * 86400_000),
      kindText: KIND_TEXT,
    };
  }
  if (view === 'trails') return { trails: loadTrails() };
  if (view === 'cache') return { cache: cacheInfo(cfg) };
  if (view === 'asr') return asrView();
  if (view === 'autosurf') {
    const st = cfg.autoSurfOn ? ensurePlan(loadAuto(), cfg, Date.now()) : loadAuto();
    return { on: cfg.autoSurfOn, day: st.day, slots: cfg.autoSurfOn ? st.slots : [], done: st.done, runs: st.runs.slice(0, 15), gate: gateKind(cfg) !== 'builtin' };
  }
  if (view === 'config') return { config: cfg, defaults: DEFAULTS, fields: FIELDS, configFile: CONFIG_FILE };
  if (view === 'inbox') {
    const st = loadInbox();
    const status = pick(q, 'status');   // open = 待处理（新的和已转达的）；空 = 全部
    const from = daysSince(q);
    const isOpen = (x) => x.status === 'new' || x.status === 'notified';
    const all = [...st.items].reverse().filter((x) => (x.at ?? 0) >= from && (status !== 'open' || isOpen(x)));
    const limit = limitOf(q);
    return { items: all.slice(0, limit), total: all.length, open: st.items.filter(isOpen).length, lastCheck: st.lastCheck, lastError: st.lastError, started: Boolean(st.baseline), on: cfg.inboxOn, gate: gateKind(cfg) !== 'builtin' };
  }
  if (view === 'guard') {
    const st = loadEngine();
    const source = pick(q, 'source', ['guard', 'inbox']);
    const action = pick(q, 'action', Object.keys(ACTION_TEXT));
    const from = daysSince(q);
    const all = [...st.decisions].reverse().filter((d) => d.at >= from && (!source || d.source === source) && (!action || d.action === action));
    const limit = limitOf(q);
    return {
      mode: cfg.guardMode,
      inboxMode: cfg.inboxReplyMode,
      ownerMid: cfg.ownerMid,
      videos: videoList(cfg, st).map((v) => ({ ...v, note: st.notes[v.bvid] ?? '' })),
      videosAt: st.guard.videosAt,
      lastPoll: st.guard.lastPoll,
      lastError: st.guard.lastError,
      pending: st.guard.pending.length,
      today: engineCount(readAudit(2000)),
      perDay: cfg.engQuotaShared ? cfg.replyPerDay : cfg.engPerDay,
      items: all.slice(0, limit),
      total: all.length,
      actionText: ACTION_TEXT,
      cats: CATS,
      gate: gateKind(cfg) !== 'builtin',
    };
  }
  if (view === 'act') {
    const entries = readAudit(500);
    const drafts = loadDrafts();
    const login = await loginInfo();
    let owner = '';
    if (cfg.ownerMid) { try { owner = await ownerName(makeClient({ ...cfg, useLogin: true }).client, cfg); } catch { owner = ''; } }
    return {
      login,
      owner: { mid: cfg.ownerMid, name: owner },
      modes: { like: cfg.likeMode, comment: cfg.commentMode, dm: cfg.dmMode, post: cfg.postMode, follow: cfg.followMode },
      counts: todayCounts(entries),
      quota: { like: cfg.likePerDay, fav: cfg.favPerDay, comment: cfg.commentPerDay, reply: cfg.replyPerDay, dm: cfg.dmPerDay, post: cfg.postPerDay, follow: cfg.followPerDay },
      favs: ownFavs(readAudit(2000)),
      favFolder: cfg.favFolder || '默认收藏夹',
      follows: ownFollows(readAudit(2000)),
      followTag: cfg.followTag || DEFAULTS.followTag,
      followPausedUntil: drafts.followPausedUntil > Date.now() ? drafts.followPausedUntil : 0,
      followPauseReason: drafts.followPauseReason,
      paused: cfg.writePaused,
      pausedUntil: drafts.pausedUntil > Date.now() ? drafts.pausedUntil : 0,
      pauseReason: drafts.pauseReason,
      drafts: drafts.list.filter((d) => d.status === 'pending').map((d) => ({ ...d, expired: Date.now() - d.createdAt > cfg.draftMinutes * 60_000 })),
      kindText: KIND_TEXT,
      gate: gateKind(cfg) !== 'builtin',
    };
  }
  throw new Error(`不认识的 view：${view}`);
}

const CACHE_DIRS = {
  results: () => RESULT_CACHE,
  storyboard: (cfg) => cfg.cacheDir,
  media: (cfg) => cfg.mediaDir,
};

async function postAction(body, ctx) {
  const cfg = loadConfig();
  switch (body.action) {
    case 'saveConfig': return { config: saveConfig(body.config ?? {}) };
    case 'resetConfig': {
      const group = body.group;
      const keys = FIELDS.filter((f) => f.group === group).map((f) => f.key);
      if (!keys.length) throw new Error('不认识的分组');
      return { config: saveConfig(Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]]))) };
    }
    case 'checkPath': return checkWritableDir(String(body.path ?? '').trim());
    case 'checkTool': return toolVersion(body.kind === 'ytdlp' ? 'ytdlp' : 'ffmpeg', String(body.path ?? '').trim());
    case 'ffmpegInstall': return { install: installFfmpeg() };
    case 'ffmpegState': {
      const s = installState();
      if (s.done) resetFfmpegCheck();
      return { install: s };
    }
    case 'refreshLogin': return { login: await loginInfo(true) };
    case 'loginStart': {
      const { url, key } = await qrGenerate();
      pendingLogin = { key, at: Date.now() };
      return { qr: await QRCode.toDataURL(url, { width: 240, margin: 1 }) };
    }
    case 'loginPoll': {
      if (!pendingLogin) return { state: 'expired' };
      if (Date.now() - pendingLogin.at > 175_000) { pendingLogin = null; return { state: 'expired' }; }
      const r = await qrPoll(pendingLogin.key);
      if (r.state === 'expired') pendingLogin = null;
      if (r.state !== 'ok') return { state: r.state };
      pendingLogin = null;
      const nav = await new BiliClient({ cookies: r.cookies }).nav().catch(() => ({}));
      saveCredential({ cookies: r.cookies, refreshToken: r.refreshToken, uname: nav.uname ?? '', mid: nav.mid ?? 0, savedAt: new Date().toISOString() });
      resetLoginCache();
      return { state: 'ok', login: await loginInfo(true) };
    }
    case 'logout':
      removeCredential();
      resetLoginCache();
      return { login: await loginInfo(true) };
    case 'clearCache': {
      const dir = CACHE_DIRS[body.which]?.(cfg);
      if (!dir) throw new Error(body.which in CACHE_DIRS ? '这个目录用的是默认位置，这里不清理' : '不认识的缓存');
      return { cleared: clearDir(dir) };
    }
    case 'clearHistory': clearHistory(); return {};
    case 'openFolder': {
      const dir = body.which === 'data' ? DATA_DIR : CACHE_DIRS[body.which]?.(cfg);
      if (!dir) throw new Error('这个目录用的是默认位置');
      fs.mkdirSync(dir, { recursive: true });
      if (process.platform === 'win32') spawn('explorer.exe', [path.normalize(dir)], { detached: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
      return { opened: dir };
    }
    case 'try': {
      const t = Date.now();
      try {
        let r;
        if (body.mode === 'find') r = await find({ query: body.query, order: body.order, duration: body.duration, limit: body.limit }, { source: 'ui' });
        else if (body.mode === 'zoom') r = await lookZoom({ url: body.url, from: Number(body.from), to: Number(body.to), cells: body.cells ? Number(body.cells) : undefined }, { source: 'ui' });
        else {
          const args = { url: body.url, detail: body.detail === 'low' ? 'low' : 'med' };
          if (body.from !== '' && body.from != null) args.from = Number(body.from);
          if (body.to !== '' && body.to != null) args.to = Number(body.to);
          r = await look(args, { source: 'ui' });
        }
        return { text: r.text, images: r.pngs.map(dataUrl), cached: Boolean(r.cached), ms: Date.now() - t, meta: r.meta ?? null, items: r.items ?? null };
      } catch (e) {
        if (e instanceof InputError || e instanceof BiliError || e instanceof ActError) throw new Error(e.message);
        throw e;
      }
    }
    case 'feed': {
      const r = await feed({ source: body.source, up: body.up, limit: 12 }, { source: 'ui' });
      return { items: r.items, title: r.meta.title };
    }
    case 'surf': {
      const t = Date.now();
      const r = await surf({ direction: body.direction ?? '' }, { source: 'ui', ask: ctx.ask?.() ?? null });
      return { text: r.text, items: r.items ?? [], ms: Date.now() - t, model: Boolean(ctx.ask?.()), mode: r.meta?.mode ?? 'quick', steps: r.meta?.steps ?? 0 };
    }
    case 'inboxCheck': return pollInbox({ force: true, getAsk: ctx.ask, log: ctx.log });
    case 'guardNow': return pollGuard({ force: true, getAsk: ctx.ask, log: ctx.log });
    case 'guardToggle': {
      const bvid = String(body.bvid ?? '');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new InputError('BV 号不对');
      return { config: saveConfig(togglePatch(cfg, loadEngine(), bvid, body.watch === true)) };
    }
    case 'guardNote': {
      const bvid = String(body.bvid ?? '');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new InputError('BV 号不对');
      const text = String(body.text ?? '').trim();
      if (text.length > 1000) throw new InputError('问答备忘最多 1000 个字');
      return engineLock(() => { const st = loadEngine(); if (text) st.notes[bvid] = text; else delete st.notes[bvid]; saveEngine(st); return { ok: true }; });
    }
    case 'autoSurfNow': return { run: await autoSurfNow({ ask: ctx.ask?.() ?? null, log: ctx.log }) };
    case 'inboxMark': {
      const st = loadInbox();
      const n = markItems(st, body.ids, ['done', 'ignored', 'new'].includes(body.status) ? body.status : 'done');
      saveInbox(st);
      return { changed: n };
    }
    case 'asrSave': return saveAsr({ mode: body.mode, baseUrl: body.baseUrl, model: body.model, key: body.key, language: body.language, start: body.start });
    case 'asrClear': return clearAsr();
    case 'asrTest': return testAsr();
    case 'dshqqCheck': {
      if (!cfg.qqBridgeDir) throw new Error('还没填 dsh-qq 桥接目录（填好先保存）');
      return { check: await checkBridge(cfg.qqBridgeDir), patches: patchStatus(cfg.qqBridgeDir) };
    }
    case 'dshqqPatch': {
      if (!cfg.qqBridgeDir) throw new Error('还没填 dsh-qq 桥接目录（填好先保存）');
      return { steps: applyPatches(cfg.qqBridgeDir, { revert: body.revert === true }) };
    }
    case 'gateTest': {
      if (gateKind(cfg) === 'builtin') throw new Error(cfg.gateMode === 'dsh-qq' ? '门卫来源选了 dsh-qq，但还没填桥接目录' : '现在用的是内置门卫（没填门卫地址，也没有桥接提供门卫服务）');
      const t = Date.now();
      const hi = await hello(cfg);
      const c = await sessionContext(cfg, 'gate-test');
      if (/门卫没响应/.test(c.label)) throw new Error(c.label);
      return { ms: Date.now() - t, label: `${c.label || '（门卫没给说明）'}；协议 v${hi.protocol}${hi.name ? `（${hi.name}）` : ''}` };
    }
    case 'ownerLookup': {
      const mid = Number(body.mid);
      if (!Number.isSafeInteger(mid) || mid <= 0) throw new Error('UID 是一串数字');
      return { owner: await makeClient({ ...cfg, useLogin: true }).client.card(mid) };
    }
    case 'draft': {
      const decision = body.decision === 'drop' ? 'drop' : 'send';
      const client = decision === 'send' ? await writeClient(cfg) : null;
      return confirm(Number(body.id), decision, { cfg, client, via: 'ui' });
    }
    case 'recheck': return recheckHidden({ client: await writeClient(cfg) });
    case 'unfollow': return ownerUnfollow(Number(body.mid), { cfg, client: await writeClient(cfg) });
    case 'unfav': return ownerUnfav(Number(body.aid), { cfg, client: await writeClient(cfg) });
    case 'undoTodayFollows': {
      const client = await writeClient(cfg);
      const today = new Date().toDateString();
      const list = ownFollows(readAudit(2000)).filter((f) => new Date(f.at).toDateString() === today);
      let done = 0;
      for (const f of list) {
        if (done) await sleep(5500);   // 设置页取关之间也隔 5 秒
        const r = await ownerUnfollow(f.mid, { cfg, client });
        if (r.status === 'sent') done += 1;
      }
      return { total: list.length, done };
    }
    case 'recheckFollows': return recheckFollows({ client: await writeClient(cfg) });
    case 'deleteSent': return deleteSent(String(body.id ?? ''), { client: await writeClient(cfg) });
    default: throw new Error(`不认识的操作：${body.action}`);
  }
}

/** 主接口。ctx.registered(): 工具是否已注册（DSH 里由插件提供，预览服务器里模拟）。 */
export function makeApiHandler(ctx = { registered: () => true }) {
  return async function handler(req, res) {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, error: '只接受本机 DSH 页面的请求' });
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET') return json(res, 200, { ok: true, ...await getView(url.searchParams.get('view') || 'overview', ctx, url.searchParams) });
      if (req.method === 'POST') return json(res, 200, { ok: true, ...await postAction(await readBody(req), ctx) });
      return json(res, 405, { ok: false, error: '只支持 GET / POST' });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message, errors: e.errors });
    }
  };
}

