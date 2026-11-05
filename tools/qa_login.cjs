// Browser check for guest login + attendance + return bonus.
// node tools/qa_login.cjs <port> [outDir]
const { chromium, devices } = require('playwright');
const port = process.argv[2] || '8124';
const out = process.argv[3] || 'docs/qa/screens/';
const base = `http://127.0.0.1:${port}/`;
const results = [];
const ok = (name, pass, info = {}) => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base);
  await p.waitForSelector('#title input.text', { timeout: 20000 });
  await p.screenshot({ path: out + 'login_new_390.png' });
  // invalid nickname
  await p.fill('#title input.text', 'a');
  await p.click('#title .btns .btn-primary');
  const err = await p.textContent('#title .warn');
  ok('nickname rule shown', /2~10자/.test(err || ''), { err });
  await p.fill('#title input.text', '선배테스트');
  // class is chosen on the profile form itself
  await p.click('#title .class-card:nth-child(2)');
  await p.waitForTimeout(200);
  await p.screenshot({ path: out + 'login_classpick_390.png' });
  await p.click('text=마법사(으)로 시작');
  await p.waitForSelector('text=모험 시작', { timeout: 20000 });
  await p.click('text=모험 시작');
  await p.waitForSelector('[data-screen="attendance"]', { timeout: 8000 });
  ok('no in-game class picker after choosing on the form', !(await p.$('[data-screen="classpick"]')));
  const cls = await p.evaluate(() => ({ cls: __asteria.game.state.player.cls, chosen: __asteria.game.state.classChosen, ult: document.querySelector('.skill.ult').getAttribute('aria-label') }));
  ok('class picker → mage saved, mage ult on bar', cls.cls === 'mage' && cls.chosen && /메테오/.test(cls.ult), cls);
  await p.waitForTimeout(400);
  await p.screenshot({ path: out + 'attendance_390.png' });
  ok('attendance popup on first entry', true);
  const gem0 = await p.evaluate(() => __asteria.game.state.wallet.gem);
  await p.click('text=오늘 보상 받기');
  await p.waitForSelector('[data-screen="grant"]', { timeout: 5000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: out + 'attendance_grant_390.png' });
  const s1 = await p.evaluate(() => ({ count: __asteria.game.state.attendance.count, nick: __asteria.game.state.profile.nickname, gold: __asteria.game.state.wallet.gold }));
  ok('attendance claimed once', s1.count === 1 && s1.nick === '선배테스트', s1);
  await p.click('text=확인');
  // status shows nickname
  const nm = await p.textContent('.status .who b');
  ok('nickname in status bar', nm === '선배테스트', { nm });
  // reload: profile list with the card, no second attendance popup
  await p.reload();
  await p.waitForSelector('.profile-card', { timeout: 20000 });
  await p.screenshot({ path: out + 'login_list_390.png' });
  await p.click('.profile-card');
  await p.waitForSelector('text=이어하기', { timeout: 20000 });
  await p.click('text=이어하기');
  await p.waitForTimeout(1200);
  const att2 = await p.$('[data-screen="attendance"]');
  ok('no attendance popup after claiming today', !att2);
  // simulate 8 days away: move lastActiveAt back and reload
  await p.evaluate(async () => { const g = __asteria.game; g.state.offlineSnapshot.lastActiveAt -= 8 * 86400000; g.state.offlineSnapshot.pendingClaim = null; await g.saver.commit(g.state); });
  await p.evaluate(() => { __asteria.game.commitState = async () => ({ ok: true }); });   // stop this tab overwriting lastActiveAt before reload
  await p.reload();
  await p.waitForSelector('.profile-card', { timeout: 20000 });
  await p.click('.profile-card');
  await p.waitForSelector('text=이어하기', { timeout: 20000 });
  await p.click('text=이어하기');
  // offline settlement first, then return bonus
  try { await p.waitForSelector('[data-screen="offline"]', { timeout: 4000 }); await p.click('[data-screen="offline"] .btn-primary, .modal-actions .btn-primary'); } catch { /* no offline */ }
  await p.waitForTimeout(1500);
  const dbg = await p.evaluate(() => ({ mode: __asteria.game.mode, pending: __asteria.game.state.returnBonus, last: __asteria.game.state.offlineSnapshot.lastActiveAt, now: Date.now(), modals: [...document.querySelectorAll('.modal-overlay')].map((m) => m.dataset.screen) }));
  console.log('debug', JSON.stringify(dbg));
  await p.screenshot({ path: out + 'debug_return.png' });
  await p.waitForSelector('[data-screen="return"]', { timeout: 8000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: out + 'return_390.png' });
  await p.click('text=복귀 보상 받기');
  await p.waitForTimeout(800);
  const rb = await p.evaluate(() => ({ pending: !!__asteria.game.state.returnBonus.pending, boost: __asteria.game.state.returnBonus.boostUntil > Date.now() }));
  ok('return bonus claimed and boost active', !rb.pending && rb.boost, rb);
  // a second profile
  await p.goto(base);
  await p.waitForSelector('text=+ 새 게스트 만들기', { timeout: 20000 });
  await p.click('text=+ 새 게스트 만들기');
  await p.fill('#title input.text', '둘째');
  await p.click('text=전사(으)로 시작');
  await p.waitForSelector('text=모험 시작', { timeout: 20000 });
  const sep = await p.evaluate(() => __asteria.game.state.attendance.count);
  ok('second profile has its own save', sep === 0, { attendance: sep });
  await p.click('text=모험 시작');
  await p.waitForTimeout(600);
  const menu = await p.$('[data-screen="attendance"]');
  if (menu) await p.click('text=오늘 보상 받기').catch(() => {});
  await p.waitForTimeout(400);
  await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((m) => m.remove()); document.getElementById('app').inert = false; __asteria.app.setTab('menu'); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: out + 'menu_tiles_390.png' });
  ok('no page errors', errs.length === 0, { errs });
  require('fs').writeFileSync(out + '../login_results.json', JSON.stringify(results, null, 1));
  await b.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})();
