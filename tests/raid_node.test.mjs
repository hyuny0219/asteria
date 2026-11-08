import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as ST from '../src/core/stages.js';

test('void boss node clears through the weekly raid', () => {
  const s = newGame(0);
  s.progression.maxWave.void = 10;
  s.stages.stars['void-10'] = 1;
  assert.equal(ST.nodeStatus(s, 'void', 'boss', true), 'current');
  const gem0 = s.wallet.gem;
  const a = ST.recordRaidClear(s, 'C');
  assert.ok(a.ok && a.first && a.best === 1);
  assert.ok(s.wallet.gem > gem0);
  assert.equal(ST.nodeStatus(s, 'void', 'boss', true), 'cleared');
  const g1 = s.wallet.gem;
  const b = ST.recordRaidClear(s, 'S');
  assert.ok(b.improved && b.best === 3 && !b.first);
  assert.equal(s.wallet.gem, g1);
  assert.equal(ST.raidStars('B'), 2);
});
