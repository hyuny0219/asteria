// v16 전직별 스킬 진화: 기본 스킬 3개 + 궁극기가 갈래(8)마다 1~4차에서 모습을 바꿉니다.
// 한 칸 = 그 단계의 완성형(누적이 아니라 그 단계 폼이 기본 정의 위에 덮어씀).
// 덮어쓰는 값은 전투가 이미 아는 것만: coef · cd · hits · target(single|all|spread) · critBonus ·
//   executeBelow · guard{sec,reduce} · stunSec · slow{mul,sec} · dot{coefPerSec,sec} · heal ·
//   buff{stat,mul,sec} · shield{pct,sec} · evade{sec,nextCrit} 와 v16 보조값
//   lifesteal(준 피해의 비율 회복) · shieldPct(시전 시 보호막, 최대 HP 비율) · critStacks(다음 n번 치명) ·
//   stunAll · slowAll{mul,sec}(버프·보호·회피 스킬의 주변 효과) · atkBuff{mul,sec}(회피 스킬의 공격 버프) ·
//   splash(단일 스킬이 맞힌 대상 말고 주변 적에게 주는 피해 비율 — 보스 한 마리 상대로는 약해지지 않게).
// tags = 시너지 태그(src/data/synergy.js TAGS) — 진화하면 태그가 바뀌어 맞는 콤보도 달라집니다.
// 궁극기는 전직 단계 배율(×1.5/×2/×2.5)이 따로 붙으므로 계수 대신 타수·범위·부가효과로 바꿉니다.
// 수치는 tools/balance_sim_v4.mjs로 맞춤 (docs/BALANCE_CHANGES.md v16, 전사·도적 쪽으로 조금 더).

const f = (name, tint, tags, desc, o = {}) => Object.freeze({ name, tint, tags, desc, ...o });

// 갈래별 대표색
const C = {
  knight: '#FFD27A', berserker: '#E2556B', wizard: '#8FD3FF', warlock: '#B49CF0',
  ranger: '#9FE3D6', hunter: '#D9A86C', assassin: '#FF6B8A', trickster: '#C3B5FF',
};

