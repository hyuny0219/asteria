// v10 장비·스킬 확장: 전설 고유 효과(+추출·이식), 스킬 각성, 장비·스킬 프리셋, 재련·등급 올리기.
// DOM-free; every mutation runs inside Game.transact.
import { AWAKEN, AWAKENINGS, EXTRACT, IMPRINT, ITEM_LEVEL, LOADOUT_DEFAULT_MAP, LOADOUT_NAMES, MYTHIC_MUL, RARITY_UP, REFORGE, UNIQUES } from '../data/gearplus.js';
import { BALANCE } from '../data/balance.js';
import { GRADE_BONUS, GRADE_EFFECT } from '../data/skillgrade.js';
import { SKILLS } from '../data/content.js';
import { lookFor, MYTHIC_UNIQUE_KEYS, rollLegend, rollOneOption } from './items.js';
import { hashString, kstDayIndex, makeRng } from './util.js';
import { returnJewels } from './crafting.js';

const EQ_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'];
const find = (s, id) => s.inventory.find((i) => i.id === id);
const isEquipped = (s, id) => Object.values(s.equipped).includes(id);
const hasLegendSlot = (it) => it && (it.rarity === 'legendary' || it.rarity === 'mythic');

// ---------- defaults / migration ----------
export function defaultGearPlus() { return { vault: {}, awakenDay: null, awakenFree: 1 }; }
export function defaultLoadouts() {
  return { list: LOADOUT_NAMES.map((name) => ({ name, saved: false, gear: {}, skills: [], runes: [] })), auto: false, map: { ...LOADOUT_DEFAULT_MAP } };
}
// Items found before v10: legendary/mythic get a deterministic 고유 효과 (seeded by the item id).
export function backfillLegends(state) {
  let n = 0;
  for (const it of [...(state.inventory || []), ...(state.overflow || [])]) {
    if (hasLegendSlot(it) && !it.legend) { it.legend = rollLegend(state.player.cls || 'warrior', makeRng(hashString('legend:' + it.id))); n++; }
  }
  return n;
}

// ---------- uniques ----------
export const legendValue = (it) => (it.legend ? it.legend.v * (it.rarity === 'mythic' ? MYTHIC_MUL : 1) : 0);
export function legendText(it) {
  if (!it || !it.legend || !UNIQUES[it.legend.id]) return null;
  const U = UNIQUES[it.legend.id];
  return { name: U.name, text: U.text(legendValue(it)), cls: U.cls };
}
export const uniqueText = (id, v) => UNIQUES[id].text(v);

// Merge skill-mod objects: additive keys add, multipliers multiply, flags OR, objects take the stronger.
const MUL = new Set(['coefMul', 'cdMul', 'dotMul']);
function mergeInto(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'pct') { dst.pct ||= {}; for (const [pk, pv] of Object.entries(v)) dst.pct[pk] = (dst.pct[pk] || 0) + pv; }
    else if (MUL.has(k)) dst[k] = (dst[k] || 1) * v;
    else if (typeof v === 'boolean') dst[k] = dst[k] || v;
    else if (typeof v === 'object') dst[k] = !dst[k] || (v.mul !== undefined && v.mul < dst[k].mul) || (v.coefPerSec || 0) > (dst[k].coefPerSec || 0) ? v : dst[k];
    else if (k === 'execute') dst[k] = Math.max(dst[k] || 0, v);
    else dst[k] = (dst[k] || 0) + v;
  }
}
// All skill mods for a loadout: equipped items' uniques + chosen awakenings.
export function skillMods(state, equipped = state.equipped) {
  const out = {};
  const add = (mods) => { for (const [sid, m] of Object.entries(mods)) { out[sid] ||= {}; mergeInto(out[sid], m); } };
  for (const id of Object.values(equipped)) {
    const it = id && find(state, id);
    if (it && it.legend && UNIQUES[it.legend.id]) add(UNIQUES[it.legend.id].mods(legendValue(it)));
  }
  // v11 스킬 등급: base multipliers + 전설/신화 bonus
  const gr = (state.skills && state.skills.grades) || {};
  for (const [sid, g] of Object.entries(gr)) {
    const e = GRADE_EFFECT[g];
    if (!e) continue;
    const m = {};
    if (e.coefMul !== 1) m.coefMul = e.coefMul;
    if (e.cdMul !== 1) m.cdMul = e.cdMul;
    const b = GRADE_BONUS[sid];
    if (b && (g === 'legendary' || g === 'mythic')) Object.assign(m, b[g]);
    if (Object.keys(m).length) add({ [sid]: m });
  }
  const aw = state.skills && state.skills.awaken;
  if (aw) for (const [sid, pick] of Object.entries(aw)) {
    const opt = AWAKENINGS[sid] && AWAKENINGS[sid][pick];
    if (opt && ((state.skills.levels || {})[sid] || 1) >= AWAKEN.needLevel) add({ [sid]: opt.mods });
  }
  return out;
}

