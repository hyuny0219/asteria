// v8 콘텐츠 QA: 쐐기 던전 (카드·선택 창·전투 HUD·결과) × 3 해상도. Captures docs/qa/screens/v8_*.png.
//   node tools/serve.mjs 8123 & NODE_PATH=$(npm root -g) node tools/qa_v8.cjs 8123
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.QA_URL || `http://localhost:${process.argv[2] || 8123}/`;
const OUT = path.join(__dirname, '..', 'docs', 'qa', 'screens');
const VPS = [[390, 844], [360, 700], [412, 915]];
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { failN++; console.log('FAIL', m); } };

async function fresh(b, vp) {
  const p = await b.newPage({ viewport: { width: vp[0], height: vp[1] } });
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(BASE + '?autostart&nodaily');
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
  await p.evaluate(async () => {
    window.__qaTx = async (fn) => { const g = __asteria.game; for (let i = 0; i < 60; i++) { const r = await g.transact('qa', fn); if (r.ok) return r; await new Promise((r) => setTimeout(r, 50)); } return { ok: false }; };
  });
  return p;
}
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.modal, .panel')].some((e) => e.scrollWidth > e.clientWidth + 1));
const shot = (p, name, vp) => p.screenshot({ path: path.join(OUT, `v8_${name}_${vp[0]}x${vp[1]}.png`) });

(async () => {
  const b = await chromium.launch();
  for (const vp of VPS) {
    const p = await fresh(b, vp);
    // locked card
    await p.evaluate(() => __asteria.app.setTab('dungeon'));
    await p.waitForTimeout(300);
    ok(await p.locator('[data-screen="mplus"].locked-card').count() === 1, `${vp[0]} mplus locked before B03`);
    // open
    await p.evaluate(() => __qaTx((s) => { s.player.level = 45; s.progression.bossCleared.B03 = true; s.player.statsUpgrades.atk = 900; s.player.statsUpgrades.hp = 900; s.player.statsUpgrades.def = 300; return { ok: true }; }));
    await p.evaluate(() => { __asteria.app.panelDirty = true; __asteria.app.renderPanel(); });
    await p.waitForTimeout(300);
    ok(await p.locator('[data-screen="mplus"]:not(.locked-card)').count() === 1, `${vp[0]} mplus card open`);
    await shot(p, 'mplus_card', vp);
    await p.click('[data-screen="mplus"] .btn-primary');
    await p.waitForTimeout(400);
    ok(await p.locator('[data-screen="mplusPick"]').isVisible(), `${vp[0]} pick modal`);
    ok(!(await overflowX(p)), `${vp[0]} pick modal no horizontal overflow`);
    await shot(p, 'mplus_pick', vp);
    await p.click('[data-screen="mplusPick"] .mp-row .btn-primary');
    await p.waitForFunction(() => __asteria.game.session && __asteria.game.session.kind === 'mplus', null, { timeout: 5000 });
    await p.waitForTimeout(2500);
    const hud = await p.evaluate(() => ({ imm: document.getElementById('app').classList.contains('immersive'), title: __asteria.app.el.hudTitle.textContent, info: __asteria.app.el.hudInfo.textContent, chips: document.querySelectorAll('.rchip').length }));
    ok(hud.imm && /쐐기 \+2/.test(hud.title) && /처치 \d+\/21/.test(hud.info) && hud.chips === 3, `${vp[0]} immersive HUD ${JSON.stringify(hud)}`);
    await shot(p, 'mplus_battle', vp);
    // let it run to the end (fast forward)
    await p.evaluate(() => { __asteria.game.speedQa = true; });
    for (let i = 0; i < 120 && (await p.evaluate(() => __asteria.game.mode)) !== 'RESULT'; i++) await p.evaluate(() => { const g = __asteria.game; for (let k = 0; k < 40 && g.active && !g.active.over; k++) { g.active.step(); g.process(g.active.drainEvents()); } });
    await p.waitForSelector('[data-screen="mplusResult"]', { timeout: 10000 });
    const res = await p.evaluate(() => ({ key: __asteria.game.state.mplus.key, txt: document.querySelector('[data-screen="mplusResult"]').textContent }));
    ok(res.key >= 3 && /시간 내 완료/.test(res.txt), `${vp[0]} result timed, key up ${JSON.stringify(res).slice(0, 120)}`);
    ok(!(await overflowX(p)), `${vp[0]} result no horizontal overflow`);
    await p.waitForTimeout(900);
    await shot(p, 'mplus_result', vp);
    await p.click('.modal .btn:not(.btn-primary)');
    await p.waitForTimeout(600);
    ok(await p.evaluate(() => __asteria.game.mode === 'FARM' && !document.getElementById('app').classList.contains('immersive')), `${vp[0]} back to farm`);
    ok(p.errs.length === 0, `${vp[0]} no page errors ${p.errs.join(' | ')}`);
    await p.close();
  }
  await b.close();
  console.log(`qa_v8: ${pass}/${pass + failN} PASS`);
  process.exit(failN ? 1 : 0);
})();
