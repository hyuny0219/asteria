// v12 탈것 · 날개 화면: 보유 목록, 장착, 레벨(+1/+10/최대), 별, 소환(확률·천장 공개).
import { MOUNTS, WINGS, STEED, STEED_GRADES, FX_NAMES } from '../data/steeds.js';
import * as ST from '../core/steeds.js';
import { spriteMeta } from '../render/assets.js';
import { fmtFull, fmtPct } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { costChip, fail } from './screens.js';

const TABLE = { mount: MOUNTS, wing: WINGS };
// key: mount | wing | food | feather | ticket_mount | ticket_wing | mount_<id> | wing_<id>
export function steedIcon(key) {
  const sm = (spriteMeta() && spriteMeta().steeds) || {};
  const named = { mount: 'steed_menu_mount', wing: 'steed_menu_wing', food: 'steed_food', feather: 'steed_feather', ticket_mount: 'steed_ticket_mount', ticket_wing: 'steed_ticket_wing' }[key];
  const e = sm['icon_' + (named || key)];
  if (e) return e.file;
  if (key.startsWith('mount_') && sm[key + '_run1']) return sm[key + '_run1'].file;
  if (key.startsWith('wing_') && sm[key + '_up']) return sm[key + '_up'].file;
  return 'assets/runtime/icon_steed_menu_' + (key.startsWith('wing') ? 'wing' : 'mount') + '.webp';
}
const matKey = (kind) => (kind === 'mount' ? 'food' : 'feather');
function matChip(kind, amount, short = false) {
  const name = ST.KINDS[kind].matName;
  return h('span', { class: 'cost-chip' + (short ? ' short' : ''), 'aria-label': `${name} ${fmtFull(amount)}` }, img(steedIcon(matKey(kind)), ''), h('b', null, fmtFull(amount)));
}
function ticketChip(kind, amount) {
  return h('span', { class: 'cost-chip', 'aria-label': `${ST.KINDS[kind].name} 소환권 ${amount}` }, img(steedIcon('ticket_' + kind), ''), h('b', null, fmtFull(amount)));
}
const bonusLines = (b) => Object.entries(b).filter(([k]) => FX_NAMES[k]).map(([k, v]) => h('div', { class: 'kv' }, FX_NAMES[k], h('b', null, k === 'expeditionCut' ? `-${fmtPct(v, 1)}` : `+${fmtPct(v, 1)}`)));
export const steedTodo = (s, kind) => ST.hasTodo(s, kind) || (s.wallet[ST.KINDS[kind].ticket] || 0) > 0;

