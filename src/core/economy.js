// Spending and inventory operations. All functions mutate the given state and return
// a result; callers run them on a cloned state inside a save transaction so a failed
// save leaves the live state untouched (see game.js `transact`).
import { BALANCE } from '../data/balance.js';
import { playerStats } from './stats.js';
import { trackItem } from './meta.js';
import { dismantleValue, enhanceChance, enhanceCost, mainScore, rarityOrder } from './items.js';
import { CLASSES, STAT_KEYS, equipSlotFor } from '../data/content.js';
import { killRewards } from './combat.js';

const U = BALANCE.upgrade;
const C = BALANCE.combat;
const EQ = BALANCE.equipment;
export const UPGRADE_STATS = ['atk', 'hp', 'def', 'crit', 'speed'];

export function upgradeCost(stat, count) {
  return Math.ceil(U.baseCosts[stat] * Math.pow(U.costGrowth, count));
}

// How many more upgrades the cap allows (Infinity when uncapped).
export function upgradeRoom(state, stat) {
  const n = state.player.statsUpgrades[stat];
  if (stat === 'crit') {
    // cap applies to base + upgrades; equipment crit above the cap is ignored anyway
    const max = Math.floor((C.critChanceCap - C.critChance) / U.gains.crit + 1e-9);
    return Math.max(0, max - n);
  }
  if (stat === 'speed') {
    const max = Math.floor((C.attackSpeedCap - C.baseAttackPerSec) / U.gains.speed + 1e-9);
    return Math.max(0, max - n);
  }
  return Infinity;
}

// Quote for buying `want` upgrades (want = 1/10/100 or 'MAX'). Exact integer costs;
// display rounding never decides affordability.
export function quoteUpgrade(state, stat, want) {
  const gold = state.wallet.gold;
  const room = upgradeRoom(state, stat);
  const limit = want === 'MAX' ? Math.min(room, 100000) : Math.min(want, room);
  let n = state.player.statsUpgrades[stat];
  let count = 0, total = 0;
  while (count < limit) {
    const c = upgradeCost(stat, n);
    if (total + c > gold) break;
    total += c; n++; count++;
  }
  const nextCost = room > 0 ? upgradeCost(stat, state.player.statsUpgrades[stat] + count) : 0;
  // cost of the full requested amount (for "부족액")
  let wantTotal = 0;
  const wantN = want === 'MAX' ? Math.max(1, count) : Math.min(want, room);
  for (let i = 0, k = state.player.statsUpgrades[stat]; i < wantN; i++, k++) wantTotal += upgradeCost(stat, k);
  return {
    stat, want, count, total, room, capped: room === 0,
    shortfall: count === 0 && room > 0 ? upgradeCost(stat, state.player.statsUpgrades[stat]) - gold : Math.max(0, wantTotal - gold),
    partial: want !== 'MAX' && count > 0 && count < Math.min(want, room),
    nextCost,
  };
}

export function buyUpgrade(state, stat, want) {
  const q = quoteUpgrade(state, stat, want);
  if (q.capped) return { ok: false, reason: 'cap', quote: q };
  if (q.count === 0) return { ok: false, reason: 'gold', quote: q };
  const before = playerStats(state);
  state.wallet.gold -= q.total;
  state.player.statsUpgrades[stat] += q.count;
  state.progression.counters.upgrades += q.count;
  state.progression.firsts.firstUpgrade ||= Date.now();
  if (state.wallet.gold < 0) throw new Error('negative gold');
  return { ok: true, quote: q, before, after: playerStats(state) };
}

// ---------- inventory ----------
export function freeSlots(state) { return EQ.inventoryCapacity - state.inventory.length; }

const AUTO_DISMANTLE_MAX = { off: -1, common: 0, uncommon: 1, rare: 2 };

