// Screenshots of the GPT (handoff v4) class art: each class mid-attack, a tier-3 per class,
// equipment with a class weapon, and the title-form class picker. node tools/qa_gpt_v4.cjs <port>
const { chromium } = require('playwright');
const port = process.argv[2] || '8124';
const out = 'docs/qa/screens/';
const base = `http://127.0.0.1:${port}/`;
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function open(b, q = '?autostart&nodaily') {
  const c = await b.newContext(ctxOpts);
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  p.on('requestfailed', (r) => p.errs.push('failed ' + r.url()));
  await p.goto(base + q);
  return { c, p };
}
async function setup(p, { cls, branch = null, tier = 0, level = 5, region = 'meadow' }) {
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(async ({ cls, branch, tier, level, region }) => {
    const g = __asteria.game;
    const { REGIONS, CLASS_SKILLS, BRANCH_SKILL, BRANCH_SKILL2 } = await import('./src/data/content.js');
    const { makeItem } = await import('./src/core/items.js'); const { makeRng } = await import('./src/core/util.js');
    const rng = makeRng(7);
    await g.transact('qa', (s) => {
      s.player.cls = cls; s.classChosen = true; s.player.level = level; s.player.tier = tier; s.player.branch = branch;
      s.skills.equipped = [...CLASS_SKILLS[cls].base, tier >= 1 ? BRANCH_SKILL[branch] : null, tier >= 2 ? BRANCH_SKILL2[branch] : null];
      s.progression.unlockedRegions = REGIONS.map((r) => r.id);
      for (const r of REGIONS) s.progression.maxWave[r.id] = 10;
      for (const st of ['atk', 'hp', 'def']) s.player.statsUpgrades[st] = 300;
      for (const r of ['common', 'uncommon', 'rare', 'legendary']) s.inventory.push(makeItem(s, { slot: 'weapon', rarity: r, level, rng }));
      return { ok: true };
    });
    await g.setFarm(region, 5, false);
    __asteria.app.updateHud(true);
  }, { cls, branch, tier, level, region });
}
async function midAttack(p) {
  await p.waitForFunction(() => { const h = __asteria.game.active.hero; const a = h.action; return a && a.kind === 'attack' && __asteria.game.active.t >= a.impactAt && __asteria.game.active.t < a.impactAt + 100; }, null, { timeout: 20000, polling: 'raf' }).catch(() => {});
}
(async () => {
  const b = await chromium.launch();
  const errs = []; const shots = [];
  for (const cls of ['mage', 'archer', 'rogue']) {
    const { c, p } = await open(b);
    await setup(p, { cls });
    await p.waitForTimeout(1500);
    await midAttack(p);
    const f = `${out}gpt_${cls}_390x844.png`; await p.screenshot({ path: f }); shots.push(f);
    errs.push(...p.errs); await c.close();
  }
  for (const [cls, branch, region] of [['mage', 'wizard', 'sky'], ['archer', 'hunter', 'forest'], ['rogue', 'assassin', 'void']]) {
    const { c, p } = await open(b);
    await setup(p, { cls, branch, tier: 3, level: 92, region });
    await p.waitForTimeout(2500);
    const f = `${out}gpt_${cls}_t3_390x844.png`; await p.screenshot({ path: f }); shots.push(f);
    errs.push(...p.errs); await c.close();
  }
  { // equipment with class weapons
    const { c, p } = await open(b);
    await setup(p, { cls: 'mage' });
    await p.evaluate(() => __asteria.app.setTab('equipment'));
    await p.waitForTimeout(800);
    const names = await p.evaluate(() => __asteria.game.state.inventory.filter((i) => i.slot === 'weapon').map((i) => i.name));
    const f = `${out}gpt_weapons_390x844.png`; await p.screenshot({ path: f }); shots.push(f);
    console.log('weapons', names.join(', '));
    errs.push(...p.errs); await c.close();
  }
  { // title form class picker
    const { c, p } = await open(b, '');
    await p.waitForSelector('#title input.text', { timeout: 20000 });
    await p.click('#title .class-card:nth-child(3)');
    await p.waitForTimeout(400);
    const f = `${out}gpt_classpick_390x844.png`; await p.screenshot({ path: f }); shots.push(f);
    errs.push(...p.errs); await c.close();
  }
  console.log(shots.join('\n'));
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
