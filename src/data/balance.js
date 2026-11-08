// Balance values. Starting point: docs/handoff/balance_seed.json (0.1-experimental),
// extended to Lv 100 for v4 (docs/DESIGN_V4.md). Every change is listed in
// docs/BALANCE_CHANGES.md. These are experiment values, not an approved table.

// Piecewise-linear lookup: pts = [[x, y], ...] sorted by x.
export function curve(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) { const [x0, y0] = pts[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  }
  return pts[pts.length - 1][1];
}

export const BALANCE = Object.freeze({
  version: '0.4-v4-experimental',
  seedVersion: '0.1-experimental',
  levelCap: 100,
  promotionLevel: 30,                 // first tier (kept for v3 UI)
  promotionLevels: [30, 60, 90],      // tier 1 / 2 / 3: EXP is stored at these levels until promoted
  expCurve: { base: 100, exponent: 1.8, bandMul: [[10, 0.25], [30, 0.15], [60, 0.6], [90, 0.8], [101, 1.6]] },   // floor(100 · Lv^1.8 · band) — band ×0.25 / ×0.15 / ×0.6 / ×0.8 / ×1.6 (v6 속도 조정: Lv30≈6h·Lv60≈2.5d·Lv90≈7d·Lv100≈10d)
  // v12 스테이지 페이즈: a farm stage (10 kills) is 3 phases with a short travel leg between
  // phases and between stages. rewardMul makes up for the kills lost to travel (farm + offline).
  phase: { sizes: [3, 3, 4], travelSec: 3, travelRegenPct: 0.03, rewardMul: 1.9 },
  combat: {
    tickMs: 50,
    bossTimeoutSec: 90,
    baseAttackPerSec: 1,
    attackSpeedCap: 3,
    critChance: 0.05,
    critChanceCap: 0.6,
    critMultiplier: 1.5,
    critDmgCap: 2.5,             // total crit multiplier cap with options/runes
    evadeCap: 0.4,
    cdrCap: 0.4,
    enemyAttackIntervalSec: 1.8,
    defenseKBase: 50,
    defenseKPerEnemyLevel: 10,
    respawnDelaySec: 3,
    spawnGapSec: 0.9,
    maxEnemiesOnField: 2,
    waveKillTarget: 10,
    retreatAfterDeaths: 2,
    retreatHoldKills: 40,
    enrage: { below: 0.3, intervalMul: 0.7, atkMul: 1.2 },
    fieldBossEverySec: 1800,     // real foreground farming seconds
    ultCharge: { perAttack: 2, perHitTaken: 1, hitTakenPerSecCap: 2, perKill: 5, killChargeCapPerAction: 10 },
  },
  player: { atk: 20, hp: 200, def: 10, levelGain: { atk: 3, hp: 25, def: 1 } },
  upgrade: {
    costGrowth: 1.15,
    baseCosts: { atk: 10, hp: 10, def: 12, crit: 30, speed: 30 },
    gains: { atk: 2, hp: 20, def: 1, crit: 0.002, speed: 0.01 },
  },
  statPoints: {
    perLevel: 5,
    // main stat of the class: +2 ATK per point; off-class attack stats +0.5
    mainAtk: 2, offAtk: 0.5,
    vit: { hp: 15, def: 1 },
    agi: { aspd: 0.003, evade: 0.002, crit: 0.001 },
    wis: { cdr: 0.001 },
    resetCostGoldMinutes: 30,
  },
  monster: {
    // ≤ Lv 30: the v3 curve (HP 50·1.10^L, ATK 7·1.075^L). Above Lv 30 the growth
    // becomes polynomial so gear + stat points can keep up to Lv 100.
    hpBase: 50, hpGrowth: 1.10,
    atkBase: 7, atkGrowth: 1.075,
    late: { from: 30, hpExp: 2.6, atkExp: 2.1 },
    defPerLevel: 0,
    elite: { hp: 3, atk: 1.3, chance: 0.06, fromWave: 3 },
    boss: { hp: 40, atk: 1.6 },
    fieldBoss: { hp: 12, atk: 1.5 },
    rewards: {
      // EXP per kill by level (piecewise), gold per kill: v3 curve ≤ 30 then polynomial
      exp: [[1, 11], [30, 12], [45, 18.5], [75, 24], [100, 26]],
      goldBase: 2.4, goldGrowth: 1.1, goldLateExp: 2.2,
      eliteMul: 3, oreChanceElite: 0.6,
      awakenFromLevel: 51, awakenChanceElite: 0.25,
    },
    // kept for the offline module's rate (same numbers as above)
    expBase: 12,
  },
  // 스테이지 지도 (v7): first-clear rewards (once per stage) and star time targets
  stages: {
    gem: 10, milestoneGem: 25,             // stages 5 and 10 are milestones (v8: ×2 / ×2.5)
    ore: 3, orePerRegion: 2, goldKills: 10, // gold = 10 kills at that stage's level
    bossGem: 50, bossGemPerRegion: 15, bossOre: 20, bossOrePerRegion: 10, bossGoldKills: 30,
    starSec: 30,                           // 3★: 10 kills within 30 s of combat time, no death (at-level ≈ 14–22 s)
    bossStarSec: 45,                       // 3★ boss: win within 45 s
  },
  equipment: {
    slots: ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'],   // equip slots
    itemSlots: ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring'],
    rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'],
    dropChance: 0.05,
    rarityConditional: { common: 0.7, uncommon: 0.25, rare: 0.045, epic: 0.005 },
    offlineRarity: { common: 0.7, uncommon: 0.25, rare: 0.05 },      // 방치: 희귀 이하만
    eliteDropChance: 0.25,
    eliteRarity: { uncommon: 0.7, rare: 0.25, epic: 0.045, legendary: 0.005 },   // one grade up
    bossRarity: { rare: 0.6, epic: 0.3, legendary: 0.095, mythic: 0.005 },      // + 1 uncommon guaranteed; mythic only in the raid
    rarityMultiplier: { common: 1, uncommon: 1.2, rare: 1.5, epic: 1.9, legendary: 2.5, mythic: 3.2 },
    optionCount: { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 4 },
    options: {
      atkPct: [0.03, 0.08], critChance: [0.01, 0.03], critDmg: [0.05, 0.15], aspd: [0.02, 0.06],
      hpPct: [0.03, 0.08], defPct: [0.03, 0.08], cdr: [0.02, 0.05], ultCharge: [0.05, 0.15], goldPct: [0.03, 0.08],
    },
    mythicUniques: ['mythUltCdr', 'mythHeal'],
    enhanceMax: 15,
    // success chance to go from +n to +n+1 (index n)
    enhanceSuccess: [1, 1, 1, 1, 1, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.16, 0.12, 0.08, 0.05],
    enhanceFailDropFrom: 11,     // at +11 or more a failure drops one level; never destroyed
    enhanceStatPerLevel: 0.05,
    enhanceCost: { base: 5, growth: 1.42, slotMul: 1.5 },   // slot enhance (v7): rarity factor → fixed 1.5 (≈ 영웅 평균)
    dismantle: { common: 1, uncommon: 3, rare: 8, epic: 20, legendary: 60, mythic: 200 },
    refundRate: 0.8,
    inventoryCapacity: 200,
    overflowCapacity: 100,
    base: {
      weapon: { atk: [6, 1.9] },
      helmet: { hp: [30, 11], def: [1, 0.35] },
      armor: { hp: [45, 15], def: [2, 0.55] },
      gloves: { atk: [2, 0.6], def: [1, 0.25] },
      boots: { hp: [20, 8], def: [1, 0.3] },
      necklace: { atk: [3, 0.9], crit: [0.004, 0.0003] },
      ring: { atk: [2, 0.7], crit: [0.003, 0.0002] },
    },
  },
  offline: { maxSeconds: 43200, efficiency: 0.75, maxEquipmentItems: 20, speedMultiplier: 1, minSeconds: 30, validateCycles: 3, minWindowSec: 60, overflowItemToOre: 1 },
  dungeon: { dailyTickets: 3, ticketCap: 9, resetTimezone: 'Asia/Seoul', stageTimeSec: 60, killTarget: 12, levelBase: 6, levelPerStage: 3, oreBase: 18, orePerStage: 9, goldPerStage: 60 },
  dungeons: {
    quarry: { name: '별의 채석장', unlockBoss: 'B01', reward: 'ore' },
    gold: { name: '황금 금고', unlockBoss: 'B02', reward: 'gold', goldMinutesPerKill: 0.6, killTarget: 15 },
    books: { name: '스킬북 서고', unlockBoss: 'B03', reward: 'books', booksBase: 3, booksPerStage: 1 / 3 },
  },
  tower: { timeSec: 60, killTarget: 10, levelBase: 5, levelPerFloor: 2, eliteBase: 0.1, elitePerFloor: 0.01,
    gemsPerFloor: 10, every5: { gem: 50, awakenStone: 2 }, every10: { starShard: 1, fromFloor: 30 } },
  raid: { unlockLevel: 91, unlockBoss: 'B09', weeklyTries: 3, timeSec: 120, boss: 'B10',
    // damage thresholds as multiples of boss max HP
    grades: [['S', 1.0], ['A', 0.7], ['B', 0.45], ['C', 0.25], ['D', 0]],
    rewards: {
      S: { gem: 300, starShard: 2, items: { legendary: 0.995, mythic: 0.005 } },
      A: { gem: 200, starShard: 1, items: { epic: 0.6, legendary: 0.4 } },
      B: { gem: 120, starShard: 1, items: { epic: 1 } },
      C: { gem: 80, items: { rare: 1 } },
      D: { gem: 40, items: { uncommon: 1 } },
    } },
  promotion: { tokenFromLevel: 25, tokensRequired: 20, killsPerToken: 5, eligibleEnemyLevel: 21, bossRequired: 'B03', trialTimeSec: 90 },
  tiers: {
    1: { level: 30, boss: 'B03', trial: 'T01' },
    2: { level: 60, boss: 'B06', awakenStone: 10, goldMinutes: 120, towerFloor: 5 },
    3: { level: 90, boss: 'B09', starShard: 3, trial: 'T03' },
  },
  skills: { levelBonusPerLevel: 0.08, maxLevel: 10, booksPerLevel: 2, goldMinutesPerLevel: 3 },
  runes: { slots: 2, maxLevel: 5, perLevel: 0.2 },
  gacha: {
    equipment: {
      cost: { gem: 50, gem11: 500 },
      rates: { common: 0.52, uncommon: 0.30, rare: 0.14, epic: 0.035, legendary: 0.0049, mythic: 0.0001 },
      // summon level by total draws; each level moves 4% of 'common' up the ladder
      levelAt: [0, 10, 40, 100, 200, 350, 550, 800, 1100, 1500],
      levelShift: { common: -0.04, uncommon: 0.012, rare: 0.016, epic: 0.009, legendary: 0.0028, mythic: 0.0002 },
      pity: 200,                 // legendary+ guaranteed on the 200th draw without one
    },
    skill: {
      cost: { gem: 80, gem11: 800 },
      // v11 뽑기형 스킬 등급: each draw is a skill card (skill + grade) or a rune.
      // published per-draw table = rune + card grades (sum 1)
      rates: { common: 0.5445, rare: 0.2772, epic: 0.1188, legendary: 0.04455, mythic: 0.00495, rune: 0.01 },
      books: { common: 2, rare: 5, epic: 12, legendary: 25, mythic: 50 },   // every card brings these books
      pity: 100,                 // rune guaranteed on the 100th draw without one
      mythicPity: 150,           // mythic skill card guaranteed on the 150th draw without one
    },
  },
  missions: { gem: 40, bonus: { gem: 100, eqTicket: 3, skTicket: 2 } },   // v8: ×2 + skill tickets
  // v8 사냥 보급: foreground farm kills only (offline stays gem/ticket-free). At ~0.5 kill/s
  // ≈ 45 gems + 3.6 장비 뽑기권 + 1.8 스킬 뽑기권 per hour of active hunting.
  supply: { gemEvery: 200, gem: 5, eqEvery: 500, skEvery: 1000, eliteGemChance: 0.15, eliteGem: 3, fieldBossGem: 30, fieldBossEqTicket: 2 },
  save: { checkpointSec: 20, schemaVersion: 3 },
  summon: { enabled: true, paidEnabled: false, adEnabled: false },
});

// v5 retune: levels past each promotion take longer (×1.35 / ×1.8 / ×2.7 for 30–59 / 60–89 / 90–99),
// so the first Lv 100 lands near the 20-day target. The step sits on the promotion locks.
export function expToNext(level) {
  const E = BALANCE.expCurve;
  let mul = 1;
  for (const [until, m] of E.bandMul || []) if (level < until) { mul = m; break; }
  return Math.floor(E.base * Math.pow(level, E.exponent) * mul);
}
// Tier gate for a level: the tier that must be done to pass `level` (0 = none).
export function tierLockAt(level) { return BALANCE.promotionLevels.indexOf(level) + 1; }
