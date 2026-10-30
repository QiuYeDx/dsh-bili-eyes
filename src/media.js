// 视频文件从哪来：插件自己从 B站 下（DASH 画面 + 音轨，ffmpeg 合成 mp4），不需要 yt-dlp。
// yt-dlp 仍然可用（设置里的「视频来源」），这里的下载是它的替补，或者反过来。
//
// 清晰度按「短边」挑：竖屏视频的 height 是长边，按 height 比会把 1080×1920 当成 1920P。
// 编码优先 HEVC：同样清晰度体积约为 AVC 的 1/3，而且任何 ffmpeg 都自带解码器（AV1 要看编译选项）。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_FFMPEG, DEFAULT_FFPROBE } from 'dsh-video-storyboard/probe';
import { UA } from './bili-api.js';
import { localBin } from './ffmpeg-fetch.js';

const REFERER = 'https://www.bilibili.com';
const CODEC_RANK = { hev1: 0, hvc1: 0, avc1: 1, av01: 2 };
const shortSide = (t) => Math.min(t.width || t.height || 0, t.height || t.width || 0);

/**
 * 设置里填了 ffmpeg 就用它（ffprobe 取同目录的）；没填用 dsh-video-storyboard 找到的。
 * storyboard 在加载时就找好了：之后才在设置页一键下载的，要在这里补上。
 */
export function mediaBins(cfg) {
  if (!cfg.ffmpegPath) {
    return {
      ffmpegPath: DEFAULT_FFMPEG === 'ffmpeg' ? localBin('ffmpeg') ?? 'ffmpeg' : DEFAULT_FFMPEG,
      ffprobePath: DEFAULT_FFPROBE === 'ffprobe' ? localBin('ffprobe') ?? 'ffprobe' : DEFAULT_FFPROBE,
    };
  }
  const probe = path.join(path.dirname(cfg.ffmpegPath), path.basename(cfg.ffmpegPath).replace(/ffmpeg/i, 'ffprobe'));
  return { ffmpegPath: cfg.ffmpegPath, ffprobePath: fs.existsSync(probe) ? probe : DEFAULT_FFPROBE };
}

/** 从 DASH 画面轨里挑一条：短边不超过 maxShort 的最清楚的；同档按编码排。都超了就取最小的。 */
export function pickVideo(tracks, maxShort) {
  const list = tracks.filter((t) => t.baseUrl || t.base_url);
  const fit = list.filter((t) => shortSide(t) <= maxShort);
  const pool = fit.length ? fit : list.filter((t) => shortSide(t) === Math.min(...list.map(shortSide)));
  const best = Math.max(...pool.map(shortSide));
  const rank = (t) => CODEC_RANK[String(t.codecs).split('.')[0]] ?? 9;
  return pool.filter((t) => shortSide(t) === best).sort((a, b) => rank(a) - rank(b) || a.bandwidth - b.bandwidth)[0] ?? null;
}

/** 音轨只用来转写和算音量，挑最小的一条。 */
export function pickAudio(tracks = []) {
  return [...(tracks ?? [])].filter((t) => t.baseUrl || t.base_url).sort((a, b) => a.bandwidth - b.bandwidth)[0] ?? null;
}

const urlsOf = (t) => [t.baseUrl ?? t.base_url, ...(t.backupUrl ?? t.backup_url ?? [])].filter(Boolean);

/** 放大看时直接从远程取帧（ffmpeg 按需 seek，不整段下载）。 */
export async function directStream(client, { bvid, cid, maxShort }) {
  const dash = await client.playurl(bvid, cid);
  const v = pickVideo(dash.video, maxShort);
  if (!v) throw new Error('没有可用的画面轨');
  return { uri: urlsOf(v)[0], userAgent: UA, referer: REFERER, height: shortSide(v) };
}

// ffmpeg 能不能跑：缓存 5 分钟（没有 ffmpeg 时看视频直接只给文字，不要慢慢失败）
const ffmpegChecked = new Map();
export function ffmpegReady(cfg) {
  const bin = mediaBins(cfg).ffmpegPath;
  const hit = ffmpegChecked.get(bin);
  if (hit && Date.now() - hit.at < 300_000) return hit.p;
  const p = new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10_000, windowsHide: true }, (err) => resolve(!err));
  });
  ffmpegChecked.set(bin, { at: Date.now(), p });
  return p;
}
/** 设置页下载完 ffmpeg 后清掉缓存。 */
export function resetFfmpegCheck() { ffmpegChecked.clear(); }

