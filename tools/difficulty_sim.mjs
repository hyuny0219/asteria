#!/usr/bin/env node
// 난이도 balance check: for Lv 100 saves (balance_sim_v4.mjs --rebirths 0 --full --snap dir),
// farm each region's stage 1 / 10 and fight its boss on 노말 and 하드 with the real Battle.
//   farm cell  = kills per minute · deaths per 10 kills over 90 s of simulated play
//   boss cell  = wins / tries (median seconds)
//   node tools/difficulty_sim.mjs <snapdir> [--diffs normal,hard] [--tries 3]
import { readdirSync, readFileSync } from 'node:fs';
import { Game } from '../src/core/game.js';
import { Battle } from '../src/core/combat.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { migrate } from '../src/core/state.js';
import { REGIONS } from '../src/data/content.js';
import { makeRng } from '../src/core/util.js';
import * as DF from '../src/core/difficulty.js';
import { playerStats } from '../src/core/stats.js';

const dir = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const diffs = String(arg('diffs', 'normal,hard')).split(',');
const tries = Number(arg('tries', 3));
const only = arg('regions', null);
// --set normal.atk.growth=1.02,hard.hp.base=2 : try values without editing the data file
for (const kv of String(arg('set', '')).split(',').filter(Boolean)) {
  const [path, v] = kv.split('='); const ks = path.split('.');
  let o = DF.DIFFICULTY; for (const k of ks.slice(0, -1)) o = o[k];
  o[ks[ks.length - 1]] = Number(v);
}

function farm(g, d, region, wave, seed) {
  const b = new Battle({ kind: 'farm', rng: makeRng(seed), hero: g.heroCfg({}), farm: {
    monsters: region.monsters, levelFn: () => DF.farmLevel(d, region.id, wave), mulFn: () => DF.enemyMul(d, region.id, wave), eliteAllowed: () => wave >= 4 } });
  let kills = 0, deaths = 0;
  while (b.t < 90000) { b.step(); for (const e of b.drainEvents()) { if (e.type === 'kill') kills++; if (e.type === 'heroDown') deaths++; } }
  return { kpm: kills / 1.5, dp10: kills ? (deaths * 10) / kills : deaths ? 99 : 0 };
}
function boss(g, d, region, seed) {
  const b = new Battle({ kind: 'boss', rng: makeRng(seed), hero: g.heroCfg({ session: true, kind: 'boss' }), boss: { id: region.boss, diff: d === 'easy' ? null : { level: DF.bossLevel(d, region.boss), mul: DF.enemyMul(d, region.id, 'boss') } } });
  while (!b.over) { b.step(); b.drainEvents(); }
  return { win: b.over === 'victory', sec: b.t / 1000 };
}

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const st = migrate(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  const g = new Game({ saver: new MemorySaver(), now: () => Date.now() });
  g.state = st; g.rng = makeRng(1);
  const ps = playerStats(st);
  console.log(`\n${f} · Lv ${st.player.level} T${st.player.tier} · 공격 ${Math.round(ps.atk)} 체력 ${Math.round(ps.hp)}`);
  for (const d of diffs) {
    const cells = [];
    let wall = null;
    for (const r of REGIONS) {
      if (only && !only.split(',').includes(r.id)) continue;
      const a = farm(g, d, r, 1, 11), z = farm(g, d, r, 10, 12);
      let wins = 0; const secs = [];
      for (let t = 0; t < tries; t++) { const x = boss(g, d, r, 100 + t); if (x.win) { wins++; secs.push(x.sec); } }
      const med = secs.length ? Math.round(secs.sort((p, q) => p - q)[Math.floor(secs.length / 2)]) : null;
      const ok = z.dp10 < 2 && wins * 2 >= tries;
      if (!ok && !wall) wall = `${r.order + 1}`;
      cells.push(`${r.order + 1}:${Math.round(a.kpm)}/${a.dp10.toFixed(1)}→${Math.round(z.kpm)}/${z.dp10.toFixed(1)} B${wins}/${tries}${med ? ' ' + med + 's' : ''}`);
    }
    console.log(`  [${DF.diffName(d)}] 벽: ${wall ? wall + '지역' : '없음'}\n    ${cells.join(' | ')}`);
  }
}
