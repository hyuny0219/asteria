// Draws (뽑기). In-game currency only: tickets first, then gems. No real payment, no ads,
// no character gacha. Rates are published (rateTable) and include the summon level.
// Pity: equipment legendary+ on the 200th draw without one; skill rune on the 100th.
import { BALANCE } from '../data/balance.js';
import { CLASS_SKILLS, RUNES } from '../data/content.js';
import { makeItem, rollSlot } from './items.js';
import { unlockedSkills } from './progression.js';

const GE = BALANCE.gacha.equipment;
const GS = BALANCE.gacha.skill;
const RARS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export function summonLevel(draws) {
  let lv = 1;
  GE.levelAt.forEach((n, i) => { if (draws >= n) lv = i + 1; });
  return lv;
}
export function nextLevelAt(draws) { const n = GE.levelAt.find((x) => x > draws); return n ?? null; }

// Published equipment rates for a summon level (sum = 1).
export function rateTable(level) {
  const out = {};
  for (const r of RARS) out[r] = Math.max(0, GE.rates[r] + GE.levelShift[r] * (level - 1));
  const sum = RARS.reduce((s, r) => s + out[r], 0);
  for (const r of RARS) out[r] /= sum;
  return out;
}
export const skillRateTable = () => ({ ...GS.rates });

// Payment: use tickets first, then gems for the rest. 11-draw with gems costs gem11.
export function quoteDraw(state, kind, n) {
  const w = state.wallet;
  const cfg = kind === 'equipment' ? GE : GS;
  const tk = kind === 'equipment' ? 'eqTicket' : 'skTicket';
  const tickets = Math.min(w[tk] || 0, n);
  const rest = n - tickets;
  const gem = rest === 0 ? 0 : rest === 11 ? cfg.cost.gem11 : rest * cfg.cost.gem;
  return { n, tickets, ticketKey: tk, gem, ok: w.gem >= gem, shortGem: Math.max(0, gem - w.gem) };
}

function pay(state, q) {
  if (!q.ok) return false;
  state.wallet[q.ticketKey] -= q.tickets;
  state.wallet.gem -= q.gem;
  return true;
}

export function drawEquipment(state, n, rng) {
  if (n !== 1 && n !== 11) return { ok: false, reason: 'count' };
  const q = quoteDraw(state, 'equipment', n);
  if (!pay(state, q)) return { ok: false, reason: 'gem', quote: q };
  const g = state.gacha.eq;
  const results = [];
  for (let i = 0; i < n; i++) {
    const lv = summonLevel(g.draws);
    let rarity = rng.weighted(rateTable(lv));
    g.pity += 1;
    let pity = false;
    if (g.pity >= GE.pity && rarity !== 'legendary' && rarity !== 'mythic') { rarity = 'legendary'; pity = true; }
    if (rarity === 'legendary' || rarity === 'mythic') g.pity = 0;
    g.draws += 1;
    const it = makeItem(state, { slot: rollSlot(rng), rarity, level: state.player.level, rng, source: 'gacha' });
    results.push({ item: it, pity });
  }
  state.progression.counters.draws += n;
  return { ok: true, quote: q, results, items: results.map((r) => r.item), level: summonLevel(g.draws), pity: g.pity };
}

export function drawSkill(state, n, rng) {
  if (n !== 1 && n !== 11) return { ok: false, reason: 'count' };
  const q = quoteDraw(state, 'skill', n);
  if (!pay(state, q)) return { ok: false, reason: 'gem', quote: q };
  const g = state.gacha.sk;
  const cls = state.player.cls || 'warrior';
  // books go to skills of the player's class (unlocked first, otherwise base skills)
  const pool = unlockedSkills(state).filter((id) => id !== CLASS_SKILLS[cls].ult);
  const skills = pool.length ? pool : CLASS_SKILLS[cls].base;
  const runeIds = Object.keys(RUNES);
  const results = [];
  for (let i = 0; i < n; i++) {
    let r = rng.weighted(GS.rates);
    g.pity += 1;
    let pity = false;
    if (g.pity >= GS.pity && r !== 'legendary') { r = 'legendary'; pity = true; }
    if (r === 'legendary') {
      g.pity = 0;
      const id = runeIds[Math.floor(rng() * runeIds.length)];
      const owned = state.skills.runes.owned;
      const before = owned[id] || 0;
      owned[id] = Math.min(BALANCE.runes.maxLevel, before + 1);
      results.push({ kind: 'rune', rarity: 'legendary', rune: id, level: owned[id], dupe: before > 0, capped: before >= BALANCE.runes.maxLevel, pity });
      if (before >= BALANCE.runes.maxLevel) state.wallet.gem += 100;   // max-level duplicate → gems back (shown)
    } else {
      const sk = skills[Math.floor(rng() * skills.length)];
      const books = GS.books[r];
      state.skills.books[sk] = (state.skills.books[sk] || 0) + books;
      results.push({ kind: 'books', rarity: r, skill: sk, books, pity });
    }
    g.draws += 1;
  }
  state.progression.counters.draws += n;
  return { ok: true, quote: q, results, pity: g.pity };
}

export function equipRune(state, runeId, slot) {
  const rn = state.skills.runes;
  if (!rn.owned[runeId]) return { ok: false, reason: 'missing' };
  if (slot < 0 || slot >= BALANCE.runes.slots) return { ok: false, reason: 'slot' };
  const at = rn.equipped.indexOf(runeId);
  if (at >= 0) rn.equipped[at] = rn.equipped[slot];
  rn.equipped[slot] = runeId;
  return { ok: true };
}
export function unequipRune(state, slot) {
  const rn = state.skills.runes;
  if (!rn.equipped[slot]) return { ok: false, reason: 'empty' };
  rn.equipped[slot] = null;
  return { ok: true };
}
