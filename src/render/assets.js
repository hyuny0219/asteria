import { MONSTERS, BOSSES, CLASSES } from '../data/content.js';
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

// Serin (warrior) has 8 key poses. Elena / Lira / Nox have one authored figure per
// costume (base, tier-1 branch), drawn static with the lunge/trail tweens.
// Costume for a branch at a tier: tier-3 / tier-2 figure when it exists, else tier 1.
export function promoKey(branch, tier = 1) {
  if (!branch || !meta) return null;
  for (let t = Math.min(3, Math.max(1, tier)); t >= 1; t--) {
    const k = t === 1 ? 'promo_' + branch : `promo_${branch}_t${t}`;
    if (meta.hero[k]) return k;
  }
  return null;
}
// Promoted forms animate with 8 key poses like the base forms: tier 1 from GPT A01
// (tools/extract_gpt_a01.py → pose_promo_<branch>_<pose>), tiers 2/3 from GPT A02
// (tools/extract_gpt_a02.py → pose_promo_<branch>_t<tier>_<pose>). A form without a
// pose sheet falls back to its single figure + tweens.
const POSE_NAMES = ['idle', 'step', 'anticipation', 'thrust', 'recovery', 'hit', 'cast', 'victory'];
export function promoPoses(branch, tier = 1) {
  if (!branch || !meta) return null;
  const k = promoKey(branch, tier);
  if (!k) return null;
  const t = k === 'promo_' + branch ? 1 : Number(k.slice(-1));
  const pre = t === 1 ? `pose_promo_${branch}_` : `pose_promo_${branch}_t${t}_`;
  const H = meta.hero;
  if (!H[pre + 'idle']) return null;
  const out = { promo: null };
  for (const n of POSE_NAMES) out[n] = H[pre + n] || H[pre + 'idle'];
  // GPT J4: walk 4 + basic attack 4 for tier-2/3 forms (cyc_<branch>_t<tier>_*)
  const cp = `cyc_${branch}_t${t}_`;
  if (t > 1 && H[cp + 'walk1']) out.cycle = { walk: [1, 2, 3, 4].map((i) => H[cp + 'walk' + i]), atk: [1, 2, 3, 4].map((i) => H[cp + 'atk' + i]) };
  return out;
}
export function heroFrames(branch, cls = 'warrior', tier = 1) {
  const H = meta.hero;
  const pp = promoPoses(branch, tier);
  if (pp) return pp;
  const art = CLASSES[cls] && CLASSES[cls].art;
  const pk = promoKey(branch, tier);
  if (art && H[art.base]) {
    const base = H[art.base];
    const promo = pk ? H[pk] : null;
    const f = promo || base;
    // base form: 8 key poses when extracted (tools/extract_poses_v4.py), like Serin
    const P = (k) => H[`pose_${cls}_${k}`];
    // GPT J3: walk cycle 4 + basic attack 4 (base form only)
    const C = (k) => H[`cyc_${cls}_${k}`];
    const cycle = C('walk1') ? { walk: [1, 2, 3, 4].map((i) => C('walk' + i)), atk: [1, 2, 3, 4].map((i) => C('atk' + i)) } : null;
    if (!promo && P('idle')) return { idle: P('idle'), step: P('step'), anticipation: P('anticipation'), thrust: P('thrust'), recovery: P('recovery'), hit: P('hit'), cast: P('cast'), victory: P('victory'), promo: null, cycle };
    return { idle: f, step: f, anticipation: f, thrust: f, recovery: f, hit: f, cast: f, victory: f, promo, static: true };
  }
  const W = (k) => H[`cyc_warrior_${k}`];   // GPT J3 세린 걷기·베기 (base form only)
  const cycle = !pk && W('walk1') ? { walk: [1, 2, 3, 4].map((i) => W('walk' + i)), atk: [1, 2, 3, 4].map((i) => W('atk' + i)) } : null;
  return { idle: H.idle, step: H.step, anticipation: H.anticipation, thrust: H.thrust, recovery: H.recovery, hit: H.hit, cast: H.cast, victory: H.victory, promo: pk ? H[pk] : null, cycle };
}
// Class portraits: face (192), card (3:4), illustration (2:3). Warrior = Serin's key art.
export function classPortrait(cls, kind) {
  const art = CLASSES[cls] && CLASSES[cls].art;
  if (art && meta.portraits[art[kind]]) return meta.portraits[art[kind]].file;
  return meta.portraits[kind === 'face' ? 'serin_face' : 'serin_key'].file;
}
export const petMeta = (id) => (meta.pets ? meta.pets[id] : null) || null;
export const petImage = (id) => (meta.pets && meta.pets[id] ? meta.pets[id].file : null);
export function enemyMeta(id) { return meta.monsters[id] || meta.bosses[id] || null; }
export function bgMeta(id) { return meta.backgrounds[id]; }
// GPT B effect sprite → loaded <img> + anchor, or null (callers fall back to vector FX).
export function fxSprite(name) { const f = meta && meta.fx && meta.fx[name]; if (!f) return null; const im = ready(f.file); if (!im) { loadImage(f.file); return null; } return { img: im, ...f }; }
export const itemIcon = (iconId) => meta.items[iconId].file;
export const skillIcon = (iconId) => meta.skills[iconId].file;
export const portrait = (id) => meta.portraits[id].file;

