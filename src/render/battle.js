// Canvas2D side-view battle renderer. Reads a Battle snapshot each frame and
// draws it; it never decides damage. Visual effects are spawned from the same
// combat events that applied the damage (game 'combat' events).
//
// Animation status (honest): the hero switches between the 8 authored key poses
// (idle/step/anticipation/thrust/recovery/hit/cast/victory) with small procedural
// tweens (breathing, lunge, knockback). Enemies and bosses are single static
// images animated by transforms (squash, lean, lunge, flash, fade). These are not
// frame-by-frame animations; see KNOWN_ISSUES.md.
import { HERO_X } from '../core/combat.js';
import { bgMeta, enemyMeta, heroFrames, outlined, ready, scaledImage, spriteMeta } from './assets.js';
import { fmt } from '../core/util.js';

const LOGICAL_W = 390;
const LOGICAL_H = 220;
const GROUND = 0.8;

export class BattleRenderer {
  constructor(canvas, { getSettings, topInset = 0 }) {
    this.topInset = topInset;   // DOM strip over the top of the canvas
    this.figScale = 0.78;       // characters & monsters drawn smaller than the 220px-stage spec (선배 요청)
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.getSettings = getSettings;
    this.numbers = [];   // floating damage numbers (pooled, max 24)
    this.fx = [];        // slashes / stars / rings (max 30)
    this.shake = { until: 0, amp: 0 };
    this.bgKey = null;
    this.bgCache = null;
    this.flashUntil = 0;
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
  get groundY() { return this.cssH * GROUND; }
  // vertical fit: sprites sized for a 220 px tall stage
  get fit() { return Math.min(this.cssH / LOGICAL_H, this.cssW / LOGICAL_W * 1.15); }

  // ---------- events from the simulation ----------
  onCombat(ev, battle) {
    const s = this.getSettings();
    const now = performance.now();
    if (ev.type === 'hit') {
      const show = s.damageNumbers === 'all' || (s.damageNumbers === 'crit' && ev.crit) || (s.damageNumbers === 'crit' && ev.by === 'enemy');
      const x = ev.by === 'hero' ? (ev.x ?? 220) : HERO_X;
      if (show) this.pushNumber({ x, y: ev.by === 'hero' ? 0.42 : 0.38, text: fmt(ev.dmg), crit: ev.crit, enemy: ev.by === 'enemy', heavy: ev.heavy, guarded: ev.guarded, born: now });
      if (ev.by === 'hero') this.pushFx({ kind: ev.action === 'ult' ? 'star' : ev.action === 'skill' ? 'arc2' : ev.action === 'counter' ? 'rose' : 'arc', x, born: now, dur: ev.action === 'ult' ? 520 : 200 });
      if (ev.by === 'enemy' && ev.heavy) this.kick(3, 100);
    } else if (ev.type === 'ultStart') {
      this.pushFx({ kind: 'charge', x: HERO_X, born: now, dur: 700 });
    } else if (ev.type === 'kill') {
      this.pushFx({ kind: 'burst', x: battle.enemies.find((e) => e.uid === ev.enemy.uid)?.x ?? 220, born: now, dur: 420, boss: ev.enemy.boss });
      if (ev.enemy.boss) this.kick(2, 80);
    } else if (ev.type === 'buff') {
      this.pushFx({ kind: 'aura', x: HERO_X, born: now, dur: 600 });
    }
  }
  pushNumber(n) { this.numbers.push(n); if (this.numbers.length > 24) this.numbers.shift(); }
  pushFx(f) { this.fx.push(f); if (this.fx.length > 30) this.fx.shift(); }
  kick(amp, ms) {
    const s = this.getSettings();
    if (!s.shake || s.reduceMotion) return;
    this.shake = { until: performance.now() + ms, amp };
  }

  // ---------- frame ----------
  draw(battle, { alpha = 0, region = null, bgId = null, branch = null, label = null, victory = false }) {
    const ctx = this.ctx;
    const W = this.cssW, H = this.cssH;
    const now = performance.now();
    const s = this.getSettings();
    ctx.save();
    if (now < this.shake.until) {
      const a = this.shake.amp;
      ctx.translate((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    }
    this.drawBg(bgId || (region && region.bg) || 'meadow');
    if (!battle) { ctx.restore(); return; }
    const gy = this.groundY;
    const sx = this.sx;
    const lerp = (a, b) => a + (b - a) * Math.min(1, alpha);

    // telegraph markers first (on the ground, under the figures)
    for (const e of battle.enemies) if (e.state === 'telegraph' || e.pending) this.drawTelegraph(e, battle, lerp(e.px, e.x) * sx, gy, now, s);

    // enemies back to front
    const sorted = [...battle.enemies].sort((a, b) => b.x - a.x);
    for (const e of sorted) this.drawEnemy(e, battle, lerp(e.px, e.x) * sx, gy, s);

    this.drawHero(battle, HERO_X * sx, gy, branch, s, victory);

    // fx & numbers
    this.drawFx(now, gy, sx, s);
    this.drawNumbers(now, sx, H, s);

    // boss / session header
    const boss = battle.enemies.find((e) => e.boss);
    if (boss) this.drawBossBar(boss, battle);
    if (label) this.drawLabel(label);
    ctx.restore();
  }

  drawBg(id) {
    const ctx = this.ctx;
    const W = this.cssW, H = this.cssH;
    const key = id + ':' + W + 'x' + H + '@' + this.dpr;
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
        x.drawImage(img, (c.width - dw) / 2, y0, dw, dh);
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

  drawHero(battle, x, gy, branch, s, victory) {
    const ctx = this.ctx;
    const h = battle.hero;
    const frames = heroFrames(branch);
    const t = battle.t;
    let pose = 'idle', dx = 0, dy = 0, alpha = 1, rot = 0;
    const ac = h.action;
    const motion = !s.reduceMotion;
    if (h.dead) { pose = 'hit'; alpha = 0.55; rot = -0.08; dy = 6; }
    else if (victory) pose = 'victory';
    else if (ac) {
      const rel = t - ac.start;
      const imp = ac.impactAt - ac.start;
      if (ac.kind === 'attack') {
        pose = rel < imp ? 'anticipation' : rel < imp + 120 ? 'thrust' : 'recovery';
        if (motion) dx = rel < imp ? -4 * (rel / imp) : rel < imp + 120 ? 10 : 10 * Math.max(0, 1 - (rel - imp - 120) / 200);
      } else {
        pose = rel < imp ? 'cast' : rel < imp + 160 ? 'thrust' : 'recovery';
        if (motion && rel >= imp) dx = 12 * Math.max(0, 1 - (rel - imp) / 300);
      }
    } else if (t < h.hitFxUntil) { pose = 'hit'; if (motion) dx = -5; }
    else if (battle.enemies.every((e) => e.state === 'approach') && battle.enemies.length) pose = Math.floor(t / 320) % 2 ? 'step' : 'idle';
    // Promoted: the branch costume has one authored figure; use it for idle/hit/victory
    // and keep the base attack poses would change costume mid-swing, so promoted
    // attacks use the branch figure + lunge only.
    let m = frames[pose];
    if (branch && frames.promo) m = frames.promo;
    const img = ready(m.file);
    const d = this.spriteDims(m);
    const breathe = motion && pose === 'idle' ? 1 + 0.012 * Math.sin(t / 420) : 1;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x + dx, gy + 2, 30 * this.fit * this.figScale, 6 * this.fit * this.figScale, 0, 0, Math.PI * 2); ctx.fill();
    if (img) {
      const sc = scaledImage(img, d.w * this.dpr, d.h * this.dpr, m.file);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + dx, gy + dy);
      ctx.rotate(rot);
      ctx.scale(1, breathe);
      ctx.drawImage(sc, -d.px, -d.py, d.w, d.h);
      if (branch && ac && motion) {
        // weapon trail for promoted attacks (no authored swing frames yet)
        const rel = t - ac.start, imp = ac.impactAt - ac.start;
        if (rel >= imp && rel < imp + 140) {
          ctx.strokeStyle = branch === 'berserker' ? 'rgba(220,60,70,0.85)' : 'rgba(240,230,210,0.85)';
          ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(10, -d.h * 0.45, d.h * 0.42, -1.1, 0.6); ctx.stroke();
        }
      }
      if (t < h.hitFxUntil && !h.dead) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25; ctx.drawImage(sc, -d.px, -d.py, d.w, d.h); }
      ctx.restore();
    } else this.placeholder(x, gy, 46, 140 * this.fit, '세린');
    // hero HP bar (above head, clear of the figure)
    const bw = 56 * this.fit, top = gy - d.py - 10;
    this.bar(x - bw / 2, Math.max(4, top), bw, 5, h.hp / h.maxHp, '#E06A86');
    // ult gauge ring under bar
    this.bar(x - bw / 2, Math.max(11, top + 7), bw, 3, h.gauge / 100, '#D8B675');
    if (h.buffs.guard) { ctx.strokeStyle = 'rgba(160,200,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, gy - d.h * 0.45, d.w * 0.45, d.h * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); }
  }

  drawEnemy(e, battle, x, gy, s) {
    const ctx = this.ctx;
    const t = battle.t;
    const m = enemyMeta(e.def.sprite === 'hero' ? 'hero' : e.def.sprite);
    const motion = !s.reduceMotion;
    const isTrial = e.def.sprite === 'hero';
    const meta = isTrial ? spriteMeta().hero.idle : m;
    // boss display height capped to the 220 px stage (spec 150..200, leave HP space)
    const bossScale = e.boss && !isTrial ? Math.min(1, 150 / meta.bodyHeightPx * 2) : 1;
    const d = this.spriteDims(meta, bossScale);
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
    if (e.state === 'dying') { const p = Math.min(1, 1 - (e.dieAt - t) / 420); alpha = 1 - p; dy += motion ? 10 * p : 0; sy *= 1 - 0.1 * p; }
    if (motion && e.state !== 'dying' && e.state !== 'telegraph') sy *= 1 + 0.015 * Math.sin(t / 380 + e.uid);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * alpha) + ')';
    ctx.beginPath(); ctx.ellipse(x, gy + 2, d.w * 0.32, 6 * this.fit, 0, 0, Math.PI * 2); ctx.fill();
    const img = ready(meta.file);
    if (img) {
      let sc = scaledImage(img, d.w * this.dpr, d.h * this.dpr, meta.file);
      if (e.elite) sc = outlined(sc, '#EDBD68', meta.file + d.w);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + dx, gy + dy);
      ctx.rotate(rot);
      ctx.scale(isTrial ? -sxx : sxx, sy);     // instructor projection faces the hero
      if (isTrial) ctx.filter = 'grayscale(1) brightness(1.35)';
      ctx.globalAlpha = alpha * (isTrial ? 0.72 : 1);
      ctx.drawImage(sc, -d.px, -d.py, d.w, d.h);
      ctx.filter = 'none';
      if (t < e.flashUntil) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * alpha; ctx.drawImage(sc, -d.px, -d.py, d.w, d.h); }
      ctx.restore();
    } else this.placeholder(x, gy, 40, d.h || 80, e.name);
    if (e.state === 'dying' || e.boss) return;
    // HP bar above head; elite marker = diamond + "정예" text (not colour only)
    const bw = Math.max(40, d.w * 0.5), top = Math.max(16, gy + dy - d.py - 10);
    this.bar(x - bw / 2, top, bw, 5, e.hp / e.maxHp, '#C9455F');
    if (e.elite) {
      ctx.fillStyle = '#EDBD68';
      ctx.beginPath(); ctx.moveTo(x - bw / 2 - 8, top + 2.5); ctx.lineTo(x - bw / 2 - 4, top - 1.5); ctx.lineTo(x - bw / 2, top + 2.5); ctx.lineTo(x - bw / 2 - 4, top + 6.5); ctx.fill();
      this.text('정예', x, top - 6, 11, '#EDBD68', 'center', 700);
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

  drawFx(now, gy, sx, s) {
    const ctx = this.ctx;
    const motion = !s.reduceMotion;
    this.fx = this.fx.filter((f) => now - f.born < f.dur);
    for (const f of this.fx) {
      const p = (now - f.born) / f.dur;
      const x = f.x * sx;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      if (f.kind === 'arc' || f.kind === 'arc2' || f.kind === 'rose') {
        ctx.strokeStyle = f.kind === 'rose' ? '#E06A86' : f.kind === 'arc2' ? '#EDBD68' : '#F5EDF0';
        ctx.lineWidth = f.kind === 'arc' ? 3 : 5;
        ctx.beginPath(); ctx.arc(x - 10, gy - 60 * this.fit, (36 + (motion ? 14 * p : 0)) * this.fit, -1.2, 0.9); ctx.stroke();
      } else if (f.kind === 'star') {
        // the only large star effect: ultimate
        ctx.strokeStyle = '#EDBD68'; ctx.lineWidth = 3;
        const r = (30 + (motion ? 50 * p : 30)) * this.fit;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.moveTo(x, gy - 60 * this.fit); ctx.lineTo(x + Math.cos(a) * r * (i % 2 ? 0.5 : 1), gy - 60 * this.fit + Math.sin(a) * r * (i % 2 ? 0.5 : 1)); }
        ctx.stroke();
      } else if (f.kind === 'charge') {
        ctx.strokeStyle = '#B79AF2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, gy - 70 * this.fit, (50 - 30 * p) * this.fit, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === 'burst') {
        ctx.fillStyle = f.boss ? '#EDBD68' : '#C8BAC9';
        for (let i = 0; i < (f.boss ? 12 : 6); i++) { const a = (i / (f.boss ? 12 : 6)) * Math.PI * 2; const r = (12 + 30 * p) * this.fit; ctx.fillRect(x + Math.cos(a) * r, gy - 40 * this.fit + Math.sin(a) * r * 0.6, 3, 3); }
      } else if (f.kind === 'aura') {
        ctx.strokeStyle = '#EDBD68'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, gy, (30 + 20 * p) * this.fit, 8 * this.fit, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawNumbers(now, sx, H, s) {
    const life = 760;
    this.numbers = this.numbers.filter((n) => now - n.born < life);
    for (const n of this.numbers) {
      const p = (now - n.born) / life;
      const y = H * n.y - (s.reduceMotion ? 0 : 26 * p);
      const size = n.crit ? 20 : n.enemy ? 15 : 16;
      const col = n.enemy ? (n.guarded ? '#A9C8FF' : '#FF9DB2') : n.crit ? '#EDBD68' : '#F5EDF0';
      this.ctx.globalAlpha = 1 - Math.max(0, p - 0.6) / 0.4;
      this.text((n.enemy ? '-' : '') + n.text + (n.crit ? '!' : ''), n.x * sx + (n.enemy ? 0 : 6), y, size, col, 'center', 800, true);
      this.ctx.globalAlpha = 1;
    }
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
