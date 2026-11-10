import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame } from '../src/core/state.js';
import { computeClaim, foodOverlap } from '../src/core/offline.js';
import { RATE_METHOD } from '../src/core/offline.js';
import * as BD from '../src/core/bossdaily.js';

const KST = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 9, mm);
const T0 = KST(2026, 11, 10, 12);
const H = 3600e3;

test('v18 시계: 게임 시간은 뒤로 가지 않고, 다시 켜도 마지막 저장 시각이 바닥', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  clock = T0 + 30 * H;                       // 다음날로 앞당김
  assert.equal(g.now(), T0 + 30 * H);
  clock = T0;                                // 다시 되돌림 → 멈춤
  assert.equal(g.now(), T0 + 30 * H);
  await g.commit('x');
  // 새로 켜도 저장 시각 아래로는 안 내려감 + 알림
  const g2 = new Game({ saver, now: () => clock });
  await g2.load();
  assert.equal(g2.now(), T0 + 30 * H);
  assert.ok(g2.notices.some((n) => n.type === 'clockRollback'));
  // 보스 일일 횟수는 되돌린 날로 다시 채워지지 않음
  g2.state.bossDaily = { day: null, used: 0 };
  BD.consume(g2.state, g2.now()); BD.consume(g2.state, g2.now()); BD.consume(g2.state, g2.now());
  assert.equal(BD.left(g2.state, g2.now()), 0);
  // 실제 시간이 따라잡으면 다시 흐름
  clock = T0 + 31 * H;
  assert.equal(g2.now(), T0 + 31 * H);
});

test('v18 시계: 7일 넘게 미래로 저장된 세이브는 기기 시계를 따름 (영원히 멈추지 않게)', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  clock = T0 + 10 * 24 * H;
  await g.commit('future');
  clock = T0;
  const g2 = new Game({ saver, now: () => clock });
  await g2.load();
  assert.equal(g2.now(), T0);
});

test('v18 음식: 방치 보상은 음식이 켜져 있던 시간만큼만 보너스', () => {
  const s = newGame(T0);
  s.progression.verifiedFarm = { region: 'meadow', wave: 5, level: 5, killsPerSec: 0.4, windowSec: 75, method: RATE_METHOD };
  s.offlineSnapshot.lastActiveAt = T0;
  const plain = computeClaim(s, T0 + 12 * H, 'p');
  s.craft = { ...(s.craft || {}), food: { id: 'soup', until: T0 + 0.5 * H } };   // 30분 남은 수프 (경험치 +20%)
  const fed = computeClaim(s, T0 + 12 * H, 'p');
  const ratio = fed.exp / plain.exp;
  assert.ok(Math.abs(ratio - (1 + 0.2 * 0.5 / 12)) < 0.002, `ratio ${ratio}`);
  assert.equal(fed.food.sec, 1800);
  assert.equal(fed.gold, plain.gold);
  // 수령 시점에 음식이 켜져 있어도 방치 구간 밖이면 보너스 없음
  assert.equal(foodOverlap({ craft: { food: { id: 'roast', until: T0 } } }, T0, 3600).frac, 0);
  // 방치 내내 켜져 있으면 전부
  const all = foodOverlap({ craft: { food: { id: 'roast', until: T0 + 5 * H } } }, T0, 3600);
  assert.equal(all.frac, 1); assert.equal(all.goldPct, 0.2);
});
