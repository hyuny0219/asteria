// EXP / level (Lv 1–100), promotion tiers 1–3 (Lv 30 / 60 / 90), skill unlocks and
// levels, region unlocks and the single "next goal".
import { BALANCE, expToNext } from '../data/balance.js';
import { BOSSES, BRANCHES, BRANCH_SKILL, BRANCH_SKILL2, CLASS_SKILLS, REGIONS, REGION_BY_ID, SKILLS, branchesOf } from '../data/content.js';
import { killRewards } from './combat.js';
import { applyAutoStats } from './economy.js';

const CAP = BALANCE.levelCap;
const PROMO = BALANCE.promotion;
const TIERS = BALANCE.tiers;
const goldPerMinute = (lv) => killRewards(lv).gold * 20;

export const tierOf = (state) => state.player.tier || (state.player.branch ? 1 : 0);
// Tier required to pass the current level (0 = none).
export function lockTierAt(state) {
  const i = BALANCE.promotionLevels.indexOf(state.player.level);
  if (i < 0) return 0;
  return tierOf(state) >= i + 1 ? 0 : i + 1;
}
export const isPromotionLocked = (state) => lockTierAt(state) > 0;
export const nextTier = (state) => Math.min(3, tierOf(state) + 1);

// Apply EXP exactly once per reward. Returns {levels, toPending, discarded}.
export function gainExp(state, amount) {
  amount = Math.floor(amount);
  const p = state.player;
  const res = { levels: 0, toPending: 0, discarded: 0 };
  if (amount <= 0) return res;
  if (isPromotionLocked(state)) { p.pendingExp += amount; res.toPending = amount; return res; }
  p.exp += amount;
  while (p.level < CAP) {
    const need = expToNext(p.level);
    if (p.exp < need) break;
    p.exp -= need;
    p.level += 1;
    if (p.level > (p.peakLevel || 0)) p.peakLevel = p.level;
    res.levels += 1;
    if (isPromotionLocked(state)) { p.pendingExp += p.exp; res.toPending += p.exp; p.exp = 0; break; }
  }
  if (p.level >= CAP && p.exp > 0) { res.discarded += p.exp; p.exp = 0; }
  if (res.levels) applyAutoStats(state);
  return res;
}

export function releasePendingExp(state) {
  const amt = state.player.pendingExp;
  state.player.pendingExp = 0;
  return { amount: amt, ...gainExp(state, amt) };
}

export function tokenEligible(state, enemyLevel) {
  return state.player.level >= PROMO.tokenFromLevel && enemyLevel >= PROMO.eligibleEnemyLevel && tierOf(state) === 0;
}
export function onTokenKill(state, enemyLevel) {
  if (!tokenEligible(state, enemyLevel)) return 0;
  if (state.wallet.token >= PROMO.tokensRequired) return 0;
  state.progression.tokenKills += 1;
  if (state.progression.tokenKills >= PROMO.killsPerToken) {
    state.progression.tokenKills = 0;
    state.wallet.token += 1;
    return 1;
  }
  return 0;
}

const trialDone = (state, tier) => !!(state.promotion.trials && state.promotion.trials[tier]) || (tier === 1 && !!state.promotion.trialCleared);

