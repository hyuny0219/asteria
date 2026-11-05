// Shared pure helpers (no DOM). Used by the game and by node tests.

// mulberry32: small seeded PRNG; state is a uint32 kept in the save so runs are reproducible.
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = () => s;
  rng.range = (a, b) => a + (b - a) * rng();
  rng.int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.weighted = (table) => {
    const entries = Object.entries(table);
    const total = entries.reduce((s2, [, w]) => s2 + w, 0);
    let r = rng() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r < 0) return k;
    }
    return entries[entries.length - 1][0];
  };
  return rng;
}

export function hashString(str) {
  // FNV-1a 32-bit, used for save checksums and deterministic seeds
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function uid(prefix, rng) {
  const r = rng ? Math.floor(rng() * 0xffffffff) : Math.floor(Math.random() * 0xffffffff);
  return `${prefix}_${Date.now().toString(36)}_${r.toString(36)}`;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Number display per spec 08: <1000 integer; 1.28K / 1.28M / 1.28B; 999.995K rounds up to 1M.
export function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  let v = Math.abs(n);
  if (v < 1000) return (neg ? '-' : '') + Math.floor(v).toLocaleString('en-US');
  const units = ['K', 'M', 'B', 'T'];
  let u = -1;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  let r = Math.round(v * 100) / 100;
  if (r >= 1000 && u < units.length - 1) { r = 1; u++; }
  const s = r.toFixed(2).replace(/\.?0+$/, '');
  return (neg ? '-' : '') + s + units[u];
}
export const fmtFull = (n) => Math.floor(n).toLocaleString('en-US');
export function fmtPct(v, digits = 1) { return (v * 100).toFixed(digits).replace(/\.0+$/, '') + '%'; }
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${s}초`;
  return `${s}초`;
}

// Asia/Seoul calendar day (UTC+9, no DST). Returned as an integer day index.
export const KST_OFFSET_MS = 9 * 3600 * 1000;
export function kstDayIndex(ms) { return Math.floor((ms + KST_OFFSET_MS) / 86400000); }
export function nextKstMidnight(ms) { return (kstDayIndex(ms) + 1) * 86400000 - KST_OFFSET_MS; }

export function deepClone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}
