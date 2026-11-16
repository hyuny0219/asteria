import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/core/combat.js';
import { makeRng } from '../src/core/util.js';
import * as tower from '../src/core/tower.js';

// v19.1: 목표 처치 수가 있는 전투(탑 등)는 목표만큼만 적이 나오고, 마지막 적을 잡으면 필드가 비어 있음
test('탑: 목표 처치 수보다 많은 적이 나오지 않고, 끝날 때 남은 적이 없음', () => {
  for (const floor of [1, 30, 80]) {
    const st = { atk: 1e7, hp: 1e8, def: 1e5, crit: 0.3, critMul: 2, aspd: 3, evade: 0, lifesteal: 0, dmgTaken: 0 };
    const b = new Battle({ kind: 'tower', rng: makeRng(floor), hero: { stats: st, pet: null, skills: { equipped: [null, null, null], levels: {}, runes: null }, branch: null, cls: 'archer', tier: 4, ult: 'starSlash', range: 'ranged', skillLevel: () => 1 },
      tower: tower.towerConfig(floor) });
    let spawned = 0, maxLive = 0;
    for (let i = 0; i < 20000 && !b.over; i++) {
      b.step();
      for (const ev of b.drainEvents()) if (ev.type === 'spawn') spawned++;
      maxLive = Math.max(maxLive, b.kills + b.alive().length);
    }
    assert.ok(b.over, 'floor ' + floor + ' finished');
    assert.equal(b.kills, b.killTarget);
    assert.ok(spawned <= b.killTarget, `spawned ${spawned} ≤ ${b.killTarget}`);
    assert.equal(b.alive().length, 0);
    assert.ok(maxLive <= b.killTarget);
  }
});
