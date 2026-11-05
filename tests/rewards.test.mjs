// Attendance, return bonus, guest profile namespace, schema 1 → 2 migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame, migrate, validate } from '../src/core/state.js';
import { ATTENDANCE, claimAttendance, attendanceStatus, prepareReturn, claimReturn, farmMultipliers } from '../src/core/rewards.js';
import { unpack } from '../src/platform/save.js';
import { hashString } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);     // 12:00 KST
const DAY = 86400000;

test('attendance: once per KST day, cumulative, cycles after 28', () => {
  const s = newGame(T0);
  const r1 = claimAttendance(s, T0);
  assert.equal(r1.ok, true);
  assert.equal(r1.day, 1);
  assert.equal(claimAttendance(s, T0 + 3600e3).reason, 'duplicate');
  // 14:59 UTC = 23:59 KST same day → still duplicate; 15:00 UTC = next KST day
  assert.equal(claimAttendance(s, Date.UTC(2026, 10, 5, 14, 59)).ok, false);
  assert.equal(claimAttendance(s, Date.UTC(2026, 10, 5, 15, 0)).day, 2);
  // skipping days does not reset the calendar
  assert.equal(claimAttendance(s, T0 + 10 * DAY).day, 3);
  for (let d = 11; d < 11 + 25; d++) claimAttendance(s, T0 + d * DAY);
  assert.equal(s.attendance.count, 28);
  assert.equal(attendanceStatus(s, T0 + 40 * DAY).index, 0);   // new cycle
  assert.ok(s.wallet.gem > 0 && s.wallet.eqTicket > 0 && s.wallet.skTicket > 0);
});

test('attendance: clock moved back is refused', () => {
  const s = newGame(T0);
  claimAttendance(s, T0 + 5 * DAY);
  const st = attendanceStatus(s, T0 + 2 * DAY);
  assert.equal(st.rolledBack, true);
  assert.equal(claimAttendance(s, T0 + 2 * DAY).reason, 'clock');
});

test('attendance reward table: 28 days, gold scales with level', () => {
  assert.equal(ATTENDANCE.length, 28);
  const a = newGame(T0); a.player.level = 2;
  const b = newGame(T0); b.player.level = 30;
  claimAttendance(a, T0); claimAttendance(b, T0);
  assert.ok(b.wallet.gold > a.wallet.gold * 5);
});

test('return bonus: needs 3+ days away, tiered, once per absence, boost ×2 for farming only', () => {
  const s = newGame(T0);
  assert.equal(prepareReturn(s, T0, T0 + 2 * DAY, 'r0'), null);
  const p = prepareReturn(s, T0, T0 + 8 * DAY, 'r1');
  assert.equal(p.tierDays, 7);
  assert.equal(prepareReturn(s, T0, T0 + 8 * DAY, 'r2').id, 'r1');     // same pending, not a new one
  const now = T0 + 8 * DAY;
  const c = claimReturn(s, now);
  assert.equal(c.ok, true);
  assert.equal(claimReturn(s, now).reason, 'none');
  assert.equal(prepareReturn(s, T0, now, 'r3'), null);                  // same absence → no second bonus
  assert.deepEqual(farmMultipliers(s, now + 3600e3), { exp: 2, gold: 2 });
  assert.deepEqual(farmMultipliers(s, now + 25 * 3600e3), { exp: 1, gold: 1 });
});

test('return bonus is prepared on load and claimed through a transaction', async () => {
  let clock = T0;
  const saver = new MemorySaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  await g.checkpoint('x');
  clock += 4 * DAY;
  const g2 = new Game({ saver, now: () => clock });
  await g2.load();
  assert.ok(g2.state.returnBonus.pending, 'pending after 4 days');
  // persisted before claiming: a reload shows the same one
  const g3 = new Game({ saver, now: () => clock });
  await g3.load();
  assert.equal(g3.state.returnBonus.pending.id, g2.state.returnBonus.pending.id);
  if (g3.mode === 'OFFLINE') await g3.claimOffline();
  const gem0 = g3.state.wallet.gem;
  saver.failNext = 1;
  const bad = await g3.claimReturn();
  assert.equal(bad.ok, false);
  assert.equal(g3.state.wallet.gem, gem0, 'failed save grants nothing');
  const ok = await g3.claimReturn();
  assert.equal(ok.ok, true);
  assert.ok(g3.state.wallet.gem > gem0);
  assert.equal((await g3.claimReturn()).ok, false);
});

test('schema 1 save migrates to the current schema and validates', () => {
  const s = newGame(T0);
  delete s.profile; delete s.attendance; delete s.returnBonus;
  s.wallet = { gold: 5, ore: 1, token: 0 };
  s.schemaVersion = 1;
  const data = JSON.stringify(s);
  const r = unpack({ data, sum: hashString(data) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.state.schemaVersion, 3);   // v4: migrates through 2 → 3
  assert.equal(r.state.wallet.gem, 0);
  assert.equal(r.state.attendance.count, 0);
  assert.deepEqual(validate(r.state), []);
});
