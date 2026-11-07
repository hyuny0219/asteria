// v10 장비·스킬 확장 data: 전설 고유 효과(uniques), 스킬 각성(awakenings), 재련·등급 올리기 비용.
//
// Both uniques and awakenings are written in one small "skill mod" vocabulary that combat
// reads at hit time (src/core/combat.js → modsFor):
//   per skill id: hitsAdd, coefMul, cdMul, toAll, stunAdd, slow {mul, sec}, dotMul,
//     dotAdd {coefPerSec, sec}, heal (max HP %), castShield (max HP %), guardAdd (s),
//     evadeAdd (s), buffSecAdd, buffMulAdd, shieldAdd (max HP %), critBonusAdd,
//     execute (HP % threshold → ×2), echo (repeat 300 ms later at × this), critStacks (n)
//   '*' (whole kit): ultInvuln (s), killCdrMs, critGauge, bossMul, lowHpAtk, pct {stat: v}

const r1 = (v) => Math.round(v * 10) / 10;
const pc = (v) => `${Math.round(v * 100)}%`;

// v = rolled strength (legendary). Mythic items use v × MYTHIC_MUL.
export const MYTHIC_MUL = 1.25;
export const UNIQUES = Object.freeze({
  // ---- warrior ----
  u_w_starburst: { cls: 'warrior', name: '별빛 폭발', range: [1, 2], mods: (v) => ({ starSlash: { stunAdd: v, coefMul: 1.2 } }), text: (v) => `별빛 참격 기절 +${r1(v)}초, 피해 +20%` },
  u_w_bulwark: { cls: 'warrior', name: '성벽', range: [0.1, 0.2], mods: (v) => ({ shieldCharge: { castShield: v } }), text: (v) => `방패 돌진 후 최대 HP ${pc(v)} 보호막` },
  u_w_rally: { cls: 'warrior', name: '끝없는 함성', range: [4, 8], mods: (v) => ({ warCry: { buffSecAdd: Math.round(v) } }), text: (v) => `전장의 외침 지속 +${Math.round(v)}초` },
  u_w_cleave: { cls: 'warrior', name: '휘몰아치는 강타', range: [0.5, 0.7], mods: (v) => ({ strike: { toAll: true, coefMul: v } }), text: (v) => `강타가 모든 적을 벱니다 (피해 ×${r1(v)})` },
  u_w_reaper: { cls: 'warrior', name: '처형인의 대검', range: [1.15, 1.35], mods: (v) => ({ berserkStrike: { execute: 0.3, coefMul: v } }), text: (v) => `광폭 일격 피해 ×${r1(v)}, HP 30% 이하 적에게 2배` },
  u_w_judge: { cls: 'warrior', name: '심판의 낙인', range: [0.5, 1], mods: (v) => ({ w_judgement: { stunAdd: v }, w_whirl: { hitsAdd: 1, coefMul: 0.8 } }), text: (v) => `심판의 일격 기절 +${r1(v)}초, 회전베기 1회 더` },
  // ---- mage ----
  u_m_starfall: { cls: 'mage', name: '유성우', range: [0.65, 0.8], mods: (v) => ({ m_meteor: { hitsAdd: 2, coefMul: v } }), text: (v) => `메테오 3개 → 5개 (운석당 피해 ×${r1(v)})` },
  u_m_twin: { cls: 'mage', name: '쌍둥이 화염', range: [0.5, 0.8], mods: (v) => ({ m_fireball: { echo: v } }), text: (v) => `파이어볼이 한 번 더 날아갑니다 (피해 ${pc(v)})` },
  u_m_glacier: { cls: 'mage', name: '빙하', range: [0.8, 1.5], mods: (v) => ({ m_frost: { stunAdd: v }, m_blizzard: { stunAdd: v * 0.6 } }), text: (v) => `서리 고리가 ${r1(v)}초 얼림 (눈보라 ${r1(v * 0.6)}초)` },
  u_m_ward: { cls: 'mage', name: '마력 순환', range: [0.1, 0.2], mods: (v) => ({ m_shield: { shieldAdd: v, heal: 0.08 } }), text: (v) => `마나 실드 +${pc(v)}, 쓸 때 HP 8% 회복` },
  u_m_plague: { cls: 'mage', name: '역병의 서', range: [1.4, 1.9], mods: (v) => ({ m_curse: { dotMul: v }, m_drain: { heal: 0.05 } }), text: (v) => `저주 지속 피해 ×${r1(v)}, 생명 흡수 회복 +5%` },
  u_m_storm: { cls: 'mage', name: '폭풍의 핵', range: [0.75, 0.9], mods: (v) => ({ m_chain: { hitsAdd: 1, cdMul: v } }), text: (v) => `연쇄 번개 1번 더, 재사용 대기 ×${r1(v)}` },
  // ---- archer ----
  u_a_deluge: { cls: 'archer', name: '폭우', range: [0.6, 0.8], mods: (v) => ({ a_rain: { hitsAdd: 5, coefMul: v } }), text: (v) => `화살비 타격 횟수 2배 (타격당 피해 ×${r1(v)})` },
  u_a_volley: { cls: 'archer', name: '일제 사격', range: [0.6, 0.8], mods: (v) => ({ a_multi: { hitsAdd: 3, coefMul: v } }), text: (v) => `멀티샷 화살 +3발 (화살당 피해 ×${r1(v)})` },
  u_a_eagle: { cls: 'archer', name: '매의 눈', range: [0.2, 0.4], mods: (v) => ({ a_aim: { critBonusAdd: v }, a_snipe: { execute: 0.35 } }), text: (v) => `정조준 치명 확률 +${pc(v)}, 저격이 HP 35% 이하 적에게 2배` },
  u_a_wild: { cls: 'archer', name: '야성의 부름', range: [1.3, 1.7], mods: (v) => ({ a_beast: { dotMul: v }, a_pack: { hitsAdd: 1 } }), text: (v) => `야수 소환 지속 피해 ×${r1(v)}, 무리 사냥 1번 더` },
  u_a_wind: { cls: 'archer', name: '바람걸음', range: [1, 3], mods: (v) => ({ a_leap: { evadeAdd: 1, critStacks: Math.round(v) } }), text: (v) => `후방 도약 +1초, 이후 ${Math.round(v)}번 공격 치명타` },
  u_a_pierce: { cls: 'archer', name: '꿰뚫는 별', range: [1.2, 1.4], mods: (v) => ({ a_pierce: { stunAdd: 0.5, coefMul: v } }), text: (v) => `관통 사격 피해 ×${r1(v)}, 0.5초 기절` },
  // ---- rogue ----
  u_r_thousand: { cls: 'rogue', name: '만검', range: [3, 6], mods: (v) => ({ r_blades: { hitsAdd: Math.round(v) } }), text: (v) => `천 개의 칼날 +${Math.round(v)}번` },
  u_r_venom: { cls: 'rogue', name: '맹독', range: [1.5, 2], mods: (v) => ({ r_poison: { dotMul: v } }), text: (v) => `독칼 지속 피해 ×${r1(v)}` },
  u_r_twinfang: { cls: 'rogue', name: '쌍아', range: [0.5, 0.8], mods: (v) => ({ r_stab: { echo: v } }), text: (v) => `급소 찌르기가 한 번 더 찌릅니다 (피해 ${pc(v)})` },
  u_r_guillotine: { cls: 'rogue', name: '단두대', range: [0.4, 0.5], mods: (v) => ({ r_execute: { execute: v } }), text: (v) => `처형 2배 피해 기준 HP 30% → ${pc(v)}` },
  u_r_phantom: { cls: 'rogue', name: '유령 걸음', range: [2, 4], mods: (v) => ({ r_shadow: { evadeAdd: 1, critStacks: Math.round(v) } }), text: (v) => `그림자 걸음 +1초, 이후 ${Math.round(v)}번 공격 치명타` },
  u_r_mirror: { cls: 'rogue', name: '거울상', range: [0.05, 0.1], mods: (v) => ({ r_illusion: { hitsAdd: 1 }, r_smoke: { heal: v } }), text: (v) => `환영 분신 1번 더, 연막 때 HP ${pc(v)} 회복` },
  // ---- 공용 ----
  u_c_aegis: { cls: null, name: '수호의 맹세', range: [1.5, 2.5], mods: (v) => ({ '*': { ultInvuln: v } }), text: (v) => `궁극기를 쓰면 ${r1(v)}초 무적` },
  u_c_haste: { cls: null, name: '전장의 흐름', range: [250, 500], mods: (v) => ({ '*': { killCdrMs: Math.round(v) } }), text: (v) => `적을 처치할 때마다 모든 스킬 대기 -${r1(v / 1000)}초` },
  u_c_focus: { cls: null, name: '집중', range: [1, 2], mods: (v) => ({ '*': { critGauge: r1(v) } }), text: (v) => `치명타마다 궁극기 게이지 +${r1(v)}` },
  u_c_titan: { cls: null, name: '거인 사냥꾼', range: [0.08, 0.15], mods: (v) => ({ '*': { bossMul: v } }), text: (v) => `보스에게 주는 피해 +${pc(v)}` },
  u_c_fury: { cls: null, name: '분노', range: [0.15, 0.3], mods: (v) => ({ '*': { lowHpAtk: v } }), text: (v) => `HP 50% 이하일 때 공격력 +${pc(v)}` },
  u_c_vamp: { cls: null, name: '흡혈귀', range: [0.02, 0.04], mods: (v) => ({ '*': { pct: { lifesteal: v } } }), text: (v) => `준 피해의 ${pc(v)} 회복` },
});
// drop: 70% own class, 30% shared
export const UNIQUE_CLASS_CHANCE = 0.7;

