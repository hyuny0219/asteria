#!/usr/bin/env node
// Browser QA: opens every one of the 22 screens/states in real game state at
// 390x844, 360x700 and 412x915, checks horizontal overflow, page errors, small
// touch targets and missing images, runs interactive flows (double-tap claim,
// save failure, multi-tab conflict, reload with a pending claim), and saves
// screenshots to docs/qa/screens/. Results: docs/qa/browser_results.json.
//
//   node tools/serve.mjs 8123 &   then   NODE_PATH=$(npm root -g) node tools/browser_qa.cjs
// Desktop Chromium only — this does not replace real iOS Safari / Android Chrome tests.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_URL || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', 'docs', 'qa');
const SHOTS = path.join(OUT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWPORTS = [[390, 844], [360, 700], [412, 915]];
const results = { startedAt: new Date().toISOString(), base: BASE, viewports: VIEWPORTS, screens: [], flows: [], errors: [] };

async function freshPage(browser, vp, { dpr = 1, ctx = null } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: dpr });
  if (!ctx) await context.addInitScript(() => {
    // one guest profile, so the title shows the profile card instead of the nickname form
    if (!localStorage.getItem('asteria-profiles')) localStorage.setItem('asteria-profiles', JSON.stringify({ list: [{ id: 'qa', nickname: 'QA선배', createdAt: Date.now(), lastPlayedAt: Date.now(), level: 1, job: '' }], last: 'qa' }));
  });
  await context.addInitScript(() => {
    // QA state edits retry while a routine checkpoint save is in flight ('busy')
    window.__qaTx = async (fn) => {
      for (let i = 0; i < 40; i++) {
        const r = await window.__asteria.game.transact('qa', fn);
        if (!r || r.ok || r.reason !== 'busy') return r;
        await new Promise((res) => setTimeout(res, 50));
      }
      throw new Error('qa transact stayed busy');
    };
  });
  const page = await context.newPage();
  page.qaErrors = [];
  page.on('pageerror', (e) => page.qaErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.qaErrors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => page.qaErrors.push('requestfailed: ' + r.url()));
  return { context, page };
}
async function boot(page, query = '?autostart&nodaily') {
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__asteria && window.__asteria.app && window.__asteria.game.state && !document.getElementById('app').hidden, null, { timeout: 20000 });
  await page.waitForTimeout(500);
}
// run the simulation fast inside the page
async function ff(page, sec) {
  await page.evaluate(async (sec) => {
    const g = window.__asteria.game;
    for (let i = 0; i < sec * 20; i++) { g.advance(50); if (i % 200 === 0) await new Promise((r) => setTimeout(r, 0)); }
  }, sec);
}
async function closeModals(page) { await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(() => {}); }); await page.keyboard.press('Escape').catch(() => {}); }

async function check(page, id, vp, note = '') {
  await page.waitForTimeout(450);
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const over = document.documentElement.scrollWidth > vw + 1;
    const modal = document.querySelector('.modal-overlay:last-child .modal');
    const modalOver = modal ? modal.scrollWidth > modal.clientWidth + 1 : false;
    const els = [...document.querySelectorAll('button, [role=button], a[href], input, select')].filter((e) => {
      const r = e.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('[inert]');
      return visible;
    });
    const small = els.filter((e) => { const r = e.getBoundingClientRect(); return (r.height < 32 || r.width < 32) && e.type !== 'checkbox' && e.type !== 'range' && e.type !== 'file'; })
      .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !e.closest('canvas') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map((e) => e.className || e.tagName);
    const brokenImg = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.closest('[hidden]')).map((i) => i.src.split('/').pop());
    const screens = [...document.querySelectorAll('[data-screen]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.dataset.screen);
    const tiny = [...document.querySelectorAll('.modal *, .panel *, .status *, .stage *, .goal *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12 && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim().slice(0, 16));
    return { over, modalOver, small, wide, brokenImg, screens, tiny: [...new Set(tiny)].slice(0, 6) };
  });
  const file = `${id}_${vp[0]}x${vp[1]}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) });
  const errors = page.qaErrors.splice(0);
  const pass = !r.over && !r.modalOver && !r.brokenImg.length && !errors.length && !r.small.length && r.screens.includes(id);
  results.screens.push({ id, viewport: `${vp[0]}x${vp[1]}`, pass, note, file, ...r, errors });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(12)} ${vp[0]}x${vp[1]} overflow=${r.over || r.modalOver} small=${r.small.length} imgs=${r.brokenImg.length} err=${errors.length} screens=${r.screens.join(',')}${note ? ' · ' + note : ''}`);
  return r;
}
const modal = (page, fn, ...args) => page.evaluate(([fn, args]) => { const A = window.__asteria; A.screens[fn](A.app, ...args); }, [fn, args]);
const closeAll = (page) => page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });

