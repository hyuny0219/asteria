// Game content for the MVP: 3 regions, 6 monsters, 3 bosses, skills, item visuals.
// Monster/boss telegraph timings come from docs/handoff/07_BESTIARY.md.

export const MONSTERS = Object.freeze({
  M01: { id: 'M01', name: '가시 슬라임', sprite: 'M01', telegraphMs: 400, telegraph: 'crouch', attack: 'leap' },
  M02: { id: 'M02', name: '잿빛 가시늑대', sprite: 'M02', telegraphMs: 450, telegraph: 'crouch', attack: 'bite' },
  M03: { id: 'M03', name: '사암 풍뎅이', sprite: 'M03', telegraphMs: 550, telegraph: 'line', attack: 'charge' },
  M04: { id: 'M04', name: '황금 가면 망령', sprite: 'M04', telegraphMs: 650, telegraph: 'glow', attack: 'bolt', flying: true },
  M05: { id: 'M05', name: '해골 광부', sprite: 'M05', telegraphMs: 550, telegraph: 'raise', attack: 'smash' },
  M06: { id: 'M06', name: '흑요석 거미', sprite: 'M06', telegraphMs: 500, telegraph: 'raise', attack: 'claw' },
});

// Boss patterns: a normal attack plus a telegraphed heavy every `heavyEvery` seconds.
export const BOSSES = Object.freeze({
  B01: {
    id: 'B01', name: '가시 슬라임 군주', sprite: 'B01', region: 'meadow', level: 10,
    lesson: '기본 공격 읽기', telegraphMs: 400,
    heavy: { name: '도약 착지', everySec: 8, telegraphMs: 700, mult: 2.2, shape: 'circle' },
    desc: '몸을 크게 움츠린 뒤 도약합니다. 착지 원이 나타나면 피해가 큽니다.',
  },
  B02: {
    id: 'B02', name: '모래 수호자', sprite: 'B02', region: 'desert', level: 20,
    lesson: '주기적 강공', telegraphMs: 550,
    heavy: { name: '대지 균열', everySec: 7, telegraphMs: 1000, mult: 2.6, shape: 'crack' },
    desc: '양팔을 들어 올리면 1초 뒤 바닥이 갈라집니다. 방패 돌진의 방어 시간으로 받아내세요.',
  },
  B03: {
    id: 'B03', name: '폐광 파수꾼', sprite: 'B03', region: 'mine', level: 32,
    lesson: '방어 타이밍', telegraphMs: 550,
    heavy: { name: '곡괭이 일격', everySec: 6.5, telegraphMs: 1200, mult: 3.0, shape: 'line' },
    desc: '곡괭이를 높이 들면 직선 경고가 나타납니다. 경고 중 방어 효과로 피해를 줄일 수 있습니다.',
  },
});

export const REGIONS = Object.freeze([
  { id: 'meadow', name: '별빛 초원', minLv: 1, maxLv: 10, label: 'Lv 1–10', monsters: ['M01', 'M02'], boss: 'B01', bg: 'meadow', order: 0 },
  { id: 'desert', name: '고대 사막', minLv: 11, maxLv: 20, label: 'Lv 11–20', monsters: ['M03', 'M04'], boss: 'B02', bg: 'desert', order: 1 },
  { id: 'mine', name: '잊힌 폐광', minLv: 21, maxLv: 33, label: 'Lv 21–35', monsters: ['M05', 'M06'], boss: 'B03', bg: 'mine', order: 2 },
]);
export const REGION_BY_ID = Object.freeze(Object.fromEntries(REGIONS.map((r) => [r.id, r])));

export function waveLevel(region, wave) {
  const r = typeof region === 'string' ? REGION_BY_ID[region] : region;
  return Math.round(r.minLv + ((wave - 1) * (r.maxLv - r.minLv)) / 9);
}

