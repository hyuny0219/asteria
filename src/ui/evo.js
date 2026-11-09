// v16 전직별 스킬 진화 UI: 진화 이름·색 테두리·단계 배지, 진화 단계 줄, 전직 결과의 진화 카드.
import { SKILLS } from '../data/content.js';
import { ctxOf, evoIconKey, evolutionsFor, skillDef, stagesOf, TIER_MARK } from '../core/skillforms.js';
import { evoSkillIcon, skillIcon } from '../render/assets.js';
import { button, h, img } from './dom.js';
import { CLASS_SKILLS } from '../data/content.js';

// 지금 상태에서의 스킬 정의 (진화 반영)
export const sv = (s, id) => skillDef(id, ctxOf(s)) || SKILLS[id];
export const skName = (s, id) => sv(s, id).name;

// 아이콘: GPT O6 진화 아이콘이 있으면 그것, 없으면 기본 아이콘 + 갈래색 테두리 + 단계 배지
export function evoIcon(s, id, cls = '') {
  const d = sv(s, id);
  if (!d || !d.evoTier) return img(skillIcon(SKILLS[id].icon), '', cls);
  const own = evoSkillIcon(evoIconKey(d.evoBranch, id, d.evoTier));
  return h('span', { class: `evo-ic evo-t${d.evoTier}`, style: `--evo:${d.tint}`, dataset: { evo: String(d.evoTier) } },
    img(own || skillIcon(SKILLS[id].icon), '', cls), h('i', { class: 'evo-mark', 'aria-hidden': 'true' }, TIER_MARK[d.evoTier]));
}

// 진화 단계 줄 (기본 + 1~4차): 지금 단계 강조, 앞으로 올 단계는 미리보기
export function stageRow(s, id) {
  const br = s.player.branch;
  const cur = ctxOf(s).tier;
  const st = stagesOf(id, br);
  if (st.length < 2) return h('p', { class: 'muted small' }, '1차 승급에서 갈래를 고르면 이 스킬이 갈래에 맞게 진화합니다.');
  return h('div', { class: 'evo-stages', dataset: { evoStages: id } }, st.map((x) => h('div', {
    class: 'evo-stage' + (x.tier === cur ? ' cur' : x.tier > cur ? ' next' : ' past'), style: x.tint ? `--evo:${x.tint}` : '' },
    h('b', null, x.tier ? `${TIER_MARK[x.tier]} ${x.name}` : `기본 ${x.name}`),
    h('span', { class: 'muted small' }, x.tier > cur ? `${x.tier}차 전직 · ${x.desc}` : x.desc))));
}

// 전직 결과 창의 진화 카드 ("강타 → 방패 강타")
export function evolutionCards(cls, branch, fromTier, toTier) {
  const list = evolutionsFor(cls, branch, fromTier, toTier);
  if (!list.length) return null;
  return h('div', { class: 'evo-cards', dataset: { screen: 'evoCards' } },
    h('div', { class: 'section-title' }, '스킬 진화'),
    list.map((e, i) => h('div', { class: 'evo-card', style: `--evo:${e.tint};--i:${i}` },
      img(evoSkillIcon(evoIconKey(branch, e.id, toTier)) || skillIcon(SKILLS[e.id].icon), '', 'evo-card-ic'),
      h('div', null, h('div', { class: 'evo-names' }, h('span', { class: 'muted' }, e.from), ' → ', h('b', null, e.to)), h('div', { class: 'muted small' }, e.desc)))));
}

// 스킬 화면 카드: 기본 스킬 3개 + 궁극기의 지금 단계와 다음 진화
export function evolutionCard(app, openDetail) {
  const s = app.state;
  const cs = CLASS_SKILLS[s.player.cls || 'warrior'];
  const cur = ctxOf(s).tier;
  const br = s.player.branch;
  const ids = [...cs.base, cs.ult];
  return h('div', { class: 'card evo-card-list', dataset: { screen: 'evolution' } },
    h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '스킬 진화'), h('span', { class: 'muted' }, br ? `${cur}차 · ${TIER_MARK[cur] || ''}` : '갈래 선택 전')),
    h('p', { class: 'muted small', style: { margin: '2px 0 6px' } }, '전직할 때마다 기본 스킬과 궁극기가 갈래에 맞게 진화해요. 이름·효과·속성 태그가 바뀌어요. 아이콘을 누르면 5단계를 다 볼 수 있어요.'),
    ids.map((id) => {
      const st = stagesOf(id, br);
      const now = st[Math.min(cur, st.length - 1)];
      const nx = st[cur + 1];
      return h('div', { class: 'evo-line', dataset: { evoLine: id }, style: now.tint ? `--evo:${now.tint}` : '' },
        evoIcon(s, id),
        h('div', null, h('b', null, now.name), h('div', { class: 'muted small' }, nx ? `다음 ${nx.tier}차: ${nx.name}` : br ? '최종 진화' : `1차 승급에서 갈래별로 진화`)),
        button('단계', { cls: 'chip-btn', onClick: () => openDetail && openDetail(app, id) }));
    }));
}
