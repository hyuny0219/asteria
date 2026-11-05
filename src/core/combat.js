// Fixed-step combat simulation (50 ms ticks). No DOM, no frame timing.
// Damage, ult gauge and rewards are driven by action impact events, never by
// render frames, so 15/30/60 FPS produce the same result for the same seed.
//
// Kinds: 'farm' (endless waves), 'boss' (90 s limit), 'dungeon' (kill target in
// time), 'trial' (instructor projection). The battle emits events; game.js turns
// 'kill' / 'victory' / 'defeat' into state changes.
import { BALANCE } from '../data/balance.js';
import { BOSSES, MONSTERS, SKILLS, TRIAL } from '../data/content.js';
import { clamp } from './util.js';

const C = BALANCE.combat;
const M = BALANCE.monster;
const TICK = C.tickMs;

export const HERO_X = 92;
export const SLOT_X = [204, 300];       // where the 1st/2nd enemy stand
export const SPAWN_X = 440;
const WALK = 150 / 1000;                // px per ms

export function monsterStats(level, { elite = false, boss = false } = {}) {
  let hp = M.hpBase * Math.pow(M.hpGrowth, level);
  let atk = M.atkBase * Math.pow(M.atkGrowth, level);
  if (elite) { hp *= M.elite.hp; atk *= M.elite.atk; }
  if (boss) { hp *= M.boss.hp; atk *= M.boss.atk; }
  return { hp: Math.floor(hp), atk: Math.floor(atk), def: Math.floor(M.defPerLevel * level) };
}
export function killRewards(level, { elite = false, boss = false } = {}) {
  const R = M.rewards;
  let exp = R.expBase * Math.pow(R.expGrowth, level - 1);
  let gold = R.goldBase * Math.pow(R.goldGrowth, level - 1);
  if (elite) { exp *= R.eliteMul; gold *= R.eliteMul; }
  if (boss) { exp *= 25; gold *= 25; }
  return { exp: Math.floor(exp), gold: Math.floor(gold) };
}

export function damageFormula(atk, coef, def, enemyLevel, crit, rngv) {
  const K = C.defenseKBase + C.defenseKPerEnemyLevel * enemyLevel;
  const raw = atk * coef * (K / (K + def)) * (crit ? C.critMultiplier : 1) * (0.9 + 0.2 * rngv);
  return Math.max(1, Math.floor(raw));
}

