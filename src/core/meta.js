// v5 part 2 systems: 도감, 업적·칭호, 무료 시즌 패스, 동료(정령·펫), 신화 제작.
// Pure state functions; Game wraps the player actions in transact() and calls the
// track* hooks from the places where kills, boss wins, tower/rift results happen.
import { give as giveSteed } from './steeds.js';
import { BALANCE } from '../data/balance.js';
import { ACHIEVEMENTS, CODEX, CODEX_MONSTERS, CRAFT, PASS, PETS, PET_RULES, TITLES } from '../data/meta.js';
import { BOSSES, RARITY } from '../data/content.js';
import { killRewards } from './combat.js';
import { makeItem } from './items.js';
import { kstDayIndex } from './util.js';

const goldPerMinute = (lv) => killRewards(lv).gold * 20;
const RARITIES = Object.keys(RARITY);

export function defaultMeta() {
  return {
    codex: { kills: {}, items: {} },
    achievements: { claimed: {} },
    titles: { owned: [], equipped: null },
    pass: { season: null, xp: 0, claimed: {}, killDay: null, killXpToday: 0, killCarry: 0 },
    pets: { owned: {}, active: null, eggs: 0, food: 0, hatched: 0 },
  };
}

// ---------- 도감 ----------
export function trackKill(state, monsterId, n = 1) {
  const k = state.codex.kills;
  k[monsterId] = (k[monsterId] || 0) + n;
}
export function trackItem(state, it) {
  if (!it || !it.slot || !it.rarity) return false;
  const slot = it.slot === 'ring1' || it.slot === 'ring2' ? 'ring' : it.slot;
  const key = `${slot}:${it.rarity}`;
  if (state.codex.items[key]) return false;
  state.codex.items[key] = true;
  return true;
}
export function codexTier(id, kills) {
  const tiers = BOSSES[id] ? CODEX.bossTiers : CODEX.monsterTiers;
  return tiers.filter((t) => kills >= t).length;
}
export function codexTiersTotal(state) {
  return CODEX_MONSTERS.reduce((s, id) => s + codexTier(id, state.codex.kills[id] || 0), 0);
}
export function codexBonus(state) {
  const out = {};
  CODEX_MONSTERS.forEach((id, i) => {
    const t = codexTier(id, state.codex.kills[id] || 0);
    if (!t) return;
    const st = CODEX.stats[i % CODEX.stats.length];
    out[st] = (out[st] || 0) + t * CODEX.perTier;
  });
  const items = Object.keys(state.codex.items).length;
  if (items) { out.atkPct = (out.atkPct || 0) + items * CODEX.itemPerEntry; out.hpPct = (out.hpPct || 0) + items * CODEX.itemPerEntry; }
  return out;
}
export const codexItemTotal = () => CODEX.itemSlots.length * RARITIES.length;