// Skills. coef = damage coefficient on ATK. Non-damage skills use `effect`.
export const SKILLS = Object.freeze({
  strike: { id: 'strike', name: '강타', icon: 'S0', kind: 'damage', coef: 2.0, cd: 6, target: 'single',
    desc: '전방의 적 하나를 강하게 벱니다.', unlock: { level: 1 } },
  shieldCharge: { id: 'shieldCharge', name: '방패 돌진', icon: 'S1', kind: 'damage', coef: 1.5, cd: 8, target: 'single',
    guard: { sec: 2, reduce: 0.4 }, desc: '방패로 돌진해 피해를 주고 2초간 받는 피해를 40% 줄입니다.', unlock: { level: 3 } },
  warCry: { id: 'warCry', name: '전장의 외침', icon: 'S2', kind: 'buff', cd: 20, buff: { stat: 'atk', mul: 0.2, sec: 8 },
    desc: '8초간 공격력이 20% 증가합니다. 같은 효과는 겹치지 않고 지속 시간만 갱신됩니다.', unlock: { level: 6 } },
  guardCounter: { id: 'guardCounter', name: '수호 반격', icon: 'S3', kind: 'passive-counter', coef: 1.8, internalCd: 1,
    desc: '방패 돌진의 방어 시간 중 피해를 받으면 즉시 반격합니다. (내부 대기 1초)', unlock: { branch: 'knight' } },
  berserkStrike: { id: 'berserkStrike', name: '광폭 일격', icon: 'S4', kind: 'damage', coef: 3.2, cd: 10, target: 'single',
    lowHpBonus: { below: 0.5, atkMul: 0.25 },
    desc: '양손 대검으로 내려칩니다. 체력 50% 이하에서는 모든 공격의 공격력이 25% 증가합니다.', unlock: { branch: 'berserker' } },
  starSlash: { id: 'starSlash', name: '별빛 참격', icon: 'S5', kind: 'ultimate', coef: 6.0, target: 'all',
    desc: '궁극기. 화면의 모든 적에게 별빛 참격을 날립니다. 게이지 100 소모.', unlock: { level: 1 } },
});
export const NORMAL_SKILLS_BASE = ['strike', 'shieldCharge', 'warCry'];
export const BRANCH_SKILL = { knight: 'guardCounter', berserker: 'berserkStrike' };

export const BRANCHES = Object.freeze({
  knight: { id: 'knight', name: '흑장미 기사', role: '방패 · 반격', weapon: '큰 방패와 장검',
    passive: { def: 0.15, hp: 0.15 }, desc: '흰 금속 갑옷과 큰 방패. 방어 시간 중 받는 피해에 반격합니다.' },
  berserker: { id: 'berserker', name: '진홍의 집행자', role: '대검 · 공격', weapon: '양손 대검',
    passive: { atk: 0.12 }, desc: '검은 금속과 비대칭 붉은 코트. 체력이 낮을수록 강해지는 공격형입니다.' },
});

// Equipment visuals: 3 looks per slot (items_24 board), material colours preserved.
// Rarity is shown by border, name and I/II/III mark, not by recolouring.
export const ITEM_LOOKS = Object.freeze({
  weapon: [{ icon: 'I00', name: '철검' }, { icon: 'I01', name: '금장 장검' }, { icon: 'I02', name: '흑장미 검' }],
  helmet: [{ icon: 'I03', name: '철 투구' }, { icon: 'I04', name: '금장 투구' }, { icon: 'I05', name: '흑장미 투구' }],
  armor: [{ icon: 'I06', name: '가죽 갑옷' }, { icon: 'I07', name: '금장 갑옷' }, { icon: 'I08', name: '흑장미 갑옷' }],
  accessory: [{ icon: 'I09', name: '은 펜던트' }, { icon: 'I10', name: '자수정 펜던트' }, { icon: 'I11', name: '장미별 펜던트' }],
});
export const SLOT_NAMES = Object.freeze({ weapon: '무기', helmet: '투구', armor: '갑옷', accessory: '장신구' });
export const RARITY = Object.freeze({
  common: { id: 'common', name: '일반', mark: 'I', order: 0 },
  uncommon: { id: 'uncommon', name: '고급', mark: 'II', order: 1 },
  rare: { id: 'rare', name: '희귀', mark: 'III', order: 2 },
});
export const CURRENCY_ICONS = Object.freeze({ gold: 'I12', gem: 'I13', ore: 'I14', exp: 'I15', ticket: 'I16', token: 'I17', chest: 'I18', goldChest: 'I19', bag: 'I21', mail: 'I23' });

export const TRIAL = Object.freeze({ id: 'T01', name: '교관 분신', sprite: 'hero', level: 30, telegraphMs: 500,
  heavy: { name: '서약의 일격', everySec: 7, telegraphMs: 900, mult: 2.2, shape: 'line' } });
export const DUNGEON = Object.freeze({ id: 'quarry', name: '별의 채석장', bg: 'mine', monsters: ['M06', 'M05'] });
