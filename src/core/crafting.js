// 제작·강화 확장: 보옥(홈 보석) · 마부 · 버프 음식.
// (화폐 '보석'과 헷갈리지 않게 홈에 박는 보석은 '보옥'이라고 부릅니다.)
//
// 보옥: 5종 × 1~5단계. 끼우기/빼기 무료(빼면 가방으로). 같은 종류·단계 3개 → 다음 단계 1개 합성.
//   v19.2: 보옥은 장비가 아니라 장비 슬롯에 박힘 (슬롯마다 홈 3칸, state.craft.sockets[slot]).
//   켜지는 홈 수는 그 슬롯에 낀 장비 등급 — 영웅 1 · 전설 2 · 신화 3. 장비를 바꿔도 보옥은 슬롯에 남고,
//   낮은 등급 장비를 끼면 넘치는 홈은 꺼짐(보옥은 그대로 보관, 언제든 빼기 가능).
//   획득: 쐐기 던전(시간 내), 월드 보스(B 이상), 원정('보옥' 원정).
// 마부: 장비 슬롯마다 추가 옵션 1줄(슬롯 강화처럼 장비를 바꿔도 유지). 광석 + 각성석으로
//   다시 굴리면 새 옵션으로 바뀝니다(잠금 없음, 확률·범위 공개).
// 버프 음식: 원정 재료(달빛 약초·야수 고기)로 제작. 30분, 동시에 하나(새로 먹으면 교체).
import { BALANCE } from '../data/balance.js';

export const JEWELS = Object.freeze({
  ruby: { name: '루비', stat: 'atkPct', label: '공격력', values: [0.01, 0.02, 0.035, 0.055, 0.08] },
  sapphire: { name: '사파이어', stat: 'hpPct', label: '체력', values: [0.015, 0.03, 0.05, 0.075, 0.11] },
  emerald: { name: '에메랄드', stat: 'critChance', label: '치명 확률', values: [0.005, 0.01, 0.017, 0.026, 0.038] },
  topaz: { name: '토파즈', stat: 'aspd', label: '공격 속도', values: [0.01, 0.02, 0.033, 0.05, 0.07] },
  amethyst: { name: '자수정', stat: 'cdr', label: '쿨타임 감소', values: [0.005, 0.01, 0.017, 0.026, 0.038] },
});
export const JEWEL_TYPES = Object.keys(JEWELS);
export const SOCKETS = Object.freeze({ epic: 1, legendary: 2, mythic: 3 });
export const MAX_JEWEL_LV = 5;
export const jewelKey = (t, lv) => `${t}:${lv}`;
export const jewelName = (t, lv) => `${JEWELS[t].name} ${lv}단계`;
export const socketCount = (it) => (it && SOCKETS[it.rarity]) || 0;

export const MAX_SOCKETS = 3;
export function defaultCraft() { return { herb: 0, meat: 0, jewels: {}, sockets: {}, enchant: {}, food: null, enchantRolls: 0 }; }
function craftState(state) {
  const c = state.craft || (state.craft = defaultCraft());
  c.jewels ||= {}; c.sockets ||= {}; c.enchant ||= {}; if (c.food === undefined) c.food = null; c.enchantRolls ||= 0;
  return c;
}

export function addJewel(state, t, lv, n = 1) {
  const c = craftState(state);
  const k = jewelKey(t, lv);
  c.jewels[k] = (c.jewels[k] || 0) + n;
}
export function rollJewel(state, rng, lv = 1) {
  const t = JEWEL_TYPES[Math.floor(rng() * JEWEL_TYPES.length)];
  addJewel(state, t, lv);
  return { type: t, lv };
}
export const jewelCount = (state, t, lv) => (craftState(state).jewels[jewelKey(t, lv)] || 0);

export function combine(state, t, lv) {
  if (!JEWELS[t] || lv < 1 || lv >= MAX_JEWEL_LV) return { ok: false, reason: 'level' };
  const c = craftState(state);
  const k = jewelKey(t, lv);
  if ((c.jewels[k] || 0) < 3) return { ok: false, reason: 'count' };
  c.jewels[k] -= 3;
  if (!c.jewels[k]) delete c.jewels[k];
  addJewel(state, t, lv + 1);
  return { ok: true, type: t, lv: lv + 1 };
}

