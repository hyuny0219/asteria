// Game content: 4 classes, 8 branches × 3 tiers, 10 regions, 20 monsters, 10 bosses,
// skills, runes, equipment visuals and sets. See docs/DESIGN_V4.md.
// Monster/boss telegraph timings for M01–M06/B01–B03 come from docs/handoff/07_BESTIARY.md.
// New creatures reuse an existing sprite with a hue `tint` until their own art exists.

export const MONSTERS = Object.freeze({
  M01: { id: 'M01', name: '가시 슬라임', sprite: 'M01', telegraphMs: 400, telegraph: 'crouch', attack: 'leap' },
  M02: { id: 'M02', name: '잿빛 가시늑대', sprite: 'M02', telegraphMs: 450, telegraph: 'crouch', attack: 'bite' },
  M03: { id: 'M03', name: '사암 풍뎅이', sprite: 'M03', telegraphMs: 550, telegraph: 'line', attack: 'charge' },
  M04: { id: 'M04', name: '황금 가면 망령', sprite: 'M04', telegraphMs: 650, telegraph: 'glow', attack: 'bolt', flying: true },
  M05: { id: 'M05', name: '해골 광부', sprite: 'M05', telegraphMs: 550, telegraph: 'raise', attack: 'smash' },
  M06: { id: 'M06', name: '흑요석 거미', sprite: 'M06', telegraphMs: 500, telegraph: 'raise', attack: 'claw' },
  M07: { id: 'M07', name: '독거미', sprite: 'M07', telegraphMs: 450, telegraph: 'raise', attack: 'claw' },
  M08: { id: 'M08', name: '트렌트', sprite: 'M08', telegraphMs: 650, telegraph: 'raise', attack: 'smash' },
  M09: { id: 'M09', name: '설인', sprite: 'M09', telegraphMs: 550, telegraph: 'crouch', attack: 'bite' },
  M10: { id: 'M10', name: '서리 마녀', sprite: 'M10', telegraphMs: 650, telegraph: 'glow', attack: 'bolt', flying: true },
  M11: { id: 'M11', name: '화염 정령', sprite: 'M11', telegraphMs: 600, telegraph: 'glow', attack: 'bolt', flying: true },
  M12: { id: 'M12', name: '샐러맨더', sprite: 'M12', telegraphMs: 550, telegraph: 'line', attack: 'charge' },
  M13: { id: 'M13', name: '머맨', sprite: 'M13', telegraphMs: 550, telegraph: 'raise', attack: 'smash' },
  M14: { id: 'M14', name: '심해어', sprite: 'M14', telegraphMs: 450, telegraph: 'crouch', attack: 'leap' },
  M15: { id: 'M15', name: '스켈레톤 기사', sprite: 'M15', telegraphMs: 550, telegraph: 'raise', attack: 'smash' },
  M16: { id: 'M16', name: '망령', sprite: 'M16', telegraphMs: 600, telegraph: 'glow', attack: 'bolt', flying: true },
  M17: { id: 'M17', name: '그리폰', sprite: 'M17', telegraphMs: 500, telegraph: 'crouch', attack: 'bite' },
  M18: { id: 'M18', name: '타락 천사병', sprite: 'M18', telegraphMs: 600, telegraph: 'glow', attack: 'bolt', flying: true },
  M19: { id: 'M19', name: '공허의 촉수', sprite: 'M19', telegraphMs: 550, telegraph: 'raise', attack: 'claw' },
  M20: { id: 'M20', name: '그림자 마수', sprite: 'M20', telegraphMs: 500, telegraph: 'crouch', attack: 'bite' },
});

