// 균열 (roguelite rift). A run is a chain of short floors using the normal combat.
// After each cleared floor the player picks 1 of 3 blessings; HP carries over between
// floors (+30% heal on clear). A weekly curse (KST Monday) changes every run that week.
// Rewards are granted once, when the run ends (death, timeout, "마치기" or clearing the
// last floor, 30), scaled by floors cleared. 2 free runs per KST day. The run lives in state.rift.run, so a reload
// resumes at the start of the current floor (or the pending blessing choice).
import { REGIONS } from '../data/content.js';
import { killRewards } from './combat.js';
import { kstDayIndex, makeRng, hashString } from './util.js';
import { kstWeekIndex } from './raid.js';
import { markTx } from './state.js';

export const RIFT = Object.freeze({
  freeRunsPerDay: 2, unlockBoss: 'B03', killTarget: 8, timeSec: 45,
  levelOffset: -3, levelPerFloor: 1, statPerFloor: 0.1, healOnClear: 0.3, maxFloor: 30,
  rewards: { gemPerFloor: 8, orePerFloor: 10, goldMinPerFloor: 1, booksEvery: 2, essenceEvery: 10 },
});

// rarity weights: common 60 / rare 30 / epic 10
export const BLESSINGS = Object.freeze({
  b_atk: { name: '맹공', desc: '공격력 +15%', mod: { atkPct: 0.15 }, r: 'common' },
  b_atk2: { name: '파괴의 의지', desc: '공격력 +30%', mod: { atkPct: 0.3 }, r: 'rare' },
  b_hp: { name: '강인함', desc: '최대 HP +20%', mod: { hpPct: 0.2 }, r: 'common' },
  b_def: { name: '돌의 피부', desc: '방어력 +30%', mod: { defPct: 0.3 }, r: 'common' },
  b_crit: { name: '예리함', desc: '치명 확률 +8%', mod: { critChance: 0.08 }, r: 'common' },
  b_cdmg: { name: '잔혹', desc: '치명 피해 +30%', mod: { critDmg: 0.3 }, r: 'rare' },
  b_aspd: { name: '질주', desc: '공격 속도 +15%', mod: { aspd: 0.15 }, r: 'common' },
  b_steal: { name: '흡혈', desc: '피해의 3% 회복', mod: { lifesteal: 0.03 }, r: 'rare' },
  b_combo: { name: '연격', desc: '추가타 확률 +15%', mod: { combo: 0.15 }, r: 'rare' },
  b_ult: { name: '충전', desc: '궁극기 충전 +40%', mod: { ultCharge: 0.4 }, r: 'common' },
  b_cdr: { name: '가속', desc: '스킬 대기 -15%', mod: { cdr: 0.15 }, r: 'common' },
  b_evade: { name: '잔상', desc: '회피 +8%', mod: { evade: 0.08 }, r: 'rare' },
  b_guard: { name: '수호', desc: '받는 피해 -12%', mod: { dmgTaken: 0.12 }, r: 'rare' },
  b_thorns: { name: '가시', desc: '받은 피해의 40%를 되돌려줍니다', mod: { thorns: 0.4 }, r: 'common' },
  b_regen: { name: '재생', desc: '초당 최대 HP 1.5% 회복', mod: { regen: 0.015 }, r: 'common' },
  b_heal: { name: '정화의 샘', desc: '층을 깰 때 HP를 추가로 30% 회복', mod: { clearHeal: 0.3 }, r: 'common' },
  b_glass: { name: '유리 대포', desc: '공격력 +60%, 최대 HP -25%', mod: { atkPct: 0.6, hpPct: -0.25 }, r: 'epic' },
  b_berserk: { name: '광기', desc: '공격 속도 +30%, 받는 피해 +10%', mod: { aspd: 0.3, dmgTaken: -0.1 }, r: 'epic' },
  b_greed: { name: '탐욕', desc: '균열 보상 +25%', mod: { riftReward: 0.25 }, r: 'rare' },
  b_echo: { name: '메아리', desc: '추가타 확률 +25%, 치명 확률 +5%', mod: { combo: 0.25, critChance: 0.05 }, r: 'epic' },
});
const RARITY_W = { common: 60, rare: 30, epic: 10 };

export const CURSES = Object.freeze([
  { id: 'c_fury', name: '분노의 주', desc: '적 공격력 +30%' },
  { id: 'c_iron', name: '강철의 주', desc: '적 체력 +40%' },
  { id: 'c_haste', name: '서두름의 주', desc: '적 공격 간격 -25%' },
  { id: 'c_famine', name: '기근의 주', desc: '회복 효과 -50%, 층 클리어 회복 없음' },
  { id: 'c_glass', name: '유리의 주', desc: '내 최대 HP -25%, 공격력 +15%' },
  { id: 'c_dark', name: '암흑의 주', desc: '내 치명 확률 -10%' },
]);
export const curseFor = (now) => CURSES[((kstWeekIndex(now) % CURSES.length) + CURSES.length) % CURSES.length];

export function defaultRift() { return { day: null, runsToday: 0, best: 0, runs: 0, run: null }; }
export const riftOpen = (state) => !!state.progression.bossCleared[RIFT.unlockBoss];

export function refreshRift(state, now) {
  const d = kstDayIndex(now);
  if (state.rift.day !== d) { state.rift.day = d; state.rift.runsToday = 0; }
}
export function runsLeft(state, now) { refreshRift(state, now); return Math.max(0, RIFT.freeRunsPerDay - state.rift.runsToday); }

