// Fixed-step combat simulation (50 ms ticks). No DOM, no frame timing.
// Damage, ult gauge and rewards are driven by action impact events, never by
// render frames, so 15/30/60 FPS produce the same result for the same seed.
//
// Kinds: 'farm' (endless waves, field boss), 'boss' (90 s), 'dungeon' (kill target in
// time; quarry/gold/books), 'tower' (floor), 'raid' (120 s damage score), 'trial'
// (instructor / past self). The battle emits events; game.js turns 'kill' / 'victory'
// / 'defeat' into state changes.
import { ROLES, ROLE_TABLE, PREFIXES, PREFIX_IDS } from '../data/roles.js';
import { BALANCE, curve } from '../data/balance.js';
import { BOSSES, MONSTERS, SKILLS, TRIALS, ULT_IDS } from '../data/content.js';
const NO_MODS = Object.freeze({});
const NO_THEME = Object.freeze({});
import { clamp } from './util.js';

const C = BALANCE.combat;
const M = BALANCE.monster;
const TICK = C.tickMs;

export const HERO_X = 92;
export const SLOT_X = [204, 250, 296, 342];
export const SPAWN_X = 440;
const WALK = 150 / 1000;

function hpAt(level) {
  const L = M.late.from;
  if (level <= L) return M.hpBase * Math.pow(M.hpGrowth, level);
  return M.hpBase * Math.pow(M.hpGrowth, L) * Math.pow(level / L, M.late.hpExp);
}
function atkAt(level) {
  const L = M.late.from;
  if (level <= L) return M.atkBase * Math.pow(M.atkGrowth, level);
  return M.atkBase * Math.pow(M.atkGrowth, L) * Math.pow(level / L, M.late.atkExp);
}
// v13 난이도 곡선: 레벨이 오를수록 몬스터 체력·공격에 곱하는 배율 (구간 선형 보간)
function curveMul(pts, level) {
  if (!pts || !pts.length) return 1;
  if (level <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [l1, m1] = pts[i];
    if (level <= l1) { const [l0, m0] = pts[i - 1]; return m0 + (m1 - m0) * ((level - l0) / (l1 - l0)); }
  }
  return pts[pts.length - 1][1];
}
export function monsterStats(level, { elite = false, boss = false, fieldBoss = false } = {}) {
  const S = M.scale || {};
  let hp = hpAt(level) * curveMul(S.hp, level) * (boss ? curveMul(S.bossHp, level) : 1);
  let atk = atkAt(level) * curveMul(S.atk, level) * (boss ? curveMul(S.bossAtk, level) : 1);
  if (elite) { hp *= M.elite.hp; atk *= M.elite.atk; }
  if (fieldBoss) { hp *= M.fieldBoss.hp; atk *= M.fieldBoss.atk; }
  if (boss) { hp *= M.boss.hp; atk *= M.boss.atk; }
  return { hp: Math.floor(hp), atk: Math.floor(atk), def: Math.floor(M.defPerLevel * level) };
}
export function goldAt(level) {
  const R = M.rewards;
  const L = M.late.from;
  if (level <= L) return R.goldBase * Math.pow(R.goldGrowth, level - 1);
  return R.goldBase * Math.pow(R.goldGrowth, L - 1) * Math.pow(level / L, R.goldLateExp);
}
export function killRewards(level, { elite = false, boss = false, fieldBoss = false } = {}) {
  const R = M.rewards;
  let exp = curve(R.exp, level);
  let gold = goldAt(level);
  if (elite) { exp *= R.eliteMul; gold *= R.eliteMul; }
  if (fieldBoss) { exp *= 8; gold *= 8; }
  if (boss) { exp *= 25; gold *= 25; }
  return { exp: Math.floor(exp), gold: Math.floor(gold) };
}

export function damageFormula(atk, coef, def, enemyLevel, crit, rngv, critMul = C.critMultiplier) {
  const K = C.defenseKBase + C.defenseKPerEnemyLevel * enemyLevel;
  const raw = atk * coef * (K / (K + def)) * (crit ? critMul : 1) * (0.9 + 0.2 * rngv);
  return Math.max(1, Math.floor(raw));
}

const isUlt = (id) => ULT_IDS.includes(id);

export class Battle {
  /**
   * @param {object} o
   *  kind, rng, hero: {stats, skills:{equipped, ultAuto, autoCast}, skillLevel(id), branch, cls, tier, ult}
   *  farm: {levelFn, monsters, eliteAllowed} | boss: {id} | trial: {tier} |
   *  dungeon: {stage, monsters, type, level, killTarget} | tower: {floor} | raid: {}
   */
  constructor(o) {
    this.kind = o.kind;
    this.rng = o.rng;
    this.t = 0;
    this.events = [];
    this.over = null;
    this.cfg = o;
    this.enemySeq = 0;
    this.enemies = [];
    this.nextSpawnAt = 300;
    this.kills = 0;
    this.damageDealt = 0;
    this.manualQueue = [];
    this.hitChargeWindow = { start: 0, count: 0 };
    const T = BALANCE;
    // 쐐기 던전 (mplus): trash count + boss; HUD timer is o.mplus.timeSec, hard stop hardSec
    this.mp = o.kind === 'mplus' ? { ...o.mplus, spawned: 0, bossUp: false, quakeAt: 15000, aff: new Set(o.mplus.affixes || []) } : null;
    if (this.mp) { this.timerMs = o.mplus.timeSec * 1000; }
    this.killTarget = o.kind === 'mplus' ? o.mplus.trash + 1 : o.kind === 'dungeon' ? (o.dungeon.killTarget || T.dungeon.killTarget) : o.kind === 'tower' ? T.tower.killTarget : o.kind === 'rift' ? o.rift.killTarget : Infinity;
    this.timeLimitMs = o.kind === 'boss' ? C.bossTimeoutSec * 1000
      : o.kind === 'trial' ? T.promotion.trialTimeSec * 1000
      : o.kind === 'dungeon' ? T.dungeon.stageTimeSec * 1000
      : o.kind === 'tower' ? T.tower.timeSec * 1000
      : o.kind === 'raid' ? T.raid.timeSec * 1000
      : o.kind === 'rift' ? o.rift.timeSec * 1000
      : o.kind === 'mplus' ? o.mplus.hardSec * 1000
      : o.kind === 'world' ? o.world.timeSec * 1000 : Infinity;
    this.secondWindUsed = false;
    this.respawnAt = null;
    // v12 farm phases: needs the game's live stage / kill counters (killsFn, stageFn)
    this.phase = o.kind === 'farm' && o.farm && o.farm.killsFn ? { key: null, pending: false, travelUntil: 0, travelFrom: 0, idx: 0 } : null;
    this.setHero(o.hero, true);
    if (o.kind === 'boss') this.spawnBoss(BOSSES[o.boss.id]);
    if (o.kind === 'raid') this.spawnBoss(BOSSES[T.raid.boss], { raid: true });
    if (o.kind === 'world') {   // 월드 보스: score fight, boss HP × hpMul at the hero's level
      const e = this.addEnemy(BOSSES[o.world.boss], o.world.level, { boss: true });
      e.maxHp = e.hp = Math.floor(e.hp * o.world.hpMul);
      if (o.world.atkMul) e.atk = Math.floor(e.atk * o.world.atkMul);
      e.world = true;
      this.worldHp = e.maxHp;
    }
    if (o.kind === 'trial') { const tier = (o.trial && o.trial.tier) || 1; this.spawnBoss({ ...TRIALS[tier], isTrial: true, tier }); }
    // rift: HP carries over between floors
    if (o.kind === 'rift' && o.rift.hpPct !== undefined) this.hero.hp = Math.max(1, Math.floor(this.hero.maxHp * o.rift.hpPct));
  }

