// 쐐기 던전 (WoW 신화+ 방식). One keystone level for all three dungeons.
// A run = trash pack (kill count) + the dungeon's boss, against a timer.
//   in time            → key +1 (+2 with >= 40% time left, +3 with >= 60%)
//   over time, done    → key unchanged, rewards halved, item one grade lower
//   death / give up    → key -1 (never below MPLUS.minKey), small ore only
// Enemy level follows the hero (Lv - 3, 30..100); each key level multiplies enemy HP/ATK
// by statPerKey. Two weekly affixes (KST Monday): one of 강화/폭군 + one rotating.
// Rewards: 3 rewarded runs per KST day (the key still moves after that). The best key
// timed this week fills the 주간 금고, claimable the following week.
// The run is stored at start (state.mplus.run): a crash/reload refunds the try, key unchanged.
import { BOSSES, DUNGEON_MONSTERS } from '../data/content.js';
import { kstDayIndex } from './util.js';
import { kstWeekIndex } from './raid.js';
import { markTx } from './state.js';
import { makeItem, rollRarity, rollSlot } from './items.js';

export const MPLUS = Object.freeze({
  unlockBoss: 'B03', minKey: 2, maxKey: 30, runsPerDay: 3,
  trash: 20, timeSec: 90, hardSec: 150,          // HUD timer / hard stop (then it is a failure)
  levelOffset: 0, minLevel: 30, statPerKey: 1.15,
  bossHpMul: 0.55,                               // dungeon boss is lighter than the field boss fight
  plus2: 0.4, plus3: 0.6,                        // time-left fractions for +2 / +3
  dungeons: {
    quarry: { name: '별의 채석장', bg: 'mine', boss: 'B03' },
    gold: { name: '황금 금고', bg: 'vault', boss: 'B02' },
    books: { name: '스킬북 서고', bg: 'library', boss: 'B08' },
  },
  reward: { gemBase: 20, gemPerKey: 6, oreBase: 15, orePerKey: 5, overtimeMul: 0.5, failOrePerKey: 3 },
  vault: { gemBase: 100, gemPerKey: 20, eqTicketPerKeys: 3, skTicketPerKeys: 5 },
});

export const AFFIXES = Object.freeze({
  fortified: { name: '강화', desc: '일반 적 체력 +20%, 공격력 +30%' },
  tyrannical: { name: '폭군', desc: '보스 체력 +30%, 공격력 +15%' },
  raging: { name: '분노', desc: '체력 30% 이하인 적의 공격 피해 +50%' },
  bursting: { name: '파열', desc: '적이 쓰러질 때마다 내 최대 HP 3% 피해' },
  quaking: { name: '지진', desc: '15초마다 내 최대 HP 8% 피해' },
  grievous: { name: '치명상', desc: '받는 회복 -40%' },
});
const ROTATE = ['raging', 'bursting', 'quaking', 'grievous'];
export function affixesFor(now) {
  const w = kstWeekIndex(now);
  const m = (x, n) => ((x % n) + n) % n;
  return [m(w, 2) ? 'tyrannical' : 'fortified', ROTATE[m(Math.floor(w / 2) + w, ROTATE.length)]];
}

export function defaultMplus() {
  return { key: MPLUS.minKey, best: { quarry: 0, gold: 0, books: 0 }, bestTimed: { quarry: 0, gold: 0, books: 0 },
    day: null, runsToday: 0, week: null, weekBest: 0, vault: null, runs: 0, run: null };
}
export const mplusOpen = (state) => !!state.progression.bossCleared[MPLUS.unlockBoss];

// day / week rollover. A finished week with a timed key becomes the claimable vault.
export function refreshMplus(state, now) {
  const m = state.mplus || (state.mplus = defaultMplus());
  const d = kstDayIndex(now);
  if (m.day !== d) { m.day = d; m.runsToday = 0; }
  const w = kstWeekIndex(now);
  if (m.week === null) m.week = w;
  else if (w > m.week) {
    if (m.weekBest > 0 && !m.vault) m.vault = { fromWeek: m.week, best: m.weekBest };
    m.week = w; m.weekBest = 0;
  }
  return m;
}
export function rewardedLeft(state, now) { refreshMplus(state, now); return Math.max(0, MPLUS.runsPerDay - state.mplus.runsToday); }

export function enemyLevel(state) { return Math.max(MPLUS.minLevel, Math.min(100, state.player.level)) + MPLUS.levelOffset; }
export const keyMul = (key) => Math.pow(MPLUS.statPerKey, key - MPLUS.minKey);

export function runConfig(state, dungeon, key, affixes) {
  const D = MPLUS.dungeons[dungeon];
  return { dungeon, key, level: enemyLevel(state), statMul: keyMul(key), trash: MPLUS.trash, timeSec: MPLUS.timeSec, hardSec: MPLUS.hardSec,
    monsters: DUNGEON_MONSTERS[dungeon], boss: D.boss, bossHpMul: MPLUS.bossHpMul, affixes: [...affixes], bg: D.bg };
}

