// dsh-bili-eyes 的界面：DSH 设置侧边栏里的「B站伙伴」。
// DSH 的浏览器插件格式是 window.__ModuleLoader__.load({ id, factory })；这里直接手写，不需要构建步骤。
// React 和 DSH 的基础组件由宿主提供（require）。数据都走同源接口 /api/bili-eyes（src/api.js）。
window.__ModuleLoader__.load({
  id: 'dsh-bili-eyes',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const React = require('react');
    let Prim = {};
    try { Prim = require('@deepseek-ai/dsh-client-ui-primitives'); } catch { /* 没有就用原生按钮 */ }
    const { useState, useEffect, useCallback, useRef } = React;
    const h = React.createElement;

    // ── 样式（DSH 主题变量，带浅色兜底；深浅色跟着 DSH 走）──────────────────────
    const CSS = `
.be{--t1:var(--dsw-alias-label-primary,#1f2328);--t2:var(--dsw-alias-label-secondary,#59636e);--t3:var(--dsw-alias-label-tertiary,#8b949e);
--b1:var(--dsw-alias-bg-layer-1,#fff);--b2:var(--dsw-alias-bg-layer-2,#f6f8fa);--bd:var(--dsw-alias-border-l2,#d0d7de);
--brand:var(--dsw-alias-brand-primary,#4d6bfe);--ok:var(--dsw-alias-state-success-primary,#1a7f37);
--bad:var(--dsw-alias-state-danger,#d1242f);--pink:#fb7299;--r:var(--dsw-radius-lg,12px);--rs:var(--dsw-radius-md,8px);
color:var(--t1);font-size:14px;line-height:1.55;display:flex;flex-direction:column;gap:16px;max-width:920px;padding-bottom:24px}
.be-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.be-head h2{margin:0;font-size:20px;font-weight:600;letter-spacing:.2px}
.be-head p{margin:4px 0 0;color:var(--t2);font-size:13px;flex-basis:100%}
.be-tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.be-tabs::-webkit-scrollbar{display:none}
.be-tab{appearance:none;border:0;background:none;color:var(--t2);padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.be-tab:hover{color:var(--t1)}
.be-tab[aria-selected=true]{color:var(--t1);border-bottom-color:var(--brand);font-weight:600}
.be-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.be-card{background:var(--b1);border:1px solid var(--bd);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.be-card-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.be-card-h h3{margin:0;font-size:15px;font-weight:600}
.be-card-h span{color:var(--t3);font-size:12px}
.be-desc{margin:0;color:var(--t2);font-size:13px}
.be-big{font-size:22px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.be-muted{color:var(--t2)}.be-faint{color:var(--t3);font-size:12px}
.be-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--b2);border:1px solid var(--bd);color:var(--t2);white-space:nowrap}
.be-badge.brand{color:var(--brand);border-color:color-mix(in srgb,var(--brand) 35%,transparent);background:color-mix(in srgb,var(--brand) 8%,transparent)}
.be-badge.pink{color:var(--pink);border-color:color-mix(in srgb,var(--pink) 40%,transparent);background:color-mix(in srgb,var(--pink) 8%,transparent)}
.be-badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.be-badge.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,transparent)}
.be-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.be-grow{flex:1 1 220px}
.be-meter{display:flex;flex-direction:column;gap:4px}
.be-meter-top{display:flex;justify-content:space-between;font-size:13px}
.be-meter-top b{font-variant-numeric:tabular-nums}
.be-bar{height:6px;border-radius:999px;background:var(--b2);overflow:hidden;border:1px solid color-mix(in srgb,var(--bd) 70%,transparent)}
.be-bar i{display:block;height:100%;background:var(--brand);border-radius:999px;transition:width .3s}
.be-bar i.hot{background:var(--bad)}
.be-kv{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;font-size:13px}
.be-kv .v{font-variant-numeric:tabular-nums;color:var(--t2);text-align:right;white-space:nowrap}
.be-checks{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.be-check{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:start}
.be-dot{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;margin-top:1px}
.be-dot.ok{background:var(--ok)}.be-dot.bad{background:var(--bad)}.be-dot.opt{background:var(--t3)}
.be-qr{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px;border-radius:var(--rs);background:var(--b2)}
.be-qr img{width:168px;height:168px;border-radius:6px;background:#fff;padding:6px;box-sizing:border-box;image-rendering:pixelated}
.be-qr.dim img{opacity:.25}
.be-hist{display:flex;flex-direction:column}
.be-err{color:var(--bad);font-size:12px;margin-top:2px;overflow-wrap:anywhere}
.be-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;row-gap:6px;padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--bd) 55%,transparent)}
.be-entry:last-child{border-bottom:0}
.be-eh{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:12.5px;color:var(--t3);line-height:20px}
.be-kind{font-weight:600;color:var(--t2);white-space:nowrap}
.be-kind.brand{color:var(--brand)}.be-kind.pink{color:var(--pink)}.be-kind.ok{color:var(--ok)}.be-kind.bad{color:var(--bad)}
.be-ctx{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t3);text-decoration:none}
a.be-ctx:hover{color:var(--brand);text-decoration:underline}
.be-et{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;color:var(--t1);text-decoration:none}
a.be-et:hover{color:var(--brand)}
.be-tag{flex:none;font-size:11.5px;line-height:18px;padding:0 6px;border-radius:4px;background:color-mix(in srgb,var(--pink) 12%,transparent);color:var(--pink)}
.be-es{display:flex;align-items:baseline;gap:12px;font-size:12px;line-height:20px;color:var(--t3);white-space:nowrap;font-variant-numeric:tabular-nums}
.be-st{display:inline-flex;align-items:center;gap:6px;color:var(--t2)}
.be-st::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.be-st.ok{color:var(--ok)}.be-st.bad{color:var(--bad)}.be-st.brand{color:var(--brand)}.be-st.pink{color:var(--pink)}.be-st.dim{color:var(--t3)}
.be-eb{grid-column:1/-1;min-width:0;display:flex;flex-direction:column;gap:6px;font-size:14px;line-height:1.6;color:var(--t1);overflow-wrap:anywhere}
.be-eb.muted{font-size:13px;color:var(--t2)}
.be-eb a{color:inherit;text-decoration:none}
.be-eb a:hover{color:var(--brand);text-decoration:underline}
.be-q{padding-left:10px;border-left:2px solid color-mix(in srgb,var(--t3) 35%,transparent)}
.be-enote{grid-column:1/-1;font-size:12.5px;line-height:1.5;color:var(--bad);overflow-wrap:anywhere}
.be-ef{grid-column:1/-1;display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap;font-size:12px;color:var(--t3);min-width:0}
.be-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 0;min-width:0;overflow-wrap:anywhere}
.be-meta>span+span::before{content:'·';margin:0 6px}
.be-meta a{color:inherit;text-decoration:none}.be-meta a:hover{color:var(--brand);text-decoration:underline}
.be-acts{display:flex;gap:4px;margin-left:auto;margin-right:-8px;align-items:center}
.be-act{appearance:none;border:0;background:none;font:inherit;font-size:12.5px;line-height:18px;color:var(--t2);padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.be-act:hover:not(:disabled){background:var(--b2);color:var(--t1)}
.be-act.primary{color:var(--brand);font-weight:600}
.be-act.primary:hover:not(:disabled){background:color-mix(in srgb,var(--brand) 10%,transparent);color:var(--brand)}
.be-act.danger:hover:not(:disabled){background:color-mix(in srgb,var(--bad) 10%,transparent);color:var(--bad)}
.be-act.danger.armed,.be-act.danger.armed:hover:not(:disabled){background:var(--bad);color:#fff}
.be-act:disabled{opacity:.5;cursor:default}
.be-act:focus-visible{outline:2px solid color-mix(in srgb,var(--brand) 55%,transparent);outline-offset:1px}
.be-sube{display:flex;flex-direction:column;gap:2px}
.be-1l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.be-sube .be-eh{font-size:12.5px}
.be-seg{display:inline-flex;border:1px solid var(--bd);border-radius:var(--rs);overflow:hidden;align-self:flex-start}
.be-seg button{appearance:none;border:0;background:var(--b1);color:var(--t2);font:inherit;font-size:13px;padding:6px 14px;cursor:pointer}
.be-seg button+button{border-left:1px solid var(--bd)}
.be-seg button[aria-pressed=true]{background:color-mix(in srgb,var(--brand) 10%,var(--b1));color:var(--brand);font-weight:600}
.be-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.be-field>label{font-size:13px;color:var(--t2)}
.be-field small{color:var(--t3);font-size:12px}
.be-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.be-fields .wide{grid-column:1/-1}
@media (max-width:560px){.be-fields{grid-template-columns:1fr}}
.be-input,.be-select{font:inherit;font-size:14px;color:var(--t1);background:var(--b1);border:1px solid var(--bd);border-radius:var(--rs);padding:6px 10px;min-width:0;width:100%;box-sizing:border-box}
.be-input:focus,.be-select:focus{outline:2px solid color-mix(in srgb,var(--brand) 40%,transparent);outline-offset:0;border-color:var(--brand)}
.be-input.mono{font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:13px}
.be-unit{display:flex;align-items:center;gap:6px}
.be-unit span{color:var(--t3);font-size:13px;white-space:nowrap}
.be-switch{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--t1)}
.be-switch input{appearance:none;width:34px;height:20px;border-radius:999px;background:var(--bd);position:relative;cursor:pointer;margin:0;flex:none;transition:background .15s}
.be-switch input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.be-switch input:checked{background:var(--brand)}
.be-switch input:checked::after{transform:translateX(14px)}
.be-btn{font:inherit;font-size:13px;padding:5px 12px;border-radius:var(--rs);border:1px solid var(--bd);background:var(--b1);color:var(--t1);cursor:pointer;white-space:nowrap}
.be-btn:hover:not(:disabled){background:var(--b2)}
.be-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
.be-btn.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,transparent)}
.be-btn.danger.armed{background:var(--bad);color:#fff;border-color:var(--bad)}
.be-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--brand) 88%,#000)}
.be-btn.danger.armed:hover:not(:disabled){background:color-mix(in srgb,var(--bad) 88%,#000)}
.be-btn:disabled{opacity:.5;cursor:default}
.be-sheets{display:flex;flex-direction:column;gap:10px}
.be-sheets img{width:100%;border-radius:var(--rs);border:1px solid var(--bd);display:block;cursor:zoom-in;background:var(--b2)}
.be-sheets img.full{cursor:zoom-out}
.be-pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:12.5px;line-height:1.6;background:var(--b2);border-radius:var(--rs);padding:12px;max-height:520px;overflow:auto;color:var(--t1)}
.be-spin{display:inline-block;width:12px;height:12px;border:2px solid color-mix(in srgb,var(--brand) 30%,transparent);border-top-color:var(--brand);border-radius:50%;animation:be-spin .8s linear infinite;vertical-align:-1px}
@keyframes be-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.be-spin{animation-duration:2.4s}.be-bar i,.be-switch input,.be-switch input::after{transition:none}}
.be-toast{position:sticky;bottom:12px;align-self:flex-start;padding:8px 14px;border-radius:var(--rs);font-size:13px;background:var(--t1);color:var(--b1);box-shadow:0 4px 14px rgba(0,0,0,.18)}
.be-toast.bad{background:var(--bad);color:#fff}
.be-empty{color:var(--t3);font-size:13px;padding:6px 0}
.be-ok{color:var(--ok);font-size:13px}.be-no{color:var(--bad);font-size:13px}
.be-page{display:flex;flex-direction:column;gap:16px;min-width:0}
.be-page[hidden]{display:none}
.be-sub{display:flex;gap:4px;flex-wrap:wrap}
.be-sub button{appearance:none;border:0;background:none;font:inherit;font-size:13px;color:var(--t2);padding:5px 12px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.be-sub button:hover{background:var(--b2);color:var(--t1)}
.be-sub button[aria-current=page]{background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--brand);font-weight:600}
.be-sub button:focus-visible,.be-tab:focus-visible,.be-link:focus-visible{outline:2px solid color-mix(in srgb,var(--brand) 55%,transparent);outline-offset:1px}
.be-n{min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:999px;background:var(--brand);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.be-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.be-tools .sp{flex:1 1 0}
.be-select.sm{width:auto;font-size:13px;padding:4px 8px}
.be-seg.sm button{padding:4px 10px;font-size:12.5px}
.be-scroll{max-height:min(520px,58vh);overflow:auto;overscroll-behavior:contain;margin:0 -16px;padding:0 16px;border-top:1px solid color-mix(in srgb,var(--bd) 60%,transparent);border-bottom:1px solid color-mix(in srgb,var(--bd) 60%,transparent)}
.be-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--t3);font-size:12px;min-height:28px}
.be-todo{display:grid;grid-template-columns:1fr auto auto;gap:4px 10px;align-items:center;font-size:13px}
.be-todo b{font-variant-numeric:tabular-nums;font-weight:600;text-align:right;color:var(--t2)}
.be-todo b.hot{color:var(--brand)}
.be-link{appearance:none;border:0;background:none;padding:2px 0;font:inherit;font-size:12.5px;color:var(--brand);cursor:pointer;white-space:nowrap}
.be-link:hover{text-decoration:underline}
.be-sumline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}
`;
    if (typeof document !== 'undefined' && !document.getElementById('dsh-bili-eyes-style')) {
      const s = document.createElement('style');
      s.id = 'dsh-bili-eyes-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    // ── 接口 ─────────────────────────────────────────────────────────────────
    const ROUTE = '/api/bili-eyes';
    async function unwrap(r) {
      let j;
      try { j = await r.json(); } catch { throw new Error(`接口没有返回 JSON（HTTP ${r.status}）：插件可能还没加载，彻底重启 DSH 试试`); }
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }
    const api = {
      get: (view) => fetch(`${ROUTE}?${new URLSearchParams({ view })}`, { credentials: 'same-origin' }).then(unwrap),
      post: (action, body = {}) => fetch(ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) }).then(unwrap),
    };

    // ── 小工具 ───────────────────────────────────────────────────────────────
    const fmtBytes = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
    const fmtDur = (s) => {
      s = Math.max(0, Math.round(Number(s) || 0));
      const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
      return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
    };
    const fmtNum = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n ?? 0));
    const fmtMs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : `${(ms / 1000).toFixed(1)} 秒`);
    const pad = (n) => String(n).padStart(2, '0');
    function when(at) {
      const d = new Date(at); const now = new Date();
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
      const y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
      return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
    }
    // 「1:23」「01:02:03」或纯秒数 → 秒；空 = 不填
    function parseTime(v) {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
      const parts = s.split(/[:：]/).map(Number);
      if (parts.some((x) => !Number.isFinite(x))) return NaN;
      return parts.reduce((acc, x) => acc * 60 + x, 0);
    }
    const videoUrl = (e) => (e.bvid ? `https://www.bilibili.com/video/${e.bvid}${e.page > 1 ? `?p=${e.page}` : ''}` : '');

    // 读一个 view；params 变了就重新读（列表的筛选、分页）。重新读时先留着旧数据，不闪
    function useView(view, params = null) {
      const qs = new URLSearchParams({ view, ...Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])) }).toString();
      const [state, setState] = useState({ loading: true, data: null, error: null });
      const seq = useRef(0);
      const load = useCallback(() => {
        const n = (seq.current += 1);
        setState((s) => ({ ...s, loading: true }));
        fetch(`${ROUTE}?${qs}`, { credentials: 'same-origin' }).then(unwrap).then(
          (data) => { if (n === seq.current) setState({ loading: false, data, error: null }); },
          (e) => { if (n === seq.current) setState((s) => ({ loading: false, data: s.data, error: e.message })); });
      }, [qs]);
      useEffect(load, [load]);
      return { ...state, reload: load };
    }
    // 切回来时刷新一次（第一次显示时 useView 自己会读，不重复）
    function useRefreshOnShow(active, reload) {
      const first = useRef(true);
      useEffect(() => { if (first.current) { first.current = false; return; } if (active) reload(); }, [active]);
    }
    // 分页列表：筛选变了从第一页读；「加载更多」把 limit 加大
    function usePaged(view, params, step = 50) {
      const key = JSON.stringify(params);
      const [page, setPage] = useState({ key, limit: step });
      const limit = page.key === key ? page.limit : step;
      const st = useView(view, { ...params, limit });
      return { ...st, more: () => setPage({ key, limit: limit + step }) };
    }

    function Btn({ kind, onClick, disabled, children, title }) {
      if (Prim.Button && kind !== 'danger') {
        return h(Prim.Button, { variant: kind === 'primary' ? undefined : 'outline', size: 'sm', onClick, disabled, title }, children);
      }
      return h('button', { type: 'button', className: `be-btn ${kind ?? ''}`, onClick, disabled, title }, children);
    }

    // 危险操作：点一下变成「确认？」，3 秒内再点一次才执行
    function ConfirmBtn({ label, confirmLabel, onConfirm, disabled, subtle }) {
      const [armed, setArmed] = useState(false);
      useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
      return h('button', {
        type: 'button', className: `${subtle ? 'be-act' : 'be-btn'} danger${armed ? ' armed' : ''}`, disabled,
        onClick: () => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); },
      }, armed ? (confirmLabel ?? '再点一次确认') : label);
    }

    // 列表行里的小按钮（文字样式，不抢正文）
    function ActBtn({ kind, onClick, disabled, children }) {
      return h('button', { type: 'button', className: `be-act ${kind ?? ''}`, onClick, disabled }, children);
    }

    // 列表里的一条，固定三层：
    //   头：类型 · 对象（或者一个主标题）……右边：状态 时间
    //   正文：她说的话 / 视频标题（quote = 她写的字，左边一道竖线）
    //   脚：附加信息 · 用 · 点隔开……右边：操作
    function Entry({ kind, ctx, title, tag, status, at, children, quote, muted, error, meta, actions }) {
      const m = (meta ?? []).filter(Boolean);
      const acts = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
      const body = (Array.isArray(children) ? children : [children]).filter((x) => x != null && x !== false && x !== '');
      return h('div', { className: 'be-entry' },
        h('div', { className: 'be-eh' },
          kind && h('span', { className: `be-kind ${kind[1] ?? ''}` }, kind[0]),
          title, ctx, tag && h('span', { className: 'be-tag' }, tag)),
        h('div', { className: 'be-es' },
          status && h('span', { className: `be-st ${status[1] || 'dim'}` }, status[0]),
          at && h('time', { title: new Date(at).toLocaleString() }, when(at))),
        body.length > 0 && h('div', { className: `be-eb${muted ? ' muted' : ''}` }, quote ? h('div', { className: 'be-q' }, body) : body),
        error && h('div', { className: 'be-enote' }, error),
        (m.length > 0 || acts.length > 0) && h('div', { className: 'be-ef' },
          m.length > 0 && h('div', { className: 'be-meta' }, m.map((x, i) => h('span', { key: i }, x))),
          acts.length > 0 && h('div', { className: 'be-acts' }, acts)));
    }
    // 头里的对象：有链接就是链接
    function Ctx({ text, url, cls = 'be-ctx' }) {
      if (!text) return null;
      return url ? h('a', { className: cls, href: url, target: '_blank', rel: 'noreferrer', title: text }, text) : h('span', { className: cls, title: text }, text);
    }
    const bv = (bvid) => `https://www.bilibili.com/video/${bvid}`;

    function Card({ title, aside, desc, children, id }) {
      return h('section', { className: 'be-card', id },
        (title || aside) && h('div', { className: 'be-card-h' }, title && h('h3', null, title), aside && h('span', null, aside)),
        desc && h('p', { className: 'be-desc' }, desc),
        children);
    }

    function Field({ label, hint, wide, children }) {
      return h('div', { className: `be-field${wide ? ' wide' : ''}` }, label && h('label', null, label), children, hint && h('small', null, hint));
    }

    function Loading({ state, children }) {
      if (state.error) return h('div', { className: 'be-card' }, h('p', { className: 'be-desc' }, `加载失败：${state.error}`), h('div', null, h(Btn, { onClick: state.reload }, '重试')));
      if (!state.data) return h('div', { className: 'be-empty' }, '加载中…');
      return children(state.data);
    }

    function Meter({ label, used, max }) {
      const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
      return h('div', { className: 'be-meter' },
        h('div', { className: 'be-meter-top' }, h('span', null, label), h('b', null, `${used} / ${max}`)),
        h('div', { className: 'be-bar', role: 'progressbar', 'aria-valuenow': used, 'aria-valuemax': max }, h('i', { className: pct >= 90 ? 'hot' : '', style: { width: `${pct}%` } })));
    }

    // ── 筛选、列表、子导航 ───────────────────────────────────────────────────
    const RANGES = [['1', '今天'], ['7', '7 天'], ['30', '30 天'], ['0', '全部']];
    function Seg({ options, value, onChange, small, label }) {
      return h('div', { className: `be-seg${small ? ' sm' : ''}`, role: 'group', 'aria-label': label },
        options.map(([v, l]) => h('button', { key: v, type: 'button', 'aria-pressed': value === v, onClick: () => onChange(v) }, l)));
    }
    function Pick({ options, value, onChange, label }) {
      return h('select', { className: 'be-select sm', value, 'aria-label': label, onChange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { key: v, value: v }, l)));
    }
    // 固定高度、内部滚动的列表；底下写「显示 n / 共 t 条」，没显示完就能加载更多
    function ListBox({ st, children, empty, unit = '条' }) {
      if (!st.data) return st.error ? h('div', { className: 'be-no' }, `加载失败：${st.error}`) : h('div', { className: 'be-empty' }, '加载中…');
      const { items, total } = st.data;
      if (!items.length) return h('div', { className: 'be-empty' }, empty);
      return h(React.Fragment, null,
        h('div', { className: 'be-scroll' }, h('div', { className: 'be-hist' }, items.map(children))),
        h('div', { className: 'be-foot' },
          h('span', null, items.length < total ? `显示 ${items.length} / 共 ${total} ${unit}` : `共 ${total} ${unit}`),
          items.length < total && h(Btn, { disabled: st.loading, onClick: st.more }, st.loading ? '加载中…' : '加载更多')));
    }
    // 不分页的短列表（几十条以内），也放进固定高度的框里
    function ScrollList({ items, children, empty }) {
      if (!items.length) return h('div', { className: 'be-empty' }, empty);
      return h('div', { className: 'be-scroll' }, h('div', { className: 'be-hist' }, items.map(children)));
    }
    function SubNav({ items, value, onChange }) {
      return h('nav', { className: 'be-sub', 'aria-label': '分区' }, items.map(([id, label, n]) => h('button', { key: id, type: 'button', 'aria-current': value === id ? 'page' : undefined, onClick: () => onChange(id) }, label, n ? h('span', { className: 'be-n' }, n > 99 ? '99+' : n) : null)));
    }
    // 子页面：去过的留着（隐藏），跑到一半的试看、逛一圈切走再回来，结果还在
    function SubPages({ items, sub, setSub, active, props }) {
      const ids = items.map((x) => x[0]);
      const cur = ids.includes(sub) ? sub : ids[0];
      const [seen, setSeen] = useState(() => new Set([cur]));
      useEffect(() => { if (!seen.has(cur)) setSeen(new Set([...seen, cur])); }, [cur]);
      return h(React.Fragment, null,
        h(SubNav, { items: items.map(([id, label, , n]) => [id, label, n]), value: cur, onChange: setSub }),
        items.map(([id, , Comp]) => (seen.has(id) || id === cur) && h('div', { key: id, className: 'be-page', hidden: id !== cur }, h(Comp, { ...props, active: active && id === cur }))));
    }

    // ── 登录 ─────────────────────────────────────────────────────────────────
    function LoginCard({ login, onChange, toast }) {
      const [qr, setQr] = useState(null);         // {img, state}
      const [busy, setBusy] = useState(false);
      const timer = useRef(null);
      const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
      useEffect(() => stop, []);
      const poll = () => {
        timer.current = setTimeout(() => {
          api.post('loginPoll').then((r) => {
            if (r.state === 'ok') { stop(); setQr(null); toast(`登录成功：${r.login?.uname ?? ''}`); onChange(r.login); return; }
            setQr((q) => (q ? { ...q, state: r.state } : q));
            if (r.state === 'expired') stop(); else poll();
          }, (e) => { stop(); setQr((q) => (q ? { ...q, state: 'error', error: e.message } : q)); });
        }, 2000);
      };
      const start = () => {
        stop(); setBusy(true);
        api.post('loginStart').then((r) => { setQr({ img: r.qr, state: 'waiting' }); poll(); }, (e) => toast(e.message, true)).finally(() => setBusy(false));
      };
      const QR_TEXT = { waiting: '用 B站 App 扫码（建议用小号）', scanned: '已扫码，在手机上点「确认登录」', expired: '二维码过期了', error: '出错了' };
      const st = login.state;
      return h(Card, { title: 'B站登录', aside: st === 'ok' ? '已登录' : '' },
        st === 'ok'
          ? h(React.Fragment, null,
            h('div', { className: 'be-big' }, login.uname || '（没有昵称）'),
            h('div', { className: 'be-row' },
              login.vip && h('span', { className: 'be-badge pink' }, '大会员'),
              login.savedAt && h('span', { className: 'be-faint' }, `${login.savedAt.slice(0, 10)} 扫码`)))
          : h(React.Fragment, null,
            h('div', { className: 'be-big' }, { none: '没登录', expired: '登录已过期', unknown: '暂时查不到' }[st]),
            h('p', { className: 'be-desc' }, st === 'unknown' ? (login.error || 'B站接口暂时连不上') : '不登录也能看；登录后多出 AI 字幕、AI 总结和 1080P 放大。')),
        qr && h('div', { className: `be-qr${qr.state === 'expired' || qr.state === 'error' ? ' dim' : ''}` },
          h('img', { src: qr.img, alt: '登录二维码' }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 160px' } },
            h('div', null, qr.state === 'waiting' || qr.state === 'scanned' ? h('span', { className: 'be-spin', style: { marginRight: 8 } }) : null, QR_TEXT[qr.state]),
            qr.error && h('div', { className: 'be-err' }, qr.error),
            h('div', { className: 'be-faint' }, '登录信息只存在本机，相当于账号密码，别外传。'),
            h('div', { className: 'be-row' },
              (qr.state === 'expired' || qr.state === 'error') && h(Btn, { kind: 'primary', onClick: start }, '重新生成'),
              h(Btn, { onClick: () => { stop(); setQr(null); } }, '取消')))),
        !qr && h('div', { className: 'be-row' },
          h(Btn, { kind: st === 'ok' ? undefined : 'primary', disabled: busy, onClick: start }, st === 'ok' ? '换个账号' : '扫码登录'),
          h(Btn, { onClick: () => api.post('refreshLogin').then((r) => { onChange(r.login); toast('已重新检查'); }, (e) => toast(e.message, true)) }, '重新检查'),
          st !== 'none' && h(ConfirmBtn, { label: '退出登录', confirmLabel: '确认退出？', onConfirm: () => api.post('logout').then((r) => { onChange(r.login); toast('已删除本机的登录信息'); }, (e) => toast(e.message, true)) })));
    }

    // ── 概览 ─────────────────────────────────────────────────────────────────
    const KIND = { look: ['看', 'brand'], zoom: ['放大', 'brand'], find: ['搜', ''], file: ['本机视频', 'pink'], feed: ['刷列表', ''], surf: ['逛一圈', 'pink'], comments: ['评论区', ''] };
    const SOURCE = { tool: '她', ui: '设置页', plugin: '插件', auto: '自己逛', cli: '命令行', other: '' };

    function HistoryRow({ e }) {
      const [label, cls] = KIND[e.kind] ?? [e.kind, ''];
      const url = videoUrl(e);
      const meta = [];
      if (['find', 'feed', 'surf', 'comments'].includes(e.kind)) { if (e.ok) meta.push(`${e.results} ${{ surf: '条挑中', comments: '条评论' }[e.kind] ?? '个结果'}`); }
      else if (e.ok) {
        if (e.duration) meta.push(e.to != null || e.from ? `${fmtDur(e.from || 0)}–${fmtDur(e.to ?? e.duration)} / ${fmtDur(e.duration)}` : fmtDur(e.duration));
        if (e.sheets) meta.push(`${e.sheets} 张图`);
      }
      if (e.ms != null) meta.push(fmtMs(e.ms));
      if (e.cached) meta.push('用了缓存');
      return h(Entry, {
        kind: [label, cls], ctx: SOURCE[e.source] && h('span', { className: 'be-ctx' }, SOURCE[e.source]),
        status: !e.ok && ['失败', 'bad'], at: e.at, error: !e.ok && e.error, meta,
      },
      url ? h('a', { href: url, target: '_blank', rel: 'noreferrer' }, e.title || e.bvid) : (e.title || '—'),
      e.ok && e.note && h('div', { className: 'be-faint' }, e.note));
    }

    function Overview({ toast, active, go }) {
      const st = useView('overview');
      useRefreshOnShow(active, st.reload);   // 切回概览时刷新（她调用、试看都会改用量和待办）
      const [login, setLogin] = useState(null);
      useEffect(() => { if (st.data) setLogin(st.data.login); }, [st.data]);
      const [showChecks, setShowChecks] = useState(false);
      // 一键下载 ffmpeg：点了之后每秒问一次进度，下完刷新检查
      const [dl, setDl] = useState(null);
      useEffect(() => {
        if (!dl?.running) return undefined;
        const t = setInterval(() => api.post('ffmpegState').then((r) => {
          setDl(r.install);
          if (!r.install.running) { toast(r.install.error ? `下载失败：${r.install.error}` : `ffmpeg 装好了（${r.install.done?.ffmpeg}）`, Boolean(r.install.error)); st.reload(); }
        }, () => {}), 1000);
        return () => clearInterval(t);
      }, [dl?.running]);
      const install = () => api.post('ffmpegInstall').then((r) => setDl(r.install), (e) => toast(e.message, true));
      return h(Loading, { state: st }, (d) => {
        const u = d.usage; const t = d.todo;
        const bad = d.checks.filter((x) => !x.ok && !x.optional);
        const optional = d.checks.filter((x) => !x.ok && x.optional);
        const open = showChecks || bad.length > 0;
        const next = t.autoSurf.next ? new Date(t.autoSurf.next).toTimeString().slice(0, 5) : '';
        const row = (label, value, hot, link, onClick) => h(React.Fragment, { key: label },
          h('span', null, label), h('b', { className: hot ? 'hot' : '' }, value),
          h('button', { type: 'button', className: 'be-link', onClick }, link));
        return h(React.Fragment, null,
          h('div', { className: 'be-grid' },
            login && h(LoginCard, { login, toast, onChange: (l) => { setLogin(l); st.reload(); } }),
            h(Card, { title: '待办和今天' },
              h('div', { className: 'be-todo' },
                row('待同意的草稿', `${t.drafts} 条`, t.drafts > 0, '去处理', () => go('act', 'drafts')),
                row('收件箱待处理', t.inboxOn ? `${t.inbox} 条` : '没开', t.inbox > 0, '去看', () => go('inbox', 'messages')),
                row('自己逛', t.autoSurf.on ? (next ? `下次 ${next}` : '今天逛完了') : '没开', false, '去看', () => go('surf', 'auto')),
                row('今天的写操作', `${t.writes} 次`, false, '看记录', () => go('act', 'log'))),
              h(Meter, { label: '这一小时新看的视频', used: u.watched, max: u.maxPerHour }),
              h(Meter, { label: '这一小时搜索', used: u.searched, max: u.maxFindPerHour }),
              u.running > 0 && h('div', null, h('span', { className: 'be-spin', style: { marginRight: 8 } }), `正在看${u.running > 1 ? `（还有 ${u.running - 1} 个排队）` : ''}`))),
          h(Card, { title: '安装检查', aside: `v${d.version}` },
            open
              ? h(React.Fragment, null,
                h('p', { className: 'be-desc' }, '带 ! 的缺了会影响基本功能；带 – 的是可选项，缺了只是少一些功能。'),
                h('ul', { className: 'be-checks' }, d.checks.map((x) => {
                  const ins = x.id === 'ffmpeg' ? (dl ?? x.install) : null;
                  return h('li', { key: x.id, className: 'be-check' },
                    h('span', { className: `be-dot ${x.ok ? 'ok' : x.optional ? 'opt' : 'bad'}` }, x.ok ? '✓' : x.optional ? '–' : '!'),
                    h('div', { style: { minWidth: 0 } }, h('div', { style: { overflowWrap: 'anywhere' } }, x.label), x.hint && h('div', { className: 'be-faint' }, x.hint),
                      ins && (ins.running
                        ? h('div', { className: 'be-row' }, h('span', { className: 'be-spin' }), h('span', { className: 'be-faint' }, ins.phase || '下载中'))
                        : !x.ok && h('div', { className: 'be-row' }, h(Btn, { kind: 'primary', onClick: install }, '下载 ffmpeg'), ins.error && h('span', { className: 'be-err' }, ins.error)))));
                })),
                h('div', { className: 'be-row' }, h(Btn, { onClick: () => { st.reload(); toast('已刷新'); } }, '重新检查'), !bad.length && h(Btn, { onClick: () => setShowChecks(false) }, '收起')))
              : h('div', { className: 'be-sumline' },
                h('span', { className: 'be-dot ok' }, '✓'),
                h('span', null, `基本功能都正常${optional.length ? `，${optional.length} 个可选项没配（${optional.map((x) => ({ login: 'B站登录', owner: '主人 UID', asr: '语音识别', inbox: '收件箱', ytdlp: 'yt-dlp', gate: '门卫', disk: '下载目录' }[x.id] ?? x.id)).join('、')}）` : ''}`),
                h('button', { type: 'button', className: 'be-link', onClick: () => setShowChecks(true) }, '展开'))));
      });
    }

    const HIST_KINDS = [['', '全部类型'], ['look', '看'], ['zoom', '放大'], ['find', '搜'], ['feed', '刷列表'], ['surf', '逛一圈'], ['comments', '评论区'], ['file', '本机视频']];
    const HIST_SOURCES = [['', '全部来源'], ['tool', '她'], ['ui', '设置页'], ['plugin', '插件'], ['auto', '自己逛'], ['cli', '命令行']];
    function WatchLog({ toast, active }) {
      const [f, setF] = useState({ kind: '', source: '', days: '7' });
      const st = usePaged('history', f);
      useRefreshOnShow(active, st.reload);
      const set = (k) => (v) => setF({ ...f, [k]: v });
      return h(Card, { title: '记录', desc: '她和试看用过的看视频、搜索、刷列表、逛一圈。只记标题、BV 号和用时。' },
        h('div', { className: 'be-tools' },
          h(Pick, { options: HIST_KINDS, value: f.kind, onChange: set('kind'), label: '类型' }),
          h(Pick, { options: HIST_SOURCES, value: f.source, onChange: set('source'), label: '来源' }),
          h(Seg, { options: RANGES, value: f.days, onChange: set('days'), small: true, label: '时间范围' }),
          h('span', { className: 'sp' }),
          h(ConfirmBtn, { label: '清空记录', confirmLabel: '确认清空？', onConfirm: () => api.post('clearHistory').then(() => { toast('记录已清空'); st.reload(); }, (e) => toast(e.message, true)) })),
        h(ListBox, { st, empty: '这段时间没有记录。' }, (e, i) => h(HistoryRow, { key: `${e.at}-${i}`, e })));
    }

    function WatchPage({ toast, active, sub, setSub }) {
      return h(SubPages, { items: [['try', '试看', Try], ['log', '记录', WatchLog]], sub, setSub, active, props: { toast } });
    }

    // ── 试看 ─────────────────────────────────────────────────────────────────
    const ORDERS = [['relevance', '综合'], ['views', '最多播放'], ['newest', '最新'], ['danmaku', '最多弹幕'], ['favorites', '最多收藏']];
    const DURATIONS = [['any', '不限时长'], ['short', '10 分钟内'], ['medium', '10~30 分钟'], ['long', '30~60 分钟'], ['xlong', '1 小时以上']];

    function Elapsed({ since }) {
      const [now, setNow] = useState(Date.now());
      useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
      return h('span', { className: 'be-faint' }, `已经 ${Math.floor((now - since) / 1000)} 秒`);
    }

    function Sheet({ src, i }) {
      const [full, setFull] = useState(false);
      return h('img', { src, alt: `分镜图 ${i + 1}`, className: full ? 'full' : '', style: full ? null : { maxHeight: 420, objectFit: 'contain' }, onClick: () => setFull(!full), title: full ? '点击收起' : '点击看原尺寸' });
    }

    function Try({ toast }) {
      const [mode, setMode] = useState('look');
      const [f, setF] = useState({ url: '', from: '', to: '', detail: 'med', cells: 6, query: '', order: 'relevance', duration: 'any', limit: 6 });
      const [run, setRun] = useState(null);   // {since}
      const [res, setRes] = useState(null);
      const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
      const go = () => {
        const body = { mode };
        if (mode === 'find') Object.assign(body, { query: f.query, order: f.order, duration: f.duration, limit: Number(f.limit) || 6 });
        else {
          const from = parseTime(f.from); const to = parseTime(f.to);
          if (Number.isNaN(from) || Number.isNaN(to)) { toast('起止时间写成秒数或 1:23 这样', true); return; }
          Object.assign(body, { url: f.url, from, to, detail: f.detail, cells: Number(f.cells) || 6 });
        }
        setRes(null); setRun({ since: Date.now(), mode });
        api.post('try', body).then((r) => setRes({ ...r, mode }), (e) => setRes({ error: e.message, mode })).finally(() => setRun(null));
      };
      const ready = mode === 'find' ? f.query.trim() : f.url.trim() && (mode !== 'zoom' || (String(f.from).trim() && String(f.to).trim()));
      return h(React.Fragment, null,
        h(Card, { title: '试看', desc: '和她调用工具走同一套流程，结果就是她拿到的样子（分镜图 + 文字素材）。会计入每小时限额，也会写进缓存。' },
          h('div', { className: 'be-seg', role: 'group' }, [['look', '看视频'], ['zoom', '放大看几秒'], ['find', '搜视频']].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': mode === id, onClick: () => setMode(id) }, label))),
          mode === 'find'
            ? h('div', { className: 'be-fields' },
              h(Field, { label: '关键词', wide: true }, h('input', { className: 'be-input', value: f.query, maxLength: 50, placeholder: '比如：三国演义 名场面', onChange: set('query'), onKeyDown: (e) => { if (e.key === 'Enter' && ready && !run) go(); } })),
              h(Field, { label: '排序' }, h('select', { className: 'be-select', value: f.order, onChange: set('order') }, ORDERS.map(([v, l]) => h('option', { key: v, value: v }, l)))),
              h(Field, { label: '时长' }, h('select', { className: 'be-select', value: f.duration, onChange: set('duration') }, DURATIONS.map(([v, l]) => h('option', { key: v, value: v }, l)))))
            : h('div', { className: 'be-fields' },
              h(Field, { label: '视频', wide: true, hint: 'B站链接、b23.tv 短链、BV 号，或整段分享文字' }, h('input', { className: 'be-input', value: f.url, placeholder: 'https://www.bilibili.com/video/BV… 或 BV…', onChange: set('url'), onKeyDown: (e) => { if (e.key === 'Enter' && ready && !run) go(); } })),
              h(Field, { label: mode === 'zoom' ? '起点' : '起点（可选）', hint: '秒数，或 1:23 这样' }, h('input', { className: 'be-input', value: f.from, placeholder: mode === 'zoom' ? '比如 1:05' : '从头开始', onChange: set('from') })),
              h(Field, { label: mode === 'zoom' ? '终点' : '终点（可选）', hint: mode === 'zoom' ? '和起点相差不超过 60 秒' : '不填 = 看到结尾（2 小时以内看完整）' }, h('input', { className: 'be-input', value: f.to, placeholder: mode === 'zoom' ? '比如 1:15' : '看到结尾', onChange: set('to') })),
              mode === 'look'
                ? h(Field, { label: '每格台词' }, h('select', { className: 'be-select', value: f.detail, onChange: set('detail') }, h('option', { value: 'med' }, '默认长度'), h('option', { value: 'low' }, '短一些')))
                : h(Field, { label: '格子数', hint: '1~9，越少每格越大' }, h('input', { className: 'be-input', type: 'number', min: 1, max: 9, value: f.cells, onChange: set('cells') }))),
          h('div', { className: 'be-row' },
            h(Btn, { kind: 'primary', disabled: !ready || Boolean(run), onClick: go }, run ? (mode === 'find' ? '搜索中…' : '正在看…') : (mode === 'find' ? '搜索' : '开始看')),
            run && h(React.Fragment, null, h('span', { className: 'be-spin' }), h(Elapsed, { since: run.since }), run.mode !== 'find' && h('span', { className: 'be-faint' }, '长视频可能要一两分钟')))),
        res && (res.error
          ? h(Card, { title: '没成功' }, h('div', { className: 'be-no' }, res.error))
          : h(Card, {
            title: res.mode === 'find' ? '搜索结果' : (res.meta?.title || '结果'),
            aside: [fmtMs(res.ms), res.cached ? '来自缓存' : '', res.images.length ? `${res.images.length} 张分镜图` : '', `文字 ${res.text.length} 字`].filter(Boolean).join(' · '),
          },
          res.mode === 'find' && res.items?.length
            ? h('div', { className: 'be-hist' }, res.items.map((x) => h(Entry, {
              key: x.bvid, title: h(Ctx, { text: x.title, url: bv(x.bvid), cls: 'be-et' }), status: x.seconds && [fmtDur(x.seconds), 'dim'],
              meta: [x.author, `播放 ${fmtNum(x.play)}`, `弹幕 ${fmtNum(x.danmaku)}`, x.pubdate && new Date(x.pubdate * 1000).toLocaleDateString()],
            })))
            : null,
          res.images.length > 0 && h('div', { className: 'be-sheets' }, res.images.map((src, i) => h(Sheet, { key: i, src, i }))),
          h('div', { className: 'be-row', style: { justifyContent: 'space-between' } },
            h('span', { className: 'be-faint' }, res.mode === 'find' ? '她拿到的文字：' : '图下面是她拿到的文字：'),
            h(Btn, { onClick: () => navigator.clipboard?.writeText(res.text).then(() => toast('已复制'), () => toast('复制失败', true)) }, '复制文字')),
          h('pre', { className: 'be-pre' }, res.text))));
    }

    // ── 设置 ─────────────────────────────────────────────────────────────────
    const GROUPS = [
      ['watch', '看视频', '怎么看：多长的视频看完整、分镜图几张、带哪些信息。'],
      ['limits', '限额与缓存', '防止刷屏把 B站接口和本机算力用光；缓存让同一个视频再看几乎不花时间。'],
      ['paths', '路径', '缓存和下载默认放在系统盘；C 盘紧张时换到别的盘。'],
    ];

    function PathField({ field, value, onChange }) {
      const [check, setCheck] = useState(null);
      const doCheck = () => {
        const p = String(value ?? '').trim();
        const req = field.type === 'exe' ? api.post('checkTool', { kind: field.exe === 'yt-dlp' ? 'ytdlp' : 'ffmpeg', path: p }) : api.post('checkPath', { path: p });
        req.then(setCheck, (e) => setCheck({ ok: false, error: e.message }));
      };
      return h(Field, { label: field.label, hint: field.hint, wide: true },
        h('div', { className: 'be-row' },
          h('input', { className: 'be-input mono be-grow', value: value ?? '', spellCheck: false, placeholder: field.type === 'exe' ? `留空 = 在 PATH 上找 ${field.exe}` : '留空 = 默认位置', onChange: (e) => { onChange(e.target.value); setCheck(null); } }),
          h(Btn, { disabled: field.type === 'dir' && !String(value ?? '').trim(), onClick: doCheck }, '检查')),
        check && h('div', { className: check.ok ? 'be-ok' : 'be-no' }, check.ok ? (check.version ? `✓ ${check.version}` : check.existed ? '✓ 可以写入' : '✓ 可以写入（文件夹已新建）') : `✗ ${check.error}`));
    }

    // 主人 UID：填完点「核对」看昵称对不对
    function OwnerField({ fld, value, onChange, hint }) {
      const [who, setWho] = useState(null);
      const check = () => api.post('ownerLookup', { mid: value }).then((r) => setWho({ ok: Boolean(r.owner.name), name: r.owner.name || '没查到这个 UID' }), (e) => setWho({ ok: false, name: e.message }));
      return h(Field, { label: fld.label, hint, wide: true },
        h('div', { className: 'be-row' },
          h('input', { className: 'be-input mono be-grow', inputMode: 'numeric', value: value || '', placeholder: '主人的 B站 UID（个人空间网址里那串数字）', onChange: (e) => { const t = e.target.value.replace(/\D/g, ''); onChange(t ? Number(t) : 0); setWho(null); } }),
          h(Btn, { disabled: !value, onClick: check }, '核对')),
        who && h('div', { className: who.ok ? 'be-ok' : 'be-no' }, who.ok ? `✓ ${who.name}` : `✗ ${who.name}`));
    }

    // 一个设置项。设置页和冲浪 / 收件箱 / 互动页共用
    function FieldInput({ fld, value, def, onChange }) {
      const changed = value !== def;
      const defText = def === '' ? '空' : (fld.scale ? def / fld.scale : def);
      const hint = [fld.hint, changed && fld.type === 'int' ? `默认 ${defText}${fld.unit ?? ''}` : ''].filter(Boolean).join('；');
      if (fld.type === 'bool') {
        return h('div', { className: 'be-field' },
          h('label', { className: 'be-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(value), onChange: (e) => onChange(e.target.checked) }), fld.label),
          fld.hint && h('small', null, fld.hint));
      }
      if (fld.type === 'dir' || fld.type === 'exe') return h(PathField, { field: fld, value, onChange });
      if (fld.key === 'ownerMid') return h(OwnerField, { fld, value, onChange, hint: fld.hint });
      if (fld.type === 'multi') {
        const set = new Set(String(value ?? '').split(',').filter(Boolean));
        const flip = (k) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); onChange(fld.options.map(([o]) => o).filter((o) => n.has(o)).join(',')); };
        return h(Field, { label: fld.label, hint: fld.hint, wide: true },
          h('div', { className: 'be-row' }, fld.options.map(([k, l]) => h('label', { key: k, className: 'be-switch' }, h('input', { type: 'checkbox', checked: set.has(k), onChange: () => flip(k) }), l))));
      }
      if (fld.type === 'enum') {
        return h(Field, { label: fld.label, hint },
          h('select', { className: 'be-select', value, onChange: (e) => onChange(e.target.value) }, fld.options.map(([v, l]) => h('option', { key: v, value: v }, l))));
      }
      if (fld.type === 'text') {
        const props = { className: `be-input${fld.multiline ? '' : ' mono'}`, value: value ?? '', maxLength: fld.max, spellCheck: false, onChange: (e) => onChange(e.target.value) };
        return h(Field, { label: fld.label, hint: fld.hint, wide: fld.multiline || fld.max > 60 },
          fld.multiline ? h('textarea', { ...props, rows: 3, style: { resize: 'vertical' } }) : h('input', props));
      }
      return h(Field, { label: fld.label, hint },
        h('div', { className: 'be-unit' },
          h('input', {
            className: 'be-input', type: 'number', step: 1, value: value === '' ? '' : (fld.scale ? value / fld.scale : value) ?? '',
            min: fld.scale ? fld.min / fld.scale : fld.min, max: fld.scale ? fld.max / fld.scale : fld.max,
            onChange: (e) => onChange(e.target.value === '' ? '' : Math.round(Number(e.target.value) * (fld.scale || 1))),
          }),
          fld.unit && h('span', null, fld.unit)));
    }

    /** 几组设置项。groups: [[分组, 标题, 说明]]；actions: {分组: (保存后的配置) => 额外按钮} */
    function ConfigGroups({ groups, toast, actions = {}, footer = false, onSaved }) {
      const st = useView('config');
      const [draft, setDraft] = useState(null);
      const [saved, setSaved] = useState(null);
      useEffect(() => { if (st.data) { setDraft(st.data.config); setSaved(st.data.config); } }, [st.data]);
      return h(Loading, { state: st }, (d) => {
        if (!draft || !saved) return null;
        const save = (group, label) => {
          const patch = {};
          for (const fld of d.fields.filter((x) => x.group === group)) patch[fld.key] = draft[fld.key];
          api.post('saveConfig', { config: patch }).then((r) => { setDraft(r.config); setSaved(r.config); toast(`${label}已保存，马上生效`); onSaved?.(r.config); }, (e) => toast(e.message, true));
        };
        const reset = (group) => api.post('resetConfig', { group }).then((r) => { setDraft(r.config); setSaved(r.config); toast('已恢复默认'); onSaved?.(r.config); }, (e) => toast(e.message, true));
        return h(React.Fragment, null,
          // 好几组设置时，顶上给一排跳转，不用一路往下滚找
          groups.length > 1 && h('nav', { className: 'be-sumline', 'aria-label': '设置分组' }, h('span', { className: 'be-faint' }, '跳到：'),
            groups.map(([group, label]) => h('button', { key: group, type: 'button', className: 'be-link', onClick: () => document.getElementById(`be-g-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label))),
          groups.map(([group, label, desc]) => {
            const list = d.fields.filter((x) => x.group === group);
            const dirty = list.some((x) => draft[x.key] !== saved[x.key]);
            return h(Card, { key: group, id: `be-g-${group}`, title: label, desc, aside: dirty ? '有未保存的修改' : '' },
              h('div', { className: 'be-fields' }, list.map((fld) => h(FieldInput, { key: fld.key, fld, value: draft[fld.key], def: d.defaults[fld.key], onChange: (v) => setDraft({ ...draft, [fld.key]: v }) }))),
              h('div', { className: 'be-row' },
                h(Btn, { kind: 'primary', disabled: !dirty, onClick: () => save(group, label) }, '保存'),
                h(Btn, { onClick: () => reset(group) }, '恢复默认'),
                actions[group]?.(saved)));
          }),
          footer && h('div', { className: 'be-faint' }, `保存后立即生效，不用重启 DSH。配置文件：${d.configFile}（只记和默认值不同的项）`));
      });
    }

    // 语音识别：读写 ~/.dsh/asr.json（和 dsh-video-storyboard 共用）。key 只能写，不会读回来
    function AsrCard({ toast }) {
      const st = useView('asr');
      const [f, setF] = useState(null);
      const [busy, setBusy] = useState(false);
      useEffect(() => { if (st.data) setF({ mode: st.data.mode === 'custom' ? 'custom' : 'siliconflow', baseUrl: st.data.mode === 'custom' ? st.data.baseUrl : '', model: st.data.mode === 'custom' ? st.data.model : '', key: '', start: (st.data.start ?? []).join('\n') }); }, [st.data]);
      const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
      const save = () => { setBusy(true); api.post('asrSave', { ...f, start: f.start.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }).then(() => { toast('语音识别已保存'); st.reload(); }, (e) => toast(e.message, true)).finally(() => setBusy(false)); };
      const test = () => { setBusy(true); api.post('asrTest').then((r) => toast(`${r.ok ? '✓' : '✗'} ${r.message}${r.ms != null ? `（${fmtMs(r.ms)}）` : ''}`, !r.ok), (e) => toast(e.message, true)).finally(() => setBusy(false)); };
      const clear = () => api.post('asrClear').then(() => { toast('已清除（原文件改名成 asr.json.bak）'); st.reload(); }, (e) => toast(e.message, true));
      return h(Card, { title: '语音识别', desc: '没字幕的视频靠它出台词。登录 B站 后大多数视频有 AI 字幕，用不上它；没配也能看，只是没台词。配置存在 ~/.dsh/asr.json，和 dsh-video-storyboard 共用。' },
        h(Loading, { state: st }, (d) => f && h(React.Fragment, null,
          h('div', { className: d.configured ? 'be-ok' : 'be-faint' }, d.configured ? `✓ 现在用的是：${d.mode === 'siliconflow' ? '硅基流动' : d.baseUrl}（${d.model}）${d.start.length ? '，用到时自动启动' : ''}` : '还没配置'),
          h('div', { className: 'be-seg', role: 'group' }, [['siliconflow', '硅基流动（云端）'], ['custom', '本机或自建服务']].map(([k, l]) => h('button', { key: k, type: 'button', 'aria-pressed': f.mode === k, onClick: () => setF({ ...f, mode: k }) }, l))),
          f.mode === 'siliconflow'
            ? h('div', { className: 'be-fields' },
              h(Field, { label: 'API Key', hint: `在 cloud.siliconflow.cn 注册后创建。模型是 FunAudioLLM/SenseVoiceSmall，中文效果好、速度快${d.mode === 'siliconflow' && d.hasKey ? '；已经填过，留空就保持不变' : ''}` },
                h('input', { className: 'be-input mono', type: 'password', autoComplete: 'off', value: f.key, placeholder: d.mode === 'siliconflow' && d.hasKey ? '（已填）' : 'sk-…', onChange: set('key') })))
            : h('div', { className: 'be-fields' },
              h(Field, { label: '服务地址', hint: 'OpenAI 兼容的转写接口，填到 /v1 为止，比如 http://127.0.0.1:8000/v1' }, h('input', { className: 'be-input mono', value: f.baseUrl, placeholder: 'http://127.0.0.1:8000/v1', onChange: set('baseUrl') })),
              h(Field, { label: '模型名', hint: '服务端认的模型名，比如 SenseVoiceSmall、whisper-1' }, h('input', { className: 'be-input mono', value: f.model, onChange: set('model') })),
              h(Field, { label: 'API Key', hint: '本机服务一般不用填；留空就保持原来的' }, h('input', { className: 'be-input mono', type: 'password', autoComplete: 'off', value: f.key, placeholder: d.hasKey ? '（已填）' : '可选', onChange: set('key') })),
              h(Field, { label: '用到时自动启动（可选）', hint: '启动服务的命令，一行一个参数（第一行是程序）。填了的话，有视频需要转写时才拉起，闲置 10 分钟后关掉', wide: true },
                h('textarea', { className: 'be-input mono', rows: 3, value: f.start, spellCheck: false, onChange: set('start'), style: { resize: 'vertical' } }))),
          h('div', { className: 'be-row' },
            h(Btn, { kind: 'primary', disabled: busy, onClick: save }, '保存'),
            d.configured && h(Btn, { disabled: busy, onClick: test }, '测试'),
            d.mode !== 'none' && h(ConfirmBtn, { label: '清除配置', confirmLabel: '确认清除？', onConfirm: clear })))));
    }

    function CacheCard({ toast, active }) {
      const st = useView('cache');
      useRefreshOnShow(active, st.reload);
      const clear = (which, label) => api.post('clearCache', { which }).then((r) => { toast(`${label}：清掉 ${r.cleared.files} 个文件（${fmtBytes(r.cleared.bytes)}）`); st.reload(); }, (e) => toast(e.message, true));
      return h(Card, { title: '缓存和下载的视频' },
        h(Loading, { state: st }, (d) => {
          const c = d.cache;
          const row = (key, label, x, extra) => h(React.Fragment, { key },
            h('div', null, h('div', null, label), h('div', { className: 'be-faint' }, x.dir ? `${x.files} 个文件${extra ?? ''}` : '默认位置（在下面「路径」里指定后可以在这里管理）')),
            h('div', { className: 'be-row', style: { justifyContent: 'flex-end' } },
              h('span', { className: 'v' }, x.dir ? fmtBytes(x.bytes) : '—'),
              x.dir && h(ConfirmBtn, { label: '清理', confirmLabel: '确认？', onConfirm: () => clear(key, label) })));
          return h(React.Fragment, null,
            h('div', { className: 'be-kv' },
              row('results', '看过的结果', c.results, `，保留 ${c.cacheHours} 小时`),
              row('storyboard', '分镜缓存', c.storyboard),
              row('media', '下载的视频', c.media, `，上限 ${fmtBytes(c.mediaMaxMb * 1048576)}`)),
            h('div', null, h(Btn, { onClick: () => api.post('openFolder', { which: 'data' }).then(() => toast('已在文件管理器里打开'), (e) => toast(e.message, true)) }, '打开数据文件夹')));
        }));
    }
    const groupPanel = (groups, extra) => function Panel(props) { return h(React.Fragment, null, extra && h(extra, props), h(ConfigGroups, { groups, toast: props.toast, footer: true })); };
    const SETTINGS_SUBS = [
      ['watch', '看视频', groupPanel([GROUPS[0]])],
      ['limits', '限额', groupPanel([GROUPS[1]])],
      ['storage', '存储', groupPanel([GROUPS[2]], CacheCard)],
      ['asr', '语音识别', AsrCard],
    ];
    function SettingsPage({ toast, active, sub, setSub }) {
      return h(SubPages, { items: SETTINGS_SUBS, sub, setSub, active, props: { toast } });
    }

    // ── 冲浪 ─────────────────────────────────────────────────────────────────
    const FEEDS = [['recommend', '首页推荐'], ['hot', '热门'], ['rank', '排行'], ['following', '关注'], ['favorites', '她的收藏'], ['up', 'UP 主']];

    function FeedPanel() {
      const [src, setSrc] = useState('recommend');
      const [up, setUp] = useState('');
      const [list, setList] = useState(null);       // {loading, items, title, error}
      const load = (source = src) => {
        if (source === 'up' && !up.trim()) { setList(null); return; }
        setList({ loading: true });
        api.post('feed', { source, up }).then((r) => setList({ items: r.items, title: r.title }), (e) => setList({ error: e.message }));
      };
      useEffect(() => { load('recommend'); }, []);
      return h(Card, { title: '刷列表', aside: list?.title ?? '', desc: '她用 bili_feed 看到的就是这些。登录后「首页推荐」按这个账号的口味推，逛得越多越准。' },
        h('div', { className: 'be-tools' },
          h(Seg, { options: FEEDS, value: src, onChange: (id) => { setSrc(id); if (id !== 'up') load(id); else setList(null); }, label: '列表' }),
          src === 'up' && h('input', { className: 'be-input be-grow', value: up, placeholder: 'UP 主昵称或 UID', onChange: (e) => setUp(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load('up'); } }),
          h(Btn, { onClick: () => load() }, src === 'up' ? '看投稿' : '换一批')),
        list?.loading && h('div', { className: 'be-empty' }, h('span', { className: 'be-spin', style: { marginRight: 8 } }), '加载中…'),
        list?.error && h('div', { className: 'be-no' }, list.error),
        list?.items && h(ScrollList, { items: list.items, empty: src === 'up' ? '这个 UP 主最近没有投稿' : '是空的' }, (x) => h(Entry, {
          key: x.bvid, title: h(Ctx, { text: x.title, url: bv(x.bvid), cls: 'be-et' }), status: x.seconds && [fmtDur(x.seconds), 'dim'],
          meta: [x.author, `播放 ${fmtNum(x.play)}`, x.pubdate && new Date(x.pubdate * 1000).toLocaleDateString()],
        })));
    }

    function SurfOncePanel() {
      const [dir, setDir] = useState('');
      const [run, setRun] = useState(null);
      const [res, setRes] = useState(null);
      const go = () => {
        setRes(null); setRun({ since: Date.now() });
        api.post('surf', { direction: dir }).then(setRes, (e) => setRes({ error: e.message })).finally(() => setRun(null));
      };
      return h(Card, { title: '逛一圈', desc: '和她调用 bili_surf 一样。「顺着逛」时模型自己搜、打开视频、看评论和 UP 主的其他投稿，最后挑几条；「固定流程」是找候选 → 挑几条 → 快速看 → 总结。本地预览没有模型，只能按播放量挑。' },
        h('div', { className: 'be-row' },
          h('input', { className: 'be-input be-grow', value: dir, maxLength: 50, placeholder: '方向（可选），比如：游戏剧情、冷门科普', onChange: (e) => setDir(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && !run) go(); } }),
          h(Btn, { kind: 'primary', disabled: Boolean(run), onClick: go }, run ? '逛着呢…' : '逛一圈'),
          run && h(Elapsed, { since: run.since })),
        res && (res.error
          ? h('div', { className: 'be-no' }, res.error)
          : h(React.Fragment, null,
            h('div', { className: 'be-faint' }, `${fmtMs(res.ms)} · ${res.mode === 'explore' ? `顺着逛了 ${res.steps} 步，路线记在「路线」里` : res.model ? '固定流程，用了模型挑选和总结' : '没用模型（按播放量挑，材料直接截取）'}`),
            h('pre', { className: 'be-pre' }, res.text))));
    }

    const RUN_CLS = { sent: 'ok', ok: 'ok', draft: 'brand', failed: 'bad', hidden: 'bad', 'no-owner': 'bad', 'no-gate': 'bad' };
    const RUN_STATUS = { sent: '已发', draft: '起草（等同意）', refused: '没发', failed: '失败', hidden: '仅自己可见', ok: '已转达', 'no-owner': '没设主人 UID', 'no-gate': '没接门卫' };
    function AutoSurfPanel({ toast, active, go }) {
      const st = useView('autosurf');
      useRefreshOnShow(active, st.reload);
      const [run, setRun] = useState(null);
      const now = () => {
        setRun({ since: Date.now() });
        api.post('autoSurfNow').then((r) => toast(r.run.ok ? `逛完了：挑了 ${r.run.picks.length} 条` : `没成功：${r.run.error}`, !r.run.ok), (e) => toast(e.message, true)).finally(() => { setRun(null); st.reload(); });
      };
      return h(Card, { title: '自己逛', desc: '插件按时间表自己去逛，逛完看情况在视频下面评论，把最想推荐的告诉主人。评论、@、私信照样受「互动」里的档位和额度管。' },
        h(Loading, { state: st }, (d) => h(React.Fragment, null,
          d.on
            ? h('div', { className: 'be-row' }, h('span', null, '今天的计划：'), d.slots.length ? d.slots.map((t) => h('span', { key: t, className: `be-badge ${d.done.includes(t) ? 'ok' : ''}` }, `${new Date(t).toTimeString().slice(0, 5)}${d.done.includes(t) ? ' ✓' : ''}`)) : h('span', { className: 'be-faint' }, '今天的时间段已经过了，明天再逛'))
            : h('div', { className: 'be-row' }, h('span', { className: 'be-faint' }, '没开。'), h('button', { type: 'button', className: 'be-link', onClick: () => go('surf', 'settings') }, '去设置里打开')),
          h('div', { className: 'be-row' }, h(Btn, { disabled: Boolean(run), onClick: now }, run ? '逛着呢…' : '现在逛一次'), run && h(Elapsed, { since: run.since }), h('span', { className: 'be-faint' }, '不占今天的次数；会真的评论 / 推荐')),
          h(ScrollList, { items: d.runs, empty: '还没自己逛过。' }, (r) => h(Entry, {
            key: r.at, kind: [r.reason === 'manual' ? '手动逛' : '到点逛', 'pink'],
            ctx: r.ok && h('span', { className: 'be-ctx' }, `挑了 ${r.picks.length} 条${r.steps ? ` · ${r.steps} 步` : ''}`),
            status: r.ok ? (r.comments.length || r.recommend ? null : ['没出手', 'dim']) : ['失败', 'bad'], at: r.at, error: r.error,
          },
          r.comments.map((c) => h(RunStep, { key: c.bvid, label: '评论', title: c.title, bvid: c.bvid, status: RUN_STATUS[c.status] ?? c.status, cls: RUN_CLS[c.status] }, c.text)),
          r.recommend && h(RunStep, { label: '推荐', title: r.recommend.title, bvid: r.recommend.bvid, status: Object.entries(r.recommend.ways).map(([k, v]) => `${{ notify: '门卫', comment: '评论 @', dm: '私信' }[k]} ${RUN_STATUS[v] ?? v}`).join(' · '), cls: wayCls(Object.values(r.recommend.ways)) }, r.recommend.why),
          r.ok && !r.comments.length && !r.recommend && r.picks.length > 0 && h('div', { className: 'be-faint' }, `逛到：${r.picks.map((p) => `《${p.title}》`).join('、')}`))))));
    }
    // 推荐有几种方式：全成了绿，有失败红，其余（比如没开的方式没发）灰
    const wayCls = (vs) => (vs.some((v) => RUN_CLS[v] === 'bad') ? 'bad' : vs.length && vs.every((v) => RUN_CLS[v] === 'ok') ? 'ok' : '');
    // 自己逛一次里的一步：评论了什么 / 推荐了什么
    function RunStep({ label, title, bvid, status, cls, children }) {
      return h('div', { className: 'be-sube' },
        h('div', { className: 'be-eh' }, h('span', { className: 'be-kind' }, label), h(Ctx, { text: title && `《${title}》`, url: bvid && bv(bvid) }), status && h('span', { className: `be-st ${cls || 'dim'}`, style: { marginLeft: 'auto', whiteSpace: 'nowrap', fontSize: 12 } }, status)),
        children && h('div', { className: 'be-q' }, children));
    }

    function TrailsPanel({ active }) {
      const st = useView('trails');
      useRefreshOnShow(active, st.reload);
      return h(Card, { title: '路线', desc: '「顺着逛」每一圈是怎么点过去的（最近 20 圈），✓ 是最后挑中的。' },
        h(Loading, { state: st }, (d) => h(ScrollList, { items: d.trails, empty: '还没有顺着逛过。' }, (t) => h(Entry, {
          key: t.at, kind: [t.direction || '随便逛', ''], status: [`挑中 ${t.picks.length} 条`, t.picks.length ? 'ok' : 'dim'], at: t.at,
          meta: [`${t.steps.length} 步`, `约 ${Math.round((t.tokens?.in ?? 0) / 1000)}k 输入 token`, t.model],
        },
        h('div', { className: 'be-faint', style: { fontSize: 12.5, lineHeight: 1.7 } }, t.steps.join(' → ') || '（没走动）'),
        t.picks.map((p) => h('div', { key: p.bvid }, h('span', { style: { color: 'var(--ok)', marginRight: 6 } }, '✓'), h('a', { href: bv(p.bvid), target: '_blank', rel: 'noreferrer' }, p.title))),
        t.route && h('div', { className: 'be-faint' }, t.route)))));
    }

    function SurfSettings({ toast }) {
      return h(ConfigGroups, { groups: [['surf', '怎么逛', '口味、用哪个模型、一圈几条、顺着逛的上限。'], ['autosurf', '自己逛', '什么时候逛、每天几次、要不要评论、怎么推荐给主人。']], toast, footer: true });
    }

    function SurfPage({ toast, active, sub, setSub, go }) {
      return h(SubPages, { items: [['feed', '刷列表', FeedPanel], ['once', '逛一圈', SurfOncePanel], ['auto', '自己逛', AutoSurfPanel], ['trails', '路线', TrailsPanel], ['settings', '设置', SurfSettings]], sub, setSub, active, props: { toast, go } });
    }

    // ── 收件箱 ───────────────────────────────────────────────────────────────
    const IN_KIND = { reply: ['回复', 'brand'], at: ['@', 'pink'], dm: ['私信', 'ok'] };
    const IN_STATUS = { new: ['新', 'brand'], notified: ['已转达', ''], done: ['处理完', 'ok'], ignored: ['忽略', ''] };

    function InboxMessages({ toast, active }) {
      const [f, setF] = useState({ status: 'open', days: '0' });
      const st = usePaged('inbox', f);
      useRefreshOnShow(active, st.reload);
      const [busy, setBusy] = useState(false);
      const check = () => {
        setBusy(true);
        api.post('inboxCheck').then((r) => { toast(r.error ? `没查成：${r.error}` : r.baseline ? '第一次查：已记下现在的位置，之后的新消息才算' : `查完了：新消息 ${r.added} 条，转达 ${r.delivered} 条`, Boolean(r.error)); st.reload(); }, (e) => toast(e.message, true)).finally(() => setBusy(false));
      };
      const mark = (ids, status) => api.post('inboxMark', { ids, status }).then(() => st.reload(), (e) => toast(e.message, true));
      const d = st.data;
      return h(Card, { title: '消息', aside: d ? (d.lastCheck ? `上次查：${when(d.lastCheck)}` : '还没查过') : '', desc: '回复我的、@ 我的、私信。后台按设置定时查，有新的就交给门卫转达（比如在 QQ 私聊里叫醒她）。' },
        d && h('div', { className: 'be-row' },
          h('span', { className: `be-badge ${d.on ? 'ok' : ''}` }, d.on ? '后台在查' : '后台没开'),
          h('span', { className: `be-badge ${d.gate ? 'ok' : ''}` }, d.gate ? '门卫已接上' : '没接门卫：只在这里显示'),
          d.lastError && h('span', { className: 'be-err' }, `上次出错：${d.lastError}`)),
        h('div', { className: 'be-tools' },
          h(Seg, { options: [['open', `待处理${d ? ` ${d.open}` : ''}`], ['', '全部']], value: f.status, onChange: (v) => setF({ ...f, status: v }), small: true, label: '状态' }),
          h(Seg, { options: RANGES, value: f.days, onChange: (v) => setF({ ...f, days: v }), small: true, label: '时间范围' }),
          h('span', { className: 'sp' }),
          h(Btn, { kind: 'primary', disabled: busy, onClick: check }, busy ? '查着呢…' : '现在查一次')),
        h(ListBox, { st, empty: f.status === 'open' ? '没有待处理的消息。' : (d?.started ? '这段时间没有消息。' : '还没查过：点「现在查一次」先记下现在的位置。') }, (x) => {
          const [kl, kc] = IN_KIND[x.kind] ?? [x.kind, ''];
          const [sl, sc] = IN_STATUS[x.status] ?? [x.status, ''];
          const open = x.status === 'new' || x.status === 'notified';
          return h(Entry, {
            key: x.id, kind: [kl, kc], title: h('span', { className: 'be-et', style: { fontSize: 13 } }, x.user.name || `UID ${x.user.mid}`), tag: x.owner && '主人',
            status: [sl, sc], at: x.at,
            meta: [x.where?.title && (x.where.uri ? h('a', { href: x.where.uri, target: '_blank', rel: 'noreferrer' }, `《${x.where.title}》`) : `《${x.where.title}》`)],
            actions: open && [h(ActBtn, { key: 'd', kind: 'primary', onClick: () => mark([x.id], 'done') }, '处理完'), h(ActBtn, { key: 'i', onClick: () => mark([x.id], 'ignored') }, '忽略')],
          }, x.text, x.mine && h('div', { className: 'be-faint be-1l', title: x.mine }, `回的是我说的：${x.mine}`));
        }));
    }

    function InboxSettings({ toast }) {
      return h(ConfigGroups, {
        groups: [['inbox', '收件箱', '多久查一次、什么时候不查、每小时最多打扰几次。'], ['gate', '门卫', '告诉插件「这个会话是不是主人本人」「主人说过什么」，并把收件箱的新消息和推荐转达到 QQ。用 dsh-qq 桥接的，选「dsh-qq」填桥接目录就行；别的桥接按 docs/门卫协议.md 接；都没有时用内置门卫（按会话的 agentPreset 和工作目录判断，本机会话「先问主人」时弹 DSH 审批卡片）。']],
        toast,
        footer: true,
        actions: { gate: (saved) => h(React.Fragment, null,
          (saved.gateMode !== 'builtin') && h(Btn, { onClick: () => api.post('gateTest').then((r) => toast(`门卫正常（${fmtMs(r.ms)}）：${r.label}`), (e) => toast(e.message, true)) }, '测试门卫'),
          saved.qqBridgeDir && h(DshQq, { toast })) },
      });
    }

    function InboxPage({ toast, active, sub, setSub }) {
      return h(SubPages, { items: [['messages', '消息', InboxMessages], ['settings', '设置', InboxSettings]], sub, setSub, active, props: { toast } });
    }

    // dsh-qq 桥接：检查连不连得上、三个补丁打没打（工具白名单、分享卡片、偶发报错）；一键适配 / 还原
    const PATCH_TEXT = { patched: '已打', original: '没打', unknown: '桥接版本变了，认不出' };
    function DshQq({ toast }) {
      const [st, setSt] = useState(null);
      const [busy, setBusy] = useState(false);
      const check = () => api.post('dshqqCheck').then(setSt, (e) => toast(e.message, true));
      useEffect(() => { check(); }, []);
      const patch = (revert) => { setBusy(true); api.post('dshqqPatch', { revert }).then((r) => { toast(`${r.steps.map((x) => x.text).join('；')}。改完要在桥接控制中心重启桥接`, r.steps.some((x) => x.result === 'fail')); check(); }, (e) => toast(e.message, true)).finally(() => setBusy(false)); };
      if (!st) return null;
      const p = st.patches;
      const all = p?.ok && !p.whitelist.missing.length && p.card === 'patched' && p.errors === 'patched';
      return h('div', { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 } },
        h('div', { className: st.check.ok ? 'be-ok' : 'be-no' }, st.check.ok ? `✓ dsh-qq 桥接连得上（主人 QQ ${st.check.ownerQQ}，${st.check.sessions} 个会话）` : `✗ ${st.check.problems.join('；')}`),
        p?.ok
          ? h('div', { className: 'be-faint' }, `补丁：工具白名单${p.whitelist.missing.length ? `缺 ${p.whitelist.missing.length} 个` : '已加'} · 分享卡片${PATCH_TEXT[p.card]} · 偶发报错不发群里${PATCH_TEXT[p.errors]}`)
          : h('div', { className: 'be-no' }, p?.error ?? ''),
        p?.ok && h('div', { className: 'be-row' },
          !all && h(Btn, { kind: 'primary', disabled: busy, onClick: () => patch(false) }, '一键适配'),
          h(ConfirmBtn, { label: '还原补丁', confirmLabel: '确认还原？', disabled: busy, onConfirm: () => patch(true) }),
          h('span', { className: 'be-faint' }, '会改桥接的源码（先备份成 .bak-bili-eyes），改完要重启桥接')));
    }

    // ── 互动 ─────────────────────────────────────────────────────────────────
    const MODE_TEXT = { off: ['关', ''], approve: ['先问主人', 'brand'], auto: ['直接发', 'pink'] };
    const LOG_STATUS = { ok: ['已发', 'ok'], hidden: ['仅自己可见', 'bad'], fail: ['失败', 'bad'], refused: ['拒绝', ''], draft: ['起草', 'brand'], rejected: ['丢掉', ''], unconfirmed: ['没核实到', 'bad'] };

    const MODE_NAME = { like: '点赞/收藏', comment: '评论', dm: '私信', post: '动态', follow: '关注' };
    function ActSummary({ d }) {
      const lvl = d.login.level;
      const kinds = [['like', '点赞', d.counts.like ?? 0, d.quota.like], ['fav', '收藏', d.counts.fav ?? 0, d.quota.fav], ['comment', '评论', d.counts.comment ?? 0, d.quota.comment], ['reply', '回复', d.counts.reply ?? 0, d.quota.reply], ['dm', '私信', d.counts.dm ?? 0, d.quota.dm], ['post', '动态', d.counts.post ?? 0, d.quota.post], ['follow', '关注', d.counts.follow ?? 0, d.quota.follow]];
      return h('div', { className: 'be-grid' },
        h(Card, { title: '账号' },
          d.login.state === 'ok'
            ? h(React.Fragment, null,
              h('div', { className: 'be-row' }, h('div', { className: 'be-big' }, d.login.uname), lvl != null && h('span', { className: `be-badge ${lvl === 0 ? 'bad' : 'ok'}` }, `LV${lvl}`)),
              lvl === 0 && h('div', { className: 'be-err' }, 'LV0（未转正）：B站不让发评论和弹幕。去 B站 App 答题转正后再打开「评论、回复」。'))
            : h('div', { className: 'be-no' }, '没登录：去「概览」扫码登录（建议用小号）'),
          h('div', { className: 'be-faint' }, d.owner.mid ? `主人：${d.owner.name || '（昵称没查到）'}（UID ${d.owner.mid}）` : '还没设置主人 UID：不能 @ 主人、不能私信'),
          h('div', { className: 'be-row' }, Object.entries(d.modes).map(([k, m]) => h('span', { key: k, className: `be-badge ${MODE_TEXT[m][1]}` }, `${MODE_NAME[k]}：${MODE_TEXT[m][0]}`)))),
        h(Card, { title: '今天' },
          (d.paused || d.pausedUntil > 0) && h('div', { className: 'be-err' }, d.paused ? '已按「全部停下」：所有写操作都会被拒绝' : `${d.pauseReason || '刚被 B站风控拦过'}：写操作暂停到 ${new Date(d.pausedUntil).toLocaleTimeString()}`),
          d.followPausedUntil > 0 && h('div', { className: 'be-err' }, `${d.followPauseReason || '关注被 B站拦过'}：关注暂停到 ${new Date(d.followPausedUntil).toLocaleString()}`),
          kinds.map(([k, label, used, max]) => h(Meter, { key: k, label, used, max }))));
    }

    function Drafts({ d, toast, reload }) {
      const draftDo = (id, decision) => api.post('draft', { id, decision }).then((r) => { toast(r.text, r.status === 'failed' || (r.status === 'refused' && decision === 'send')); reload(); }, (e) => toast(e.message, true));
      return h(Card, { title: '待同意', aside: d.drafts.length ? `${d.drafts.length} 条` : '', desc: d.gate ? '她起草后会先在聊天里问主人；主人回一句同意的话（「可以」「嗯」「发吧」「关注吧」都行）她就会发出。你也可以直接在这里处理。' : '没接门卫：她没法确认主人同意，草稿只能在这里处理。' },
        h(ScrollList, { items: d.drafts, empty: '没有待同意的草稿。' }, (x) => h(Entry, {
          key: x.id, kind: [d.kindText[x.kind], 'brand'], ctx: h(Ctx, { text: x.target?.title, url: x.target?.url }),
          status: x.expired ? ['已过期', 'dim'] : ['等主人同意', 'brand'], at: x.createdAt, quote: true,
          meta: [`草稿 #${x.id}`, x.where],
          actions: !x.expired && [h(ActBtn, { key: 's', kind: 'primary', onClick: () => draftDo(x.id, 'send') }, '同意并发出'), h(ActBtn, { key: 'd', onClick: () => draftDo(x.id, 'drop') }, '丢掉')],
        }, x.preview)));
    }

    const LOG_KINDS = [['', '全部操作'], ['like', '点赞'], ['fav', '收藏'], ['unfav', '取消收藏'], ['comment', '评论'], ['reply', '回复'], ['dm', '私信'], ['post', '动态'], ['follow', '关注'], ['unfollow', '取关']];
    const LOG_STATUSES = [['', '全部结果'], ['ok', '已发'], ['draft', '起草'], ['refused', '拒绝'], ['fail', '失败'], ['hidden', '仅自己可见'], ['unconfirmed', '没核实到'], ['rejected', '丢掉']];
    function ActLog({ toast, active }) {
      const [f, setF] = useState({ kind: '', status: '', days: '7' });
      const st = usePaged('actlog', f);
      useRefreshOnShow(active, st.reload);
      const set = (k) => (v) => setF({ ...f, [k]: v });
      const del = (id) => api.post('deleteSent', { id }).then(() => { toast('已在 B站删掉'); st.reload(); }, (e) => toast(e.message, true));
      const recheck = () => api.post('recheck').then((r) => { toast(r.checked ? `查了 ${r.checked} 条，${r.nowVisible} 条已经公开` : '没有要复查的'); st.reload(); }, (e) => toast(e.message, true));
      const kindText = st.data?.kindText ?? {};
      return h(Card, { title: '记录', desc: st.data?.hiddenOpen ? '「仅自己可见」= B站接受了，但被风控或审核藏起来了，别人看不到、被 @ 的人也收不到通知。有时审核过后会公开，可以过一阵再查。' : '每一次写操作：发出的、起草的、被拒的、失败的都在这里。' },
        h('div', { className: 'be-tools' },
          h(Pick, { options: LOG_KINDS, value: f.kind, onChange: set('kind'), label: '操作' }),
          h(Pick, { options: LOG_STATUSES, value: f.status, onChange: set('status'), label: '结果' }),
          h(Seg, { options: RANGES, value: f.days, onChange: set('days'), small: true, label: '时间范围' }),
          h('span', { className: 'sp' }),
          st.data?.hiddenOpen && h(Btn, { onClick: recheck }, '再查一次可见性')),
        h(ListBox, { st, empty: '这段时间没有写操作。' }, (e) => {
          const [sl, sc] = e.nowVisible ? ['已公开', 'ok'] : (LOG_STATUS[e.status] ?? [e.status, '']);
          const canDel = (e.status === 'ok' || e.status === 'hidden') && (e.kind === 'comment' || e.kind === 'reply') && e.rpid && !e.deleted;
          const target = e.target?.title || e.target?.name;
          // 有正文（评论、回复、私信）：对象放在头里，正文是她说的话；没有正文（收藏、关注）：对象就是正文
          return h(Entry, {
            key: e.id, kind: [kindText[e.kind] ?? e.kind, ''], ctx: e.text && h(Ctx, { text: target, url: e.target?.url }),
            status: [sl, sc], at: e.at, quote: Boolean(e.text), error: e.error,
            meta: [e.draft && `草稿 #${e.draft}`, e.deleted && '已在 B站删掉'],
            actions: canDel && h(ConfirmBtn, { key: 'del', subtle: true, label: '在 B站删掉', confirmLabel: '确认删除？', onConfirm: () => del(e.id) }),
          }, e.text || (target && (e.target.url ? h('a', { href: e.target.url, target: '_blank', rel: 'noreferrer' }, target) : target)));
        }));
    }

    function Follows({ d, toast, reload }) {
      const unfollow = (mid) => api.post('unfollow', { mid }).then((r) => { toast(r.text, r.status !== 'sent'); reload(); }, (e) => toast(e.message, true));
      const undoToday = () => api.post('undoTodayFollows').then((r) => { toast(r.total ? `今天关注了 ${r.total} 个，取关了 ${r.done} 个` : '今天没关注过谁', r.done < r.total); reload(); }, (e) => toast(e.message, true));
      const recheck = () => api.post('recheckFollows').then((r) => toast(r.missing.length ? `查了 ${r.checked} 个，这些已经不在关注里：${r.missing.join('、')}` : `查了 ${r.checked} 个，都还在关注`, r.missing.length > 0), (e) => toast(e.message, true));
      const today = d.follows.filter((f) => new Date(f.at).toDateString() === new Date().toDateString()).length;
      return h(Card, { title: '她的关注', aside: d.follows.length ? `${d.follows.length} 个` : '', desc: `她自己关注的 UP 主（都在 B站的「${d.followTag}」分组里）。号上原来就有的关注不在这里，她也动不了。` },
        d.follows.length > 0 && h('div', { className: 'be-row' },
          today > 0 && h(ConfirmBtn, { label: `撤销今天的 ${today} 个关注`, confirmLabel: '确认全部取关？', onConfirm: undoToday }),
          h(Btn, { onClick: recheck }, '再核实一次')),
        h(ScrollList, { items: d.follows, empty: '她还没关注过谁。' }, (f) => h(Entry, {
          key: f.mid, title: h(Ctx, { text: String(f.name || f.mid), url: `https://space.bilibili.com/${f.mid}`, cls: 'be-et' }), at: f.at, muted: true,
          meta: [`UID ${f.mid}`], actions: h(ConfirmBtn, { key: 'u', subtle: true, label: '取关', confirmLabel: '确认取关？', onConfirm: () => unfollow(f.mid) }),
        }, f.why)));
    }

    function Favs({ d, toast, reload }) {
      const unfav = (aid) => api.post('unfav', { aid }).then((r) => { toast(r.text, r.status !== 'sent'); reload(); }, (e) => toast(e.message, true));
      return h(Card, { title: '她的收藏', aside: d.favs.length ? `${d.favs.length} 个` : '', desc: `她自己收藏的视频（在 B站的「${d.favFolder}」收藏夹里）。账号里原来就有的收藏不在这里，她也动不了。` },
        h(ScrollList, { items: d.favs, empty: '她还没收藏过视频。' }, (f) => h(Entry, {
          key: f.aid, title: h(Ctx, { text: f.title || f.bvid, url: bv(f.bvid), cls: 'be-et' }), at: f.at, muted: true,
          meta: [f.bvid], actions: h(ConfirmBtn, { key: 'u', subtle: true, label: '取消收藏', confirmLabel: '确认取消？', onConfirm: () => unfav(f.aid) }),
        }, f.why)));
    }

    function ActSettings({ toast, reload }) {
      return h(ConfigGroups, { groups: [['act', '互动设置', '每一类写操作的档位和每天上限。默认全关；「先问主人」会先起草，主人同意才发。@ 和私信只能对着主人。']], toast, footer: true, onSaved: () => reload() });
    }

    function InteractPage({ toast, active, sub, setSub }) {
      const st = useView('act');
      useRefreshOnShow(active, st.reload);
      return h(Loading, { state: st }, (d) => h(SubPages, {
        items: [['summary', '概况', ActSummary], ['drafts', '待同意', Drafts, d.drafts.filter((x) => !x.expired).length], ['log', '记录', ActLog], ['follows', '关注', Follows], ['favs', '收藏', Favs], ['settings', '设置', ActSettings]],
        sub, setSub, active, props: { toast, d, reload: st.reload },
      }));
    }

    // ── 页面 ─────────────────────────────────────────────────────────────────
    // 一个页签出错只坏这一页，别的页签照常能用
    class PageBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      render() {
        if (!this.state.error) return this.props.children;
        return h('div', { className: 'be-card' }, h('p', { className: 'be-desc' }, `这一页出错了：${this.state.error.message}`), h('div', null, h(Btn, { onClick: () => this.setState({ error: null }) }, '重试')));
      }
    }
    const TABS = [['overview', '概览', Overview], ['watch', '看视频', WatchPage], ['surf', '冲浪', SurfPage], ['inbox', '收件箱', InboxPage], ['act', '互动', InteractPage], ['settings', '设置', SettingsPage]];
    const stored = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
    function BiliEyes() {
      const [tab, setTab] = useState(() => { const t = stored('dsh-bili-eyes:tab', 'overview'); return TABS.some((x) => x[0] === t) ? t : 'overview'; });
      const [subs, setSubs] = useState(() => { try { return JSON.parse(stored('dsh-bili-eyes:subs', '{}')) || {}; } catch { return {}; } });
      const [msg, setMsg] = useState(null);
      const toast = useCallback((text, bad = false) => setMsg({ text, bad, at: Date.now() }), []);
      useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(null), msg.bad ? 6000 : 2500); return () => clearTimeout(t); }, [msg]);
      useEffect(() => { try { localStorage.setItem('dsh-bili-eyes:tab', tab); localStorage.setItem('dsh-bili-eyes:subs', JSON.stringify(subs)); } catch { /* 忽略 */ } }, [tab, subs]);
      const go = useCallback((t, s) => { setTab(t); if (s) setSubs((x) => ({ ...x, [t]: s })); }, []);
      return h('div', { className: 'be' },
        h('header', { className: 'be-head' }, h('h2', null, 'B站伙伴'), h('p', null, '她的 B站：看视频、逛 B站、收件箱，以及点赞、评论、收藏、关注这些写操作（默认全关，在「互动 → 设置」里逐项打开）。这里的改动立即生效。')),
        h('nav', { className: 'be-tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', className: 'be-tab', 'aria-selected': tab === id, onClick: () => setTab(id) }, label))),
        // 页签都挂着、只是隐藏：试看跑到一半切走再回来，结果还在
        TABS.map(([id, , Page]) => h('div', { key: id, className: 'be-page', hidden: tab !== id }, h(PageBoundary, null, h(Page, { toast, go, active: tab === id, sub: subs[id], setSub: (s) => setSubs((x) => ({ ...x, [id]: s })) })))),
        msg && h('div', { className: `be-toast${msg.bad ? ' bad' : ''}`, role: 'status' }, msg.text));
    }

    const inject = ['slots'];
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-bili-eyes',
        order: 117,
        label: () => 'B站伙伴',
        inject: () => ({}),
      }, BiliEyes));
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.BiliEyes = BiliEyes;
    return module.exports;
  },
});
