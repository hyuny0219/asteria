// 월드 보스 (정해진 시간대 점수제) + 희귀 정예 (사냥터 이름 붙은 정예).
//
// 월드 보스: KST 12시·18시·21시에 1시간씩 열리고, 창마다 1번 도전. 60초 동안 준 피해로
// 등급(D~S)을 매깁니다. 보스는 요일마다 바뀌고(기존 보스 그림).
// 세기 = '지금까지 잡은 가장 어려운 보스'(난이도 포함) 기준: 그 보스의 레벨·노말/하드 배율에
// 체력 ×WB.hpMul, 공격 ×WB.atkMul. 영웅 레벨이 더 높으면 영웅 레벨. (예전엔 영웅 레벨만 따라가서
// 장비가 앞서 나간 영웅에게는 너무 쉬웠음.) 쓰러뜨리면 바로 S 등급입니다.
// 희귀 정예: 화면을 켜고 사냥하다 스테이지를 깰 때 rareChance 확률로 그 지역의 이름 붙은
// 희귀 정예 1마리가 나타납니다(동시에 1마리, 방치 정산에는 없음). 처치하면 보석과 희귀
// 이상 장비 확정, 도감 "희귀 정예" 칸이 채워지고 10종을 모두 잡으면 칭호.
import { BOSSES, REGIONS } from '../data/content.js';
import { kstDayIndex } from './util.js';
import { markTx } from './state.js';
import { makeItem, rollRarity, rollSlot } from './items.js';
import { rollJewel } from './crafting.js';
import * as DF from './difficulty.js';

export const WB = Object.freeze({
  unlockBoss: 'B03', hours: [12, 18, 21], windowMin: 60, timeSec: 60, hpMul: 3, atkMul: 1,
  rotation: ['B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B03'],
  // grade thresholds as a share of the world boss HP
  grades: [['S', 0.7], ['A', 0.45], ['B', 0.28], ['C', 0.14], ['D', 0]],
  rewards: {
    S: { gem: 120, ore: 80, eqTicket: 2, skTicket: 1, wingFeather: 20, mountFood: 20 },
    A: { gem: 90, ore: 60, eqTicket: 1, skTicket: 1, wingFeather: 10, mountFood: 10 },
    B: { gem: 60, ore: 45, eqTicket: 1 },
    C: { gem: 40, ore: 30 },
    D: { gem: 20, ore: 15 },
  },
});

const KST = 9 * 3600000;
export const kstHour = (now) => new Date(now + KST).getUTCHours();
export function currentWindow(now) {
  const h = kstHour(now);
  return WB.hours.includes(h) ? { day: kstDayIndex(now), hour: h, key: `${kstDayIndex(now)}:${h}` } : null;
}
// next window start (ms) after now (or the current one's end when open)
export function nextWindow(now) {
  const day = kstDayIndex(now);
  for (let d = 0; d < 2; d++) for (const hr of WB.hours) {
    const start = (day + d) * 86400000 - KST + hr * 3600000;
    if (start > now) return { start, hour: hr };
  }
  return null;
}
export const worldBossId = (now) => WB.rotation[((kstDayIndex(now) % WB.rotation.length) + WB.rotation.length) % WB.rotation.length];
export const worldBossOpen = (state) => !!state.progression.bossCleared[WB.unlockBoss];
export function defaultWorldBoss() { return { used: {}, best: 0, bestGrade: null, tries: 0, rares: {} }; }
export function refreshWorldBoss(state, now) {
  const w = state.worldBoss || (state.worldBoss = defaultWorldBoss());
  const today = kstDayIndex(now);
  for (const k of Object.keys(w.used)) if (Number(k.split(':')[0]) < today - 1) delete w.used[k];
  return w;
}
export function canChallenge(state, now) {
  if (!worldBossOpen(state)) return { ok: false, reason: 'locked' };
  const win = currentWindow(now);
  if (!win) return { ok: false, reason: 'closed', next: nextWindow(now) };
  if (refreshWorldBoss(state, now).used[win.key]) return { ok: false, reason: 'used', next: nextWindow(now) };
  return { ok: true, window: win };
}
export function beginWorldBoss(state, runId, now) {
  const c = canChallenge(state, now);
  if (!c.ok) return c;
  state.worldBoss.used[c.window.key] = runId;
  state.worldBoss.tries += 1;
  return { ok: true, window: c.window, bossId: worldBossId(now) };
}
// 보상 장비 레벨 (영웅 레벨 기준 그대로)
export const bossLevel = (state) => Math.max(30, Math.min(100, state.player.level));
// 가장 어려운 처치 기록: 하드 → 노말 → 이지 순으로, 그 난이도에서 가장 뒤 지역 보스.
export function frontier(state) {
  for (const d of [...DF.DIFF_IDS].reverse()) {
    const t = DF.track(state, d);
    const r = [...REGIONS].reverse().find((x) => t.bossCleared[x.boss]);
    if (r) return { d, region: r.id, boss: r.boss };
  }
  return null;
}
export function scaleFor(state) {
  const f = frontier(state);
  const lv = Math.max(30, Math.min(100, Math.max(state.player.level, f ? DF.bossLevel(f.d, f.boss) : 0)));
  const em = f ? DF.enemyMul(f.d, f.region, 'boss') : null;
  return { level: lv, hp: WB.hpMul * (em ? em.hp : 1), atk: WB.atkMul * (em ? em.atk : 1), from: f };
}
export function battleConfig(state, now) {
  const sc = scaleFor(state);
  return { boss: worldBossId(now), level: sc.level, hpMul: sc.hp, atkMul: sc.atk, timeSec: WB.timeSec, from: sc.from };
}
export function gradeFor(share) { return WB.grades.find(([, t]) => share >= t)[0]; }

