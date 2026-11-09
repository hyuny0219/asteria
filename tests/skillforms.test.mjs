import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as prog from '../src/core/progression.js';
import { Battle } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import { BRANCHES, CLASS_SKILLS, SKILLS, branchesOf } from '../src/data/content.js';
import { TAGS } from '../src/data/synergy.js';
import { SKILL_FORMS, EVO_SKILLS } from '../src/data/skillforms.js';
import { skillDef, tagsFor, evolutionsFor, stagesOf, ctxOf } from '../src/core/skillforms.js';
import * as SYN from '../src/core/synergy.js';
import { playerStats } from '../src/core/stats.js';

const T0 = Date.UTC(2026, 10, 9, 3);
const CLS = Object.keys(CLASS_SKILLS);

test('every class base skill + ult has 4 forms for both branches (128), names/tags/tints valid', () => {
  let n = 0;
  for (const cls of CLS) {
    const ids = [...CLASS_SKILLS[cls].base, CLASS_SKILLS[cls].ult];
    for (const id of ids) for (const br of branchesOf(cls)) {
      const forms = SKILL_FORMS[id] && SKILL_FORMS[id][br];
      assert.ok(forms && forms.length === 4, `${id}/${br} has 4 forms`);
      const names = new Set([SKILLS[id].name]);
      forms.forEach((fm, i) => {
        n++;
        assert.ok(fm.name && fm.desc && /^#[0-9A-Fa-f]{6}$/.test(fm.tint), `${id}/${br}/t${i + 1} fields`);
        assert.ok(fm.tags.length && fm.tags.every((t) => TAGS[t]), `${id}/${br}/t${i + 1} tags valid: ${fm.tags}`);
        assert.ok(!names.has(fm.name), `${id}/${br}/t${i + 1} name differs from earlier stages`);
        names.add(fm.name);
        const d = skillDef(id, { tier: i + 1, branch: br, cls });
        assert.equal(d.name, fm.name); assert.equal(d.kind, SKILLS[id].kind, 'kind never changes');
        if (d.kind === 'damage' || d.kind === 'ultimate') assert.ok(d.coef > 0 && (d.hits || 1) >= 1);
        if (d.kind !== 'ultimate') assert.ok(d.cd > 0);
        assert.ok(['single', 'all', 'spread', undefined].includes(d.target));
      });
    }
  }
  assert.equal(n, 128);
  assert.equal(EVO_SKILLS.length, 16);
});

test('resolver: no branch / tier 0 → base def; tier 4 reachable; other skills untouched', () => {
  assert.equal(skillDef('strike', null), SKILLS.strike);
  assert.equal(skillDef('strike', { tier: 0, branch: 'knight' }), SKILLS.strike);
  assert.equal(skillDef('strike', { tier: 4, branch: 'knight' }).name, '여명 붕괴');
  assert.equal(skillDef('strike', { tier: 4, branch: 'berserker' }).name, '혈월 참수');
  assert.equal(skillDef('guardCounter', { tier: 4, branch: 'knight' }), SKILLS.guardCounter);
  // a branch from another class never applies
  assert.equal(skillDef('strike', { tier: 2, branch: 'wizard' }), SKILLS.strike);
  const s = newGame(T0, 7, 'mage'); s.player.branch = 'warlock'; s.player.tier = 3;
  assert.equal(skillDef('m_fireball', ctxOf(s)).name, SKILL_FORMS.m_fireball.warlock[2].name);
});

test('synergy uses evolved tags (kit combos + battle)', () => {
  // base strike = bleed only; knight t2 strike = holy+explode
  assert.deepEqual(tagsFor('strike'), ['bleed']);
  assert.deepEqual(tagsFor('strike', { tier: 2, branch: 'knight' }), ['holy', 'explode']);
  const ctx = { tier: 4, branch: 'wizard' };
  const kit = ['m_fireball', 'm_frost', 'm_shield', 'm_meteor'];
  assert.ok(!SYN.combosFor(['m_frost']).includes('shock'));
  assert.ok(SYN.combosFor(kit, ctx).includes('shock'), 'tier-4 wizard gets lightning → 감전 possible');
  // battle: b.skill resolves forms → synergy preHit sees the evolved tags
  const s = newGame(T0, 7, 'mage'); s.player.level = 80; s.player.branch = 'wizard'; s.player.tier = 4;
  const b = new Battle({ kind: 'farm', rng: makeRng(1), hero: { stats: playerStats(s), skills: { ...s.skills, autoCast: true }, branch: 'wizard', tier: 4, cls: 'mage', ult: 'm_meteor', range: 'ranged', skillLevel: () => 1 }, farm: { region: 'mine', wave: 1, level: 25 } });
  assert.deepEqual(b.skill('m_fireball').tags, ['fire', 'frost', 'lightning', 'explode']);
});

test('evolutionsFor lists the changed skills for each tier step; stages show 5', () => {
  for (const cls of CLS) for (const br of branchesOf(cls)) for (let t = 1; t <= 4; t++) {
    const ev = evolutionsFor(cls, br, t - 1, t);
    assert.equal(ev.length, 4, `${br} ${t}: 3 base + ult evolve`);
    assert.ok(ev.at(-1).ult, 'ultimate listed last');
  }
  assert.equal(stagesOf('a_aim', 'ranger').length, 5);
  assert.equal(stagesOf('a_aim', null).length, 1);
});

test('promotion result carries the evolutions (computed inside the promote transaction)', () => {
  const s = newGame(T0, 7, 'warrior');
  s.player.level = 30; s.wallet.token = 99; s.progression.bossCleared.B03 = true; s.promotion.trials[1] = true;
  const r = prog.promote(s, 1, 'knight', T0);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.evolutions.map((e) => `${e.from}→${e.to}`), ['강타→방패 강타', '방패 돌진→수호 돌진', '전장의 외침→기사의 서약', '별빛 참격→성광 참격']);
});

