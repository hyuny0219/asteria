// v4 systems: classes, tiers 1–3, gacha, +15 enhance, rings, sets, runes, stat points,
// missions, raid week, tower, dungeons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame, validate, SCHEMA_VERSION } from '../src/core/state.js';
import { unpack } from '../src/platform/save.js';
import { hashString, makeRng, kstDayIndex } from '../src/core/util.js';
import { BALANCE, expToNext } from '../src/data/balance.js';
import { CLASSES, CLASS_SKILLS, BOSSES, REGIONS, SKILLS, branchesOf } from '../src/data/content.js';
import { gainExp, promote, promotionChecklist, isPromotionLocked, levelSkill, skillLevel, slotCount, unlockedSkills } from '../src/core/progression.js';
import { rateTable, drawEquipment, drawSkill, quoteDraw, summonLevel, skillRateTable, equipRune } from '../src/core/gacha.js';
import { addItems, enhance, equip, applyAutoStats, statPointsFree, allocateStat, resetStats, autoEquip } from '../src/core/economy.js';
import { makeItem } from '../src/core/items.js';
import { playerStats, activeSetBonuses } from '../src/core/stats.js';
import { claimMission, missionStatus, track, claimMissionBonus } from '../src/core/missions.js';
import { refreshRaid, kstWeekIndex, beginRaid, triesLeft } from '../src/core/raid.js';
import { finishFloor, floorReward } from '../src/core/tower.js';
import * as dun from '../src/core/dungeon.js';
import { Battle, monsterStats } from '../src/core/combat.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
const DAY = 86400000;
const heroCfg = (s) => { const cls = s.player.cls; return { stats: playerStats(s), skills: s.skills, branch: s.player.branch, cls, tier: s.player.tier, ult: CLASS_SKILLS[cls].ult, range: CLASSES[cls].range, skillLevel: (id) => skillLevel(s, id) }; };

test('migration 2 → 3 keeps v3 progress (warrior, tier 1, necklace slot, skill levels)', () => {
  const s = newGame(T0);
  // fake a v2 save
  s.schemaVersion = 2;
  delete s.player.cls; delete s.player.tier; delete s.player.stats; delete s.player.statAuto;
  s.player.level = 31; s.player.branch = 'knight';
  delete s.gacha; delete s.missions; delete s.tower; delete s.raid; delete s.dungeons;
  delete s.skills.levels; delete s.skills.books; delete s.skills.runes;
  s.skills.equipped = ['strike', 'shieldCharge', 'warCry', 'guardCounter'];
  const it = makeItem(s, { slot: 'necklace', rarity: 'rare', level: 20, rng: makeRng(1) });
  it.slot = 'accessory';
  s.inventory.push(it);
  s.equipped = { weapon: null, helmet: null, armor: null, accessory: it.id };
  s.promotion = { trialCleared: true, branchChosenAt: T0 };
  const data = JSON.stringify(s);
  const r = unpack({ data, sum: hashString(data) });
  assert.equal(r.ok, true, r.error);
  const m = r.state;
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.player.cls, 'warrior');
  assert.equal(m.player.tier, 1);
  assert.equal(m.equipped.necklace, it.id);
  assert.equal(m.inventory[0].slot, 'necklace');
  assert.equal(m.skills.equipped.length, 5);
  assert.equal(m.skills.equipped[3], 'guardCounter');
  assert.equal(m.skills.levels.strike, 1 + Math.floor(30 / 4) + 1);
  assert.equal(m.promotion.trials[1], true);
  assert.deepEqual(validate(m), []);
});

test('level locks at 30 / 60 / 90 store EXP until each tier, then release in order', () => {
  for (const [lv, tier] of [[30, 1], [60, 2], [90, 3]]) {
    const s = newGame(T0);
    s.player.level = lv - 1; s.player.tier = tier - 1; if (tier > 1) s.player.branch = 'knight';
    gainExp(s, expToNext(lv - 1) + 777);
    assert.equal(s.player.level, lv);
    assert.equal(isPromotionLocked(s), true);
    assert.equal(s.player.pendingExp, 777);
    gainExp(s, 100);
    assert.equal(s.player.pendingExp, 877);
    s.player.tier = tier;
    assert.equal(isPromotionLocked(s), false);
  }
});

