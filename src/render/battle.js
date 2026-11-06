// Canvas2D side-view battle renderer. Reads a Battle snapshot each frame and
// draws it; it never decides damage. Visual effects are spawned from the same
// combat events that applied the damage (game 'combat' events).
//
// Animation status (honest): the hero switches between the 8 authored key poses
// (idle/step/anticipation/thrust/recovery/hit/cast/victory) with small procedural
// tweens (breathing, lunge, knockback). Enemies and bosses are single static
// images animated by transforms (squash, lean, lunge, flash, fade). These are not
// frame-by-frame animations; see KNOWN_ISSUES.md.
//
// Combat feel (presentation only — nothing here changes damage or timing):
// - basic attacks cycle a 3-step combo (1타 → 2타 → 피니시) chosen per swing; the
//   step only picks poses / lunge / effect shapes. No damage bonus.
// - hit-stop freezes the *drawn* sprites 40–120 ms; the simulation keeps ticking.
// - slow motion slows only the effect clock (particles / slashes), never the battle.
// - ultimate cut-in (dim + diagonal banner with portrait + name) is timed on battle
//   time from 'ultStart' so it lines up with the 700 ms impact; tap skips the banner.
import { HERO_X } from '../core/combat.js';
import { CLASSES, SKILLS } from '../data/content.js';
import { bgMeta, fxSprite, classPortrait, enemyMeta, heroFrames, loadImage, outlined, petMeta, promoPortrait, ready, scaledImage, spriteMeta } from './assets.js';
import { Particles, PK } from './particles.js';
import { fmt } from '../core/util.js';

const LOGICAL_W = 390;
const LOGICAL_H = 220;
const GROUND = 0.8;
const FLIGHT = 150;        // ms a ranged projectile is shown travelling
const COMBO_RESET = 2000;  // ms without a swing/hit → combo back to 1타 / counter cleared
const FX_CAP = 64;

// pose / lunge per combo step (melee values; ranged classes use a fraction)
const COMBO = [null,
  { wind: 'anticipation', hit: 'thrust', rec: 'recovery', back: -4, lunge: 10, hold: 110, scale: 1 },
  { wind: 'recovery', hit: 'thrust', rec: 'anticipation', back: -2, lunge: 15, hold: 100, scale: 1.02 },
  { wind: 'cast', hit: 'thrust', rec: 'recovery', back: -9, lunge: 24, hold: 170, scale: 1.06 },
];
// class palettes: main stroke, hot core, deep tone, banner tint
const PAL = {
  warrior: { main: '#F5EDF0', hot: '#FFE6A8', deep: '#C9455F', band: '#5A1A2C' },
  berserker: { main: '#FF8C8C', hot: '#FFD0B0', deep: '#B0203A', band: '#5A0F1E' },
  mage: { main: '#CDB6FF', hot: '#FFE6A8', deep: '#7A5CD6', band: '#2C1F5A' },
  warlock: { main: '#9BE89A', hot: '#E8FFD0', deep: '#3C8A55', band: '#173A2A' },
  archer: { main: '#C9F0D8', hot: '#FFE6A8', deep: '#3E8C6A', band: '#173B2E' },
  rogue: { main: '#F0C6D2', hot: '#FF6F8E', deep: '#8E294C', band: '#3A0F22' },
};
const DOT_COL = { r_poison: '#8BE07A', m_curse: '#C08CFF', a_beast: '#F08080' };
const PROJ_SKILL = { m_fireball: 'fire', m_curse: 'hex', m_drain: null, m_chain: null, m_frost: null, m_blizzard: null,
  a_aim: 'arrowC', a_pierce: null, a_snipe: null, a_beast: null, a_pack: null, r_poison: 'daggerP' };
