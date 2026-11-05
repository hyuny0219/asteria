// EXP / level, promotion (서약 각성), region unlocks and the single "next goal".
import { BALANCE, expToNext } from '../data/balance.js';
import { BOSSES, BRANCH_SKILL, REGIONS, REGION_BY_ID, SKILLS } from '../data/content.js';

const CAP = BALANCE.levelCap;
const PROMO = BALANCE.promotion;

export const isPromotionLocked = (state) => state.player.level >= BALANCE.promotionLevel && !state.player.branch;

// Apply EXP exactly once per reward. Returns {levels, toPending, discarded}.
export function gainExp(state, amount) {
  amount = Math.floor(amount);
  const p = state.player;
  const res = { levels: 0, toPending: 0, discarded: 0 };
  if (amount <= 0) return res;
  if (isPromotionLocked(state)) {
    p.pendingExp += amount;
    res.toPending = amount;
    return res;
  }
  p.exp += amount;
  while (p.level < CAP) {
    const need = expToNext(p.level);
    if (p.exp < need) break;
    p.exp -= need;
    p.level += 1;
    res.levels += 1;
    if (isPromotionLocked(state)) {
      // rest goes to pending storage until the promotion is done
      p.pendingExp += p.exp;
      res.toPending += p.exp;
      p.exp = 0;
      break;
    }
  }
  if (p.level >= CAP && p.exp > 0) {
    res.discarded += p.exp;     // MVP MAX: EXP past Lv35 is not stored (shown in UI)
    p.exp = 0;
  }
  return res;
}

// After promotion: apply stored EXP in order, up to the cap.
export function releasePendingExp(state) {
  const amt = state.player.pendingExp;
  state.player.pendingExp = 0;
  return { amount: amt, ...gainExp(state, amt) };
}

export function tokenEligible(state, enemyLevel) {
  return state.player.level >= PROMO.tokenFromLevel && enemyLevel >= PROMO.eligibleEnemyLevel && !state.player.branch;
}
// Called per kill. Every 5 eligible kills = 1 token (guaranteed, no RNG).
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

export function promotionChecklist(state) {
  const lvOk = state.player.level >= BALANCE.promotionLevel;
  const tokOk = state.wallet.token >= PROMO.tokensRequired;
  const bossOk = !!state.progression.bossCleared[PROMO.bossRequired];
  const trialOk = !!state.promotion.trialCleared;
  return {
    done: !!state.player.branch,
    items: [
      { id: 'level', label: `레벨 ${BALANCE.promotionLevel} 달성`, ok: lvOk, progress: `${state.player.level} / ${BALANCE.promotionLevel}`, go: lvOk ? null : 'farm' },
      { id: 'token', label: '시련의 증표', ok: tokOk, progress: `${state.wallet.token} / ${PROMO.tokensRequired}`,
        hint: state.player.level < PROMO.tokenFromLevel ? `Lv ${PROMO.tokenFromLevel}부터 Lv ${PROMO.eligibleEnemyLevel}+ 적 ${PROMO.killsPerToken}마리마다 1개` : `Lv ${PROMO.eligibleEnemyLevel}+ 적 ${PROMO.killsPerToken}마리마다 1개 · ${PROMO.killsPerToken - state.progression.tokenKills}마리 남음`,
        go: tokOk ? null : 'mine' },
      { id: 'boss', label: `${BOSSES[PROMO.bossRequired].name} 처치`, ok: bossOk, progress: bossOk ? '완료' : '미완료', go: bossOk ? null : 'boss:B03' },
      { id: 'trial', label: '교관 시련', ok: trialOk, progress: trialOk ? '완료' : (lvOk && tokOk && bossOk ? '도전 가능' : '앞 조건 필요'), go: trialOk ? null : 'trial' },
    ],
    canTrial: lvOk && tokOk && bossOk && !trialOk,
    canChoose: lvOk && tokOk && bossOk && trialOk && !state.player.branch,
  };
}

