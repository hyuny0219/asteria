// v10 UI: 전설 고유 효과(표시·추출·이식·수집), 재련, 등급 올리기, 스킬 각성, 장비·스킬 프리셋.
import * as EVO from './evo.js';
import { AWAKEN, AWAKENINGS, EXTRACT, LOADOUT_KINDS, MYTHIC_MUL, RARITY_UP, UNIQUES } from '../data/gearplus.js';
import { CLASSES, OPTION_NAMES, RARITY, SKILLS, SLOT_NAMES } from '../data/content.js';
import { BALANCE } from '../data/balance.js';
import * as G from '../core/gearplus.js';
import * as prog from '../core/progression.js';
import { fmt, fmtPct } from '../core/util.js';
import { itemIcon, skillIcon } from '../render/assets.js';
import { rarityLabel } from '../core/items.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { costChip, fail } from './screens.js';

const OPT_KEYS = Object.keys(BALANCE.equipment.options);
const PCT = new Set(['atkPct', 'critChance', 'critDmg', 'aspd', 'hpPct', 'defPct', 'cdr', 'ultCharge', 'goldPct']);
const optLabel = (o) => (o.unique ? `고유 · ${OPTION_NAMES[o.k] || o.k}` : `${OPTION_NAMES[o.k] || o.k} +${PCT.has(o.k) ? fmtPct(o.v, 1) : o.v}`);
const clsName = (c) => (c ? CLASSES[c].name : '공용');

// ---------- 고유 효과 line (compare / tiles) ----------
export function legendLine(it) {
  const L = G.legendText(it);
  if (!L) return null;
  const em = { warrior: 'L00', mage: 'L01', archer: 'L02', rogue: 'L03' }[L.cls] || 'L04';   // GPT L emblems
  return h('div', { class: 'legend-line', dataset: { legend: it.legend.id } },
    img(skillIcon(em), '', 'lg-em'),
    h('span', { class: 'lg-tag' }, it.rarity === 'mythic' ? '신화 고유' : '전설 고유'),
    h('b', null, L.name), h('span', null, L.text), L.cls ? h('span', { class: 'lg-cls' }, clsName(L.cls)) : null);
}

// buttons added under the compare window
export function compareActions(app, it, rerender) {
  const s = app.state;
  const worn = Object.values(s.equipped).includes(it.id);
  const row0 = [button(it.level >= s.player.level ? `Lv ${it.level} · 최대` : `레벨 올리기 · Lv ${it.level}`, { cls: 'btn', dataset: { act: 'itemlevel' }, disabled: it.level >= s.player.level, onClick: () => openItemLevel(app, it.id, rerender) })];
  const row = [
    button('재련', { cls: 'btn', dataset: { act: 'reforge' }, disabled: !(it.options || []).some((o) => !o.unique), onClick: () => openReforge(app, it.id, rerender) }),
    button('등급 올리기', { cls: 'btn', dataset: { act: 'rarityup' }, disabled: !RARITY_UP.next[it.rarity], onClick: () => openRarityUp(app, it.id, rerender) }),
  ];
  const row2 = [];
  if (it.rarity === 'legendary' || it.rarity === 'mythic') {
    row2.push(button('효과 이식', { cls: 'btn', dataset: { act: 'imprint' }, disabled: !Object.keys(s.gearPlus.vault).length, onClick: () => openImprint(app, it.id, rerender) }));
    if (it.legend) row2.push(button('효과 추출(분해)', { cls: 'btn', dataset: { act: 'extract' }, disabled: worn || it.locked, onClick: () => confirmExtract(app, it.id, rerender) }));
  }
  return [h('div', { class: 'btn-row' }, row0), h('div', { class: 'btn-row' }, row), row2.length ? h('div', { class: 'btn-row' }, row2) : null];
}

