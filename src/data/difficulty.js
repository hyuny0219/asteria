// 난이도 (schema 9): 이지 → 노말 → 하드. Same regions, monsters and bosses; every enemy is
// Lv 100 on 노말/하드 and scales with the stage index.
//   enemy hp/atk = base × growth^idx   (idx = region order × 11 + stage − 1; boss = +10 → 0 … 109)
// Tuned with tools/difficulty_sim.mjs against Lv 100 saves (see docs/BALANCE_CHANGES.md).
export const DIFF_IDS = Object.freeze(['easy', 'normal', 'hard']);
export const DIFFICULTY = Object.freeze({
  easy: { id: 'easy', name: '이지', order: 0 },
  normal: {
    id: 'normal', name: '노말', order: 1, level: 100, minPlayerLevel: 90,
    hp: { base: 1, growth: 1.02 }, atk: { base: 1.5, growth: 1.02 },
    gold: 1.6, exp: 1.5, drop: 1.25, firstClear: 2,
    // per-kill drop rarity (replaces the easy table) and repeat boss table
    rarity: { common: 0.3, uncommon: 0.38, rare: 0.24, epic: 0.075, legendary: 0.005 },
    bossFirst: { epic: 0.85, legendary: 0.15 },
  },
  hard: {
    id: 'hard', name: '하드', order: 2, level: 100, minPlayerLevel: 90,
    hp: { base: 2.5, growth: 1.022 }, atk: { base: 5, growth: 1.022 },
    gold: 2.4, exp: 2, drop: 1.5, firstClear: 3,
    rarity: { common: 0.12, uncommon: 0.33, rare: 0.35, epic: 0.18, legendary: 0.02 },
    bossFirst: { epic: 0.5, legendary: 0.5 },
  },
});