// Boss patterns: normal attack + telegraphed heavy every `everySec` + enrage under 30% HP.
export const BOSSES = Object.freeze({
  B01: { id: 'B01', name: '가시 슬라임 군주', sprite: 'B01', region: 'meadow', level: 10, lesson: '기본 공격 읽기', telegraphMs: 400,
    heavy: { name: '도약 착지', everySec: 8, telegraphMs: 700, mult: 2.2, shape: 'circle' },
    desc: '몸을 크게 움츠린 뒤 도약합니다. 착지 원이 나타나면 피해가 큽니다.' },
  B02: { id: 'B02', name: '모래 수호자', sprite: 'B02', region: 'desert', level: 20, lesson: '주기적 강공', telegraphMs: 550,
    heavy: { name: '대지 균열', everySec: 7, telegraphMs: 1000, mult: 2.6, shape: 'crack' },
    desc: '양팔을 들어 올리면 1초 뒤 바닥이 갈라집니다. 방어 효과로 받아내세요.' },
  B03: { id: 'B03', name: '폐광 파수꾼', sprite: 'B03', region: 'mine', level: 32, lesson: '방어 타이밍', telegraphMs: 550,
    heavy: { name: '곡괭이 일격', everySec: 6.5, telegraphMs: 1200, mult: 3.0, shape: 'line' },
    desc: '곡괭이를 높이 들면 직선 경고가 나타납니다. 경고 중 방어 효과로 피해를 줄일 수 있습니다.' },
  B04: { id: 'B04', name: '여왕 거미 아라크네', sprite: 'B04', region: 'forest', level: 40, lesson: '연속 공격', telegraphMs: 500,
    heavy: { name: '독사 분사', everySec: 6.5, telegraphMs: 1000, mult: 2.8, shape: 'circle' },
    desc: '배를 들어 올리면 독사를 뿌립니다. HP 30% 아래에서 더 빨라집니다.' },
  B05: { id: 'B05', name: '프로스트 웜', sprite: 'B05', region: 'glacier', level: 50, lesson: '긴 예고, 큰 피해', telegraphMs: 600,
    heavy: { name: '빙결 돌진', everySec: 7, telegraphMs: 1300, mult: 3.2, shape: 'line' },
    desc: '몸을 말아 올린 뒤 직선으로 돌진합니다.' },
  B06: { id: 'B06', name: '이프리트', sprite: 'B06', region: 'volcano', level: 60, lesson: '2차 승급의 벽', telegraphMs: 550,
    heavy: { name: '화염 폭발', everySec: 6, telegraphMs: 1100, mult: 3.2, shape: 'circle' },
    desc: '두 팔에 불꽃을 모으면 주변이 폭발합니다. 2차 승급 조건입니다.' },
  B07: { id: 'B07', name: '크라켄', sprite: 'B07', region: 'abyssal', level: 70, lesson: '광폭화 대비', telegraphMs: 550,
    heavy: { name: '촉수 내려치기', everySec: 6, telegraphMs: 1100, mult: 3.3, shape: 'crack' },
    desc: '촉수를 높이 들어 내려칩니다. 광폭화하면 연달아 칩니다.' },
  B08: { id: 'B08', name: '데스나이트 군주', sprite: 'B08', region: 'castle', level: 80, lesson: '방어 효과 관리', telegraphMs: 550,
    heavy: { name: '저주의 참격', everySec: 5.5, telegraphMs: 1100, mult: 3.4, shape: 'line' },
    desc: '검에 어둠을 모은 뒤 참격을 날립니다.' },
  B09: { id: 'B09', name: '타락한 대천사', sprite: 'B09', region: 'sky', level: 90, lesson: '3차 승급의 벽', telegraphMs: 550,
    heavy: { name: '심판의 빛', everySec: 5.5, telegraphMs: 1200, mult: 3.6, shape: 'circle' },
    desc: '날개를 펼치면 빛이 떨어집니다. 3차 승급 조건입니다.' },
  // 10-보스 (stage boss fight, like B01–B09). The weekly raid reuses its art/pattern with its
  // own HP pool, timer and grades (raid.js) — the two never affect each other.
  B10: { id: 'B10', name: '심연의 군주', sprite: 'B10', region: 'void', level: 100, lesson: '마지막 보스', telegraphMs: 550,
    heavy: { name: '공허 붕괴', everySec: 5, telegraphMs: 1200, mult: 3.8, shape: 'crack' },
    desc: '심연의 마지막 주인. 땅이 갈라지면 피하세요. 처치하면 다음 난이도가 열립니다. (주간 레이드는 별도)' },
});

export const REGIONS = Object.freeze([
  { id: 'meadow', name: '별빛 초원', minLv: 1, maxLv: 10, label: 'Lv 1–10', monsters: ['M01', 'M02'], boss: 'B01', bg: 'meadow', order: 0 },
  { id: 'desert', name: '고대 사막', minLv: 11, maxLv: 20, label: 'Lv 11–20', monsters: ['M03', 'M04'], boss: 'B02', bg: 'desert', order: 1 },
  { id: 'mine', name: '잊힌 폐광', minLv: 21, maxLv: 33, label: 'Lv 21–35', monsters: ['M05', 'M06'], boss: 'B03', bg: 'mine', order: 2 },
  { id: 'forest', name: '어둠의 숲', minLv: 31, maxLv: 40, label: 'Lv 31–40', monsters: ['M07', 'M08'], boss: 'B04', bg: 'forest', order: 3 },
  { id: 'glacier', name: '얼음 산맥', minLv: 41, maxLv: 50, label: 'Lv 41–50', monsters: ['M09', 'M10'], boss: 'B05', bg: 'glacier', order: 4 },
  { id: 'volcano', name: '화산 지대', minLv: 51, maxLv: 60, label: 'Lv 51–60', monsters: ['M11', 'M12'], boss: 'B06', bg: 'volcano', order: 5 },
  { id: 'abyssal', name: '가라앉은 도시', minLv: 61, maxLv: 70, label: 'Lv 61–70', monsters: ['M13', 'M14'], boss: 'B07', bg: 'abyssal', order: 6 },
  { id: 'castle', name: '망자의 성', minLv: 71, maxLv: 80, label: 'Lv 71–80', monsters: ['M15', 'M16'], boss: 'B08', bg: 'castle', order: 7 },
  { id: 'sky', name: '천공의 섬', minLv: 81, maxLv: 90, label: 'Lv 81–90', monsters: ['M17', 'M18'], boss: 'B09', bg: 'sky', order: 8 },
  { id: 'void', name: '심연', minLv: 91, maxLv: 100, label: 'Lv 91–100', monsters: ['M19', 'M20'], boss: 'B10', bg: 'void', order: 9 },
]);
export const REGION_BY_ID = Object.freeze(Object.fromEntries(REGIONS.map((r) => [r.id, r])));

