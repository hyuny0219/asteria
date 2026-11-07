// Save state shape, creation, validation and migration.
import { BALANCE } from '../data/balance.js';
import { CLASS_SKILLS } from '../data/content.js';
import { kstDayIndex } from './util.js';
import { refreshLook } from './items.js';
import { defaultMeta } from './meta.js';
import { defaultStages, stagesFromProgress } from './stages.js';
import { defaultMplus } from './mplus.js';
import { defaultExpedition } from './expedition.js';
import { defaultWorldBoss } from './worldboss.js';
import { defaultCraft } from './crafting.js';
import { defaultMail } from './mail.js';

export const SCHEMA_VERSION = 8;

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
      peakLevel: 1,                               // highest level ever (talent points survive 환생)
    },
    // 특성 / 환생 / 균열 (schema 4) — see talents.js, rebirth.js, rift.js
    talents: { presets: [{}, {}], active: 0, autoSwitch: false, auto: false, respecDay: null, respecUsed: 0 },
    rebirth: { count: 0, essence: 0, totalEssence: 0, levels: { atk: 0, hp: 0, gold: 0, exp: 0 }, lastAt: null },
    rift: { day: null, runsToday: 0, best: 0, runs: 0, run: null },
    // 도감 · 업적 · 칭호 · 시즌 패스 · 동료 (schema 5) — see meta.js
    ...defaultMeta(),
    profile: { nickname: '' },
    wallet: { gold: 0, ore: 0, token: 0, gem: 0, eqTicket: 0, skTicket: 0, awakenStone: 0, starShard: 0, classTicket: 0 },
    shop: { buys: {} },
    attendance: { lastDay: null, count: 0 },
    returnBonus: { pending: null, lastAwayFrom: null, claimed: 0, boostUntil: 0 },
    inventory: [],          // item objects
    overflow: [],           // items that did not fit (never auto-deleted)
    equipped: { weapon: null, helmet: null, armor: null, gloves: null, boots: null, necklace: null, ring1: null, ring2: null },
    // 슬롯 강화 (schema 6): level per equip slot, ore spent per slot
    slotEnhance: { weapon: 0, helmet: 0, armor: 0, gloves: 0, boots: 0, necklace: 0, ring1: 0, ring2: 0 },
    slotEnhanceOre: { weapon: 0, helmet: 0, armor: 0, gloves: 0, boots: 0, necklace: 0, ring1: 0, ring2: 0 },
    stages: defaultStages(),
    // v8 콘텐츠 (schema 8): 쐐기 던전 (mplus.js)
    mplus: defaultMplus(),
    expedition: defaultExpedition(),     // 원정 파견 (expedition.js)
    craft: defaultCraft(),                // 제작 재료 · 보옥 가방 · 마부(슬롯) · 버프 음식 (crafting.js)
    mail: defaultMail(),                  // 우편함 · 운영 우편 배달 기록 · 쿠폰 사용 기록 (mail.js)
    worldBoss: defaultWorldBoss(),        // 월드 보스 기록 + 희귀 정예 도감 (worldboss.js)   // 스테이지 지도 (schema 7): best stars, first-clear claimed, auto-advance
    notices: {},            // one-time notices shown after load: { slotEnhance: { refund, levels } }
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
  // 3 → 4: talents, rebirth, rift. Nothing to convert; peakLevel starts at the current level.
  3: (s) => {
    s.schemaVersion = 4;
    s.player.peakLevel = Math.max(s.player.peakLevel || 1, s.player.level);
    return s;
  },
  // 4 → 5: 도감/업적/칭호/패스/동료. Existing items fill the equipment codex; past boss
  // clears count once in the boss codex. Achievements are measured from counters, so
  // they become claimable right away (no retroactive auto-grant).
  4: (s) => {
    s.schemaVersion = 5;
    const m = defaultMeta();
    for (const k of Object.keys(m)) if (!s[k]) s[k] = m[k];
    for (const it of [...(s.inventory || []), ...(s.overflow || [])]) {
      const slot = it.slot === 'ring1' || it.slot === 'ring2' ? 'ring' : it.slot;
      if (slot && it.rarity) s.codex.items[`${slot}:${it.rarity}`] = true;
    }
    for (const b of Object.keys(s.progression.bossCleared || {})) s.codex.kills[b] = Math.max(s.codex.kills[b] || 0, 1);
    return s;
  },
  // 5 → 6: 아이템 강화 → 슬롯 강화. Each slot takes the level of the item worn there;
  // unworn items are refunded 100% of their invested ore and reset. A notice explains it once.
  5: (s) => {
    s.schemaVersion = 6;
    const slots = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'];
    s.slotEnhance = {}; s.slotEnhanceOre = {};
    const worn = new Set();
    for (const k of slots) {
      const id = s.equipped && s.equipped[k];
      const it = id && (s.inventory || []).find((i) => i.id === id);
      s.slotEnhance[k] = it ? Math.max(0, Math.min(15, it.enhance || 0)) : 0;
      s.slotEnhanceOre[k] = it ? (it.oreInvested || 0) : 0;
      if (it) worn.add(it.id);
    }
    let refund = 0, refunded = 0;
    for (const it of [...(s.inventory || []), ...(s.overflow || [])]) {
      if (!worn.has(it.id) && (it.oreInvested || 0) > 0) { refund += it.oreInvested; refunded += 1; }
      delete it.enhance; delete it.oreInvested;
    }
    s.wallet.ore += refund;
    const levels = { ...s.slotEnhance };
    s.notices = { ...(s.notices || {}) };
    if (refund > 0 || Object.values(levels).some((v) => v > 0)) s.notices.slotEnhance = { refund, refunded, levels };
    return s;
  },
  // 6 → 7: 스테이지 지도. Progress already made = 1★ cleared, first-clear reward marked received.
  6: (s) => {
    s.schemaVersion = 7;
    if (!s.stages) s.stages = stagesFromProgress(s);
    return s;
  },
  // 7 → 8: v8 콘텐츠. New top-level blocks start empty (filled below from newGame defaults).
  7: (s) => {
    s.schemaVersion = 8;
    if (!s.mplus) s.mplus = defaultMplus();
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
  for (const it of [...(cur.inventory || []), ...(cur.overflow || [])]) refreshLook(it);
  for (const k of Object.keys(d.skills)) if (cur.skills[k] === undefined) cur.skills[k] = d.skills[k];
  for (const k of Object.keys(d.dungeons)) if (!cur.dungeons[k]) cur.dungeons[k] = d.dungeons[k];
  for (const k of Object.keys(d.player)) if (cur.player[k] === undefined) cur.player[k] = d.player[k];
  for (const k of Object.keys(d.slotEnhance)) { cur.slotEnhance[k] ||= 0; cur.slotEnhanceOre[k] ||= 0; }
  for (const k of Object.keys(d.craft)) if (cur.craft[k] === undefined) cur.craft[k] = d.craft[k];
  return cur;
}

export function markTx(s, txId) {
  const a = s.transactions.applied;
  if (a.includes(txId)) return false;
  a.push(txId);
  if (a.length > 64) a.splice(0, a.length - 64);
  return true;
}
