import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as ST from '../src/core/steeds.js';
import { STEED, MOUNTS, WINGS } from '../src/data/steeds.js';
import { playerStats } from '../src/core/stats.js';
import { makeRng } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 8, 3);

test('탈것·날개: first one auto-equips, duplicates become shards', () => {
  const s = newGame(T0);
  assert.equal(s.mounts.equipped, null);
  assert.equal(ST.give(s, 'mount', 'horse').dup, false);
  assert.equal(s.mounts.equipped, 'horse');
  ST.give(s, 'mount', 'wolf');
  assert.equal(s.mounts.equipped, 'horse');
  assert.equal(ST.give(s, 'mount', 'horse').dup, true);
  assert.equal(s.mounts.owned.horse.shards, STEED.summon.dupShards);
  assert.equal(ST.give(s, 'mount', 'nope').reason, 'missing');
});

test('탈것·날개: level +1 / +10 / max with food, cap 50', () => {
  const s = newGame(T0);
  ST.give(s, 'wing', 'rose');
  assert.equal(ST.levelUp(s, 'wing', 'rose', 1).reason, 'steed-mat');
  s.wallet.wingFeather = 10000;
  const r1 = ST.levelUp(s, 'wing', 'rose', 1);
  assert.equal(r1.ok, true); assert.equal(r1.cost, STEED.levelCost(1)); assert.equal(s.wings.owned.rose.lv, 2);
  const q10 = ST.levelQuote(s, 'wing', 'rose', 10);
  let exp = 0; for (let l = 2; l < 12; l++) exp += STEED.levelCost(l);
  assert.equal(q10.cost, exp);
  ST.levelUp(s, 'wing', 'rose', 10);
  assert.equal(s.wings.owned.rose.lv, 12);
  ST.levelUp(s, 'wing', 'rose', 'max');
  assert.equal(s.wings.owned.rose.lv, STEED.maxLevel);
  assert.equal(ST.levelUp(s, 'wing', 'rose', 1).reason, 'cap');
  // max stops at what the wallet can pay
  const t = newGame(T0); ST.give(t, 'mount', 'horse'); t.wallet.mountFood = STEED.levelCost(1) + STEED.levelCost(2) + 1;
  assert.equal(ST.levelUp(t, 'mount', 'horse', 'max').to, 3);
  assert.equal(t.wallet.mountFood, 1);
});

test('탈것·날개: star up from shards raises the bonus; equipped bonus reaches the stats', () => {
  const s = newGame(T0);
  const hp0 = playerStats(s).hp;
  ST.give(s, 'mount', 'horse');
  const hp1 = playerStats(s).hp;
  assert.ok(hp1 > hp0);
  const b1 = ST.steedBonus('mount', 'horse', s.mounts.owned.horse);
  assert.equal(ST.starUp(s, 'mount', 'horse').reason, 'shards');
  s.mounts.owned.horse.shards = 10;
  assert.equal(ST.starUp(s, 'mount', 'horse').star, 2);
  const b2 = ST.steedBonus('mount', 'horse', s.mounts.owned.horse);
  assert.ok(Math.abs(b2.goldPct / b1.goldPct - STEED.starMul[1]) < 1e-9);
  assert.ok(playerStats(s).goldPct > 0);
  s.mounts.owned.horse.star = 5;
  assert.equal(ST.starUp(s, 'mount', 'horse').reason, 'max');
});

