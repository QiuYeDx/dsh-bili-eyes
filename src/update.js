// 「关于」页用的：当前版本、怎么装的、npm 上的最新版本（检查更新）、本地 CHANGELOG 里这一版的内容。
// 检查更新只读 npm 的包信息（npm 官方源和 npmmirror 一起问，取版本高的），结果存在 ~/.dsh/bili-eyes/update.json。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
export const QQ_GROUP = '1130276670';    // 交流群（README 开头也写着）
const FILE = path.join(DATA_DIR, 'update.json');
const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];
const TTL = 12 * 3600_000;           // 查成功后 12 小时内不再自己查
const RETRY = 30 * 60_000;           // 查失败后 30 分钟再试

/** 比较两个版本号：a > b 返回正数。带 -rc 之类后缀的比同号正式版小。 */
export function cmpVer(a, b) {
  const parse = (v) => { const [main, pre = ''] = String(v ?? '').replace(/^v/, '').split('-', 2); return { n: main.split('.').map((x) => Number(x) || 0), pre }; };
  const x = parse(a); const y = parse(b);
  for (let i = 0; i < 3; i += 1) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) - (y.n[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** 插件目录里有 .git 就是从源码目录装的（link:），否则当成从 npm 装的。 */
export function installInfo() {
  return { kind: fs.existsSync(path.join(ROOT, '.git')) ? 'local' : 'npm', dir: path.resolve(ROOT) };
}

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { return {}; }
}
function save(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/** 上次检查的结果（不联网）。stale = 该重新查了。 */
export function updateState(now = Date.now()) {
  const s = load();
  const last = s.error ? s.failedAt ?? 0 : s.checkedAt ?? 0;
  return {
    current: PKG.version,
    latest: s.latest ?? '',
    publishedAt: s.publishedAt ?? 0,
    registry: s.registry ?? '',
    checkedAt: s.checkedAt ?? 0,
    error: s.error ?? '',
    newer: Boolean(s.latest) && cmpVer(s.latest, PKG.version) > 0,
    stale: now - last > (s.error ? RETRY : TTL),
    checking: Boolean(running),
  };
}

async function fetchLatest(reg, fetchImpl) {
  const r = await fetchImpl(`${reg}/${PKG.name}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(reg).host} 返回 HTTP ${r.status}`);
  const j = await r.json();
  const version = j['dist-tags']?.latest;
  if (!version) throw new Error(`${new URL(reg).host} 上没有 latest 版本`);
  return { version, publishedAt: Date.parse(j.time?.[version] ?? '') || 0, registry: reg };
}

let running = null;
/** 去 npm 查最新版本；同时只查一次，返回查完后的 updateState()。 */
export function checkUpdate({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!running) {
    running = (async () => {
      const old = load();
      const rs = await Promise.allSettled(REGISTRIES.map((reg) => fetchLatest(reg, fetchImpl)));
      const ok = rs.filter((x) => x.status === 'fulfilled').map((x) => x.value);
      if (!ok.length) {
        const why = rs.map((x) => x.reason?.name === 'TimeoutError' ? '超时' : x.reason?.message ?? String(x.reason)).join('；');
        save({ ...old, error: `连不上 npm：${why}`, failedAt: now() });
        return;
      }
      const best = ok.reduce((a, b) => (cmpVer(b.version, a.version) > 0 ? b : a));
      save({ latest: best.version, publishedAt: best.publishedAt, registry: best.registry, checkedAt: now(), error: '' });
    })().finally(() => { running = null; });
  }
  return running.then(() => updateState(now()));
}

/** 过期了就在后台查一次（不等结果）。 */
export function checkUpdateIfStale() {
  if (updateState().stale && !running) checkUpdate().catch(() => {});
}

/**
 * 本地 CHANGELOG.md 里的几节：当前版本那一节；源码目录装的再加上「未发布」。
 * 返回 [{version, date, lines}]，lines 是去掉空行和底部链接定义的原文。
 */
export function changelogFor(version = PKG.version, { withUnreleased = false, text } = {}) {
  let src = text;
  if (src == null) { try { src = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'); } catch { return []; } }
  const out = [];
  const parts = src.split(/^## /m).slice(1);
  for (const p of parts) {
    const [head, ...body] = p.split(/\r?\n/);
    const m = head.match(/^\[([^\]]+)\](?:\s*-\s*(\S+))?/);
    if (!m) continue;
    const unreleased = m[1] === '未发布';
    if (!(m[1] === version || (unreleased && withUnreleased))) continue;
    const lines = body.map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\[[^\]]+\]:\s/.test(l));
    if (lines.length) out.push({ version: unreleased ? '' : m[1], date: m[2] ?? '', lines });
  }
  return out;
}
