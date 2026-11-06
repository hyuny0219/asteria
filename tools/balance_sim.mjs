#!/usr/bin/env node
// Monte Carlo balance simulation with a scripted "reasonable player".
// Runs the real engine (src/core) with an in-memory saver and a fake clock.
//
//   node tools/balance_sim.mjs [--seeds 12] [--hours 30] [--json out.json]
//
// Active play only (no offline time) unless --sessions is given: then the player
// plays `--session-min` minutes every `--every-h` hours and offline claims fill the gaps.
import { Game } from '../src/core/game.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { quoteUpgrade } from '../src/core/economy.js';
import { enhanceCost } from '../src/core/items.js';
import { promotionChecklist } from '../src/core/progression.js';
import { REGIONS, BOSSES } from '../src/data/content.js';
import { BALANCE } from '../src/data/balance.js';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const SEEDS = Number(args.seeds || 12);
const HOURS = Number(args.hours || 30);
const SESSIONS = !!args.sessions;
const SESSION_MIN = Number(args['session-min'] || 30);
const EVERY_H = Number(args['every-h'] || 6);

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const median = (a) => pct(a, 0.5);

async function runOne(seed) {
  let clock = Date.UTC(2026, 10, 5, 0, 0, 0) + seed * 1000;
  const saver = new MemorySaver();
  saver.slots.current = { data: JSON.stringify(newGame(clock, seed)), sum: 0 };
  saver.slots.current.data = JSON.stringify({ ...JSON.parse(saver.slots.current.data), revision: 0 });
  const g = new Game({ saver, now: () => clock });
  // seed the new game with our seed so runs are reproducible
  await g.load();
  const m = { seed, marks: {}, bossFights: [], ttk: {}, deaths: 0, promotionBranch: null };
  const mark = (k, t) => { if (m.marks[k] === undefined) m.marks[k] = Math.round(t); };
  const spawnAt = new Map();
  g.on('combat', (ev) => {
    if (ev.type === 'engage' && g.active.kind === 'farm') spawnAt.set(ev.enemy, ev.t);
    if (ev.type === 'kill' && g.active.kind === 'farm' && !ev.enemy.elite) {
      const s0 = spawnAt.get(ev.enemy.uid);
      if (s0 !== undefined) {
        const reg = g.state.progression.region;
        (m.ttk[reg] ||= []).push((ev.t - s0) / 1000);
        spawnAt.delete(ev.enemy.uid);
      }
    }
    if (ev.type === 'heroDown') m.deaths++;
  });
  let t = 0;                 // active seconds played
  let lastBossTry = -1e9;
  const branch = seed % 2 ? 'berserker' : 'knight';
  const tickSecond = async () => {
    for (let i = 0; i < 20; i++) { g.advance(50); clock += 50; }
    await new Promise((r) => setImmediate(r));
    t += 1;
  };
  const policy = async () => {
    const s = g.state;
    if (g.mode === 'RESULT') {
      const r = g.result;
      if (r.kind === 'boss') {
        m.bossFights.push({ boss: r.bossId, win: r.win, sec: r.timeSec, lv: s.player.level, at: t, atk: playerStats(s).atk, hp: playerStats(s).hp });
        if (r.win) { mark('win_' + r.bossId, t); m.lastFailPower = 0; }
      }
      if (r.kind === 'trial' && r.win) mark('trial', t);
      g.returnToFarm();
      if (r.kind === 'boss' && r.win && r.unlocked) await g.setFarm(r.unlocked, 1, true);
      return;
    }
    if (g.mode !== 'FARM') return;
    // spend gold: best value per gold among atk/hp/def/crit/speed
    for (let k = 0; k < 60; k++) {
      const weights = { atk: 1.0, hp: 0.55, def: 0.35, crit: 0.8, speed: 0.9 };
      const st = playerStats(s);
      const val = { atk: 2 / st.atk, hp: 20 / st.hp, def: 1 / Math.max(1, st.def), crit: 0.002 / Math.max(0.05, st.crit), speed: 0.01 / st.aspd };
      let best = null, bestScore = 0;
      for (const stat of Object.keys(weights)) {
        const q = quoteUpgrade(g.state, stat, 1);
        if (!q.count) continue;
        const score = (val[stat] * weights[stat]) / q.total;
        if (score > bestScore) { bestScore = score; best = stat; }
      }
      if (!best) break;
      const r = await g.buyUpgrade(best, 1);
      if (!r.ok) break;
      mark('firstUpgrade', t);
    }
    if (g.state.inventory.length) mark('firstItem', t);
    await g.autoEquip();
    // enhance equipped items with ore, cheapest first
    for (let k = 0; k < 10; k++) {
      // slot enhancement (schema 6): cheapest worn slot first
      const eq = Object.keys(g.state.equipped).filter((k) => g.state.equipped[k] && (g.state.slotEnhance[k] || 0) < 10);
      eq.sort((a, b) => enhanceCost(g.state.slotEnhance[a] || 0) - enhanceCost(g.state.slotEnhance[b] || 0));
      if (!eq.length || g.state.wallet.ore < enhanceCost(g.state.slotEnhance[eq[0]] || 0)) break;
      await g.enhance(eq[0]);
    }
    if (g.state.inventory.length > 60) {
      const ids = g.state.inventory.filter((i) => i.rarity === 'common' && !i.locked && !Object.values(g.state.equipped).includes(i.id)).map((i) => i.id);
      if (ids.length) await g.dismantle(ids);
    }
    // dungeon
    if (g.state.progression.bossCleared.B01 && g.state.dungeon.tickets > 0) {
      const d = g.state.dungeon;
      if (!m.dungeonFailAt || t - m.dungeonFailAt > 1800) {
        const r = await g.enterDungeon(d.best + 1);
        if (r.ok) return;
      }
      if (d.best > 0) await g.sweepDungeon();
    }
    // promotion
    const cl = promotionChecklist(g.state);
    if (g.state.player.level >= 25) mark('lv25', t);
    if (g.state.player.level >= 30) mark('lv30', t);
    if (g.state.player.level >= 35) mark('lv35', t);
    if (g.state.wallet.token >= 20) mark('tokens', t);
    if (cl.canTrial && t - lastBossTry > 120) { lastBossTry = t; g.startTrial(); return; }
    if (cl.canChoose) { const r = await g.choosePromotion(branch); if (r.ok) { mark('promotion', t); m.promotionBranch = branch; } }
    // boss: try when wave 10 reached, wait 2 min after a loss
    const reg = REGIONS.find((r) => r.id === g.state.progression.region);
    const power = playerStats(g.state).atk * playerStats(g.state).hp;
    if (!g.state.progression.bossCleared[reg.boss] && g.canChallengeBoss(reg.boss).ok && t - lastBossTry > 120 && (!m.lastFailPower || power > m.lastFailPower * 1.12)) {
      m.lastFailPower = power;
      lastBossTry = t;
      mark('firstBossTry_' + reg.boss, t);
      g.startBoss(reg.boss);
    }
  };
  const endT = HOURS * 3600;
  while (t < endT) {
    if (SESSIONS && t > 0 && t % (SESSION_MIN * 60) === 0) {
      // go offline until the next session
      await g.onHidden();
      clock += (EVERY_H * 3600 - SESSION_MIN * 60) * 1000;
      g.onVisible();
      if (g.mode === 'OFFLINE') { const c = g.claim; m.offline = (m.offline || 0) + (c ? c.exp : 0); await g.claimOffline(); }
    }
    await tickSecond();
    if (t % 1 === 0) await policy();
    if (g.mode === 'DUNGEON' || g.mode === 'BOSS' || g.mode === 'PROMOTION_TRIAL') continue;
    if (g.result && g.result.kind === 'dungeon' && !g.result.win) m.dungeonFailAt = t;
    if (m.marks.promotion && g.state.player.level >= 35 && m.marks.win_B03) break;
  }
  m.final = { level: g.state.player.level, region: g.state.progression.region, wave: g.state.progression.wave, gold: g.state.wallet.gold, ore: g.state.wallet.ore, dungeonBest: g.state.dungeon.best, kills: g.state.progression.counters.kills, stats: playerStats(g.state), playedSec: t };
  return m;
}

