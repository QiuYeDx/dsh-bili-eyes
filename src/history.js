// 最近看过 / 搜过的记录：$DSH_HOME/bili-eyes/history.jsonl，设置页「看视频 → 记录」里展示。
// 只记标题、BV 号、用时这类信息，不记返回的文字和图片。超过 400 行时截成最近 300 行。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const KEEP = 300;
const TRIM_AT = 400;
let lines = -1;   // 文件当前行数（-1 = 还没数过）

export function record(entry, file = HISTORY_FILE) {
  // node --test 跑单元测试时不写真实记录（测试里显式传 file 的除外）
  if (process.env.NODE_TEST_CONTEXT && file === HISTORY_FILE) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
    if (lines < 0) lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
    else lines += 1;
    if (lines > TRIM_AT) {
      const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-KEEP);
      fs.writeFileSync(file, `${keep.join('\n')}\n`);
      lines = keep.length;
    }
  } catch { /* 记录失败不影响看视频 */ }
}

/** 最近的记录，新的在前。 */
export function readHistory(limit = 50, file = HISTORY_FILE) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit).reverse()
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function clearHistory(file = HISTORY_FILE) {
  fs.rmSync(file, { force: true });
  lines = 0;
}
