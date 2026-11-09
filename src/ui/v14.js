// v14 UI: 주간 테마 (전투 화면 칩 · 모험>도전 카드 · 상세 창). 역할·접두사는 캔버스 이름표(render/battle.js).
import * as TH from '../core/theme.js';
import { ROLES, PREFIXES } from '../data/roles.js';
import { CURRENCY_ICONS } from '../data/content.js';
import { itemIcon } from '../render/assets.js';
import { fmt } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, openModal, toast } from './dom.js';
import { fail, rewardTiles } from './screens.js';

const REWARD_NAMES = { gem: '보석', ore: '강화 광석', eqTicket: '장비 뽑기권', skTicket: '스킬 뽑기권', awakenStone: '각성석', gold: '골드' };
export const rewardText = (rw) => Object.entries(rw).map(([k, v]) => `${REWARD_NAMES[k] || k} ${fmt(v)}`).join(' · ');
const left = (ms) => { const d = Math.floor(ms / 86400000), hr = Math.floor((ms % 86400000) / 3600000); return d > 0 ? `${d}일 ${hr}시간` : `${hr}시간`; };

export const chipText = (now = Date.now()) => { const t = TH.themeFor(now); return `${t.icon} ${t.name}`; };

export function themeCard(app) {
  const now = Date.now();
  const st = TH.status(app.state, now);
  const t = st.theme;
  return h('div', { class: 'card theme-card' + (st.canClaim ? ' hot-card' : ''), dataset: { screen: 'theme', theme: t.id } },
    h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, `이번 주 테마 · ${t.icon} ${t.name}`), h('span', { class: 'muted' }, `${left(st.endsAt - now)} 남음`)),
    h('div', { class: 'kv' }, '규칙', h('b', null, t.modText)),
    h('div', { class: 'kv' }, '보너스', h('b', null, t.bonusText)),
    h('div', { class: 'kv' }, '주간 도전', h('b', { dataset: { k: 'themeProgress' } }, `${t.challenge.text} · ${fmt(st.progress)}/${fmt(st.goal)}`)),
    h('div', { class: 'bar-mini', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(st.goal), 'aria-valuenow': String(st.progress) }, h('span', { style: { width: Math.round((st.progress / st.goal) * 100) + '%' } })),
    h('p', { class: 'muted small', style: { margin: '4px 0 6px' } }, '규칙·보너스는 화면을 켜고 하는 사냥에만 붙어요(방치 정산·던전·보스전 제외). 다음 주 월요일 0시(KST)에 바뀌어요.'),
    button(st.claimed ? '이번 주 보상 받음' : st.canClaim ? `도전 보상 받기 · ${rewardText(t.reward)}` : '자세히 보기', { cls: 'btn' + (st.canClaim ? ' btn-primary' : ''), dataset: { act: 'theme' }, disabled: st.claimed, onClick: () => openTheme(app) }));
}

export function openTheme(app) {
  const m = openModal({ id: 'theme', title: '주간 테마', body: h('div'), actions: [] });
  const render = () => {
    const now = Date.now();
    const st = TH.status(app.state, now);
    const t = st.theme;
    m.setBody(h('div', { dataset: { screen: 'themeDetail' } },
      h('h3', { style: { margin: '0 0 6px' } }, `${t.icon} ${t.name}`),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, '규칙', h('b', null, t.modText)),
        h('div', { class: 'kv' }, '보너스', h('b', null, t.bonusText)),
        h('div', { class: 'kv' }, '주간 도전', h('b', null, `${t.challenge.text} · ${fmt(st.progress)}/${fmt(st.goal)}`)),
        h('div', { class: 'kv' }, '도전 보상', h('b', null, rewardText(t.reward))),
        h('div', { class: 'kv' }, '남은 기간', h('b', null, left(st.endsAt - now))),
        h('div', { class: 'kv' }, '다음 주', h('b', null, `${st.next.icon} ${st.next.name}`))),
      h('p', { class: 'muted small' }, '규칙과 보너스는 화면을 켜고 하는 사냥터 전투에만 적용돼요. 방치 정산, 던전·탑·균열·쐐기·보스전에는 적용되지 않아요. 도전 보상은 주마다 한 번 받을 수 있어요.'),
      h('div', { class: 'section-title' }, '몬스터 역할 (Lv 21부터 사수, Lv 31부터 치유사·자폭병)'),
      h('ul', { class: 'muted small', style: { margin: '0 0 6px', paddingLeft: '18px' } },
        h('li', null, `${ROLES.charge.glyph} 돌격: 체력 ×${ROLES.charge.hp}. 앞줄에서 버팀 (이름표 생략)`),
        h('li', null, `${ROLES.archer.glyph} 사수: 체력 ×${ROLES.archer.hp}. 뒷줄에서도 공격력 100%`),
        h('li', null, `${ROLES.healer.glyph} 치유사: ${ROLES.healer.healEverySec}초마다 가장 다친 아군 체력 ${Math.round(ROLES.healer.healPct * 100)}% 회복. 원거리 영웅은 먼저 노려요`),
        h('li', null, `${ROLES.bomber.glyph} 자폭병: 맨 앞에 서면 ${ROLES.bomber.blastMs / 1000}초 예고 후 큰 폭발(공격 ×${ROLES.bomber.blastMult})하고 쓰러져요`)),
      h('div', { class: 'section-title' }, '정예 접두사 (정예마다 하나, 5종 같은 확률)'),
      h('ul', { class: 'muted small', style: { margin: 0, paddingLeft: '18px' } }, Object.values(PREFIXES).map((p) => h('li', null, `${p.name}: ${p.text}`)))));
    m.setActions([
      st.canClaim ? button(`도전 보상 받기`, { cls: 'btn btn-primary', busy: true, dataset: { act: 'themeClaim' }, onClick: async () => {
        const r = fail(await app.game.claimTheme());
        if (!r.ok) return;
        m.close();
        const tiles = Object.entries(r.reward).map(([k, v]) => ({ icon: itemIcon(CURRENCY_ICONS[k] || CURRENCY_ICONS.gem), value: '+' + fmt(v), label: REWARD_NAMES[k] || k }));
        const g = openModal({ id: 'themeGrant', title: '주간 도전 완료', kind: 'center', body: h('div', { dataset: { screen: 'themeGrant' } }, rewardTiles(tiles)), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => g.close() })] });
        if (app.state.settings.sound) sfx('bell');
        toast('주간 도전 보상을 받았어요.', 'good');
      } }) : null,
      button('닫기', { cls: 'btn', onClick: () => m.close() })].filter(Boolean));
  };
  render();
}
