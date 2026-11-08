import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import * as M from '../src/core/mail.js';
import { COUPONS } from '../src/data/coupons.js';

const KST = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 9, mm);
const T0 = KST(2026, 11, 8, 12);
const DAY = 86400000;

test('운영 우편: delivered once per profile inside its window', () => {
  const s = newGame(T0);
  const r1 = M.refreshMail(s, T0);
  assert.equal(r1.added, 3);                       // welcome + v8 update + v12 steeds
  assert.deepEqual(s.mail.list.map((x) => x.id).sort(), ['ops-v12-steeds', 'ops-v8-update', 'ops-welcome']);
  assert.equal(M.refreshMail(s, T0 + 1000).added, 0);
  assert.equal(s.mail.list.length, 3);
  // after the v8 window only the welcome mail arrives
  const late = newGame(KST(2026, 12, 2));
  M.refreshMail(late, KST(2026, 12, 2));
  assert.deepEqual(late.mail.list.map((x) => x.id).sort(), ['ops-v12-steeds', 'ops-welcome']);
});

test('old saves (no mail block) get one after migrate', () => {
  const s = newGame(T0);
  delete s.mail;
  const m = migrate(s);
  assert.ok(m.mail && Array.isArray(m.mail.list));
});

test('claim / claim all grant once; claimed mail is cleaned after 7 days, unclaimed expires after 30', () => {
  const s = newGame(T0);
  M.refreshMail(s, T0);
  const gem0 = s.wallet.gem, eq0 = s.wallet.eqTicket;
  const r = M.claimAllMail(s, T0);
  assert.equal(r.ok, true);
  assert.equal(s.wallet.gem - gem0, 800);
  assert.equal(s.wallet.eqTicket - eq0, 15);
  assert.equal(M.claimAllMail(s, T0).reason, 'none');
  assert.equal(M.claimMail(s, 'ops-welcome', T0).reason, 'duplicate');
  assert.deepEqual(r.got.steeds, [{ kind: 'mount', id: 'horse' }, { kind: 'wing', id: 'rose' }]);
  assert.equal(s.mounts.equipped, 'horse');
  assert.equal(s.wings.equipped, 'rose');
  M.refreshMail(s, T0 + 6 * DAY);
  assert.equal(s.mail.list.length, 3);
  M.refreshMail(s, T0 + 8 * DAY);
  assert.equal(s.mail.list.length, 0);
  // expiry of an unclaimed mail
  M.sendMail(s, { title: 't', rewards: { gem: 5 }, now: T0 });
  assert.equal(M.unclaimedCount(s, T0), 1);
  const e = M.refreshMail(s, T0 + 31 * DAY);
  assert.equal(e.expired, 1);
  assert.equal(s.mail.list.length, 0);
});

test('mail can carry an item and pet rewards', () => {
  const s = newGame(T0);
  const mail = M.sendMail(s, { title: 'x', rewards: { item: { slot: 'ring', rarity: 'epic' }, petEgg: 1, petFood: 5 }, now: T0 });
  const inv0 = s.inventory.length + s.overflow.length;
  const r = M.claimMail(s, mail.id, T0);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].rarity, 'epic');
  assert.equal(s.inventory.length + s.overflow.length, inv0 + 1);
  assert.equal(s.pets.eggs, 1);
});

test('쿠폰: normalize, hash, expiry, one use per profile, reward arrives as mail', async () => {
  assert.equal(M.normalizeCoupon(' seon-bae '), 'SEONBAE');
  assert.equal(M.normalizeCoupon('Asteria 2026'), 'ASTERIA2026');
  const h = await M.hashCoupon('seon-bae');
  assert.ok(COUPONS.some((c) => c.hash === h));
  assert.equal(h, await M.hashCoupon('SEONBAE'));
  const s = newGame(T0);
  const r = M.redeemCouponHash(s, h, T0);
  assert.equal(r.ok, true);
  assert.equal(s.mail.list[0].rewards.gem, 3000);
  assert.equal(s.wallet.gem, 0);                    // only after claiming the mail
  assert.equal(M.redeemCouponHash(s, h, T0).reason, 'coupon-used');
  assert.equal(M.redeemCouponHash(s, await M.hashCoupon('NOPE'), T0).reason, 'coupon-unknown');
  const late = newGame(T0);
  assert.equal(M.redeemCouponHash(late, await M.hashCoupon('NOCTURNE'), KST(2027, 1, 1)).reason, 'coupon-expired');
  // no plain codes in the coupon table
  const txt = JSON.stringify(COUPONS);
  for (const c of ['SEONBAE', 'NOCTURNE', 'ASTERIA2026']) assert.ok(!txt.includes(c));
});

test('Game: refreshMail saves only when something changes; coupon → mail → claim', async () => {
  const { Game } = await import('../src/core/game.js');
  const { MemorySaver } = await import('../src/platform/memorySaver.js');
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  assert.equal(g.state.mail.list.length, 3);          // delivered by the load housekeeping
  const r2 = await g.refreshMail();
  assert.equal(r2.noop, true);                         // nothing changed → no save
  clock += 31 * 86400000;
  const r3 = await g.refreshMail();
  assert.equal(r3.ok, true); assert.ok(!r3.noop);
  assert.equal(g.state.mail.list.length, 0);          // both expired unclaimed
  g.state.mail.list.length = 0;
  const c = await g.redeemCoupon('asteria-2026');
  assert.equal(c.ok, true);
  assert.equal((await g.redeemCoupon('ASTERIA2026')).reason, 'coupon-used');
  assert.equal((await g.redeemCoupon('   ')).reason, 'coupon-empty');
  const gem0 = g.state.wallet.gem;
  const all = await g.claimAllMail();
  assert.equal(all.ok, true);
  assert.equal(g.state.wallet.gem - gem0, 1000);      // only the coupon mail is left
});
