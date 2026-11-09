import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as ST from '../src/core/story.js';
import * as DF from '../src/core/difficulty.js';
import { REGIONS } from '../src/data/content.js';

const T0 = Date.UTC(2026, 10, 9, 3);
test('every region has an intro and boss lore; ending has 3–4 cards; difficulties framed', () => {
  for (const r of REGIONS) { assert.ok(ST.REGION_STORY[r.id].intro.length > 10, r.id); assert.ok(ST.REGION_STORY[r.id].boss.length > 10, r.id); }
  assert.ok(ST.ENDING.length >= 3 && ST.ENDING.length <= 4);
  assert.ok(ST.DIFF_STORY.normal && ST.DIFF_STORY.hard);
});
test('region intro is pending once per region on 이지, then once per difficulty', () => {
  const s = newGame(T0);
  assert.deepEqual(ST.pendingIntro(s), { key: 'r:meadow', kind: 'region', region: 'meadow', text: ST.REGION_STORY.meadow.intro });
  assert.equal(ST.markSeen(s, 'r:meadow', T0), true);
  assert.equal(ST.markSeen(s, 'r:meadow', T0), false);
  assert.equal(ST.pendingIntro(s), null);
  s.progression.region = 'desert';
  assert.equal(ST.pendingIntro(s).key, 'r:desert');
  s.diff.cur = 'normal';
  assert.equal(ST.pendingIntro(s).key, 'd:normal');
  ST.markSeen(s, 'd:normal');
  assert.equal(ST.pendingIntro(s), null);   // 노말에서는 지역 소개를 다시 띄우지 않음
});
test('first 이지 boss clear records lore once; B10 also records the ending; 노말 first clears do not', () => {
  const s = newGame(T0);
  assert.equal(ST.onBossFirstClear(s, 'B01', 'easy', T0).lore, ST.REGION_STORY.meadow.boss);
  assert.deepEqual(ST.onBossFirstClear(s, 'B01', 'easy', T0), {});
  assert.deepEqual(ST.onBossFirstClear(s, 'B02', 'normal', T0), {});
  const e = ST.onBossFirstClear(s, 'B10', 'easy', T0);
  assert.equal(e.ending, true); assert.ok(e.lore);
  const j = ST.journal(s).map((x) => x.key);
  assert.deepEqual(j, ['b:B01', 'b:B10', 'end']);
});
test('old saves: passed regions/bosses become read (no popups), fresh saves start empty', () => {
  const s = newGame(T0);
  assert.deepEqual(s.story, { seen: {} });
  s.progression.unlockedRegions = ['meadow', 'desert', 'mine'];
  s.progression.bossCleared = { B01: true, B02: true };
  delete s.story;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(ST.seen(m, 'r:mine') && ST.seen(m, 'b:B02') && !ST.seen(m, 'b:B03') && !ST.seen(m, 'end'));
  assert.equal(ST.pendingIntro(m), null);
  // a damaged block is repaired instead of throwing
  m.story = 'x';
  assert.equal(ST.markSeen(m, 'r:forest'), true);
  assert.equal(DF.curDiff(m), 'easy');
});

test('farm 영웅+ drop: lootSaved fires only after the save commit succeeds', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => T0 });
  await g.load();
  const seen = [];
  g.on('lootSaved', (e) => seen.push({ e, rev: g.state.revision }));
  const before = g.state.revision;
  const p = g.saveLoot([{ id: 'x', rarity: 'legendary', name: 't' }], 300);
  assert.equal(seen.length, 0);   // 아직 저장 전
  const c = await p;
  assert.equal(c.ok, true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].rev > before);
  assert.equal(seen[0].e.x, 300);
  // failed save → no 연출
  saver.failNext = 1;
  const seen2 = seen.length;
  const c2 = await g.saveLoot([{ id: 'y', rarity: 'mythic', name: 'u' }], 1);
  assert.equal(c2.ok, false);
  assert.equal(seen.length, seen2);
});
