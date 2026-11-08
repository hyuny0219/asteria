import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/core/combat.js';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { makeRng } from '../src/core/util.js';
import { BALANCE } from '../src/data/balance.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';

const T0 = Date.UTC(2026, 10, 8, 3, 0, 0);
const heroCfg = (s) => ({ stats: playerStats(s), skills: s.skills, branch: s.player.branch, skillLevel: () => 1 });

// drive a farm battle and keep a stage counter like the game does
function run(seconds, seed = 3) {
  const s = newGame(T0);
  s.player.statsUpgrades.atk = 200; s.player.statsUpgrades.hp = 200;
  const st = { kills: 0, wave: 1 };
  const b = new Battle({ kind: 'farm', rng: makeRng(seed), hero: heroCfg(s), farm: { monsters: ['M01'], levelFn: () => 1, eliteAllowed: () => false,
    killsFn: () => st.kills, stageFn: () => 'meadow-' + st.wave } });
  const log = [];
  for (let i = 0; i < seconds * 20; i++) {
    b.step();
    for (const ev of b.drainEvents()) {
      if (ev.type === 'kill') { st.kills++; if (st.kills >= 10) { st.kills = 0; st.wave++; } }
      if (ev.type === 'travelStart' || ev.type === 'travelEnd') log.push({ type: ev.type, t: ev.t, kills: st.kills, wave: st.wave, alive: b.alive().length });
    }
  }
  return { b, log, st };
}

test('페이즈: travel starts after 3, 6 and 10 kills, never with enemies on the field, and lasts travelSec', () => {
  const { log } = run(120);
  const starts = log.filter((x) => x.type === 'travelStart');
  assert.ok(starts.length >= 3);
  assert.deepEqual(starts.slice(0, 3).map((x) => x.kills), [3, 6, 0]);   // 10 → next stage (kills reset)
  assert.ok(starts.every((x) => x.alive === 0));
  const ends = log.filter((x) => x.type === 'travelEnd');
  assert.equal(ends[0].t - starts[0].t, BALANCE.phase.travelSec * 1000);
});

test('페이즈: a phase never spawns past its end (≤ 3 kills before the first travel)', () => {
  const { b } = run(1);
  for (let i = 0; i < 400 && !b.traveling; i++) b.step();
  assert.ok(b.alive().length === 0 || !b.traveling);
});

test('페이즈: travel heals and the hero does not act', () => {
  const s = newGame(T0);
  const st = { kills: 3, wave: 1 };
  const b = new Battle({ kind: 'farm', rng: makeRng(1), hero: heroCfg(s), farm: { monsters: ['M01'], levelFn: () => 1, eliteAllowed: () => false, killsFn: () => st.kills, stageFn: () => 'x' } });
  b.phase.key = 'x:0';   // as if phase 1 just ended
  b.hero.hp = Math.floor(b.hero.maxHp * 0.5);
  b.step();
  assert.equal(b.traveling, true);
  const hp0 = b.hero.hp;
  for (let i = 0; i < 20; i++) b.step();   // 1 s
  assert.ok(b.hero.hp - hp0 >= Math.floor(b.hero.maxHp * BALANCE.phase.travelRegenPct * 0.95));
  assert.equal(b.hero.action, null);
  assert.equal(b.alive().length, 0);
});

test('페이즈: same seed → same travel timeline (deterministic)', () => {
  assert.deepEqual(run(60, 9).log, run(60, 9).log);
});

test('페이즈: game farm counts star time only while fighting', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  let travelTicks = 0;
  for (let i = 0; i < 2400; i++) { clock += 50; g.advance(50); if (g.farm.traveling) travelTicks++; if (i % 20 === 0) await new Promise((r) => setImmediate(r)); }
  assert.ok(travelTicks > 0);
});

test('방치 일관성: the verified kills/s window includes the travel legs', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  let vf = null;
  g.on && g.on('farmVerified', (v) => { vf = v; });
  let travelMs = 0;
  for (let i = 0; i < 6000 && !vf; i++) {
    clock += 50; g.advance(50); if (g.farm.traveling) travelMs += 50;
    if (!vf && g.state.progression.verifiedFarm) vf = g.state.progression.verifiedFarm;
    if (i % 20 === 0) await new Promise((r) => setImmediate(r));
  }
  assert.ok(vf, 'farm verified');
  const { RATE_METHOD } = await import('../src/core/offline.js');
  assert.equal(vf.method, RATE_METHOD);
  // a window of ≥ 3 stages holds ≥ 3×2 in-stage travel legs; kills/s must reflect them
  const minTravel = 6 * BALANCE.phase.travelSec;
  assert.ok(vf.windowSec >= minTravel);
  assert.ok(travelMs > 0);
  const kills = Math.round(vf.killsPerSec * vf.windowSec);
  assert.ok(kills / (vf.windowSec - minTravel) > vf.killsPerSec, 'rate is diluted by travel time');
});

test('방치 일관성: a v1 baseline (fight time only) is converted to the travel footing', async () => {
  const { ratePerSecond, travelAdjustedKps, RATE_METHOD } = await import('../src/core/offline.js');
  const old = { region: 'R1', wave: 1, level: 5, killsPerSec: 1, method: 'measured-60s-window-x1/v1' };
  const adj = travelAdjustedKps(old);
  assert.ok(Math.abs(adj - 10 / (10 + 3 * BALANCE.phase.travelSec)) < 1e-9);
  assert.equal(ratePerSecond(old).killsPerSec, adj);
  assert.equal(ratePerSecond({ ...old, method: RATE_METHOD }).killsPerSec, 1);
});
