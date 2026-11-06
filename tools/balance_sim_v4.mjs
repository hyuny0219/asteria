#!/usr/bin/env node
// v4 Monte Carlo balance simulation (Lv 1–100) with a scripted "engaged player".
// Real engine (src/core), in-memory saver, fake clock. Mixed play: `--sessions N`
// sessions of `--session-min` minutes per day; offline settlement fills the gaps
// (12 h cap, 75%). Daily attendance and missions are claimed.
//
//   node tools/balance_sim_v4.mjs [--seeds 2] [--days 22] [--sessions 4] [--session-min 30] [--class warrior] [--json out]
import { Game } from '../src/core/game.js';
import { upgradeCost as rbCost } from '../src/core/rebirth.js';
import { riftOpen, runsLeft } from '../src/core/rift.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { playerStats } from '../src/core/stats.js';
import { quoteUpgrade, statPointsFree } from '../src/core/economy.js';
import { enhanceCost } from '../src/core/items.js';
import { promotionChecklist, tierOf, lockTierAt, unlockedSkills, skillLevelCost, ultId, raidOpen, towerOpen, dungeonOpen, branchesOf } from '../src/core/progression.js';
import { missionStatus } from '../src/core/missions.js';
import { attendanceStatus } from '../src/core/rewards.js';
import { petPower, achievementStatus } from '../src/core/meta.js';
import { TITLES } from '../src/data/meta.js';
import { REGIONS, BOSSES, RUNES } from '../src/data/content.js';
import { BALANCE } from '../src/data/balance.js';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const SEEDS = Number(args.seeds || 2);
const DAYS = Number(args.days || 22);
const SESS = Number(args.sessions || 4);
const SESSION_MIN = Number(args['session-min'] || 30);
const CLASSES = args.class ? [args.class] : ['warrior', 'mage', 'archer', 'rogue'];
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const median = (a) => pct(a, 0.5);

// Same contract as MemorySaver without serialising the whole save on every commit
// (the sim commits thousands of times; correctness of saves is covered by tests).
class FastSaver {
  constructor() { this.rev = 0; this.kind = 'memory'; this.failNext = 0; }
  async load() { return { status: 'empty', state: null }; }
  async commit(state) { if (state.revision !== this.rev) return { ok: false, conflict: true }; state.revision = ++this.rev; return { ok: true, revision: this.rev }; }
}

