// v7: enhancement belongs to the equip slot (schema 6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate, validate, SCHEMA_VERSION } from '../src/core/state.js';
import { makeItem, itemStats, itemBaseStats, enhanceCost, enhanceChance } from '../src/core/items.js';
import { addItems, equip, enhance, enhanceQuote } from '../src/core/economy.js';
import { playerStats } from '../src/core/stats.js';
import { makeRng } from '../src/core/util.js';
import { BALANCE } from '../src/data/balance.js';

const T0 = Date.UTC(2026, 10, 1, 3);
const EQ = BALANCE.equipment;

test('slot enhance math: item base × (1 + 5% × slot level); cost/chance by level only', () => {
  const s = newGame(T0);
  const it = makeItem(s, { slot: 'weapon', rarity: 'epic', level: 30, rng: makeRng(4) });
  const base = itemBaseStats(it);
  assert.equal(itemStats(it).atk, Math.floor(base.atk));
  assert.equal(itemStats(it, 10).atk, Math.floor(base.atk * 1.5));
  assert.equal(enhanceCost(0), Math.floor(EQ.enhanceCost.base * EQ.enhanceCost.slotMul));
  assert.ok(enhanceCost(10) > enhanceCost(9));
  assert.equal(enhanceChance(4), 1); assert.ok(enhanceChance(5) < 1); assert.equal(enhanceChance(15), 0);
});

test('slot level survives item swaps and applies to whichever item is worn', () => {
  const s = newGame(T0); const rng = makeRng(5);
  const a = makeItem(s, { slot: 'weapon', rarity: 'rare', level: 20, rng });
  const b = makeItem(s, { slot: 'weapon', rarity: 'epic', level: 20, rng });
  addItems(s, [a, b]); equip(s, a.id);
  s.wallet.ore = 1e9;
  for (let i = 0; i < 5; i++) assert.ok(enhance(s, 'weapon', () => 0).success);
  const atkA = playerStats(s).atk;
  equip(s, b.id, 'weapon');
  assert.equal(s.slotEnhance.weapon, 5);
  const bonusB = itemStats(b, 5).atk - itemStats(b, 0).atk;
  assert.ok(bonusB > 0);
  assert.ok(playerStats(s).atk > atkA);
  assert.ok(s.slotEnhanceOre.weapon > 0);
});

test('rings: ring1 and ring2 have separate levels', () => {
  const s = newGame(T0);
  s.wallet.ore = 1e9;
  enhance(s, 'ring1', () => 0); enhance(s, 'ring1', () => 0); enhance(s, 'ring2', () => 0);
  assert.equal(s.slotEnhance.ring1, 2); assert.equal(s.slotEnhance.ring2, 1);
  assert.equal(enhanceQuote(s, 'ring').ok, false);
});

test('schema 5 → 6: slot = worn item level, unworn ore refunded 100%, notice once', () => {
  const s = newGame(T0); const rng = makeRng(6);
  const w = makeItem(s, { slot: 'weapon', rarity: 'rare', level: 10, rng });
  const r1 = makeItem(s, { slot: 'ring', rarity: 'rare', level: 10, rng });
  const r2 = makeItem(s, { slot: 'ring', rarity: 'rare', level: 10, rng });
  const spare = makeItem(s, { slot: 'weapon', rarity: 'epic', level: 10, rng });
  const over = makeItem(s, { slot: 'helmet', rarity: 'rare', level: 10, rng });
  Object.assign(w, { enhance: 7, oreInvested: 300 });
  Object.assign(r1, { enhance: 3, oreInvested: 40 });
  Object.assign(r2, { enhance: 12, oreInvested: 900 });
  Object.assign(spare, { enhance: 9, oreInvested: 500 });
  Object.assign(over, { enhance: 2, oreInvested: 15 });
  s.inventory.push(w, r1, r2, spare); s.overflow.push(over);
  s.equipped.weapon = w.id; s.equipped.ring1 = r1.id; s.equipped.ring2 = r2.id;
  s.schemaVersion = 5; delete s.slotEnhance; delete s.slotEnhanceOre; delete s.notices;
  s.wallet.ore = 10;
  const m = migrate(s);
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(validate(m), []);
  assert.equal(m.slotEnhance.weapon, 7); assert.equal(m.slotEnhance.ring1, 3); assert.equal(m.slotEnhance.ring2, 12);
  assert.equal(m.slotEnhance.helmet, 0);
  assert.equal(m.wallet.ore, 10 + 500 + 15);
  for (const it of [...m.inventory, ...m.overflow]) { assert.equal(it.enhance, undefined); assert.equal(it.oreInvested, undefined); }
  assert.deepEqual(m.notices.slotEnhance, { refund: 515, refunded: 2, levels: m.slotEnhance });
  // migrating again is a no-op (already v6)
  const ore = m.wallet.ore; migrate(m); assert.equal(m.wallet.ore, ore);
});

test('schema 5 → 6 with no enhancement: no notice', () => {
  const s = newGame(T0);
  s.schemaVersion = 5; delete s.slotEnhance; delete s.notices;
  const m = migrate(s);
  assert.equal(m.notices.slotEnhance, undefined);
  assert.equal(m.slotEnhance.weapon, 0);
});
