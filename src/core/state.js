// Save state shape, creation, validation and migration.
import { BALANCE } from '../data/balance.js';
import { CLASS_SKILLS } from '../data/content.js';
import { kstDayIndex } from './util.js';

export const SCHEMA_VERSION = 3;

export function newGame(now = Date.now(), seed = (now ^ 0x5eed) >>> 0, cls = 'warrior') {
  return {
    schemaVersion: SCHEMA_VERSION,
    balanceVersion: BALANCE.version,
    revision: 0,
    createdAt: now,
    savedAt: now,
    rngSeed: seed >>> 0,
    player: {
      cls, tier: 0, level: 1, exp: 0, pendingExp: 0, branch: null, branchChanges: 0, classChanges: 0,
      statsUpgrades: { atk: 0, hp: 0, def: 0, crit: 0, speed: 0 },
      stats: { str: 0, int: 0, dex: 0, agi: 0, vit: 0, wis: 0 }, statAuto: true,
    },
    profile: { nickname: '' },
    wallet: { gold: 0, ore: 0, token: 0, gem: 0, eqTicket: 0, skTicket: 0, awakenStone: 0, starShard: 0, classTicket: 0 },
    shop: { buys: {} },
    attendance: { lastDay: null, count: 0 },
    returnBonus: { pending: null, lastAwayFrom: null, claimed: 0, boostUntil: 0 },
    inventory: [],          // item objects
    overflow: [],           // items that did not fit (never auto-deleted)
    equipped: { weapon: null, helmet: null, armor: null, gloves: null, boots: null, necklace: null, ring1: null, ring2: null },
    skills: {
      equipped: [...CLASS_SKILLS[cls].base, null, null],   // 5 slots: 3 base, 4th at tier 1, 5th at tier 2
      ultAuto: 'ELITE_BOSS',                     // OFF | ELITE_BOSS | ALWAYS
      autoCast: true,
      levels: {},                                // skillId → 1..10 (missing = 1)
      books: {},                                 // skillId → skill books owned
      runes: { owned: {}, equipped: [null, null] },   // runeId → level 1..5
    },
    gacha: { eq: { draws: 0, pity: 0 }, sk: { draws: 0, pity: 0 } },
    missions: { day: null, progress: {}, claimed: {}, bonus: false },
    tower: { best: 0 },
    raid: { week: null, tries: 0, best: 0, bestGrade: null },
    dungeons: {
      gold: { tickets: BALANCE.dungeon.dailyTickets, lastDay: kstDayIndex(now), best: 0, pendingRun: null, clockWarnings: 0 },
      books: { tickets: BALANCE.dungeon.dailyTickets, lastDay: kstDayIndex(now), best: 0, pendingRun: null, clockWarnings: 0 },
    },
    progression: {
      region: 'meadow', wave: 1, waveKills: 0,
      maxWave: { meadow: 1 },                    // highest wave reached per region
      unlockedRegions: ['meadow'],
      bossCleared: {},                           // { B01: true }
      firstClearClaimed: {},                     // { B01: claimId }
      verifiedFarm: null,                        // see offline.js
      tokenKills: 0,
      counters: { kills: 0, bossWins: 0, bossLosses: 0, deaths: 0, upgrades: 0, enhances: 0, dismantled: 0, draws: 0, fieldBosses: 0 },
      fieldBossSec: 0,                           // foreground farming seconds toward the next field boss
      firsts: {},                                // tutorial goals: firstUpgrade, firstEquip, ...
    },
    dungeon: { tickets: BALANCE.dungeon.dailyTickets, lastDay: kstDayIndex(now), best: 0, pendingRun: null, clockWarnings: 0 },
    promotion: { trialCleared: false, trials: {}, branchChosenAt: null, tierAt: {} },
    offlineSnapshot: { lastActiveAt: now, pendingClaim: null },
    transactions: { lastClaimId: null, lastClaimAt: null, applied: [] },   // recent tx ids (bounded)
    settings: {
      reduceMotion: false, shake: true, damageNumbers: 'all', sound: false, volume: 0.6,
      battleView: 'battle', speed: 1, devTools: false, autoDismantle: 'off',
    },
    diagnostics: { clockRollbacks: 0, futureClamps: 0, saveFailures: 0, recovered: 0 },
    nextItemSeq: 1,
  };
}

// Light structural validation. Returns list of problems (empty = valid).
export function validate(s) {
  const p = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  if (typeof s.schemaVersion !== 'number') p.push('schemaVersion');
  if (!s.player || typeof s.player.level !== 'number' || s.player.level < 1 || s.player.level > BALANCE.levelCap) p.push('player.level');
  if (!s.wallet || ['gold', 'ore', 'token', 'gem', 'eqTicket', 'skTicket', 'awakenStone', 'starShard', 'classTicket'].filter((k) => k in s.wallet || ['gold', 'ore', 'token'].includes(k)).some((k) => typeof s.wallet[k] !== 'number' || s.wallet[k] < 0 || !Number.isFinite(s.wallet[k]))) p.push('wallet');
  if (!Array.isArray(s.inventory)) p.push('inventory');
  if (!Array.isArray(s.overflow)) p.push('overflow');
  if (!s.equipped || typeof s.equipped !== 'object') p.push('equipped');
  if (!s.skills || !Array.isArray(s.skills.equipped)) p.push('skills');
  if (!s.progression || typeof s.progression.wave !== 'number') p.push('progression');
  if (!s.dungeon || typeof s.dungeon.tickets !== 'number') p.push('dungeon');
  if (!s.settings) p.push('settings');
  if (!s.transactions || !Array.isArray(s.transactions.applied)) p.push('transactions');
  return p;
}