test('evolved mechanics fire in battle: lifesteal heals, buff utility (shield / crit stacks / stun all)', () => {
  const s = newGame(T0, 7, 'warrior'); s.player.level = 90; s.player.branch = 'berserker'; s.player.tier = 4;
  const hero = { stats: playerStats(s), skills: { ...s.skills, autoCast: true }, branch: 'berserker', tier: 4, cls: 'warrior', ult: 'starSlash', range: 'melee', skillLevel: () => 1 };
  const b = new Battle({ kind: 'boss', rng: makeRng(3), hero, boss: { id: 'B05' } });
  for (let i = 0; i < 40; i++) b.step();
  b.hero.hp = Math.floor(b.hero.maxHp * 0.5);
  const before = b.hero.hp;
  b.resolveHeroImpact({ kind: 'skill', skill: 'strike' });   // 혈월 참수: lifesteal 12%
  assert.ok(b.hero.hp > before, 'lifesteal healed');
  b.resolveHeroImpact({ kind: 'skill', skill: 'warCry' });   // 혈월의 포효: crit stacks 3 + stun all
  assert.ok(b.hero.buffs.critStacks && b.hero.buffs.critStacks.n >= 3);
  const boss = b.enemies.find((e) => e.boss);
  assert.ok(boss.stunUntil > b.t, 'stunAll (boss resisted to 40%)');
  // knight shield charge t3: shieldPct
  const k = newGame(T0, 7, 'warrior'); k.player.level = 90; k.player.branch = 'knight'; k.player.tier = 3;
  const b2 = new Battle({ kind: 'boss', rng: makeRng(3), hero: { ...hero, stats: playerStats(k), branch: 'knight', tier: 3 }, boss: { id: 'B05' } });
  for (let i = 0; i < 40; i++) b2.step();
  b2.resolveHeroImpact({ kind: 'skill', skill: 'shieldCharge' });
  assert.ok(b2.hero.shield && b2.hero.shield.amount > 0, '맹세의 돌진 shield');
});
