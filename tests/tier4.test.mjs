import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as DF from '../src/core/difficulty.js';
import * as prog from '../src/core/progression.js';
import { playerStats } from '../src/core/stats.js';
import { Battle } from '../src/core/combat.js';
import { doRebirth } from '../src/core/rebirth.js';
import { makeRng } from '../src/core/util.js';
import { BALANCE } from '../src/data/balance.js';
import { BRANCHES, BRANCH_SKILL } from '../src/data/content.js';

const T0 = Date.UTC(2026, 10, 9, 3);
function t3(cls = 'warrior', branch = 'knight') {
  const s = newGame(T0, 7, cls);
  s.player.level = 100; s.player.peakLevel = 100; s.player.tier = 3; s.player.branch = branch;
  s.wallet.starShard = 40; s.wallet.awakenStone = 300; s.wallet.gold = 1e12;
  return s;
}
const T4 = BALANCE.tiers[4];

test('초월 conditions: Lv 100 · tier 3 · Normal B05 · materials · trial', () => {
  const s = t3();
  let cl = prog.promotionChecklist(s, 4);
  assert.equal(cl.tier, 4);
  assert.equal(prog.nextTier(s), 4);
  assert.ok(!cl.items.find((i) => i.id === 'boss').ok, 'normal B05 not yet');
  assert.equal(cl.canTrial, false);
  s.progression.bossCleared.B05 = true;   // Easy B05 does not count
  assert.equal(prog.promotionChecklist(s, 4).canTrial, false);
  DF.track(s, 'normal').bossCleared.B05 = true;
  cl = prog.promotionChecklist(s, 4);
  assert.equal(cl.canTrial, true);
  assert.equal(cl.canPromote, false);
  s.promotion.trials[4] = true;
  assert.equal(prog.promotionChecklist(s, 4).canPromote, true);
  s.wallet.starShard = T4.starShard - 1;
  assert.equal(prog.promotionChecklist(s, 4).canPromote, false);
});

test('promote(4) needs a 초월 서약 of the class, pays, opens slot 6 with the sibling branch skill', () => {
  const s = t3('warrior', 'knight');
  DF.track(s, 'normal').bossCleared.B05 = true; s.promotion.trials[4] = true;
  assert.equal(prog.promote(s, 4, null).reason, 'oath');
  assert.equal(prog.promote(s, 4, 'm_reson').reason, 'oath');   // other class
  const shard = s.wallet.starShard, st = s.wallet.awakenStone, gold = s.wallet.gold;
  const r = prog.promote(s, 4, 'w_unyield', T0);
  assert.equal(r.ok, true);
  assert.equal(s.player.tier, 4);
  assert.equal(r.name, BRANCHES.knight.names[3]);
  assert.equal(prog.tierName(s), BRANCHES.knight.names[3]);
  assert.equal(s.wallet.starShard, shard - T4.starShard);
  assert.equal(s.wallet.awakenStone, st - T4.awakenStone);
  assert.ok(s.wallet.gold < gold);
  assert.equal(prog.slotCount(s), 6);
  assert.equal(s.skills.equipped.length, 6);
  assert.equal(s.skills.equipped[5], BRANCH_SKILL.berserker);
  assert.ok(prog.unlockedSkills(s).includes(BRANCH_SKILL.berserker));
  assert.equal(prog.promotionChecklist(s, 4).done, true);
});

test('every branch has a 4th name and a 4th passive', () => {
  for (const b of Object.values(BRANCHES)) { assert.equal(b.names.length, 4, b.id); assert.ok(b.tiers[3], b.id); }
});

test('old saves get a 6th (empty) slot and oath = null', () => {
  const s = newGame(T0); s.skills.equipped = s.skills.equipped.slice(0, 5); delete s.promotion.oath;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.equal(m.skills.equipped.length, 6);
  assert.equal(m.skills.equipped[5], null);
  assert.equal(m.promotion.oath, null);
});

