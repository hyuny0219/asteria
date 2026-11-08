// v12 QA: 스테이지 페이즈 HUD + 이동 구간(배경 흐름, 탈것, 회복), 탈것·날개 화면(목록·장착·레벨·별·소환·확률),
// 전투 중 날개, 모션 줄이기. 3 viewports, no horizontal overflow, no page errors.
// usage: node tools/qa_v12.cjs [port]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const port = process.argv[2] || 8123;
const base = process.env.QA_URL || `http://localhost:${port}/`;
const out = path.join(__dirname, '..', 'docs', 'qa', 'screens') + '/';
const VPS = [[390, 844], [360, 700], [412, 915]];
const results = [];
const ok = (cond, name, extra) => { results.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra ? JSON.stringify(extra) : ''); };
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
    const tx = (src) => p.evaluate(async (src) => { const g = __asteria.game; const f = eval(src); for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { f(s); return { ok: true }; }); if (r.ok) return true; await new Promise((r) => setTimeout(r, 60)); } return false; }, src);
    await tx(`(s) => { s.player.level = 20; s.mounts = { owned: { horse: { lv: 1, star: 1, shards: 12 } }, equipped: 'horse', pity: 0, draws: 0 };
      s.wings = { owned: { rose: { lv: 1, star: 1, shards: 0 } }, equipped: 'rose', pity: 0, draws: 0 };
      s.wallet.mountFood = 400; s.wallet.wingFeather = 400; s.wallet.mountTicket = 2; s.wallet.wingTicket = 1; s.wallet.gem = 8000; }`);
    await p.evaluate(() => __asteria.game.syncHero && __asteria.game.syncHero());

    // 1) battle: phase HUD state + wings behind the hero
    await p.evaluate(() => __asteria.app.setTab('battle'));
    await p.waitForTimeout(600);
    const bs = await p.evaluate(() => { const g = __asteria.game, r = __asteria.app.renderer; return { phase: g.farm && g.farm.phaseInfo && g.farm.phaseInfo(), wing: r.wingId, mount: r.mountId }; });
    ok(bs.phase && bs.phase.count === 3 && bs.wing === 'rose' && bs.mount === 'horse', `phase info + steeds passed to renderer ${tag}`, bs);
    // wait for an attack frame (fast flap)
    await p.waitForFunction(() => { const a = __asteria.game.farm && __asteria.game.farm.hero.action; return a && a.kind === 'attack'; }, null, { timeout: 15000 }).catch(() => {});
    await p.screenshot({ path: `${out}v12_battle_wings_${tag}.png` });

    // 2) travel leg: force the end of phase 1, then capture
    await tx(`(s) => { s.progression.waveKills = 2; }`);
    const tr = await p.waitForFunction(() => __asteria.game.farm && __asteria.game.farm.traveling, null, { timeout: 20000 }).then(() => true).catch(() => false);
    ok(tr, `travel leg starts after phase 1 ${tag}`);
    if (tr) {
      const s0 = await p.evaluate(() => ({ scroll: __asteria.app.renderer.bgScroll || 0, hp: __asteria.game.farm.hero.hp, info: __asteria.game.farm.phaseInfo(), alive: __asteria.game.farm.alive().length }));
      await p.waitForTimeout(900);
      const s1 = await p.evaluate(() => ({ scroll: __asteria.app.renderer.bgScroll || 0, traveling: __asteria.game.farm.traveling, alive: __asteria.game.farm.alive().length, act: __asteria.game.farm.hero.action }));
      ok(s1.scroll !== s0.scroll && s0.alive === 0 && s1.alive === 0 && !s1.act, `travel: background scrolls, no enemies, hero idle ${tag}`, { s0, s1 });
      ok(s0.info.traveling && s0.info.idx >= 1, `phase HUD state while travelling ${tag}`, s0.info);
      await p.screenshot({ path: `${out}v12_travel_${tag}.png` });
    }
    // 3) menu tiles with red dot
    await p.evaluate(() => __asteria.app.setTab('menu'));
    await p.waitForTimeout(400);
    const tiles = await p.evaluate(() => ['mounts', 'wings'].map((id) => { const t = document.querySelector(`[data-key="tile-${id}"]`); return t ? { id, hot: t.classList.contains('hot'), txt: t.textContent } : null; }));
    ok(tiles.every((t) => t && t.hot), `menu tiles 탈것/날개 with red dot ${tag}`, tiles);
    ok(!(await overflow(p)), `menu no overflow ${tag}`);
    await p.screenshot({ path: `${out}v12_menu_${tag}.png` });

    // 4) mounts screen
    await p.click('[data-key="tile-mounts"]');
    await p.waitForSelector('[data-screen="mounts"]');
    await p.waitForTimeout(300);
    const ms = await p.evaluate(() => { const m = document.querySelector('[data-screen="mounts"]'); return { cards: m.querySelectorAll('.steed-card').length, chips: m.querySelectorAll('.steed-lv .cost-chip').length, rates: /희귀 60%/.test(m.textContent) && /천장/.test(m.textContent) && /신화 1%/.test(m.textContent), imgs: [...m.querySelectorAll('.steed-card img')].filter((i) => i.complete && i.naturalWidth > 0).length }; });
    ok(ms.cards === 8 && ms.chips >= 2 && ms.rates && ms.imgs === 8, `mounts screen: 8 cards, cost chips, odds + pity published ${tag}`, ms);
    ok(!(await overflow(p)), `mounts no overflow ${tag}`);
    await p.screenshot({ path: `${out}v12_mounts_${tag}.png` });
    await p.click('[data-key="steed-lv-10"]');
    await p.waitForTimeout(500);
    await p.click('[data-key="steed-star"]');
    await p.waitForTimeout(500);
    const hs = await p.evaluate(() => ({ ...__asteria.game.state.mounts.owned.horse }));
    ok(hs.lv === 11 && hs.star === 2, `mount level +10 and star up ${tag}`, hs);
    await p.click('[data-key="steed-summon-10"]');
    await p.waitForSelector('[data-screen="steedSummonResult"]', { timeout: 5000 });
    const sr = await p.evaluate(() => ({ n: document.querySelectorAll('[data-screen="steedSummonResult"] .steed-res').length, t: __asteria.game.state.wallet.mountTicket }));
    ok(sr.n === 10 && sr.t === 0, `mount summon ×10 uses tickets first ${tag}`, sr);
    ok(!(await overflow(p)), `summon result no overflow ${tag}`);
    await p.screenshot({ path: `${out}v12_mount_summon_${tag}.png` });
    await clearModals(p);

    // 5) wings screen
    await p.evaluate(() => __asteria.screens.go(__asteria.app, 'wings'));
    await p.waitForSelector('[data-screen="wings"]');
    await p.waitForTimeout(300);
    const ws = await p.evaluate(() => { const m = document.querySelector('[data-screen="wings"]'); return { cards: m.querySelectorAll('.steed-card').length, equipped: !!m.querySelector('.steed-card .pending-tag') }; });
    ok(ws.cards === 8 && ws.equipped, `wings screen ${tag}`, ws);
    await p.click('[data-key="steed-lv-max"]');
    await p.waitForTimeout(500);
    const wl = await p.evaluate(() => __asteria.game.state.wings.owned.rose.lv);
    ok(wl > 11, `wing level max ${tag}`, wl);
    ok(!(await overflow(p)), `wings no overflow ${tag}`);
    await p.screenshot({ path: `${out}v12_wings_${tag}.png` });
    await clearModals(p);

    // 6) placeholder mount (no art yet) on a travel leg, and reduce-motion keeps the scene still
    if (vp[0] === 390) {
      await tx(`(s) => { s.mounts.owned.skelhorse = { lv: 1, star: 1, shards: 0 }; s.mounts.equipped = 'skelhorse'; s.wings.owned.phoenix = { lv: 1, star: 1, shards: 0 }; s.wings.equipped = 'phoenix'; s.progression.waveKills = 2; }`);
      await p.evaluate(() => __asteria.app.setTab('battle'));
      const t2 = await p.waitForFunction(() => __asteria.game.farm && __asteria.game.farm.traveling, null, { timeout: 20000 }).then(() => true).catch(() => false);
      if (t2) { await p.waitForTimeout(300); await p.screenshot({ path: `${out}v12_travel_placeholder_${tag}.png` }); }
      ok(t2, `placeholder mount travel captured ${tag}`);
      await tx(`(s) => { s.settings.reduceMotion = true; s.progression.waveKills = 5; }`);
      const t3 = await p.waitForFunction(() => __asteria.game.farm && __asteria.game.farm.traveling, null, { timeout: 25000 }).then(() => true).catch(() => false);
      const rm0 = await p.evaluate(() => __asteria.app.renderer.bgScroll || 0);
      await p.waitForTimeout(600);
      const rm1 = await p.evaluate(() => __asteria.app.renderer.bgScroll || 0);
      ok(t3 && rm0 === rm1, `reduce motion: travel background stays still ${tag}`, { rm0, rm1 });
      await tx(`(s) => { s.settings.reduceMotion = false; }`);
    }
    const badCls = await p.evaluate((re) => { const R = new RegExp(re); const s = new Set(); document.querySelectorAll('[class]').forEach((e) => e.classList.forEach((c) => { if (R.test(c)) s.add(c); })); return [...s]; }, BAD.source);
    ok(!badCls.length, `no blocker-like class names ${tag}`, badCls);
    ok(!errs.length, `no page errors ${tag}`, errs);
    await ctx.close();
  }
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'qa_v12.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
  console.log(`qa_v12: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === results.length ? 0 : 1);
})();
