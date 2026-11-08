// v12 탈것 · 날개 data. Bonuses are fractions (0.03 = +3%) at Lv 1 ★1; see core/steeds.js for scaling.
// Grade drives summon odds and base stats. `fx` is the kind-specific bonus.
export const STEED_GRADES = Object.freeze({
  rare: { name: '희귀', base: 0.02, color: '#74B8FF' },
  epic: { name: '영웅', base: 0.03, color: '#B784F5' },
  legendary: { name: '전설', base: 0.045, color: '#F2A04A' },
  mythic: { name: '신화', base: 0.06, color: '#F0506E' },
});
export const MOUNTS = Object.freeze({
  horse: { name: '검은 군마', grade: 'rare', fx: { goldPct: 0.05 }, color: '#2B2230', icon: 0 },
  wolf: { name: '은빛 늑대', grade: 'rare', fx: { expPct: 0.04 }, color: '#B9C2D6', icon: 1 },
  lizard: { name: '사막 도마뱀', grade: 'epic', fx: { goldPct: 0.08 }, color: '#C99A4A', icon: 2 },
  elk: { name: '설원 큰사슴', grade: 'epic', fx: { offlinePct: 0.04 }, color: '#9FD3E8', icon: 3 },
  skelhorse: { name: '불꽃 해골마', grade: 'legendary', fx: { atkPct: 0.03 }, color: '#F07A3A', icon: 4 },
  griffin: { name: '그리폰', grade: 'legendary', fx: { expeditionCut: 0.1 }, color: '#D8B675', icon: 5 },
  unicorn: { name: '별빛 유니콘', grade: 'mythic', fx: { expPct: 0.08 }, color: '#C9A6FF', icon: 6 },
  nightmare: { name: '심연의 악몽마', grade: 'mythic', fx: { critDmg: 0.12 }, color: '#5A2A6A', icon: 7 },
});
export const WINGS = Object.freeze({
  rose: { name: '흑장미 깃털 날개', grade: 'rare', fx: { critChance: 0.015 }, color: '#7A1F3A', icon: 8 },
  angel: { name: '천사의 백금 날개', grade: 'rare', fx: { hpPct: 0.04 }, color: '#F3E7C9', icon: 9 },
  bat: { name: '박쥐 가죽 날개', grade: 'epic', fx: { lifesteal: 0.008 }, color: '#3A2A3E', icon: 10 },
  fairy: { name: '나비 요정 날개', grade: 'epic', fx: { cdr: 0.03 }, color: '#B98BFF', icon: 11 },
  phoenix: { name: '불사조 불꽃 날개', grade: 'legendary', fx: { atkPct: 0.03 }, color: '#FF8A3A', icon: 12 },
  ice: { name: '얼음 결정 날개', grade: 'legendary', fx: { defPct: 0.06 }, color: '#9FE3FF', icon: 13 },
  star: { name: '별자리 날개', grade: 'mythic', fx: { critDmg: 0.1 }, color: '#29204A', icon: 14 },
  abyss: { name: '심연의 촉수 날개', grade: 'mythic', fx: { aspd: 0.05 }, color: '#4A2060', icon: 15 },
});
// mount: hp + atk from grade base; wing: atk from grade base
export const STEED = Object.freeze({
  maxLevel: 50, levelPer: 0.04,                       // +4% of the bonus per level
  starMul: [1, 1.2, 1.45, 1.75, 2.1], starShards: [10, 20, 40, 80],   // ★1→2 … ★4→5
  levelCost: (lv) => Math.ceil(4 + lv * 1.5),          // food / feathers for Lv lv → lv+1
  summon: {
    rates: { rare: 0.6, epic: 0.3, legendary: 0.09, mythic: 0.01 },
    gem: 120, gem10: 1100, pity: 60,                    // legendary+ guaranteed on the 60th summon without one
    dupShards: 10,
    mats10: 30,                                         // every summon also gives 3 food / feathers (30 per 10)
  },
});
export const FX_NAMES = Object.freeze({ goldPct: '골드 획득', expPct: '경험치 획득', offlinePct: '방치 보상', atkPct: '공격력', hpPct: '최대 HP', defPct: '방어력',
  critChance: '치명타 확률', critDmg: '치명타 피해', cdr: '스킬 쿨타임 감소', aspd: '공격 속도', lifesteal: '흡혈', expeditionCut: '원정 시간 단축' });
