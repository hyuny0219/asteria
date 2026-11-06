// Combat feel QA: combo steps, crit, skill VFX and the ultimate cut-in per class.
// node tools/qa_combat_fx.cjs <port>
// Captures docs/qa/screens/fx_*.png by freezing the renderer a fixed time after
// the triggering combat event (the canvas keeps its last frame), and measures
// renderer draw cost (avg / p95 ms per frame) and particle counts.
const { chromium } = require('playwright');
const fs = require('fs');
const port = process.argv[2] || '8123';
const base = `http://127.0.0.1:${port}/?autostart&nodaily`;
const out = 'docs/qa/screens/';
const results = [];
const CLASSES = [
  { cls: 'warrior', branch: 'knight', tier: 2, skill: 'strike', skill2: 'w_judgement' },
  { cls: 'mage', branch: 'wizard', tier: 1, skill: 'm_frost', skill2: 'm_chain' },
  { cls: 'archer', branch: null, tier: 0, skill: 'a_multi', skill2: 'a_aim' },
  { cls: 'rogue', branch: 'trickster', tier: 1, skill: 'r_poison', skill2: 'r_smoke' },
];

async function setup(p, c) {
  await p.goto(base);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(async (c) => {
    const { CLASS_SKILLS, BRANCH_SKILL, BRANCH_SKILL2 } = await import('/src/data/content.js');
    const g = __asteria.game;
    await g.transact('qa', (s) => {
      const p = s.player;
      p.cls = c.cls; p.branch = c.branch; p.tier = c.tier; p.level = c.tier >= 2 ? 62 : c.tier ? 35 : 20; s.classChosen = true;
      s.skills.equipped = [...CLASS_SKILLS[c.cls].base, c.tier >= 1 ? BRANCH_SKILL[c.branch] : null, c.tier >= 2 ? BRANCH_SKILL2[c.branch] : null];
      s.skills.autoCast = false; s.skills.ultAuto = 'OFF';
      s.progression.region = 'meadow'; s.progression.wave = 3;
      s.settings.damageNumbers = 'all';
      return { ok: true };
    });
    g.startFarm();
    // QA only: keep enemies alive and the hero topped up so combos chain
    globalThis.__qaTank = setInterval(() => {
      const b = g.active; if (!b) return;
      for (const e of b.enemies) if (!e.__qa) { e.__qa = 1; e.maxHp *= 40; e.hp = e.maxHp; }
      b.hero.hp = b.hero.maxHp;
    }, 100);
    // event log + freeze hook
    const r = __asteria.app.renderer;
    globalThis.__fx = { log: [], want: null, done: false, draw: [], maxParts: 0 };
    const orig = r.onCombat.bind(r);
    r.onCombat = (ev, b) => {
      const cue = orig(ev, b);
      const F = __fx;
      if (ev.type === 'hit' && ev.by === 'hero') F.log.push({ a: ev.action, step: ev.action === 'attack' ? r.combo.step : 0, crit: ev.crit, cue });
      const w = F.want;
      if (w && !F.done && !w.armed && w.match(ev, r)) { w.armed = true; setTimeout(() => { r.draw = () => {}; F.done = true; }, w.delay); }
      return cue;
    };
    const d0 = r.draw.bind(r);
    r.__draw = d0;
    const timed = (...a) => { const t = performance.now(); d0(...a); __fx.draw.push(performance.now() - t); __fx.maxParts = Math.max(__fx.maxParts, r.parts.count); };
    r.draw = timed; r.__timed = timed;
  }, c);
}

// arm a capture: match is a function source evaluated in the page
async function capture(p, name, matchSrc, delay, before, timeout = 15000) {
  await p.evaluate(({ matchSrc, delay }) => {
    const r = __asteria.app.renderer;
    r.draw = r.__timed;
    __fx.done = false;
    __fx.want = { match: new Function('ev', 'r', matchSrc), delay, armed: false };
  }, { matchSrc, delay });
  if (before) await p.evaluate(`(${before})()`);
  const ok = await p.waitForFunction(() => __fx.done, null, { timeout }).then(() => true).catch(() => false);
  if (ok) await p.locator('canvas').first().screenshot({ path: `${out}${name}.png` });
  results.push({ name, pass: ok });
  console.log(ok ? 'PASS' : 'FAIL', name);
  return ok;
}

