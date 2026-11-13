import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate, SCHEMA_VERSION } from '../src/core/state.js';
import * as DF from '../src/core/difficulty.js';
import * as ST from '../src/core/stages.js';
import * as prog from '../src/core/progression.js';
import { REGIONS, BOSSES } from '../src/data/content.js';
import { raidOpen } from '../src/core/progression.js';
import { BALANCE } from '../src/data/balance.js';

const T0 = Date.UTC(2026, 10, 8, 3);
const LAST = DF.lastRegion();   // v19: 1막 끝(심연) — 2막은 같은 난이도 안에서 이어짐
function clearedEasy() {
  const s = newGame(T0);
  s.player.level = 100;
  for (const r of REGIONS.filter((x) => !x.act)) { s.progression.maxWave[r.id] = 10; if (!s.progression.unlockedRegions.includes(r.id)) s.progression.unlockedRegions.push(r.id); s.progression.bossCleared[r.boss] = true; }
  s.progression.region = LAST.id; s.progression.wave = 7;
  return s;
}

test('schema 8 save migrates to 9: every record stays 이지, 노말·하드 start empty', () => {
  const s = clearedEasy();
  s.stages.stars['meadow-3'] = 2;
  delete s.diff; s.schemaVersion = 8;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 9);
  assert.equal(DF.curDiff(m), 'easy');
  assert.equal(m.progression.bossCleared.B05, true);
  assert.equal(DF.track(m, 'easy').stars['meadow-3'], 2);
  assert.deepEqual(DF.track(m, 'normal').bossCleared, {});
  assert.deepEqual(DF.track(m, 'hard').unlockedRegions, [REGIONS[0].id]);
  // a half-written block is repaired
  const h = JSON.parse(JSON.stringify(s)); h.diff = { cur: 'bogus', tracks: { normal: { wave: 3 } } };
  const m2 = migrate(h);
  assert.equal(m2.diff.cur, 'easy');
  assert.deepEqual(m2.diff.tracks.normal.unlockedRegions, [REGIONS[0].id]);
  assert.ok(m2.diff.tracks.hard.maxWave);
});

test('노말 opens on 이지 last boss, 하드 on 노말 last boss (generalised to the last region)', () => {
  const s = newGame(T0);
  assert.equal(DF.diffOpen(s, 'easy'), true);
  assert.equal(DF.diffOpen(s, 'normal'), false);
  s.progression.bossCleared[LAST.boss] = true;
  assert.equal(DF.diffOpen(s, 'normal'), true);
  assert.equal(DF.diffOpen(s, 'hard'), false);
  DF.track(s, 'normal').bossCleared[LAST.boss] = true;
  assert.equal(DF.diffOpen(s, 'hard'), true);
  assert.equal(LAST.boss, 'B10');
  assert.ok(!BOSSES.B10.raid, '10-보스 is a plain stage boss now (raid is separate)');
});

test('onBossCleared on 노말 writes the 노말 track only and reports the unlock', () => {
  const s = clearedEasy();
  delete s.progression.bossCleared[LAST.boss];
  let r = prog.onBossCleared(s, LAST.boss, 'easy');
  assert.equal(r.first, true);
  assert.equal(r.diffUnlocked, 'normal');
  assert.ok(r.unlocked === null || r.unlocked === 'r11');   // v19: 2막 첫 지역(이미 열려 있지 않다면)
  assert.equal(DF.switchDiff(s, 'normal').ok, true);
  r = prog.onBossCleared(s, 'B01');
  assert.equal(r.first, true);
  assert.equal(r.unlocked, 'desert');
  assert.equal(r.diff, 'normal');
  assert.equal(DF.track(s, 'normal').bossCleared.B01, true);
  assert.deepEqual(DF.track(s, 'normal').unlockedRegions, ['meadow', 'desert']);
  // 이지 records (used by dungeons, raid, achievements) are untouched
  assert.equal(Object.keys(s.progression.bossCleared).length, 10);
  assert.equal(prog.onBossCleared(s, 'B01').first, false);
  assert.equal(raidOpen(s), true);
});

test('switching difficulty parks and restores each farm position; no level gate (보스만 잡으면 열림)', () => {
  const s = clearedEasy();
  s.player.level = 61;
  assert.equal(DF.switchDiff(s, 'hard').reason, 'locked');
  const a = DF.switchDiff(s, 'normal');
  assert.deepEqual([a.ok, a.region, a.wave], [true, 'meadow', 1]);
  assert.equal(s.progression.region, 'meadow');
  DF.track(s).maxWave.meadow = 6; s.progression.wave = 6;
  const b = DF.switchDiff(s, 'easy');
  assert.deepEqual([b.region, b.wave], [LAST.id, 7]);
  const c = DF.switchDiff(s, 'normal');
  assert.deepEqual([c.region, c.wave], ['meadow', 6]);
  assert.equal(DF.switchDiff(s, 'normal').reason, 'same');
});

