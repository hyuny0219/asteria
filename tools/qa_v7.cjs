// Browser checks for v7: 슬롯 강화 (schema 6 migration notice) and 스테이지 지도.
// node tools/qa_v7.cjs <port> [outDir]
const { chromium } = require('playwright');
const port = process.argv[2] || '8140';
const out = process.argv[3] || 'docs/qa/screens/';
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
const metrics = (p) => p.evaluate(() => {
  const small = [...document.querySelectorAll('.modal button, .modal [role=button], .stage-map button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32); }).map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 20));
  return { over: document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.modal, .stage-map')].some((m) => m.scrollWidth > m.clientWidth + 1), small, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.split('/').pop()) };
});
async function boot(p, q = '?autostart&nodaily') {
  await p.goto(`http://127.0.0.1:${port}/${q}`);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(async () => { const d = await import('./src/ui/dom.js'); window.__qaClose = () => d.closeAllModals(); });
}
const tx = (p, src) => p.evaluate(async (src) => {
  const g = __asteria.game; const fn = eval(src);
  for (let i = 0; i < 20; i++) { const r = await g.transact('qa', fn); if (r.ok) return r; await new Promise((res) => setTimeout(res, 150)); }
}, src);
const VPS = [[390, 844], [360, 700], [412, 915]];
async function stageChecks(p, tag) {
  // progress: meadow cleared (boss), desert at stage 6 with some stars
  await tx(p, `(s) => { const P = s.progression; P.maxWave = { meadow: 10, desert: 6 }; P.bossCleared = { B01: true }; P.unlockedRegions = ['meadow', 'desert'];
    P.region = 'desert'; P.wave = 5; s.player.level = 16;
    for (let n = 1; n <= 10; n++) { s.stages.stars['meadow-' + n] = 1 + (n % 3); s.stages.claimed['meadow-' + n] = true; }
    s.stages.stars['meadow-boss'] = 2; s.stages.claimed['meadow-boss'] = true;
    for (let n = 1; n <= 5; n++) { s.stages.stars['desert-' + n] = n % 2 ? 3 : 2; s.stages.claimed['desert-' + n] = true; }
    return { ok: true }; }`);
  await p.evaluate(() => { __qaClose(); __asteria.app.setTab('battle'); });   // region chip lives on the battle tab
  await p.waitForTimeout(300);
  // open from the region chip on the battle strip
  await p.click('.where-btn');
  await p.waitForSelector('[data-screen="stagemap"]');
  await p.waitForTimeout(500);
  const info = await p.evaluate(() => {
    const nodes = [...document.querySelectorAll('.stage-map .stage-node')];
    const box = document.querySelector('.stage-map').getBoundingClientRect();
    const rects = nodes.map((n) => n.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlap++; }
    const inside = rects.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1);
    return { n: nodes.length, status: nodes.map((n) => n.dataset.status === 'current' ? 'u' : n.dataset.status[0]).join(''), overlap, inside, mapH: Math.round(box.height), tabs: document.querySelectorAll('.stage-tabs .tab').length, locked: document.querySelectorAll('.stage-tabs .tab.locked').length, detail: document.querySelector('.stage-detail b').textContent };
  });
  await p.screenshot({ path: `${out}v7_stagemap_${tag}.png` });
  const m1 = await metrics(p);
  ok(`stage map ${tag}`, info.n === 11 && info.status === 'ccccculllll' && info.overlap === 0 && info.inside && info.tabs === 10 && info.locked === 8 && !m1.over && m1.small.length === 0, { ...info, ...m1 });
  // current stage detail shows its first-clear reward
  await p.click('.stage-node[data-node="6"]');
  const d6 = await p.evaluate(() => ({ rw: document.querySelectorAll('.stage-detail .stage-rw .rw').length, btn: document.querySelector('.stage-detail [data-act="stage-go"]').textContent }));
  await p.screenshot({ path: `${out}v7_stagemap_current_${tag}.png` });
  ok(`current stage reward ${tag}`, d6.rw === 3 && /여기서 사냥/.test(d6.btn), d6);
  // tap a cleared stage → detail (reward received) → farm there
  await p.click('.stage-node[data-node="3"]');
  const d3 = await p.textContent('.stage-detail');
  await p.click('.stage-detail [data-act="stage-go"]');
  await p.waitForTimeout(500);
  const at = await p.evaluate(() => ({ r: __asteria.game.state.progression.region, w: __asteria.game.state.progression.wave, chip: document.querySelector('.where-btn').textContent, open: !!document.querySelector('[data-screen="stagemap"]') }));
  ok(`farm cleared stage ${tag}`, at.r === 'desert' && at.w === 3 && /2-3/.test(at.chip) && /받음/.test(d3), { ...at, d3: d3.slice(0, 60) });
  // map from the 모험 tab, meadow tab → boss node detail; locked region tab view
  await p.evaluate(() => __asteria.app.setTab('dungeon'));
  await p.waitForTimeout(300);
  await p.click('text=스테이지 지도');
  await p.waitForSelector('[data-screen="stagemap"]');
  await p.click('.stage-tabs [data-region="meadow"]');
  await p.click('.stage-node[data-node="boss"]');
  const boss = await p.evaluate(() => ({ status: document.querySelector('.stage-node[data-node="boss"]').dataset.status, btn: document.querySelector('.stage-detail [data-act="stage-go"]').textContent }));
  ok(`boss node ${tag}`, boss.status === 'cleared' && /재도전/.test(boss.btn), boss);
  await p.click('.stage-tabs [data-region="glacier"]');
  await p.waitForTimeout(200);
  const lk = await p.evaluate(() => ({ lock: !!document.querySelector('.stage-map.locked .stage-lock'), dis: document.querySelector('.stage-detail [data-act="stage-go"]').disabled }));
  await p.screenshot({ path: `${out}v7_stagemap_locked_${tag}.png` });
  ok(`locked region ${tag}`, lk.lock && lk.dis, lk);
  // auto-advance toggle
  await p.click('.stage-tabs [data-region="desert"]');
  await p.click('[data-act="stage-auto"]');
  await p.waitForTimeout(300);
  const a1 = await p.evaluate(() => ({ auto: __asteria.game.state.stages.auto, adv: __asteria.game.state.progression.autoAdvance, aria: document.querySelector('[data-act="stage-auto"]').getAttribute('aria-checked') }));
  await p.click('[data-act="stage-auto"]');
  await p.waitForTimeout(300);
  const a2 = await p.evaluate(() => __asteria.game.state.stages.auto);
  ok(`auto toggle ${tag}`, a1.auto === false && a1.adv === false && a1.aria === 'false' && a2 === true, { a1, a2 });
  await p.evaluate(() => __qaClose());
  // live clear: fast-forward the farm on the current stage → first-clear once (toast after commit)
  const live = await p.evaluate(async () => {
    const g = __asteria.game;
    await g.setFarm('desert', 6, true);
    const gem0 = g.state.wallet.gem;
    const seen = []; g.on('stageClear', (r) => seen.push(r));
    for (let i = 0; i < 400 && !g.state.stages.claimed['desert-6']; i++) { g.advance(500); await new Promise((r) => setTimeout(r, 0)); }
    for (let i = 0; i < 10; i++) { g.advance(0); await new Promise((r) => setTimeout(r, 10)); }
    return { claimed: !!g.state.stages.claimed['desert-6'], stars: g.state.stages.stars['desert-6'], gem: g.state.wallet.gem - gem0, seen: seen.map((r) => r.key + ':' + r.first), wave: g.state.progression.wave };
  });
  ok(`live first clear ${tag}`, live.claimed && live.stars >= 1 && live.gem >= 5 && live.seen.includes('desert-6:true') && live.wave === 7, live);
}
const only = process.env.QA_ONLY || '';

(async () => {
  const b = await chromium.launch();
  for (const vp of VPS) {
    const tag = `${vp[0]}x${vp[1]}`;
    const c = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await boot(p);
    if (!only || only === 'slot') {
      // ---- schema 5 save → migration → one-time notice
      const mig = await p.evaluate(async () => {
        const g = __asteria.game;
        const { migrate } = await import('./src/core/state.js');
        const { makeItem } = await import('./src/core/items.js'); const { makeRng } = await import('./src/core/util.js');
        const st = structuredClone(g.state); const rng = makeRng(11);
        st.inventory = []; for (const k in st.equipped) st.equipped[k] = null;
        const mk = (slot, rarity, en, ore) => { const it = makeItem(st, { slot, rarity, level: 30, rng }); it.enhance = en; it.oreInvested = ore; st.inventory.push(it); return it; };
        st.equipped.weapon = mk('weapon', 'epic', 9, 620).id;
        st.equipped.armor = mk('armor', 'rare', 5, 90).id;
        st.equipped.ring1 = mk('ring', 'rare', 3, 40).id;
        st.equipped.ring2 = mk('ring', 'epic', 11, 1500).id;
        mk('weapon', 'rare', 7, 300); mk('helmet', 'uncommon', 4, 60);
        st.schemaVersion = 5; delete st.slotEnhance; delete st.slotEnhanceOre; delete st.notices;
        const ore0 = st.wallet.ore;
        const m = migrate(st);
        await g.importState(m);
        __asteria.app.setTab('equipment');
        __asteria.app.showDailyPopups();
        return { ore0, ore: g.state.ore, gained: g.state.wallet.ore - ore0, slot: g.state.slotEnhance, notice: !!g.state.notices.slotEnhance };
      });
      await p.waitForSelector('[data-screen="slot-notice"]', { timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${out}v7_slot_notice_${tag}.png` });
      const m1 = await metrics(p);
      ok(`migration notice ${tag}`, mig.gained === 360 && mig.slot.weapon === 9 && mig.slot.ring2 === 11 && mig.notice && !m1.over && !!(await p.$('[data-screen="slot-notice"]')), { ...mig, ...m1 });
      await p.click('[data-screen="slot-notice"] ~ * .btn-primary, .modal-actions .btn-primary');
      await p.waitForTimeout(400);
      const gone = await p.evaluate(() => ({ notice: !!__asteria.game.state.notices.slotEnhance, open: !!document.querySelector('[data-screen="slot-notice"]') }));
      ok(`notice shown once ${tag}`, !gone.notice && !gone.open, gone);
      await p.evaluate(() => { __qaClose(); __asteria.app.setTab('equipment'); });
      await p.waitForTimeout(300);
      // equipment grid: equipped slots show +N, inventory tiles none
      const grid = await p.evaluate(() => ({ eq: [...document.querySelectorAll('[aria-label^="장착 장비"] .en')].map((e) => e.textContent), inv: document.querySelectorAll('.grid4.inv .en').length }));
      await p.screenshot({ path: `${out}v7_equipment_${tag}.png` });
      ok(`equipment tiles ${tag}`, grid.eq.includes('+9') && grid.eq.includes('+11') && grid.inv === 0, grid);
      // slot enhance modal: tap the armor slot → compare → 강화
      await p.evaluate(() => { const g = __asteria.game; return window.__qaTx ? null : null; });
      await tx(p, '(s) => { s.wallet.ore = 50000; return { ok: true }; }');
      await p.click('[aria-label^="장착 장비"] .item >> nth=2');
      await p.waitForSelector('[data-screen="compare"]');
      const note = await p.textContent('[data-note="slot-enhance"]');
      await p.screenshot({ path: `${out}v7_compare_${tag}.png` });
      ok(`compare slot note ${tag}`, /갑옷 슬롯 강화 \+5/.test(note), { note });
      await p.click('.modal-actions .btn-gold');
      await p.waitForSelector('[data-screen="enhance"] .slot-chips');
      const before = await p.evaluate(() => __asteria.game.state.slotEnhance.armor);
      await p.click('.modal-actions .btn-primary');
      await p.waitForTimeout(700);
      const after = await p.evaluate(() => __asteria.game.state.slotEnhance.armor);
      await p.screenshot({ path: `${out}v7_slot_enhance_${tag}.png` });
      const m2 = await metrics(p);
      ok(`slot enhance ${tag}`, after >= before && !m2.over && m2.small.length === 0, { before, after, ...m2 });
      // switch to ring2 chip
      await p.click('.slot-chips [data-slot="ring2"]');
      const r2 = await p.textContent('[data-screen="enhance"] h3');
      ok(`ring2 separate ${tag}`, /반지 2 슬롯 \+11/.test(r2), { r2 });
      await p.evaluate(() => __qaClose());
    }
    if (!only || only === 'stage') await stageChecks(p, tag, vp);
    ok(`no page errors ${tag}`, errs.length === 0, { errs: errs.slice(0, 3) });
    await c.close();
  }
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`qa_v7: ${pass}/${results.length} PASS`);
  require('fs').writeFileSync('docs/qa/qa_v7.json', JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
  process.exit(pass === results.length ? 0 : 1);
})();
