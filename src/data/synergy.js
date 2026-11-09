// v14 스킬 시너지: 스킬마다 속성·상태 태그, 태그끼리 맞물리면 콤보가 터집니다.
// 태그 효과(스킬로 적중했을 때만, 기본 공격 제외):
//   화염 → 화상(초당 피해) · 빙결 → 냉기 1중첩(공격 둔화), 3중첩이면 잠깐 얼어붙음
//   출혈 → 출혈 1중첩(초당 피해, 최대 5) · 번개 → 시전마다 다른 적 1명에게 번개가 한 번 더 튐
//   독 · 그림자 · 신성 · 폭발 · 야수 · 정밀 · 비전 · 바람 → 콤보 조건으로만 쓰임
// 수치는 tools/balance_sim_v4.mjs로 맞춤 (docs/BALANCE_CHANGES.md v14).

export const TAGS = Object.freeze({
  fire: { name: '화염', color: '#FF8A4C' },
  frost: { name: '빙결', color: '#8FD3FF' },
  lightning: { name: '번개', color: '#F5E27A' },
  bleed: { name: '출혈', color: '#E2556B' },
  poison: { name: '독', color: '#8BD46A' },
  shadow: { name: '그림자', color: '#B49CF0' },
  holy: { name: '신성', color: '#FFE6A3' },
  explode: { name: '폭발', color: '#FFB36B' },
  beast: { name: '야수', color: '#D9A86C' },
  precise: { name: '정밀', color: '#9FE3D6' },
  arcane: { name: '비전', color: '#C3B5FF' },
  wind: { name: '바람', color: '#BFEAD8' },
});

// every skill (incl. buffs / shields / dodges, which only show the chip)
export const SKILL_TAGS = Object.freeze({
  strike: ['bleed'], shieldCharge: ['holy'], warCry: ['holy'], guardCounter: ['holy'],
  berserkStrike: ['bleed'], w_judgement: ['holy'], w_whirl: ['bleed'], starSlash: ['holy', 'explode'],
  m_fireball: ['fire', 'explode'], m_frost: ['frost'], m_shield: ['arcane'], m_chain: ['lightning'],
  m_curse: ['shadow', 'poison'], m_blizzard: ['frost'], m_drain: ['shadow'], m_meteor: ['fire', 'explode'],
  a_aim: ['precise'], a_multi: ['bleed'], a_leap: ['wind'], a_pierce: ['precise', 'lightning'],
  a_beast: ['beast', 'bleed'], a_snipe: ['precise'], a_pack: ['beast'], a_rain: ['bleed'],
  r_stab: ['bleed'], r_poison: ['poison'], r_shadow: ['shadow'], r_execute: ['shadow'],
  r_smoke: ['poison', 'shadow'], r_shadowstrike: ['shadow', 'bleed'], r_illusion: ['shadow'], r_blades: ['bleed'],
});

// combo numbers (coef = × hero attack; *Mul = bonus to that hit). Tuned with balance_sim_v4.
export const TUNE = Object.freeze({
  igniteMul: 0.25, steam: 0.2, shatter: 0.2, shatterFrozen: 0.4, shockMul: 0.15,
  hemorrhage: 1.8, gangrene: 0.6, weakMul: 0.3, judgement: 1.4, instinctMul: 0.15, rupturePer: 0.25,
});
// status numbers (coef = × hero attack, like skills)
export const STATUS = Object.freeze({
  burn: { coefPerSec: 0.08, sec: 4 },
  chill: { slowMul: 0.8, sec: 4, freezeAt: 3, freezeSec: 1.2, bossFreezeSec: 0.4 },
  bleed: { coefPerSec: 0.08, sec: 5, max: 5 },
  chain: { coefMul: 0.5 },
});

// combos. need = tags the equipped kit must cover (for the "can make" list on the skill screen).
// text is shown in the codex once discovered; hint before that.
export const COMBOS = Object.freeze({
  ignite: { id: 'ignite', name: '연소 폭발', need: ['fire', 'explode'], color: '#FF8A4C',
    text: '화상 입은 적에게 폭발 스킬이 맞으면 그 타격 피해 +25%, 화상이 주변 적에게 번집니다.', hint: '불붙은 적을 터뜨려 보세요.' },
  shatter: { id: 'shatter', name: '얼음 파편', need: ['frost'], color: '#8FD3FF',
    text: '냉기·빙결 상태의 적을 처치하면 파편이 튀어 다른 모든 적에게 공격력 ×0.2(얼어 있었다면 ×0.4) 피해.', hint: '차갑게 식은 적을 쓰러뜨리면…' },
  hemorrhage: { id: 'hemorrhage', name: '출혈 폭발', need: ['bleed'], color: '#E2556B',
    text: '출혈이 3중첩 쌓이면 터져서 공격력 ×1.8 피해를 주고 중첩이 사라집니다. (여러 번 때리는 스킬도 한 번 시전에 1중첩)', hint: '상처를 계속 벌려 보세요.' },
  shock: { id: 'shock', name: '감전', need: ['lightning', 'frost'], color: '#F5E27A',
    text: '냉기 걸린 적에게 번개가 맞으면 40% 확률로 0.8초 기절하고 그 타격 피해 +15%.', hint: '젖고 차가운 적은 전기가 잘 통해요.' },
  steam: { id: 'steam', name: '증기 폭발', need: ['fire', 'frost'], color: '#F2F2F2',
    text: '냉기 걸린 적에게 화염이 맞으면 냉기가 터지며 모든 적에게 공격력 ×0.2 피해.', hint: '불과 얼음을 한 적에게.' },
  gangrene: { id: 'gangrene', name: '괴저', need: ['poison', 'bleed'], color: '#8BD46A',
    text: '독에 걸린 적에게 출혈이 쌓이면 즉시 공격력 ×0.6 피해와 출혈 1중첩 추가.', hint: '독이 퍼진 상처에 칼을…' },
  weakpoint: { id: 'weakpoint', name: '약점 공략', need: ['shadow|precise'], color: '#B49CF0',
    text: '상태 이상이 2종류 이상 걸린 적에게 그림자·정밀 스킬이 맞으면 확정 치명타, 피해 +30%.', hint: '약해진 적의 빈틈을 노리세요.' },
  judgement: { id: 'judgement', name: '신성 심판', need: ['holy'], color: '#FFE6A3',
    text: '기절·빙결된 적에게 신성 스킬이 맞으면 공격력 ×1.4 추가 피해, 최대 HP 2% 회복.', hint: '움직이지 못하는 적에게 빛을.' },
  instinct: { id: 'instinct', name: '야수 본능', need: ['beast', 'bleed'], color: '#D9A86C',
    text: '피 흘리는 적에게 야수 스킬이 맞으면 피해 +15%, 출혈 1중첩 추가.', hint: '야수는 피 냄새를 맡아요.' },
  rupture: { id: 'rupture', name: '파열', need: ['explode', 'bleed'], color: '#FF6B6B',
    text: '출혈 중인 적에게 폭발 스킬이 맞으면 출혈 중첩당 피해 +25%, 중첩을 모두 소모합니다.', hint: '깊은 상처에 충격을 주면…' },
});
export const COMBO_IDS = Object.freeze(Object.keys(COMBOS));
// first discovery: small one-time reward + pass xp
export const FIRST_REWARD = Object.freeze({ gem: 30, passXp: 8 });
export const tagsOf = (id) => SKILL_TAGS[id] || [];