export const SKILL_FORMS = Object.freeze({
  // ===================== 전사 =====================
  strike: {
    knight: [
      f('방패 강타', C.knight, ['holy'], '방패로 내리쳐 피해를 주고 1.5초간 받는 피해 25% 감소.', { coef: 2.3, guard: { sec: 1.5, reduce: 0.25 } }),
      f('성광 강타', C.knight, ['holy', 'explode'], '내리친 자리에서 빛이 터져 주변 적에게도 35% 피해.', { coef: 2.4, splash: 0.35 }),
      f('심판의 일격', C.knight, ['holy'], '내려찍어 1.2초 기절시키고 최대 HP 2% 회복.', { coef: 2.8, stunSec: 1.2, heal: 0.02 }),
      f('여명 붕괴', C.knight, ['holy', 'explode'], '여명의 빛이 무너져 1초 기절, 주변 적에게 45% 피해, 2초간 받는 피해 30% 감소.', { coef: 3.0, splash: 0.45, stunSec: 1, guard: { sec: 2, reduce: 0.3 } }),
    ],
    berserker: [
      f('처형 일격', C.berserker, ['bleed'], '체력 30% 이하의 적에게 2배 피해.', { coef: 2.4, executeBelow: 0.3 }),
      f('피의 일격', C.berserker, ['bleed'], '깊게 베어 4초간 출혈 피해, 처형 30%.', { coef: 2.5, executeBelow: 0.3, dot: { coefPerSec: 0.3, sec: 4 } }),
      f('학살', C.berserker, ['bleed'], '두 번 연속 베고 준 피해의 10%를 회복, 처형 35%.', { coef: 1.6, hits: 2, executeBelow: 0.35, lifesteal: 0.1 }),
      f('혈월 참수', C.berserker, ['bleed', 'explode'], '혈월 아래 두 번 참수. 처형 40%, 출혈, 흡혈 12%.', { coef: 2.0, hits: 2, executeBelow: 0.4, lifesteal: 0.12, dot: { coefPerSec: 0.4, sec: 4 } }),
    ],
  },
  shieldCharge: {
    knight: [
      f('수호 돌진', C.knight, ['holy'], '돌진해 2.5초간 받는 피해 45% 감소.', { coef: 1.6, guard: { sec: 2.5, reduce: 0.45 } }),
      f('성벽 돌진', C.knight, ['holy'], '성벽처럼 들이받아 0.8초 기절, 3초간 피해 50% 감소.', { coef: 1.8, stunSec: 0.8, guard: { sec: 3, reduce: 0.5 } }),
      f('맹세의 돌진', C.knight, ['holy'], '기절 1초, 3초간 피해 50% 감소, 최대 HP 8% 보호막.', { coef: 2.0, stunSec: 1, guard: { sec: 3, reduce: 0.5 }, shieldPct: 0.08 }),
      f('여명의 성벽', C.knight, ['holy', 'explode'], '밀어내며 1초 기절, 주변 적에게 45% 피해, 4초간 피해 55% 감소, 보호막 12%.', { coef: 2.2, splash: 0.45, stunSec: 1, guard: { sec: 4, reduce: 0.55 }, shieldPct: 0.12 }),
    ],
    berserker: [
      f('광폭 돌진', C.berserker, ['bleed'], '거칠게 들이받아 큰 피해, 1.5초간 피해 30% 감소.', { coef: 2.0, guard: { sec: 1.5, reduce: 0.3 } }),
      f('전장 돌파', C.berserker, ['bleed'], '적진을 가르며 주변 적에게도 35% 피해.', { coef: 2.0, splash: 0.35 }),
      f('피의 쇄도', C.berserker, ['bleed'], '주변 적에게도 35% 피해, 출혈, 준 피해 5% 회복.', { coef: 2.1, splash: 0.35, dot: { coefPerSec: 0.25, sec: 4 }, lifesteal: 0.05 }),
      f('폭군의 진격', C.berserker, ['bleed', 'explode'], '짓밟아 0.8초 기절·출혈, 주변 적에게 45% 피해, 흡혈 8%.', { coef: 2.3, splash: 0.45, stunSec: 0.8, dot: { coefPerSec: 0.3, sec: 4 }, lifesteal: 0.08 }),
    ],
  },
  warCry: {
    knight: [
      f('기사의 서약', C.knight, ['holy'], '8초간 공격력 20% 증가, 6초간 받는 피해 15% 감소.', { buff: { stat: 'atk', mul: 0.2, sec: 8 }, guard: { sec: 6, reduce: 0.15 } }),
      f('성가', C.knight, ['holy'], '8초간 공격력 22% 증가, 최대 HP 5% 회복.', { buff: { stat: 'atk', mul: 0.22, sec: 8 }, heal: 0.05 }),
      f('성전의 외침', C.knight, ['holy'], '9초간 공격력 24% 증가, 최대 HP 10% 보호막.', { buff: { stat: 'atk', mul: 0.24, sec: 9 }, shieldPct: 0.1 }),
      f('여명의 찬가', C.knight, ['holy'], '9초간 공격력 27%, 보호막 15%, 모든 적 1초 기절.', { buff: { stat: 'atk', mul: 0.27, sec: 9 }, shieldPct: 0.15, stunAll: 1 }),
    ],
    berserker: [
      f('광전사의 포효', C.berserker, ['bleed'], '8초간 공격력 22% 증가.', { buff: { stat: 'atk', mul: 0.22, sec: 8 } }),
      f('전쟁의 북', C.berserker, ['bleed'], '8초간 공격력 24% 증가, 최대 HP 4% 회복.', { buff: { stat: 'atk', mul: 0.24, sec: 8 }, heal: 0.04 }),
      f('피의 갈증', C.berserker, ['bleed'], '9초간 공격력 26% 증가, 다음 2번 치명타.', { buff: { stat: 'atk', mul: 0.26, sec: 9 }, critStacks: 2 }),
      f('혈월의 포효', C.berserker, ['bleed'], '9초간 공격력 30%, 다음 3번 치명타, 모든 적 0.8초 기절.', { buff: { stat: 'atk', mul: 0.3, sec: 9 }, critStacks: 3, stunAll: 0.8 }),
    ],
  },
  starSlash: {
    knight: [
      f('성광 참격', C.knight, ['holy', 'explode'], '궁극기. 모든 적에게 빛의 참격, 2.2초 기절.', { stunSec: 2.2 }),
      f('천상의 심판', C.knight, ['holy', 'explode'], '궁극기. 모든 적에게 심판, 2.2초 기절, 최대 HP 5% 회복.', { stunSec: 2.2, heal: 0.05 }),
      f('대심판', C.knight, ['holy', 'explode'], '궁극기. 2.5초 기절, 회복 8%, 보호막 10%.', { stunSec: 2.5, heal: 0.08, shieldPct: 0.1 }),
      f('여명 강림', C.knight, ['holy', 'explode'], '궁극기. 여명이 두 번 내려쳐 2.5초 기절, 회복 10%.', { coef: 3.2, hits: 2, stunSec: 2.5, heal: 0.1 }),
    ],
    berserker: [
      f('혈참', C.berserker, ['bleed', 'explode'], '궁극기. 모든 적을 베고 출혈.', { dot: { coefPerSec: 0.4, sec: 4 } }),
      f('피의 폭풍', C.berserker, ['bleed', 'explode'], '궁극기. 피의 폭풍이 두 번 휘몰아칩니다.', { coef: 3.1, hits: 2, stunSec: 1 }),
      f('붉은 학살', C.berserker, ['bleed', 'explode'], '궁극기. 세 번 베고 처형 30%.', { coef: 2.1, hits: 3, stunSec: 1, executeBelow: 0.3 }),
      f('혈월 강림', C.berserker, ['bleed', 'explode'], '궁극기. 혈월이 세 번 내려앉아 처형 35%, 흡혈 6%.', { coef: 2.2, hits: 3, stunSec: 1, executeBelow: 0.35, lifesteal: 0.06 }),
    ],
  },

  // ===================== 마법사 =====================
  m_fireball: {
    wizard: [
      f('불꽃 폭발', C.wizard, ['fire', 'explode'], '터지는 불덩이.', { coef: 2.0 }),
      f('화염 폭풍', '#FF8A4C', ['fire', 'explode'], '불덩이가 터져 주변 적에게도 35% 피해.', { coef: 2.1, splash: 0.35 }),
      f('삼원소 탄', C.wizard, ['fire', 'frost', 'explode'], '불·얼음 탄, 주변 적에게도 40% 피해.', { coef: 2.2, splash: 0.4 }),
      f('성좌의 불꽃', '#FFE6A3', ['fire', 'frost', 'lightning', 'explode'], '세 원소의 탄, 주변 적에게도 45% 피해.', { coef: 2.3, splash: 0.45 }),
    ],
    warlock: [
      f('암흑 화살', C.warlock, ['shadow', 'fire'], '어둠의 화살, 4초간 지속 피해.', { coef: 1.9, dot: { coefPerSec: 0.3, sec: 4 } }),
      f('저주탄', C.warlock, ['shadow', 'poison'], '저주가 5초간 좀먹습니다.', { coef: 1.8, dot: { coefPerSec: 0.45, sec: 5 } }),
      f('망자의 손', C.warlock, ['shadow', 'poison'], '망자의 손이 두 번 움켜쥐고 생명을 빨아들입니다(흡혈 5%).', { coef: 1.2, hits: 2, dot: { coefPerSec: 0.5, sec: 5 }, lifesteal: 0.05 }),
      f('밤의 창', '#7F6BD8', ['shadow', 'poison', 'explode'], '밤의 창 두 자루, 6초 지속 피해.', { coef: 1.45, hits: 2, dot: { coefPerSec: 0.55, sec: 6 } }),
    ],
  },
  m_frost: {
    wizard: [
      f('빙결 고리', C.wizard, ['frost'], '모든 적을 얼려 3초간 크게 늦춥니다.', { coef: 1.5, slow: { mul: 0.55, sec: 3 } }),
      f('서리 폭풍', C.wizard, ['frost', 'wind'], '눈보라가 3.5초간 적을 묶습니다.', { coef: 1.45, slow: { mul: 0.5, sec: 3.5 } }),
      f('절대 영도', '#BFE9FF', ['frost'], '모든 적을 0.8초 얼려 세웁니다.', { coef: 1.5, stunSec: 0.8, slow: { mul: 0.5, sec: 3.5 } }),
      f('성좌의 겨울', '#E8F6FF', ['frost', 'lightning'], '별빛 서리가 1초 얼리고 번개가 튑니다.', { coef: 1.6, stunSec: 1, slow: { mul: 0.45, sec: 4 } }),
    ],
    warlock: [
      f('저주의 고리', C.warlock, ['frost', 'shadow'], '모든 적을 늦추고 4초간 저주 피해.', { coef: 1.3, slow: { mul: 0.6, sec: 3 }, dot: { coefPerSec: 0.2, sec: 4 } }),
      f('시체 폭발', C.warlock, ['shadow', 'explode'], '쓰러진 자의 잔해가 터져 모든 적에게 피해.', { coef: 1.6, slow: null }),
      f('망령의 행진', C.warlock, ['shadow', 'frost'], '망령이 지나가며 늦추고 5초간 피해.', { coef: 1.6, slow: { mul: 0.55, sec: 3 }, dot: { coefPerSec: 0.3, sec: 5 } }),
      f('군단의 저주', '#7F6BD8', ['shadow', 'poison', 'frost'], '군단이 0.6초 붙잡고 5초간 좀먹습니다.', { coef: 1.75, stunSec: 0.6, slow: { mul: 0.55, sec: 3 }, dot: { coefPerSec: 0.35, sec: 5 } }),
    ],
  },
  m_shield: {
    wizard: [
      f('원소 보호막', C.wizard, ['arcane'], '최대 HP 27% 흡수 보호막.', { shield: { pct: 0.27, sec: 10 } }),
      f('반사 장막', C.wizard, ['arcane', 'frost'], '보호막 30%, 모든 적 3초간 둔화.', { shield: { pct: 0.3, sec: 10 }, slowAll: { mul: 0.7, sec: 3 } }),
      f('시간의 장벽', C.wizard, ['arcane'], '보호막 32%, 최대 HP 5% 회복.', { shield: { pct: 0.32, sec: 10 }, heal: 0.05 }),
      f('성좌 결계', '#E8F6FF', ['arcane', 'lightning'], '12초간 보호막 36%, 모든 적 0.8초 기절.', { shield: { pct: 0.36, sec: 12 }, stunAll: 0.8 }),
    ],
    warlock: [
      f('영혼 결계', C.warlock, ['arcane', 'shadow'], '보호막 26%, 최대 HP 3% 회복.', { shield: { pct: 0.26, sec: 10 }, heal: 0.03 }),
      f('뼈 갑옷', C.warlock, ['shadow'], '보호막 30%, 6초간 받는 피해 15% 감소.', { shield: { pct: 0.3, sec: 10 }, guard: { sec: 6, reduce: 0.15 } }),
      f('리치의 성구함', C.warlock, ['shadow', 'arcane'], '보호막 32%, 최대 HP 6% 회복.', { shield: { pct: 0.32, sec: 10 }, heal: 0.06 }),
      f('밤의 왕좌', '#7F6BD8', ['shadow', 'arcane'], '보호막 36%, 회복 8%, 모든 적 3초 둔화.', { shield: { pct: 0.36, sec: 12 }, heal: 0.08, slowAll: { mul: 0.65, sec: 3 } }),
    ],
  },
  m_meteor: {
    wizard: [
      f('화염 운석', C.wizard, ['fire', 'explode'], '궁극기. 운석 3개.', {}),
      f('원소 운석우', C.wizard, ['fire', 'frost', 'explode'], '궁극기. 불·얼음 운석 4개.', { coef: 2.6, hits: 4 }),
      f('대재앙', '#FF8A4C', ['fire', 'frost', 'explode'], '궁극기. 운석 4개가 1초 기절시킵니다.', { coef: 2.6, hits: 4, stunSec: 1 }),
      f('성좌 붕괴', '#FFE6A3', ['fire', 'frost', 'lightning', 'explode'], '궁극기. 별자리가 무너져 5번 떨어지고 1.2초 기절.', { coef: 2.1, hits: 5, stunSec: 1.2 }),
    ],
    warlock: [
      f('암흑 운석', C.warlock, ['shadow', 'explode'], '궁극기. 어둠의 운석 3개, 4초간 지속 피해.', { dot: { coefPerSec: 0.4, sec: 4 } }),
      f('죽음의 비', C.warlock, ['shadow', 'poison', 'explode'], '궁극기. 죽음의 비 4번, 5초 지속 피해.', { coef: 2.7, hits: 4, dot: { coefPerSec: 0.5, sec: 5 } }),
      f('죽음의 군단', C.warlock, ['shadow', 'poison'], '궁극기. 군단이 5번 덮치고 흡혈 4%.', { coef: 2.3, hits: 5, lifesteal: 0.04 }),
      f('밤의 강림', '#7F6BD8', ['shadow', 'poison', 'explode'], '궁극기. 밤이 5번 내려앉아 6초 지속 피해, 흡혈 5%.', { coef: 2.4, hits: 5, dot: { coefPerSec: 0.55, sec: 6 }, lifesteal: 0.05 }),
    ],
  },

  // ===================== 궁수 (조금 덜 세게) =====================
  a_aim: {
    ranger: [
      f('집중 사격', C.ranger, ['precise'], '치명타 확률 +10%.', { coef: 2.2, critBonus: 0.1 }),
      f('은월 저격', C.ranger, ['precise'], '치명타 확률 +15%.', { coef: 2.3, critBonus: 0.15 }),
      f('관통탄', C.ranger, ['precise', 'wind'], '치명타 +18%, 체력 25% 이하 적에게 2배.', { coef: 2.35, critBonus: 0.18, executeBelow: 0.25 }),
      f('별을 꿰는 화살', '#E8F6FF', ['precise', 'lightning'], '치명타 +22%, 처형 30%, 번개가 튑니다.', { coef: 2.5, critBonus: 0.22, executeBelow: 0.3 }),
    ],
    hunter: [
      f('야수 사격', C.hunter, ['precise', 'beast'], '야수의 감각으로 쏩니다.', { coef: 2.2 }),
      f('독침 사격', C.hunter, ['beast', 'poison'], '4초간 독 피해.', { coef: 2.0, dot: { coefPerSec: 0.3, sec: 4 } }),
      f('사냥감 표시', C.hunter, ['beast', 'poison'], '표시한 적을 늦추고 5초 독.', { coef: 2.1, dot: { coefPerSec: 0.35, sec: 5 }, slow: { mul: 0.75, sec: 3 } }),
      f('태고의 화살', '#B7E07A', ['beast', 'poison', 'bleed'], '태고의 독과 상처, 5초간 피해.', { coef: 2.3, dot: { coefPerSec: 0.4, sec: 5 } }),
    ],
  },
  a_multi: {
    ranger: [
      f('부채 사격', C.ranger, ['bleed', 'precise'], '화살 5발을 넓게.', {}),
      f('연속 사격', C.ranger, ['bleed', 'precise'], '화살 6발.', { coef: 0.72, hits: 6 }),
      f('은월 산탄', C.ranger, ['bleed', 'precise'], '화살 6발, 치명타 +8%.', { coef: 0.72, hits: 6, critBonus: 0.08 }),
      f('유성 사격', '#E8F6FF', ['bleed', 'lightning'], '유성 같은 화살 6발, 치명타 +10%.', { coef: 0.76, hits: 6, critBonus: 0.1 }),
    ],
    hunter: [
      f('가시 사격', C.hunter, ['bleed', 'beast'], '가시 화살 5발.', {}),
      f('독무 사격', C.hunter, ['poison', 'bleed'], '독 묻은 화살 5발.', { coef: 0.75, dot: { coefPerSec: 0.15, sec: 4 } }),
      f('무리 사냥', C.hunter, ['beast', 'bleed'], '무리처럼 6발이 몰려듭니다.', { coef: 0.72, hits: 6 }),
      f('태고의 사냥', '#B7E07A', ['beast', 'poison', 'bleed'], '태고의 무리 6발, 독.', { coef: 0.74, hits: 6, dot: { coefPerSec: 0.15, sec: 4 } }),
    ],
  },
  a_leap: {
    ranger: [
      f('바람 걸음', C.ranger, ['wind'], '2초 회피, 다음 1번 치명타.', { evade: { sec: 2 }, critStacks: 1 }),
      f('매의 도약', C.ranger, ['wind', 'precise'], '2초 회피, 다음 2번 치명타.', { evade: { sec: 2 }, critStacks: 2 }),
      f('천공 도약', C.ranger, ['wind', 'precise'], '2.5초 회피, 치명 2번, 6초간 공격력 10%.', { evade: { sec: 2.5 }, critStacks: 2, atkBuff: { mul: 0.1, sec: 6 } }),
      f('별빛 도약', '#E8F6FF', ['wind', 'precise'], '3초 회피, 다음 3번 치명타.', { evade: { sec: 3 }, critStacks: 3 }),
    ],
    hunter: [
      f('야수 도약', C.hunter, ['wind', 'beast'], '2초 회피, 최대 HP 3% 회복.', { evade: { sec: 2 }, heal: 0.03 }),
      f('무리의 부름', C.hunter, ['beast'], '2초 회피, 6초간 공격력 12%.', { evade: { sec: 2 }, atkBuff: { mul: 0.12, sec: 6 } }),
      f('야생 회피', C.hunter, ['wind', 'beast'], '2.5초 회피, 회복 5%.', { evade: { sec: 2.5 }, heal: 0.05 }),
      f('태고의 숨결', '#B7E07A', ['wind', 'beast'], '2.5초 회피, 회복 6%, 6초간 공격력 15%.', { evade: { sec: 2.5 }, heal: 0.06, atkBuff: { mul: 0.15, sec: 6 } }),
    ],
  },
  a_rain: {
    ranger: [
      f('정밀 화살비', C.ranger, ['bleed', 'precise'], '궁극기. 화살비 5번, 치명타 +10%.', { critBonus: 0.1 }),
      f('은월 화살비', C.ranger, ['bleed', 'precise'], '궁극기. 화살비 6번.', { coef: 1.28, hits: 6 }),
      f('매의 눈', C.ranger, ['bleed', 'precise'], '궁극기. 6번, 치명타 +15%.', { coef: 1.3, hits: 6, critBonus: 0.15 }),
      f('별비', '#E8F6FF', ['bleed', 'precise', 'lightning'], '궁극기. 별빛 화살비 7번, 치명타 +18%.', { coef: 1.15, hits: 7, critBonus: 0.18 }),
    ],
    hunter: [
      f('가시비', C.hunter, ['bleed', 'poison'], '궁극기. 가시 화살비, 4초 독.', { dot: { coefPerSec: 0.3, sec: 4 } }),
      f('맹독 화살비', C.hunter, ['poison', 'bleed'], '궁극기. 5초 맹독.', { dot: { coefPerSec: 0.4, sec: 5 } }),
      f('야수의 왕', C.hunter, ['beast', 'bleed'], '궁극기. 야수의 무리가 6번 덮칩니다.', { coef: 1.28, hits: 6 }),
      f('태고의 폭우', '#B7E07A', ['beast', 'poison', 'bleed'], '궁극기. 6번, 5초 맹독.', { coef: 1.3, hits: 6, dot: { coefPerSec: 0.45, sec: 5 } }),
    ],
  },

  // ===================== 도적 (조금 더 세게) =====================
  r_stab: {
    assassin: [
      f('암살', C.assassin, ['bleed', 'shadow'], '치명 +30%, 체력 25% 이하 2배.', { coef: 1.9, executeBelow: 0.25 }),
      f('적월의 찌르기', C.assassin, ['bleed', 'shadow'], '치명 +35%, 처형 30%, 출혈.', { coef: 2.05, critBonus: 0.35, executeBelow: 0.3, dot: { coefPerSec: 0.3, sec: 4 } }),
      f('그림자 처형', C.assassin, ['bleed', 'shadow'], '치명 +40%, 처형 35%.', { coef: 2.35, critBonus: 0.4, executeBelow: 0.35 }),
      f('그믐의 처형', '#FF3D6E', ['bleed', 'shadow'], '두 번 찌르는 처형. 치명 +45%, 처형 40%.', { coef: 1.45, hits: 2, critBonus: 0.45, executeBelow: 0.4 }),
    ],
    trickster: [
      f('카드 투척', C.trickster, ['arcane', 'bleed'], '날카로운 카드를 던집니다.', { coef: 1.85 }),
      f('거울 찌르기', C.trickster, ['arcane', 'bleed'], '거울상과 함께 두 번 찌릅니다.', { coef: 1.05, hits: 2 }),
      f('운명의 카드', C.trickster, ['arcane', 'lightning'], '카드 3장이 적들 사이를 튑니다.', { coef: 1.0, hits: 3, target: 'spread' }),
      f('가면의 카드', '#E0D4FF', ['arcane', 'lightning', 'shadow'], '카드 4장, 치명 +30%.', { coef: 1.0, hits: 4, target: 'spread' }),
    ],
  },
  r_poison: {
    assassin: [
      f('맹독 칼날', C.assassin, ['poison'], '6초간 강한 독.', { coef: 0.7, dot: { coefPerSec: 0.6, sec: 6 } }),
      f('적월의 독', C.assassin, ['poison', 'bleed'], '독과 상처 6초, 독이 튀어 주변 적에게 35% 피해.', { coef: 0.8, splash: 0.35, dot: { coefPerSec: 0.7, sec: 6 } }),
      f('치명독', C.assassin, ['poison', 'bleed'], '6초 독, 처형 30%, 주변 적에게 45% 피해.', { coef: 0.9, splash: 0.45, dot: { coefPerSec: 0.8, sec: 6 }, executeBelow: 0.3 }),
      f('그믐 독', '#FF3D6E', ['poison', 'shadow'], '그믐의 독 6초, 주변 적에게 50% 피해.', { coef: 1.0, splash: 0.5, dot: { coefPerSec: 0.9, sec: 6 } }),
    ],
    trickster: [
      f('독 카드', C.trickster, ['poison', 'arcane'], '독이 스민 카드, 6초.', { coef: 0.7, dot: { coefPerSec: 0.55, sec: 6 } }),
      f('환영 독', C.trickster, ['poison', 'arcane'], '6초 독, 환영이 주변 적에게 35% 피해.', { coef: 0.75, splash: 0.35, dot: { coefPerSec: 0.6, sec: 6 } }),
      f('운명의 실', C.trickster, ['poison', 'arcane'], '늦추고 6초 독, 주변 적에게 40% 피해.', { coef: 0.8, splash: 0.4, dot: { coefPerSec: 0.65, sec: 6 }, slow: { mul: 0.7, sec: 3 } }),
      f('가면 무도회', '#E0D4FF', ['poison', 'lightning'], '0.5초 홀리고 6초 독, 주변 적에게 45% 피해.', { coef: 0.85, splash: 0.45, dot: { coefPerSec: 0.7, sec: 6 }, stunSec: 0.5 }),
    ],
  },
  r_shadow: {
    assassin: [
      f('그림자 습격', C.assassin, ['shadow'], '2초 은신, 다음 2번 치명타.', { evade: { sec: 2, nextCrit: true }, critStacks: 1 }),
      f('적월 은신', C.assassin, ['shadow'], '2초 은신, 다음 3번 치명타.', { evade: { sec: 2, nextCrit: true }, critStacks: 2 }),
      f('월식', C.assassin, ['shadow'], '2.5초 은신, 치명 4번, 6초간 공격력 15%.', { evade: { sec: 2.5, nextCrit: true }, critStacks: 3, atkBuff: { mul: 0.15, sec: 6 } }),
      f('그믐의 장막', '#FF3D6E', ['shadow'], '3초 은신, 치명 5번, 8초간 공격력 20%.', { evade: { sec: 3, nextCrit: true }, critStacks: 4, atkBuff: { mul: 0.2, sec: 8 } }),
    ],
    trickster: [
      f('환영 걸음', C.trickster, ['shadow', 'arcane'], '2.5초 회피, 다음 공격 치명타.', { evade: { sec: 2.5, nextCrit: true } }),
      f('거울상', C.trickster, ['shadow', 'arcane'], '2.5초 회피, 치명 3번.', { evade: { sec: 2.5, nextCrit: true }, critStacks: 2 }),
      f('운명 회피', C.trickster, ['shadow', 'arcane'], '3초 회피, 최대 HP 4% 회복.', { evade: { sec: 3, nextCrit: true }, heal: 0.04, critStacks: 2 }),
      f('천의 얼굴', '#E0D4FF', ['shadow', 'arcane'], '3초 회피, 치명 4번, 회복 5%.', { evade: { sec: 3, nextCrit: true }, critStacks: 3, heal: 0.05 }),
    ],
  },
  r_blades: {
    assassin: [
      f('처형의 칼날', C.assassin, ['bleed'], '궁극기. 칼날 12번, 처형 30%.', { executeBelow: 0.3 }),
      f('적월 난무', C.assassin, ['bleed', 'shadow'], '궁극기. 칼날 12번, 더 깊게.', { coef: 1.05, executeBelow: 0.3 }),
      f('월식 난무', C.assassin, ['bleed', 'shadow'], '궁극기. 칼날 14번, 처형 35%.', { coef: 1.0, hits: 14, executeBelow: 0.35 }),
      f('그믐 난무', '#FF3D6E', ['bleed', 'shadow'], '궁극기. 칼날 15번, 처형 40%.', { coef: 1.05, hits: 15, executeBelow: 0.4 }),
    ],
    trickster: [
      f('카드 폭풍', C.trickster, ['arcane', 'bleed'], '궁극기. 카드 12장이 적들 사이를 튑니다.', { coef: 0.85, target: 'spread' }),
      f('거울의 춤', C.trickster, ['arcane', 'bleed'], '궁극기. 카드 14장.', { coef: 0.8, hits: 14, target: 'spread' }),
      f('운명 직조', C.trickster, ['arcane', 'lightning'], '궁극기. 14장, 0.8초 기절.', { coef: 0.82, hits: 14, target: 'spread', stunSec: 0.8 }),
      f('천 개의 가면', '#E0D4FF', ['arcane', 'lightning', 'bleed'], '궁극기. 카드 16장, 1초 기절.', { coef: 0.82, hits: 16, target: 'spread', stunSec: 1 }),
    ],
  },
});

// 밸런스 손잡이 (docs/BALANCE_CHANGES.md v16):
//  cls = 기본 스킬보다 늘어난 계수·지속 피해에 곱하는 직업 배율(진화가 기본보다 약해지지는 않음).
//        전사·도적은 더, 마법사·궁수는 덜 → 직업 차이를 좁힘.
//  splash = 단일 스킬이 진화로 얻은 '주변 피해' 비율에 곱하는 배율(무리 사냥 속도 조절).
export const EVO_SCALE = Object.freeze({
  splash: 1,   // 주변 피해(splash) 비율에 곱하는 배율 — 데이터 값이 곧 실제 값(시뮬로 0.35~0.5에 맞춤)
  cls: { warrior: 1.0, mage: 0.86, archer: 0.72, rogue: 1.4 },
});

export const EVO_SKILLS = Object.freeze(Object.keys(SKILL_FORMS));
export const TIER_MARK = Object.freeze(['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ']);
// 런타임 아이콘 키 (GPT O6가 오면 sprites.json에 채워짐; 없으면 기본 아이콘 + 색 테두리)
export const evoIconKey = (branch, id, tier) => `skill_evo_${branch}_${id}_t${tier}`;