export function waveLevel(region, wave) {
  const r = typeof region === 'string' ? REGION_BY_ID[region] : region;
  return Math.round(r.minLv + ((wave - 1) * (r.maxLv - r.minLv)) / 9);
}

// ---------- classes ----------
export const CLASSES = Object.freeze({
  warrior: { id: 'warrior', name: '전사', hero: '세린', age: 28, role: '근접 탱커/딜러', range: 'melee', mainStat: 'str',
    mods: { hp: 1.25, def: 1.3 }, autoStats: { str: 2, vit: 2, agi: 1 }, sprite: 'hero', desc: '흑장미의 서약을 지키는 기사. 단단하고 꾸준합니다.' },
  mage: { id: 'mage', name: '마법사', hero: '엘레나', age: 30, role: '원거리 광역 딜러', range: 'ranged', mainStat: 'int',
    mods: { atk: 1.15, hp: 0.85 }, autoStats: { int: 3, wis: 1, vit: 1 }, sprite: 'hero', art: { base: 'cls_mage', face: 'face_mage', card: 'card_mage', kv: 'kv_mage' }, desc: '보랏빛 긴 머리의 마도사. 마도서로 별을 불러 여러 적을 한 번에 공격합니다.' },
  archer: { id: 'archer', name: '궁수', hero: '리라', age: 26, role: '원거리 단일 딜러', range: 'ranged', mainStat: 'dex',
    mods: { atk: 1.1 }, crit: 0.05, aspd: 0.1, autoStats: { dex: 3, agi: 1, vit: 1 }, sprite: 'hero', art: { base: 'cls_archer', face: 'face_archer', card: 'card_archer', kv: 'kv_archer' }, desc: '붉은 포니테일의 숲 감시자. 장궁으로 한 적씩 정확하게 노립니다.' },
  rogue: { id: 'rogue', name: '도적', hero: '녹스', age: 29, role: '근접 치명·회피', range: 'melee', mainStat: 'agi',
    mods: { hp: 0.95 }, crit: 0.10, evade: 0.08, autoStats: { agi: 3, dex: 1, vit: 1 }, sprite: 'hero', art: { base: 'cls_rogue', face: 'face_rogue', card: 'card_rogue', kv: 'kv_rogue' }, desc: '검은 단발에 진홍빛 눈의 그림자 칼날. 쌍단검 연타와 회피로 싸웁니다.' },
});
export const CLASS_IDS = Object.keys(CLASSES);
export const STAT_KEYS = ['str', 'int', 'dex', 'agi', 'vit', 'wis'];
export const STAT_NAMES = Object.freeze({ str: '힘 STR', int: '지능 INT', dex: '민첩 DEX', agi: '기민 AGI', vit: '체력 VIT', wis: '지혜 WIS' });