// Choose branch. Tokens are consumed only here (on success). First choice is free.
export function choosePromotion(state, branch, { dev = false } = {}) {
  const cl = promotionChecklist(state);
  const switching = !!state.player.branch;
  if (switching && !dev) return { ok: false, reason: 'switch-dev-only' };
  if (!switching && !cl.canChoose) return { ok: false, reason: 'conditions', checklist: cl };
  if (!BRANCH_SKILL[branch]) return { ok: false, reason: 'branch' };
  const prev = state.player.branch;
  state.player.branch = branch;
  state.player.branchChanges += switching ? 1 : 0;
  if (!switching) {
    state.wallet.token -= PROMO.tokensRequired;
    state.promotion.branchChosenAt = Date.now();
  }
  // branch-only skill swap; everything else (level, gear, quests) is kept
  const eq = state.skills.equipped;
  const oldSkill = prev ? BRANCH_SKILL[prev] : null;
  const newSkill = BRANCH_SKILL[branch];
  const idx = oldSkill ? eq.indexOf(oldSkill) : eq.indexOf(null);
  // the branch skill takes the freed 4th slot (or replaces the previous branch skill)
  if (idx >= 0) eq[idx] = newSkill; else eq[3] = newSkill;
  const exp = switching ? null : releasePendingExp(state);
  return { ok: true, branch, prev, exp };
}

export function unlockedSkills(state) {
  const out = ['strike', 'starSlash'];
  if (state.player.level >= SKILLS.shieldCharge.unlock.level) out.push('shieldCharge');
  if (state.player.level >= SKILLS.warCry.unlock.level) out.push('warCry');
  if (state.player.branch) out.push(BRANCH_SKILL[state.player.branch]);
  return out;
}
export const slotCount = (state) => (state.player.branch ? 4 : 3);

export function skillLevel(state, id) {
  // MVP: automatic from player level and promotion (no skill books). 1..10
  const base = 1 + Math.floor((state.player.level - 1) / 4);
  return Math.min(10, base + (state.player.branch ? 1 : 0));
}

// ---------- regions ----------
export function regionUnlocked(state, id) { return state.progression.unlockedRegions.includes(id); }
export function onBossCleared(state, bossId) {
  const first = !state.progression.bossCleared[bossId];
  state.progression.bossCleared[bossId] = true;
  const region = REGIONS.find((r) => r.boss === bossId);
  const next = REGIONS[region.order + 1];
  let unlocked = null;
  if (next && !regionUnlocked(state, next.id)) {
    state.progression.unlockedRegions.push(next.id);
    state.progression.maxWave[next.id] = 1;
    unlocked = next.id;
  }
  return { first, unlocked };
}

// The material dungeon opens after the first region boss so the first session stays focused.
export const dungeonOpen = (state) => !!state.progression.bossCleared.B01;

// ---------- the single next goal (spec: only one near goal) ----------
export function nextGoal(state) {
  const p = state.progression;
  const f = p.firsts;
  if (!f.firstUpgrade) return { id: 'upgrade', text: '골드로 공격력 강화하기', action: 'growth', reward: null };
  if (!f.firstEquip && state.inventory.length) return { id: 'equip', text: '새 장비 장착하기', action: 'equipment' };
  const region = REGION_BY_ID[p.region];
  if (!p.bossCleared[region.boss]) {
    if ((p.maxWave[region.id] || 1) < 10) return { id: 'wave', text: `${region.name} 웨이브 10 도달`, action: null, progress: `${p.maxWave[region.id] || 1} / 10` };
    return { id: 'boss', text: `${BOSSES[region.boss].name} 도전`, action: `boss:${region.boss}` };
  }
  const nextRegion = REGIONS.find((r) => regionUnlocked(state, r.id) && !p.bossCleared[r.boss]);
  if (nextRegion && nextRegion.id !== p.region) return { id: 'move', text: `${nextRegion.name}(으)로 이동`, action: 'world' };
  if (!state.player.branch && state.player.level >= PROMO.tokenFromLevel) {
    const cl = promotionChecklist(state);
    const todo = cl.items.find((i) => !i.ok);
    if (todo) return { id: 'promo', text: `서약 각성 준비 · ${todo.label}`, action: 'quest', progress: todo.progress };
    return { id: 'promo', text: '서약 각성 분기 선택', action: 'promotion' };
  }
  if (state.dungeon.tickets > 0 && dungeonOpen(state)) return { id: 'dungeon', text: '별의 채석장에서 강화 광석 얻기', action: 'dungeon' };
  if (state.player.level < CAP) return { id: 'level', text: `레벨 ${state.player.level + 1} 달성`, action: null };
  return { id: 'max', text: 'MVP 최고 레벨 도달 · 장비 강화로 보스 기록 단축', action: 'equipment' };
}
