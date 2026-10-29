// dsh-bili-eyes 的界面：DSH 设置侧边栏里的「B站看视频」。
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
.be-hrow{display:grid;grid-template-columns:76px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid color-mix(in srgb,var(--bd) 60%,transparent)}
.be-hrow:last-child{border-bottom:0}
.be-hrow .when{color:var(--t3);font-size:12px;font-variant-numeric:tabular-nums;padding-top:2px}
.be-htitle{display:flex;gap:6px;align-items:baseline;min-width:0}
.be-htitle a,.be-htitle span.t{color:var(--t1);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.be-htitle a:hover{color:var(--brand);text-decoration:underline}
.be-hmeta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--t3);margin-top:2px}
.be-err{color:var(--bad);font-size:12px;margin-top:2px;overflow-wrap:anywhere}
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
.be-btn:disabled{opacity:.5;cursor:default}
.be-sheets{display:flex;flex-direction:column;gap:10px}
.be-sheets img{width:100%;border-radius:var(--rs);border:1px solid var(--bd);display:block;cursor:zoom-in;background:var(--b2)}
.be-sheets img.full{cursor:zoom-out}
.be-pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:12.5px;line-height:1.6;background:var(--b2);border-radius:var(--rs);padding:12px;max-height:520px;overflow:auto;color:var(--t1)}
.be-items{display:flex;flex-direction:column;gap:8px}
.be-item{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--bd);border-radius:var(--rs)}
.be-item a{color:var(--t1);font-weight:500;text-decoration:none}
.be-item a:hover{color:var(--brand)}
.be-spin{display:inline-block;width:12px;height:12px;border:2px solid color-mix(in srgb,var(--brand) 30%,transparent);border-top-color:var(--brand);border-radius:50%;animation:be-spin .8s linear infinite;vertical-align:-1px}
@keyframes be-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.be-spin{animation-duration:2.4s}.be-bar i,.be-switch input,.be-switch input::after{transition:none}}
.be-toast{position:sticky;bottom:12px;align-self:flex-start;padding:8px 14px;border-radius:var(--rs);font-size:13px;background:var(--t1);color:var(--b1);box-shadow:0 4px 14px rgba(0,0,0,.18)}
.be-toast.bad{background:var(--bad);color:#fff}
.be-empty{color:var(--t3);font-size:13px;padding:6px 0}
.be-ok{color:var(--ok);font-size:13px}.be-no{color:var(--bad);font-size:13px}
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

    function useView(view) {
      const [state, setState] = useState({ loading: true, data: null, error: null });
      const load = useCallback(() => {
        setState((s) => ({ ...s, loading: true }));
        api.get(view).then((data) => setState({ loading: false, data, error: null }), (e) => setState({ loading: false, data: null, error: e.message }));
      }, [view]);
      useEffect(load, [load]);
      return { ...state, reload: load };
    }

    function Btn({ kind, onClick, disabled, children, title }) {
      if (Prim.Button && kind !== 'danger') {
        return h(Prim.Button, { variant: kind === 'primary' ? undefined : 'outline', size: 'sm', onClick, disabled, title }, children);
      }
      return h('button', { type: 'button', className: `be-btn ${kind ?? ''}`, onClick, disabled, title }, children);
    }

    // 危险操作：点一下变成「确认？」，3 秒内再点一次才执行
    function ConfirmBtn({ label, confirmLabel, onConfirm, disabled }) {
      const [armed, setArmed] = useState(false);
      useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
      return h('button', {
        type: 'button', className: `be-btn danger${armed ? ' armed' : ''}`, disabled,
        onClick: () => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); },
      }, armed ? (confirmLabel ?? '再点一次确认') : label);
    }

    function Card({ title, aside, desc, children }) {
      return h('section', { className: 'be-card' },
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
    const KIND = { look: ['看', 'brand'], zoom: ['放大', 'brand'], find: ['搜', ''], file: ['本机视频', 'pink'] };
    const SOURCE = { tool: '她', ui: '试看', plugin: '插件', cli: '命令行', other: '' };

    function HistoryRow({ e }) {
      const [label, cls] = KIND[e.kind] ?? [e.kind, ''];
      const url = videoUrl(e);
      const meta = [];
      if (e.kind === 'find') { if (e.ok) meta.push(`${e.results} 个结果`); }
      else if (e.ok) {
        if (e.duration) meta.push(e.to != null || e.from ? `${fmtDur(e.from || 0)}–${fmtDur(e.to ?? e.duration)} / ${fmtDur(e.duration)}` : fmtDur(e.duration));
        if (e.sheets) meta.push(`${e.sheets} 张图`);
      }
      if (e.ms != null) meta.push(fmtMs(e.ms));
      return h('div', { className: 'be-hrow' },
        h('div', { className: 'when' }, when(e.at)),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'be-htitle' },
            h('span', { className: `be-badge ${cls}` }, label),
            url ? h('a', { href: url, target: '_blank', rel: 'noreferrer', title: e.title }, e.title || e.bvid) : h('span', { className: 't', title: e.title }, e.title || '—')),
          h('div', { className: 'be-hmeta' },
            meta.map((m, i) => h('span', { key: i }, m)),
            e.cached && h('span', { className: 'be-badge ok' }, '缓存'),
            SOURCE[e.source] && h('span', { className: 'be-badge' }, SOURCE[e.source])),
          !e.ok && h('div', { className: 'be-err' }, e.error),
          e.ok && e.note && h('div', { className: 'be-faint' }, e.note)));
    }

    function Overview({ toast, active }) {
      const st = useView('overview');
      // 切回概览时刷新（试看、她调用都会改用量和记录）
      const first = useRef(true);
      useEffect(() => { if (first.current) { first.current = false; return; } if (active) st.reload(); }, [active]);
      const [login, setLogin] = useState(null);
      useEffect(() => { if (st.data) setLogin(st.data.login); }, [st.data]);
      const clear = (which, label) => api.post('clearCache', { which }).then((r) => { toast(`${label}：清掉 ${r.cleared.files} 个文件（${fmtBytes(r.cleared.bytes)}）`); st.reload(); }, (e) => toast(e.message, true));
      return h(Loading, { state: st }, (d) => {
        const u = d.usage; const c = d.cache;
        const cacheRow = (key, label, s, extra) => h(React.Fragment, { key },
          h('div', null, h('div', null, label), h('div', { className: 'be-faint' }, s.dir ? `${s.files} 个文件${extra ?? ''}` : '默认位置（在「设置 → 路径」里指定后可以在这里管理）')),
          h('div', { className: 'be-row', style: { justifyContent: 'flex-end' } },
            h('span', { className: 'v' }, s.dir ? fmtBytes(s.bytes) : '—'),
            s.dir && h(ConfirmBtn, { label: '清理', confirmLabel: '确认？', onConfirm: () => clear(key, label) })));
        return h(React.Fragment, null,
          h('div', { className: 'be-grid' },
            login && h(LoginCard, { login, toast, onChange: (l) => { setLogin(l); st.reload(); } }),
            h(Card, { title: '这一小时' },
              h(Meter, { label: '新看的视频', used: u.watched, max: u.maxPerHour }),
              h(Meter, { label: '搜索', used: u.searched, max: u.maxFindPerHour }),
              u.running > 0 && h('div', null, h('span', { className: 'be-spin', style: { marginRight: 8 } }), `正在看 ${u.running > 1 ? `（还有 ${u.running - 1} 个排队）` : ''}`),
              h('div', { className: 'be-faint' }, '只统计 DSH 这次启动以来；缓存命中不算，放大看算在「新看」里。上限在「设置 → 限额」里改。')),
            h(Card, { title: '缓存' },
              h('div', { className: 'be-kv' },
                cacheRow('results', '看过的结果', { ...c.results, dir: c.results.dir }, `，保留 ${c.cacheHours} 小时`),
                cacheRow('storyboard', '分镜缓存', c.storyboard),
                cacheRow('media', '下载的视频', c.media, `，上限 ${fmtBytes(c.mediaMaxMb * 1048576)}`)),
              h('div', null, h(Btn, { onClick: () => api.post('openFolder', { which: 'data' }).then(() => toast('已在文件管理器里打开'), (e) => toast(e.message, true)) }, '打开数据文件夹')))),
          h(Card, { title: '状态检查', aside: `v${d.version}` },
            h('ul', { className: 'be-checks' }, d.checks.map((x) => h('li', { key: x.id, className: 'be-check' },
              h('span', { className: `be-dot ${x.ok ? 'ok' : x.optional ? 'opt' : 'bad'}` }, x.ok ? '✓' : x.optional ? '–' : '!'),
              h('div', null, h('div', null, x.label), x.hint && h('div', { className: 'be-faint' }, x.hint))))),
            h('div', null, h(Btn, { onClick: () => { st.reload(); toast('已刷新'); } }, '刷新'))),
          h(Card, { title: '最近看过', aside: d.history.length ? `最近 ${d.history.length} 条` : '' },
            d.history.length
              ? h('div', { className: 'be-hist' }, d.history.map((e, i) => h(HistoryRow, { key: `${e.at}-${i}`, e })))
              : h('div', { className: 'be-empty' }, '还没看过视频：在聊天里给她一个 B站链接，或者去「试看」页试一下。'),
            d.history.length > 0 && h('div', null, h(ConfirmBtn, { label: '清空记录', confirmLabel: '确认清空？', onConfirm: () => api.post('clearHistory').then(() => { toast('记录已清空'); st.reload(); }, (e) => toast(e.message, true)) }))));
      });
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
            ? h('div', { className: 'be-items' }, res.items.map((x) => h('div', { key: x.bvid, className: 'be-item' },
              h('a', { href: `https://www.bilibili.com/video/${x.bvid}`, target: '_blank', rel: 'noreferrer' }, x.title),
              h('div', { className: 'be-faint' }, `${x.author} · ${fmtDur(x.seconds)} · 播放 ${fmtNum(x.play)} · 弹幕 ${fmtNum(x.danmaku)}${x.pubdate ? ` · ${new Date(x.pubdate * 1000).toLocaleDateString()}` : ''}`))))
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

    function Settings({ toast }) {
      const st = useView('config');
      const [draft, setDraft] = useState(null);
      useEffect(() => { if (st.data) setDraft(st.data.config); }, [st.data]);
      return h(Loading, { state: st }, (d) => {
        if (!draft) return null;
        const fields = d.fields;
        const shown = (fld) => (fld.scale ? draft[fld.key] / fld.scale : draft[fld.key]);
        const setVal = (fld, v) => setDraft({ ...draft, [fld.key]: v });
        const save = (group, label) => {
          const patch = {};
          for (const fld of fields.filter((x) => x.group === group)) patch[fld.key] = draft[fld.key];
          api.post('saveConfig', { config: patch }).then((r) => { setDraft(r.config); toast(`${label}已保存，马上生效`); }, (e) => toast(e.message, true));
        };
        const reset = (group) => api.post('resetConfig', { group }).then((r) => { setDraft(r.config); toast('已恢复默认'); }, (e) => toast(e.message, true));
        return h(React.Fragment, null,
          GROUPS.map(([group, label, desc]) => {
            const list = fields.filter((x) => x.group === group);
            const dirty = list.some((x) => draft[x.key] !== d.config[x.key]);
            return h(Card, { key: group, title: label, desc, aside: dirty ? '有未保存的修改' : '' },
              h('div', { className: 'be-fields' }, list.map((fld) => {
                if (fld.type === 'bool') {
                  return h('div', { key: fld.key, className: 'be-field' },
                    h('label', { className: 'be-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(draft[fld.key]), onChange: (e) => setVal(fld, e.target.checked) }), fld.label),
                    fld.hint && h('small', null, fld.hint));
                }
                if (fld.type === 'dir' || fld.type === 'exe') return h(PathField, { key: fld.key, field: fld, value: draft[fld.key], onChange: (v) => setVal(fld, v) });
                const isDefault = draft[fld.key] === d.defaults[fld.key];
                return h(Field, { key: fld.key, label: fld.label, hint: [fld.hint, isDefault ? '' : `默认 ${fld.scale ? d.defaults[fld.key] / fld.scale : d.defaults[fld.key]}${fld.unit ?? ''}`].filter(Boolean).join('；') },
                  h('div', { className: 'be-unit' },
                    h('input', {
                      className: 'be-input', type: 'number', step: 1, value: shown(fld) ?? '',
                      min: fld.scale ? fld.min / fld.scale : fld.min, max: fld.scale ? fld.max / fld.scale : fld.max,
                      onChange: (e) => setVal(fld, e.target.value === '' ? '' : Math.round(Number(e.target.value) * (fld.scale || 1))),
                    }),
                    fld.unit && h('span', null, fld.unit)));
              })),
              h('div', { className: 'be-row' },
                h(Btn, { kind: 'primary', disabled: !dirty, onClick: () => save(group, label) }, '保存'),
                h(Btn, { onClick: () => reset(group) }, '恢复默认')));
          }),
          h('div', { className: 'be-faint' }, `保存后立即生效，不用重启 DSH。配置文件：${d.configFile}（只记和默认值不同的项）`));
      });
    }

    // ── 页面 ─────────────────────────────────────────────────────────────────
    const TABS = [['overview', '概览', Overview], ['try', '试看', Try], ['settings', '设置', Settings]];
    function BiliEyes() {
      const [tab, setTab] = useState(() => { try { return localStorage.getItem('dsh-bili-eyes:tab') || 'overview'; } catch { return 'overview'; } });
      const [msg, setMsg] = useState(null);
      const toast = useCallback((text, bad = false) => setMsg({ text, bad, at: Date.now() }), []);
      useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(null), msg.bad ? 6000 : 2500); return () => clearTimeout(t); }, [msg]);
      useEffect(() => { try { localStorage.setItem('dsh-bili-eyes:tab', tab); } catch { /* 忽略 */ } }, [tab]);
      return h('div', { className: 'be' },
        h('header', { className: 'be-head' }, h('h2', null, 'B站看视频'), h('p', null, '让模型看 B站视频、在 B站搜视频。只读，只认 B站链接；这里的改动立即生效。')),
        h('nav', { className: 'be-tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', className: 'be-tab', 'aria-selected': tab === id, onClick: () => setTab(id) }, label))),
        // 三个页签都挂着、只是隐藏：试看跑到一半切走再回来，结果还在
        TABS.map(([id, , Page]) => h('div', { key: id, hidden: tab !== id, style: { display: tab === id ? 'flex' : 'none', flexDirection: 'column', gap: 16 } }, h(Page, { toast, active: tab === id }))),
        msg && h('div', { className: `be-toast${msg.bad ? ' bad' : ''}`, role: 'status' }, msg.text));
    }

    const inject = ['slots'];
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-bili-eyes',
        order: 117,
        label: () => 'B站看视频',
        inject: () => ({}),
      }, BiliEyes));
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.BiliEyes = BiliEyes;
    return module.exports;
  },
});
