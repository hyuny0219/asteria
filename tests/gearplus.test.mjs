// v10: 전설 고유 효과 · 추출/이식 · 스킬 각성 · 프리셋 · 재련 · 등급 올리기
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { Battle } from '../src/core/combat.js';
import { makeItem } from '../src/core/items.js';
import { makeRng } from '../src/core/util.js';
import * as G from '../src/core/gearplus.js';
import * as prog from '../src/core/progression.js';
import { UNIQUES } from '../src/data/gearplus.js';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';

const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);
const mk = (s, slot, rarity, level = 40, seed = 1) => { const it = makeItem(s, { slot, rarity, level, rng: makeRng(seed) }); s.inventory.push(it); return it; };

test('legendary and mythic drops always carry a 고유 효과; lower rarities never do', () => {
  const s = newGame(T0, 3, 'archer');
  for (let i = 0; i < 40; i++) {
    const leg = mk(s, 'weapon', 'legendary', 40, i), myth = mk(s, 'ring', 'mythic', 40, 100 + i), epic = mk(s, 'boots', 'epic', 40, 200 + i);
    assert.ok(leg.legend && UNIQUES[leg.legend.id]);
    assert.ok(myth.legend && UNIQUES[myth.legend.id]);
    assert.equal(epic.legend, undefined);
    const [a, b] = UNIQUES[leg.legend.id].range;
    assert.ok(leg.legend.v >= a && leg.legend.v <= b);
    const c = UNIQUES[leg.legend.id].cls;
    assert.ok(c === null || c === 'archer', 'own class or shared');
  }
});

test('old saves: legendary/mythic items get a deterministic 고유 효과 on load', () => {
  const s = newGame(T0, 3, 'mage');
  const it = mk(s, 'weapon', 'legendary'); delete it.legend;
  const a = migrate(JSON.parse(JSON.stringify(s))).inventory[0].legend;
  const b = migrate(JSON.parse(JSON.stringify(s))).inventory[0].legend;
  assert.ok(a && UNIQUES[a.id]);
  assert.deepEqual(a, b);
});

