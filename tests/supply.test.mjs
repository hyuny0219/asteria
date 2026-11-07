import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { BALANCE } from '../src/data/balance.js';

const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);

test('사냥 보급: every N foreground kills gives gems and draw tickets', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  const SP = BALANCE.supply;
  const w0 = { ...g.state.wallet };
  g.state.supply = { kills: SP.skEvery - 1 };
  g.processFarm({ type: 'kill', enemy: { id: 'M01', level: 1, elite: false, fieldBoss: false } });
  assert.equal(g.state.supply.kills, SP.skEvery);
  assert.equal(g.state.wallet.skTicket - w0.skTicket, 1);
  assert.equal(g.state.wallet.eqTicket - w0.eqTicket, 1);          // 1000 is also a multiple of 500
  assert.ok(g.state.wallet.gem - w0.gem >= SP.gem);                 // and of 200
  g.processFarm({ type: 'kill', enemy: { id: 'M01', level: 1, elite: false, fieldBoss: false } });
  assert.equal(g.state.wallet.skTicket - w0.skTicket, 1);          // no double grant
});

test('field boss gives gems + equipment tickets', async () => {
  let clock = T0;
  const g = new Game({ saver: new MemorySaver(), now: () => clock });
  await g.load();
  const w0 = { ...g.state.wallet };
  g.state.supply = { kills: 1 };
  g.processFarm({ type: 'kill', enemy: { id: 'M01', level: 5, elite: true, fieldBoss: true } });
  assert.equal(g.state.wallet.gem - w0.gem, BALANCE.supply.fieldBossGem);
  assert.equal(g.state.wallet.eqTicket - w0.eqTicket, BALANCE.supply.fieldBossEqTicket);
});
