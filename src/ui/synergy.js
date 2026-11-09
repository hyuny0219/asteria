// v14 스킬 시너지 UI (src/ui/synergy.js): 태그 칩, 지금 편성으로 만들 수 있는 콤보, 시너지 도감.
import { SKILLS } from '../data/content.js';
import { COMBOS, COMBO_IDS, FIRST_REWARD, TAGS, tagsOf } from '../data/synergy.js';
import * as SYN from '../core/synergy.js';
import { ctxOf, tagsFor } from '../core/skillforms.js';
import { button, h, openModal } from './dom.js';

// ctx(또는 state)를 주면 전직으로 진화한 태그를 보여줍니다 (v16)
export function tagChips(id, ctxOrState = null) {
  const ctx = ctxOrState && ctxOrState.player ? ctxOf(ctxOrState) : ctxOrState;
  const tags = ctx ? tagsFor(id, ctx) : tagsOf(id);
  if (!tags.length) return null;
  return h('span', { class: 'syn-tags', dataset: { tags: tags.join(',') } },
    tags.map((t) => h('span', { class: 'syn-tag', style: `--tc:${TAGS[t].color}` }, TAGS[t].name)));
}
const needText = (c) => c.need.map((n) => n.split('|').map((t) => TAGS[t].name).join('·')).join(' + ');

// skill screen card: combos the current 5 skills (+ ultimate) can make
export function synergyCard(app, ultId) {
  const s = app.state;
  const kit = [...s.skills.equipped.filter(Boolean), ultId].filter(Boolean);
  const can = SYN.combosFor(kit, ctxOf(s));
  const found = SYN.synState(s).found;
  const got = COMBO_IDS.filter((id) => found[id]).length;
  return h('div', { class: 'card syn-card', dataset: { screen: 'synergy' } },
    h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '시너지'), h('span', { class: 'muted' }, `도감 ${got}/${COMBO_IDS.length}`)),
    h('p', { class: 'muted small', style: { margin: '2px 0 6px' } }, '스킬 태그가 맞물리면 콤보가 터져요. 처음 터뜨린 콤보는 도감에 기록되고 보석을 받아요.'),
    can.length ? h('div', { class: 'syn-list' }, can.map((id) => {
      const C = COMBOS[id], known = !!found[id];
      return h('div', { class: 'syn-row' + (known ? '' : ' unknown'), dataset: { combo: id } },
        h('b', { style: { color: known ? C.color : 'var(--muted)' } }, known ? C.name : '???'),
        h('span', { class: 'muted small' }, known ? C.text : `${needText(C)} · ${C.hint}`));
    })) : h('p', { class: 'muted small' }, '지금 편성으로는 만들 수 있는 콤보가 없어요. 태그가 겹치는 스킬을 함께 넣어 보세요.'),
    button('시너지 도감', { cls: 'chip-btn', dataset: { act: 'synCodex' }, onClick: () => openSynergyCodex(app) }));
}

export function openSynergyCodex(app) {
  const s = app.state;
  const found = SYN.synState(s).found;
  const got = COMBO_IDS.filter((id) => found[id]).length;
  const m = openModal({ id: 'synCodex', title: '시너지 도감', body: h('div', { dataset: { screen: 'synCodex' } },
    h('p', { class: 'modal-desc' }, `발견 ${got}/${COMBO_IDS.length}. 처음 발견할 때마다 보석 ${FIRST_REWARD.gem}개와 시즌 패스 경험치를 받아요. 콤보는 스킬·궁극기 적중에서만 터져요(기본 공격 제외).`),
    h('div', { class: 'section-title' }, '태그'),
    h('div', { class: 'syn-tags wrap' }, Object.entries(TAGS).map(([k, t]) => h('span', { class: 'syn-tag', style: `--tc:${t.color}` }, t.name))),
    h('p', { class: 'muted small' }, '화염 → 화상(지속 피해) · 빙결 → 냉기(둔화), 3중첩이면 잠깐 얼어붙음 · 출혈 → 출혈 중첩(지속 피해, 최대 5) · 번개 → 시전마다 다른 적 1명에게 한 번 더 튐. 나머지 태그는 콤보 조건이에요.'),
    h('div', { class: 'section-title' }, '콤보'),
    COMBO_IDS.map((id) => {
      const C = COMBOS[id], known = !!found[id];
      return h('div', { class: 'card syn-entry' + (known ? '' : ' unknown'), dataset: { combo: id } },
        h('div', { class: 'kv' }, h('b', { style: { color: known ? C.color : 'var(--muted)' } }, known ? C.name : '???'), h('span', { class: 'muted small' }, needText(C))),
        h('p', { class: 'muted small', style: { margin: '2px 0 0' } }, known ? C.text : `힌트: ${C.hint}`));
    }),
    h('div', { class: 'section-title' }, '스킬별 태그'),
    h('div', null, Object.values(SKILLS).filter((sk) => sk.cls === (s.player.cls || 'warrior')).map((sk) => h('div', { class: 'kv' }, sk.name, tagChips(sk.id))))),
  actions: [] });
  m.setActions([button('닫기', { cls: 'btn', onClick: () => m.close() })]);
}