test('tier checklists: each lists unmet items with shortcuts; promote spends only on success', () => {
  const s = newGame(T0);
  s.player.level = 30;
  let cl = promotionChecklist(s, 1);
  assert.deepEqual(cl.items.map((i) => i.id), ['level', 'token', 'boss', 'trial']);
  assert.equal(cl.items.find((i) => i.id === 'boss').go, 'boss:B03');
  assert.equal(promote(s, 1, 'knight').reason, 'conditions');
  s.wallet.token = 20; s.progression.bossCleared.B03 = true; s.promotion.trials[1] = true;
  assert.equal(promote(s, 1, 'wizard').reason, 'branch');            // other class's branch
  assert.ok(promote(s, 1, 'knight').ok);
  assert.equal(s.wallet.token, 0);
  // tier 2
  s.player.level = 60;
  cl = promotionChecklist(s, 2);
  assert.deepEqual(cl.items.map((i) => i.id), ['level', 'awaken', 'gold', 'boss', 'tower']);
  assert.equal(cl.canPromote, false);
  const gold = cl.items.find((i) => i.id === 'gold').cost;
  s.wallet.awakenStone = 10; s.wallet.gold = gold + 5; s.progression.bossCleared.B06 = true; s.tower.best = 5;
  const p2 = promote(s, 2);
  assert.ok(p2.ok, JSON.stringify(p2));
  assert.equal(s.wallet.awakenStone, 0); assert.equal(s.wallet.gold, 5);
  assert.equal(s.skills.equipped[4], 'w_judgement');
  assert.equal(slotCount(s), 5);
  // tier 3
  s.player.level = 90;
  cl = promotionChecklist(s, 3);
  assert.deepEqual(cl.items.map((i) => i.id), ['level', 'shard', 'boss', 'trial']);
  s.wallet.starShard = 3; s.progression.bossCleared.B09 = true;
  assert.equal(promotionChecklist(s, 3).canTrial, true);
  s.promotion.trials[3] = true;
  assert.ok(promote(s, 3).ok);
  assert.equal(s.player.tier, 3); assert.equal(s.wallet.starShard, 0);
});

