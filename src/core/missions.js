// 일일 미션 (KST 00:00 초기화) + v18.6 주간 퀘스트 (KST 월요일 00:00 초기화).
// 게임 곳곳에서 track(state, event, n)으로 사건을 세면, 그 사건을 보는 일일·주간 항목이 함께 올라갑니다.
//   사건: kills · elites · boss(도전) · bossWin · dungeon · enhance · draw(뽑기 1번 누름) · draws(뽑은 장수)
//         challenge(탑·균열·쐐기·월드 보스·레이드 입장) · raid · dismantle(분해 개수) · dailyBonus
import { BALANCE } from '../data/balance.js';
import { kstDayIndex } from './util.js';
import { grantMeta } from './meta.js';

// ---------- 일일 ----------
export const MISSIONS = Object.freeze([
  { id: 'kills', ev: 'kills', name: '몬스터 300마리 처치', target: 300 },
  { id: 'enhance', ev: 'enhance', name: '장비 강화 5회', target: 5 },
  { id: 'dungeon', ev: 'dungeon', name: '던전 1회 (도전 또는 소탕)', target: 1 },
  { id: 'draw', ev: 'draw', name: '뽑기 1회', target: 1 },
  { id: 'boss', ev: 'boss', name: '보스 1회 도전', target: 1 },
  // v18.6 추가
  { id: 'elites', ev: 'elites', name: '정예 몬스터 10마리 처치', target: 10 },
  { id: 'challenge', ev: 'challenge', name: '탑·균열·쐐기·월드 보스·레이드 중 1회 도전', target: 1 },
  { id: 'dismantle', ev: 'dismantle', name: '장비 분해 10개', target: 10 },
]);
export const DAILY_BONUS_NEED = 6;   // 8개 중 6개를 받으면 완료 보상

// ---------- 주간 ----------
export const WEEKLY = Object.freeze([
  { id: 'w_kills', ev: 'kills', name: '몬스터 5,000마리 처치', target: 5000, reward: { gem: 150 } },
  { id: 'w_bossWin', ev: 'bossWin', name: '보스 15회 처치', target: 15, reward: { gem: 150, awakenStone: 5 } },
  { id: 'w_dungeon', ev: 'dungeon', name: '던전 10회', target: 10, reward: { ore: 1500 } },
  { id: 'w_draws', ev: 'draws', name: '뽑기 30장', target: 30, reward: { eqTicket: 5 } },
  { id: 'w_enhance', ev: 'enhance', name: '장비 강화 30회', target: 30, reward: { ore: 1000 } },
  { id: 'w_challenge', ev: 'challenge', name: '탑·균열·쐐기·월드 보스·레이드 10회', target: 10, reward: { awakenStone: 10 } },
  { id: 'w_raid', ev: 'raid', name: '주간 레이드 1회 도전', target: 1, reward: { skTicket: 3 } },
  { id: 'w_daily', ev: 'dailyBonus', name: '일일 미션 완료 보상 5일 받기', target: 5, reward: { gem: 200, starShard: 1 } },
]);
export const WEEKLY_BONUS_NEED = 6;
export const WEEKLY_BONUS = Object.freeze({ gem: 300, petEgg: 1, mountTicket: 2, wingTicket: 2 });

// 월요일 00:00 (KST) 기준 주 번호. kstDayIndex 0 = 1970-01-01(목) → +3
export const kstWeekIndex = (now) => Math.floor((kstDayIndex(now) + 3) / 7);
export const defaultWeekly = () => ({ week: null, progress: {}, claimed: {}, bonus: false });

export function refreshMissions(state, now) {
  const m = state.missions;
  const today = kstDayIndex(now);
  let changed = false;
  if (m.day !== today && !(m.day !== null && today < m.day)) {   // 시계가 뒤로 가면 오늘 것 유지
    m.day = today; m.progress = {}; m.claimed = {}; m.bonus = false; changed = true;
  }
  const w = state.weekly || (state.weekly = defaultWeekly());
  const wk = kstWeekIndex(now);
  if (w.week !== wk && !(w.week !== null && wk < w.week)) { Object.assign(w, defaultWeekly(), { week: wk }); changed = true; }
  return changed;
}
export function track(state, ev, n = 1, now = Date.now()) {
  refreshMissions(state, now);
  const m = state.missions;
  m.progress[ev] = (m.progress[ev] || 0) + n;
  const w = state.weekly;
  w.progress[ev] = (w.progress[ev] || 0) + n;
}

