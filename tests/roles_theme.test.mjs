import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { Battle, SLOT_X } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import * as prog from '../src/core/progression.js';
import { ROLES, PREFIXES } from '../src/data/roles.js';
import { MONSTERS } from '../src/data/content.js';
import * as TH from '../src/core/theme.js';

const T0 = Date.UTC(2026, 10, 9, 3);
function farm({ level = 50, seed = 3, theme = null, cls = 'warrior', range = 'melee', strong = false } = {}) {
  const s = newGame(T0, 7, cls);
  s.player.level = 60;
  if (strong) s.player.statsUpgrades = { atk: 3000, hp: 3000, def: 200, crit: 0, speed: 0 };
  return new Battle({ kind: 'farm', rng: makeRng(seed), hero: { stats: playerStats(s), skills: { ...s.skills, autoCast: true }, branch: null, cls, tier: 0, ult: prog.ultId(s), range, skillLevel: () => 1 },
    farm: { monsters: ['M01', 'M02'], levelFn: () => level, eliteAllowed: () => true, themeFn: theme ? () => theme : undefined } });
}
const spawnMany = (b, n) => { const out = []; for (let i = 0; i < n; i++) { b.spawnFarmEnemy(); out.push(b.enemies.pop()); } return out; };

test('roles open by level: Lv ≤20 돌격만, Lv 21–30 +사수, Lv 31+ 치유사·자폭병', () => {
  const roles = (lv) => new Set(spawnMany(farm({ level: lv }), 300).map((e) => e.role));
  assert.deepEqual([...roles(15)], ['charge']);
  assert.deepEqual([...roles(25)].sort(), ['archer', 'charge']);
  assert.deepEqual([...roles(50)].sort(), ['archer', 'bomber', 'charge', 'healer']);
});

test('elites get exactly one prefix, normals none; bosses and field bosses have no role', () => {
  const list = spawnMany(farm({ level: 50 }), 2000);
  const elites = list.filter((e) => e.elite);
  assert.ok(elites.length > 50);
  assert.ok(elites.every((e) => PREFIXES[e.prefix]));
  assert.ok(list.filter((e) => !e.elite).every((e) => e.prefix === null));
  assert.equal(new Set(elites.map((e) => e.prefix)).size, 5);
  const b = new Battle({ kind: 'boss', rng: makeRng(1), hero: farm().heroCfg, boss: { id: 'B03' } });
  assert.equal(b.enemies[0].role, null);
  const f = farm({ level: 50 });
  const fb = f.spawnFieldBoss(50);
  assert.equal(fb.role, null); assert.equal(fb.prefix, null);
});

test('role stats: 사수 low HP, 돌격 tanky (vs the same monster without role)', () => {
  const b = farm({ level: 50 });
  const base = b.addEnemy(MONSTERS.M01, 50, { plain: true }).maxHp;
  const a = b.addEnemy(MONSTERS.M01, 50, {});
  assert.equal(a.maxHp, Math.max(1, Math.floor(base * ROLES[a.role].hp)));
});

test('치유사 heals the most hurt ally; 자폭병 explodes at the front and dies; 사수 hits at full from the back', () => {
  const b = farm({ level: 50 });
  b.enemies.length = 0; b.nextSpawnAt = Infinity;
  const tank = b.addEnemy(MONSTERS.M01, 50, { plain: true });
  const healer = b.addEnemy(MONSTERS.M02, 50, { plain: true });
  healer.role = 'healer'; healer.healAt = b.t + 4000; healer.atk = 0;
  for (const e of [tank, healer]) { e.x = e.px = SLOT_X[0] + (e === healer ? 46 : 0); e.state = 'ready'; }
  tank.hp = Math.floor(tank.maxHp * 0.3);
  const ev = [];
  b.hero.buffs.invuln = { until: Infinity };
  const hpBefore = tank.hp;
  for (let i = 0; i < 100; i++) { b.enemiesAct(); b.t += 50; ev.push(...b.drainEvents()); }
  assert.ok(ev.some((x) => x.type === 'enemyHeal' && x.by === healer.uid));
  assert.ok(tank.hp > hpBefore);
  // bomber
  const c = farm({ level: 50 });
  c.enemies.length = 0; c.nextSpawnAt = Infinity;
  const bomb = c.addEnemy(MONSTERS.M01, 50, { plain: true });
  bomb.role = 'bomber'; bomb.x = bomb.px = SLOT_X[0]; bomb.state = 'ready'; bomb.nextAttackAt = 0;
  const hp0 = c.hero.hp;
  const ev2 = [];
  for (let i = 0; i < 60 && bomb.state !== 'dying'; i++) { c.t += 50; c.enemiesAct(); ev2.push(...c.drainEvents()); }
  assert.ok(ev2.some((x) => x.type === 'telegraph' && x.blast));
  assert.equal(bomb.state, 'dying');
  assert.ok(c.hero.hp < hp0);
});

