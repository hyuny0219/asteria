// v5 part 2 content data: 도감, 업적·칭호, 무료 시즌 패스, 동료(정령·펫), 신화 제작.
// All bonuses are deliberately small (선배's open decision: the first Lv 100 is already
// ~12 days vs the 20-day target, so these must not speed progression up much).
import { BOSSES, MONSTERS } from './content.js';

// ---------- 도감 ----------
export const CODEX = Object.freeze({
  monsterTiers: [10, 100, 1000],
  bossTiers: [1, 10, 50],
  // each tier of each entry grants +perTier of a stat; stat rotates by entry index
  stats: ['atkPct', 'hpPct', 'defPct', 'goldPct'],
  perTier: 0.0008,
  itemSlots: ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring'],
  itemPerEntry: 0.0004,            // +0.04% ATK and HP per slot×rarity first found (42 entries → ~1.7%)
});
export const CODEX_MONSTERS = Object.freeze([...Object.keys(MONSTERS), ...Object.keys(BOSSES)]);

// ---------- 칭호 ----------
export const TITLES = Object.freeze({
  t_pioneer: { name: '초원의 개척자', bonus: { atkPct: 0.01 } },
  t_hunter: { name: '천 마리 사냥꾼', bonus: { atkPct: 0.015 } },
  t_slayer: { name: '보스 사냥꾼', bonus: { critChance: 0.01 } },
  t_tower: { name: '탑의 정복자', bonus: { hpPct: 0.02 } },
  t_rift: { name: '균열 탐험가', bonus: { critDmg: 0.04 } },
  t_reborn: { name: '별의 환생자', bonus: { atkPct: 0.02 } },
  t_collector: { name: '도감 수집가', bonus: { goldPct: 0.03 } },
  t_tamer: { name: '정령의 벗', bonus: { hpPct: 0.015 } },
  t_legend: { name: '아스테리아의 전설', bonus: { atkPct: 0.025, hpPct: 0.025 } },
  t_season: { name: '시즌의 별', bonus: { atkPct: 0.015, goldPct: 0.02 } },
  t_rarehunter: { name: '희귀 정예 사냥꾼', bonus: { dropPct: 0.03, critChance: 0.01 } },
});

// ---------- 업적 (~30) ----------
// key = what is measured (see achievements.js measure()); reward is granted once.
export const ACHIEVEMENTS = Object.freeze([
  { id: 'lv10', name: '첫걸음', desc: '레벨 10 달성', key: 'peakLevel', goal: 10, reward: { gem: 50 } },
  { id: 'lv30', name: '서약의 시작', desc: '레벨 30 달성', key: 'peakLevel', goal: 30, reward: { gem: 100, petEgg: 1 } },
  { id: 'lv60', name: '각성', desc: '레벨 60 달성', key: 'peakLevel', goal: 60, reward: { gem: 150, skTicket: 2 } },
  { id: 'lv90', name: '정점의 문턱', desc: '레벨 90 달성', key: 'peakLevel', goal: 90, reward: { gem: 200, eqTicket: 5 } },
  { id: 'lv100', name: '별에 닿다', desc: '레벨 100 달성', key: 'peakLevel', goal: 100, reward: { gem: 300, petEgg: 1 } },
  { id: 'k1k', name: '사냥꾼', desc: '몬스터 1,000마리 처치', key: 'kills', goal: 1000, reward: { gem: 50 }, title: 't_hunter' },
  { id: 'k10k', name: '노련한 사냥꾼', desc: '몬스터 10,000마리 처치', key: 'kills', goal: 10000, reward: { gem: 100, petFood: 20 } },
  { id: 'k100k', name: '전장의 지배자', desc: '몬스터 100,000마리 처치', key: 'kills', goal: 100000, reward: { gem: 200, petEgg: 1 } },
  { id: 'k1m', name: '끝없는 사냥', desc: '몬스터 1,000,000마리 처치', key: 'kills', goal: 1000000, reward: { gem: 500 } },
  { id: 'b1', name: '첫 보스', desc: '보스 1회 처치', key: 'bossWins', goal: 1, reward: { gem: 30 }, title: 't_pioneer' },
  { id: 'b50', name: '보스 사냥꾼', desc: '보스 50회 처치', key: 'bossWins', goal: 50, reward: { gem: 150 }, title: 't_slayer' },
  { id: 'bB03', name: '폐광의 해방', desc: '폐광 파수꾼 처치', key: 'boss:B03', goal: 1, reward: { gem: 80 } },
  { id: 'bB06', name: '불의 정복', desc: '이프리트 처치', key: 'boss:B06', goal: 1, reward: { gem: 120, petEgg: 1 } },
  { id: 'bB09', name: '타락의 종말', desc: '타락한 대천사 처치', key: 'boss:B09', goal: 1, reward: { gem: 160 } },
  { id: 'bB10', name: '심연을 넘어', desc: '심연의 군주 처치', key: 'boss:B10', goal: 1, reward: { gem: 250 }, title: 't_legend' },
  { id: 'tw10', name: '탑 오르기', desc: '시련의 탑 10층', key: 'tower', goal: 10, reward: { gem: 60 } },
  { id: 'tw30', name: '높은 곳으로', desc: '시련의 탑 30층', key: 'tower', goal: 30, reward: { gem: 120, petFood: 30 } },
  { id: 'tw50', name: '탑의 정복자', desc: '시련의 탑 50층', key: 'tower', goal: 50, reward: { gem: 200 }, title: 't_tower' },
  { id: 'rf10', name: '균열 입문', desc: '균열 10층 도달', key: 'rift', goal: 10, reward: { gem: 80 } },
  { id: 'rf20', name: '균열 탐험가', desc: '균열 20층 도달', key: 'rift', goal: 20, reward: { gem: 150 }, title: 't_rift' },
  { id: 'rf30', name: '균열의 끝', desc: '균열 30층 완주', key: 'rift', goal: 30, reward: { gem: 250, petEgg: 1 } },
  { id: 'rb1', name: '첫 환생', desc: '환생 1회', key: 'rebirth', goal: 1, reward: { gem: 200 }, title: 't_reborn' },
  { id: 'rb5', name: '윤회', desc: '환생 5회', key: 'rebirth', goal: 5, reward: { gem: 400, petEgg: 1 } },
  { id: 'gc100', name: '별의 유산', desc: '뽑기 100회', key: 'draws', goal: 100, reward: { gem: 100 } },
  { id: 'gc1000', name: '별을 모으는 자', desc: '뽑기 1,000회', key: 'draws', goal: 1000, reward: { gem: 300 } },
  { id: 'en100', name: '대장장이', desc: '장비 강화 100회', key: 'enhances', goal: 100, reward: { gem: 80, petFood: 10 } },
  { id: 'at7', name: '꾸준함', desc: '누적 출석 7일', key: 'attendance', goal: 7, reward: { gem: 50 } },
  { id: 'at28', name: '한 달의 서약', desc: '누적 출석 28일', key: 'attendance', goal: 28, reward: { gem: 150, petEgg: 1 } },
  { id: 'cx30', name: '도감 수집가', desc: '몬스터 도감 단계 30개', key: 'codexTiers', goal: 30, reward: { gem: 100 }, title: 't_collector' },
  { id: 'cx60', name: '박물학자', desc: '몬스터 도감 단계 60개', key: 'codexTiers', goal: 60, reward: { gem: 200 } },
  { id: 'pt3', name: '정령의 벗', desc: '동료 3종 보유', key: 'pets', goal: 3, reward: { gem: 100, petFood: 20 }, title: 't_tamer' },
  { id: 'pt6', name: '모든 정령', desc: '동료 6종 보유', key: 'pets', goal: 6, reward: { gem: 300 } },
]);

