// Save state shape, creation, validation and migration.
import { BALANCE } from '../data/balance.js';
import { NORMAL_SKILLS_BASE } from '../data/content.js';
import { kstDayIndex } from './util.js';

export const SCHEMA_VERSION = 2;

export function newGame(now = Date.now(), seed = (now ^ 0x5eed) >>> 0) {
  return {
    schemaVersion: SCHEMA_VERSION,
    balanceVersion: BALANCE.version,
    revision: 0,
    createdAt: now,
    savedAt: now,
    rngSeed: seed >>> 0,
    player: {
      level: 1, exp: 0, pendingExp: 0, branch: null, branchChanges: 0,
      statsUpgrades: { atk: 0, hp: 0, def: 0, crit: 0, speed: 0 },
    },
    profile: { nickname: '' },
    wallet: { gold: 0, ore: 0, token: 0, gem: 0, eqTicket: 0, skTicket: 0 },
    attendance: { lastDay: null, count: 0 },
    returnBonus: { pending: null, lastAwayFrom: null, claimed: 0, boostUntil: 0 },
    inventory: [],          // item objects
    overflow: [],           // items that did not fit (never auto-deleted)
    equipped: { weapon: null, helmet: null, armor: null, accessory: null },
    skills: {
      equipped: [...NORMAL_SKILLS_BASE, null],   // 4 normal slots, slot 4 unlocks at promotion
      ultAuto: 'ELITE_BOSS',                     // OFF | ELITE_BOSS | ALWAYS
      autoCast: true,
    },
    progression: {
      region: 'meadow', wave: 1, waveKills: 0,
      maxWave: { meadow: 1 },                    // highest wave reached per region
      unlockedRegions: ['meadow'],
      bossCleared: {},                           // { B01: true }
      firstClearClaimed: {},                     // { B01: claimId }
      verifiedFarm: null,                        // see offline.js
      tokenKills: 0,
      counters: { kills: 0, bossWins: 0, bossLosses: 0, deaths: 0, upgrades: 0, enhances: 0, dismantled: 0 },
      firsts: {},                                // tutorial goals: firstUpgrade, firstEquip, ...
    },
    dungeon: { tickets: BALANCE.dungeon.dailyTickets, lastDay: kstDayIndex(now), best: 0, pendingRun: null, clockWarnings: 0 },
    promotion: { trialCleared: false, branchChosenAt: null },
    offlineSnapshot: { lastActiveAt: now, pendingClaim: null },
    transactions: { lastClaimId: null, lastClaimAt: null, applied: [] },   // recent tx ids (bounded)
    settings: {
      reduceMotion: false, shake: true, damageNumbers: 'all', sound: false, volume: 0.6,
      battleView: 'battle', speed: 1, devTools: false,
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
  if (!s.wallet || ['gold', 'ore', 'token', 'gem', 'eqTicket', 'skTicket'].filter((k) => k in s.wallet || ['gold', 'ore', 'token'].includes(k)).some((k) => typeof s.wallet[k] !== 'number' || s.wallet[k] < 0 || !Number.isFinite(s.wallet[k]))) p.push('wallet');
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
  return cur;
}

export function markTx(s, txId) {
  const a = s.transactions.applied;
  if (a.includes(txId)) return false;
  a.push(txId);
  if (a.length > 64) a.splice(0, a.length - 64);
  return true;
}