export function beginRun(state, runId, now) {
  if (!riftOpen(state)) return { ok: false, reason: 'locked' };
  if (state.rift.run) return { ok: false, reason: 'pending' };
  if (runsLeft(state, now) <= 0) return { ok: false, reason: 'tries' };
  state.rift.runsToday += 1;
  state.rift.runs += 1;
  state.rift.run = { id: runId, floor: 1, cleared: 0, blessings: [], choices: null, curse: curseFor(now).id, hpPct: 1, startedAt: now };
  return { ok: true, run: state.rift.run };
}

// Sum of blessing mods for the run (stats.js applies these only in rift battles).
export function runMods(run) {
  const m = {};
  if (!run) return m;
  for (const id of run.blessings) for (const [k, v] of Object.entries(BLESSINGS[id].mod)) m[k] = (m[k] || 0) + v;
  return m;
}

export function floorConfig(state, run) {
  const unlocked = REGIONS.filter((r) => state.progression.unlockedRegions.includes(r.id));
  const rng = makeRng(hashString(run.id + ':' + run.floor));
  const region = unlocked[Math.floor(rng() * unlocked.length)] || REGIONS[0];
  const level = Math.max(3, state.player.level + RIFT.levelOffset + RIFT.levelPerFloor * (run.floor - 1));
  return { floor: run.floor, region: region.id, bg: region.bg, monsters: region.monsters, level, killTarget: RIFT.killTarget,
    timeSec: RIFT.timeSec, statMul: 1 + RIFT.statPerFloor * (run.floor - 1), curse: run.curse, eliteRush: run.floor % 5 === 0 };
}

export function rollChoices(runId, floor) {
  const rng = makeRng(hashString(runId + ':choice:' + floor));
  const ids = Object.keys(BLESSINGS);
  const out = [];
  while (out.length < 3) {
    const pickR = (() => { const x = rng() * 100; return x < RARITY_W.epic ? 'epic' : x < RARITY_W.epic + RARITY_W.rare ? 'rare' : 'common'; })();
    const pool = ids.filter((id) => BLESSINGS[id].r === pickR && !out.includes(id));
    const pool2 = pool.length ? pool : ids.filter((id) => !out.includes(id));
    out.push(pool2[Math.floor(rng() * pool2.length)]);
  }
  return out;
}

// Floor result (from Game.finishSession). win → choices; loss → the run ends.
export function finishFloor(state, runId, win, hpPct, now, rng, skills = []) {
  const run = state.rift.run;
  if (!run || run.id !== runId) return { ok: false, reason: 'duplicate' };
  if (!win) return { ...endRun(state, now, rng, skills), win: false, floor: run.floor };
  run.cleared = run.floor;
  state.rift.best = Math.max(state.rift.best, run.cleared);
  if (run.cleared >= RIFT.maxFloor) return { ...endRun(state, now, rng, skills), win: true, floor: run.floor, complete: true };
  const mods = runMods(run);
  const heal = run.curse === 'c_famine' ? 0 : RIFT.healOnClear + (mods.clearHeal || 0);
  run.hpPct = Math.min(1, Math.max(0.05, hpPct) + heal);
  run.choices = rollChoices(run.id, run.floor);
  return { ok: true, win: true, floor: run.floor, choices: run.choices, best: state.rift.best };
}

export function pickBlessing(state, id) {
  const run = state.rift.run;
  if (!run || !run.choices) return { ok: false, reason: 'none' };
  if (!run.choices.includes(id)) return { ok: false, reason: 'choice' };
  run.blessings.push(id);
  run.choices = null;
  run.floor += 1;
  return { ok: true, id, floor: run.floor };
}

export function rewardFor(state, cleared, run) {
  const R = RIFT.rewards;
  const mul = 1 + (runMods(run).riftReward || 0);
  const gpm = killRewards(Math.max(1, state.player.level)).gold * 20;
  return {
    gem: Math.floor(R.gemPerFloor * cleared * mul),
    ore: Math.floor(R.orePerFloor * cleared * mul),
    gold: Math.floor(gpm * R.goldMinPerFloor * cleared * mul),
    books: Math.floor(cleared / R.booksEvery),
    essence: Math.floor(cleared / R.essenceEvery),
  };
}

// Ends the run and grants rewards once. `skills` = skills that can take books.
export function endRun(state, now, rng, skills = []) {
  const run = state.rift.run;
  if (!run) return { ok: false, reason: 'none' };
  if (!markTx(state, run.id + ':end')) { state.rift.run = null; return { ok: false, reason: 'duplicate' }; }
  const rw = rewardFor(state, run.cleared, run);
  state.wallet.gem += rw.gem; state.wallet.ore += rw.ore; state.wallet.gold += rw.gold;
  const bookMap = {};
  if (rw.books && skills.length) for (let i = 0; i < rw.books; i++) { const id = skills[Math.floor(rng() * skills.length)]; bookMap[id] = (bookMap[id] || 0) + 1; state.skills.books[id] = (state.skills.books[id] || 0) + 1; }
  if (rw.essence && state.rebirth) { state.rebirth.essence += rw.essence; state.rebirth.totalEssence += rw.essence; }
  state.rift.best = Math.max(state.rift.best, run.cleared);
  state.rift.run = null;
  return { ok: true, ended: true, cleared: run.cleared, reward: rw, bookMap, blessings: run.blessings };
}
