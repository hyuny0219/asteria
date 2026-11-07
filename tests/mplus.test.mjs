import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as MP from '../src/core/mplus.js';
import { Battle } from '../src/core/combat.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { makeRng } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 9, 3, 0, 0);   // Monday 12:00 KST
const open = (s) => { s.progression.bossCleared.B03 = true; s.player.level = 40; return s; };

test('쐐기: key moves +1/+2/+3 by time left, 0 overtime, -1 on fail (min 2)', () => {
  assert.equal(MP.keyDelta(80, true), 1);
  assert.equal(MP.keyDelta(MP.MPLUS.timeSec * 0.55, true), 2);
  assert.equal(MP.keyDelta(MP.MPLUS.timeSec * 0.35, true), 3);
  assert.equal(MP.keyDelta(200, false), 0);
  const s = open(newGame(T0));
  const rng = makeRng(3);
  assert.equal(MP.beginRun(s, 'quarry', 'r1', T0).ok, true);
  const r1 = MP.finishRun(s, 'r1', { win: true, timeSec: 30 }, T0, rng);
  assert.equal(r1.result, 'timed'); assert.equal(s.mplus.key, 5); assert.ok(r1.reward.gem > 0); assert.ok(r1.items.length >= 1);
  assert.equal(s.mplus.weekBest, 2); assert.equal(s.mplus.bestTimed.quarry, 2);
  MP.beginRun(s, 'gold', 'r2', T0);
  const r2 = MP.finishRun(s, 'r2', { win: true, timeSec: 120 }, T0, rng);
  assert.equal(r2.result, 'overtime'); assert.equal(s.mplus.key, 5); assert.equal(s.mplus.best.gold, 5); assert.equal(s.mplus.bestTimed.gold, 0);
  MP.beginRun(s, 'books', 'r3', T0);
  const r3 = MP.finishRun(s, 'r3', { win: false, timeSec: 50 }, T0, rng);
  assert.equal(r3.result, 'fail'); assert.equal(s.mplus.key, 4);
  assert.equal(MP.finishRun(s, 'r3', { win: true, timeSec: 10 }, T0, rng).ok, false);   // no double result
  s.mplus.key = 2; MP.beginRun(s, 'books', 'r4', T0); MP.finishRun(s, 'r4', { win: false, timeSec: 5 }, T0, rng);
  assert.equal(s.mplus.key, 2);
});

test('쐐기: 3 rewarded runs a day, crash refunds the try, weekly vault next week', () => {
  const s = open(newGame(T0));
  const rng = makeRng(4);
  for (let i = 0; i < 3; i++) { MP.beginRun(s, 'quarry', 'a' + i, T0); MP.finishRun(s, 'a' + i, { win: true, timeSec: 85 }, T0, rng); }
  assert.equal(MP.rewardedLeft(s, T0), 0);
  assert.equal(MP.beginRun(s, 'quarry', 'a4', T0).reason, 'tries');   // 4th run of the day is blocked
  // crash
  const s2 = open(newGame(T0));
  MP.beginRun(s2, 'gold', 'c1', T0);
  assert.equal(MP.rewardedLeft(s2, T0), 2);
  assert.deepEqual(MP.recoverRun(s2), { dungeon: 'gold', key: 2 });
  assert.equal(MP.rewardedLeft(s2, T0), 3); assert.equal(s2.mplus.run, null);
  // vault
  const best = s.mplus.weekBest;
  assert.ok(best >= 2);
  assert.equal(MP.claimVault(s, T0).ok, false);
  const next = T0 + 7 * 86400000;
  const v = MP.claimVault(s, next);
  assert.equal(v.ok, true); assert.equal(v.best, best); assert.deepEqual(v.reward, MP.vaultReward(best));
  assert.equal(MP.claimVault(s, next).ok, false);
});

test('쐐기: two weekly affixes (one of 강화/폭군), change on Monday', () => {
  const a = MP.affixesFor(T0), b = MP.affixesFor(T0 + 7 * 86400000);
  assert.equal(a.length, 2);
  assert.ok(['fortified', 'tyrannical'].includes(a[0]));
  assert.notDeepEqual(a, b);
  assert.deepEqual(MP.affixesFor(T0 + 3 * 86400000), a);
});

test('쐐기 전투: trash then the dungeon boss; boss kill ends it', () => {
  const s = open(newGame(T0));
  const g = new Game({ saver: new MemorySaver(), now: () => T0 });
  g.state = s; g.rng = makeRng(1);
  s.player.level = 30; s.player.statsUpgrades.atk = 900; s.player.statsUpgrades.hp = 900; s.player.statsUpgrades.def = 300;
  const cfg = MP.runConfig(s, 'quarry', 2, ['fortified', 'quaking']);
  const b = new Battle({ kind: 'mplus', rng: makeRng(9), hero: g.sessionHero(), mplus: cfg });
  let bossEv = null;
  while (!b.over && b.t < 300000) { b.step(); for (const e of b.drainEvents()) if (e.type === 'mplusBoss') bossEv = e; }
  assert.equal(b.over, 'victory');
  assert.ok(bossEv, 'boss spawned');
  assert.equal(b.kills, cfg.trash + 1);
});

test('schema 7 save migrates to 8 with a fresh keystone', () => {
  const s = newGame(T0);
  delete s.mplus; s.schemaVersion = 7;
  const m = migrate(s);
  assert.equal(m.schemaVersion, 8);
  assert.equal(m.mplus.key, 2);
});
