// v11 스킬 등급(뽑기형) QA: 스킬 뽑기 확률표(등급 + 각인), 신화 천장 표시, 뽑기 결과(등급 카드·등급 상승),
// 스킬 화면 등급 태그·아이콘 테두리, 상세 등급 표(지금/다음), 전투 스킬바 등급색.
// 3 viewports, no horizontal overflow, no page errors. usage: node tools/qa_v11.cjs [port]
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
  const bad = [...document.querySelectorAll('.modal-overlay:last-of-type .modal *, .panel *, .skills *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > innerWidth + 1 && !scroller(e); });
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
    await tx(`(s) => { s.wallet.gem = 50000; s.wallet.skTicket = 0; s.skills.grades = {}; s.gacha.sk.mythPity = 40; }`);
    // 1) gacha screen: skill tab, rates incl. rune + 5 grades, mythic pity line
    await p.evaluate(() => __asteria.screens.go(__asteria.app, 'gacha'));
    await p.waitForSelector('[data-screen="gacha"], .modal-overlay');
    await p.click('text=스킬 뽑기');
    await p.waitForTimeout(300);
    const g = await p.evaluate(() => { const m = document.querySelector('.modal-overlay:last-of-type'); const t = m.textContent; return { rows: [...m.querySelectorAll('details .kv')].length, myth: /신화 스킬 확정까지/.test(t), sum: [...m.querySelectorAll('details .kv b')].reduce((a, b) => a + parseFloat(b.textContent), 0) }; });
    ok(g.rows === 6 && g.myth && Math.abs(g.sum - 100) < 0.1, `gacha skill rates ${tag}`, g);
    ok(!(await overflow(p)), `gacha no overflow ${tag}`);
    await p.screenshot({ path: `${out}v11_gacha_${tag}.png` });
    // result screen with an upgrade (seeded 11-draw on a fresh grade table)
    await tx(`(s) => { s.skills.grades = {}; }`);
    await p.evaluate(async () => {
      const g = __asteria.game; const seq = ['epic', 'common', 'legendary', 'rare', 'common', 'mythic', 'common', 'rare', 'common', 'epic', 'common'];
      let i = 0; const real = g.rng;
      g.rng = Object.assign((...a) => real(...a), real, { weighted: () => seq[i++ % seq.length] });
      await p_draw(); g.rng = real;
      async function p_draw() {
        __asteria.screens.go(__asteria.app, 'gacha');
        await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.modal-overlay:last-of-type [role="tab"]')].find((b) => /스킬/.test(b.textContent)).click();
        await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.modal-overlay:last-of-type .draw-btn')][1].click();
        await new Promise((r) => setTimeout(r, 600));
      }
    });
    await p.waitForSelector('[data-screen="gachaResult"]', { timeout: 5000 });
    await p.waitForTimeout(1200);
    const up = await p.evaluate(() => ({ up: document.querySelectorAll('[data-screen="gachaResult"] .tag.up').length, line: !!document.querySelector('.draw-up') }));
    ok(up.up >= 2 && up.line, `등급 상승 shown ${tag}`, up);
    const grades = await p.evaluate(() => ({ ...__asteria.game.state.skills.grades }));
    ok(Object.values(grades).includes('mythic'), `grades upgraded by draws ${tag}`, grades);
    ok(!(await overflow(p)), `result no overflow ${tag}`);
    await p.screenshot({ path: `${out}v11_draw_result_${tag}.png` });
    await clearModals(p);
    // 3) skills tab: grade tags + coloured icons
    await p.evaluate(() => __asteria.app.setTab('skills'));
    await p.waitForTimeout(400);
    const sk = await p.evaluate(() => ({ tags: document.querySelectorAll('.panel .sg-tag').length, coloured: document.querySelectorAll('.panel img.sg-legendary, .panel img.sg-mythic, .panel img.sg-epic').length }));
    ok(sk.tags >= 4 && sk.coloured >= 1, `skills tab grade tags ${tag}`, sk);
    ok(!(await overflow(p)), `skills tab no overflow ${tag}`);
    await p.screenshot({ path: `${out}v11_skills_${tag}.png` });
    // 4) detail: grade table with current + next
    const target = await p.evaluate(() => { const g = __asteria.game.state.skills.grades; return Object.keys(g).find((k) => g[k] !== 'mythic') || Object.keys(g)[0]; });
    await p.evaluate((id) => __asteria.screens.openSkillDetail(__asteria.app, id), target);
    await p.waitForSelector('[data-screen="skillgrade"]');
    await p.waitForTimeout(700);
    const d = await p.evaluate(() => ({ rows: document.querySelectorAll('.sg-row').length, on: document.querySelectorAll('.sg-row.on').length, next: document.querySelectorAll('.sg-row.next').length }));
    ok(d.rows === 5 && d.on === 1, `detail grade table ${tag}`, d);
    ok(!(await overflow(p)), `detail no overflow ${tag}`);
    await p.screenshot({ path: `${out}v11_detail_${tag}.png` });
    await clearModals(p);
    // 5) battle tab skill bar colour
    await p.evaluate(() => { __asteria.app.buildSkills(); __asteria.app.setTab('battle'); });
    await p.waitForTimeout(500);
    const bar = await p.evaluate(() => [...document.querySelectorAll('.skills .skill')].map((b) => [...b.classList].find((c) => c.startsWith('sg-'))).filter(Boolean));
    ok(bar.length >= 4 && bar.some((c) => c !== 'sg-common'), `skill bar grade classes ${tag}`, bar);
    await p.screenshot({ path: `${out}v11_battle_${tag}.png` });
    const badCls = await p.evaluate((re) => { const R = new RegExp(re); const s = new Set(); document.querySelectorAll('[class]').forEach((e) => e.classList.forEach((c) => { if (R.test(c)) s.add(c); })); return [...s]; }, BAD.source);
    ok(!badCls.length, `no blocker-like class names ${tag}`, badCls);
    ok(!errs.length, `no page errors ${tag}`, errs);
    await ctx.close();
  }
  await b.close();
  const pass = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'qa_v11.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
  console.log(`qa_v11: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === results.length ? 0 : 1);
})();
