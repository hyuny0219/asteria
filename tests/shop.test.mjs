import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame } from '../src/core/state.js';
import { changeClass, classChangeCost, buy, shopStatus } from '../src/core/shop.js';
import { CLASS_SKILLS } from '../src/data/content.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
const DAY = 86400000;

test('class change: first free, then needs a ticket; keeps level/gear/tier', () => {
  const s = newGame(T0);
  s.player.level = 65; s.player.tier = 2; s.player.branch = 'knight';
  s.inventory.push({ id: 'x' }); s.equipped.weapon = 'x';
  assert.equal(classChangeCost(s).free, true);
  const r = changeClass(s, 'mage', 'warlock');
  assert.equal(r.ok, true);
  assert.equal(s.player.cls, 'mage');
  assert.equal(s.player.branch, 'warlock');
  assert.equal(s.player.tier, 2);
  assert.equal(s.player.level, 65);
  assert.equal(s.equipped.weapon, 'x');
  assert.deepEqual(s.skills.equipped.slice(0, 3), CLASS_SKILLS.mage.base);
  assert.ok(s.skills.equipped[3] && s.skills.equipped[4], 'tier skills of the new branch');
  // second change needs a ticket
  assert.equal(changeClass(s, 'archer').reason, 'class-ticket');
  s.wallet.classTicket = 1;
  assert.equal(changeClass(s, 'archer', 'knight').reason, 'branch');
  assert.equal(changeClass(s, 'archer').ok, true);
  assert.equal(s.wallet.classTicket, 0);
  assert.equal(changeClass(s, 'archer').reason, 'same-class');
});

test('shop: gem price, period limits reset by KST day/week, no negative wallet', () => {
  const s = newGame(T0);
  assert.equal(buy(s, 'classTicket', T0).reason, 'gem');
  s.wallet.gem = 10000;
  assert.equal(buy(s, 'classTicket', T0).ok, true);
  assert.equal(s.wallet.classTicket, 1);
  assert.equal(s.wallet.gem, 5000);
  s.wallet.gold = 1e9;
  assert.equal(buy(s, 'tickets3', T0).ok, true);
  assert.equal(buy(s, 'tickets3', T0).reason, 'limit');
  assert.equal(shopStatus(s, 'tickets3', T0 + DAY).left, 1);
  assert.equal(buy(s, 'tickets3', T0 + DAY).ok, true);
});

test('game: class change is a transaction (failed save changes nothing)', async () => {
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => T0 });
  await g.load();
  saver.failNext = 1;
  const bad = await g.changeClass('rogue');
  assert.equal(bad.ok, false);
  assert.equal(g.state.player.cls, 'warrior');
  assert.equal(g.state.player.classChanges, 0);
  const ok = await g.changeClass('rogue');
  assert.equal(ok.ok, true);
  assert.equal(g.state.player.cls, 'rogue');
});