// ---------- skills ----------
// kind: damage | buff | shield | evade | passive-counter | ultimate
// target single|all, hits (multi-hit at impact), dot {coefPerSec, sec}, stunSec, slow {mul, sec}
export const SKILLS = Object.freeze({
  // warrior (v3 ids kept)
  strike: { id: 'strike', cls: 'warrior', name: '강타', icon: 'S0', kind: 'damage', coef: 2.0, cd: 6, target: 'single', desc: '전방의 적 하나를 강하게 벱니다.', unlock: { level: 1 } },
  shieldCharge: { id: 'shieldCharge', cls: 'warrior', name: '방패 돌진', icon: 'S1', kind: 'damage', coef: 1.5, cd: 8, target: 'single', guard: { sec: 2, reduce: 0.4 }, desc: '방패로 돌진해 피해를 주고 2초간 받는 피해를 40% 줄입니다.', unlock: { level: 3 } },
  warCry: { id: 'warCry', cls: 'warrior', name: '전장의 외침', icon: 'S2', kind: 'buff', cd: 20, buff: { stat: 'atk', mul: 0.2, sec: 8 }, desc: '8초간 공격력이 20% 증가합니다. 같은 효과는 겹치지 않고 지속 시간만 갱신됩니다.', unlock: { level: 6 } },
  guardCounter: { id: 'guardCounter', cls: 'warrior', name: '수호 반격', icon: 'S3', kind: 'passive-counter', coef: 1.8, internalCd: 1, desc: '방패 돌진의 방어 시간 중 피해를 받으면 즉시 반격합니다. (내부 대기 1초)', unlock: { tier: 1, branch: 'knight' } },
  berserkStrike: { id: 'berserkStrike', cls: 'warrior', name: '광폭 일격', icon: 'S4', kind: 'damage', coef: 3.2, cd: 10, target: 'single', lowHpBonus: { below: 0.5, atkMul: 0.25 }, desc: '양손 대검으로 내려칩니다. 체력 50% 이하에서는 모든 공격의 공격력이 25% 증가합니다.', unlock: { tier: 1, branch: 'berserker' } },
  w_judgement: { id: 'w_judgement', cls: 'warrior', name: '심판의 일격', icon: 'K32', kind: 'damage', coef: 2.6, cd: 9, target: 'single', stunSec: 1, guard: { sec: 2, reduce: 0.3 }, desc: '빛나는 검으로 내려쳐 1초 기절시키고 2초간 피해를 30% 줄입니다.', unlock: { tier: 2, branch: 'knight' } },
  w_whirl: { id: 'w_whirl', cls: 'warrior', name: '회전베기', icon: 'K33', kind: 'damage', coef: 1.6, cd: 6, target: 'all', desc: '대검을 휘둘러 모든 적을 벱니다.', unlock: { tier: 2, branch: 'berserker' } },
  starSlash: { id: 'starSlash', cls: 'warrior', name: '별빛 참격', icon: 'S5', kind: 'ultimate', coef: 6.0, target: 'all', stunSec: 2, desc: '궁극기. 모든 적에게 별빛 참격(대지 분쇄)을 날리고 2초 기절시킵니다. 게이지 100 소모.', unlock: { level: 1 } },
  // mage
  m_fireball: { id: 'm_fireball', cls: 'mage', name: '파이어볼', icon: 'G00', kind: 'damage', coef: 2.0, cd: 2, target: 'single', desc: '불덩이를 던집니다.', unlock: { level: 1 } },
  m_frost: { id: 'm_frost', cls: 'mage', name: '서리 고리', icon: 'K01', kind: 'damage', coef: 1.4, cd: 8, target: 'all', slow: { mul: 0.6, sec: 3 }, desc: '모든 적을 얼려 3초간 공격을 늦춥니다.', unlock: { level: 3 } },
  m_shield: { id: 'm_shield', cls: 'mage', name: '마나 실드', icon: 'G06', kind: 'shield', cd: 25, shield: { pct: 0.25, sec: 10 }, desc: '10초간 최대 HP 25%만큼 피해를 흡수합니다.', unlock: { level: 6 } },
  m_chain: { id: 'm_chain', cls: 'mage', name: '연쇄 번개', icon: 'G04', kind: 'damage', coef: 1.8, cd: 7, target: 'all', desc: '번개가 모든 적을 연달아 칩니다.', unlock: { tier: 1, branch: 'wizard' } },
  m_curse: { id: 'm_curse', cls: 'mage', name: '저주', icon: 'G07', kind: 'damage', coef: 0.6, cd: 8, target: 'single', dot: { coefPerSec: 0.8, sec: 6 }, desc: '6초간 초당 피해를 주는 저주를 겁니다.', unlock: { tier: 1, branch: 'warlock' } },
  m_blizzard: { id: 'm_blizzard', cls: 'mage', name: '눈보라', icon: 'G02', kind: 'damage', coef: 2.2, cd: 10, target: 'all', slow: { mul: 0.5, sec: 4 }, desc: '눈보라로 모든 적을 베고 4초간 크게 늦춥니다.', unlock: { tier: 2, branch: 'wizard' } },
  m_drain: { id: 'm_drain', cls: 'mage', name: '생명 흡수', icon: 'G05', kind: 'damage', coef: 2.4, cd: 9, target: 'single', heal: 0.1, desc: '피해를 주고 최대 HP 10%를 회복합니다.', unlock: { tier: 2, branch: 'warlock' } },
  m_meteor: { id: 'm_meteor', cls: 'mage', name: '메테오', icon: 'G01', kind: 'ultimate', coef: 3.5, hits: 3, target: 'all', desc: '궁극기. 운석 3개가 모든 적에게 떨어집니다.', unlock: { level: 1 } },
  // archer
  a_aim: { id: 'a_aim', cls: 'archer', name: '정조준', icon: 'G12', kind: 'damage', coef: 2.2, cd: 3, target: 'single', desc: '숨을 고르고 정확히 쏩니다.', unlock: { level: 1 } },
  a_multi: { id: 'a_multi', cls: 'archer', name: '멀티샷', icon: 'G09', kind: 'damage', coef: 0.8, hits: 5, cd: 5, target: 'spread', desc: '화살 5발을 적들에게 나눠 쏩니다.', unlock: { level: 3 } },
  a_leap: { id: 'a_leap', cls: 'archer', name: '후방 도약', icon: 'K10', kind: 'evade', cd: 10, evade: { sec: 2 }, desc: '뒤로 뛰어 2초간 모든 공격을 피합니다.', unlock: { level: 6 } },
  a_pierce: { id: 'a_pierce', cls: 'archer', name: '관통 사격', icon: 'G08', kind: 'damage', coef: 2.0, cd: 6, target: 'all', desc: '일렬로 선 적을 모두 꿰뚫습니다.', unlock: { tier: 1, branch: 'ranger' } },
  a_beast: { id: 'a_beast', cls: 'archer', name: '야수 소환', icon: 'G13', kind: 'damage', coef: 0.5, cd: 10, target: 'single', dot: { coefPerSec: 1.0, sec: 6 }, desc: '늑대를 불러 6초간 물어뜯게 합니다.', unlock: { tier: 1, branch: 'hunter' } },
  a_snipe: { id: 'a_snipe', cls: 'archer', name: '저격', icon: 'G11', kind: 'damage', coef: 4.5, cd: 12, target: 'single', critBonus: 0.3, desc: '치명타 확률 +30%의 강력한 한 발.', unlock: { tier: 2, branch: 'ranger' } },
  a_pack: { id: 'a_pack', cls: 'archer', name: '무리 사냥', icon: 'K14', kind: 'damage', coef: 1.5, hits: 2, cd: 9, target: 'all', desc: '야수 무리가 모든 적을 두 번 공격합니다.', unlock: { tier: 2, branch: 'hunter' } },
  a_rain: { id: 'a_rain', cls: 'archer', name: '화살비', icon: 'K15', kind: 'ultimate', coef: 1.5, hits: 5, target: 'all', desc: '궁극기. 하늘에서 화살비가 5번 쏟아집니다.', unlock: { level: 1 } },
  // rogue
  r_stab: { id: 'r_stab', cls: 'rogue', name: '급소 찌르기', icon: 'G23', kind: 'damage', coef: 1.6, cd: 2, target: 'single', critBonus: 0.3, desc: '치명타 확률 +30%로 급소를 찌릅니다.', unlock: { level: 1 } },
  r_poison: { id: 'r_poison', cls: 'rogue', name: '독칼', icon: 'G17', kind: 'damage', coef: 0.6, cd: 7, target: 'single', dot: { coefPerSec: 0.5, sec: 6 }, desc: '6초간 독 피해를 줍니다.', unlock: { level: 3 } },
  r_shadow: { id: 'r_shadow', cls: 'rogue', name: '그림자 걸음', icon: 'G18', kind: 'evade', cd: 15, evade: { sec: 2, nextCrit: true }, desc: '2초간 은신해 모든 공격을 피하고, 다음 공격은 치명타가 됩니다.', unlock: { level: 6 } },
  r_execute: { id: 'r_execute', cls: 'rogue', name: '처형', icon: 'G20', kind: 'damage', coef: 3.0, cd: 8, target: 'single', executeBelow: 0.3, desc: 'HP 30% 이하의 적에게 피해가 두 배입니다.', unlock: { tier: 1, branch: 'assassin' } },
  r_smoke: { id: 'r_smoke', cls: 'rogue', name: '연막', icon: 'G22', kind: 'damage', coef: 1.0, cd: 12, target: 'all', evadeSec: 3, desc: '연막으로 모든 적을 베고 3초간 공격을 피합니다.', unlock: { tier: 1, branch: 'trickster' } },
  r_shadowstrike: { id: 'r_shadowstrike', cls: 'rogue', name: '그림자 강습', icon: 'G16', kind: 'damage', coef: 2.0, hits: 3, cd: 9, target: 'single', desc: '세 번 연달아 벱니다.', unlock: { tier: 2, branch: 'assassin' } },
  r_illusion: { id: 'r_illusion', cls: 'rogue', name: '환영 분신', icon: 'G21', kind: 'damage', coef: 1.4, hits: 2, cd: 10, target: 'all', evadeSec: 1, desc: '분신과 함께 모든 적을 두 번 공격합니다.', unlock: { tier: 2, branch: 'trickster' } },
  r_blades: { id: 'r_blades', cls: 'rogue', name: '천 개의 칼날', icon: 'G19', kind: 'ultimate', coef: 0.9, hits: 12, target: 'single', desc: '궁극기. 칼날 12번으로 한 적을 몰아칩니다.', unlock: { level: 1 } },
});

