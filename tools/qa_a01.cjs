// GPT A01 tier-1 key poses: each posed form mid-attack in battle.  node tools/qa_a01.cjs <port>
const { chromium } = require('playwright');
const port = process.argv[2] || '8124';
const out = 'docs/qa/screens/';
const base = `http://127.0.0.1:${port}/`;
const FORMS = [['warrior', 'knight', 'meadow'], ['warrior', 'berserker', 'desert'], ['mage', 'warlock', 'volcano'], ['archer', 'ranger', 'forest'], ['archer', 'hunter', 'glacier'], ['rogue', 'assassin', 'castle'], ['rogue', 'trickster', 'void']];
(async () => {
  const b = await chromium.launch();
  const errs = []; const shots = []; const res = [];
  for (const [cls, branch, region] of FORMS) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    await p.goto(base + '?autostart&nodaily');
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    await p.evaluate(async ({ cls, branch, region }) => {
      const g = __asteria.game;
      const { REGIONS, CLASS_SKILLS, BRANCH_SKILL } = await import('./src/data/content.js');
      for (let i = 0; i < 20 && g.busy; i++) await new Promise((r) => setTimeout(r, 100));
      await g.transact('qa', (s) => {
        s.player.cls = cls; s.classChosen = true; s.player.level = 35; s.player.tier = 1; s.player.branch = branch;
        s.skills.equipped = [...CLASS_SKILLS[cls].base, BRANCH_SKILL[branch], null];
        s.progression.unlockedRegions = REGIONS.map((r) => r.id);
        for (const r of REGIONS) s.progression.maxWave[r.id] = 10;
        for (const st of ['atk', 'hp', 'def']) s.player.statsUpgrades[st] = 300;
        return { ok: true };
      });
      await g.setFarm(region, 3, false);
      __asteria.app.updateHud(true);
    }, { cls, branch, region });
    await p.waitForTimeout(1800);
    await p.waitForFunction(() => { const a = __asteria.game.active.hero.action; const t = __asteria.game.active.t; return a && a.kind === 'attack' && t >= a.impactAt && t < a.impactAt + 100; }, null, { timeout: 20000, polling: 'raf' }).catch(() => {});
    const posed = await p.evaluate(async (branch) => { const A = await import('./src/render/assets.js'); return !!A.promoPoses(branch, 1); }, branch);
    res.push(`${branch}: poses=${posed}`);
    const f = `${out}a01_${branch}_390x844.png`; await p.screenshot({ path: f }); shots.push(f);
    await c.close();
  }
  console.log(res.join('\n')); console.log(shots.join('\n'));
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
