// 对谁：一次写操作算对自己人、主人评论区里的别人，还是外面的人（权限表的列）。
// 由插件按 B站上的事实判断（视频是谁投的、被回的那条是谁发的），不听模型怎么说。见 docs/权限-设计.md。
import { isFriend } from './config.js';

// ── 对谁 ──────────────────────────────────────────────────────────────────
// 由插件按 B站上的事实判断（视频是谁投的、被回的那条是谁发的），不听模型怎么说。见 docs/权限-设计.md。
const upCache = new Map();   // aid → UP 主 UID
/** 视频是谁投的（aid）。查不到返回 0。 */
export async function videoUp(client, aid) {
  const k = String(aid);
  if (upCache.has(k)) return upCache.get(k);
  const mid = await client.view({ aid: Number(aid) }).then((v) => Number(v?.owner?.mid) || 0, () => 0);
  if (mid) { upCache.set(k, mid); if (upCache.size > 500) upCache.delete(upCache.keys().next().value); }
  return mid;
}
/** 视频本身算谁的：自己人投的 → own，别的 → out。 */
export const videoAudience = (cfg, upMid) => (isFriend(cfg, upMid) ? 'own' : 'out');
/**
 * 回复算对谁：被回的人是自己人 → own；否则看在哪：自己人的投稿下 → home，别处 → out。
 * 被回的人不知道时（mid=0），能套上的几格都给出去，按最严的算；在哪也不知道时（upMid=null）同理。
 */
export function replyAudience(cfg, { mid, upMid }) {
  if (isFriend(cfg, mid)) return 'own';
  const place = upMid == null ? ['home', 'out'] : [isFriend(cfg, upMid) ? 'home' : 'out'];
  return mid ? (place.length === 1 ? place[0] : place) : ['own', ...place];
}
