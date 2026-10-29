// 配置：$DSH_HOME/bili-eyes.json（没有就用默认值）。登录信息和缓存在 $DSH_HOME/bili-eyes/ 下。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
export const DATA_DIR = path.join(DSH_HOME, 'bili-eyes');
export const CONFIG_FILE = path.join(DSH_HOME, 'bili-eyes.json');

export const DEFAULTS = Object.freeze({
  maxFindPerHour: 60,      // 每小时最多搜几次（bili_find）
  maxPerHour: 30,          // 每小时最多新看几个视频（缓存命中不算；放大看另算，上限是它的 2 倍）
  maxFullSeconds: 7200,    // 这个时长以内看完整；更长且没给 from/to：只看开头 longWindowSeconds
  longWindowSeconds: 7200,
  secondsPerCell: 60,      // 每格大约覆盖多久；视频越长分镜图越多（每张 16 格），直到 maxSheets
  maxSheets: 4,            // 一次最多几张分镜图（每张约 384 token）
  timeoutSeconds: 150,     // 分镜的最短超时；长视频会按时长自动放宽（最多 10 分钟），超时就只返回文字信息
  cacheHours: 24,          // 同一视频同一窗口的结果缓存多久
  comments: 5,             // 带几条热评（0 = 不带）
  danmaku: true,           // 带弹幕热词与高能时段
  textBudget: 2600,        // 返回文字的大致字数上限（一张图时；每多一张图再加 1000）
  useLogin: true,          // 有登录信息时用（AI 字幕、AI 总结、高画质）
  cacheDir: '',            // 分镜缓存目录（空 = dsh-video-storyboard 默认，在 C 盘）
  mediaDir: '',            // 下载的 360P 视频放哪（空 = 系统临时目录）
  mediaMaxMb: 2048,        // mediaDir 的容量上限
  ytdlpPath: '',           // yt-dlp 可执行文件（空 = PATH 上找）
  ffmpegPath: '',          // ffmpeg（空 = PATH 上找）
});

export function loadConfig(file = CONFIG_FILE) {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { /* 没有配置文件就用默认 */ }
  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(user)) if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) cfg[k] = v;
  return cfg;
}

// 设置页用的字段说明（界面按它渲染，保存时也按它校验）。scale：界面上显示的单位 = 存的值 / scale
export const FIELDS = Object.freeze([
  { key: 'maxFullSeconds', group: 'watch', type: 'int', min: 60, max: 36000, scale: 60, unit: '分钟', label: '这个时长以内看完整', hint: '更长的视频没指定 from/to 时只看开头一段' },
  { key: 'longWindowSeconds', group: 'watch', type: 'int', min: 60, max: 36000, scale: 60, unit: '分钟', label: '超长视频看开头多久' },
  { key: 'secondsPerCell', group: 'watch', type: 'int', min: 10, max: 600, unit: '秒', label: '每格大约覆盖多久', hint: '视频越长分镜图越多（每张 16 格），直到下面的张数上限' },
  { key: 'maxSheets', group: 'watch', type: 'int', min: 1, max: 8, unit: '张', label: '一次最多几张分镜图', hint: '每张约 384 token' },
  { key: 'timeoutSeconds', group: 'watch', type: 'int', min: 30, max: 600, unit: '秒', label: '分镜最短超时', hint: '长视频按时长自动放宽（最多 10 分钟）；超时只给文字' },
  { key: 'textBudget', group: 'watch', type: 'int', min: 500, max: 20000, unit: '字', label: '返回文字的字数上限', hint: '一张图时；每多一张图再加 1000' },
  { key: 'comments', group: 'watch', type: 'int', min: 0, max: 20, unit: '条', label: '带几条热评', hint: '0 = 不带' },
  { key: 'danmaku', group: 'watch', type: 'bool', label: '带弹幕热词和最密集时段' },
  { key: 'useLogin', group: 'watch', type: 'bool', label: '有登录信息时使用', hint: 'AI 字幕、AI 总结、1080P 放大' },
  { key: 'maxPerHour', group: 'limits', type: 'int', min: 1, max: 1000, unit: '个', label: '每小时最多新看几个视频', hint: '缓存命中不算；放大看的上限是它的 2 倍' },
  { key: 'maxFindPerHour', group: 'limits', type: 'int', min: 1, max: 1000, unit: '次', label: '每小时最多搜几次' },
  { key: 'cacheHours', group: 'limits', type: 'int', min: 0, max: 720, unit: '小时', label: '结果缓存多久', hint: '同一视频同一段再看直接用缓存；0 = 不用缓存' },
  { key: 'mediaMaxMb', group: 'limits', type: 'int', min: 100, max: 102400, unit: 'MB', label: '下载视频的容量上限', hint: '超了先删最旧的' },
  { key: 'cacheDir', group: 'paths', type: 'dir', label: '分镜缓存目录', hint: '留空 = dsh-video-storyboard 的默认位置（系统盘）' },
  { key: 'mediaDir', group: 'paths', type: 'dir', label: '下载视频的目录', hint: '留空 = 系统临时目录' },
  { key: 'ytdlpPath', group: 'paths', type: 'exe', exe: 'yt-dlp', label: 'yt-dlp 路径', hint: '留空 = 在 PATH 上找' },
  { key: 'ffmpegPath', group: 'paths', type: 'exe', exe: 'ffmpeg', label: 'ffmpeg 路径', hint: '留空 = 在 PATH 上找' },
]);

