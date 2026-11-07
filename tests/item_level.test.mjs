import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as G from '../src/core/gearplus.js';

const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);
const setup = (lv = 40, itLv = 10, ore = 100000, gold = 1e9) => {
  const s = newGame(T0);
  s.player.level = lv; s.wallet.ore = ore; s.wallet.gold = gold;
  s.inventory.push({ id: 'x1', slot: 'helmet', rarity: 'epic', level: itLv, main: 'hp', look: 'I71', name: 't', options: [] });
  return s;
};

test('레벨 맞추기: +N charges the summed step costs and never passes the hero level', () => {
  const s = setup();
  const q = G.levelUpQuote(s, s.inventory[0], 10);
  let ore = 0, gold = 0;
  for (let L = 10; L < 20; L++) { const c = G.levelStepCost(s.inventory[0], L); ore += c.ore; gold += c.gold; }
  assert.deepEqual([q.to, q.ore, q.gold], [20, ore, gold]);
  const r = G.levelUpItem(s, 'x1', 'max');
  assert.equal(r.ok, true);
  assert.equal(s.inventory[0].level, 40);
  assert.equal(G.levelUpItem(s, 'x1', 1).reason, 'item-cap');
});

test('레벨 맞추기 max stops at what the wallet can pay; nothing changes when broke', () => {
  const s = setup(60, 10, 30, 1e9);
  const r = G.levelUpItem(s, 'x1', 'max');
  assert.equal(r.ok, true);
  assert.ok(s.inventory[0].level > 10 && s.inventory[0].level < 60);
  assert.ok(s.wallet.ore >= 0);
  const s2 = setup(60, 10, 0, 0);
  assert.equal(G.levelUpItem(s2, 'x1', 1).ok, false);
  assert.equal(s2.inventory[0].level, 10);
});
