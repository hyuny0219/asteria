// GPT O1/O2 적용 확인: 직업마다 2·3·4차 전투 화면 + 초월 창(4차 그림). docs/qa/screens/v15_art_*.png
// usage: node tools/qa_v15_art.cjs [port] (QA_URL 우선)
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs', 'qa', 'screens');
(async () => {
  const base = (process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8436) + '/') + '?autostart&nodaily';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  const clean = () => p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
  await clean();
  const shots = []; const info = [];
  for (const [cls, br] of [['warrior', 'knight'], ['warrior', 'berserker'], ['mage', 'wizard'], ['mage', 'warlock'], ['archer', 'ranger'], ['archer', 'hunter'], ['rogue', 'assassin'], ['rogue', 'trickster']]) {
    for (const tier of [2, 3, 4]) {
      await p.evaluate(async ({ cls, br, tier }) => { const g = __asteria.game; for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { s.player.cls = cls; s.classChosen = true; s.player.level = 100; s.player.tier = tier; s.player.branch = br; s.player.statsUpgrades.hp = 20000; s.player.statsUpgrades.def = 3000; s.progression.region = 'meadow'; s.progression.wave = 1; return { ok: true }; }); if (r.ok) break; await new Promise((r) => setTimeout(r, 50)); } g.startFarm && g.startFarm(); }, { cls, br, tier });
      await p.waitForTimeout(1400);
      await clean();
      const r = await p.evaluate(() => { const c = document.querySelector('canvas'); const bb = c.getBoundingClientRect(); const rd = __asteria.app.renderer || __asteria.renderer; return { x: bb.x, y: bb.y, w: bb.width, h: bb.height, tier: rd && rd.heroTier, t4art: rd && rd.heroArtT4 }; });
      info.push({ cls, br, tier, t4art: r.t4art, rtier: r.tier });
      const f = path.join(OUT, `v15_art_${br}_t${tier}_390.png`);
      await p.screenshot({ path: f, clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
      shots.push(f);
    }
  }
  // 초월 창 (4차 그림)
  await p.evaluate(async () => { const g = __asteria.game; for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { s.player.cls = 'mage'; s.player.branch = 'wizard'; s.player.tier = 3; return { ok: true }; }); if (r.ok) break; await new Promise((r) => setTimeout(r, 50)); } const m = await import('/src/ui/v4.js'); (m.openAscend || m.openTier4 || (() => {}))(__asteria.app); });
  await p.waitForTimeout(600);
  const asc = await p.evaluate(() => { const el = document.querySelector('[data-screen="promotion"][data-tier="4"]'); return el ? [...el.querySelectorAll('img')].map((i) => i.getAttribute('src')) : null; });
  if (asc) await p.screenshot({ path: path.join(OUT, 'v15_art_ascend_390x844.png') });
  console.log(JSON.stringify({ info, asc, errs }));
  await b.close();
})();