// ---------- 추출 ----------
function confirmExtract(app, id, after) {
  const s = app.state;
  const q = G.extractQuote(s, id);
  if (!q.ok) { fail(q); return; }
  const L = G.legendText(q.item);
  const m = openModal({ id: 'extract', title: '고유 효과 추출', kind: 'center', body: h('div', { dataset: { screen: 'extract' } }, img(skillIcon('L05'), '', 'modal-em'),
    h('p', null, `${q.item.name}을(를) 분해하고 고유 효과를 보관함에 넣습니다. 장비는 사라집니다(박힌 보옥은 돌려받음).`),
    h('div', { class: 'card' }, h('div', { class: 'kv' }, '효과', h('b', null, `${L.name}`)), h('p', { class: 'muted small', style: { margin: '2px 0 0' } }, UNIQUES[q.item.legend.id].text(q.item.legend.v)),
      h('div', { class: 'kv' }, '보관함', h('b', null, q.current ? (q.upgrade ? '더 좋은 수치로 갱신' : '이미 같거나 더 좋은 수치 보유') : '새로 수집')),
      h('div', { class: 'kv' }, '비용', h('b', null, `강화 광석 ${EXTRACT.ore} · 각성석 ${EXTRACT.awakenStone} (보유 ${fmt(s.wallet.ore)} · ${s.wallet.awakenStone || 0})`))),
    h('p', { class: 'muted small' }, '보관함의 효과는 몇 번이든 다른 전설·신화 장비에 이식할 수 있어요(신화는 수치 ×1.25).')),
  actions: [button('취소', { cls: 'btn', onClick: () => m.close() }), button('추출', { cls: 'btn btn-primary', busy: true, onClick: async () => {
    const r = fail(await app.game.extractLegend(id));
    if (r.ok) { m.close(); toast(`${UNIQUES[r.id].name} 보관${r.improved ? ' · 수치 갱신' : ''}`, 'good'); if (app.state.settings.sound) sfx('bell'); if (after) after(); }
  } })] });
}

// ---------- 이식 ----------
function openImprint(app, id, after) {
  const s = app.state;
  const it = s.inventory.find((i) => i.id === id);
  if (!it) return;
  const c = G.imprintCost(it);
  const list = Object.entries(s.gearPlus.vault).sort((a, b) => (UNIQUES[a[0]].cls === s.player.cls ? -1 : 0) - (UNIQUES[b[0]].cls === s.player.cls ? -1 : 0));
  const mul = it.rarity === 'mythic' ? MYTHIC_MUL : 1;
  const m = openModal({ id: 'imprint', title: '고유 효과 이식', body: h('div', { dataset: { screen: 'imprint' } }, img(skillIcon('L06'), '', 'modal-em'),
    h('p', { class: 'modal-desc' }, `${it.name}의 고유 효과를 바꿉니다. 지금 효과는 사라져요(먼저 추출하면 보관됨). 비용: 강화 광석 ${c.ore} · 골드 ${fmt(c.gold)}`),
    it.legend ? h('div', { class: 'card' }, h('div', { class: 'muted small' }, '지금 효과'), legendLine(it)) : null,
    list.map(([uid, v]) => {
      const U = UNIQUES[uid];
      return h('div', { class: 'card vault-row', dataset: { uid } },
        h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, U.name), h('span', { class: 'lg-cls' }, clsName(U.cls))),
        h('p', { class: 'muted small', style: { margin: '2px 0 6px' } }, U.text(v * mul)),
        button('이 효과로 바꾸기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
          const r = fail(await app.game.imprintLegend(id, uid));
          if (r.ok) { m.close(); toast(`${U.name} 이식`, 'good'); if (after) after(); }
        } }));
    })) });
}

