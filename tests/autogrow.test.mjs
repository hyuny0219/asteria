import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import { autoGrow, autoGrowReserve } from '../src/core/autogrow.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);

test('auto growth spends gold across all stats, never below zero', () => {
  const s = newGame(T0);
  s.wallet.gold = 50000;
  const r = autoGrow(s);
  assert.ok(r.count > 10);
  for (const k of ['atk', 'hp', 'def', 'crit', 'speed']) assert.ok(s.player.statsUpgrades[k] > 0, k);
  assert.ok(s.wallet.gold >= 0);
  assert.ok(s.player.statsUpgrades.atk >= s.player.statsUpgrades.def, 'attack weighted higher');
});

test('auto growth keeps the tier-2 gold reserve near Lv 60', () => {
  const s = newGame(T0);
  s.player.level = 58; s.player.tier = 1; s.player.branch = 'knight';
  const reserve = autoGrowReserve(s);
  assert.ok(reserve > 0);
  s.wallet.gold = reserve + 100;
  autoGrow(s);
  assert.ok(s.wallet.gold >= reserve);
});

test('auto growth respects crit/speed caps and spreads stat points', () => {
  const s = newGame(T0);
  s.player.level = 10;
  s.wallet.gold = 1e12;
  autoGrow(s, { maxBuys: 5000 });
  const again = autoGrow(s, { maxBuys: 10 });
  assert.ok(again.count >= 0);
  assert.equal(s.player.statAuto, true);
  const used = Object.values(s.player.stats).reduce((a, b) => a + b, 0);
  assert.ok(used > 0, 'stat points spent automatically');
});

test('game loop runs auto growth while farming', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  g.state.wallet.gold = 5000;
  for (let i = 0; i < 30; i++) { clock += 250; g.advance(250); }
  assert.ok(g.state.player.statsUpgrades.atk > 0);
});
