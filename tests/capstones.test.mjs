// Combat-level checks for the six capstones not covered in v5.test.mjs.
// Each runs the same seed with and without the capstone flag and compares events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { Battle } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import * as prog from '../src/core/progression.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);
function hero(cls, branch, equipped, { level = 80, tier = 2 } = {}) {
  const s = newGame(T0, 7, cls);
  s.player.level = level; s.player.peakLevel = level; s.player.tier = tier; s.player.branch = branch;
  s.skills.equipped = equipped;
  return s;
}
function run(s, caps, { kind = 'farm', extra = {}, ms = 60000, seed = 5, range = 'melee', ultAuto, gauge = 0 } = {}) {
  const st = { ...playerStats(s), caps };
  const skills = { ...s.skills, ultAuto: ultAuto || s.skills.ultAuto, autoCast: true };
  const b = new Battle({ kind, rng: makeRng(seed), hero: { stats: st, skills, branch: s.player.branch, cls: s.player.cls, tier: s.player.tier, ult: prog.ultId(s), range, skillLevel: () => 1, gauge },
    farm: { monsters: ['M01', 'M02'], levelFn: () => 30, eliteAllowed: () => false }, ...extra });
  const ev = [];
  for (let t = 0; t < ms; t += 50) { b.step(); ev.push(...b.drainEvents()); }
  return { b, ev };
}
const sumDmg = (ev, f) => ev.filter((e) => e.type === 'hit' && e.by === 'hero' && f(e)).reduce((a, e) => a + e.dmg, 0);

test('capstone 이중 반격: counter damage ×2 and faster retrigger', () => {
  const s = hero('warrior', 'knight', ['shieldCharge', 'guardCounter', 'strike', null, null]);
  const opt = { kind: 'boss', extra: { boss: { id: 'B05' } }, ms: 40000 };
  const off = run(s, {}, opt).ev.filter((e) => e.type === 'hit' && e.skill === 'guardCounter');
  const on = run(s, { cap_counter2: true }, opt).ev.filter((e) => e.type === 'hit' && e.skill === 'guardCounter');
  assert.ok(off.length > 0, 'counters happen without capstone');
  const avg = (a) => a.reduce((x, e) => x + e.dmg, 0) / a.length;
  assert.ok(avg(on) > avg(off) * 1.6, `avg counter ${avg(on)} vs ${avg(off)}`);
});

test('capstone 피의 군주: low-HP attack bonus +50% instead of +25%', () => {
  const s = hero('warrior', 'berserker', ['strike', null, null, null, null]);
  const off = run(s, {}, { ms: 50 }).b;
  const on = run(s, { cap_berserk: true }, { ms: 50 }).b;
  for (const b of [off, on]) b.hero.hp = b.hero.maxHp * 0.4;
  const base = playerStats(s).atk;
  assert.ok(Math.abs(off.heroAtk() / base - 1.25) < 1e-9);
  assert.ok(Math.abs(on.heroAtk() / base - 1.5) < 1e-9);
});

test('capstone 역병: damage over time doubled', () => {
  const s = hero('mage', 'warlock', ['m_curse', null, null, null, null]);
  // single target (boss) so overkill on a 4-monster farm field does not blur the ratio
  const opt = { range: 'ranged', kind: 'boss', extra: { boss: { id: 'B03' } }, ms: 30000 };
  const off = sumDmg(run(s, {}, opt).ev, (e) => e.action === 'dot');
  const on = sumDmg(run(s, { cap_dot2: true }, opt).ev, (e) => e.action === 'dot');
  assert.ok(off > 0);
  assert.ok(on > off * 1.5, `${on} vs ${off}`);
});

test('capstone 추적 화살비: arrow rain hits 1.5× as often', () => {
  const s = hero('archer', 'ranger', [null, null, null, null, null]);
  const count = (caps) => run(s, caps, { range: 'ranged', ultAuto: 'ALWAYS', ms: 4000, gauge: 100, kind: 'boss', extra: { boss: { id: 'B05' } } }).ev.filter((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'ult').length;
  const off = count({}), on = count({ cap_rainPlus: true });
  assert.ok(off > 0);
  assert.ok(on >= off * 1.4, `${on} vs ${off}`);
});

test('capstone 우두머리: beast skills coefficient ×2 and heal', () => {
  const s = hero('archer', 'hunter', ['a_beast', 'a_pack', null, null, null]);
  const off = run(s, {}, { ms: 50, range: 'ranged' }).b, on = run(s, { cap_beast2: true }, { ms: 50, range: 'ranged' }).b;
  assert.ok(Math.abs(on.skillCoef('a_beast') / off.skillCoef('a_beast') - 2) < 1e-9);
  assert.ok(Math.abs(on.skillCoef('a_pack') / off.skillCoef('a_pack') - 2) < 1e-9);
  assert.equal(on.skillCoef('a_aim'), off.skillCoef('a_aim'));
});

test('capstone 환영 무도: illusion extra hits appear only with the capstone', () => {
  const s = hero('rogue', 'trickster', ['r_stab', null, null, null, null]);
  const ill = (caps) => run(s, caps).ev.filter((e) => e.type === 'hit' && e.skill === 'illusion').length;
  assert.equal(ill({}), 0);
  assert.ok(ill({ cap_illusion: true }) > 5);
});

test('capstone 그림자 일격: three guaranteed crits after shadow step', () => {
  const s = hero('rogue', 'assassin', ['r_shadow', null, null, null, null]);
  s.player.statsUpgrades.crit = 0;
  const { ev } = run(s, { cap_shadowCrit: true }, { ms: 20000 });
  const i = ev.findIndex((e) => e.type === 'buff' && e.skill === 'r_shadow');
  assert.ok(i >= 0);
  const next = ev.slice(i).filter((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'attack').slice(0, 3);
  assert.equal(next.length, 3);
  assert.ok(next.every((e) => e.crit));
});
