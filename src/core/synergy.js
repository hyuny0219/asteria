// v14 스킬 시너지 (DOM-free). Two halves:
//  - battle hooks: preHit / postHit / onKill, called by Battle for skill & ultimate hits only.
//    They apply tag statuses (화상·냉기·출혈·번개 연쇄) and fire combos, pushing
//    { type: 'synergy', id, name, x } events. Combo damage uses battle.synHit (no re-trigger).
//  - codex: state.synergy = { found: { id: firstAt } }; the first trigger of a combo gives
//    FIRST_REWARD once (recorded inside Game.transact).
import { COMBOS, COMBO_IDS, FIRST_REWARD, STATUS, TAGS, TUNE as T, tagsOf } from '../data/synergy.js';

export const defaultSynergy = () => ({ found: {} });

// ---------- enemy status helpers ----------
const syn = (e) => e.syn || (e.syn = { chill: 0, chillUntil: 0, frozenUntil: 0 });
const now = (b) => b.t;
const dotsOf = (b, e, skill) => e.dots.filter((d) => d.skill === skill && d.until > now(b));
export const burning = (b, e) => dotsOf(b, e, 'syn_burn').length > 0;
export const bleedStacks = (b, e) => dotsOf(b, e, 'syn_bleed').length;
export const chilled = (b, e) => { const s = e.syn; return !!s && ((s.chill > 0 && s.chillUntil > now(b)) || s.frozenUntil > now(b)); };
export const frozen = (b, e) => !!e.syn && e.syn.frozenUntil > now(b);
export const poisoned = (b, e) => e.dots.some((d) => d.until > now(b) && d.skill && !String(d.skill).startsWith('syn_') && tagsOf(d.skill).includes('poison'));
const stunned = (b, e) => e.stunUntil > now(b);
// distinct debuff kinds on an enemy (약점 공략)
export function debuffKinds(b, e) {
  let n = 0;
  if (burning(b, e)) n++;
  if (chilled(b, e) || e.slowUntil > now(b)) n++;
  if (bleedStacks(b, e)) n++;
  if (e.dots.some((d) => d.until > now(b) && !String(d.skill || '').startsWith('syn_'))) n++;
  if (stunned(b, e)) n++;
  return n;
}
const has = (b, comboId) => !b.synCombos || b.synCombos.has(comboId);

function fire(b, id, e) {
  const C = COMBOS[id];
  b.events.push({ type: 'synergy', id, name: C.name, color: C.color, x: e ? e.x : 260, t: b.t });
  b.synergyCount = (b.synergyCount || 0) + 1;
}
function addBleed(b, e, skill) {
  const S = STATUS.bleed;
  const live = dotsOf(b, e, 'syn_bleed');
  if (live.length >= S.max) { live.sort((p, q) => p.until - q.until)[0].until = b.t + S.sec * 1000; return live.length; }
  e.dots.push({ coef: S.coefPerSec * b.synLv(skill), until: b.t + S.sec * 1000, nextAt: b.t + 1000, skill: 'syn_bleed' });
  return live.length + 1;
}
function addBurn(b, e, skill) {
  const S = STATUS.burn;
  const live = dotsOf(b, e, 'syn_burn');
  if (live.length) { live[0].until = b.t + S.sec * 1000; return; }
  e.dots.push({ coef: S.coefPerSec * b.synLv(skill), until: b.t + S.sec * 1000, nextAt: b.t + 1000, skill: 'syn_burn' });
}
function addChill(b, e) {
  const S = STATUS.chill, s = syn(e);
  if (s.chillUntil <= b.t) s.chill = 0;
  s.chill++; s.chillUntil = b.t + S.sec * 1000;
  if (!(e.slowUntil > b.t) || e.slowMul > S.slowMul) { e.slowUntil = b.t + S.sec * 1000; e.slowMul = Math.min(e.slowMul || 1, S.slowMul); }
  else e.slowUntil = Math.max(e.slowUntil, b.t + S.sec * 1000);
  if (s.chill >= S.freezeAt) {
    s.chill = 0;
    const sec = e.boss ? S.bossFreezeSec : S.freezeSec;
    s.frozenUntil = b.t + sec * 1000;
    e.stunUntil = Math.max(e.stunUntil, s.frozenUntil);
    b.events.push({ type: 'frozen', enemy: e.uid, x: e.x, t: b.t });
  }
}

