// node --test tests/   — logic checks mapped to docs/handoff/03_QA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame, validate } from '../src/core/state.js';
import { Battle } from '../src/core/combat.js';
import { buyUpgrade, quoteUpgrade, upgradeCost, upgradeRoom, dismantle, dismantleQuote, addItems, equip, setLock, enhance } from '../src/core/economy.js';
import { makeItem, dismantleValue } from '../src/core/items.js';
import { gainExp, choosePromotion, promotionChecklist, onTokenKill, slotCount } from '../src/core/progression.js';
import { computeClaim, applyClaim, FarmVerifier } from '../src/core/offline.js';
import * as dun from '../src/core/dungeon.js';
import { playerStats } from '../src/core/stats.js';
import { fmt, makeRng, kstDayIndex } from '../src/core/util.js';
import { BALANCE, expToNext } from '../src/data/balance.js';
import { addItems as addItemsFn } from '../src/core/economy.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
const heroCfg = (s) => ({ stats: playerStats(s), skills: s.skills, branch: s.player.branch, skillLevel: () => 1 });

async function newLoadedGame(opts = {}) {
  let clock = opts.clock ?? T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  return { g, saver, tick: (ms) => { clock += ms; }, setClock: (v) => { clock = v; }, get clock() { return clock; } };
}

test('FPS independence: 15/30/60 FPS give identical combat for the same seed', () => {
  const run = (frameMs) => {
    const s = newGame(T0, 42);
    const b = new Battle({ kind: 'farm', rng: makeRng(42), hero: heroCfg(s), farm: { monsters: ['M01', 'M02'], levelFn: () => 6, eliteAllowed: () => true } });
    let acc = 0, kills = 0, dmg = 0;
    for (let t = 0; t < 180000; t += frameMs) {
      acc += frameMs;
      while (acc >= 50) { acc -= 50; b.step(); for (const e of b.drainEvents()) { if (e.type === 'kill') kills++; if (e.type === 'hit') dmg += e.dmg; } }
    }
    return { kills, dmg, hp: Math.round(b.hero.hp), gauge: b.hero.gauge, t: b.t };
  };
  const a = run(1000 / 15), c = run(1000 / 30), d = run(1000 / 60);
  // frame grouping can leave at most one tick difference at the end
  for (const x of [c, d]) {
    assert.ok(Math.abs(x.t - a.t) <= 50, 't');
    assert.ok(Math.abs(x.kills - a.kills) <= 1, `kills ${x.kills} vs ${a.kills}`);
  }
  assert.deepEqual(run(50), run(50));
  assert.ok(a.kills > 20);
});

test('ult gauge: clamped 0..100, kill charge per action capped at 10', () => {
  const s = newGame(T0, 7);
  s.player.statsUpgrades.atk = 400;   // one-shot everything
  const b = new Battle({ kind: 'farm', rng: makeRng(7), hero: heroCfg(s), farm: { monsters: ['M01'], levelFn: () => 1, eliteAllowed: () => false } });
  let maxGauge = 0;
  for (let i = 0; i < 4000; i++) { b.step(); b.drainEvents(); maxGauge = Math.max(maxGauge, b.hero.gauge); assert.ok(b.hero.gauge >= 0 && b.hero.gauge <= 100); }
  assert.equal(maxGauge, 100);
  // multi-kill: ult kills 2 enemies -> +10 max (not +10 per enemy beyond the cap)
  const s2 = newGame(T0, 9);
  s2.player.statsUpgrades.atk = 400;
  const b2 = new Battle({ kind: 'farm', rng: makeRng(9), hero: heroCfg(s2), farm: { monsters: ['M01'], levelFn: () => 1, eliteAllowed: () => false } });
  b2.addEnemy({ id: 'M01', name: 'x', telegraphMs: 400 }, 1).state = 'ready';
  for (const e of b2.enemies) { e.x = 204; e.state = 'ready'; }
  b2.addEnemy({ id: 'M01', name: 'y', telegraphMs: 400 }, 1);
  b2.enemies[1].x = 300; b2.enemies[1].state = 'ready';
  b2.addEnemy({ id: 'M01', name: 'z', telegraphMs: 400 }, 1);
  b2.enemies[2].x = 350; b2.enemies[2].state = 'ready';
  b2.hero.gauge = 100;
  b2.heroCfg.skills = { ...s2.skills, ultAuto: 'ALWAYS', autoCast: false };
  const before = b2.hero.gauge;
  for (let i = 0; i < 30; i++) b2.step();
  const kills = b2.drainEvents().filter((e) => e.type === 'kill').length;
  assert.ok(kills >= 2, 'ult hit several');
  assert.ok(b2.hero.gauge <= before - 100 + BALANCE.combat.ultCharge.killChargeCapPerAction + 2 * BALANCE.combat.ultCharge.perAttack, `gauge ${b2.hero.gauge}`);
});