// ---------- 재련 ----------
function openItemLevel(app, id, after) {
  const m = openModal({ id: 'itemlevel', title: '장비 레벨 올리기', body: h('div'), actions: [] });
  const render = () => {
    const s = app.state;
    const it = s.inventory.find((i) => i.id === id);
    if (!it) { m.close(); return; }
    const q1 = G.levelUpQuote(s, it, 1), q10 = G.levelUpQuote(s, it, 10), qm = G.levelUpQuote(s, it, 'max');
    const capped = it.level >= s.player.level;
    const can = (q) => q.steps > 0 && s.wallet.ore >= q.ore && s.wallet.gold >= q.gold;
    const go = (steps) => async () => { const r = fail(await app.game.levelUpItem(id, steps)); if (r.ok) { toast(`${it.name} Lv ${r.from} → ${r.to}`, 'good'); render(); if (after) after(); } };
    m.setBody(h('div', { dataset: { screen: 'itemlevel' } },
      img(skillIcon('L08'), '', 'modal-em'),
      h('p', { class: 'modal-desc' }, `강화 광석과 골드로 장비 레벨을 내 레벨(Lv ${s.player.level})까지 올려요. 레벨이 오르면 기본 능력치가 올라가고, 옵션·고유 효과·보옥·슬롯 강화는 그대로예요.`),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, '장비', h('b', null, `${rarityLabel(it.rarity)} ${it.name}`)),
        h('div', { class: 'kv' }, '지금 레벨', h('b', null, capped ? `Lv ${it.level} (최대)` : `Lv ${it.level} / ${s.player.level}`)),
        h('div', { class: 'kv' }, '보유', h('b', null, `강화 광석 ${fmt(s.wallet.ore)} · 골드 ${fmt(s.wallet.gold)}`))),
      capped ? h('p', { class: 'muted small' }, '내 레벨까지 올렸어요. 레벨이 오르면 더 올릴 수 있어요.') :
        h('div', { class: 'card' }, [['+1', q1], ['+10', q10], ['최대', qm]].map(([t, q]) =>
          h('div', { class: 'kv' }, `${t}${q.steps ? ` → Lv ${q.to}` : ''}`, h('b', null, q.steps ? `광석 ${fmt(q.ore)} · 골드 ${fmt(q.gold)}` : '재료 부족'))))));
    m.setActions(capped ? [button('닫기', { cls: 'btn', onClick: () => m.close() })] : [
      button('+1', { cls: 'btn', busy: true, disabled: !can(q1), onClick: go(1) }),
      button('+10', { cls: 'btn', busy: true, disabled: !can(q10), onClick: go(10) }),
      button('최대', { cls: 'btn btn-primary', busy: true, disabled: !qm.steps, onClick: go('max') })]);
  };
  render();
}

function openReforge(app, id, after) {
  let sel = null;
  const m = openModal({ id: 'reforge', title: '재련', body: h('div'), actions: [] });
  const render = () => {
    const s = app.state;
    const it = s.inventory.find((i) => i.id === id);
    if (!it) { m.close(); return; }
    const c = G.reforgeCost(it);
    if (sel === null) sel = it.options.findIndex((o) => !o.unique);
    m.setBody(h('div', { dataset: { screen: 'reforge' } },
      img(skillIcon('L08'), '', 'modal-em'),
      h('p', { class: 'modal-desc' }, '바꿀 옵션 하나를 고르면 그 줄만 새로 굴립니다. 다른 줄은 그대로이고, 다른 줄과 겹치는 옵션은 나오지 않아요. 재련할수록 비용이 올라가요(광석 +50%씩).'),
      sel >= 0 ? h('p', { class: 'muted small', dataset: { note: 'odds' } }, (() => { const n = OPT_KEYS.length - it.options.filter((o, i) => i !== sel && !o.unique).length; return `확률: 옵션 ${n}종 중 하나가 각 ${fmtPct(1 / n, 1)}, 수치는 옵션 범위 안에서 균등.`; })()) : null,
      h('div', { class: 'opt-pick', role: 'radiogroup', 'aria-label': '재련할 옵션' }, it.options.map((o, i) => h('button', { type: 'button', role: 'radio', class: 'opt-row', 'aria-checked': String(sel === i), disabled: !!o.unique, onClick: () => { sel = i; render(); } }, optLabel(o)))),
      h('div', { class: 'card' }, h('div', { class: 'kv' }, '비용', h('b', null, `강화 광석 ${fmt(c.ore)} · 골드 ${fmt(c.gold)}`)), h('div', { class: 'kv' }, '보유', h('b', null, `${fmt(s.wallet.ore)} · ${fmt(s.wallet.gold)}`)),
        h('div', { class: 'kv' }, '재련 횟수', h('b', null, `${it.reforges || 0}회`)))));
    m.setActions([button('닫기', { cls: 'btn', onClick: () => m.close() }), button('재련', { cls: 'btn btn-primary', busy: true, disabled: sel < 0 || s.wallet.ore < c.ore || s.wallet.gold < c.gold, onClick: async () => {
      const r = fail(await app.game.reforge(id, sel));
      if (r.ok) { toast(`${optLabel(r.prev)} → ${optLabel(r.next)}`, 'good', 2600); render(); if (after) after(); }
    } })]);
  };
  render();
}

