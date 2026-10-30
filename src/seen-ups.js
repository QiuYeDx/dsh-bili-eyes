// 她最近真看过谁的视频：用 bili_look 看过（设置页试看不算），或者 bili_surf 挑中过。
// 只在列表、搜索结果、评论区里露过面的不算。关注「直接发」只对这里的人开放（act.js）。
// $DSH_HOME/bili-eyes/seen-ups.json：{mid: {name, at, bvid, title, how}}，保留 30 天、最多 500 人。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const SEEN_UPS_FILE = path.join(DATA_DIR, 'seen-ups.json');
const KEEP_DAYS = 30;
const KEEP_MAX = 500;

export function loadSeenUps(file = SEEN_UPS_FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}

/** 记一笔。how：look 看过 / surf 逛的时候挑中。 */
export function rememberUp({ mid, name = '', bvid = '', title = '', how = 'look' }, { file = SEEN_UPS_FILE, now = Date.now() } = {}) {
  mid = Number(mid);
  if (!(mid > 0)) return;
  if (process.env.NODE_TEST_CONTEXT && file === SEEN_UPS_FILE) return;
  const all = loadSeenUps(file);
  all[mid] = { name, at: now, bvid, title: String(title).slice(0, 80), how };
  const keep = Object.entries(all).filter(([, v]) => now - v.at < KEEP_DAYS * 86400_000).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_MAX);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* 记不下来只影响关注能不能直接发 */ }
}

/** days 天内看过这个 UP 主的视频吗；看过返回那条记录。 */
export function watchedUp(mid, { days = 14, file = SEEN_UPS_FILE, now = Date.now() } = {}) {
  const e = loadSeenUps(file)[Number(mid)];
  return e && now - e.at < days * 86400_000 ? e : null;
}
