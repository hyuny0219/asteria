import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_GROUPS, groupMenuTiles } from '../src/ui/menugroups.js';

test('v18 메뉴: 모든 타일이 정확히 한 분류에 들어가고, 모르는 타일은 수집 칸 끝으로', () => {
  const ids = MENU_GROUPS.flatMap((g) => g.ids);
  assert.equal(new Set(ids).size, ids.length);
  const tiles = [...ids, 'brandNew'].map((id) => ({ id, t: id }));
  const g = groupMenuTiles(tiles);
  assert.equal(g.reduce((n, x) => n + x.tiles.length, 0), tiles.length);
  assert.equal(g.find((x) => x.id === 'collect').tiles.at(-1).id, 'brandNew');
  // 빈 분류는 숨김
  assert.deepEqual(groupMenuTiles([{ id: 'help' }]).map((x) => x.id), ['system']);
});
