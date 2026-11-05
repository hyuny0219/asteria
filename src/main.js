// Boot: title/loading (S20) → lock → saver → load (recovery if corrupt) → loop.
import { Game } from './core/game.js';
import { REGION_BY_ID } from './data/content.js';
import { createSaver, WriterLock } from './platform/save.js';
import { MemorySaver } from './platform/memorySaver.js';
import { loadMeta, preloadFor } from './render/assets.js';
import { App } from './ui/app.js';
import { button, h } from './ui/dom.js';
import { enableAudio } from './platform/audio.js';
import * as Screens from './ui/screens.js';

const title = document.getElementById('title');
const bar = title.querySelector('.bar i');
const msg = title.querySelector('.msg');
const btns = title.querySelector('.btns');
const setProgress = (p, text) => { bar.style.width = Math.round(p * 100) + '%'; if (text) msg.textContent = text; };
const showButtons = (list) => { btns.replaceChildren(...list); const f = btns.querySelector('button'); if (f) f.focus(); };

let game, app, lock, saver, saverWarning;

async function boot() {
  try {
    setProgress(0.1, '데이터를 불러오는 중…');
    await loadMeta();
    setProgress(0.25, '저장 권한 확인 중…');
    lock = new WriterLock();
    const got = await lock.acquire();
    if (!got) return conflictAtBoot();
    lock.onLost = () => game && game.setMode('CONFLICT');
    await start();
  } catch (e) {
    console.error(e);
    msg.textContent = '시작하지 못했습니다: ' + (e.message || e);
    showButtons([button('다시 시도', { cls: 'btn btn-primary', onClick: () => location.reload() })]);
  }
}

function conflictAtBoot() {
  msg.textContent = '아스테리아가 다른 탭에서 이미 실행 중입니다. 중복 저장을 막기 위해 이 탭은 대기합니다.';
  title.dataset.screen = 'conflict';
  showButtons([button('이 탭에서 계속', { cls: 'btn btn-primary', onClick: async () => { await lock.acquire({ steal: true }); lock.onLost = () => game && game.setMode('CONFLICT'); title.dataset.screen = 'title'; await start(); } })]);
}

async function start() {
  setProgress(0.4, '저장 데이터 확인 중…');
  const c = await createSaver();
  saver = c.saver || new MemorySaver();
  saverWarning = c.warning;
  game = new Game({ saver, log: (...a) => console.warn(...a) });
  globalThis.__asteria = { game, saver, screens: Screens, get app() { return app; } };   // QA hook (dev tools / browser tests)
  const res = await game.load();
  if (res.status === 'corrupt' || res.status === 'error') return recovery(res);
  await afterLoad(res);
}

function recovery(res) {
  title.dataset.screen = 'title';
  msg.textContent = res.status === 'error' ? `저장소를 읽지 못했습니다 (${res.error}).` : `현재 저장이 손상되었습니다 (${res.error}).`;
  const list = [];
  if (res.previous) {
    list.push(button(`이전 정상본으로 복구 (Lv ${res.previous.player.level} · ${new Date(res.previous.savedAt).toLocaleString('ko-KR')})`, { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = await saver.restorePrevious();
      if (!r.ok) { msg.textContent = '복구 실패: ' + r.error; return; }
      const st = await game.start(r.state);
      await afterLoad(st);
    } }));
  }
  list.push(button('새로 시작 (손상된 저장 삭제)', { cls: 'btn btn-danger', onClick: async () => {
    if (!confirm('손상된 저장을 지우고 새로 시작할까요? 되돌릴 수 없습니다.')) return;
    await saver.wipe();
    const st = await game.start(null);
    await afterLoad(st);
  } }));
  showButtons(list);
}

async function afterLoad() {
  setProgress(0.7, '지역 그림을 불러오는 중…');
  const s = game.state;
  await preloadFor({ region: REGION_BY_ID[s.progression.region], boss: null, branch: s.player.branch });
  setProgress(1, '준비 완료');
  app = new App({ game, saver, lock, root: document.getElementById('app'), saverWarning });
  app.onTakeover = takeover;
  app.build();
  app.renderSaveStatus(game.saveStatus);
  if (s.settings.sound) document.addEventListener('pointerdown', () => enableAudio(s.settings.volume), { once: true });
  // first screen: start button so audio/gestures are user-initiated and title is visible once
  showButtons([button(game.loadInfo && game.loadInfo.status === 'empty' ? '모험 시작' : '이어하기', { cls: 'btn btn-primary', onClick: () => enter() })]);
  msg.textContent = saverWarning || (game.loadInfo.status === 'empty' ? '세린의 서약이 시작됩니다.' : `Lv ${s.player.level} · ${REGION_BY_ID[s.progression.region].name}`);
  if (new URLSearchParams(location.search).has('autostart')) enter();
}

function enter() {
  title.hidden = true;
  title.setAttribute('aria-hidden', 'true');
  document.getElementById('app').hidden = false;
  app.renderer.resize();
  for (const n of game.notices || []) {
    if (n.type === 'dungeonRefund') import('./ui/dom.js').then((d) => d.toast(`중단된 채석장 ${n.stage}단계 도전의 입장권 1장을 돌려드렸습니다.`, 'info', 4000));
    if (n.type === 'clockRollback') import('./ui/dom.js').then((d) => d.toast('기기 시계가 과거로 바뀌어 입장권 충전을 건너뛰었습니다.', 'error', 4000));
  }
  if (game.mode === 'OFFLINE') app.onMode('OFFLINE');
  if (game.mode === 'CONFLICT') app.onMode('CONFLICT');
  loop();
}

let last = 0, raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  last = performance.now();
  const frame = (now) => {
    const dt = Math.min(250, now - last);   // cap: a long frame never replays more than 250 ms
    last = now;
    if (!document.hidden) game.advance(dt);
    app.frame(game.alpha);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

async function takeover() {
  await lock.acquire({ steal: true });
  lock.onLost = () => game && game.setMode('CONFLICT');
  location.reload();   // reload the newest saved state from the store
}

document.addEventListener('visibilitychange', () => {
  if (!game || !game.state) return;
  if (document.hidden) game.onHidden();
  else { last = performance.now(); game.onVisible(); }
});
window.addEventListener('pagehide', () => { if (game && game.state) game.onHidden(); });

boot();
