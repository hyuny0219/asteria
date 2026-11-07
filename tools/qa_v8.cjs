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
    // ---- 원정 파견 ----
    await p.evaluate(() => __asteria.app.setTab('dungeon'));
    ok(await p.locator('[data-screen="expedition"].locked-card').count() === 1, `${vp[0]} expedition locked without a companion`);
    await p.evaluate(() => __qaTx((s) => { s.pets.owned.P01 = { level: 12, stars: 2, shards: 0 }; s.pets.owned.P03 = { level: 3, stars: 1, shards: 0 }; s.pets.active = 'P01'; return { ok: true }; }));
    await p.evaluate(() => { __asteria.app.renderPanel(); });
    await p.waitForTimeout(300);
    await p.click('[data-screen="expedition"] .btn-primary');
    await p.waitForTimeout(400);
    ok(await p.locator('[data-screen="expeditionList"] .exp-card').count() === 5, `${vp[0]} board of 5`);
    // one-tap send (best free companion) on the first card
    await p.click('[data-screen="expeditionList"] .exp-card .btn-primary >> nth=0');
    await p.waitForTimeout(500);
    const sent = await p.evaluate(() => __asteria.game.state.expedition.slots.filter(Boolean).length);
    ok(sent === 1, `${vp[0]} sent one expedition`);
    ok(await p.evaluate(() => __asteria.game.state.expedition.slots.find(Boolean).pet === 'P01'), `${vp[0]} one-tap send used the strongest free companion`);
    // 자동 파견 sends the remaining free companion, then the button explains why it is off
    await p.click('[data-screen="expeditionList"] .exp-top .btn:has-text("자동 파견")');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => __asteria.game.state.expedition.slots.filter(Boolean).length === 2), `${vp[0]} auto dispatch filled the other companion`);
    ok(await p.locator('[data-screen="expeditionList"] .exp-top .btn:has-text("쉬는 동료 없음")').count() === 1, `${vp[0]} auto button explains no free companion`);
    ok(!(await overflowX(p)), `${vp[0]} expedition modal no horizontal overflow`);
    await shot(p, 'expedition', vp);
    // finish it by moving its end time
    await p.evaluate(() => __qaTx((s) => { for (const x of s.expedition.slots) if (x) x.endAt = Date.now() - 1000; return { ok: true }; }));
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; __asteria.app.renderPanel(); });
    await p.click('[data-screen="expedition"] .btn-primary');
    await p.waitForTimeout(500);
    const btn = p.locator('[data-screen="expeditionList"] .exp-top .btn-primary:has-text("보상 받기")').first();
    await btn.click();
    await p.waitForSelector('[data-screen="expResult"]', { timeout: 5000 });
    ok(await p.evaluate(() => __asteria.game.state.expedition.done === 2), `${vp[0]} expeditions claimed (모두 받기)`);
    await shot(p, 'expedition_result', vp);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    // ---- 희귀 정예 (spawn in farm, codex tab) ----
    await p.evaluate(() => { const g = __asteria.game; const { RARES } = __asteria.wb || {}; });
    const rare = await p.evaluate(async () => { const g = __asteria.game; const m = await import('./src/core/worldboss.js'); const e = g.farm.spawnRare(m.RARES.meadow, 3); return !!e; });
    ok(rare, `${vp[0]} rare elite spawned`);
    await p.evaluate(() => __asteria.app.setTab('battle'));
    await p.waitForTimeout(2500);
    await shot(p, 'rare_elite', vp);
    await p.evaluate(() => __qaTx((s) => { s.worldBoss.rares.RE01 = 2; s.worldBoss.rares.RE03 = 1; return { ok: true }; }));
    await p.evaluate(async () => { const v6 = await import('./src/ui/v6.js'); v6.openCodex(__asteria.app, 'rare'); });
    await p.waitForTimeout(500);
    ok(await p.locator('[data-screen="codex"] .rare-cell').count() === 10, `${vp[0]} codex rare tab 10 cells`);
    ok(!(await overflowX(p)), `${vp[0]} codex rare no overflow`);
    await shot(p, 'codex_rare', vp);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    // ---- 제작소: 보옥 · 마부 · 음식 ----
    await p.evaluate(async () => { const I = await import('./src/core/items.js'); const E = await import('./src/core/economy.js'); const U = await import('./src/core/util.js'); return __qaTx((s) => { const it = I.makeItem(s, { slot: 'weapon', rarity: 'legendary', level: 45, rng: U.makeRng(7) }); s.inventory.push(it); E.equip(s, it.id); s.craft.jewels = { 'ruby:1': 4, 'sapphire:2': 1 }; s.craft.herb = 5; s.craft.meat = 5; s.wallet.ore += 1000; s.wallet.awakenStone = 2; return { ok: true }; }); });
    await p.evaluate(() => { __asteria.app.setTab('dungeon'); __asteria.app.renderPanel(); });
    await p.waitForTimeout(300);
    ok(await p.locator('[data-screen="workshopCard"]').count() === 1, `${vp[0]} workshop card`);
    await p.click('[data-screen="workshopCard"] .btn-primary');
    await p.waitForTimeout(400);
    ok(await p.locator('[data-screen="workshop"] .ws-sockets .btn').count() === 2, `${vp[0]} legendary weapon shows 2 sockets`);
    await p.click('[data-screen="workshop"] .ws-sockets .btn >> nth=0');
    await p.waitForTimeout(200);
    await p.click('[data-screen="workshop"] .mp-row .btn-primary >> nth=0');
    await p.waitForTimeout(500);
    const gem = await p.evaluate(() => { const s = __asteria.game.state; const it = s.inventory.find((i) => i.id === s.equipped.weapon); return it.gems && it.gems[0]; });
    ok(gem && gem.t === 'ruby' && gem.lv === 1, `${vp[0]} jewel socketed ${JSON.stringify(gem)}`);
    await p.click('[data-screen="workshop"] .mp-row .btn:not([disabled]) >> nth=0');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => __asteria.game.state.craft.jewels['ruby:2'] === 1 && !__asteria.game.state.craft.jewels['ruby:1']), `${vp[0]} combine 3→1`);
    ok(!(await overflowX(p)), `${vp[0]} workshop jewel no overflow`);
    await shot(p, 'workshop_jewel', vp);
    await p.click('[data-screen="workshop"] .ws-sockets .btn >> nth=0');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => { const s = __asteria.game.state; const it = s.inventory.find((i) => i.id === s.equipped.weapon); return !it.gems[0] && s.craft.jewels['ruby:1'] === 1; }), `${vp[0]} free unsocket back to bag`);
    await p.click('[data-screen="workshop"] .seg button >> nth=1');
    await p.waitForTimeout(300);
    await p.click('[data-screen="workshop"] [data-slot="weapon"] .btn');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => !!__asteria.game.state.craft.enchant.weapon && __asteria.game.state.wallet.awakenStone === 1), `${vp[0]} enchant weapon slot`);
    ok(!(await overflowX(p)), `${vp[0]} workshop enchant no overflow`);
    await shot(p, 'workshop_enchant', vp);
    await p.click('[data-screen="workshop"] .seg button >> nth=2');
    await p.waitForTimeout(300);
    await p.click('[data-screen="workshop"] .mp-row .btn-primary >> nth=0');
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => { const f = __asteria.game.state.craft.food; return f && f.id === 'soup' && f.until > Date.now(); }), `${vp[0]} cooked soup`);
    ok(!(await overflowX(p)), `${vp[0]} workshop food no overflow`);
    await shot(p, 'workshop_food', vp);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    ok(p.errs.length === 0, `${vp[0]} no page errors ${p.errs.join(' | ')}`);
    await p.close();
    // ---- 월드 보스 (fake clock inside a window) ----
    const q = await b.newPage({ viewport: { width: vp[0], height: vp[1] } });
    q.errs = []; q.on('pageerror', (e) => q.errs.push(e.message));
    await q.clock.install({ time: new Date('2026-11-09T18:20:00+09:00') });
    await q.goto(BASE + '?autostart&nodaily');
    await q.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    await q.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    await q.evaluate(async () => { const g = __asteria.game; for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { s.player.level = 45; s.progression.bossCleared.B03 = true; s.player.statsUpgrades.atk = 900; s.player.statsUpgrades.hp = 900; return { ok: true }; }); if (r.ok) break; await new Promise((r) => setTimeout(r, 50)); } __asteria.app.setTab('dungeon'); __asteria.app.renderPanel(); });
    await q.waitForTimeout(400);
    ok(await q.locator('[data-screen="worldBoss"].hot-card').count() === 1, `${vp[0]} world boss open at 18:20 KST`);
    await shot(q, 'worldboss_card', vp);
    await q.click('[data-screen="worldBoss"] .btn-primary');
    await q.waitForFunction(() => __asteria.game.session && __asteria.game.session.kind === 'world', null, { timeout: 5000 });
    await q.waitForTimeout(1500);
    ok(await q.evaluate(() => /월드 보스/.test(__asteria.app.el.hudTitle.textContent) && document.getElementById('app').classList.contains('immersive')), `${vp[0]} world boss immersive HUD`);
    await shot(q, 'worldboss_battle', vp);
    for (let i = 0; i < 120 && (await q.evaluate(() => __asteria.game.mode)) !== 'RESULT'; i++) await q.evaluate(() => { const g = __asteria.game; for (let k = 0; k < 40 && g.active && !g.active.over; k++) { g.active.step(); g.process(g.active.drainEvents()); } });
    await q.waitForSelector('[data-screen="worldBossResult"]', { timeout: 10000 });
    await q.waitForTimeout(900);
    ok(await q.evaluate(() => !!__asteria.game.state.worldBoss.bestGrade), `${vp[0]} world boss graded`);
    await shot(q, 'worldboss_result', vp);
    await q.click('[data-screen="worldBossResult"] ~ .modal-actions .btn, .modal-actions .btn-primary');
    await q.waitForTimeout(500);
    await q.evaluate(() => { __asteria.app.renderPanel(); });
    ok(await q.locator('[data-screen="worldBoss"] .btn-primary[disabled]').count() === 1, `${vp[0]} one try per window`);
    ok(q.errs.length === 0, `${vp[0]} world boss no page errors ${q.errs.join(' | ')}`);
    await q.close();
  }
  await b.close();
  console.log(`qa_v8: ${pass}/${pass + failN} PASS`);
  process.exit(failN ? 1 : 0);
})();