export function finishWorldBoss(state, runId, damage, bossHp, rng) {
  if (!markTx(state, runId + ':wb')) return { ok: false, reason: 'duplicate' };
  const w = state.worldBoss;
  const share = bossHp > 0 ? Math.min(1, damage / bossHp) : 0;
  const grade = gradeFor(share);
  const rw = { ...WB.rewards[grade] };
  state.wallet.gem += rw.gem; state.wallet.ore += rw.ore;
  if (rw.eqTicket) state.wallet.eqTicket += rw.eqTicket;
  if (rw.skTicket) state.wallet.skTicket += rw.skTicket;
  if (rw.wingFeather) state.wallet.wingFeather = (state.wallet.wingFeather || 0) + rw.wingFeather;
  if (rw.mountFood) state.wallet.mountFood = (state.wallet.mountFood || 0) + rw.mountFood;
  const items = [];
  if (grade === 'S' || grade === 'A') items.push(makeItem(state, { slot: rollSlot(rng), rarity: rollRarity(rng, grade === 'S' ? { epic: 0.6, legendary: 0.4 } : { rare: 0.5, epic: 0.5 }), level: bossLevel(state), rng, source: 'worldBoss' }));
  const JW = { S: [2, 2], A: [1, 2], B: [1, 1] }[grade];   // [count, level] 보옥
  const jewels = [];
  if (JW) for (let i = 0; i < JW[0]; i++) jewels.push(rollJewel(state, rng, JW[1]));
  if (damage > w.best) { w.best = damage; w.bestGrade = grade; }
  return { ok: true, grade, share, damage, reward: rw, items, jewels };
}

// ---------- 희귀 정예 ----------
export const RARES = Object.freeze({
  meadow: { id: 'RE01', name: '이슬뿔 군주 트릴', base: 'M02' },
  desert: { id: 'RE02', name: '모래폭풍 사냥꾼 카샤르', base: 'M04' },
  mine: { id: 'RE03', name: '수정 갑각 고르보', base: 'M06' },
  forest: { id: 'RE04', name: '독안개 직조자 셀라', base: 'M07' },
  glacier: { id: 'RE05', name: '얼음송곳 예티 운', base: 'M09' },
  volcano: { id: 'RE06', name: '잿불 포식자 이그란', base: 'M12' },
  abyssal: { id: 'RE07', name: '심연 비늘 모르가', base: 'M14' },
  castle: { id: 'RE08', name: '잊힌 기사 발테르', base: 'M15' },
  sky: { id: 'RE09', name: '폭풍깃 그리폰 아에라', base: 'M17' },
  void: { id: 'RE10', name: '공허의 눈 녹시스', base: 'M19' },
});
export const RARE_RULES = Object.freeze({ chance: 0.03, gem: 40, rarity: { rare: 0.6, epic: 0.35, legendary: 0.05 }, title: 't_rarehunter' });
export const rareCount = (state) => Object.keys((state.worldBoss && state.worldBoss.rares) || {}).length;

// a stage was cleared in the foreground: maybe a rare elite appears (returns its def or null)
export function rollRare(region, rng, mul = 1) { return rng() < RARE_RULES.chance * mul ? RARES[region] || null : null; }

export function onRareKill(state, rareId, level, rng) {
  const w = state.worldBoss || (state.worldBoss = defaultWorldBoss());
  const first = !w.rares[rareId];
  w.rares[rareId] = (w.rares[rareId] || 0) + 1;
  state.wallet.gem += RARE_RULES.gem;
  const item = makeItem(state, { slot: rollSlot(rng), rarity: rollRarity(rng, RARE_RULES.rarity), level, rng, source: 'rare' });
  let title = null;
  if (first && rareCount(state) >= Object.keys(RARES).length && !state.titles.owned.includes(RARE_RULES.title)) { state.titles.owned.push(RARE_RULES.title); title = RARE_RULES.title; }
  return { gem: RARE_RULES.gem, item, first, title };
}
export const rareById = (id) => Object.values(RARES).find((r) => r.id === id) || null;
export { BOSSES, REGIONS };
