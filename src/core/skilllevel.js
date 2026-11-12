// v18.3 스킬 레벨 확장: 최대 Lv 10 → 전직 단계마다 +5 (전직 전 10 · 1차 15 · 2차 20 · 3차 25 · 초월 30).
// Lv 10까지는 예전 그대로(레벨당 +8%, 스킬북 2n권). Lv 11부터는 레벨당 +2%로 완만하게,
// 대신 스킬북이 훨씬 많이 들어서 오래 쓰는 성장 목표가 됨 (10→30 한 스킬당 약 2,900권).
import { BALANCE } from '../data/balance.js';

const SK = BALANCE.skills;
export const SKILL_CAP_BASE = SK.maxLevel;            // 10
export const SKILL_CAP_ABS = SK.maxLevel + SK.capPerTier * 4;   // 30

export function skillMaxLevel(state) {
  const tier = Math.max(0, Math.min(4, (state && state.player && state.player.tier) || 0));
  return SK.maxLevel + SK.capPerTier * tier;
}
// 레벨 n에서 받는 피해 배율
export function skillLevelMul(lvl) {
  const n = Math.max(1, lvl || 1);
  const low = Math.min(n, SK.maxLevel) - 1;
  const high = Math.max(0, n - SK.maxLevel);
  return 1 + SK.levelBonusPerLevel * low + SK.levelBonusHigh * high;
}
// n → n+1 비용 (스킬북 권수, 골드는 분당 골드 × 분)
export function skillStepCost(n) {
  if (n < SK.maxLevel) return { books: SK.booksPerLevel * n, goldMinutes: SK.goldMinutesPerLevel * n };
  const k = n - SK.maxLevel + 1;   // 10→11 이 1
  return { books: SK.booksPerLevel * n + SK.booksHighStep * k, goldMinutes: SK.goldMinutesPerLevel * n * SK.goldHighMul };
}