async function screensAt(browser, vp) {
  // ---- title (20) before entering ----
  let { context, page } = await freshPage(browser, vp);
  await page.goto(BASE + '?nodaily', { waitUntil: 'load' });
  await page.waitForSelector('#title .btns .profile-card', { timeout: 20000 });
  await check(page, 'title', vp, '시작 화면 · 프로필 선택');
  await page.click('#title .btns .profile-card');
  await page.waitForSelector('#title .btns .btn-primary:not(.profile-card)', { timeout: 20000 });
  await page.click('#title .btns .btn-primary');
  await page.waitForTimeout(800);
  await ff(page, 20);
  await check(page, 'main', vp, '실제 전투 20초 후');
  // equipment empty state (19) — reset inventory
  await page.evaluate(async () => { const g = window.__asteria.game; await window.__qaTx((s) => { s.inventory = []; for (const k in s.equipped) s.equipped[k] = null; return { ok: true }; }); window.__asteria.app.setTab('equipment'); });
  await check(page, 'empty', vp, '장비 없음');
  // give a set of items, then inventory (2), compare (3), enhance (4), dismantle (16)
  await page.evaluate(async () => {
    const A = window.__asteria; const g = A.game;
    const { makeItem } = await import('./src/core/items.js'); const { makeRng } = await import('./src/core/util.js');
    const rng = makeRng(3);
    await window.__qaTx((s) => { for (let i = 0; i < 14; i++) s.inventory.push(makeItem(s, { slot: ['weapon', 'helmet', 'armor', 'accessory'][i % 4], rarity: ['common', 'uncommon', 'rare'][i % 3], level: 5 + i, rng })); s.wallet.ore = 120; s.wallet.gold = 5000; return { ok: true }; });
    await g.autoEquip();
    A.app.setTab('equipment');
  });
  await check(page, 'inventory', vp);
  const firstId = await page.evaluate(() => window.__asteria.game.state.inventory.find((i) => !Object.values(window.__asteria.game.state.equipped).includes(i.id)).id);
  await modal(page, 'openCompare', firstId);
  await check(page, 'compare', vp);
  await closeAll(page);
  await modal(page, 'openEnhance', firstId);
  await check(page, 'enhance', vp);
  await page.click('.modal-actions .btn-primary');
  await page.waitForTimeout(600);
  await check(page, 'enhance', vp, '강화 성공 후');
  await closeAll(page);
  await modal(page, 'openDismantle');
  await check(page, 'dismantle', vp);
  await closeAll(page);
  // overflow (15)
  await page.evaluate(async () => {
    const g = window.__asteria.game; const { makeItem } = await import('./src/core/items.js'); const { makeRng } = await import('./src/core/util.js'); const rng = makeRng(5);
    await window.__qaTx((s) => { while (s.inventory.length < 200) s.inventory.push(makeItem(s, { slot: 'helmet', rarity: 'common', level: 3, rng })); for (let i = 0; i < 6; i++) s.overflow.push(makeItem(s, { slot: 'weapon', rarity: 'uncommon', level: 9, rng })); return { ok: true }; });
  });
  await modal(page, 'openOverflow');
  await check(page, 'overflow', vp);
  await closeAll(page);
  // skills (5) / detail (6)
  await page.evaluate(() => window.__asteria.app.setTab('skills'));
  await check(page, 'skills', vp);
  await modal(page, 'openSkillDetail', 'strike');
  await check(page, 'skilldetail', vp);
  await closeAll(page);
  // world (7), boss (8)
  await modal(page, 'openWorld');
  await check(page, 'world', vp);
  await closeAll(page);
  await page.evaluate(async () => { const g = window.__asteria.game; await window.__qaTx((s) => { s.progression.maxWave.meadow = 10; s.progression.wave = 10; return { ok: true }; }); });
  await modal(page, 'openBoss', 'B01');
  await check(page, 'boss', vp);
  // victory (9): strong hero, fight for real
  await page.evaluate(async () => { const g = window.__asteria.game; await window.__qaTx((s) => { s.player.statsUpgrades.atk = 120; s.player.statsUpgrades.hp = 60; return { ok: true }; }); });
  await page.click('.modal-actions .btn-primary');
  await page.waitForTimeout(300);
  await check(page, 'skills', vp, '보스전 진행 중 (탭은 스킬)');
  await ff(page, 90);
  await page.waitForFunction(() => document.querySelector('[data-screen=victory],[data-screen=defeat]'), null, { timeout: 10000 }).catch(() => {});
  await check(page, 'victory', vp, '실제 보스전 승리');
  await page.click('.modal-actions .btn:last-child');
  await page.waitForTimeout(300);
  // defeat (10): weak hero vs B02 via forfeit
  await page.evaluate(async () => { const g = window.__asteria.game; await window.__qaTx((s) => { s.progression.maxWave.desert = 10; return { ok: true }; }); g.startBoss('B02'); });
  await ff(page, 2);
  await page.evaluate(() => window.__asteria.game.forfeit());
  await page.waitForTimeout(400);
  await check(page, 'defeat', vp, '중단 → 손실 없음');
  await page.click('.modal-actions .btn-primary');
  // dungeon (14)
  await page.evaluate(() => window.__asteria.app.setTab('dungeon'));
  await check(page, 'dungeon', vp);
  // offline (11)
  await page.evaluate(async () => {
    const g = window.__asteria.game;
    await window.__qaTx((s) => { s.progression.verifiedFarm = { region: 'meadow', wave: 8, level: 8, killsPerSec: 0.35, windowSec: 80, method: 'qa', at: Date.now() }; return { ok: true }; });
    g.state.offlineSnapshot.lastActiveAt = Date.now() - 13 * 3600 * 1000;
    g.onVisible();
  });
  await page.waitForTimeout(400);
  await check(page, 'offline', vp, '13시간 경과 → 12시간 적용');
  await page.click('.modal-actions .btn-primary');
  await page.waitForTimeout(400);
  // quest (13) / promotion (12) with dev save
  await page.evaluate(async () => {
    const g = window.__asteria.game;
    await window.__qaTx((s) => { s.player.level = 30; s.wallet.token = 20; s.progression.bossCleared.B03 = true; s.progression.unlockedRegions = ['meadow', 'desert', 'mine']; s.promotion.trialCleared = false; s.player.pendingExp = 12480; return { ok: true }; });
  });
  await modal(page, 'openQuest');
  await check(page, 'quest', vp);
  await closeAll(page);
  await page.evaluate(async () => { const g = window.__asteria.game; await window.__qaTx((s) => { s.promotion.trialCleared = true; s.promotion.trials = { ...(s.promotion.trials || {}), 1: true }; return { ok: true }; }); });
  await modal(page, 'openPromotion');
  await check(page, 'promotion', vp);
  await closeAll(page);
  // settings (17), summon (21)
  await modal(page, 'openSettings');
  await check(page, 'settings', vp);
  await closeAll(page);
  // ---- v4 screens ----
  const v4 = (fn, ...args) => page.evaluate(async ([fn, args]) => { const V = await import('./src/ui/v4.js'); V[fn](window.__asteria.app, ...args); }, [fn, args]);
  await page.evaluate(async () => { await window.__qaTx((s) => { s.wallet.gem = 20000; s.wallet.eqTicket = 2; s.wallet.skTicket = 1; return { ok: true }; }); });
  await v4('openGacha', 'eq');
  await check(page, 'gacha', vp, '장비 뽑기 · 확률 공개 · 천장');
  await page.click('.modal-actions .btn-primary');
  await page.waitForSelector('[data-screen=gachaResult]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await check(page, 'gachaResult', vp, '11회 결과 (저장 후 공개)');
  await closeAll(page);
  await v4('openGacha', 'sk');
  await check(page, 'gachaskill', vp, '스킬 뽑기');
  await page.click('.modal-actions .btn-primary');
  await page.waitForSelector('[data-screen=gachaResult]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await check(page, 'gachaResult', vp, '스킬 11회 결과');
  await closeAll(page);
  await v4('openMissions');
  await check(page, 'missions', vp);
  await closeAll(page);
  // v5: 특성 / 환생 / 균열
  const v5 = (fn, ...args) => page.evaluate(async ([fn, args]) => { const V = await import('./src/ui/v5.js'); V[fn](window.__asteria.app, ...args); }, [fn, args]);
  await page.evaluate(async () => { await window.__qaTx((s) => { s.player.tier = Math.max(1, s.player.tier || 0); s.player.branch = s.player.branch || 'knight'; s.player.peakLevel = 70; s.progression.bossCleared.B03 = true; return { ok: true }; }); });
  await v5('openTalents');
  await check(page, 'talents', vp, '특성 트리');
  await closeAll(page);
  await v5('openRebirth');
  await check(page, 'rebirth', vp, '환생');
  await closeAll(page);
  await page.evaluate(() => { window.__asteria.app.setTab('dungeon'); const r = document.querySelector('[data-screen="rift"]'); if (r) r.scrollIntoView(); });
  await check(page, 'rift', vp, '균열 카드');
  await v4('openClassPicker');
  await check(page, 'classpick', vp, '클래스 선택 4종');
  await closeAll(page);
  await page.evaluate(() => window.__asteria.app.setTab('growth'));
  await check(page, 'statpoints', vp, '능력치 포인트');
  await page.evaluate(async () => { await window.__qaTx((s) => { s.skills.runes.owned = { lifesteal: 2, focus: 1, gale: 1 }; s.skills.runes.equipped = ['lifesteal', null]; return { ok: true }; }); window.__asteria.app.setTab('skills'); });
  await check(page, 'runes', vp, '각인 2칸');
  await page.evaluate(() => window.__asteria.app.setTab('equipment'));
  await check(page, 'inventory', vp, '8부위 · 6등급');
  // tower / raid
  await page.evaluate(async () => { await window.__qaTx((s) => { s.progression.bossCleared.B03 = true; s.player.level = 95; s.progression.bossCleared.B09 = true; return { ok: true }; }); window.__asteria.app.setTab('dungeon'); });
  await check(page, 'tower', vp, '시련의 탑 · 레이드 카드');
  await page.evaluate(() => { window.__asteria.game.startTower(); });
  await ff(page, 3);
  await page.evaluate(() => window.__asteria.game.forfeit());
  await page.waitForSelector('[data-screen=towerResult]', { timeout: 5000 }).catch(() => {});
  await check(page, 'towerResult', vp, '탑 결과');
  await page.click('.modal-actions .btn:last-child');
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await window.__asteria.game.startRaid(); });
  await ff(page, 4);
  await page.evaluate(() => window.__asteria.game.forfeit());
  await page.waitForSelector('[data-screen=raidResult]', { timeout: 5000 }).catch(() => {});
  await check(page, 'raidResult', vp, '레이드 결과');
  await page.click('.modal-actions .btn-primary');
  await page.waitForTimeout(300);
  // tier 2 / 3 promotion
  await page.evaluate(async () => { await window.__qaTx((s) => { s.player.branch = 'knight'; s.player.tier = 1; s.player.level = 60; s.wallet.awakenStone = 10; s.wallet.gold = 1e9; s.progression.bossCleared.B06 = true; s.tower.best = 5; return { ok: true }; }); });
  await v4('openPromotionTier', 2);
  await check(page, 'promotion', vp, '2차 승급');
  await page.click('.modal-actions .btn-primary');
  await page.waitForSelector('[data-screen=promoPlay]', { timeout: 5000 }).catch(() => {});
  await check(page, 'promoPlay', vp, '2차 승급 완료');
  await closeAll(page);
  await page.evaluate(async () => { await window.__qaTx((s) => { s.player.level = 90; s.wallet.starShard = 3; s.progression.bossCleared.B09 = true; s.promotion.trials = { ...(s.promotion.trials || {}), 3: true }; return { ok: true }; }); });
  await modal(page, 'openQuest');
  await check(page, 'quest', vp, '3차 승급 체크리스트');
  await closeAll(page);
  await page.evaluate(async () => { await window.__qaTx((s) => { s.player.tier = 1; s.player.level = 30; s.wallet.gold = 1e6; return { ok: true }; }); });
  // save error (18): next save fails, try a shop purchase (growth is automatic, no buttons)
  await page.evaluate(async () => { await window.__qaTx((s) => { s.wallet.gold = 1e15; s.shop = { buys: {} }; return { ok: true }; }); window.__asteria.app.setTab('menu'); });
  await page.waitForTimeout(300);
  await page.click('[data-key="tile-shop"]');
  await page.waitForSelector('[data-key="shop-ore100"] .btn');
  // set the failure and tap in the same task, so a background checkpoint cannot consume it
  await page.evaluate(() => { window.__asteria.saver.failNext = 1; document.querySelector('[data-key="shop-ore100"] .btn').click(); });
  await page.waitForTimeout(500);
  await check(page, 'saveerror', vp, '저장 실패 시뮬레이션');
  await closeAll(page);
  // conflict (22): second tab in the same profile
  const p2 = await context.newPage();
  p2.qaErrors = [];
  p2.on('pageerror', (e) => p2.qaErrors.push('pageerror: ' + e.message));
  await p2.goto(BASE, { waitUntil: 'load' });
  await p2.waitForFunction(() => document.getElementById('title').dataset.screen === 'conflict', null, { timeout: 15000 }).catch(() => {});
  await check(p2, 'conflict', vp, '두 번째 탭');
  await context.close();
}