async function runOne(seed, cls) {
  const start = Date.UTC(2026, 10, 5, 0, 0, 0) + seed * 1000;
  let clock = start;
  const saver = new FastSaver();
  const g = new Game({ saver, now: () => clock });
  await g.load();
  await g.chooseClass(cls);
  const m = { seed, cls, marks: {}, bossFights: [], ttk: {}, deaths: 0, draws: 0 };
  const day = () => (clock - start) / 86400000;
  const mark = (k) => { if (m.marks[k] === undefined) m.marks[k] = Math.round(day() * 100) / 100; };
  const spawnAt = new Map();
  g.on('combat', (ev) => {
    if (ev.type === 'engage' && g.active.kind === 'farm') spawnAt.set(ev.enemy, ev.t);
    if (ev.type === 'kill' && g.active.kind === 'farm' && !ev.enemy.elite) {
      const s0 = spawnAt.get(ev.enemy.uid);
      if (s0 !== undefined) { const band = Math.floor(g.state.player.level / 10) * 10; (m.ttk[band] ||= []).push((ev.t - s0) / 1000); spawnAt.delete(ev.enemy.uid); }
    }
    if (ev.type === 'heroDown') m.deaths++;
  });
  let lastBossTry = -1e18, lastTower = -1e18, lastFailPower = 0, lastTrial = -1e18;
  const branch = branchesOf(cls)[seed % 2];
  const tickSecond = () => { for (let i = 0; i < 20; i++) { g.advance(50); clock += 50; } };
  const policy = async () => {
    const s = g.state;
    if (g.mode === 'RESULT') {
      const r = g.result;
      if (r.kind === 'boss') { m.bossFights.push({ boss: r.bossId, win: r.win, sec: r.timeSec, lv: s.player.level }); if (r.win) { mark('win_' + r.bossId); lastFailPower = 0; } }
      if (r.kind === 'trial' && r.win) mark('trial' + r.tier);
      if (r.kind === 'tower' && !r.win) lastTower = clock;
      if (r.kind === 'raid') { (m.raid ||= []).push(r.grade); }
      if (r.kind === 'rift' && r.ended) (m.rift ||= []).push(r.cleared || 0);
      g.returnToFarm();
      if (r.kind === 'boss' && r.win && r.unlocked) await g.setFarm(r.unlocked, 1, true);
      return;
    }
    if (g.mode !== 'FARM') return;
    // attendance / missions
    if (attendanceStatus(s, clock).canClaim) await g.claimAttendance();
    if (s.returnBonus.pending) await g.claimReturn();
    for (const x of missionStatus(g.state, clock).list) if (x.done && !x.claimed) await g.claimMission(x.id);
    if (missionStatus(g.state, clock).canBonus) await g.claimMissionBonus();
    // meta like a real player (unless --nometa): achievements, free pass, eggs, pet food, best pet & title
    if (!args.nometa) {
      if (achievementStatus(g.state).some((x) => x.done && !x.claimed)) await g.claimAllAchievements();
      await g.claimAllPass();
      while (g.state.pets.eggs > 0) { const r = await g.hatchEgg(); if (!r.ok) break; }
      const ids = Object.keys(g.state.pets.owned);
      for (const id of ids) await g.starUpPet(id);
      if (ids.length) {
        const score = (id) => { const p = petPower(g.state, id); return p ? p.coef + Object.values(p.aura)[0] * 10 : 0; };
        const best = ids.sort((a, b) => score(b) - score(a))[0];
        if (g.state.pets.active !== best) await g.setActivePet(best);
        for (let k = 0; k < 5; k++) { const r = await g.feedPet(best); if (!r.ok) break; }
      }
      const tsum = (id) => Object.values((TITLES[id] && TITLES[id].bonus) || {}).reduce((a, v) => a + v, 0);
      const bt = [...(g.state.titles.owned || [])].sort((a, b) => tsum(b) - tsum(a))[0];
      if (bt && g.state.titles.equipped !== bt) await g.equipTitle(bt);
    }
    // gold upgrades: automatic in the game (autogrow.js, runs every 2 s of farming); run once more here
    g.runAutoGrow();
    // skill levels
    for (const id of unlockedSkills(g.state)) {
      const c = skillLevelCost(g.state, id);
      if (c && (g.state.skills.books[id] || 0) >= c.books && g.state.wallet.gold >= c.gold) await g.levelSkill(id);
    }
    // equip skills: fill slots with unlocked non-ult skills
    const ul = unlockedSkills(g.state).filter((id) => id !== ultId(g.state));
    for (let i = 0; i < ul.length; i++) { const free = g.state.skills.equipped.indexOf(null); if (!g.state.skills.equipped.includes(ul[i]) && free >= 0) await g.setSkillSlot(free, ul[i]); }
    // gacha: equipment 11 when possible, skill draws with every 3rd batch
    const w = g.state.wallet;
    if (w.eqTicket >= 11 || w.gem >= 500) { const r = await g.drawEquipment(11); if (r.ok) m.draws += 11; }
    else if (w.eqTicket > 0) await g.drawEquipment(1);
    if (w.skTicket >= 11 || (g.state.wallet.gem >= 800 && m.draws % 33 === 0)) await g.drawSkill(11);
    else if (w.skTicket > 0) await g.drawSkill(1);
    // runes: best two owned
    const owned = Object.entries(g.state.skills.runes.owned).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    for (let i = 0; i < 2 && i < owned.length; i++) if (g.state.skills.runes.equipped[i] !== owned[i]) await g.equipRune(owned[i], i);
    await g.autoEquip();
    for (let k = 0; k < 12; k++) {
      const eq = Object.values(g.state.equipped).filter(Boolean).map((id) => g.state.inventory.find((i) => i.id === id)).filter((i) => i && i.enhance < 15);
      eq.sort((a, b) => enhanceCost(a) - enhanceCost(b));
      if (!eq.length || g.state.wallet.ore < enhanceCost(eq[0])) break;
      await g.enhance(eq[0].id);
    }
    if (g.state.inventory.length > 80) {
      const ids = g.state.inventory.filter((i) => ['common', 'uncommon', 'rare'].includes(i.rarity) && !i.locked && !Object.values(g.state.equipped).includes(i.id)).map((i) => i.id);
      if (ids.length) await g.dismantle(ids);
    }
    if (g.state.overflow.length) await g.moveOverflow();
    // milestones
    const lv = g.state.player.level;
    for (const L of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) if (lv >= L) mark('lv' + L);
    m.early ||= {}; for (let L = 2; L <= 10; L++) if (lv >= L && m.early[L] === undefined) m.early[L] = (clock - start) / 60000;
    // rebirth at Lv 100 (--rebirths, default 1), then spend essence on the cheapest upgrade
    if (lv >= 100 && (g.state.rebirth.count || 0) < Number(args.rebirths ?? 1)) { const r = await g.doRebirth(); if (r.ok) { mark('rebirth' + g.state.rebirth.count); m.rebirthLevelAtDay = day(); return; } }
    if (g.state.rebirth.count) { for (const L of [50, 100]) if (lv >= L) mark('rb_lv' + L); }
    for (let k = 0; k < 20; k++) { const c = ['atk', 'hp', 'exp', 'gold'].map((x) => [x, rbCost(x, g.state.rebirth.levels[x] || 0)]).sort((a, b) => a[1] - b[1])[0]; if (g.state.rebirth.essence < c[1]) break; await g.rebirthUpgrade(c[0]); }
    // dungeons
    for (const type of ['quarry', 'gold', 'books']) {
      if (!dungeonOpen(g.state, type)) continue;
      const d = type === 'quarry' ? g.state.dungeon : g.state.dungeons[type];
      if (d.tickets <= 0) continue;
      if (!m['dfail_' + type] || clock - m['dfail_' + type] > 3 * 3600e3) { const r = await g.enterDungeon(type, d.best + 1); if (r.ok) { m.lastDungeon = type; return; } }
      if (d.best > 0) await g.sweepDungeon(type);
    }
    // promotion
    const t = tierOf(g.state);
    if (t < 3) {
      const nt = t + 1;
      const cl = promotionChecklist(g.state, nt);
      if (cl.canTrial && clock - lastTrial > 600e3) { lastTrial = clock; if (g.startTrial(nt).ok) return; }
      if (cl.canPromote) { const r = await g.promote(nt, nt === 1 ? branch : null); if (r.ok) mark('tier' + nt); }
    }
    // talents: one-toggle auto allocation from tier 1
    if (t >= 1 && !g.state.talents.auto) await g.talentAuto(true);
    // rift: free runs (always take the first blessing)
    if (riftOpen(g.state) && (g.state.rift.run || runsLeft(g.state, clock) > 0)) { if (g.state.rift.run?.choices) await g.riftPick(g.state.rift.run.choices[0]); const r = await g.startRift(); if (r.ok) return; }
    // tower
    if (towerOpen(g.state) && clock - lastTower > 1800e3 && (g.state.tower.best < 5 || lv >= 55)) { if (g.startTower().ok) return; }
    // raid
    if (raidOpen(g.state) && g.state.raid.tries < BALANCE.raid.weeklyTries) { const r = await g.startRaid(); if (r.ok) return; }
    // boss
    const reg = REGIONS.find((r) => r.id === g.state.progression.region);
    const st = playerStats(g.state);
    const power = st.atk * st.hp;
    if (!BOSSES[reg.boss].raid && !g.state.progression.bossCleared[reg.boss] && g.canChallengeBoss(reg.boss).ok && clock - lastBossTry > 300e3 && (!lastFailPower || power > lastFailPower * 1.1)) {
      lastFailPower = power; lastBossTry = clock;
      g.startBoss(reg.boss);
    }
  };
  const perDaySec = SESS * SESSION_MIN * 60;
  const gapMs = (86400 - perDaySec) / SESS * 1000;
  for (let d = 0; d < DAYS; d++) {
    for (let k = 0; k < SESS; k++) {
      for (let sec = 0; sec < SESSION_MIN * 60; sec++) {
        tickSecond();
        if (g.busy) await new Promise((r) => setImmediate(r));
        if (sec % 10 === 0 || g.mode === 'RESULT') await policy();
      }
      // leave: finish any running session first
      let guard = 0;
      while (['BOSS', 'DUNGEON', 'PROMOTION_TRIAL'].includes(g.mode) && guard++ < 400) { tickSecond(); await new Promise((r) => setImmediate(r)); }
      if (g.mode === 'RESULT') await policy();
      if (g.state.rebirth.count) (m.rbTrace ||= []).push([Math.round(day() * 100) / 100, g.state.player.level, g.state.progression.region, g.state.progression.wave, g.mode]);
      await g.onHidden();
      clock += gapMs;
      g.onVisible();
      if (g.mode === "OFFLINE") { const lv0 = g.state.player.level; const pc = g.state.offlineSnapshot.pendingClaim; await g.claimOffline(); if (args.trace && g.state.rebirth.count) console.error("off", lv0, "->", g.state.player.level, pc && pc.exp, pc && pc.reason, pc && pc.farm && pc.farm.level); }
    }
    if (g.state.player.level >= 100) mark('lv100');
    if (g.state.player.level >= 100 && m.marks.tier3 && (g.state.rebirth.count || 0) >= Number(args.rebirths ?? 1)) break;
  }
  if (args.trace) console.error("end", JSON.stringify(m.marks), g.state.player.exp, g.state.player.pendingExp, cls, g.mode, JSON.stringify(g.state.rift.run), g.state.player.level, g.state.progression.region);
  m.final = { level: g.state.player.level, tier: tierOf(g.state), region: g.state.progression.region, wave: g.state.progression.wave, tower: g.state.tower.best, stats: playerStats(g.state), gem: g.state.wallet.gem, days: day(), locked: lockTierAt(g.state) };
  return m;
}

