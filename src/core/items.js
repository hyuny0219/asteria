// Equipment generation and per-item stat calculation (6 rarities, options, sets, +15).
import { BALANCE } from '../data/balance.js';
import { ITEM_LOOKS, RARITY, SLOT_NAMES, SETS } from '../data/content.js';

const EQ = BALANCE.equipment;
const LOOK_INDEX = { common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 2, mythic: 2 };
const OPTION_KEYS = Object.keys(EQ.options);

export function normalizeSlot(slot) { return slot === 'accessory' ? 'necklace' : slot; }

function rollOptions(rarity, rng) {
  const n = EQ.optionCount[rarity] || 0;
  const pool = [...OPTION_KEYS];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const [a, b] = EQ.options[k];
    out.push({ k, v: Math.round((a + (b - a) * rng()) * 1000) / 1000 });
  }
  if (rarity === 'mythic') out.push({ k: EQ.mythicUniques[Math.floor(rng() * EQ.mythicUniques.length)], v: 1, unique: true });
  return out;
}

export function makeItem(state, { slot, rarity, level, rng, source = 'drop', set = null }) {
  slot = normalizeSlot(slot);
  const look = ITEM_LOOKS[slot][LOOK_INDEX[rarity] ?? 0];
  const main = slot === 'weapon' || slot === 'gloves' ? 'atk' : slot === 'necklace' || slot === 'ring' ? (rng() < 0.5 ? 'atk' : 'crit') : 'hp';
  const id = `it${state.nextItemSeq++}`;
  const it = { id, slot, rarity, level, main, look: look.icon, name: look.name, enhance: 0, oreInvested: 0, locked: false, source, isNew: true, options: rollOptions(rarity, rng) };
  if (set && SETS[set] && ['helmet', 'armor', 'gloves', 'boots'].includes(slot)) { it.set = set; it.name = `${SETS[set].name}의 ${SLOT_NAMES[slot]}`; }
  if (look.iconPending) it.iconPending = true;
  return it;
}

export function rollRarity(rng, table) { return rng.weighted(table); }
export function rollSlot(rng) { return rng.pick(EQ.itemSlots); }

// Base stats of an item (before enhancement), scaled by level and rarity.
export function itemBaseStats(item) {
  const b = EQ.base[normalizeSlot(item.slot)];
  const m = EQ.rarityMultiplier[item.rarity] || 1;
  const out = {};
  const pick = item.slot === 'necklace' || item.slot === 'accessory' || item.slot === 'ring';
  for (const [stat, [base, per]] of Object.entries(b)) {
    if (pick && stat !== item.main) continue;
    out[stat] = (base + per * item.level) * m;
  }
  return out;
}

// Final flat stats: each enhance level adds +5% of the base.
export function itemStats(item) {
  const base = itemBaseStats(item);
  const mul = 1 + EQ.enhanceStatPerLevel * item.enhance;
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = k === 'crit' ? v * mul : Math.floor(v * mul);
  return out;
}
// Percent/utility options of an item: { atkPct: 0.05, ... } (uniques as 1).
export function itemOptions(item) {
  const out = {};
  for (const o of item.options || []) out[o.k] = (out[o.k] || 0) + o.v;
  return out;
}

// Main-stat score used by "추천 장착" (main stat + rough option value).
export function mainScore(item) {
  const s = itemStats(item);
  const o = itemOptions(item);
  let v;
  if (item.slot === 'weapon' || item.slot === 'gloves') v = s.atk + (s.def || 0) * 3;
  else if (item.main === 'crit') v = s.crit * 2500;
  else if (item.main === 'atk') v = s.atk;
  else v = (s.hp || 0) * 0.1 + (s.def || 0) * 3;
  const optVal = (o.atkPct || 0) * 400 + (o.critChance || 0) * 1500 + (o.critDmg || 0) * 300 + (o.aspd || 0) * 600 + (o.hpPct || 0) * 200 + (o.defPct || 0) * 120 + (o.cdr || 0) * 300 + (o.ultCharge || 0) * 100 + (o.goldPct || 0) * 50 + (o.mythUltCdr || 0) * 300 + (o.mythHeal || 0) * 200;
  return v * (1 + item.level / 200) + optVal * (1 + item.level / 50);
}

export function itemTitle(item) { return `${item.enhance ? '+' + item.enhance + ' ' : ''}${item.name}`; }
export function rarityLabel(r) { return `${RARITY[r].name} ${RARITY[r].mark}`; }
export function slotLabel(slot) { return SLOT_NAMES[slot]; }
export const rarityOrder = (r) => RARITY[r].order;

export function enhanceCost(item) {
  return Math.floor(EQ.enhanceCost.base * Math.pow(EQ.enhanceCost.growth, item.enhance) * (1 + rarityOrder(item.rarity) * 0.25));
}
export function enhanceChance(item) { return item.enhance >= EQ.enhanceMax ? 0 : EQ.enhanceSuccess[item.enhance]; }
export function dismantleValue(item) {
  return EQ.dismantle[item.rarity] + Math.floor(item.oreInvested * EQ.refundRate);
}
