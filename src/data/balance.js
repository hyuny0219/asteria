// Balance values. Starting point: docs/handoff/balance_seed.json (0.1-experimental).
// Every change from the seed is listed in docs/BALANCE_CHANGES.md with the reason.
// These are experiment values, not an approved balance table.
export const BALANCE = Object.freeze({
  version: '0.2-mvp-tuned',
  seedVersion: '0.1-experimental',
  levelCap: 35,
  promotionLevel: 30,
  expCurve: { base: 100, exponent: 1.8 },          // EXP to next = floor(100 * Lv^1.8)  (seed, unchanged)
  combat: {
    tickMs: 50,
    bossTimeoutSec: 90,
    baseAttackPerSec: 1,
    attackSpeedCap: 3,
    critChance: 0.05,
    critChanceCap: 0.6,
    critMultiplier: 1.5,
    enemyAttackIntervalSec: 1.8,
    defenseKBase: 50,
    defenseKPerEnemyLevel: 10,
    respawnDelaySec: 3,          // FARM restart after defeat
    spawnGapSec: 0.9,            // time between an enemy dying and the next stepping in
    maxEnemiesOnField: 2,
    waveKillTarget: 10,
    retreatAfterDeaths: 2,       // deaths on one wave before auto-retreating one wave
    retreatHoldKills: 40,        // kills before auto-advance resumes after a retreat
    ultCharge: { perAttack: 2, perHitTaken: 1, hitTakenPerSecCap: 2, perKill: 5, killChargeCapPerAction: 10 },
  },
  player: { atk: 20, hp: 200, def: 10, levelGain: { atk: 3, hp: 25, def: 1 } },
  upgrade: {
    costGrowth: 1.15,
    baseCosts: { atk: 10, hp: 10, def: 12, crit: 30, speed: 30 },
    gains: { atk: 2, hp: 20, def: 1, crit: 0.002, speed: 0.01 },
  },
  monster: {
    // Seed formula HP 50*1.12^Lv, ATK 8*1.10^Lv kept as the reference; MVP uses
    // a gentler curve after simulation (see BALANCE_CHANGES.md).
    hpBase: 50, hpGrowth: 1.10,
    atkBase: 7, atkGrowth: 1.075,
    defPerLevel: 0,              // early enemies DEF 0 (seed)
    elite: { hp: 3, atk: 1.3, chance: 0.06, fromWave: 3 },
    boss: { hp: 40, atk: 1.6 },
    rewards: { expBase: 12, expGrowth: 1.0, goldBase: 2.4, goldGrowth: 1.1, eliteMul: 3, oreChanceElite: 0.6 },
  },
  equipment: {
    slots: ['weapon', 'helmet', 'armor', 'accessory'],
    dropChance: 0.05,
    rarityConditional: { common: 0.7, uncommon: 0.25, rare: 0.05 },
    eliteDropChance: 0.25,
    eliteRarity: { common: 0.4, uncommon: 0.45, rare: 0.15 },
    rarityMultiplier: { common: 1, uncommon: 1.25, rare: 1.6 },
    enhanceMax: 10,
    enhanceSuccess: 1,
    enhanceStatPerLevel: 0.05,
    enhanceCost: { base: 5, growth: 1.5 },
    dismantle: { common: 1, uncommon: 3, rare: 8 },
    refundRate: 0.8,
    inventoryCapacity: 200,
    overflowCapacity: 100,       // beyond this, new drops convert to ore at dismantle value (shown, never silent)
    base: {
      weapon: { atk: [6, 1.6] },
      helmet: { hp: [30, 9], def: [1, 0.35] },
      armor: { hp: [45, 12], def: [2, 0.5] },
      accessory: { atk: [3, 0.8], crit: [0.004, 0.0004] },
    },
  },
  offline: { maxSeconds: 43200, efficiency: 0.75, maxEquipmentItems: 20, speedMultiplier: 1, minSeconds: 30, validateCycles: 3, minWindowSec: 60, overflowItemToOre: 1 },
  dungeon: { dailyTickets: 3, ticketCap: 9, resetTimezone: 'Asia/Seoul', stageTimeSec: 60, killTarget: 12, levelBase: 6, levelPerStage: 3, oreBase: 18, orePerStage: 9, goldPerStage: 60 },
  promotion: { tokenFromLevel: 25, tokensRequired: 20, killsPerToken: 5, eligibleEnemyLevel: 21, bossRequired: 'B03', trialTimeSec: 90 },
  skills: { levelBonusPerLevel: 0.08 },
  save: { checkpointSec: 20, schemaVersion: 1 },
  summon: { enabled: false, paidEnabled: false, adEnabled: false },
});

export function expToNext(level) {
  return Math.floor(BALANCE.expCurve.base * Math.pow(level, BALANCE.expCurve.exponent));
}