test('upgrade caps: no purchase and no cost at crit 60% / speed 3.0', () => {
  const s = newGame(T0);
  s.wallet.gold = 1e15;
  s.player.statsUpgrades.crit = upgradeRoom(s, 'crit');
  s.player.statsUpgrades.speed = upgradeRoom(s, 'speed');
  assert.equal(upgradeRoom(s, 'crit'), 0);
  const g0 = s.wallet.gold;
  assert.equal(buyUpgrade(s, 'crit', 'MAX').reason, 'cap');
  assert.equal(buyUpgrade(s, 'speed', 10).reason, 'cap');
  assert.equal(s.wallet.gold, g0);
  const st = playerStats(s);
  assert.ok(st.crit <= 0.6 + 1e-9 && st.aspd <= 3 + 1e-9);
  // crit room leaves exactly the cap
  assert.ok(Math.abs(BALANCE.combat.critChance + 0.002 * s.player.statsUpgrades.crit - 0.6) < 0.002);
});

test('×10 / MAX: count, total and charge match; partial; shortfall exact', () => {
  const s = newGame(T0);
  const ten = Array.from({ length: 10 }, (_, i) => upgradeCost('atk', i)).reduce((a, b) => a + b, 0);
  s.wallet.gold = ten;
  const q = quoteUpgrade(s, 'atk', 10);
  assert.equal(q.count, 10); assert.equal(q.total, ten);
  const r = buyUpgrade(s, 'atk', 10);
  assert.ok(r.ok); assert.equal(s.wallet.gold, 0); assert.equal(s.player.statsUpgrades.atk, 10);
  // partial ×10
  s.wallet.gold = upgradeCost('atk', 10) + upgradeCost('atk', 11) + 1;
  const p = quoteUpgrade(s, 'atk', 10);
  assert.equal(p.count, 2); assert.ok(p.partial);
  buyUpgrade(s, 'atk', 10);
  assert.equal(s.wallet.gold, 1);
  // MAX with zero affordable -> shortfall = next cost - gold
  const z = quoteUpgrade(s, 'atk', 'MAX');
  assert.equal(z.count, 0); assert.equal(z.shortfall, upgradeCost('atk', 12) - 1);
  assert.equal(buyUpgrade(s, 'atk', 'MAX').reason, 'gold');
  assert.equal(s.wallet.gold, 1);
  // costs are ceil(base * 1.15^n)
  assert.equal(upgradeCost('atk', 0), 10); assert.equal(upgradeCost('atk', 1), 12); assert.equal(upgradeCost('crit', 2), Math.ceil(30 * 1.15 ** 2));
});