// 스킬 각성: skill Lv 10 → pick A or B. Free change once per KST day, then 50 보석.
export const AWAKEN = Object.freeze({ needLevel: 10, changeGem: 50 });
const A = (name, desc, mods) => ({ name, desc, mods });
export const AWAKENINGS = Object.freeze({
  strike: [A('연격', '두 번 벱니다 (타격당 70%)', { hitsAdd: 1, coefMul: 0.7 }), A('대지 가르기', '모든 적을 벱니다 (60%)', { toAll: true, coefMul: 0.6 })],
  shieldCharge: [A('철벽', '방어 시간 +2초', { guardAdd: 2 }), A('충격파', '0.8초 기절', { stunAdd: 0.8 })],
  warCry: [A('긴 함성', '지속 +6초', { buffSecAdd: 6 }), A('격앙', '공격력 +10%p 더', { buffMulAdd: 0.1 })],
  guardCounter: [A('반격 강화', '반격 피해 ×1.5', { coefMul: 1.5 }), A('피의 반격', '반격할 때 HP 2% 회복', { coefMul: 1.2, heal: 0.02 })],
  berserkStrike: [A('처형', 'HP 30% 이하 적에게 2배', { execute: 0.3 }), A('연속 내려치기', '두 번 (타격당 65%)', { hitsAdd: 1, coefMul: 0.65 })],
  w_judgement: [A('긴 심판', '기절 +1초', { stunAdd: 1 }), A('신성 방벽', '방어 시간 +2초', { guardAdd: 2 })],
  w_whirl: [A('두 바퀴', '두 번 (타격당 75%)', { hitsAdd: 1, coefMul: 0.75 }), A('빠른 회전', '재사용 대기 ×0.65', { cdMul: 0.65 })],
  starSlash: [A('별의 심판', '피해 ×1.3', { coefMul: 1.3 }), A('긴 기절', '기절 +1.5초', { stunAdd: 1.5 })],
  m_fireball: [A('쌍화염', '한 번 더 (60%)', { echo: 0.6 }), A('화염 폭발', '모든 적 (55%)', { toAll: true, coefMul: 0.55 })],
  m_frost: [A('빙결', '1초 얼림', { stunAdd: 1 }), A('혹한', '적 공격 속도 60% 감소, 4초', { slow: { mul: 0.4, sec: 4 } })],
  m_shield: [A('두꺼운 실드', '흡수량 +15%p', { shieldAdd: 0.15 }), A('치유 실드', '쓸 때 HP 12% 회복', { heal: 0.12 })],
  m_chain: [A('연쇄 강화', '한 번 더 (타격당 70%)', { hitsAdd: 1, coefMul: 0.7 }), A('과부하', '피해 ×1.35, 대기 ×1.15', { coefMul: 1.35, cdMul: 1.15 })],
  m_curse: [A('역병', '지속 피해 ×1.8', { dotMul: 1.8 }), A('저주 확산', '모든 적에게 (80%)', { toAll: true, coefMul: 0.8 })],
  m_blizzard: [A('영구 동토', '0.8초 얼림', { stunAdd: 0.8 }), A('폭설', '재사용 대기 ×0.7', { cdMul: 0.7 })],
  m_drain: [A('대흡수', '회복 +10%p', { heal: 0.1 }), A('연쇄 흡수', '모든 적에게 (50%)', { toAll: true, coefMul: 0.5 })],
  m_meteor: [A('유성우', '운석 5개 (운석당 80%)', { hitsAdd: 2, coefMul: 0.8 }), A('거대 운석', '거대한 운석 1개(피해 ×2.6) + 1.5초 기절', { hitsAdd: -2, coefMul: 2.6, stunAdd: 1.5 })],
  a_aim: [A('급소', '치명 확률 +30%', { critBonusAdd: 0.3 }), A('속사', '재사용 대기 ×0.6', { cdMul: 0.6 })],
  a_multi: [A('화살 폭풍', '+3발 (화살당 80%)', { hitsAdd: 3, coefMul: 0.8 }), A('무거운 화살', '화살당 피해 ×1.5', { coefMul: 1.5 })],
  a_leap: [A('긴 도약', '회피 +1.5초', { evadeAdd: 1.5 }), A('반격 사격', '이후 2번 공격 치명타', { critStacks: 2 })],
  a_pierce: [A('충격 화살', '0.6초 기절', { stunAdd: 0.6 }), A('관통 강화', '피해 ×1.35', { coefMul: 1.35 })],
  a_beast: [A('피의 냄새', '지속 피해 ×1.7', { dotMul: 1.7 }), A('늑대 무리', '모든 적에게 (80%)', { toAll: true, coefMul: 0.8 })],
  a_snipe: [A('사형 선고', 'HP 35% 이하 적에게 2배', { execute: 0.35 }), A('연속 저격', '재사용 대기 ×0.7', { cdMul: 0.7 })],
  a_pack: [A('무리 증원', '한 번 더', { hitsAdd: 1 }), A('사냥 본능', '쓸 때 HP 5% 회복', { heal: 0.05 })],
  a_rain: [A('폭우', '+3번 (타격당 85%)', { hitsAdd: 3, coefMul: 0.85 }), A('화살 폭격', '피해 ×1.3 + 0.8초 기절', { coefMul: 1.3, stunAdd: 0.8 })],
  r_stab: [A('쌍찌르기', '한 번 더 (60%)', { echo: 0.6 }), A('치명 강화', '치명 확률 +30%', { critBonusAdd: 0.3 })],
  r_poison: [A('맹독', '지속 피해 ×1.8', { dotMul: 1.8 }), A('독안개', '모든 적에게 (80%)', { toAll: true, coefMul: 0.8 })],
  r_shadow: [A('긴 은신', '회피 +1.5초', { evadeAdd: 1.5 }), A('그림자 연격', '이후 3번 공격 치명타', { critStacks: 3 })],
  r_execute: [A('단두대', '2배 기준 HP 45% 이하', { execute: 0.45 }), A('연속 처형', '재사용 대기 ×0.7', { cdMul: 0.7 })],
  r_smoke: [A('짙은 연막', '회피 +2초', { evadeAdd: 2 }), A('독 연막', '4초간 독 피해', { dotAdd: { coefPerSec: 0.4, sec: 4 } })],
  r_shadowstrike: [A('그림자 춤', '+2번 (타격당 80%)', { hitsAdd: 2, coefMul: 0.8 }), A('암살', '치명 확률 +30%', { critBonusAdd: 0.3 })],
  r_illusion: [A('분신 증원', '한 번 더', { hitsAdd: 1 }), A('환영 은신', '회피 +1.5초', { evadeAdd: 1.5 })],
  r_blades: [A('칼날 폭풍', '모든 적에게 (55%)', { toAll: true, coefMul: 0.55 }), A('만 개의 칼날', '+6번 (타격당 80%)', { hitsAdd: 6, coefMul: 0.8 })],
});