const runs = [];
for (let s = 1; s <= SEEDS; s++) runs.push(await runOne(s));

const keys = ['firstUpgrade', 'firstItem', 'firstBossTry_B01', 'win_B01', 'win_B02', 'lv25', 'tokens', 'lv30', 'win_B03', 'trial', 'promotion', 'lv35'];
const fmtT = (sec) => (sec == null ? '—' : sec < 3600 ? `${(sec / 60).toFixed(1)}분` : `${(sec / 3600).toFixed(2)}시간`);
const report = { balanceVersion: BALANCE.version, seeds: SEEDS, hours: HOURS, sessions: SESSIONS, milestones: {}, ttk: {}, bosses: {}, deaths: [], branchParity: {} };
console.log(`balance ${BALANCE.version} · seeds ${SEEDS} · max ${HOURS}h active${SESSIONS ? ` · sessions ${SESSION_MIN}m/${EVERY_H}h` : ''}`);
console.log('milestone            median      p10        p90      reached');
for (const k of keys) {
  const vals = runs.map((r) => r.marks[k]).filter((v) => v !== undefined);
  report.milestones[k] = { median: median(vals), p10: pct(vals, 0.1), p90: pct(vals, 0.9), reached: vals.length };
  console.log(k.padEnd(20), fmtT(median(vals)).padEnd(11), fmtT(pct(vals, 0.1)).padEnd(10), fmtT(pct(vals, 0.9)).padEnd(8), `${vals.length}/${SEEDS}`);
}
for (const reg of ['meadow', 'desert', 'mine']) {
  const all = runs.flatMap((r) => r.ttk[reg] || []);
  report.ttk[reg] = { median: median(all), p10: pct(all, 0.1), p90: pct(all, 0.9), n: all.length };
  console.log(`TTK ${reg}: median ${median(all)?.toFixed(2)}s p10 ${pct(all, 0.1)?.toFixed(2)} p90 ${pct(all, 0.9)?.toFixed(2)} (n=${all.length})`);
}
for (const b of Object.keys(BOSSES)) {
  const f = runs.flatMap((r) => r.bossFights.filter((x) => x.boss === b));
  const wins = f.filter((x) => x.win);
  report.bosses[b] = { fights: f.length, winRate: f.length ? wins.length / f.length : null, winSecMedian: median(wins.map((x) => x.sec)), tries: median(runs.map((r) => r.bossFights.filter((x) => x.boss === b).length)) };
  const fl = f.map((x) => x.lv);
  console.log(`   ${b} hero level at fights: first ${f[0]?.lv} median ${median(fl)}  atk/hp first ${f[0]?.atk}/${f[0]?.hp}, at first win ${wins[0]?.lv} ${wins[0]?.atk}/${wins[0]?.hp}`);
  console.log(`${b}: fights ${f.length}, win rate ${f.length ? ((wins.length / f.length) * 100).toFixed(0) : '-'}%, win time median ${median(wins.map((x) => x.sec)) ?? '-'}s, tries/run median ${report.bosses[b].tries}`);
}
const byBranch = {};
for (const r of runs) if (r.promotionBranch) (byBranch[r.promotionBranch] ||= []).push(r.marks.lv35 !== undefined ? r.marks.lv35 - r.marks.promotion : null);
report.branchParity = byBranch;
report.deaths = runs.map((r) => r.deaths);
report.final = runs.map((r) => r.final);
console.log('deaths per run', report.deaths.join(','));
console.log('final', runs.map((r) => `L${r.final.level}/${r.final.region}${r.final.wave}/d${r.final.dungeonBest}`).join(' '));
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 1));