export const CLASS_SKILLS = Object.freeze({
  warrior: { base: ['strike', 'shieldCharge', 'warCry'], ult: 'starSlash' },
  mage: { base: ['m_fireball', 'm_frost', 'm_shield'], ult: 'm_meteor' },
  archer: { base: ['a_aim', 'a_multi', 'a_leap'], ult: 'a_rain' },
  rogue: { base: ['r_stab', 'r_poison', 'r_shadow'], ult: 'r_blades' },
});
export const NORMAL_SKILLS_BASE = CLASS_SKILLS.warrior.base;
export const ULT_IDS = Object.freeze(Object.values(CLASS_SKILLS).map((c) => c.ult));

// ---------- branches (8) × tiers (3) ----------
const BRANCH_DEFS = {
  knight: { id: 'knight', cls: 'warrior', names: ['흑장미 기사', '팔라딘', '크루세이더', '여명의 성벽'], role: '방패 · 반격', weapon: '큰 방패와 장검', finalUlt: '천상의 심판',
    tiers: [{ def: 0.15, hp: 0.15 }, { def: 0.1, hp: 0.1 }, { hp: 0.1, atk: 0.15, defToAtk: 0.5 }, { atk: 0.15, hp: 0.1, def: 0.1, defToAtk: 0.35 }], skills: ['guardCounter', 'w_judgement'],
    desc: '흰 금속 갑옷과 큰 방패. 방어 시간 중 받는 피해에 반격합니다.' },
  berserker: { id: 'berserker', cls: 'warrior', names: ['진홍의 집행자', '워로드', '블러드 로드', '혈월의 폭군'], role: '대검 · 공격', weapon: '양손 대검', finalUlt: '피의 폭풍',
    tiers: [{ atk: 0.12 }, { atk: 0.08, crit: 0.03 }, { atk: 0.16, hp: 0.05 }, { atk: 0.18, hp: 0.05 }], skills: ['berserkStrike', 'w_whirl'],
    desc: '검은 금속과 비대칭 붉은 코트. 체력이 낮을수록 강해지는 공격형입니다.' },
  wizard: { id: 'wizard', cls: 'mage', names: ['위자드', '아크메이지', '엘리멘탈 마스터', '성좌의 대현자'], role: '원소 · 광역', weapon: '천구 지팡이', finalUlt: '원소 대폭발',
    tiers: [{ atk: 0.1 }, { atk: 0.08, cdr: 0.05 }, { atk: 0.15, hp: 0.06 }, { atk: 0.14, cdr: 0.03, hp: 0.18, def: 0.12, dmgTaken: 0.15 }], skills: ['m_chain', 'm_blizzard'], desc: '원소를 다루는 정통 마도사. 광역 피해와 둔화.' },
  warlock: { id: 'warlock', cls: 'mage', names: ['워록', '네크로맨서', '리치 로드', '밤의 주권자'], role: '암흑 · 지속 피해', weapon: '심연의 마도서', finalUlt: '죽음의 군단',
    tiers: [{ atk: 0.06, hp: 0.08 }, { atk: 0.08, hp: 0.05 }, { atk: 0.1, hp: 0.08 }, { atk: 0.12, hp: 0.2, def: 0.08, lifesteal: 0.03, dmgTaken: 0.15 }], skills: ['m_curse', 'm_drain'], desc: '저주와 흡수로 오래 버티며 싸웁니다.' },
  ranger: { id: 'ranger', cls: 'archer', names: ['레인저', '스나이퍼', '호크아이', '별을 꿰는 자'], role: '정밀 · 치명', weapon: '장궁', finalUlt: '매의 눈',
    tiers: [{ crit: 0.05, atk: 0.05 }, { critDmg: 0.2 }, { atk: 0.1, crit: 0.05, hp: 0.15 }, { atk: 0.12, critDmg: 0.15, hp: 0.1 }], skills: ['a_pierce', 'a_snipe'], desc: '한 발 한 발이 치명적인 명사수.' },
  hunter: { id: 'hunter', cls: 'archer', names: ['헌터', '비스트마스터', '와일드 킹', '태고의 사냥꾼'], role: '야성 · 소환', weapon: '가시나무 장궁', finalUlt: '야수의 왕',
    tiers: [{ atk: 0.06, hp: 0.06 }, { atk: 0.08, aspd: 0.05 }, { atk: 0.1, hp: 0.08 }, { atk: 0.12, aspd: 0.05 }], skills: ['a_beast', 'a_pack'], desc: '야수와 함께 사냥합니다.' },
  assassin: { id: 'assassin', cls: 'rogue', names: ['어쌔신', '나이트블레이드', '섀도우', '그믐의 처형자'], role: '암살 · 폭발', weapon: '쌍단검', finalUlt: '그림자 처형',
    tiers: [{ atk: 0.1 }, { critDmg: 0.25 }, { atk: 0.12, crit: 0.03, hp: 0.2, def: 0.1, lifesteal: 0.06 }, { atk: 0.14, critDmg: 0.15, hp: 0.08 }], skills: ['r_execute', 'r_shadowstrike'], desc: '약한 적을 순식간에 끝냅니다.' },
  trickster: { id: 'trickster', cls: 'rogue', names: ['트릭스터', '팬텀', '페이트위버', '천 개의 가면'], role: '기교 · 회피', weapon: '단검과 카드', finalUlt: '운명의 실',
    tiers: [{ evade: 0.05, atk: 0.05 }, { evade: 0.04, aspd: 0.05 }, { atk: 0.1, evade: 0.04, hp: 0.15, def: 0.1, lifesteal: 0.05 }, { atk: 0.12, evade: 0.03, aspd: 0.04, hp: 0.06 }], skills: ['r_smoke', 'r_illusion'], desc: '회피와 환영으로 상대를 농락합니다.' },
};
for (const b of Object.values(BRANCH_DEFS)) { b.name = b.names[0]; b.passive = b.tiers[0]; }   // v3 fields
export const BRANCHES = Object.freeze(BRANCH_DEFS);