test('탈것·날개 소환: tickets first, then gems; published odds hold; pity at 60', () => {
  const s = newGame(T0);
  s.wallet.mountTicket = 3; s.wallet.gem = 0;
  assert.equal(ST.summon(s, 'mount', 10, makeRng(1)).reason, 'gem');
  const q = ST.summonQuote(s, 'mount', 1);
  assert.deepEqual([q.tickets, q.gem], [1, 0]);
  s.wallet.gem = 10000;
  const r = ST.summon(s, 'mount', 10, makeRng(2));
  assert.equal(r.ok, true); assert.equal(r.quote.tickets, 3);
  assert.equal(s.wallet.mountTicket, 0);
  assert.equal(s.wallet.gem, 10000 - 7 * STEED.summon.gem);
  assert.equal(r.mats, STEED.summon.mats10);
  // odds: 30,000 single draws on fresh boxes
  const cnt = { rare: 0, epic: 0, legendary: 0, mythic: 0 };
  const rng = makeRng(42);
  const t = newGame(T0); t.wallet.gem = 1e12;
  for (let i = 0; i < 30000; i++) { const x = ST.summon(t, 'wing', 1, rng); cnt[x.results[0].grade]++; }
  const R = STEED.summon.rates;
  assert.ok(Math.abs(cnt.rare / 30000 - R.rare) < 0.02, JSON.stringify(cnt));
  assert.ok(Math.abs(cnt.epic / 30000 - R.epic) < 0.02);
  assert.ok(Math.abs(cnt.mythic / 30000 - R.mythic) < 0.004);
  assert.ok(Math.abs(Object.values(R).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // pity: an rng that always lands on 희귀 → the 60th draw is 전설
  const u = newGame(T0); u.wallet.gem = 1e9;
  const low = () => 0; low.weighted = () => 'rare';
  let pityAt = null;
  for (let i = 1; i <= 60; i++) { const x = ST.summon(u, 'mount', 1, low).results[0]; if (x.pity) pityAt = i; }
  assert.equal(pityAt, STEED.summon.pity);
  assert.equal(u.mounts.pity, 0);
  assert.equal(MOUNTS[Object.keys(u.mounts.owned).find((id) => MOUNTS[id].grade === 'legendary')].grade, 'legendary');
  assert.ok(Object.keys(WINGS).length === 8 && Object.keys(MOUNTS).length === 8);
});

test('탈것·날개 마이그레이션: old saves get empty boxes and wallet keys; broken boxes are repaired', () => {
  const s = newGame(T0);
  delete s.mounts; delete s.wings;
  for (const k of ['mountFood', 'wingFeather', 'mountTicket', 'wingTicket']) delete s.wallet[k];
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(m.mounts, ST.defaultSteeds());
  assert.equal(m.wallet.mountTicket, 0);
  const b = newGame(T0); b.mounts = { owned: { horse: { lv: 3, star: 1, shards: 0 } }, equipped: 'ghost' }; b.wings = 7;
  const m2 = migrate(b);
  assert.equal(m2.mounts.equipped, null); assert.equal(m2.mounts.pity, 0); assert.equal(m2.mounts.owned.horse.lv, 3);
  assert.deepEqual(m2.wings, ST.defaultSteeds());
});

test('탈것 효과: 그리폰 shortens expeditions; todo dot when affordable', async () => {
  const EX = await import('../src/core/expedition.js');
  const s = newGame(T0);
  assert.equal(ST.hasTodo(s, 'mount'), false);
  ST.give(s, 'mount', 'griffin');
  s.wallet.mountFood = 100;
  assert.equal(ST.hasTodo(s, 'mount'), true);
  const cut = ST.equippedBonus(s).expeditionCut;
  assert.ok(cut > 0.09 && cut < 0.11);
  assert.ok(typeof EX.steedBonusOf({ id: 'exp1_0', hours: 4 }).type === 'string');
});

test('Game: steed methods go through transact and persist', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => T0 });
  await g.load();
  await g.transact('qa', (s) => { s.wallet.gem = 5000; s.wallet.wingFeather = 500; return { ok: true }; });
  const r = await g.steedSummon('wing', 10);
  assert.equal(r.ok, true);
  const id = r.results[0].id;
  assert.equal((await g.steedEquip('wing', id)).ok, true);
  assert.equal((await g.steedLevel('wing', id, 10)).ok, true);
  const g2 = new Game({ saver, now: () => T0 });
  await g2.load();
  assert.equal(g2.state.wings.equipped, id);
  assert.equal(g2.state.wings.owned[id].lv, 11);
});
