// Browser check for 특성 / 환생 / 균열 screens: node tools/qa_v5.cjs <port>
const { chromium } = require('playwright');
const port = process.argv[2] || '8140';
const out = 'docs/qa/screens/';
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
(async () => {
  const b = await chromium.launch();
  for (const vp of [[390, 844], [360, 700]]) {
    const tag = `${vp[0]}x${vp[1]}`;
    const c = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/?autostart&nodaily`);
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    // set up: tier-1 mage at Lv 100 with rift open
    await p.evaluate(async () => {
      const g = __asteria.game;
      for (let i = 0; i < 40 && g.busy; i++) await new Promise((r) => setTimeout(r, 25));
      await g.transact('qa', (s) => { s.player.cls = 'mage'; s.player.level = 100; s.player.peakLevel = 100; s.player.tier = 1; s.player.branch = 'wizard'; s.skills.equipped = ['m_fireball', 'm_frost', 'm_shield', null, null]; s.progression.bossCleared.B03 = true; s.classChosen = true; s.wallet.gold = 1e7; return { ok: true }; });
      __asteria.app.buildSkills();
    });
    const overflow = () => p.evaluate(() => { const m = document.querySelector('.modal'); return document.documentElement.scrollWidth > innerWidth || (m && m.scrollWidth > m.clientWidth + 1); });
    // talents
    await p.evaluate(() => __asteria.app.setTab('menu'));
    await p.waitForTimeout(300);
    await p.click('[data-key="tile-talents"]');
    await p.waitForSelector('[data-screen="talents"]');
    await p.waitForTimeout(300);
    for (let i = 0; i < 5; i++) await p.click('[data-key="tal-wz_atk"]');
    await p.waitForTimeout(300);
    const r1 = await p.evaluate(() => __asteria.game.state.talents.presets[0].wz_atk);
    ok(`${tag} talent rank via tap`, r1 === 5, { r1 });
    await p.screenshot({ path: `${out}talents_${tag}.png` });
    ok(`${tag} talents no overflow`, !(await overflow()));
    await p.click('.modal-overlay[data-screen="talents"] .modal-actions .btn >> text=닫기');
    await p.waitForTimeout(200);
    // rebirth
    await p.click('[data-key="tile-rebirth"]');
    await p.waitForSelector('[data-screen="rebirth"]');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}rebirth_${tag}.png` });
    ok(`${tag} rebirth no overflow`, !(await overflow()));
    await p.click('text=환생하기 · 정수');
    await p.waitForSelector('[data-screen="rebirthConfirm"], .modal-overlay[data-screen="rebirthConfirm"]');
    await p.click('.modal-overlay[data-screen="rebirthConfirm"] .btn-danger');
    await p.waitForTimeout(700);
    const rb = await p.evaluate(() => ({ lv: __asteria.game.state.player.level, n: __asteria.game.state.rebirth.count, tier: __asteria.game.state.player.tier }));
    ok(`${tag} rebirth applied after confirm`, rb.lv === 1 && rb.n === 1 && rb.tier === 1, rb);
    // rift
    await p.evaluate(async () => { await __asteria.game.transact('qa', (s) => { s.player.level = 60; s.player.statsUpgrades.atk = 260; s.player.statsUpgrades.hp = 260; s.player.statsUpgrades.def = 120; return { ok: true }; }); (__asteria.app.advTab = 'challenge', __asteria.app.setTab('dungeon')); });
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('[data-screen="rift"]').scrollIntoView());
    await p.screenshot({ path: `${out}rift_${tag}.png` });
    await p.click('[data-screen="rift"] .btn-primary');
    await p.waitForFunction(() => __asteria.game.mode === 'DUNGEON', null, { timeout: 5000 });
    // fast-forward until the floor ends
    await p.evaluate(async () => { const g = __asteria.game; for (let i = 0; i < 3000 && g.mode === 'DUNGEON'; i++) { g.advance(250); if (g.busy || i % 10 === 0) await new Promise((r) => setTimeout(r, 5)); } });
    await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ mode: __asteria.game.mode, run: __asteria.game.state.rift.run, modals: [...document.querySelectorAll('.modal-overlay')].map((m) => m.dataset.screen) }));
    if (st.run && st.run.choices) {
      await p.waitForSelector('[data-screen="riftBless"]');
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${out}riftBless_${tag}.png` });
      ok(`${tag} blessing modal after floor`, true, { choices: st.run.choices });
      await p.click('.bless');
      await p.waitForSelector('.modal-overlay[data-screen="riftNext"]');
      await p.click('text=보상 받고 마치기');
      await p.waitForSelector('.modal-overlay[data-screen="riftEnd"]');
      await p.click('text=보상 받고 마치기 >> nth=-1');
      await p.waitForSelector('[data-screen="riftResult"]', { timeout: 5000 });
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${out}riftResult_${tag}.png` });
    } else {
      ok(`${tag} rift floor ended`, !st.run, st);
    }
    const end = await p.evaluate(() => ({ run: __asteria.game.state.rift.run, best: __asteria.game.state.rift.best }));
    ok(`${tag} rift run closed with record`, end.run === null, end);
    ok(`${tag} no page errors`, errs.length === 0, { errs });
    await c.close();
  }
  await b.close();
  require('fs').writeFileSync('docs/qa/v5_results.json', JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})();
