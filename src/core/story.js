// v14 이야기 진행 기록. state.story.seen = { 'r:meadow': ts, 'd:normal': ts, 'b:B01': ts, end: ts }.
// 지역 소개는 이지에서 처음 들어간 지역마다, 난이도 도입은 노말·하드에 처음 들어갈 때 한 번.
// 보스 기록·엔딩은 첫 처치 결과(transact) 안에서 기록됩니다.
import { REGIONS } from '../data/content.js';
import { REGION_STORY, DIFF_STORY, ENDING } from '../data/story.js';
import * as DF from './difficulty.js';

export { REGION_STORY, DIFF_STORY, ENDING };
export const defaultStory = () => ({ seen: {} });
function st(state) {
  if (!state.story || typeof state.story !== 'object' || !state.story.seen || typeof state.story.seen !== 'object') state.story = defaultStory();
  return state.story;
}
export const seen = (state, key) => !!st(state).seen[key];
export function markSeen(state, key, now = Date.now()) {
  const s = st(state);
  if (s.seen[key]) return false;
  s.seen[key] = now;
  return true;
}

// What should be shown on entering the current farm: a region intro (이지) or a difficulty intro.
export function pendingIntro(state) {
  const d = DF.curDiff(state);
  if (d !== 'easy') {
    const key = 'd:' + d;
    return seen(state, key) ? null : { key, kind: 'diff', diff: d, text: DIFF_STORY[d] };
  }
  const region = state.progression && state.progression.region;
  if (!REGION_STORY[region]) return null;
  const key = 'r:' + region;
  return seen(state, key) ? null : { key, kind: 'region', region, text: REGION_STORY[region].intro };
}

// Called inside the boss-result transaction on a first clear.
export function onBossFirstClear(state, bossId, d, now = Date.now()) {
  const out = {};
  if (d !== 'easy') return out;
  const region = REGIONS.find((r) => r.boss === bossId);
  if (!region || !REGION_STORY[region.id]) return out;
  if (markSeen(state, 'b:' + bossId, now)) out.lore = REGION_STORY[region.id].boss;
  if (region === REGIONS[REGIONS.length - 1] && markSeen(state, 'end', now)) out.ending = true;
  return out;
}

// Entries the player has unlocked, in reading order (for the 이야기 menu).
export function journal(state) {
  const out = [];
  for (const r of REGIONS) {
    const S = REGION_STORY[r.id];
    if (!S) continue;
    if (seen(state, 'r:' + r.id)) out.push({ key: 'r:' + r.id, kind: 'region', region: r.id, title: r.name, text: S.intro });
    if (seen(state, 'b:' + r.boss)) out.push({ key: 'b:' + r.boss, kind: 'boss', region: r.id, boss: r.boss, title: `${r.name} · 보스`, text: S.boss });
  }
  if (seen(state, 'end')) out.push({ key: 'end', kind: 'ending', title: '엔딩 · 첫 번째 새벽', text: ENDING.map((c) => c.text).join(' ') });
  for (const d of ['normal', 'hard']) if (seen(state, 'd:' + d)) out.push({ key: 'd:' + d, kind: 'diff', diff: d, title: `${DF.diffName(d)} 난이도`, text: DIFF_STORY[d] });
  return out;
}