// ---------- 업적 ----------
const GRADE_RANK = { D: 1, C: 2, B: 3, A: 4, S: 5 };
export function measure(state, key) {
  const c = state.progression.counters;
  if (key === 'peakLevel') return Math.max(state.player.peakLevel || 1, state.player.level);
  if (key === 'kills') return c.kills || 0;
  if (key === 'bossWins') return c.bossWins || 0;
  if (key.startsWith('boss:')) return state.progression.bossCleared[key.slice(5)] ? 1 : 0;
  if (key === 'tower') return state.tower.best || 0;
  if (key === 'rift') return state.rift.best || 0;
  if (key === 'rebirth') return state.rebirth.count || 0;
  if (key === 'draws') return (state.gacha.eq.draws || 0) + (state.gacha.sk.draws || 0);
  if (key === 'enhances') return c.enhances || 0;
  if (key === 'attendance') return state.attendance.count || 0;
  if (key === 'codexTiers') return codexTiersTotal(state);
  if (key === 'pets') return Object.keys(state.pets.owned).length;
  // v18.2
  if (key === 'tier') return state.player.tier || 0;
  if (key === 'skillMax') return Object.values(state.skills.levels || {}).filter((v) => v >= 10).length;
  if (key === 'awaken') return Object.keys(state.skills.awaken || {}).length;
  if (key === 'fieldBosses') return c.fieldBosses || 0;
  if (key === 'deaths') return c.deaths || 0;
  if (key === 'dismantled') return c.dismantled || 0;
  if (key === 'rares') return Object.keys((state.worldBoss && state.worldBoss.rares) || {}).length;
  if (key.startsWith('act2boss:')) { const b = key.slice(9); const tr = state.diff && state.diff.tracks ? Object.values(state.diff.tracks) : []; return (state.progression.bossCleared[b] || tr.some((t) => t && t.bossCleared && t.bossCleared[b])) ? 1 : 0; }
  if (key.startsWith('dboss:')) { const [, d, b] = key.split(':'); const t = state.diff && state.diff.tracks && state.diff.tracks[d]; return t && t.bossCleared && t.bossCleared[b] ? 1 : 0; }
  if (key === 'mplus') { const m = state.mplus; return m ? Math.max(0, ...Object.values(m.best || {})) : 0; }
  if (key === 'raidGrade') return GRADE_RANK[state.raid && state.raid.bestGrade] || 0;
  if (key === 'wbGrade') return GRADE_RANK[state.worldBoss && state.worldBoss.bestGrade] || 0;
  if (key === 'itemCodex') return Object.keys(state.codex.items || {}).length;
  if (key === 'steeds') return Object.keys((state.mounts && state.mounts.owned) || {}).length + Object.keys((state.wings && state.wings.owned) || {}).length;
  if (key === 'uniques') return Object.keys((state.gearPlus && state.gearPlus.vault) || {}).length;
  if (key === 'synergy') return Object.keys((state.synergy && state.synergy.found) || {}).length;
  if (key.startsWith('story:')) return state.story && state.story.seen && state.story.seen[key.slice(6)] ? 1 : 0;
  return 0;
}
export function achievementStatus(state) {
  return ACHIEVEMENTS.map((a) => {
    const v = measure(state, a.key);
    return { ...a, value: Math.min(v, a.goal), done: v >= a.goal, claimed: !!state.achievements.claimed[a.id] };
  });
}
export const claimableAchievements = (state) => achievementStatus(state).filter((a) => a.done && !a.claimed).length;

// grant any meta/wallet reward object
export function grantMeta(state, rw) {
  const w = state.wallet;
  for (const [k, v] of Object.entries(rw)) {
    if (k === 'petEgg') state.pets.eggs += v;
    else if (k === 'petFood') state.pets.food += v;
    else if (k === 'essence') state.rebirth.essence += v;
    else if (k === 'title') { if (!state.titles.owned.includes(v)) state.titles.owned.push(v); }
    else if (k === 'ticket') state.dungeon.tickets += v;
    else if (k === 'mount' || k === 'wing') giveSteed(state, k, v);   // v12: a specific steed id
    else w[k] = (w[k] || 0) + v;
  }
}
export function claimAchievement(state, id) {
  const a = achievementStatus(state).find((x) => x.id === id);
  if (!a) return { ok: false, reason: 'missing' };
  if (a.claimed) return { ok: false, reason: 'duplicate' };
  if (!a.done) return { ok: false, reason: 'conditions' };
  state.achievements.claimed[id] = true;
  const rw = { ...a.reward };
  if (a.title) rw.title = a.title;
  grantMeta(state, rw);
  return { ok: true, id, reward: rw };
}
export function claimAllAchievements(state) {
  const got = [];
  for (const a of achievementStatus(state)) if (a.done && !a.claimed) got.push(claimAchievement(state, a.id));
  if (!got.length) return { ok: false, reason: 'none' };
  const sum = {};
  for (const g of got) for (const [k, v] of Object.entries(g.reward)) { if (k === 'title') (sum.titles ||= []).push(v); else sum[k] = (sum[k] || 0) + v; }
  return { ok: true, count: got.length, reward: sum };
}