// ---------- 등급 올리기 ----------
function openRarityUp(app, id, after) {
  const picked = new Set();
  const m = openModal({ id: 'rarityup', title: '등급 올리기', body: h('div'), actions: [] });
  const render = () => {
    const s = app.state;
    const it = s.inventory.find((i) => i.id === id);
    if (!it) { m.close(); return; }
    const to = RARITY_UP.next[it.rarity];
    const cands = G.rarityUpCandidates(s, it).sort((a, b) => a.level - b.level);
    for (const x of [...picked]) if (!cands.find((c) => c.id === x)) picked.delete(x);
    const q = G.rarityUpQuote(s, id, [...picked]);
    const cost = { ore: RARITY_UP.ore[to] || 0, star: RARITY_UP.starShard[to] || 0 };
    m.setBody(h('div', { dataset: { screen: 'rarityup' } },
      img(skillIcon('L09'), '', 'modal-em'),
      h('p', { class: 'modal-desc' }, `같은 부위·같은 등급 장비 2개를 재료로 ${it.name}을(를) ${to ? RARITY[to].name : '-'} 등급으로 올립니다. 옵션은 그대로 + 1줄 추가, 레벨은 셋 중 가장 높은 값. 재료는 사라져요(잠금·장착 제외).`),
      h('div', { class: 'card' }, h('div', { class: 'kv' }, '본체', h('b', null, `${rarityLabel(it.rarity)} → ${to ? rarityLabel(to) : '최고 등급'}`)),
        h('div', { class: 'kv' }, '비용', h('b', null, `강화 광석 ${fmt(cost.ore)}${cost.star ? ` · 별의 파편 ${cost.star}` : ''}`)),
        to === 'legendary' ? h('p', { class: 'muted small', style: { margin: '2px 0 0' } }, '전설이 되면 고유 효과가 하나 붙어요.') : null),
      h('div', { class: 'section-title' }, `재료 선택 ${picked.size}/2`),
      cands.length ? h('div', { class: 'mat-grid' }, cands.map((c) => h('button', { type: 'button', class: 'mat' + (picked.has(c.id) ? ' on' : ''), 'aria-pressed': String(picked.has(c.id)), dataset: { mat: c.id },
        onClick: () => { if (picked.has(c.id)) picked.delete(c.id); else if (picked.size < 2) picked.add(c.id); render(); } },
        img(itemIcon(c.look), ''), h('span', null, `Lv ${c.level}`)))) : h('p', { class: 'muted' }, `같은 부위의 ${RARITY[it.rarity].name} 장비가 더 필요해요(잠금·장착 제외).`)));
    m.setActions([button('닫기', { cls: 'btn', onClick: () => m.close() }), button('등급 올리기', { cls: 'btn btn-primary', busy: true, disabled: !q.ok, onClick: async () => {
      const r = fail(await app.game.rarityUp(id, [...picked]));
      if (r.ok) { m.close(); toast(`${r.item.name} · ${RARITY[r.to].name} 등급!`, 'good', 2600); if (app.state.settings.sound) sfx('bell'); if (after) after(); }
    } })]);
  };
  render();
}

