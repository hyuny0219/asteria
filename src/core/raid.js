// 주간 레이드 "심연의 문": 3 tries a week (reset Monday 00:00 KST), 120 s against the
// 심연의 군주. Damage dealt (as a share of its max HP) decides the grade and reward.
import { BALANCE } from '../data/balance.js';
import { BOSSES } from '../data/content.js';
import { monsterStats } from './combat.js';
import { kstDayIndex } from './util.js';
import { makeItem, rollSlot } from './items.js';

const R = BALANCE.raid;
// KST day 0 = 1970-01-01 (Thursday). Monday-based week index.
export const kstWeekIndex = (ms) => Math.floor((kstDayIndex(ms) + 3) / 7);
export function refreshRaid(state, now) {
  const w = kstWeekIndex(now);
  if (state.raid.week === w) return false;
  if (state.raid.week !== null && w < state.raid.week) return false;
  state.raid.week = w; state.raid.tries = 0;
  return true;
}
export function triesLeft(state, now) { refreshRaid(state, now); return Math.max(0, R.weeklyTries - state.raid.tries); }
export const raidBossHp = () => monsterStats(BOSSES[R.boss].level, { boss: true }).hp * 3;
export function gradeFor(damage) {
  const share = damage / raidBossHp();
  for (const [g, t] of R.grades) if (share >= t) return g;
  return 'D';
}
export function beginRaid(state, now) {
  refreshRaid(state, now);
  if (state.raid.tries >= R.weeklyTries) return { ok: false, reason: 'tries' };
  state.raid.tries += 1;          // a try is spent on entry (saved before the fight)
  return { ok: true };
}
export function finishRaid(state, damage, rng) {
  const grade = gradeFor(damage);
  const rw = R.rewards[grade];
  state.wallet.gem += rw.gem || 0;
  state.wallet.starShard += rw.starShard || 0;
  const items = [];
  if (rw.items) items.push(makeItem(state, { slot: rollSlot(rng), rarity: rng.weighted(rw.items), level: Math.min(BALANCE.levelCap, state.player.level), rng, source: 'raid', set: 'void' }));
  if (damage > state.raid.best) { state.raid.best = damage; state.raid.bestGrade = grade; }
  return { ok: true, grade, damage, share: damage / raidBossHp(), reward: { gem: rw.gem || 0, starShard: rw.starShard || 0 }, items };
}
