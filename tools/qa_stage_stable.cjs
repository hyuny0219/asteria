// 스테이지 탭: 처치마다 지도를 다시 그리지 않고, 스테이지를 깨서 다시 그려도 고른 지역·칸이 유지되는지 확인.
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto((process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8123) + '/') + '?autostart&nodaily');
await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
await p.evaluate(async () => { const g = __asteria.game; for (let i=0;i<40;i++){ const r = await g.transact('qa',(s)=>{ s.player.level=40; s.progression.unlockedRegions=['meadow','desert','mine','forest']; for (const r of ['meadow','desert','mine']) s.progression.maxWave[r]=10; s.progression.bossCleared.B01=true; s.progression.bossCleared.B02=true; s.progression.bossCleared.B03=true; s.progression.region='meadow'; s.progression.wave=1; return {ok:true}; }); if (r.ok) break; await new Promise(r=>setTimeout(r,60)); } g.startFarm && g.startFarm(); });
await p.evaluate(() => __asteria.app.setTab('stage')); await p.waitForTimeout(600);
await p.click('.stage-tabs [data-region="desert"]'); await p.waitForTimeout(300);
await p.click('.stage-node[data-node="7"]'); await p.waitForTimeout(300);
const mark = await p.evaluate(() => { const m = document.querySelector('.stage-map'); m.dataset.qaMark = '1'; return { left: document.querySelector('.stage-tabs').scrollLeft }; });
const k0 = await p.evaluate(() => __asteria.game.state.stats ? JSON.stringify(__asteria.game.state.progression.waveKills) : __asteria.game.state.progression.waveKills);
await p.waitForTimeout(22000);
const after = await p.evaluate(() => ({ same: !!document.querySelector('.stage-map[data-qa-mark="1"]'), region: document.querySelector('.stage-tabs [aria-selected="true"]').dataset.region, sel: document.querySelector('.stage-detail b') && document.querySelector('.stage-detail b').textContent, kills: __asteria.game.state.progression.waveKills, wave: __asteria.game.state.progression.wave, left: document.querySelector('.stage-tabs').scrollLeft }));
console.log(JSON.stringify({ k0, mark, after, errs }));
await b.close(); })();
