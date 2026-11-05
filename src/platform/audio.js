// Minimal synthesized cues (placeholder, not final SFX). Audio starts only after the
// user turns sound on in settings (a user gesture), per browser autoplay rules.
let ctx = null;
let volume = 0.6;
export function enableAudio(v = 0.6) {
  volume = v;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
export function setVolume(v) { volume = v; }
const last = {};
export function sfx(kind) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (last[kind] && now - last[kind] < 0.06) return;   // rate-limit per cue
  last[kind] = now;
  const spec = {
    hit: [[620, 0.05, 'triangle', 0.18]],
    crit: [[880, 0.06, 'triangle', 0.22], [1320, 0.08, 'sine', 0.12]],
    warn: [[220, 0.18, 'sawtooth', 0.12]],
    metal: [[1250, 0.12, 'square', 0.08], [1870, 0.18, 'sine', 0.08]],
    bell: [[660, 0.5, 'sine', 0.2], [990, 0.6, 'sine', 0.1]],
    rise: [[180, 0.4, 'sawtooth', 0.08], [360, 0.5, 'sine', 0.12], [720, 0.7, 'sine', 0.16]],
  }[kind];
  if (!spec) return;
  spec.forEach(([f, dur, type, gain], i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    const t0 = now + i * 0.06;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * volume, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  });
}
