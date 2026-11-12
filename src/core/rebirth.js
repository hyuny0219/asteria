// 환생 (prestige). Unlock: Lv 100 (documented in docs/DESIGN_V5.md).
// Resets: level → 1, EXP and stored EXP, gold, gold auto-upgrades, stat points (re-spread
//   automatically), hunting position (별빛 초원 W1) and the current-wave counters.
// Keeps: class, promotion tier & branch (their level locks no longer apply), equipment,
//   inventory, gems/tickets/ore/materials, skills & levels & books, runes, talents (points
//   come from peak level, so none are lost), regions & boss records, tower/raid/rift records,
//   collections, missions, attendance.
// Grants 환생 정수 (essence) for permanent upgrades that multiply ATK / HP / gold / EXP.
import { STAT_KEYS } from '../data/content.js';
import { applyAutoStats } from './economy.js';

export const REBIRTH = Object.freeze({
  level: 100,
  ascLevel: 50,                  // v18.5 초월 레벨 조건
  essenceBase: 30,
  essencePerTowerFloor: 0.5,     // floor(tower.best × 0.5)
  essencePerRebirth: 5,          // later rebirths give a bit more
  catchUpExp: 16,
  catchUpAscExp: 4,              // v18.5 초월 레벨 회복은 ×4 (×16이면 환생이 반나절마다 돌아서 정수·특성이 폭주)                // 기억의 가속: EXP ×16 while below the peak level reached before
  upgrades: {
    atk: { name: '영혼의 칼날', desc: '공격력', per: 0.08, base: 10, growth: 1.35, max: 50 },
    hp: { name: '영혼의 갑주', desc: '최대 HP', per: 0.08, base: 10, growth: 1.35, max: 50 },
    gold: { name: '황금 기억', desc: '골드 획득', per: 0.10, base: 8, growth: 1.3, max: 50 },
    exp: { name: '윤회의 지혜', desc: '경험치 획득', per: 0.10, base: 8, growth: 1.3, max: 50 },
  },
});

export function defaultRebirth() { return { count: 0, essence: 0, totalEssence: 0, levels: { atk: 0, hp: 0, gold: 0, exp: 0 }, lastAt: null }; }

// v18.5: 환생은 초월(4차) 뒤 초월 Lv 50부터 — 초월하자마자 Lv 1로 돌아가는 흐름을 막음
export const canRebirth = (state) => (state.player.tier || 0) >= 4 && state.player.level >= REBIRTH.level && (state.player.ascLv || 0) >= REBIRTH.ascLevel;
export function essenceFor(state) {
  const rb = state.rebirth;
  return Math.floor(REBIRTH.essenceBase + ((state.tower && state.tower.best) || 0) * REBIRTH.essencePerTowerFloor + rb.count * REBIRTH.essencePerRebirth);
}
export function upgradeCost(key, lv) { const u = REBIRTH.upgrades[key]; return Math.ceil(u.base * Math.pow(u.growth, lv)); }

export function rebirthMultipliers(state) {
  const rb = state.rebirth;
  const m = { atk: 1, hp: 1, gold: 1, exp: 1 };
  if (!rb) return m;
  for (const k of Object.keys(m)) m[k] = 1 + REBIRTH.upgrades[k].per * (rb.levels[k] || 0);
  return m;
}

// Multipliers used by farming/offline: upgrades × catch-up below the previous peak level.
export function farmMultipliers(state) {
  const m = rebirthMultipliers(state);
  const p = state.player;
  if (state.rebirth && state.rebirth.count > 0) {
    if (p.level < (p.peakLevel || 0)) m.exp *= REBIRTH.catchUpExp;
    else if ((p.ascLv || 0) < (p.ascPeak || 0)) m.exp *= REBIRTH.catchUpAscExp;
  }
  return m;
}

export function preview(state) {
  return {
    ok: canRebirth(state), essence: essenceFor(state), count: state.rebirth.count,
    resets: ['레벨 → 1, 초월 레벨 → 0, 경험치·보관 경험치', '골드와 골드 자동 강화 단계', '능력치 포인트(자동으로 다시 분배)', '사냥 위치 → 별빛 초원 W1 (이미 잡은 보스 지역은 자동으로 다시 올라가요)'],
    keeps: ['클래스·승급 단계·갈래 (레벨 잠금 없이 다시 성장)', '장비·가방·보석·뽑기권·재료', '스킬 레벨·스킬북·각인·특성', '지역 개방·보스 처치·탑·레이드·균열 기록', `기억의 가속: 이전 최고 레벨까지 경험치 ×${REBIRTH.catchUpExp}, 이전 최고 초월 레벨까지 ×${REBIRTH.catchUpAscExp}`],
  };
}

export function doRebirth(state, now) {
  if (!canRebirth(state)) return { ok: false, reason: (state.player.tier || 0) < 4 ? 'rebirthTier' : 'rebirthAsc', need: REBIRTH.ascLevel };
  const gain = essenceFor(state);
  const p = state.player;
  p.peakLevel = Math.max(p.peakLevel || 0, p.level);
  p.ascPeak = Math.max(p.ascPeak || 0, p.ascLv || 0);
  p.level = 1; p.exp = 0; p.pendingExp = 0;
  p.ascLv = 0; p.ascExp = 0;
  for (const k of Object.keys(p.statsUpgrades)) p.statsUpgrades[k] = 0;
  for (const k of STAT_KEYS) p.stats[k] = 0;
  p.statAuto = true;
  applyAutoStats(state);
  state.wallet.gold = 0;
  const pr = state.progression;
  // 난이도: 환생은 이지 1-1에서 다시 시작 (노말·하드 기록과 위치는 그대로 보관)
  if (state.diff && state.diff.cur && state.diff.cur !== 'easy') {
    const t = state.diff.tracks[state.diff.cur];
    if (t) { t.region = pr.region; t.wave = pr.wave; }
    state.diff.cur = 'easy';
  }
  if (state.diff) state.diff.easyPos = null;
  pr.region = 'meadow'; pr.wave = 1; pr.waveKills = 0; pr.autoAdvance = true; pr.holdKills = 0; pr.waveDeaths = 0;
  pr.verifiedFarm = null;
  const rb = state.rebirth;
  rb.count += 1; rb.essence += gain; rb.totalEssence += gain; rb.lastAt = now;
  return { ok: true, essence: gain, count: rb.count };
}

export function buyUpgrade(state, key) {
  const u = REBIRTH.upgrades[key];
  if (!u) return { ok: false, reason: 'missing' };
  const rb = state.rebirth;
  const lv = rb.levels[key] || 0;
  if (lv >= u.max) return { ok: false, reason: 'max' };
  const c = upgradeCost(key, lv);
  if (rb.essence < c) return { ok: false, reason: 'essence', need: c };
  rb.essence -= c;
  rb.levels[key] = lv + 1;
  return { ok: true, key, level: lv + 1, cost: c };
}

