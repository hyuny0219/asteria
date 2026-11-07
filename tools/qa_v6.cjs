// Browser checks for v5 part 2: 도감, 업적·칭호, 시즌 패스, 동료, 신화 제작.
// node tools/qa_v6.cjs <port> [outDir]
const { chromium } = require('playwright');
const port = process.argv[2] || '8140';
const out = process.argv[3] || 'docs/qa/screens/';
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };

async function setup(p) {
  await p.goto(`http://127.0.0.1:${port}/?autostart&nodaily`);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(async () => {
    const g = __asteria.game;
    const tryTx = async (fn) => { for (let i = 0; i < 20; i++) { const r = await g.transact('qa', fn); if (r.ok) return r; await new Promise((res) => setTimeout(res, 150)); } };
    await tryTx((s) => {
      s.player.level = 90; s.player.peakLevel = 90;
      s.progression.counters.kills = 12000; s.progression.counters.bossWins = 3; s.progression.bossCleared.B03 = true;
      for (const [k, v] of Object.entries({ M01: 1200, M02: 150, M03: 40, M04: 12, M05: 3, B01: 12, B02: 1 })) s.codex.kills[k] = v;
      s.codex.items['weapon:rare'] = true; s.codex.items['boots:epic'] = true; s.codex.items['ring:mythic'] = true;
      s.pets.eggs = 8; s.pets.food = 400;
      s.pass.xp = 0;
      s.wallet.starShard = 3; s.rebirth.essence = 25; s.wallet.ore = 3000; s.wallet.gold = 1e15;
      return { ok: true };
    });
    const M = await import('./src/core/meta.js');
    await tryTx((s) => { M.addPassXp(s, 120 * 7 + 40, Date.now()); return { ok: true }; });
  });
  await p.waitForTimeout(300);
}
const metrics = (p) => p.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.modal')].some((m) => m.scrollWidth > m.clientWidth + 1), broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.split('/').pop()) }));

(async () => {
  const b = await chromium.launch();
  for (const vp of [[390, 844], [360, 700]]) {
    const c = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await setup(p);
    const tag = `${vp[0]}x${vp[1]}`;
    const shot = async (name) => { await p.waitForTimeout(450); const m = await metrics(p); ok(`${name} ${tag}`, !m.over && !m.broken.length, m); await p.screenshot({ path: `${out}${name}_${tag}.png` }); };
    // pets: hatch all eggs, feed, set active
    await p.evaluate(() => __asteria.screens.menuPanel && __asteria.app.setTab('menu'));
    await p.waitForTimeout(200);
    await p.click('[data-key="tile-pets"]');
    await p.waitForSelector('[data-screen="pets"]');
    for (let i = 0; i < 8; i++) {
      await p.click('text=/정령 알 부화/');
      await p.waitForSelector('[data-screen="petHatch"]');
      await p.waitForTimeout(150);
      if (i === 0) await shot('petHatch');
      await p.click('[data-screen="petHatch"] >> xpath=../.. >> text=확인');
      await p.waitForTimeout(150);
    }
    await p.click('text=/먹이 .* 레벨업/');
    await p.waitForTimeout(300);
    await shot('pets');
    const pst = await p.evaluate(() => ({ owned: Object.keys(__asteria.game.state.pets.owned).length, active: __asteria.game.state.pets.active, eggs: __asteria.game.state.pets.eggs }));
    ok(`pets hatched & active ${tag}`, pst.owned >= 1 && pst.active && pst.eggs === 0, pst);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; });
    // codex
    await p.click('[data-key="tile-codex"]');
    await p.waitForSelector('[data-screen="codex"]');
    await shot('codex');
    await p.click('[data-screen="codex"] [role="tab"]:nth-child(2)');
    await p.waitForTimeout(200);
    await shot('codexItems');
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; });
    // achievements: claim all, then titles tab: equip one
    await p.click('[data-key="tile-achievements"]');
    await p.waitForSelector('[data-screen="achievements"]');
    await shot('achievements');
    await p.click('text=/모두 받기/');
    await p.waitForSelector('[data-screen="metaGrant"]');
    await p.click('[data-screen="metaGrant"] >> xpath=../.. >> text=확인');
    await p.click('[data-screen="achievements"] [role="tab"]:nth-child(2)');
    await p.waitForSelector('[data-screen="titles"]');
    await p.click('[data-screen="titles"] .btn-primary');
    await p.waitForTimeout(300);
    await shot('titles');
    const tt = await p.evaluate(() => ({ equipped: __asteria.game.state.titles.equipped, status: document.querySelector('.status .who b').textContent }));
    ok(`title equipped & shown ${tag}`, !!tt.equipped && /「/.test(tt.status), tt);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; });
    // pass
    await p.click('[data-key="tile-pass"]');
    await p.waitForSelector('[data-screen="pass"]');
    await shot('pass');
    const gem0 = await p.evaluate(() => __asteria.game.state.wallet.gem);
    await p.click('[data-key="pass-1"]');
    await p.waitForSelector('[data-screen="metaGrant"]');
    const gem1 = await p.evaluate(() => __asteria.game.state.wallet.gem);
    ok(`pass level 1 claimed once ${tag}`, gem1 > gem0, { gem0, gem1 });
    await p.click('[data-screen="metaGrant"] >> xpath=../.. >> text=확인');
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; });
    // craft
    await p.click('[data-key="tile-craft"]');
    await p.waitForSelector('[data-screen="craft"]');
    await shot('craft');
    await p.click('.modal-overlay[data-screen="craft"] .modal-actions .btn-primary');
    await p.waitForSelector('[data-screen="craftResult"]');
    await shot('craftResult');
    const cr = await p.evaluate(() => __asteria.game.state.inventory.some((i) => i.rarity === 'mythic' && i.source === 'craft'));
    ok(`mythic crafted ${tag}`, cr);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; __asteria.app.setTab('battle'); });
    // battle with the companion
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${out}battle_pet_${tag}.png` });
    const hits = await p.evaluate(() => new Promise((res) => { let n = 0; const off = __asteria.game.on('combat', (e) => { if (e.type === 'hit' && e.action === 'pet') n++; }); setTimeout(() => { off(); res(n); }, 7000); }));
    ok(`pet attacks in battle ${tag}`, hits > 0, { hits });
    await shot('menu_v6');
    ok(`no page errors ${tag}`, errs.length === 0, { errs });
    await c.close();
  }
  await b.close();
  require('fs').writeFileSync(out + '../qa_v6_results.json', JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})();
