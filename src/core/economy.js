// Spending and inventory operations. All functions mutate the given state and return
// a result; callers run them on a cloned state inside a save transaction so a failed
// save leaves the live state untouched (see game.js `transact`).
import { BALANCE } from '../data/balance.js';
import { playerStats } from './stats.js';
import { dismantleValue, enhanceCost, mainScore } from './items.js';

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

export function addItems(state, items) {
  const stored = [], overflowed = [], converted = [];
  for (const it of items) {
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
  return { stored, overflowed, converted };
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

export function equip(state, id) {
  const it = findItem(state, id);
  if (!it) return { ok: false, reason: 'missing' };
  const prev = state.equipped[it.slot];
  state.equipped[it.slot] = id;
  it.isNew = false;
  state.progression.firsts.firstEquip ||= Date.now();
  return { ok: true, slot: it.slot, prev };
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
  for (const slot of EQ.slots) {
    const cur = state.equipped[slot] ? findItem(state, state.equipped[slot]) : null;
    let best = cur;
    for (const it of state.inventory) {
      if (it.slot !== slot) continue;
      if (!best || mainScore(it) > mainScore(best)) best = it;
    }
    if (best && best !== cur) out[slot] = best.id;
  }
  return out;
}
export function autoEquip(state) {
  const rec = recommend(state);
  for (const id of Object.values(rec)) equip(state, id);
  return { ok: Object.keys(rec).length > 0, changed: rec, reason: Object.keys(rec).length ? null : 'already-best' };
}

// ---------- enhance ----------
export function enhanceQuote(state, id) {
  const it = findItem(state, id);
  if (!it) return { ok: false, reason: 'missing' };
  if (it.enhance >= EQ.enhanceMax) return { ok: false, reason: 'max', item: it };
  const cost = enhanceCost(it);
  return { ok: state.wallet.ore >= cost, reason: state.wallet.ore >= cost ? null : 'ore', cost, shortfall: Math.max(0, cost - state.wallet.ore), item: it };
}
export function enhance(state, id) {
  const q = enhanceQuote(state, id);
  if (!q.ok) return q;
  state.wallet.ore -= q.cost;
  q.item.enhance += 1;               // MVP: success is guaranteed up to +10
  q.item.oreInvested += q.cost;
  state.progression.counters.enhances += 1;
  return { ok: true, cost: q.cost, item: q.item };
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
  const order = { common: 0, uncommon: 1, rare: 2 };
  return state.inventory.filter((i) => order[i.rarity] <= order[maxRarity] && !i.locked && !isEquipped(state, i.id) && (!slot || i.slot === slot)).map((i) => i.id);
}