const byXDesc = (a, b) => b.x - a.x;
// projectile kind → GPT B sprite and on-screen length (px at u = 1)
const PROJ_SPRITE = { bolt: 'bolt', star: 'bolt', hex: 'hex', fire: 'meteor', arrow: 'arrow', arrowC: 'arrow_glow', dagger: 'dagger', daggerP: 'dagger' };
const PROJ_LEN = { bolt: 46, star: 52, hex: 46, fire: 52, arrow: 50, arrowC: 60, dagger: 30, daggerP: 30 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const white = new WeakMap();   // sprite canvas → white silhouette (hit flash), no ctx.filter needed

function whiteOf(src) {
  let c = white.get(src);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  white.set(src, c);
  return c;
}

export class BattleRenderer {
  constructor(canvas, { getSettings, topInset = 0 }) {
    this.topInset = topInset;   // DOM strip over the top of the canvas
    this.figScale = 0.78;       // characters & monsters drawn smaller than the 220px-stage spec (선배 요청)
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.getSettings = getSettings;
    this.numbers = [];   // floating damage numbers (max 24)
    this.fx = [];        // slashes / rings / beams (max FX_CAP), compacted in place
    this.parts = new Particles(260);
    this.shake = { until: 0, amp: 0, ms: 1 };
    this.bgKey = null;
    this.bgCache = null;
    this.clock = performance.now();   // effect clock (runs slower during slow motion)
    this.lastNow = this.clock;
    this.slowUntil = 0;
    this.freezeUntil = 0; this.frozenT = 0; this.pendingStop = null; this.rt = 0;
    this.combo = { step: 0, actStart: -1, lastSwing: -1e9 };
    this.counter = { n: 0, last: -1e9, pop: -1e9 };
    this.kb = new Map();             // enemy uid → knockback {at, amp}
    this.toast = null;
    this.cut = null;                 // ultimate cut-in state
    this.skillKey = null; this.ultHits = 0;
    this._sorted = [];
    this.ghost = null;               // last drawn hero sprite (afterimages)
    this.frameMs = 0;                // smoothed frame time (QA reads it)
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width || LOGICAL_W), hgt = Math.max(1, r.height || LOGICAL_H);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.cssW = w; this.cssH = hgt; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hgt * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // reset, never accumulate
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.bgKey = null;
  }

  get sx() { return this.cssW / LOGICAL_W; }
  // immersive: bigger figures → pull the waiting line in so the 2nd/3rd enemy stays on screen
  ex(x) { return this.immersive && x > 250 ? 250 + (x - 250) * 0.5 : x; }
  get groundY() { return this.cssH * GROUND; }
  // vertical fit: sprites sized for a 220 px tall stage
  // immersive special fights have a much taller canvas: let figures grow more (still
  // width-limited so the hero and the front enemy never overlap)
  get fit() { return Math.min(this.cssH / LOGICAL_H, this.cssW / LOGICAL_W * (this.immersive ? 1.35 : 1.15)); }
  get u() { return this.fit * this.figScale; }
  pal() { return PAL[this.heroBranch === 'berserker' ? 'berserker' : this.heroBranch === 'warlock' ? 'warlock' : this.heroCls] || PAL.warrior; }

  // ---------- events from the simulation ----------
  // Returns a sound cue name (or null); the app plays it when sound is on.
  onCombat(ev, battle) {
    const s = this.getSettings();
    const now = performance.now();
    if (ev.type === 'hit') {
      if (ev.by === 'hero') return this.heroHit(ev, battle, s, now);
      const show = s.damageNumbers === 'all' || s.damageNumbers === 'crit';
      if (show) this.pushNumber({ x: HERO_X, y: 0.38, text: fmt(ev.dmg), crit: false, enemy: true, heavy: ev.heavy, guarded: ev.guarded, born: now, dx: 0 });
      const hx = HERO_X * this.sx, hy = this.groundY - 52 * this.u;
      this.parts.burst(this.clock, hx + 8, hy, ev.heavy ? 10 : 4, 120, 260, 2.2, ev.guarded ? '#A9C8FF' : '#FF9DB2', PK.STREAK, 0, 1.6, Math.PI);
      if (ev.heavy) { this.kick(4, 160); this.flashScreen(ev.guarded ? '#A9C8FF' : '#FF4060', 0.18, 160); }
      return null;
    }
    if (ev.type === 'miss') {
      this.pushNumber({ x: HERO_X, y: 0.38, text: '회피', miss: true, born: now, dx: 0 });
    } else if (ev.type === 'enrage') {
      this.kick(3, 140);
    } else if (ev.type === 'skillStart') {
      const sk = SKILLS[ev.skill];
      if (sk) this.toast = { text: sk.name, born: now, ult: false };
      const P = this.pal();
      this.pushFx({ kind: 'sigil', x: HERO_X * this.sx, y: this.groundY, r: 34 * this.u, col: P.main, born: this.clock, dur: 520 });
      this.parts.burst(this.clock, HERO_X * this.sx, this.groundY - 30 * this.u, 8, 50, 520, 2, P.hot, PK.DOT, -90, Math.PI, -Math.PI / 2);
      return 'cast';
    } else if (ev.type === 'ultStart') {
      this.startUlt(ev, battle, s, now);
      return 'ult';
    } else if (ev.type === 'kill') {
      const e = battle.enemies.find((q) => q.uid === ev.enemy.uid);
      const x = this.ex(e ? e.x : 220) * this.sx, y = this.groundY - 40 * this.u;
      this.pushFx({ kind: 'ring', x, y: this.groundY, r0: 6 * this.u, r1: (ev.enemy.boss ? 90 : 40) * this.u, col: ev.enemy.boss ? '#EDBD68' : '#C8BAC9', w: 2, flat: 0.32, born: this.clock, dur: 420 });
      this.parts.burst(this.clock, x, y, ev.enemy.boss ? 28 : 12, ev.enemy.boss ? 220 : 140, 520, 2.4, ev.enemy.boss ? '#EDBD68' : '#C8BAC9', PK.SHARD, 160);
      if (ev.enemy.boss) { this.kick(4, 220); this.flashScreen('#FFE6A8', 0.3, 260); }
    } else if (ev.type === 'buff') {
      this.buffFx(ev, battle);
      return 'buff';
    }
    return null;
  }

  // ---------- hero hits: combo, hit feel, skill & ult effects ----------
  heroHit(ev, battle, s, now) {
    const a = ev.action;
    const motion = !s.reduceMotion;
    const u = this.u, gy = this.groundY;
    const X = this.ex(ev.x ?? 220) * this.sx, Y = gy - 52 * u;
    const P = this.pal();
    const show = s.damageNumbers === 'all' || (s.damageNumbers === 'crit' && ev.crit);
    if (a === 'dot') {
      const col = DOT_COL[ev.skill] || '#8BE07A';
      if (show) this.pushNumber({ x: ev.x ?? 220, y: 0.47, text: fmt(ev.dmg), dot: col, born: now, dx: 0 });
      for (let i = 0; i < 4; i++) this.parts.spawn(this.clock + i * 40, X + (Math.random() - 0.5) * 22 * u, Y + (Math.random() - 0.2) * 24 * u, 0, -30 - Math.random() * 30, 520, 3 + Math.random() * 2, col, PK.BUBBLE, -20);
      return null;
    }
    if (a === 'pet') {
      if (show) this.pushNumber({ x: ev.x ?? 220, y: 0.42, text: fmt(ev.dmg), born: now + 200, dx: 0 });
      this.pushFx({ kind: 'petshot', x: X, born: this.clock, dur: 260 }); this.petHitAt = now;
      return null;
    }
    // combo counter: chained hero hits, cleared after COMBO_RESET ms without one
    const C = this.counter;
    if (now - C.last > COMBO_RESET) C.n = 0;
    C.n++; C.last = now; C.pop = now;

    const ac = battle.hero.action;
    const step = a === 'attack' ? this.comboStep(ac, now) : 0;
    const finisher = step === 3;
    const proj = a !== 'combo' && a !== 'counter' ? this.projKind(ev) : null;
    const delay = proj ? FLIGHT : 0;
    const land = now + delay, landC = this.clock + delay;
    const ult = a === 'ult';
    // weight drives shake / hit-stop / knockback / particles
    let w = a === 'attack' ? (finisher ? 2.2 : step === 2 ? 1.3 : 1) : a === 'skill' ? 2 : ult ? 3 : a === 'counter' ? 1.6 : 0.7;
    if (ev.crit) w += 1;
    if (show) this.pushNumber({ x: ev.x ?? 220, y: 0.42, text: fmt(ev.dmg), crit: ev.crit, big: finisher || ult, born: land, dx: (Math.random() - 0.5) * 14 });

    // hit-stop (render only), longer on crit / finisher / ult
    const stop = Math.min(120, (a === 'combo' ? 0 : 40) + (finisher ? 25 : 0) + (ev.crit ? 25 : 0) + (a === 'skill' ? 15 : 0) + (ult ? 50 : 0));
    if (stop) this.hitStop(stop, land);
    if (a !== 'combo') this.kick(Math.min(7, 0.8 + w * 1.1), 70 + w * 35, land);
    if (motion) this.kb.set(ev.target, { at: land, amp: Math.min(14, 3 + w * 3) });
    if (this.kb.size > 40) this.kb.clear();

    // projectiles (visual only — the damage was applied at the impact event)
    if (proj) this.spawnProj(proj, X, step, ev.crit, ev, now);

    // generic impact sparks in class colour
    const sparks = Math.round((ev.crit ? 12 : 6) * Math.min(2, w) * (motion ? 1 : 0.5));
    this.parts.burst(landC, X - 4, Y, sparks, 150 + w * 40, 300, 2.4, ev.crit ? P.hot : P.main, PK.STREAK, 0, 2.4, Math.PI);
    if (ev.crit) { this.parts.burst(landC, X, Y, 4, 60, 420, 6, '#FFE6A8', PK.STAR); this.pushFx({ kind: 'ring', x: X, y: Y, r0: 4 * u, r1: 34 * u, col: '#FFE6A8', w: 3, flat: 1, born: landC, dur: 260 }); }

    let cue = ev.crit ? 'crit' : 'hit';
    if (a === 'attack') { this.attackFx(step, X, Y, u, P, landC, ev.crit); if (finisher) cue = ev.crit ? 'crit' : 'finisher'; else if (step === 2) cue = ev.crit ? 'crit' : 'hit2'; }
    else if (a === 'combo') this.pushFx({ kind: 'blade', x1: X - 16 * u, y1: Y + 14 * u, x2: X + 14 * u, y2: Y - 16 * u, w: 4 * u, col: P.main, born: landC + 60, dur: 180 });
    else if (a === 'counter') this.pushFx({ kind: 'slash', x: X - 8 * u, y: Y, r: 36 * u, a0: -2.1, a1: 0.8, w: 9 * u, col: '#E06A86', core: '#FFD0DA', born: landC, dur: 240 });
    else if (a === 'skill') { this.skillFx(ev, battle, X, Y, u, P, landC, ac); cue = ev.crit ? 'crit' : 'skill'; }
    else if (ult) { cue = this.ultHitFx(ev, battle, X, Y, u, P, landC, s) || (ev.crit ? 'crit' : 'hit'); }
    return cue;
  }

  // which combo step the given basic-attack action is (decided once per swing)
  comboStep(ac, now) {
    const c = this.combo;
    if (!ac || ac.kind !== 'attack') return c.step || 1;
    if (ac.start !== c.actStart) {
      c.actStart = ac.start;
      c.step = now - c.lastSwing > COMBO_RESET ? 1 : (c.step % 3) + 1;
      c.lastSwing = now;
    }
    return c.step;
  }

  // which projectile a hero hit uses: mage star bolt, archer arrow; rogue throws daggers on skills only
  projKind(ev) {
    const c = this.heroCls;
    if (ev.action === 'skill' && ev.skill in PROJ_SKILL) return PROJ_SKILL[ev.skill];
    if (c === 'mage' && (ev.ranged || ev.action === 'attack' || ev.action === 'skill')) return ev.action === 'ult' ? null : this.heroBranch === 'warlock' ? 'hex' : 'bolt';
    if (c === 'archer' && ev.action !== 'ult') return 'arrow';
    if (c === 'rogue' && ev.action === 'skill') return 'dagger';
    return null;
  }

  spawnProj(proj, X, step, crit, ev, now) {
    const c = this.clock;
    if (ev.action === 'attack' && step === 2) {
      // double bolt / quick double shot: a second (visual) projectile
      this.pushFx({ kind: 'proj', proj, x: X, yoff: -7, born: c, dur: FLIGHT, crit });
      this.pushFx({ kind: 'proj', proj, x: X, yoff: 7, born: c + 60, dur: FLIGHT, crit });
    } else if (ev.action === 'attack' && step === 3) {
      this.pushFx({ kind: 'proj', proj: proj === 'arrow' ? 'arrowC' : 'star', x: X, yoff: 0, born: c, dur: FLIGHT, crit, big: true });
    } else if (ev.skill === 'a_multi') {
      this.ultHits = this.skillKey === this.keyOf(ev) ? this.ultHits + 1 : 0;
      this.pushFx({ kind: 'proj', proj, x: X, yoff: (this.ultHits % 5 - 2) * 5, born: c + (this.ultHits % 5) * 30, dur: FLIGHT, crit });
    } else this.pushFx({ kind: 'proj', proj, x: X, yoff: 0, born: c, dur: FLIGHT, crit });
  }

  attackFx(step, X, Y, u, P, t0, crit) {
    const cls = this.heroCls;
    const core = crit ? '#FFE6A8' : '#FFFFFF';
    if (cls === 'warrior') {
      if (step === 1) this.pushFx({ kind: 'slash', x: X - 6 * u, y: Y, r: 34 * u, a0: -2.2, a1: 0.7, w: 9 * u, col: P.main, core, born: t0, dur: 220 });
      else if (step === 2) this.pushFx({ kind: 'slash', x: X - 6 * u, y: Y - 4 * u, r: 36 * u, a0: 2.3, a1: -0.6, w: 10 * u, col: P.main, core, born: t0, dur: 230 });
      else {
        this.pushFx({ kind: 'slash', x: X - 4 * u, y: Y - 6 * u, r: 50 * u, a0: -2.7, a1: 0.5, w: 16 * u, col: P.hot, core, born: t0, dur: 320 });
        this.pushFx({ kind: 'ring', x: X, y: this.groundY, r0: 8 * u, r1: 56 * u, col: P.hot, w: 3, flat: 0.3, born: t0 + 40, dur: 360 });
        this.parts.burst(t0, X, this.groundY - 4, 10, 170, 520, 3, '#C8B49A', PK.SHARD, 420, 1.6, -Math.PI / 2);
      }
    } else if (cls === 'rogue') {
      if (step === 1) {
        this.pushFx({ kind: 'blade', x1: X - 20 * u, y1: Y - 14 * u, x2: X + 18 * u, y2: Y + 12 * u, w: 5 * u, col: P.main, core, born: t0, dur: 170 });
        this.pushFx({ kind: 'blade', x1: X - 18 * u, y1: Y - 2 * u, x2: X + 20 * u, y2: Y + 22 * u, w: 5 * u, col: P.main, core, born: t0 + 60, dur: 170 });
      } else if (step === 2) {
        for (let i = 0; i < 4; i++) {
          const a = -0.9 + i * 0.6 + (Math.random() - 0.5) * 0.4, L = 20 * u;
          this.pushFx({ kind: 'blade', x1: X - Math.cos(a) * L, y1: Y - Math.sin(a) * L, x2: X + Math.cos(a) * L, y2: Y + Math.sin(a) * L, w: 4 * u, col: P.main, core, born: t0 + i * 38, dur: 150 });
        }
      } else {
        this.pushFx({ kind: 'blade', x1: X - 34 * u, y1: Y - 30 * u, x2: X + 30 * u, y2: Y + 28 * u, w: 9 * u, col: P.hot, core, born: t0, dur: 300 });
        this.pushFx({ kind: 'blade', x1: X - 34 * u, y1: Y + 28 * u, x2: X + 30 * u, y2: Y - 30 * u, w: 9 * u, col: P.hot, core, born: t0 + 70, dur: 300 });
        this.parts.burst(t0 + 70, X, Y, 10, 200, 380, 2.6, P.hot, PK.SHARD);
      }
    } else if (cls === 'mage') {
      if (step === 3) {
        this.pushFx({ kind: 'nova', x: X, y: Y, r: 46 * u, col: P.main, born: t0, dur: 380 });
        this.parts.burst(t0, X, Y, 10, 160, 520, 5, P.hot, PK.STAR, 0);
      } else this.pushFx({ kind: 'spark', x: X, y: Y, col: P.main, crit, img: this.heroBranch === 'warlock' ? 'hit_poison' : 'hit_magic', born: t0, dur: 220 });
    } else {   // archer
      if (step === 3) {
        this.pushFx({ kind: 'ring', x: X, y: Y, r0: 6 * u, r1: 44 * u, col: P.main, w: 3, flat: 1, born: t0, dur: 320 });
        this.parts.burst(t0, X, Y, 12, 260, 340, 3, P.hot, PK.STREAK, 0, 1.2, 0);
      } else this.pushFx({ kind: 'spark', x: X, y: Y, col: P.main, crit, born: t0, dur: 220 });
    }
  }

  keyOf(ev) { return ev.skill + ':' + Math.round(ev.t / 50); }

  // skill impact: one big effect per cast + a small one per hit
  skillFx(ev, battle, X, Y, u, P, t0, ac) {
    const key = this.keyOf(ev);
    const first = key !== this.skillKey;
    this.skillKey = key;
    const id = ev.skill, gy = this.groundY, hx = HERO_X * this.sx, hy = gy - 52 * u;
    const enemiesX = () => battle.enemies.filter((e) => e.state !== 'dying').map((e) => this.ex(e.x) * this.sx);
    switch (id) {
      case 'strike': case 'berserkStrike': case 'r_execute': {
        const red = id !== 'strike';
        if (id === 'r_execute') {
          this.pushFx({ kind: 'blade', x1: X - 44 * u, y1: Y - 40 * u, x2: X + 40 * u, y2: Y + 36 * u, w: 12 * u, col: '#FF5070', core: '#FFE0E6', born: t0, dur: 360 });
          this.pushFx({ kind: 'blade', x1: X - 44 * u, y1: Y + 36 * u, x2: X + 40 * u, y2: Y - 40 * u, w: 12 * u, col: '#FF5070', core: '#FFE0E6', born: t0 + 80, dur: 360 });
        } else this.pushFx({ kind: 'slash', x: X - 6 * u, y: Y - 8 * u, r: 54 * u, a0: -2.6, a1: 0.6, w: 18 * u, col: red ? '#FF6A6A' : '#EDBD68', core: '#FFF6DE', born: t0, dur: 340 });
        this.pushFx({ kind: 'ring', x: X, y: gy, r0: 8 * u, r1: 60 * u, col: red ? '#FF6A6A' : '#EDBD68', w: 3, flat: 0.3, born: t0 + 40, dur: 380 });
        this.parts.burst(t0, X, Y, 14, 240, 420, 3, red ? '#FF8C8C' : '#FFE6A8', PK.SHARD);
        break;
      }
      case 'shieldCharge': case 'w_judgement':
        if (first) {
          for (let i = 0; i < 10; i++) this.parts.spawn(t0 - 120 + i * 10, hx + Math.random() * (X - hx), hy + (Math.random() - 0.5) * 50 * u, 520, 0, 200, 4, '#A9C8FF', PK.STREAK);
          this.pushFx({ kind: 'dome', col: '#A9C8FF', born: t0, dur: 700 });
        }
        if (id === 'w_judgement') this.pushFx({ kind: 'pillar', x: X, col: '#FFE6A8', born: t0, dur: 480 });
        this.pushFx({ kind: 'ring', x: X, y: Y, r0: 8 * u, r1: 46 * u, col: '#A9C8FF', w: 4, flat: 1, born: t0, dur: 300 });
        break;
      case 'w_whirl':
        if (first) this.pushFx({ kind: 'whirl', x: hx, y: hy, r: 58 * u, col: P.main, born: t0 - 80, dur: 420 });
        this.pushFx({ kind: 'slash', x: X - 4 * u, y: Y, r: 32 * u, a0: 2.6, a1: -0.4, w: 9 * u, col: P.main, core: '#FFFFFF', born: t0, dur: 240 });
        break;
      case 'm_fireball':
        this.pushFx({ kind: 'ring', x: X, y: Y, r0: 6 * u, r1: 48 * u, col: '#FF9A4A', w: 5, flat: 1, born: t0, dur: 340 });
        this.parts.burst(t0, X, Y, 16, 200, 460, 3.6, '#FFB050', PK.DOT, 60);
        this.parts.burst(t0 + 60, X, Y - 10, 6, 40, 700, 9, 'rgba(60,40,40,0.9)', PK.SMOKE, -40);
        break;
      case 'm_frost': case 'm_blizzard':
        if (first) {
          this.pushFx({ kind: 'ring', x: (hx + this.cssW) / 2, y: gy, r0: 10 * u, r1: this.cssW * 0.5, col: '#AEE4FF', w: 4, flat: 0.2, born: t0 - 60, dur: 520 });
          this.pushFx({ kind: 'ring', x: (hx + this.cssW) / 2, y: gy, r0: 4 * u, r1: this.cssW * 0.36, col: '#EAF6FF', w: 2, flat: 0.2, born: t0, dur: 480 });
          if (id === 'm_blizzard') for (let i = 0; i < 40; i++) { const x0 = hx + 40 * u + Math.random() * (this.cssW - hx); this.parts.spawn(t0 - 200 + Math.random() * 500, x0, this.topInset + Math.random() * 30, -50 - Math.random() * 40, 120, 900, 1.5 + Math.random() * 1.5, '#EAF6FF', PK.DOT, 120); }
        }
        this.parts.burst(t0, X, gy - 14 * u, 8, 160, 520, 4, '#CDEFFF', PK.SHARD, 260, 1.4, -Math.PI / 2);
        break;
      case 'm_chain':
        if (first) {
          const xs = enemiesX();
          const pts = [hx + 18 * u, hy - 10 * u];
          for (const x of xs.sort((p, q) => p - q)) pts.push(x, hy + (Math.random() - 0.5) * 16 * u);
          this.pushFx({ kind: 'chain', pts, col: '#C9E2FF', born: t0, dur: 360, seed: Math.random() * 1000 });
        }
        this.parts.burst(t0, X, Y, 6, 180, 260, 2.4, '#E6F2FF', PK.STREAK);
        break;
      case 'm_curse':
        this.pushFx({ kind: 'sigil', x: X, y: gy, r: 30 * u, col: '#C08CFF', born: t0, dur: 900 });
        for (let i = 0; i < 6; i++) this.parts.spawn(t0 + i * 50, X + (Math.random() - 0.5) * 30 * u, gy - 6, 0, -40, 800, 3, '#C08CFF', PK.BUBBLE, -30);
        break;
      case 'm_drain':
        this.pushFx({ kind: 'beam', x1: X, y1: Y, x2: hx + 10 * u, y2: hy, col: '#8BE07A', w: 6 * u, born: t0, dur: 520, pull: true });
        for (let i = 0; i < 10; i++) this.parts.spawn(t0 + i * 30, X, Y + (Math.random() - 0.5) * 20 * u, (hx - X) * 2.2, 0, 420, 2.6, '#B8FFB0', PK.DOT);
        break;
      case 'a_aim': case 'r_stab':
        this.pushFx({ kind: 'ring', x: X, y: Y, r0: 4 * u, r1: 36 * u, col: P.hot, w: 3, flat: 1, born: t0, dur: 260 });
        this.parts.burst(t0, X, Y, 10, 240, 300, 3, P.hot, PK.STREAK, 0, 1.0, 0);
        break;
      case 'a_multi':
        this.parts.burst(t0, X, Y, 4, 150, 220, 2, P.main, PK.STREAK);
        break;
      case 'a_pierce': case 'a_snipe':
        if (first) {
          if (id === 'a_snipe') this.pushFx({ kind: 'reticle', x: X, y: Y, born: t0 - 260, dur: 520 });
          this.pushFx({ kind: 'beam', x1: hx + 20 * u, y1: hy - 6 * u, x2: id === 'a_pierce' ? this.cssW + 20 : X, y2: hy - 2 * u, col: id === 'a_snipe' ? '#FFE6A8' : '#C9F0D8', w: (id === 'a_snipe' ? 5 : 8) * u, born: t0 - 20, dur: 320 });
        }
        this.parts.burst(t0, X, Y, 10, 280, 300, 3, id === 'a_snipe' ? '#FFE6A8' : '#C9F0D8', PK.STREAK, 0, 0.9, 0);
        break;
      case 'a_beast': case 'a_pack':
        for (let i = 0; i < 3; i++) this.pushFx({ kind: 'blade', x1: X - 18 * u + i * 9 * u, y1: Y - 22 * u, x2: X - 6 * u + i * 9 * u, y2: Y + 18 * u, w: 5 * u, col: '#F0B080', core: '#FFF0E0', born: t0 + i * 25, dur: 240 });
        this.parts.burst(t0, X, Y, 6, 140, 360, 2.4, '#F08080', PK.DOT, 200);
        break;
      case 'r_poison':
        this.parts.burst(t0, X, Y, 14, 160, 480, 3, '#8BE07A', PK.DOT, 260);
        for (let i = 0; i < 6; i++) this.parts.spawn(t0 + i * 60, X + (Math.random() - 0.5) * 24 * u, Y + 10 * u, 0, -36, 700, 3.4, '#8BE07A', PK.BUBBLE, -20);
        break;
      case 'r_smoke': case 'r_illusion':
        if (first) {
          for (let i = 0; i < 18; i++) this.parts.spawn(t0 - 100 + i * 15, hx + Math.random() * (this.cssW - hx), gy - Math.random() * 40 * u, (Math.random() - 0.5) * 30, -10, 1100, 16 * u + Math.random() * 10, 'rgba(70,60,90,0.95)', PK.SMOKE);
          if (id === 'r_illusion') { this.pushFx({ kind: 'ghost', dx: -26, born: t0 - 160, dur: 520 }); this.pushFx({ kind: 'ghost', dx: 30, born: t0 - 100, dur: 520 }); }
        }
        this.pushFx({ kind: 'blade', x1: X - 22 * u, y1: Y - 18 * u, x2: X + 20 * u, y2: Y + 16 * u, w: 5 * u, col: '#D6B8F0', core: '#FFFFFF', born: t0, dur: 200 });
        break;
      case 'r_shadowstrike': {
        this.ultHits = first ? 0 : this.ultHits + 1;
        const i = this.ultHits, a = -1.2 + i * 1.1, L = 30 * u;
        this.pushFx({ kind: 'blade', x1: X - Math.cos(a) * L, y1: Y - Math.sin(a) * L, x2: X + Math.cos(a) * L, y2: Y + Math.sin(a) * L, w: 7 * u, col: '#9A6CD8', core: '#F0E6FF', born: t0 + i * 70, dur: 220 });
        this.parts.burst(t0 + i * 70, X, Y, 5, 120, 500, 10 * u, 'rgba(40,30,60,0.9)', PK.SMOKE);
        break;
      }
      default:
        this.pushFx({ kind: 'slash', x: X - 8 * u, y: Y, r: 40 * u, a0: -2.3, a1: 0.7, w: 12 * u, col: P.hot, core: '#FFFFFF', born: t0, dur: 260 });
    }
  }

  buffFx(ev, battle) {
    const u = this.u, gy = this.groundY, hx = HERO_X * this.sx, c = this.clock;
    const id = ev.skill;
    if (ev.shield) {
      this.pushFx({ kind: 'dome', col: '#B9A0FF', born: c, dur: 900, big: true });
      this.parts.burst(c, hx, gy - 52 * u, 12, 120, 600, 4, '#D9CCFF', PK.STAR);
    } else if (ev.evade) {
      for (let i = 0; i < 14; i++) this.parts.spawn(c + i * 12, hx + (Math.random() - 0.5) * 50 * u, gy - Math.random() * 90 * u, (Math.random() - 0.5) * 40, -15, 900, 12 * u + Math.random() * 8, 'rgba(50,40,70,0.95)', PK.SMOKE);
      this.pushFx({ kind: 'ghost', dx: id === 'a_leap' ? 22 : -24, born: c, dur: 520 });
    } else if (id === 'secondWind') {
      this.pushFx({ kind: 'column', x: hx, col: '#8BE07A', born: c, dur: 900 });
    } else {
      this.pushFx({ kind: 'column', x: hx, col: id === 'warCry' ? '#FF7A5A' : '#EDBD68', born: c, dur: 900 });
      this.pushFx({ kind: 'ring', x: hx, y: gy, r0: 10 * u, r1: 70 * u, col: '#EDBD68', w: 3, flat: 0.3, born: c, dur: 520 });
      for (let i = 0; i < 14; i++) this.parts.spawn(c + i * 30, hx + (Math.random() - 0.5) * 50 * u, gy - Math.random() * 10, 0, -70 - Math.random() * 40, 800, 2.2, id === 'warCry' ? '#FF9A6A' : '#FFE6A8', PK.DOT, -30);
      if (id === 'warCry') this.kick(2.5, 200);
    }
  }

  // ---------- ultimate ----------
  startUlt(ev, battle, s, now) {
    const sk = SKILLS[ev.skill];
    const name = sk ? sk.name : '궁극기';
    const simple = !!s.reduceMotion;
    this.cut = { t0: ev.t, name, born: now, skipped: false, simple, impact: false, cls: this.heroCls };
    this.ultHits = 0;
    if (simple) { this.toast = { text: name, born: now, ult: true }; return; }
    const sp = s.speed === 2 ? 2 : 1;
    const u = this.u, gy = this.groundY, hx = HERO_X * this.sx;
    const c = this.clock;
    const xs = battle.enemies.filter((e) => e.state !== 'dying').map((e) => this.ex(e.x) * this.sx);
    if (!xs.length) xs.push(this.cssW * 0.7);
    const cls = this.heroCls;
    this.pushFx({ kind: 'charge', x: hx, y: gy - 60 * u, col: this.pal().main, born: c, dur: 700 / sp });
    if (cls === 'mage') {
      // three meteors land around the 700 ms impact (visual timing only)
      for (let i = 0; i < 3; i++) {
        const x = xs[i % xs.length] + (i >= xs.length ? (i - 1) * 24 * u : 0);
        this.pushFx({ kind: 'meteor', x, y: gy, born: c + (420 + i * 70) / sp, dur: 640, fall: 300 / sp, col: this.heroBranch === 'warlock' ? '#7CE08A' : '#FF9A4A', r: 16 * u });
      }
    } else if (cls === 'archer') {
      const x0 = Math.min(...xs) - 30 * u, x1 = Math.max(...xs) + 40 * u;
      for (let i = 0; i < 46; i++) {
        const x = x0 + Math.random() * (x1 - x0), fall = gy - (this.topInset + 10);
        this.parts.spawn(c + (430 + Math.random() * 520) / sp, x + 60, this.topInset + 4, -200 * sp, (fall / 0.28) * sp * 0.8, 280 / sp + 60, 4.5, '#D9C7A3', PK.ARROW, 1200 * sp);
      }
    } else if (cls === 'rogue') {
      this.pushFx({ kind: 'bladering', x: hx, y: gy - 52 * u, r: 50 * u, born: c, dur: 700 / sp });
    }
  }

  ultHitFx(ev, battle, X, Y, u, P, t0, s) {
    const cut = this.cut;
    const first = !cut || !cut.impact;
    if (cut) cut.impact = true;
    const motion = !s.reduceMotion;
    const cls = this.heroCls, gy = this.groundY, hx = HERO_X * this.sx;
    const i = this.ultHits++;
    if (first) {
      this.flashScreen('#FFFFFF', motion ? 0.6 : 0.3, 240);
      if (!motion) return 'boom';
      this.kick(8, 420);
      this.hitStop(110, performance.now());
      this.slowUntil = performance.now() + 240;
      if (cls === 'warrior') {
        this.pushFx({ kind: 'wave', x0: hx + 20 * u, y: gy - 50 * u, r: 70 * u, col: P.hot, born: t0, dur: 420 });
        this.parts.burst(t0, hx + 60 * u, gy - 50 * u, 24, 320, 640, 6, '#FFE6A8', PK.STAR, 0, 1.4, 0);
      } else if (cls === 'mage') {
        this.pushFx({ kind: 'nova', x: X, y: Y, r: 120 * u, col: P.main, born: t0, dur: 520 });
      } else if (cls === 'archer') {
        this.pushFx({ kind: 'ring', x: X, y: gy, r0: 10 * u, r1: 140 * u, col: P.main, w: 4, flat: 0.3, born: t0, dur: 520 });
      } else {
        this.pushFx({ kind: 'blade', x1: X - 70 * u, y1: Y - 60 * u, x2: X + 64 * u, y2: Y + 56 * u, w: 16 * u, col: '#FF6F8E', core: '#FFFFFF', born: t0 + 420, dur: 380 });
        this.pushFx({ kind: 'blade', x1: X - 70 * u, y1: Y + 56 * u, x2: X + 64 * u, y2: Y - 60 * u, w: 16 * u, col: '#FF6F8E', core: '#FFFFFF', born: t0 + 480, dur: 380 });
      }
    }
    if (!motion) return null;
    if (cls === 'warrior') {
      this.pushFx({ kind: 'slash', x: X - 6 * u, y: Y - 6 * u, r: 58 * u, a0: -2.8, a1: 0.6, w: 18 * u, col: '#EDBD68', core: '#FFFFFF', born: t0 + 80, dur: 360 });
      this.parts.burst(t0 + 80, X, Y, 8, 200, 520, 5, '#FFE6A8', PK.STAR);
    } else if (cls === 'mage') {
      this.parts.burst(t0, X, Y + 10 * u, 6, 220, 420, 3, '#FFB050', PK.DOT, 300);
    } else if (cls === 'archer') {
      this.parts.burst(t0 + (i % 5) * 60, X, Y, 4, 160, 260, 2.4, P.main, PK.STREAK);
    } else {
      // thousand blades: each hit is a blade streaking in from a different angle
      const a = i * 2.39996, L = 46 * u, d = t0 + i * 34;
      this.pushFx({ kind: 'blade', x1: X - Math.cos(a) * L, y1: Y - Math.sin(a) * L * 0.8, x2: X + Math.cos(a) * L, y2: Y + Math.sin(a) * L * 0.8, w: 5 * u, col: i % 3 ? '#F0C6D2' : '#FF6F8E', core: '#FFFFFF', born: d, dur: 160 });
      if (i % 3 === 0) this.parts.burst(d, X, Y, 4, 180, 260, 2.4, '#FF8FA6', PK.STREAK);
    }
    return first ? 'boom' : null;
  }

  // tap on the battle: skip the cut-in banner (the ultimate itself still plays)
  skipCutin() {
    if (this.cut && !this.cut.simple && !this.cut.skipped) { this.cut.skipped = true; return true; }
    return false;
  }

  pushNumber(n) { this.numbers.push(n); if (this.numbers.length > 24) this.numbers.shift(); }
  pushFx(f) { this.fx.push(f); if (this.fx.length > FX_CAP) this.fx.shift(); }
  flashScreen(col, a, ms) { this.pushFx({ kind: 'flash', col, a, born: this.clock, dur: ms }); }
  hitStop(ms, at = performance.now()) {
    const s = this.getSettings();
    if (s.reduceMotion) return;
    if (!this.pendingStop || at + ms > this.pendingStop.at + this.pendingStop.ms) this.pendingStop = { at, ms };
  }
  kick(amp, ms, at = performance.now()) {
    const s = this.getSettings();
    if (!s.shake || s.reduceMotion) return;
    const now = performance.now();
    // keep the stronger of the running and the new shake
    const cur = now < this.shake.until ? this.shake.amp * (this.shake.until - now) / this.shake.ms : 0;
    if (amp >= cur) this.shake = { until: Math.max(now, at) + ms, amp, ms };
  }

  // ---------- frame ----------
  draw(battle, { alpha = 0, region = null, bgId = null, bgTint = null, branch = null, cls = 'warrior', tier = 1, heroTint = 0, label = null, victory = false }) {
    this.heroTier = tier;
    this.heroTint = heroTint;
    this.heroCls = cls;
    this.heroBranch = branch;
    const ctx = this.ctx;
    const W = this.cssW, H = this.cssH;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.lastNow));
    this.frameMs = this.frameMs * 0.9 + dt * 0.1;
    this.lastNow = now;
    this.clock += now < this.slowUntil ? dt * 0.35 : dt;
    const s = this.getSettings();
    this.preloadPortrait(cls, branch, tier);
    ctx.save();
    if (now < this.shake.until) {
      const a = this.shake.amp * Math.min(1, (this.shake.until - now) / this.shake.ms + 0.25);
      ctx.translate((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    }
    this.drawBg(bgId || (region && region.bg) || 'meadow', bgTint ?? (region && !bgId ? region.bgTint : null));
    if (!battle) { ctx.restore(); return; }
    // hit-stop: sprites are drawn at a frozen battle time; the simulation keeps going
    if (this.pendingStop && now >= this.pendingStop.at) {
      if (now >= this.freezeUntil) this.frozenT = battle.t;
      this.freezeUntil = Math.max(this.freezeUntil, this.pendingStop.at + this.pendingStop.ms);
      this.pendingStop = null;
    }
    this.rt = now < this.freezeUntil ? Math.min(this.frozenT, battle.t) : battle.t;
    const gy = this.groundY;
    const sx = this.sx;
    const lerp = (a, b) => a + (b - a) * Math.min(1, alpha);

    // telegraph markers first (on the ground, under the figures)
    for (const e of battle.enemies) if (e.state === 'telegraph' || e.pending) this.drawTelegraph(e, battle, this.ex(lerp(e.px, e.x)) * sx, gy, now, s);

    // enemies back to front (reused array, no per-frame allocation)
    const sorted = this._sorted; sorted.length = 0;
    for (const e of battle.enemies) sorted.push(e);
    sorted.sort(byXDesc);
    for (const e of sorted) this.drawEnemy(e, battle, this.ex(lerp(e.px, e.x)) * sx, gy, s, now);

    this.drawDim(battle);
    this.drawHero(battle, HERO_X * sx, gy, branch, s, victory);
    this.drawPet(battle, HERO_X * sx, gy, s, now);

    // fx & numbers
    this.drawFx(this.clock, gy, sx, s);
    this.parts.draw(ctx, this.clock);
    this.drawNumbers(now, sx, H, s);
    this.drawCombo(now, battle);
    this.drawToast(now, battle);
    this.drawCut(battle, now);
    this.drawFlash(this.clock);

    // boss / session header
    const boss = battle.enemies.find((e) => e.boss);
    if (boss) this.drawBossBar(boss, battle);
    if (label && !this.immersive) this.drawLabel(label);   // the immersive HUD shows it
    ctx.restore();
  }

  drawBg(id, tint = null) {
    const ctx = this.ctx;
    const W = this.cssW, H = this.cssH;
    const key = id + ':' + W + 'x' + H + '@' + this.dpr + ':' + (tint || 0);
    if (this.bgKey !== key || !this.bgCache) {
      const m = bgMeta(id);
      const img = m && ready(m.file);
      if (img) {
        const c = document.createElement('canvas');
        c.width = Math.round(W * this.dpr); c.height = Math.round(H * this.dpr);
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        const sc = Math.max(c.width / img.width, c.height / img.height);
        const dw = img.width * sc, dh = img.height * sc;
        // align the art's ground line (80%) with the stage ground (80%)
        let y0 = c.height * GROUND - dh * (m.groundRatio || GROUND);
        y0 = Math.min(0, Math.max(c.height - dh, y0));
        if (tint) x.filter = `hue-rotate(${tint}deg) saturate(1.15)`;   // placeholder region look, baked once
        x.drawImage(img, (c.width - dw) / 2, y0, dw, dh);
        x.filter = 'none';
        // scrim for legibility of numbers/HP bars on bright skies
        const g = x.createLinearGradient(0, 0, 0, c.height);
        g.addColorStop(0, 'rgba(16,13,24,0.35)'); g.addColorStop(0.35, 'rgba(16,13,24,0)'); g.addColorStop(1, 'rgba(16,13,24,0.25)');
        x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
        this.bgCache = c; this.bgKey = key;
      } else {
        ctx.fillStyle = '#1b1526'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#2a2236'; ctx.fillRect(0, this.groundY, W, H - this.groundY);
        return;
      }
    }
    ctx.drawImage(this.bgCache, 0, 0, W, H);
  }

  spriteDims(m, extraScale = 1) {
    const f = this.fit * 0.5 * extraScale * this.figScale;   // runtime art is stored at 2x
    return { w: m.size[0] * f, h: m.size[1] * f, px: m.pivot[0] * f, py: m.pivot[1] * f, f };
  }

  // 동료: stands (or hovers) just ahead of the hero, bobbing; a small lunge on attack
  drawPet(battle, hx, gy, s, now) {
    const pet = battle.heroCfg && battle.heroCfg.pet;
    this.petPos = null;
    if (!pet) return;
    const m = petMeta(pet.id);
    if (!m) return;
    const img = ready(m.file);
    if (!img) { loadImage(m.file).catch(() => {}); return; }
    const ctx = this.ctx;
    const d = this.spriteDims(m);
    const motion = !s.reduceMotion;
    const bob = motion ? Math.sin(now / 420) * 3 : 0;
    const lunge = motion && this.petHitAt && now - this.petHitAt < 220 ? 8 * Math.sin(((now - this.petHitAt) / 220) * Math.PI) : 0;
    const x = hx + 62 * this.fit * this.figScale + lunge;
    const y = gy - (m.flying ? 70 : 2) * this.fit * this.figScale + (m.flying ? bob : bob * 0.3);
    const sc = scaledImage(img, d.w * this.dpr, d.h * this.dpr, m.file);
    ctx.save();
    ctx.globalAlpha = battle.hero.dead ? 0.5 : 1;
    ctx.drawImage(sc, x - d.px, y - d.py, d.w, d.h);
    ctx.restore();
    this.petPos = { x: x + d.w * 0.25, y: y - d.h * 0.5 };
  }

  drawHero(battle, x, gy, branch, s, victory) {
    const ctx = this.ctx;
    const h = battle.hero;
    const frames = heroFrames(branch, this.heroCls || 'warrior', this.heroTier || 1);
    const t = this.rt;
    let pose = 'idle', dx = 0, dy = 0, alpha = 1, rot = 0, scl = 1, step = 0;
    const ac = h.action;
    const motion = !s.reduceMotion;
    const ranged = this.heroCls === 'mage' || this.heroCls === 'archer';
    if (h.dead) { pose = 'hit'; alpha = 0.55; rot = -0.08; dy = 6; }
    else if (victory) pose = 'victory';
    else if (ac) {
      const rel = t - ac.start;
      const imp = ac.impactAt - ac.start;
      if (ac.kind === 'attack') {
        step = this.comboStep(ac, performance.now());
        const P = COMBO[step];
        pose = rel < imp ? P.wind : rel < imp + P.hold ? P.hit : P.rec;
        const L = P.lunge * (ranged ? 0.35 : 1), B = P.back * (ranged ? 0.6 : 1);
        if (motion) {
          dx = rel < imp ? B * (rel / imp) : rel < imp + P.hold ? L : L * Math.max(0, 1 - (rel - imp - P.hold) / 200);
          if (step === 3) { rot = rel < imp ? -0.05 * (rel / imp) : rel < imp + P.hold ? 0.03 : 0; scl = rel >= imp && rel < imp + P.hold ? P.scale : 1; }
          if (step === 2 && rel >= imp && rel < imp + P.hold) dy = -2;
        }
      } else if (ac.kind === 'ult') {
        pose = rel < imp ? 'cast' : rel < imp + 220 ? 'thrust' : 'recovery';
        if (motion) { dy = rel < imp ? -5 * Math.sin(Math.min(1, rel / imp) * Math.PI * 0.5) : 0; dx = rel >= imp ? 16 * Math.max(0, 1 - (rel - imp) / 360) : 0; scl = rel >= imp && rel < imp + 220 ? 1.06 : 1; }
      } else {
        pose = rel < imp ? 'cast' : rel < imp + 160 ? 'thrust' : 'recovery';
        if (motion && rel >= imp) dx = 12 * Math.max(0, 1 - (rel - imp) / 300);
      }
    } else if (t < h.hitFxUntil) { pose = 'hit'; if (motion) dx = -5; }
    else if (battle.enemies.every((e) => e.state === 'approach') && battle.enemies.length) pose = Math.floor(t / 320) % 2 ? 'step' : 'idle';
    if (h.buffs && h.buffs.evade && battle.t < h.buffs.evade.until && !h.dead) alpha = 0.55;   // 그림자 걸음 / 후방 도약
    // Promoted forms with a key-pose sheet (GPT A01, tier 1) use their own 8 poses.
    // Others have one authored figure per costume: that figure + lunge/trail only
    // (the base poses would change costume mid-swing).
    let m = frames[pose];
    if (branch && frames.promo) m = frames.promo;
    const hf = this.heroTint ? `hue-rotate(${this.heroTint}deg) saturate(1.1)` : '';
    const img = ready(m.file);
    if (!img) loadImage(m.file);   // class change / promotion: load the new figure on first use
    const d = this.spriteDims(m);
    const breathe = motion && pose === 'idle' ? 1 + 0.012 * Math.sin(t / 420) : 1;
    // buff glow under the hero
    if (h.buffs && h.buffs.atk && battle.t < h.buffs.atk.until) {
      ctx.fillStyle = 'rgba(255,110,80,' + (0.16 + (motion ? 0.06 * Math.sin(t / 140) : 0)) + ')';
      ctx.beginPath(); ctx.ellipse(x, gy + 1, 40 * this.u, 9 * this.u, 0, 0, Math.PI * 2); ctx.fill();
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x + dx, gy + 2, 30 * this.fit * this.figScale, 6 * this.fit * this.figScale, 0, 0, Math.PI * 2); ctx.fill();
    if (img) {
      const sc = scaledImage(img, d.w * this.dpr, d.h * this.dpr, m.file, hf);
      const gh = this.ghost || (this.ghost = { sc: null, d: null, x: 0, gy: 0 });
      gh.sc = sc; gh.d = d; gh.x = x; gh.gy = gy;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + dx, gy + dy);
      ctx.rotate(rot);
      ctx.scale(scl, breathe * scl);
      ctx.drawImage(sc, -d.px, -d.py, d.w, d.h);
      if ((frames.static || (branch && frames.promo)) && ac && ac.kind === 'attack' && motion && !ranged) {
        // weapon trail for single-figure forms; the arc changes with the combo step
        const rel = t - ac.start, imp = ac.impactAt - ac.start;
        if (rel >= imp && rel < imp + 140) {
          const P = this.pal();
          ctx.strokeStyle = P.main; ctx.globalAlpha = 0.85;
          ctx.lineWidth = step === 3 ? 6 : 4; ctx.beginPath();
          if (step === 2) ctx.arc(10, -d.h * 0.45, d.h * 0.42, 0.8, -0.9, true);
          else ctx.arc(10, -d.h * 0.45, d.h * (step === 3 ? 0.5 : 0.42), step === 3 ? -1.8 : -1.1, step === 3 ? 0.9 : 0.6);
          ctx.stroke();
        }
      }
      if (t < h.hitFxUntil && !h.dead) { ctx.globalAlpha = Math.min(0.55, 0.55 * (h.hitFxUntil - t) / 200); ctx.drawImage(whiteOf(sc), -d.px, -d.py, d.w, d.h); }
      ctx.restore();
    } else this.placeholder(x, gy, 46, 140 * this.fit, '세린');
    // shield / guard bubbles while active
    const shieldOn = h.shield && battle.t < h.shield.until;
    if ((shieldOn || h.buffs.guard) && !h.dead) {
      const pulse = motion ? 0.06 * Math.sin(battle.t / 180) : 0;
      ctx.save();
      ctx.strokeStyle = shieldOn ? 'rgba(185,160,255,0.85)' : 'rgba(160,200,255,0.85)';
      ctx.fillStyle = shieldOn ? 'rgba(185,160,255,0.10)' : 'rgba(160,200,255,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, gy - d.h * 0.45, d.w * (0.45 + pulse * 0.3), d.h * (0.55 + pulse * 0.2), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // hero HP bar (above head, clear of the figure)
    const bw = 56 * this.fit, top = gy - d.py - 10;
    this.heroTop = Math.max(4, top);
    this.bar(x - bw / 2, Math.max(4, top), bw, 5, h.hp / h.maxHp, '#E06A86');
    // ult gauge ring under bar
    this.bar(x - bw / 2, Math.max(11, top + 7), bw, 3, h.gauge / 100, '#D8B675');
  }

  drawEnemy(e, battle, x, gy, s, now) {
    const ctx = this.ctx;
    const t = this.rt;
    const m = enemyMeta(e.def.sprite === 'hero' ? 'hero' : e.def.sprite);
    const motion = !s.reduceMotion;
    const isTrial = e.def.sprite === 'hero';
    const base = isTrial ? spriteMeta().hero.idle : m;
    // GPT C action frames: attack while lunging, hit while flashing / knocked back, dead while dying
    let meta = base;
    if (!isTrial && m && m.frames) {
      const kb0 = this.kb.get(e.uid);
      const act = e.state === 'dying' ? 'dead' : e.state === 'attack' ? 'attack'
        : t < e.flashUntil + 60 || (kb0 && now - kb0.at < 200) ? 'hit' : 'idle';
      const fr = m.frames[act];
      if (fr && ready(fr.file)) meta = fr;
      else if (fr) loadImage(fr.file);
      if (meta === base && m.frames.idle && ready(m.frames.idle.file)) meta = m.frames.idle;
    }
    // boss display height capped to the 220 px stage (spec 150..200, leave HP space)
    const bossScale = e.boss && !isTrial ? Math.min(1, 150 / base.bodyHeightPx * 2) : 1;
    const d = this.spriteDims(meta, bossScale);
    const dIdle = meta === base ? d : this.spriteDims(base, bossScale);   // HP bar / labels stay put between frames
    let dx = 0, dy = 0, sy = 1, sxx = 1, rot = 0, alpha = 1;
    if (e.def.flying) dy = -14 * this.fit * this.figScale + (motion ? Math.sin(t / 300) * 3 : 0);
    if (e.state === 'telegraph' && motion) {
      const p = Math.min(1, (t - e.stateAt) / (e.pending ? e.pending.impactAt - e.stateAt : 500));
      const kind = e.pending && e.pending.heavy ? 'heavy' : e.def.telegraph;
      if (kind === 'crouch') { sy = 1 - 0.12 * p; sxx = 1 + 0.06 * p; }
      else if (kind === 'raise' || kind === 'heavy') { rot = 0.08 * p; dx = 6 * p; }
      else if (kind === 'line') { dx = 8 * p; }
    }
    if (e.state === 'attack' && motion) { const p = (t - e.stateAt) / 300; dx = -22 * Math.sin(Math.min(1, p) * Math.PI); }
    if (e.state === 'dying') { const p = Math.min(1, 1 - (e.dieAt - t) / 420); alpha = 1 - p * p; dy += motion && !base.frames ? 10 * p : 0; sy *= base.frames ? 1 : 1 - 0.1 * p; }
    if (motion && e.state !== 'dying' && e.state !== 'telegraph') sy *= 1 + 0.015 * Math.sin(t / 380 + e.uid);
    // knockback nudge (bosses move half as far)
    const kb = this.kb.get(e.uid);
    if (kb && motion) {
      const p = (now - kb.at) / 200;
      if (p >= 0 && p < 1) { dx += kb.amp * (e.boss ? 0.5 : 1) * (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8); rot += (e.boss ? 0.02 : 0.05) * (1 - p); }
      else if (p >= 1) this.kb.delete(e.uid);
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * alpha) + ')';
    ctx.beginPath(); ctx.ellipse(x, gy + 2, dIdle.w * 0.32, 6 * this.fit, 0, 0, Math.PI * 2); ctx.fill();
    const img = ready(meta.file);
    if (img) {
      // instructor projection: grey/bright look baked into the cached bitmap (no per-frame filter)
      const ef = isTrial ? 'grayscale(1) brightness(1.35)' : e.def.tint ? `hue-rotate(${e.def.tint}deg) saturate(1.15)` : '';
      let sc = scaledImage(img, d.w * this.dpr, d.h * this.dpr, meta.file, ef);
      if (e.enraged) sc = outlined(sc, '#F0506E', meta.file + d.w + ef + 'rage');
      else if (e.elite) sc = outlined(sc, e.fieldBoss ? '#F2A04A' : '#EDBD68', meta.file + d.w + ef + (e.fieldBoss ? 'fb' : ''));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + dx, gy + dy);
      ctx.rotate(rot);
      ctx.scale(isTrial ? -sxx : sxx, sy);     // instructor projection faces the hero
      ctx.globalAlpha = alpha * (isTrial ? 0.72 : 1);
      ctx.drawImage(sc, -d.px, -d.py, d.w, d.h);
      // white hit flash (silhouette), strongest right at the hit
      if (t < e.flashUntil && e.state !== 'dying') { ctx.globalAlpha = alpha * Math.min(0.85, 0.35 + (e.flashUntil - t) / 160); ctx.drawImage(whiteOf(sc), -d.px, -d.py, d.w, d.h); }
      ctx.restore();
    } else this.placeholder(x, gy, 40, d.h || 80, e.name);
    if (e.boss && e.enraged && e.state !== 'dying') this.text('광폭화', x, Math.max(this.topInset + 44, gy + dy - dIdle.py - 6), 13, '#FF9DB2', 'center', 800, true);
    if (e.state === 'dying' || e.boss) return;
    // HP bar above head; elite marker = diamond + "정예" text (not colour only)
    const bw = Math.max(40, dIdle.w * 0.5), top = Math.max(16, gy + dy - dIdle.py - 10);
    this.bar(x - bw / 2, top, bw, 5, e.hp / e.maxHp, '#C9455F');
    if (e.elite) {
      ctx.fillStyle = '#EDBD68';
      ctx.beginPath(); ctx.moveTo(x - bw / 2 - 8, top + 2.5); ctx.lineTo(x - bw / 2 - 4, top - 1.5); ctx.lineTo(x - bw / 2, top + 2.5); ctx.lineTo(x - bw / 2 - 4, top + 6.5); ctx.fill();
      this.text(e.fieldBoss ? '필드 보스' : '정예', x, top - 6, 12, e.fieldBoss ? '#F2A04A' : '#EDBD68', 'center', 700, true);
    }
  }

  drawTelegraph(e, battle, x, gy, now, s) {
    const ctx = this.ctx;
    const p = e.pending;
    if (!p) return;
    const total = p.impactAt - e.stateAt;
    const prog = Math.min(1, (battle.t - e.stateAt) / Math.max(1, total));
    const heavy = p.heavy;
    const shape = heavy ? e.def.heavy.shape : 'line';
    const hx = HERO_X * this.sx;
    ctx.save();
    ctx.lineWidth = heavy ? 2.5 : 1.5;
    ctx.setLineDash(heavy ? [6, 4] : [4, 4]);
    ctx.strokeStyle = heavy ? 'rgba(237,189,104,0.95)' : 'rgba(245,237,240,0.7)';
    ctx.fillStyle = heavy ? 'rgba(184,77,104,' + (0.18 + 0.22 * prog) + ')' : 'rgba(184,77,104,0.12)';
    if (shape === 'circle') {
      const r = 40 * this.fit * (0.4 + 0.6 * prog);
      ctx.beginPath(); ctx.ellipse(hx, gy, r * 1.6, r * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (shape === 'crack') {
      ctx.beginPath();
      ctx.moveTo(x, gy); for (let i = 1; i <= 6; i++) ctx.lineTo(x + (hx - x) * (i / 6) * prog, gy + (i % 2 ? -4 : 4));
      ctx.stroke();
      ctx.fillRect(Math.min(x, hx) - 10, gy - 6, Math.abs(hx - x) * prog + 20, 12);
    } else {
      const y = gy - 2;
      ctx.fillRect(hx - 24, y - 5, (x - hx + 24) * 1, 10);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (hx - 24 - x) * prog, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // warning icon above the attacker (shape + icon + text, not colour alone)
    const iy = Math.max(30, gy - (heavy ? 150 : 100) * this.fit * this.figScale);
    ctx.fillStyle = heavy ? '#EDBD68' : '#F5EDF0';
    ctx.beginPath(); ctx.moveTo(x, iy - 11); ctx.lineTo(x + 10, iy + 7); ctx.lineTo(x - 10, iy + 7); ctx.closePath(); ctx.fill();
    this.text('!', x, iy + 5, 12, '#100D18', 'center', 900);
    if (heavy) this.text(e.def.heavy.name, x, iy - 16, 13, '#EDBD68', 'center', 700);
    ctx.restore();
  }

  // crescent slash path between angles a0→a1 (a1 < a0 sweeps anticlockwise)
  crescent(cx, cy, r, a0, a1, w) {
    const ctx = this.ctx;
    const ccw = a1 < a0, mid = (a0 + a1) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1, ccw);
    ctx.arc(cx - Math.cos(mid) * w, cy - Math.sin(mid) * w, r, a1, a0, !ccw);
    ctx.closePath();
  }
  bladePath(x1, y1, x2, y2, w) {
    const ctx = this.ctx;
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * w * 0.5, ny = (dx / L) * w * 0.5, mx = x1 + dx * 0.55, my = y1 + dy * 0.55;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx + nx, my + ny); ctx.lineTo(x2, y2); ctx.lineTo(mx - nx, my - ny); ctx.closePath();
  }

  drawFx(now, gy, sx, s) {
    const ctx = this.ctx;
    const motion = !s.reduceMotion;
    const u = this.u;
    // compact in place (no per-frame array allocation)
    const arr = this.fx;
    let j = 0;
    for (let i = 0; i < arr.length; i++) { const f = arr[i]; if (now - f.born < f.dur) arr[j++] = f; }
    arr.length = j;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (now < f.born || f.kind === 'flash') continue;
      const p = (now - f.born) / f.dur;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      switch (f.kind) {
        case 'slash': {
          // sweep in fast, then the tail catches up
          const head = clamp01(p / 0.3), tail = clamp01((p - 0.3) / 0.7);
          const a0 = f.a0 + (f.a1 - f.a0) * tail, a1 = f.a0 + (f.a1 - f.a0) * head;
          if (Math.abs(a1 - a0) < 0.02) break;
          const r = f.r * (motion ? 1 + 0.12 * p : 1);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p * p;
          ctx.fillStyle = f.col; this.crescent(f.x, f.y, r, a0, a1, f.w); ctx.fill();
          ctx.fillStyle = f.core; this.crescent(f.x, f.y, r, a0, a1, f.w * 0.35); ctx.fill();
          break;
        }
        case 'blade': {
          const head = clamp01(p / 0.35), tail = clamp01((p - 0.35) / 0.65);
          const x1 = f.x1 + (f.x2 - f.x1) * tail, y1 = f.y1 + (f.y2 - f.y1) * tail;
          const x2 = f.x1 + (f.x2 - f.x1) * head, y2 = f.y1 + (f.y2 - f.y1) * head;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p * p;
          ctx.fillStyle = f.col; this.bladePath(x1, y1, x2, y2, f.w); ctx.fill();
          ctx.fillStyle = f.core || '#fff'; this.bladePath(x1, y1, x2, y2, f.w * 0.35); ctx.fill();
          break;
        }
        case 'ring': {
          const e = 1 - (1 - p) * (1 - p);
          const r = f.r0 + (f.r1 - f.r0) * (motion ? e : 0.7);
          ctx.strokeStyle = f.col; ctx.lineWidth = f.w * (1 - p * 0.6);
          ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * f.flat, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'nova': {
          ctx.globalCompositeOperation = 'lighter';
          const r = f.r * (motion ? 0.3 + 0.7 * (1 - (1 - p) * (1 - p)) : 0.8);
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, f.col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#FFF6DE'; ctx.lineWidth = 2; ctx.beginPath();
          for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + p; const rr = r * (k % 2 ? 0.7 : 1.15); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr); }
          ctx.stroke();
          break;
        }
        case 'spark': {
          const hs = fxSprite(f.crit ? 'crit' : f.img || 'hit');
          if (hs) {
            const sz = (f.crit ? 46 : 32) * this.fit * (motion ? 0.7 + 0.5 * p : 1), sc = sz / Math.max(hs.w, hs.h);
            ctx.globalAlpha = 1 - p * p; ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(hs.img, f.x - hs.ax * hs.w * sc, f.y - hs.ay * hs.h * sc, hs.w * sc, hs.h * sc);
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          ctx.strokeStyle = f.crit ? '#EDBD68' : f.col; ctx.lineWidth = 2;
          const r = (6 + (motion ? 16 * p : 8)) * this.fit;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; ctx.moveTo(f.x + Math.cos(a) * r * 0.4, f.y + Math.sin(a) * r * 0.4); ctx.lineTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r); }
          ctx.stroke();
          break;
        }
        case 'proj': this.drawProj(f, p, gy, sx, motion); break;
        case 'petshot': {
          // companion: a small glowing mote from the pet to the target
          const pp = this.petPos || { x: (HERO_X - 30) * sx, y: gy - 90 * u };
          const q = Math.min(1, p * 1.4);
          const mx = pp.x + (f.x - pp.x) * q, my = pp.y + (gy - 50 * u - pp.y) * q;
          ctx.globalAlpha = 1 - p * 0.5;
          ctx.fillStyle = '#FFE6A8';
          ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'charge': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.4 + 0.6 * p;
          ctx.strokeStyle = f.col; ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) { const r = (64 - 50 * ((p + k / 3) % 1)) * u; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke(); }
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 40 * u);
          g.addColorStop(0, 'rgba(255,246,222,' + (0.6 * p) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 40 * u, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'sigil': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
          ctx.strokeStyle = f.col; ctx.lineWidth = 1.6;
          const r = f.r * (0.8 + 0.2 * Math.min(1, p * 3)), rot = motion ? p * 2.2 : 0;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(f.x, f.y, r * 0.72, r * 0.72 * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = rot + (k / 6) * Math.PI * 2, b = a + Math.PI * 2 / 3; ctx.moveTo(f.x + Math.cos(a) * r * 0.72, f.y + Math.sin(a) * r * 0.72 * 0.3); ctx.lineTo(f.x + Math.cos(b) * r * 0.72, f.y + Math.sin(b) * r * 0.72 * 0.3); }
          ctx.stroke();
          break;
        }
        case 'dome': {
          const hx = HERO_X * sx, hy = gy - 50 * u;
          const r = (f.big ? 62 : 56) * u * (motion ? 0.7 + 0.3 * Math.min(1, p * 4) : 1);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - p) * 0.9;
          const g = ctx.createRadialGradient(hx, hy, r * 0.5, hx, hy, r);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, f.col);
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hx, hy, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = f.col; ctx.lineWidth = 2; ctx.stroke();
          // hex lattice hint
          ctx.globalAlpha = (1 - p) * 0.5; ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * r * 0.8, hy + Math.sin(a) * r); }
          ctx.stroke();
          break;
        }
        case 'pillar': {
          ctx.globalCompositeOperation = 'lighter';
          const w = 26 * u * (1 - p * 0.6);
          const g = ctx.createLinearGradient(f.x - w, 0, f.x + w, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, f.col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(f.x - w, this.topInset, w * 2, gy - this.topInset);
          break;
        }
        case 'column': {
          const hx = f.x;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85) * 0.8;
          const w = 34 * u, top = gy - (140 * u) * Math.min(1, p * 2.5);
          const g = ctx.createLinearGradient(0, gy, 0, top);
          g.addColorStop(0, f.col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hx, (gy + top) / 2, w, (gy - top) / 2, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'beam': {
          ctx.globalCompositeOperation = 'lighter';
          const head = clamp01(p / 0.25);
          const x2 = f.x1 + (f.x2 - f.x1) * head, y2 = f.y1 + (f.y2 - f.y1) * head;
          ctx.lineCap = 'round';
          ctx.strokeStyle = f.col; ctx.lineWidth = f.w * (1 - p * 0.5);
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = f.w * 0.3;
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(x2, y2); ctx.stroke();
          break;
        }
        case 'chain': {
          ctx.globalCompositeOperation = 'lighter';
          const flick = motion ? Math.floor(now / 45) : 0;
          ctx.strokeStyle = f.col; ctx.lineWidth = 2.4; ctx.lineJoin = 'bevel';
          const pts = f.pts, segs = Math.max(1, Math.ceil(clamp01(p / 0.4) * (pts.length / 2 - 1)));
          ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
          for (let k = 1; k <= segs; k++) {
            const ax = pts[k * 2 - 2], ay = pts[k * 2 - 1], bx = pts[k * 2], by = pts[k * 2 + 1];
            for (let q = 1; q <= 5; q++) {
              const jit = q === 5 ? 0 : Math.sin(f.seed + k * 13.1 + q * 7.7 + flick * 3.3) * 10 * u;
              ctx.lineTo(ax + (bx - ax) * (q / 5), ay + (by - ay) * (q / 5) + jit);
            }
          }
          ctx.stroke();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1; ctx.stroke();
          break;
        }
        case 'whirl': {
          ctx.globalCompositeOperation = 'lighter';
          const rot = motion ? p * Math.PI * 4 : 0;
          ctx.fillStyle = f.col;
          this.crescent(f.x, f.y, f.r, rot, rot + 2.6, 12 * u); ctx.fill();
          this.crescent(f.x, f.y, f.r, rot + Math.PI, rot + Math.PI + 2.6, 12 * u); ctx.fill();
          break;
        }
        case 'reticle': {
          const r = 22 * u * (1.6 - 0.6 * clamp01(p * 2));
          ctx.strokeStyle = '#FFE6A8'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(f.x - r * 1.4, f.y); ctx.lineTo(f.x - r * 0.4, f.y); ctx.moveTo(f.x + r * 0.4, f.y); ctx.lineTo(f.x + r * 1.4, f.y);
          ctx.moveTo(f.x, f.y - r * 1.4); ctx.lineTo(f.x, f.y - r * 0.4); ctx.moveTo(f.x, f.y + r * 0.4); ctx.lineTo(f.x, f.y + r * 1.4); ctx.stroke();
          break;
        }
        case 'meteor': {
          const fallP = (now - f.born) / f.fall;
          const sx0 = f.x + 120 * u, sy0 = this.topInset - 20, ty = f.y - 8 * u;
          if (fallP < 1) {
            const q = fallP * fallP;
            const mx = sx0 + (f.x - sx0) * q, my = sy0 + (ty - sy0) * q;
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createLinearGradient(mx + 60 * u, my - 70 * u, mx, my);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, f.col);
            ctx.strokeStyle = g; ctx.lineWidth = f.r * 1.4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(mx + 60 * u, my - 70 * u); ctx.lineTo(mx, my); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
            const ms = fxSprite(f.col === '#7CE08A' ? 'hex' : 'meteor');
            if (ms) {
              const sc = (f.r * 4.2) / ms.w;
              ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.atan2(ty - sy0, f.x - sx0));
              ctx.drawImage(ms.img, -ms.ax * ms.w * sc, -ms.ay * ms.h * sc, ms.w * sc, ms.h * sc); ctx.restore();
            } else { ctx.fillStyle = '#FFF2D0'; ctx.beginPath(); ctx.arc(mx, my, f.r * 0.7, 0, Math.PI * 2); ctx.fill(); }
          } else {
            const q = (now - f.born - f.fall) / (f.dur - f.fall);
            if (!f.landed) { f.landed = true; this.parts.burst(now, f.x, ty, 14, 240, 500, 3.4, f.col, PK.DOT, 300, 2.2, -Math.PI / 2); this.parts.burst(now, f.x, ty, 5, 50, 800, 14 * u, 'rgba(50,35,35,0.9)', PK.SMOKE); }
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 1 - q;
            const r = (20 + 60 * (1 - (1 - q) * (1 - q))) * u;
            const g = ctx.createRadialGradient(f.x, ty, 0, f.x, ty, r);
            g.addColorStop(0, 'rgba(255,246,222,0.95)'); g.addColorStop(0.4, f.col); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(f.x, ty, r * 1.2, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'wave': {
          // 별빛 참격: a giant crescent rolling across the field
          const x = f.x0 + (this.cssW + 60 - f.x0) * (motion ? (1 - (1 - p) * (1 - p)) : 0.5);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - p * 0.7;
          ctx.fillStyle = f.col; this.crescent(x - f.r, f.y, f.r * 1.4, -1.0, 1.0, 26 * u); ctx.fill();
          ctx.fillStyle = '#FFFFFF'; this.crescent(x - f.r, f.y, f.r * 1.4, -0.9, 0.9, 9 * u); ctx.fill();
          break;
        }
        case 'bladering': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3 + 0.7 * p;
          const rot = motion ? p * Math.PI * 3 : 0, r = f.r * (1 - 0.3 * p);
          ctx.fillStyle = '#F0C6D2';
          for (let k = 0; k < 10; k++) {
            const a = rot + (k / 10) * Math.PI * 2, cx = f.x + Math.cos(a) * r, cy = f.y + Math.sin(a) * r * 0.8;
            this.bladePath(cx - Math.cos(a + 1.3) * 9 * u, cy - Math.sin(a + 1.3) * 9 * u, cx + Math.cos(a + 1.3) * 9 * u, cy + Math.sin(a + 1.3) * 9 * u, 3 * u);
            ctx.fill();
          }
          break;
        }
        case 'ghost': {
          const g = this.ghost;
          if (!g) break;
          ctx.globalAlpha = 0.45 * (1 - p);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(g.sc, g.x + f.dx * u * 2 * (motion ? p : 1) - g.d.px, g.gy - g.d.py, g.d.w, g.d.h);
          break;
        }
        default: break;
      }
      ctx.restore();
    }
  }

  drawProj(f, p, gy, sx, motion) {
    const ctx = this.ctx;
    const u = this.u;
    const hx = (HERO_X + 26) * sx, y0 = gy - 62 * u + (f.yoff || 0), y1 = gy - 50 * u + (f.yoff || 0) * 0.4;
    const q = motion ? p : 1;
    const px = hx + (f.x - hx) * q, py = y0 + (y1 - y0) * q;
    const ang = Math.atan2(y1 - y0, f.x - hx);
    ctx.globalAlpha = 1;
    ctx.translate(px, py); ctx.rotate(ang);
    const k = f.proj;
    // GPT B sprite (anchor = leading tip at the projectile position); vector fallback below
    const spr = fxSprite(PROJ_SPRITE[k] === 'dagger' && this.heroBranch === 'trickster' ? 'card' : PROJ_SPRITE[k]);
    if (spr) {
      const big = f.big || k === 'fire' ? 1.5 : 1;
      const L = (spr.file.includes('card') ? 22 : PROJ_LEN[k] || 48) * big * u * (f.crit ? 1.15 : 1);
      const sc = L / spr.w;
      if (spr.file.includes('card') && motion) ctx.rotate(p * Math.PI * 4);
      ctx.drawImage(spr.img, -spr.ax * spr.w * sc, -spr.ay * spr.h * sc, spr.w * sc, spr.h * sc);
      return;
    }
    if (k === 'bolt' || k === 'hex' || k === 'star' || k === 'fire') {
      const big = f.big || k === 'fire' ? 1.6 : 1;
      const col = k === 'fire' ? 'rgba(255,150,70,0.95)' : k === 'hex' ? 'rgba(130,220,120,0.9)' : f.crit || k === 'star' ? 'rgba(237,189,104,0.95)' : 'rgba(188,154,243,0.9)';
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-44 * big, 0, 0, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
      ctx.strokeStyle = g; ctx.lineWidth = 5 * big; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-44 * big, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = k === 'fire' ? '#FFE0A0' : f.crit || k === 'star' ? '#FFE6A8' : k === 'hex' ? '#E0FFD8' : '#EDE3FF';
      ctx.beginPath();
      const spin = motion ? p * 4 : 0;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + spin, r = (i % 2 ? 2.5 : 7) * big; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
    } else if (k === 'arrow' || k === 'arrowC') {
      const c = k === 'arrowC';
      if (c) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,230,168,0.55)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(4, 0); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = 'rgba(201,216,255,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(-18, 0); ctx.stroke();
      ctx.strokeStyle = '#D9C7A3'; ctx.lineWidth = c ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.fillStyle = f.crit || c ? '#EDBD68' : '#E6ECF5';
      ctx.beginPath(); ctx.moveTo(c ? 10 : 8, 0); ctx.lineTo(1, c ? -4 : -3); ctx.lineTo(1, c ? 4 : 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7AC9A8';
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-23, -4); ctx.lineTo(-15, 0); ctx.lineTo(-23, 4); ctx.closePath(); ctx.fill();
    } else {
      ctx.rotate(motion ? p * Math.PI * 4 : 0);
      ctx.fillStyle = k === 'daggerP' ? '#9BE89A' : '#D8DDE6'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-3, -2.5); ctx.lineTo(-3, 2.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8E294C'; ctx.fillRect(-8, -1.5, 5, 3);
    }
  }

  // full-screen flashes (drawn last, over everything)
  drawFlash(now) {
    const ctx = this.ctx;
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      if (f.kind !== 'flash' || now < f.born) continue;
      const p = (now - f.born) / f.dur;
      if (p >= 1) continue;
      ctx.globalAlpha = f.a * (1 - p) * (1 - p);
      ctx.fillStyle = f.col; ctx.fillRect(-10, -10, this.cssW + 20, this.cssH + 20);
    }
    ctx.globalAlpha = 1;
  }

  // ultimate: background dim under the hero (enemies darken, hero + effects pop)
  drawDim(battle) {
    const c = this.cut;
    if (!c) return;
    const rel = battle.t - c.t0;
    if (rel > 1250 || rel < -2000) { this.cut = null; return; }
    if (c.simple || rel < 0) return;
    const top = c.skipped ? 0.35 : 0.62;
    const a = rel < 120 ? top * rel / 120 : rel < 860 ? top : top * Math.max(0, 1 - (rel - 860) / 300);
    const ctx = this.ctx;
    ctx.globalAlpha = a; ctx.fillStyle = '#07050C';
    ctx.fillRect(-10, -10, this.cssW + 20, this.cssH + 20);
    ctx.globalAlpha = 1;
  }

  preloadPortrait(cls, branch, tier) {
    const key = cls + ':' + branch + ':' + tier;
    if (key === this.portraitKey) return;
    this.portraitKey = key;
    this.portraitFile = (branch && promoPortrait(branch, tier)) || classPortrait(cls, 'kv');
    if (this.portraitFile) loadImage(this.portraitFile).catch(() => {});
  }

  // ultimate cut-in: diagonal banner with the hero's portrait + ult name (~700 ms)
  drawCut(battle, now) {
    const c = this.cut;
    if (!c || c.simple || c.skipped) return;
    const rel = battle.t - c.t0;
    if (rel < 40 || rel > 800) return;
    const ctx = this.ctx;
    const W = this.cssW, H = this.cssH;
    const P = this.pal();
    const inP = clamp01((rel - 40) / 170), outP = clamp01((rel - 640) / 150);
    const ease = 1 - (1 - inP) * (1 - inP) * (1 - inP);
    const off = (1 - ease) * -W * 1.2 + outP * outP * W * 1.2;
    const bh = Math.min(H * 0.36, 150), cy = this.topInset + (H - this.topInset) * 0.42;
    ctx.save();
    ctx.translate(W / 2 + off, cy);
    ctx.rotate(-0.16);
    const bw = W * 1.6;
    // band
    const g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    g.addColorStop(0, '#0B0812'); g.addColorStop(0.5, P.band); g.addColorStop(1, '#0B0812');
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = g; ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    // speed lines
    ctx.globalAlpha = 0.35; ctx.strokeStyle = P.main; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 14; k++) {
      const yy = -bh / 2 + ((k * 37) % 100) / 100 * bh;
      const xx = ((k * 151 + rel * 1.6) % (bw)) - bw / 2;
      ctx.moveTo(-xx, yy); ctx.lineTo(-xx - 40 - (k % 4) * 20, yy);
    }
    ctx.stroke();
    // gold edges
    ctx.globalAlpha = 1; ctx.fillStyle = '#EDBD68';
    ctx.fillRect(-bw / 2, -bh / 2 - 3, bw, 3); ctx.fillRect(-bw / 2, bh / 2, bw, 3);
    // portrait (bust crop of the current class / branch / tier art)
    const img = this.portraitFile && ready(this.portraitFile);
    const boxW = bh * 1.2, bx = -W * 0.5 + 6;
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(bx, -bh / 2); ctx.lineTo(bx + boxW + 18, -bh / 2); ctx.lineTo(bx + boxW - 18, bh / 2); ctx.lineTo(bx, bh / 2); ctx.closePath(); ctx.clip();
      const sw = img.width * 0.7, sh = sw * bh / boxW, sx0 = img.width * 0.15, sy0 = img.height * 0.02;
      ctx.drawImage(img, sx0, sy0, sw, sh, bx + (rel - 40) * 0.02, -bh / 2, boxW, bh);
      ctx.restore();
    }
    // text
    const tx = bx + boxW + 6;
    this.text('ULTIMATE', tx, -bh * 0.14, 11, '#EDBD68', 'left', 800);
    const fs = Math.min(30, Math.max(20, W * 0.07));
    this.text(c.name, tx, -bh * 0.14 + fs + 2, fs, '#FFFFFF', 'left', 900, true);
    const hero = CLASSES[c.cls] ? CLASSES[c.cls].hero : '';
    if (hero) this.text(hero, tx, -bh * 0.14 + fs + 20, 12, P.main, 'left', 600);
    ctx.restore();
  }

  drawNumbers(now, sx, H, s) {
    const life = 820;
    const arr = this.numbers;
    let j = 0;
    for (let i = 0; i < arr.length; i++) { const n = arr[i]; if (now - n.born < life) arr[j++] = n; }
    arr.length = j;
    const motion = !s.reduceMotion;
    const ctx = this.ctx;
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (now < n.born) continue;
      const p = (now - n.born) / life;
      const pop = motion && !n.miss ? (p < 0.1 ? 1 + (n.crit ? 0.9 : n.big ? 0.6 : 0.35) * (1 - p / 0.1) : 1) : 1;
      const bounce = motion && p < 0.3 ? Math.sin((p / 0.3) * Math.PI) * (n.crit ? 10 : 6) : 0;
      const y = H * n.y - (motion ? 24 * p : 0) - bounce;
      const x = this.ex(n.x) * sx + (n.enemy ? 0 : 6) + (motion ? (n.dx || 0) * p : 0);
      const size = n.crit ? 22 : n.big ? 20 : n.dot ? 13 : n.enemy ? 15 : 16;
      const col = n.miss ? '#A9E8D0' : n.dot ? n.dot : n.enemy ? (n.guarded ? '#A9C8FF' : '#FF9DB2') : n.crit ? '#FFD46E' : n.big ? '#FFF2D0' : '#F5EDF0';
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, p - 0.6) / 0.4;
      ctx.translate(x, y); ctx.scale(pop, pop);
      this.text(n.miss ? n.text : (n.enemy ? '-' : '') + n.text, 0, 0, size, col, 'center', 900, true);
      if (n.crit) this.text('치명!', 0, -size + 2, 11, '#FF8FA6', 'center', 900, true);
      ctx.restore();
    }
  }

  // "N COMBO" counter (resets after COMBO_RESET ms without a hit)
  drawCombo(now, battle) {
    const C = this.counter;
    const age = now - C.last;
    if (C.n < 2 || age > COMBO_RESET) return;
    const s = this.getSettings();
    const ctx = this.ctx;
    const boss = battle.enemies.some((e) => e.boss);
    const x = this.cssW - 12, y = this.topInset + (boss ? 40 : 4) + 24;
    const pp = (now - C.pop) / 160;
    const pop = !s.reduceMotion && pp < 1 ? 1 + 0.35 * (1 - pp) : 1;
    ctx.save();
    ctx.globalAlpha = age > COMBO_RESET * 0.7 ? 1 - (age - COMBO_RESET * 0.7) / (COMBO_RESET * 0.3) : 1;
    ctx.translate(x, y); ctx.scale(pop, pop);
    const col = C.n >= 30 ? '#FF8FA6' : C.n >= 10 ? '#FFD46E' : '#F5EDF0';
    this.text(String(C.n), -50, 0, 26, col, 'right', 900, true);
    this.text('COMBO', 0, -2, 12, '#EDBD68', 'right', 800, true);
    ctx.restore();
  }

  // skill name toast (and the reduced-motion ultimate name)
  drawToast(now, battle) {
    const t = this.toast;
    if (!t) return;
    const age = now - t.born, life = t.ult ? 1400 : 1000;
    if (age > life) { this.toast = null; return; }
    const ctx = this.ctx;
    // skill names float above the caster (clear of the damage numbers over the enemies)
    const boss = battle.enemies.some((e) => e.boss);
    const y = Math.max(this.topInset + (boss ? 40 : 0) + 14, (this.heroTop || 80) - 16) + (age < 120 ? -6 * (1 - age / 120) : 0);
    const a = age < 120 ? age / 120 : age > life - 250 ? (life - age) / 250 : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `800 ${t.ult ? 16 : 14}px "Noto Sans KR", sans-serif`;
    const w = ctx.measureText(t.text).width + 28, h = t.ult ? 28 : 24, x = Math.max(w / 2 + 6, HERO_X * this.sx);
    ctx.fillStyle = 'rgba(16,13,24,0.82)';
    ctx.beginPath(); ctx.moveTo(x - w / 2 + 8, y - h / 2); ctx.lineTo(x + w / 2, y - h / 2); ctx.lineTo(x + w / 2 - 8, y + h / 2); ctx.lineTo(x - w / 2, y + h / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = t.ult ? '#EDBD68' : 'rgba(237,189,104,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    this.text(t.text, x, y + 5, t.ult ? 16 : 14, t.ult ? '#FFE6A8' : '#F5EDF0', 'center', 800);
    ctx.restore();
  }

  drawBossBar(boss, battle) {
    const W = this.cssW;
    const x = 12, w = W - 24, y = this.topInset;
    this.text(boss.name, x, y + 12, 13, '#F5EDF0', 'left', 700, true);
    const left = battle.timeLeftMs();
    if (left !== null) this.text(Math.ceil(left / 1000) + '초', W - 12, y + 12, 13, left < 15000 ? '#FF9DB2' : '#D8B675', 'right', 700, true);
    this.bar(x, y + 18, w, 7, boss.hp / boss.maxHp, '#C9455F');
  }
  drawLabel(text) { this.text(text, 12, this.cssH - 60, 14, '#C8BAC9', 'left', 500, true); }

  bar(x, y, w, hgt, v, color) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(16,13,24,0.75)'; ctx.fillRect(x - 1, y - 1, w + 2, hgt + 2);
    ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, Math.min(1, v)) * w, hgt);
  }
  text(str, x, y, size, color, align = 'left', weight = 500, stroke = false) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(16,13,24,0.85)'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  placeholder(x, gy, w, hgt, name) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(200,186,201,0.18)';
    ctx.fillRect(x - w / 2, gy - hgt, w, hgt);
    this.text(name, x, gy - hgt - 4, 11, '#C8BAC9', 'center');
  }
}
