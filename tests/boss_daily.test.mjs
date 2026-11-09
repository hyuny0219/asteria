import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as BD from '../src/core/bossdaily.js';

const T0 = Date.UTC(2026, 10, 9, 3);   // KST 12:00
test('repeat boss kills: 3 per KST day, first clears never count', () => {
  const s = newGame(T0);
  assert.equal(BD.isRepeat(s, 'B01'), false);
  s.progression.bossCleared.B01 = true;
  assert.equal(BD.isRepeat(s, 'B01'), true);
  assert.equal(BD.left(s, T0), 3);
  assert.ok(BD.consume(s, T0) && BD.consume(s, T0) && BD.consume(s, T0));
  assert.equal(BD.consume(s, T0), false);
  assert.equal(BD.left(s, T0), 0);
  // KST midnight resets
  const next = Date.UTC(2026, 10, 9, 15, 1);
  assert.equal(BD.left(s, next), 3);
});
test('old saves get the field; tampered counts are clamped', () => {
  const s = newGame(T0); delete s.bossDaily;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(m.bossDaily, { day: null, used: 0 });
  m.bossDaily = { day: null, used: -9 };
  assert.equal(BD.left(m, T0), 3);
  m.bossDaily.used = 99; m.bossDaily.day = BD.refresh(m, T0).day;
  m.bossDaily.used = 99;
  assert.equal(BD.left(m, T0), 0);
});

test('game: 4th repeat win of the day is refused at the door; first clears do not count', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  await g.transact('t', (s) => { s.player.level = 60; s.player.statsUpgrades.atk = 12000; s.player.statsUpgrades.hp = 8000; s.progression.maxWave.meadow = 10; return { ok: true }; });
  const fight = async () => { assert.ok(g.startBoss('B01').ok); for (let i = 0; i < 4000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); } await new Promise((r) => setTimeout(r, 10)); const r = g.result; g.returnToFarm(); return r; };
  const first = await fight();
  assert.equal(first.win, true); assert.equal(first.first, true);
  assert.equal(BD.left(g.state, clock), 3);   // 첫 처치는 차감 없음
  for (let k = 2; k >= 0; k--) { const r = await fight(); assert.equal(r.win, true); assert.equal(r.dailyLeft, k); assert.ok(r.items.length > 0); }
  const c = g.canChallengeBoss('B01');
  assert.equal(c.ok, false); assert.equal(c.reason, 'bossDaily');
  assert.equal(g.startBoss('B01').reason, 'bossDaily');
});
