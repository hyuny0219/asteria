// One function composes level stats + gold upgrades + equipment + branch + buffs.
// Order (documented in docs/IMPLEMENTATION.md):
//   1. base + level gains   2. + gold upgrades   3. + equipment flat
//   4. × branch passive     5. × combat buffs (applied by combat at hit time)
//   6. caps (crit 60%, attack speed 3.0/s) — values beyond caps are ignored.
import { BALANCE } from '../data/balance.js';
import { BRANCHES } from '../data/content.js';
import { itemStats } from './items.js';

const P = BALANCE.player;
const U = BALANCE.upgrade;
const C = BALANCE.combat;

export function playerStats(state) {
  const lv = state.player.level;
  const up = state.player.statsUpgrades;
  let atk = P.atk + P.levelGain.atk * (lv - 1) + U.gains.atk * up.atk;
  let hp = P.hp + P.levelGain.hp * (lv - 1) + U.gains.hp * up.hp;
  let def = P.def + P.levelGain.def * (lv - 1) + U.gains.def * up.def;
  let crit = C.critChance + U.gains.crit * up.crit;
  let aspd = C.baseAttackPerSec + U.gains.speed * up.speed;
  const equipBonus = { atk: 0, hp: 0, def: 0, crit: 0 };
  for (const slot of Object.keys(state.equipped)) {
    const id = state.equipped[slot];
    if (!id) continue;
    const item = state.inventory.find((i) => i.id === id);
    if (!item) continue;
    const s = itemStats(item);
    for (const k of Object.keys(s)) equipBonus[k] += s[k];
  }
  atk += equipBonus.atk; hp += equipBonus.hp; def += equipBonus.def; crit += equipBonus.crit;
  const br = state.player.branch ? BRANCHES[state.player.branch].passive : null;
  if (br) {
    if (br.atk) atk *= 1 + br.atk;
    if (br.hp) hp *= 1 + br.hp;
    if (br.def) def *= 1 + br.def;
  }
  const rawCrit = crit;
  crit = Math.min(crit, C.critChanceCap);
  aspd = Math.min(aspd, C.attackSpeedCap);
  return {
    atk: Math.floor(atk), hp: Math.floor(hp), def: Math.floor(def), crit, critMul: C.critMultiplier, aspd,
    rawCrit, equipBonus, capped: { crit: rawCrit > C.critChanceCap, aspd: aspd >= C.attackSpeedCap },
  };
}

// Rough single-number power for display only (detail panel). Not used for any reward.
export function powerRating(st) {
  return Math.floor(st.atk * st.aspd * (1 + st.crit * (st.critMul - 1)) * 6 + st.hp * 0.6 + st.def * 8);
}
