// Boot: title/loading (S20) → lock → saver → load (recovery if corrupt) → loop.
import { Game } from './core/game.js';
import { REGION_BY_ID } from './data/content.js';
import { createSaver, WriterLock } from './platform/save.js';
import * as Profiles from './platform/profiles.js';
import * as FS from './ui/fullscreen.js';
import { CLASSES, CLASS_IDS, CLASS_SKILLS, SKILLS } from './data/content.js';
import { classArt, needsClassPick } from './ui/v4.js';
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

let game, app, lock, saver, saverWarning, profileId;

async function boot() {
  try {
    setProgress(0.1, '데이터를 불러오는 중…');
    await loadMeta();
    setProgress(0.25, '저장 권한 확인 중…');
    lock = new WriterLock();
    const got = await lock.acquire();
    if (!got) return conflictAtBoot();
    lock.onLost = () => game && game.setMode('CONFLICT');
    await pickProfile();
  } catch (e) {
    console.error(e);
    msg.textContent = '시작하지 못했습니다: ' + (e.message || e);
    showButtons([button('다시 시도', { cls: 'btn btn-primary', onClick: () => location.reload() })]);
  }
}

function conflictAtBoot() {
  msg.textContent = '아스테리아가 다른 탭에서 이미 실행 중입니다. 중복 저장을 막기 위해 이 탭은 대기합니다.';
  title.dataset.screen = 'conflict';
  showButtons([button('이 탭에서 계속', { cls: 'btn btn-primary', onClick: async () => { await lock.acquire({ steal: true }); lock.onLost = () => game && game.setMode('CONFLICT'); title.dataset.screen = 'title'; const lp = Profiles.last(); if (lp) await start(lp.id); else await pickProfile(); } })]);
}

// ---------- guest login ----------
async function pickProfile() {
  setProgress(0.35, '');
  // saves made before profiles existed become the first profile
  if (!Profiles.list().length) {
    const legacy = await createSaver('default');
    if (legacy.saver && legacy.saver.exists && await legacy.saver.exists()) Profiles.create('모험가', { id: 'default' });
  }
  const qs = new URLSearchParams(location.search);
  const list = Profiles.list();
  if (qs.has('autostart')) {
    const p = Profiles.last() || list[0] || Profiles.create('QA' + Math.floor(Math.random() * 9000 + 1000)).profile;
    return start(p.id);
  }
  btns.dataset.screen = 'login';
  title.querySelector('.bar').hidden = true;
  if (!list.length) return newProfileForm(true);
  msg.textContent = '프로필을 골라 주세요';
  const lastP = Profiles.last();
  const cards = list.map((p) => {
    const b = button('', { cls: 'btn profile-card' + (lastP && lastP.id === p.id ? ' btn-primary' : ''), onClick: () => start(p.id) });
    b.replaceChildren(h('b', null, p.nickname), h('span', null, `Lv ${p.level || 1}${p.job ? ' · ' + p.job : ''} · ${relTime(p.lastPlayedAt)}`));
    b.setAttribute('aria-label', `${p.nickname} Lv ${p.level || 1}로 시작`);
    return b;
  });
  const add = list.length < Profiles.MAX_PROFILES ? button('+ 새 게스트 만들기', { cls: 'btn', onClick: () => newProfileForm(false) }) : null;
  showButtons([...cards, add, h('p', { class: 'muted' }, '게스트 프로필은 이 기기 브라우저에만 저장돼요. 다른 기기로 옮기려면 환경 설정의 내보내기를 써 주세요.')].filter(Boolean));
}