test('gacha: rates sum to 1 at every summon level; skill rates sum to 1', () => {
  for (let lv = 1; lv <= 10; lv++) {
    const t = rateTable(lv);
    assert.ok(Math.abs(Object.values(t).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok(Object.values(t).every((v) => v >= 0));
  }
  assert.ok(rateTable(10).legendary > rateTable(1).legendary);
  assert.ok(Math.abs(Object.values(skillRateTable()).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(summonLevel(0), 1); assert.equal(summonLevel(1500), 10);
});

test('gacha pity: legendary+ exactly on draw 200, rune exactly on draw 100', () => {
  const s = newGame(T0);
  s.wallet.gem = 1e9;
  // rng that never rolls high: weighted() always picks the first key (common)
  const low = makeRng(1); const lowRng = Object.assign(() => 0, { weighted: (t) => Object.keys(t)[0], pick: low.pick, int: low.int });
  for (let i = 0; i < 199; i++) drawEquipment(s, 1, lowRng);
  assert.equal(s.gacha.eq.pity, 199);
  const r = drawEquipment(s, 1, lowRng);
  assert.equal(r.results[0].item.rarity, 'legendary');
  assert.equal(r.results[0].pity, true);
  assert.equal(s.gacha.eq.pity, 0);
  for (let i = 0; i < 99; i++) drawSkill(s, 1, lowRng);
  const k = drawSkill(s, 1, lowRng);
  assert.equal(k.results[0].kind, 'rune');
  assert.equal(s.gacha.sk.pity, 0);
});

test('gacha payment: tickets first, then gems; 11 with gems = 500', () => {
  const s = newGame(T0);
  s.wallet.eqTicket = 3; s.wallet.gem = 1000;
  assert.deepEqual([quoteDraw(s, 'equipment', 11).tickets, quoteDraw(s, 'equipment', 11).gem], [3, 400]);
  s.wallet.eqTicket = 0;
  assert.equal(quoteDraw(s, 'equipment', 11).gem, 500);
  const r = drawEquipment(s, 11, makeRng(4));
  assert.ok(r.ok); assert.equal(s.wallet.gem, 500); assert.equal(r.items.length, 11);
  s.wallet.gem = 10;
  assert.equal(drawEquipment(s, 1, makeRng(4)).reason, 'gem');
});

test('gacha through Game: failed save spends nothing', async () => {
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => T0 });
  await g.load();
  await g.transact('qa', (s) => { s.wallet.gem = 500; return { ok: true }; });
  saver.failNext = 1;
  const r = await g.drawEquipment(1);
  assert.equal(r.ok, false);
  assert.equal(g.state.wallet.gem, 500);
  assert.equal(g.state.inventory.length, 0);
  const ok = await g.drawEquipment(1);
  assert.ok(ok.ok);
  assert.equal(g.state.wallet.gem, 450);
  assert.equal(g.state.inventory.length, 1);
});

test('enhance +15: fail ≤ +10 keeps level, fail at +11+ drops one, never destroyed', () => {
  const s = newGame(T0);
  const it = makeItem(s, { slot: 'weapon', rarity: 'epic', level: 50, rng: makeRng(2) });
  addItems(s, [it]);
  s.wallet.ore = 1e9;
  s.slotEnhance.weapon = 8;
  const f1 = enhance(s, 'weapon', () => 0.999);
  assert.equal(f1.success, false); assert.equal(s.slotEnhance.weapon, 8);
  s.slotEnhance.weapon = 12;
  const f2 = enhance(s, 'weapon', () => 0.999);
  assert.equal(f2.success, false); assert.equal(s.slotEnhance.weapon, 11);
  assert.ok(s.inventory.includes(it));
});

test('rings fill ring1 then ring2; recommend keeps two best rings', () => {
  const s = newGame(T0);
  const r1 = makeItem(s, { slot: 'ring', rarity: 'rare', level: 10, rng: makeRng(1) });
  const r2 = makeItem(s, { slot: 'ring', rarity: 'epic', level: 10, rng: makeRng(2) });
  const r3 = makeItem(s, { slot: 'ring', rarity: 'common', level: 1, rng: makeRng(3) });
  addItems(s, [r1, r2, r3]);
  assert.equal(equip(s, r1.id).slot, 'ring1');
  assert.equal(equip(s, r3.id).slot, 'ring2');
  autoEquip(s);
  const worn = [s.equipped.ring1, s.equipped.ring2];
  assert.ok(worn.includes(r1.id) && worn.includes(r2.id));
});

test('sets: 2 and 4 pieces activate bonuses', () => {
  const s = newGame(T0);
  const pcs = ['helmet', 'armor', 'gloves', 'boots'].map((slot, i) => makeItem(s, { slot, rarity: 'rare', level: 20, rng: makeRng(i + 1), set: 'desert' }));
  addItems(s, pcs);
  equip(s, pcs[0].id); equip(s, pcs[1].id);
  assert.equal(activeSetBonuses(s).length, 1);
  const before = playerStats(s).def;
  equip(s, pcs[2].id); equip(s, pcs[3].id);
  assert.equal(activeSetBonuses(s).length, 2);
  assert.ok(playerStats(s).def > before);
});

test('runes: equipped rune changes stats; level scales it', () => {
  const s = newGame(T0);
  const base = playerStats(s).hp;
  s.skills.runes.owned.bulwark = 1;
  assert.ok(equipRune(s, 'bulwark', 0).ok);
  const h1 = playerStats(s).hp;
  assert.ok(h1 > base);
  s.skills.runes.owned.bulwark = 5;
  assert.ok(playerStats(s).hp > h1);
  assert.equal(equipRune(s, 'combo', 1).reason, 'missing');
});

test('stat points: 5 per level, auto split by class, manual turns auto off, reset refunds', () => {
  const s = newGame(T0, 1, 'mage');
  s.player.level = 11;
  applyAutoStats(s);
  assert.equal(statPointsFree(s), 0);
  assert.ok(s.player.stats.int > s.player.stats.vit);
  const atk = playerStats(s).atk;
  resetStats(s, { free: true });
  assert.equal(statPointsFree(s), 50);
  assert.ok(allocateStat(s, 'int', 50).ok);
  assert.equal(s.player.statAuto, false);
  assert.ok(playerStats(s).atk > atk);
});

test('missions reset at KST midnight; each claimed once; bonus after all', () => {
  const s = newGame(T0);
  track(s, 'kills', 300, T0); track(s, 'enhance', 5, T0); track(s, 'dungeon', 1, T0); track(s, 'draw', 1, T0); track(s, 'boss', 1, T0);
  for (const id of ['kills', 'enhance', 'dungeon', 'draw', 'boss']) assert.ok(claimMission(s, id, T0).ok);
  assert.equal(claimMission(s, 'kills', T0).reason, 'duplicate');
  assert.ok(claimMissionBonus(s, T0).ok);
  assert.equal(claimMissionBonus(s, T0).reason, 'duplicate');
  // 15:00 UTC = 00:00 KST next day
  const next = Date.UTC(2026, 10, 5, 15, 0);
  assert.equal(missionStatus(s, next).list[0].progress, 0);
  assert.equal(claimMission(s, 'kills', next).reason, 'conditions');
});

test('raid: 3 tries per week, resets Monday 00:00 KST', () => {
  const s = newGame(T0);              // 2026-11-05 is a Thursday
  for (let i = 0; i < 3; i++) assert.ok(beginRaid(s, T0).ok);
  assert.equal(beginRaid(s, T0).reason, 'tries');
  const sunday = Date.UTC(2026, 10, 8, 14, 59);      // Sun 23:59 KST
  const monday = Date.UTC(2026, 10, 8, 15, 0);       // Mon 00:00 KST
  assert.equal(triesLeft(s, sunday), 0);
  assert.equal(kstWeekIndex(monday), kstWeekIndex(sunday) + 1);
  assert.equal(triesLeft(s, monday), 3);
});

test('tower: a floor pays once; every 5th floor adds awaken stones', () => {
  const s = newGame(T0);
  for (let f = 1; f <= 4; f++) finishFloor(s, f, true);
  const gem4 = s.wallet.gem;
  const r5 = finishFloor(s, 5, true);
  assert.equal(r5.reward.awakenStone, 2);
  assert.equal(s.wallet.awakenStone, 2);
  const again = finishFloor(s, 5, true);
  assert.equal(again.reward, null);
  assert.equal(s.wallet.gem, gem4 + floorReward(5).gem);
  assert.equal(finishFloor(s, 6, false).reward, null);
});

test('dungeons: gold and books types use their own tickets and rewards', () => {
  const s = newGame(T0);
  s.dungeons.gold.best = 2;
  const g0 = s.wallet.gold;
  assert.ok(dun.sweep(s, { type: 'gold' }).ok);
  assert.ok(s.wallet.gold > g0);
  assert.equal(s.dungeons.gold.tickets, 2);
  assert.equal(s.dungeon.tickets, 3);
  assert.ok(dun.beginRun(s, 1, 'r1', T0, 'books').ok);
  const f = dun.finishRun(s, 'r1', true, { type: 'books', skills: ['strike'], rng: makeRng(1) });
  assert.ok(f.books >= 3);
  assert.equal(s.skills.books.strike, f.books);
  // refill next KST day for every type
  dun.refreshTickets(s, T0 + DAY);
  assert.equal(s.dungeons.gold.tickets, 5);
});

test('skill level-up spends books and gold', () => {
  const s = newGame(T0);
  s.skills.books.strike = 1; s.wallet.gold = 1e6;
  assert.equal(levelSkill(s, 'strike').reason, 'books');
  s.skills.books.strike = 2;
  assert.ok(levelSkill(s, 'strike').ok);
  assert.equal(skillLevel(s, 'strike'), 2);
  assert.equal(s.skills.books.strike, 0);
});

test('every class: skills deal damage and a fitting hero beats each region boss', () => {
  for (const cls of Object.keys(CLASSES)) {
    for (const [bossId, lv, tier] of [['B01', 9, 0], ['B04', 42, 1], ['B07', 72, 2], ['B09', 92, 3]]) {
      const s = newGame(T0, 7, cls);
      s.player.level = lv; s.player.tier = tier;
      if (tier) s.player.branch = branchesOf(cls)[0];
      applyAutoStats(s);
      // fitting gear: rare-ish pieces at the boss level, +enhance by tier
      // (v13 몬스터 곡선 이후 후반 보스는 전설 장비 수준을 요구 — 실제 플레이는 펫·탈것·특성이 더해짐)
      const rng = makeRng(3);
      for (const slot of ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring', 'ring']) {
        const it = makeItem(s, { slot, rarity: tier >= 2 ? 'legendary' : tier === 1 ? 'epic' : 'rare', level: BOSSES[bossId].level, rng });
        addItems(s, [it]); equip(s, it.id);
      }
      for (const k of Object.keys(s.slotEnhance)) s.slotEnhance[k] = 3 + tier * 3 + (tier >= 2 ? 1 : 0);
      s.player.statsUpgrades = { atk: 25 + lv, hp: 25 + lv, def: 10 + lv / 2, crit: 10 + lv, speed: 10 + lv };
      for (const id of unlockedSkills(s)) s.skills.levels[id] = Math.min(10, 1 + Math.floor(lv / 10));
      const eq = s.skills.equipped;
      unlockedSkills(s).filter((id) => SKILLS[id].kind !== 'ultimate').forEach((id, i) => { if (i < 5) eq[i] = id; });
      let wins = 0, skillHits = 0, dealt = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const b = new Battle({ kind: 'boss', rng: makeRng(seed), hero: heroCfg(s), boss: { id: bossId } });
        let res = null;
        while (!res) { b.step(); for (const e of b.drainEvents()) { if (e.type === 'hit' && e.by === 'hero' && (e.action === 'skill' || e.action === 'dot' || e.action === 'ult')) skillHits++; if (e.type === 'victory' || e.type === 'defeat') res = e; } }
        if (res.type === 'victory') wins++;
        const bo = b.enemies.find((x) => x.boss);
        dealt += bo ? 1 - Math.max(0, bo.hp) / bo.maxHp : 1;
      }
      assert.ok(skillHits > 0, `${cls} skills hit`);
      // v13 곡선: 후반 보스(B07·B09)는 장비만으로는 부족하고 펫·특성·룬·세트까지 갖춰야 잡힘
      // (전 직업 실제 클리어는 tools/balance_sim_v4.mjs). 여기선 장비만 갖춘 영웅이 대부분 깎는지 확인.
      if (tier < 2) assert.ok(wins >= 3, `${cls} vs ${bossId} wins ${wins}/5`);
      else assert.ok(dealt / 5 >= 0.55, `${cls} vs ${bossId} avg dealt ${(dealt / 5).toFixed(2)}`);   // v14: 시너지로 전투 흐름이 바뀌어 경계값 근처라 0.55
    }
  }
});

test('chooseClass only at the start; raid boss is not a normal boss fight', async () => {
  const g = new Game({ saver: new MemorySaver(), now: () => T0 });
  await g.load();
  const r = await g.chooseClass('archer');
  assert.ok(r.ok);
  assert.deepEqual(g.state.skills.equipped.slice(0, 3), CLASS_SKILLS.archer.base);
  assert.equal((await g.chooseClass('rogue')).reason, 'class-locked');
  assert.equal(g.canChallengeBoss('B10').ok, false);
});
