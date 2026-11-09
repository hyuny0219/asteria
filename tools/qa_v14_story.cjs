const { chromium } = require('playwright');
const out = process.argv[2] || 'docs/qa/screens';
(async () => { const b = await chromium.launch(); const errs = [];
const page = async (q) => { const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); p.on('pageerror', (e) => errs.push(e.message)); await p.goto('' + (process.env.QA_URL || 'http://localhost:8431/') + '?autostart' + q); await p.waitForFunction(() => globalThis.__asteria?.app?.el && __asteria.game.mode === 'FARM', null, { timeout: 20000 }); return p; };
const clear = (p) => p.evaluate(async () => { const d = await import('/src/ui/dom.js'); d.closeAllModals(); document.querySelectorAll('.modal-overlay').forEach((o) => o.remove()); document.getElementById('app').inert = false; });
const res = {};
// 1) region intro: fresh save, close daily popups, wait for the intro
let p = await page('');
for (let i = 0; i < 12; i++) { await p.waitForTimeout(700); const ids = await p.evaluate(() => [...document.querySelectorAll('.modal-overlay')].map((o) => o.dataset.screen)); if (ids.includes('storyIntro')) break; if (ids.length) await clear(p); }
await p.waitForTimeout(900);
res.intro = await p.evaluate(() => document.querySelector('[data-screen="storyIntro"]')?.innerText || null);
await p.screenshot({ path: out + '/v14_intro_390x844.png' });
await p.click('[data-screen="storyIntro"] .btn-primary').catch(() => {});
await p.waitForTimeout(600);
res.introSeen = await p.evaluate(() => !!__asteria.game.state.story.seen['r:meadow']);
await p.close();
// 2) legendary reveal in the boss victory modal (real items from a saved state)
p = await page('&nodaily'); await clear(p);
await p.evaluate(async () => { const { makeItem } = await import('/src/core/items.js'); const { makeRng } = await import('/src/core/util.js'); const g = __asteria.game; let items;
  for (let i = 0; i < 40; i++) { const r = await g.transact('qa', (s) => { const rng = makeRng(9); items = [makeItem(s, { slot: 'weapon', rarity: 'legendary', level: 50, rng }), makeItem(s, { slot: 'ring', rarity: 'epic', level: 50, rng })]; s.inventory.push(...items); return { ok: true }; }); if (r.ok) break; await new Promise((r) => setTimeout(r, 60)); }
  const S = await import('/src/ui/screens.js'); S.openResult(__asteria.app, { kind: 'boss', win: true, first: true, bossId: 'B05', diff: 'easy', timeSec: 61, gold: 5200, exp: 9100, ore: 150, gem: 100, items, lore: (await import('/src/data/story.js')).REGION_STORY.glacier.boss }); });
await p.waitForTimeout(250); await p.screenshot({ path: out + '/v14_reveal_dim_390x844.png' });
await p.waitForTimeout(1500); await p.screenshot({ path: out + '/v14_reveal_390x844.png' });
res.flip = await p.evaluate(() => document.querySelectorAll('.reward.flip.r-legendary').length);
await clear(p);
// 3) farm pillar (after a real save, via the same event the game emits)
await p.evaluate(() => __asteria.game.emit('lootSaved', { items: [{ rarity: 'legendary', name: '시험용 전설 검' }], x: 250 }));
await p.waitForTimeout(350);
await p.screenshot({ path: out + '/v14_pillar_390x844.png' });
res.toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.className + ' | ' + t.textContent));
// 4) ending cards
await p.evaluate(async () => { const m = await import('/src/ui/story.js'); m.openEnding(__asteria.app, () => {}); });
await p.waitForTimeout(700); await p.screenshot({ path: out + '/v14_ending1_390x844.png' });
await p.click('[data-act="ending-next"]'); await p.waitForTimeout(150); await p.click('[data-act="ending-next"]'); await p.waitForTimeout(700);
await p.screenshot({ path: out + '/v14_ending3_390x844.png' });
await clear(p);
// 5) journal
await p.evaluate(async () => { const ST = await import('/src/core/story.js'); const g = __asteria.game; await g.transact('qa', (s) => { for (const k of ['r:meadow', 'b:B01', 'r:desert', 'b:B02', 'r:mine']) ST.markSeen(s, k); return { ok: true }; }); const m = await import('/src/ui/story.js'); m.openJournal(__asteria.app); });
await p.waitForTimeout(500); await p.screenshot({ path: out + '/v14_journal_390x844.png' });
res.journal = await p.evaluate(() => document.querySelectorAll('.story-entry').length);
console.log(JSON.stringify({ ...res, errs }, null, 1));
await b.close(); })();
