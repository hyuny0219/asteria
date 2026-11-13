#!/usr/bin/env node
// v4 Monte Carlo balance simulation (Lv 1–100) with a scripted "engaged player".
// Real engine (src/core), in-memory saver, fake clock. Mixed play: `--sessions N`
// sessions of `--session-min` minutes per day; offline settlement fills the gaps
// (12 h cap, 75%). Daily attendance and missions are claimed.
//
//   node tools/balance_sim_v4.mjs [--seeds 2] [--days 22] [--sessions 4] [--session-min 30] [--class warrior] [--json out]
import { Game } from '../src/core/game.js';
import { upgradeCost as rbCost, canRebirth } from '../src/core/rebirth.js';
import { riftOpen, runsLeft } from '../src/core/rift.js';
import { MemorySaver } from '../src/platform/memorySaver.js';
import { playerStats } from '../src/core/stats.js';
import { quoteUpgrade, statPointsFree } from '../src/core/economy.js';
import { enhanceCost } from '../src/core/items.js';
import { promotionChecklist, tierOf, lockTierAt, unlockedSkills, skillLevelCost, ultId, raidOpen, towerOpen, dungeonOpen, branchesOf, oathOptions } from '../src/core/progression.js';
import * as BD from '../src/core/bossdaily.js';
import * as DF from '../src/core/difficulty.js';
import { missionStatus } from '../src/core/missions.js';
import { attendanceStatus } from '../src/core/rewards.js';
import { petPower, achievementStatus } from '../src/core/meta.js';
import { TITLES } from '../src/data/meta.js';
import { REGIONS, BOSSES, RUNES } from '../src/data/content.js';
import { BALANCE } from '../src/data/balance.js';
import { writeFileSync } from 'node:fs';
import { steedBonus } from '../src/core/steeds.js';
import { MOUNTS, WINGS } from '../src/data/steeds.js';

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
      // v17 계측: 별의 파편 출처, 노말 보스 실패 원인, 시련 시도
      const sh0 = m.lastShard ?? 0, sh1 = s.wallet.starShard; if (sh1 > sh0) { const src = r.kind === 'boss' ? (r.diff && r.diff !== 'easy' ? 'nboss' : 'boss') : r.kind; (m.shardIn ||= {})[src] = ((m.shardIn ||= {})[src] || 0) + (sh1 - sh0); }
      m.lastShard = sh1;
      if (r.kind === 'boss' && DF.curDiff(s) !== 'easy' && r.bossId === m.repeatBoss && DF.track(s).bossCleared[r.bossId]) { if (r.win) { m.repeatWins = (m.repeatWins || 0) + 1; if (m.repeatWins % 5 === 0) m.repeatDown = Math.max(0, (m.repeatDown || 0) - 1); } else m.repeatDown = (m.repeatDown || 0) + 1; }
      if (r.kind === 'boss' && !r.win && DF.curDiff(s) !== 'easy') { const k = r.bossId + ':' + (r.reason || 'death'); (m.nFail ||= {})[k] = ((m.nFail ||= {})[k] || 0) + 1; }
      if (r.kind === 'trial') (m.trials ||= []).push(`T${r.tier}${r.win ? 'W' : 'L'}@${day().toFixed(1)}`);
      if (r.kind === 'boss') { const dp = r.diff && r.diff !== 'easy' ? r.diff[0].toUpperCase() + '_' : ''; m.bossFights.push({ boss: dp + r.bossId, win: r.win, sec: r.timeSec, lv: s.player.level }); if (r.win) { mark('win_' + dp + r.bossId); lastFailPower = 0; (m.lastWinDay ||= {})[r.diff || 'easy'] = day(); } }
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
      // slot enhancement (schema 6): cheapest worn slot first
      const eq = Object.keys(g.state.equipped).filter((k) => g.state.equipped[k] && (g.state.slotEnhance[k] || 0) < 15);
      eq.sort((a, b) => enhanceCost(g.state.slotEnhance[a] || 0) - enhanceCost(g.state.slotEnhance[b] || 0));
      if (!eq.length || g.state.wallet.ore < enhanceCost(g.state.slotEnhance[eq[0]] || 0)) break;
      await g.enhance(eq[0]);
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
    if (lv >= 100 && (g.state.rebirth.count || 0) < Number(args.rebirths ?? 0)) { const r = await g.doRebirth(); if (r.ok) { mark('rebirth' + g.state.rebirth.count); m.rebirthLevelAtDay = day(); return; } }
    if (g.state.rebirth.count) { for (const L of [50, 100]) if (lv >= L) mark('rb_lv' + L); }
    for (let k = 0; k < 20; k++) { const c = ['atk', 'hp', 'exp', 'gold'].map((x) => [x, rbCost(x, g.state.rebirth.levels[x] || 0)]).sort((a, b) => a[1] - b[1])[0]; if (g.state.rebirth.essence < c[1]) break; await g.rebirthUpgrade(c[0]); }
    // --late N (v18.5 후반 플레이): 초월 뒤 실제 플레이어처럼
    //   · N일마다 Lv 100에서 환생(전직 단계·장비·난이도 기록 유지, 기억의 가속으로 빠르게 복귀)
    //   · Lv 100이면 열린 가장 높은 난이도로 이동(노말 → 하드)
    //   · 탈것·날개 뽑기권·보석으로 소환, 먹이·깃털로 레벨업, ★ 올리기, 가장 센 것 장착
    if (args.late) {
      // v18.5: 환생은 초월 Lv 50부터 — 되는 즉시
      for (const L of [1, 10, 25, 50]) if ((g.state.player.ascLv || 0) >= L) mark('asc' + L);
      if (canRebirth(g.state)) {
        const r = await g.doRebirth(); if (r.ok) { m.lastLateRebirth = day(); (m.lateRebirths ||= []).push(Math.round(day() * 10) / 10); return; }
      }
      if (lv >= 100 && tierOf(g.state) >= 4) {
        let target = DF.diffOpen(g.state, 'hard') ? 'hard' : DF.diffOpen(g.state, 'normal') ? 'normal' : 'easy';
        // v19: 지금 난이도의 2막을 아직 밀고 있으면(최근 2일 안에 보스를 잡았으면) 그대로 — 실제 플레이어처럼
        { const cd = DF.curDiff(g.state); const tr = DF.track(g.state, cd);
          if (cd !== target && !tr.bossCleared.B20 && tr.bossCleared.B10 && day() - (m.lastWinDay?.[cd] ?? -99) < 2) target = cd; }
        if (DF.curDiff(g.state) !== target && g.mode === 'FARM') { const r = await g.switchDifficulty(target); if (r.ok) mark(target + '_start'); }
      }
      for (const kind of ['mount', 'wing']) {
        const tk = kind === 'mount' ? 'mountTicket' : 'wingTicket';
        while ((g.state.wallet[tk] || 0) >= 10) { const r = await g.steedSummon(kind, 10); if (!r.ok) break; }
        if ((g.state.wallet[tk] || 0) > 0) await g.steedSummon(kind, 1);
        if (g.state.wallet.gem >= 3000) await g.steedSummon(kind, 10);
        const box = kind === 'mount' ? g.state.mounts : g.state.wings, T = kind === 'mount' ? MOUNTS : WINGS;
        const ids = Object.keys(box.owned || {});
        for (const id of ids) await g.steedStar(kind, id);
        const val = (id) => { const b = steedBonus(kind, id, box.owned[id]); return Object.entries(b || {}).reduce((a, [k, v]) => a + (['atkPct', 'critDmg', 'aspd', 'hpPct', 'defPct', 'critChance', 'lifesteal', 'cdr'].includes(k) ? v : 0), 0); };
        const best = ids.sort((a, b) => val(b) - val(a))[0];
        if (best) { if (box.equipped !== best) await g.steedEquip(kind, best); for (let k = 0; k < 10; k++) { const r = await g.steedLevel(kind, best, 1); if (!r.ok) break; } }
      }
    }
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
    if (t < 4) {
      const nt = t + 1;
      const cl = promotionChecklist(g.state, nt);
      if (cl.canTrial && clock - lastTrial > 600e3) { lastTrial = clock; if (g.startTrial(nt).ok) return; }
      // v15 초월: 서약은 직업의 첫 번째(A)
      if (cl.canPromote) { const r = await g.promote(nt, nt === 1 ? branch : nt === 4 ? oathOptions(g.state)[0].id : null); if (r.ok) mark('tier' + nt); }
    }
    // v15: 이지 심연의 군주를 잡으면 노말로 넘어가 진행 (--rebirths 0 --full 일 때 의미 있음)
    if (DF.curDiff(g.state) === 'easy' && DF.diffOpen(g.state, 'normal') && g.state.player.level >= 100 && !Number(args.rebirths ?? 0)) { const r = await g.switchDifficulty('normal'); if (r.ok) mark('normal_start'); }
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
    if (!BOSSES[reg.boss].raid && !DF.track(g.state).bossCleared[reg.boss] && g.canChallengeBoss(reg.boss).ok && clock - lastBossTry > 300e3 && (!lastFailPower || power > lastFailPower * 1.1)) {
      lastFailPower = power; lastBossTry = clock;
      g.startBoss(reg.boss);
      return;
    }
    // v17: 노말 이상에서는 하루 반복 처치(최대 3회)를 가장 뒤의 잡은 보스로 — 실제 플레이어처럼
    if (DF.curDiff(g.state) !== 'easy' && BD.left(g.state, clock) > 0 && clock - (m.lastRepeat || 0) > 1800e3) {
      const t = DF.track(g.state);
      // 진 보스는 한 단계 낮춰서 (실제 플레이어처럼 이길 만한 보스를 고름)
      const cleared = REGIONS.filter((r) => t.bossCleared[r.boss]);
      const pick = cleared[Math.max(0, cleared.length - 1 - (m.repeatDown || 0))];
      if (pick && g.canChallengeBoss(pick.boss).ok) { m.lastRepeat = clock; m.repeatBoss = pick.boss; g.startBoss(pick.boss); }
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
    (m.shardDay ||= []).push(g.state.wallet.starShard); m.lastShard = g.state.wallet.starShard;
    // --snap dir: write the save at the end of each listed day (e.g. --snap-days 3,6,10) for other sims
    // (--late: 환생 중이면 Lv 100으로 돌아온 날로 미뤄서 저장 — 하드 측정용)
    if (args.snap) { const days = String(args['snap-days'] || '3,6,10,14').split(',').map(Number); if (days.includes(d + 1)) m.snapDue = d + 1;
      if (m.snapDue && (!args.late || g.state.player.level >= 100)) { const { mkdirSync } = await import('node:fs'); mkdirSync(args.snap, { recursive: true }); writeFileSync(`${args.snap}/${cls}_s${seed}_d${m.snapDue}.json`, JSON.stringify(g.state)); m.snapDue = null; } }
    if (!args.full && g.state.player.level >= 100 && m.marks.tier3 && (g.state.rebirth.count || 0) >= Number(args.rebirths ?? 0)) break;
  }
  if (args.trace) console.error("end", JSON.stringify(m.marks), g.state.player.exp, g.state.player.pendingExp, cls, g.mode, JSON.stringify(g.state.rift.run), g.state.player.level, g.state.progression.region);
  m.final = { level: g.state.player.level, tier: tierOf(g.state), region: g.state.progression.region, wave: g.state.progression.wave, tower: g.state.tower.best, stats: playerStats(g.state), gem: g.state.wallet.gem, days: day(), locked: lockTierAt(g.state) };
  return m;
}

