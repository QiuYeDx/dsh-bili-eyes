// 一键下载 ffmpeg / ffprobe：没装 ffmpeg 的人在设置页点一下就能看视频。
//
// 来源是 npm 上的 @ffmpeg-installer/<平台> 和 @ffprobe-installer/<平台>（只是把官方静态构建打成 tgz），
// 先走 npmmirror，不通再走 npmjs。按 npm 元数据里的 sha512 校验，解压到 $DSH_HOME/tools/ffmpeg/bin ——
// dsh-video-storyboard 本来就会在这里找。不用 ffmpeg-static：它靠安装脚本下载，DSH 的 pnpm 默认不跑安装脚本。
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DSH_HOME } from './config.js';

export const TOOLS_BIN = path.join(DSH_HOME, 'tools', 'ffmpeg', 'bin');
const REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];
const PLATFORMS = new Set(['win32-x64', 'win32-ia32', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-ia32', 'linux-arm64', 'linux-arm']);
const MAX_BYTES = 150 * 1048576;
const exe = (name) => name + (process.platform === 'win32' ? '.exe' : '');

/** $DSH_HOME/tools/ffmpeg/bin 里已经有的话返回路径。 */
export function localBin(name) {
  const p = path.join(TOOLS_BIN, exe(name));
  return fs.existsSync(p) ? p : null;
}

/** 读 tar（ustar / GNU 长文件名都行），返回 [{name, data}]。只认普通文件。 */
export function untar(buf) {
  const out = [];
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const str = (a, b) => head.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    const prefix = str(345, 500);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const data = buf.subarray(off + 512, off + 512 + size);
    if (type === 'L') longName = data.toString('utf8').replace(/\0.*$/s, '');
    else if (type === '0' || type === '\0') out.push({ name, data: Buffer.from(data) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** npm 的 integrity（sha512-base64）对不对。 */
export function integrityOk(buf, integrity) {
  const m = /^sha512-(.+)$/.exec(String(integrity ?? '').trim().split(/\s+/)[0]);
  if (!m) return false;
  return crypto.createHash('sha512').update(buf).digest('base64') === m[1];
}

async function fetchBuf(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length')) || 0;
  if (len > MAX_BYTES) throw new Error('文件太大');
  return Buffer.from(await r.arrayBuffer());
}

/** 下载一个包里的可执行文件到 TOOLS_BIN。返回 {file, version, registry}。 */
async function fetchOne(pkg, name, onPhase) {
  const errors = [];
  for (const reg of REGISTRIES) {
    try {
      onPhase(`查 ${pkg}（${new URL(reg).host}）`);
      const meta = JSON.parse((await fetchBuf(`${reg}/${pkg.replace('/', '%2f')}`, 20_000)).toString('utf8'));
      const version = meta['dist-tags']?.latest;
      const dist = meta.versions?.[version]?.dist;
      if (!dist?.tarball || !dist?.integrity) throw new Error('元数据里没有下载地址或校验值');
      onPhase(`下载 ${pkg}@${version}（${dist.size ? `${(dist.size / 1048576).toFixed(0)} MB` : '大小未知'}）`);
      const tgz = await fetchBuf(dist.tarball, 300_000);
      if (!integrityOk(tgz, dist.integrity)) throw new Error('sha512 校验不通过');
      const entry = untar(zlib.gunzipSync(tgz)).find((e) => path.posix.basename(e.name) === exe(name));
      if (!entry) throw new Error(`包里没有 ${exe(name)}`);
      fs.mkdirSync(TOOLS_BIN, { recursive: true });
      const file = path.join(TOOLS_BIN, exe(name));
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, entry.data, { mode: 0o755 });
      fs.renameSync(tmp, file);
      return { file, version, registry: reg };
    } catch (e) { errors.push(`${new URL(reg).host}：${e.message}`); }
  }
  throw new Error(`${pkg} 下载失败（${errors.join('；')}）`);
}

function versionOf(file) {
  return new Promise((resolve, reject) => {
    execFile(file, ['-version'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error(`下载的 ${path.basename(file)} 跑不起来：${err.message}`));
      else resolve(String(stdout).split('\n')[0].match(/version (\S+)/)?.[1] ?? '?');
    });
  });
}

// 设置页轮询进度用
let state = { running: false, phase: '', error: '', done: null };
export function installState() { return { ...state, dir: TOOLS_BIN }; }

/** 开始下载（已经在下就不重复）。返回当前状态，进度用 installState() 查。 */
export function installFfmpeg() {
  if (state.running) return installState();
  const plat = `${process.platform}-${process.arch}`;
  if (!PLATFORMS.has(plat)) { state = { running: false, phase: '', error: `没有 ${plat} 平台的现成包，请自己装 ffmpeg`, done: null }; return installState(); }
  state = { running: true, phase: '准备', error: '', done: null };
  (async () => {
    const onPhase = (p) => { state.phase = p; };
    const a = await fetchOne(`@ffmpeg-installer/${plat}`, 'ffmpeg', onPhase);
    const b = await fetchOne(`@ffprobe-installer/${plat}`, 'ffprobe', onPhase);
    onPhase('检查能不能运行');
    const [va, vb] = [await versionOf(a.file), await versionOf(b.file)];
    state = { running: false, phase: '', error: '', done: { ffmpeg: va, ffprobe: vb, at: Date.now() } };
  })().catch((e) => { state = { running: false, phase: '', error: e.message, done: null }; });
  return installState();
}