// 재련: reroll one option. ore × (1 + 0.5 × times reforged), gold = goldPerLevel × item level × (1 + times)
export const REFORGE = Object.freeze({ ore: { common: 10, uncommon: 20, rare: 40, epic: 80, legendary: 150, mythic: 250 }, growth: 0.5, goldPerLevel: 400 });
// 레벨 맞추기: raise an item's level (up to the hero's level). Cost of one step L → L+1:
// ore = ceil(ore[rarity] × (1 + L/25)), gold = gold[rarity] × L.
export const ITEM_LEVEL = Object.freeze({
  ore: { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 5, mythic: 8 },
  gold: { common: 20, uncommon: 30, rare: 50, epic: 80, legendary: 120, mythic: 180 },
});
// 등급 올리기: 3 of the same slot & rarity (1 base + 2 materials) → next rarity
export const RARITY_UP = Object.freeze({
  next: { common: 'uncommon', uncommon: 'rare', rare: 'epic', epic: 'legendary', legendary: 'mythic' },
  ore: { uncommon: 20, rare: 60, epic: 150, legendary: 400, mythic: 1000 },
  starShard: { mythic: 2 },
});
// 고유 효과 추출 / 이식 비용
export const EXTRACT = Object.freeze({ ore: 200, awakenStone: 1 });
export const IMPRINT = Object.freeze({ ore: 300, goldPerLevel: 600 });

// 프리셋 (장비 + 스킬 + 각인). Battle kinds → preset index when 자동 교체 is on.
export const LOADOUT_NAMES = ['사냥', '보스', '쐐기'];
export const LOADOUT_KINDS = Object.freeze({ farm: '사냥', dungeon: '재료 던전', boss: '지역 보스', raid: '레이드', world: '월드 보스', tower: '시련의 탑', trial: '승급 시련', mplus: '쐐기 던전', rift: '균열' });
export const LOADOUT_DEFAULT_MAP = Object.freeze({ farm: 0, dungeon: 0, boss: 1, raid: 1, world: 1, tower: 1, trial: 1, mplus: 2, rift: 2 });
