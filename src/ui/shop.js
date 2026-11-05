// 상점 and 클래스 전환 screens. In-game currency only; no purchase of real money items.
import { BRANCHES, CLASSES, CLASS_IDS, CLASS_SKILLS, CURRENCY_ICONS, SKILLS, branchesOf } from '../data/content.js';
import { itemIcon } from '../render/assets.js';
import * as prog from '../core/progression.js';
import { SHOP, classChangeCost, shopStatus } from '../core/shop.js';
import { fmt, fmtFull } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { fail } from './screens.js';
import { classArt } from './v4.js';

const GIVE_NAMES = { classTicket: '클래스 전환권', eqTicket: '장비 뽑기권', skTicket: '스킬 뽑기권', ticket: '던전 입장권', ore: '강화 광석', awakenStone: '각성석' };
const LIMIT = { day: '오늘', week: '이번 주' };

export function openShop(app, focus = null) {
  const g = app.game;
  let m;
  const render = () => {
    const s = g.state;
    const now = Date.now();
    const wallet = h('div', { class: 'wallet-row' },
      h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.gem), ''), fmtFull(s.wallet.gem)),
      h('span', { class: 'cur' }, img(itemIcon(CURRENCY_ICONS.gold), ''), fmt(s.wallet.gold)),
      h('span', { class: 'cur', title: '클래스 전환권' }, img(itemIcon(CURRENCY_ICONS.classTicket), '클래스 전환권'), `${s.wallet.classTicket || 0}`),
      h('span', { class: 'cur', title: '각성석' }, img(itemIcon(CURRENCY_ICONS.awakenStone), '각성석'), `${s.wallet.awakenStone || 0}`));
    const list = h('div', { class: 'shop-list' }, SHOP.map((item) => {
      const st = shopStatus(s, item.id, now);
      const priceTxt = st.price.gem ? `보석 ${fmtFull(st.price.gem)}` : `골드 ${fmt(st.price.gold)}`;
      const limTxt = item.limit ? `${LIMIT[item.limit]} ${st.left}/${item.max}` : '제한 없음';
      return h('div', { class: 'shop-item' + (focus === item.id ? ' focus' : ''), dataset: { key: 'shop-' + item.id } },
        img(itemIcon(item.icon), ''),
        h('div', { class: 'si' }, h('b', null, item.name), h('span', { class: 'muted' }, item.desc), h('span', { class: 'lim' }, limTxt)),
        button(st.left <= 0 ? '매진' : priceTxt, { cls: 'btn' + (st.canBuy ? ' btn-primary' : ''), disabled: !st.canBuy, busy: true, onClick: async () => {
          const r = fail(await g.buyShop(item.id));
          if (!r.ok) return;
          if (s.settings.sound) sfx('metal');
          toast(`${item.name} 구매 완료`, 'good');
          render();
        } }));
    }));
    const body = h('div', { dataset: { screen: 'shop' } },
      h('p', { class: 'modal-desc' }, '게임에서 얻은 보석과 골드로만 삽니다. 실제 결제는 없어요. 기간 한도는 매일·매주 월요일 00:00(한국 시간)에 초기화됩니다.'),
      wallet, list);
    if (!m) m = openModal({ id: 'shop', title: '상점', body, actions: [button('닫기', { cls: 'btn', onClick: () => m.close() })] });
    else m.setBody(body);
  };
  render();
  return m;
}

