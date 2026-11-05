// Class change (첫 1회 무료, 이후 클래스 전환권) and the in-game shop.
// Everything is bought with in-game currency only (보석·골드). No real money.
import { BRANCHES, BRANCH_SKILL, BRANCH_SKILL2, CLASSES, CLASS_SKILLS, STAT_KEYS, branchesOf } from '../data/content.js';
import { killRewards } from './combat.js';
import { applyAutoStats } from './economy.js';
import { tierOf } from './progression.js';
import { kstDayIndex } from './util.js';
import { kstWeekIndex } from './raid.js';

const goldPerMinute = (lv) => killRewards(lv).gold * 20;

// ---------- class change ----------
export function classChangeCost(state) {
  const used = state.player.classChanges || 0;
  if (used === 0) return { free: true, ticket: 0, have: state.wallet.classTicket || 0 };
  return { free: false, ticket: 1, have: state.wallet.classTicket || 0 };
}

// Keeps level, EXP, equipment, wallet, promotion tier and quests. The new class gets
// its own skills (levels/books are per skill, so each class keeps its own), a branch
// of the new class at the same tier, and stat points back to spend again.
export function changeClass(state, cls, branch = null) {
  if (!CLASSES[cls]) return { ok: false, reason: 'class' };
  const p = state.player;
  const prevCls = p.cls || 'warrior';
  if (cls === prevCls) return { ok: false, reason: 'same-class' };
  const tier = tierOf(state);
  if (tier >= 1) {
    branch ||= branchesOf(cls)[0];
    if (!BRANCHES[branch] || BRANCHES[branch].cls !== cls) return { ok: false, reason: 'branch' };
  } else branch = null;
  const cost = classChangeCost(state);
  if (!cost.free && cost.have < cost.ticket) return { ok: false, reason: 'class-ticket' };
  if (!cost.free) state.wallet.classTicket -= cost.ticket;
  const prevBranch = p.branch;
  p.cls = cls;
  p.branch = branch;
  p.classChanges = (p.classChanges || 0) + 1;
  const cs = CLASS_SKILLS[cls];
  state.skills.equipped = [...cs.base, tier >= 1 ? BRANCH_SKILL[branch] : null, tier >= 2 ? BRANCH_SKILL2[branch] : null];
  for (const k of STAT_KEYS) p.stats[k] = 0;
  p.statAuto = true;
  applyAutoStats(state);
  state.classChosen = true;
  return { ok: true, cls, prevCls, branch, prevBranch, free: cost.free };
}

// ---------- shop ----------
// limit: per 'day' | 'week' | null. price: { gem } or { goldMin } (minutes of farming gold).
export const SHOP = Object.freeze([
  { id: 'classTicket', name: '클래스 전환권', desc: '다른 클래스로 바꿀 수 있는 전환권 1장. 레벨·장비·승급 단계는 그대로입니다.', give: { classTicket: 1 }, price: { gem: 5000 }, limit: null, icon: 'I38' },
  { id: 'eqTicket10', name: '장비 뽑기권 ×10', desc: '장비 뽑기 10회분.', give: { eqTicket: 10 }, price: { gem: 450 }, limit: 'week', max: 2, icon: 'I18' },
  { id: 'skTicket5', name: '스킬 뽑기권 ×5', desc: '스킬 뽑기 5회분.', give: { skTicket: 5 }, price: { gem: 380 }, limit: 'week', max: 2, icon: 'I19' },
  { id: 'tickets3', name: '던전 입장권 ×3', desc: '별의 채석장 입장권 3장.', give: { ticket: 3 }, price: { goldMin: 90 }, limit: 'day', max: 1, icon: 'I16' },
  { id: 'ore100', name: '강화 광석 ×100', desc: '장비 강화 재료.', give: { ore: 100 }, price: { goldMin: 60 }, limit: 'day', max: 3, icon: 'I14' },
  { id: 'awaken2', name: '각성석 ×2', desc: '2차 승급 재료.', give: { awakenStone: 2 }, price: { gem: 300 }, limit: 'week', max: 3, icon: 'I36' },
]);
export const SHOP_BY_ID = Object.freeze(Object.fromEntries(SHOP.map((x) => [x.id, x])));

function period(item, now) {
  if (item.limit === 'day') return 'd' + kstDayIndex(now);
  if (item.limit === 'week') return 'w' + kstWeekIndex(now);
  return 'all';
}
export function priceOf(state, item) {
  if (item.price.gem) return { gem: item.price.gem };
  return { gold: Math.floor(goldPerMinute(state.player.level) * item.price.goldMin) };
}
export function shopStatus(state, id, now) {
  const item = SHOP_BY_ID[id];
  const rec = (state.shop && state.shop.buys[id]) || null;
  const per = period(item, now);
  const bought = rec && rec.period === per ? rec.count : 0;
  const left = item.limit ? Math.max(0, item.max - bought) : Infinity;
  const price = priceOf(state, item);
  const afford = price.gem ? state.wallet.gem >= price.gem : state.wallet.gold >= price.gold;
  return { item, price, bought, left, afford, canBuy: left > 0 && afford };
}
export function buy(state, id, now) {
  const item = SHOP_BY_ID[id];
  if (!item) return { ok: false, reason: 'missing' };
  const st = shopStatus(state, id, now);
  if (st.left <= 0) return { ok: false, reason: 'limit' };
  if (!st.afford) return { ok: false, reason: st.price.gem ? 'gem' : 'gold' };
  if (st.price.gem) state.wallet.gem -= st.price.gem; else state.wallet.gold -= st.price.gold;
  const w = state.wallet;
  for (const [k, v] of Object.entries(item.give)) {
    if (k === 'ticket') state.dungeon.tickets += v;
    else w[k] = (w[k] || 0) + v;
  }
  state.shop ||= { buys: {} };
  const per = period(item, now);
  const rec = state.shop.buys[id];
  state.shop.buys[id] = { period: per, count: rec && rec.period === per ? rec.count + 1 : 1 };
  if (w.gem < 0 || w.gold < 0) throw new Error('negative wallet');
  return { ok: true, id, give: item.give, price: st.price };
}
