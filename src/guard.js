// 守评论区：盯着主人投稿的评论区，定时拉新评论交给评论引擎（engine.js）。
// 主人投稿下的新评论，通知是发给主人的号的，她的小号收不到，所以只能定时去看：
// 每个被盯的视频按时间拉最新的一页评论，记住看到哪了；第一次只记位置，不回旧评论。
// 只看顶层新评论；别人回复她的楼中楼走收件箱。
import { loadConfig } from './config.js';
import { loadCredential } from './credential.js';
import { clip } from './look.js';
import { writeClient, ownerName as ownerNameOf } from './interact.js';
import { inQuiet } from './inbox.js';
import { loadEngine, saveEngine, processBatch, reportLines, sendReport, engineLock } from './engine.js';

const VIDEO_REFRESH_MS = 30 * 60_000;
const BATCH = 12;          // 一次最多交给模型几条
const PENDING_MAX = 60;

/** 文本里的 BV 号（去重）。 */
export const bvList = (s) => [...new Set(String(s ?? '').match(/BV[0-9A-Za-z]{10}/g) ?? [])];

/** 主人最近的投稿（半小时更新一次）写进 st.guard.videos。 */
export async function refreshVideos(client, cfg, st, now = Date.now(), force = false) {
  if (!force && now - st.guard.videosAt < VIDEO_REFRESH_MS) return;
  const list = await client.upVideos(cfg.ownerMid);
  for (const v of list) st.guard.videos[v.bvid] = { ...(st.guard.videos[v.bvid] ?? {}), bvid: v.bvid, title: v.title, pubdate: v.pubdate, owner: true };
  st.guard.videosAt = now;
}

/**
 * 主人的投稿列表（设置页用）和现在盯着哪些。
 * 返回 [{bvid, title, pubdate, watched, manual, excluded, owner}]，新的在前。
 */
export function videoList(cfg, st, now = Date.now()) {
  const ex = new Set(bvList(cfg.guardExclude));
  const manual = new Set(bvList(cfg.guardVideos));
  const all = new Map(Object.values(st.guard.videos).filter((v) => v.owner !== false || manual.has(v.bvid)).map((v) => [v.bvid, v]));
  for (const b of manual) if (!all.has(b)) all.set(b, { bvid: b, title: '', pubdate: 0 });
  const recent = (v) => !(cfg.guardDays > 0 && v.pubdate && now / 1000 - v.pubdate > cfg.guardDays * 86400);
  return [...all.values()].map((v) => {
    const isManual = manual.has(v.bvid);
    const auto = cfg.guardAutoNew && v.owner !== false && recent(v);
    return { bvid: v.bvid, title: v.title ?? '', pubdate: v.pubdate ?? 0, owner: v.owner !== false, manual: isManual, excluded: ex.has(v.bvid), watched: (auto || isManual) && !ex.has(v.bvid) && v.owner !== false };
  }).sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));
}

/**
 * 设置页勾选 / 取消勾选一个投稿：改 guardExclude / guardVideos，返回要保存的配置补丁。
 */
export function togglePatch(cfg, st, bvid, watch, now = Date.now()) {
  const ex = bvList(cfg.guardExclude).filter((b) => b !== bvid);
  const manual = bvList(cfg.guardVideos);
  const v = st.guard.videos[bvid];
  const recent = v && !(cfg.guardDays > 0 && v.pubdate && now / 1000 - v.pubdate > cfg.guardDays * 86400);
  const autoCovers = cfg.guardAutoNew && v?.owner !== false && recent;
  if (watch) return { guardExclude: ex.join('\n'), guardVideos: (autoCovers || manual.includes(bvid) ? manual : [...manual, bvid]).join('\n') };
  return { guardExclude: (autoCovers ? [...ex, bvid] : ex).join('\n'), guardVideos: manual.filter((b) => b !== bvid).join('\n') };
}

let running = false;
/**
 * 看一次（定时，或者设置页「现在看一次」force=true）。
 * @param {{cfg?, getAsk?:()=>Function|null, now?, log?, force?, deps?}} o
 */
