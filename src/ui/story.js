// v14 이야기 UI: 지역 첫 입장 소개, 엔딩 카드, 이야기 메뉴(다시 읽기).
import { BOSSES, REGION_BY_ID } from '../data/content.js';
import * as ST from '../core/story.js';
import * as DF from '../core/difficulty.js';
import { bgMeta, spriteMeta } from '../render/assets.js';
import { button, h, img, modalOpen, openModal } from './dom.js';

const qaQuiet = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nodaily');
const artFor = (a) => {
  if (!a) return null;
  if (a.boss) { const b = spriteMeta().bosses[a.boss]; return b ? { file: b.file, boss: true } : null; }
  const bg = bgMeta(a.bg);
  return bg ? { file: bg.file } : null;
};
function scene(art, title, sub) {
  return h('div', { class: 'story-scene' + (art && art.boss ? ' boss' : ''), style: art && !art.boss ? { backgroundImage: `url(${art.file})` } : {} },
    art && art.boss ? img(art.file, '', 'story-boss') : null,
    h('div', { class: 'story-shade' }),
    h('div', { class: 'story-head' }, sub ? h('span', null, sub) : null, h('b', null, title)));
}

// Region / difficulty intro on first entry. Shown only in FARM with no other modal up.
export function maybeIntro(app) {
  if (qaQuiet() || app._storyOpen || !app.state || app.game.mode !== 'FARM' || modalOpen()) return false;
  const p = ST.pendingIntro(app.state);
  if (!p) return false;
  app._storyOpen = true;
  const r = REGION_BY_ID[app.state.progression.region];
  const art = p.kind === 'region' ? artFor({ bg: r.bg }) : artFor({ bg: 'void' });
  const title = p.kind === 'region' ? r.name : `${DF.diffName(p.diff)} 난이도`;
  const done = async () => { m.close(); };
  const m = openModal({ id: 'storyIntro', kind: 'center', title: '이야기', onClose: async () => { app._storyOpen = false; await app.game.storySeen(p.key); },
    body: h('div', { dataset: { screen: 'storyIntro', key: p.key } }, scene(art, title, p.kind === 'region' ? r.label : '새로운 밤'), h('p', { class: 'story-text' }, p.text)),
    actions: [button(p.kind === 'region' ? '사냥 시작' : '들어가기', { cls: 'btn btn-primary', onClick: done })] });
  return true;
}

// 엔딩 (이지 심연의 군주 첫 처치): 카드를 넘긴 뒤 onDone (노말 개방 결과 창).
// v19: which === 2 → 2막 엔딩 (별을 삼키는 자 첫 처치)
export function openEnding(app, onDone, which = 1) {
  let i = 0;
  const CARDS = which === 2 ? ST.ENDING2 : ST.ENDING;
  const m = openModal({ id: 'ending', kind: 'center', title: which === 2 ? '2막 엔딩' : '엔딩', dismissible: false, body: h('div'), actions: [] });
  const render = () => {
    const c = CARDS[i];
    m.setBody(h('div', { dataset: { screen: 'ending', card: String(i) }, class: 'story-card' },
      scene(artFor(c.art), c.title, `${i + 1} / ${CARDS.length}`),
      h('p', { class: 'story-text' }, c.text),
      h('div', { class: 'story-dots' }, CARDS.map((_, k) => h('i', { class: k === i ? 'on' : '' })))));
    const last = i === CARDS.length - 1;
    m.setActions([button(last ? '계속' : '다음', { cls: 'btn btn-primary', dataset: { act: 'ending-next' }, onClick: () => { if (!last) { i++; render(); } else { m.close(); if (onDone) onDone(); } } })]);
  };
  render();
  return m;
}

// 이야기 메뉴: 본 것만, 순서대로
export function openJournal(app) {
  const list = ST.journal(app.state);
  const total = Object.keys(ST.REGION_STORY).length * 2 + 4;   // + 엔딩 2개 · 노말 · 하드
  openModal({ id: 'journal', title: '이야기', body: h('div', { dataset: { screen: 'journal' } },
    h('p', { class: 'modal-desc' }, `지나온 밤의 기록 ${list.length}/${total}. 새 지역에 처음 들어가거나 보스를 처음 쓰러뜨리면 기록이 늘어나요.`),
    list.length ? list.map((e) => {
      const art = e.kind === 'boss' ? null : e.kind === 'diff' || e.kind === 'ending' ? artFor({ bg: 'void' }) : artFor({ bg: REGION_BY_ID[e.region].bg });
      return h('div', { class: 'card story-entry k-' + e.kind, dataset: { key: e.key } },
        art ? h('div', { class: 'story-thumb', style: { backgroundImage: `url(${art.file})` } }) : e.boss ? img(spriteMeta().bosses[e.boss].file, '', 'story-thumb-boss') : null,
        h('div', null, h('b', null, e.kind === 'boss' ? `${BOSSES[e.boss].name}` : e.title), h('p', { class: 'muted small' }, e.text)));
    }) : h('p', { class: 'muted' }, '아직 기록이 없어요.')), actions: [] });
}
