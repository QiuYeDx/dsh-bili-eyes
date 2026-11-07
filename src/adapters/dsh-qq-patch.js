// dsh-qq 桥接（h-D-ACE/dsh-qq）的三个补丁：设置页「一键适配」和作者自用的安装脚本都调这里，只有这一份。
//   1. 工具白名单：把本插件的工具按全名加进 qq-tool-restrict.mjs 的 SAFE_EXACT（不按前缀放行）
//   2. 分享卡片：桥接默认把 QQ 卡片显示成「[卡片消息]」，改成「[卡片·来源] 标题 链接」，模型才看得到链接
//   3. 报错：模型偶发的坏 JSON（MALFORMED_RESPONSE）只记日志，不往 QQ 群里发「AI 处理出错」
// 都是幂等的：已经打过就跳过，桥接升级后重新点一次会补上；找不到要改的那一行（桥接版本变了）就报出来，不硬改。
// 第一次改某个文件前备份成 <文件>.bak-bili-eyes（已有备份就不覆盖）。还原 = 把补丁去掉，换回原来那一行。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ALL_TOOLS } from '../tool-list.js';

export function bridgeFiles(dir) {
  return {
    restrict: path.join(dir, 'plugins', 'qq-agent-presets', 'qq-tool-restrict.mjs'),
    bridge: path.join(dir, 'src', 'bridge.js'),
  };
}

const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
function write(file, text) {
  const bak = `${file}.bak-bili-eyes`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, text);
}

// ── 1. 白名单 ─────────────────────────────────────────────────────────────
const MARK = '// bili-eyes patch';
const ANCHOR = "  'todo_write',";
function whitelist(src, tools) {
  const at = src.indexOf('const SAFE_EXACT = new Set([');
  const found = at >= 0 && src.indexOf(ANCHOR, at) >= 0;
  return { found, missing: found ? tools.filter((t) => !src.includes(`  '${t}', ${MARK}`)) : tools };
}

// ── 2. 分享卡片 ───────────────────────────────────────────────────────────
const CARD_ORIGINAL = "      case 'json': out.push('[卡片消息]'); break;";
// 认补丁时只看开头和结尾两行的固定部分：BEGIN 后面的说明文字换过，旧补丁也认得
const CARD_RE = /[ \t]*\/\/ ==== bili-eyes patch BEGIN[^\r\n]*\r?\n[\s\S]*?\/\/ ==== bili-eyes patch END/;
const cardPatch = (eol) => [
  '      // ==== bili-eyes patch BEGIN：分享卡片还原成「[卡片·来源] 标题 链接」（dsh-bili-eyes 一键适配）',
  "      case 'json': {",
  "        let card = '[卡片消息]';",
  '        try {',
  "          const j = typeof d.data === 'string' ? JSON.parse(d.data) : (d.data ?? {});",
  '          const m = Object.values(j?.meta ?? {})[0] ?? {};',
  '          const mini = Boolean(m.qqdocurl || m.appid);   // QQ 小程序卡片：title 是来源（哔哩哔哩），desc 是标题',
  "          const from = String((mini ? m.title : m.tag) || '').trim() || String(j?.prompt ?? '').match(/^\\[([^\\]]+)\\]/)?.[1] || '分享';",
  "          const title = String((mini ? m.desc : m.title) || '').replace(/\\s+/g, ' ').trim().slice(0, 80);",
  "          let url = String(m.qqdocurl || m.jumpUrl || m.url || '');",
  '          try {',
  '            const u = new URL(url);',
  '            for (const k of [...u.searchParams.keys()]) if (/^(share_.*|bbid|buvid|unique_k|spm_id_from|vd_source|timestamp|plat_id|mid|up_id|is_story_h5|from_spmid|ts)$/i.test(k)) u.searchParams.delete(k);',
  '            url = u.toString();',
  "          } catch { url = ''; }",
  "          if (title || url) card = `[卡片·${from}] ${title}${url ? ` ${url}` : ''}`.trim();",
  '        } catch { /* 解析不了就保持原样 */ }',
  '        out.push(card);',
  '        break;',
  '      }',
  '      // ==== bili-eyes patch END',
].join(eol);

// ── 3. 报错 ───────────────────────────────────────────────────────────────
const ERR_ORIGINAL = '    if (!silent) await sendToQQ(key, agentErrorUserText(d, { audited: shouldAuditKey(key) }));';
const ERR_PATCHED = "    if (!silent && d.code !== 'MALFORMED_RESPONSE') await sendToQQ(key, agentErrorUserText(d, { audited: shouldAuditKey(key) }));   // bili-eyes patch：模型偶发的坏 JSON 只记日志，不往 QQ 发";

const state = (src, patchedTest, original) => (patchedTest(src) ? 'patched' : src.includes(original) ? 'original' : 'unknown');