export function beginRun(state, dungeon, runId, now) {
  if (!mplusOpen(state)) return { ok: false, reason: 'locked' };
  if (!MPLUS.dungeons[dungeon]) return { ok: false, reason: 'dungeon' };
  const m = refreshMplus(state, now);
  if (m.run) return { ok: false, reason: 'pending' };
  const rewarded = m.runsToday < MPLUS.runsPerDay;
  if (rewarded) m.runsToday += 1;
  m.runs += 1;
  m.run = { id: runId, dungeon, key: m.key, affixes: affixesFor(now), rewarded, startedAt: now };
  return { ok: true, run: m.run };
}

// Crash / reload during a run: the try comes back, the key does not move.
export function recoverRun(state) {
  const m = state.mplus;
  if (!m || !m.run) return null;
  const run = m.run;
  if (run.rewarded) m.runsToday = Math.max(0, m.runsToday - 1);
  m.run = null;
  return { dungeon: run.dungeon, key: run.key };
}

const RARITY_BY_KEY = [
  [15, { epic: 0.4, legendary: 0.58, mythic: 0.02 }],
  [10, { epic: 0.65, legendary: 0.35 }],
  [5, { rare: 0.3, epic: 0.6, legendary: 0.1 }],
  [0, { rare: 0.7, epic: 0.3 }],
];
export const rarityTable = (key) => RARITY_BY_KEY.find(([k]) => key >= k)[1];
const LOWER = { mythic: 'legendary', legendary: 'epic', epic: 'rare', rare: 'uncommon', uncommon: 'common', common: 'common' };

export function keyDelta(timeSec, timed) {
  if (!timed) return 0;
  const left = 1 - timeSec / MPLUS.timeSec;
  return left >= MPLUS.plus3 ? 3 : left >= MPLUS.plus2 ? 2 : 1;
}

// outcome: { win, timeSec }. Returns the result + rewards (items to be added by the caller).
export function finishRun(state, runId, outcome, now, rng) {
  const m = state.mplus;
  const run = m && m.run;
  if (!run || run.id !== runId) return { ok: false, reason: 'duplicate' };
  if (!markTx(state, runId + ':mplus')) { m.run = null; return { ok: false, reason: 'duplicate' }; }
  m.run = null;
  const R = MPLUS.reward;
  const key = run.key;
  const res = { ok: true, dungeon: run.dungeon, key, affixes: run.affixes, rewarded: run.rewarded, timeSec: outcome.timeSec, items: [], reward: {} };
  if (!outcome.win) {
    m.key = Math.max(MPLUS.minKey, key - 1);
    res.result = 'fail'; res.newKey = m.key;
    if (run.rewarded) { res.reward.ore = R.failOrePerKey * key; state.wallet.ore += res.reward.ore; }
    return res;
  }
  const timed = outcome.timeSec <= MPLUS.timeSec;
  const delta = keyDelta(outcome.timeSec, timed);
  m.key = Math.min(MPLUS.maxKey, key + delta);
  m.best[run.dungeon] = Math.max(m.best[run.dungeon] || 0, key);
  if (timed) { m.bestTimed[run.dungeon] = Math.max(m.bestTimed[run.dungeon] || 0, key); m.weekBest = Math.max(m.weekBest || 0, key); }
  res.result = timed ? 'timed' : 'overtime'; res.delta = delta; res.newKey = m.key;
  if (!run.rewarded) return res;
  const mul = timed ? 1 : R.overtimeMul;
  res.reward.gem = Math.floor((R.gemBase + R.gemPerKey * key) * mul);
  res.reward.ore = Math.floor((R.oreBase + R.orePerKey * key) * mul);
  state.wallet.gem += res.reward.gem; state.wallet.ore += res.reward.ore;
  let rarity = rollRarity(rng, rarityTable(key));
  if (!timed) rarity = LOWER[rarity];
  const lvl = enemyLevel(state);
  res.items.push(makeItem(state, { slot: rollSlot(rng), rarity, level: lvl, rng, source: 'mplus' }));
  if (timed && delta >= 3) res.items.push(makeItem(state, { slot: rollSlot(rng), rarity: rollRarity(rng, rarityTable(key)), level: lvl, rng, source: 'mplus' }));
  return res;
}

export function vaultReward(best) {
  const V = MPLUS.vault;
  return { gem: V.gemBase + V.gemPerKey * best, eqTicket: Math.floor(best / V.eqTicketPerKeys) + 1, skTicket: Math.floor(best / V.skTicketPerKeys) };
}
export function claimVault(state, now) {
  const m = refreshMplus(state, now);
  if (!m.vault) return { ok: false, reason: 'none' };
  const rw = vaultReward(m.vault.best);
  state.wallet.gem += rw.gem; state.wallet.eqTicket += rw.eqTicket; state.wallet.skTicket += rw.skTicket;
  const best = m.vault.best;
  m.vault = null;
  return { ok: true, best, reward: rw };
}

export const bossDef = (dungeon) => BOSSES[MPLUS.dungeons[dungeon].boss];
