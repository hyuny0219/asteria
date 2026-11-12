// One function composes every source of player power. Order (docs/IMPLEMENTATION.md):
//   1. base + level gains            2. stat points (class main stat)
//   3. gold upgrades                 4. equipment flat stats
//   5. % sources summed: equipment options, sets, branch tier passives, runes, class mods
//   6. × (1 + sum%) on ATK/HP/DEF    7. combat buffs (applied by combat at hit time)
//   8. caps (crit 60%, crit dmg ×2.5, attack speed 3.0/s, evade 40%, cooldown 40%)
import { OATH_BY_ID } from '../data/oath.js';
import { BALANCE } from '../data/balance.js';
import { BRANCHES, CLASSES, RUNES, SETS, SET_SLOTS } from '../data/content.js';
import { itemOptions, itemStats } from './items.js';
import { talentEffects } from './talents.js';
import { rebirthMultipliers, farmMultipliers as rebirthFarm } from './rebirth.js';
import { ascMultipliers } from './ascension.js';
import { metaBonus } from './meta.js';
import { enchantBonus, foodBonus, jewelBonus } from './crafting.js';
import { skillMods as gearSkillMods } from './gearplus.js';
import { equippedBonus as steedBonus } from './steeds.js';

const P = BALANCE.player;
const U = BALANCE.upgrade;
const C = BALANCE.combat;
const SP = BALANCE.statPoints;

// Slot enhancement level (schema 6): belongs to the equip slot, survives item swaps.
export function slotLevel(state, slotKey) { return (state.slotEnhance && state.slotEnhance[slotKey]) || 0; }
export function equippedItems(state) {
  const out = [];
  for (const id of Object.values(state.equipped)) {
    if (!id) continue;
    const it = state.inventory.find((i) => i.id === id);
    if (it) out.push(it);
  }
  return out;
}

export function setCounts(state) {
  const n = {};
  for (const it of equippedItems(state)) if (it.set && SET_SLOTS.includes(it.slot)) n[it.set] = (n[it.set] || 0) + 1;
  return n;
}
export function activeSetBonuses(state) {
  const out = [];
  for (const [set, c] of Object.entries(setCounts(state))) {
    if (c >= 2) out.push({ set, pieces: 2, bonus: SETS[set].b2 });
    if (c >= 4) out.push({ set, pieces: 4, bonus: SETS[set].b4 });
  }
  return out;
}

export function runeValue(id, level) { return RUNES[id].base * (1 + BALANCE.runes.perLevel * (level - 1)); }

