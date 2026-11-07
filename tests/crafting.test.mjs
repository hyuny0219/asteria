import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as CR from '../src/core/crafting.js';
import { playerStats } from '../src/core/stats.js';
import { makeItem } from '../src/core/items.js';
import * as eco from '../src/core/economy.js';
import { makeRng } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 9, 3, 0, 0);

test('보옥: sockets by rarity, socket/unsocket/replace, stats apply only when equipped', () => {
  const s = newGame(T0); const rng = makeRng(1);
  const it = makeItem(s, { slot: 'weapon', rarity: 'legendary', level: 30, rng });
  s.inventory.push(it);
  assert.equal(CR.socketCount(it), 2);
  assert.equal(CR.socketCount({ rarity: 'rare' }), 0);
  CR.addJewel(s, 'ruby', 3, 2);
  const before = playerStats(s, { now: T0 }).atk;
  assert.equal(CR.socket(s, it.id, 0, 'ruby', 3).ok, true);
  assert.equal(CR.socket(s, it.id, 2, 'ruby', 3).reason, 'socket');
  assert.equal(playerStats(s, { now: T0 }).atk, before);          // not equipped yet
  eco.equip(s, it.id);
  const withJ = playerStats(s, { now: T0 }).atk;
  CR.unsocket(s, it.id, 0);
  const without = playerStats(s, { now: T0 }).atk;
  assert.ok(withJ > without);
  assert.equal(CR.jewelCount(s, 'ruby', 3), 2);
  CR.socket(s, it.id, 0, 'ruby', 3); CR.addJewel(s, 'topaz', 1);
  const r = CR.socket(s, it.id, 0, 'topaz', 1);
  assert.deepEqual(r.replaced, { t: 'ruby', lv: 3 });
  assert.equal(CR.jewelCount(s, 'ruby', 3), 2);
});

test('보옥: 3 → next level, max 5; dismantle returns socketed 보옥', () => {
  const s = newGame(T0); const rng = makeRng(2);
  CR.addJewel(s, 'emerald', 1, 7);
  assert.equal(CR.combine(s, 'emerald', 1).ok, true);
  assert.equal(CR.combine(s, 'emerald', 1).ok, true);
  assert.equal(CR.combine(s, 'emerald', 1).reason, 'count');
  assert.equal(CR.jewelCount(s, 'emerald', 2), 2); assert.equal(CR.jewelCount(s, 'emerald', 1), 1);
  assert.equal(CR.combine(s, 'emerald', 5).reason, 'level');
  const it = makeItem(s, { slot: 'armor', rarity: 'mythic', level: 30, rng });
  s.inventory.push(it);
  CR.socket(s, it.id, 2, 'emerald', 2);
  const d = eco.dismantle(s, [it.id]);
  assert.equal(d.ok, true); assert.equal(d.quote.jewelsReturned, 1);
  assert.equal(CR.jewelCount(s, 'emerald', 2), 2);
});

test('마부: per slot, costs ore + 각성석, re-roll replaces, survives item swaps', () => {
  const s = newGame(T0); const rng = makeRng(3);
  assert.equal(CR.enchantRoll(s, 'weapon', rng).reason, 'locked');
  s.progression.bossCleared.B03 = true;
  assert.equal(CR.enchantRoll(s, 'weapon', rng).reason, 'ore');
  s.wallet.ore = 1000; s.wallet.awakenStone = 2;
  const a = CR.enchantRoll(s, 'weapon', rng);
  assert.equal(a.ok, true); assert.equal(s.wallet.ore, 850); assert.equal(s.wallet.awakenStone, 1);
  const o = CR.ENCHANT.options.find((x) => x.stat === a.enchant.stat);
  assert.ok(a.enchant.value >= o.min && a.enchant.value <= o.max);
  const b = CR.enchantRoll(s, 'weapon', rng);
  assert.deepEqual(b.prev, a.enchant);
  assert.equal(CR.enchantRoll(s, 'weapon', rng).reason, 'awakenStone');
  assert.ok(Object.values(CR.enchantBonus(s)).some((v) => v > 0));   // slot-based: no item needed
});

test('버프 음식: costs 재료, 30 min, one at a time', () => {
  const s = newGame(T0);
  assert.equal(CR.cook(s, 'feast', T0).reason, 'herb');
  s.craft.herb = 10; s.craft.meat = 10;
  const base = playerStats(s, { now: T0 }).atk;
  assert.equal(CR.cook(s, 'feast', T0).ok, true);
  assert.ok(playerStats(s, { now: T0 + 60000 }).atk > base);
  assert.equal(playerStats(s, { now: T0 + 31 * 60000 }).atk, base);
  const r = CR.cook(s, 'soup', T0 + 60000);
  assert.equal(r.replaced, 'feast');
  assert.equal(playerStats(s, { now: T0 + 120000 }).expPct, 0.2);
});

test('schema 8 fill: old craft block gets jewels / enchant / food', () => {
  const s = newGame(T0); s.craft = { herb: 2, meat: 1 };
  const m = migrate(s);
  assert.deepEqual(m.craft.jewels, {}); assert.deepEqual(m.craft.enchant, {}); assert.equal(m.craft.herb, 2);
});

test('보옥 sources: 쐐기 시간 내 · 월드 보스 B+ · 보옥 원정', async () => {
  const MP = await import('../src/core/mplus.js');
  const WBm = await import('../src/core/worldboss.js');
  const EX = await import('../src/core/expedition.js');
  const s = newGame(T0); s.progression.bossCleared.B03 = true; s.player.level = 40;
  const rng = makeRng(4);
  MP.beginRun(s, 'quarry', 'j1', T0);
  const r = MP.finishRun(s, 'j1', { win: true, timeSec: 60 }, T0, rng);
  assert.equal(r.jewels.length, 1);
  const w = WBm.finishWorldBoss(s, 'wbj', 800, 1000, rng);
  assert.equal(w.grade, 'S'); assert.equal(w.jewels.length, 2); assert.equal(w.jewels[0].lv, 2);
  assert.equal(WBm.finishWorldBoss(s, 'wbj2', 10, 1000, rng).jewels.length, 0);
  s.pets.owned.P01 = { level: 30, stars: 3, shards: 0 };
  s.expedition = EX.defaultExpedition(); EX.refreshExpedition(s, T0);
  s.expedition.board[0] = { ...s.expedition.board[0], type: 'jewel', amount: 1, hours: 8 };
  EX.send(s, s.expedition.board[0].id, 'P01', T0);
  const c = EX.claim(s, 0, T0 + 8 * 3600000);
  assert.ok(c.jewels.length >= 1); assert.equal(c.jewels[0].lv, 2);
  const total = Object.values(s.craft.jewels).reduce((a, b) => a + b, 0);
  assert.equal(total, 1 + 2 + c.jewels.length);
});
