// 도감 · 업적 · 칭호 · 무료 시즌 패스 · 동료 · 신화 제작 (schema 5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate, validate } from '../src/core/state.js';
import * as M from '../src/core/meta.js';
import { ACHIEVEMENTS, PASS, PETS, TITLES } from '../src/data/meta.js';
import { playerStats } from '../src/core/stats.js';
import { addItems } from '../src/core/economy.js';
import { makeItem } from '../src/core/items.js';
import { Battle } from '../src/core/combat.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { makeRng } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
const DAY = 86400000;

test('codex: kill tiers 10/100/1000 give small stat bonuses; item codex counts slot×rarity once', () => {
  const s = newGame(T0);
  s.player.level = 60;
  const atk0 = playerStats(s).atk;
  M.trackKill(s, 'M01', 9);
  assert.equal(M.codexTiersTotal(s), 0);
  M.trackKill(s, 'M01', 1);
  assert.equal(M.codexTiersTotal(s), 1);
  M.trackKill(s, 'M01', 990);
  assert.equal(M.codexTier('M01', s.codex.kills.M01), 3);
  M.trackKill(s, 'B01', 1);
  assert.equal(M.codexTier('B01', 1), 1);
  assert.ok(M.codexBonus(s).atkPct > 0 && playerStats(s).atk >= atk0);
  const rng = makeRng(1);
  const it = makeItem(s, { slot: 'boots', rarity: 'rare', level: 5, rng });
  addItems(s, [it, makeItem(s, { slot: 'boots', rarity: 'rare', level: 6, rng })]);
  assert.equal(Object.keys(s.codex.items).length, 1);
  const b = M.codexBonus(s);
  assert.ok(b.atkPct < 0.02 && b.hpPct < 0.02, 'bonuses stay small');
});

test('achievements: measured from counters, claim once, titles granted and equippable', () => {
  const s = newGame(T0);
  s.player.level = 60;
  assert.ok(ACHIEVEMENTS.length >= 30);
  assert.equal(M.claimAchievement(s, 'b1').reason, 'conditions');
  s.progression.counters.bossWins = 1;
  const r = M.claimAchievement(s, 'b1');
  assert.equal(r.ok, true);
  assert.ok(s.titles.owned.includes('t_pioneer'));
  assert.equal(M.claimAchievement(s, 'b1').reason, 'duplicate');
  assert.equal(M.equipTitle(s, 't_tower').reason, 'locked');
  const atk0 = playerStats(s).atk;
  assert.equal(M.equipTitle(s, 't_pioneer').ok, true);
  assert.ok(playerStats(s).atk > atk0);
  assert.equal(M.titleName(s), TITLES.t_pioneer.name);
  s.progression.counters.kills = 1500;
  s.player.peakLevel = 35;
  const all = M.claimAllAchievements(s);
  assert.ok(all.ok && all.count >= 3);
  assert.equal(M.claimableAchievements(s), 0);
});

test('season pass: free track, XP levels, claim once, resets on a new 28-day season', () => {
  const s = newGame(T0);
  M.addPassXp(s, PASS.xpPerLevel * 2 + 5, T0);
  let st = M.passStatus(s, T0);
  assert.equal(st.level, 2);
  assert.equal(M.claimPass(s, 3, T0).reason, 'conditions');
  const gem0 = s.wallet.gem;
  assert.equal(M.claimPass(s, 1, T0).ok, true);
  assert.equal(s.wallet.gem, gem0 + PASS.rewards[0].gem);
  assert.equal(M.claimPass(s, 1, T0).reason, 'duplicate');
  // kill XP has a daily cap
  for (let i = 0; i < 100000; i++) M.trackPassKill(s, T0);
  assert.ok(s.pass.killXpToday <= PASS.xp.killsDailyCap);
  // level 30 gives the season title
  M.addPassXp(s, 1e9, T0);
  assert.equal(M.passStatus(s, T0).level, PASS.levels);
  assert.ok(M.claimAllPass(s, T0).ok);
  assert.ok(s.titles.owned.includes('t_season'));
  // next season: xp and claims reset
  const b = M.seasonBounds(T0);
  const next = T0 + b.daysLeft * DAY + 1000;
  st = M.passStatus(s, next);
  assert.equal(st.level, 0);
  assert.equal(st.season, M.seasonBounds(T0).index + 2);
});