const isSlot = (slot) => BALANCE.equipment.slots.includes(slot);
// 슬롯의 홈 (길이 3, 빈 칸은 null)
export function slotGems(state, slot) {
  const c = craftState(state);
  const a = c.sockets[slot];
  return Array.from({ length: MAX_SOCKETS }, (_, i) => (a && a[i]) || null);
}
// 지금 켜진 홈 수 = 그 슬롯에 낀 장비의 등급
export function activeSockets(state, slot) {
  const id = state.equipped && state.equipped[slot];
  const it = id && state.inventory.find((i) => i.id === id);
  return socketCount(it);
}
export function socket(state, slot, idx, t, lv) {
  if (!isSlot(slot)) return { ok: false, reason: 'slot' };
  if (!JEWELS[t]) return { ok: false, reason: 'jewel' };
  if (idx < 0 || idx >= activeSockets(state, slot)) return { ok: false, reason: 'socket' };
  if (jewelCount(state, t, lv) <= 0) return { ok: false, reason: 'jewel' };
  const c = craftState(state);
  const a = (c.sockets[slot] = slotGems(state, slot));
  c.jewels[jewelKey(t, lv)] -= 1;
  if (!c.jewels[jewelKey(t, lv)]) delete c.jewels[jewelKey(t, lv)];
  const old = a[idx];
  if (old) addJewel(state, old.t, old.lv);
  a[idx] = { t, lv };
  return { ok: true, replaced: old || null };
}
// 빼기는 꺼진 홈에서도 가능
export function unsocket(state, slot, idx) {
  if (!isSlot(slot)) return { ok: false, reason: 'slot' };
  const c = craftState(state);
  const a = c.sockets[slot];
  const g = a && a[idx];
  if (!g) return { ok: false, reason: 'empty' };
  addJewel(state, g.t, g.lv);
  a[idx] = null;
  return { ok: true, jewel: g };
}
// 예전 세이브: 장비에 박혀 있던 보옥 → 낀 장비면 그 슬롯으로, 아니면 가방으로 (분해 직전 안전망 겸용)
export function returnJewels(state, items) {
  let n = 0;
  for (const it of items) { for (const g of it.gems || []) if (g) { addJewel(state, g.t, g.lv); n++; } if (it.gems) delete it.gems; }
  return n;
}
export function migrateSockets(state) {
  const c = craftState(state);
  const slotOf = {};
  for (const [k, id] of Object.entries(state.equipped || {})) if (id) slotOf[id] = k;
  for (const it of [...(state.inventory || []), ...(state.overflow || [])]) {
    if (!it || !Array.isArray(it.gems)) continue;
    const slot = slotOf[it.id];
    if (slot && isSlot(slot)) {
      const a = (c.sockets[slot] = slotGems(state, slot));
      it.gems.forEach((g, i) => {
        if (!g || !JEWELS[g.t]) return;
        if (i < MAX_SOCKETS && !a[i]) a[i] = { t: g.t, lv: g.lv }; else addJewel(state, g.t, g.lv);
      });
    } else for (const g of it.gems) if (g && JEWELS[g.t]) addJewel(state, g.t, g.lv);
    delete it.gems;
  }
}
// 슬롯 보옥 효과 (켜진 홈만)
export function slotJewelBonus(state, slot) {
  const out = {};
  const n = activeSockets(state, slot);
  const a = slotGems(state, slot);
  for (let i = 0; i < n; i++) {
    const g = a[i];
    if (!g || !JEWELS[g.t]) continue;
    const J = JEWELS[g.t];
    out[J.stat] = (out[J.stat] || 0) + J.values[Math.min(MAX_JEWEL_LV, g.lv) - 1];
  }
  return out;
}