const runs = [];
for (const cls of CLASSES) for (let s = 1; s <= SEEDS; s++) { const t0 = Date.now(); const r = await runOne(s, cls); runs.push(r); console.error(`${cls}#${s} done in ${((Date.now() - t0) / 1000).toFixed(0)}s → L${r.final.level} T${r.final.tier}`); if (args.trace && r.rbTrace) console.error(JSON.stringify(r.rbTrace.filter((_, i) => i % 2 === 0))); }

const keys = ['rebirth1', 'rb_lv50', 'rb_lv100', 'rebirth2', 'rebirth3', 'lv10', 'lv20', 'lv30', 'tier1', 'lv40', 'lv50', 'lv60', 'tier2', 'lv70', 'lv80', 'lv90', 'tier3', 'lv100', ...Object.keys(BOSSES).filter((b) => !BOSSES[b].raid).map((b) => 'win_' + b)];
console.log(`balance ${BALANCE.version} · ${CLASSES.join('/')} × ${SEEDS} seeds · ${SESS}×${SESSION_MIN}min/day · max ${DAYS} days (days since start)`);
console.log('milestone    median   p10     p90     reached');
const report = { balanceVersion: BALANCE.version, classes: CLASSES, seeds: SEEDS, sessions: SESS, sessionMin: SESSION_MIN, milestones: {}, ttk: {}, bosses: {}, final: [] };
for (const k of keys) {
  const vals = runs.map((r) => r.marks[k]).filter((v) => v !== undefined);
  report.milestones[k] = { median: median(vals), p10: pct(vals, 0.1), p90: pct(vals, 0.9), reached: vals.length };
  console.log(k.padEnd(12), String(median(vals) ?? '—').padEnd(8), String(pct(vals, 0.1) ?? '—').padEnd(7), String(pct(vals, 0.9) ?? '—').padEnd(7), `${vals.length}/${runs.length}`);
}
for (const band of Object.keys(Object.assign({}, ...runs.map((r) => r.ttk))).sort((a, b) => a - b)) {
  const all = runs.flatMap((r) => r.ttk[band] || []);
  report.ttk[band] = { median: median(all), p90: pct(all, 0.9), n: all.length };
  console.log(`TTK Lv${band}–${+band + 9}: median ${median(all)?.toFixed(2)}s p90 ${pct(all, 0.9)?.toFixed(2)} (n=${all.length})`);
}
for (const b of Object.keys(BOSSES).filter((x) => !BOSSES[x].raid)) {
  const f = runs.flatMap((r) => r.bossFights.filter((x) => x.boss === b));
  const wins = f.filter((x) => x.win);
  report.bosses[b] = { fights: f.length, winRate: f.length ? wins.length / f.length : null, winSec: median(wins.map((x) => x.sec)) };
  console.log(`${b}: fights ${f.length}, win ${f.length ? Math.round((wins.length / f.length) * 100) : '-'}%, win time median ${median(wins.map((x) => x.sec)) ?? '-'}s`);
}
for (const cls of CLASSES) {
  const rs = runs.filter((r) => r.cls === cls);
  console.log(`${cls}: final ${rs.map((r) => `L${r.final.level}/T${r.final.tier}/tower${r.final.tower}/${r.final.region}`).join(' ')} · lv100 day ${rs.map((r) => r.marks.lv100 ?? '—').join(',')} · raid ${rs.map((r) => (r.raid || []).join('')).join(' ')} · deaths ${rs.map((r) => r.deaths).join(',')}`);
}
{ const em = {}; for (let L = 2; L <= 10; L++) { const v = runs.map((r) => r.early && r.early[L]).filter((x) => x !== undefined); em[L] = median(v); } report.earlyMin = em;
  console.log('early Lv (min since start, median): ' + Object.entries(em).map(([L, v]) => `Lv${L} ${v?.toFixed(1)}`).join(' · ')); }
report.final = runs.map((r) => ({ cls: r.cls, seed: r.seed, ...r.final, marks: r.marks, raid: r.raid }));
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 1));