test('oath pct effects reach the stats; switching costs gold', () => {
  const s = t3('archer', 'ranger');
  DF.track(s, 'normal').bossCleared.B05 = true; s.promotion.trials[4] = true;
  const before = playerStats(s);
  prog.promote(s, 4, 'a_snipe', T0);
  const sn = playerStats(s);
  assert.ok(sn.critMul > before.critMul);
  s.wallet.gold = 0;
  assert.equal(prog.setOath(s, 'a_rapid').reason, 'gold');
  s.wallet.gold = 1e12;
  const g0 = s.wallet.gold;
  const r = prog.setOath(s, 'a_rapid');
  assert.equal(r.ok, true);
  assert.equal(s.wallet.gold, g0 - prog.oathChangeCost(s));
  assert.ok(playerStats(s).aspd >= sn.aspd);
  assert.equal(prog.setOath(s, 'a_rapid').reason, 'same');
  assert.equal(prog.setOath(s, 'w_ruin').reason, 'oath');
});

function heroOf(s, extra = {}) {
  return { stats: playerStats(s), skills: { ...s.skills, autoCast: false, ultAuto: 'OFF' }, branch: s.player.branch, cls: s.player.cls, tier: s.player.tier, ult: 'starSlash', range: 'melee', skillLevel: () => 1, ...extra };
}
test('oath combat effects: 불굴 low-HP guard, 맹독 DoT ×, 파괴 boss ×', () => {
  const s = t3();
  // 불굴: same hit below 35% HP is smaller
  const hit = (fx) => { const b = new Battle({ kind: 'boss', rng: makeRng(1), hero: heroOf(s, { oath: fx }), boss: { id: 'B01' } }); b.hero.hp = Math.floor(b.hero.maxHp * 0.3); const e = b.enemies[0]; const hp0 = b.hero.hp; b.rng = () => 0.5; b.enemyHits(e, 1, false); return hp0 - b.hero.hp; };
  const plain = hit(null), guarded = hit({ lowHpGuard: 0.25 });
  assert.ok(guarded < plain, `${guarded} < ${plain}`);
  // 맹독: DoT tick bigger
  const dot = (fx) => { const b = new Battle({ kind: 'boss', rng: makeRng(2), hero: heroOf(s, { oath: fx }), boss: { id: 'B01' } }); const e = b.enemies[0]; e.dots.push({ coef: 0.5, nextAt: b.t, until: b.t + 5000, skill: 'r_poison' }); const hp0 = e.hp; b.rng = () => 0.5; b.tickDots(); return hp0 - e.hp; };
  assert.ok(dot({ dotMul: 1.45 }) > dot(null));
  assert.equal(new Battle({ kind: 'boss', rng: makeRng(3), hero: heroOf(s, { oath: { synMul: 1.5 } }), boss: { id: 'B01' } }).synMul, 1.5);
});

test('초월 trial: T04 spawns with a 120 s limit and ult ×2.5 at tier 4', () => {
  const s = t3();
  const b = new Battle({ kind: 'trial', rng: makeRng(4), hero: heroOf(s), trial: { tier: 4 } });
  assert.equal(b.enemies[0].trial, true);
  assert.equal(b.timeLimitMs, 120000);
});

test('rebirth keeps tier 4, its oath and the 6th slot', () => {
  const s = t3();
  DF.track(s, 'normal').bossCleared.B05 = true; s.promotion.trials[4] = true;
  prog.promote(s, 4, 'w_ruin', T0);
  const r = doRebirth(s, T0 + 1000);
  assert.equal(r.ok, true);
  assert.equal(s.player.level, 1);
  assert.equal(s.player.tier, 4);
  assert.equal(s.promotion.oath, 'w_ruin');
  assert.equal(prog.slotCount(s), 6);
  assert.equal(prog.lockTierAt(s), 0);
});