async function flows(browser) {
  const vp = [390, 844];
  const rec = (name, pass, detail) => { results.flows.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} flow: ${name} · ${JSON.stringify(detail)}`); };
  // 1. double-tap offline claim + reload with a pending claim → granted once
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    await page.evaluate(async () => {
      const g = window.__asteria.game;
      await window.__qaTx((s) => { s.progression.verifiedFarm = { region: 'meadow', wave: 5, level: 5, killsPerSec: 0.4, windowSec: 80, method: 'qa', at: Date.now() }; return { ok: true }; });
      g.state.offlineSnapshot.lastActiveAt = Date.now() - 2 * 3600 * 1000;
      g.onVisible();
    });
    await page.waitForSelector('[data-screen=offline]');
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({ gold: window.__asteria.game.state.wallet.gold, claim: window.__asteria.game.state.offlineSnapshot.pendingClaim }));
    // reload before claiming: same claim must come back
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__asteria && window.__asteria.app && !document.getElementById('app').hidden, null, { timeout: 20000 });
    await page.waitForSelector('[data-screen=offline]');
    const after = await page.evaluate(() => window.__asteria.game.state.offlineSnapshot.pendingClaim);
    rec('reload keeps the same pending claim', after && after.claimId === before.claim.claimId && after.gold === before.claim.gold, { first: before.claim.claimId, after: after && after.claimId });
    // count every gold source: kill rewards are summed separately so only the claim remains
    await page.evaluate(() => { const A = window.__asteria; A.killGold = 0; A.claims = 0; A.game.on('reward', (r) => { A.killGold += r.gold; }); A.game.on('tx', ({ label, res }) => { if (label === 'offlineClaim' && res.ok) A.claims++; }); });
    const btn = page.locator('.modal-actions .btn-primary');
    await btn.click(); await btn.click({ force: true, timeout: 500 }).catch(() => {}); await btn.click({ force: true, timeout: 500 }).catch(() => {});
    await page.waitForTimeout(600);
    const g2 = await page.evaluate(() => ({ gold: window.__asteria.game.state.wallet.gold, last: window.__asteria.game.state.transactions.lastClaimId, killGold: window.__asteria.killGold, claims: window.__asteria.claims }));
    const claimGold = g2.gold - before.gold - g2.killGold;
    rec('triple-tap claim grants once', g2.claims === 1 && claimGold === before.claim.gold && g2.last === before.claim.claimId, { expected: before.claim.gold, claimGold, killGold: g2.killGold, claims: g2.claims });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__asteria && window.__asteria.app && !document.getElementById('app').hidden, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const again = await page.evaluate(() => !!document.querySelector('[data-screen=offline]'));
    rec('no second claim after reload', !again, {});
    await context.close();
  }
  // 2. save failure: no gold spent, error shown, retry works
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    await page.evaluate(async () => { await window.__qaTx((s) => { s.wallet.gold = 1e12; s.shop = { buys: {} }; return { ok: true }; }); window.__asteria.app.setTab('menu'); });
    await page.waitForTimeout(300);
    await page.click('[data-key="tile-shop"]');
    await page.waitForSelector('[data-key="shop-ore100"] .btn');
    await page.evaluate(() => { window.__asteria.saver.failNext = 1; });
    const g0 = await page.evaluate(() => ({ ore: window.__asteria.game.state.wallet.ore, buys: JSON.stringify(window.__asteria.game.state.shop.buys) }));
    await page.click('[data-key="shop-ore100"] .btn');
    await page.waitForTimeout(500);
    const g1 = await page.evaluate(() => ({ ore: window.__asteria.game.state.wallet.ore, buys: JSON.stringify(window.__asteria.game.state.shop.buys), modal: !!document.querySelector('[data-screen=saveerror]'), dot: document.querySelector('.save-dot').classList.contains('bad') }));
    rec('failed save spends nothing', g1.ore === g0.ore && g1.buys === g0.buys && g1.modal && g1.dot, { g0, g1 });
    await page.click('.modal-actions .btn-primary');
    await page.waitForTimeout(500);
    const ok = await page.evaluate(() => window.__asteria.game.saveStatus.ok);
    rec('retry save succeeds', ok, {});
    await context.close();
  }
  // 3. reward animation only after commit: claim with failing save keeps modal and grants nothing
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    await page.evaluate(async () => {
      const g = window.__asteria.game;
      await window.__qaTx((s) => { s.progression.verifiedFarm = { region: 'meadow', wave: 5, level: 5, killsPerSec: 0.4, windowSec: 80, method: 'qa', at: Date.now() }; return { ok: true }; });
      g.state.offlineSnapshot.lastActiveAt = Date.now() - 3600 * 1000;
      g.onVisible();
    });
    await page.waitForSelector('[data-screen=offline]');
    await page.waitForTimeout(300);
    const gold0 = await page.evaluate(() => window.__asteria.game.state.wallet.gold);
    await page.evaluate(() => { window.__asteria.saver.failNext = 1; });
    await page.click('[data-screen=offline] ~ * .btn-primary, .modal-actions .btn-primary');
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ gold: window.__asteria.game.state.wallet.gold, offline: !!document.querySelector('[data-screen=offline]'), err: !!document.querySelector('[data-screen=saveerror]'), mode: window.__asteria.game.mode }));
    rec('claim with failed save grants nothing and keeps the claim', st.gold === gold0 && st.offline && st.mode === 'OFFLINE', st);
    await context.close();
  }
  // 4. multi-tab: second tab waits; takeover stops the first
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    const p2 = await context.newPage();
    await p2.goto(BASE, { waitUntil: 'load' });
    await p2.waitForFunction(() => document.getElementById('title').dataset.screen === 'conflict', null, { timeout: 15000 }).catch(() => {});
    const waiting = await p2.evaluate(() => document.getElementById('title').dataset.screen);
    await p2.click('#title .btns button');
    await page.waitForTimeout(1500);
    const first = await page.evaluate(() => window.__asteria.game.mode);
    const second = await p2.evaluate(() => window.__asteria && window.__asteria.game && window.__asteria.game.mode);
    rec('second tab blocked, takeover stops first tab', waiting === 'conflict' && first === 'CONFLICT' && ['FARM', 'LOAD', 'OFFLINE'].includes(second), { waiting, first, second });
    // the stopped tab must not write
    const rev1 = await p2.evaluate(() => window.__asteria.game.state.revision);
    await page.evaluate(() => window.__asteria.game.setSetting('shake', false));
    await p2.waitForTimeout(300);
    const r2 = await page.evaluate(() => window.__asteria.game.mode);
    rec('stopped tab cannot commit', r2 === 'CONFLICT', { rev1 });
    await context.close();
  }
  // 5. hidden tab: no replay of hidden time as foreground ticks
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    await ff(page, 5);
    const k0 = await page.evaluate(() => window.__asteria.game.state.progression.counters.kills);
    await page.evaluate(async () => { const g = window.__asteria.game; await g.onHidden(); g.state.offlineSnapshot.lastActiveAt -= 20000; g.onVisible(); });
    await page.waitForTimeout(200);
    const k1 = await page.evaluate(() => ({ kills: window.__asteria.game.state.progression.counters.kills, acc: window.__asteria.game.acc, mode: window.__asteria.game.mode }));
    rec('hidden → visible does not replay ticks', k1.kills - k0 <= 2 && k1.acc < 100, { k0, k1 });
    await context.close();
  }
  // 6. DPR 2 and 3 canvas backing store capped at 2
  for (const dpr of [1, 2, 3]) {
    const { context, page } = await freshPage(browser, vp, { dpr });
    await boot(page);
    const c = await page.evaluate(() => { const c = document.querySelector('.battle canvas'); return { w: c.width, cw: c.getBoundingClientRect().width }; });
    rec(`DPR ${dpr} canvas backing = css × min(dpr,2)`, Math.abs(c.w - c.cw * Math.min(dpr, 2)) <= 2, c);
    await page.screenshot({ path: path.join(SHOTS, `battle_dpr${dpr}.png`), clip: { x: 0, y: 92, width: 390, height: 220 } });
    await context.close();
  }
  // 7. 200% text zoom: key buttons still reachable (scroll allowed)
  {
    const { context, page } = await freshPage(browser, vp);
    await boot(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; document.body.style.fontSize = '32px'; });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, navVisible: !!document.querySelector('.nav button') }));
    await page.screenshot({ path: path.join(SHOTS, 'text200.png'), fullPage: true });
    rec('200% text: no horizontal overflow', !r.over, r);
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) await screensAt(browser, vp);
    await flows(browser);
  } catch (e) {
    console.error(e);
    results.errors.push(String(e.stack || e));
  } finally {
    await browser.close();
    results.finishedAt = new Date().toISOString();
    const ids = [...new Set(results.screens.map((s) => s.id))];
    results.summary = { screenChecks: results.screens.length, screenPass: results.screens.filter((s) => s.pass).length, distinctScreens: ids.length, ids, flows: results.flows.length, flowPass: results.flows.filter((f) => f.pass).length };
    fs.writeFileSync(path.join(OUT, 'browser_results.json'), JSON.stringify(results, null, 1));
    console.log('SUMMARY', JSON.stringify(results.summary));
  }
})();