// Migrations keyed by the version they upgrade FROM. None needed yet (schema 1),
// but loading always runs through here so future versions have one entry point.
const MIGRATIONS = {
  // 1 → 2: profile, gems & draw tickets, attendance, return bonus
  1: (s) => {
    s.schemaVersion = 2;
    s.profile ||= { nickname: '' };
    Object.assign(s.wallet, { gem: s.wallet.gem || 0, eqTicket: s.wallet.eqTicket || 0, skTicket: s.wallet.skTicket || 0 });
    s.attendance ||= { lastDay: null, count: 0 };
    s.returnBonus ||= { pending: null, lastAwayFrom: null, claimed: 0, boostUntil: 0 };
    return s;
  },
  // 2 → 3: classes, tiers, 8 equipment slots, stat points, skill levels, runes, gacha,
  // missions, tower, raid, gold/book dungeons. v3 progress is kept as warrior.
  2: (s) => {
    s.schemaVersion = 3;
    const p = s.player;
    p.cls ||= 'warrior';
    p.tier = p.branch ? 1 : 0;
    p.stats ||= { str: 0, int: 0, dex: 0, agi: 0, vit: 0, wis: 0 };
    if (p.statAuto === undefined) p.statAuto = true;
    const eq = s.equipped;
    const necklace = eq.accessory || null;
    delete eq.accessory;
    s.equipped = { weapon: eq.weapon || null, helmet: eq.helmet || null, armor: eq.armor || null, gloves: null, boots: null, necklace, ring1: null, ring2: null };
    for (const it of [...s.inventory, ...s.overflow]) if (it.slot === 'accessory') it.slot = 'necklace';
    for (const it of [...s.inventory, ...s.overflow]) { it.options ||= []; }
    const sk = s.skills;
    while (sk.equipped.length < 5) sk.equipped.push(null);
    sk.levels ||= {}; sk.books ||= {}; sk.runes ||= { owned: {}, equipped: [null, null] };
    // v3 skill levels were automatic (1 + ⌊(Lv−1)/4⌋, +1 after promotion): keep them
    const auto = Math.min(10, 1 + Math.floor((p.level - 1) / 4) + (p.branch ? 1 : 0));
    for (const id of ['strike', 'shieldCharge', 'warCry', 'starSlash', 'guardCounter', 'berserkStrike']) if (!sk.levels[id] && auto > 1) sk.levels[id] = auto;
    s.promotion.trials ||= s.promotion.trialCleared ? { 1: true } : {};
    s.promotion.tierAt ||= p.branch ? { 1: s.promotion.branchChosenAt || s.savedAt } : {};
    s.wallet.awakenStone ||= 0; s.wallet.starShard ||= 0;
    s.settings.autoDismantle ||= 'off';
    s.progression.counters.draws ||= 0; s.progression.counters.fieldBosses ||= 0;
    s.progression.fieldBossSec ||= 0;
    return s;
  },
};
export function migrate(s) {
  let cur = s;
  while (cur.schemaVersion < SCHEMA_VERSION) {
    const fn = MIGRATIONS[cur.schemaVersion];
    if (!fn) throw new Error(`no migration from ${cur.schemaVersion}`);
    cur = fn(cur);
  }
  // fill fields added later in the same schema with defaults (forward-compatible)
  const d = newGame(cur.createdAt || Date.now(), cur.rngSeed);
  for (const k of Object.keys(d)) if (cur[k] === undefined) cur[k] = d[k];
  for (const k of Object.keys(d.settings)) if (cur.settings[k] === undefined) cur.settings[k] = d.settings[k];
  for (const k of Object.keys(d.progression)) if (cur.progression[k] === undefined) cur.progression[k] = d.progression[k];
  for (const k of Object.keys(d.wallet)) if (cur.wallet[k] === undefined) cur.wallet[k] = d.wallet[k];
  if (cur.player.classChanges === undefined) cur.player.classChanges = 0;
  for (const k of Object.keys(d.skills)) if (cur.skills[k] === undefined) cur.skills[k] = d.skills[k];
  for (const k of Object.keys(d.dungeons)) if (!cur.dungeons[k]) cur.dungeons[k] = d.dungeons[k];
  for (const k of Object.keys(d.player)) if (cur.player[k] === undefined) cur.player[k] = d.player[k];
  return cur;
}

export function markTx(s, txId) {
  const a = s.transactions.applied;
  if (a.includes(txId)) return false;
  a.push(txId);
  if (a.length > 64) a.splice(0, a.length - 64);
  return true;
}