// New creatures reuse an existing sprite (content `sprite` field) until their art exists.
export function spriteFile(def) {
  const m = def && (meta.monsters[def.sprite] || meta.bosses[def.sprite] || meta.monsters[def.id] || meta.bosses[def.id]);
  return m ? m.file : null;
}
// static sprite + GPT C action frames (idle/attack/hit/dead) when the creature has them
export function spriteFiles(def) {
  const m = def && (meta.monsters[def.sprite] || meta.bosses[def.sprite] || meta.monsters[def.id] || meta.bosses[def.id]);
  if (!m) return [];
  return [m.file, ...(m.frames ? Object.values(m.frames).map((f) => f.file) : [])];
}
export function promoFrame(branch, tier = 1) { const k = promoKey(branch, tier); return k ? meta.hero[k] : null; }
// Transparent full figure for promotion screens (portraits mirror the hero entries).
export function promoPortrait(branch, tier = 1) { const k = promoKey(branch, tier); return k && meta.portraits[k] ? meta.portraits[k].file : null; }

export async function preloadFor({ region, boss, branch, cls = 'warrior', tier = 1, bg = null, monsters = MONSTERS, bosses = BOSSES, pet = null, allMonsters = false }) {
  const art = CLASSES[cls] && CLASSES[cls].art;
  // Serin's 8 poses (also used by the instructor projection) + this class's figure
  const list = Object.entries(meta.hero).filter(([k]) => !k.startsWith('promo_') && !k.startsWith('cls_') && !k.startsWith('pose_') && !k.startsWith('cyc_')).map(([, f]) => f.file);
  if (art && meta.hero[art.base]) list.push(meta.hero[art.base].file);
  for (const [k, f] of Object.entries(meta.hero)) if (k.startsWith(`pose_${cls}_`) || k.startsWith(`cyc_${cls}_`)) list.push(f.file);
  const pf = promoFrame(branch, tier);
  if (pf) list.push(pf.file);
  const pp = promoPoses(branch, tier);
  if (pp) for (const n of POSE_NAMES) list.push(pp[n].file);
  if (pp && pp.cycle) for (const f of [...pp.cycle.walk, ...pp.cycle.atk]) list.push(f.file);
  if (region) {
    const bg = meta.backgrounds[region.bg];
    if (bg) list.push(bg.file);
    for (const m of region.monsters) list.push(...spriteFiles(monsters ? monsters[m] : { id: m }));
    list.push(spriteFile(bosses ? bosses[region.boss] : { id: region.boss }));
  }
  if (boss) list.push(spriteFile(bosses ? bosses[boss] : { id: boss }));
  // rift / tower / dungeons draw monsters from other regions
  if (allMonsters && monsters) for (const m of Object.values(monsters)) list.push(...spriteFiles(m));
  if (pet && meta.pets && meta.pets[pet]) { list.push(meta.pets[pet].file); if (meta.pets[pet].frames) for (const f of Object.values(meta.pets[pet].frames)) list.push(f.file); }
  if (bg && meta.backgrounds[bg]) list.push(meta.backgrounds[bg].file);
  if (meta.fx) for (const f of Object.values(meta.fx)) list.push(f.file);   // GPT B projectiles / hits (~220 KB)
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
