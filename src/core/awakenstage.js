// v18.4 각성 단계: 고른 각성(A/B)이 스킬 레벨과 함께 자랍니다.
//   1단계 Lv 10 · 2단계 Lv 20 · 3단계(완성) Lv 30 — 레벨 상한이 전직마다 +5라서 2단계는 2차 전직, 3단계는 초월 이후.
// 64개 각성을 하나씩 다시 정하지 않고, 효과 종류별 규칙으로 같은 방향을 강화합니다. 3단계는 공통으로 이 스킬 피해 ×1.15.
import { AWAKEN, AWAKENINGS } from '../data/gearplus.js';

export const AWAKEN_STAGES = Object.freeze([AWAKEN.needLevel, 20, 30]);   // 각 단계가 열리는 스킬 레벨
export const AWAKEN_FINAL_MUL = 1.15;

export function awakenStage(level) {
  let s = 0;
  for (const need of AWAKEN_STAGES) if ((level || 1) >= need) s++;
  return s;   // 0 = 아직 각성 전
}
export const nextStageLevel = (level) => AWAKEN_STAGES.find((need) => (level || 1) < need) || null;

const r3 = (x) => Math.round(x * 1000) / 1000;
// 단계 s(1~3)의 효과
export function scaleAwaken(mods, s, { final = true } = {}) {
  if (!mods || s <= 1) return { ...(mods || {}) };
  const i = s - 1;                 // 1 또는 2
  const dur = [1, 1.5, 2][i];      // 지속 시간류
  const amt = [1, 1.25, 1.5][i];   // 수치류
  const out = {};
  for (const [k, v] of Object.entries(mods)) {
    // 여러 번 치는 대신 깎이던 피해는 회복(전체 공격형은 절반만), 강화형은 더 강하게
    if (k === 'coefMul') out[k] = v < 1 ? r3(v + (1 - v) * i / (mods.toAll ? 6 : 3)) : r3(1 + (v - 1) * amt);
    else if (k === 'cdMul') out[k] = v < 1 ? r3(Math.max(0.5, 1 - (1 - v) * amt)) : r3(1 + (v - 1) * (1 - i / 2));   // 과부하 같은 대기 증가는 줄어듦
    else if (k === 'dotMul') out[k] = r3(1 + (v - 1) * amt);
    else if (['stunAdd', 'guardAdd', 'evadeAdd', 'buffSecAdd'].includes(k)) out[k] = r3(v * dur);
    else if (['heal', 'shieldAdd', 'critBonusAdd', 'buffMulAdd'].includes(k)) out[k] = r3(v * amt);
    else if (k === 'echo') out[k] = r3(Math.min(1, v + 0.15 * i));
    else if (k === 'execute') out[k] = r3(v + 0.05 * i);
    else if (k === 'critStacks') out[k] = v + i;
    else if (k === 'slow') out[k] = { ...v, sec: r3(v.sec * dur) };
    else if (k === 'dotAdd') out[k] = { ...v, coefPerSec: r3(v.coefPerSec * amt) };
    else out[k] = v;               // hitsAdd, toAll: 그대로
  }
  if (s >= 3 && final) out.coefMul = r3((out.coefMul || 1) * AWAKEN_FINAL_MUL);
  return out;
}
export function awakenMods(skillId, pick, level) {
  const opt = AWAKENINGS[skillId] && AWAKENINGS[skillId][pick];
  const s = awakenStage(level);
  return opt && s ? scaleAwaken(opt.mods, s) : null;
}

// 단계 효과를 짧은 문장으로 (UI) — 완성 보너스는 따로 붙여서 '타격당 90%'가 '피해 ×1.035'로 섞이지 않게
export function describeStage(mods, s) {
  const t = describeMods(scaleAwaken(mods, s, { final: false }));
  return s >= 3 ? `${t} · 완성 피해 ×${AWAKEN_FINAL_MUL}` : t;
}
const pct = (x) => `${Math.round(x * 100)}%`;
export function describeMods(m) {
  const out = [];
  if (m.toAll) out.push('모든 적');
  if (m.hitsAdd) out.push(m.hitsAdd > 0 ? `+${m.hitsAdd}번` : `${m.hitsAdd}번`);
  if (m.coefMul && m.coefMul !== 1) out.push(m.coefMul < 1 ? `타격당 ${pct(m.coefMul)}` : `피해 ×${m.coefMul}`);
  if (m.echo) out.push(`한 번 더 (${pct(m.echo)})`);
  if (m.cdMul && m.cdMul !== 1) out.push(`대기 ×${m.cdMul}`);
  if (m.dotMul) out.push(`지속 피해 ×${m.dotMul}`);
  if (m.stunAdd) out.push(`기절 +${m.stunAdd}초`);
  if (m.guardAdd) out.push(`방어 +${m.guardAdd}초`);
  if (m.evadeAdd) out.push(`회피 +${m.evadeAdd}초`);
  if (m.buffSecAdd) out.push(`지속 +${m.buffSecAdd}초`);
  if (m.buffMulAdd) out.push(`공격력 +${pct(m.buffMulAdd)}p`);
  if (m.heal) out.push(`HP ${pct(m.heal)} 회복`);
  if (m.shieldAdd) out.push(`흡수량 +${pct(m.shieldAdd)}p`);
  if (m.critBonusAdd) out.push(`치명 확률 +${pct(m.critBonusAdd)}`);
  if (m.critStacks) out.push(`이후 ${m.critStacks}번 치명타`);
  if (m.execute) out.push(`HP ${pct(m.execute)} 이하 2배`);
  if (m.slow) out.push(`적 공속 ${pct(1 - m.slow.mul)} 감소 ${m.slow.sec}초`);
  if (m.dotAdd) out.push(`독 ${m.dotAdd.sec}초 (초당 ${m.dotAdd.coefPerSec})`);
  return out.join(' · ');
}
