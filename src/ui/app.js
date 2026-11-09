// App shell: layout (spec 08 table), per-frame updates, and mode → screen routing.
import { BALANCE, expToNext } from '../data/balance.js';
import { BOSSES, CLASSES, CURRENCY_ICONS, RARITY, REGION_BY_ID, SKILLS } from '../data/content.js';
import { BattleRenderer } from '../render/battle.js';
import { itemIcon, portrait, classPortrait, preloadFor, skillIcon } from '../render/assets.js';
import * as prog from '../core/progression.js';
import { fmt } from '../core/util.js';
import { button, clear, closeAllModals, h, icon, img, initModals, initToasts, modalOpen, openModal, toast } from './dom.js';
import * as S from './screens.js';
import * as V4 from './v4.js';
import { sfx } from '../platform/audio.js';
import * as FS from './fullscreen.js';
import { titleName } from '../core/meta.js';
import { stageLabel } from '../core/stages.js';
import * as DF from '../core/difficulty.js';
import * as V5 from './v5.js';
import { BLESSINGS, CURSES } from '../core/rift.js';
import { AFFIXES, MPLUS } from '../core/mplus.js';
import * as V8 from './v8.js';
import * as MAILUI from './mail.js';

export const TABS = [
  { id: 'battle', label: '전투', icon: 'battle' },
  { id: 'stage', label: '스테이지', icon: 'map' },
  { id: 'equipment', label: '장비', icon: 'equipment' },
  { id: 'skills', label: '스킬', icon: 'skill' },
  { id: 'dungeon', label: '모험', icon: 'dungeon' },
  { id: 'menu', label: '메뉴', icon: 'menu' },
];

export class App {
  constructor({ game, saver, lock, root, saverWarning }) {
    this.game = game;
    this.saver = saver;
    this.lock = lock;
    this.root = root;
    this.saverWarning = saverWarning;
    this.tab = 'stage';
    this.mult = 1;
    this.lastHud = 0;
    this.panelDirty = true;
    this.forcedBattleView = false;
  }

  get state() { return this.game.state; }
  get settings() { return this.game.state ? this.game.state.settings : { damageNumbers: 'all', shake: true, reduceMotion: false }; }