// ---------- 칭호 ----------
export function equipTitle(state, id) {
  if (id !== null && (!TITLES[id] || !state.titles.owned.includes(id))) return { ok: false, reason: 'locked' };
  state.titles.equipped = id;
  return { ok: true, id };
}
export const titleBonus = (state) => (state.titles.equipped && TITLES[state.titles.equipped] ? TITLES[state.titles.equipped].bonus : {});
export const titleName = (state) => (state.titles.equipped && TITLES[state.titles.equipped] ? TITLES[state.titles.equipped].name : null);

// ---------- 무료 시즌 패스 ----------
export function seasonIndex(now) { return Math.floor((kstDayIndex(now) - PASS.epochDay) / PASS.days); }
export function seasonBounds(now) {
  const i = seasonIndex(now);
  const startDay = PASS.epochDay + i * PASS.days;
  return { index: i, startDay, endDay: startDay + PASS.days, daysLeft: startDay + PASS.days - kstDayIndex(now) };
}
export function refreshPass(state, now) {
  const i = seasonIndex(now);
  if (state.pass.season !== i) { state.pass.season = i; state.pass.xp = 0; state.pass.claimed = {}; state.pass.killXpToday = 0; state.pass.killCarry = 0; }
  const d = kstDayIndex(now);
  if (state.pass.killDay !== d) { state.pass.killDay = d; state.pass.killXpToday = 0; }
}
export function addPassXp(state, xp, now) {
  refreshPass(state, now);
  state.pass.xp = Math.min(PASS.levels * PASS.xpPerLevel, state.pass.xp + xp);
}
export function trackPassKill(state, now) {
  refreshPass(state, now);
  const p = state.pass;
  if (p.killXpToday >= PASS.xp.killsDailyCap) return;
  p.killCarry = (p.killCarry || 0) + 1;
  if (p.killCarry >= 100) { p.killCarry = 0; p.killXpToday += PASS.xp.kills100; addPassXp(state, PASS.xp.kills100, now); }
}
export function passStatus(state, now) {
  refreshPass(state, now);
  const lv = Math.min(PASS.levels, Math.floor(state.pass.xp / PASS.xpPerLevel));
  const b = seasonBounds(now);
  return { level: lv, xp: state.pass.xp, intoLevel: lv >= PASS.levels ? PASS.xpPerLevel : state.pass.xp % PASS.xpPerLevel, perLevel: PASS.xpPerLevel, season: b.index + 1, daysLeft: b.daysLeft,
    claimable: PASS.rewards.filter((_, i) => i < lv && !state.pass.claimed[i + 1]).length };
}
export function claimPass(state, level, now) {
  const st = passStatus(state, now);
  if (level < 1 || level > PASS.levels) return { ok: false, reason: 'missing' };
  if (state.pass.claimed[level]) return { ok: false, reason: 'duplicate' };
  if (level > st.level) return { ok: false, reason: 'conditions' };
  state.pass.claimed[level] = true;
  const rw = { ...PASS.rewards[level - 1] };
  grantMeta(state, rw);
  return { ok: true, level, reward: rw };
}
export function claimAllPass(state, now) {
  const st = passStatus(state, now);
  const got = [];
  for (let lv = 1; lv <= st.level; lv++) if (!state.pass.claimed[lv]) got.push(claimPass(state, lv, now));
  if (!got.length) return { ok: false, reason: 'none' };
  const sum = {};
  for (const g of got) for (const [k, v] of Object.entries(g.reward)) { if (k === 'title') (sum.titles ||= []).push(v); else sum[k] = (sum[k] || 0) + v; }
  return { ok: true, count: got.length, reward: sum };
}