  get ultId() { return this.heroCfg.ult || 'starSlash'; }
  get caps() { return (this.heroCfg.stats && this.heroCfg.stats.caps) || {}; }
  // v10 skill mods (전설 고유 효과 + 스킬 각성): per skill id, '*' = whole kit
  modsFor(id) { const sm = this.heroCfg.stats && this.heroCfg.stats.skillMods; return (sm && id && sm[id]) || NO_MODS; }
  get gmods() { return this.modsFor('*'); }
  get curse() { return this.kind === 'rift' ? this.cfg.rift.curse : null; }

  setHero(h, reset = false) {
    const prev = this.hero;
    const st = h.stats;
    this.heroCfg = h;
    this.hero = {
      maxHp: st.hp,
      hp: reset || !prev ? st.hp : clamp(prev.hp * (st.hp / prev.maxHp), 1, st.hp),
      x: HERO_X, px: HERO_X,
      action: prev && !reset ? prev.action : null,
      nextAttackAt: prev && !reset ? prev.nextAttackAt : 0,
      cds: prev && !reset ? prev.cds : {},
      buffs: prev && !reset ? prev.buffs : {},
      shield: prev && !reset ? prev.shield : null,
      gauge: prev ? prev.gauge : (h.gauge || 0),
      counterReadyAt: prev ? prev.counterReadyAt : 0,
      hitFxUntil: 0,
      dead: false,
    };
  }
  updateStats(h) { this.setHero(h, false); }

