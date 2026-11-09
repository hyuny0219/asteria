// 스킬 형태 해석: 전직 단계(tier)·갈래(branch)에 따라 스킬 정의를 돌려주는 단 한 곳.
// v16: 기본 스킬 3개 + 궁극기는 갈래마다 1~4차 폼이 있습니다(src/data/skillforms.js).
// 그 단계 폼이 기본 정의(SKILLS[id]) 위에 덮어써지고, 시너지 태그도 폼의 tags를 씁니다.
// 전투(combat.js의 this.skill), 시너지, 스킬 화면, 전투 바가 모두 이 함수를 거칩니다.
import { SKILLS } from '../data/content.js';
import { EVO_SCALE, SKILL_FORMS, TIER_MARK, evoIconKey } from '../data/skillforms.js';
import { tagsOf as baseTags } from '../data/synergy.js';

const cache = new Map();
const tierFrom = (ctx) => (!ctx ? 0 : Math.max(0, Math.min(4, ctx.tier === undefined || ctx.tier === null ? (ctx.branch ? 1 : 0) : ctx.tier)));

export function formOf(id, ctx) {
  const t = tierFrom(ctx);
  if (!t || !ctx.branch) return null;
  const byBranch = SKILL_FORMS[id];
  const forms = byBranch && byBranch[ctx.branch];
  return forms ? forms[t - 1] : null;
}

export function skillDef(id, ctx = null) {   // ctx: { tier, branch, cls }
  const base = SKILLS[id];
  const form = base ? formOf(id, ctx) : null;
  if (!form) return base;
  const key = `${id}|${ctx.branch}|${tierFrom(ctx)}`;
  let d = cache.get(key);
  if (!d) {
    const { name, desc, tint, tags, ...over } = form;
    const t = tierFrom(ctx);
    const m = { ...base, ...over };
    // 밸런스: 기본보다 늘어난 계수·지속 피해만 직업 배율로 조절(진화가 기본보다 약해지지 않음).
    // 단일 스킬이 얻은 광역은 target 'all'이 아니라 splash(주변 적 피해 비율)라 보스 상대로 약해지지 않음.
    const cls = EVO_SCALE.cls[base.cls] || 1;
    const pw = (x) => (x.coef || 0) * (x.hits || 1);
    let k = 1;
    if (m.coef && base.coef && (over.coef !== undefined || over.hits !== undefined)) {
      const pb = pw(base), pf = pw(m);
      const pn = pf > pb ? pb + (pf - pb) * cls : pf;
      k = pn / pf;
      m.coef = +(pn / (m.hits || 1)).toFixed(3);
    }
    if (m.dot && over.dot) {
      const bd = base.dot ? base.dot.coefPerSec : 0;
      m.dot = { ...m.dot, coefPerSec: +(m.dot.coefPerSec > bd ? bd + (m.dot.coefPerSec - bd) * cls : m.dot.coefPerSec).toFixed(3) };
    }
    if (m.splash) m.splash = +(m.splash * EVO_SCALE.splash).toFixed(3);
    d = Object.freeze({ ...m, name, desc, tint, tags, baseName: base.name, evoTier: t, evoBranch: ctx.branch, evoScale: +k.toFixed(3) });
    cache.set(key, d);
  }
  return d;
}

// 태그: 진화했으면 폼의 태그, 아니면 기본 태그
export const tagsFor = (id, ctx = null) => { const d = skillDef(id, ctx); return (d && d.tags) || baseTags(id); };

// 저장 상태에서 ctx 만들기 (UI)
export function ctxOf(state) {
  const p = state.player;
  return { tier: p.tier || (p.branch ? 1 : 0), branch: p.branch || null, cls: p.cls || 'warrior' };
}

// 한 스킬의 5단계(기본 + 1~4차) — 갈래가 없으면 기본만
export function stagesOf(id, branch) {
  const base = SKILLS[id];
  const out = [{ tier: 0, name: base.name, desc: base.desc, tint: null }];
  const forms = branch && SKILL_FORMS[id] && SKILL_FORMS[id][branch];
  if (forms) forms.forEach((fm, i) => out.push({ tier: i + 1, name: fm.name, desc: fm.desc, tint: fm.tint, tags: fm.tags }));
  return out;
}

// 전직으로 바뀐 스킬 목록 (fromTier → toTier, 같은 갈래)
export function evolutionsFor(cls, branch, fromTier, toTier) {
  const out = [];
  if (!branch || toTier <= fromTier) return out;
  for (const id of Object.keys(SKILL_FORMS)) {
    if (SKILLS[id].cls !== cls || !SKILL_FORMS[id][branch]) continue;
    const a = skillDef(id, { tier: fromTier, branch });
    const b = skillDef(id, { tier: toTier, branch });
    if (a.name !== b.name) out.push({ id, from: a.name, to: b.name, tint: b.tint, desc: b.desc, tier: toTier, ult: SKILLS[id].kind === 'ultimate' });
  }
  return out.sort((x, y) => Number(x.ult) - Number(y.ult));
}

export { TIER_MARK, evoIconKey };
