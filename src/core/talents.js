// 특성: points, ranks, row gates, presets, respec, auto-allocate. Pure; Game wraps in transact.
// State: state.talents = { presets: [{nodeId: rank}, {…}], active: 0, autoSwitch: false,
//   auto: false, respecDay: null, respecUsed: 0 } ; points derived from peak level etc.
import { CLASS_TREES, TALENT_NODES, TALENT_RULES as R, TALENT_TREES } from '../data/talents.js';
import { killRewards } from './combat.js';
import { kstDayIndex } from './util.js';

const goldPerMinute = (lv) => killRewards(lv).gold * 20;

export function defaultTalents() { return { presets: [{}, {}], active: 0, autoSwitch: false, auto: false, respecDay: null, respecUsed: 0 }; }

export const talentsOpen = (state) => (state.player.tier || 0) >= R.unlockTier;
export function treesFor(state) { return CLASS_TREES[state.player.cls || 'warrior']; }

export function pointsTotal(state) {
  if (!talentsOpen(state)) return 0;
  const peak = Math.max(state.player.level, state.player.peakLevel || 0);
  const fromLevel = Math.max(0, Math.min(100, peak) - (R.fromLevel - 1));
  const fromTower = Math.floor(((state.tower && state.tower.best) || 0) / R.perTowerFloors);
  const fromRebirth = ((state.rebirth && state.rebirth.count) || 0) * R.perRebirth;
  return fromLevel + fromTower + fromRebirth;
}
const preset = (state, idx = state.talents.active) => state.talents.presets[idx];
export function pointsSpent(state, idx) { return Object.values(preset(state, idx)).reduce((a, b) => a + b, 0); }
export function pointsFree(state, idx) { return pointsTotal(state) - pointsSpent(state, idx); }
export function treeSpent(state, tree, idx) {
  const p = preset(state, idx);
  return Object.entries(p).reduce((s, [id, r]) => s + (TALENT_NODES[id] && TALENT_NODES[id].tree === tree ? r : 0), 0);
}
export function rankOf(state, id, idx) { return preset(state, idx)[id] || 0; }

export function canRank(state, id, idx = state.talents.active) {
  const nd = TALENT_NODES[id];
  if (!nd) return { ok: false, reason: 'missing' };
  if (!talentsOpen(state)) return { ok: false, reason: 'locked' };
  if (!treesFor(state).includes(nd.tree)) return { ok: false, reason: 'tree' };
  if (rankOf(state, id, idx) >= nd.max) return { ok: false, reason: 'max' };
  if (pointsFree(state, idx) <= 0) return { ok: false, reason: 'points' };
  // row gate counts points in rows above this one only
  const above = Object.entries(preset(state, idx)).reduce((s, [nid, r]) => {
    const x = TALENT_NODES[nid];
    return s + (x && x.tree === nd.tree && x.row < nd.row ? r : 0);
  }, 0);
  if (above < R.rowGate * nd.row) return { ok: false, reason: 'gate', need: R.rowGate * nd.row, have: above };
  return { ok: true };
}
export function rankUp(state, id, idx = state.talents.active) {
  const c = canRank(state, id, idx);
  if (!c.ok) return c;
  const p = preset(state, idx);
  p[id] = (p[id] || 0) + 1;
  return { ok: true, id, rank: p[id] };
}

export function respecCost(state, now) {
  const t = state.talents;
  const day = kstDayIndex(now);
  const used = t.respecDay === day ? t.respecUsed : 0;
  return used < R.respecFreePerDay ? 0 : Math.floor(goldPerMinute(state.player.level) * R.respecGoldMinutes);
}
export function respec(state, now, idx = state.talents.active) {
  const cost = respecCost(state, now);
  if (state.wallet.gold < cost) return { ok: false, reason: 'gold', cost };
  state.wallet.gold -= cost;
  const day = kstDayIndex(now);
  const t = state.talents;
  t.respecUsed = t.respecDay === day ? t.respecUsed + 1 : 1;
  t.respecDay = day;
  t.presets[idx] = {};
  return { ok: true, cost };
}

// Recommended order: the player's own branch tree, then common, then the other tree.
export function autoAllocate(state, idx = state.talents.active) {
  const trees = treesFor(state);
  const own = state.player.branch && trees.includes(state.player.branch) ? state.player.branch : trees[0];
  const order = [own, 'common', ...trees.filter((t) => t !== own && t !== 'common')];
  let given = 0;
  for (const tree of order) {
    for (const row of TALENT_TREES[tree].rows) {
      // spread across the row's nodes one rank at a time
      let progress = true;
      while (progress) {
        progress = false;
        for (const nd of row) if (canRank(state, nd.id, idx).ok) { rankUp(state, nd.id, idx); given++; progress = true; }
      }
    }
  }
  return given;
}

export function setPreset(state, idx) { if (idx < 0 || idx >= R.presets) return { ok: false, reason: 'preset' }; state.talents.active = idx; return { ok: true, active: idx }; }

// Sum of effects + capstone flags for a preset (stats.js / combat read this).
export function talentEffects(state, idx = state.talents ? state.talents.active : 0) {
  const out = { pct: {}, caps: {} };
  if (!state.talents || !talentsOpen(state)) return out;
  const trees = treesFor(state);
  for (const [id, r] of Object.entries(state.talents.presets[idx] || {})) {
    const nd = TALENT_NODES[id];
    if (!nd || !r || !trees.includes(nd.tree)) continue;
    if (nd.cap) { out.caps[nd.cap] = true; continue; }
    for (const [k, v] of Object.entries(nd.eff)) out.pct[k] = (out.pct[k] || 0) + v * r;
  }
  return out;
}
