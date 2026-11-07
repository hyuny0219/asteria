#!/usr/bin/env node
// 쐐기 던전 balance check: for saved states (balance_sim_v4.mjs --snap dir), run each key
// level a few times with the real Battle and print timed / overtime / fail and median time.
//   node tools/balance_sim_v4.mjs --seeds 1 --days 11 --snap /tmp/snaps --snap-days 2,4,7,11
//   node tools/mplus_sim.mjs /tmp/snaps [--keys 2-16] [--tries 3]
import { readdirSync, readFileSync } from 'node:fs';
import { Game } from '../src/core/game.js';
import { Battle } from '../src/core/combat.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { migrate } from '../src/core/state.js';
import { MPLUS, runConfig, AFFIXES } from '../src/core/mplus.js';
import { makeRng } from '../src/core/util.js';

const dir = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const [k0, k1] = String(arg('keys', '2-16')).split('-').map(Number);
const tries = Number(arg('tries', 3));
const affSets = [['fortified', 'bursting'], ['tyrannical', 'quaking']];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const st = migrate(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  const g = new Game({ saver: new MemorySaver(), now: () => Date.now() });
  g.state = st; g.rng = makeRng(1);
  const line = [];
  for (const aff of affSets) {
    let maxTimed = 0;
    const cells = [];
    for (let key = k0; key <= k1; key++) {
      const times = []; let timed = 0, fail = 0;
      for (let t = 0; t < tries; t++) {
        const b = new Battle({ kind: 'mplus', rng: makeRng(key * 97 + t), hero: g.sessionHero(), mplus: runConfig(st, ['quarry', 'gold', 'books'][t % 3], key, aff) });
        while (!b.over) { b.step(); b.drainEvents(); }
        if (b.over === 'victory') { times.push(b.t / 1000); if (b.t / 1000 <= MPLUS.timeSec) timed++; } else fail++;
      }
      const med = times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : null;
      if (timed * 2 >= tries) maxTimed = key;
      cells.push(`+${key}:${timed}/${tries}${med ? ` ${Math.round(med)}s` : ''}${fail ? ` ✗${fail}` : ''}`);
    }
    line.push(`  [${aff.map((a) => AFFIXES[a].name).join('·')}] 시간 내 과반 최고 +${maxTimed}\n    ${cells.join(' | ')}`);
  }
  console.log(`${f} · Lv ${st.player.level} T${st.player.tier}\n${line.join('\n')}`);
}