export async function pollGuard({ cfg = loadConfig(), getAsk = null, now = Date.now(), log = () => {}, force = false, deps = {} } = {}) {
  if (running) return { checked: false, reason: '正在看' };
  if (!force && cfg.guardMode === 'off') return { checked: false, reason: '没开' };
  if (!cfg.ownerMid) return { checked: false, error: '还没设置主人 UID（互动 → 设置）' };
  const quiet = inQuiet(cfg.inboxQuiet, new Date(now));
  if (!force) {
    if (quiet && cfg.inboxQuietMode === 'skip') return { checked: false, reason: '安静时段' };
    if (now - loadEngine().guard.lastPoll < cfg.guardIntervalMinutes * 60_000) return { checked: false, reason: '还没到时间' };
  }
  const cred = loadCredential();
  if (!cred) return { checked: false, error: 'B站没登录' };
  running = true;
  try {
    return await engineLock(async () => {
      const st = loadEngine();
      st.guard.lastPoll = now;
      try {
        const client = await (deps.writeClient ?? writeClient)(cfg);
        await refreshVideos(client, cfg, st, now, force);
        const watched = videoList(cfg, st, now).filter((v) => v.watched);
        const fresh = [];
        for (const w of watched) {
          let v = st.guard.videos[w.bvid] ?? { bvid: w.bvid };
          if (!v.aid) {
            const info = await client.view({ bvid: w.bvid });
            v = { ...v, bvid: w.bvid, aid: Number(info.aid), title: info.title ?? v.title ?? '', desc: clip(info.desc, 500), pubdate: Number(info.pubdate) || v.pubdate || 0, owner: Number(info.owner?.mid) === Number(cfg.ownerMid) };
            st.guard.videos[w.bvid] = v;
          }
          if (!v.owner) continue;   // 手动加的不是主人的投稿：不盯（设置页会标出来）
          const c = await client.comments(v.aid, { sort: 'new', n: 20 });
          const cursor = st.guard.cursors[v.aid];
          const maxAt = Math.max(Number(cursor) || 0, ...c.list.map((x) => x.at));
          if (cursor == null) { st.guard.cursors[v.aid] = maxAt || now; continue; }   // 第一次：只记位置
          for (const x of c.list) {
            if (x.at <= cursor) continue;
            fresh.push({ key: x.rpid, source: 'guard', oid: v.aid, type: 1, root: x.rpid, parent: x.rpid, rpid: x.rpid, at: x.at, user: { mid: x.mid, name: x.user }, text: x.text, replies: x.replies, bvid: v.bvid, title: v.title, url: `https://www.bilibili.com/video/${v.bvid}`, ownerVideo: true });
          }
          st.guard.cursors[v.aid] = maxAt;
        }
        const known = new Set(st.guard.pending.map((x) => x.key));
        st.guard.pending = [...st.guard.pending, ...fresh.filter((x) => !known.has(x.key))].slice(-PENDING_MAX);

        const hold = quiet && cfg.inboxQuietMode === 'hold' && !force;
        let res = { results: [] };
        if (!hold && cfg.guardMode !== 'off' && st.guard.pending.length) {
          const batch = st.guard.pending.slice(0, BATCH);
          const name = await ownerNameOf(client, cfg).catch(() => '');
          res = await processBatch(batch, { cfg, ask: getAsk?.() ?? null, client, selfMid: Number(cred.cookies.DedeUserID) || 0, ownerName: name, st, now, deps });
          const done = new Set(res.results.filter((r) => r.action !== 'held').map((r) => r.key));
          st.guard.pending = st.guard.pending.filter((x) => !done.has(x.key));
          const lines = reportLines(res.results, cfg.guardReport);
          if (lines.length) await sendReport(lines, { cfg, st, now });
        }
        st.guard.lastError = res.error ?? '';
        const n = (a) => res.results.filter((r) => r.action === a).length;
        if (fresh.length || res.results.length) log(`守评论区：新评论 ${fresh.length} 条；回了 ${n('replied')}，起草 ${n('draft')}，转告主人 ${n('notified')}，跳过 ${n('skipped')}${hold ? '（安静时段，先攒着）' : ''}`);
        return { checked: true, videos: watched.length, fresh: fresh.length, pending: st.guard.pending.length, hold, replied: n('replied'), draft: n('draft'), notified: n('notified'), skipped: n('skipped'), error: res.error };
      } catch (e) {
        st.guard.lastError = clip(e?.message ?? e, 160);
        return { checked: false, error: st.guard.lastError };
      } finally {
        saveEngine(st);
      }
    });
  } finally { running = false; }
}