// 시계 없이 세기 (economy처럼 now를 모르는 곳용). 초기화는 다음 track/refresh 때.
export function bump(state, ev, n = 1) {
  if (state.missions && state.missions.day !== null) state.missions.progress[ev] = (state.missions.progress[ev] || 0) + n;
  if (state.weekly && state.weekly.week !== null) state.weekly.progress[ev] = (state.weekly.progress[ev] || 0) + n;
}
export function missionStatus(state, now = Date.now()) {
  const m = state.missions;
  const fresh = m.day !== kstDayIndex(now);
  const list = MISSIONS.map((x) => {
    const p = fresh ? 0 : Math.min(x.target, m.progress[x.ev] || 0);
    return { ...x, progress: p, done: p >= x.target, claimed: !fresh && !!m.claimed[x.id] };
  });
  const got = list.filter((x) => x.claimed).length;
  const bonusClaimed = !fresh && m.bonus;
  return { list, got, need: DAILY_BONUS_NEED, canBonus: got >= DAILY_BONUS_NEED && !bonusClaimed, bonusClaimed, claimable: list.filter((x) => x.done && !x.claimed).length };
}
export function claimMission(state, id, now) {
  refreshMissions(state, now);
  const st = missionStatus(state, now).list.find((x) => x.id === id);
  if (!st) return { ok: false, reason: 'missing' };
  if (st.claimed) return { ok: false, reason: 'duplicate' };
  if (!st.done) return { ok: false, reason: 'conditions' };
  state.missions.claimed[id] = true;
  state.wallet.gem += BALANCE.missions.gem;
  return { ok: true, id, reward: { gem: BALANCE.missions.gem } };
}
export function claimMissionBonus(state, now) {
  refreshMissions(state, now);
  const st = missionStatus(state, now);
  if (st.bonusClaimed) return { ok: false, reason: 'duplicate' };
  if (!st.canBonus) return { ok: false, reason: 'conditions' };
  state.missions.bonus = true;
  const b = BALANCE.missions.bonus;
  state.wallet.gem += b.gem;
  state.wallet.eqTicket += b.eqTicket;
  state.wallet.skTicket += b.skTicket || 0;
  track(state, 'dailyBonus', 1, now);
  return { ok: true, reward: { ...b } };
}

export function weeklyStatus(state, now = Date.now()) {
  const w = state.weekly || defaultWeekly();
  const fresh = w.week !== kstWeekIndex(now);
  const list = WEEKLY.map((x) => {
    const p = fresh ? 0 : Math.min(x.target, w.progress[x.ev] || 0);
    return { ...x, progress: p, done: p >= x.target, claimed: !fresh && !!w.claimed[x.id] };
  });
  const got = list.filter((x) => x.claimed).length;
  const bonusClaimed = !fresh && w.bonus;
  // 다음 초기화까지 남은 시간
  const nextMs = (kstWeekIndex(now) + 1) * 7 * 86400000 - 3 * 86400000 - 9 * 3600000;
  return { list, got, need: WEEKLY_BONUS_NEED, canBonus: got >= WEEKLY_BONUS_NEED && !bonusClaimed, bonusClaimed, claimable: list.filter((x) => x.done && !x.claimed).length, resetInMs: Math.max(0, nextMs - now) };
}
export function claimWeekly(state, id, now) {
  refreshMissions(state, now);
  const st = weeklyStatus(state, now).list.find((x) => x.id === id);
  if (!st) return { ok: false, reason: 'missing' };
  if (st.claimed) return { ok: false, reason: 'duplicate' };
  if (!st.done) return { ok: false, reason: 'conditions' };
  state.weekly.claimed[id] = true;
  grantMeta(state, st.reward);
  return { ok: true, id, reward: { ...st.reward } };
}
export function claimWeeklyBonus(state, now) {
  refreshMissions(state, now);
  const st = weeklyStatus(state, now);
  if (st.bonusClaimed) return { ok: false, reason: 'duplicate' };
  if (!st.canBonus) return { ok: false, reason: 'conditions' };
  state.weekly.bonus = true;
  grantMeta(state, WEEKLY_BONUS);
  return { ok: true, reward: { ...WEEKLY_BONUS } };
}
// 받을 수 있는 주간 보상 전부 (한 번에 받기용)
export function claimAllWeekly(state, now) {
  const got = [];
  for (const x of weeklyStatus(state, now).list) if (x.done && !x.claimed) { const r = claimWeekly(state, x.id, now); if (r.ok) got.push(r); }
  const b = weeklyStatus(state, now).canBonus ? claimWeeklyBonus(state, now) : null;
  if (!got.length && !(b && b.ok)) return { ok: false, reason: 'none' };
  const sum = {};
  for (const r of [...got, ...(b && b.ok ? [b] : [])]) for (const [k, v] of Object.entries(r.reward)) sum[k] = (sum[k] || 0) + v;
  return { ok: true, count: got.length, bonus: !!(b && b.ok), reward: sum };
}