// 추출: destroy a legendary/mythic (unlocked, not worn) and keep its effect in the vault (best value per id).
export function extractQuote(state, itemId) {
  const it = find(state, itemId);
  if (!it) return { ok: false, reason: 'missing' };
  if (!it.legend) return { ok: false, reason: 'no-legend' };
  if (it.locked || isEquipped(state, itemId)) return { ok: false, reason: 'protected' };
  const cur = state.gearPlus.vault[it.legend.id] || 0;
  return { ok: true, item: it, cost: { ...EXTRACT }, upgrade: it.legend.v > cur, current: cur };
}
export function extractLegend(state, itemId) {
  const q = extractQuote(state, itemId);
  if (!q.ok) return q;
  if (state.wallet.ore < EXTRACT.ore) return { ok: false, reason: 'ore' };
  if ((state.wallet.awakenStone || 0) < EXTRACT.awakenStone) return { ok: false, reason: 'awakenStone' };
  state.wallet.ore -= EXTRACT.ore;
  state.wallet.awakenStone -= EXTRACT.awakenStone;
  const { id, v } = q.item.legend;
  state.gearPlus.vault[id] = Math.max(state.gearPlus.vault[id] || 0, v);
  returnJewels(state, [q.item]);
  state.inventory = state.inventory.filter((i) => i.id !== itemId);
  return { ok: true, id, v: state.gearPlus.vault[id], improved: q.upgrade };
}
export function imprintCost(it) { return { ore: IMPRINT.ore, gold: IMPRINT.goldPerLevel * Math.max(1, it.level) }; }
// 이식: put a vault effect on a legendary/mythic item (replaces its effect). The vault entry stays.
export function imprintLegend(state, itemId, uid) {
  const it = find(state, itemId);
  if (!it) return { ok: false, reason: 'missing' };
  if (!hasLegendSlot(it)) return { ok: false, reason: 'rarity' };
  const v = state.gearPlus.vault[uid];
  if (!v) return { ok: false, reason: 'no-legend' };
  if (it.legend && it.legend.id === uid && it.legend.v >= v) return { ok: false, reason: 'same' };
  const c = imprintCost(it);
  if (state.wallet.ore < c.ore) return { ok: false, reason: 'ore' };
  if (state.wallet.gold < c.gold) return { ok: false, reason: 'gold' };
  state.wallet.ore -= c.ore;
  state.wallet.gold -= c.gold;
  const prev = it.legend;
  it.legend = { id: uid, v };
  return { ok: true, prev, legend: it.legend };
}

// ---------- 스킬 각성 ----------
export function awakenStatus(state, now) {
  const g = state.gearPlus;
  const day = kstDayIndex(now);
  return { free: g.awakenDay !== day ? 1 : g.awakenFree, gem: AWAKEN.changeGem };
}
export function setAwaken(state, skillId, pick, now) {
  if (!AWAKENINGS[skillId] || !AWAKENINGS[skillId][pick]) return { ok: false, reason: 'awaken' };
  if (((state.skills.levels || {})[skillId] || 1) < AWAKEN.needLevel) return { ok: false, reason: 'awaken-level' };
  state.skills.awaken ||= {};
  const cur = state.skills.awaken[skillId];
  if (cur === pick) return { ok: false, reason: 'same' };
  let paid = 0;
  if (cur !== undefined) {   // the first pick is free; changes use the daily free change, then gems
    const g = state.gearPlus;
    const day = kstDayIndex(now);
    if (g.awakenDay !== day) { g.awakenDay = day; g.awakenFree = 1; }
    if (g.awakenFree > 0) g.awakenFree--;
    else { if (state.wallet.gem < AWAKEN.changeGem) return { ok: false, reason: 'gem' }; state.wallet.gem -= AWAKEN.changeGem; paid = AWAKEN.changeGem; }
  }
  state.skills.awaken[skillId] = pick;
  return { ok: true, skill: skillId, pick, paid };
}