export function addItems(state, items) {
  const stored = [], overflowed = [], converted = [], autoDismantled = [];
  const autoMax = AUTO_DISMANTLE_MAX[state.settings.autoDismantle || 'off'] ?? -1;
  for (const it of items) {
    if (state.codex) trackItem(state, it);      // 장비 도감: counts even if auto-dismantled
    if (autoMax >= 0 && rarityOrder(it.rarity) <= autoMax && it.source !== 'gacha') {
      // auto-dismantle (setting): new drops only; never locked/equipped (they are new)
      const ore = dismantleValue(it);
      state.wallet.ore += ore;
      state.progression.counters.dismantled += 1;
      state.progression.counters.autoDismantledOre = (state.progression.counters.autoDismantledOre || 0) + ore;
      autoDismantled.push(it);
      continue;
    }
    if (state.inventory.length < EQ.inventoryCapacity) { state.inventory.push(it); stored.push(it); }
    else if (state.overflow.length < EQ.overflowCapacity) { state.overflow.push(it); overflowed.push(it); }
    else {
      // both full: convert to ore like the offline rule, and count it so the UI can show it
      const ore = dismantleValue(it);
      state.wallet.ore += ore;
      state.progression.counters.overflowConverted = (state.progression.counters.overflowConverted || 0) + 1;
      state.progression.counters.overflowConvertedOre = (state.progression.counters.overflowConvertedOre || 0) + ore;
      converted.push(it);
    }
  }
  return { stored, overflowed, converted, autoDismantled };
}

export function moveOverflow(state) {
  const moved = [];
  while (state.overflow.length && state.inventory.length < EQ.inventoryCapacity) {
    const it = state.overflow.shift();
    state.inventory.push(it); moved.push(it);
  }
  return { ok: moved.length > 0, moved, remaining: state.overflow.length, reason: moved.length ? null : 'full' };
}

const findItem = (state, id) => state.inventory.find((i) => i.id === id);
export const isEquipped = (state, id) => Object.values(state.equipped).includes(id);

// Rings fill ring1 then ring2 (or the given slot); everything else uses its own slot.
export function equip(state, id, toSlot = null) {
  const it = findItem(state, id);
  if (!it) return { ok: false, reason: 'missing' };
  const choices = equipSlotFor(it.slot);
  if (toSlot && !choices.includes(toSlot)) return { ok: false, reason: 'slot' };
  for (const k of choices) if (state.equipped[k] === id) state.equipped[k] = null;   // moving a ring
  const slot = toSlot || choices.find((k) => !state.equipped[k]) || choices[0];
  const prev = state.equipped[slot];
  state.equipped[slot] = id;
  it.isNew = false;
  state.progression.firsts.firstEquip ||= Date.now();
  return { ok: true, slot, prev };
}

export function unequip(state, slot) {
  if (!state.equipped[slot]) return { ok: false, reason: 'empty' };
  state.equipped[slot] = null;
  return { ok: true };
}

export function setLock(state, id, locked) {
  const it = findItem(state, id);
  if (!it) return { ok: false, reason: 'missing' };
  it.locked = locked;
  return { ok: true };
}

// Recommended equip per slot by main stat (labelled as such in the UI).
export function recommend(state) {
  const out = {};
  for (const itemSlot of EQ.itemSlots) {
    const slots = equipSlotFor(itemSlot);
    const ranked = state.inventory.filter((i) => i.slot === itemSlot).sort((a, b) => mainScore(b) - mainScore(a)).slice(0, slots.length);
    // keep items already worn when they are among the best (avoid ring1/ring2 swaps)
    const worn = slots.map((k) => state.equipped[k]);
    const want = ranked.map((i) => i.id);
    const free = slots.filter((k) => !want.includes(state.equipped[k]));
    const toPlace = want.filter((id) => !worn.includes(id));
    toPlace.forEach((id, i) => { if (free[i]) out[free[i]] = id; });
  }
  return out;
}
export function autoEquip(state) {
  const rec = recommend(state);
  for (const [slot, id] of Object.entries(rec)) equip(state, id, slot);
  return { ok: Object.keys(rec).length > 0, changed: rec, reason: Object.keys(rec).length ? null : 'already-best' };
}

// ---------- enhance (slot) ----------
// Enhancement belongs to the equip slot (weapon … ring1, ring2), not the item, so a
// swap keeps the level. Works on an empty slot too (the level waits for an item).
export const ENHANCE_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'];
export function enhanceQuote(state, slot) {
  if (!ENHANCE_SLOTS.includes(slot)) return { ok: false, reason: 'missing' };
  const lv = state.slotEnhance[slot] || 0;
  if (lv >= EQ.enhanceMax) return { ok: false, reason: 'max', slot, level: lv };
  const cost = enhanceCost(lv);
  return { ok: state.wallet.ore >= cost, reason: state.wallet.ore >= cost ? null : 'ore', slot, level: lv, cost, chance: enhanceChance(lv), dropOnFail: lv >= EQ.enhanceFailDropFrom, shortfall: Math.max(0, cost - state.wallet.ore) };
}
// +1..+5 always succeed; later levels can fail. At +11 or more a failure drops one level.
// Never destroyed. `rng` is the game RNG (deterministic per save).
export function enhance(state, slot, rng = Math.random) {
  const q = enhanceQuote(state, slot);
  if (!q.ok) return q;
  state.wallet.ore -= q.cost;
  state.slotEnhanceOre[slot] = (state.slotEnhanceOre[slot] || 0) + q.cost;
  state.progression.counters.enhances += 1;
  const before = q.level;
  const success = q.chance >= 1 || rng() < q.chance;
  let after = before;
  if (success) after += 1;
  else if (before >= EQ.enhanceFailDropFrom) after -= 1;
  state.slotEnhance[slot] = after;
  return { ok: true, success, chance: q.chance, before, after, cost: q.cost, slot };
}

