// Ticket dungeons: 별의 채석장 (quarry, ore — v3 data in state.dungeon), 황금 금고 (gold),
// 스킬북 서고 (books) in state.dungeons[type]. Tickets: +3 per KST day, cap 9.
// Entry transaction records a pending run; a run never finished is refunded on load.
import { BALANCE } from '../data/balance.js';
import { DUNGEON_MONSTERS } from '../data/content.js';
import { goldAt } from './combat.js';
import { kstDayIndex, nextKstMidnight } from './util.js';

const D = BALANCE.dungeon;
export const DUNGEON_TYPES = Object.keys(BALANCE.dungeons);
export const dungeonState = (state, type = 'quarry') => (type === 'quarry' ? state.dungeon : state.dungeons[type]);

function refreshOne(state, d, today) {
  if (today < d.lastDay) { d.clockWarnings = (d.clockWarnings || 0) + 1; return { added: 0, rollback: true }; }
  const days = today - d.lastDay;
  if (days <= 0) return { added: 0 };
  const before = d.tickets;
  // rewards may push tickets above the cap; refills only fill up to it
  d.tickets = Math.max(d.tickets, Math.min(D.ticketCap, d.tickets + D.dailyTickets * days));
  d.lastDay = today;
  return { added: d.tickets - before };
}
// Refill every dungeon. Clock going backwards adds nothing (logged once).
export function refreshTickets(state, now) {
  const today = kstDayIndex(now);
  const q = refreshOne(state, state.dungeon, today);
  if (q.rollback) state.diagnostics.clockRollbacks++;
  for (const t of DUNGEON_TYPES) if (t !== 'quarry' && state.dungeons[t]) refreshOne(state, state.dungeons[t], today);
  return q;
}
export const nextRefillAt = (now) => nextKstMidnight(now);

export const stageLevel = (stage) => D.levelBase + D.levelPerStage * stage;
export function stageReward(stage, type = 'quarry') {
  if (type === 'gold') {
    const G = BALANCE.dungeons.gold;
    return { gold: Math.floor(goldAt(stageLevel(stage)) * 20 * G.goldMinutesPerKill * G.killTarget), ore: 0, books: 0 };
  }
  if (type === 'books') {
    const B = BALANCE.dungeons.books;
    return { books: Math.floor(B.booksBase + B.booksPerStage * stage), gold: D.goldPerStage * stage, ore: 0 };
  }
  return { ore: D.oreBase + D.orePerStage * (stage - 1), gold: D.goldPerStage * stage, books: 0 };
}
export function runConfig(type, stage) {
  return { type, stage, level: stageLevel(stage), monsters: DUNGEON_MONSTERS[type], killTarget: type === 'gold' ? BALANCE.dungeons.gold.killTarget : D.killTarget };
}

export function beginRun(state, stage, runId, now, type = 'quarry') {
  const d = dungeonState(state, type);
  if (d.pendingRun) return { ok: false, reason: 'pending' };
  if (d.tickets <= 0) return { ok: false, reason: 'tickets' };
  if (stage < 1 || stage > d.best + 1) return { ok: false, reason: 'stage' };
  d.tickets -= 1;
  d.pendingRun = { runId, stage, startedAt: now, type };
  return { ok: true };
}

// Books are spread one by one over the player's unlocked skills (deterministic rng).
export function grantBooks(state, n, skills, rng) {
  const got = {};
  if (!skills.length) return got;
  for (let i = 0; i < n; i++) { const id = skills[Math.floor(rng() * skills.length)]; got[id] = (got[id] || 0) + 1; }
  for (const [id, k] of Object.entries(got)) state.skills.books[id] = (state.skills.books[id] || 0) + k;
  return got;
}

// Clear = full reward and maybe a record; fail = 30% (ore/gold/books), ticket stays spent.
export function finishRun(state, runId, cleared, { type = 'quarry', skills = [], rng = Math.random } = {}) {
  const d = dungeonState(state, type);
  if (!d.pendingRun || d.pendingRun.runId !== runId) return { ok: false, reason: 'no-run' };
  const stage = d.pendingRun.stage;
  const r = stageReward(stage, type);
  const k = cleared ? 1 : 0.3;
  const ore = Math.floor(r.ore * k);
  const gold = cleared || type === 'gold' ? Math.floor(r.gold * k) : 0;
  const books = Math.floor(r.books * k);
  state.wallet.ore += ore;
  state.wallet.gold += gold;
  const bookMap = books ? grantBooks(state, books, skills, rng) : {};
  const record = cleared && stage > d.best;
  if (record) d.best = stage;
  d.pendingRun = null;
  return { ok: true, type, stage, cleared, ore, gold, books, bookMap, record };
}

export function sweep(state, { type = 'quarry', skills = [], rng = Math.random } = {}) {
  const d = dungeonState(state, type);
  if (d.best <= 0) return { ok: false, reason: 'no-record' };
  if (d.tickets <= 0) return { ok: false, reason: 'tickets' };
  if (d.pendingRun) return { ok: false, reason: 'pending' };
  d.tickets -= 1;
  const r = stageReward(d.best, type);
  state.wallet.ore += r.ore;
  state.wallet.gold += r.gold;
  const bookMap = r.books ? grantBooks(state, r.books, skills, rng) : {};
  return { ok: true, type, stage: d.best, ...r, bookMap };
}

export function recoverPendingRun(state) {
  for (const type of DUNGEON_TYPES) {
    const d = dungeonState(state, type);
    if (!d || !d.pendingRun) continue;
    const run = d.pendingRun;
    d.pendingRun = null;
    d.tickets = Math.min(Math.max(D.ticketCap, d.tickets), d.tickets + 1);
    return { refunded: 1, stage: run.stage, runId: run.runId, type };
  }
  return null;
}
