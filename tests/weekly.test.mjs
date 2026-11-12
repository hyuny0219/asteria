import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/core/state.js';
import * as M from '../src/core/missions.js';

const KST = (y, m, d, hh = 0) => Date.UTC(y, m - 1, d, hh - 9);
const MON = KST(2026, 11, 9, 10);   // 2026-11-09 월요일

test('v18.6 주간: 월요일 00:00 KST에 초기화, 항목별 보상 · 6개 받으면 완료 보상', () => {
  assert.equal(M.kstWeekIndex(KST(2026, 11, 9, 0)), M.kstWeekIndex(KST(2026, 11, 15, 23)));
  assert.notEqual(M.kstWeekIndex(KST(2026, 11, 15, 23)), M.kstWeekIndex(KST(2026, 11, 16, 0)));
  const s = newGame(MON);
  M.track(s, 'kills', 5000, MON); M.track(s, 'bossWin', 15, MON); M.track(s, 'dungeon', 10, MON);
  M.track(s, 'draws', 30, MON); M.track(s, 'enhance', 30, MON);
  const ore0 = s.wallet.ore;
  assert.ok(M.claimWeekly(s, 'w_dungeon', MON).ok); assert.equal(s.wallet.ore - ore0, 1500);
  assert.equal(M.claimWeekly(s, 'w_dungeon', MON).reason, 'duplicate');
  assert.equal(M.claimWeekly(s, 'w_raid', MON).reason, 'conditions');
  const all = M.claimAllWeekly(s, MON);
  assert.equal(all.count, 4); assert.equal(all.bonus, false);
  M.track(s, 'challenge', 10, MON); assert.ok(M.claimWeekly(s, 'w_challenge', MON).ok);
  const eggs = s.pets.eggs;
  assert.ok(M.claimWeeklyBonus(s, MON).ok); assert.equal(s.pets.eggs, eggs + 1);
  assert.equal(M.claimWeeklyBonus(s, MON).reason, 'duplicate');
  // 다음 주 월요일: 전부 초기화
  const next = KST(2026, 11, 16, 0);
  const st = M.weeklyStatus(s, next);
  assert.equal(st.got, 0); assert.equal(st.list[0].progress, 0); assert.equal(st.bonusClaimed, false);
});

test('v18.6 일일 완료 보상을 받으면 주간 "5일" 항목이 오름, 자동 분해도 셈', async () => {
  const s = newGame(MON);
  for (const ev of ['kills', 'enhance', 'dungeon', 'draw', 'boss', 'elites']) M.track(s, ev, 1000, MON);
  for (const x of M.MISSIONS.slice(0, 6)) assert.ok(M.claimMission(s, x.id, MON).ok, x.id);
  assert.ok(M.claimMissionBonus(s, MON).ok);
  assert.equal(M.weeklyStatus(s, MON).list.find((x) => x.id === 'w_daily').progress, 1);
  const { addItems } = await import('../src/core/economy.js');
  const { makeItem } = await import('../src/core/items.js');
  const { makeRng } = await import('../src/core/util.js');
  s.settings.autoDismantle = 'rare';
  addItems(s, Array.from({ length: 4 }, (_, i) => makeItem(s, { slot: 'boots', rarity: 'common', level: 5, rng: makeRng(i + 1) })));
  assert.equal(M.missionStatus(s, MON).list.find((x) => x.id === 'dismantle').progress, 4);
});
