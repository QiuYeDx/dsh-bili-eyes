// 语音识别的配置：设置页读写 $DSH_HOME/asr.json（dsh-video-storyboard 的约定，看视频时没字幕就用它转写台词）。
//   硅基流动：https://api.siliconflow.cn/v1 + FunAudioLLM/SenseVoiceSmall，填一个 API Key 就能用
//   本机 / 自建：任何 OpenAI 兼容的 /audio/transcriptions 服务（SenseVoice、FunASR、whisper…），可选「用到时自动启动」的命令
// 写回时保留文件里本页不管的字段（hotwords、terms、manage 的其他项…）。API Key 永远不返回给页面，只说有没有。
import fs from 'node:fs';
import path from 'node:path';
import { DSH_HOME } from './config.js';

export const ASR_FILE = path.join(DSH_HOME, 'asr.json');
export const SILICONFLOW = { baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' };

function readRaw(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); return j && typeof j === 'object' ? j : {}; } catch { return null; }
}

const isLocal = (u) => { try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(u).hostname); } catch { return false; } };

/** 给页面看的配置（不含 key）。 */
export function asrView(file = ASR_FILE) {
  const raw = readRaw(file);
  if (!raw) return { file, configured: false, mode: 'none' };
  const baseUrl = String(raw.baseUrl ?? '');
  return {
    file,
    configured: Boolean(baseUrl) && (Boolean(raw.key) || isLocal(baseUrl)),
    mode: /siliconflow\.cn/i.test(baseUrl) ? 'siliconflow' : baseUrl ? 'custom' : 'none',
    baseUrl, model: String(raw.model ?? ''), language: String(raw.language ?? 'zh'),
    hasKey: Boolean(raw.key),
    start: Array.isArray(raw.manage?.start) ? raw.manage.start : [],
    hotwords: String(raw.hotwords ?? ''),
  };
}

/**
 * 保存。mode：siliconflow / custom。key 留空 = 保持原来的；start 是数组（空数组 = 不自动启动）。
 * 返回新的 asrView。
 */
export function saveAsr({ mode, baseUrl, model, key, language, start }, file = ASR_FILE) {
  const prev = readRaw(file) ?? {};
  const next = { ...prev };
  if (mode === 'siliconflow') {
    Object.assign(next, SILICONFLOW);
    if (!key && !prev.key) throw new Error('硅基流动要填 API Key');
    delete next.manage;   // 云端不用启动本机服务
  } else if (mode === 'custom') {
    let u;
    try { u = new URL(String(baseUrl ?? '').trim()); } catch { throw new Error('服务地址要是 http(s) 网址，比如 http://127.0.0.1:8000/v1'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('服务地址要是 http(s) 网址');
    next.baseUrl = u.href.replace(/\/$/, '');
    if (!String(model ?? '').trim()) throw new Error('要填模型名（服务端认的那个）');
    next.model = String(model).trim();
    const cmd = Array.isArray(start) ? start.map(String).filter(Boolean) : [];
    if (cmd.length) next.manage = { waitMs: 90_000, idleMs: 600_000, ...(prev.manage ?? {}), start: cmd };
    else delete next.manage;
  } else throw new Error('不认识的方式');
  if (key) next.key = String(key).trim();
  next.language = String(language || prev.language || 'zh');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
  fs.renameSync(tmp, file);
  return asrView(file);
}

/** 清除配置：改名成 asr.json.bak（不直接删，要恢复改回来就行）。 */
export function clearAsr(file = ASR_FILE) {
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.bak`);
  return asrView(file);
}

/** 1 秒静音的 16kHz 单声道 wav：只用来测服务连不连得上、key 对不对。 */
export function silentWav(seconds = 1, rate = 16000) {
  const n = seconds * rate; const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/** 测一下：发 1 秒静音去转写。返回 {ok, ms, message}。 */
export async function testAsr({ file = ASR_FILE, fetchImpl = fetch } = {}) {
  const raw = readRaw(file);
  if (!raw?.baseUrl) return { ok: false, message: '还没配置' };
  const form = new FormData();
  form.append('file', new Blob([silentWav()], { type: 'audio/wav' }), 'test.wav');
  form.append('model', String(raw.model ?? ''));
  const t = Date.now();
  try {
    const r = await fetchImpl(`${String(raw.baseUrl).replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', body: form, headers: raw.key ? { authorization: `Bearer ${raw.key}` } : {}, signal: AbortSignal.timeout(30_000) });
    const ms = Date.now() - t;
    if (r.status === 401 || r.status === 403) return { ok: false, ms, message: 'API Key 不对（服务拒绝了）' };
    if (!r.ok) return { ok: false, ms, message: `服务返回 HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 120)}` };
    return { ok: true, ms, message: '连得上，转写接口能用' };
  } catch (e) {
    const local = isLocal(raw.baseUrl);
    if (local && raw.manage?.start) return { ok: false, ms: Date.now() - t, message: '本机服务现在没开（配置了自动启动：看到没字幕的视频时会自己拉起，这里不会去启动它）' };
    return { ok: false, ms: Date.now() - t, message: `连不上：${e?.cause?.code ?? e?.message ?? e}` };
  }
}
