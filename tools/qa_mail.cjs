// 우편함 · 쿠폰 QA (v9): operator mail delivery, header badge, claim all (reveal after save),
// coupon redeem → mail, failure reasons, 3 viewports, no horizontal overflow.
// usage: node tools/qa_mail.cjs [port]   (or QA_URL=...)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const port = process.argv[2] || 8123;
const base = process.env.QA_URL || `http://localhost:${port}/`;
const out = path.join(__dirname, '..', 'docs', 'qa', 'screens') + '/';
const VPS = [[390, 844], [360, 700], [412, 915]];
const results = [];
const ok = (cond, name, extra) => { results.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra ? JSON.stringify(extra) : ''); };

(async () => {
  const b = await chromium.launch();
  for (const vp of VPS) {
    const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base + '?autostart&nodaily');
    await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
    // boot refresh delivers operator mail → header badge
    await p.waitForFunction(() => __asteria.game.state.mail && __asteria.game.state.mail.list.length >= 1, null, { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => __asteria.app.updateHud(true));
    const n = await p.evaluate(() => __asteria.game.state.mail.list.filter((x) => !x.claimedAt).length);
    ok(n >= 1, `${vp[0]} operator mail delivered`, { n });
    ok(await p.locator('.mail-btn:not([hidden])').count() === 1, `${vp[0]} header mail badge visible`);
    // open from the header badge
    await p.click('.mail-btn');
    await p.waitForSelector('[data-screen="mail"]');
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.modal *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1));
    ok(!over, `${vp[0]} mailbox no horizontal overflow`);
    await p.screenshot({ path: `${out}v9_mail_${vp[0]}x${vp[1]}.png` });
    // coupon: unknown, then valid, then used
    await p.fill('.coupon-input', 'nope-123');
    await p.click('.coupon-go');
    await p.waitForTimeout(400);
    ok(/없는 쿠폰/.test(await p.textContent('.coupon-card')), `${vp[0]} unknown coupon message`);
    await p.fill('.coupon-input', 'seon-bae');
    await p.click('.coupon-go');
    await p.waitForTimeout(500);
    const hasMail = await p.evaluate(() => __asteria.game.state.mail.list.some((x) => /쿠폰 보상/.test(x.title) && x.rewards.gem === 3000));
    ok(hasMail && /우편으로 도착/.test(await p.textContent('.coupon-card')), `${vp[0]} coupon → mail`);
    await p.screenshot({ path: `${out}v9_coupon_${vp[0]}x${vp[1]}.png` });
    await p.fill('.coupon-input', 'SEONBAE');
    await p.click('.coupon-go');
    await p.waitForTimeout(400);
    ok(/이미 사용/.test(await p.textContent('.coupon-card')), `${vp[0]} coupon used once`);
    // claim all: reward reveal opens only after the save
    const gem0 = await p.evaluate(() => __asteria.game.state.wallet.gem);
    await p.click('.mail-all');
    await p.waitForSelector('[data-screen="mailClaimed"]', { timeout: 5000 });
    const gem1 = await p.evaluate(() => __asteria.game.state.wallet.gem);
    ok(gem1 - gem0 >= 3000 + 300, `${vp[0]} claim all granted`, { gained: gem1 - gem0 });
    await p.screenshot({ path: `${out}v9_mail_claimed_${vp[0]}x${vp[1]}.png` });
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; __asteria.app.updateHud(true); });
    ok(await p.locator('.mail-btn[hidden]').count() === 1, `${vp[0]} badge hidden after claiming`);
    // menu tile exists
    await p.evaluate(() => __asteria.app.setTab('menu'));
    await p.waitForTimeout(300);
    ok(await p.locator('[data-key="tile-mail"]').count() === 1, `${vp[0]} menu tile`);
    ok(errs.length === 0, `${vp[0]} no page errors`, { errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'qa_mail_results.json'), JSON.stringify(results, null, 1));
  const pass = results.filter((r) => r.pass).length;
  console.log(`qa_mail: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})();
