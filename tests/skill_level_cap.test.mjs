import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as prog from '../src/core/progression.js';
import { skillMaxLevel, skillLevelMul, skillStepCost, SKILL_CAP_ABS } from '../src/core/skilllevel.js';

test('v18.3 스킬 최대 레벨: 전직마다 +5 (10/15/20/25/30)', () => {
  const s = newGame(0, 1, 'warrior');
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => { s.player.tier = t; return skillMaxLevel(s); }), [10, 15, 20, 25, 30]);
  assert.equal(SKILL_CAP_ABS, 30);
});

test('v18.3 Lv 10까지는 예전과 같고, 11부터 완만한 배율 + 많은 스킬북', () => {
  assert.equal(skillLevelMul(1), 1);
  assert.ok(Math.abs(skillLevelMul(10) - 1.72) < 1e-9);
  assert.ok(Math.abs(skillLevelMul(30) - 2.12) < 1e-9);
  assert.deepEqual(skillStepCost(9), { books: 18, goldMinutes: 27 });
  assert.equal(skillStepCost(10).books, 30);
  let total = 0; for (let n = 10; n < 30; n++) total += skillStepCost(n).books;
  assert.ok(total > 2500 && total < 3200, String(total));
});

test('v18.3 전직 전에는 Lv 10에서 막히고, 1차 전직 후 Lv 11로 올릴 수 있음', () => {
  const s = newGame(0, 1, 'warrior');
  const id = s.skills.equipped[0];
  s.skills.levels[id] = 10; s.skills.books[id] = 1000; s.wallet.gold = 1e12;
  assert.equal(prog.levelSkill(s, id).reason, 'max');
  s.player.tier = 1; s.player.level = 30; s.player.branch = 'knight';
  const r = prog.levelSkill(s, id);
  assert.equal(r.ok, true); assert.equal(s.skills.levels[id], 11); assert.equal(s.skills.books[id], 970);
});
