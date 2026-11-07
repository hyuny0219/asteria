import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as EX from '../src/core/expedition.js';

const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);
const withPets = (ids) => { const s = newGame(T0); ids.forEach(([id, level, stars]) => { s.pets.owned[id] = { level, stars, shards: 0 }; }); return s; };

test('자동 파견: one expedition per free companion, never more than free slots', () => {
  const s = withPets([['P01', 10, 1], ['P02', 30, 2]]);
  const r = EX.sendAuto(s, T0);
  assert.equal(r.ok, true);
  assert.equal(r.sent.length, 2);
  assert.equal(s.expedition.slots.filter(Boolean).length, 2);
  assert.equal(new Set(s.expedition.slots.filter(Boolean).map((x) => x.pet)).size, 2);
  const again = EX.sendAuto(s, T0);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'no-pet');
});

test('bestPetFor picks the free companion with the highest success', () => {
  const s = withPets([['P01', 5, 1], ['P02', 40, 3]]);
  const exp = EX.refreshExpedition(s, T0).board[0];
  assert.equal(EX.bestPetFor(s, exp).pet, 'P02');
  assert.equal(EX.bestPetFor(s, exp, new Set(['P02'])).pet, 'P01');
});
