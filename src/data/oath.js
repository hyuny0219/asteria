// v15 초월 서약: 4차 전직(초월) 때 직업별 2개 중 1개를 고릅니다. 나중에 골드로 바꿀 수 있어요.
// pct  → stats.js 퍼센트 풀에 그대로 더함 (lifesteal, dmgTaken, aspd, critDmg, critChance, cdr, combo, atkPct …)
// fx   → combat.js 전투 효과: lowHpGuard(HP 35% 미만 받는 피해 −), bossMul(보스 피해 +), synMul(시너지 콤보 피해 ×), dotMul(지속 피해 ×)
export const OATHS = Object.freeze({
  warrior: [
    { id: 'w_unyield', name: '불굴', desc: '흡혈 +4% · 받는 피해 −6%. HP 35% 미만이면 받는 피해 25% 추가 감소.', pct: { lifesteal: 0.04, dmgTaken: 0.06 }, fx: { lowHpGuard: 0.25 } },
    { id: 'w_ruin', name: '파괴', desc: '공격력 +6% · 보스에게 주는 피해 +20%.', pct: { atkPct: 0.06 }, fx: { bossMul: 0.2 } },
  ],
  mage: [
    { id: 'm_reson', name: '원소 공명', desc: '시너지 콤보 피해 +50% · 공격력 +4%.', pct: { atkPct: 0.04 }, fx: { synMul: 1.5 } },
    { id: 'm_warp', name: '시간 왜곡', desc: '재사용 대기 −12% · 궁극기 충전 +10%.', pct: { cdr: 0.12, ultCharge: 0.1 }, fx: {} },
  ],
  archer: [
    { id: 'a_rapid', name: '연사', desc: '공격 속도 +15%.', pct: { aspd: 0.15 }, fx: {} },
    { id: 'a_snipe', name: '저격', desc: '치명 피해 +40% · 치명타 +4%.', pct: { critDmg: 0.4, critChance: 0.04 }, fx: {} },
  ],
  rogue: [
    { id: 'r_clone', name: '그림자 분신', desc: '기본 공격이 20% 확률로 한 번 더 들어감.', pct: { combo: 0.2 }, fx: {} },
    { id: 'r_venom', name: '맹독', desc: '지속 피해(독·출혈·화상) +45%.', pct: {}, fx: { dotMul: 1.45 } },
  ],
});
export const OATH_BY_ID = Object.freeze(Object.fromEntries(Object.values(OATHS).flat().map((e) => [e.id, e])));
export const OATH_CHANGE_GOLD_MIN = 60;   // 바꿀 때 골드 = 분당 골드 × 60 (처음 고를 때는 무료)
