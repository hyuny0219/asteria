// Automatic growth (선배 요청: 성장 스탯은 자동으로, 화면은 확인만).
// Gold upgrades are bought automatically from farming gold, cheapest-weighted first so
// the five stats rise together. A reserve is kept for things the player still buys by
// hand: the tier-2 promotion gold, and skill level-ups whose books are already in hand.
// Stat points are always spread by the class recommendation.
import { BALANCE } from '../data/balance.js';
import { killRewards } from './combat.js';
import { UPGRADE_STATS, applyAutoStats, upgradeCost, upgradeRoom } from './economy.js';
import { skillLevelCost, tierOf, unlockedSkills } from './progression.js';

const WEIGHTS = { atk: 1.0, hp: 0.85, def: 0.55, crit: 0.5, speed: 0.5 };
const goldPerMinute = (lv) => killRewards(lv).gold * 20;

export function autoGrowReserve(state) {
  let reserve = 0;
  const T2 = BALANCE.tiers && BALANCE.tiers[2];
  if (T2 && tierOf(state) < 2 && state.player.level >= T2.level - 5) reserve += goldPerMinute(T2.level) * T2.goldMinutes;
  for (const id of unlockedSkills(state)) {
    const c = skillLevelCost(state, id);
    if (c && (state.skills.books[id] || 0) >= c.books) reserve += c.gold;
  }
  return reserve;
}

// Mutates state. Returns {count, spent, bought:{stat:n}}.
export function autoGrow(state, { maxBuys = 200 } = {}) {
  const ups = state.player.statsUpgrades;
  const reserve = autoGrowReserve(state);
  const out = { count: 0, spent: 0, bought: {} };
  while (out.count < maxBuys) {
    let best = null;
    for (const stat of UPGRADE_STATS) {
      if (upgradeRoom(state, stat) <= 0) continue;
      const c = upgradeCost(stat, ups[stat]);
      const score = c / WEIGHTS[stat];
      if (!best || score < best.score) best = { stat, c, score };
    }
    if (!best || state.wallet.gold - best.c < reserve) break;
    state.wallet.gold -= best.c;
    ups[best.stat] += 1;
    out.count += 1; out.spent += best.c;
    out.bought[best.stat] = (out.bought[best.stat] || 0) + 1;
  }
  if (out.count) {
    state.progression.counters.upgrades = (state.progression.counters.upgrades || 0) + out.count;
    state.progression.firsts.firstUpgrade ||= Date.now();
    state.progression.autoGrow = { at: Date.now(), total: ((state.progression.autoGrow && state.progression.autoGrow.total) || 0) + out.count, spent: ((state.progression.autoGrow && state.progression.autoGrow.spent) || 0) + out.spent };
  }
  state.player.statAuto = true;
  applyAutoStats(state);
  if (state.wallet.gold < 0) throw new Error('negative gold');
  return { ...out, reserve };
}