  build() {
    const app = this.root;
    clear(app);
    this.el = {};
    const E = this.el;
    // status 52
    E.face = img(portrait('serin_face'), '', 'face');
    E.name = h('b', null, '세린');
    E.sub = h('small', null, '');
    E.lvbar = h('i', { style: { width: '0%' } });
    E.gold = h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.gold), ''), h('span', { class: 'v' }, '0'));
    E.gold.setAttribute('aria-label', '골드');
    E.ore = h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.ore), ''), h('span', { class: 'v' }, '0'));
    E.ore.setAttribute('aria-label', '강화 광석');
    E.saveDot = h('span', { class: 'save-dot', title: '저장 상태', role: 'img', 'aria-label': '저장됨' });
    E.me = h('button', { type: 'button', class: 'me', 'aria-label': '프로필', onClick: () => S.openProfile ? S.openProfile(this) : S.openSettings(this) },
      E.face, h('div', { class: 'who' }, E.name, E.sub, h('span', { class: 'lvbar', 'aria-hidden': 'true' }, E.lvbar)));
    E.fsBtn = h('button', { type: 'button', class: 'icon-btn fs-btn', 'aria-label': '전체 화면', onClick: () => this.toggleFullscreen() });
    E.mailN = h('span', { class: 'mail-n' }, '');
    E.mailBtn = h('button', { type: 'button', class: 'icon-btn mail-btn', 'aria-label': '우편함', hidden: true, onClick: () => MAILUI.openMailbox(this) }, icon('mail', 20), E.mailN);
    app.appendChild(h('header', { class: 'status' }, E.me, h('div', { class: 'wallet' }, E.gold, E.ore, E.mailBtn, E.saveDot, E.fsBtn)));
    FS.onChange(() => { this.renderFsBtn(); setTimeout(() => this.renderer && this.renderer.resize(), 120); });
    window.addEventListener('resize', () => this.renderFsBtn());
    E.banner = h('div', { class: 'notice-host' });
    app.appendChild(E.banner);
    // stage info lives on the battle as a top strip (saves a 40px row on short phones)
    E.where = h('span', { class: 'nm' }, '');
    E.prog = h('span', { class: 'pt' }, '');
    E.progBar = h('i', { style: { width: '0%' } });
    E.worldBtn = h('button', { type: 'button', class: 'where-btn', 'aria-label': '스테이지 지도', onClick: () => S.openWorld(this) },
      h('b', null, E.where, h('span', { 'aria-hidden': 'true', style: { color: 'var(--gold)' } }, '▾')), h('span', { class: 'wp' }, E.prog, h('span', { class: 'pb' }, E.progBar)));
    E.bossBtn = button('보스 도전', { cls: 'boss-chip', onClick: () => S.openBoss(this) });
    // battle 220
    E.canvas = h('canvas', { role: 'img', 'aria-label': '자동 전투 화면' });
    E.liveText = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    E.portraitLive = h('div', { class: 'live' });
    E.portraitImg = img(portrait('serin_key'), '세린 일러스트');
    E.portrait = h('div', { class: 'portrait' }, E.portraitImg, h('div', { class: 'scrim' }), E.portraitLive,
      (E.cap = h('div', { class: 'cap' }, (E.capB = h('b', null, '세린')), (E.capS = h('span', null, '흑장미의 서약')))));
    E.viewBtn = button('일러스트', { cls: 'mini-btn', ariaLabel: '보기 전환', onClick: () => this.toggleView() });
    E.speedBtn = button('×1', { cls: 'mini-btn', ariaLabel: '전투 배속', onClick: () => this.toggleSpeed() });
    E.autoBadge = h('span', { class: 'badge' }, '자동 전투');
    E.sessionBar = h('div', { class: 'session-bar' });
    E.riftChips = h('div', { class: 'rift-chips', 'aria-label': '균열 효과' });
    // immersive HUD for special fights (boss / dungeon / rift / tower / raid / trial)
    E.hudTitle = h('b', null, '');
    E.hudInfo = h('span', null, '');
    E.hudTime = h('i', { style: { width: '100%' } });
    E.hud = h('div', { class: 'imm-hud', 'data-screen': 'immersive', 'aria-live': 'off' },
      h('div', { class: 'imm-info' }, E.hudTitle, E.hudInfo, h('span', { class: 'imm-time', 'aria-hidden': 'true' }, E.hudTime)));
    E.battle = h('section', { class: 'battle', 'aria-label': '전투' }, E.canvas, E.portrait,
      h('div', { class: 'topstrip' }, h('span', { class: 'spacer' }), E.worldBtn, E.bossBtn),
      h('div', { class: 'overlay-tl' }, E.autoBadge), h('div', { class: 'overlay-tr' }, E.speedBtn, E.viewBtn), E.sessionBar, E.riftChips, E.hud, E.liveText);
    app.appendChild(E.battle);
    // skills 64
    E.skills = h('div', { class: 'skills', role: 'toolbar', 'aria-label': '스킬' });
    app.appendChild(E.skills);
    // lower: goal + panel (panel takes the rest of the screen)
    E.goal = h('button', { type: 'button', class: 'goal', onClick: () => this.goGoal() });
    E.panel = h('section', { class: 'panel', 'aria-live': 'off' });
    E.panel.addEventListener('pointerdown', () => { this.pointerDown = true; this.lastTouch = performance.now(); });
    E.panel.addEventListener('scroll', () => { this.lastTouch = performance.now(); }, { capture: true, passive: true });
    window.addEventListener('pointerup', () => { this.pointerDown = false; });
    window.addEventListener('pointercancel', () => { this.pointerDown = false; });
    // page tabs: slim live strip instead of the battle (tap → back to the battle tab)
    E.miniTxt = h('b', null, '');
    E.miniSub = h('span', { class: 'ms' }, '');
    E.miniBar = h('i', { style: { width: '0%' } });
    E.mini = h('button', { type: 'button', class: 'mini-battle', 'aria-label': '전투 화면으로', onClick: () => this.setTab('battle') },
      icon('battle', 16), h('span', { class: 'mt' }, E.miniTxt, E.miniSub), h('span', { class: 'mb', 'aria-hidden': 'true' }, E.miniBar), h('span', { class: 'go' }, '전투 ›'));
    app.insertBefore(E.mini, E.battle);
    app.appendChild(h('div', { class: 'lower' }, E.goal, E.panel));
    // nav 56
    E.nav = h('nav', { class: 'nav', 'aria-label': '주 메뉴' });
    this.navBtns = {};
    for (const t of TABS) {
      const b = h('button', { type: 'button', onClick: () => this.setTab(t.id) }, icon(t.icon, 20), h('span', null, t.label));
      this.navBtns[t.id] = b;
      E.nav.appendChild(b);
    }
    app.appendChild(E.nav);
    initModals(document.getElementById('modals'));
    initToasts(document.getElementById('toasts'));

    this.renderer = new BattleRenderer(E.canvas, { getSettings: () => this.settings, topInset: 46 });
    this.iris = document.getElementById('iris') || document.body.appendChild(h('div', { id: 'iris', 'aria-hidden': 'true' }));
    new ResizeObserver(() => this.renderer.resize()).observe(E.canvas);
    // tap the battle during an ultimate: skip the cut-in banner (the attack itself still plays)
    E.canvas.addEventListener('pointerdown', () => { if (this.renderer) this.renderer.skipCutin(); });
    this.bindGame();
    this.buildSkills();
    this.setTab('battle');
    this.applyView();
    this.applyA11y();
    this.renderFsBtn();
  }

  bindGame() {
    const g = this.game;
    g.on('combat', (ev) => {
      const cue = this.renderer ? this.renderer.onCombat(ev, g.active) : null;
      if (cue && this.state.settings.sound) sfx(cue);
      if (ev.type === 'kill' && ev.enemy && ev.enemy.boss && !ev.enemy.trial) this.announce('보스를 쓰러뜨렸습니다', true);
      if (ev.type === 'telegraph' && ev.heavy) {
        this.announce(`경고: ${ev.name}`, true);
        if (this.state.settings.sound) sfx('warn');
      }
    });
    g.on('reward', (r) => {
      this.panelDirty = true;
      // common drops only light the 장비 tab dot; uncommon+ get a short toast
      const notable = r.loot ? r.loot.items.filter((i) => i.rarity !== 'common' && i.rarity !== 'uncommon') : [];
      if (notable.length) this.announce(`${RARITY[notable[0].rarity].name} 장비 획득: ${notable[0].name}`);
      if (notable.length) toast(`장비 획득 · ${notable.map((i) => `${RARITY[i.rarity].name} ${RARITY[i.rarity].mark} ${i.name}`).join(', ')}`, 'good', 1800);
      if (r.rare) toast(`희귀 정예 처치 · 보석 +${r.rare.gem} · ${RARITY[r.rare.item.rarity].name} ${r.rare.item.name}${r.rare.first ? ' · 도감 등록' : ''}${r.rare.title ? ' · 칭호 획득!' : ''}`, 'good', 3200);
      if (r.supplyEq || r.supplySk) toast(`사냥 보급 · ${[r.supplyEq ? '장비 뽑기권 +1' : '', r.supplySk ? '스킬 뽑기권 +1' : ''].filter(Boolean).join(', ')}`, 'good', 1800);
      if (r.token) toast(`시련의 증표 +1 (${this.state.wallet.token}/${BALANCE.promotion.tokensRequired})`, 'good', 1800);
      if (r.expRes && r.expRes.toPending && !this._pendingToast) { this._pendingToast = true; toast(`Lv ${this.state.player.level}: 승급 전까지 경험치는 보관됩니다.`, 'info', 3500); }
    });
    g.on('levelUp', ({ level }) => { toast(`레벨 업! Lv ${level}`, 'good'); this.announce(`레벨 ${level} 달성`); this.panelDirty = true; this.structural = true; this.buildSkills(); });
    g.on('combat', (ev) => { if (ev.type === 'rareElite') { toast(`희귀 정예 출현! ${ev.name}`, 'good', 3200); this.announce(`희귀 정예 ${ev.name} 출현`); } if (ev.type === 'fieldBoss') toast(`${ev.name} 출현! 처치하면 보석과 상위 장비`, 'good', 3000); if (ev.type === 'enrage') this.announce('보스 광폭화', true); });
    g.on('retreat', ({ wave }) => toast(`연속 패배로 웨이브 ${wave}에서 잠시 사냥합니다.`, 'info', 3000));
    g.on('overflow', ({ count }) => { if (!this._ovToast) { this._ovToast = true; toast(`보관함이 가득 차 ${count}개를 임시 보관함에 보관했습니다.`, 'error', 3500); } });
    g.on('farmVerified', (vf) => { this.panelDirty = true; });
    g.on('tx', ({ label }) => { this.panelDirty = true; if (label !== 'upgrade') this.structural = true; this.buildSkills(); this.updateHud(true); });
    g.on('state', () => { this.panelDirty = true; this.structural = true; this.buildSkills(); this.updateHud(true); });
    g.on('saveStatus', (st) => this.renderSaveStatus(st));
    g.on('saveError', (e) => S.openSaveError(this, e));
    g.on('mode', ({ mode, prev }) => this.onMode(mode, prev));
    g.on('result', (r) => S.openResult(this, r));
    g.on('session', (sess) => this.onSession(sess));
    g.on('farmChanged', () => { this.panelDirty = true; this.preload(); });
    // stage clear (emitted only after its commit): stars + first-clear reward
    g.on('stageClear', (r) => {
      const rw = r.reward ? ` · 보석 +${r.reward.gem} 광석 +${r.reward.ore} 골드 +${fmt(r.reward.gold)}` : '';
      toast(`${r.label} 클리어 ${'★'.repeat(r.best)}${'☆'.repeat(3 - r.best)}${rw}`, 'good');
      this.panelDirty = true;
    });
  }

  // Offline claim → return bonus → today's attendance, one after another, each only
  // when there is something to claim. Called on entering and after each claim.
  showDailyPopups() {
    if (this.game.mode === 'OFFLINE' || this.game.mode === 'CONFLICT') return;
    // one-time change notices come first and ignore ?nodaily (a fresh save has none)
    if (this.state.notices && this.state.notices.slotEnhance) { if (!modalOpen()) S.openSlotEnhanceNotice(this); return; }
    if (new URLSearchParams(location.search).has('nodaily')) return;   // QA screenshots
    if (V4.needsClassPick(this.state)) { if (!modalOpen('classpick')) V4.openClassPicker(this, { onDone: () => this.showDailyPopups() }); return; }
    if (modalOpen()) return;
    if (this.state.returnBonus.pending) { S.openReturnBonus(this); return; }
    if (!this._attShown) { this._attShown = true; S.openAttendance(this, { auto: true }); }
  }

  onMode(mode, prev) {
    if (mode === 'OFFLINE') S.openOffline(this);
    if (mode === 'CONFLICT') S.openConflict(this);
    if (mode === 'DEFEAT') this.announce(`${CLASSES[this.state.player.cls || 'warrior'].hero}이(가) 쓰러졌습니다. 3초 뒤 다시 싸웁니다.`, true);
    this.updateHud(true);
    this.renderSession();
  }

  onSession(sess) {
    if (sess) {
      // boss/dungeon/trial always shows the real battle; restore the user's view after
      this.forcedBattleView = true;
      this.applyView();
      this.setImmersive(true, sess);
      preloadFor({ region: REGION_BY_ID[this.state.progression.region], boss: sess.bossId || null, branch: this.state.player.branch, cls: this.state.player.cls, tier: prog.tierOf(this.state), allMonsters: sess.kind === 'rift' || sess.kind === 'tower' || sess.kind === 'dungeon' || sess.kind === 'mplus', bg: sess.kind === 'tower' ? 'tower' : sess.kind === 'raid' ? 'void' : sess.kind === 'rift' ? 'rift' : sess.kind === 'trial' ? 'trial' : sess.kind === 'mplus' ? sess.bg : sess.kind === 'world' ? (REGION_BY_ID[(BOSSES[sess.bossId] || {}).region] || {}).bg : sess.kind === 'dungeon' ? ({ quarry: 'mine', gold: 'vault', books: 'library' }[sess.type] || 'mine') : null });
    } else if (this._chaining) {
      // going straight into the next fight (e.g. next tower floor): stay in the battle view
    } else {
      this.forcedBattleView = false;
      this.applyView();
      this.setImmersive(false);
    }
    this.renderSession();
  }

  // Continue into another special fight without leaving the immersive screen:
  // ends the current result (back → farm) and starts the next one in the same frame.
  chainSession(back, start) {
    this._chaining = true;
    let r;
    try { back(); r = start(); } finally { this._chaining = false; }
    if (!r || !r.ok) { this.forcedBattleView = false; this.applyView(); this.setImmersive(false); this.renderSession(); }
    else this.flashBanner(this.sessionLabel(this.game.session));
    return r;
  }
  flashBanner(text) {
    if (!text || !this.el.battle) return;
    const old = this.el.battle.querySelector('.imm-floorcap');
    if (old) old.remove();
    const b = h('div', { class: 'imm-floorcap', 'aria-live': 'polite' }, text);
    this.el.battle.appendChild(b);
    setTimeout(() => b.remove(), 1400);
  }

  confirmForfeit() {
    const sess = this.game.session;
    if (!sess || modalOpen('forfeit')) return;
    const what = sess.kind === 'mplus' ? '쐐기 던전을 포기할까요? 실패로 처리되어 열쇠가 1단계 내려갑니다(최소 +2).' : sess.kind === 'rift' ? '균열 진행을 여기서 끝낼까요? 지금까지 내려간 층 기준으로 정산합니다.' : sess.kind === 'dungeon' ? '던전을 중단할까요? 입장권은 이미 사용되었습니다.' : '전투를 포기하고 사냥터로 돌아갈까요?';
    const m = openModal({ id: 'forfeit', title: sess.kind === 'boss' || sess.kind === 'raid' ? '포기' : '중단', kind: 'center', desc: what, actions: [
      button('포기하기', { cls: 'btn btn-danger', onClick: () => { m.close(); this.game.forfeit(); } }),
      button('계속 싸우기', { cls: 'btn', onClick: () => m.close() })] });
  }

  // ---------- immersive special fights ----------
  // Screen transition into a battle-only layout; the result modal shows over it and the
  // farm layout comes back when the session ends (returnToFarm → session null).
  setImmersive(on, sess = null) {
    const app = this.root;
    if (app.classList.contains('immersive') === on) { if (on) this.updateImmersiveHud(true); return; }
    const apply = () => {
      app.classList.toggle('immersive', on);
      this.renderer.immersive = on;
      this.renderer.topInset = on ? 74 : 46;
      this.renderer.resize();
      if (on) this.updateImmersiveHud(true);
    };
    const reduceMotion = this.state && this.state.settings.reduceMotion;
    if (reduceMotion || !this.iris) { apply(); return; }
    const iris = this.iris;
    clearTimeout(this._irisT);
    iris.classList.add('on');
    this._irisT = setTimeout(() => { apply(); requestAnimationFrame(() => iris.classList.remove('on')); }, 175);
  }
  sessionLabel(sess) {
    if (!sess) return '';
    // the canvas boss bar already shows the boss name + time: the HUD only names the fight
    if (sess.kind === 'boss') return `보스전 · ${REGION_BY_ID[(BOSSES[sess.bossId] || {}).region] ? REGION_BY_ID[BOSSES[sess.bossId].region].name : ''}`.replace(/ · $/, '');
    if (sess.kind === 'raid') return '심연의 문 · 주간 레이드';
    if (sess.kind === 'world') return `월드 보스 · ${(BOSSES[sess.bossId] || {}).name || ''}`;
    if (sess.kind === 'trial') return `교관 시련 · ${sess.tier || 1}차`;
    if (sess.kind === 'tower') return `시련의 탑 · ${sess.floor}층`;
    if (sess.kind === 'rift') return `균열 · ${sess.floor}층`;
    if (sess.kind === 'mplus') return `쐐기 +${sess.key} · ${(MPLUS.dungeons[sess.dungeon] || {}).name || ''}`;
    if (sess.kind === 'dungeon') return `${({ quarry: '별의 채석장', gold: '황금 금고', books: '스킬북 서고' })[sess.type] || '던전'} · ${sess.stage}단계`;
    return '';
  }
  updateImmersiveHud(force = false) {
    const g = this.game, sess = g.session, b = g.active;
    if (!sess || !b || !this.root.classList.contains('immersive')) return;
    const now = performance.now();
    if (!force && now - (this._hudAt || 0) < 200) return;
    this._hudAt = now;
    const E = this.el;
    const title = this.sessionLabel(sess);
    if (E.hudTitle.textContent !== title) E.hudTitle.textContent = title;
    const bossBar = sess.kind === 'boss' || sess.kind === 'raid' || sess.kind === 'world';   // time already on the boss bar
    // 쐐기: the HUD timer is the key timer; past it the run keeps going (over time, key does not rise)
    const lim = bossBar ? 0 : sess.kind === 'mplus' ? (b.timerMs || 0) : (b.timeLimitMs || 0);
    const left = lim ? Math.max(0, lim - (b.t || 0)) : 0;
    const sec = Math.ceil(left / 1000);
    const parts = [];
    const mm = (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    if (sess.kind === 'mplus' && lim && b.t > lim) parts.push(`시간 초과 +${mm(Math.floor((b.t - lim) / 1000))}`);
    else if (lim) parts.push(mm(sec));
    if (Number.isFinite(b.killTarget)) parts.push(`처치 ${b.kills || 0}/${b.killTarget}`);
    const info = parts.join(' · ');
    if (E.hudInfo.textContent !== info) E.hudInfo.textContent = info;
    E.hudTime.style.width = lim ? (left / lim * 100).toFixed(1) + '%' : '0%';
    E.hudTime.parentElement.classList.toggle('low', lim > 0 && left < 15000);
    E.hudTime.parentElement.hidden = !lim;
  }

  // Screen-reader announcements for key moments, at most one per 1.5 s (warnings excepted).
  announce(text, urgent = false) {
    const now = performance.now();
    if (!urgent && now - (this._lastAnnounce || 0) < 1500) return;
    this._lastAnnounce = now;
    this.el.liveText.textContent = '';
    requestAnimationFrame(() => { this.el.liveText.textContent = text; });
  }
  renderRiftChips() {
    const box = clear(this.el.riftChips);
    const sess = this.game.session;
    if (sess && sess.kind === 'mplus') {
      box.hidden = false;
      box.appendChild(h('span', { class: 'rchip curse' }, `열쇠 +${sess.key}`));
      for (const a of sess.affixes || []) { const x = AFFIXES[a]; if (x) box.appendChild(h('span', { class: 'rchip rare', title: x.desc }, x.name)); }
      return;
    }
    const run = sess && sess.kind === 'rift' && this.state.rift && this.state.rift.run;
    box.hidden = !run;
    if (!run) return;
    const cu = CURSES.find((c) => c.id === run.curse);
    if (cu) box.appendChild(h('span', { class: 'rchip curse', title: cu.desc }, '☠ ' + cu.name));
    const counts = {};
    for (const id of run.blessings) counts[id] = (counts[id] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) { const b = BLESSINGS[id]; if (b) box.appendChild(h('span', { class: 'rchip ' + (b.r || 'common'), title: b.desc }, b.name + (n > 1 ? ' ×' + n : ''))); }
  }
  renderSession() {
    this.renderRiftChips();
    const bar = clear(this.el.sessionBar);
    const m = this.game.mode;
    if (m === 'BOSS' || m === 'DUNGEON' || m === 'PROMOTION_TRIAL') {
      bar.appendChild(button(m === 'BOSS' ? '포기' : '중단', { cls: 'mini-btn', ariaLabel: m === 'BOSS' ? '포기하고 사냥터로' : '중단하고 사냥터로', onClick: () => this.confirmForfeit() }));
    }
  }

  preload() {
    const s = this.state;
    return preloadFor({ region: REGION_BY_ID[s.progression.region], boss: null, branch: s.player.branch, cls: s.player.cls, tier: prog.tierOf(s) });
  }

  // ---------- fullscreen ----------
  renderFsBtn() {
    const b = this.el.fsBtn;
    const m = FS.mode();
    b.hidden = m === 'standalone' || m === 'none';
    const full = FS.isFull();
    b.innerHTML = full ? FS.ICON_EXIT : FS.ICON_ENTER;
    b.setAttribute('aria-label', full ? '전체 화면 끄기' : '전체 화면');
  }
  async toggleFullscreen() {
    const m = FS.mode();
    if (m === 'ios-guide') return S.openFullscreenGuide();
    if (FS.isFull()) await FS.exit(); else await FS.enter();
    this.renderFsBtn();
  }

  // ---------- views ----------
  toggleView() {
    const v = this.state.settings.battleView === 'battle' ? 'portrait' : 'battle';
    this.game.setSetting('battleView', v).then(() => this.applyView());
  }
  applyView() {
    const v = this.forcedBattleView ? 'battle' : (this.state ? this.state.settings.battleView : 'battle');
    this.el.battle.classList.toggle('view-portrait', v === 'portrait');
    this.el.viewBtn.textContent = v === 'portrait' ? '전투' : '일러스트';
    this.el.viewBtn.disabled = this.forcedBattleView;
    this.el.speedBtn.hidden = v === 'portrait';
  }
  toggleSpeed() {
    const sp = this.state.settings.speed === 2 ? 1 : 2;
    this.game.setSetting('speed', sp).then(() => { this.updateHud(true); if (sp === 2) toast('×2: 전투·쿨타임·적 공격 모두 2배속. 방치 보상은 ×1 기준입니다.', 'info', 3600); });
  }
  applyA11y() {
    document.documentElement.classList.toggle('reduce-motion', !!(this.state && this.state.settings.reduceMotion));
  }

  setTab(id) {
    const wasBattle = this.tab === 'battle';
    this.tab = id;
    // 전투 탭 = 전투 전체 화면, 나머지 탭 = 전체 화면 페이지 + 얇은 전투 상태줄
    this.root.classList.toggle('tab-battle', id === 'battle');
    this.root.classList.toggle('tab-page', id !== 'battle');
    if (id === 'battle' && !wasBattle && this.renderer) requestAnimationFrame(() => this.renderer.resize());
    this.structural = true;
    for (const [k, b] of Object.entries(this.navBtns)) { if (k === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    this.panelDirty = true;
    this.renderPanel();
  }

  renderPanel() {
    if (!this.state) return;
    this.panelDirty = false;
    this.structural = false;
    this.lastPanel = performance.now();
    const scroll = this.el.panel.querySelector('.panel-scroll');
    const top = scroll ? scroll.scrollTop : 0;
    const keepFocus = document.activeElement && this.el.panel.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    clear(this.el.panel);
    if (this.tab === 'battle') this.el.goal.dataset.screen = 'main'; else delete this.el.goal.dataset.screen;   // 전투 탭 = 홈 화면
    if (this.tab === 'battle') { this.renderGoal(); return; }
    const map = { stage: S.stagePanel, growth: S.growthPanel, equipment: S.equipmentPanel, skills: S.skillsPanel, dungeon: S.dungeonPanel, menu: S.menuPanel };
    this.el.panel.appendChild(map[this.tab](this));
    if (this.tab === 'stage' && S.stageSig) this._stageSig = S.stageSig(this);
    const ns = this.el.panel.querySelector('.panel-scroll');
    if (ns) ns.scrollTop = top;
    if (keepFocus) { const f = this.el.panel.querySelector(`[data-key="${keepFocus}"]`); if (f) f.focus({ preventScroll: true }); }
    this.renderGoal();
  }

  renderGoal() {
    const goal = prog.nextGoal(this.state);
    this.goal = goal;
    clear(this.el.goal);
    const todo = S.todoCount ? S.todoCount(this) : 0;
    this.el.goal.append(...[h('span', { class: 'lbl' }, '다음 목표'), h('span', { class: 'txt' }, goal.text), goal.progress ? h('span', { class: 'pr' }, goal.progress) : null,
      goal.action ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null].filter(Boolean));
    this._todo = todo;
    this.el.goal.disabled = !goal.action;
    this.el.goal.setAttribute('aria-label', `다음 목표: ${goal.text}${goal.progress ? ' ' + goal.progress : ''}`);
  }
  goGoal() { const a = this.goal && this.goal.action; if (a) S.go(this, a); }

  // ---------- skills bar ----------
  buildSkills() {
    if (!this.state) return;
    const bar = clear(this.el.skills);
    const s = this.state;
    const slots = prog.slotCount(s);
    this.skillEls = [];
    for (let i = 0; i < 5; i++) {
      const id = s.skills.equipped[i];
      if (i >= slots) { bar.appendChild(h('button', { type: 'button', class: 'skill locked', 'aria-label': '승급 해금 슬롯', onClick: () => S.go(this, 'quest') }, '승급', h('br'), '해금')); continue; }
      if (!id) { bar.appendChild(h('button', { type: 'button', class: 'skill empty', 'aria-label': '빈 슬롯 - 스킬 편성', onClick: () => this.setTab('skills') }, '+')); continue; }
      const sk = SKILLS[id];
      const cd = h('span', { class: 'cd', style: { height: '0%' } });
      const cdt = h('span', { class: 'cdt' });
      const b = h('button', { type: 'button', class: `skill sg-${(s.skills.grades && s.skills.grades[id]) || 'common'}${((s.skills.grades && s.skills.grades[id]) || 'common') === 'common' ? '' : ' sgb'}`, 'aria-label': `${sk.name}${sk.kind === 'passive-counter' ? ' (자동 반응)' : ''}`, onClick: () => this.castSkill(id) }, img(skillIcon(sk.icon), ''), cd, cdt);
      bar.appendChild(b);
      this.skillEls.push({ id, cd, cdt, b });
    }
    bar.appendChild(h('span', { class: 'skill-divider', 'aria-hidden': 'true' }));
    const gauge = h('i', { style: { width: '0%' } });
    const ultId = prog.ultId(s);
    const ultSk = SKILLS[ultId];
    const ult = h('button', { type: 'button', class: `skill ult sg-${(s.skills.grades && s.skills.grades[ultId]) || 'common'}${((s.skills.grades && s.skills.grades[ultId]) || 'common') === 'common' ? '' : ' sgb'}`, 'aria-label': `궁극기 ${ultSk.name}`, onClick: () => this.castSkill(ultId) }, img(skillIcon(ultSk.icon), ''), h('span', { class: 'gauge' }, gauge));
    this.ultName = ultSk.name;
    bar.appendChild(ult);
    this.ultEl = { b: ult, gauge };
  }
  castSkill(id) {
    const g = this.game;
    const sk = SKILLS[id];
    if (sk.kind === 'passive-counter') { toast('수호 반격은 방패 돌진의 방어 시간 중 피해를 받으면 자동으로 발동합니다.', 'info', 3200); return; }
    if (!['FARM', 'BOSS', 'DUNGEON', 'PROMOTION_TRIAL'].includes(g.mode)) return;
    const b = g.active;
    const isUlt = sk.kind === 'ultimate';
    if (isUlt && b.hero.gauge < 100) { toast(`궁극기 게이지 부족 (${Math.floor(b.hero.gauge)}/100)`, 'info'); return; }
    if (!isUlt && (b.hero.cds[id] || 0) > b.t) { toast(`${sk.name} 대기 중 · ${((b.hero.cds[id] - b.t) / 1000).toFixed(1)}초`, 'info'); return; }
    g.castManual(id);
  }

  // ---------- per frame ----------
  frame(alpha) {
    const g = this.game;
    if (!g.state || !this.renderer) return;
    if (g.session) this.updateImmersiveHud();
    const b = g.active;
    const s = g.state;
    const view = this.forcedBattleView ? 'battle' : s.settings.battleView;
    const hidden = this.tab !== 'battle' && !this.root.classList.contains('immersive');   // page tab: battle is off-screen
    if (view === 'battle' && !hidden) {
      const region = REGION_BY_ID[s.progression.region];
      const sess = g.session;
      // GPT G: 금고 · 서고 · 시련장 · 균열 전용 배경
      const SB = { quarry: ['mine', null], gold: ['vault', null], books: ['library', null], tower: ['tower', null], raid: ['void', null], rift: ['rift', null] };
      const sk = sess ? (sess.kind === 'dungeon' ? sess.type || 'quarry' : sess.kind === 'mplus' ? sess.dungeon : sess.kind) : null;
      const wbReg = sess && sess.kind === 'world' ? REGION_BY_ID[(BOSSES[sess.bossId] || {}).region] : null;
      const [bg, bgTint] = g.mode === 'PROMOTION_TRIAL' ? ['trial', null] : wbReg ? [wbReg.bg, null] : SB[sk] || [region.bg, region.bgTint || null];
      const left = b.timeLeftMs ? b.timeLeftMs() : null;
      const DN = { quarry: '채석장', gold: '황금 금고', books: '스킬북 서고' };
      const label = sess && sess.kind === 'mplus' ? null
        : sk === 'rift' ? `균열 ${sess.floor}층 · 처치 ${b.kills}/${b.killTarget} · ${Math.ceil((left || 0) / 1000)}초`
        : sk === 'tower' ? `시련의 탑 ${sess.floor}층 · 처치 ${b.kills}/${BALANCE.tower.killTarget} · ${Math.ceil((left || 0) / 1000)}초`
        : g.mode === 'DUNGEON' && sess ? `${DN[sk] || '던전'} ${sess.stage}단계 · 처치 ${b.kills} · ${Math.ceil((left || 0) / 1000)}초`
        : sk === 'raid' ? `레이드 · 누적 피해 ${fmt(b.raidDamage || b.damageDealt || 0)} · ${Math.ceil((left || 0) / 1000)}초`
        : g.mode === 'DEFEAT' ? '쓰러졌습니다 · 3초 뒤 재개 (손실 없음)' : null;
      const cls = CLASSES[s.player.cls || 'warrior'];
      this.renderer.draw(b, { alpha, region, bgId: bg, bgTint, branch: s.player.branch, cls: s.player.cls || 'warrior', tier: prog.tierOf(s), heroTint: cls.tint || 0, mount: s.mounts && s.mounts.equipped, wing: s.wings && s.wings.equipped, label, victory: g.mode === 'RESULT' && g.result && g.result.win });
    }
    // cooldowns
    if (b && this.skillEls) {
      for (const e of this.skillEls) {
        const left = Math.max(0, (b.hero.cds[e.id] || 0) - b.t);
        const total = (SKILLS[e.id].cd || 1) * 1000;
        e.cd.style.height = (left > 0 ? (left / total) * 100 : 0) + '%';
        e.cdt.textContent = left > 0 ? Math.ceil(left / 1000) : '';
      }
      const gv = Math.floor(b.hero.gauge);
      this.ultEl.gauge.style.width = gv + '%';
      this.ultEl.b.classList.toggle('ready', gv >= 100);
      this.ultEl.b.setAttribute('aria-label', `궁극기 ${this.ultName} · 게이지 ${gv}/100`);
    }
    const now = performance.now();
    if (now - this.lastHud > 250) { this.lastHud = now; this.updateHud(); }
  }

  updateHud(force = false) {
    const s = this.state;
    if (!s) return;
    const E = this.el;
    const p = s.player;
    const region = REGION_BY_ID[s.progression.region];
    const ttl = titleName(s);
    E.name.textContent = (s.profile.nickname || '모험가') + (ttl ? ` 「${ttl}」` : '');
    const faceSrc = classPortrait(p.cls || 'warrior', 'face');
    if (E.face.getAttribute('src') !== faceSrc) E.face.setAttribute('src', faceSrc);
    const kvSrc = classPortrait(p.cls || 'warrior', 'kv');
    if (E.portraitImg && E.portraitImg.getAttribute('src') !== kvSrc) {
      const C = CLASSES[p.cls || 'warrior'];
      E.portraitImg.setAttribute('src', kvSrc); E.portraitImg.alt = `${C.hero} 일러스트`;
      E.portraitImg.style.objectPosition = C.art ? '50% 2%' : '';   // generated figures start near the top edge
    }
    const capName = CLASSES[p.cls || 'warrior'].hero, capSub = prog.tierName(s) || (p.cls && p.cls !== 'warrior' ? CLASSES[p.cls].name : '흑장미의 서약');
    if (E.capB && E.capB.textContent !== capName) { E.capB.textContent = capName; E.capS.textContent = capSub; } else if (E.capS && E.capS.textContent !== capSub) E.capS.textContent = capSub;
    E.sub.textContent = `Lv ${p.level} · ${prog.tierName(s) || CLASSES[p.cls || 'warrior'].name}${p.pendingExp ? ' · 보관 EXP ' + fmt(p.pendingExp) : ''}`;
    E.gold.querySelector('.v').textContent = fmt(s.wallet.gold);
    E.ore.querySelector('.v').textContent = fmt(s.wallet.ore);
    const mailN = MAILUI.mailCount(s);
    if (E.mailBtn) { E.mailBtn.hidden = !mailN; E.mailN.textContent = mailN > 9 ? '9+' : String(mailN); E.mailBtn.setAttribute('aria-label', `우편함 · 받을 우편 ${mailN}통`); }
    const m = this.game.mode;
    let pv = 0;
    if (m === 'BOSS') { E.where.textContent = BOSSES[this.game.session.bossId].name; E.prog.textContent = DF.prefix(this.game.session.diff || 'easy') + '보스전'; }
    else if (m === 'DUNGEON' && this.game.session && this.game.session.kind === 'rift') { E.where.textContent = '균열'; E.prog.textContent = `${this.game.session.floor}층`; }
    else if (m === 'DUNGEON' && this.game.session && this.game.session.kind === 'mplus') { E.where.textContent = MPLUS.dungeons[this.game.session.dungeon].name; E.prog.textContent = `쐐기 +${this.game.session.key}`; }
    else if (m === 'DUNGEON' && this.game.session && this.game.session.kind === 'tower') { E.where.textContent = '시련의 탑'; E.prog.textContent = `${this.game.session.floor}층`; }
    else if (m === 'DUNGEON') { E.where.textContent = BALANCE.dungeons[this.game.session.type || 'quarry'].name; E.prog.textContent = `${this.game.session.stage}단계`; }
    else if (m === 'PROMOTION_TRIAL') { E.where.textContent = (this.game.session && this.game.session.tier === 3) ? '영웅의 시련' : '교관 시련'; E.prog.textContent = '승급 시련'; }
    else { E.where.textContent = region.name; E.prog.textContent = DF.prefix(DF.curDiff(s)) + stageLabel(region.id, s.progression.wave); pv = s.progression.waveKills / BALANCE.combat.waveKillTarget; }
    E.progBar.style.width = Math.round(Math.min(1, pv) * 100) + '%';
    E.miniTxt.textContent = `${E.where.textContent} ${E.prog.textContent}`;
    E.miniSub.textContent = m === 'DEFEAT' ? '재정비 중' : m === 'FARM' ? `처치 ${s.progression.waveKills}/${BALANCE.combat.waveKillTarget}` : '전투 중';
    E.miniBar.style.width = E.progBar.style.width;
    E.worldBtn.disabled = m !== 'FARM' && m !== 'DEFEAT';
    const need = expToNext(p.level);
    E.lvbar.style.width = need ? Math.min(100, (p.exp / need) * 100).toFixed(1) + '%' : '0%';
    const bossId = region.boss;
    const can = this.game.canChallengeBoss(bossId);
    E.bossBtn.disabled = m !== 'FARM';
    E.bossBtn.textContent = m === 'BOSS' || m === 'DUNGEON' || m === 'PROMOTION_TRIAL' ? '전투 중' : DF.track(s).bossCleared[bossId] ? (can.ok ? `보스 재도전 ${can.left}/3` : '보스 · 오늘 3회 완료') : can.ok ? '보스 도전!' : `보스 · ${stageLabel(region.id, 10)} 필요`;
    E.bossBtn.classList.toggle('hot', can.ok && !DF.track(s).bossCleared[bossId]);
    E.speedBtn.textContent = s.settings.speed === 2 ? '×2' : '×1';
    E.autoBadge.textContent = m === 'DEFEAT' ? '재정비 중' : m === 'BOSS' ? '보스전' : m === 'DUNGEON' ? '던전' : m === 'PROMOTION_TRIAL' ? '시련' : `자동 전투 · ×${s.settings.speed}`;
    // portrait live summary (same simulation)
    const vf = s.progression.verifiedFarm;
    clear(E.portraitLive).append(h('span', null, `자동 사냥 중 · ${region.name} ${DF.prefix(DF.curDiff(s))}${stageLabel(region.id, s.progression.wave)}`), h('span', { class: 'muted' }, vf ? `검증 사냥터 W${vf.wave} · 분당 ${fmt(vf.killsPerSec * 60)}마리` : '사냥터 검증 중 (웨이브 10마리 ×3회 무사 처치)'));
    // nav badges
    const newItems = s.inventory.some((i) => i.isNew) || s.overflow.length > 0;
    this.navDot('equipment', newItems);
    const dunHot = ['quarry', 'gold', 'books'].some((t) => prog.dungeonOpen(s, t) && (t === 'quarry' ? s.dungeon : s.dungeons[t]).tickets > 0);
    this.navDot('dungeon', dunHot || V5.riftDot(s) || V8.mplusDot(s) || V8.expeditionDot(s) || V8.worldBossDot(s));
    this.navDot('skills', prog.unlockedSkills(s).some((id) => { const c = prog.skillLevelCost(s, id); return c && (s.skills.books[id] || 0) >= c.books && s.wallet.gold >= c.gold; }));
    this.navDot('menu', S.todoCount(this) > 0);
    // growth: patch values in place. Other tabs: rebuild when data changed, at most once
    // a second and never while a finger/mouse is down on the panel (no lost taps).
    const live = this.el.panel.firstChild;
    if (this.tab === 'growth' && live && live._update && !this.structural) { live._update(); this.renderGoal(); this.panelDirty = false; return; }
    const nowMs = performance.now();
    // 스테이지 지도: 처치·골드·자동 강화마다 다시 그리지 않음. 지도에 보이는 값이 바뀔 때만,
    // 그리고 마지막 터치 후 4초가 지난 뒤에만 다시 그림 (고르던 칸·탭 스크롤이 튀지 않게).
    if (this.tab === 'stage' && this.panelDirty) {
      const sig = S.stageSig ? S.stageSig(this) : null;
      if (sig === this._stageSig) { this.panelDirty = false; return; }
      if (nowMs - (this.lastTouch || 0) < 4000) return;
    }
    if (this.panelDirty && !this.pointerDown && (force || nowMs - (this.lastPanel || 0) > 1000)) this.renderPanel();
  }
  navDot(tab, on) {
    const b = this.navBtns[tab];
    let d = b.querySelector('.dot');
    if (on && !d) b.appendChild(h('span', { class: 'dot', 'aria-hidden': 'true' }));
    if (!on && d) d.remove();
    b.setAttribute('aria-label', TABS.find((t) => t.id === tab).label + (on ? ' (새 소식)' : ''));
  }

  renderSaveStatus(st) {
    const d = this.el.saveDot;
    d.classList.toggle('bad', !st.ok);
    d.setAttribute('aria-label', st.ok ? '저장됨' : '저장 실패');
    d.title = st.ok ? '저장됨' : '저장 실패: ' + (st.error || '');
    clear(this.el.banner);
    if (!st.ok) {
      this.el.banner.appendChild(h('div', { class: 'notice-bar', role: 'alert' }, icon('warning', 20), h('span', { style: { flex: 1 } }, '최근 진행이 저장되지 않았습니다.'),
        button('다시 저장', { cls: 'btn', busy: true, onClick: async () => { await this.game.checkpoint('retry'); } })));
    }
  }
}

export { modalOpen, closeAllModals };