test('stage clears and first-clear rewards are per difficulty, once each, ×2 on 노말', () => {
  const s = clearedEasy();
  const e = ST.recordClear(s, 'meadow', 3, { deaths: 0, timeSec: 10 }, 'easy');
  assert.ok(e.first);
  assert.ok(!ST.recordClear(s, 'meadow', 3, { deaths: 0, timeSec: 10 }, 'easy').first);
  DF.switchDiff(s, 'normal');
  const gem0 = s.wallet.gem;
  const n = ST.recordClear(s, 'meadow', 3, { deaths: 1, timeSec: 99 });
  assert.ok(n.first);
  assert.equal(n.diff, 'normal');
  assert.equal(s.wallet.gem - gem0, ST.stageReward('meadow', 3, 'easy').gem * 2);
  assert.ok(!ST.recordClear(s, 'meadow', 3, { deaths: 0, timeSec: 5 }).first);
  assert.equal(DF.track(s, 'normal').stars['meadow-3'], 3);
  assert.equal(DF.track(s, 'easy').stars['meadow-3'], 3);
  assert.equal(DF.track(s, 'hard').stars['meadow-3'], undefined);
  assert.equal(ST.nodeStatus(s, 'desert', 1, prog.regionUnlocked(s, 'desert')), 'locked');
  assert.equal(ST.nodeStatus(s, 'desert', 1, prog.regionUnlocked(s, 'desert', 'easy'), 'easy'), 'cleared');
  assert.equal(ST.stageReward('meadow', 'boss', 'hard').gem, ST.stageReward('meadow', 'boss', 'easy').gem * 3);
});

test('enemy scaling: none on 이지, grows through the stages, 하드 > 노말', () => {
  assert.equal(DF.enemyMul('easy', 'meadow', 1), null);
  const a = DF.enemyMul('normal', 'meadow', 1), b = DF.enemyMul('normal', LAST.id, 'boss'), c = DF.enemyMul('hard', 'meadow', 1);
  assert.ok(b.hp > a.hp && b.atk > a.atk);
  assert.ok(c.hp > a.hp && c.atk > a.atk);
  assert.equal(DF.farmLevel('normal', 'meadow', 1), 100);
  assert.equal(DF.farmLevel('easy', 'meadow', 1), 1);
  assert.equal(DF.stepIndex(LAST.id, 'boss'), 109);
  // v19 2막: 이지도 배율이 붙고, 1막 끝에서 이어서 커짐
  const e11 = DF.enemyMul('easy', 'r11', 1), e20 = DF.enemyMul('easy', 'r20', 'boss');
  assert.ok(e11 && e11.hp >= 1 && e20.hp > e11.hp);
  const n10 = DF.enemyMul('normal', 'void', 'boss'), n20 = DF.enemyMul('normal', 'r20', 'boss'), h20 = DF.enemyMul('hard', 'r20', 'boss');
  assert.ok(n20.hp > n10.hp && h20.hp > n20.hp);
});

test('nextGoal points at 노말 1-1 once 이지 is done', () => {
  const s = clearedEasy();
  s.progression.firsts.firstEquip = true; s.inventory = []; s.player.tier = 3; s.pets.eggs = 0; s.dungeon.tickets = 0;
  assert.deepEqual(prog.nextGoal(s), { id: 'diff', text: '노말 난이도 1-1 시작', action: 'world' });
  DF.switchDiff(s, 'normal');
  assert.match(prog.nextGoal(s).text, /^노말 별빛 초원 웨이브 10/);
});

test('노말 boss fight: Lv 100 scaled boss, own first clear once, 이지 records untouched', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  await g.transact('t', (s) => {
    const c = clearedEasy();
    for (const k of ['maxWave', 'unlockedRegions', 'bossCleared', 'region', 'wave']) s.progression[k] = c.progression[k];
    s.player.level = 100; s.player.statsUpgrades.atk = 12000; s.player.statsUpgrades.hp = 8000;
    return { ok: true };
  });
  assert.equal((await g.switchDifficulty('normal')).ok, true);
  assert.equal(g.canChallengeBoss('B01').reason, 'wave');
  await g.transact('t', (s) => { DF.track(s).maxWave.meadow = 10; return { ok: true }; });
  assert.ok(g.startBoss('B01').ok);
  const e = g.active.enemies.find((x) => x.boss);
  assert.equal(e.level, 100);
  const easyFirst = g.state.progression.firstClearClaimed.B01;
  for (let i = 0; i < 4000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(g.result.win, true);
  assert.equal(g.result.diff, 'normal');
  assert.equal(g.result.first, true);
  assert.equal(g.result.unlocked, 'desert');
  assert.ok(g.result.items.some((i) => i.source === 'firstClear' && i.level === 100 && ['epic', 'legendary'].includes(i.rarity)));
  assert.ok(g.state.progression.firstClearClaimed['normal:B01']);
  assert.equal(g.state.progression.firstClearClaimed.B01, easyFirst);
  assert.equal(DF.track(g.state, 'normal').stars['meadow-boss'] > 0, true);
  g.returnToFarm();
  const gem = g.state.wallet.gem;
  g.startBoss('B01');
  for (let i = 0; i < 4000 && g.mode === 'BOSS'; i++) { g.advance(50); await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(g.result.first, false);
  assert.ok(!g.result.items.some((i) => i.source === 'firstClear'));
  assert.equal(g.state.wallet.gem, gem);
});

test('심연의 군주 is a normal stage boss on 이지; the weekly raid stays its own fight', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const { raidBossHp } = await import('../src/core/raid.js');
  const { monsterStats } = await import('../src/core/combat.js');
  const g = new Game({ saver: new MemorySaver(), now: () => T0 });
  await g.load();
  await g.transact('t', (s) => { const c = clearedEasy(); delete c.progression.bossCleared.B10; for (const k of ['maxWave', 'unlockedRegions', 'bossCleared', 'region', 'wave']) s.progression[k] = c.progression[k]; s.player.level = 100; return { ok: true }; });
  assert.equal(g.canChallengeBoss('B10').ok, true);
  assert.ok(g.startBoss('B10').ok);
  const e = g.active.enemies.find((x) => x.boss);
  assert.equal(e.maxHp, monsterStats(100, { boss: true }).hp);
  assert.ok(!e.raid);
  assert.equal(raidBossHp(), monsterStats(100, { boss: true }).hp * 3);
  assert.equal(g.active.timeLimitMs, BALANCE.combat.bossTimeoutSec * 1000);
});