(async () => {
  const b = await chromium.launch();
  const perf = [];
  for (const c of CLASSES) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await setup(p, c);
    await p.waitForTimeout(2500);
    // 1) combo: a finisher (3타) captured just after contact
    await capture(p, `fx_combo3_${c.cls}`, "return ev.type==='hit' && ev.by==='hero' && ev.action==='attack' && r.combo.step===3 && !ev.crit", c.cls === 'mage' || c.cls === 'archer' ? 230 : 90);
    await capture(p, `fx_combo2_${c.cls}`, "return ev.type==='hit' && ev.by==='hero' && ev.action==='attack' && r.combo.step===2", c.cls === 'mage' || c.cls === 'archer' ? 120 : 70);
    // 2) crit (warrior only, rogue has the highest crit — use both)
    if (c.cls === 'rogue' || c.cls === 'warrior') await capture(p, `fx_crit_${c.cls}`, "return ev.type==='hit' && ev.by==='hero' && ev.crit && ev.action==='attack'", 110, null, 45000);
    // 3) skills
    for (const id of [c.skill, c.skill2]) {
      await capture(p, `fx_skill_${c.cls}_${id}`, `return (ev.type==='hit' && ev.by==='hero' && ev.skill==='${id}') || (ev.type==='buff' && ev.skill==='${id}')`, id === 'm_frost' || id === 'r_smoke' || id === 'm_chain' ? 140 : 160,
        `() => { const b = __asteria.game.active; b.hero.cds['${id}'] = 0; b.manualQueue.push('${id}'); }`);
    }
    // 4) ultimate: cut-in banner (~450 ms after ultStart), then the impact effect
    const ultFire = '() => { const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); }';
    await capture(p, `fx_ult_cutin_${c.cls}`, "return ev.type==='ultStart'", 430, ultFire);
    await p.evaluate(() => { const r = __asteria.app.renderer; r.draw = r.__timed; });
    await p.waitForTimeout(1600);
    await capture(p, `fx_ult_${c.cls}`, "return ev.type==='hit' && ev.by==='hero' && ev.action==='ult'", c.cls === 'rogue' ? 300 : 260, ultFire);
    await p.evaluate(() => { const r = __asteria.app.renderer; r.draw = r.__timed; });
    // 5) frame cost over 3 s of normal fighting with skills + an ult
    await p.evaluate(() => { __fx.draw.length = 0; __fx.maxParts = 0; __fx.want = null; const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); });
    await p.waitForTimeout(3000);
    const m = await p.evaluate(() => {
      const d = [...__fx.draw].sort((a, b) => a - b);
      const avg = d.reduce((a, b) => a + b, 0) / d.length;
      const steps = __fx.log.filter((x) => x.a === 'attack').map((x) => x.step).join('');
      return { frames: d.length, avgMs: +avg.toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2), maxParts: __fx.maxParts, fx: __asteria.app.renderer.fx.length, steps: steps.slice(0, 24), cues: [...new Set(__fx.log.map((x) => x.cue))].join(',') };
    });
    const comboOk = /123/.test(m.steps);
    const pass = errs.length === 0 && m.p95Ms < 8 && comboOk;
    perf.push({ cls: c.cls, ...m, errs });
    results.push({ name: `perf_${c.cls}`, pass, m, errs });
    console.log(pass ? 'PASS' : 'FAIL', 'perf', c.cls, JSON.stringify(m), errs.join(' | '));
    await ctx.close();
  }
  // reduce motion + shake off: no cut-in banner, no errors, ult still resolves
  {
    const ctx = await b.newContext({ viewport: { width: 360, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await setup(p, CLASSES[0]);
    await p.evaluate(async () => { await __asteria.game.setSetting('reduceMotion', true); await __asteria.game.setSetting('shake', false); });
    await p.waitForTimeout(1500);
    await capture(p, 'fx_ult_reduced_warrior', "return ev.type==='ultStart'", 430, '() => { const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); }');
    const m = await p.evaluate(() => { const r = __asteria.app.renderer; return { simple: !!(r.cut && r.cut.simple), shake: r.shake.until > performance.now() }; });
    const pass = m.simple && !m.shake && errs.length === 0;
    results.push({ name: 'reduced_motion', pass, m, errs });
    console.log(pass ? 'PASS' : 'FAIL', 'reduced_motion', JSON.stringify(m), errs.join(' | '));
    // tap to skip the cut-in
    await p.evaluate(async () => { await __asteria.game.setSetting('reduceMotion', false); const r = __asteria.app.renderer; r.draw = r.__timed; });
    await p.waitForTimeout(1600);
    await p.evaluate(() => { const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); });
    await p.waitForFunction(() => __asteria.app.renderer.cut && !__asteria.app.renderer.cut.simple, null, { timeout: 5000 }).catch(() => {});
    await p.locator('canvas').first().tap({ position: { x: 200, y: 200 } }).catch(() => {});
    const sk = await p.evaluate(() => ({ skipped: !!(__asteria.app.renderer.cut && __asteria.app.renderer.cut.skipped), mode: __asteria.game.mode }));
    results.push({ name: 'tap_skip_cutin', pass: sk.skipped && sk.mode === 'FARM', sk });
    console.log(sk.skipped ? 'PASS' : 'FAIL', 'tap_skip_cutin', JSON.stringify(sk));
    await ctx.close();
  }
  // immersive boss fight (tall canvas): skill toast + cut-in + finisher at full size
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await setup(p, CLASSES[1]);
    const st = await p.evaluate(async () => {
      const g = __asteria.game;
      await g.transact('qa', (s) => { s.progression.maxWave.meadow = 10; s.progression.wave = 10; return { ok: true }; });
      const r = g.startBoss('B01');
      return { ok: !r || r.ok !== false, mode: g.mode, reason: r && r.reason };
    });
    await p.waitForTimeout(2600);
    await capture(p, 'fx_boss_combo3_mage', "return ev.type==='hit' && ev.by==='hero' && ev.action==='attack' && r.combo.step===3", 220);
    await capture(p, 'fx_boss_skill_mage', "return ev.type==='hit' && ev.by==='hero' && ev.skill==='m_chain'", 140, "() => { const b = __asteria.game.active; b.hero.cds.m_chain = 0; b.manualQueue.push('m_chain'); }");
    await capture(p, 'fx_boss_ult_cutin_mage', "return ev.type==='ultStart'", 430, '() => { const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); }');
    await p.evaluate(() => { const r = __asteria.app.renderer; r.draw = r.__timed; });
    await p.waitForTimeout(1600);
    await capture(p, 'fx_boss_ult_mage', "return ev.type==='hit' && ev.by==='hero' && ev.action==='ult'", 200, '() => { const b = __asteria.game.active; b.hero.gauge = 100; b.manualQueue.push(b.ultId); }');
    const pass = st.ok && errs.length === 0;
    results.push({ name: 'immersive_boss', pass, st, errs });
    console.log(pass ? 'PASS' : 'FAIL', 'immersive_boss', JSON.stringify(st), errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync('docs/qa/combat_fx.json', JSON.stringify({ results, perf }, null, 1));
  const fail = results.filter((r) => !r.pass).length;
  console.log(`combat fx QA: ${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
