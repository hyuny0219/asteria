// App shell: layout (spec 08 table), per-frame updates, and mode → screen routing.
import { BALANCE } from '../data/balance.js';
import { BOSSES, CURRENCY_ICONS, REGION_BY_ID, SKILLS } from '../data/content.js';
import { BattleRenderer } from '../render/battle.js';
import { itemIcon, portrait, preloadFor, skillIcon } from '../render/assets.js';
import * as prog from '../core/progression.js';
import { fmt } from '../core/util.js';
import { button, clear, closeAllModals, h, icon, img, initModals, initToasts, modalOpen, toast } from './dom.js';
import * as S from './screens.js';
import { sfx } from '../platform/audio.js';

export const TABS = [
  { id: 'growth', label: '성장' },
  { id: 'equipment', label: '장비' },
  { id: 'skills', label: '스킬' },
  { id: 'dungeon', label: '던전' },
  { id: 'menu', label: '메뉴' },
];

export class App {
  constructor({ game, saver, lock, root, saverWarning }) {
    this.game = game;
    this.saver = saver;
    this.lock = lock;
    this.root = root;
    this.saverWarning = saverWarning;
    this.tab = 'growth';
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
    E.gold = h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.gold), ''), h('span', { class: 'v' }, '0'));
    E.gold.setAttribute('aria-label', '골드');
    E.ore = h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.ore), ''), h('span', { class: 'v' }, '0'));
    E.ore.setAttribute('aria-label', '강화 광석');
    E.saveDot = h('span', { class: 'save-dot', title: '저장 상태', role: 'img', 'aria-label': '저장됨' });
    app.appendChild(h('header', { class: 'status' }, E.face, h('div', { class: 'who' }, E.name, E.sub), h('div', { class: 'wallet' }, E.gold, E.ore, E.saveDot)));
    E.banner = h('div', { class: 'banner-host' });
    app.appendChild(E.banner);
    // stage 40
    E.where = h('span', { class: 'where' }, '');
    E.prog = h('span', { class: 'prog' }, '');
    E.bossBtn = button('보스 도전', { cls: 'chip-btn', onClick: () => S.openBoss(this) });
    E.worldBtn = button(icon('dungeon', 20, '지역 선택'), { cls: 'icon-btn', ariaLabel: '지역 선택', onClick: () => S.openWorld(this) });
    app.appendChild(h('div', { class: 'stage' }, E.where, E.prog, h('span', { class: 'spacer' }), E.worldBtn, E.bossBtn));
    // battle 220
    E.canvas = h('canvas', { role: 'img', 'aria-label': '자동 전투 화면' });
    E.liveText = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    E.portraitLive = h('div', { class: 'live' });
    E.portrait = h('div', { class: 'portrait' }, img(portrait('serin_key'), '세린 일러스트'), h('div', { class: 'scrim' }), E.portraitLive,
      h('div', { class: 'cap' }, h('b', null, '세린'), h('span', null, '흑장미의 서약')));
    E.viewBtn = button('일러스트', { cls: 'mini-btn', ariaLabel: '보기 전환', onClick: () => this.toggleView() });
    E.speedBtn = button('×1', { cls: 'mini-btn', ariaLabel: '전투 배속', onClick: () => this.toggleSpeed() });
    E.autoBadge = h('span', { class: 'badge' }, '자동 전투');
    E.sessionBar = h('div', { class: 'session-bar' });
    E.battle = h('section', { class: 'battle', 'aria-label': '전투' }, E.canvas, E.portrait,
      h('div', { class: 'overlay-tl' }, E.autoBadge), h('div', { class: 'overlay-tr' }, E.speedBtn, E.viewBtn), E.sessionBar, E.liveText);
    app.appendChild(E.battle);
    // skills 64
    E.skills = h('div', { class: 'skills', role: 'toolbar', 'aria-label': '스킬' });
    app.appendChild(E.skills);
    // lower: goal 56 + panel 312
    E.goal = h('button', { type: 'button', class: 'goal', onClick: () => this.goGoal() });
    E.panel = h('section', { class: 'panel', 'aria-live': 'off' });
    E.panel.addEventListener('pointerdown', () => { this.pointerDown = true; });
    window.addEventListener('pointerup', () => { this.pointerDown = false; });
    window.addEventListener('pointercancel', () => { this.pointerDown = false; });
    app.appendChild(h('div', { class: 'lower' }, E.goal, E.panel));
    // nav 56
    E.nav = h('nav', { class: 'nav', 'aria-label': '주 메뉴' });
    this.navBtns = {};
    for (const t of TABS) {
      const b = h('button', { type: 'button', onClick: () => this.setTab(t.id) }, t.label);
      this.navBtns[t.id] = b;
      E.nav.appendChild(b);
    }
    app.appendChild(E.nav);
    initModals(document.getElementById('modals'));
    initToasts(document.getElementById('toasts'));

    this.renderer = new BattleRenderer(E.canvas, { getSettings: () => this.settings });
    new ResizeObserver(() => this.renderer.resize()).observe(E.canvas);
    this.bindGame();
    this.buildSkills();
    this.setTab('growth');
    this.applyView();
    this.applyA11y();
  }

  bindGame() {
    const g = this.game;
    g.on('combat', (ev) => {
      if (this.renderer) this.renderer.onCombat(ev, g.active);
      if (ev.type === 'hit' && ev.by === 'hero' && this.state.settings.sound) sfx(ev.crit ? 'crit' : 'hit');
      if (ev.type === 'telegraph' && ev.heavy) {
        this.el.liveText.textContent = `경고: ${ev.name}`;
        if (this.state.settings.sound) sfx('warn');
      }
    });
    g.on('reward', (r) => {
      this.panelDirty = true;
      // common drops only light the 장비 tab dot; uncommon+ get a short toast
      const notable = r.loot ? r.loot.items.filter((i) => i.rarity !== 'common') : [];
      if (notable.length) toast(`장비 획득 · ${notable.map((i) => `${i.rarity === 'rare' ? '희귀 III' : '고급 II'} ${i.name}`).join(', ')}`, 'good', 1800);
      if (r.token) toast(`시련의 증표 +1 (${this.state.wallet.token}/${BALANCE.promotion.tokensRequired})`, 'good', 1800);
      if (r.expRes && r.expRes.toPending && !this._pendingToast) { this._pendingToast = true; toast('Lv 30: 서약 각성 전까지 경험치는 보관됩니다.', 'info', 3500); }
    });
    g.on('levelUp', ({ level }) => { toast(`레벨 업! Lv ${level}`, 'good'); this.panelDirty = true; this.buildSkills(); });
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
  }

  onMode(mode, prev) {
    if (mode === 'OFFLINE') S.openOffline(this);
    if (mode === 'CONFLICT') S.openConflict(this);
    if (mode === 'DEFEAT') { this.el.liveText.textContent = '세린이 쓰러졌습니다. 3초 뒤 다시 싸웁니다.'; }
    this.updateHud(true);
    this.renderSession();
  }

  onSession(sess) {
    if (sess) {
      // boss/dungeon/trial always shows the real battle; restore the user's view after
      this.forcedBattleView = true;
      this.applyView();
      preloadFor({ region: REGION_BY_ID[this.state.progression.region], boss: sess.bossId || null, branch: this.state.player.branch });
    } else {
      this.forcedBattleView = false;
      this.applyView();
    }
    this.renderSession();
  }

  renderSession() {
    const bar = clear(this.el.sessionBar);
    const m = this.game.mode;
    if (m === 'BOSS' || m === 'DUNGEON' || m === 'PROMOTION_TRIAL') {
      bar.appendChild(button(m === 'BOSS' ? '포기하고 파밍' : '중단', { cls: 'mini-btn', onClick: () => this.game.forfeit() }));
    }
  }

  preload() {
    const s = this.state;
    return preloadFor({ region: REGION_BY_ID[s.progression.region], boss: null, branch: s.player.branch });
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
    this.tab = id;
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
    const map = { growth: S.growthPanel, equipment: S.equipmentPanel, skills: S.skillsPanel, dungeon: S.dungeonPanel, menu: S.menuPanel };
    this.el.panel.appendChild(map[this.tab](this));
    const ns = this.el.panel.querySelector('.panel-scroll');
    if (ns) ns.scrollTop = top;
    if (keepFocus) { const f = this.el.panel.querySelector(`[data-key="${keepFocus}"]`); if (f) f.focus({ preventScroll: true }); }
    this.renderGoal();
  }

  renderGoal() {
    const goal = prog.nextGoal(this.state);
    this.goal = goal;
    clear(this.el.goal);
    this.el.goal.append(...[h('span', { class: 'lbl' }, '다음 목표'), h('span', { class: 'txt' }, goal.text), goal.progress ? h('span', { class: 'pr' }, goal.progress) : null].filter(Boolean));
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
    for (let i = 0; i < 4; i++) {
      const id = s.skills.equipped[i];
      if (i >= slots) { bar.appendChild(h('button', { type: 'button', class: 'skill locked', 'aria-label': '승급 해금 슬롯', onClick: () => S.go(this, 'quest') }, '승급', h('br'), '해금')); continue; }
      if (!id) { bar.appendChild(h('button', { type: 'button', class: 'skill empty', 'aria-label': '빈 슬롯 - 스킬 편성', onClick: () => this.setTab('skills') }, '+')); continue; }
      const sk = SKILLS[id];
      const cd = h('span', { class: 'cd', style: { height: '0%' } });
      const cdt = h('span', { class: 'cdt' });
      const b = h('button', { type: 'button', class: 'skill', 'aria-label': `${sk.name}${sk.kind === 'passive-counter' ? ' (자동 반응)' : ''}`, onClick: () => this.castSkill(id) }, img(skillIcon(sk.icon), ''), cd, cdt);
      bar.appendChild(b);
      this.skillEls.push({ id, cd, cdt, b });
    }
    bar.appendChild(h('span', { class: 'skill-divider', 'aria-hidden': 'true' }));
    const gauge = h('i', { style: { width: '0%' } });
    const ult = h('button', { type: 'button', class: 'skill ult', 'aria-label': '궁극기 별빛 참격', onClick: () => this.castSkill('starSlash') }, img(skillIcon('S5'), ''), h('span', { class: 'gauge' }, gauge));
    bar.appendChild(ult);
    this.ultEl = { b: ult, gauge };
  }
  castSkill(id) {
    const g = this.game;
    const sk = SKILLS[id];
    if (sk.kind === 'passive-counter') { toast('수호 반격은 방패 돌진의 방어 시간 중 피해를 받으면 자동으로 발동합니다.', 'info', 3200); return; }
    if (!['FARM', 'BOSS', 'DUNGEON', 'PROMOTION_TRIAL'].includes(g.mode)) return;
    const b = g.active;
    if (id === 'starSlash' && b.hero.gauge < 100) { toast(`궁극기 게이지 부족 (${Math.floor(b.hero.gauge)}/100)`, 'info'); return; }
    if (id !== 'starSlash' && (b.hero.cds[id] || 0) > b.t) { toast(`${sk.name} 대기 중 · ${((b.hero.cds[id] - b.t) / 1000).toFixed(1)}초`, 'info'); return; }
    g.castManual(id);
  }

  // ---------- per frame ----------
  frame(alpha) {
    const g = this.game;
    if (!g.state || !this.renderer) return;
    const b = g.active;
    const s = g.state;
    const view = this.forcedBattleView ? 'battle' : s.settings.battleView;
    if (view === 'battle') {
      const region = REGION_BY_ID[s.progression.region];
      const bg = g.mode === 'PROMOTION_TRIAL' ? 'cathedral' : g.mode === 'DUNGEON' ? 'mine' : region.bg;
      const label = g.mode === 'DUNGEON' ? `채석장 ${g.session?.stage}단계 · 처치 ${b.kills}/${BALANCE.dungeon.killTarget} · ${Math.ceil(b.timeLeftMs() / 1000)}초` : g.mode === 'DEFEAT' ? '쓰러졌습니다 · 3초 뒤 재개 (손실 없음)' : null;
      this.renderer.draw(b, { alpha, region, bgId: bg, branch: s.player.branch, label, victory: g.mode === 'RESULT' && g.result && g.result.win });
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
      this.ultEl.b.setAttribute('aria-label', `궁극기 별빛 참격 · 게이지 ${gv}/100`);
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
    E.sub.textContent = `Lv ${p.level}${p.branch ? ' · ' + (p.branch === 'knight' ? '흑장미 기사' : '진홍의 집행자') : ''}${p.pendingExp ? ' · 보관 EXP ' + fmt(p.pendingExp) : ''}`;
    E.gold.querySelector('.v').textContent = fmt(s.wallet.gold);
    E.ore.querySelector('.v').textContent = fmt(s.wallet.ore);
    const m = this.game.mode;
    if (m === 'BOSS') { E.where.textContent = BOSSES[this.game.session.bossId].name; E.prog.textContent = '보스전'; }
    else if (m === 'DUNGEON') { E.where.textContent = '별의 채석장'; E.prog.textContent = `${this.game.session.stage}단계`; }
    else if (m === 'PROMOTION_TRIAL') { E.where.textContent = '교관 시련'; E.prog.textContent = '서약 각성'; }
    else { E.where.textContent = region.name; E.prog.textContent = `웨이브 ${s.progression.wave}/10 · ${s.progression.waveKills}/${BALANCE.combat.waveKillTarget}`; }
    const bossId = region.boss;
    const can = this.game.canChallengeBoss(bossId);
    E.bossBtn.disabled = m !== 'FARM';
    E.bossBtn.textContent = s.progression.bossCleared[bossId] ? '보스 재도전' : can.ok ? '보스 도전' : `보스 · W${s.progression.maxWave[region.id] || 1}/10`;
    E.bossBtn.classList.toggle('hot', can.ok && !s.progression.bossCleared[bossId]);
    E.speedBtn.textContent = s.settings.speed === 2 ? '×2' : '×1';
    E.autoBadge.textContent = m === 'DEFEAT' ? '재정비 중' : m === 'BOSS' ? '보스전' : m === 'DUNGEON' ? '던전' : m === 'PROMOTION_TRIAL' ? '시련' : `자동 전투 · ×${s.settings.speed}`;
    // portrait live summary (same simulation)
    const vf = s.progression.verifiedFarm;
    clear(E.portraitLive).append(h('span', null, `자동 사냥 중 · ${region.name} W${s.progression.wave}`), h('span', { class: 'muted' }, vf ? `검증 사냥터 W${vf.wave} · 분당 ${fmt(vf.killsPerSec * 60)}마리` : '사냥터 검증 중 (웨이브 10마리 ×3회 무사 처치)'));
    // nav badges
    const newItems = s.inventory.some((i) => i.isNew) || s.overflow.length > 0;
    this.navDot('equipment', newItems);
    this.navDot('dungeon', prog.dungeonOpen(s) && s.dungeon.tickets > 0);
    this.navDot('menu', prog.promotionChecklist(s).canChoose || prog.promotionChecklist(s).canTrial);
    // growth: patch values in place. Other tabs: rebuild when data changed, at most once
    // a second and never while a finger/mouse is down on the panel (no lost taps).
    const live = this.el.panel.firstChild;
    if (this.tab === 'growth' && live && live._update && !this.structural) { live._update(); this.renderGoal(); this.panelDirty = false; return; }
    const nowMs = performance.now();
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
      this.el.banner.appendChild(h('div', { class: 'banner', role: 'alert' }, icon('warning', 20), h('span', { style: { flex: 1 } }, '최근 진행이 저장되지 않았습니다.'),
        button('다시 저장', { cls: 'btn', busy: true, onClick: async () => { await this.game.checkpoint('retry'); } })));
    }
  }
}

export { modalOpen, closeAllModals };
