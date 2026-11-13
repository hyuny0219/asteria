import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as DF from '../src/core/difficulty.js';
import * as prog from '../src/core/progression.js';
import * as STORY from '../src/core/story.js';
import { REGIONS, BOSSES, MONSTERS, SETS } from '../src/data/content.js';
import { RARES } from '../src/core/worldboss.js';
import { Battle } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import { readFileSync } from 'node:fs';

const T0 = Date.UTC(2026, 10, 13, 3);
const SPR = JSON.parse(readFileSync(new URL('../assets/runtime/sprites.json', import.meta.url)));

test('v19 2막 데이터: 20지역 · 몬스터 40 · 보스 20, 그림·세트·희귀 정예·이야기 모두 연결', () => {
  assert.equal(REGIONS.length, 20);
  for (const r of REGIONS.filter((x) => x.act === 2)) {
    assert.ok(SPR.backgrounds[r.bg], 'bg ' + r.bg);
    assert.ok(SPR.bosses[r.boss], 'boss art ' + r.boss);
    for (const m of r.monsters) { assert.ok(MONSTERS[m], m); assert.ok(SPR.monsters[MONSTERS[m].sprite], 'art ' + m); }
    assert.ok(BOSSES[r.boss].mech, 'mech ' + r.boss);
    assert.ok(SETS[r.id] && RARES[r.id] && STORY.REGION_STORY[r.id]);
  }
});

test('v19 2막 해금: 같은 난이도 10지역 보스 → 11지역, 다음 난이도 해금은 1막 끝 그대로', () => {
  const s = newGame(T0);
  for (const r of REGIONS.slice(0, 9)) { s.progression.bossCleared[r.boss] = true; s.progression.unlockedRegions.push(REGIONS[r.order + 1].id); }
  assert.equal(DF.diffOpen(s, 'normal'), false);
  const res = prog.onBossCleared(s, 'B10', 'easy');
  assert.equal(res.unlocked, 'r11');
  assert.equal(res.diffUnlocked, 'normal');
  // 다음 목표는 노말이 먼저, 2막은 그다음
  s.progression.region = 'void'; s.progression.firsts.firstEquip = true; s.inventory = []; s.player.level = 100; s.player.tier = 3; s.pets.eggs = 0; s.dungeon.tickets = 0;
  assert.equal(prog.nextGoal(s).id, 'diff');
});

test('v19 예전 세이브: B10을 이미 잡았으면 11지역이 열린 채로 불러옴', () => {
  const s = newGame(T0);
  s.progression.bossCleared.B10 = true;
  s.diff.tracks.normal.bossCleared.B10 = true;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(m.progression.unlockedRegions.includes('r11'));
  assert.ok(m.diff.tracks.normal.unlockedRegions.includes('r11'));
  assert.ok(!m.diff.tracks.hard.unlockedRegions.includes('r11'));
});

test('v19 2막 곡선: 이지 2막은 1막 끝에서 완만하게, 노말·하드는 이어서 더 셈', () => {
  const e11 = DF.enemyMul('easy', 'r11', 1), e20 = DF.enemyMul('easy', 'r20', 'boss');
  assert.ok(Math.abs(e11.hp - Math.pow(1.005, 1)) < 1e-9);
  assert.ok(e20.hp < 1.8);
  const n10 = DF.enemyMul('normal', 'void', 'boss').hp, n20 = DF.enemyMul('normal', 'r20', 'boss').hp, h10 = DF.enemyMul('hard', 'void', 'boss').hp;
  assert.ok(n20 / n10 > 1.8 && n20 / n10 < 2.1);
  assert.ok(n20 < h10 * 1.1, '노말 20 ≈ 하드 9~10');
});

test('v19 2막 엔딩·기록: 2막 보스는 어느 난이도든 처음 잡을 때 기록, 별을 삼키는 자는 엔딩 2', () => {
  const s = newGame(T0);
  assert.deepEqual(STORY.onBossFirstClear(s, 'B01', 'normal', T0), {});
  const a = STORY.onBossFirstClear(s, 'B13', 'normal', T0);
  assert.ok(a.lore);
  const e = STORY.onBossFirstClear(s, 'B20', 'hard', T0);
  assert.equal(e.ending, 2);
  assert.equal(STORY.onBossFirstClear(s, 'B20', 'easy', T0).ending, undefined);
});

// 기믹 동작 확인용 간단 전투
function bossFight(id, hero = {}) {
  const st = { atk: 40000, hp: 400000, def: 2000, crit: 0.3, critMul: 2, aspd: 2, evade: 0, lifesteal: 0, dmgTaken: 0, ...hero };
  return new Battle({ kind: 'boss', rng: makeRng(7), hero: { stats: st, pet: null, skills: { equipped: [null, null, null], levels: {}, runes: null }, branch: null, cls: 'warrior', tier: 1, ult: 'starSlash', range: 'melee', skillLevel: () => 1 },
    boss: { id, diff: { level: 100, mul: DF.enemyMul('easy', BOSSES[id].region, 'boss') } } });
}
test('v19 기믹: 세계수 재생은 지속 피해가 없을 때만 · 반사·결계·형태 변화 이벤트', () => {
  const b = bossFight('B14', { atk: 1 });
  const e = b.enemies.find((x) => x.boss);
  e.hp = e.maxHp * 0.5;
  for (let i = 0; i < 100; i++) b.step();
  assert.ok(e.hp > e.maxHp * 0.5);
  for (const id of ['B11', 'B12', 'B16', 'B17']) {
    const bb = bossFight(id, { atk: 1, hp: 1e9 });
    const ev = [];
    for (let i = 0; i < 1200; i++) { bb.step(); ev.push(...bb.drainEvents()); if (bb.over) break; }
    assert.ok(ev.some((x) => x.type === 'mech'), id);
  }
  const d = bossFight('B20', { atk: 200000, hp: 1e9 });
  const ev = [];
  for (let i = 0; i < 3000 && !d.over; i++) { d.step(); ev.push(...d.drainEvents()); }
  assert.ok(ev.filter((x) => x.type === 'mech').length >= 2);
});
