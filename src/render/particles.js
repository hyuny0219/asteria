// Pooled particles for battle effects. A fixed number of particle objects is
// allocated once; spawning reuses a dead slot and drawing compacts the live set
// in place (swap-remove), so the frame loop allocates nothing. Motion is a closed
// form of age (no per-frame integration), so slow-motion is just a slower clock.
export const PK = Object.freeze({ DOT: 0, STREAK: 1, SMOKE: 2, SHARD: 3, ARROW: 4, STAR: 5, BUBBLE: 6 });

export class Particles {
  constructor(cap = 260) {
    this.cap = cap;
    this.n = 0;
    this.pool = new Array(cap);
    for (let i = 0; i < cap; i++) this.pool[i] = { x: 0, y: 0, vx: 0, vy: 0, g: 0, born: 0, life: 1, size: 1, color: '#fff', kind: 0, rot: 0, vr: 0 };
  }
  // returns false when the pool is full (the effect is simply thinner, never queued)
  spawn(born, x, y, vx, vy, life, size, color, kind = 0, g = 0) {
    if (this.n >= this.cap) return false;
    const q = this.pool[this.n++];
    q.born = born; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.size = size; q.color = color; q.kind = kind; q.g = g;
    q.rot = Math.random() * 6.283; q.vr = (Math.random() * 2 - 1) * 9;
    return true;
  }
  // radial burst helper
  burst(born, x, y, count, speed, life, size, color, kind = 0, g = 0, spread = Math.PI * 2, dir = 0) {
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      if (!this.spawn(born, x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.7 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.6), color, kind, g)) return;
    }
  }
  clear() { this.n = 0; }
  get count() { return this.n; }

  draw(ctx, now) {
    let i = 0;
    let comp = '';
    while (i < this.n) {
      const q = this.pool[i];
      const age = now - q.born;
      if (age >= q.life) { this.n--; this.pool[i] = this.pool[this.n]; this.pool[this.n] = q; continue; }
      i++;
      if (age < 0) continue;
      const p = age / q.life, s = age / 1000;
      let x, y, vx = q.vx, vy = q.vy;
      if (q.g) { x = q.x + q.vx * s; y = q.y + q.vy * s + 0.5 * q.g * s * s; vy = q.vy + q.g * s; }
      else { const k = (q.life / 1000) * (p - p * p * 0.5); x = q.x + q.vx * k; y = q.y + q.vy * k; vx *= 1 - p; vy *= 1 - p; }
      const want = q.kind === PK.SMOKE ? 'source-over' : 'lighter';
      if (want !== comp) { ctx.globalCompositeOperation = want; comp = want; }
      const sz = q.size;
      switch (q.kind) {
        case PK.DOT:
          ctx.globalAlpha = 1 - p * p; ctx.fillStyle = q.color;
          ctx.beginPath(); ctx.arc(x, y, sz * (1 - p * 0.6), 0, 6.283); ctx.fill();
          break;
        case PK.STREAK: {
          ctx.globalAlpha = 1 - p; ctx.strokeStyle = q.color; ctx.lineWidth = Math.max(1, sz * 0.45 * (1 - p * 0.5));
          const sp = Math.hypot(vx, vy) || 1, len = sz * 3.2 * (1 - p * 0.7);
          ctx.beginPath(); ctx.moveTo(x - (vx / sp) * len, y - (vy / sp) * len); ctx.lineTo(x, y); ctx.stroke();
          break;
        }
        case PK.SMOKE:
          ctx.globalAlpha = 0.42 * (1 - p); ctx.fillStyle = q.color;
          ctx.beginPath(); ctx.arc(x, y, sz * (1 + p * 1.4), 0, 6.283); ctx.fill();
          break;
        case PK.SHARD: {
          ctx.globalAlpha = 1 - p * p; ctx.fillStyle = q.color;
          const r = q.rot + q.vr * s, c = Math.cos(r) * sz, d = Math.sin(r) * sz;
          ctx.beginPath(); ctx.moveTo(x + c, y + d); ctx.lineTo(x - d * 0.35, y + c * 0.35); ctx.lineTo(x - c, y - d); ctx.lineTo(x + d * 0.35, y - c * 0.35); ctx.closePath(); ctx.fill();
          break;
        }
        case PK.ARROW: {
          ctx.globalAlpha = p > 0.85 ? (1 - p) / 0.15 : 1; ctx.strokeStyle = q.color; ctx.lineWidth = 1.6;
          const sp = Math.hypot(vx, vy) || 1, ux = vx / sp, uy = vy / sp, len = sz * 4;
          ctx.beginPath(); ctx.moveTo(x - ux * len, y - uy * len); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = '#F5EDF0';
          ctx.beginPath(); ctx.moveTo(x + ux * 4, y + uy * 4); ctx.lineTo(x - uy * 2.4, y + ux * 2.4); ctx.lineTo(x + uy * 2.4, y - ux * 2.4); ctx.closePath(); ctx.fill();
          break;
        }
        case PK.STAR: {
          ctx.globalAlpha = 1 - p; ctx.fillStyle = q.color;
          const r = sz * (1 - p * 0.5), w = r * 0.28;
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y); ctx.lineTo(x + w, y + w); ctx.lineTo(x, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y); ctx.lineTo(x - w, y - w); ctx.closePath(); ctx.fill();
          break;
        }
        default:   // BUBBLE
          ctx.globalAlpha = 0.9 * (1 - p); ctx.strokeStyle = q.color; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, sz * (0.6 + p * 0.6), 0, 6.283); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