const runs = [];
for (const cls of CLASSES) for (let s = 1; s <= SEEDS; s++) { const t0 = Date.now(); const r = await runOne(s, cls); runs.push(r); console.error(`${cls}#${s} done in ${((Date.now() - t0) / 1000).toFixed(0)}s → L${r.final.level} T${r.final.tier}`); if (args.trace && r.rbTrace) console.error(JSON.stringify(r.rbTrace.filter((_, i) => i % 2 === 0))); }

const keys = ['rebirth1', 'rb_lv50', 'rb_lv100', 'rebirth2', 'rebirth3', 'lv10', 'lv20', 'lv30', 'tier1', 'lv40', 'lv50', 'lv60', 'tier2', 'lv70', 'lv80', 'lv90', 'tier3', 'lv100', ...Object.keys(BOSSES).filter((b) => !BOSSES[b].raid).map((b) => 'win_' + b), 'normal_start', ...REGIONS.map((r) => 'win_N_' + r.boss), 'trial4', 'tier4'];
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
  for (const r of rs) console.log(`  ${cls}#${r.seed} t3 ${r.marks.tier3 ?? "—"} B09 ${r.marks.win_B09 ?? "—"} B10 ${r.marks.win_B10 ?? "—"} lv100 ${r.marks.lv100 ?? "—"} final ${r.final.region}/${r.final.wave} · shardIn ${JSON.stringify(r.shardIn || {})} shard@d ${(r.shardDay || []).filter((_, i) => i % 2 === 1).join(',')} · N-boss ${REGIONS.map((x) => r.marks['win_N_' + x.boss] ?? '—').join(',')} · nFail ${JSON.stringify(r.nFail || {})} · trials ${(r.trials || []).filter((x) => x.startsWith('T4')).slice(0, 8).join(' ')} · tower ${r.final.tower}${args.late ? ` · asc1/10/25/50 ${['asc1', 'asc10', 'asc25', 'asc50'].map((k) => r.marks[k] ?? '—').join('/')} · 환생 ${(r.lateRebirths || []).join(',') || '—'} · H-boss ${REGIONS.map((x) => r.marks['win_H_' + x.boss] ?? '—').join(',')}` : ''} · E2-boss ${REGIONS.filter((x) => x.act === 2).map((x) => r.marks['win_' + x.boss] ?? '—').join(',')}`);
  console.log(`${cls}: final ${rs.map((r) => `L${r.final.level}/T${r.final.tier}/tower${r.final.tower}/${r.final.region}`).join(' ')} · lv100 day ${rs.map((r) => r.marks.lv100 ?? '—').join(',')} · tier4 day ${rs.map((r) => r.marks.tier4 ?? '—').join(',')} · raid ${rs.map((r) => (r.raid || []).join('')).join(' ')} · deaths ${rs.map((r) => r.deaths).join(',')}`);
}
{ const em = {}; for (let L = 2; L <= 10; L++) { const v = runs.map((r) => r.early && r.early[L]).filter((x) => x !== undefined); em[L] = median(v); } report.earlyMin = em;
  console.log('early Lv (min since start, median): ' + Object.entries(em).map(([L, v]) => `Lv${L} ${v?.toFixed(1)}`).join(' · ')); }
report.final = runs.map((r) => ({ cls: r.cls, seed: r.seed, ...r.final, marks: r.marks, raid: r.raid }));
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 1));
