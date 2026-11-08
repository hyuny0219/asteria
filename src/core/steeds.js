// v12 탈것 · 날개: own, level (food / feathers), star (shards from duplicates), equip, summon.
// state.mounts / state.wings = { owned: { id: { lv, star, shards } }, equipped: id|null, pity, draws }
import { MOUNTS, WINGS, STEED, STEED_GRADES } from '../data/steeds.js';

export const KINDS = Object.freeze({
  mount: { table: MOUNTS, key: 'mounts', mat: 'mountFood', ticket: 'mountTicket', name: '탈것', matName: '탈것 먹이' },
  wing: { table: WINGS, key: 'wings', mat: 'wingFeather', ticket: 'wingTicket', name: '날개', matName: '날개 깃털' },
});
export const defaultSteeds = () => ({ owned: {}, equipped: null, pity: 0, draws: 0 });
const box = (state, kind) => (state[KINDS[kind].key] ||= defaultSteeds());

export function give(state, kind, id) {
  const b = box(state, kind);
  if (!KINDS[kind].table[id]) return { ok: false, reason: 'missing' };
  if (b.owned[id]) { b.owned[id].shards += STEED.summon.dupShards; return { ok: true, dup: true }; }
  b.owned[id] = { lv: 1, star: 1, shards: 0 };
  if (!b.equipped) b.equipped = id;
  return { ok: true, dup: false };
}

// bonus of one owned steed: grade base (mount → hp+atk, wing → atk) + its fx, × level × star
export function steedBonus(kind, id, o) {
  const d = KINDS[kind].table[id];
  if (!d || !o) return {};
  const mul = (1 + STEED.levelPer * (o.lv - 1)) * STEED.starMul[o.star - 1];
  const base = STEED_GRADES[d.grade].base;
  const out = kind === 'mount' ? { hpPct: base * mul, atkPct: base * 0.5 * mul } : { atkPct: base * mul };
  for (const [k, v] of Object.entries(d.fx)) out[k] = (out[k] || 0) + v * mul;
  return out;
}
export function equippedBonus(state) {
  const out = {};
  for (const kind of ['mount', 'wing']) {
    const b = state[KINDS[kind].key];
    if (!b || !b.equipped) continue;
    for (const [k, v] of Object.entries(steedBonus(kind, b.equipped, b.owned[b.equipped]))) out[k] = (out[k] || 0) + v;
  }
  return out;
}

export function equip(state, kind, id) {
  const b = box(state, kind);
  if (!b.owned[id]) return { ok: false, reason: 'missing' };
  b.equipped = id;
  return { ok: true };
}

export function levelQuote(state, kind, id, steps) {
  const b = box(state, kind), o = b.owned[id];
  const have = state.wallet[KINDS[kind].mat] || 0;
  let lv = o.lv, cost = 0, n = 0;
  const want = steps === 'max' ? Infinity : steps;
  while (n < want && lv < STEED.maxLevel) {
    const c = STEED.levelCost(lv);
    if (steps === 'max' && cost + c > have) break;
    cost += c; lv++; n++;
  }
  return { from: o.lv, to: lv, steps: n, cost, have };
}
export function levelUp(state, kind, id, steps) {
  const b = box(state, kind), o = b.owned[id];
  if (!o) return { ok: false, reason: 'missing' };
  if (o.lv >= STEED.maxLevel) return { ok: false, reason: 'cap' };
  const q = levelQuote(state, kind, id, steps);
  const mat = KINDS[kind].mat;
  if (!q.steps || (state.wallet[mat] || 0) < q.cost) return { ok: false, reason: 'steed-mat' };
  state.wallet[mat] -= q.cost;
  o.lv = q.to;
  return { ok: true, ...q };
}
export const starCost = (o) => (o.star < 5 ? STEED.starShards[o.star - 1] : null);
export function starUp(state, kind, id) {
  const o = box(state, kind).owned[id];
  if (!o) return { ok: false, reason: 'missing' };
  const c = starCost(o);
  if (c === null) return { ok: false, reason: 'max' };
  if (o.shards < c) return { ok: false, reason: 'shards' };
  o.shards -= c; o.star += 1;
  return { ok: true, star: o.star };
}

// summon: tickets first, then gems (n = 1 or 10)
export function summonQuote(state, kind, n) {
  const S = STEED.summon, tk = KINDS[kind].ticket;
  const tickets = Math.min(state.wallet[tk] || 0, n);
  const rest = n - tickets;
  const gem = rest === 0 ? 0 : rest === 10 ? S.gem10 : rest * S.gem;
  return { n, tickets, ticketKey: tk, gem, ok: (state.wallet.gem || 0) >= gem, shortGem: Math.max(0, gem - (state.wallet.gem || 0)) };
}
export function summon(state, kind, n, rng) {
  if (n !== 1 && n !== 10) return { ok: false, reason: 'count' };
  const q = summonQuote(state, kind, n);
  if (!q.ok) return { ok: false, reason: 'gem', quote: q };
  state.wallet[q.ticketKey] = (state.wallet[q.ticketKey] || 0) - q.tickets;
  state.wallet.gem -= q.gem;
  const b = box(state, kind), T = KINDS[kind].table, S = STEED.summon;
  const results = [];
  for (let i = 0; i < n; i++) {
    b.pity += 1; b.draws += 1;
    let g = rng.weighted(S.rates);
    let pity = false;
    if (b.pity >= S.pity && g !== 'legendary' && g !== 'mythic') { g = 'legendary'; pity = true; }
    if (g === 'legendary' || g === 'mythic') b.pity = 0;
    const ids = Object.keys(T).filter((id) => T[id].grade === g);
    const id = ids[Math.floor(rng() * ids.length)];
    const r = give(state, kind, id);
    results.push({ id, grade: g, dup: r.dup, pity });
  }
  const mats = Math.round(S.mats10 * n / 10);
  state.wallet[KINDS[kind].mat] = (state.wallet[KINDS[kind].mat] || 0) + mats;
  return { ok: true, results, mats, quote: q };
}
// something to do: level-up affordable or a star ready
export function hasTodo(state, kind) {
  const b = state[KINDS[kind].key];
  if (!b) return false;
  const have = state.wallet[KINDS[kind].mat] || 0;
  return Object.values(b.owned).some((o) => (o.lv < STEED.maxLevel && have >= STEED.levelCost(o.lv)) || (o.star < 5 && o.shards >= STEED.starShards[o.star - 1]));
}