// opts.preset: talent preset index (default the active one)
// opts.rift: { mods, curse } — blessings/curse, only inside a rift run
export function playerStats(state, opts = {}) {
  const p = state.player;
  const lv = p.level;
  const cls = CLASSES[p.cls || 'warrior'];
  const up = p.statsUpgrades;
  const sp = p.stats || {};
  const mainAtkPts = sp[cls.mainStat] || 0;
  const offAtkPts = ['str', 'int', 'dex'].filter((k) => k !== cls.mainStat).reduce((s, k) => s + (sp[k] || 0), 0) + (cls.mainStat === 'agi' ? 0 : 0);
  let atk = P.atk + P.levelGain.atk * (lv - 1) + U.gains.atk * up.atk + SP.mainAtk * mainAtkPts + SP.offAtk * offAtkPts;
  let hp = P.hp + P.levelGain.hp * (lv - 1) + U.gains.hp * up.hp + SP.vit.hp * (sp.vit || 0);
  let def = P.def + P.levelGain.def * (lv - 1) + U.gains.def * up.def + SP.vit.def * (sp.vit || 0);
  let crit = C.critChance + U.gains.crit * up.crit + SP.agi.crit * (sp.agi || 0) + (cls.crit || 0);
  let aspd = C.baseAttackPerSec + U.gains.speed * up.speed + SP.agi.aspd * (sp.agi || 0) + (cls.aspd || 0);
  let evade = SP.agi.evade * (sp.agi || 0) + (cls.evade || 0);
  let cdr = SP.wis.cdr * (sp.wis || 0);
  // percent pool
  const pct = { atkPct: 0, hpPct: 0, defPct: 0, critChance: 0, critDmg: 0, aspd: 0, cdr: 0, ultCharge: 0, goldPct: 0, evade: 0, lifesteal: 0, combo: 0, dmgTaken: 0, mythUltCdr: 0, mythHeal: 0, expPct: 0, offlinePct: 0, dropPct: 0, thorns: 0, regen: 0 };
  const add = (o) => { for (const [k, v] of Object.entries(o)) pct[k] = (pct[k] || 0) + v; };
  const equipBonus = { atk: 0, hp: 0, def: 0, crit: 0 };
  for (const [slotKey, id] of Object.entries(state.equipped)) {
    const it = id && state.inventory.find((i) => i.id === id);
    if (!it) continue;
    const s = itemStats(it, slotLevel(state, slotKey));
    for (const k of Object.keys(s)) equipBonus[k] = (equipBonus[k] || 0) + s[k];
    add(itemOptions(it));
    add(jewelBonus(it));   // v8 보옥
  }
  for (const sb of activeSetBonuses(state)) add(sb.bonus);
  // v15 초월 서약 (퍼센트 부분; 전투 효과 fx는 combat.js)
  { const eg = (p.tier || 0) >= 4 && state.promotion && OATH_BY_ID[state.promotion.oath]; if (eg) add(eg.pct); }
  // branch passives for every tier reached
  let defToAtk = 0;   // v17 기사: 방어력 일부가 공격력으로 (갈래 패시브 defToAtk 합)
  if (cls.lifesteal) add({ lifesteal: cls.lifesteal });   // v17 도적: 기본 흡혈
  if (p.branch && BRANCHES[p.branch]) {
    const tiers = BRANCHES[p.branch].tiers;
    for (let t = 0; t < Math.min(p.tier || 1, 4); t++) {
      const tp = tiers[t];
      if (!tp) continue;
      add({ atkPct: tp.atk || 0, hpPct: tp.hp || 0, defPct: tp.def || 0, critChance: tp.crit || 0, critDmg: tp.critDmg || 0, cdr: tp.cdr || 0, aspd: tp.aspd || 0, evade: tp.evade || 0, lifesteal: tp.lifesteal || 0, dmgTaken: tp.dmgTaken || 0 });
      defToAtk += tp.defToAtk || 0;
    }
  }
  // runes
  const rn = state.skills.runes;
  if (rn) for (const id of rn.equipped || []) if (id && rn.owned[id]) {
    const v = runeValue(id, rn.owned[id]);
    const st = RUNES[id].stat;
    add({ [st]: v });
  }
  // 도감 · 칭호 · 동료 오라 (small permanent bonuses)
  add(metaBonus(state));
  // v8 마부(슬롯) · 버프 음식(30분)
  add(enchantBonus(state));
  add(foodBonus(state, opts.now !== undefined ? opts.now : Date.now()));
  // v12 탈것 · 날개 (equipped ones; expeditionCut is read by the expedition module)
  { const { expeditionCut, ...sb } = steedBonus(state); add(sb); }
  // v10 전설 고유 효과 · 스킬 각성 (skill mods; '*' may carry plain % stats)
  const sm = gearSkillMods(state);
  if (sm['*'] && sm['*'].pct) add(sm['*'].pct);
  // talents (preset), rift blessings/curse
  const tal = state.talents ? talentEffects(state, opts.preset !== undefined ? opts.preset : state.talents.active) : { pct: {}, caps: {} };
  add(tal.pct);
  const rift = opts.rift || null;
  if (rift) {
    const { clearHeal, riftReward, ...m } = rift.mods || {};
    add(m);
    if (rift.curse === 'c_glass') add({ hpPct: -0.25, atkPct: 0.15 });
    if (rift.curse === 'c_dark') add({ critChance: -0.1 });
  }
  atk += equipBonus.atk; hp += equipBonus.hp; def += equipBonus.def; crit += equipBonus.crit;
  const rb = rebirthMultipliers(state);
  const asc = ascMultipliers(state);   // v18.5 초월 레벨
  atk *= (cls.mods.atk || 1) * (1 + pct.atkPct) * rb.atk * asc.atk;
  hp *= (cls.mods.hp || 1) * Math.max(0.2, 1 + pct.hpPct) * rb.hp * asc.hp;
  def *= (cls.mods.def || 1) * (1 + pct.defPct) * asc.def;
  if (defToAtk) atk += def * defToAtk;
  crit = Math.max(0, crit + pct.critChance);
  aspd *= 1 + pct.aspd;
  evade += pct.evade;
  cdr += pct.cdr;
  const rawCrit = crit;
  crit = Math.min(crit, C.critChanceCap);
  aspd = Math.min(aspd, C.attackSpeedCap);
  const critMul = Math.min(C.critDmgCap, C.critMultiplier + pct.critDmg);
  return {
    atk: Math.floor(atk), hp: Math.floor(hp), def: Math.floor(def), crit, critMul, aspd,
    evade: Math.min(C.evadeCap, evade), cdr: Math.min(C.cdrCap, cdr),
    ultCharge: pct.ultCharge, goldPct: pct.goldPct, lifesteal: pct.lifesteal, combo: Math.min(0.8, pct.combo), dmgTaken: Math.min(0.5, pct.dmgTaken),
    expPct: pct.expPct, offlinePct: pct.offlinePct, dropPct: pct.dropPct, thorns: pct.thorns, regen: pct.regen, caps: tal.caps,
    rebirth: rebirthFarm(state), skillMods: sm,
    mythUltCdr: pct.mythUltCdr > 0, mythHeal: pct.mythHeal > 0,
    rawCrit, equipBonus, capped: { crit: rawCrit > C.critChanceCap, aspd: aspd >= C.attackSpeedCap },
  };
}

// Rough single-number power for display only. Not used for any reward.
export function powerRating(st) {
  return Math.floor(st.atk * st.aspd * (1 + st.crit * (st.critMul - 1)) * 6 + st.hp * 0.6 + st.def * 8);
}
