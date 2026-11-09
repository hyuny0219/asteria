// 지역 보스 반복 처치: 하루 3회 (KST 자정 초기화, 모든 보스·난이도 공유).
// 아직 못 잡은 보스(그 난이도 첫 처치)는 횟수 없이 몇 번이든 도전할 수 있어요 — 진행이 막히지 않게.
// 횟수는 반복 처치에 '이겼을 때'만 줄어듭니다(지거나 앱을 꺼도 그대로). 0회면 반복 도전은 못 해요.
import { kstDayIndex } from './util.js';
import * as DF from './difficulty.js';

export const BOSS_DAILY = 3;
export const defaultBossDaily = () => ({ day: null, used: 0 });
export function refresh(state, now) {
  const b = state.bossDaily && typeof state.bossDaily === 'object' ? state.bossDaily : (state.bossDaily = defaultBossDaily());
  const today = kstDayIndex(now);
  if (b.day !== today) { b.day = today; b.used = 0; }
  b.used = Math.max(0, Math.min(BOSS_DAILY, Number(b.used) || 0));
  return b;
}
export const left = (state, now) => BOSS_DAILY - refresh(state, now).used;
export const isRepeat = (state, bossId, d = DF.curDiff(state)) => !!DF.track(state, d).bossCleared[bossId];
export function consume(state, now) {
  const b = refresh(state, now);
  if (b.used >= BOSS_DAILY) return false;
  b.used += 1;
  return true;
}
