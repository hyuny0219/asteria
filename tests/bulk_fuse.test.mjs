import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as G from '../src/core/gearplus.js';
import { makeItem } from '../src/core/items.js';
import { makeRng } from '../src/core/util.js';
import { RARITY_UP } from '../src/data/gearplus.js';

const T0 = Date.UTC(2026, 10, 9, 3);
function bag(spec, ore = 1e6) {
  const s = newGame(T0);
  s.inventory = []; s.wallet.ore = ore;
  const rng = makeRng(7);
  for (const [slot, rarity, n, level = 10] of spec) for (let i = 0; i < n; i++) s.inventory.push(makeItem(s, { slot, rarity, level: level + i, rng }));
  return s;
}

test('9 common helmets cascade to 1 rare (target rare), 8 consumed', () => {
  const s = bag([['helmet', 'common', 9]]);
  const q = G.bulkRarityUpPlan(s, 'rare');
  assert.equal(q.steps.length, 4);
  assert.deepEqual(q.result, { rare: 1 });
  assert.equal(q.consumed, 8);
  assert.equal(q.cost.ore, 3 * RARITY_UP.ore.uncommon + RARITY_UP.ore.rare);
  const r = G.bulkRarityUp(s, 'rare', null, makeRng(1));
  assert.equal(r.ok, true);
  assert.equal(s.inventory.length, 1);
  assert.equal(s.inventory[0].rarity, 'rare');
  assert.equal(s.inventory[0].level, 18);   // 가장 높은 레벨이 이어짐
  assert.equal(s.wallet.ore, 1e6 - q.cost.ore);
});

test('target caps the result: target uncommon leaves uncommons alone', () => {
  const s = bag([['boots', 'common', 9], ['boots', 'uncommon', 3]]);
  const q = G.bulkRarityUpPlan(s, 'uncommon');
  assert.equal(q.steps.length, 3);
  assert.ok(q.steps.every((st) => st.to === 'uncommon'));
});

test('locked and equipped items are never used; slots never mix', () => {
  const s = bag([['weapon', 'common', 3], ['armor', 'common', 2], ['gloves', 'common', 3]]);
  s.inventory.find((i) => i.slot === 'weapon').locked = true;
  const g = s.inventory.filter((i) => i.slot === 'gloves');
  s.equipped.gloves = g[0].id;   // v18.3: 프리셋 대신 착용으로 보호 확인
  const q = G.bulkRarityUpPlan(s, 'epic');
  assert.equal(q.steps.length, 0);
  assert.equal(q.ok, false);
  s.equipped.weapon = null;
});

test('stops when ore runs out; preview and result match', () => {
  const s = bag([['ring', 'common', 9]], RARITY_UP.ore.uncommon * 2 + 5);
  const q = G.bulkRarityUpPlan(s, 'rare');
  assert.equal(q.steps.length, 2);
  assert.equal(q.stopped, 'ore');
  const r = G.bulkRarityUp(s, 'rare', null, makeRng(2));
  assert.equal(r.count, 2);
  assert.equal(s.inventory.length, 5);
  assert.equal(s.wallet.ore, 5);
});

test('slot filter only touches that slot; best item is kept as base', () => {
  const s = bag([['helmet', 'common', 3], ['armor', 'common', 3]]);
  const best = s.inventory.filter((i) => i.slot === 'armor').sort((a, b) => b.level - a.level)[0];
  const r = G.bulkRarityUp(s, 'epic', 'armor', makeRng(3));
  assert.equal(r.count, 1);
  assert.equal(s.inventory.filter((i) => i.slot === 'helmet').length, 3);
  assert.ok(s.inventory.find((i) => i.id === best.id && i.rarity === 'uncommon'));
});