export const BRANCH_SKILL = Object.freeze(Object.fromEntries(Object.values(BRANCHES).map((b) => [b.id, b.skills[0]])));
export const BRANCH_SKILL2 = Object.freeze(Object.fromEntries(Object.values(BRANCHES).map((b) => [b.id, b.skills[1]])));
export const branchesOf = (cls) => Object.values(BRANCHES).filter((b) => b.cls === cls).map((b) => b.id);

// ---------- runes (각인, from the skill draw) ----------
// rune icons: K24–K31 (generated/skills_v4.png). Tower / raid emblems: K34 / K35.
export const EMBLEMS = Object.freeze({ tower: 'K34', raid: 'K35' });
export const RUNES = Object.freeze({
  lifesteal: { id: 'lifesteal', name: '흡혈', icon: 'K24', stat: 'lifesteal', base: 0.03, desc: '준 피해의 3% 회복' },
  combo: { id: 'combo', name: '연격', icon: 'K25', stat: 'combo', base: 0.1, desc: '10% 확률로 50% 추가타' },
  ward: { id: 'ward', name: '별의 가호', icon: 'K26', stat: 'dmgTaken', base: 0.08, desc: '받는 피해 -8%' },
  midas: { id: 'midas', name: '황금손', icon: 'K27', stat: 'goldPct', base: 0.15, desc: '골드 +15%' },
  focus: { id: 'focus', name: '집중', icon: 'K28', stat: 'critDmg', base: 0.25, desc: '치명 피해 +25%' },
  gale: { id: 'gale', name: '질풍', icon: 'K29', stat: 'aspd', base: 0.1, desc: '공격 속도 +10%' },
  bulwark: { id: 'bulwark', name: '철벽', icon: 'K30', stat: 'hpPct', base: 0.12, desc: '최대 HP +12%' },
  charge: { id: 'charge', name: '충전', icon: 'K31', stat: 'ultCharge', base: 0.2, desc: '궁극기 충전 +20%' },
});

