// EXP / level (Lv 1–100), promotion tiers 1–3 (Lv 30 / 60 / 90) + 4 (초월, Lv 100 · 노말 B05), skill unlocks and
// levels, region unlocks and the single "next goal".
import * as DF from './difficulty.js';
import { BALANCE, expToNext } from '../data/balance.js';
import { BOSSES, BRANCHES, BRANCH_SKILL, BRANCH_SKILL2, CLASS_SKILLS, REGIONS, REGION_BY_ID, SKILLS, branchesOf } from '../data/content.js';
import { killRewards } from './combat.js';
import { applyAutoStats } from './economy.js';
import { OATHS, OATH_BY_ID, OATH_CHANGE_GOLD_MIN } from '../data/oath.js';
import { evolutionsFor } from './skillforms.js';
import { skillMaxLevel, skillStepCost } from './skilllevel.js';
import { gainAscExp } from './ascension.js';

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
export const MAX_TIER = 4;
export const nextTier = (state) => Math.min(MAX_TIER, tierOf(state) + 1);

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
  if (p.level >= CAP && p.exp > 0) {   // v18.5: 초월했으면 초월 레벨로
    const a = gainAscExp(state, p.exp); p.exp = 0;
    res.discarded += a.discarded; if (a.levels) res.ascLevels = a.levels;
  }
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

// 초월(4차) 6번 슬롯 스킬: 같은 직업의 다른 갈래 1차 스킬 ('다른 길의 기술')
export const siblingBranch = (state) => branchesOf(state.player.cls || 'warrior').find((b) => b !== state.player.branch) || null;
export const tier4Skill = (state) => { const b = siblingBranch(state); return b ? BRANCH_SKILL[b] : null; };
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
    items.push({ id: 'shard', label: '별의 파편', ok, progress: `${state.wallet.starShard} / ${T.starShard}`, hint: '노말 이상 보스 반복 처치(하루 첫 승리 확정) · 레이드 · 시련의 탑 30~100층 10층마다 · 타락한 대천사', go: ok ? null : 'tower' });
    if (tier === 4) {
      const gold = goldPerMinute(T.level) * T.goldMinutes;
      const stOk = state.wallet.awakenStone >= T.awakenStone;
      const gOk = state.wallet.gold >= gold;
      items.push({ id: 'awaken', label: '각성석', ok: stOk, progress: `${state.wallet.awakenStone} / ${T.awakenStone}`, hint: `Lv ${BALANCE.monster.rewards.awakenFromLevel}+ 정예 · 시련의 탑 5층마다 2개`, go: stOk ? null : 'tower' });
      items.push({ id: 'gold', label: '골드', ok: gOk, progress: `${Math.floor(state.wallet.gold)} / ${Math.floor(gold)}`, cost: Math.floor(gold), go: gOk ? null : 'dungeon:gold' });
    }
  }
  const bossOk = T.bossDiff ? !!DF.track(state, T.bossDiff).bossCleared[T.boss] : !!state.progression.bossCleared[T.boss];
  items.push({ id: 'boss', label: `${T.bossDiff ? DF.prefix(T.bossDiff) : ''}${BOSSES[T.boss].name} 처치`, ok: bossOk, progress: bossOk ? '완료' : '미완료', go: bossOk ? null : T.bossDiff ? 'world' : `boss:${T.boss}` });
  if (tier === 4) {
    const lvOk3 = tierOf(state) >= 3;
    items.unshift({ id: 'tier3', label: '3차 승급', ok: lvOk3, progress: lvOk3 ? '완료' : '미완료', go: lvOk3 ? null : 'quest' });
  }
  const pre = items.every((i) => i.ok);
  if (tier === 2) {
    const ok = (state.tower.best || 0) >= T.towerFloor;
    items.push({ id: 'tower', label: `시련의 탑 ${T.towerFloor}층`, ok, progress: `${state.tower.best || 0} / ${T.towerFloor}`, go: ok ? null : 'tower' });
  }
  let canTrial = false;
  if (T.trial) {
    const ok = trialDone(state, tier);
    items.push({ id: 'trial', label: tier === 1 ? '교관 시련' : tier === 4 ? '초월 시련 · 초월자의 그림자' : '영웅의 시련 · 과거의 자신', ok, progress: ok ? '완료' : pre ? '도전 가능' : '앞 조건 필요', go: ok ? null : `trial:${tier}` });
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
  } else if (tier === 4) {
    const T = TIERS[4];
    const oath = branch;   // tier 4: the 2nd argument is the 초월 서약 id
    if (!oath || !OATH_BY_ID[oath] || !(OATHS[p.cls || 'warrior'] || []).some((e) => e.id === oath)) return { ok: false, reason: 'oath' };
    state.wallet.starShard -= T.starShard;
    state.wallet.awakenStone -= T.awakenStone;
    state.wallet.gold -= goldPerMinute(T.level) * T.goldMinutes;
    state.promotion.oath = oath;
    const eq = state.skills.equipped;
    while (eq.length < 6) eq.push(null);
    const sk = tier4Skill(state);
    if (sk && !eq.includes(sk)) eq[5] = sk;
  }
  if (state.wallet.gold < 0 || state.wallet.awakenStone < 0 || state.wallet.starShard < 0) throw new Error('negative wallet');
  p.tier = tier;
  state.promotion.tierAt[tier] = now;
  const exp = releasePendingExp(state);
  // v16: 이번 전직으로 진화한 스킬 (결과 창은 저장 확정 뒤에 이 목록으로 진화 카드를 보여줌)
  const evolutions = evolutionsFor(p.cls || 'warrior', p.branch, tier - 1, tier);
  return { ok: true, tier, branch: p.branch, name: BRANCHES[p.branch].names[tier - 1], exp, oath: tier === 4 ? state.promotion.oath : undefined, evolutions };
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
  if (t >= 4 && state.player.branch) { const sk = tier4Skill(state); if (sk) out.push(sk); }
  return out;
}
export const slotCount = (state) => 3 + (tierOf(state) >= 1 ? 1 : 0) + (tierOf(state) >= 2 ? 1 : 0) + (tierOf(state) >= 4 ? 1 : 0);

