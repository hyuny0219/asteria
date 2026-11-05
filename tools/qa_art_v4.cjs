// Battle screenshots of the v4 art at 390×844: new regions, a tier-3 hero, a new boss.
// node tools/qa_art_v4.cjs <port> [outDir]
const { chromium } = require('playwright');
const port = process.argv[2] || '8124';
const out = process.argv[3] || 'docs/qa/screens/';
const base = `http://127.0.0.1:${port}/?autostart&nodaily`;

async function page(b) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  p.on('requestfailed', (r) => p.errs.push('failed ' + r.url()));
  await p.goto(base);
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  return { c, p };
}
// unlock regions / set class, level, tier; then farm a region
async function setup(p, { cls = 'warrior', branch = null, tier = 0, level = 1, region = 'meadow', wave = 5 }) {
  await p.evaluate(async ({ cls, branch, tier, level, region, wave }) => {
    const g = __asteria.game;
    const { REGIONS, CLASS_SKILLS, BRANCH_SKILL, BRANCH_SKILL2 } = await import('./src/data/content.js');
    await g.transact('qa', (s) => {
      s.player.cls = cls; s.classChosen = true; s.player.level = level; s.player.tier = tier; s.player.branch = branch;
      s.skills.equipped = [...CLASS_SKILLS[cls].base, tier >= 1 ? BRANCH_SKILL[branch] : null, tier >= 2 ? BRANCH_SKILL2[branch] : null];
      s.progression.unlockedRegions = REGIONS.map((r) => r.id);
      for (const r of REGIONS) s.progression.maxWave[r.id] = 10;
      for (const st of ['atk', 'hp', 'def']) s.player.statsUpgrades[st] = 400;
      return { ok: true };
    });
    await g.setFarm(region, wave, false);
    __asteria.app.setTab('growth');
    __asteria.app.updateHud(true);
  }, { cls, branch, tier, level, region, wave });
  await p.waitForTimeout(3500);
}

(async () => {
  const b = await chromium.launch();
  const shots = [];
  const cases = [
    ['forest', { region: 'forest', level: 35, cls: 'archer', branch: 'ranger', tier: 1 }],
    ['volcano', { region: 'volcano', level: 55, cls: 'mage', branch: 'wizard', tier: 2 }],
    ['void', { region: 'void', level: 95, cls: 'rogue', branch: 'trickster', tier: 3 }],
    ['tier3_warrior', { region: 'castle', level: 92, cls: 'warrior', branch: 'knight', tier: 3 }],
    ['abyssal', { region: 'abyssal', level: 65, cls: 'warrior', branch: 'berserker', tier: 2 }],
    ['sky', { region: 'sky', level: 85, cls: 'mage', branch: 'warlock', tier: 3 }],
    ['glacier', { region: 'glacier', level: 45, cls: 'archer', branch: 'hunter', tier: 1 }],
  ];
  const errs = [];
  for (const [n, o] of cases) {
    const { c, p } = await page(b);
    await setup(p, o);
    const f = `${out}art_${n}_390x844.png`;
    await p.screenshot({ path: f });
    shots.push(f); errs.push(...p.errs);
    await c.close();
  }
  // new boss fights
  for (const [boss, region, o] of [['B06', 'volcano', { cls: 'mage', branch: 'warlock', tier: 2, level: 60 }], ['B09', 'sky', { cls: 'warrior', branch: 'berserker', tier: 3, level: 90 }], ['B04', 'forest', { cls: 'rogue', branch: 'assassin', tier: 1, level: 40 }]]) {
    const { c, p } = await page(b);
    await setup(p, { ...o, region, wave: 10 });
    const r = await p.evaluate((id) => __asteria.game.startBoss(id), boss);
    await p.waitForTimeout(4000);
    const f = `${out}art_boss_${boss}_390x844.png`;
    await p.screenshot({ path: f });
    shots.push(f); errs.push(...p.errs);
    console.log(boss, JSON.stringify(r));
    await c.close();
  }
  console.log(JSON.stringify({ shots, errors: errs }, null, 1));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