// ---------- 마부 ----------
export const ENCHANT = Object.freeze({
  unlockBoss: 'B03',
  cost: { ore: 150, awakenStone: 1 },
  options: [
    { stat: 'atkPct', label: '공격력', min: 0.02, max: 0.05, w: 18 },
    { stat: 'hpPct', label: '체력', min: 0.03, max: 0.06, w: 18 },
    { stat: 'critChance', label: '치명 확률', min: 0.01, max: 0.03, w: 12 },
    { stat: 'critDmg', label: '치명 피해', min: 0.05, max: 0.12, w: 12 },
    { stat: 'aspd', label: '공격 속도', min: 0.02, max: 0.05, w: 12 },
    { stat: 'cdr', label: '쿨타임 감소', min: 0.01, max: 0.03, w: 10 },
    { stat: 'goldPct', label: '골드 획득', min: 0.03, max: 0.08, w: 9 },
    { stat: 'expPct', label: '경험치 획득', min: 0.03, max: 0.08, w: 9 },
  ],
});
export const enchantOpen = (state) => !!state.progression.bossCleared[ENCHANT.unlockBoss];
export function enchantRoll(state, slot, rng) {
  if (!enchantOpen(state)) return { ok: false, reason: 'locked' };
  if (!BALANCE.equipment.slots.includes(slot)) return { ok: false, reason: 'slot' };
  const C = ENCHANT.cost;
  if (state.wallet.ore < C.ore) return { ok: false, reason: 'ore', need: C.ore };
  if ((state.wallet.awakenStone || 0) < C.awakenStone) return { ok: false, reason: 'awakenStone', need: C.awakenStone };
  state.wallet.ore -= C.ore; state.wallet.awakenStone -= C.awakenStone;
  const total = ENCHANT.options.reduce((s, o) => s + o.w, 0);
  let x = rng() * total, opt = ENCHANT.options[0];
  for (const o of ENCHANT.options) { x -= o.w; if (x < 0) { opt = o; break; } }
  const value = Math.round((opt.min + (opt.max - opt.min) * rng()) * 1000) / 1000;
  const c = craftState(state);
  const prev = c.enchant[slot] || null;
  c.enchant[slot] = { stat: opt.stat, value };
  c.enchantRolls += 1;
  return { ok: true, slot, enchant: c.enchant[slot], prev };
}
export const enchantLabel = (e) => { const o = e && ENCHANT.options.find((x) => x.stat === e.stat); return o ? o.label : ''; };
export function enchantBonus(state) {
  const out = {};
  const c = state.craft;
  if (!c || !c.enchant) return out;
  for (const e of Object.values(c.enchant)) if (e) out[e.stat] = (out[e.stat] || 0) + e.value;
  return out;
}

// ---------- 버프 음식 ----------
export const FOODS = Object.freeze({
  soup: { name: '달빛 약초 수프', desc: '경험치 +20%', bonus: { expPct: 0.2 }, cost: { herb: 4, meat: 1 } },
  roast: { name: '야수 고기 구이', desc: '골드 +20%', bonus: { goldPct: 0.2 }, cost: { herb: 1, meat: 4 } },
  feast: { name: '전사의 만찬', desc: '공격력 +5%', bonus: { atkPct: 0.05 }, cost: { herb: 3, meat: 3 } },
});
export const FOOD_MIN = 30;
export function cook(state, id, now) {
  const f = FOODS[id];
  if (!f) return { ok: false, reason: 'food' };
  const c = craftState(state);
  for (const [k, v] of Object.entries(f.cost)) if ((c[k] || 0) < v) return { ok: false, reason: k, need: v };
  for (const [k, v] of Object.entries(f.cost)) c[k] -= v;
  const replaced = c.food && c.food.until > now ? c.food.id : null;
  c.food = { id, until: now + FOOD_MIN * 60000 };
  return { ok: true, id, until: c.food.until, replaced };
}
export function activeFood(state, now) {
  const f = state.craft && state.craft.food;
  return f && f.until > now && FOODS[f.id] ? f : null;
}
export function foodBonus(state, now) { const f = activeFood(state, now); return f ? FOODS[f.id].bonus : {}; }