// ---------- 고유 효과 수집 (도감) ----------
export function openLegendCodex(app) {
  const s = app.state;
  const ids = Object.keys(UNIQUES);
  const got = ids.filter((k) => s.gearPlus.vault[k]).length;
  const groups = [s.player.cls || 'warrior', ...Object.keys(CLASSES).filter((c) => c !== (s.player.cls || 'warrior')), null];
  openModal({ id: 'legendCodex', title: '고유 효과 보관함', body: h('div', { dataset: { screen: 'legendCodex' } },
    h('p', { class: 'modal-desc' }, `수집 ${got}/${ids.length}. 전설·신화 장비를 "효과 추출"로 분해하면 여기에 모이고, 다른 전설·신화 장비에 몇 번이든 이식할 수 있어요. 같은 효과는 더 좋은 수치만 남아요.`),
    h('p', { class: 'muted small', dataset: { note: 'odds' } }, `확률: 전설·신화 장비가 나올 때 고유 효과 1개가 붙습니다 — 70% 내 직업 효과 6종 중 하나(각 약 11.7%), 30% 공용 효과 6종 중 하나(각 5%). 수치는 범위 안에서 균등, 신화는 ×${MYTHIC_MUL}.`),
    groups.map((c) => h('div', null, h('div', { class: 'section-title' }, clsName(c)),
      ids.filter((k) => UNIQUES[k].cls === c).map((k) => {
        const v = s.gearPlus.vault[k];
        const U = UNIQUES[k];
        return h('div', { class: 'card vault-row' + (v ? '' : ' unknown'), dataset: { uid: k } },
          h('div', { class: 'kv' }, h('b', { style: { color: v ? 'var(--text)' : 'var(--muted)' } }, U.name), h('span', { class: 'muted small' }, v ? '보관 중' : '미수집')),
          h('p', { class: 'muted small', style: { margin: 0 } }, v ? U.text(v) : `미수집 · 최대 수치 예: ${U.text(U.range[1])}`));
      })))) });
}

// ---------- 스킬 각성 (skills tab) ----------
export function awakenCard(app) {
  const s = app.state;
  const ids = prog.unlockedSkills(s).filter((id) => AWAKENINGS[id]);
  const st = G.awakenStatus(s, Date.now());
  return h('div', { class: 'card', dataset: { screen: 'awaken' }, style: { marginTop: '8px' } },
    h('h3', null, '스킬 각성'),
    h('p', { class: 'muted small', style: { margin: '0 0 6px' } }, `스킬 Lv ${AWAKEN.needLevel}이 되면 각성 두 갈래 중 하나를 고릅니다. 첫 선택은 무료, 바꾸기는 하루 1번 무료(오늘 ${st.free}번 남음), 그다음은 보석 ${AWAKEN.changeGem}.`),
    ids.map((id) => {
      const lv = prog.skillLevel(s, id);
      const cur = (s.skills.awaken || {})[id];
      const ok = lv >= AWAKEN.needLevel;
      return h('div', { class: 'awk-row' + (cur !== undefined && ok ? ' on' : ''), dataset: { key: 'awk-' + id } },
        h('span', { class: 'awk-ic' + (cur !== undefined && ok ? ' awk-' + (cur ? 'b' : 'a') : '') }, img(skillIcon(SKILLS[id].icon), '')),
        h('div', { class: 'awk-body' }, h('div', { class: 't' }, `${EVO.skName(s, id)} · Lv ${lv}`),
          ok ? h('div', { class: 'awk-opts' }, AWAKENINGS[id].map((o, i) => h('button', { type: 'button', class: 'awk-opt', 'aria-pressed': String(cur === i), disabled: cur !== undefined && cur !== i && st.free <= 0 && s.wallet.gem < st.gem, dataset: { awk: `${id}:${i}` }, onClick: async () => {
            if (cur === i) return;
            const r = fail(await app.game.setAwaken(id, i));
            if (r.ok) toast(`${EVO.skName(s, id)} 각성: ${o.name}${r.paid ? ` (보석 ${r.paid})` : ''}`, 'good');
          } }, h('b', null, img(skillIcon(i ? 'L11' : 'L10'), '', 'awk-em'), `${i ? 'B' : 'A'} · ${o.name}`), h('span', null, o.desc),
            cur !== undefined && cur !== i ? (st.free > 0 ? h('span', { class: 'awk-cost free' }, '오늘 무료 변경') : costChip('gem', st.gem, s.wallet.gem < st.gem)) : null)))
            : h('div', { class: 'muted small' }, `Lv ${AWAKEN.needLevel}에 각성 · ${AWAKENINGS[id].map((o, i) => `${i ? 'B' : 'A'} ${o.name}`).join(' / ')}`)));
    }));
}

// ---------- 프리셋 (equipment tab) ----------

export const v10Tiles = (app) => [{ id: 'legendCodex', ic: 'star', em: 'L07', t: '고유 효과', s: `수집 ${Object.keys(app.state.gearPlus.vault).length}/${Object.keys(UNIQUES).length}`, on: () => openLegendCodex(app) }];