export class Battle {
  /**
   * @param {object} o
   *  kind, rng, hero: {stats, skills:{equipped, ultAuto, autoCast}, skillLevel(id), branch}
   *  farm: {levelFn: () => level, monsters: [ids], eliteChance}
   *  boss: {id} | trial: {} | dungeon: {stage}
   */
  constructor(o) {
    this.kind = o.kind;
    this.rng = o.rng;
    this.t = 0;
    this.events = [];
    this.over = null;              // null | 'victory' | 'defeat'
    this.cfg = o;
    this.enemySeq = 0;
    this.enemies = [];
    this.nextSpawnAt = 300;
    this.kills = 0;
    this.manualQueue = [];
    this.hitChargeWindow = { start: 0, count: 0 };
    this.timeLimitMs = o.kind === 'boss' ? C.bossTimeoutSec * 1000
      : o.kind === 'trial' ? BALANCE.promotion.trialTimeSec * 1000
      : o.kind === 'dungeon' ? BALANCE.dungeon.stageTimeSec * 1000 : Infinity;
    this.respawnAt = null;
    this.setHero(o.hero, true);
    if (o.kind === 'boss') this.spawnBoss(BOSSES[o.boss.id]);
    if (o.kind === 'trial') this.spawnBoss({ ...TRIAL, isTrial: true });
  }

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
    const elite = f.eliteAllowed() && this.rng() < M.elite.chance;
    this.addEnemy(MONSTERS[id], level, { elite });
  }
  addEnemy(def, level, { elite = false, boss = false } = {}) {
    const st = monsterStats(level, { elite, boss });
    const e = {
      uid: ++this.enemySeq, def, id: def.id, name: def.name, level, elite, boss,
      hp: st.hp, maxHp: st.hp, atk: st.atk, defense: st.def,
      x: boss ? SLOT_X[0] + 20 : SPAWN_X, px: boss ? SLOT_X[0] + 20 : SPAWN_X,
      state: boss ? 'ready' : 'approach', stateAt: this.t,
      nextAttackAt: this.t + (boss ? 1500 : 900),
      heavyAt: boss && def.heavy ? this.t + def.heavy.everySec * 1000 : Infinity,
      pending: null,       // {impactAt, mult, heavy}
      flashUntil: 0, dieAt: 0,
    };
    this.enemies.push(e);
    this.events.push({ type: 'spawn', enemy: e, t: this.t });
    return e;
  }
  spawnBoss(def) {
    const lv = def.isTrial ? TRIAL.level : def.level;
    const e = this.addEnemy(def, lv, { boss: true });
    if (def.isTrial) {
      // instructor projection: softer than a region boss (it is a test, not a wall)
      e.maxHp = e.hp = Math.floor(e.hp * 0.55);
      e.atk = Math.floor(e.atk * 0.8);
      e.trial = true;
    }
  }
  spawnDungeonEnemy() {
    const D = BALANCE.dungeon;
    const lv = D.levelBase + D.levelPerStage * this.cfg.dungeon.stage;
    const ids = this.cfg.dungeon.monsters;
    this.addEnemy(MONSTERS[ids[this.rng.int(0, ids.length - 1)]], lv, { elite: this.rng() < 0.1 });
  }

  alive() { return this.enemies.filter((e) => e.state !== 'dying'); }
  front() {
    const a = this.alive().filter((e) => e.state !== 'approach' || e.x <= SLOT_X[0] + 1);
    return a.sort((x, y) => x.x - y.x)[0] || null;
  }

  // ---------- inputs ----------
  castManual(skillId) {
    if (this.over || this.hero.dead) return false;
    this.manualQueue.push(skillId);
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
      this.finish(this.kind === 'dungeon' ? 'defeat' : 'defeat', 'timeout');
      return;
    }

    // spawning
    if (this.kind === 'farm' || this.kind === 'dungeon') {
      if (this.alive().length < C.maxEnemiesOnField && t >= this.nextSpawnAt) {
        if (this.kind === 'farm') this.spawnFarmEnemy(); else this.spawnDungeonEnemy();
        this.nextSpawnAt = t + C.spawnGapSec * 1000;
      }
    }

    this.moveEnemies();
    this.tickBuffs();
    this.regen();
    this.heroAct();
    this.enemiesAct();
    this.cleanupDying();
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
  }

  regen() {
    const h = this.hero;
    const engaged = this.alive().some((e) => e.state !== 'approach');
    const rate = engaged ? 0.006 : 0.06;   // fraction of max HP per second
    if (this.kind === 'farm' || this.kind === 'dungeon') h.hp = Math.min(h.maxHp, h.hp + h.maxHp * rate * (TICK / 1000));
  }

  heroAtk() {
    const st = this.heroCfg.stats;
    let mul = 1;
    if (this.hero.buffs.atk) mul += this.hero.buffs.atk.mul;
    const bs = SKILLS.berserkStrike.lowHpBonus;
    if (this.heroCfg.branch === 'berserker' && this.hero.hp / this.hero.maxHp <= bs.below) mul += bs.atkMul;
    return st.atk * mul;
  }

  skillCoef(id) {
    const sk = SKILLS[id];
    const lvl = this.heroCfg.skillLevel(id);
    return sk.coef * (1 + BALANCE.skills.levelBonusPerLevel * (lvl - 1));
  }

  chooseAction(target) {
    const h = this.hero;
    const hc = this.heroCfg;
    const t = this.t;
    // 1) manual requests have priority when their condition is met
    while (this.manualQueue.length) {
      const id = this.manualQueue.shift();
      if (id === 'starSlash' && h.gauge >= 100) return { kind: 'ult', skill: id };
      if (id !== 'starSlash' && this.skillReady(id)) return { kind: 'skill', skill: id };
      this.events.push({ type: 'castRejected', skill: id, reason: id === 'starSlash' ? 'gauge' : 'cooldown', t });
    }
    // 2) ult auto
    if (h.gauge >= 100) {
      const mode = hc.skills.ultAuto;
      const hasElite = this.alive().some((e) => e.elite || e.boss);
      if (mode === 'ALWAYS' || (mode === 'ELITE_BOSS' && hasElite)) return { kind: 'ult', skill: 'starSlash' };
    }
    // 3) auto-cast normal skills in slot order
    if (hc.skills.autoCast) {
      for (const id of hc.skills.equipped) {
        if (!id || !this.skillReady(id)) continue;
        if (id === 'warCry' && h.buffs.atk && h.buffs.atk.until - t > 2000) continue;
        return { kind: 'skill', skill: id };
      }
    }
    // 4) basic attack on cadence
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
      const a = this.chooseAction(target);
      if (!a) return;
      const st = this.heroCfg.stats;
      if (a.kind === 'attack') {
        const interval = 1000 / st.aspd;
        const dur = Math.min(interval, 560);
        h.action = { ...a, start: t, dur, impactAt: t + Math.round(dur * 0.45 / TICK) * TICK, hit: false, kills: 0 };
        h.nextAttackAt = t + interval;
      } else if (a.kind === 'skill') {
        const sk = SKILLS[a.skill];
        h.action = { ...a, start: t, dur: 600, impactAt: t + 300, hit: false, kills: 0 };
        h.cds[a.skill] = t + sk.cd * 1000;
        this.events.push({ type: 'skillStart', skill: a.skill, t });
      } else if (a.kind === 'ult') {
        h.gauge -= 100;   // spend on cast
        h.action = { ...a, start: t, dur: 1100, impactAt: t + 700, hit: false, kills: 0 };
        this.events.push({ type: 'ultStart', t });
      }
      h.nextAttackAt = Math.max(h.nextAttackAt, t + (h.action.dur));
    }
    const ac = h.action;
    if (ac && !ac.hit && t >= ac.impactAt) {
      ac.hit = true;
      this.resolveHeroImpact(ac);
    }
    if (ac && t >= ac.start + ac.dur) h.action = null;
  }

  resolveHeroImpact(ac) {
    const h = this.hero;
    const st = this.heroCfg.stats;
    let targets = [];
    const front = this.front();
    let coef = 1;
    if (ac.kind === 'attack') { coef = 1; targets = front ? [front] : []; }
    else if (ac.kind === 'skill') {
      const sk = SKILLS[ac.skill];
      if (sk.kind === 'buff') {
        h.buffs[sk.buff.stat] = { mul: sk.buff.mul, until: this.t + sk.buff.sec * 1000 };  // same type: max value, refresh
        this.events.push({ type: 'buff', skill: ac.skill, t: this.t });
        return;
      }
      coef = this.skillCoef(ac.skill);
      targets = front ? [front] : [];
      if (sk.guard) h.buffs.guard = { reduce: sk.guard.reduce, until: this.t + sk.guard.sec * 1000 };
    } else if (ac.kind === 'ult') {
      coef = this.skillCoef('starSlash');
      targets = this.alive().filter((e) => e.state !== 'approach' || e.x < 400);
    }
    const atk = this.heroAtk();
    let killsThisAction = 0;
    for (const e of targets) {
      const crit = this.rng() < st.crit;
      const dmg = damageFormula(atk, coef, e.defense, e.level, crit, this.rng());
      e.hp -= dmg;
      e.flashUntil = this.t + 120;
      this.events.push({ type: 'hit', by: 'hero', target: e.uid, dmg, crit, action: ac.kind, skill: ac.skill || null, t: this.t, x: e.x });
      if (e.hp <= 0) { this.kill(e); killsThisAction++; }
    }
    // ult gauge: +2 on a completed basic attack, +5 per kill (max 10 per action)
    const U = C.ultCharge;
    let charge = 0;
    if (ac.kind === 'attack' && targets.length) charge += U.perAttack;
    charge += Math.min(killsThisAction * U.perKill, U.killChargeCapPerAction);
    if (ac.kind !== 'ult') this.addGauge(charge);
    else this.addGauge(Math.min(killsThisAction * U.perKill, U.killChargeCapPerAction));
  }

  addGauge(v) { this.hero.gauge = clamp(this.hero.gauge + v, 0, 100); }

  kill(e) {
    e.state = 'dying';
    e.dieAt = this.t + 420;
    this.kills++;
    this.events.push({ type: 'kill', enemy: { uid: e.uid, id: e.id, level: e.level, elite: e.elite, boss: e.boss, trial: !!e.trial }, t: this.t });
    if (this.kind === 'boss' || this.kind === 'trial') this.finish('victory');
    if (this.kind === 'dungeon' && this.kills >= BALANCE.dungeon.killTarget) this.finish('victory');
  }

  enemiesAct() {
    const t = this.t;
    const front = this.front();
    for (const e of this.alive()) {
      if (e.state === 'approach') continue;
      if (e !== front) continue;     // only the front enemy fights; others wait their turn
      if (e.pending) {
        if (t >= e.pending.impactAt) {
          const p = e.pending;
          e.pending = null;
          e.state = 'attack'; e.stateAt = t;
          this.enemyHits(e, p.mult, p.heavy);
          e.nextAttackAt = t + C.enemyAttackIntervalSec * 1000;
        }
        continue;
      }
      if (e.state === 'attack' && t - e.stateAt >= 300) { e.state = 'ready'; e.stateAt = t; }
      if (e.boss && e.def.heavy && t >= e.heavyAt) {
        const hv = e.def.heavy;
        e.pending = { impactAt: t + hv.telegraphMs, mult: hv.mult, heavy: true };
        e.state = 'telegraph'; e.stateAt = t;
        e.heavyAt = t + hv.everySec * 1000 + hv.telegraphMs;
        this.events.push({ type: 'telegraph', enemy: e.uid, heavy: true, name: hv.name, shape: hv.shape, ms: hv.telegraphMs, t });
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
    let dmg = damageFormula(e.atk, mult, st.def, e.level, false, this.rng());
    const guard = h.buffs.guard;
    if (guard) dmg = Math.max(1, Math.floor(dmg * (1 - guard.reduce)));
    h.hp -= dmg;
    h.hitFxUntil = this.t + 240;
    this.events.push({ type: 'hit', by: 'enemy', target: 'hero', source: e.uid, dmg, heavy, guarded: !!guard, t: this.t });
    // ult gauge +1 per real hit taken, max 2 per second
    const w = this.hitChargeWindow;
    if (this.t - w.start >= 1000) { w.start = this.t; w.count = 0; }
    if (w.count < C.ultCharge.hitTakenPerSecCap) { w.count++; this.addGauge(C.ultCharge.perHitTaken); }
    // knight counter: reacts to damage received during the guard window
    if (guard && this.heroCfg.skills.equipped.includes('guardCounter') && this.t >= h.counterReadyAt && h.hp > 0) {
      h.counterReadyAt = this.t + SKILLS.guardCounter.internalCd * 1000;
      const crit = this.rng() < st.crit;
      const cd = damageFormula(this.heroAtk(), this.skillCoef('guardCounter'), e.defense, e.level, crit, this.rng());
      e.hp -= cd; e.flashUntil = this.t + 120;
      this.events.push({ type: 'hit', by: 'hero', target: e.uid, dmg: cd, crit, action: 'counter', skill: 'guardCounter', t: this.t, x: e.x });
      if (e.hp <= 0) { this.kill(e); this.addGauge(C.ultCharge.perKill); }
    }
    if (h.hp <= 0) this.heroDown();
  }

  heroDown() {
    const h = this.hero;
    h.hp = 0; h.dead = true; h.action = null;
    this.events.push({ type: 'heroDown', t: this.t });
    if (this.kind === 'farm') {
      this.respawnAt = this.t + C.respawnDelaySec * 1000;
    } else {
      this.finish('defeat', 'hp');
    }
  }

  respawn() {
    const h = this.hero;
    h.dead = false; h.hp = h.maxHp; h.action = null; h.buffs = {};
    this.enemies = [];
    this.respawnAt = null;
    this.nextSpawnAt = this.t + 400;
    this.events.push({ type: 'respawn', t: this.t });
  }

  cleanupDying() {
    this.enemies = this.enemies.filter((e) => e.state !== 'dying' || this.t < e.dieAt);
  }

  finish(result, reason = null) {
    if (this.over) return;
    this.over = result;
    // boss death fires exactly one completion event; UI timing never gates it
    this.events.push({ type: result, reason, t: this.t, kills: this.kills });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  timeLeftMs() { return Number.isFinite(this.timeLimitMs) ? Math.max(0, this.timeLimitMs - this.t) : null; }
}
