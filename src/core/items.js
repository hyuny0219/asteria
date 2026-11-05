// Equipment generation and per-item stat calculation.
import { BALANCE } from '../data/balance.js';
import { ITEM_LOOKS, RARITY, SLOT_NAMES } from '../data/content.js';

const EQ = BALANCE.equipment;
const LOOK_BY_RARITY = { common: 0, uncommon: 1, rare: 2 };

export function makeItem(state, { slot, rarity, level, rng, source = 'drop' }) {
  const look = ITEM_LOOKS[slot][LOOK_BY_RARITY[rarity]];
  // accessory rolls ATK or CRIT as its main stat
  const main = slot === 'weapon' ? 'atk' : slot === 'accessory' ? (rng() < 0.5 ? 'atk' : 'crit') : 'hp';
  const id = `it${state.nextItemSeq++}`;
  return { id, slot, rarity, level, main, look: look.icon, name: look.name, enhance: 0, oreInvested: 0, locked: false, source, isNew: true };
}

export function rollRarity(rng, table) { return rng.weighted(table); }
export function rollSlot(rng) { return rng.pick(EQ.slots); }

// Base stats of an item (before enhancement), scaled by level and rarity.
export function itemBaseStats(item) {
  const b = EQ.base[item.slot];
  const m = EQ.rarityMultiplier[item.rarity];
  const out = {};
  for (const [stat, [base, per]] of Object.entries(b)) {
    if (item.slot === 'accessory' && stat !== item.main) continue;
    out[stat] = (base + per * item.level) * m;
  }
  return out;
}

// Final stats: each enhance level adds +5% of the base (additive, applies to all stats on the item).
export function itemStats(item) {
  const base = itemBaseStats(item);
  const mul = 1 + EQ.enhanceStatPerLevel * item.enhance;
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = k === 'crit' ? v * mul : Math.floor(v * mul);
  return out;
}

// Main-stat score used by "추천 장착" (explicitly main-stat based, not DPS-optimal).
export function mainScore(item) {
  const s = itemStats(item);
  if (item.slot === 'weapon') return s.atk;
  if (item.slot === 'accessory') return item.main === 'crit' ? s.crit * 2500 : s.atk; // 1% crit ~ 25 ATK for ranking only
  return (s.hp || 0) + (s.def || 0) * 10;
}

export function itemTitle(item) {
  return `${item.enhance ? '+' + item.enhance + ' ' : ''}${item.name}`;
}
export function rarityLabel(r) { return `${RARITY[r].name} ${RARITY[r].mark}`; }
export function slotLabel(slot) { return SLOT_NAMES[slot]; }

export function enhanceCost(item) {
  return Math.floor(EQ.enhanceCost.base * Math.pow(EQ.enhanceCost.growth, item.enhance));
}
export function dismantleValue(item) {
  return EQ.dismantle[item.rarity] + Math.floor(item.oreInvested * EQ.refundRate);
}
