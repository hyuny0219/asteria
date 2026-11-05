// Material dungeon "별의 채석장": tickets, entry transaction, sweep, crash recovery.
// Daily reset at 00:00 Asia/Seoul (client clock; manipulation is not prevented — see docs).
import { BALANCE } from '../data/balance.js';
import { kstDayIndex, nextKstMidnight } from './util.js';

const D = BALANCE.dungeon;

// Refill +3 per KST day passed, capped at 9. Clock going backwards adds nothing.
export function refreshTickets(state, now) {
  const d = state.dungeon;
  const today = kstDayIndex(now);
  if (today < d.lastDay) { d.clockWarnings++; state.diagnostics.clockRollbacks++; return { added: 0, rollback: true }; }
  const days = today - d.lastDay;
  if (days <= 0) return { added: 0 };
  const before = d.tickets;
  d.tickets = Math.min(D.ticketCap, d.tickets + D.dailyTickets * days);
  d.lastDay = today;
  return { added: d.tickets - before };
}
export const nextRefillAt = (now) => nextKstMidnight(now);

export function stageReward(stage) {
  return { ore: D.oreBase + D.orePerStage * (stage - 1), gold: D.goldPerStage * stage };
}
export const stageLevel = (stage) => D.levelBase + D.levelPerStage * stage;

// Entry consumes a ticket and records a pending run (saved in the same commit).
export function beginRun(state, stage, runId, now) {
  const d = state.dungeon;
  if (d.pendingRun) return { ok: false, reason: 'pending' };
  if (d.tickets <= 0) return { ok: false, reason: 'tickets' };
  if (stage < 1 || stage > d.best + 1) return { ok: false, reason: 'stage' };
  d.tickets -= 1;
  d.pendingRun = { runId, stage, startedAt: now };
  return { ok: true };
}

// Finish a run once. Clear = full reward and maybe a new record; fail = 30% ore, ticket stays spent.
export function finishRun(state, runId, cleared) {
  const d = state.dungeon;
  if (!d.pendingRun || d.pendingRun.runId !== runId) return { ok: false, reason: 'no-run' };
  const stage = d.pendingRun.stage;
  const r = stageReward(stage);
  const ore = cleared ? r.ore : Math.floor(r.ore * 0.3);
  const gold = cleared ? r.gold : 0;
  state.wallet.ore += ore;
  state.wallet.gold += gold;
  const record = cleared && stage > d.best;
  if (record) d.best = stage;
  d.pendingRun = null;
  return { ok: true, stage, cleared, ore, gold, record };
}

// Sweep: instant reward of the best cleared stage for one ticket.
export function sweep(state) {
  const d = state.dungeon;
  if (d.best <= 0) return { ok: false, reason: 'no-record' };
  if (d.tickets <= 0) return { ok: false, reason: 'tickets' };
  if (d.pendingRun) return { ok: false, reason: 'pending' };
  d.tickets -= 1;
  const r = stageReward(d.best);
  state.wallet.ore += r.ore;
  state.wallet.gold += r.gold;
  return { ok: true, stage: d.best, ...r };
}

// On load: a run that was entered but never finished (crash / closed tab) is refunded once.
export function recoverPendingRun(state) {
  const d = state.dungeon;
  if (!d.pendingRun) return null;
  const run = d.pendingRun;
  d.pendingRun = null;
  d.tickets = Math.min(D.ticketCap, d.tickets + 1);
  return { refunded: 1, stage: run.stage, runId: run.runId };
}
