// 우편함 · 쿠폰 UI (v9)
import { CURRENCY_ICONS } from '../data/content.js';
import { itemIcon, skillIcon } from '../render/assets.js';
import * as MAILC from '../core/mail.js';
import { fmt } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { fail, itemRewards, rewardTiles } from './screens.js';

const ICON = {
  gold: () => itemIcon(CURRENCY_ICONS.gold), gem: () => itemIcon(CURRENCY_ICONS.gem), ore: () => itemIcon(CURRENCY_ICONS.ore),
  eqTicket: () => itemIcon(CURRENCY_ICONS.chest), skTicket: () => itemIcon(CURRENCY_ICONS.goldChest), ticket: () => itemIcon(CURRENCY_ICONS.ticket),
  awakenStone: () => itemIcon('I36'), starShard: () => itemIcon('I37'), petEgg: () => skillIcon('V10'), petFood: () => skillIcon('V11'),
};
const iconFor = (k) => (ICON[k] ? ICON[k]() : itemIcon(CURRENCY_ICONS.mail));
const daysLeft = (ms) => Math.max(0, Math.ceil(ms / 86400000));
const when = (t) => new Date(t).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });

function rewardChips(rw) {
  return h('div', { class: 'mail-chips' }, Object.entries(rw || {}).map(([k, v]) => k === 'item'
    ? h('span', { class: 'mail-chip' }, img(itemIcon(CURRENCY_ICONS.bag), ''), `장비 · ${v.rarity}`)
    : h('span', { class: 'mail-chip' }, img(iconFor(k), ''), h('b', null, fmt(v)), MAILC.MAIL_REWARD_NAMES[k] || k)));
}

// reward reveal only after the claim transaction has been saved
function showClaimed(app, r) {
  if (app.state.settings.sound) sfx('bell');
  const tiles = Object.entries(r.got || {}).map(([k, v]) => ({ icon: iconFor(k), value: '+' + fmt(v), label: MAILC.MAIL_REWARD_NAMES[k] || k }))
    .concat(itemRewards(r.items || []));
  const m = openModal({ id: 'mailClaimed', title: r.ids.length > 1 ? `우편 ${r.ids.length}통 수령` : '우편 수령', kind: 'center',
    body: h('div', { dataset: { screen: 'mailClaimed' } }, tiles.length ? rewardTiles(tiles) : h('p', null, '받을 보상이 없는 우편이었어요.')),
    actions: [button('확인', { cls: 'btn btn-primary', onClick: () => m.close() })] });
  return m;
}

export function openMailbox(app) {
  let timer = null;
  const m = openModal({ id: 'mailbox', title: '우편함', body: h('div'), kind: 'full', onClose: () => { clearInterval(timer); app.renderPanel && app.renderPanel(); app.updateHud && app.updateHud(true); } });
  let couponMsg = null;
  const render = () => {
    const s = app.state;
    const now = Date.now();
    const list = (s.mail && s.mail.list) || [];
    const open = list.filter((x) => !x.claimedAt && now < x.expiresAt);
    const done = list.filter((x) => x.claimedAt);
    const row = (x) => h('div', { class: 'card mail-row' + (x.claimedAt ? ' got' : ''), dataset: { mail: x.id } },
      h('div', { class: 'mail-top' },
        img(itemIcon(CURRENCY_ICONS.mail), '', 'mail-ico'),
        h('div', { class: 'mail-txt' },
          h('b', null, x.title),
          h('span', { class: 'muted small' }, `${x.sender} · ${when(x.at)}${x.claimedAt ? ' · 받음' : ` · ${daysLeft(x.expiresAt - now)}일 남음`}`))),
      x.body ? h('p', { class: 'mail-body' }, x.body) : null,
      rewardChips(x.rewards),
      x.claimedAt ? null : button('받기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
        const r = fail(await app.game.claimMail(x.id));
        if (r.ok) { render(); showClaimed(app, r); }
      } }));
    // coupon box
    const input = h('input', { type: 'text', class: 'coupon-input', placeholder: '쿠폰 번호 입력', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '40', 'aria-label': '쿠폰 번호' });
    const submit = button('확인', { cls: 'btn btn-primary coupon-go', busy: true, onClick: async () => {
      const r = await app.game.redeemCoupon(input.value);
      if (r.ok) { couponMsg = { ok: true, text: `「${r.title}」 쿠폰 보상이 우편으로 도착했어요.` }; toast('쿠폰 보상이 우편함에 도착했어요', 'good'); }
      else couponMsg = { ok: false, text: { 'coupon-unknown': '없는 쿠폰 번호예요. 다시 확인해 주세요.', 'coupon-expired': '사용 기간이 끝난 쿠폰이에요.', 'coupon-used': '이미 사용한 쿠폰이에요.', 'coupon-empty': '쿠폰 번호를 입력해 주세요.' }[r.reason] || '잠시 후 다시 시도해 주세요.' };
      render();
    } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
    const coupon = h('div', { class: 'card coupon-card', dataset: { screen: 'coupon' } },
      h('b', null, '쿠폰 입력'),
      h('div', { class: 'coupon-line' }, input, submit),
      couponMsg ? h('p', { class: 'small ' + (couponMsg.ok ? 'okc' : 'warn'), style: { margin: '6px 0 0' } }, couponMsg.text)
        : h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, '대소문자·띄어쓰기·하이픈은 상관없어요. 보상은 우편으로 와요.'));
    m.setBody(h('div', { dataset: { screen: 'mail' } },
      coupon,
      h('div', { class: 'mail-head' }, h('b', null, `받을 우편 ${open.length}통`),
        open.length > 1 ? button(`모두 받기 (${open.length})`, { cls: 'btn btn-primary mail-all', busy: true, onClick: async () => {
          const r = fail(await app.game.claimAllMail());
          if (r.ok) { render(); showClaimed(app, r); }
        } }) : null),
      open.length ? open.map(row) : h('p', { class: 'muted' }, '새 우편이 없어요.'),
      done.length ? h('div', { class: 'section-title' }, '받은 우편 (7일 뒤 정리)') : null,
      ...done.map(row),
      h('p', { class: 'muted small' }, `우편은 도착 후 30일 동안 보관돼요. 기간이 지나면 받지 않은 우편도 사라져요.${s.mail && s.mail.expired ? ` (지금까지 기간이 지나 사라진 우편 ${s.mail.expired}통)` : ''}`)));
  };
  render();
  app.game.refreshMail().then((r) => { if (r && r.ok && !r.noop) render(); });
  timer = setInterval(() => { app.game.refreshMail().then((r) => { if (r && r.ok && !r.noop) render(); }); }, 60000);
  return m;
}

export const mailCount = (s) => MAILC.unclaimedCount(s, Date.now());
export const mailTile = (app) => {
  const n = mailCount(app.state);
  return { id: 'mail', em: null, ic: 'mail', t: '우편함', s: n ? `받을 우편 ${n}통` : '쿠폰 입력 · 받은 우편', dot: n > 0, on: () => openMailbox(app) };
};
