// v18 메뉴 분류 (DOM 없이 테스트할 수 있게 분리)
export const MENU_GROUPS = [
  { id: 'reward', t: '보상', ids: ['mail', 'attendance', 'missions', 'pass'] },
  { id: 'growth', t: '성장', ids: ['promotion', 'talents', 'rebirth', 'growth'] },
  { id: 'craft', t: '뽑기 · 제작 · 상점', ids: ['gacha', 'shop', 'workshop', 'craft'] },
  { id: 'collect', t: '수집 · 기록', ids: ['pets', 'mounts', 'wings', 'achievements', 'codex', 'legendCodex', 'story'] },
  { id: 'system', t: '기타 · 설정', ids: ['classChange', 'settings', 'help'] },
];
export function groupMenuTiles(tiles) {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const used = new Set();
  const groups = MENU_GROUPS.map((g) => ({ ...g, tiles: g.ids.map((id) => byId.get(id)).filter(Boolean) }));
  for (const g of groups) for (const t of g.tiles) used.add(t.id);
  const rest = tiles.filter((t) => !used.has(t.id));
  if (rest.length) groups.find((g) => g.id === 'collect').tiles.push(...rest);   // 새로 생긴 타일은 수집 칸 끝에
  return groups.filter((g) => g.tiles.length);
}