/** 三个补丁现在的状态。{ok, error?, whitelist:{found, missing}, card, errors}（card/errors：patched / original / unknown） */
export function patchStatus(dir) {
  const f = bridgeFiles(dir);
  if (!fs.existsSync(f.restrict) || !fs.existsSync(f.bridge)) return { ok: false, error: '这个目录不像 dsh-qq 桥接（找不到 src/bridge.js 或 qq-tool-restrict.mjs）' };
  const r = read(f.restrict); const b = read(f.bridge);
  return {
    ok: true,
    whitelist: whitelist(r, ALL_TOOLS),
    card: state(b, (s) => CARD_RE.test(s), CARD_ORIGINAL),
    errors: state(b, (s) => s.includes(ERR_PATCHED), ERR_ORIGINAL),
    // 桥接每次启动都重写 state/bridge.lock：比 bridge.js 旧，说明卡片、报错补丁打上之后还没重启过桥接
    staleBridge: (() => { try { return fs.statSync(path.join(dir, 'state', 'bridge.lock')).mtimeMs < fs.statSync(f.bridge).mtimeMs; } catch { return false; } })(),
  };
}

// ── 找桥接 ────────────────────────────────────────────────────────────────
// 没在门卫里填桥接目录的人（只想让她在群里看视频，没碰过门卫）也该知道补丁没打。
// dsh-qq 的会话默认开在 <桥接>/state/agents，所以从 DSH 会话的工作目录往上找。

export const isBridgeDir = (dir) => { const f = bridgeFiles(dir); return fs.existsSync(f.bridge) && fs.existsSync(f.restrict); };