// ---------- 초월 서약 ----------
export const oathOptions = (state) => OATHS[state.player.cls || 'warrior'] || [];
export const oathOf = (state) => (tierOf(state) >= 4 && state.promotion.oath && OATH_BY_ID[state.promotion.oath]) || null;
export const oathChangeCost = (state) => Math.floor(goldPerMinute(state.player.level) * OATH_CHANGE_GOLD_MIN);
export function setOath(state, id) {
  if (tierOf(state) < 4) return { ok: false, reason: 'tier' };
  if (!oathOptions(state).some((e) => e.id === id)) return { ok: false, reason: 'oath' };
  if (state.promotion.oath === id) return { ok: false, reason: 'same' };
  const cost = oathChangeCost(state);
  if (state.wallet.gold < cost) return { ok: false, reason: 'gold', need: cost };
  state.wallet.gold -= cost;
  state.promotion.oath = id;
  return { ok: true, oath: id, cost };
}

export function skillLevel(state, id) { return (state.skills.levels && state.skills.levels[id]) || 1; }
export function skillLevelCost(state, id) {
  const n = skillLevel(state, id);
  if (n >= skillMaxLevel(state)) return null;
  const c = skillStepCost(n);
  return { books: c.books, gold: Math.floor(goldPerMinute(state.player.level) * c.goldMinutes) };
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
// Region access / boss clears follow the current difficulty's track (이지 = state.progression).
export function regionUnlocked(state, id, d = DF.curDiff(state)) { return DF.track(state, d).unlockedRegions.includes(id); }
export function onBossCleared(state, bossId, d = DF.curDiff(state)) {
  const t = DF.track(state, d);
  const first = !t.bossCleared[bossId];
  const diffWasOpen = DF.DIFF_IDS.map((x) => DF.diffOpen(state, x));
  t.bossCleared[bossId] = true;
  const region = REGIONS.find((r) => r.boss === bossId);
  const next = region ? REGIONS[region.order + 1] : null;
  let unlocked = null;
  if (next && !regionUnlocked(state, next.id, d)) {
    t.unlockedRegions.push(next.id);
    t.maxWave[next.id] = 1;
    unlocked = next.id;
  }
  // last region's boss → the next difficulty opens
  const diffUnlocked = DF.DIFF_IDS.find((x, i) => !diffWasOpen[i] && DF.diffOpen(state, x)) || null;
  return { first, unlocked, diffUnlocked, diff: d };
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
  // v15 초월: 노말 B05까지 잡았으면 남은 조건을 바로 가리킴
  if (tierOf(state) === 3 && state.player.level >= TIERS[4].level && DF.track(state, TIERS[4].bossDiff).bossCleared[TIERS[4].boss]) {
    const cl = promotionChecklist(state, 4);
    const todo = cl.items.find((i) => !i.ok);
    if (todo) return { id: 'promo', text: `초월 준비 · ${todo.label}`, action: todo.id === 'trial' ? 'quest' : todo.go || 'quest', progress: todo.progress };
    return { id: 'promo', text: '4차 전직 · 초월하기', action: 'promotion' };
  }
  const region = REGION_BY_ID[p.region];
  const d = DF.curDiff(state);
  const t = DF.track(state, d);
  const pre = DF.prefix(d);
  if (!t.bossCleared[region.boss]) {
    if ((t.maxWave[region.id] || 1) < 10) return { id: 'wave', text: `${pre}${region.name} 웨이브 10 도달`, action: null, progress: `${t.maxWave[region.id] || 1} / 10` };
    return { id: 'boss', text: `${pre}${BOSSES[region.boss].name} 도전`, action: `boss:${region.boss}` };
  }
  const nextRegion = REGIONS.find((r) => regionUnlocked(state, r.id) && !t.bossCleared[r.boss]);
  if (nextRegion && nextRegion.id !== p.region) return { id: 'move', text: `${pre}${nextRegion.name}(으)로 이동`, action: 'world' };
  // this difficulty is done → point at the next one (once it is open and untouched)
  const nd = DF.DIFF_IDS[DF.DIFFICULTY[d].order + 1];
  if (nd && DF.diffOpen(state, nd) && !Object.keys(DF.track(state, nd).bossCleared).length && (DF.track(state, nd).maxWave[REGIONS[0].id] || 1) <= 1) return { id: 'diff', text: `${DF.diffName(nd)} 난이도 1-1 시작`, action: 'world' };
  const nt = nextTier(state);
  if (tierOf(state) < 4 && state.player.level >= BALANCE.tiers[nt].level - 5) {
    const cl = promotionChecklist(state, nt);
    const todo = cl.items.find((i) => !i.ok && i.id !== 'level');
    if (todo) return { id: 'promo', text: `${nt}차 승급 준비 · ${todo.label}`, action: todo.go || 'quest', progress: todo.progress };
  }
  if (state.pets && state.pets.eggs > 0) return { id: 'pet', text: `정령 알 ${state.pets.eggs}개 부화하기`, action: 'pets' };
  if (state.dungeon.tickets > 0 && dungeonOpen(state)) return { id: 'dungeon', text: '별의 채석장에서 강화 광석 얻기', action: 'dungeon' };
  if (state.player.level < CAP) return { id: 'level', text: `레벨 ${state.player.level + 1} 달성`, action: null };
  const hardDone = DF.track(state, 'hard').bossCleared[DF.lastRegion().boss];
  return { id: 'max', text: hardDone ? '최고 레벨 · 하드 별 모으기 · 레이드와 시련의 탑 기록 갱신' : '최고 레벨 · 상위 난이도 · 레이드와 시련의 탑 기록 갱신', action: hardDone ? 'dungeon' : 'world' };
}

export { branchesOf };
