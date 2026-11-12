import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as prog from '../src/core/progression.js';
import { playerStats } from '../src/core/stats.js';
import { ascExpToNext, ASC_MAX } from '../src/core/ascension.js';

test('v18.5 초월 레벨: 초월 전 Lv 100의 남는 경험치는 버리고, 초월 뒤엔 초월 레벨로 쌓임', () => {
  const s = newGame(0, 1, 'warrior');
  s.player.level = 100; s.player.tier = 3;
  assert.equal(prog.gainExp(s, 1e6).discarded, 1e6);
  assert.equal(s.player.ascLv, 0);
  s.player.tier = 4;
  const atk0 = playerStats(s).atk;
  const r = prog.gainExp(s, ascExpToNext(0) + ascExpToNext(1) + 5);
  assert.equal(s.player.ascLv, 2); assert.equal(s.player.ascExp, 5); assert.equal(r.ascLevels, 2);
  assert.ok(Math.abs(playerStats(s).atk / atk0 - 1.02) < 0.002);
  prog.gainExp(s, 1e12);
  assert.equal(s.player.ascLv, ASC_MAX); assert.equal(s.player.ascExp, 0);
});
