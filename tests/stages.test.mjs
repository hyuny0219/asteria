// v7: 스테이지 지도 — first clear once, stars, auto-advance, migration (schema 7)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate, validate, SCHEMA_VERSION } from '../src/core/state.js';
import * as st from '../src/core/stages.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { BALANCE } from '../src/data/balance.js';

const T0 = Date.UTC(2026, 10, 1, 3);

test('stars: 1★ clear, 2★ no death, 3★ no death under time target (boss target separate)', () => {
  assert.equal(st.starsFor({ deaths: 1, timeSec: 5 }, 3), 1);
  assert.equal(st.starsFor({ deaths: 0, timeSec: BALANCE.stages.starSec + 1 }, 3), 2);
  assert.equal(st.starsFor({ deaths: 0, timeSec: BALANCE.stages.starSec }, 3), 3);
  assert.equal(st.starsFor({ deaths: 0, timeSec: BALANCE.stages.bossStarSec }, 'boss'), 3);
  assert.equal(st.stageLabel('desert', 4), '2-4');
  assert.equal(st.stageLabel('void', 'boss'), '10-보스');
});

test('first-clear reward is granted once; stars keep the best', () => {
  const s = newGame(T0);
  const g0 = s.wallet.gem, o0 = s.wallet.ore;
  const r1 = st.recordClear(s, 'meadow', 5, { deaths: 1, timeSec: 99 });
  assert.ok(r1.first); assert.equal(r1.stars, 1);
  const rw = st.stageReward('meadow', 5);
  assert.equal(s.wallet.gem, g0 + rw.gem); assert.equal(s.wallet.ore, o0 + rw.ore);
  const r2 = st.recordClear(s, 'meadow', 5, { deaths: 0, timeSec: 10 });
  assert.equal(r2.first, false); assert.equal(r2.reward, null); assert.ok(r2.improved);
  assert.equal(s.wallet.gem, g0 + rw.gem);
  assert.equal(s.stages.stars['meadow-5'], 3);
  const r3 = st.recordClear(s, 'meadow', 5, { deaths: 2, timeSec: 10 });
  assert.equal(r3.improved, false); assert.equal(s.stages.stars['meadow-5'], 3);
  // boss nodes give more than stages
  assert.ok(st.stageReward('meadow', 'boss').gem > st.stageReward('meadow', 10).gem);
  assert.ok(st.stageReward('void', 3).ore > st.stageReward('meadow', 3).ore);
  assert.equal(st.recordClear(s, 'meadow', 11, {}).ok, false);
});

test('node status: cleared below max wave, current at max, boss after W10, locked regions', () => {
  const s = newGame(T0);
  s.progression.maxWave.meadow = 4;
  assert.equal(st.nodeStatus(s, 'meadow', 3, true), 'cleared');
  assert.equal(st.nodeStatus(s, 'meadow', 4, true), 'current');
  assert.equal(st.nodeStatus(s, 'meadow', 5, true), 'locked');
  assert.equal(st.nodeStatus(s, 'meadow', 'boss', true), 'locked');
  s.progression.maxWave.meadow = 10;
  assert.equal(st.nodeStatus(s, 'meadow', 10, true), 'current');
  assert.equal(st.nodeStatus(s, 'meadow', 'boss', true), 'current');
  s.stages.stars['meadow-10'] = 1;
  assert.equal(st.nodeStatus(s, 'meadow', 10, true), 'cleared');
  s.progression.bossCleared.B01 = true;
  assert.equal(st.nodeStatus(s, 'meadow', 'boss', true), 'cleared');
  assert.equal(st.nodeStatus(s, 'desert', 1, false), 'locked');
});

test('schema 6 → 7: progress becomes 1★ cleared with reward marked received (no windfall)', () => {
  const s = newGame(T0);
  s.progression.maxWave = { meadow: 10, desert: 6 };
  s.progression.bossCleared = { B01: true };
  s.progression.autoAdvance = false;
  s.schemaVersion = 6; delete s.stages;
  const gem = s.wallet.gem;
  const m = migrate(s);
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(validate(m), []);
  assert.equal(m.stages.stars['meadow-10'], 1); assert.equal(m.stages.stars['meadow-boss'], 1);
  assert.equal(m.stages.stars['desert-5'], 1); assert.equal(m.stages.stars['desert-6'], undefined);
  assert.ok(m.stages.claimed['desert-5']);
  assert.equal(m.stages.auto, false);
  assert.equal(m.wallet.gem, gem);
});

test('game: farming clears stages in order, auto-advance on, reward once, stars saved', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  const cleared = [];
  g.on('stageClear', (r) => cleared.push(r));
  for (let i = 0; i < 200 && g.state.progression.maxWave.meadow < 4; i++) { clock += 1000; g.advance(1000); await new Promise((r) => setImmediate(r)); }
  for (let i = 0; i < 20; i++) { g.advance(0); await new Promise((r) => setImmediate(r)); }
  assert.ok(g.state.progression.maxWave.meadow >= 4);
  for (const n of [1, 2, 3]) assert.ok(g.state.stages.stars[`meadow-${n}`] >= 1, `meadow-${n}`);
  assert.ok(g.state.stages.claimed['meadow-1']);
  assert.ok(cleared.some((r) => r.key === 'meadow-1' && r.first));
  // replaying a cleared stage never pays again
  const gem = g.state.wallet.gem;
  const r = await g.transact('qa', (s) => st.recordClear(s, 'meadow', 1, { deaths: 0, timeSec: 1 }));
  assert.equal(r.first, false); assert.equal(g.state.wallet.gem, gem);
  // auto-advance toggle
  await g.setStageAuto(false);
  assert.equal(g.state.stages.auto, false); assert.equal(g.state.progression.autoAdvance, false);
  const w = g.state.progression.wave;
  for (let i = 0; i < 60; i++) { clock += 1000; g.advance(1000); await new Promise((r) => setImmediate(r)); }
  assert.equal(g.state.progression.wave, w);
  await g.setStageAuto(true);
  assert.equal(g.state.progression.autoAdvance, true);
  // saved
  const g2 = new Game({ saver, now: () => clock });
  await g2.load();
  assert.ok(g2.state.stages.stars['meadow-1'] >= 1);
});