// Checklist for a tier (default: the next one). Every unmet item has a `go` shortcut.
export function promotionChecklist(state, tier = null) {
  tier = tier || nextTier(state);
  const cur = tierOf(state);
  const T = TIERS[tier];
  const lvOk = state.player.level >= T.level;
  const items = [{ id: 'level', label: `레벨 ${T.level} 달성`, ok: lvOk, progress: `${Math.min(state.player.level, T.level)} / ${T.level}`, go: lvOk ? null : 'farm' }];
  if (tier === 1) {
    const tokOk = state.wallet.token >= PROMO.tokensRequired;
    items.push({ id: 'token', label: '시련의 증표', ok: tokOk, progress: `${state.wallet.token} / ${PROMO.tokensRequired}`,
      hint: state.player.level < PROMO.tokenFromLevel ? `Lv ${PROMO.tokenFromLevel}부터 Lv ${PROMO.eligibleEnemyLevel}+ 적 ${PROMO.killsPerToken}마리마다 1개` : `Lv ${PROMO.eligibleEnemyLevel}+ 적 ${PROMO.killsPerToken}마리마다 1개 · ${PROMO.killsPerToken - state.progression.tokenKills}마리 남음`,
      go: tokOk ? null : 'mine' });
  } else if (tier === 2) {
    const gold = goldPerMinute(T.level) * T.goldMinutes;
    const stOk = state.wallet.awakenStone >= T.awakenStone;
    const gOk = state.wallet.gold >= gold;
    items.push({ id: 'awaken', label: '각성석', ok: stOk, progress: `${state.wallet.awakenStone} / ${T.awakenStone}`, hint: `Lv ${BALANCE.monster.rewards.awakenFromLevel}+ 정예 25% · 시련의 탑 5층마다 2개`, go: stOk ? null : 'tower' });
    items.push({ id: 'gold', label: '골드', ok: gOk, progress: `${Math.floor(state.wallet.gold)} / ${Math.floor(gold)}`, cost: Math.floor(gold), go: gOk ? null : 'dungeon:gold' });
  } else {
    const ok = state.wallet.starShard >= T.starShard;
    items.push({ id: 'shard', label: '별의 파편', ok, progress: `${state.wallet.starShard} / ${T.starShard}`, hint: '레이드 · 시련의 탑 30층부터 10층마다 · 타락한 대천사', go: ok ? null : 'tower' });
  }
  const bossOk = !!state.progression.bossCleared[T.boss];
  items.push({ id: 'boss', label: `${BOSSES[T.boss].name} 처치`, ok: bossOk, progress: bossOk ? '완료' : '미완료', go: bossOk ? null : `boss:${T.boss}` });
  const pre = items.every((i) => i.ok);
  if (tier === 2) {
    const ok = (state.tower.best || 0) >= T.towerFloor;
    items.push({ id: 'tower', label: `시련의 탑 ${T.towerFloor}층`, ok, progress: `${state.tower.best || 0} / ${T.towerFloor}`, go: ok ? null : 'tower' });
  }
  let canTrial = false;
  if (T.trial) {
    const ok = trialDone(state, tier);
    items.push({ id: 'trial', label: tier === 1 ? '교관 시련' : '영웅의 시련 · 과거의 자신', ok, progress: ok ? '완료' : pre ? '도전 가능' : '앞 조건 필요', go: ok ? null : `trial:${tier}` });
    canTrial = pre && !ok && cur === tier - 1;
  }
  const all = items.every((i) => i.ok);
  return {
    tier, done: cur >= tier, items, canTrial,
    canChoose: tier === 1 && all && cur === 0,
    canPromote: all && cur === tier - 1,
  };
}

// Tier 1 (v3 API): choose a branch. Tokens are consumed only here. First choice is free.
export function choosePromotion(state, branch, { dev = false } = {}) {
  const switching = tierOf(state) >= 1;
  if (switching) {
    if (!dev) return { ok: false, reason: 'switch-dev-only' };
    if (!BRANCHES[branch] || BRANCHES[branch].cls !== state.player.cls) return { ok: false, reason: 'branch' };
    const prev = state.player.branch;
    const eq = state.skills.equipped;
    const swap = (a, b) => { const i = eq.indexOf(a); if (i >= 0) eq[i] = b; };
    swap(BRANCH_SKILL[prev], BRANCH_SKILL[branch]);
    swap(BRANCH_SKILL2[prev], BRANCH_SKILL2[branch]);
    state.player.branch = branch;
    state.player.branchChanges += 1;
    return { ok: true, branch, prev, exp: null };
  }
  return promote(state, 1, branch);
}

// Generic promotion. Tier 1 needs a branch of the player's class.
export function promote(state, tier, branch = null, now = Date.now()) {
  const cl = promotionChecklist(state, tier);
  if (!cl.canPromote) return { ok: false, reason: 'conditions', checklist: cl };
  const p = state.player;
  if (tier === 1) {
    if (!branch || !BRANCHES[branch] || BRANCHES[branch].cls !== (p.cls || 'warrior')) return { ok: false, reason: 'branch' };
    state.wallet.token -= PROMO.tokensRequired;
    p.branch = branch;
    state.promotion.branchChosenAt = now;
    const eq = state.skills.equipped;
    const idx = eq.indexOf(null);
    eq[idx >= 0 && idx < 4 ? idx : 3] = BRANCH_SKILL[branch];
  } else if (tier === 2) {
    const T = TIERS[2];
    state.wallet.awakenStone -= T.awakenStone;
    state.wallet.gold -= goldPerMinute(T.level) * T.goldMinutes;
    const eq = state.skills.equipped;
    eq[4] = BRANCH_SKILL2[p.branch];
  } else if (tier === 3) {
    state.wallet.starShard -= TIERS[3].starShard;
  }
  if (state.wallet.gold < 0 || state.wallet.awakenStone < 0 || state.wallet.starShard < 0) throw new Error('negative wallet');
  p.tier = tier;
  state.promotion.tierAt[tier] = now;
  const exp = releasePendingExp(state);
  return { ok: true, tier, branch: p.branch, name: BRANCHES[p.branch].names[tier - 1], exp };
}

export function tierName(state) {
  const t = tierOf(state);
  return t && state.player.branch ? BRANCHES[state.player.branch].names[t - 1] : null;
}

export function ultId(state) { return CLASS_SKILLS[state.player.cls || 'warrior'].ult; }
export function unlockedSkills(state) {
  const cls = state.player.cls || 'warrior';
  const cs = CLASS_SKILLS[cls];
  const out = [];
  for (const id of cs.base) if (state.player.level >= (SKILLS[id].unlock.level || 1)) out.push(id);
  out.push(cs.ult);
  const t = tierOf(state);
  if (t >= 1 && state.player.branch) out.push(BRANCH_SKILL[state.player.branch]);
  if (t >= 2 && state.player.branch) out.push(BRANCH_SKILL2[state.player.branch]);
  return out;
}
export const slotCount = (state) => 3 + (tierOf(state) >= 1 ? 1 : 0) + (tierOf(state) >= 2 ? 1 : 0);