  // ---------- spawning ----------
  spawnFarmEnemy() {
    const f = this.cfg.farm;
    const level = f.levelFn();
    const ids = f.monsters;
    const id = ids[this.rng.int(0, ids.length - 1)];
    const tm = this.themeMod();
    const elite = f.eliteAllowed() && this.rng() < M.elite.chance * (tm.eliteChanceMul || 1);
    this.addEnemy(MONSTERS[id], level, { elite, mul: f.mulFn ? f.mulFn() : null });
  }
  // 희귀 정예: a named elite joins the farm field (one at a time, never with a field boss)
  spawnRare(rare, level) {
    if (this.kind !== 'farm' || this.enemies.some((e) => e.fieldBoss || e.rare)) return null;
    const def = MONSTERS[rare.base];
    const e = this.addEnemy({ ...def, name: rare.name }, level + 2, { elite: true, plain: true, mul: this.cfg.farm.mulFn ? this.cfg.farm.mulFn() : null });
    e.maxHp = e.hp = Math.floor(e.hp * 5);
    e.atk = Math.floor(e.atk * 1.3);
    e.rare = rare.id;
    this.events.push({ type: 'rareElite', enemy: e.uid, name: rare.name, rare: rare.id, t: this.t });
    return e;
  }
  // Field boss joins the farm field (does not end the battle when killed).
  spawnFieldBoss(level) {
    if (this.kind !== 'farm' || this.enemies.some((e) => e.fieldBoss)) return null;
    const ids = this.cfg.farm.monsters;
    const def = MONSTERS[ids[this.rng.int(0, ids.length - 1)]];
    const e = this.addEnemy({ ...def, name: `필드 보스 · ${def.name}` }, level, { elite: true, fieldBoss: true, plain: true, mul: this.cfg.farm.mulFn ? this.cfg.farm.mulFn() : null });
    this.events.push({ type: 'fieldBoss', enemy: e.uid, name: e.name, t: this.t });
    return e;
  }
  // mul: 노말/하드 scaling { hp, atk } (difficulty.js)
  // v14 주간 테마 규칙 (사냥터 화면 전투에만)
  themeMod() { return (this.kind === 'farm' && this.cfg.farm && this.cfg.farm.themeFn && this.cfg.farm.themeFn()) || NO_THEME; }
  // v14 역할: 레벨 조건을 넘은 역할 중 가중치로 하나
  rollRole(level) {
    const pool = ROLE_TABLE.filter(([, minLv]) => level >= minLv);
    const tot = pool.reduce((a, [, , w]) => a + w, 0);
    let r = this.rng() * tot;
    for (const [id, , w] of pool) { r -= w; if (r < 0) return id; }
    return pool[pool.length - 1][0];
  }
  addEnemy(def, level, { elite = false, boss = false, fieldBoss = false, mul = null, plain = false } = {}) {
    const st = monsterStats(level, { elite, boss, fieldBoss });
    const role = boss || fieldBoss || plain ? null : this.rollRole(level);
    const prefix = elite && !boss && !fieldBoss && !plain ? PREFIX_IDS[Math.floor(this.rng() * PREFIX_IDS.length)] : null;
    if (role) { st.hp = Math.max(1, Math.floor(st.hp * ROLES[role].hp)); st.atk = Math.floor(st.atk * ROLES[role].atk); }
    if (prefix && PREFIXES[prefix].hp) st.hp = Math.floor(st.hp * PREFIXES[prefix].hp);
    if (!boss) {
      const tm = this.themeMod();
      if (tm.hpMul) st.hp = Math.max(1, Math.floor(st.hp * tm.hpMul));
      if (tm.atkMul) st.atk = Math.floor(st.atk * tm.atkMul);
      if (elite && tm.eliteHpMul) st.hp = Math.floor(st.hp * tm.eliteHpMul);
    }
    if (mul) { st.hp = Math.floor(st.hp * mul.hp); st.atk = Math.floor(st.atk * mul.atk); }
    if (this.mp) {
      const a = this.mp.aff;
      let hm = this.mp.statMul, am = this.mp.statMul;
      if (boss) { hm *= this.mp.bossHpMul; if (a.has('tyrannical')) { hm *= 1.3; am *= 1.15; } }
      else if (a.has('fortified')) { hm *= 1.2; am *= 1.3; }
      st.hp = Math.floor(st.hp * hm); st.atk = Math.floor(st.atk * am);
    }
    if (this.kind === 'rift') {
      const r = this.cfg.rift;
      st.hp = Math.floor(st.hp * r.statMul * (r.curse === 'c_iron' ? 1.4 : 1));
      st.atk = Math.floor(st.atk * r.statMul * (r.curse === 'c_fury' ? 1.3 : 1));
    }
    const e = {
      uid: ++this.enemySeq, def, id: def.id, name: def.name, level, elite, boss, fieldBoss, role, prefix,
      healAt: role === 'healer' ? this.t + ROLES.healer.healEverySec * 1000 : Infinity,
      hp: st.hp, maxHp: st.hp, atk: st.atk, defense: st.def,
      x: boss ? SLOT_X[0] + 20 : SPAWN_X, px: boss ? SLOT_X[0] + 20 : SPAWN_X,
      state: boss ? 'ready' : 'approach', stateAt: this.t,
      nextAttackAt: this.t + (boss ? 1500 : 900),
      heavyAt: boss && def.heavy ? this.t + def.heavy.everySec * 1000 : Infinity,
      pending: null, flashUntil: 0, dieAt: 0,
      stunUntil: 0, slowUntil: 0, slowMul: 1, dots: [], enraged: false,
    };
    this.enemies.push(e);
    this.events.push({ type: 'spawn', enemy: e, t: this.t });
    return e;
  }
  spawnBoss(def, { raid = false } = {}) {
    const dv = !raid && !def.isTrial && this.kind === 'boss' && this.cfg.boss && this.cfg.boss.diff;   // 노말/하드 stage boss
    const lv = dv ? dv.level : def.level;
    const e = this.addEnemy(def, lv, { boss: true, mul: dv ? dv.mul : null });
    if (def.isTrial) {
      // instructor projection / past self: a test, not a wall
      const hm = def.hpMul || 0.55, am = def.atkMul || 0.8;
      e.maxHp = e.hp = Math.floor(e.hp * hm);
      e.atk = Math.floor(e.atk * am);
      e.trial = true;
    }
    if (raid) { e.raid = true; e.maxHp = e.hp = Math.floor(e.hp * 3); }
  }
  spawnSessionEnemy() {
    if (this.mp) {
      const mp = this.mp;
      if (mp.spawned < mp.trash) {
        mp.spawned++;
        this.addEnemy(MONSTERS[mp.monsters[this.rng.int(0, mp.monsters.length - 1)]], mp.level, { elite: this.rng() < 0.15 });
      } else if (!mp.bossUp && this.alive().length === 0) {
        mp.bossUp = true;
        const e = this.addEnemy(BOSSES[mp.boss], mp.level + 2, { boss: true });
        this.events.push({ type: 'mplusBoss', enemy: e.uid, name: e.name, t: this.t });
      }
      return;
    }
    if (this.kind === 'rift') {
      const r = this.cfg.rift;
      const ids = r.monsters;
      this.addEnemy(MONSTERS[ids[this.rng.int(0, ids.length - 1)]], r.level, { elite: r.eliteRush || this.rng() < 0.15 });
      return;
    }
    if (this.kind === 'tower') {
      const T = BALANCE.tower;
      const f = this.cfg.tower.floor;
      const lv = T.levelBase + T.levelPerFloor * f;
      const ids = this.cfg.tower.monsters;
      this.addEnemy(MONSTERS[ids[this.rng.int(0, ids.length - 1)]], lv, { elite: this.rng() < Math.min(0.6, T.eliteBase + T.elitePerFloor * f) });
      return;
    }
    const d = this.cfg.dungeon;
    const D = BALANCE.dungeon;
    const lv = d.level || D.levelBase + D.levelPerStage * d.stage;
    const ids = d.monsters;
    this.addEnemy(MONSTERS[ids[this.rng.int(0, ids.length - 1)]], lv, { elite: this.rng() < 0.1 });
  }

  alive() { return this.enemies.filter((e) => e.state !== 'dying'); }
  // v14: 원거리 영웅은 붙어 있는 치유사를 먼저 노림 (없으면 맨 앞)
  heroFront() {
    const f = this.front();
    if (!f || this.heroCfg.range !== 'ranged') return f;
    return this.alive().find((e) => e.role === 'healer' && e.state !== 'approach') || f;
  }
  front() {
    const a = this.alive().filter((e) => e.state !== 'approach' || e.x <= SLOT_X[0] + 1);
    return a.sort((x, y) => x.x - y.x)[0] || null;
  }

  // ---------- inputs ----------
  castManual(skillId) {
    if (this.over || this.hero.dead) return false;
    this.manualQueue.push(skillId === 'starSlash' ? this.ultId : skillId);
    return true;
  }

