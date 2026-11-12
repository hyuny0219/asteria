// v18.5 초월 레벨 (1~50): 초월한 뒤 Lv 100에서 버리던 경험치가 여기 쌓입니다.
//   레벨마다 공격력·체력·방어력 +1% (곱연산, Lv 50 = ×1.5). 환생은 초월 Lv 50부터.
//   환생하면 레벨과 함께 0으로 돌아가고, 기억의 가속(경험치 ×16)으로 이전 최고 초월 레벨까지 빠르게 회복.
import { BALANCE } from '../data/balance.js';

const A = BALANCE.ascension;
export const ASC_MAX = A.maxLevel;
export const ascOpen = (state) => (state.player.tier || 0) >= 4 && state.player.level >= BALANCE.levelCap;
export const ascLevel = (state) => state.player.ascLv || 0;
export function ascExpToNext(n) { return Math.floor(A.expBase * (1 + A.expGrowth * n)); }
// 경험치 넣기 → 오른 초월 레벨 수, 남아서 버린 양
export function gainAscExp(state, amount) {
  const p = state.player;
  const res = { levels: 0, discarded: 0 };
  if (!ascOpen(state) || amount <= 0) { res.discarded = Math.max(0, amount); return res; }
  p.ascLv ||= 0; p.ascExp = (p.ascExp || 0) + amount;
  while (p.ascLv < ASC_MAX) {
    const need = ascExpToNext(p.ascLv);
    if (p.ascExp < need) break;
    p.ascExp -= need; p.ascLv += 1; res.levels += 1;
    if (p.ascLv > (p.ascPeak || 0)) p.ascPeak = p.ascLv;
  }
  if (p.ascLv >= ASC_MAX && p.ascExp > 0) { res.discarded = p.ascExp; p.ascExp = 0; }
  return res;
}
export function ascMultipliers(state) {
  const n = ascLevel(state);
  return { atk: 1 + A.perLevel.atk * n, hp: 1 + A.perLevel.hp * n, def: 1 + A.perLevel.def * n };
}
