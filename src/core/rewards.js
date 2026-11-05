// Daily attendance (28-day cumulative calendar) and the return bonus for players who
// were away for days. Both are claimed through Game.transact like every other grant:
// the claim is saved first, the reveal animation plays after.
//
// Days are Asia/Seoul calendar days (same boundary as dungeon tickets). Missing a day
// never resets the calendar: it counts days attended, not a streak.
import { killRewards } from './combat.js';
import { kstDayIndex } from './util.js';

// `gold` values are "minutes of farming" at the player's level so a reward stays
// meaningful at Lv 5 and Lv 95. Converted with goldPerMinute() when granted.
export const ATTENDANCE = Object.freeze([
  { gold: 10 }, { gem: 50 }, { ore: 30 }, { ticket: 1 }, { gem: 50 }, { gold: 20 }, { eqTicket: 3, big: true },
  { gold: 15 }, { gem: 60 }, { ore: 50 }, { skTicket: 2 }, { gem: 60 }, { gold: 30 }, { gem: 300, big: true },
  { gold: 20 }, { gem: 70 }, { ore: 70 }, { ticket: 2 }, { gem: 70 }, { gold: 40 }, { skTicket: 5, big: true },
  { gold: 25 }, { gem: 80 }, { ore: 90 }, { eqTicket: 2 }, { gem: 80 }, { gold: 60 }, { eqTicket: 10, skTicket: 5, gem: 500, big: true },
]);

export const RETURN_BONUS = Object.freeze({
  minDays: 3,
  tiers: [
    { days: 3, gem: 200, eqTicket: 3, skTicket: 1, goldMin: 120, boostHours: 12 },
    { days: 7, gem: 500, eqTicket: 10, skTicket: 3, goldMin: 300, boostHours: 24 },
    { days: 14, gem: 1000, eqTicket: 20, skTicket: 6, goldMin: 600, boostHours: 48 },
  ],
  boost: { exp: 2, gold: 2 },      // farming only; offline settlement stays ×1 (no temporary buffs)
});

export const REWARD_KEYS = ['gold', 'gem', 'ore', 'ticket', 'eqTicket', 'skTicket'];

export function goldPerMinute(level) {
  // ~20 kills a minute of normal farming at that level
  return killRewards(level).gold * 20;
}

export function resolveReward(r, level) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'gold' || k === 'goldMin') out.gold = (out.gold || 0) + Math.floor(goldPerMinute(level) * v);
    else if (REWARD_KEYS.includes(k)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

export function grant(state, rw) {
  const w = state.wallet;
  for (const [k, v] of Object.entries(rw)) {
    if (k === 'gold' || k === 'ore' || k === 'gem' || k === 'eqTicket' || k === 'skTicket') w[k] = (w[k] || 0) + v;
    else if (k === 'ticket') state.dungeon.tickets += v;     // may exceed the daily cap; refills stop at the cap
  }
}

// ---------- attendance ----------
export function attendanceStatus(state, now) {
  const a = state.attendance;
  const today = kstDayIndex(now);
  const idx = a.count % ATTENDANCE.length;
  const rolledBack = a.lastDay !== null && today < a.lastDay;
  return { today, canClaim: !rolledBack && a.lastDay !== today, index: idx, cycle: Math.floor(a.count / ATTENDANCE.length) + 1, count: a.count, rolledBack, claimedToday: a.lastDay === today };
}

export function claimAttendance(state, now) {
  const st = attendanceStatus(state, now);
  if (st.rolledBack) return { ok: false, reason: 'clock' };
  if (!st.canClaim) return { ok: false, reason: 'duplicate' };
  const rw = resolveReward(ATTENDANCE[st.index], state.player.level);
  grant(state, rw);
  state.attendance.lastDay = st.today;
  state.attendance.count += 1;
  return { ok: true, day: st.index + 1, reward: rw, big: !!ATTENDANCE[st.index].big };
}

// ---------- return bonus ----------
// Called on load with the last active time *before* this session overwrote it.
export function prepareReturn(state, lastActiveAt, now, id) {
  if (state.returnBonus.pending) return state.returnBonus.pending;
  const days = kstDayIndex(now) - kstDayIndex(lastActiveAt);
  if (!(days >= RETURN_BONUS.minDays)) return null;
  // one bonus per absence: never twice for the same last-active day
  if (state.returnBonus.lastAwayFrom === kstDayIndex(lastActiveAt)) return null;
  let tier = RETURN_BONUS.tiers[0];
  for (const t of RETURN_BONUS.tiers) if (days >= t.days) tier = t;
  const pending = { id, days, tierDays: tier.days, reward: resolveReward(tier, state.player.level), boostHours: tier.boostHours, awayFrom: kstDayIndex(lastActiveAt) };
  state.returnBonus.pending = pending;
  return pending;
}

export function claimReturn(state, now) {
  const p = state.returnBonus.pending;
  if (!p) return { ok: false, reason: 'none' };
  grant(state, p.reward);
  state.returnBonus.pending = null;
  state.returnBonus.lastAwayFrom = p.awayFrom;
  state.returnBonus.claimed += 1;
  state.returnBonus.boostUntil = Math.max(state.returnBonus.boostUntil || 0, now) + p.boostHours * 3600 * 1000;
  return { ok: true, reward: p.reward, days: p.days, boostHours: p.boostHours };
}

export function boostActive(state, now) { return (state.returnBonus.boostUntil || 0) > now; }
export function farmMultipliers(state, now) {
  return boostActive(state, now) ? RETURN_BONUS.boost : { exp: 1, gold: 1 };
}
