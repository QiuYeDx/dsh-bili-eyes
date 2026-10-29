// 配置：$DSH_HOME/bili-eyes.json（没有就用默认值）。登录信息和缓存在 $DSH_HOME/bili-eyes/ 下。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
export const DATA_DIR = path.join(DSH_HOME, 'bili-eyes');
export const CONFIG_FILE = path.join(DSH_HOME, 'bili-eyes.json');

export const DEFAULTS = Object.freeze({
  maxPerHour: 12,          // 每小时最多新看几个视频（缓存命中不算）
  maxFullSeconds: 1200,    // 超过这个时长且没给 from/to：只看开头 longWindowSeconds
  longWindowSeconds: 600,
  timeoutSeconds: 150,     // 分镜超过这么久就放弃画面，只返回文字信息
  cacheHours: 24,          // 同一视频同一窗口的结果缓存多久
  comments: 5,             // 带几条热评（0 = 不带）
  danmaku: true,           // 带弹幕热词与高能时段
  textBudget: 2600,        // 返回文字的大致字数上限
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

// dsh-video-storyboard 通过环境变量找 yt-dlp / ffmpeg、决定缓存位置；在调用前设好
export function applyEnv(cfg, env = process.env) {
  if (cfg.cacheDir) env.DSH_VIDEO_CACHE_DIR = cfg.cacheDir;
  if (cfg.mediaDir) env.DSH_VIDEO_MEDIA_DIR = cfg.mediaDir;
  if (cfg.mediaMaxMb) env.DSH_VIDEO_MEDIA_MAX_MB = String(cfg.mediaMaxMb);
  if (cfg.ytdlpPath) env.DSH_YTDLP_PATH = cfg.ytdlpPath;
  if (cfg.ffmpegPath) env.DSH_FFMPEG_PATH = cfg.ffmpegPath;
}
