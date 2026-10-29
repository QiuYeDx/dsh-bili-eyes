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
  // 冲浪（bili_surf）
  surfModel: '',           // 挑选和总结用的模型「provider/model」（空 = 跟调用它的会话一样）
  surfTaste: '',           // 口味：喜欢看什么、不想看什么（给挑选那一步看）
  surfPicks: 3,            // 一圈挑几条
  surfCandidates: 24,      // 一圈先找多少候选
  surfMaxSeconds: 3600,    // 比这更长的视频不进候选
  surfPerHour: 6,          // 每小时最多逛几圈
  // 收件箱
  inboxOn: false,          // 后台轮询「回复我的 / @ 我的 / 私信」
  inboxIntervalSeconds: 180,
  inboxQuiet: '00:30-07:30', // 这个时段不查（空 = 全天查）
  inboxDm: true,           // 也查私信
  inboxNotifyPerHour: 6,   // 每小时最多转达几次
  // 互动（写操作）：off 关 / approve 先起草等主人同意 / auto 在额度内直接发
  ownerMid: 0,             // 主人的 B站 UID：@ 和私信只能对着他
  likeMode: 'off',
  commentMode: 'off',
  dmMode: 'off',
  postMode: 'off',
  likePerDay: 30,
  commentPerDay: 5,        // 顶层评论
  replyPerDay: 10,         // 楼中楼回复
  dmPerDay: 10,
  postPerDay: 2,
  writeGapSeconds: 60,     // 两次写操作之间至少隔多久
  draftMinutes: 60,        // 草稿多久没同意就作废
  writePaused: false,      // 全部停下
  // 门卫（可选）：回答「这个会话是不是主人本人」「主人说过什么」，并转达收件箱
  gateUrl: '',
  gateHeader: '',          // 请求门卫时带的头，写成「名字: 值」
});

export const MODES = Object.freeze(['off', 'approve', 'auto']);
const MODE_OPTIONS = [['off', '关'], ['approve', '先问主人'], ['auto', '直接发（在额度内）']];

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
  { key: 'surfTaste', group: 'surf', type: 'text', max: 500, multiline: true, label: '口味', hint: '喜欢看什么、不想看什么，挑视频时参考。比如「爱看游戏剧情、冷门科普；不看带货和低俗」' },
  { key: 'surfModel', group: 'surf', type: 'text', max: 120, pattern: /^[^\s/]+\/\S+$/, patternHint: '写成 provider/model', label: '挑选和总结用的模型', hint: '写成 provider/model；留空 = 跟调用它的会话用同一个模型' },
  { key: 'surfPicks', group: 'surf', type: 'int', min: 1, max: 5, unit: '条', label: '一圈挑几条' },
  { key: 'surfCandidates', group: 'surf', type: 'int', min: 6, max: 60, unit: '条', label: '一圈先找多少候选' },
  { key: 'surfMaxSeconds', group: 'surf', type: 'int', min: 60, max: 36000, scale: 60, unit: '分钟', label: '候选视频最长', hint: '更长的不进候选' },
  { key: 'surfPerHour', group: 'surf', type: 'int', min: 1, max: 60, unit: '圈', label: '每小时最多逛几圈' },
  { key: 'inboxOn', group: 'inbox', type: 'bool', label: '后台查收件箱', hint: '回复我的、@ 我的、私信；有新的就交给门卫转达' },
  { key: 'inboxDm', group: 'inbox', type: 'bool', label: '也查私信', hint: '只转达主人的私信；别人的只记下来' },
  { key: 'inboxIntervalSeconds', group: 'inbox', type: 'int', min: 60, max: 3600, unit: '秒', label: '多久查一次' },
  { key: 'inboxQuiet', group: 'inbox', type: 'text', max: 11, pattern: /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, patternHint: '写成 00:30-07:30', label: '安静时段', hint: '这段时间不查，比如 00:30-07:30；留空 = 全天查' },
  { key: 'inboxNotifyPerHour', group: 'inbox', type: 'int', min: 1, max: 60, unit: '次', label: '每小时最多转达几次' },
  { key: 'ownerMid', group: 'act', type: 'int', min: 0, max: Number.MAX_SAFE_INTEGER, label: '主人的 B站 UID', hint: '@ 和私信只能对着这个账号；0 = 没设置（不能 @、不能私信）' },
  { key: 'likeMode', group: 'act', type: 'enum', options: MODE_OPTIONS, label: '点赞、收藏' },
  { key: 'commentMode', group: 'act', type: 'enum', options: MODE_OPTIONS, label: '评论、回复' },
  { key: 'dmMode', group: 'act', type: 'enum', options: MODE_OPTIONS, label: '私信主人' },
  { key: 'postMode', group: 'act', type: 'enum', options: MODE_OPTIONS, label: '发动态' },
  { key: 'likePerDay', group: 'act', type: 'int', min: 0, max: 200, unit: '次', label: '每天最多点赞/收藏' },
  { key: 'commentPerDay', group: 'act', type: 'int', min: 0, max: 50, unit: '条', label: '每天最多评论' },
  { key: 'replyPerDay', group: 'act', type: 'int', min: 0, max: 100, unit: '条', label: '每天最多回复' },
  { key: 'dmPerDay', group: 'act', type: 'int', min: 0, max: 50, unit: '条', label: '每天最多私信' },
  { key: 'postPerDay', group: 'act', type: 'int', min: 0, max: 10, unit: '条', label: '每天最多动态' },
  { key: 'writeGapSeconds', group: 'act', type: 'int', min: 10, max: 3600, unit: '秒', label: '两次之间至少隔' },
  { key: 'draftMinutes', group: 'act', type: 'int', min: 5, max: 1440, unit: '分钟', label: '草稿有效期', hint: '这么久没同意就作废' },
  { key: 'writePaused', group: 'act', type: 'bool', label: '全部停下', hint: '打开后一切写操作都拒绝（草稿也发不出去）' },
  { key: 'gateUrl', group: 'gate', type: 'text', max: 200, pattern: /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/\S*)?$/, patternHint: '只能是本机地址 http://127.0.0.1:端口/路径', label: '门卫地址', hint: '本机 HTTP 接口，回答「这个会话是不是主人本人」「主人说过什么」并转达收件箱；留空 = 只能在这里点同意' },
  { key: 'gateHeader', group: 'gate', type: 'text', max: 200, pattern: /^[A-Za-z0-9-]+:\s*\S.*$/, patternHint: '写成「名字: 值」', label: '请求头', hint: '请求门卫时带上，比如 x-fish: 1' },
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
    } else if (f.type === 'enum') {
      if (!f.options.some(([o]) => o === v)) errors.push(`${f.label}的选项不对`);
    } else if (f.type === 'text') {
      if (typeof v !== 'string' || v.length > f.max) errors.push(`${f.label}最多 ${f.max} 个字`);
      else if (v && f.pattern && !f.pattern.test(v)) errors.push(`${f.label}：${f.patternHint}`);
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
    const type = FIELDS.find((f) => f.key === k)?.type;
    if (type === 'dir' || type === 'exe') next[k] = String(v ?? '').trim().replace(/\\/g, '/');
    else if (typeof DEFAULTS[k] === 'string') next[k] = String(v ?? '').trim();
    else next[k] = v;
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
