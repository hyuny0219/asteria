// v15 4차 전직(초월) 브라우저 QA: 준비 화면 → 초월 시련(자동) → 서약 고르기 → 6칸 스킬바 · 오라 → 서약 바꾸기.
// usage: node tools/qa_v15_tier4.cjs [port] (QA_URL 우선) — 캡처는 docs/qa/screens/v15_tier4_*.png
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs', 'qa', 'screens');
(async () => {
  const base = (process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8434) + '/') + '?autostart&nodaily';
  const b = await chromium.launch();
  const res = []; const ok = (n, c, d) => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' ' + JSON.stringify(d) : '')); };
  for (const [w, hgt] of [[390, 844], [360, 700]]) {
    const p = await b.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: w === 390 ? 2 : 1 });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base);
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    const clean = () => p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    await clean();
    const tx = (src) => p.evaluate(async (src) => { const g = __asteria.game; const fn = new Function('s', 'DF', 'REGIONS', src); const DF = await import('/src/core/difficulty.js'); const { REGIONS } = await import('/src/data/content.js'); for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { fn(s, DF, REGIONS); return { ok: true }; }); if (r.ok) return; await new Promise((r) => setTimeout(r, 50)); } }, src);
    await tx(`s.player.level = 100; s.player.peakLevel = 100; s.player.tier = 3; s.player.branch = 'knight'; s.skills.equipped = ['strike','shieldCharge','warCry','guardCounter','w_judgement',null];
      s.player.statsUpgrades.atk = 30000; s.player.statsUpgrades.hp = 20000; s.player.statsUpgrades.def = 3000;
      s.wallet.starShard = 40; s.wallet.awakenStone = 300; s.wallet.gold = 1e13;
      for (const r of REGIONS) { s.progression.bossCleared[r.boss] = true; s.progression.maxWave[r.id] = 10; if (!s.progression.unlockedRegions.includes(r.id)) s.progression.unlockedRegions.push(r.id); }
      DF.track(s, 'normal').bossCleared.B05 = true;
      if (s.story) { s.story.seen = s.story.seen || {}; }`);
    await p.evaluate(() => { __asteria.app.buildSkills(); __asteria.app.updateHud(true); });
    // quest (tier 4 checklist)
    await p.evaluate(async () => { const m = await import('/src/ui/screens.js'); m.openQuest(__asteria.app); });
    await p.waitForTimeout(400);
    const q = await p.evaluate(() => document.querySelector('[data-screen="quest"]').innerText);
    ok(`${w} quest shows 초월 step`, /4차 전직 · 초월/.test(q) && /노말 프로스트 웜/.test(q), q.slice(0, 160));
    if (w === 390) await p.screenshot({ path: path.join(OUT, 'v15_tier4_quest_390x844.png') });
    // trial
    const tb = await p.$('.modal-actions .btn-primary');
    await tb.click();
    await p.waitForTimeout(800);
    // 시련을 빨리 감기 (게임 시간 50ms씩, 최대 130초)
    await p.evaluate(async () => { const g = __asteria.game; for (let i = 0; i < 2600 && g.mode === 'PROMOTION_TRIAL'; i++) { g.advance(50); if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0)); } });
    await p.waitForFunction(() => /초월 시련 (통과|실패)/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    const tr = await p.evaluate(() => document.body.innerText.match(/초월 시련 (통과|실패)/)?.[0] || null);
    ok(`${w} trial result`, tr === '초월 시련 통과', { tr });
    await p.click('.modal-actions .btn-primary');   // 초월하기 → ascend modal
    await p.waitForTimeout(500);
    const asc = await p.evaluate(() => { const el = document.querySelector('[data-screen="promotion"][data-tier="4"]'); return el ? el.innerText : null; });
    ok(`${w} ascend modal`, asc && /서약/.test(asc) && /6번 슬롯/.test(asc), asc && asc.slice(0, 200));
    const disabled0 = await p.evaluate(() => document.querySelector('.modal-actions .btn-primary').disabled);
    ok(`${w} needs an oath pick`, disabled0);
    await p.click('[data-oath="w_ruin"]'); await p.waitForTimeout(200);
    const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok(`${w} no horizontal overflow`, noOverflow);
    if (w === 390) await p.screenshot({ path: path.join(OUT, 'v15_tier4_oath_390x844.png') });
    await p.click('.modal-actions .btn-primary');
    await p.waitForSelector('[data-screen="promoPlay"]', { timeout: 8000 });
    await p.waitForTimeout(1600);
    const st = await p.evaluate(() => ({ tier: __asteria.game.state.player.tier, oath: __asteria.game.state.promotion.oath, eq: __asteria.game.state.skills.equipped, name: document.querySelector('[data-screen="promoPlay"]').innerText }));
    ok(`${w} promoted to tier 4`, st.tier === 4 && st.oath === 'w_ruin' && st.eq[5] === 'berserkStrike' && /여명의 성벽/.test(st.name), st);
    if (w === 390) await p.screenshot({ path: path.join(OUT, 'v15_tier4_ascend_390x844.png') });
    await clean();
    await p.waitForTimeout(1500);
    const bar = await p.evaluate(() => { const bar = document.querySelector('.skills'); const r = bar.getBoundingClientRect(); const btns = [...bar.querySelectorAll('.skill')]; return { six: bar.classList.contains('six'), n: btns.length, right: Math.max(...btns.map((x) => x.getBoundingClientRect().right)), w: innerWidth, aura: !!__asteria.app.renderer?.auraOn, rt: __asteria.app.renderer?.heroTier, mode: __asteria.game.mode, dead: __asteria.game.active?.hero?.dead }; });
    ok(`${w} 6 skills + ult fit`, bar.six && bar.n === 7 && bar.right <= bar.w, bar);
    ok(`${w} aura drawn`, bar.aura, bar);
    if (w === 390) await p.screenshot({ path: path.join(OUT, 'v15_tier4_battle_390x844.png') });
    // oath switch from the menu tile
    await p.evaluate(async () => { const m = await import('/src/ui/v4.js'); m.openOath(__asteria.app); });
    await p.waitForTimeout(300);
    await p.click('[data-oath="w_unyield"]'); await p.waitForTimeout(150);
    await p.click('.modal-actions .btn-primary'); await p.waitForTimeout(600);
    const eng2 = await p.evaluate(() => __asteria.game.state.promotion.oath);
    ok(`${w} oath switched`, eng2 === 'w_unyield', { eng2 });
    ok(`${w} no page errors`, errs.length === 0, errs);
    await p.close();
  }
  await b.close();
  const pass = res.filter((r) => r[1]).length;
  console.log(`SUMMARY ${pass} / ${res.length}`);
  process.exit(pass === res.length ? 0 : 1);
})();
