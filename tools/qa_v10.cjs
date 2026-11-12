// v10 장비·스킬 QA: 전설 고유 효과(비교창 표시·추출·보관함·이식), 재련, 등급 올리기,
// 스킬 각성(Lv10, A/B, 아이콘 테두리), 프리셋(저장·불러오기·없는 장비 빈칸·자동 교체 매핑).
// 3 viewports, no horizontal overflow, no page errors. usage: node tools/qa_v10.cjs [port]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const port = process.argv[2] || 8123;
const base = process.env.QA_URL || `http://localhost:${port}/`;
const out = path.join(__dirname, '..', 'docs', 'qa', 'screens') + '/';
const VPS = [[390, 844], [360, 700], [412, 915]];
const results = [];
const ok = (cond, name, extra) => { results.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra ? JSON.stringify(extra) : ''); };
// horizontal scrollers (.tabs/.seg strips) may hold off-screen children by design; their own box must fit
const overflow = (p) => p.evaluate(() => {
  if (document.documentElement.scrollWidth > innerWidth) return 'doc';
  const scroller = (e) => { for (let x = e.parentElement; x; x = x.parentElement) { const cs = getComputedStyle(x); if (/auto|scroll|hidden/.test(cs.overflowX) && x.scrollWidth > x.clientWidth + 1) return true; } return false; };
  const bad = [...document.querySelectorAll('.modal-overlay:last-of-type .modal *, .panel *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > innerWidth + 1 && !scroller(e); });
  return bad.length ? bad.slice(0, 3).map((e) => e.tagName + '.' + [...e.classList].join('.') + ' ' + Math.round(e.getBoundingClientRect().right)).join(', ') : false;
});
const clearModals = (p) => p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
const BAD = /(^|[-_ ])(adv?|ads|banner|sponsor|promo-banner)([-_ ]|$)/;

(async () => {
  const b = await chromium.launch();
  for (const vp of VPS) {
    const tag = `${vp[0]}x${vp[1]}`;
    const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base + '?autostart&nodaily');
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    await clearModals(p);
    // seed: 2 legendary weapons + 3 rare helmets, currencies, a Lv10 skill
    const seeded = await p.evaluate(async () => {
      const items = await import('/src/core/items.js');
      const prog = await import('/src/core/progression.js');
      const g = __asteria.game;
      let x = 1;
      const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
      const r = await g.transact('qaSeed', (s) => {
        for (let i = 0; i < 2; i++) s.inventory.push(items.makeItem(s, { slot: 'weapon', rarity: 'legendary', level: 20, rng }));
        for (let i = 0; i < 3; i++) s.inventory.push(items.makeItem(s, { slot: 'helmet', rarity: 'rare', level: 10 + i, rng }));
        Object.assign(s.wallet, { ore: 50000, gold: 5e6, gem: 500, awakenStone: 5 });
        const sk = prog.unlockedSkills(s)[0];
        s.skills.levels[sk] = 10;
        return { ok: true, sk };
      });
      const s = g.state;
      return { sk: r.sk, legends: s.inventory.filter((i) => i.legend).map((i) => i.id), helmets: s.inventory.filter((i) => i.slot === 'helmet' && i.rarity === 'rare').map((i) => i.id) };
    });
    ok(seeded.legends.length >= 2, `${tag} legendary items carry 고유 효과`, seeded);
    // compare modal shows legend line + v10 buttons
    await p.evaluate((id) => __asteria.app.setTab('equipment'), null);
    await p.waitForTimeout(300);
    await p.evaluate(async (id) => { const S = await import('/src/ui/screens.js'); S.openCompare(__asteria.app, id); }, seeded.legends[0]);
    await p.waitForSelector('[data-screen="compare"] .legend-line');
    ok(await p.locator('[data-act="reforge"]').count() === 1 && await p.locator('[data-act="extract"]').count() === 1 && await p.locator('[data-act="imprint"]').count() === 1, `${tag} compare: 재련·등급·추출·이식 buttons`);
    { const o = await overflow(p); ok(!o, `${tag} compare no overflow`, o ? { o } : undefined); }
    await p.waitForTimeout(450);
    await p.screenshot({ path: `${out}v10_compare_${tag}.png` });
    // extract
    await p.click('[data-act="extract"]');
    await p.waitForSelector('[data-screen="extract"]');
    await p.screenshot({ path: `${out}v10_extract_${tag}.png` });
    await p.click('.modal-overlay:last-child .btn-primary');
    await p.waitForTimeout(500);
    const ex = await p.evaluate((id) => ({ gone: !__asteria.game.state.inventory.find((i) => i.id === id), vault: Object.keys(__asteria.game.state.gearPlus.vault).length, stone: __asteria.game.state.wallet.awakenStone }), seeded.legends[0]);
    ok(ex.gone && ex.vault === 1 && ex.stone === 4, `${tag} extract → vault`, ex);
    await clearModals(p);
    // codex
    await p.evaluate(async () => { const V = await import('/src/ui/v10.js'); V.openLegendCodex(__asteria.app); });
    await p.waitForSelector('[data-screen="legendCodex"]');
    { const o = await overflow(p); const n = await p.locator('.vault-row:not(.unknown)').count(); ok(n === 1 && !o, `${tag} 고유 효과 보관함 1/36`, { n, o }); }
    await p.screenshot({ path: `${out}v10_codex_${tag}.png` });
    await clearModals(p);
    // imprint onto the other legendary
    await p.evaluate(async (id) => { const S = await import('/src/ui/screens.js'); S.openCompare(__asteria.app, id); }, seeded.legends[1]);
    await p.waitForSelector('[data-act="imprint"]');
    await p.click('[data-act="imprint"]');
    await p.waitForSelector('[data-screen="imprint"]');
    await p.screenshot({ path: `${out}v10_imprint_${tag}.png` });
    const want = await p.evaluate(() => Object.keys(__asteria.game.state.gearPlus.vault)[0]);
    await p.click(`[data-screen="imprint"] .vault-row[data-uid="${want}"] .btn-primary`);
    await p.waitForTimeout(500);
    ok(await p.evaluate(([id, uid]) => __asteria.game.state.inventory.find((i) => i.id === id).legend.id === uid, [seeded.legends[1], want]), `${tag} imprint applied`);
    await clearModals(p);
    // reforge
    await p.evaluate(async (id) => { const S = await import('/src/ui/screens.js'); S.openCompare(__asteria.app, id); }, seeded.legends[1]);
    await p.click('[data-act="reforge"]');
    await p.waitForSelector('[data-screen="reforge"]');
    const before = await p.evaluate((id) => JSON.stringify(__asteria.game.state.inventory.find((i) => i.id === id).options), seeded.legends[1]);
    await p.click('.modal-overlay:last-child .modal-actions .btn-primary, .modal-overlay:last-child .btn-primary');
    await p.waitForTimeout(500);
    const after = await p.evaluate((id) => { const it = __asteria.game.state.inventory.find((i) => i.id === id); return { o: JSON.stringify(it.options), n: it.reforges }; }, seeded.legends[1]);
    ok(after.n === 1 && after.o !== before, `${tag} reforge rerolls one line`, after);
    { const o = await overflow(p); ok(!o, `${tag} reforge no overflow`, o ? { o } : undefined); }
    await p.screenshot({ path: `${out}v10_reforge_${tag}.png` });
    await clearModals(p);
    // rarity up: rare helmet ×3 → epic
    await p.evaluate(async (id) => { const S = await import('/src/ui/screens.js'); S.openCompare(__asteria.app, id); }, seeded.helmets[0]);
    await p.click('[data-act="rarityup"]');
    await p.waitForSelector('[data-screen="rarityup"]');
    await p.click(`[data-mat="${seeded.helmets[1]}"]`);
    await p.click(`[data-mat="${seeded.helmets[2]}"]`);
    await p.screenshot({ path: `${out}v10_rarityup_${tag}.png` });
    { const o = await overflow(p); ok(!o, `${tag} rarity up no overflow`, o ? { o } : undefined); }
    await p.click('.modal-overlay:last-child .btn-primary:not([disabled])');
    await p.waitForTimeout(500);
    const ru = await p.evaluate((ids) => { const s = __asteria.game.state; const it = s.inventory.find((i) => i.id === ids[0]); return { r: it.rarity, lv: it.level, n: it.options.length, mats: ids.slice(1).filter((x) => s.inventory.find((i) => i.id === x)).length }; }, seeded.helmets);
    ok(ru.r === 'epic' && ru.lv === 12 && ru.mats === 0, `${tag} rarity up rare→epic`, ru);
    await clearModals(p);
    // skills: awakening
    await p.evaluate(() => __asteria.app.setTab('skills'));
    await p.waitForSelector('[data-screen="awaken"]');
    await p.click(`[data-awk="${seeded.sk}:1"]`);
    await p.waitForTimeout(500);
    ok(await p.evaluate((sk) => __asteria.game.state.skills.awaken[sk] === 1, seeded.sk), `${tag} awakening B chosen (free)`);
    await p.click(`[data-awk="${seeded.sk}:0"]`);
    await p.waitForTimeout(500);
    const aw = await p.evaluate((sk) => ({ a: __asteria.game.state.skills.awaken[sk], gem: __asteria.game.state.wallet.gem }), seeded.sk);
    ok(aw.a === 0 && aw.gem === 500, `${tag} first change free today`, aw);
    await p.click(`[data-awk="${seeded.sk}:1"]`);
    await p.waitForTimeout(500);
    const aw2 = await p.evaluate((sk) => ({ a: __asteria.game.state.skills.awaken[sk], gem: __asteria.game.state.wallet.gem }), seeded.sk);
    ok(aw2.a === 1 && aw2.gem === 450, `${tag} second change costs 50 gems`, aw2);
    ok(await p.locator('img.awk-a, img.awk-b, .awk-ic.awk-a, .awk-ic.awk-b').count() >= 1, `${tag} awakened icon border`);
    await p.locator('[data-screen="awaken"]').scrollIntoViewIfNeeded();
    { const o = await overflow(p); ok(!o, `${tag} skills no overflow`, o ? { o } : undefined); }
    await p.screenshot({ path: `${out}v10_awaken_${tag}.png` });
    // v18.3: 장비 프리셋 제거 — 장비 화면에 프리셋 카드가 없어야 함
    await p.evaluate(() => __asteria.app.setTab('equipment'));
    await p.waitForTimeout(400);
    ok(await p.locator('[data-screen="loadouts"]').count() === 0 && (await p.evaluate(() => __asteria.game.state.loadouts)) === undefined, `${tag} presets removed`);
    // menu tile + class names
    await p.evaluate(() => __asteria.app.setTab('menu'));
    await p.waitForTimeout(300);
    ok(await p.locator('[data-key="tile-legendCodex"]').count() === 1, `${tag} menu tile 고유 효과`);
    const bad = await p.evaluate((src) => { const re = new RegExp(src); return [...document.querySelectorAll('[class]')].flatMap((e) => [...e.classList]).filter((c) => re.test(c)); }, BAD.source);
    ok(bad.length === 0, `${tag} no ad-blocker class names`, { bad: [...new Set(bad)] });
    ok(errs.length === 0, `${tag} no page errors`, { errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'qa_v10_results.json'), JSON.stringify(results, null, 1));
  const pass = results.filter((r) => r.pass).length;
  console.log(`qa_v10: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})();