test('dismantle: locked/equipped protected, 80% refund floored, no double refund', () => {
  const s = newGame(T0);
  const rng = makeRng(1);
  const a = makeItem(s, { slot: 'weapon', rarity: 'rare', level: 5, rng });
  const b = makeItem(s, { slot: 'helmet', rarity: 'uncommon', level: 5, rng });
  const c = makeItem(s, { slot: 'armor', rarity: 'common', level: 5, rng });
  const d = makeItem(s, { slot: 'armor', rarity: 'common', level: 5, rng });
  addItems(s, [a, b, c, d]);
  s.wallet.ore = 100;
  equip(s, a.id); setLock(s, b.id, true);
  enhance(s, 'armor'); enhance(s, 'armor');           // slot enhance: items carry nothing
  const q = dismantleQuote(s, [a.id, b.id, c.id, d.id, c.id]);
  assert.equal(q.count, 2); assert.equal(q.blocked.length, 2);
  assert.equal(dismantleValue(c), 1);                 // rarity only (schema 6)
  const ore0 = s.wallet.ore;
  const r = dismantle(s, [a.id, b.id, c.id, d.id]);
  assert.ok(r.ok); assert.equal(s.wallet.ore, ore0 + 1 + 1);
  const again = dismantle(s, [c.id, d.id]);
  assert.equal(again.ok, false); assert.equal(s.wallet.ore, ore0 + 2);
  assert.equal(s.slotEnhance.armor, 2);               // the slot keeps its level
  assert.ok(s.inventory.find((i) => i.id === a.id) && s.inventory.find((i) => i.id === b.id));
});

// v4: +1..+5 guaranteed, max +15 (fail rules tested in v4.test.mjs)
test('enhance: +5 guaranteed, +15 cap, ore never negative', () => {
  const s = newGame(T0);
  const it = makeItem(s, { slot: 'weapon', rarity: 'common', level: 1, rng: makeRng(2) });
  addItems(s, [it]);
  s.wallet.ore = 1e9;
  for (let i = 0; i < 5; i++) assert.equal(enhance(s, 'weapon', () => 0.99).success, true);
  assert.equal(s.slotEnhance.weapon, 5);
  for (let i = 0; i < 10; i++) enhance(s, 'weapon', () => 0);   // rng 0 → always succeeds
  assert.equal(s.slotEnhance.weapon, 15);
  assert.equal(enhance(s, 'weapon').reason, 'max');
  s.wallet.ore = 0;
  assert.equal(enhance(s, 'helmet').reason, 'ore');
  assert.equal(enhance(s, 'ring').reason, 'missing');
  assert.equal(s.wallet.ore, 0);
});

test('inventory 200: extra items go to overflow, never deleted', () => {
  const s = newGame(T0);
  const rng = makeRng(3);
  const items = Array.from({ length: 205 }, () => makeItem(s, { slot: 'helmet', rarity: 'common', level: 1, rng }));
  const r = addItemsFn(s, items);
  assert.equal(s.inventory.length, 200); assert.equal(s.overflow.length, 5); assert.equal(r.overflowed.length, 5);
  // temporary storage full too: converted to ore at dismantle value, counted
  const more = Array.from({ length: 100 }, () => makeItem(s, { slot: 'helmet', rarity: 'uncommon', level: 1, rng }));
  const ore0 = s.wallet.ore;
  const r2 = addItemsFn(s, more);
  assert.equal(s.overflow.length, 100); assert.equal(r2.converted.length, 5);
  assert.equal(s.wallet.ore, ore0 + 5 * 3);
  assert.equal(s.progression.counters.overflowConverted, 5);
});

// v4: 5 slot entries (3 base, 4th at tier 1, 5th at tier 2)
test('skills: 3 slots before promotion, 4 after tier 1, 5 after tier 2; ult separate', () => {
  const s = newGame(T0);
  assert.equal(slotCount(s), 3);
  assert.equal(s.skills.equipped.length, 5);
  assert.equal(s.skills.equipped[3], null);
  s.player.branch = 'knight'; s.player.tier = 1;
  assert.equal(slotCount(s), 4);
  s.player.tier = 2;
  assert.equal(slotCount(s), 5);
});

