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
// layered cue table: [freq, dur, type, gain, delay?]; type 'noise' = filtered white
// noise (whoosh / impact body). Hit cues get a little random detune so rapid
// combos don't sound identical.
const SPEC = {
  hit: [[2400, 0.05, 'noise', 0.22, 0], [620, 0.05, 'triangle', 0.14, 0]],
  hit2: [[3200, 0.05, 'noise', 0.22, 0], [760, 0.05, 'triangle', 0.14, 0.01]],
  finisher: [[900, 0.12, 'noise', 0.32, 0], [170, 0.14, 'square', 0.12, 0], [520, 0.1, 'triangle', 0.16, 0.02]],
  crit: [[2800, 0.07, 'noise', 0.28, 0], [880, 0.06, 'triangle', 0.22, 0], [1320, 0.1, 'sine', 0.14, 0.05]],
  skill: [[1600, 0.1, 'noise', 0.26, 0], [440, 0.08, 'sawtooth', 0.08, 0], [880, 0.12, 'triangle', 0.12, 0.03]],
  cast: [[520, 0.14, 'sine', 0.1, 0], [780, 0.16, 'sine', 0.08, 0.05]],
  buff: [[660, 0.22, 'sine', 0.12, 0], [990, 0.28, 'sine', 0.1, 0.07]],
  ult: [[160, 0.6, 'sawtooth', 0.08, 0], [320, 0.6, 'sine', 0.12, 0.08], [640, 0.6, 'sine', 0.14, 0.2], [4000, 0.5, 'noise', 0.08, 0.1]],
  boom: [[300, 0.45, 'noise', 0.4, 0], [70, 0.5, 'sine', 0.3, 0], [140, 0.3, 'square', 0.08, 0], [1500, 0.15, 'triangle', 0.1, 0.03]],
  warn: [[220, 0.18, 'sawtooth', 0.12]],
  metal: [[1250, 0.12, 'square', 0.08], [1870, 0.18, 'sine', 0.08]],
  bell: [[660, 0.5, 'sine', 0.2], [990, 0.6, 'sine', 0.1]],
  rise: [[180, 0.4, 'sawtooth', 0.08], [360, 0.5, 'sine', 0.12], [720, 0.7, 'sine', 0.16]],
};
const DETUNE = { hit: 1, hit2: 1, crit: 1, finisher: 1, skill: 1 };
let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(ctx.sampleRate * 0.6);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
export function sfx(kind) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (last[kind] && now - last[kind] < 0.06) return;   // rate-limit per cue
  last[kind] = now;
  const spec = SPEC[kind];
  if (!spec) return;
  const det = DETUNE[kind] ? (Math.random() * 2 - 1) * 90 : 0;
  spec.forEach(([f, dur, type, gain, delay], i) => {
    const g = ctx.createGain();
    const t0 = now + (delay ?? i * 0.06);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * volume, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let src;
    if (type === 'noise') {
      src = ctx.createBufferSource(); src.buffer = noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (1 + det / 1200); bp.Q.value = 0.9;
      src.connect(bp).connect(g);
    } else {
      src = ctx.createOscillator(); src.type = type; src.frequency.value = f; src.detune.value = det;
      src.connect(g);
    }
    g.connect(ctx.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  });
}
