// 특성 / 환생 / 균열
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate, validate, SCHEMA_VERSION } from '../src/core/state.js';
import * as T from '../src/core/talents.js';
import { TALENT_NODES, TALENT_TREES } from '../src/data/talents.js';
import * as RB from '../src/core/rebirth.js';
import * as RF from '../src/core/rift.js';
import { playerStats } from '../src/core/stats.js';
import { Battle } from '../src/core/combat.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { makeRng } from '../src/core/util.js';
import * as prog from '../src/core/progression.js';
import { makeItem } from '../src/core/items.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
const DAY = 86400000;
const tier1 = (cls = 'warrior', lv = 60, branch = null) => {
  const s = newGame(T0, 7, cls);
  s.player.level = lv; s.player.peakLevel = lv; s.player.tier = 1;
  s.player.branch = branch || { warrior: 'knight', mage: 'wizard', archer: 'ranger', rogue: 'assassin' }[cls];
  return s;
};

test('talents: locked before tier 1; points = peak level − 30 + tower/10', () => {
  const s = newGame(T0);
  s.player.level = 40;
  assert.equal(T.pointsTotal(s), 0);
  const t = tier1('warrior', 45);
  t.tower.best = 23;
  assert.equal(T.pointsTotal(t), 15 + 2);
});

test('talents: ranks cap at max, row gate needs 5 points in the rows above, own class trees only', () => {
  const s = tier1('mage', 100);
  assert.equal(T.canRank(s, 'kn_hp').reason, 'tree');
  assert.equal(T.canRank(s, 'wz_ult').reason, 'gate');           // row 2
  for (let i = 0; i < 5; i++) assert.equal(T.rankUp(s, 'wz_atk').ok, true);
  assert.equal(T.rankUp(s, 'wz_atk').reason, 'max');
  assert.equal(T.canRank(s, 'wz_ult').ok, true);
  assert.equal(T.canRank(s, 'cap_meteor2').reason, 'gate');
  T.autoAllocate(s);
  assert.equal(T.rankOf(s, 'cap_meteor2'), 1, 'auto reaches own capstone first');
  assert.ok(T.pointsSpent(s) <= T.pointsTotal(s));
});

test('talents: stat effects show in playerStats; presets are separate', () => {
  const s = tier1('warrior', 80);
  const base = playerStats(s).atk;
  for (let i = 0; i < 5; i++) T.rankUp(s, 'bs_atk');
  assert.ok(playerStats(s).atk > base);
  assert.equal(T.setPreset(s, 1).ok, true);
  assert.equal(playerStats(s).atk, base, 'preset 2 is empty');
  assert.ok(playerStats(s, { preset: 0 }).atk > base);
});

test('talents: respec free once per KST day, then gold', () => {
  const s = tier1('archer', 70);
  T.rankUp(s, 'rg_atk');
  assert.equal(T.respecCost(s, T0), 0);
  assert.equal(T.respec(s, T0).ok, true);
  assert.equal(T.pointsSpent(s), 0);
  assert.ok(T.respecCost(s, T0) > 0);
  s.wallet.gold = 0;
  assert.equal(T.respec(s, T0).reason, 'gold');
  assert.equal(T.respecCost(s, T0 + DAY), 0);
});

function fight(s, kind = 'farm', extra = {}, ms = 60000, seed = 3) {
  const st = playerStats(s);
  const b = new Battle({ kind, rng: makeRng(seed), hero: { stats: st, skills: s.skills, branch: s.player.branch, cls: s.player.cls, tier: s.player.tier, ult: prog.ultId(s), range: 'ranged', skillLevel: () => 1 }, farm: { monsters: ['M01'], levelFn: () => 5, eliteAllowed: () => false }, ...extra });
  const ev = [];
  for (let t = 0; t < ms; t += 50) { b.step(); ev.push(...b.drainEvents()); }
  return { b, ev };
}

