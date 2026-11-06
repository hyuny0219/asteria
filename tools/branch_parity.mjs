#!/usr/bin/env node
// Branch parity: same Lv30 stats/gear, B03 (and the trial) fought N times per branch
// with the same seeds. Reports win rate and median clear time for knight/berserker/none.
import { Battle } from '../src/core/combat.js';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { makeItem } from '../src/core/items.js';
import { skillLevel } from '../src/core/progression.js';
import { makeRng } from '../src/core/util.js';

const N = Number(process.argv[2] || 40);
function build(branch, power) {
  const s = newGame(0, 1);
  s.player.level = 30;
  s.player.statsUpgrades = { atk: Math.round(55 * power), hp: Math.round(50 * power), def: Math.round(25 * power), crit: 15, speed: 20 };
  const rng = makeRng(11);
  for (const slot of ['weapon', 'helmet', 'armor', 'accessory']) { const it = makeItem(s, { slot, rarity: 'rare', level: 28, rng }); s.inventory.push(it); s.equipped[slot] = it.id; if (s.slotEnhance[slot] !== undefined) s.slotEnhance[slot] = 5; }
  if (branch) { s.player.branch = branch; s.skills.equipped[3] = branch === 'knight' ? 'guardCounter' : 'berserkStrike'; }
  return s;
}
function fight(s, seed, kind = 'boss') {
  const b = new Battle({ kind, rng: makeRng(seed), hero: { stats: playerStats(s), skills: s.skills, branch: s.player.branch, skillLevel: (id) => skillLevel(s, id) }, boss: { id: 'B03' } });
  while (!b.over && b.t < 200000) b.step();
  return { win: b.over === 'victory', sec: b.t / 1000, hpLeft: b.hero.hp / b.hero.maxHp };
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const out = {};
for (const power of [0.8, 1.0, 1.2]) {
  for (const br of [null, 'knight', 'berserker']) {
    const s = build(br, power);
    const res = Array.from({ length: N }, (_, i) => fight(s, 1000 + i));
    const wins = res.filter((r) => r.win);
    const key = `power${power}:${br || 'unpromoted'}`;
    out[key] = { winRate: wins.length / N, medianWinSec: med(wins.map((r) => r.sec)), medianHpLeft: med(wins.map((r) => r.hpLeft)), atk: playerStats(s).atk, hp: playerStats(s).hp };
    console.log(key.padEnd(26), `win ${(100 * wins.length / N).toFixed(0)}%`.padEnd(9), `time ${out[key].medianWinSec ?? '-'}s`.padEnd(11), `hp left ${out[key].medianHpLeft?.toFixed(2) ?? '-'}`, `atk ${out[key].atk} hp ${out[key].hp}`);
  }
}
if (process.argv[3]) (await import('node:fs')).writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