/** 校验一份完整配置，返回错误列表（空 = 合法）。 */
export function validateConfig(c) {
  const errors = [];
  for (const f of FIELDS) {
    const v = c[f.key];
    const show = (n) => (f.scale ? n / f.scale : n);
    if (f.type === 'int') {
      if (!Number.isInteger(v) || v < f.min || v > f.max) errors.push(`${f.label}要是 ${show(f.min)}~${show(f.max)}${f.unit ? ` ${f.unit}` : ''} 之间的整数`);
    } else if (f.type === 'bool') {
      if (typeof v !== 'boolean') errors.push(`${f.label}要是开或关`);
    } else if (typeof v !== 'string' || (v !== '' && !path.isAbsolute(v))) {
      errors.push(`${f.label}要是绝对路径（或留空）`);
    } else if (f.type === 'exe' && v && !new RegExp(`^${f.exe}(\\.exe)?$`, 'i').test(path.basename(v))) {
      errors.push(`${f.label}要指向 ${f.exe} 可执行文件`);
    }
  }
  return errors;
}

/** 合并一份局部修改并保存（文件里只留和默认值不同的项）；不合法就抛错，文件不动。 */
export function saveConfig(patch, file = CONFIG_FILE) {
  const next = { ...loadConfig(file) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in DEFAULTS)) continue;
    next[k] = typeof DEFAULTS[k] === 'string' ? String(v ?? '').trim().replace(/\\/g, '/') : v;
  }
  const errors = validateConfig(next);
  if (errors.length) { const err = new Error(errors.join('；')); err.errors = errors; throw err; }
  const out = {};
  for (const k of Object.keys(DEFAULTS)) if (next[k] !== DEFAULTS[k]) out[k] = next[k];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1));
  fs.renameSync(tmp, file);
  return next;
}

// dsh-video-storyboard 通过环境变量找 yt-dlp / ffmpeg、决定缓存位置；在调用前设好
// 设置页里清空某项时，撤掉之前由这里设的值（外部本来就有的环境变量不动）
const ENV_KEYS = { cacheDir: 'DSH_VIDEO_CACHE_DIR', mediaDir: 'DSH_VIDEO_MEDIA_DIR', mediaMaxMb: 'DSH_VIDEO_MEDIA_MAX_MB', ytdlpPath: 'DSH_YTDLP_PATH', ffmpegPath: 'DSH_FFMPEG_PATH' };
const ownEnv = new Map();
export function applyEnv(cfg, env = process.env) {
  for (const [k, name] of Object.entries(ENV_KEYS)) {
    if (cfg[k]) { env[name] = String(cfg[k]); ownEnv.set(name, env[name]); }
    else if (ownEnv.has(name) && env[name] === ownEnv.get(name)) { delete env[name]; ownEnv.delete(name); }
  }
}