// v4: cap is Lv 100 (was 35)
test('Lv30 EXP is stored, applied in order after promotion, capped at 100', () => {
  const s = newGame(T0);
  s.player.level = 29;
  const r = gainExp(s, expToNext(29) + 5000);
  assert.equal(s.player.level, 30); assert.equal(s.player.exp, 0); assert.equal(s.player.pendingExp, 5000 + 0);
  assert.equal(r.toPending, 5000);
  gainExp(s, 1000);
  assert.equal(s.player.pendingExp, 6000); assert.equal(s.player.level, 30);
  // promotion: tokens consumed only now
  s.wallet.token = 20; s.progression.bossCleared.B03 = true; s.promotion.trialCleared = true;
  s.player.pendingExp = expToNext(30) + expToNext(31) + 10;
  const p = choosePromotion(s, 'berserker');
  assert.ok(p.ok); assert.equal(s.wallet.token, 0); assert.equal(s.player.level, 32); assert.equal(s.player.exp, 10); assert.equal(s.player.pendingExp, 0);
  assert.equal(s.skills.equipped[3], 'berserkStrike');
  // cap 100: overflow EXP is discarded
  s.player.level = 99; s.player.tier = 3; s.player.exp = 0;
  const c = gainExp(s, expToNext(99) + 999);
  assert.equal(s.player.level, 100); assert.equal(s.player.exp, 0); assert.equal(c.discarded, 999);
  s.player.tier = 1;
  // re-switch only in dev
  assert.equal(choosePromotion(s, 'knight').reason, 'switch-dev-only');
  assert.ok(choosePromotion(s, 'knight', { dev: true }).ok);
  assert.equal(s.skills.equipped[3], 'guardCounter');
});

test('promotion checklist: each missing condition has a reason and shortcut', () => {
  const s = newGame(T0);
  s.player.level = 30;
  const cl = promotionChecklist(s);
  assert.equal(cl.canTrial, false);
  const tok = cl.items.find((i) => i.id === 'token');
  const boss = cl.items.find((i) => i.id === 'boss');
  assert.equal(tok.ok, false); assert.equal(tok.go, 'mine');
  assert.equal(boss.ok, false); assert.equal(boss.go, 'boss:B03');
  assert.equal(choosePromotion(s, 'knight').reason, 'conditions');
  assert.equal(s.wallet.token, 0);
  // tokens: 5 eligible kills = 1 token, from Lv25, only for Lv21+ enemies
  const t = newGame(T0); t.player.level = 25;
  for (let i = 0; i < 4; i++) onTokenKill(t, 21);
  assert.equal(t.wallet.token, 0);
  onTokenKill(t, 21); assert.equal(t.wallet.token, 1);
  for (let i = 0; i < 10; i++) onTokenKill(t, 15);
  assert.equal(t.wallet.token, 1);
});