// ---------- equipment ----------
// 3 looks per slot; 6 rarities map onto them (common/uncommon → 0, rare/epic → 1, legendary/mythic → 2).
// Gloves/boots/ring have no art yet and borrow existing icons (iconPending).
const NECKLACE_LOOKS = [{ icon: 'I09', name: '은 펜던트' }, { icon: 'I10', name: '자수정 펜던트' }, { icon: 'I11', name: '장미별 펜던트' }];
export const ITEM_LOOKS = Object.freeze({
  accessory: NECKLACE_LOOKS,   // v3 alias
  weapon: [{ icon: 'I00', name: '철검' }, { icon: 'I01', name: '금장 장검' }, { icon: 'I02', name: '흑장미 검' }],
  helmet: [{ icon: 'I03', name: '철 투구' }, { icon: 'I04', name: '금장 투구' }, { icon: 'I05', name: '흑장미 투구' }],
  armor: [{ icon: 'I06', name: '가죽 갑옷' }, { icon: 'I07', name: '금장 갑옷' }, { icon: 'I08', name: '흑장미 갑옷' }],
  // gloves / boots / ring have 4 generated looks: common, uncommon, rare, epic+ (see RARITY_LOOK4)
  gloves: [{ icon: 'I24', name: '철 건틀릿' }, { icon: 'I25', name: '금장 건틀릿' }, { icon: 'I26', name: '흑장미 건틀릿' }, { icon: 'I27', name: '진홍 룬 건틀릿' }],
  boots: [{ icon: 'I28', name: '가죽 장화' }, { icon: 'I29', name: '금장 각반' }, { icon: 'I30', name: '흑장미 각반' }, { icon: 'I31', name: '진홍 룬 장화' }],
  necklace: NECKLACE_LOOKS,
  ring: [{ icon: 'I32', name: '은 반지' }, { icon: 'I33', name: '자수정 반지' }, { icon: 'I34', name: '장미별 반지' }, { icon: 'I35', name: '진홍 룬 반지' }],
});
// Class weapons (handoff v4 class_weapons_9): common, uncommon, rare+ looks per class.
export const CLASS_WEAPON_LOOKS = Object.freeze({
  mage: [{ icon: 'I40', name: '낡은 마도서' }, { icon: 'I41', name: '성좌의 마도서' }, { icon: 'I42', name: '심연의 마도서' }],
  archer: [{ icon: 'I43', name: '사냥꾼의 활' }, { icon: 'I44', name: '은월의 활' }, { icon: 'I45', name: '가시나무 장궁' }],
  rogue: [{ icon: 'I46', name: '강철 쌍단검' }, { icon: 'I47', name: '금장 쌍단검' }, { icon: 'I48', name: '적월 쌍단검' }],
});
export const SLOT_NAMES = Object.freeze({ weapon: '무기', helmet: '투구', armor: '갑옷', gloves: '장갑', boots: '신발', necklace: '목걸이', ring: '반지', ring1: '반지 1', ring2: '반지 2', accessory: '목걸이' });
export const equipSlotFor = (itemSlot) => (itemSlot === 'ring' ? ['ring1', 'ring2'] : [itemSlot]);
export const RARITY = Object.freeze({
  common: { id: 'common', name: '일반', mark: 'I', order: 0, color: '#9AA3AD' },
  uncommon: { id: 'uncommon', name: '고급', mark: 'II', order: 1, color: '#55C59A' },
  rare: { id: 'rare', name: '희귀', mark: 'III', order: 2, color: '#74B8FF' },
  epic: { id: 'epic', name: '영웅', mark: 'IV', order: 3, color: '#B784F5' },
  legendary: { id: 'legendary', name: '전설', mark: 'V', order: 4, color: '#F2A04A' },
  mythic: { id: 'mythic', name: '신화', mark: 'VI', order: 5, color: '#F0506E' },
});
export const OPTION_NAMES = Object.freeze({
  atkPct: '공격력', critChance: '치명타 확률', critDmg: '치명타 피해', aspd: '공격 속도', hpPct: '최대 HP', defPct: '방어력',
  cdr: '스킬 쿨타임 감소', ultCharge: '궁극기 충전량', goldPct: '골드 획득량',
  mythUltCdr: '궁극기 후 5초간 스킬 쿨타임 50% 감소', mythHeal: '처치 시 10% 확률로 HP 20% 회복',
});

