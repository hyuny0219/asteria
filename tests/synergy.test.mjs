import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { Battle } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import * as prog from '../src/core/progression.js';
import * as SYN from '../src/core/synergy.js';
import { SKILLS, MONSTERS } from '../src/data/content.js';
import { COMBOS, COMBO_IDS, SKILL_TAGS, TAGS, FIRST_REWARD } from '../src/data/synergy.js';

const T0 = Date.UTC(2026, 10, 9, 3);
function battle(cls = 'mage', n = 3) {
  const s = newGame(T0, 7, cls);
  s.player.level = 40;
  const b = new Battle({ kind: 'farm', rng: makeRng(4), hero: { stats: playerStats(s), skills: { ...s.skills, autoCast: false }, cls, tier: 0, ult: prog.ultId(s), range: 'ranged', skillLevel: () => 1 },
    farm: { monsters: ['M01'], levelFn: () => 40, eliteAllowed: () => false } });
  b.enemies.length = 0;
  const es = [];
  for (let i = 0; i < n; i++) { const e = b.addEnemy(MONSTERS.M01, 40); e.maxHp = e.hp = 1e9; e.state = 'ready'; e.x = 204 + i * 46; es.push(e); }
  b.events.length = 0;
  return { b, es };
}
const fired = (b) => b.drainEvents().filter((e) => e.type === 'synergy').map((e) => e.id);
const hit = (b, e, skill) => { const pre = SYN.preHit(b, e, skill); SYN.postHit(b, e, skill); return pre; };

test('every skill has valid tags; every combo is reachable by some class kit', () => {
  for (const id of Object.keys(SKILLS)) {
    assert.ok(SKILL_TAGS[id] && SKILL_TAGS[id].length, `${id} has tags`);
    for (const t of SKILL_TAGS[id]) assert.ok(TAGS[t], `${id}: ${t}`);
  }
  for (const id of COMBO_IDS) {
    const ok = ['warrior', 'mage', 'archer', 'rogue'].some((c) => SYN.combosFor(Object.values(SKILLS).filter((s) => s.cls === c).map((s) => s.id)).includes(id));
    assert.ok(ok, `${id} reachable`);
  }
  assert.ok(COMBO_IDS.length >= 6 && COMBO_IDS.length <= 10);
});

test('statuses: burn, chill → freeze at 3, bleed stacks', () => {
  const { b, es: [e] } = battle();
  SYN.postHit(b, e, 'm_fireball');
  assert.ok(SYN.burning(b, e));
  for (let i = 0; i < 2; i++) SYN.postHit(b, e, 'm_frost');
  assert.ok(SYN.chilled(b, e)); assert.equal(SYN.frozen(b, e), false);
  SYN.postHit(b, e, 'm_frost');
  assert.ok(SYN.frozen(b, e)); assert.ok(e.stunUntil > b.t);
  const r = battle('rogue');
  SYN.postHit(r.b, r.es[0], 'r_stab'); SYN.postHit(r.b, r.es[0], 'r_stab');
  assert.equal(SYN.bleedStacks(r.b, r.es[0]), 2);
});