/** 会话工作目录 → 它所在的 dsh-qq 桥接目录（往上找几层），不是就返回 '' */
export function bridgeDirOf(cwd) {
  if (!cwd) return '';
  let d = path.resolve(String(cwd));
  for (let i = 0; i < 4; i += 1) {
    if (isBridgeDir(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return '';
}

/** 一个会话日志的第一行（会话头，里面有 cwd）。.zstd 是一串独立的帧，只解第一帧 */
function sessionHead(file) {
  try {
    let text;
    if (file.endsWith('.zstd')) {
      if (typeof zlib.zstdDecompressSync !== 'function') return null;
      const buf = fs.readFileSync(file);
      const next = buf.indexOf(ZSTD_MAGIC, 4);
      text = zlib.zstdDecompressSync(next > 0 ? buf.subarray(0, next) : buf).toString('utf8');
    } else {
      const fd = fs.openSync(file, 'r');
      try { const b = Buffer.alloc(4096); text = b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)).toString('utf8'); } finally { fs.closeSync(fd); }
    }
    return JSON.parse(text.split('\n')[0]);
  } catch { return null; }
}
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * DSH 会话里出现过的 dsh-qq 桥接目录。sessions 是 DSH 的会话目录（<DSH_HOME>/sessions）：
 * 每个项目目录（按工作目录分）只读一个会话的会话头。extra 是另外知道的工作目录（比如最近判定过的会话）。
 */
export function findBridgeDirs(sessions, extra = []) {
  const cwds = new Set(extra.filter(Boolean));
  let projects = [];
  try { projects = fs.readdirSync(sessions, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch { /* 没有会话目录 */ }
  for (const p of projects.slice(0, 200)) {
    try {
      const dir = path.join(sessions, p.name);
      const one = fs.readdirSync(dir, { withFileTypes: true }).find((x) => x.isDirectory());
      if (!one) continue;
      const file = fs.readdirSync(path.join(dir, one.name)).filter((x) => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(x)).sort().pop();
      const head = file && sessionHead(path.join(dir, one.name, file));
      if (head?.cwd) cwds.add(head.cwd);
    } catch { /* 读不了就跳过 */ }
  }
  const out = new Set();
  for (const c of cwds) { const b = bridgeDirOf(c); if (b) out.add(b); }
  return [...out];
}

/** 打补丁（revert=true 时还原）。返回每一项做了什么：[{item, result, text}]，result：done / skip / fail。 */
export function applyPatches(dir, { revert = false, tools = ALL_TOOLS } = {}) {
  const f = bridgeFiles(dir);
  const st = patchStatus(dir);
  if (!st.ok) throw new Error(st.error);
  const out = [];
  // 1. 白名单
  {
    let src = read(f.restrict); const eol = eolOf(src);
    if (revert) {
      if (src.includes(MARK)) { write(f.restrict, src.split(eol).filter((l) => !l.includes(MARK)).join(eol)); out.push({ item: 'whitelist', result: 'done', text: '白名单：已移除本插件的工具' }); }
      else out.push({ item: 'whitelist', result: 'skip', text: '白名单：本来就没有' });
    } else {
      const w = whitelist(src, tools);
      if (!w.found) out.push({ item: 'whitelist', result: 'fail', text: '白名单：没找到 SAFE_EXACT，桥接版本变了，要手工把工具名加进 qq-tool-restrict.mjs' });
      else if (!w.missing.length) out.push({ item: 'whitelist', result: 'skip', text: '白名单：已经都在' });
      else {
        const at = src.indexOf(ANCHOR, src.indexOf('const SAFE_EXACT = new Set([')) + ANCHOR.length;
        src = src.slice(0, at) + w.missing.map((t) => `${eol}  '${t}', ${MARK}：B站工具（dsh-bili-eyes；写操作由插件按主人设置和门卫把关）`).join('') + src.slice(at);
        write(f.restrict, src);
        out.push({ item: 'whitelist', result: 'done', text: `白名单：加入 ${w.missing.join('、')}` });
      }
    }
  }
  // 2. 卡片、3. 报错（同一个文件，依次改）
  {
    let src = read(f.bridge); const eol = eolOf(src); let changed = false;
    if (revert) {
      if (CARD_RE.test(src)) { src = src.replace(CARD_RE, CARD_ORIGINAL); changed = true; out.push({ item: 'card', result: 'done', text: '卡片：已还原' }); }
      else out.push({ item: 'card', result: 'skip', text: '卡片：本来就是原样' });
      if (src.includes(ERR_PATCHED)) { src = src.replace(ERR_PATCHED, ERR_ORIGINAL); changed = true; out.push({ item: 'errors', result: 'done', text: '报错：已还原' }); }
      else out.push({ item: 'errors', result: 'skip', text: '报错：本来就是原样' });
    } else {
      if (CARD_RE.test(src)) {
        const next = src.replace(CARD_RE, cardPatch(eol));
        if (next !== src) { src = next; changed = true; out.push({ item: 'card', result: 'done', text: '卡片：补丁更新到最新' }); }
        else out.push({ item: 'card', result: 'skip', text: '卡片：已经打过' });
      } else if (src.includes(CARD_ORIGINAL)) { src = src.replace(CARD_ORIGINAL, cardPatch(eol)); changed = true; out.push({ item: 'card', result: 'done', text: '卡片：已打补丁' }); }
      else out.push({ item: 'card', result: 'fail', text: '卡片：没找到要改的那一行，桥接版本变了，跳过' });
      if (src.includes(ERR_PATCHED)) out.push({ item: 'errors', result: 'skip', text: '报错：已经打过' });
      else if (src.includes(ERR_ORIGINAL)) { src = src.replace(ERR_ORIGINAL, ERR_PATCHED); changed = true; out.push({ item: 'errors', result: 'done', text: '报错：已打补丁' }); }
      else out.push({ item: 'errors', result: 'fail', text: '报错：没找到要改的那一行，桥接版本变了，跳过' });
    }
    if (changed) write(f.bridge, src);
  }
  return out;
}

const sameDir = (a, b) => {
  const n = (x) => path.resolve(String(x)).replace(/[\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/**
 * 设置页「安装检查」的一条：这个 dsh-qq 桥接的补丁打没打。configuredDir 是门卫里填的桥接目录。
 * 卡片没打（她只看到「[卡片消息]」）、白名单缺工具、打了没重启算要紧；只差「偶发报错不发群里」算可选。
 */
export function patchCheck(dir, configuredDir, st = patchStatus(dir)) {
  const where = `dsh-qq 桥接（${dir}）`;
  if (!st.ok) return { id: `dshqq:${dir}`, ok: false, optional: true, label: `${where}：${st.error}`, hint: '' };
  const severe = []; const minor = [];
  if (!st.whitelist.found) severe.push('桥接版本变了，找不到工具白名单（SAFE_EXACT）');
  else if (st.whitelist.missing.length) severe.push(`工具白名单缺 ${st.whitelist.missing.length} 个，QQ 里她用不了 ${st.whitelist.missing.slice(0, 4).join('、')}${st.whitelist.missing.length > 4 ? ' 等' : ''}`);
  if (st.card === 'original') severe.push('分享卡片补丁没打：群里有人发 B站分享卡片时她只看到「[卡片消息]」，拿不到链接');
  else if (st.card === 'unknown') severe.push('桥接版本变了，分享卡片补丁认不出');
  if (st.errors === 'original') minor.push('偶发报错补丁没打：模型偶尔出错时群里会收到「AI 处理出错」');
  else if (st.errors === 'unknown') minor.push('桥接版本变了，偶发报错补丁认不出');
  const onlyRestart = !severe.length && !minor.length && st.staleBridge;
  if (onlyRestart) severe.push('补丁打上了，但桥接还是改之前启动的，卡片还是「[卡片消息]」');
  const problems = [...severe, ...minor];
  if (!problems.length) return { id: `dshqq:${dir}`, ok: true, label: `${where}：补丁都打上了` };
  const configured = configuredDir && sameDir(configuredDir, dir);
  const hint = onlyRestart ? '在桥接的控制中心重启一次桥接'
    : configured ? '去「收件箱 → 设置 → 门卫」点「一键适配」，再在桥接的控制中心重启桥接'
      : `去「收件箱 → 设置 → 门卫」：门卫来源选「dsh-qq」、桥接目录填 ${dir}，保存后点「一键适配」，再在桥接的控制中心重启桥接`;
  return { id: `dshqq:${dir}`, ok: false, optional: !severe.length, label: `${where}：${problems.join('；')}`, hint, go: onlyRestart ? null : ['inbox', 'settings'] };
}
