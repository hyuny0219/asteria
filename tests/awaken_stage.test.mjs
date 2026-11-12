import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as G from '../src/core/gearplus.js';
import { awakenStage, scaleAwaken, describeStage, nextStageLevel } from '../src/core/awakenstage.js';
import { AWAKENINGS } from '../src/data/gearplus.js';

test('v18.4 각성 단계: Lv 10/20/30', () => {
  assert.deepEqual([1, 9, 10, 19, 20, 29, 30].map(awakenStage), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(nextStageLevel(12), 20); assert.equal(nextStageLevel(30), null);
});

test('v18.4 1단계는 예전과 같고, 단계마다 같은 방향으로 강해짐', () => {
  for (const [id, opts] of Object.entries(AWAKENINGS)) for (const o of opts) {
    assert.deepEqual(scaleAwaken(o.mods, 1), o.mods, id);
    assert.ok(describeStage(o.mods, 3).includes('완성'), id);
  }
  const st = (s) => scaleAwaken(AWAKENINGS.shieldCharge[1].mods, s);
  assert.deepEqual([1, 2, 3].map((s) => st(s).stunAdd), [0.8, 1.2, 1.6]);
  assert.equal(st(3).coefMul, 1.15);
  assert.deepEqual([1, 2, 3].map((s) => scaleAwaken(AWAKENINGS.strike[0].mods, s, { final: false }).coefMul), [0.7, 0.8, 0.9]);
  assert.ok(scaleAwaken(AWAKENINGS.strike[1].mods, 3, { final: false }).coefMul < 0.75);   // 전체 공격형은 천천히
  assert.equal(scaleAwaken(AWAKENINGS.a_aim[1].mods, 3).cdMul, 0.5);                       // 대기 감소 하한
});

test('v18.4 전투 효과(skillMods)에 단계가 반영됨', () => {
  const s = newGame(0, 1, 'warrior');
  s.skills.awaken = { shieldCharge: 1 };
  s.skills.levels.shieldCharge = 9;  assert.equal(G.skillMods(s).shieldCharge, undefined);
  s.skills.levels.shieldCharge = 10; assert.equal(G.skillMods(s).shieldCharge.stunAdd, 0.8);
  s.skills.levels.shieldCharge = 25; assert.equal(G.skillMods(s).shieldCharge.stunAdd, 1.2);
  s.skills.levels.shieldCharge = 30; assert.equal(G.skillMods(s).shieldCharge.stunAdd, 1.6);
});
