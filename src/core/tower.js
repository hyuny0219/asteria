// 시련의 탑: no tickets, one floor per run (60 s, 10 kills). A floor's reward is paid
// only the first time it is cleared (best record), so retries never farm it.
import { BALANCE } from '../data/balance.js';
import { DUNGEON_MONSTERS } from '../data/content.js';

const T = BALANCE.tower;
export const floorLevel = (f) => T.levelBase + T.levelPerFloor * f;
export function floorReward(f) {
  const r = { gem: T.gemsPerFloor, awakenStone: 0, starShard: 0 };
  if (f % 5 === 0) { r.gem += T.every5.gem; r.awakenStone += T.every5.awakenStone; }
  if (f % 10 === 0 && f >= T.every10.fromFloor && f <= (T.every10.toFloor || Infinity)) r.starShard += T.every10.starShard;
  return r;
}
export const nextFloor = (state) => (state.tower.best || 0) + 1;
export const towerConfig = (floor) => ({ floor, monsters: DUNGEON_MONSTERS.tower, level: floorLevel(floor) });
export function finishFloor(state, floor, cleared) {
  if (!cleared) return { ok: true, floor, cleared: false, reward: null };
  if (floor !== nextFloor(state)) return { ok: true, floor, cleared: true, reward: null, repeat: true };
  const r = floorReward(floor);
  state.tower.best = floor;
  state.wallet.gem += r.gem;
  state.wallet.awakenStone += r.awakenStone;
  state.wallet.starShard += r.starShard;
  return { ok: true, floor, cleared: true, reward: r, record: true };
}