test('capstone: 이중 유성 makes meteor hit again (echo hits)', () => {
  const s = tier1('mage', 100);
  s.skills.ultAuto = 'ALWAYS';
  const without = fight(s).ev.filter((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'ult').length;
  T.autoAllocate(s);
  assert.ok(playerStats(s).caps.cap_meteor2);
  const withCap = fight(s).ev.filter((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'ult').length;
  assert.ok(withCap > without, `${withCap} > ${without}`);
});

test('capstone: 재기 survives one lethal hit per battle', () => {
  const s = tier1('warrior', 31);
  for (const id of ['cm_hp', 'cm_hp', 'cm_hp', 'cm_hp', 'cm_hp', 'cm_def', 'cm_def', 'cm_def', 'cm_def', 'cm_def', 'cm_gold', 'cm_gold', 'cm_gold', 'cm_gold', 'cm_gold', 'cm_exp', 'cm_exp', 'cm_exp', 'cm_exp', 'cm_exp', 'cm_guard'] ) { s.player.level = 100; s.player.peakLevel = 100; T.rankUp(s, id); }
  for (let i = 0; i < 5; i++) { T.rankUp(s, 'cm_guard'); T.rankUp(s, 'cm_evade'); T.rankUp(s, 'cm_offline'); T.rankUp(s, 'cm_drop'); }
  assert.equal(T.rankUp(s, 'cap_secondWind').ok, true);
  s.player.level = 1;
  const { ev } = fight(s, 'boss', { boss: { id: 'B05' } }, 30000);
  assert.ok(ev.some((e) => e.type === 'buff' && e.skill === 'secondWind'));
});

test('capstone: 그림자 일격 gives guaranteed crits after shadow step', () => {
  const s = tier1('rogue', 100);
  T.autoAllocate(s);
  assert.ok(playerStats(s).caps.cap_shadowCrit);
});

test('rebirth: needs Lv 100; resets level/gold/upgrades, keeps tier/gear/gems; multipliers apply', () => {
  const s = tier1('warrior', 99);
  assert.equal(RB.doRebirth(s, T0).reason, 'level');
  s.player.level = 100; s.player.tier = 3; s.wallet.gold = 1e9; s.wallet.gem = 500; s.player.statsUpgrades.atk = 300;
  const it = makeItem(s, { slot: 'weapon', rarity: 'rare', level: 90, rng: makeRng(2) }); s.inventory.push(it); s.equipped.weapon = it.id; s.tower.best = 40;
  const before = T.pointsTotal(s);
  const r = RB.doRebirth(s, T0);
  assert.equal(r.ok, true);
  assert.equal(r.essence, 30 + 20);
  assert.equal(s.player.level, 1); assert.equal(s.wallet.gold, 0); assert.equal(s.player.statsUpgrades.atk, 0);
  assert.equal(s.player.tier, 3); assert.equal(s.equipped.weapon, it.id); assert.equal(s.wallet.gem, 500);
  assert.equal(s.progression.region, 'meadow');
  assert.equal(prog.isPromotionLocked(s), false);
  assert.ok(T.pointsTotal(s) >= before, 'talent points kept (+3 per rebirth)');
  const atk0 = playerStats(s).atk;
  assert.equal(RB.buyUpgrade(s, 'atk').ok, true);
  assert.ok(playerStats(s).atk > atk0);
  s.rebirth.essence = 0;
  assert.equal(RB.buyUpgrade(s, 'atk').reason, 'essence');
});

test('rift: locked before B03, 2 free runs a KST day, blessing pick, rewards once', () => {
  const s = tier1('archer', 50);
  assert.equal(RF.beginRun(s, 'r1', T0).reason, 'locked');
  s.progression.bossCleared.B03 = true;
  assert.equal(RF.beginRun(s, 'r1', T0).ok, true);
  assert.equal(RF.beginRun(s, 'r2', T0).reason, 'pending');
  const w = RF.finishFloor(s, 'r1', true, 0.5, T0, makeRng(1), ['a_aim']);
  assert.equal(w.choices.length, 3);
  assert.equal(new Set(w.choices).size, 3);
  assert.equal(RF.pickBlessing(s, 'nope').reason, 'choice');
  assert.equal(RF.pickBlessing(s, w.choices[0]).ok, true);
  assert.equal(s.rift.run.floor, 2);
  assert.ok(Object.keys(RF.runMods(s.rift.run)).length > 0);
  const gem0 = s.wallet.gem;
  const end = RF.finishFloor(s, 'r1', false, 0, T0, makeRng(1), ['a_aim']);
  assert.equal(end.ended, true);
  assert.equal(end.cleared, 1);
  assert.ok(s.wallet.gem > gem0);
  assert.equal(s.rift.run, null);
  assert.equal(RF.finishFloor(s, 'r1', false, 0, T0, makeRng(1)).reason, 'duplicate');
  assert.equal(RF.beginRun(s, 'r2', T0).ok, true);
  RF.endRun(s, T0, makeRng(1));
  assert.equal(RF.beginRun(s, 'r3', T0).reason, 'tries');
  assert.equal(RF.beginRun(s, 'r3', T0 + DAY).ok, true);
});

test('rift: curse rotates weekly (KST Monday) and choices are deterministic per run', () => {
  const a = RF.curseFor(T0), b = RF.curseFor(T0 + 7 * DAY);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(RF.rollChoices('x', 3), RF.rollChoices('x', 3));
});

test('rift run through Game: saved run resumes after reload, forfeit ends with rewards', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  await g.transact('qa', (s) => { s.player.level = 40; s.progression.bossCleared.B03 = true; return { ok: true }; });
  const r = await g.startRift();
  assert.equal(r.ok, true);
  assert.equal(g.mode, 'DUNGEON');
  const g2 = new Game({ saver, now: () => clock });
  await g2.load();
  assert.ok(g2.state.rift.run, 'run survives reload');
  if (g2.mode === 'OFFLINE') await g2.claimOffline();
  assert.equal((await g2.startRift()).floor, 1);
  g2.forfeit();
  for (let i = 0; i < 20 && g2.mode !== 'RESULT'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(g2.mode, 'RESULT');
  assert.equal(g2.state.rift.run, null);
});

test('schema 3 → 4 adds talents/rebirth/rift and peakLevel', () => {
  const s = newGame(T0);
  delete s.talents; delete s.rebirth; delete s.rift; delete s.player.peakLevel;
  s.schemaVersion = 3; s.player.level = 42;
  const m = migrate(s);
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.player.peakLevel, 42);
  assert.ok(m.talents && m.rebirth && m.rift);
  assert.deepEqual(validate(m), []);
});

test('talent data: every tree has 5 rows and one capstone', () => {
  for (const [id, t] of Object.entries(TALENT_TREES)) {
    assert.equal(t.rows.length, 5, id);
    assert.equal(t.rows[4].length, 1);
    assert.ok(t.rows[4][0].capstone);
  }
  assert.ok(Object.keys(TALENT_NODES).length >= 9 * 9);
});

test('rift: clearing the last floor ends the run with rewards (no endless runs)', () => {
  const s = tier1('warrior', 60);
  s.progression.bossCleared.B03 = true;
  RF.beginRun(s, 'deep', T0);
  s.rift.run.floor = RF.RIFT.maxFloor;
  const r = RF.finishFloor(s, 'deep', true, 0.9, T0, makeRng(1));
  assert.equal(r.ended, true);
  assert.equal(r.complete, true);
  assert.equal(s.rift.run, null);
  assert.equal(s.rift.best, RF.RIFT.maxFloor);
});

test('rebirth: 기억의 가속 multiplies EXP only below the previous peak level', () => {
  const s = tier1('mage', 100);
  RB.doRebirth(s, T0);
  assert.equal(playerStats(s).rebirth.exp, RB.REBIRTH.catchUpExp);
  s.player.level = 100;
  assert.equal(playerStats(s).rebirth.exp, 1);
});

test('farm verification: a very fast hero still verifies once 60 s of kills accumulate', async () => {
  const { FarmVerifier } = await import('../src/core/offline.js');
  const v = new FarmVerifier();
  let vf = null;
  for (let t = 0; t < 70000 && !vf; t += 500) vf = v.onKill('meadow', 10, 9, t);   // 2 kills/s → 30 kills in 15 s
  assert.ok(vf, 'verified');
  assert.ok(vf.windowSec >= 60);
  assert.ok(Math.abs(vf.killsPerSec - 2) < 0.1);
});
