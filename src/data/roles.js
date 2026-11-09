// v14 몬스터 역할 · 정예 접두사 (그림은 기존 몬스터 그대로, 이름표에 표시).
// 역할은 레벨에 따라 열립니다: Lv 20 이하 돌격만 → Lv 21–30 사수 추가 → Lv 31+ (4지역~) 치유사·자폭병까지.
// 보스·필드 보스·희귀 정예·분열 조각에는 역할이 없습니다.
export const ROLES = Object.freeze({
  charge: { id: 'charge', name: '돌격', glyph: '⚔', hp: 1.05, atk: 1 },
  archer: { id: 'archer', name: '사수', glyph: '➶', hp: 0.6, atk: 0.65, backFull: true },          // 뒷줄에서도 공격력 100% (sideAtkMul 예외)
  healer: { id: 'healer', name: '치유사', glyph: '✚', hp: 0.75, atk: 0.5, healEverySec: 4, healPct: 0.08 },   // 4초마다 가장 다친 아군 최대 체력 8% 회복
  bomber: { id: 'bomber', name: '자폭병', glyph: '✹', hp: 0.5, atk: 1, blastMult: 1.6, blastMs: 1100 },       // 맨 앞에 서면 1.1초 예고 후 큰 폭발, 스스로 쓰러짐
});
// [최소 레벨, 가중치] — 레벨 조건을 넘은 역할 중 가중치로 하나
export const ROLE_TABLE = Object.freeze([
  ['charge', 1, 55],
  ['archer', 21, 20],
  ['healer', 31, 12],
  ['bomber', 31, 13],
]);
export const PREFIXES = Object.freeze({
  swift: { id: 'swift', name: '빠른', text: '공격 속도 ×1.4' , atkSpeed: 1.4 },
  tough: { id: 'tough', name: '단단한', text: '체력 ×1.6', hp: 1.6 },
  vamp: { id: 'vamp', name: '흡혈하는', text: '준 피해의 50% 회복', lifesteal: 0.5 },
  split: { id: 'split', name: '분열하는', text: '쓰러지면 작은 조각 2마리(체력 25%·공격 60%)', split: { n: 2, hp: 0.25, atk: 0.6 } },
  thorns: { id: 'thorns', name: '가시', text: '받은 피해의 6%를 되돌림(한 번에 최대 영웅 체력 2%)', reflect: 0.06, reflectCap: 0.02 },
});
export const PREFIX_IDS = Object.keys(PREFIXES);
