import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as WBm from '../src/core/worldboss.js';
import { Battle } from '../src/core/combat.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { makeRng } from '../src/core/util.js';

const at = (h, m = 0) => Date.UTC(2026, 10, 9, h - 9, m, 0);   // KST h:m on 2026-11-09
const open = (s) => { s.progression.bossCleared.B03 = true; s.player.level = 40; return s; };

test('월드 보스: open 12/18/21시 1시간, 창마다 1회', () => {
  const s = open(newGame(at(10)));
  assert.equal(WBm.canChallenge(s, at(11, 59)).reason, 'closed');
  assert.equal(WBm.canChallenge(s, at(11, 59)).next.hour, 12);
  assert.equal(WBm.canChallenge(s, at(12, 30)).ok, true);
  assert.equal(WBm.beginWorldBoss(s, 'w1', at(12, 30)).ok, true);
  assert.equal(WBm.canChallenge(s, at(12, 59)).reason, 'used');
  assert.equal(WBm.canChallenge(s, at(18, 1)).ok, true);
  assert.equal(WBm.canChallenge(s, at(22, 1)).reason, 'closed');
  assert.equal(WBm.nextWindow(at(22, 1)).hour, 12);
  assert.equal(WBm.canChallenge(newGame(at(12)), at(12, 5)).reason, 'locked');
});

test('월드 보스: grade by damage share, rewards once', () => {
  const s = open(newGame(at(10)));
  const rng = makeRng(2);
  assert.equal(WBm.gradeFor(0.8), 'S'); assert.equal(WBm.gradeFor(0.3), 'B'); assert.equal(WBm.gradeFor(0.01), 'D');
  const g0 = s.wallet.gem;
  const r = WBm.finishWorldBoss(s, 'w1', 500, 1000, rng);
  assert.equal(r.grade, 'A'); assert.equal(s.wallet.gem - g0, WBm.WB.rewards.A.gem); assert.equal(r.items.length, 1);
  assert.equal(WBm.finishWorldBoss(s, 'w1', 900, 1000, rng).ok, false);
  assert.equal(s.worldBoss.bestGrade, 'A');
});

test('월드 보스 전투: 60 s score fight, ends as a victory with damage', () => {
  const s = open(newGame(at(12)));
  const g = new Game({ saver: new MemorySaver(), now: () => at(12) });
  g.state = s; g.rng = makeRng(1);
  const b = new Battle({ kind: 'world', rng: makeRng(5), hero: g.sessionHero(), world: WBm.battleConfig(s, at(12)) });
  while (!b.over) { b.step(); b.drainEvents(); }
  assert.equal(b.over, 'victory');
  assert.ok(b.damageDealt > 0); assert.ok(b.worldHp > b.damageDealt);
  assert.ok(b.t <= 60000);
});

test('희귀 정예: spawns in the farm, kill gives gems + item, 10/10 gives the title', () => {
  const s = newGame(at(10));
  const g = new Game({ saver: new MemorySaver(), now: () => at(10) });
  g.state = s; g.rng = makeRng(1); g.startFarm();
  const e = g.farm.spawnRare(WBm.RARES.meadow, 3);
  assert.ok(e && e.rare === 'RE01');
  assert.equal(g.farm.spawnRare(WBm.RARES.meadow, 3), null);   // one at a time
  const gem0 = s.wallet.gem, inv0 = s.inventory.length;
  g.processFarm({ type: 'kill', enemy: { id: e.id, level: 5, elite: true, fieldBoss: false, rare: 'RE01' } });
  assert.equal(s.wallet.gem - gem0 >= WBm.RARE_RULES.gem, true);
  assert.ok(s.inventory.length > inv0);
  assert.equal(s.worldBoss.rares.RE01, 1);
  const rng = makeRng(3);
  for (const r of Object.values(WBm.RARES)) WBm.onRareKill(s, r.id, 10, rng);
  assert.ok(s.titles.owned.includes('t_rarehunter'));
});

test('schema 8 fill: worldBoss block', () => {
  const s = newGame(at(10)); delete s.worldBoss;
  assert.equal(migrate(s).worldBoss.best, 0);
});