// Boss armour sets: helmet/armor/gloves/boots dropped by a region boss share its set.
export const SETS = Object.freeze({
  meadow: { name: '초원 순례자', b2: { hpPct: 0.06 }, b4: { atkPct: 0.06 } },
  desert: { name: '사막 수호자', b2: { defPct: 0.08 }, b4: { hpPct: 0.08 } },
  mine: { name: '폐광 파수꾼', b2: { atkPct: 0.06 }, b4: { critChance: 0.04 } },
  forest: { name: '여왕의 독니', b2: { critChance: 0.03 }, b4: { atkPct: 0.1 } },
  glacier: { name: '서리 군주', b2: { hpPct: 0.1 }, b4: { defPct: 0.12 } },
  volcano: { name: '화염 정령왕', b2: { atkPct: 0.08 }, b4: { critDmg: 0.2 } },
  abyssal: { name: '심해 지배자', b2: { hpPct: 0.1 }, b4: { aspd: 0.08 } },
  castle: { name: '죽음의 기사', b2: { defPct: 0.12 }, b4: { atkPct: 0.12 } },
  sky: { name: '타락 천사', b2: { critChance: 0.04 }, b4: { atkPct: 0.14 } },
  void: { name: '심연의 군주', b2: { atkPct: 0.1 }, b4: { critDmg: 0.3, atkPct: 0.08 } },
});
export const SET_SLOTS = ['helmet', 'armor', 'gloves', 'boots'];

export const CURRENCY_ICONS = Object.freeze({ gold: 'I12', gem: 'I13', ore: 'I14', exp: 'I15', ticket: 'I16', token: 'I17', chest: 'I18', goldChest: 'I19', bag: 'I21', mail: 'I23',
  awakenStone: 'I36', starShard: 'I37', classTicket: 'I38', skillBook: 'I39', eqTicket: 'I18', skTicket: 'I19' });
export const RARITY_LOOK4 = Object.freeze({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 3, mythic: 3 });
export const LOOK4_SLOTS = Object.freeze(['gloves', 'boots', 'ring']);
// GPT F: own art for 영웅(epic) / 전설(legendary) / 신화(mythic). Key = slot, or class for class weapons
// (weapon = 전사 검). J1: helmet / armor / necklace epic+ too (I71..I78).
const hi = (base, n, names) => Object.freeze({ epic: { icon: 'I' + base, name: names[0] }, legendary: { icon: 'I' + (base + 1), name: names[1] }, mythic: { icon: 'I' + (base + 2), name: names[2] } });
export const HIGH_LOOKS = Object.freeze({
  gloves: hi(49, 0, ['자수정 건틀릿', '태양 금장 건틀릿', '진홍 장미 건틀릿']),
  boots: hi(52, 0, ['자수정 장화', '태양 금장 장화', '진홍 장미 장화']),
  ring: hi(55, 0, ['자수정 서약 반지', '태양 호박 반지', '진홍 장미 반지']),
  mage: hi(58, 0, ['자수정 성좌 마도서', '태양 금장 마도서', '진홍 장미 마도서']),
  archer: hi(61, 0, ['자수정 장궁', '태양 금장 장궁', '진홍 장미 장궁']),
  rogue: hi(64, 0, ['자수정 쌍단검', '태양 금장 쌍단검', '진홍 장미 쌍단검']),
  weapon: hi(67, 0, ['자수정 장검', '태양 금장 장검', '진홍 장미 검']),
  helmet: hi(71, 0, ['자수정 기사 투구', '태양 금장 투구', '진홍 장미 투구']),
  armor: Object.freeze({ epic: { icon: 'I74', name: '자수정 판금 갑옷' }, legendary: { icon: 'I75', name: '태양 금장 갑옷' }, mythic: { icon: 'I76', name: '진홍 장미 갑옷' } }),
  necklace: Object.freeze({ epic: { icon: 'I77', name: '자수정 목걸이' }, legendary: { icon: 'I78', name: '태양 금장 목걸이' }, mythic: { icon: 'I70', name: '진홍 장미 펜던트' } }),
});

export const TRIAL = Object.freeze({ id: 'T01', name: '교관 분신', sprite: 'hero', level: 30, telegraphMs: 500,
  heavy: { name: '서약의 일격', everySec: 7, telegraphMs: 900, mult: 2.2, shape: 'line' } });
export const TRIALS = Object.freeze({
  1: TRIAL,
  3: { id: 'T03', name: '과거의 자신', sprite: 'hero', level: 90, telegraphMs: 500, hpMul: 0.7, atkMul: 0.9,
    heavy: { name: '맹세의 메아리', everySec: 6, telegraphMs: 900, mult: 2.6, shape: 'line' } },
  // v15 초월 시련: 끝에 다다른 자신의 그림자. 노말 5지역 보스와 비슷한 세기, 120초.
  4: { id: 'T04', name: '초월자의 그림자', sprite: 'hero', level: 100, telegraphMs: 450, hpMul: 1.4, atkMul: 2.2, timeSec: 120,
    heavy: { name: '끝의 메아리', everySec: 5, telegraphMs: 850, mult: 2.8, shape: 'line' } },
});
export const DUNGEON = Object.freeze({ id: 'quarry', name: '별의 채석장', bg: 'mine', monsters: ['M06', 'M05'] });
export const DUNGEON_MONSTERS = Object.freeze({ quarry: ['M06', 'M05'], gold: ['M03', 'M04'], books: ['M04', 'M06'], tower: ['M05', 'M06', 'M02', 'M03'] });