  // ---------- main step ----------
  step() {
    if (this.over) return;
    this.t += TICK;
    const t = this.t;
    const h = this.hero;
    h.px = h.x;
    for (const e of this.enemies) e.px = e.x;

    if (h.dead) {
      if (this.kind === 'farm' && this.respawnAt !== null && t >= this.respawnAt) this.respawn();
      this.cleanupDying();
      return;
    }
    if (t >= this.timeLimitMs) {
      // raid: the time limit is the end of a scored run, not a loss
      this.finish(this.kind === 'raid' || this.kind === 'world' ? 'victory' : 'defeat', 'timeout');
      return;
    }
    if (this.mp && this.mp.aff.has('quaking') && t >= this.mp.quakeAt) {
      this.mp.quakeAt += 15000;
      this.affixHit(0.08, 'quaking');
      if (this.hero.dead) return;
    }
    if (this.phase && this.phaseStep()) {   // travelling between phases / stages: no enemies, regen, no actions
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * BALANCE.phase.travelRegenPct * (TICK / 1000));
      this.tickBuffs();
      this.cleanupDying();
      return;
    }
    if (this.kind === 'farm' || this.kind === 'dungeon' || this.kind === 'tower' || this.kind === 'rift' || this.kind === 'mplus') {
      if (this.alive().length < C.maxEnemiesOnField && t >= this.nextSpawnAt && (!this.phase || this.phaseRoom())) {
        if (this.kind === 'farm') this.spawnFarmEnemy(); else this.spawnSessionEnemy();
        this.nextSpawnAt = t + C.spawnGapSec * 1000 * (this.themeMod().spawnGapMul || 1);
      }
    }
    this.moveEnemies();
    this.tickBuffs();
    this.tickDots();
    this.regen();
    this.heroAct();
    this.petAct();
    this.enemiesAct();
    this.cleanupDying();
  }

  // ---------- v12 farm phases ----------
  static phaseOf(kills) { const S = BALANCE.phase.sizes; let acc = 0; for (let i = 0; i < S.length; i++) { acc += S[i]; if (kills < acc) return i; } return S.length - 1; }
  static phaseEnd(idx) { return BALANCE.phase.sizes.slice(0, idx + 1).reduce((a, b) => a + b, 0); }
  get traveling() { return !!(this.phase && this.phase.travelUntil); }
  travelProgress() { const P = this.phase; return P && P.travelUntil ? Math.min(1, (this.t - P.travelFrom) / (P.travelUntil - P.travelFrom)) : 0; }
  phaseInfo() { return this.phase ? { idx: this.phase.idx, count: BALANCE.phase.sizes.length, traveling: this.traveling, pending: this.phase.pending } : null; }
  // returns true while travelling (the caller skips combat for this tick)
  phaseStep() {
    const P = this.phase, f = this.cfg.farm, t = this.t;
    const idx = Battle.phaseOf(f.killsFn());
    const key = f.stageFn() + ':' + idx;
    P.idx = idx;
    if (P.key === null) P.key = key;
    if (key !== P.key) { P.key = key; P.pending = true; }
    if (P.pending && !P.travelUntil && !this.alive().length && !this.hero.action) {
      P.pending = false;
      P.travelFrom = t;
      P.travelUntil = t + BALANCE.phase.travelSec * 1000;
      this.events.push({ type: 'travelStart', phase: idx, t });
    }
    if (P.travelUntil) {
      if (t < P.travelUntil) return true;
      P.travelUntil = 0;
      this.nextSpawnAt = t + 150;
      this.events.push({ type: 'travelEnd', phase: idx, t });
    }
    return false;
  }
  // spawn only up to the end of the current phase (field boss / rare elites are extra)
  phaseRoom() {
    const P = this.phase;
    if (P.pending || P.travelUntil) return false;
    const k = this.cfg.farm.killsFn();
    const normal = this.alive().filter((e) => !e.fieldBoss && !e.rare).length;
    return k + normal < Battle.phaseEnd(Battle.phaseOf(k));
  }

  moveEnemies() {
    const alive = this.alive().sort((a, b) => a.uid - b.uid);
    alive.forEach((e, i) => {
      if (e.boss) return;
      const target = SLOT_X[Math.min(i, SLOT_X.length - 1)];
      if (e.x > target) {
        e.x = Math.max(target, e.x - WALK * TICK);
        if (e.state === 'ready' && e.x > target) e.state = 'approach';
      }
      if (e.state === 'approach' && e.x <= target) {
        e.state = 'ready'; e.stateAt = this.t; e.nextAttackAt = Math.max(e.nextAttackAt, this.t + 600);
        if (!e.engagedAt) { e.engagedAt = this.t; this.events.push({ type: 'engage', enemy: e.uid, t: this.t }); }
      }
    });
  }

  tickBuffs() {
    const b = this.hero.buffs;
    for (const k of Object.keys(b)) if (b[k].until <= this.t) delete b[k];
    if (this.hero.shield && this.hero.shield.until <= this.t) this.hero.shield = null;
  }

  tickDots() {
    for (const e of this.alive()) {
      if (!e.dots.length) continue;
      for (const d of e.dots) {
        if (this.t >= d.nextAt && this.t <= d.until) {
          d.nextAt += 1000;
          const dmg = damageFormula(this.heroAtk(), d.coef, e.defense, e.level, false, this.rng());
          this.dealDamage(e, dmg, { crit: false, action: 'dot', skill: d.skill });
          if (e.state === 'dying') break;
        }
      }
      e.dots = e.dots.filter((d) => d.until > this.t);
    }
  }

  // 동료: a small fixed hit on the front enemy every few seconds (no gauge, no crit)
  petAct() {
    const pet = this.heroCfg.pet;
    if (!pet || this.hero.dead) return;
    if (this.petNextAt === undefined) this.petNextAt = this.t + pet.everyMs;
    if (this.t < this.petNextAt) return;
    const e = this.front();
    if (!e || e.state === 'approach' || e.state === 'dying') return;
    this.petNextAt = this.t + pet.everyMs;
    const dmg = damageFormula(this.heroAtk(), pet.coef, e.defense, e.level, false, this.rng());
    this.events.push({ type: 'petAttack', pet: pet.id, target: e.uid, x: e.x, t: this.t });
    this.dealDamage(e, dmg, { crit: false, action: 'pet', skill: pet.id, ranged: true });
  }

  regen() {
    const h = this.hero;
    const engaged = this.alive().some((e) => e.state !== 'approach');
    const rate = engaged ? 0.006 : 0.06;
    if (this.kind === 'farm' || this.kind === 'dungeon' || this.kind === 'tower' || this.kind === 'mplus') h.hp = Math.min(h.maxHp, h.hp + h.maxHp * rate * this.healMul() * (TICK / 1000));
    const rg = this.heroCfg.stats.regen || 0;   // rift blessing 재생
    if (rg && !h.dead) this.heal(h.maxHp * rg * (TICK / 1000));
  }

  heroAtk() {
    const st = this.heroCfg.stats;
    let mul = 1;
    if (this.hero.buffs.atk) mul += this.hero.buffs.atk.mul;
    const bs = SKILLS.berserkStrike.lowHpBonus;
    const low = this.hero.hp / this.hero.maxHp <= bs.below;
    if (this.caps.cap_berserk && low) mul += 0.5;
    else if (this.heroCfg.branch === 'berserker' && low) mul += bs.atkMul;
    if (this.gmods.lowHpAtk && this.hero.hp / this.hero.maxHp <= 0.5) mul += this.gmods.lowHpAtk;
    return st.atk * mul;
  }

  skillCoef(id) {
    const sk = SKILLS[id];
    const lvl = this.heroCfg.skillLevel(id);
    let c = sk.coef * (1 + BALANCE.skills.levelBonusPerLevel * (lvl - 1));
    if (isUlt(id)) { const tier = this.heroCfg.tier || (this.heroCfg.branch ? 1 : 0); if (tier >= 3) c *= 2; else if (tier >= 2) c *= 1.5; }
    if (this.caps.cap_beast2 && (id === 'a_beast' || id === 'a_pack')) c *= 2;
    const m = this.modsFor(id);
    if (m.coefMul) c *= m.coefMul;
    return c;
  }
  cooldownMs(id) {
    let cdr = this.heroCfg.stats.cdr || 0;
    if (this.hero.buffs.mythCdr) cdr = 1 - (1 - cdr) * 0.5;
    return SKILLS[id].cd * 1000 * (1 - Math.min(0.7, cdr)) * (this.modsFor(id).cdMul || 1);
  }

  chooseAction() {
    const h = this.hero;
    const hc = this.heroCfg;
    const t = this.t;
    const ult = this.ultId;
    while (this.manualQueue.length) {
      const id = this.manualQueue.shift();
      if (id === ult && h.gauge >= 100) return { kind: 'ult', skill: id };
      if (id !== ult && this.skillReady(id)) return { kind: 'skill', skill: id };
      this.events.push({ type: 'castRejected', skill: id, reason: id === ult ? 'gauge' : 'cooldown', t });
    }
    if (h.gauge >= 100) {
      const mode = hc.skills.ultAuto;
      const hasElite = this.alive().some((e) => e.elite || e.boss);
      if (mode === 'ALWAYS' || (mode === 'ELITE_BOSS' && hasElite)) return { kind: 'ult', skill: ult };
    }
    if (hc.skills.autoCast) {
      for (const id of hc.skills.equipped) {
        if (!id || !this.skillReady(id)) continue;
        const sk = SKILLS[id];
        if (sk.kind === 'buff' && h.buffs[sk.buff.stat] && h.buffs[sk.buff.stat].until - t > 2000) continue;
        if (sk.kind === 'shield' && h.shield) continue;
        if (sk.kind === 'evade' && !this.alive().some((e) => e.state === 'telegraph' || e.boss)) continue;   // save dodges for real threats
        return { kind: 'skill', skill: id };
      }
    }
    if (t >= h.nextAttackAt) return { kind: 'attack' };
    return null;
  }

  skillReady(id) {
    const sk = SKILLS[id];
    if (!sk || sk.kind === 'passive-counter' || sk.kind === 'ultimate') return false;
    if (!this.heroCfg.skills.equipped.includes(id)) return false;
    return (this.hero.cds[id] || 0) <= this.t;
  }

  heroAct() {
    const h = this.hero;
    const t = this.t;
    const target = this.front();
    if (!h.action) {
      if (!target || target.state === 'approach') return;
      const a = this.chooseAction();
      if (!a) return;
      const st = this.heroCfg.stats;
      if (a.kind === 'attack') {
        const interval = 1000 / st.aspd;
        const dur = Math.min(interval, 560);
        h.action = { ...a, start: t, dur, impactAt: t + Math.round(dur * 0.45 / TICK) * TICK, hit: false };
        h.nextAttackAt = t + interval;
      } else if (a.kind === 'skill') {
        h.action = { ...a, start: t, dur: 600, impactAt: t + 300, hit: false };
        h.cds[a.skill] = t + this.cooldownMs(a.skill);
        this.events.push({ type: 'skillStart', skill: a.skill, t });
      } else if (a.kind === 'ult') {
        h.gauge -= 100;
        h.action = { ...a, start: t, dur: 1100, impactAt: t + 700, hit: false };
        this.events.push({ type: 'ultStart', skill: a.skill, t });
        if (this.heroCfg.stats.mythUltCdr) h.buffs.mythCdr = { until: t + 5000 };
        if (this.gmods.ultInvuln) h.buffs.invuln = { until: t + this.gmods.ultInvuln * 1000 };   // 수호의 맹세
      }
      h.nextAttackAt = Math.max(h.nextAttackAt, t + h.action.dur);
    }
    if (h.echo && t >= h.echo.at) { const e = h.echo; h.echo = null; this.resolveEcho(e); }
    const ac = h.action;
    if (ac && !ac.hit && t >= ac.impactAt) { ac.hit = true; this.resolveHeroImpact(ac); }
    if (ac && t >= ac.start + ac.dur) h.action = null;
  }

  targetsFor(sk, front) {
    if (!sk || sk.target === 'single') return front ? [front] : [];
    return this.alive().filter((e) => e.state !== 'approach' || e.x < 400);
  }

  resolveHeroImpact(ac) {
    const h = this.hero;
    const st = this.heroCfg.stats;
    const front = this.heroFront();
    let sk = null, coef = 1, targets = [], hits = 1;
    if (ac.kind === 'attack') { targets = front ? [front] : []; }
    else {
      sk = SKILLS[ac.skill];
      const md = this.modsFor(ac.skill);
      if (sk.kind === 'buff') { h.buffs[sk.buff.stat] = { mul: sk.buff.mul + (md.buffMulAdd || 0), until: this.t + (sk.buff.sec + (md.buffSecAdd || 0)) * 1000 }; this.events.push({ type: 'buff', skill: ac.skill, t: this.t }); return; }
      if (sk.kind === 'shield') { h.shield = { amount: Math.floor(h.maxHp * (sk.shield.pct + (md.shieldAdd || 0))), until: this.t + sk.shield.sec * 1000 }; if (md.heal) this.heal(h.maxHp * md.heal); this.events.push({ type: 'buff', skill: ac.skill, shield: true, t: this.t }); return; }
      if (sk.kind === 'evade') {
        h.buffs.evade = { until: this.t + (sk.evade.sec + (md.evadeAdd || 0)) * 1000 };
        if (sk.evade.nextCrit) h.buffs.nextCrit = { until: this.t + 6000 };
        if (this.caps.cap_shadowCrit) h.buffs.critStacks = { n: 3, until: this.t + 8000 };
        if (md.critStacks) h.buffs.critStacks = { n: Math.max(md.critStacks, (h.buffs.critStacks && h.buffs.critStacks.n) || 0), until: this.t + 8000 };
        this.events.push({ type: 'buff', skill: ac.skill, evade: true, t: this.t });
        return;
      }
      coef = this.skillCoef(ac.skill);
      hits = sk.hits || 1;
      if (this.caps.cap_rainPlus && ac.skill === 'a_rain') hits = Math.ceil(hits * 1.5);
      if (md.hitsAdd) hits = Math.max(1, hits + md.hitsAdd);
      if (md.toAll && sk.target === 'single') sk = { ...sk, target: 'all' };
      if (md.critBonusAdd) sk = { ...sk, critBonus: (sk.critBonus || 0) + md.critBonusAdd };
      if (md.execute) sk = { ...sk, executeBelow: Math.max(sk.executeBelow || 0, md.execute) };
      targets = this.targetsFor(sk, front);
      if (sk.guard) h.buffs.guard = { reduce: sk.guard.reduce, until: this.t + (sk.guard.sec + (md.guardAdd || 0) + (this.caps.cap_counter2 && !this.heroCfg.skills.equipped.includes('guardCounter') ? 1 : 0)) * 1000 };
      if (sk.evadeSec) h.buffs.evade = { until: this.t + (sk.evadeSec + (md.evadeAdd || 0)) * 1000 };
    }
    const atk = this.heroAtk();
    let kills = 0;
    const ranged = this.heroCfg.range === 'ranged';
    const hitOne = (e, c, extraCrit = 0) => {
      if (!e || e.state === 'dying') return;
      let crit = this.rng() < Math.min(1, st.crit + extraCrit);
      if (h.buffs.nextCrit) { crit = true; delete h.buffs.nextCrit; }
      else if (h.buffs.critStacks && h.buffs.critStacks.n > 0) { crit = true; if (--h.buffs.critStacks.n <= 0) delete h.buffs.critStacks; }
      let cc = c;
      if (sk && sk.executeBelow && e.hp / e.maxHp <= sk.executeBelow) cc *= 2;
      if (e.boss && this.gmods.bossMul) cc *= 1 + this.gmods.bossMul;   // 거인 사냥꾼
      const dmg = damageFormula(atk, cc, e.defense, e.level, crit, this.rng(), st.critMul);
      if (crit && this.gmods.critGauge) this.addGauge(this.gmods.critGauge);   // 집중
      const killed = this.dealDamage(e, dmg, { crit, action: ac.kind, skill: ac.skill || null, ranged });
      if (killed) kills++;
      if (st.combo && this.rng() < st.combo && e.state !== 'dying') {
        const d2 = Math.max(1, Math.floor(dmg * 0.5));
        if (this.dealDamage(e, d2, { crit: false, action: 'combo', skill: null, ranged })) kills++;
      }
      if (this.caps.cap_illusion && e.state !== 'dying' && this.rng() < 0.25) {
        if (this.dealDamage(e, dmg, { crit, action: 'combo', skill: 'illusion', ranged })) kills++;
      }
    };
    if (sk && sk.target === 'spread') {
      for (let i = 0; i < hits; i++) { const a = this.alive().filter((e) => e.state !== 'approach' || e.x < 400); if (!a.length) break; hitOne(a[i % a.length], coef, sk.critBonus || 0); }
    } else {
      for (let i = 0; i < hits; i++) for (const e of targets) hitOne(e, coef, (sk && sk.critBonus) || 0);
    }
    if (sk) {
      const md = this.modsFor(ac.skill);
      const stun = (sk.stunSec || 0) + (md.stunAdd || 0);
      const slow = md.slow || sk.slow;
      const lvMul = 1 + BALANCE.skills.levelBonusPerLevel * (this.heroCfg.skillLevel(ac.skill) - 1);
      for (const e of targets) {
        if (e.state === 'dying') continue;
        if (stun > 0 && !e.boss) e.stunUntil = Math.max(e.stunUntil, this.t + stun * 1000);
        else if (stun > 0 && e.boss) e.stunUntil = Math.max(e.stunUntil, this.t + stun * 400);     // bosses resist
        if (slow) { e.slowUntil = this.t + slow.sec * 1000; e.slowMul = slow.mul; }
        if (sk.dot) e.dots.push({ coef: (this.caps.cap_dot2 ? 2 : 1) * (md.dotMul || 1) * sk.dot.coefPerSec * lvMul, until: this.t + sk.dot.sec * 1000, nextAt: this.t + 1000, skill: ac.skill });
        if (md.dotAdd) e.dots.push({ coef: (this.caps.cap_dot2 ? 2 : 1) * md.dotAdd.coefPerSec * lvMul, until: this.t + md.dotAdd.sec * 1000, nextAt: this.t + 1000, skill: ac.skill });
      }
      if (sk.heal) this.heal(h.maxHp * sk.heal);
      if (md.heal) this.heal(h.maxHp * md.heal);
      if (md.castShield) h.shield = { amount: Math.max((h.shield && h.shield.amount) || 0, Math.floor(h.maxHp * md.castShield)), until: this.t + 4000 };
      // 쌍화염 · 쌍찌르기: the same skill again 300 ms later at × echo (front target, or all for area skills)
      if (md.echo && !h.echo) h.echo = { at: this.t + 300, coef: coef * md.echo, skill: ac.skill, single: sk.target !== 'all', critBonus: sk.critBonus || 0 };
      if (this.caps.cap_beast2 && (ac.skill === 'a_beast' || ac.skill === 'a_pack')) this.heal(h.maxHp * 0.02);
    }
    // 이중 유성: the meteor falls again 400 ms later at 60%
    if (ac.kind === 'ult' && ac.skill === 'm_meteor' && this.caps.cap_meteor2 && !ac.echo) h.echo = { at: this.t + 400, coef: coef * 0.6, skill: ac.skill };
    const U = C.ultCharge;
    let charge = 0;
    if (ac.kind === 'attack' && targets.length) charge += U.perAttack;
    const ig = this.themeMod().ignite;   // v14 화염 주간: 기본 공격이 3초 화상 (새로 맞으면 갱신)
    if (ig && ac.kind === 'attack') for (const e of targets) if (e.state !== 'dying') { e.dots = e.dots.filter((d) => d.skill !== 'ignite'); e.dots.push({ coef: ig.coef, until: this.t + ig.sec * 1000, nextAt: this.t + 1000, skill: 'ignite' }); }
    charge += Math.min(kills * U.perKill, U.killChargeCapPerAction);
    if (ac.kind === 'ult') charge = Math.min(kills * U.perKill, U.killChargeCapPerAction);
    this.addGauge(charge);
  }

  resolveEcho(e) {
    const st = this.heroCfg.stats;
    const atk = this.heroAtk();
    const list = e.single ? [this.heroFront()].filter((x) => x && x.state !== 'dying') : this.alive().filter((x) => x.state !== 'approach' || x.x < 400);
    for (const t of list) {
      const crit = this.rng() < Math.min(1, st.crit + (e.critBonus || 0));
      this.dealDamage(t, damageFormula(atk, e.coef, t.defense, t.level, crit, this.rng(), st.critMul), { crit, action: e.single || !isUlt(e.skill) ? 'skill' : 'ult', skill: e.skill });
    }
  }

  // Applies damage; returns true when the enemy died.
  dealDamage(e, dmg, { crit, action, skill, ranged = false }) {
    const st = this.heroCfg.stats;
    e.hp -= dmg;
    e.flashUntil = this.t + 120;
    this.damageDealt += dmg;
    this.events.push({ type: 'hit', by: 'hero', target: e.uid, dmg, crit, action, skill, ranged, t: this.t, x: e.x });
    if (st.lifesteal) this.heal(dmg * st.lifesteal);
    if (e.prefix === 'thorns' && action !== 'thorns' && !this.hero.dead) {   // v14 가시: 받은 피해 일부를 되돌림
      const P = PREFIXES.thorns;
      const back = Math.max(1, Math.floor(Math.min(dmg * P.reflect, this.hero.maxHp * P.reflectCap)));
      this.hero.hp -= back;
      this.events.push({ type: 'hit', by: 'enemy', target: 'hero', source: e.uid, dmg: back, heavy: false, thorns: true, t: this.t });
      if (this.hero.hp <= 0) this.heroDown();
    }
    if (this.caps.cap_berserk && this.hero.hp / this.hero.maxHp <= 0.5) this.heal(dmg * 0.03);
    if (e.boss && !e.enraged && e.hp > 0 && e.hp / e.maxHp < C.enrage.below && !e.trial) {
      e.enraged = true;
      e.atk = Math.floor(e.atk * C.enrage.atkMul);
      this.events.push({ type: 'enrage', enemy: e.uid, t: this.t });
    }
    if (e.hp <= 0) { this.kill(e); return true; }
    return false;
  }
  heal(v) { const h = this.hero; if (h.dead) return; if (this.curse === 'c_famine') v *= 0.5; v *= this.healMul(); h.hp = Math.min(h.maxHp, h.hp + v); }
  healMul() { return this.mp && this.mp.aff.has('grievous') ? 0.6 : 1; }
  // 쐐기 변칙 피해 (파열·지진): % of max HP, ignores defense/shield, can finish the hero
  affixHit(pct, affix) {
    const h = this.hero;
    if (h.dead) return;
    const dmg = Math.max(1, Math.floor(h.maxHp * pct));
    h.hp -= dmg;
    h.hitFxUntil = this.t + 160;
    this.events.push({ type: 'hit', by: 'enemy', target: 'hero', source: affix, dmg, heavy: false, affix, t: this.t });
    if (h.hp <= 0) this.heroDown();
  }

  addGauge(v) {
    const mul = 1 + (this.heroCfg.stats.ultCharge || 0);
    this.hero.gauge = clamp(this.hero.gauge + v * mul, 0, 100);
  }

  kill(e) {
    e.state = 'dying';
    e.dieAt = this.t + 420;
    this.kills++;
    if (e.prefix === 'split' && !this.over) {   // v14 분열하는: 작은 조각 2마리 (역할·접두사 없음)
      const S = PREFIXES.split.split;
      for (let i = 0; i < S.n; i++) {
        const c = this.addEnemy({ ...e.def, name: e.def.name + ' 조각' }, e.level, { plain: true });
        c.maxHp = c.hp = Math.max(1, Math.floor(e.maxHp * S.hp));
        c.atk = Math.floor(e.atk * S.atk);
        c.x = c.px = e.x + 16 + i * 24; c.shard = true;
      }
    }
    this.events.push({ type: 'kill', enemy: { uid: e.uid, id: e.id, level: e.level, elite: e.elite, boss: e.boss, fieldBoss: !!e.fieldBoss, trial: !!e.trial, rare: e.rare || null }, t: this.t });
    if (this.heroCfg.stats.mythHeal && this.rng() < 0.1) this.heal(this.hero.maxHp * 0.2);
    const kc = this.gmods.killCdrMs;   // 전장의 흐름
    if (kc) for (const k of Object.keys(this.hero.cds)) this.hero.cds[k] = Math.max(this.t, this.hero.cds[k] - kc);
    if (this.kind === 'boss' || this.kind === 'trial' || this.kind === 'raid' || this.kind === 'world') { if (e.boss) this.finish('victory'); }
    if ((this.kind === 'dungeon' || this.kind === 'tower' || this.kind === 'rift') && this.kills >= this.killTarget) this.finish('victory');
    if (this.mp) { if (e.boss) this.finish('victory'); else if (this.mp.aff.has('bursting')) this.affixHit(0.03, 'bursting'); }
  }

  enemiesAct() {
    const t = this.t;
    const front = this.front();
    for (const e of this.alive()) {
      if (e.state === 'approach') continue;   // v13: 붙은 적은 모두 공격 (맨 앞 외에는 sideAtkMul)
      if (e.stunUntil > t) { if (e.pending) e.pending.impactAt += TICK; continue; }
      if (e.role === 'healer' && t >= e.healAt) {   // v14 치유사: 가장 다친 아군 회복
        e.healAt = t + ROLES.healer.healEverySec * 1000;
        const hurt = this.alive().filter((x) => x.hp < x.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (hurt) { const v = Math.floor(hurt.maxHp * ROLES.healer.healPct); hurt.hp = Math.min(hurt.maxHp, hurt.hp + v); this.events.push({ type: 'enemyHeal', enemy: hurt.uid, by: e.uid, amount: v, t }); }
      }
      if (e.role === 'bomber' && !e.pending && e !== front) continue;   // 자폭병은 맨 앞에 서야 터짐
      if (e.pending) {
        if (t >= e.pending.impactAt) {
          const p = e.pending;
          e.pending = null;
          e.state = 'attack'; e.stateAt = t;
          const full = e === this.front() || e.boss || p.blast || (e.role && ROLES[e.role].backFull);
          this.enemyHits(e, p.mult * (full ? 1 : C.sideAtkMul), p.heavy);
          if (p.blast) { if (e.state !== 'dying') { e.blasted = true; this.kill(e); } continue; }   // 자폭: 터진 뒤 쓰러짐
          let interval = C.enemyAttackIntervalSec * 1000;
          if (e.prefix === 'swift') interval /= PREFIXES.swift.atkSpeed;
          const tm = this.themeMod();
          if (tm.enemyAtkSpeed && !e.boss) interval /= tm.enemyAtkSpeed;
          if (e.enraged) interval *= C.enrage.intervalMul;
          if (this.curse === 'c_haste') interval *= 0.75;
          if (e.slowUntil > t) interval /= e.slowMul;
          e.nextAttackAt = t + interval;
        }
        continue;
      }
      if (e.state === 'attack' && t - e.stateAt >= 300) { e.state = 'ready'; e.stateAt = t; }
      if (e.boss && e.def.heavy && t >= e.heavyAt) {
        const hv = e.def.heavy;
        e.pending = { impactAt: t + hv.telegraphMs, mult: hv.mult, heavy: true };
        e.state = 'telegraph'; e.stateAt = t;
        e.heavyAt = t + hv.everySec * 1000 * (e.enraged ? C.enrage.intervalMul : 1) + hv.telegraphMs;
        this.events.push({ type: 'telegraph', enemy: e.uid, heavy: true, name: hv.name, shape: hv.shape, ms: hv.telegraphMs, t });
        continue;
      }
      if (e.role === 'bomber' && t >= e.nextAttackAt) {
        const B = ROLES.bomber;
        e.pending = { impactAt: t + B.blastMs, mult: B.blastMult, heavy: false, blast: true };
        e.state = 'telegraph'; e.stateAt = t;
        this.events.push({ type: 'telegraph', enemy: e.uid, heavy: false, blast: true, name: '자폭', shape: 'circle', ms: B.blastMs, t });
        continue;
      }
      if (t >= e.nextAttackAt) {
        const ms = e.def.telegraphMs || 500;
        e.pending = { impactAt: t + ms, mult: 1, heavy: false };
        e.state = 'telegraph'; e.stateAt = t;
        this.events.push({ type: 'telegraph', enemy: e.uid, heavy: false, shape: e.def.telegraph, ms, t });
      }
    }
  }

  enemyHits(e, mult, heavy) {
    const h = this.hero;
    const st = this.heroCfg.stats;
    // evade: skill window (100%) or passive chance; 수호의 맹세: invulnerable after an ult
    if (h.buffs.invuln && this.t < h.buffs.invuln.until) { this.events.push({ type: 'miss', by: 'enemy', target: 'hero', source: e.uid, heavy, invuln: true, t: this.t }); return; }
    if (h.buffs.evade || (st.evade && this.rng() < st.evade)) {
      this.events.push({ type: 'miss', by: 'enemy', target: 'hero', source: e.uid, heavy, t: this.t });
      return;
    }
    let dmg = damageFormula(e.atk, mult, st.def, e.level, false, this.rng());
    if (this.mp && this.mp.aff.has('raging') && !e.boss && e.hp / e.maxHp < 0.3) dmg = Math.floor(dmg * 1.5);
    const guard = h.buffs.guard;
    if (guard) dmg = Math.max(1, Math.floor(dmg * (1 - guard.reduce)));
    if (st.dmgTaken) dmg = Math.max(1, Math.floor(dmg * (1 - st.dmgTaken)));
    if (h.shield) {
      const ab = Math.min(h.shield.amount, dmg);
      h.shield.amount -= ab; dmg -= ab;
      if (h.shield.amount <= 0) h.shield = null;
    }
    // 재기: once per battle a lethal hit leaves 30% HP
    if (h.hp - dmg <= 0 && this.caps.cap_secondWind && !this.secondWindUsed) { this.secondWindUsed = true; dmg = 0; h.hp = Math.max(h.hp, Math.floor(h.maxHp * 0.3)); this.events.push({ type: 'buff', skill: 'secondWind', t: this.t }); }
    h.hp -= dmg;
    h.hitFxUntil = this.t + 240;
    if (e.prefix === 'vamp' && dmg > 0 && e.state !== 'dying') e.hp = Math.min(e.maxHp, e.hp + Math.floor(dmg * PREFIXES.vamp.lifesteal));   // v14 흡혈하는
    if (st.thorns && dmg > 0 && e.state !== 'dying') this.dealDamage(e, Math.max(1, Math.floor(dmg * st.thorns)), { crit: false, action: 'thorns', skill: null });
    this.events.push({ type: 'hit', by: 'enemy', target: 'hero', source: e.uid, dmg, heavy, guarded: !!guard, t: this.t });
    const w = this.hitChargeWindow;
    if (this.t - w.start >= 1000) { w.start = this.t; w.count = 0; }
    if (w.count < C.ultCharge.hitTakenPerSecCap) { w.count++; this.addGauge(C.ultCharge.perHitTaken); }
    if (guard && this.heroCfg.skills.equipped.includes('guardCounter') && this.t >= h.counterReadyAt && h.hp > 0) {
      h.counterReadyAt = this.t + (this.caps.cap_counter2 ? 500 : SKILLS.guardCounter.internalCd * 1000);
      const crit = this.rng() < st.crit;
      const cd = damageFormula(this.heroAtk(), this.skillCoef('guardCounter') * (this.caps.cap_counter2 ? 2 : 1), e.defense, e.level, crit, this.rng(), st.critMul);
      if (this.dealDamage(e, cd, { crit, action: 'counter', skill: 'guardCounter' })) this.addGauge(C.ultCharge.perKill);
      const cm = this.modsFor('guardCounter');
      if (cm.heal) this.heal(h.maxHp * cm.heal);
    }
    if (h.hp <= 0) this.heroDown();
  }

  heroDown() {
    const h = this.hero;
    h.hp = 0; h.dead = true; h.action = null;
    this.events.push({ type: 'heroDown', t: this.t });
    if (this.kind === 'farm') this.respawnAt = this.t + C.respawnDelaySec * 1000;
    else this.finish(this.kind === 'raid' || this.kind === 'world' ? 'victory' : 'defeat', 'hp');   // raid / world boss: score still counts
  }

  respawn() {
    const h = this.hero;
    h.dead = false; h.hp = h.maxHp; h.action = null; h.buffs = {}; h.shield = null;
    this.enemies = [];
    this.respawnAt = null;
    this.nextSpawnAt = this.t + 400;
    this.events.push({ type: 'respawn', t: this.t });
  }

  cleanupDying() { this.enemies = this.enemies.filter((e) => e.state !== 'dying' || this.t < e.dieAt); }

  finish(result, reason = null) {
    if (this.over) return;
    this.over = result;
    this.events.push({ type: result, reason, t: this.t, kills: this.kills, damage: this.damageDealt, hpPct: this.hero.maxHp ? Math.max(0, this.hero.hp) / this.hero.maxHp : 0 });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
  timeLeftMs() { return Number.isFinite(this.timeLimitMs) ? Math.max(0, this.timeLimitMs - this.t) : null; }
}