// ---------- 프리셋 ----------
export function saveLoadout(state, idx, name = null) {
  const L = state.loadouts.list[idx];
  if (!L) return { ok: false, reason: 'loadout' };
  L.gear = { ...state.equipped };
  L.skills = [...state.skills.equipped];
  L.runes = [...((state.skills.runes && state.skills.runes.equipped) || [])];
  L.saved = true;
  if (name) L.name = String(name).slice(0, 8);
  return { ok: true, idx };
}
export function renameLoadout(state, idx, name) {
  const L = state.loadouts.list[idx];
  const n = String(name || '').trim().slice(0, 8);
  if (!L || !n) return { ok: false, reason: 'loadout' };
  L.name = n;
  return { ok: true };
}
// What a preset resolves to right now: missing items (분해·이식) → empty, locked skills/runes dropped.
export function resolveLoadout(state, L, unlocked = null) {
  const equipped = {};
  const missing = [];
  const used = new Set();
  for (const k of EQ_SLOTS) {
    const id = L.gear[k];
    if (id && find(state, id) && !used.has(id)) { equipped[k] = id; used.add(id); }
    else { equipped[k] = null; if (id) missing.push(k); }
  }
  const skills = (L.skills || []).map((id) => (id && (!unlocked || unlocked.includes(id)) ? id : null));
  while (skills.length < 5) skills.push(null);
  const owned = (state.skills.runes && state.skills.runes.owned) || {};
  const runes = (L.runes || []).map((id) => (id && owned[id] ? id : null));
  return { equipped, skills, runes, missing };
}
export function applyLoadout(state, idx, unlocked) {
  const L = state.loadouts.list[idx];
  if (!L || !L.saved) return { ok: false, reason: 'loadout' };
  const r = resolveLoadout(state, L, unlocked);
  state.equipped = { ...state.equipped, ...r.equipped };
  const slots = state.skills.equipped.length;
  state.skills.equipped = r.skills.slice(0, slots).map((id, i) => id || state.skills.equipped[i] || null);
  if (state.skills.runes) state.skills.runes.equipped = r.runes.length ? r.runes : state.skills.runes.equipped;
  state.loadouts.current = idx;
  return { ok: true, missing: r.missing };
}
export function setLoadoutAuto(state, on, map = null) {
  state.loadouts.auto = !!on;
  if (map) for (const [k, v] of Object.entries(map)) if (k in state.loadouts.map && [0, 1, 2, -1].includes(v)) state.loadouts.map[k] = v;
  return { ok: true };
}
// The loadout a battle of `kind` should use (null → the gear actually worn).
export function loadoutFor(state, kind) {
  const L = state.loadouts;
  if (!L || !L.auto) return null;
  const idx = L.map[kind];
  const p = idx === undefined || idx < 0 ? null : L.list[idx];
  return p && p.saved ? p : null;
}

// ---------- 재련 ----------
export function reforgeCost(it) {
  const n = it.reforges || 0;
  return { ore: Math.floor(REFORGE.ore[it.rarity] * (1 + REFORGE.growth * n)), gold: Math.floor(REFORGE.goldPerLevel * Math.max(1, it.level) * (1 + n)) };
}
export function reforge(state, itemId, optIdx, rng) {
  const it = find(state, itemId);
  if (!it) return { ok: false, reason: 'missing' };
  const o = (it.options || [])[optIdx];
  if (!o || o.unique) return { ok: false, reason: 'option' };
  const c = reforgeCost(it);
  if (state.wallet.ore < c.ore) return { ok: false, reason: 'ore' };
  if (state.wallet.gold < c.gold) return { ok: false, reason: 'gold' };
  const keep = it.options.filter((x, i) => i !== optIdx && !x.unique).map((x) => x.k);
  const nu = rollOneOption(rng, keep);
  if (!nu) return { ok: false, reason: 'option' };
  state.wallet.ore -= c.ore;
  state.wallet.gold -= c.gold;
  const prev = { ...o };
  it.options[optIdx] = nu;
  it.reforges = (it.reforges || 0) + 1;
  return { ok: true, prev, next: nu, cost: c };
}

