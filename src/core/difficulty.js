// 난이도 트랙 (schema 9). 이지 = the original progression (state.progression + state.stages,
// which every other system keeps reading: dungeon/tower/raid/world boss unlocks, achievements).
// 노말/하드 keep their own copy of the stage progress in state.diff.tracks[d]; the farm
// position (progression.region / wave) is swapped in and out when the player switches.
import { REGIONS, REGION_BY_ID, BOSSES, waveLevel } from '../data/content.js';
import { DIFFICULTY, DIFF_IDS } from '../data/difficulty.js';

export { DIFFICULTY, DIFF_IDS };
export const defaultTrack = () => ({ region: REGIONS[0].id, wave: 1, maxWave: { [REGIONS[0].id]: 1 }, unlockedRegions: [REGIONS[0].id], bossCleared: {}, stars: {}, claimed: {} });
export const defaultDiff = () => ({ cur: 'easy', easyPos: null, tracks: { normal: defaultTrack(), hard: defaultTrack() } });

export const curDiff = (state) => (state.diff && DIFFICULTY[state.diff.cur] ? state.diff.cur : 'easy');
export const isEasy = (state) => curDiff(state) === 'easy';
export const diffName = (d) => DIFFICULTY[d].name;

// Stage progress of difficulty `d` (live references — writes land in the save).
export function track(state, d = curDiff(state)) {
  if (d === 'easy') {
    state.stages ||= { stars: {}, claimed: {}, auto: true };
    const p = state.progression;
    return { maxWave: p.maxWave, unlockedRegions: p.unlockedRegions, bossCleared: p.bossCleared, stars: state.stages.stars, claimed: state.stages.claimed };
  }
  state.diff ||= defaultDiff();
  state.diff.tracks[d] ||= defaultTrack();
  return state.diff.tracks[d];
}

// 노말 opens when 이지's 1막 last boss (심연의 군주) is down; 하드 when 노말's is.
// v19: 2막(11~20)은 각 난이도 안에서 10지역 보스 다음에 이어지고, 다음 난이도 해금 조건은 그대로 1막 끝.
export const ACT1_LAST = 'void';
export const lastRegion = () => REGION_BY_ID[ACT1_LAST];
export const finalRegion = () => REGIONS[REGIONS.length - 1];
export const actOf = (regionId) => (REGION_BY_ID[regionId] && REGION_BY_ID[regionId].act) || 1;
export function diffOpen(state, d) {
  const o = DIFFICULTY[d].order;
  if (o === 0) return true;
  const prev = DIFF_IDS[o - 1];
  return !!track(state, prev).bossCleared[lastRegion().boss];
}
export const lockText = (d) => {
  const prev = DIFF_IDS[DIFFICULTY[d].order - 1];
  return `${diffName(prev)} ${BOSSES[lastRegion().boss].name} 처치 시 열림`;
};

// Switch difficulty: park the current farm position on the old track, restore the new one.
export function switchDiff(state, d) {
  if (!DIFFICULTY[d]) return { ok: false, reason: 'missing' };
  if (!diffOpen(state, d)) return { ok: false, reason: 'locked' };
  if (state.player.level < (DIFFICULTY[d].minPlayerLevel || 0)) return { ok: false, reason: 'level', need: DIFFICULTY[d].minPlayerLevel };
  state.diff ||= defaultDiff();
  const from = curDiff(state);
  if (from === d) return { ok: false, reason: 'same' };
  const p = state.progression;
  if (from === 'easy') state.diff.easyPos = { region: p.region, wave: p.wave };
  else { const t = track(state, from); t.region = p.region; t.wave = p.wave; }
  state.diff.cur = d;
  const pos = d === 'easy' ? (state.diff.easyPos || { region: p.region, wave: p.wave }) : track(state, d);
  const t = track(state, d);
  const region = t.unlockedRegions.includes(pos.region) ? pos.region : t.unlockedRegions[t.unlockedRegions.length - 1];
  p.region = region;
  p.wave = Math.max(1, Math.min(pos.region === region ? pos.wave : 1, t.maxWave[region] || 1));
  p.waveKills = 0; p.holdKills = 0; p.waveDeaths = 0;
  return { ok: true, from, to: d, region: p.region, wave: p.wave };
}

// Enemy scaling on 노말/하드. n: 1..10 or 'boss'.
export const stepIndex = (regionId, n) => REGION_BY_ID[regionId].order * 11 + (n === 'boss' ? 10 : n - 1);
const ACT1_STEPS = 109;   // 1막 마지막 step (10지역 보스)
export function enemyMul(d, regionId, n) {
  const D = DIFFICULTY[d];
  const i = stepIndex(regionId, n);
  const extra = Math.max(0, i - ACT1_STEPS);   // 2막 step 수
  if (d === 'easy') {
    if (!extra) return null;                   // 1막 이지는 레벨 곡선 그대로
    const g = Math.pow(D.act2.growth, extra);
    return { hp: D.act2.hp * g, atk: D.act2.atk * g };
  }
  const bm = n === 'boss' && D.boss ? D.boss : { hp: 1, atk: 1 };
  const g2 = D.act2 ? Math.pow(D.act2.growth, extra) : 1;
  const base = Math.min(i, ACT1_STEPS);
  return { hp: D.hp.base * Math.pow(D.hp.growth, base) * bm.hp * g2, atk: D.atk.base * Math.pow(D.atk.growth, base) * bm.atk * g2 };
}
export const farmLevel = (d, regionId, wave) => (d === 'easy' ? waveLevel(regionId, wave) : DIFFICULTY[d].level);
export const bossLevel = (d, bossId) => (d === 'easy' ? BOSSES[bossId].level : DIFFICULTY[d].level);
export const rewardMul = (d) => (d === 'easy' ? { gold: 1, exp: 1, drop: 1 } : { gold: DIFFICULTY[d].gold, exp: DIFFICULTY[d].exp, drop: DIFFICULTY[d].drop });
export const firstClearMul = (d) => (d === 'easy' ? 1 : DIFFICULTY[d].firstClear);
// "노말 3-7" (이지 has no prefix)
export const prefix = (d) => (d === 'easy' ? '' : diffName(d) + ' ');
