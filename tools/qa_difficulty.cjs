// 난이도 (이지 · 노말 · 하드): 잠김 안내, 10-보스(심연의 군주) 처치로 노말 열림, 전환 시 위치 분리,
// 노말 첫 클리어 보상 1회, 상단 표기 "노말 1-x", 하드 잠김 → 열림. 390×844 캡처.
const { chromium } = require('playwright');
const out = (process.env.SHOTS || 'docs/qa/screens') + '/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const R = [];
  const check = (name, ok, info) => { R.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info ? JSON.stringify(info) : ''}`); };
  await p.goto((process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8123) + '/') + '?autostart&nodaily');
  await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
  await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
  const tx = (fn) => p.evaluate(async (src) => { const g = __asteria.game; const f = new Function('s', 'DF', 'REGIONS', src); const DF = await import('./src/core/difficulty.js'); const { REGIONS: ALL } = await import('./src/data/content.js'); const REGIONS = ALL.filter((r) => r.act !== 2);
    for (let i = 0; i < 60; i++) { const r = await g.transact('qa', (s) => { f(s, DF, REGIONS); return { ok: true }; }); if (r.ok) return true; await new Promise((x) => setTimeout(x, 60)); } return false; }, fn);
  // Lv 100, 이지 all regions open, 9 bosses down, 심연 10 reached (10-보스 not yet)
  await tx(`s.player.level = 100; s.player.statsUpgrades.atk = 20000; s.player.statsUpgrades.hp = 14000; s.progression.unlockedRegions = REGIONS.map((r) => r.id);
    for (const r of REGIONS) { s.progression.maxWave[r.id] = 10; s.stages.stars[r.id + '-10'] = 1; s.stages.claimed[r.id + '-10'] = true; if (r.boss !== 'B10') s.progression.bossCleared[r.boss] = true; }
    s.progression.region = 'void'; s.progression.wave = 7; s.progression.firsts.firstEquip = true;`);
  await p.evaluate(() => { __asteria.game.startFarm(); __asteria.app.setTab('stage'); }); await p.waitForTimeout(700);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.diff-chip')].map((c) => ({ d: c.dataset.diff, on: c.getAttribute('aria-pressed'), locked: c.classList.contains('locked'), t: c.textContent })));
  check('chips: 이지 on, 노말·하드 locked', chips.length === 3 && chips[0].on === 'true' && chips[1].locked && chips[2].locked, chips);
  await p.click('.diff-chip[data-diff="normal"]'); await p.waitForTimeout(300);
  const t1 = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '));
  check('locked 노말 explains the condition', /심연의 군주 처치 시 열림/.test(t1), t1);
  check('still 이지', await p.evaluate(() => __asteria.game.state.diff.cur === 'easy'));
  // 10-보스 node is a plain boss fight now (not the raid)
  await p.click('.stage-tabs [data-region="void"]'); await p.waitForTimeout(250);
  await p.click('.stage-node[data-node="boss"]'); await p.waitForTimeout(250);
  const bossBtn = await p.evaluate(() => document.querySelector('.stage-detail [data-act="stage-go"]').textContent);
  check('10-보스 button = 보스 도전', bossBtn === '보스 도전', bossBtn);
  await p.click('.stage-detail [data-act="stage-go"]'); await p.waitForTimeout(400);
  const bm = await p.evaluate(() => ({ open: !!document.querySelector('[data-screen="boss"]'), txt: document.querySelector('[data-screen="boss"]')?.textContent || '' }));
  check('boss modal opens with 노말 개방 hint', bm.open && /노말 난이도 개방/.test(bm.txt), bm.txt.slice(0, 160));
  await p.screenshot({ path: out + 'diff_bossmodal_390x844.png' });
  await p.evaluate(() => { const b = [...document.querySelectorAll('.modal .btn-primary')].find((x) => /도전/.test(x.textContent)); b.click(); });
  await p.waitForFunction(() => __asteria.game.mode === 'BOSS', null, { timeout: 5000 });
  const raidTries0 = await p.evaluate(() => __asteria.game.state.raid.tries);
  await p.evaluate(() => { __asteria.game.state.settings.speed = 4; });
  await p.waitForFunction(() => __asteria.game.mode === 'RESULT', null, { timeout: 120000 });
  await p.waitForTimeout(500);
  // v14: 이지 심연의 군주 첫 처치는 엔딩 카드(3–4장)를 넘긴 뒤 결과 창
  const endCards = await p.evaluate(() => document.querySelectorAll('.modal [data-screen="ending"]').length);
  check('B10 first clear shows the ending first', endCards === 1, { endCards });
  for (let k = 0; k < 6 && await p.$('[data-act="ending-next"]'); k++) { await p.click('[data-act="ending-next"]'); await p.waitForTimeout(250); }
  const vic = await p.evaluate(() => ({ win: __asteria.game.result.win, du: __asteria.game.result.diffUnlocked, title: document.querySelector('.modal h2, .modal-title')?.textContent, btn: !!document.querySelector('[data-act="diff-start"]'), raid: __asteria.game.state.raid.tries, b10: __asteria.game.state.progression.bossCleared.B10 }));
  check('B10 stage boss win opens 노말 (raid tries untouched)', vic.win && vic.du === 'normal' && vic.btn && vic.raid === raidTries0 && vic.b10, vic);
  await p.screenshot({ path: out + 'diff_unlock_390x844.png' });
  await p.click('[data-act="diff-start"]');
  await p.waitForFunction(() => __asteria.game.state.diff.cur === 'normal' && __asteria.game.mode === 'FARM', null, { timeout: 8000 });
  await p.waitForTimeout(400);
  const pos = await p.evaluate(() => ({ r: __asteria.game.state.progression.region, w: __asteria.game.state.progression.wave, easy: __asteria.game.state.diff.easyPos, lv: __asteria.game.farm.cfg.farm.levelFn(), mul: __asteria.game.farm.cfg.farm.mulFn() }));
  check('노말 starts at 1-1, 이지 position parked', pos.r === 'meadow' && pos.w === 1 && pos.easy && pos.easy.region === 'void' && pos.lv === 100 && pos.mul.hp >= 1, pos);
  await p.evaluate(() => __asteria.app.setTab('battle')); await p.waitForTimeout(500);
  const top = await p.evaluate(() => [...document.querySelectorAll('.mini-txt, [data-role="mini-txt"], .strip-txt')].map((x) => x.textContent).join(' | ') || document.body.innerText.match(/노말 1-\d+/)?.[0]);
  check('battle strip shows 노말 1-x', /노말 1-\d/.test(top || ''), top);
  await p.screenshot({ path: out + 'diff_battle_normal_390x844.png' });
  // stage map on 노말: own progress, locked 2지역, 강화 배율
  await p.evaluate(() => __asteria.app.setTab('stage')); await p.waitForTimeout(600);
  const map = await p.evaluate(() => ({ diff: document.querySelector('.stage-wrap').dataset.diff, desert: document.querySelector('.stage-tabs [data-region="desert"]').classList.contains('locked'), note: document.querySelector('.diff-note')?.textContent, mul: document.querySelector('.stage-detail')?.textContent.includes('강화 배율') }));
  check('노말 map: own track (2지역 locked), multipliers shown', map.diff === 'normal' && map.desert && /노말/.test(map.note || '') && map.mul, map);
  await p.screenshot({ path: out + 'diff_stage_normal_390x844.png' });
  // first clear reward on 노말 once (stage 1)
  const g0 = await p.evaluate(() => __asteria.game.state.wallet.gem);
  await p.waitForFunction(() => (__asteria.game.state.diff.tracks.normal.claimed['meadow-1']), null, { timeout: 60000 });
  await p.waitForTimeout(300);
  const g1 = await p.evaluate(async () => { const ST = await import('./src/core/stages.js'); return { gem: __asteria.game.state.wallet.gem, rw: ST.stageReward('meadow', 1, 'normal').gem, easyStars: __asteria.game.state.stages.stars['meadow-1'] }; });
  check('노말 1-1 first clear paid ×2 once', g1.gem - g0 >= g1.rw && g1.rw === 4 * 2 || g1.gem - g0 >= g1.rw, { ...g1, g0 });
  const before = await p.evaluate(() => __asteria.game.state.wallet.gem);
  const again = await p.evaluate(async () => { const ST = await import('./src/core/stages.js'); const g = __asteria.game; return g.transact('qa', (s) => ST.recordClear(s, 'meadow', 1, { deaths: 0, timeSec: 999 }, 'normal')); });
  const after = await p.evaluate(() => __asteria.game.state.wallet.gem);
  check('no second 노말 first-clear payment', !again.first && after === before, { again: again.first, before, after });
  // back to 이지: position restored, 이지 records intact
  await p.click('.diff-chip[data-diff="easy"]');
  await p.waitForFunction(() => __asteria.game.state.diff.cur === 'easy', null, { timeout: 5000 }); await p.waitForTimeout(500);
  const back = await p.evaluate(() => ({ r: __asteria.game.state.progression.region, w: __asteria.game.state.progression.wave, b: Object.keys(__asteria.game.state.progression.bossCleared).length, lv: __asteria.game.farm.cfg.farm.levelFn(), mul: __asteria.game.farm.cfg.farm.mulFn() }));
  check('back to 이지 at 심연 10-7, 10 bosses kept, no scaling', back.r === 'void' && back.w === 7 && back.b === 10 && back.mul === null && back.lv < 100, back);
  // 하드 still locked until 노말's last boss
  const hard = await p.evaluate(() => document.querySelector('.diff-chip[data-diff="hard"]').classList.contains('locked'));
  check('하드 locked', hard);
  await tx(`DF.track(s, 'normal').bossCleared.B10 = true;`);
  await p.evaluate(() => __asteria.app.renderPanel && __asteria.app.renderPanel()); await p.waitForTimeout(600);
  const hard2 = await p.evaluate(() => !document.querySelector('.diff-chip[data-diff="hard"]').classList.contains('locked'));
  check('하드 opens after 노말 심연의 군주', hard2);
  await p.click('.diff-chip[data-diff="hard"]');
  await p.waitForFunction(() => __asteria.game.state.diff.cur === 'hard', null, { timeout: 5000 }); await p.waitForTimeout(600);
  await p.screenshot({ path: out + 'diff_stage_hard_390x844.png' });
  const hd = await p.evaluate(() => ({ r: __asteria.game.state.progression.region, w: __asteria.game.state.progression.wave, chip: getComputedStyle(document.querySelector('.diff-chip[data-diff="hard"]')).backgroundImage }));
  check('하드 1-1 with red chip', hd.r === 'meadow' && hd.w === 1 && /gradient/.test(hd.chip), hd);
  // save survives reload
  await p.evaluate(() => __asteria.game.save && __asteria.game.save());
  await p.reload(); await p.waitForFunction(() => globalThis.__asteria?.game?.state, null, { timeout: 20000 });
  const rl = await p.evaluate(() => __asteria.game.state.diff.cur);
  check('difficulty persists after reload', rl === 'hard', rl);
  check('no page errors', errs.length === 0, errs);
  console.log('SUMMARY', R.filter((x) => x.ok).length, '/', R.length);
  await b.close();
})();
