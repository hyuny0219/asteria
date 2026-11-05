import { MONSTERS, BOSSES } from '../data/content.js';
// Runtime asset loader. Reads assets/runtime/sprites.json (written by
// tools/extract_assets.py). Images load on demand; only the active region,
// the hero and the current boss are preloaded (spec 02 §5: no full preload).
const cache = new Map();
let meta = null;

export async function loadMeta(base = '') {
  const res = await fetch(base + 'assets/runtime/sprites.json');
  if (!res.ok) throw new Error('sprites.json ' + res.status);
  meta = await res.json();
  return meta;
}
export const spriteMeta = () => meta;

export function loadImage(src) {
  if (cache.has(src)) return cache.get(src).promise;
  const img = new Image();
  img.decoding = 'async';
  const entry = { img, ok: false, failed: false, promise: null };
  entry.promise = new Promise((resolve) => {
    img.onload = () => { entry.ok = true; resolve(img); };
    img.onerror = () => { entry.failed = true; resolve(null); };
  });
  img.src = src;
  cache.set(src, entry);
  return entry.promise;
}
export function ready(src) { const e = cache.get(src); return e && e.ok ? e.img : null; }
export function failed(src) { const e = cache.get(src); return !!(e && e.failed); }

export function heroFrames(branch) {
  const H = meta.hero;
  return { idle: H.idle, step: H.step, anticipation: H.anticipation, thrust: H.thrust, recovery: H.recovery, hit: H.hit, cast: H.cast, victory: H.victory, promo: branch ? H['promo_' + branch] : null };
}
export function enemyMeta(id) { return meta.monsters[id] || meta.bosses[id] || null; }
export function bgMeta(id) { return meta.backgrounds[id]; }
export const itemIcon = (iconId) => meta.items[iconId].file;
export const skillIcon = (iconId) => meta.skills[iconId].file;
export const portrait = (id) => meta.portraits[id].file;

// New creatures reuse an existing sprite (content `sprite` field) until their art exists.
export function spriteFile(def) {
  const m = def && (meta.monsters[def.sprite] || meta.bosses[def.sprite] || meta.monsters[def.id] || meta.bosses[def.id]);
  return m ? m.file : null;
}
export function promoFrame(branch) { return branch && meta.hero['promo_' + branch] ? meta.hero['promo_' + branch] : null; }

export async function preloadFor({ region, boss, branch, monsters = MONSTERS, bosses = BOSSES }) {
  const list = Object.values(meta.hero).filter((f) => !f.id.startsWith('knight') && !f.id.startsWith('berserker')).map((f) => f.file);
  const pf = promoFrame(branch);
  if (pf) list.push(pf.file);
  if (region) {
    const bg = meta.backgrounds[region.bg];
    if (bg) list.push(bg.file);
    for (const m of region.monsters) list.push(spriteFile(monsters ? monsters[m] : { id: m }));
    list.push(spriteFile(bosses ? bosses[region.boss] : { id: region.boss }));
  }
  if (boss) list.push(spriteFile(bosses ? bosses[boss] : { id: boss }));
  await Promise.all(list.filter(Boolean).map(loadImage));
}

// Cache an image pre-scaled to its display size (avoids resampling big art every frame).
const scaled = new Map();
// `filter` (e.g. 'hue-rotate(90deg)') is baked into the cached bitmap once — placeholder
// tints for creatures/classes without their own art never run a filter per frame.
export function scaledImage(img, w, h, key, filter = '') {
  const k = key + ':' + w + 'x' + h + (filter ? ':' + filter : '');
  let c = scaled.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  if (filter) x.filter = filter;
  x.drawImage(img, 0, 0, c.width, c.height);
  x.filter = 'none';
  scaled.set(k, c);
  if (scaled.size > 200) scaled.delete(scaled.keys().next().value);
  return c;
}
// 2px outline version (elite marker), cached.
export function outlined(src, color, key) {
  const k = 'ol:' + key + color;
  let c = scaled.get(k);
  if (c) return c;
  const pad = 3;
  c = document.createElement('canvas');
  c.width = src.width + pad * 2; c.height = src.height + pad * 2;
  const x = c.getContext('2d');
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5]]) x.drawImage(src, pad + dx, pad + dy);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  x.drawImage(src, pad, pad);
  scaled.set(k, c);
  return c;
}