export const mediaDirOf = (cfg) => cfg.mediaDir || path.join(os.tmpdir(), 'dsh-bili-eyes', 'media');

async function download(urls, file, signal) {
  let last;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, referer: REFERER }, signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file));
      return;
    } catch (e) { last = e; if (signal?.aborted) break; }
  }
  throw new Error(`下载失败：${last?.message ?? last}`);
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 << 20 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 200)));
      else resolve();
    });
  });
}

/** 超过容量上限就从最旧的删起（只动本插件下的文件，同目录里 yt-dlp 的缓存不碰）。 */
function prune(dir, maxBytes, keep) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^BV\w+-p\d+-\d+p\.mp4$/.test(f))
      .map((f) => { const p = path.join(dir, f); const st = fs.statSync(p); return { p, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => a.at - b.at);
  } catch { return; }
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files) {
    if (total <= maxBytes) break;
    if (f.p === keep) continue;
    try { fs.rmSync(f.p); total -= f.size; } catch { /* 正在被读就下次再删 */ }
  }
}

const inflight = new Map();
/**
 * 下载一个分 P 到本地，返回 mp4 路径。同一视频同一档清晰度只下一次（缓存在 mediaDir）。
 * @returns {Promise<{file:string, height:number, codec:string, bytes:number, cached:boolean}>}
 */
export function downloadVideo(client, { bvid, cid, page = 1, maxShort, cfg, timeoutMs = 300_000, log = () => {} }) {
  const dir = mediaDirOf(cfg);
  const file = path.join(dir, `${bvid}-p${page}-${maxShort}p.mp4`);
  if (inflight.has(file)) return inflight.get(file);
  const job = (async () => {
    try {
      const st = fs.statSync(file);
      const now = new Date();
      fs.utimesSync(file, now, now);   // 用到就算新的，清理时排后面
      return { file, height: null, codec: '', bytes: st.size, cached: true };
    } catch { /* 没有缓存 */ }
    fs.mkdirSync(dir, { recursive: true });
    const dash = await client.playurl(bvid, cid);
    let v = pickVideo(dash.video, maxShort);
    // 老视频只有 AVC，长片体积会很大（40 分钟 480P 约 240 MB）：估算超过 200 MB 就降一档
    while (v && (dash.duration || 0) * v.bandwidth / 8 > 200 * 1048576) {
      const lower = pickVideo(dash.video, shortSide(v) - 1);
      if (!lower || shortSide(lower) >= shortSide(v)) break;
      v = lower;
    }
    const a = pickAudio(dash.audio);
    if (!v) throw new Error('没有可用的画面轨');
    const tmp = `${file}.${process.pid}`;
    const signal = AbortSignal.timeout(timeoutMs);
    const t = Date.now();
    try {
      await Promise.all([download(urlsOf(v), `${tmp}.v`, signal), a ? download(urlsOf(a), `${tmp}.a`, signal) : null]);
      const { ffmpegPath } = mediaBins(cfg);
      await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', '-i', `${tmp}.v`, ...(a ? ['-i', `${tmp}.a`] : []),
        '-map', '0:v:0', ...(a ? ['-map', '1:a:0'] : []), '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], 120_000);
      fs.renameSync(tmp, file);
    } finally {
      for (const f of [`${tmp}.v`, `${tmp}.a`, tmp]) fs.rmSync(f, { force: true });
    }
    const bytes = fs.statSync(file).size;
    const codec = String(v.codecs).split('.')[0];
    log(`下载了 ${bvid} P${page}：${shortSide(v)}P ${codec}，${(bytes / 1048576).toFixed(1)} MB，${((Date.now() - t) / 1000).toFixed(1)} 秒`);
    prune(dir, cfg.mediaMaxMb * 1048576, file);
    return { file, height: shortSide(v), codec, bytes, cached: false };
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}
