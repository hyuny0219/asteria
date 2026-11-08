// 10-보스(심연의 군주 · 주간 레이드) 칸: 레이드로 안내하고, 레이드 한 번이면 클리어로 표시되는지 확인.
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto((process.env.QA_URL || 'http://localhost:' + (process.argv[2] || 8123) + '/') + '?autostart&nodaily');
await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 });
await p.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
await p.evaluate(async () => { const g = __asteria.game; const { REGIONS } = await import('./src/data/content.js'); for (let i=0;i<40;i++){ const r = await g.transact('qa',(s)=>{ s.player.level=100; s.progression.unlockedRegions=REGIONS.map(r=>r.id); for (const r of REGIONS) { s.progression.maxWave[r.id]=10; s.stages.stars[r.id+'-10']=1; if (r.id!=='void') s.progression.bossCleared[r.boss]=true; } s.progression.region='void'; s.progression.wave=10; return {ok:true}; }); if (r.ok) break; await new Promise(r=>setTimeout(r,60)); } });
await p.evaluate(() => __asteria.app.setTab('stage')); await p.waitForTimeout(700);
await p.click('.stage-tabs [data-region="void"]'); await p.waitForTimeout(300);
await p.click('.stage-node[data-node="boss"]'); await p.waitForTimeout(300);
const before = await p.evaluate(() => ({ status: document.querySelector('.stage-node[data-node="boss"]').dataset.status, btn: document.querySelector('.stage-detail [data-act="stage-go"]').textContent, disabled: document.querySelector('.stage-detail [data-act="stage-go"]').disabled }));
await p.screenshot({ path: process.env.SHOT || 'docs/qa/screens/raid_node_390x844.png' });
await p.click('.stage-detail [data-act="stage-go"]'); await p.waitForTimeout(500);
const routed = await p.evaluate(() => ({ tab: __asteria.app.tab, adv: __asteria.app.advTab, raidCard: !!document.querySelector('[data-screen="raid"]') }));
const st = await p.evaluate(async () => { const g = __asteria.game; const ST = await import('./src/core/stages.js'); await g.transact('qa2', (s) => ST.recordRaidClear(s, 'B')); return g.state.stages.stars['void-boss']; });
await p.evaluate(() => __asteria.app.setTab('stage')); await p.waitForTimeout(700);
const after = await p.evaluate(() => document.querySelector('.stage-node[data-node="boss"]').dataset.status);
console.log(JSON.stringify({ before, routed, stars: st, after, errs }));
await b.close(); })();
