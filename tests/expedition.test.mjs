import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as EX from '../src/core/expedition.js';

const T0 = Date.UTC(2026, 10, 9, 3, 0, 0);
const withPets = () => { const s = newGame(T0); s.pets.owned.P01 = { level: 10, stars: 2, shards: 0 }; s.pets.owned.P02 = { level: 1, stars: 1, shards: 0 }; return s; };

test('원정: locked without a companion; board of 5, same on reload, new next day', () => {
  const s0 = newGame(T0);
  assert.equal(EX.expeditionOpen(s0), false);
  const s = withPets();
  const e = EX.refreshExpedition(s, T0);
  assert.equal(e.board.length, 5);
  assert.deepEqual(e.board.map((x) => x.hours), [2, 4, 8, 4, 2]);
  const again = JSON.parse(JSON.stringify(e.board));
  s.expedition.day = null; EX.refreshExpedition(s, T0);
  assert.deepEqual(s.expedition.board, again);
  EX.refreshExpedition(s, T0 + 86400000);
  assert.notDeepEqual(s.expedition.board.map((x) => x.id), again.map((x) => x.id));
});

test('원정: send, busy pet and slot rules, real-time claim, no re-roll', () => {
  const s = withPets();
  const e = EX.refreshExpedition(s, T0);
  const [a, b, c, d] = e.board;
  assert.equal(EX.send(s, a.id, 'P01', T0).ok, true);
  assert.equal(EX.send(s, b.id, 'P01', T0).reason, 'pet-busy');
  assert.equal(EX.send(s, b.id, 'P02', T0).ok, true);
  assert.equal(EX.claim(s, 0, T0 + 1000).reason, 'running');
  const end = T0 + a.hours * 3600000;
  const snap = JSON.parse(JSON.stringify(s));
  const r = EX.claim(s, 0, end);
  assert.equal(r.ok, true);
  assert.ok(['success', 'great', 'fail'].includes(r.result));
  const r2 = EX.claim(snap, 0, end + 99999);
  assert.deepEqual([r2.result, r2.amount], [r.result, r.amount]);   // seeded: reloading does not change the outcome
  assert.equal(s.expedition.slots[0], null);
  // three slots max (P01 is free again)
  assert.equal(EX.send(s, c.id, 'P01', end).ok, true);
  s.pets.owned.P03 = { level: 1, stars: 1, shards: 0 };
  s.pets.owned.P04 = { level: 1, stars: 1, shards: 0 };
  assert.equal(EX.send(s, d.id, 'P03', end).ok, true);
  assert.equal(EX.send(s, s.expedition.board[0].id, 'P04', end).reason, 'slots');
});

test('원정: stronger companion → higher chance; rewards go to the right place', () => {
  const s = withPets();
  const exp = { req: 14 };
  assert.ok(EX.successChance(s, 'P01', exp).success > EX.successChance(s, 'P02', exp).success);
  EX.grant(s, 'herb', 3); EX.grant(s, 'food', 2); EX.grant(s, 'eqTicket', 1);
  assert.equal(s.craft.herb, 3); assert.equal(s.pets.food, 2); assert.equal(s.wallet.eqTicket, 1);
});

test('schema 8 fill: older v8 saves get expedition + craft blocks', () => {
  const s = newGame(T0); delete s.expedition; delete s.craft;
  const m = migrate(s);
  assert.equal(m.expedition.slots.length, 3); assert.equal(m.craft.herb, 0);
});
