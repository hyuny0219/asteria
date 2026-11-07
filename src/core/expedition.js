// 원정 파견 (길드 미션 / 용병 파견 방식). Unlocks with the first companion.
// - 3 slots. A board of 5 expeditions is rolled every KST day (seeded: same board on reload).
//   Expeditions not yet started are replaced at the next day; running ones keep going.
// - Send one companion (not already out) for 2 / 4 / 8 h of real time (keeps running while
//   the app is closed). Companions on an expedition keep helping in battle as before
//   (aura + support hits) — sending them costs nothing but the slot.
// - Success chance from companion score (level + 5 × (stars − 1)) vs the expedition's
//   requirement; great success doubles the reward, failure still returns 30%.
//   The roll is seeded by the expedition id, so it cannot be re-rolled by reloading.
import { kstDayIndex, makeRng, hashString } from './util.js';
import { PETS } from '../data/meta.js';
import { rollJewel } from './crafting.js';

export const EXPEDITION = Object.freeze({
  slots: 3, boardSize: 5, hours: [2, 4, 8],
  req: { 2: 6, 4: 14, 8: 24 },
  chance: { base: 0.55, perPoint: 0.03, min: 0.25, max: 0.95 },
  great: { perPoint: 0.015, max: 0.35 }, failShare: 0.3,
  // reward per hour of expedition by type (rounded down, min 1)
  perHour: { gem: 9, ore: 12, food: 2, herb: 1.5, meat: 1.5, eqTicket: 0.25, skTicket: 0.15, jewel: 0.125 },
});
export const EXP_REWARD_NAMES = Object.freeze({ gem: '보석', ore: '강화 광석', food: '동료 먹이', herb: '달빛 약초', meat: '야수 고기', eqTicket: '장비 뽑기권', skTicket: '스킬 뽑기권', jewel: '보옥' });
const TYPE_W = { gem: 24, ore: 16, food: 13, herb: 12, meat: 12, eqTicket: 9, skTicket: 7, jewel: 7 };
const NAMES = ['폐허 정찰', '상단 호위', '약초 채집', '사냥감 추적', '광맥 탐사', '잃어버린 보물 찾기', '마물 소굴 소탕', '별빛 순례', '고대 서고 조사', '국경 순찰', '밀수꾼 추적', '정령의 샘 탐색'];

export function defaultExpedition() { return { day: null, board: [], slots: [null, null, null], done: 0, great: 0 }; }
export const expeditionOpen = (state) => !!state.pets && Object.keys(state.pets.owned || {}).length > 0;
export const petScore = (state, petId) => { const p = state.pets.owned[petId]; return p ? p.level + 5 * (p.stars - 1) : 0; };

export function rewardAmount(type, hours) { return Math.max(1, Math.floor(EXPEDITION.perHour[type] * hours)); }

function rollBoard(state, day) {
  const rng = makeRng(hashString(`exp:${state.rngSeed}:${day}`));
  const out = [];
  const names = [...NAMES];
  for (let i = 0; i < EXPEDITION.boardSize; i++) {
    const hours = EXPEDITION.hours[i % 3 === 2 ? 2 : i % 2 === 0 ? 0 : 1];
    const type = rng.weighted(TYPE_W);
    const name = names.splice(Math.floor(rng() * names.length), 1)[0];
    out.push({ id: `exp${day}_${i}`, name, hours, req: EXPEDITION.req[hours], type, amount: rewardAmount(type, hours) });
  }
  return out;
}

export function refreshExpedition(state, now) {
  const e = state.expedition || (state.expedition = defaultExpedition());
  const d = kstDayIndex(now);
  if (e.day !== d) {
    e.day = d;
    const running = new Set(e.slots.filter(Boolean).map((x) => x.exp.id));
    e.board = rollBoard(state, d).filter((x) => !running.has(x.id));
  }
  return e;
}

export function successChance(state, petId, exp) {
  const C = EXPEDITION.chance;
  const diff = petScore(state, petId) - exp.req;
  return { success: Math.max(C.min, Math.min(C.max, C.base + C.perPoint * diff)), great: Math.max(0, Math.min(EXPEDITION.great.max, EXPEDITION.great.perPoint * diff)) };
}

export const busyPets = (state) => new Set((state.expedition ? state.expedition.slots : []).filter(Boolean).map((x) => x.pet));

export function send(state, expId, petId, now) {
  if (!expeditionOpen(state)) return { ok: false, reason: 'locked' };
  const e = refreshExpedition(state, now);
  const exp = e.board.find((x) => x.id === expId);
  if (!exp) return { ok: false, reason: 'expedition' };
  if (!state.pets.owned[petId]) return { ok: false, reason: 'pet' };
  if (busyPets(state).has(petId)) return { ok: false, reason: 'pet-busy' };
  const slot = e.slots.findIndex((x) => !x);
  if (slot < 0) return { ok: false, reason: 'slots' };
  const ch = successChance(state, petId, exp);
  e.slots[slot] = { exp, pet: petId, startAt: now, endAt: now + exp.hours * 3600000, chance: ch.success, greatChance: ch.great };
  e.board = e.board.filter((x) => x.id !== expId);
  return { ok: true, slot, endAt: e.slots[slot].endAt };
}

// grant: (type, amount) → applies to the wallet / pets / craft materials
export function grant(state, type, amount) {
  if (type === 'gem' || type === 'ore' || type === 'eqTicket' || type === 'skTicket') state.wallet[type] += amount;
  else if (type === 'food') state.pets.food += amount;
  else { state.craft ||= { herb: 0, meat: 0 }; state.craft[type] = (state.craft[type] || 0) + amount; }
}

export function claim(state, slot, now) {
  const e = state.expedition;
  const x = e && e.slots[slot];
  if (!x) return { ok: false, reason: 'empty' };
  if (now < x.endAt) return { ok: false, reason: 'running', left: x.endAt - now };
  const rng = makeRng(hashString(`${x.exp.id}:${x.pet}:${x.startAt}`));
  const ok = rng() < x.chance;
  const great = ok && rng() < x.greatChance;
  const amount = ok ? x.exp.amount * (great ? 2 : 1) : Math.max(1, Math.floor(x.exp.amount * EXPEDITION.failShare));
  let jewels = null;
  if (x.exp.type === 'jewel') { jewels = []; for (let i = 0; i < amount; i++) jewels.push(rollJewel(state, rng, x.exp.hours >= 8 ? 2 : 1)); }
  else grant(state, x.exp.type, amount);
  e.slots[slot] = null;
  e.done = (e.done || 0) + 1;
  if (great) e.great = (e.great || 0) + 1;
  return { ok: true, result: great ? 'great' : ok ? 'success' : 'fail', type: x.exp.type, amount, pet: x.pet, name: x.exp.name, jewels };
}
export function claimAll(state, now) {
  const out = [];
  for (let i = 0; i < EXPEDITION.slots; i++) { const r = claim(state, i, now); if (r.ok) out.push(r); }
  return out.length ? { ok: true, results: out } : { ok: false, reason: 'none' };
}
export const readyCount = (state, now) => (state.expedition ? state.expedition.slots.filter((x) => x && now >= x.endAt).length : 0);
export const petName = (id) => (PETS[id] ? PETS[id].name : id);