function bossRun(s, ms = 30000, seed = 4) {
  const st = playerStats(s);
  const b = new Battle({ kind: 'boss', rng: makeRng(seed), hero: { stats: st, skills: { ...s.skills, autoCast: true, ultAuto: 'ALWAYS' }, branch: s.player.branch, cls: s.player.cls, tier: s.player.tier, ult: prog.ultId(s), range: 'ranged', skillLevel: () => 1, gauge: 100 }, boss: { id: 'B05' } });
  const ev = [];
  for (let t = 0; t < ms; t += 50) { b.step(); ev.push(...b.drainEvents()); }
  return ev;
}
test('unique 폭우 doubles 화살비 hits (equipped item → combat)', () => {
  const s = newGame(T0, 7, 'archer');
  s.player.level = 60; s.player.tier = 1; s.player.branch = 'ranger';
  const firstUlt = (ev) => { const t0 = ev.find((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'ult').t; return ev.filter((e) => e.type === 'hit' && e.by === 'hero' && e.action === 'ult' && e.t === t0).length; };
  const off = firstUlt(bossRun(s, 3000));
  const it = mk(s, 'weapon', 'legendary'); it.legend = { id: 'u_a_deluge', v: 1 };
  s.equipped.weapon = it.id;
  const on = firstUlt(bossRun(s, 3000));
  assert.equal(off, 5);
  assert.equal(on, 10);
});

test('mythic scales the value ×1.25; skill mods merge (multipliers multiply)', () => {
  const s = newGame(T0, 7, 'mage');
  const a = mk(s, 'weapon', 'mythic'); a.legend = { id: 'u_m_storm', v: 0.8 };
  const b = mk(s, 'ring', 'legendary'); b.legend = { id: 'u_m_storm', v: 0.9 };
  s.equipped.weapon = a.id; s.equipped.ring1 = b.id;
  const m = G.skillMods(s).m_chain;
  assert.equal(m.hitsAdd, 2);
  assert.ok(Math.abs(m.cdMul - 0.8 * 1.25 * 0.9) < 1e-9);
});

test('추출 keeps the best value in the vault, removes the item; 이식 replaces the effect', () => {
  const s = newGame(T0, 7, 'rogue');
  s.wallet.ore = 5000; s.wallet.awakenStone = 5; s.wallet.gold = 1e9;
  const a = mk(s, 'boots', 'legendary', 40, 1); a.legend = { id: 'u_r_venom', v: 2.0 };
  const b = mk(s, 'boots', 'legendary', 40, 2); b.legend = { id: 'u_r_venom', v: 1.9 };
  const tgt = mk(s, 'weapon', 'legendary', 40, 3); tgt.legend = { id: 'u_c_focus', v: 1 };
  s.equipped.weapon = tgt.id;
  assert.equal(G.extractLegend(s, tgt.id).reason, 'protected');
  assert.ok(G.extractLegend(s, a.id).ok);
  assert.ok(G.extractLegend(s, b.id).ok);
  assert.equal(s.gearPlus.vault.u_r_venom, 2.0);
  assert.equal(s.inventory.length, 1);
  assert.equal(s.wallet.awakenStone, 3);
  const r = G.imprintLegend(s, tgt.id, 'u_r_venom');
  assert.ok(r.ok);
  assert.deepEqual(tgt.legend, { id: 'u_r_venom', v: 2.0 });
  assert.equal(G.imprintLegend(s, tgt.id, 'u_r_venom').reason, 'same');
  const epic = mk(s, 'ring', 'epic');
  assert.equal(G.imprintLegend(s, epic.id, 'u_r_venom').reason, 'rarity');
});

test('스킬 각성: needs Lv 10, first pick free, one free change per KST day, then gems', () => {
  const s = newGame(T0, 7, 'mage');
  s.wallet.gem = 100;
  assert.equal(G.setAwaken(s, 'm_meteor', 0, T0).reason, 'awaken-level');
  s.skills.levels.m_meteor = 10;
  assert.ok(G.setAwaken(s, 'm_meteor', 0, T0).ok);
  assert.equal(G.setAwaken(s, 'm_meteor', 1, T0).paid, 0);       // daily free change
  assert.equal(G.setAwaken(s, 'm_meteor', 0, T0).paid, 50);
  assert.equal(s.wallet.gem, 50);
  assert.equal(G.setAwaken(s, 'm_meteor', 1, T0 + 86400000).paid, 0);   // next day free again
  assert.deepEqual(G.skillMods(s).m_meteor, { hitsAdd: -2, coefMul: 2.6, stunAdd: 1.5 });
  s.skills.levels.m_meteor = 9;   // below Lv 10 the awakening is inactive
  assert.equal(G.skillMods(s).m_meteor, undefined);
});

test('v18.3 장비 프리셋 제거: 예전 세이브의 loadouts는 지우고 전투는 착용 장비 그대로', async () => {
  const { migrate } = await import('../src/core/state.js');
  const s = newGame(T0, 7, 'warrior');
  assert.equal(s.loadouts, undefined);
  s.loadouts = { list: [{ name: '보스', saved: true, gear: {} }], auto: true, map: {} };
  s.schemaVersion = s.schemaVersion;   // same schema: fill/cleanup pass only
  const m = migrate(s);
  assert.equal(m.loadouts, undefined);
});

test('재련 rerolls only the chosen option and gets dearer; 등급 올리기 3 → 1 next rarity', () => {
  const s = newGame(T0, 7, 'warrior');
  s.wallet.ore = 1e6; s.wallet.gold = 1e9; s.wallet.starShard = 5;
  const it = mk(s, 'gloves', 'epic', 50, 9);
  const before = it.options.map((o) => ({ ...o }));
  const c0 = G.reforgeCost(it);
  const r = G.reforge(s, it.id, 0, makeRng(3));
  assert.ok(r.ok);
  assert.deepEqual(it.options.slice(1), before.slice(1));
  assert.ok(!it.options.slice(1).some((o) => o.k === it.options[0].k), 'no duplicate key');
  assert.ok(G.reforgeCost(it).ore > c0.ore);
  const m1 = mk(s, 'gloves', 'epic', 55, 10), m2 = mk(s, 'gloves', 'epic', 45, 11), other = mk(s, 'boots', 'epic', 40, 12);
  assert.equal(G.rarityUp(s, it.id, [m1.id, other.id], makeRng(1)).reason, 'materials');
  m2.locked = true;
  assert.equal(G.rarityUp(s, it.id, [m1.id, m2.id], makeRng(1)).reason, 'protected');
  m2.locked = false;
  const n0 = it.options.length;
  const up = G.rarityUp(s, it.id, [m1.id, m2.id], makeRng(1));
  assert.ok(up.ok);
  assert.equal(it.rarity, 'legendary');
  assert.equal(it.level, 55);
  assert.equal(it.options.length, n0 + 1);
  assert.ok(it.legend, 'legendary gains a 고유 효과');
  assert.ok(!s.inventory.find((i) => i.id === m1.id));
});