test('분열하는 elite splits into two shards; 가시 reflects capped damage', () => {
  const b = farm({ level: 50 });
  b.enemies.length = 0; b.nextSpawnAt = Infinity;
  const e = b.addEnemy(MONSTERS.M01, 50, { plain: true });
  e.prefix = 'split';
  b.kill(e);
  const shards = b.enemies.filter((x) => x.shard);
  assert.equal(shards.length, 2);
  assert.ok(shards.every((x) => x.maxHp === Math.max(1, Math.floor(e.maxHp * 0.25)) && x.role === null && x.prefix === null));
  const t = b.addEnemy(MONSTERS.M01, 50, { plain: true });
  t.prefix = 'thorns'; t.hp = t.maxHp = 1e9;
  const h0 = b.hero.hp;
  b.dealDamage(t, 1e7, { crit: false, action: 'attack', skill: null });
  assert.equal(h0 - b.hero.hp, Math.floor(b.hero.maxHp * PREFIXES.thorns.reflectCap));
});

test('ranged heroes aim at an engaged 치유사 first; melee stays on the front', () => {
  const b = farm({ level: 50, range: 'ranged', cls: 'archer' });
  b.enemies.length = 0;
  const f = b.addEnemy(MONSTERS.M01, 50, { plain: true }); f.x = SLOT_X[0]; f.state = 'ready';
  const h = b.addEnemy(MONSTERS.M02, 50, { plain: true }); h.role = 'healer'; h.x = SLOT_X[2]; h.state = 'ready';
  assert.equal(b.heroFront(), h);
  const m = farm({ level: 50 });
  m.enemies.length = 0;
  const f2 = m.addEnemy(MONSTERS.M01, 50, { plain: true }); f2.x = SLOT_X[0]; f2.state = 'ready';
  const h2 = m.addEnemy(MONSTERS.M02, 50, { plain: true }); h2.role = 'healer'; h2.x = SLOT_X[2]; h2.state = 'ready';
  assert.equal(m.heroFront(), f2);
});

test('theme mods: 화염 ignites on basic attacks; 군단 lowers HP; 사냥꾼 doubles elites', () => {
  const fire = TH.THEMES.find((t) => t.id === 'fire').mod;
  const b = farm({ level: 30, theme: fire });
  const ev = [];
  for (let i = 0; i < 400; i++) { b.step(); ev.push(...b.drainEvents()); }
  assert.ok(ev.some((x) => x.type === 'hit' && x.skill === 'ignite'));
  const swarm = TH.THEMES.find((t) => t.id === 'swarm').mod;
  const plainHp = farm({ level: 20, seed: 9 }).addEnemy(MONSTERS.M01, 20, { plain: true }).maxHp;
  assert.equal(farm({ level: 20, seed: 9, theme: swarm }).addEnemy(MONSTERS.M01, 20, { plain: true }).maxHp, Math.floor(plainHp * 0.8));
  const hunter = TH.THEMES.find((t) => t.id === 'hunter').mod;
  const n0 = spawnMany(farm({ level: 15 }), 4000).filter((e) => e.elite).length;
  const n1 = spawnMany(farm({ level: 15, theme: hunter }), 4000).filter((e) => e.elite).length;
  assert.ok(n1 > n0 * 1.6, `${n1} vs ${n0}`);
});

test('weekly theme rotates every KST Monday through all 6; challenge resets, claims once', () => {
  const ids = [];
  const mon = Date.UTC(2026, 10, 15, 15, 0, 1);   // KST Mon 2026-11-16 00:00:01
  for (let w = 0; w < 6; w++) ids.push(TH.themeFor(mon + w * 7 * 86400000).id);
  assert.equal(new Set(ids).size, 6);
  assert.equal(TH.themeFor(mon - 2000).id !== TH.themeFor(mon).id, true);
  assert.equal(TH.themeFor(mon + 6 * 86400000).id, TH.themeFor(mon).id);
  const s = newGame(T0);
  const th = TH.themeFor(mon);
  TH.track(s, th.challenge.key, th.challenge.goal - 1, mon);
  assert.equal(TH.status(s, mon).canClaim, false);
  assert.equal(TH.claim(s, mon).reason, 'conditions');
  TH.track(s, 'nonsense', 99, mon);
  TH.track(s, th.challenge.key, 5, mon);
  const gem = s.wallet.gem;
  const r = TH.claim(s, mon);
  assert.equal(r.ok, true);
  assert.equal(s.wallet.gem, gem + (th.reward.gem || 0));
  assert.equal(TH.claim(s, mon).reason, 'claimed');
  const next = mon + 7 * 86400000;
  assert.equal(TH.status(s, next).progress, 0);
  assert.equal(TH.status(s, next).claimed, false);
  const m = migrate(JSON.parse(JSON.stringify({ ...newGame(T0), theme: undefined })));
  assert.deepEqual(m.theme, { week: null, id: null, progress: 0, claimed: false });
});
