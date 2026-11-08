// 스테이지 지도 (schema 7). Each region = 10 stages (the existing waves 1..10) + a boss
// node. A stage clears under the existing wave rule (waveKillTarget kills on that wave).
// Stars are best-ever and survive 환생; first-clear rewards are granted exactly once.
import { BALANCE } from '../data/balance.js';
import { REGIONS, REGION_BY_ID, BOSSES, waveLevel } from '../data/content.js';
import { killRewards } from './combat.js';
import { track, curDiff, firstClearMul, bossLevel } from './difficulty.js';

const ST = BALANCE.stages;
export const STAGE_COUNT = 10;
export const stageKey = (regionId, n) => `${regionId}-${n}`;          // n: 1..10 or 'boss'
export const stageLabel = (regionId, n) => n === 'boss' ? `${REGION_BY_ID[regionId].order + 1}-보스` : `${REGION_BY_ID[regionId].order + 1}-${n}`;
export function defaultStages() { return { stars: {}, claimed: {}, auto: true }; }

// Small first-clear rewards; boss nodes give more (on top of the existing boss first clear).
// 노말/하드: own first-clear rewards (× firstClearMul), gold at Lv 100.
export function stageReward(regionId, n, d = 'easy') {
  const r = REGION_BY_ID[regionId];
  const m = firstClearMul(d);
  if (n === 'boss') {
    const b = BOSSES[r.boss];
    return { gem: (ST.bossGem + ST.bossGemPerRegion * r.order) * m, ore: (ST.bossOre + ST.bossOrePerRegion * r.order) * m, gold: Math.floor(killRewards(bossLevel(d, b.id)).gold * ST.bossGoldKills * m) };
  }
  const milestone = n % 5 === 0;
  return {
    gem: (milestone ? ST.milestoneGem : ST.gem) * m,
    ore: (ST.ore + ST.orePerRegion * r.order + (milestone ? ST.ore * 2 : 0)) * m,
    gold: Math.floor(killRewards(d === 'easy' ? waveLevel(r, n) : 100).gold * ST.goldKills * m),
  };
}
export const starTimeSec = (n) => (n === 'boss' ? ST.bossStarSec : ST.starSec);
// 1★ clear · 2★ no death in that stage · 3★ no death and under the time target
export function starsFor({ deaths = 0, timeSec = Infinity }, n) {
  if (deaths > 0) return 1;
  return timeSec <= starTimeSec(n) ? 3 : 2;
}

// Record a clear inside a transaction draft. Returns what changed (reward only the first time).
// d: the difficulty the clear happened on (defaults to the current one).
export function recordClear(state, regionId, n, run, d = curDiff(state)) {
  if (!REGION_BY_ID[regionId] || !(n === 'boss' || (n >= 1 && n <= STAGE_COUNT))) return { ok: false, reason: 'missing' };
  state.stages ||= defaultStages();
  const t = track(state, d);
  const key = stageKey(regionId, n);
  const stars = starsFor(run, n);
  const prev = t.stars[key] || 0;
  if (stars > prev) t.stars[key] = stars;
  const out = { ok: true, key, diff: d, label: stageLabel(regionId, n), stars, best: Math.max(prev, stars), improved: stars > prev, first: false, reward: null };
  if (!t.claimed[key]) {
    t.claimed[key] = true;
    const rw = stageReward(regionId, n, d);
    state.wallet.gem += rw.gem; state.wallet.ore += rw.ore; state.wallet.gold += rw.gold;
    out.first = true; out.reward = rw;
  }
  return out;
}

// Node state for the map: 'cleared' | 'current' | 'locked'.
export function nodeStatus(state, regionId, n, unlocked, d = curDiff(state)) {
  if (!unlocked) return 'locked';
  const p = track(state, d);
  const max = p.maxWave[regionId] || 1;
  const stars = p.stars;
  if (n === 'boss') {
    if (p.bossCleared[REGION_BY_ID[regionId].boss]) return 'cleared';
    return max >= STAGE_COUNT ? 'current' : 'locked';
  }
  if (n < max) return 'cleared';
  if (n === max) return n === STAGE_COUNT && stars[stageKey(regionId, n)] ? 'cleared' : 'current';
  return 'locked';
}
export function regionStars(state, regionId, d = curDiff(state)) {
  const stars = track(state, d).stars;
  let got = 0;
  for (let n = 1; n <= STAGE_COUNT; n++) got += stars[stageKey(regionId, n)] || 0;
  got += stars[stageKey(regionId, 'boss')] || 0;
  return { got, max: (STAGE_COUNT + 1) * 3 };
}

// Existing saves (schema 6 → 7): progress already made counts as 1★ cleared with its
// first-clear reward marked received — no retroactive windfall.
export function stagesFromProgress(state) {
  const st = defaultStages();
  const p = state.progression;
  st.auto = p.autoAdvance !== false;
  for (const r of REGIONS) {
    const max = p.maxWave[r.id] || 0;
    const boss = !!p.bossCleared[r.boss];
    const upto = boss ? STAGE_COUNT : max - 1;
    for (let n = 1; n <= upto; n++) { st.stars[stageKey(r.id, n)] = 1; st.claimed[stageKey(r.id, n)] = true; }
    if (boss) { st.stars[stageKey(r.id, 'boss')] = 1; st.claimed[stageKey(r.id, 'boss')] = true; }
  }
  return st;
}