export function openClassChange(app) {
  const g = app.game;
  const s = g.state;
  const cur = s.player.cls || 'warrior';
  const tier = prog.tierOf(s);
  let pick = CLASS_IDS.find((c) => c !== cur);
  let branch = tier >= 1 ? branchesOf(pick)[0] : null;
  let m;
  const render = () => {
    const cost = classChangeCost(g.state);
    const k = CLASSES[pick];
    const cs = CLASS_SKILLS[pick];
    const cards = h('div', { class: 'class-cards', role: 'radiogroup', 'aria-label': '바꿀 클래스' }, CLASS_IDS.map((id) => {
      const c = CLASSES[id];
      const isCur = id === cur;
      return h('button', { type: 'button', class: 'class-card' + (pick === id ? ' pick' : ''), role: 'radio', 'aria-checked': String(pick === id), disabled: isCur, onClick: () => { pick = id; branch = tier >= 1 ? branchesOf(id)[0] : null; render(); } },
        h('span', { class: 'art' }, classArt(id), isCur ? h('span', { class: 'pending-tag' }, '현재') : c.artPending ? h('span', { class: 'pending-tag' }, '준비 중') : null), h('b', null, c.name), h('span', { class: 'muted' }, c.hero));
    }));
    const branchPick = tier >= 1 ? h('div', { class: 'card' }, h('h3', null, `갈래 선택 (지금 ${tier}차 승급 유지)`),
      h('div', { class: 'seg', role: 'group', 'aria-label': '갈래' }, branchesOf(pick).map((b) => h('button', { type: 'button', 'aria-pressed': String(branch === b), onClick: () => { branch = b; render(); } }, BRANCHES[b].names[tier - 1]))),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, BRANCHES[branch].names.join(' → '))) : null;
    const costLine = cost.free ? '첫 전환은 무료예요.' : `클래스 전환권 1장 필요 (보유 ${cost.have}장). 상점에서 보석 5,000에 살 수 있어요.`;
    const body = h('div', { dataset: { screen: 'classChange' } },
      h('p', { class: 'modal-desc' }, `지금 클래스: ${CLASSES[cur].name} ${CLASSES[cur].hero}. ${costLine}`),
      cards,
      h('div', { class: 'card' },
        h('h3', null, `${k.name} · ${k.hero}`),
        h('div', { class: 'kv' }, '역할', h('b', null, k.role)),
        h('div', { class: 'kv' }, '스킬', h('b', null, cs.base.map((x) => SKILLS[x].name).join(' · '))),
        h('div', { class: 'kv' }, '궁극기', h('b', null, SKILLS[cs.ult].name))),
      branchPick,
      h('div', { class: 'card' }, h('h3', null, '바뀌는 것 / 그대로인 것'),
        h('p', { class: 'small', style: { margin: 0 } }, '그대로: 레벨·경험치, 장비, 재화, 승급 단계, 지역·보스 기록, 각인.'),
        h('p', { class: 'small', style: { margin: '4px 0 0' } }, '바뀜: 스킬 편성(새 클래스 스킬), 능력치 포인트는 새 클래스 추천으로 다시 분배. 스킬 레벨·스킬북은 클래스마다 따로 남아요.')));
    const canDo = cost.free || cost.have >= 1;
    const actions = [
      canDo ? button(`${k.name}(으)로 전환${cost.free ? ' · 무료' : ' · 전환권 1장'}`, { cls: 'btn btn-primary', onClick: () => confirm() })
        : button('상점에서 전환권 사기', { cls: 'btn btn-primary', onClick: () => { m.close(); openShop(app, 'classTicket'); } }),
      button('취소', { cls: 'btn', onClick: () => m.close() })];
    if (!m) m = openModal({ id: 'classChange', title: '클래스 전환', body, actions });
    else { m.setBody(body); m.setActions(actions); }
  };
  const confirm = () => {
    const k = CLASSES[pick];
    const cost = classChangeCost(g.state);
    const cm = openModal({ id: 'classConfirm', title: '전환할까요?', kind: 'center',
      desc: `${CLASSES[cur].name} → ${k.name}${branch ? ` (${BRANCHES[branch].names[tier - 1]})` : ''}. ${cost.free ? '무료 전환 1회를 사용합니다.' : '클래스 전환권 1장을 사용합니다.'} 되돌리려면 다시 전환권이 필요해요.`,
      actions: [
        button('전환하기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
          const r = fail(await g.changeClass(pick, branch));
          if (!r.ok) return;
          cm.close(); m.close();
          app.buildSkills(); app.updateHud(true); app.renderPanel();
          toast(`${k.name} ${k.hero}(으)로 전환했어요.`, 'good', 3000);
        } }),
        button('취소', { cls: 'btn', onClick: () => cm.close() })] });
  };
  render();
  return m;
}