// ---------- dismantle ----------
export function dismantleQuote(state, ids) {
  const items = [], blocked = [];
  for (const id of new Set(ids)) {
    const it = findItem(state, id);
    if (!it) continue;
    if (it.locked || isEquipped(state, id)) blocked.push(it); else items.push(it);
  }
  const ore = items.reduce((s, it) => s + dismantleValue(it), 0);
  const byRarity = items.reduce((m, it) => ((m[it.rarity] = (m[it.rarity] || 0) + 1), m), {});
  return { items, blocked, ore, byRarity, count: items.length };
}
export function dismantle(state, ids) {
  const q = dismantleQuote(state, ids);
  if (!q.count) return { ok: false, reason: q.blocked.length ? 'protected' : 'none', quote: q };
  const remove = new Set(q.items.map((i) => i.id));
  state.inventory = state.inventory.filter((i) => !remove.has(i.id));
  state.wallet.ore += q.ore;
  state.progression.counters.dismantled += q.count;
  moveOverflow(state);
  return { ok: true, quote: q };
}

// Bulk-select helper: everything at or below a rarity that is not equipped/locked.
export function selectForDismantle(state, maxRarity, slot = null) {
  return state.inventory.filter((i) => rarityOrder(i.rarity) <= rarityOrder(maxRarity) && !i.locked && !isEquipped(state, i.id) && (!slot || i.slot === slot)).map((i) => i.id);
}

// ---------- stat points ----------
export function statPointsTotal(state) { return (state.player.level - 1) * BALANCE.statPoints.perLevel; }
export function statPointsFree(state) {
  const used = STAT_KEYS.reduce((s, k) => s + (state.player.stats[k] || 0), 0);
  return statPointsTotal(state) - used;
}
// Spread free points by the class recommendation (largest remainder, deterministic).
export function applyAutoStats(state) {
  if (!state.player.statAuto) return 0;
  let free = statPointsFree(state);
  if (free <= 0) return 0;
  const w = CLASSES[state.player.cls || 'warrior'].autoStats;
  const keys = Object.keys(w);
  const total = keys.reduce((s, k) => s + w[k], 0);
  const n = free;
  let given = 0;
  // whole cycles first
  const cycles = Math.floor(n / total);
  for (const k of keys) { state.player.stats[k] += w[k] * cycles; given += w[k] * cycles; }
  let rest = n - given;
  for (const k of keys) { const g = Math.min(rest, w[k]); state.player.stats[k] += g; rest -= g; if (rest <= 0) break; }
  return n;
}
export function allocateStat(state, key, n = 1) {
  if (!STAT_KEYS.includes(key)) return { ok: false, reason: 'stat' };
  const free = statPointsFree(state);
  if (free <= 0) return { ok: false, reason: 'points' };
  const k = Math.min(free, Math.max(1, Math.floor(n)));
  state.player.stats[key] += k;
  state.player.statAuto = false;
  return { ok: true, added: k, free: free - k };
}
export function statResetCost(state) {
  return Math.floor(killRewards(state.player.level).gold * 20 * BALANCE.statPoints.resetCostGoldMinutes);
}
export function resetStats(state, { free = false } = {}) {
  const cost = free ? 0 : statResetCost(state);
  if (state.wallet.gold < cost) return { ok: false, reason: 'gold', cost };
  state.wallet.gold -= cost;
  for (const k of STAT_KEYS) state.player.stats[k] = 0;
  return { ok: true, cost, free: statPointsFree(state) };
}
export function setAutoStats(state, on) {
  state.player.statAuto = !!on;
  const given = on ? applyAutoStats(state) : 0;
  return { ok: true, given };
}
