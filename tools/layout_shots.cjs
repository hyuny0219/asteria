// Quick layout check on phone-sized viewports: node tools/layout_shots.cjs <port> <tab> [outDir]
const { chromium, devices } = require('playwright');
const port = process.argv[2] || '8124';
const tab = process.argv[3] || 'growth';
const out = process.argv[4] || 'docs/qa/layout/';
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const list = [
    ['iphone13', devices['iPhone 13']],
    ['short600', { viewport: { width: 375, height: 600 }, isMobile: true, hasTouch: true }],
    ['pixel7', devices['Pixel 7']],
  ];
  for (const [n, d] of list) {
    const c = await b.newContext({ ...d, deviceScaleFactor: 1 });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/?autostart`);
    await p.waitForFunction(() => globalThis.__asteria?.app?.el, null, { timeout: 20000 });
    await p.waitForTimeout(2500);
    await p.evaluate((t) => __asteria.app.setTab(t), tab);
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => ({
      vh: innerHeight, sh: document.documentElement.scrollHeight,
      battle: Math.round(document.querySelector('.battle').getBoundingClientRect().height),
      panel: Math.round(document.querySelector('.lower .panel').getBoundingClientRect().height),
      navBottom: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom),
    }));
    console.log(n, JSON.stringify(m), errs.join(' | '));
    await p.screenshot({ path: `${out}${n}_${tab}.png` });
    await c.close();
  }
  await b.close();
})();