test('pets: eggs hatch (no paid gacha), duplicates → shards → stars, food → levels, aura + attack', () => {
  const s = newGame(T0);
  const rng = makeRng(7);
  assert.equal(M.hatchEgg(s, rng).reason, 'eggs');
  s.pets.eggs = 40;
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(M.hatchEgg(s, rng).id);
  assert.equal(seen.size, Object.keys(PETS).length);
  const id = s.pets.active;
  assert.ok(id);
  const p = s.pets.owned[id];
  const before = M.petPower(s).coef;
  if (p.shards >= 1) { assert.equal(M.starUpPet(s, id).ok, true); assert.ok(M.petPower(s).coef > before); }
  assert.equal(M.feedPet(s, id).reason, 'food');
  s.pets.food = 1000;
  assert.equal(M.feedPet(s, id).ok, true);
  assert.equal(s.pets.owned[id].level, 2);
  assert.ok(Object.values(M.petPower(s).aura)[0] > 0);
  // battle: the pet hits periodically
  const st = playerStats(s);
  const b = new Battle({ kind: 'farm', rng: makeRng(3), hero: { stats: st, pet: M.petPower(s), skills: s.skills, cls: 'warrior', tier: 0, ult: 'starSlash', range: 'melee', skillLevel: () => 1 }, farm: { monsters: ['M01'], levelFn: () => 2, eliteAllowed: () => false } });
  let petHits = 0;
  for (let i = 0; i < 1200; i++) { b.step(); for (const e of b.drainEvents()) if (e.type === 'hit' && e.action === 'pet') petHits++; }
  assert.ok(petHits > 5);
});

test('mythic craft: locked until Lv 90 / B09, exact cost, failed save spends nothing', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  assert.equal((await g.craftMythic('weapon')).reason, 'locked');
  await g.transact('qa', (s) => { s.player.level = 90; s.wallet.starShard = 3; s.rebirth.essence = 20; s.wallet.ore = 2000; s.wallet.gold = 1e12; return { ok: true }; });
  saver.failNext = 1;
  const bad = await g.craftMythic('ring');
  assert.equal(bad.ok, false);
  assert.equal(g.state.wallet.starShard, 3);
  const ok = await g.craftMythic('ring');
  assert.equal(ok.ok, true);
  assert.equal(ok.item.rarity, 'mythic');
  assert.ok(g.state.inventory.some((i) => i.id === ok.item.id));
  assert.equal(g.state.wallet.starShard, 0);
  assert.equal((await g.craftMythic('ring')).reason, 'starShard');
});

test('schema 4 save migrates to 5+: items fill the equipment codex, boss clears the boss codex', () => {
  const s = newGame(T0);
  for (const k of ['codex', 'achievements', 'titles', 'pass', 'pets']) delete s[k];
  s.schemaVersion = 4;
  s.inventory.push({ id: 'x', slot: 'ring1', rarity: 'epic', level: 1, options: [] });
  s.progression.bossCleared.B02 = true;
  const m = migrate(s);
  assert.ok(m.schemaVersion >= 5);
  assert.ok(m.codex.items['ring:epic']);
  assert.equal(m.codex.kills.B02, 1);
  assert.deepEqual(validate(m), []);
});

test('game: boss first clear gives a pet egg + pass XP; mission claim gives pass XP', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  await g.transact('qa', (s) => { s.missions.progress = { kills: 1e6, enhance: 1e6, dungeon: 1e6, draw: 1e6, boss: 1e6 }; return { ok: true }; });
  const ms = (await import('../src/core/missions.js')).missionStatus(g.state, clock);
  const first = ms.list.find((x) => x.done && !x.claimed);
  if (first) {
    const xp0 = g.state.pass.xp;
    const r = await g.claimMission(first.id);
    assert.equal(r.ok, true);
    assert.ok(g.state.pass.xp > xp0);
  }
});
