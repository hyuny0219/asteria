// 특성 (talents). Per class: two branch-themed trees (either can be learned, so builds can
// mix) + one common tree. 5 rows; rows 1–4 hold 2 nodes of rank 1–5, row 5 is a single
// capstone (rank 1) that changes how a skill behaves. Row r opens after 5×(r−1) points
// are spent in that tree. Values are per rank; experiment values (docs/BALANCE_CHANGES.md).
//
// Effect keys feed the percent pool in stats.js (atkPct, hpPct, defPct, critChance,
// critDmg, aspd, cdr, ultCharge, goldPct, evade, lifesteal, combo, dmgTaken) or the
// economy multipliers (expPct, offlinePct, dropPct). Capstones set a combat flag `cap`.
const n = (id, name, eff, desc, max = 5) => ({ id, name, eff, desc, max });
const cap = (id, name, desc) => ({ id, name, cap: id, desc, max: 1, capstone: true });

const TREES = {
  // ---- warrior ----
  knight: { name: '수호', theme: '흑장미 기사 계열 · 방패와 반격', rows: [
    [n('kn_hp', '강철 체력', { hpPct: 0.03 }, '최대 HP +3%'), n('kn_def', '방패 숙련', { defPct: 0.04 }, '방어력 +4%')],
    [n('kn_guard', '굳건함', { dmgTaken: 0.012 }, '받는 피해 -1.2%'), n('kn_atk', '기사의 검', { atkPct: 0.02 }, '공격력 +2%')],
    [n('kn_cdr', '전열 유지', { cdr: 0.015 }, '스킬 대기 -1.5%'), n('kn_ult', '서약의 불꽃', { ultCharge: 0.04 }, '궁극기 충전 +4%')],
    [n('kn_steal', '피의 맹세', { lifesteal: 0.004 }, '피해의 0.4% 회복'), n('kn_crit', '반격 준비', { critChance: 0.01 }, '치명 확률 +1%')],
    [cap('cap_counter2', '이중 반격', '수호 반격 피해 ×2, 방어 효과 중 모든 피격에 반격(내부 대기 0.5초). 수호 반격이 없으면 방패 돌진의 방어 효과 +1초.')],
  ] },
  berserker: { name: '광전', theme: '진홍의 집행자 계열 · 대검과 광폭', rows: [
    [n('bs_atk', '대검 수련', { atkPct: 0.03 }, '공격력 +3%'), n('bs_crit', '피 냄새', { critChance: 0.01 }, '치명 확률 +1%')],
    [n('bs_aspd', '휘몰아치기', { aspd: 0.02 }, '공격 속도 +2%'), n('bs_cdmg', '처형 본능', { critDmg: 0.05 }, '치명 피해 +5%')],
    [n('bs_steal', '피의 갈망', { lifesteal: 0.005 }, '피해의 0.5% 회복'), n('bs_hp', '분노의 육체', { hpPct: 0.02 }, '최대 HP +2%')],
    [n('bs_combo', '연속 베기', { combo: 0.02 }, '추가타 확률 +2%'), n('bs_ult', '광폭 충전', { ultCharge: 0.04 }, '궁극기 충전 +4%')],
    [cap('cap_berserk', '피의 군주', 'HP 50% 이하일 때 공격력 +25%가 +50%로, 그동안 피해의 3%를 회복합니다.')],
  ] },
  // ---- mage ----
  wizard: { name: '성좌', theme: '위자드 계열 · 원소와 별', rows: [
    [n('wz_atk', '별빛 지식', { atkPct: 0.03 }, '공격력 +3%'), n('wz_cdr', '빠른 영창', { cdr: 0.015 }, '스킬 대기 -1.5%')],
    [n('wz_ult', '천구 공명', { ultCharge: 0.05 }, '궁극기 충전 +5%'), n('wz_crit', '정밀 주문', { critChance: 0.01 }, '치명 확률 +1%')],
    [n('wz_cdmg', '초신성', { critDmg: 0.05 }, '치명 피해 +5%'), n('wz_hp', '마나 장막', { hpPct: 0.02 }, '최대 HP +2%')],
    [n('wz_aspd', '연속 시전', { aspd: 0.02 }, '공격 속도 +2%'), n('wz_guard', '성운 보호', { dmgTaken: 0.01 }, '받는 피해 -1%')],
    [cap('cap_meteor2', '이중 유성', '메테오가 두 번 떨어집니다(두 번째는 피해 60%).')],
  ] },
  warlock: { name: '심연', theme: '워록 계열 · 저주와 흡수', rows: [
    [n('wl_atk', '금지된 지식', { atkPct: 0.03 }, '공격력 +3%'), n('wl_steal', '생명 착취', { lifesteal: 0.005 }, '피해의 0.5% 회복')],
    [n('wl_cdr', '계약의 속삭임', { cdr: 0.015 }, '스킬 대기 -1.5%'), n('wl_hp', '심연의 육체', { hpPct: 0.025 }, '최대 HP +2.5%')],
    [n('wl_crit', '낙인', { critChance: 0.01 }, '치명 확률 +1%'), n('wl_ult', '어둠 충전', { ultCharge: 0.04 }, '궁극기 충전 +4%')],
    [n('wl_cdmg', '파멸', { critDmg: 0.05 }, '치명 피해 +5%'), n('wl_guard', '장막', { dmgTaken: 0.01 }, '받는 피해 -1%')],
    [cap('cap_dot2', '역병', '지속 피해(저주·생명 흡수 등)가 두 배로 들어갑니다.')],
  ] },
  // ---- archer ----
  ranger: { name: '명사수', theme: '레인저 계열 · 정밀 사격', rows: [
    [n('rg_atk', '은월의 활', { atkPct: 0.03 }, '공격력 +3%'), n('rg_crit', '정조준', { critChance: 0.012 }, '치명 확률 +1.2%')],
    [n('rg_cdmg', '급소 사격', { critDmg: 0.06 }, '치명 피해 +6%'), n('rg_aspd', '빠른 장전', { aspd: 0.02 }, '공격 속도 +2%')],
    [n('rg_ult', '집중', { ultCharge: 0.04 }, '궁극기 충전 +4%'), n('rg_evade', '거리 유지', { evade: 0.006 }, '회피 +0.6%')],
    [n('rg_combo', '연사', { combo: 0.02 }, '추가타 확률 +2%'), n('rg_cdr', '사냥 감각', { cdr: 0.015 }, '스킬 대기 -1.5%')],
    [cap('cap_rainPlus', '추적 화살비', '화살비가 표식처럼 적을 따라가 타격 횟수가 1.5배가 됩니다.')],
  ] },
  hunter: { name: '추적자', theme: '헌터 계열 · 야수와 덫', rows: [
    [n('ht_atk', '사냥꾼의 힘', { atkPct: 0.03 }, '공격력 +3%'), n('ht_hp', '야성의 몸', { hpPct: 0.025 }, '최대 HP +2.5%')],
    [n('ht_aspd', '추격', { aspd: 0.02 }, '공격 속도 +2%'), n('ht_steal', '포식', { lifesteal: 0.004 }, '피해의 0.4% 회복')],
    [n('ht_crit', '약점 포착', { critChance: 0.01 }, '치명 확률 +1%'), n('ht_guard', '가시 덫', { dmgTaken: 0.01 }, '받는 피해 -1%')],
    [n('ht_cdmg', '맹수의 이빨', { critDmg: 0.05 }, '치명 피해 +5%'), n('ht_ult', '무리 본능', { ultCharge: 0.04 }, '궁극기 충전 +4%')],
    [cap('cap_beast2', '우두머리', '야수 소환·무리 사냥 피해 ×2, 야수 공격 시 HP 2% 회복.')],
  ] },
  // ---- rogue ----
  assassin: { name: '암살', theme: '어쌔신 계열 · 급소와 처형', rows: [
    [n('as_crit', '급소 감각', { critChance: 0.012 }, '치명 확률 +1.2%'), n('as_atk', '단검 숙련', { atkPct: 0.025 }, '공격력 +2.5%')],
    [n('as_cdmg', '처형자', { critDmg: 0.06 }, '치명 피해 +6%'), n('as_evade', '그림자 보법', { evade: 0.008 }, '회피 +0.8%')],
    [n('as_aspd', '연타', { aspd: 0.02 }, '공격 속도 +2%'), n('as_cdr', '숨 고르기', { cdr: 0.015 }, '스킬 대기 -1.5%')],
    [n('as_combo', '두 번째 칼날', { combo: 0.02 }, '추가타 확률 +2%'), n('as_ult', '적월', { ultCharge: 0.04 }, '궁극기 충전 +4%')],
    [cap('cap_shadowCrit', '그림자 일격', '그림자 걸음 뒤 다음 3번의 공격이 반드시 치명타가 됩니다.')],
  ] },
  trickster: { name: '기만', theme: '트릭스터 계열 · 환영과 회피', rows: [
    [n('tk_evade', '속임수', { evade: 0.008 }, '회피 +0.8%'), n('tk_atk', '카드 칼날', { atkPct: 0.025 }, '공격력 +2.5%')],
    [n('tk_combo', '거울 칼', { combo: 0.02 }, '추가타 확률 +2%'), n('tk_cdr', '손재주', { cdr: 0.015 }, '스킬 대기 -1.5%')],
    [n('tk_hp', '도주 본능', { hpPct: 0.025 }, '최대 HP +2.5%'), n('tk_crit', '허점', { critChance: 0.01 }, '치명 확률 +1%')],
    [n('tk_ult', '운명 조작', { ultCharge: 0.05 }, '궁극기 충전 +5%'), n('tk_gold', '소매치기', { goldPct: 0.04 }, '골드 +4%')],
    [cap('cap_illusion', '환영 무도', '공격마다 25% 확률로 환영이 같은 피해로 한 번 더 공격합니다.')],
  ] },
  // ---- common ----
  common: { name: '생존·재화', theme: '모든 클래스 공용', rows: [
    [n('cm_hp', '단련', { hpPct: 0.03 }, '최대 HP +3%'), n('cm_def', '경계', { defPct: 0.03 }, '방어력 +3%')],
    [n('cm_gold', '탐욕', { goldPct: 0.04 }, '골드 +4%'), n('cm_exp', '배움', { expPct: 0.03 }, '경험치 +3%')],
    [n('cm_guard', '인내', { dmgTaken: 0.01 }, '받는 피해 -1%'), n('cm_evade', '몸놀림', { evade: 0.005 }, '회피 +0.5%')],
    [n('cm_offline', '여행자의 지혜', { offlinePct: 0.03 }, '방치 보상 효율 +3%p'), n('cm_drop', '보물 사냥꾼', { dropPct: 0.04 }, '장비 드롭 +4%')],
    [cap('cap_secondWind', '재기', '전투마다 한 번, 쓰러질 피해를 받으면 HP 30%로 버팁니다.')],
  ] },
};

export const CLASS_TREES = Object.freeze({
  warrior: ['knight', 'berserker', 'common'],
  mage: ['wizard', 'warlock', 'common'],
  archer: ['ranger', 'hunter', 'common'],
  rogue: ['assassin', 'trickster', 'common'],
});

export const TALENT_TREES = Object.freeze(TREES);
// node id → { tree, row, node }
export const TALENT_NODES = Object.freeze(Object.fromEntries(Object.entries(TREES).flatMap(([tree, t]) =>
  t.rows.flatMap((row, r) => row.map((nd) => [nd.id, { ...nd, tree, row: r }])))));

export const TALENT_RULES = Object.freeze({
  unlockTier: 1, fromLevel: 31, perTowerFloors: 10, perRebirth: 3,
  rowGate: 5,                 // points spent in the tree needed per row
  respecFreePerDay: 1, respecGoldMinutes: 30,
  presets: 2,
});
// Icon placeholders: swap when the talent emblem board arrives (keyed by tree id).
export const TALENT_ICONS = Object.freeze({ knight: 'S1', berserker: 'S4', wizard: 'K07', warlock: 'K04', ranger: 'K08', hunter: 'K12', assassin: 'K16', trickster: 'K22', common: 'V00' });