// ---------- 무료 시즌 패스 ----------
export const PASS = Object.freeze({
  days: 28,
  epochDay: 20748,                 // KST day index of the first season start (2026-10-26, a Monday)
  xpPerLevel: 120,
  levels: 30,
  xp: { mission: 10, missionBonus: 20, boss: 6, towerRecord: 5, riftFloor: 2, kills100: 1, killsDailyCap: 40 },
  // free track only (no premium track)
  rewards: [
    { gem: 50 }, { petFood: 10 }, { eqTicket: 2 }, { gem: 80 }, { petEgg: 1 },
    { skTicket: 2 }, { gem: 100 }, { petFood: 20 }, { essence: 5 }, { petEgg: 1 },
    { gem: 120 }, { eqTicket: 3 }, { petFood: 30 }, { skTicket: 3 }, { petEgg: 1 },
    { gem: 150 }, { essence: 10 }, { petFood: 40 }, { eqTicket: 5 }, { petEgg: 1 },
    { gem: 200 }, { skTicket: 5 }, { petFood: 50 }, { essence: 15 }, { petEgg: 1 },
    { gem: 250 }, { eqTicket: 8 }, { petFood: 60 }, { gem: 300 }, { petEgg: 2, title: 't_season' },
  ],
});

// ---------- 동료 ----------
// aura: one small passive each; attack: coef × hero ATK every `everySec` on the front enemy
export const PETS = Object.freeze({
  P01: { id: 'P01', name: '별여우', aura: { stat: 'critChance', base: 0.01, perLevel: 0.0005 }, attack: { coef: 0.35, everySec: 3 }, desc: '별빛 꼬리로 치명타 확률을 높여요.' },
  P02: { id: 'P02', name: '불씨 새끼용', aura: { stat: 'atkPct', base: 0.01, perLevel: 0.0006 }, attack: { coef: 0.45, everySec: 3.5 }, desc: '작은 불꽃으로 공격력을 높여요.' },
  P03: { id: 'P03', name: '서리 올빼미', aura: { stat: 'ultCharge', base: 0.03, perLevel: 0.0015 }, attack: { coef: 0.3, everySec: 3 }, desc: '궁극기 게이지가 더 빨리 차요.' },
  P04: { id: 'P04', name: '숲정령 사슴', aura: { stat: 'regen', base: 0.002, perLevel: 0.0001 }, attack: { coef: 0.25, everySec: 3 }, desc: '전투 중 체력을 조금씩 회복시켜요.' },
  P05: { id: 'P05', name: '그림자 고양이', aura: { stat: 'evade', base: 0.01, perLevel: 0.0005 }, attack: { coef: 0.35, everySec: 2.5 }, desc: '회피율을 높여요.' },
  P06: { id: 'P06', name: '빛의 정령', aura: { stat: 'goldPct', base: 0.02, perLevel: 0.001 }, attack: { coef: 0.25, everySec: 3 }, desc: '골드를 더 많이 얻어요.' },
});
export const PET_RULES = Object.freeze({
  maxLevel: 30,
  foodPerLevel: (lv) => 3 + 2 * lv,          // food to go lv → lv+1
  maxStars: 5,
  shardsForStar: [1, 2, 3, 4],               // duplicates needed for ★2..★5
  starMul: 0.2,                              // +20% aura & attack per extra star
  hatchRates: { P01: 1 / 6, P02: 1 / 6, P03: 1 / 6, P04: 1 / 6, P05: 1 / 6, P06: 1 / 6 },
});

// ---------- 신화 제작 ----------
export const CRAFT = Object.freeze({
  slots: ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring'],
  unlock: { level: 90, boss: 'B09' },        // either is enough
  cost: { starShard: 3, essence: 20, ore: 2000, goldMinutes: 120 },
});