test('trial: automatic battle can win; failure costs nothing', async () => {
  const { g } = await newLoadedGame();
  await g.transact('t', (s) => { s.player.level = 30; s.wallet.token = 20; s.progression.bossCleared.B03 = true; s.player.statsUpgrades = { atk: 5, hp: 5, def: 0, crit: 0, speed: 0 }; return { ok: true }; });
  assert.ok(g.startTrial().ok);
  for (let i = 0; i < 2000 && g.mode === 'PROMOTION_TRIAL'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(g.mode, 'RESULT');
  assert.equal(g.result.win, false);
  assert.equal(g.state.wallet.token, 20);
  assert.equal(g.state.promotion.trialCleared, false);
  g.returnToFarm();
  await g.transact('t', (s) => { s.player.statsUpgrades = { atk: 160, hp: 120, def: 40, crit: 40, speed: 60 }; return { ok: true }; });
  assert.ok(g.startTrial().ok);
  for (let i = 0; i < 2000 && g.mode === 'PROMOTION_TRIAL'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(g.result.win, true);
  assert.equal(g.state.promotion.trialCleared, true);
  assert.equal(g.state.wallet.token, 20, 'tokens only consumed at branch choice');
});

test('offline: 0s / 1h / 12h / 24h / clock rollback, 75%, ×1, verified farm only', () => {
  const s = newGame(T0);
  s.progression.verifiedFarm = { region: 'meadow', wave: 5, level: 5, killsPerSec: 0.4, windowSec: 75 };
  const at = (sec) => { s.offlineSnapshot.lastActiveAt = T0; return computeClaim(s, T0 + sec * 1000, 'c' + sec); };
  assert.equal(at(0).reason, 'short');
  const h1 = at(3600), h12 = at(43200), h24 = at(86400);
  assert.equal(h1.appliedSec, 3600);
  assert.equal(h24.appliedSec, 43200); assert.equal(h24.lostSec, 43200);
  assert.equal(h24.gold, h12.gold); assert.equal(h24.exp, h12.exp);
  // 75% of rate × seconds
  const perKillGold = Math.floor(BALANCE.monster.rewards.goldBase * Math.pow(BALANCE.monster.rewards.goldGrowth, 4));
  assert.equal(h1.gold, Math.floor(perKillGold * 0.4 * 3600 * 0.75));
  // deterministic for the same claim id
  assert.deepEqual(computeClaim(s, T0 + 3600e3, 'same'), computeClaim(s, T0 + 3600e3, 'same'));
  // clock moved backwards
  s.offlineSnapshot.lastActiveAt = T0;
  const back = computeClaim(s, T0 - 5000e3, 'back');
  assert.equal(back.appliedSec, 0); assert.ok(back.diag.includes('clock-rollback'));
  // items capped at 20, excess converted to ore
  assert.ok(h12.items.length <= 20);
  assert.equal(h12.ore, h12.convertedItems);
  // unverified: nothing
  const u = newGame(T0);
  u.offlineSnapshot.lastActiveAt = T0;
  const uc = computeClaim(u, T0 + 7200e3, 'u');
  assert.equal(uc.reason, 'unverified'); assert.equal(uc.gold, 0);
  // apply once
  const st2 = newGame(T0); st2.progression.verifiedFarm = s.progression.verifiedFarm;
  st2.offlineSnapshot.lastActiveAt = T0;
  const cl = computeClaim(st2, T0 + 3600e3, 'once');
  assert.ok(applyClaim(st2, cl, gainExp, addItemsFn).ok);
  const gold = st2.wallet.gold;
  assert.equal(applyClaim(st2, cl, gainExp, addItemsFn).reason, 'duplicate');
  assert.equal(st2.wallet.gold, gold);
});

test('farm verification: 3 clean cycles over ≥60 s; death resets; lowest wave/level used', () => {
  const v = new FarmVerifier();
  v.start('meadow', 3, 0);
  let res = null;
  let t = 0;
  for (let i = 0; i < 20; i++) { t += 3000; res = v.onKill('meadow', 3, 3, t); }
  assert.equal(res, null, 'only 2 cycles');
  v.onDeath();
  v.start('meadow', 3, t);
  for (let i = 0; i < 30; i++) { t += 3000; res = v.onKill('meadow', i < 10 ? 3 : 4, i < 10 ? 3 : 4, t) || res; }
  assert.ok(res);
  assert.equal(res.wave, 3); assert.equal(res.level, 3);
  assert.ok(res.windowSec >= 60);
  assert.ok(Math.abs(res.killsPerSec - 1 / 3) < 0.02);
});

test('dungeon: KST daily +3 to 9, rollback adds nothing, entry/finish/sweep/recover once', () => {
  const s = newGame(T0);
  s.dungeon.tickets = 0;
  s.dungeon.lastDay = kstDayIndex(T0);
  assert.equal(dun.refreshTickets(s, T0 + 3600e3).added, 0);
  // next KST midnight
  const mid = dun.nextRefillAt(T0);
  assert.equal(new Date(mid).getUTCHours(), 15);   // 00:00 KST = 15:00 UTC
  assert.equal(dun.refreshTickets(s, mid + 1000).added, 3);
  assert.equal(dun.refreshTickets(s, mid + 5 * 86400e3).added, 6);   // capped at 9
  assert.equal(s.dungeon.tickets, 9);
  assert.ok(dun.refreshTickets(s, T0).rollback);
  assert.equal(s.dungeon.tickets, 9);
  // sweep needs a record
  assert.equal(dun.sweep(s).reason, 'no-record');
  assert.equal(dun.beginRun(s, 2, 'r1', T0).reason, 'stage');
  assert.ok(dun.beginRun(s, 1, 'r1', T0).ok);
  assert.equal(s.dungeon.tickets, 8);
  assert.equal(dun.beginRun(s, 1, 'r2', T0).reason, 'pending');
  const f = dun.finishRun(s, 'r1', true);
  assert.ok(f.ok && f.record); assert.equal(s.dungeon.best, 1);
  assert.equal(dun.finishRun(s, 'r1', true).reason, 'no-run');
  const ore = s.wallet.ore;
  const sw = dun.sweep(s);
  assert.equal(sw.stage, 1); assert.equal(s.wallet.ore, ore + dun.stageReward(1).ore); assert.equal(s.dungeon.tickets, 7);
  // crash during a run: one refund on load
  dun.beginRun(s, 2, 'r3', T0);
  assert.equal(s.dungeon.tickets, 6);
  assert.equal(dun.recoverPendingRun(s).refunded, 1);
  assert.equal(s.dungeon.tickets, 7);
  assert.equal(dun.recoverPendingRun(s), null);
  s.dungeon.tickets = 0;
  assert.equal(dun.sweep(s).reason, 'tickets');
});

test('transactions: failed save leaves state unchanged and grants nothing', async () => {
  const { g, saver } = await newLoadedGame();
  await g.transact('t', (s) => { s.wallet.gold = 1000; return { ok: true }; });
  saver.failNext = 1;
  const r = await g.buyUpgrade('atk', 10);
  assert.equal(r.ok, false); assert.equal(r.reason, 'save');
  assert.equal(g.state.wallet.gold, 1000); assert.equal(g.state.player.statsUpgrades.atk, 0);
  const r2 = await g.buyUpgrade('atk', 1);
  assert.ok(r2.ok); assert.equal(g.state.wallet.gold, 990);
  // stored copy matches the live state
  const stored = JSON.parse(saver.slots.current.data);
  assert.equal(stored.wallet.gold, 990); assert.equal(stored.revision, g.state.revision);
  assert.ok(saver.slots.previousGood);
});

test('revision conflict blocks writes (second writer)', async () => {
  const { g, saver } = await newLoadedGame();
  // another writer bumps the stored revision
  const other = JSON.parse(saver.slots.current.data);
  await saver.commit(other);
  const r = await g.transact('write', (s) => { s.wallet.gold += 1; return { ok: true }; });
  assert.equal(r.ok, false); assert.equal(r.reason, 'conflict'); assert.equal(g.mode, 'CONFLICT');
  assert.equal(JSON.parse(saver.slots.current.data).wallet.gold, other.wallet.gold);
  assert.equal((await g.transact('x', () => ({ ok: true }))).reason, 'conflict');
});

test('offline claim in game: persisted pending claim, reload shows same, double claim once', async () => {
  const env = await newLoadedGame();
  const { g, saver } = env;
  await g.transact('t', (s) => { s.progression.verifiedFarm = { region: 'meadow', wave: 5, level: 5, killsPerSec: 0.4, windowSec: 75 }; return { ok: true }; });
  await g.onHidden();
  env.tick(3 * 3600e3);
  g.onVisible();
  assert.equal(g.mode, 'OFFLINE');
  await new Promise((r) => setTimeout(r, 5));
  const claim = g.state.offlineSnapshot.pendingClaim;
  assert.ok(claim && claim.gold > 0);
  // "reload": a new Game on the same store gets the same claim, not a new one
  const g2 = new Game({ saver, now: () => env.clock });
  await g2.load();
  assert.equal(g2.mode, 'OFFLINE');
  assert.equal(g2.state.offlineSnapshot.pendingClaim.claimId, claim.claimId);
  const gold0 = g2.state.wallet.gold;
  const [a, b] = await Promise.all([g2.claimOffline(), g2.claimOffline()]);
  assert.ok(a.ok || b.ok);
  assert.ok(!(a.ok && b.ok));
  assert.equal(g2.state.wallet.gold, gold0 + claim.gold);
  assert.equal(g2.mode, 'FARM');
  const r3 = await g2.claimOffline();
  assert.equal(r3.ok, false);
});

test('hidden → visible never replays hidden time as foreground ticks', async () => {
  const env = await newLoadedGame();
  const { g } = env;
  g.advance(1000);
  const t0 = g.farm.t;
  await g.onHidden();
  env.tick(20000);
  g.onVisible();
  assert.equal(g.acc, 0);
  assert.equal(g.farm.t, t0);
});

test('boss: one completion event, rewards saved before result, farm battle preserved', async () => {
  const { g } = await newLoadedGame();
  await g.transact('t', (s) => { s.progression.maxWave.meadow = 10; s.player.statsUpgrades.atk = 120; s.player.statsUpgrades.hp = 50; return { ok: true }; });
  const farm = g.farm;
  const farmT = farm.t;
  let results = 0;
  g.on('result', () => results++);
  assert.ok(g.startBoss('B01').ok);
  for (let i = 0; i < 2000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(results, 1);
  assert.equal(g.result.win, true);
  assert.equal(g.state.progression.bossCleared.B01, true);
  assert.ok(g.state.inventory.some((i) => i.source === 'firstClear' && i.rarity === 'rare' && i.slot === 'weapon'));
  assert.ok(g.state.progression.unlockedRegions.includes('desert'));
  g.returnToFarm();
  assert.equal(g.active, farm); assert.equal(farm.t, farmT);
  // second clear does not give the first-clear reward again
  const firsts = g.state.inventory.filter((i) => i.source === 'firstClear').length;
  g.startBoss('B01');
  for (let i = 0; i < 2000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(g.state.inventory.filter((i) => i.source === 'firstClear').length, firsts);
});

test('boss failure returns to farm with no loss', async () => {
  const { g } = await newLoadedGame();
  await g.transact('t', (s) => { s.progression.maxWave.meadow = 10; s.wallet.gold = 777; return { ok: true }; });
  const inv = g.state.inventory.length;
  g.startBoss('B01');
  for (let i = 0; i < 4000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(g.result.win, false);
  assert.ok(g.state.wallet.gold >= 777);
  assert.equal(g.state.inventory.length, inv);
  g.returnToFarm();
  assert.equal(g.mode, 'FARM');
});

test('save validation catches broken data', () => {
  const s = newGame(T0);
  assert.deepEqual(validate(s), []);
  s.wallet.gold = -1;
  assert.ok(validate(s).includes('wallet'));
});

test('number format per spec 08', () => {
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1K');
  assert.equal(fmt(1280), '1.28K');
  assert.equal(fmt(999995), '1M');
  assert.equal(fmt(1280000), '1.28M');
  assert.equal(fmt(1.28e9), '1.28B');
});

test('save records: checksum and import validation reject damaged data', async () => {
  const { unpack, parseExport } = await import('../src/platform/save.js');
  const { hashString } = await import('../src/core/util.js');
  const s = newGame(T0);
  const data = JSON.stringify(s);
  assert.ok(unpack({ data, sum: hashString(data) }).ok);
  assert.equal(unpack({ data: data.replace('"gold":0', '"gold":9'), sum: hashString(data) }).error, 'checksum');
  assert.equal(unpack({ data: '{bad', sum: hashString('{bad') }).error, 'json');
  const newer = JSON.stringify({ ...s, schemaVersion: 99 });
  assert.equal(unpack({ data: newer, sum: hashString(newer) }).error, 'newer-schema');
  assert.ok(parseExport(JSON.stringify({ format: 'asteria-save', exportedAt: T0, state: s })).ok);
  assert.equal(parseExport('not json').ok, false);
  assert.equal(parseExport(JSON.stringify({ format: 'other', state: s })).ok, false);
  const broken = { ...s, wallet: { gold: -5, ore: 0, token: 0 } };
  assert.equal(parseExport(JSON.stringify({ format: 'asteria-save', state: broken })).ok, false);
});
