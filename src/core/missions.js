// Daily missions (KST day). Progress counts events; each mission is claimed once for
// gems, and finishing all five gives a bonus. Reset at 00:00 Asia/Seoul.
import { BALANCE } from '../data/balance.js';
import { kstDayIndex } from './util.js';

export const MISSIONS = Object.freeze([
  { id: 'kills', name: '몬스터 300마리 처치', target: 300 },
  { id: 'enhance', name: '장비 강화 5회', target: 5 },
  { id: 'dungeon', name: '던전 1회 (도전 또는 소탕)', target: 1 },
  { id: 'draw', name: '뽑기 1회', target: 1 },
  { id: 'boss', name: '보스 1회 도전', target: 1 },
]);

export function refreshMissions(state, now) {
  const m = state.missions;
  const today = kstDayIndex(now);
  if (m.day === today) return false;
  if (m.day !== null && today < m.day) return false;      // clock went back: keep today's
  m.day = today; m.progress = {}; m.claimed = {}; m.bonus = false;
  return true;
}
export function track(state, id, n = 1, now = Date.now()) {
  refreshMissions(state, now);
  const m = state.missions;
  m.progress[id] = (m.progress[id] || 0) + n;
}
export function missionStatus(state, now = Date.now()) {
  const m = state.missions;
  const fresh = m.day !== kstDayIndex(now);
  const list = MISSIONS.map((x) => {
    const p = fresh ? 0 : Math.min(x.target, m.progress[x.id] || 0);
    return { ...x, progress: p, done: p >= x.target, claimed: !fresh && !!m.claimed[x.id] };
  });
  const allClaimed = list.every((x) => x.claimed);
  return { list, canBonus: allClaimed && !(!fresh && m.bonus), bonusClaimed: !fresh && m.bonus, claimable: list.filter((x) => x.done && !x.claimed).length };
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
  return { ok: true, reward: { ...b } };
}
