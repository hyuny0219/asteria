// Offline (복귀) settlement.
//
// Farm verification: a farm spot becomes the offline baseline only after the hero
// survives 3 consecutive wave cycles (10 kills each) with no death, measured over at
// least 60 s of ×1 simulation time. The rate is the measured kills/s over that window
// with rewards at the lowest wave level of the window. Boss or unverified waves never
// set the rate, and combat power alone never raises it.
//
// Reward = floor(rate * min(elapsed, 12h) * 0.75). EXP, gold, ore and common..rare
// equipment only; no tickets, tokens or gems. At most 20 items are created; the rest
// is converted to ore (1 per item, shown in the breakdown).
import { BALANCE } from '../data/balance.js';
import { REGION_BY_ID } from '../data/content.js';
import { killRewards } from './combat.js';
import { makeItem, rollRarity, rollSlot } from './items.js';
import { hashString, makeRng } from './util.js';

const O = BALANCE.offline;
const EQ = BALANCE.equipment;

export const RATE_METHOD = 'measured-60s-window-x1/v1';

// --- verification tracker (lives in memory, result stored in progression.verifiedFarm) ---
export class FarmVerifier {
  constructor() { this.reset(); }
  reset() { this.cycles = []; this.cur = null; }
  start(region, wave, simMs) { this.cur = { region, wave, kills: 0, startMs: simMs, level: null, minLevel: Infinity }; }
  onDeath() { this.reset(); }
  // returns a verifiedFarm object when the window qualifies, else null
  onKill(region, wave, level, simMs, eliteFree = true) {
    if (!this.cur || this.cur.region !== region) this.start(region, wave, simMs - 1);
    const c = this.cur;
    c.kills++;
    c.minLevel = Math.min(c.minLevel, level);
    if (c.kills >= BALANCE.combat.waveKillTarget) {
      c.endMs = simMs;
      this.cycles.push(c);
      if (this.cycles.length > O.validateCycles) this.cycles.shift();
      this.start(region, wave, simMs);
    }
    if (this.cycles.length < O.validateCycles) return null;
    const first = this.cycles[0], last = this.cycles[this.cycles.length - 1];
    const windowMs = last.endMs - first.startMs;
    if (windowMs < O.minWindowSec * 1000) return null;
    const kills = this.cycles.reduce((s, x) => s + x.kills, 0);
    const minLevel = Math.min(...this.cycles.map((x) => x.minLevel));
    const minWave = Math.min(...this.cycles.map((x) => x.wave));
    return { region, wave: minWave, level: minLevel, killsPerSec: kills / (windowMs / 1000), windowSec: Math.round(windowMs / 1000), method: RATE_METHOD, at: Date.now() };
  }
}

export function ratePerSecond(vf) {
  if (!vf) return null;
  const r = killRewards(vf.level);
  return {
    exp: r.exp * vf.killsPerSec,
    gold: r.gold * vf.killsPerSec,
    items: vf.killsPerSec * EQ.dropChance,
    killsPerSec: vf.killsPerSec,
  };
}

// Pure computation of a claim. Deterministic for a given claimId.
export function computeClaim(state, now, claimId) {
  const last = state.offlineSnapshot.lastActiveAt;
  let elapsed = (now - last) / 1000;
  const diag = [];
  if (!Number.isFinite(elapsed) || elapsed < 0) { diag.push('clock-rollback'); elapsed = 0; }
  const cap = O.maxSeconds;
  if (elapsed > 7 * 86400) diag.push('future-clamped');          // implausible gap: still capped, but logged
  const applied = Math.min(elapsed, cap);
  const lost = Math.max(0, elapsed - cap);
  const vf = state.progression.verifiedFarm;
  const rate = ratePerSecond(vf);
  const claim = { claimId, computedAt: now, fromAt: last, elapsedSec: Math.floor(elapsed), appliedSec: Math.floor(applied), lostSec: Math.floor(lost),
    efficiency: O.efficiency, capSec: cap, diag, farm: vf ? { region: vf.region, wave: vf.wave, level: vf.level, killsPerSec: vf.killsPerSec } : null,
    exp: 0, gold: 0, ore: 0, items: [], convertedItems: 0, reason: null };
  if (!rate) { claim.reason = 'unverified'; return claim; }
  if (applied < O.minSeconds) { claim.reason = 'short'; return claim; }
  const k = applied * O.efficiency;
  claim.exp = Math.floor(rate.exp * k);
  claim.gold = Math.floor(rate.gold * k);
  // items: expected count, sampled deterministically from the claim id
  const rng = makeRng(hashString(claimId));
  const expected = rate.items * k;
  let n = Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
  const make = Math.min(n, O.maxEquipmentItems);
  claim.convertedItems = n - make;
  claim.ore += claim.convertedItems * O.overflowItemToOre;
  // items are described here; real item objects are created at apply time
  claim.items = [];
  for (let i = 0; i < make; i++) claim.items.push({ slot: rollSlot(rng), rarity: rollRarity(rng, EQ.offlineRarity), level: vf.level });
  return claim;
}

// Apply a computed claim exactly once. Returns the created items.
export function applyClaim(state, claim, gainExp, addItems) {
  if (state.transactions.lastClaimId === claim.claimId) return { ok: false, reason: 'duplicate' };
  state.wallet.gold += claim.gold;
  state.wallet.ore += claim.ore;
  const expRes = gainExp(state, claim.exp);
  const rng = makeRng(hashString(claim.claimId + ':items'));
  const items = claim.items.map((d) => makeItem(state, { ...d, rng, source: 'offline' }));
  const added = addItems(state, items);
  state.transactions.lastClaimId = claim.claimId;
  state.transactions.lastClaimAt = claim.computedAt;
  state.offlineSnapshot.pendingClaim = null;
  state.offlineSnapshot.lastActiveAt = claim.computedAt;
  return { ok: true, expRes, items, overflowed: added.overflowed };
}

export function regionName(id) { return REGION_BY_ID[id]?.name || id; }
