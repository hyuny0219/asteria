// v17 직업 밸런스: 기사 방어력→공격력, 도적 흡혈, 레이드 C 파편
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { finishRaid, gradeFor, raidBossHp } from '../src/core/raid.js';
import { BALANCE } from '../src/data/balance.js';
import { BRANCHES } from '../src/data/content.js';
import { makeRng } from '../src/core/util.js';
import { EVO_SCALE } from '../src/data/skillforms.js';

const T0 = Date.UTC(2026, 10, 10, 3);
const hero = (cls, branch, tier) => { const s = newGame(T0, 7, cls); s.player.level = 100; s.player.branch = branch; s.player.tier = tier; return s; };

test('knight converts part of defence into attack, growing with tier', () => {
  const sum = (t) => BRANCHES.knight.tiers.slice(0, t).reduce((a, x) => a + (x.defToAtk || 0), 0);
  assert.equal(sum(2), 0, 'no conversion before tier 3 (early game unchanged)');
  assert.ok(sum(3) > 0 && sum(4) > sum(3));
  for (const b of Object.keys(BRANCHES)) if (b !== 'knight') assert.ok(BRANCHES[b].tiers.every((x) => !x.defToAtk), b + ' has no conversion');
});

test('knight attack rises when defence rises (conversion is live)', () => {
  const s = hero('warrior', 'knight', 3);
  const a0 = playerStats(s).atk;
  s.player.statsUpgrades.def = (s.player.statsUpgrades.def || 0) + 200;
  const p1 = playerStats(s);
  assert.ok(p1.atk > a0, 'more def → more atk for knight');
  const z = hero('warrior', 'berserker', 3);
  const b0 = playerStats(z).atk;
  z.player.statsUpgrades.def = (z.player.statsUpgrades.def || 0) + 200;
  assert.equal(playerStats(z).atk, b0, 'berserker atk does not follow def');
});

test('rogue survival kicks in at tier 3 (both branches); early tiers unchanged', () => {
  const ls = (b, t) => playerStats(hero('rogue', b, t)).lifesteal;
  const hp = (b, t) => playerStats(hero('rogue', b, t)).hp;
  assert.equal(ls('assassin', 2), 0);
  assert.ok(ls('assassin', 3) >= 0.06 - 1e-9);
  assert.ok(ls('trickster', 3) >= 0.05 - 1e-9);
  assert.ok(hp('assassin', 3) > hp('assassin', 2) * 1.15);
  assert.equal(playerStats(hero('archer', 'ranger', 3)).lifesteal, 0);
});

test('raid grade C now pays 1 star shard (D pays none)', () => {
  assert.equal(BALANCE.raid.rewards.C.starShard, 1);
  assert.ok(!BALANCE.raid.rewards.D.starShard);
  const s = newGame(T0); const hp = raidBossHp();
  const before = s.wallet.starShard;
  const c = finishRaid(s, hp * 0.3, makeRng(1));
  assert.equal(c.grade, 'C'); assert.equal(s.wallet.starShard, before + 1);
  assert.equal(gradeFor(hp * 0.1), 'D');
});

test('evolution scale: tiers 1–2 keep v16 values, tiers 3–4 lift warrior/rogue/wizard', async () => {
  const { skillDef } = await import('../src/core/skillforms.js');
  assert.deepEqual({ ...EVO_SCALE.cls }, { warrior: 1.0, mage: 0.86, archer: 0.72, rogue: 1.4 });
  assert.ok(EVO_SCALE.late.warrior > EVO_SCALE.cls.warrior && EVO_SCALE.late.rogue > EVO_SCALE.cls.rogue);
  // knight strike: tier-3 form coefficient grows more under the late scale than tier 2
  const c = (t) => { const d = skillDef('strike', { tier: t, branch: 'knight', cls: 'warrior' }); return (d.coef || 0) * (d.hits || 1); };
  assert.ok(c(3) >= c(2));
});

test('tower pays star shards every 10 floors from 30 up to 100 only', async () => {
  const { floorReward } = await import('../src/core/tower.js');
  assert.equal(floorReward(20).starShard, 0);
  assert.equal(floorReward(30).starShard, 1);
  assert.equal(floorReward(100).starShard, 1);
  assert.equal(floorReward(110).starShard, 0);
  assert.equal(floorReward(150).starShard, 0);
});

test('normal-boss repeat: first win of the day pays a guaranteed shard', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const DF = await import('../src/core/difficulty.js');
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  await g.transact('t', (s) => {
    s.player.level = 100; s.player.statsUpgrades.atk = 60000; s.player.statsUpgrades.hp = 40000;
    DF.ensure && DF.ensure(s);
    s.diff.cur = 'normal';
    const t = DF.track(s, 'normal'); t.maxWave.meadow = 10; t.bossCleared.B01 = true;
    s.progression.firstClearClaimed['normal:B01'] = 'x'; s.progression.firstClearClaimed['N_B01'] = 'x';
    return { ok: true };
  });
  const fight = async () => { const st = g.startBoss('B01'); assert.ok(st.ok, JSON.stringify(st)); for (let i = 0; i < 4000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); } await new Promise((r) => setTimeout(r, 10)); const r = g.result; g.returnToFarm(); return r; };
  const s0 = g.state.wallet.starShard;
  const r1 = await fight();
  assert.equal(r1.win, true);
  assert.equal(r1.dailyShard, true);
  assert.equal(g.state.wallet.starShard, s0 + DF.DIFFICULTY.normal.order);
  const r2 = await fight();
  assert.ok(!r2.dailyShard, 'only the first repeat win of the day is guaranteed');
});
