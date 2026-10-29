// 弹幕：解析 XML，算出高频说法和弹幕最密集的几个时间点（「高能时段」）。

const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unescape = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITY[m]);

/** @returns {{t:number, text:string}[]} */
export function parseDanmaku(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<d p="([^"]*)">([^<]*)<\/d>/g)) {
    const t = Number(m[1].split(',')[0]);
    const text = unescape(m[2]).trim();
    if (Number.isFinite(t) && text) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

// 把「哈哈哈哈哈」「？？？？」这类刷屏归成一类，方便计数
export function normalizeDanmaku(text) {
  return text
    .replace(/\s+/g, '')
    .replace(/(.)\1{2,}/gu, '$1$1$1')
    .replace(/([?？!！])\1+/gu, '$1$1')
    .slice(0, 20);
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function danmakuStats(items, { duration = 0, topN = 8, peaks = 3 } = {}) {
  if (!items.length) return { count: 0, top: [], peaks: [] };
  const counts = new Map();
  for (const d of items) {
    const k = normalizeDanmaku(d.text);
    if (k.length < 1) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([text, n]) => ({ text, n }));

  // 高能时段：按固定窗口分桶，取最密的几个且互不相邻（弹幕太少时说不上「密集」，不算）
  if (items.length < 30) return { count: items.length, top, peaks: [] };
  const span = Math.max(duration, items[items.length - 1].t, 1);
  const win = Math.max(5, Math.min(30, Math.round(span / 30)));
  const buckets = new Map();
  for (const d of items) {
    const b = Math.floor(d.t / win);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(d);
  }
  const avg = items.length / Math.max(1, Math.ceil(span / win));
  const chosen = [];
  for (const [b, list] of [...buckets.entries()].sort((a, c) => c[1].length - a[1].length)) {
    if (chosen.length >= peaks) break;
    if (list.length < avg * 1.8) break;
    if (chosen.some((x) => Math.abs(x.b - b) <= 1)) continue;
    const local = new Map();
    for (const d of list) { const k = normalizeDanmaku(d.text); local.set(k, (local.get(k) ?? 0) + 1); }
    const sample = [...local.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([t]) => t);
    chosen.push({ b, from: fmt(b * win), to: fmt((b + 1) * win), n: list.length, sample });
  }
  return { count: items.length, top, peaks: chosen.sort((a, c) => a.b - c.b).map(({ b, ...rest }) => rest) };
}