export function skillLevel(state, id) { return (state.skills.levels && state.skills.levels[id]) || 1; }
export function skillLevelCost(state, id) {
  const n = skillLevel(state, id);
  if (n >= BALANCE.skills.maxLevel) return null;
  return { books: BALANCE.skills.booksPerLevel * n, gold: Math.floor(goldPerMinute(state.player.level) * BALANCE.skills.goldMinutesPerLevel * n) };
}
export function levelSkill(state, id) {
  if (!unlockedSkills(state).includes(id)) return { ok: false, reason: 'locked-skill' };
  const c = skillLevelCost(state, id);
  if (!c) return { ok: false, reason: 'max' };
  const have = state.skills.books[id] || 0;
  if (have < c.books) return { ok: false, reason: 'books', need: c.books, have };
  if (state.wallet.gold < c.gold) return { ok: false, reason: 'gold', need: c.gold };
  state.skills.books[id] = have - c.books;
  state.wallet.gold -= c.gold;
  state.skills.levels[id] = skillLevel(state, id) + 1;
  return { ok: true, id, level: state.skills.levels[id], cost: c };
}

// ---------- regions ----------
export function regionUnlocked(state, id) { return state.progression.unlockedRegions.includes(id); }
export function onBossCleared(state, bossId) {
  const first = !state.progression.bossCleared[bossId];
  state.progression.bossCleared[bossId] = true;
  const region = REGIONS.find((r) => r.boss === bossId);
  const next = region ? REGIONS[region.order + 1] : null;
  let unlocked = null;
  if (next && !regionUnlocked(state, next.id)) {
    state.progression.unlockedRegions.push(next.id);
    state.progression.maxWave[next.id] = 1;
    unlocked = next.id;
  }
  return { first, unlocked };
}

export const dungeonOpen = (state, type = 'quarry') => !!state.progression.bossCleared[BALANCE.dungeons[type].unlockBoss];
export const towerOpen = (state) => !!state.progression.bossCleared.B03;
export const raidOpen = (state) => state.player.level >= BALANCE.raid.unlockLevel && !!state.progression.bossCleared[BALANCE.raid.unlockBoss];

// ---------- the single next goal ----------
export function nextGoal(state) {
  const p = state.progression;
  const f = p.firsts;
  // gold upgrades are automatic now (autogrow.js), so the first goal is equipment
  if (!f.firstEquip && state.inventory.length) return { id: 'equip', text: '새 장비 장착하기', action: 'equipment' };
  const lock = lockTierAt(state);
  if (lock) {
    const cl = promotionChecklist(state, lock);
    const todo = cl.items.find((i) => !i.ok);
    if (todo) return { id: 'promo', text: `${lock}차 승급 준비 · ${todo.label}`, action: todo.go || 'quest', progress: todo.progress };
    return { id: 'promo', text: lock === 1 ? '서약 각성 분기 선택' : `${lock}차 승급하기`, action: 'promotion' };
  }
  const region = REGION_BY_ID[p.region];
  if (!p.bossCleared[region.boss] && !BOSSES[region.boss].raid) {
    if ((p.maxWave[region.id] || 1) < 10) return { id: 'wave', text: `${region.name} 웨이브 10 도달`, action: null, progress: `${p.maxWave[region.id] || 1} / 10` };
    return { id: 'boss', text: `${BOSSES[region.boss].name} 도전`, action: `boss:${region.boss}` };
  }
  const nextRegion = REGIONS.find((r) => regionUnlocked(state, r.id) && !p.bossCleared[r.boss] && !BOSSES[r.boss].raid);
  if (nextRegion && nextRegion.id !== p.region) return { id: 'move', text: `${nextRegion.name}(으)로 이동`, action: 'world' };
  const nt = nextTier(state);
  if (tierOf(state) < 3 && state.player.level >= BALANCE.tiers[nt].level - 5) {
    const cl = promotionChecklist(state, nt);
    const todo = cl.items.find((i) => !i.ok && i.id !== 'level');
    if (todo) return { id: 'promo', text: `${nt}차 승급 준비 · ${todo.label}`, action: todo.go || 'quest', progress: todo.progress };
  }
  if (state.dungeon.tickets > 0 && dungeonOpen(state)) return { id: 'dungeon', text: '별의 채석장에서 강화 광석 얻기', action: 'dungeon' };
  if (state.player.level < CAP) return { id: 'level', text: `레벨 ${state.player.level + 1} 달성`, action: null };
  return { id: 'max', text: '최고 레벨 · 레이드와 시련의 탑 기록 갱신', action: 'dungeon' };
}

export { branchesOf };
