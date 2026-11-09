// GPT O3·O4·O5·O6 적용 확인 캡처: 3·4차 걷기/공격 프레임, 3·4차 탄 자세(탈것 종류별), 서약·초월 아이콘, 6번 칸, 진화 스킬 아이콘.
// usage: node tools/qa_v15_o345.cjs [port] (QA_URL 우선) → docs/qa/screens/v15_o345_*.png
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs', 'qa', 'screens');
(async () => {
  const base = (process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8437) + '/') + '?autostart&nodaily';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  const clean = () => p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
  await clean();
  const set = (o) => p.evaluate(async (o) => { const g = __asteria.game; const C = await import('/src/data/content.js'); for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { s.player.cls = o.cls; s.classChosen = true; s.player.level = 100; s.player.tier = o.tier; s.player.branch = o.br; s.player.statsUpgrades.hp = 20000; s.player.statsUpgrades.def = 3000; s.progression.region = 'meadow'; s.progression.wave = 1; s.mounts.owned = {}; s.mounts.equipped = null; if (o.mount) { s.mounts.owned[o.mount] = { lv: 1, star: 0, shards: 0 }; s.mounts.equipped = o.mount; } if (o.tier >= 4 && !s.promotion.oath) s.promotion.oath = o.oath || null; const base = C.CLASS_SKILLS[o.cls].base; for (let k = 0; k < 3; k++) s.skills.equipped[k] = base[k]; for (const id of base) s.skills.levels[id] = s.skills.levels[id] || 1; return { ok: true }; }); if (r.ok) break; await new Promise((r) => setTimeout(r, 50)); } g.startFarm && g.startFarm(); }, o);
  const canvasClip = () => p.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const info = {};
  // 1) walk / attack frames (renderer state sampled while capturing)
  for (const [cls, br, tier] of [['warrior', 'knight', 4], ['warrior', 'berserker', 3], ['mage', 'wizard', 4], ['rogue', 'assassin', 4], ['archer', 'hunter', 3]]) {
    await set({ cls, br, tier });
    await clean();
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(OUT, `v15_o345_${br}_t${tier}_walk_390.png`), clip: await canvasClip() });
    await p.waitForTimeout(1600);
    await clean();
    await p.screenshot({ path: path.join(OUT, `v15_o345_${br}_t${tier}_atk_390.png`), clip: await canvasClip() });
    info[`${br}_t${tier}`] = await p.evaluate(() => { const rd = __asteria.app.renderer || __asteria.renderer; return rd ? { tier: rd.heroTier, branch: rd.heroBranch } : null; });
  }
  // 2) riding, t3 / t4, several steed types
  const ride = [];
  for (const [cls, br, tier, mount] of [['warrior', 'knight', 3, 'horse'], ['warrior', 'berserker', 4, 'wolf'], ['mage', 'warlock', 4, 'lizard'], ['archer', 'ranger', 4, 'elk'], ['rogue', 'trickster', 3, 'nightmare'], ['rogue', 'assassin', 4, 'griffin']]) {
    await set({ cls, br, tier, mount });
    await clean();
    // the hero rides only while travelling between phases
    // force the travel stretch (field cleared, travelUntil set) so the capture shows the steed
    await p.evaluate(() => { const a = __asteria.game.active; if (a && a.phase) { a.enemies.length = 0; a.phase.travelUntil = a.t + 6000; } });
    await p.waitForTimeout(700);
    await clean();
    const f = `v15_o345_ride_${br}_t${tier}_${mount}_390.png`;
    await p.screenshot({ path: path.join(OUT, f), clip: await canvasClip() });
    ride.push(await p.evaluate(() => { const rd = __asteria.app.renderer || __asteria.renderer; const m = rd && rd.rideMeta && rd.rideMeta(); return m ? m.source : null; }));
  }
  // 3) 초월 창 (서약 아이콘 · 초월 문장 · 6번 칸 열쇠)
  await set({ cls: 'archer', br: 'ranger', tier: 3 });
  await clean();
  await p.screenshot({ path: path.join(OUT, 'v15_o345_slot6_locked_390x844.png') });
  const lockedKey = await p.evaluate(() => !!document.querySelector('.skill.locked .slot-key'));
  await p.evaluate(async () => { const m = await import('/src/ui/v4.js'); m.openAscend(__asteria.app); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const c = document.querySelector('.oath-card'); c && c.click(); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'v15_o345_ascend_oath_390x844.png') });
  const ascImgs = await p.evaluate(() => [...document.querySelectorAll('[data-screen="promotion"] img')].map((i) => i.getAttribute('src').split('/').pop()));
  await clean();
  // 4) 서약 바꾸기 (4차) + 진화 스킬 아이콘
  await set({ cls: 'rogue', br: 'trickster', tier: 4, oath: 'r_clone' });
  await p.evaluate(async () => { const m = await import('/src/ui/v4.js'); m.openOath(__asteria.app); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const c = document.querySelectorAll('.oath-card')[1]; c && c.click(); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'v15_o345_oath_swap_390x844.png') });
  const swap = await p.evaluate(() => !!document.querySelector('.oath-swap .btn-icon'));
  await clean();
  await p.evaluate(() => __asteria.app.setTab('skills'));
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'v15_o345_skills_evo_390x844.png') });
  const evo = await p.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src') || '').filter((s) => s.includes('skill_evo_')).length);
  await p.evaluate(() => __asteria.app.setTab('battle'));
  await p.waitForTimeout(500);
  const bar = await p.evaluate(() => [...document.querySelectorAll('.skill img')].map((i) => (i.getAttribute('src') || '').split('/').pop()));
  await p.screenshot({ path: path.join(OUT, 'v15_o345_battlebar_390x844.png') });
  console.log(JSON.stringify({ info, ride, lockedKey, ascImgs, swap, evo, bar, errs }));
  await b.close();
})();
