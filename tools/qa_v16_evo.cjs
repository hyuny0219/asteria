// v16 전직별 스킬 진화 브라우저 QA: 스킬 화면(진화 이름·테두리·진화 카드) → 상세(5단계 줄) →
// 초월(4차) 결과의 진화 카드 → 전투 바 · 1차 승급 결과의 진화 카드(360px).
// usage: node tools/qa_v16_evo.cjs [port] (QA_URL 우선) — 캡처는 docs/qa/screens/v16_evo_*.png
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs', 'qa', 'screens');
(async () => {
  const base = (process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8435) + '/') + '?autostart&nodaily';
  const b = await chromium.launch();
  const res = []; const ok = (n, c, d) => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' ' + JSON.stringify(d) : '')); };
  const boot = async (w, hgt) => {
    const p = await b.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: w === 390 ? 2 : 1 });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base);
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    const clean = () => p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    await clean();
    const tx = (src) => p.evaluate(async (src) => { const g = __asteria.game; const fn = new Function('s', 'DF', 'REGIONS', src); const DF = await import('/src/core/difficulty.js'); const { REGIONS } = await import('/src/data/content.js');
      for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { fn(s, DF, REGIONS); return { ok: true }; }); if (r.ok) return; await new Promise((r) => setTimeout(r, 50)); } }, src);
    return { p, errs, clean, tx };
  };

  // ---------- 390: tier 3 knight → skills screen, detail, 초월 → cards, battle bar ----------
  {
    const { p, errs, clean, tx } = await boot(390, 844);
    await tx(`s.player.level = 100; s.player.peakLevel = 100; s.player.tier = 3; s.player.branch = 'knight'; s.skills.equipped = ['strike','shieldCharge','warCry','guardCounter','w_judgement',null];
      s.player.statsUpgrades.atk = 30000; s.player.statsUpgrades.hp = 20000; s.player.statsUpgrades.def = 3000;
      s.wallet.starShard = 40; s.wallet.awakenStone = 300; s.wallet.gold = 1e13;
      for (const r of REGIONS) { s.progression.bossCleared[r.boss] = true; s.progression.maxWave[r.id] = 10; if (!s.progression.unlockedRegions.includes(r.id)) s.progression.unlockedRegions.push(r.id); }
      DF.track(s, 'normal').bossCleared.B05 = true;`);
    await p.evaluate(() => { __asteria.app.buildSkills(); __asteria.app.updateHud(true); __asteria.app.setTab('skills'); });
    await p.waitForTimeout(600);
    const sk = await p.evaluate(() => { const el = document.querySelector('[data-screen="skills"]'); return { txt: el.innerText, evoIcons: el.querySelectorAll('.evo-ic.evo-t3').length, card: !!el.querySelector('[data-screen="evolution"]') }; });
    ok('skills screen shows tier-3 names', /심판의 일격/.test(sk.txt) && /맹세의 돌진/.test(sk.txt) && /성전의 외침/.test(sk.txt) && /대심판/.test(sk.txt), sk.txt.slice(0, 200));
    ok('tinted evo icons with Ⅲ badge', sk.evoIcons >= 4, sk);
    ok('evolution card with next stage', sk.card && /다음 4차: 여명 붕괴/.test(sk.txt), null);
    await p.evaluate(() => { const c = document.querySelector('[data-screen="evolution"]'); c.scrollIntoView({ block: 'start' }); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, 'v16_evo_skills_390x844.png') });
    // detail
    await p.evaluate(async () => { const m = await import('/src/ui/screens.js'); m.openSkillDetail(__asteria.app, 'strike'); });
    await p.waitForTimeout(400);
    const det = await p.evaluate(() => { const el = document.querySelector('[data-screen="skilldetail"]'); const rows = [...el.querySelectorAll('.evo-stage')]; return { n: rows.length, cur: rows.findIndex((r) => r.classList.contains('cur')), txt: el.innerText, title: document.querySelector('.modal h2, .modal-title, [role=dialog] h2')?.innerText }; });
    ok('detail: 5 stages, current = 3차', det.n === 5 && det.cur === 3, det);
    ok('detail: evolved title and base note', /강타의 3차 진화/.test(det.txt), det.title);
    await p.evaluate(() => { const el = document.querySelector('.evo-stages'); el && el.scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, 'v16_evo_detail_390x844.png') });
    await clean();
    // 초월 (tier 4): trial → ascend → promoPlay with evolution cards
    await p.evaluate(async () => { const m = await import('/src/ui/screens.js'); m.openQuest(__asteria.app); });
    await p.waitForTimeout(400);
    await p.click('.modal-actions .btn-primary');
    await p.waitForTimeout(800);
    await p.evaluate(async () => { const g = __asteria.game; for (let i = 0; i < 2600 && g.mode === 'PROMOTION_TRIAL'; i++) { g.advance(50); if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0)); } });
    await p.waitForFunction(() => /초월 시련 (통과|실패)/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    await p.click('.modal-actions .btn-primary');
    await p.waitForTimeout(500);
    await p.click('[data-oath="w_ruin"]'); await p.waitForTimeout(200);
    const before = await p.evaluate(() => __asteria.game.state.player.tier);
    await p.click('.modal-actions .btn-primary');
    await p.waitForSelector('[data-screen="promoPlay"]', { timeout: 8000 });
    // cards appear only inside the result modal, i.e. after the promote transaction returned ok
    const savedAtOpen = await p.evaluate(() => __asteria.game.state.player.tier);
    await p.waitForTimeout(2200);
    const cards = await p.evaluate(() => [...document.querySelectorAll('[data-screen="promoPlay"] .evo-card')].map((c) => c.innerText.replace(/\s+/g, ' ')));
    ok('초월 result lists 4 evolutions', cards.length === 4 && /심판의 일격 → 여명 붕괴/.test(cards[0]) && /대심판 → 여명 강림/.test(cards[3]), cards);
    ok('cards shown after save (tier already 4 when modal opened)', before === 3 && savedAtOpen === 4, { before, savedAtOpen });
    await p.screenshot({ path: path.join(OUT, 'v16_evo_promo_390x844.png') });
    await clean();
    await p.evaluate(() => { __asteria.app.setTab('battle'); });
    await p.waitForTimeout(1200);
    const bar = await p.evaluate(() => { const bar = document.querySelector('.skills'); const btns = [...bar.querySelectorAll('.skill.evo')]; return { n: btns.length, labels: btns.map((x) => x.getAttribute('aria-label')) }; });
    ok('battle bar uses evolved names', bar.n >= 4 && bar.labels.some((l) => /여명 붕괴/.test(l)) && bar.labels.some((l) => /여명 강림/.test(l)), bar);
    // cast an evolved skill so its tinted name floats
    await p.evaluate(() => __asteria.app.castSkill('strike'));
    await p.waitForTimeout(450);
    await p.screenshot({ path: path.join(OUT, 'v16_evo_battle_390x844.png') });
    ok('390 no page errors', errs.length === 0, errs);
    await p.close();
  }

  // ---------- 360: tier-1 promotion result (berserker) ----------
  {
    const { p, errs, clean, tx } = await boot(360, 700);
    await tx(`s.player.level = 30; s.wallet.token = 99; s.progression.bossCleared.B03 = true; s.promotion.trials[1] = true;`);
    const r = await p.evaluate(async () => { const r = await __asteria.game.promote(1, 'berserker'); const V4 = await import('/src/ui/v4.js'); if (r.ok) V4.celebratePromotion(__asteria.app, r); return r; });
    ok('tier-1 promote ok with evolutions', r.ok && r.evolutions.length === 4, r.evolutions);
    await p.waitForTimeout(2200);
    const c1 = await p.evaluate(() => [...document.querySelectorAll('[data-screen="promoPlay"] .evo-card')].map((c) => c.innerText.replace(/\s+/g, ' ')));
    ok('tier-1 cards (강타 → 처형 일격)', c1.length === 4 && /강타 → 처형 일격/.test(c1[0]), c1);
    const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok('360 no horizontal overflow', noOverflow);
    ok('360 no page errors', errs.length === 0, errs);
    await clean();
    await p.close();
  }
  await b.close();
  const pass = res.filter((r) => r[1]).length;
  console.log(`SUMMARY ${pass} / ${res.length}`);
  process.exit(pass === res.length ? 0 : 1);
})();