function relTime(t) {
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

function newProfileForm(first) {
  msg.textContent = first ? '모험가 이름을 정해 주세요' : '새 게스트 프로필';
  const input = h('input', { class: 'text', type: 'text', maxlength: '10', autocomplete: 'nickname', 'aria-label': '닉네임', placeholder: '닉네임 (2~10자)', enterkeyhint: 'done' });
  const err = h('p', { class: 'warn', 'aria-live': 'polite' });
  // class is picked here, together with the nickname (applied right after the save loads)
  let pick = 'warrior';
  const info = h('p', { class: 'muted class-info', 'aria-live': 'polite' });
  const cards = h('div', { class: 'class-cards', role: 'radiogroup', 'aria-label': '클래스 선택' });
  const go = button('', { cls: 'btn btn-primary', onClick: () => {
    const r = Profiles.create(input.value, { cls: pick });
    if (!r.ok) { err.textContent = r.reason; input.focus(); return; }
    start(r.profile.id);
  } });
  const renderCards = () => {
    cards.replaceChildren(...CLASS_IDS.map((id) => {
      const k = CLASSES[id];
      return h('button', { type: 'button', class: 'class-card' + (pick === id ? ' pick' : ''), role: 'radio', 'aria-checked': String(pick === id), 'aria-label': `${k.name} ${k.hero}`, onClick: () => { pick = id; renderCards(); } },
        h('span', { class: 'art' }, classArt(id), k.artPending ? h('span', { class: 'pending-tag' }, '준비 중') : null), h('b', null, k.name), h('span', { class: 'muted' }, `${k.hero} · ${k.age}세`));
    }));
    const k = CLASSES[pick];
    const cs = CLASS_SKILLS[pick];
    info.textContent = `${k.role} · ${k.range === 'ranged' ? '원거리' : '근접'} · 스킬 ${cs.base.map((x) => SKILLS[x].name).join('·')} · 궁극기 ${SKILLS[cs.ult].name}`;
    go.textContent = `${k.name}(으)로 시작`;
  };
  renderCards();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  input.addEventListener('input', () => { err.textContent = ''; });
  const back = first ? null : button('뒤로', { cls: 'btn', onClick: () => pickProfile() });
  showButtons([input, err, h('p', { class: 'section-title', style: { margin: '4px 0 0' } }, '클래스 (나중에 1회 무료로 바꿀 수 있어요)'), cards, info, go, back, h('p', { class: 'muted' }, '서버 계정이 아닌 이 기기 전용 게스트예요. 브라우저 데이터를 지우면 함께 지워집니다.')].filter(Boolean));
  input.focus();
}

async function start(pid) {
  profileId = pid;
  Profiles.setLast(pid);
  showButtons([]);
  delete btns.dataset.screen;
  title.querySelector('.bar').hidden = false;
  setProgress(0.4, '저장 데이터 확인 중…');
  const c = await createSaver(pid);
  saver = c.saver || new MemorySaver();
  saverWarning = c.warning;
  game = new Game({ saver, log: (...a) => console.warn(...a) });
  globalThis.__asteria = { game, saver, screens: Screens, profiles: Profiles, get profileId() { return profileId; }, get app() { return app; } };   // QA hook (dev tools / browser tests)
  const res = await game.load();
  // keep the profile card (level, job) fresh
  game.on('saveStatus', (st) => { if (st.ok && game.state) Profiles.touch(pid, { level: game.state.player.level, job: game.state.player.branch ? (game.state.player.branch === 'knight' ? '흑장미 기사' : '진홍의 집행자') : '' }); });
  if (game.state && !game.state.profile.nickname) { const p = Profiles.get(pid); if (p) await game.setNickname(p.nickname); }
  // class chosen on the profile form → apply once to the fresh save
  { const p = Profiles.get(pid); if (game.state && p && p.cls && needsClassPick(game.state)) await game.chooseClass(p.cls); }
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
  await preloadFor({ region: REGION_BY_ID[s.progression.region], boss: null, branch: s.player.branch, cls: s.player.cls, tier: s.player.tier || 0 });
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
  // the start tap is a user gesture, so the browser allows fullscreen here
  if (FS.autoPref() && FS.mode() === 'api' && !new URLSearchParams(location.search).has('autostart')) FS.enter();
  title.hidden = true;
  title.setAttribute('aria-hidden', 'true');
  document.getElementById('app').hidden = false;
  app.renderer.resize();
  for (const n of game.notices || []) {
    if (n.type === 'dungeonRefund') import('./ui/dom.js').then((d) => d.toast(`중단된 채석장 ${n.stage}단계 도전의 입장권 1장을 돌려드렸습니다.`, 'info', 4000));
    if (n.type === 'mplusRefund') import('./ui/dom.js').then((d) => d.toast(`중단된 쐐기 던전(+${n.key})은 실패로 처리했어요. 열쇠 +${n.newKey}${n.ore ? ` · 광석 ${n.ore}` : ''}`, 'info', 4500));
    if (n.type === 'clockRollback') import('./ui/dom.js').then((d) => d.toast('기기 시계가 마지막 접속보다 과거예요. 실제 시간이 따라잡을 때까지 일일 충전·초기화가 멈춥니다.', 'error', 5000));
  }
  if (game.mode === 'OFFLINE') app.onMode('OFFLINE');
  else app.showDailyPopups();
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

// keep deployed files fresh (see sw.js); https only, so local QA servers are unaffected
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
