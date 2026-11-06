// Immersive special-fight layout: boss / dungeon / rift / tower at 3 viewports.
// node tools/qa_immersive.cjs <port>
const { chromium } = require('playwright');
const port = process.argv[2] || '8123';
const base = `http://127.0.0.1:${port}/?autostart&nodaily`;
const out = 'docs/qa/screens/';
const VPS = [[390, 844], [360, 700], [412, 915]];
const results = [];

async function setup(p) {
  await p.goto(base);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(async () => {
    const g = __asteria.game;
    const tx = (fn) => g.transact('qa', (s) => { fn(s); return { ok: true }; });
    await tx((s) => {
      s.player.level = 62; s.player.tier = 2; s.player.branch = s.player.branch || 'knight';
      s.progression.unlockedRegions = ['meadow', 'desert', 'mine', 'forest', 'glacier', 'volcano'];
      for (const r of ['meadow', 'desert', 'mine', 'forest', 'glacier', 'volcano']) s.progression.maxWave[r] = 10;
      for (const b of ['B01', 'B02', 'B03', 'B04', 'B05']) s.progression.bossCleared[b] = true;
      s.dungeon.tickets = 9;
      s.progression.region = 'mine'; s.progression.wave = 10;
      if (s.rift) { s.rift.free = 2; s.rift.freeLeft = 2; }
    });
    if (g.startFarm) g.startFarm();
  });
}

async function start(p, kind) {
  return p.evaluate(async (k) => {
    const g = __asteria.game;
    let r;
    if (k === 'boss') r = g.startBoss('B03');
    if (k === 'dungeon') r = await g.enterDungeon('quarry', 1);
    if (k === 'tower') r = await g.startTower();
    if (k === 'rift') r = g.startRift ? await g.startRift() : (g.enterRift ? await g.enterRift() : { ok: false, reason: 'no api' });
    return { r: r && (r.ok === undefined ? true : r.ok), reason: r && r.reason, mode: g.mode };
  }, kind);
}

(async () => {
  const b = await chromium.launch();
  for (const [w, hgt] of VPS) {
    for (const kind of ['boss', 'dungeon', 'tower', 'rift']) {
      const c = await b.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await setup(p);
      const st = await start(p, kind);
      await p.waitForTimeout(1600);
      // rift may open a blessing choice first; pick the first option
      if (kind === 'rift') { const pick = await p.$('[data-screen="riftBlessing"] button, [data-screen="rift"] .btn-primary'); if (pick) { await pick.click().catch(() => {}); await p.waitForTimeout(800); } }
      const m = await p.evaluate(() => {
        const app = document.getElementById('app');
        const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; };
        const small = [...document.querySelectorAll('#app button')].filter((x) => x.offsetParent && (x.getBoundingClientRect().height < 32 || x.getBoundingClientRect().width < 32)).map((x) => x.textContent.trim().slice(0, 10));
        return {
          immersive: app.classList.contains('immersive'),
          battleH: Math.round(document.querySelector('.battle').getBoundingClientRect().height),
          navVisible: vis('.nav'), panelVisible: vis('.lower'), hud: document.querySelector('.imm-hud b')?.textContent,
          overflow: document.documentElement.scrollWidth > innerWidth, small,
        };
      });
      const pass = st.r && m.immersive && !m.navVisible && !m.panelVisible && !m.overflow && m.small.length === 0 && errs.length === 0;
      results.push({ kind, vp: `${w}x${hgt}`, pass, st, m, errs });
      console.log(pass ? 'PASS' : 'FAIL', kind, `${w}x${hgt}`, JSON.stringify({ st, m, errs }));
      await p.screenshot({ path: `${out}immersive_${kind}_${w}x${hgt}.png` });
      // forfeit → back to the farm layout
      if (kind === 'boss' && w === 390) {
        await p.click('.session-bar .mini-btn');
        await p.waitForSelector('[data-screen="forfeit"], .modal', { timeout: 3000 }).catch(() => {});
        await p.click('text=포기하기').catch(() => {});
        await p.waitForTimeout(1200);
        await p.evaluate(() => { const btn = [...document.querySelectorAll('.modal .btn')].find((x) => /사냥|확인|돌아/.test(x.textContent)); if (btn) btn.click(); });
        await p.waitForTimeout(900);
        const back = await p.evaluate(() => ({ immersive: document.getElementById('app').classList.contains('immersive'), mode: __asteria.game.mode }));
        const ok = !back.immersive && back.mode === 'FARM';
        results.push({ kind: 'forfeit-back', pass: ok, back });
        console.log(ok ? 'PASS' : 'FAIL', 'forfeit-back', JSON.stringify(back));
      }
      await c.close();
    }
  }
  await b.close();
  require('fs').writeFileSync('docs/qa/immersive_results.json', JSON.stringify(results, null, 1));
  const fails = results.filter((r) => !r.pass).length;
  console.log('SUMMARY', results.length - fails, '/', results.length);
  process.exit(fails ? 1 : 0);
})();