// ---------- 동료 ----------
export function hatchEgg(state, rng) {
  if (state.pets.eggs <= 0) return { ok: false, reason: 'eggs' };
  state.pets.eggs -= 1;
  state.pets.hatched = (state.pets.hatched || 0) + 1;
  const id = rng.weighted(PET_RULES.hatchRates);
  const own = state.pets.owned[id];
  if (!own) {
    state.pets.owned[id] = { level: 1, stars: 1, shards: 0 };
    if (!state.pets.active) state.pets.active = id;
    return { ok: true, id, isNew: true };
  }
  own.shards += 1;
  return { ok: true, id, isNew: false, shards: own.shards };
}
export function feedPet(state, id) {
  const p = state.pets.owned[id];
  if (!p) return { ok: false, reason: 'missing' };
  if (p.level >= PET_RULES.maxLevel) return { ok: false, reason: 'max' };
  const cost = PET_RULES.foodPerLevel(p.level);
  if (state.pets.food < cost) return { ok: false, reason: 'food', need: cost };
  state.pets.food -= cost;
  p.level += 1;
  return { ok: true, id, level: p.level, cost };
}
export function starUpPet(state, id) {
  const p = state.pets.owned[id];
  if (!p) return { ok: false, reason: 'missing' };
  if (p.stars >= PET_RULES.maxStars) return { ok: false, reason: 'max' };
  const need = PET_RULES.shardsForStar[p.stars - 1];
  if (p.shards < need) return { ok: false, reason: 'shards', need };
  p.shards -= need;
  p.stars += 1;
  return { ok: true, id, stars: p.stars };
}
export function setActivePet(state, id) {
  if (id !== null && !state.pets.owned[id]) return { ok: false, reason: 'missing' };
  state.pets.active = id;
  return { ok: true, id };
}
export function petPower(state, id = state.pets.active) {
  const p = id && state.pets.owned[id];
  if (!p) return null;
  const def = PETS[id];
  const mul = 1 + PET_RULES.starMul * (p.stars - 1);
  return { id, aura: { [def.aura.stat]: (def.aura.base + def.aura.perLevel * (p.level - 1)) * mul }, coef: def.attack.coef * mul, everyMs: def.attack.everySec * 1000 };
}

// all small permanent bonuses from this module, merged into playerStats' % pool
export function metaBonus(state) {
  const out = {};
  const add = (o) => { for (const [k, v] of Object.entries(o || {})) out[k] = (out[k] || 0) + v; };
  if (state.codex) add(codexBonus(state));
  if (state.titles) add(titleBonus(state));
  if (state.pets) { const pp = petPower(state); if (pp) add(pp.aura); }
  return out;
}

// ---------- 신화 제작 ----------
export function craftOpen(state) {
  return state.player.level >= CRAFT.unlock.level || (state.player.peakLevel || 0) >= CRAFT.unlock.level || !!state.progression.bossCleared[CRAFT.unlock.boss];
}
export function craftCost(state) {
  const c = CRAFT.cost;
  return { starShard: c.starShard, essence: c.essence, ore: c.ore, gold: Math.floor(goldPerMinute(state.player.level) * c.goldMinutes) };
}
export function craftQuote(state) {
  const c = craftCost(state);
  const have = { starShard: state.wallet.starShard || 0, essence: state.rebirth.essence || 0, ore: state.wallet.ore || 0, gold: state.wallet.gold || 0 };
  const short = Object.keys(c).filter((k) => have[k] < c[k]);
  return { cost: c, have, short, ok: craftOpen(state) && short.length === 0, open: craftOpen(state) };
}
export function craftMythic(state, slot, rng) {
  if (!CRAFT.slots.includes(slot)) return { ok: false, reason: 'slot' };
  const q = craftQuote(state);
  if (!q.open) return { ok: false, reason: 'locked' };
  if (q.short.length) return { ok: false, reason: q.short[0] === 'essence' ? 'essence' : q.short[0], short: q.short };
  state.wallet.starShard -= q.cost.starShard;
  state.rebirth.essence -= q.cost.essence;
  state.wallet.ore -= q.cost.ore;
  state.wallet.gold -= q.cost.gold;
  const it = makeItem(state, { slot, rarity: 'mythic', level: state.player.level, rng, source: 'craft' });
  if (state.wallet.gold < 0 || state.wallet.ore < 0 || state.rebirth.essence < 0 || state.wallet.starShard < 0) throw new Error('negative wallet');
  return { ok: true, item: it, cost: q.cost };
}

export { BALANCE };