// ---------- 레벨 맞추기 ----------
export const itemLevelCap = (state) => state.player.level;
export function levelStepCost(it, L) { return { ore: Math.ceil(ITEM_LEVEL.ore[it.rarity] * (1 + L / 25)), gold: ITEM_LEVEL.gold[it.rarity] * L }; }
// steps: a number, or 'max' = as many as the wallet allows (never above the hero's level)
export function levelUpQuote(state, it, steps) {
  const cap = itemLevelCap(state);
  let lv = it.level, ore = 0, gold = 0, n = 0;
  const want = steps === 'max' ? Infinity : steps;
  while (n < want && lv < cap) {
    const c = levelStepCost(it, lv);
    if (steps === 'max' && (ore + c.ore > state.wallet.ore || gold + c.gold > state.wallet.gold)) break;
    ore += c.ore; gold += c.gold; lv++; n++;
  }
  return { from: it.level, to: lv, steps: n, ore, gold, cap };
}
export function levelUpItem(state, itemId, steps) {
  const it = find(state, itemId);
  if (!it) return { ok: false, reason: 'missing' };
  if (it.level >= itemLevelCap(state)) return { ok: false, reason: 'item-cap' };
  const q = levelUpQuote(state, it, steps);
  if (!q.steps) return { ok: false, reason: state.wallet.ore < levelStepCost(it, it.level).ore ? 'ore' : 'gold' };
  if (state.wallet.ore < q.ore) return { ok: false, reason: 'ore' };
  if (state.wallet.gold < q.gold) return { ok: false, reason: 'gold' };
  state.wallet.ore -= q.ore;
  state.wallet.gold -= q.gold;
  it.level = q.to;
  return { ok: true, ...q };
}

// ---------- 등급 올리기 ----------
export function rarityUpQuote(state, baseId, matIds) {
  const base = find(state, baseId);
  if (!base) return { ok: false, reason: 'missing' };
  const to = RARITY_UP.next[base.rarity];
  if (!to) return { ok: false, reason: 'max-rarity' };
  const ids = [...new Set(matIds)].filter((id) => id !== baseId);
  if (ids.length !== 2) return { ok: false, reason: 'materials' };
  const mats = ids.map((id) => find(state, id));
  for (const m of mats) {
    if (!m || m.slot !== base.slot || m.rarity !== base.rarity) return { ok: false, reason: 'materials' };
    if (m.locked || isEquipped(state, m.id)) return { ok: false, reason: 'protected' };
  }
  const cost = { ore: RARITY_UP.ore[to] || 0, starShard: RARITY_UP.starShard[to] || 0 };
  return { ok: true, base, mats, to, cost, level: Math.max(base.level, ...mats.map((m) => m.level)) };
}
export const rarityUpCandidates = (state, base) => state.inventory.filter((i) => i.id !== base.id && i.slot === base.slot && i.rarity === base.rarity && !i.locked && !isEquipped(state, i.id));
export function rarityUp(state, baseId, matIds, rng) {
  const q = rarityUpQuote(state, baseId, matIds);
  if (!q.ok) return q;
  if (state.wallet.ore < q.cost.ore) return { ok: false, reason: 'ore' };
  if ((state.wallet.starShard || 0) < q.cost.starShard) return { ok: false, reason: 'starShard' };
  state.wallet.ore -= q.cost.ore;
  state.wallet.starShard = (state.wallet.starShard || 0) - q.cost.starShard;
  const it = q.base;
  const from = it.rarity;
  it.rarity = q.to;
  it.level = q.level;
  const extra = rollOneOption(rng, (it.options || []).map((o) => o.k));
  if (extra) it.options.push(extra);
  if (q.to === 'mythic' && !it.options.some((o) => o.unique)) { const U = MYTHIC_UNIQUE_KEYS(); it.options.push({ k: U[Math.floor(rng() * U.length)], v: 1, unique: true }); }
  if ((q.to === 'legendary' || q.to === 'mythic') && !it.legend) it.legend = rollLegend(state.player.cls || 'warrior', rng);
  const look = lookFor(it.slot, it.rarity, state.player.cls || null);
  it.look = look.icon;
  if (!it.set) it.name = look.name;
  returnJewels(state, q.mats);
  const drop = new Set(q.mats.map((m) => m.id));
  state.inventory = state.inventory.filter((i) => !drop.has(i.id));
  return { ok: true, item: it, from, to: q.to, added: extra };
}

export { EQ_SLOTS as LOADOUT_SLOTS };
export const skillAwakenings = (id) => AWAKENINGS[id] || null;
export const isUltSkill = (id) => SKILLS[id] && SKILLS[id].kind === 'ultimate';
void BALANCE;