export function openSteeds(app, kind = 'mount', focus = null) {
  let m;
  let sel = focus;
  const K = ST.KINDS[kind], T = TABLE[kind];
  const render = () => {
    const s = app.state;
    const B = s[K.key] || ST.defaultSteeds();
    sel = sel && T[sel] ? sel : B.equipped || Object.keys(B.owned)[0] || Object.keys(T)[0];
    const cards = h('div', { class: 'pet-cards steed-cards', role: 'radiogroup', 'aria-label': K.name }, Object.entries(T).map(([id, d]) => {
      const o = B.owned[id];
      return h('button', { type: 'button', class: 'pet-card steed-card' + (sel === id ? ' pick' : '') + (o ? '' : ' unseen'), role: 'radio', 'aria-checked': String(sel === id), dataset: { key: `${kind}-${id}` }, onClick: () => { sel = id; render(); } },
        img(steedIcon(`${kind}_${id}`), '', 'steed-img'), h('b', null, d.name),
        h('span', { class: 'steed-grade', style: { color: STEED_GRADES[d.grade].color } }, STEED_GRADES[d.grade].name),
        h('span', { class: 'muted' }, o ? `Lv ${o.lv} · ${'★'.repeat(o.star)}` : '미보유'),
        B.equipped === id ? h('span', { class: 'pending-tag' }, '장착 중') : null);
    }));
    const d = T[sel], o = B.owned[sel];
    const have = s.wallet[K.mat] || 0;
    let detail;
    if (o) {
      const q1 = ST.levelQuote(s, kind, sel, 1), q10 = ST.levelQuote(s, kind, sel, 10), qm = ST.levelQuote(s, kind, sel, 'max');
      const capped = o.lv >= STEED.maxLevel;
      const lvBtn = (label, q, steps) => {
        const ok = !capped && q.steps > 0 && have >= q.cost;
        const b = button(label, { cls: 'btn', disabled: !ok, busy: true, dataset: { key: `steed-lv-${steps}` }, onClick: async () => { const r = fail(await app.game.steedLevel(kind, sel, steps)); if (r.ok) { toast(`${d.name} Lv ${r.to}`, 'good'); render(); } } });
        if (!capped && q.steps) b.append(' ', matChip(kind, q.cost, have < q.cost));
        return b;
      };
      const sc = ST.starCost(o);
      const starBtn = button(sc === null ? '최고 별' : `별 올리기 ★${o.star + 1}`, { cls: 'btn', disabled: sc === null || o.shards < sc, busy: true, dataset: { key: 'steed-star' }, onClick: async () => { const r = fail(await app.game.steedStar(kind, sel)); if (r.ok) { toast(`${d.name} ★${r.star}`, 'good'); render(); } } });
      detail = h('div', { class: 'card' },
        h('h3', null, d.name, ' ', h('span', { class: 'steed-grade', style: { color: STEED_GRADES[d.grade].color } }, STEED_GRADES[d.grade].name)),
        h('div', { class: 'kv' }, '레벨', h('b', null, `${o.lv} / ${STEED.maxLevel}`)),
        h('div', { class: 'kv' }, '별', h('b', null, `${'★'.repeat(o.star)}${'☆'.repeat(5 - o.star)}`)),
        h('div', { class: 'kv' }, '조각', h('b', null, sc === null ? `${o.shards} · 최고 별` : `${o.shards} / ${sc}`)),
        ...bonusLines(ST.steedBonus(kind, sel, o)),
        h('div', { class: 'btn-row steed-lv', style: { marginTop: '6px' } }, lvBtn('+1', q1, 1), lvBtn('+10', q10, 10), lvBtn(capped ? '최고 레벨' : `최대 (+${qm.steps})`, qm, 'max')),
        h('div', { class: 'btn-row', style: { marginTop: '6px' } }, starBtn,
          button(B.equipped === sel ? '장착 중' : '장착', { cls: 'btn' + (B.equipped === sel ? '' : ' btn-primary'), disabled: B.equipped === sel, busy: true, dataset: { key: 'steed-equip' }, onClick: async () => { const r = fail(await app.game.steedEquip(kind, sel)); if (r.ok) render(); } })));
    } else {
      detail = h('div', { class: 'card' }, h('h3', null, d.name, ' ', h('span', { class: 'steed-grade', style: { color: STEED_GRADES[d.grade].color } }, STEED_GRADES[d.grade].name)),
        h('p', { class: 'muted' }, '아직 없는 ' + K.name + '이에요. 소환이나 보상으로 얻을 수 있어요. Lv 1 ★1 효과:'),
        ...bonusLines(ST.steedBonus(kind, sel, { lv: 1, star: 1 })));
    }
    const S = STEED.summon;
    const drawBtn = (n) => {
      const q = ST.summonQuote(s, kind, n);
      const b = button(h('b', null, `${n}회 소환`), { cls: 'btn' + (n === 10 ? ' btn-primary' : ''), disabled: !q.ok, busy: true, dataset: { key: `steed-summon-${n}` }, onClick: async () => {
        const r = fail(await app.game.steedSummon(kind, n));
        if (!r.ok) return;
        if (app.state.settings.sound) sfx('bell');
        const list = h('div', { class: 'steed-results', dataset: { screen: 'steedSummonResult' } }, r.results.map((x) => h('div', { class: 'steed-res' + (x.dup ? ' dup' : '') },
          img(steedIcon(`${kind}_${x.id}`), '', 'steed-img'), h('b', { style: { color: STEED_GRADES[x.grade].color } }, T[x.id].name),
          h('span', { class: 'muted' }, x.dup ? `조각 +${S.dupShards}` : '새로 얻음', x.pity ? ' · 천장' : ''))),
        h('p', { class: 'muted' }, `${K.matName} +${r.mats}`));
        const rm = openModal({ id: 'steedSummonResult', title: `${K.name} 소환`, kind: 'center', body: list, actions: [button('확인', { cls: 'btn btn-primary', onClick: () => rm.close() })] });
        render();
      } });
      b.append(' ', h('small', { class: 'draw-cost' }, q.tickets ? ticketChip(kind, q.tickets) : null, q.tickets && q.gem ? ' + ' : null, q.gem ? costChip('gem', q.gem, !q.ok) : null));
      return b;
    };
    const rates = Object.entries(S.rates).map(([g, p]) => {
      const n = Object.values(T).filter((x) => x.grade === g).length;
      return `${STEED_GRADES[g].name} ${fmtPct(p, 0)} (각 ${fmtPct(p / n, 2)})`;
    }).join(' · ');
    const summon = h('div', { class: 'card', dataset: { key: 'steed-summon' } },
      h('h3', null, `${K.name} 소환`),
      h('div', { class: 'btn-row' }, drawBtn(1), drawBtn(10)),
      h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, `확률: ${rates}. 천장: 전설 이상 없이 ${S.pity}회째 소환은 전설 확정 (지금 ${B.pity}/${S.pity}). 중복은 조각 ${S.dupShards}개. 소환 1회마다 ${K.matName} ${S.mats10 / 10}개. 소환권을 먼저 쓰고, 모자라면 보석(1회 ${S.gem} · 10회 ${S.gem10}).`));
    const hero = kind === 'mount' && (spriteMeta().steeds || {}).hero_mount;
    const body = h('div', { dataset: { screen: kind === 'mount' ? 'mounts' : 'wings' } },
      hero ? h('div', { class: 'steed-hero' }, img(hero.file, '', 'steed-hero-img'), h('span', { class: 'steed-hero-cap' }, '함께 달리는 동료')) : null,
      h('div', { class: 'wallet-row' },
        h('span', { class: 'cur' }, img(steedIcon(matKey(kind)), '', 'cur-ico'), `${K.matName} ${fmtFull(have)}`),
        h('span', { class: 'cur' }, img(steedIcon('ticket_' + kind), '', 'cur-ico'), `소환권 ${fmtFull(s.wallet[K.ticket] || 0)}`)),
      cards, detail, summon,
      h('p', { class: 'muted small' }, kind === 'mount'
        ? '장착한 탈것은 페이즈 사이 이동 구간에서 함께 달리고, 최대 HP·공격력과 고유 효과를 줘요. 먹이: 소환·업적·쐐기 금고·원정·월드 보스.'
        : '장착한 날개는 늘 등 뒤에 보이고(평소엔 천천히, 공격할 땐 빠르게 날갯짓), 공격력과 고유 효과를 줘요. 깃털: 소환·업적·쐐기 금고·원정·월드 보스.'));
    const actions = [button('닫기', { cls: 'btn', onClick: () => m.close() })];
    if (!m) m = openModal({ id: kind === 'mount' ? 'mounts' : 'wings', title: kind === 'mount' ? '탈것' : '날개', body, actions, onClose: () => app.renderPanel && app.renderPanel() });
    else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

export function v12Tiles(app) {
  const s = app.state;
  const t = (kind) => {
    const B = s[ST.KINDS[kind].key] || ST.defaultSteeds();
    const T = TABLE[kind];
    return { id: kind === 'mount' ? 'mounts' : 'wings', src: steedIcon(kind), t: kind === 'mount' ? '탈것' : '날개',
      s: B.equipped ? `${T[B.equipped].name} Lv ${B.owned[B.equipped].lv}` : `${Object.keys(B.owned).length}/${Object.keys(T).length}`,
      dot: steedTodo(s, kind), on: () => openSteeds(app, kind) };
  };
  return [t('mount'), t('wing')];
}