test('each combo triggers in a controlled battle', () => {
  const cases = {
    ignite: () => { const { b, es } = battle(); SYN.postHit(b, es[0], 'm_fireball'); b.drainEvents(); const p = hit(b, es[0], 'm_meteor'); assert.ok(p.mul > 1.2); assert.ok(SYN.burning(b, es[1]), 'burn spread'); return fired(b); },
    shatter: () => { const { b, es } = battle(); SYN.postHit(b, es[0], 'm_frost'); b.drainEvents(); const hp = es[1].hp; es[0].hp = 1; b.synHit(es[0], 1, null, 'm_fireball'); assert.ok(es[1].hp < hp); return fired(b); },
    hemorrhage: () => { const { b, es } = battle('rogue'); const hp = es[0].hp; for (let i = 0; i < 3; i++) SYN.postHit(b, es[0], 'r_stab'); assert.equal(SYN.bleedStacks(b, es[0]), 0); assert.ok(es[0].hp < hp); return fired(b); },
    shock: () => { const { b, es } = battle(); SYN.postHit(b, es[0], 'm_frost'); b.drainEvents(); b.rng = () => 0.01; hit(b, es[0], 'm_chain'); return fired(b); },
    steam: () => { const { b, es } = battle(); SYN.postHit(b, es[0], 'm_frost'); b.drainEvents(); const hp = es[2].hp; hit(b, es[0], 'm_fireball'); assert.ok(es[2].hp < hp); return fired(b); },
    gangrene: () => { const { b, es } = battle('rogue'); es[0].dots.push({ coef: 0.5, until: b.t + 6000, nextAt: b.t + 1000, skill: 'r_poison' }); hit(b, es[0], 'r_stab'); return fired(b); },
    weakpoint: () => { const { b, es } = battle('rogue'); es[0].dots.push({ coef: 0.5, until: b.t + 6000, nextAt: b.t + 1000, skill: 'r_poison' }); es[0].stunUntil = b.t + 2000; const p = hit(b, es[0], 'r_execute'); assert.equal(p.forceCrit, true); return fired(b); },
    judgement: () => { const { b, es } = battle('warrior'); es[0].stunUntil = b.t + 2000; const hp = es[0].hp; hit(b, es[0], 'shieldCharge'); assert.ok(es[0].hp < hp); return fired(b); },
    instinct: () => { const { b, es } = battle('archer'); SYN.postHit(b, es[0], 'a_multi'); b.drainEvents(); hit(b, es[0], 'a_pack'); return fired(b); },
    rupture: () => { const { b, es } = battle('warrior'); SYN.postHit(b, es[0], 'strike'); SYN.postHit(b, es[0], 'strike'); b.drainEvents(); const p = hit(b, es[0], 'starSlash'); assert.ok(p.mul > 1.2); assert.equal(SYN.bleedStacks(b, es[0]), 0); return fired(b); },
  };
  assert.deepEqual(Object.keys(cases).sort(), [...COMBO_IDS].sort());
  for (const [id, f] of Object.entries(cases)) assert.ok(f().includes(id), `${id} fired`);
});

test('lightning jumps to one more enemy once per cast', () => {
  const { b, es } = battle();
  b.synCoef = 2; const hp = es[1].hp;
  SYN.postHit(b, es[0], 'm_chain', { first: true });
  assert.ok(es[1].hp < hp);
  const hp2 = es[1].hp;
  SYN.postHit(b, es[0], 'm_chain', { first: false });
  assert.equal(es[1].hp, hp2);
});

test('real fight: a mage kit with fireball + frost makes combos happen on its own', () => {
  const s = newGame(T0, 7, 'mage'); s.player.level = 40;
  const sk = { ...s.skills, equipped: ['m_fireball', 'm_frost', null, null, null], autoCast: true };
  const b = new Battle({ kind: 'farm', rng: makeRng(9), hero: { stats: playerStats(s), skills: sk, cls: 'mage', tier: 0, ult: 'm_meteor', range: 'ranged', skillLevel: () => 1 }, farm: { monsters: ['M01', 'M02'], levelFn: () => 20, eliteAllowed: () => false } });
  const ids = new Set();
  for (let t = 0; t < 60000; t += 50) { b.step(); for (const e of b.drainEvents()) if (e.type === 'synergy') ids.add(e.id); }
  assert.ok(ids.size >= 1, [...ids].join(','));
});

test('codex: first trigger rewards once; old saves get the field', () => {
  const s = newGame(T0);
  const gem = s.wallet.gem;
  const a = SYN.record(s, 'ignite', T0);
  assert.equal(a.first, true); assert.equal(s.wallet.gem, gem + FIRST_REWARD.gem);
  const b = SYN.record(s, 'ignite', T0 + 1);
  assert.equal(b.first, false); assert.equal(s.wallet.gem, gem + FIRST_REWARD.gem);
  assert.ok(SYN.isFound(s, 'ignite'));
  assert.equal(SYN.record(s, 'nope', T0).ok, false);
  delete s.synergy;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(m.synergy, { found: {} });
  m.synergy = 'bad';
  assert.equal(SYN.isFound(m, 'ignite'), false);
});

test('game: the first combo is saved with its reward exactly once', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const g = new Game({ saver: new MemorySaver(), now: () => T0 });
  await g.load();
  const gem = g.state.wallet.gem;
  let found = 0; g.on('synergyFound', () => found++);
  g.onSynergy({ type: 'synergy', id: 'steam' }); g.onSynergy({ type: 'synergy', id: 'steam' });
  await new Promise((r) => setTimeout(r, 20));
  g.onSynergy({ type: 'synergy', id: 'steam' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(found, 1);
  assert.equal(g.state.wallet.gem, gem + FIRST_REWARD.gem);
  assert.ok(g.state.synergy.found.steam);
});