// before the damage roll: multiplier / forced crit (and combos that change this hit)
export function preHit(b, e, skill) {
  const tags = tagsOf(skill);
  const out = { mul: 1, forceCrit: false };
  if (!tags.length || !e || e.state === 'dying') return out;
  if (tags.includes('explode') && burning(b, e) && has(b, 'ignite')) {
    out.mul *= 1 + T.igniteMul; fire(b, 'ignite', e);
    for (const o of b.alive()) if (o !== e && o.state !== 'approach') addBurn(b, o, skill);
  }
  if (tags.includes('explode') && bleedStacks(b, e) && has(b, 'rupture')) {
    const n = bleedStacks(b, e);
    out.mul *= 1 + T.rupturePer * n; fire(b, 'rupture', e);
    e.dots = e.dots.filter((d) => d.skill !== 'syn_bleed');
  }
  if (tags.includes('lightning') && chilled(b, e) && has(b, 'shock') && b.rng() < 0.4) {
    out.mul *= 1 + T.shockMul; fire(b, 'shock', e);
    e.stunUntil = Math.max(e.stunUntil, b.t + (e.boss ? 320 : 800));
  }
  if ((tags.includes('shadow') || tags.includes('precise')) && debuffKinds(b, e) >= 2 && has(b, 'weakpoint')) {
    out.mul *= 1 + T.weakMul; out.forceCrit = true; fire(b, 'weakpoint', e);
  }
  if (tags.includes('beast') && bleedStacks(b, e) && has(b, 'instinct')) {
    out.mul *= 1 + T.instinctMul; fire(b, 'instinct', e); addBleed(b, e, skill);
  }
  if (tags.includes('fire') && chilled(b, e) && has(b, 'steam')) {
    const s = syn(e); s.chill = 0; s.chillUntil = 0;
    fire(b, 'steam', e);
    for (const o of b.alive()) if (o.state !== 'approach' || o.x < 400) b.synHit(o, T.steam, 'steam');
  }
  if (tags.includes('holy') && (stunned(b, e) || frozen(b, e)) && has(b, 'judgement')) {
    fire(b, 'judgement', e);
    b.synHit(e, T.judgement, 'judgement');
    b.heal(b.hero.maxHp * 0.02);
  }
  return out;
}

// after the hit landed: statuses, stack combos, lightning chain
export function postHit(b, e, skill, { first = true } = {}) {
  const tags = tagsOf(skill);
  if (!tags.length || !e) return;
  // multi-hit skills apply their statuses once per target per cast
  const again = b.synCast ? b.synCast.has(e.uid) : false;
  if (b.synCast) b.synCast.add(e.uid);
  const alive = e.state !== 'dying' && !again;
  if (alive && tags.includes('fire')) addBurn(b, e, skill);
  if (alive && tags.includes('frost')) addChill(b, e);
  if (alive && tags.includes('bleed')) {
    const n = addBleed(b, e, skill);
    if (poisoned(b, e) && has(b, 'gangrene') && e.state !== 'dying') {
      fire(b, 'gangrene', e);
      b.synHit(e, T.gangrene, 'gangrene');
      if (e.state !== 'dying') addBleed(b, e, skill);
    }
    if (n >= 3 && e.state !== 'dying' && has(b, 'hemorrhage')) {
      e.dots = e.dots.filter((d) => d.skill !== 'syn_bleed');
      fire(b, 'hemorrhage', e);
      b.synHit(e, T.hemorrhage, 'hemorrhage');
    }
  }
  // 번개: once per cast the bolt jumps to one more enemy at × chain.coefMul of the skill
  if (first && tags.includes('lightning')) {
    const o = b.alive().find((x) => x !== e && (x.state !== 'approach' || x.x < 400));
    if (o) b.synHit(o, STATUS.chain.coefMul * b.synCoef, null, skill);
  }
}

export function onKill(b, e) {
  if (!e.syn || !has(b, 'shatter')) return;
  const fr = frozen(b, e);
  if (!fr && !chilled(b, e)) return;
  e.syn.chill = 0; e.syn.chillUntil = 0; e.syn.frozenUntil = 0;
  const others = b.alive().filter((o) => o !== e && (o.state !== 'approach' || o.x < 400));
  if (!others.length) return;
  fire(b, 'shatter', e);
  for (const o of others) b.synHit(o, fr ? T.shatterFrozen : T.shatter, 'shatter');
}

// combos a kit (equipped skills + ultimate) can make
export function kitTags(skillIds) { return [...new Set(skillIds.filter(Boolean).flatMap(tagsOf))]; }
export function combosFor(skillIds) {
  const tags = new Set(kitTags(skillIds));
  return COMBO_IDS.filter((id) => COMBOS[id].need.every((n) => n.split('|').some((t) => tags.has(t))));
}

// ---------- codex ----------
export function synState(state) {
  const s = state.synergy && typeof state.synergy === 'object' ? state.synergy : (state.synergy = defaultSynergy());
  if (!s.found || typeof s.found !== 'object') s.found = {};
  return s;
}
export const isFound = (state, id) => !!synState(state).found[id];
// record one trigger; returns { first, reward } (reward only on the first ever trigger)
export function record(state, id, nowMs) {
  if (!COMBOS[id]) return { ok: false, reason: 'missing' };
  const s = synState(state);
  if (s.found[id]) return { ok: true, first: false };
  s.found[id] = nowMs;
  state.wallet.gem += FIRST_REWARD.gem;
  return { ok: true, first: true, reward: { gem: FIRST_REWARD.gem }, passXp: FIRST_REWARD.passXp };
}
export { COMBOS, COMBO_IDS, TAGS, tagsOf };
