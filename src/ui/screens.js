// Screens. Each 22-screen reference id from docs/handoff (screens.json) is noted
// as `data-screen` on its root so browser QA can open and check every one.
import { BALANCE } from '../data/balance.js';
import { BOSSES, BRANCHES, CURRENCY_ICONS, REGIONS, REGION_BY_ID, SKILLS, SLOT_NAMES, RARITY, waveLevel } from '../data/content.js';
import { itemIcon, portrait, skillIcon, spriteMeta } from '../render/assets.js';
import { dismantleQuote, enhanceQuote, isEquipped, quoteUpgrade, recommend, selectForDismantle, upgradeRoom } from '../core/economy.js';
import { itemStats, rarityLabel } from '../core/items.js';
import * as prog from '../core/progression.js';
import { stageLevel, stageReward, nextRefillAt } from '../core/dungeon.js';
import { playerStats, powerRating } from '../core/stats.js';
import { RATE_METHOD } from '../core/offline.js';
import { fmt, fmtDuration, fmtFull, fmtPct, kstDayIndex } from '../core/util.js';
import { parseExport } from '../platform/save.js';
import * as Profiles from '../platform/profiles.js';
import { ATTENDANCE, RETURN_BONUS, attendanceStatus, boostActive, resolveReward } from '../core/rewards.js';
import { enableAudio, setVolume, sfx } from '../platform/audio.js';
import { button, closeAllModals, h, icon, img, modalOpen, openModal, toast } from './dom.js';
import * as FS from './fullscreen.js';

const STAT_INFO = {
  atk: { name: '공격력', fmt: (s) => fmtFull(s.atk) },
  hp: { name: '체력', fmt: (s) => fmtFull(s.hp) },
  def: { name: '방어력', fmt: (s) => fmtFull(s.def) },
  crit: { name: '치명타 확률', fmt: (s) => fmtPct(s.crit) },
  speed: { name: '공격 속도', fmt: (s) => s.aspd.toFixed(2) + '/초' },
};
const reasonText = {
  gold: '골드가 부족합니다', ore: '강화 광석이 부족합니다', cap: '상한에 도달했습니다', max: '최대 강화(+10)입니다',
  protected: '잠금·장착 장비는 분해할 수 없습니다', none: '선택한 장비가 없습니다', tickets: '입장권이 없습니다', 'no-record': '최고 기록이 없어 소탕할 수 없습니다',
  pending: '진행 중인 도전이 있습니다', stage: '도전할 수 없는 단계입니다', locked: '아직 열리지 않았습니다', wave: '웨이브 10에 먼저 도달해야 합니다',
  region: '지역이 아직 열리지 않았습니다', mode: '지금은 할 수 없습니다 (다른 전투 진행 중)', save: '저장하지 못해 취소되었습니다', busy: '처리 중입니다',
  conditions: '조건이 충족되지 않았습니다', conflict: '다른 탭이 저장 권한을 가지고 있습니다', 'switch-dev-only': '분기 재전환은 개발 설정에서만 가능합니다',
  'locked-slot': '승급 후 열리는 슬롯입니다', 'locked-skill': '아직 배우지 않은 스킬입니다', duplicate: '이미 처리되었습니다', full: '보관함에 빈 칸이 없습니다', 'already-best': '이미 주 스탯 기준 최고 장비를 착용 중입니다', missing: '장비를 찾을 수 없습니다', empty: '빈 슬롯입니다',
};
export const why = (r) => (r && r.reason ? reasonText[r.reason] || r.reason : '');
function fail(r) { if (r && !r.ok && r.reason !== 'save' && r.reason !== 'conflict') toast(why(r), 'error'); return r; }
const curIcon = (k) => img(itemIcon(CURRENCY_ICONS[k]), '');
const reduce = (app) => app.state.settings.reduceMotion;

// ---------- routing helper for goal / shortcuts ----------
export function go(app, action) {
  if (!action) return;
  closeAllModals();
  if (action === 'growth' || action === 'equipment' || action === 'skills' || action === 'dungeon') return app.setTab(action);
  if (action === 'world') return openWorld(app);
  if (action === 'quest') return openQuest(app);
  if (action === 'promotion') return openPromotion(app);
  if (action === 'trial') return openQuest(app);
  if (action === 'farm') return app.setTab('growth');
  if (action === 'mine') return openWorld(app, 'mine');
  if (action.startsWith('boss:')) return openBoss(app, action.slice(5));
}

// ======================= S01 growth panel (main) =======================
export function growthPanel(app) {
  const s0 = app.state;
  const root = h('div', { class: 'panel', dataset: { screen: 'main' }, style: { height: '100%', margin: 0 } });
  const mults = [1, 10, 100, 'MAX'].map((m) => h('button', { type: 'button', class: 'mult', 'aria-pressed': String(app.mult === m), onClick: () => { app.mult = m; app.panelDirty = true; app.renderPanel(); } }, m === 'MAX' ? 'MAX' : '×' + m));
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '성장'), h('span', { class: 'spacer' }), h('div', { class: 'mults', role: 'group', 'aria-label': '강화 배수' }, mults)));
  const list = h('div', { class: 'panel-scroll' });
  const updaters = [];
  for (const stat of ['atk', 'hp', 'def', 'crit', 'speed']) {
    const vals = h('span', { class: 'vals' });
    const note = h('span', { class: 'note' });
    const b = button('', { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = fail(await app.game.buyUpgrade(stat, app.mult));
      if (r.ok && app.state.settings.sound) sfx('metal');
      update();
    } });
    b.dataset.key = 'up-' + stat;
    // values are patched in place (no rebuild), so a tap is never lost to a re-render
    const update = () => {
      if (b.dataset.busy === '1') return;
      const s = app.state;
      const st = playerStats(s);
      const q = quoteUpgrade(s, stat, app.mult);
      const gain = BALANCE.upgrade.gains[stat];
      const n = Math.max(1, q.count);
      const after = stat === 'crit' ? fmtPct(Math.min(BALANCE.combat.critChanceCap, st.rawCrit + gain * n)) : stat === 'speed' ? Math.min(BALANCE.combat.attackSpeedCap, st.aspd + gain * n).toFixed(2) + '/초' : fmtFull((stat === 'atk' ? st.atk : stat === 'hp' ? st.hp : st.def) + gain * n * (stat === 'atk' && s.player.branch === 'berserker' ? 1.12 : 1));
      let label, nt = '', disabled = false;
      if (q.capped) { label = '상한 도달'; disabled = true; nt = stat === 'crit' ? '치명타 확률 상한 60%' : '공격 속도 상한 3.0/초'; }
      else if (q.count === 0) { label = `강화 · ${fmt(q.nextCost)}`; disabled = true; nt = `골드 ${fmtFull(q.shortfall)} 부족`; }
      else {
        label = `강화 ×${q.count} · ${fmt(q.total)}`;
        if (q.partial) nt = `×${app.mult} 중 ${q.count}회 가능 · 총 ${fmtFull(q.total)} 골드`;
        else if (app.mult !== 1) nt = `총 ${fmtFull(q.total)} 골드`;
      }
      const v = `${STAT_INFO[stat].fmt(st)} → ${q.capped ? 'MAX' : after}`;
      if (vals.textContent !== v) vals.textContent = v;
      if (note.textContent !== nt) note.textContent = nt;
      note.hidden = !nt;
      if (b.textContent !== label) b.textContent = label;
      b.disabled = disabled;
      b.setAttribute('aria-label', `${STAT_INFO[stat].name} ${label}${nt ? ' · ' + nt : ''}`);
    };
    update();
    updaters.push(update);
    list.appendChild(h('div', { class: 'stat-row' }, h('span', { class: 'nm' }, STAT_INFO[stat].name), vals, note, b));
  }
  const power = h('b');
  const eqb = h('b');
  const capNote = h('p', { class: 'muted' }, '장비 치명타 중 60% 상한을 넘는 부분은 적용되지 않습니다.');
  updaters.push(() => { const st = playerStats(app.state); power.textContent = fmt(powerRating(st)); eqb.textContent = `공 ${st.equipBonus.atk} · 체 ${st.equipBonus.hp} · 방 ${st.equipBonus.def}`; capNote.hidden = !st.capped.crit; });
  updaters[updaters.length - 1]();
  list.appendChild(h('details', { class: 'card' }, h('summary', { class: 'small' }, '전투력 · 상세 능력치'),
    h('div', { class: 'kv' }, '전투력(표시용)', power),
    h('div', { class: 'kv' }, '치명 피해', h('b', null, fmtPct(playerStats(s0).critMul, 0))),
    h('div', { class: 'kv' }, '장비 보너스', eqb), capNote));
  root.appendChild(list);
  root._update = () => updaters.forEach((u) => u());
  return root;
}

// ======================= S02 equipment panel =======================
function itemTile(app, it, { onClick, sel = false } = {}) {
  const eq = isEquipped(app.state, it.id);
  const tile = h('button', { type: 'button', class: `item r-${it.rarity}${sel ? ' sel' : ''}`, dataset: { key: 'it-' + it.id },
    'aria-label': `${rarityLabel(it.rarity)} ${it.name}${it.enhance ? ' +' + it.enhance : ''} Lv${it.level}${eq ? ' 장착 중' : ''}${it.locked ? ' 잠금' : ''}`, onClick },
    h('span', { class: `mk r-${it.rarity}` }, RARITY[it.rarity].mark),
    it.enhance ? h('span', { class: 'en' }, '+' + it.enhance) : null,
    img(itemIcon(it.look), ''),
    h('span', { class: 'nm' }, it.name),
    h('span', { class: 'st' }, eq ? h('span', { class: 'tag' }, '장착') : null, it.locked ? h('span', { class: 'tag' }, '잠금') : null),
    it.isNew && !eq ? h('span', { class: 'newdot' }, 'N') : null);
  return tile;
}

export function equipmentPanel(app) {
  const s = app.state;
  app.eqFilter ||= 'all';
  const root = h('div', { class: 'panel', dataset: { screen: s.inventory.length ? 'inventory' : 'empty' }, style: { height: '100%', margin: 0 } });
  const cap = BALANCE.equipment.inventoryCapacity;
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '장비'), h('span', { class: 'muted num' }, `${s.inventory.length}/${cap}`), h('span', { class: 'spacer' }),
    button('추천 장착', { cls: 'chip-btn', busy: true, ariaLabel: '추천 장착 (주 스탯 기준)', onClick: async () => { const r = fail(await app.game.autoEquip()); if (r.ok) toast('주 스탯 기준으로 장착했습니다. (DPS 최적 계산 아님)', 'good'); } })));
  const sc = h('div', { class: 'panel-scroll' });
  if (s.overflow.length) sc.appendChild(h('div', { class: 'banner', role: 'status' }, icon('warning', 20), h('span', { style: { flex: 1 } }, `임시 보관함 ${s.overflow.length}개`), button('확인', { cls: 'btn', onClick: () => openOverflow(app) })));
  // equipped 4 slots
  const eqGrid = h('div', { class: 'grid4', 'aria-label': '장착 장비' });
  for (const slot of BALANCE.equipment.slots) {
    const id = s.equipped[slot];
    const it = id && s.inventory.find((i) => i.id === id);
    eqGrid.appendChild(it ? itemTile(app, it, { onClick: () => openCompare(app, it.id) }) : h('div', { class: 'item empty' }, SLOT_NAMES[slot], h('br'), '비어 있음'));
  }
  sc.append(h('p', { class: 'muted', style: { margin: '0 0 6px' } }, '장착 중'), eqGrid);
  if (!s.inventory.length) {
    // S19 empty state
    sc.appendChild(h('div', { class: 'card', style: { marginTop: '12px', textAlign: 'center' } }, img(itemIcon('I21'), '', ''),
      h('h3', null, '아직 장비가 없습니다'), h('p', { class: 'muted' }, '사냥 중 처치한 적이 5% 확률로 장비를 떨어뜨립니다. 보스를 처음 처치하면 희귀 무기를 확정으로 얻습니다.'),
      button('자동 사냥 계속하기', { cls: 'btn btn-primary', onClick: () => app.setTab('growth') })));
    root.appendChild(sc);
    return root;
  }
  const filters = [['all', '전체'], ['weapon', '무기'], ['helmet', '투구'], ['armor', '갑옷'], ['accessory', '장신구']];
  sc.appendChild(h('div', { class: 'tabs', role: 'group', 'aria-label': '부위 필터', style: { margin: '12px 0 8px' } },
    filters.map(([k, l]) => h('button', { type: 'button', class: 'tab', 'aria-pressed': String(app.eqFilter === k), onClick: () => { app.eqFilter = k; app.renderPanel(); } }, l))));
  const order = { rare: 0, uncommon: 1, common: 2 };
  const items = s.inventory.filter((i) => app.eqFilter === 'all' || i.slot === app.eqFilter)
    .sort((a, b) => order[a.rarity] - order[b.rarity] || b.level - a.level || b.enhance - a.enhance);
  const grid = h('div', { class: 'grid4 inv' });
  for (const it of items.slice(0, 200)) grid.appendChild(itemTile(app, it, { onClick: () => openCompare(app, it.id) }));
  sc.appendChild(grid);
  sc.appendChild(h('div', { style: { marginTop: '10px' } }, button('일괄 분해', { cls: 'btn', onClick: () => openDismantle(app) })));
  sc.appendChild(h('p', { class: 'muted' }, '잠금·장착 장비는 분해 대상에서 제외됩니다. 장비를 바꿔도 캐릭터 외형은 승급 외형만 바뀝니다.'));
  root.appendChild(sc);
  return root;
}

// ======================= S03 compare =======================
function statLines(it) {
  const s = itemStats(it);
  const out = [];
  if (s.atk !== undefined) out.push(['공격력', s.atk]);
  if (s.hp !== undefined) out.push(['체력', s.hp]);
  if (s.def !== undefined) out.push(['방어력', s.def]);
  if (s.crit !== undefined) out.push(['치명타', fmtPct(s.crit, 2)]);
  return out;
}
export function openCompare(app, id) {
  const render = () => {
    const s = app.state;
    const it = s.inventory.find((i) => i.id === id);
    if (!it) { m.close(); return; }
    if (it.isNew) app.game.markSeen([it.id]);
    const curId = s.equipped[it.slot];
    const cur = curId && curId !== it.id ? s.inventory.find((i) => i.id === curId) : null;
    const eq = isEquipped(s, it.id);
    const col = (x, title) => h('div', { class: 'card', style: { flex: 1, margin: 0 } }, h('p', { class: 'muted', style: { margin: 0 } }, title),
      x ? [img(itemIcon(x.look), '', ''), h('h3', null, (x.enhance ? '+' + x.enhance + ' ' : '') + x.name), h('div', { class: `rar r-${x.rarity}` }, rarityLabel(x.rarity) + ` · Lv ${x.level}`),
        statLines(x).map(([k, v]) => h('div', { class: 'kv' }, k, h('b', null, typeof v === 'number' ? fmtFull(v) : v)))] : h('p', { class: 'muted' }, '비어 있음'));
    const body = h('div', { dataset: { screen: 'compare' } },
      h('div', { class: 'btn-row', style: { alignItems: 'stretch' } }, col(cur || (eq ? null : null), eq ? '장착 중' : '현재 장착'), h('div', { style: { alignSelf: 'center', flex: 'none' } }, icon('compare', 22)), col(it, eq ? '이 장비' : '선택')));
    m.setBody(body);
    const lockBtn = button(it.locked ? '잠금 해제' : '잠금', { cls: 'btn', busy: true, onClick: async () => { fail(await app.game.setLock(it.id, !it.locked)); render(); } });
    const actions = [
      eq ? button('장착 해제', { cls: 'btn', busy: true, onClick: async () => { fail(await app.game.unequip(it.slot)); render(); } })
        : button('장착', { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.equip(it.id)); if (r.ok) { toast(`${it.name} 장착`, 'good'); render(); } } }),
      h('div', { class: 'btn-row' }, button(`강화 +${it.enhance}`, { cls: 'btn btn-gold', onClick: () => openEnhance(app, it.id) }), lockBtn),
    ];
    m.setActions(actions);
  };
  const m = openModal({ id: 'compare', title: '장비 비교', body: h('div'), actions: [] });
  render();
  return m;
}

// ======================= S04 enhance =======================
export function openEnhance(app, id) {
  const render = (anim = null) => {
    const s = app.state;
    const it = s.inventory.find((i) => i.id === id);
    if (!it) { m.close(); return; }
    const q = enhanceQuote(s, id);
    const before = itemStats(it);
    const nextIt = { ...it, enhance: Math.min(10, it.enhance + 1) };
    const after = itemStats(nextIt);
    const lines = Object.keys(before).map((k) => h('div', { class: 'kv' }, { atk: '공격력', hp: '체력', def: '방어력', crit: '치명타' }[k],
      h('b', null, k === 'crit' ? `${fmtPct(before[k], 2)} → ${fmtPct(after[k], 2)}` : `${fmtFull(before[k])} → ${it.enhance >= 10 ? 'MAX' : fmtFull(after[k])}`)));
    const ring = h('div', { class: 'card' + (anim ? ' reveal' : ''), style: { textAlign: 'center' } },
      img(itemIcon(it.look), '', ''), h('h3', null, `+${it.enhance} ${it.name}`), h('div', { class: `rar r-${it.rarity}` }, rarityLabel(it.rarity)),
      anim ? h('p', { class: 'okc', role: 'status' }, `강화 성공 · +${it.enhance}`) : null);
    if (anim && !reduce(app)) ring.animate([{ boxShadow: '0 0 0 0 rgba(216,182,117,.9)' }, { boxShadow: '0 0 0 10px rgba(216,182,117,0)' }], { duration: 600 });
    m.setBody(h('div', { dataset: { screen: 'enhance' } }, ring, h('div', { class: 'card' }, lines,
      h('div', { class: 'kv' }, '비용', h('b', null, it.enhance >= 10 ? '—' : `강화 광석 ${fmtFull(q.cost || 0)}`)),
      h('div', { class: 'kv' }, '보유', h('b', null, `강화 광석 ${fmtFull(s.wallet.ore)}`))),
      h('p', { class: 'muted' }, 'MVP 강화는 +10까지 100% 성공합니다. 실패·하락·파괴가 없습니다. 분해 시 투입한 광석의 80%를 돌려받습니다.')));
    const disabled = it.enhance >= 10 || !q.ok;
    const label = it.enhance >= 10 ? '최대 강화 +10' : q.ok ? `강화 · 광석 ${fmtFull(q.cost)}` : `광석 ${fmtFull(q.shortfall)} 부족`;
    m.setActions([button(label, { cls: 'btn btn-primary', disabled, busy: true, onClick: async () => {
      const r = fail(await app.game.enhance(id));
      if (r.ok) { if (app.state.settings.sound) sfx('metal'); render(true); }
    } })]);
  };
  const m = openModal({ id: 'enhance', title: '장비 강화', body: h('div'), actions: [] });
  render();
}

// ======================= S16 dismantle =======================
export function openDismantle(app, preset = null) {
  let level = 'common';
  const render = () => {
    const ids = preset || selectForDismantle(app.state, level);
    const q = dismantleQuote(app.state, ids);
    const blocked = app.state.inventory.filter((i) => i.locked || isEquipped(app.state, i.id)).length;
    m.setBody(h('div', { dataset: { screen: 'dismantle' } },
      preset ? null : h('div', { class: 'tabs', role: 'group', 'aria-label': '분해 등급' }, [['common', '일반 I 이하'], ['uncommon', '고급 II 이하'], ['rare', '희귀 III 이하']].map(([k, l]) =>
        h('button', { type: 'button', class: 'tab', 'aria-pressed': String(level === k), onClick: () => { level = k; render(); } }, l))),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('div', { class: 'kv' }, '분해할 장비', h('b', null, `${q.count}개`)),
        ...Object.entries(q.byRarity).map(([r, n]) => h('div', { class: 'kv' }, rarityLabel(r), h('b', null, `${n}개`))),
        h('div', { class: 'kv' }, '받을 강화 광석', h('b', null, fmtFull(q.ore))),
        h('div', { class: 'kv' }, '제외(잠금·장착)', h('b', null, `${blocked}개`))),
      h('p', { class: 'warn' }, '분해는 되돌릴 수 없습니다. 투입한 강화 광석은 80%(내림)만 돌려받습니다.')));
    m.setActions([button(q.count ? `${q.count}개 분해 · 광석 +${fmtFull(q.ore)}` : '분해할 장비 없음', { cls: 'btn btn-danger', disabled: !q.count, busy: true, onClick: async () => {
      const r = fail(await app.game.dismantle(q.items.map((i) => i.id)));
      if (r.ok) { toast(`${r.quote.count}개 분해 · 강화 광석 +${fmtFull(r.quote.ore)}`, 'good'); m.close(); }
    } }), button('취소', { cls: 'btn', onClick: () => m.close() })]);
  };
  const m = openModal({ id: 'dismantle', title: '분해 전 확인', body: h('div'), actions: [] });
  render();
}

// ======================= S15 overflow =======================
export function openOverflow(app) {
  const render = () => {
    const s = app.state;
    const free = BALANCE.equipment.inventoryCapacity - s.inventory.length;
    m.setBody(h('div', { dataset: { screen: 'overflow' } },
      h('p', null, `보관함(${s.inventory.length}/${BALANCE.equipment.inventoryCapacity})이 가득 차서 장비 ${s.overflow.length}개를 임시 보관함에 두었습니다. 자동으로 삭제하지 않습니다.`),
      h('div', { class: 'grid4' }, s.overflow.slice(0, 24).map((it) => itemTile(app, it, {}))),
      s.overflow.length > 24 ? h('p', { class: 'muted' }, `외 ${s.overflow.length - 24}개`) : null,
      h('p', { class: 'muted' }, `임시 보관함은 ${BALANCE.equipment.overflowCapacity}칸입니다. 그것도 가득 차면 새 장비는 분해 값만큼 강화 광석으로 바뀝니다.${s.progression.counters.overflowConverted ? ` 지금까지 ${s.progression.counters.overflowConverted}개 → 광석 ${fmtFull(s.progression.counters.overflowConvertedOre || 0)}` : ''}`),
      h('p', { class: 'muted' }, free > 0 ? `빈 칸 ${free}개 · 옮기기를 누르면 가능한 만큼 보관함으로 옮깁니다.` : '먼저 장비를 분해해 빈 칸을 만드세요.')));
    m.setActions([
      button(free > 0 ? `보관함으로 옮기기 (${Math.min(free, s.overflow.length)}개)` : '빈 칸 없음', { cls: 'btn btn-primary', disabled: free <= 0 || !s.overflow.length, busy: true, onClick: async () => { const r = fail(await app.game.moveOverflow()); if (r.ok) { toast(`${r.moved.length}개를 옮겼습니다.`, 'good'); if (!app.state.overflow.length) m.close(); else render(); } } }),
      button('일반 장비 분해하러 가기', { cls: 'btn', onClick: () => { m.close(); openDismantle(app); } }),
    ]);
  };
  const m = openModal({ id: 'overflow', title: '보관함이 가득 찼습니다', body: h('div'), actions: [] });
  render();
}

// ======================= S05 skills panel / S06 detail =======================
export function skillsPanel(app) {
  const s = app.state;
  const root = h('div', { class: 'panel', dataset: { screen: 'skills' }, style: { height: '100%', margin: 0 } });
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '스킬 편성'), h('span', { class: 'muted' }, `일반 ${prog.slotCount(s)}칸 + 궁극기`)));
  const sc = h('div', { class: 'panel-scroll' });
  const unlocked = prog.unlockedSkills(s);
  const eq = s.skills.equipped;
  for (let i = 0; i < 4; i++) {
    const id = eq[i];
    const locked = i >= prog.slotCount(s);
    sc.appendChild(h('div', { class: 'skill-line' },
      locked ? h('span', { class: 'skill locked', style: { width: '52px', height: '52px' } }, icon('lock', 20)) : id ? img(skillIcon(SKILLS[id].icon), '') : h('span', { class: 'skill empty', style: { width: '52px', height: '52px' } }),
      h('div', null, h('div', { class: 't' }, `${i + 1}번 · ${locked ? '승급 해금' : id ? SKILLS[id].name : '비어 있음'}`), h('div', { class: 'muted' }, locked ? 'Lv 30 서약 각성 후 분기 스킬이 들어갑니다.' : id ? SKILLS[id].desc : '')),
      locked ? button('조건', { cls: 'chip-btn', onClick: () => openQuest(app) }) : button('변경', { cls: 'chip-btn', onClick: () => openSkillPicker(app, i) })));
  }
  sc.appendChild(h('div', { class: 'skill-line' }, img(skillIcon('S5'), ''), h('div', null, h('div', { class: 't' }, '궁극기 · 별빛 참격'), h('div', { class: 'muted' }, '게이지 100 소모 · 일반 공격 +2, 피격 +1(초당 최대 2), 처치 +5')),
    button('상세', { cls: 'chip-btn', onClick: () => openSkillDetail(app, 'starSlash') })));
  sc.appendChild(h('p', { class: 'small', style: { margin: '8px 0 4px' } }, '궁극기 자동 사용'));
  const modes = [['OFF', '끔'], ['ELITE_BOSS', '정예·보스'], ['ALWAYS', '항상']];
  sc.appendChild(h('div', { class: 'seg', role: 'group', 'aria-label': '궁극기 자동 사용' }, modes.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(s.skills.ultAuto === k), onClick: async () => fail(await app.game.setUltAuto(k)) }, l))));
  sc.appendChild(h('label', { class: 'switch-row' }, h('span', null, '일반 스킬 자동 시전'), h('input', { type: 'checkbox', checked: s.skills.autoCast, onChange: async (e) => fail(await app.game.setAutoCast(e.target.checked)) })));
  sc.appendChild(h('p', { class: 'muted' }, '스킬 레벨은 플레이어 레벨과 승급에 따라 자동으로 오릅니다 (스킬북 없음). 전투 중 스킬 아이콘을 누르면 조건이 맞을 때 우선 시전됩니다.'));
  const notYet = Object.values(SKILLS).filter((k) => !unlocked.includes(k.id));
  if (notYet.length) sc.appendChild(h('div', { class: 'card' }, h('h3', null, '잠긴 스킬'), notYet.map((k) => h('div', { class: 'kv' }, k.name, h('b', null, k.unlock.level ? `Lv ${k.unlock.level}` : BRANCHES[k.unlock.branch].name)))));
  root.appendChild(sc);
  return root;
}
function openSkillPicker(app, slotIdx) {
  const s = app.state;
  const options = prog.unlockedSkills(s).filter((id) => SKILLS[id].kind !== 'ultimate');
  const m = openModal({ id: 'skillpick', title: `${slotIdx + 1}번 슬롯`, body: h('div', null, options.map((id) => h('div', { class: 'skill-line' }, img(skillIcon(SKILLS[id].icon), ''),
    h('div', null, h('div', { class: 't' }, SKILLS[id].name + (s.skills.equipped[slotIdx] === id ? ' · 장착 중' : '')), h('div', { class: 'muted' }, SKILLS[id].desc)),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      button('장착', { cls: 'chip-btn', disabled: s.skills.equipped[slotIdx] === id, busy: true, onClick: async () => { const r = fail(await app.game.setSkillSlot(slotIdx, id)); if (r.ok) m.close(); } }),
      button('상세', { cls: 'chip-btn', onClick: () => openSkillDetail(app, id) }))))) });
}
export function openSkillDetail(app, id) {
  const sk = SKILLS[id];
  const s = app.state;
  const lvl = prog.skillLevel(s, id);
  const coef = sk.coef ? sk.coef * (1 + BALANCE.skills.levelBonusPerLevel * (lvl - 1)) : null;
  openModal({ id: 'skilldetail', title: sk.name, body: h('div', { dataset: { screen: 'skilldetail' } },
    img(skillIcon(sk.icon), '', 'boss-art'),
    h('p', null, sk.desc),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '스킬 레벨', h('b', null, `${lvl} / 10`)),
      coef ? h('div', { class: 'kv' }, '피해 계수', h('b', null, `공격력 × ${coef.toFixed(2)}`)) : null,
      sk.cd ? h('div', { class: 'kv' }, '재사용 대기', h('b', null, `${sk.cd}초`)) : null,
      sk.internalCd ? h('div', { class: 'kv' }, '내부 대기', h('b', null, `${sk.internalCd}초`)) : null,
      h('div', { class: 'kv' }, '범위', h('b', null, sk.target === 'all' ? '화면의 모든 적' : sk.kind === 'buff' ? '자신' : sk.kind === 'passive-counter' ? '공격한 적' : '전방 단일'))),
    h('p', { class: 'muted' }, '레벨당 피해 +8% (합연산). 피해는 공격 동작의 타격 시점에 한 번 계산됩니다.')) });
}

// ======================= S14 adventure panel (region + boss + dungeon) =======================
function adventureHeader(app) {
  const s = app.state;
  const region = REGION_BY_ID[s.progression.region];
  const boss = BOSSES[region.boss];
  const can = app.game.canChallengeBoss(region.boss);
  const cleared = s.progression.bossCleared[region.boss];
  const wrap = h('div');
  wrap.appendChild(h('div', { class: 'section-title' }, '사냥터 · 보스'));
  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'kv' }, region.name, h('b', null, `웨이브 ${s.progression.wave}/10 · 최고 ${s.progression.maxWave[region.id] || 1}`)),
    h('div', { class: 'kv' }, boss.name, h('b', null, cleared ? '처치 완료' : can.ok ? '도전 가능' : '웨이브 10 도달 시')),
    h('div', { class: 'btn-row', style: { marginTop: '8px' } },
      button('지역 선택', { cls: 'btn', onClick: () => openWorld(app) }),
      button(cleared ? '보스 재도전' : '보스 도전', { cls: 'btn' + (can.ok && !cleared ? ' btn-primary' : ''), onClick: () => openBoss(app, region.boss) }))));
  return wrap;
}
// ======================= S14 dungeon panel =======================
export function dungeonPanel(app) {
  const s = app.state;
  const d = s.dungeon;
  const root = h('div', { class: 'panel', dataset: { screen: 'dungeon' }, style: { height: '100%', margin: 0 } });
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '모험'), h('span', { class: 'spacer' }), h('span', { class: 'cur' }, curIcon('ticket'), `${d.tickets}/${BALANCE.dungeon.ticketCap}`)));
  const sc = h('div', { class: 'panel-scroll' });
  sc.appendChild(adventureHeader(app));
  sc.appendChild(h('div', { class: 'section-title' }, '재료 던전 · 별의 채석장'));
  if (!prog.dungeonOpen(s)) {
    sc.appendChild(h('div', { class: 'card' }, h('h3', null, '아직 열리지 않았습니다'), h('p', { class: 'muted' }, `${BOSSES.B01.name}을(를) 처치하면 재료 던전이 열립니다.`), button('보스 도전 보기', { cls: 'btn', onClick: () => openBoss(app, 'B01') })));
    root.appendChild(sc);
    return root;
  }
  const next = Math.min(d.best + 1, 99);
  const rw = stageReward(next);
  const refill = new Date(nextRefillAt(Date.now()));
  sc.appendChild(h('div', { class: 'card' },
    h('div', { class: 'kv' }, '입장권', h('b', null, `${d.tickets} / ${BALANCE.dungeon.ticketCap}`)),
    h('div', { class: 'kv' }, '다음 충전', h('b', null, `${refill.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })} 00:00 KST · +${BALANCE.dungeon.dailyTickets}`)),
    h('div', { class: 'kv' }, '최고 기록', h('b', null, d.best ? `${d.best}단계` : '없음')),
    h('div', { class: 'kv' }, `${next}단계 보상`, h('b', null, `강화 광석 ${rw.ore} · 골드 ${fmt(rw.gold)}`)),
    h('div', { class: 'kv' }, `${next}단계 적 레벨`, h('b', null, `Lv ${stageLevel(next)} · ${BALANCE.dungeon.stageTimeSec}초 안에 ${BALANCE.dungeon.killTarget}마리`))));
  if (d.tickets <= 0) {
    // S19 empty/ticket-zero state
    sc.appendChild(h('div', { class: 'card', dataset: { screen: 'empty' } }, h('h3', null, '입장권이 없습니다'), h('p', { class: 'muted' }, `매일 00:00(KST)에 ${BALANCE.dungeon.dailyTickets}장 충전, 최대 ${BALANCE.dungeon.ticketCap}장까지 쌓입니다. 방치 보상으로는 지급되지 않습니다.`)));
  }
  const best = stageReward(Math.max(1, d.best));
  sc.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    button(d.best ? `${d.best}단계 소탕 · 입장권 1` : '소탕 불가 · 기록 없음', { cls: 'btn btn-primary', disabled: !d.best || d.tickets <= 0, busy: true, onClick: async () => {
      const r = fail(await app.game.sweepDungeon());
      if (r.ok) toast(`${r.stage}단계 소탕 · 광석 +${r.ore} · 골드 +${fmt(r.gold)}`, 'good');
    } }),
    d.best ? null : h('p', { class: 'muted' }, '한 번 클리어한 단계부터 소탕할 수 있습니다.'),
    button(`${next}단계 도전 · 입장권 1`, { cls: 'btn', disabled: d.tickets <= 0 || app.game.mode !== 'FARM', busy: true, onClick: async () => {
      const r = fail(await app.game.enterDungeon(next));
      if (r.ok) toast(`${next}단계 시작`, 'info');
    } }),
    d.best > 1 ? button(`${d.best}단계 다시 도전`, { cls: 'btn', disabled: d.tickets <= 0 || app.game.mode !== 'FARM', busy: true, onClick: async () => fail(await app.game.enterDungeon(d.best)) }) : null));
  sc.appendChild(h('p', { class: 'muted' }, `입장 시 입장권 1장을 먼저 사용합니다. 시간 안에 실패하면 광석 30%만 받습니다. 전투 중 앱이 종료되면 다음 실행 때 입장권 1장을 돌려드립니다. 소탕 보상: 광석 ${best.ore}.`));
  root.appendChild(sc);
  return root;
}

// ======================= menu panel =======================
// Things the player can act on now get a red dot; everything is one tap from here.
export function menuTiles(app) {
  const s = app.state;
  const cl = prog.promotionChecklist(s);
  const promoHot = cl.canChoose || cl.canTrial;
  const extra = (globalThis.__menuExtras || []).map((f) => f(app)).filter(Boolean);
  const att = attendanceStatus(s, Date.now());
  return [
    ...extra,
    { id: 'attendance', ic: 'check', t: '출석', s: att.claimedToday ? `오늘 완료 · ${att.count}일` : `${att.index + 1}일차 받기`, dot: att.canClaim, on: () => openAttendance(app) },
    { id: 'promotion', ic: 'star', t: '서약 각성', s: s.player.branch ? BRANCHES[s.player.branch].name : cl.canChoose ? '분기 선택 가능' : cl.canTrial ? '시련 도전 가능' : `Lv ${BALANCE.promotionLevel} 승급`, dot: promoHot,
      on: () => (cl.canChoose || s.player.branch ? openPromotion(app) : openQuest(app)) },
    { id: 'world', ic: 'dungeon', t: '지역 선택', s: REGION_BY_ID[s.progression.region].name, on: () => openWorld(app) },
    { id: 'summon', ic: 'equipment', t: '별의 유산', s: '장비 소환', on: () => openSummon(app) },
    { id: 'settings', ic: 'menu', t: '환경 설정', s: '저장 · 소리 · 접근성', on: () => openSettings(app) },
    { id: 'help', ic: 'info', t: '도움말', s: '처음 하는 분', on: () => openHelp(app) },
  ];
}
export function todoCount(app) { return menuTiles(app).filter((t) => t.dot).length; }
export function menuPanel(app) {
  const root = h('div', { class: 'panel', style: { height: '100%', margin: 0 } });
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '메뉴')));
  const sc = h('div', { class: 'panel-scroll' });
  const grid = h('div', { class: 'tiles' });
  for (const t of menuTiles(app)) {
    grid.appendChild(h('button', { type: 'button', class: 'tile' + (t.dot ? ' hot' : ''), dataset: { key: 'tile-' + t.id }, 'aria-label': t.t + (t.dot ? ' (할 일 있음)' : ''), onClick: t.on },
      icon(t.ic, 24), h('span', { class: 't' }, t.t), h('span', { class: 's' }, t.s), t.dot ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null));
  }
  sc.appendChild(grid);
  root.appendChild(sc);
  return root;
}

// ======================= S07 world =======================
export function openWorld(app, focus = null) {
  const s = app.state;
  const body = h('div', { dataset: { screen: 'world' } });
  for (const r of REGIONS) {
    const open = prog.regionUnlocked(s, r.id);
    const max = s.progression.maxWave[r.id] || 0;
    const cleared = s.progression.bossCleared[r.boss];
    const card = h('div', { class: 'card', style: focus === r.id ? { borderColor: 'var(--gold)' } : null },
      h('h3', null, r.name, h('span', { class: 'muted' }, `  ${r.label}`)),
      h('div', { class: 'kv' }, '상태', h('b', null, !open ? '잠김' : cleared ? '보스 처치 완료' : max >= 10 ? '보스 도전 가능' : `웨이브 ${max}/10`)),
      open ? h('div', { class: 'kv' }, '적 레벨', h('b', null, `Lv ${waveLevel(r, 1)}–${waveLevel(r, 10)}`)) : h('p', { class: 'muted' }, `${BOSSES[REGIONS[r.order - 1].boss].name} 처치 시 열림`));
    if (open) {
      const waves = h('div', { class: 'tabs', role: 'group', 'aria-label': `${r.name} 웨이브 선택` });
      for (let w = 1; w <= Math.max(1, max); w++) waves.appendChild(h('button', { type: 'button', class: 'tab', 'aria-pressed': String(s.progression.region === r.id && s.progression.wave === w), onClick: async () => {
        const res = fail(await app.game.setFarm(r.id, w, w === max));
        if (res.ok) { toast(`${r.name} 웨이브 ${w}에서 사냥합니다.${w < max ? ' (자동 진행 멈춤)' : ''}`, 'info'); m.close(); }
      } }, `W${w}`));
      card.append(h('p', { class: 'small', style: { margin: '8px 0 4px' } }, '파밍 위치'), waves,
        button(cleared ? '보스 재도전' : '보스 정보', { cls: 'btn', onClick: () => openBoss(app, r.boss) }));
    }
    body.appendChild(card);
  }
  body.appendChild(h('p', { class: 'muted' }, '권장 레벨은 잠금 조건이 아닙니다. 낮은 웨이브를 고르면 자동 진행이 멈추고 그 웨이브에서 계속 사냥합니다.'));
  const m = openModal({ id: 'world', title: '지역 선택', body });
}

// ======================= S08 boss =======================
export function openBoss(app, bossId = null) {
  const s = app.state;
  bossId ||= REGION_BY_ID[s.progression.region].boss;
  const b = BOSSES[bossId];
  const can = app.game.canChallengeBoss(bossId);
  const first = !s.progression.bossCleared[bossId];
  const art = spriteMeta().bosses[bossId];
  const m = openModal({ id: 'boss', title: '보스 도전', body: h('div', { dataset: { screen: 'boss' } },
    img(art.file, b.name, 'boss-art'),
    h('h3', { style: { fontSize: '18px', margin: '0 0 8px' } }, b.name),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '제한 시간', h('b', null, `${BALANCE.combat.bossTimeoutSec}초`)),
      h('div', { class: 'kv' }, '보스 레벨', h('b', null, `Lv ${b.level}`)),
      h('div', { class: 'kv' }, '패턴', h('b', null, `${b.heavy.name} · ${b.heavy.everySec}초마다 · 예고 ${b.heavy.telegraphMs / 1000}초`)),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, b.desc)),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, first ? '최초 처치 보상' : '반복 처치 보상', h('b', null, first ? (bossId === 'B01' ? '희귀 무기 1개 확정' : '희귀 장비 1개 확정') + ' · 강화 광석' : '고급/희귀 장비 1개')),
      first && bossId !== 'B03' ? h('div', { class: 'kv' }, '다음 지역', h('b', null, REGIONS[REGION_BY_ID[b.region].order + 1].name + ' 개방')) : null,
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '실패해도 골드·장비 손실은 없고 직전 사냥 위치로 돌아갑니다.'))),
    actions: [
      button(can.ok ? '무료 도전' : can.reason === 'wave' ? `웨이브 10 도달 필요 (현재 ${can.have}/10)` : why(can), { cls: 'btn btn-primary', disabled: !can.ok || app.game.mode !== 'FARM', onClick: () => {
        const r = app.game.startBoss(bossId);
        if (!r.ok) return fail(r);
        m.close();
      } }),
      button('파밍 계속', { cls: 'btn', onClick: () => m.close() })] });
}

// ======================= S09 victory / S10 defeat / dungeon & trial results =======================
function rewardTiles(list) {
  return h('div', { class: 'rewards reveal' }, list.map((r, i) => {
    const el = h('div', { class: 'reward', style: { animationDelay: `${350 + i * 60}ms` } }, img(r.icon, ''), h('b', null, r.value), r.label);
    return el;
  }));
}
function itemRewards(items) { return items.map((it) => ({ icon: itemIcon(it.look), value: rarityLabel(it.rarity), label: it.name })); }

export function openResult(app, r) {
  if (r.saveFailed) {
    return openModal({ id: 'saveerror', title: '저장하지 못했습니다', alert: true, dismissible: false,
      body: h('div', { dataset: { screen: 'saveerror' } }, h('p', null, '전투 결과를 저장하지 못해 보상을 아직 지급하지 않았습니다. 보상 연출도 시작하지 않았습니다.'), h('p', { class: 'muted' }, '다시 시도하면 같은 결과를 한 번만 저장합니다.')),
      actions: [button('다시 저장', { cls: 'btn btn-primary', busy: true, onClick: async () => { closeAllModals(); await app.game.retryFinish(); } }), button('저장 파일 내보내기', { cls: 'btn', onClick: () => downloadExport(app) })] });
  }
  const back = () => {
    const res = app.game.returnToFarm();
    if (res.ok) app.applyView();
  };
  if (r.kind === 'boss' && r.win) {
    const b = BOSSES[r.bossId];
    const tiles = [{ icon: itemIcon(CURRENCY_ICONS.gold), value: '+' + fmt(r.gold), label: '골드' }, { icon: itemIcon(CURRENCY_ICONS.exp), value: '+' + fmt(r.exp), label: r.expRes && r.expRes.toPending ? '경험치(보관)' : '경험치' }];
    if (r.ore) tiles.push({ icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + r.ore, label: '강화 광석' });
    tiles.push(...itemRewards(r.items || []));
    if (app.state.settings.sound) sfx('bell');
    const actions = [];
    if (r.unlocked) actions.push(button(`${REGION_BY_ID[r.unlocked].name}(으)로 이동`, { cls: 'btn btn-primary', busy: true, onClick: async () => { m.close(); back(); await app.game.setFarm(r.unlocked, 1, true); } }));
    actions.push(button(r.unlocked ? '현재 지역에서 계속' : '파밍으로 돌아가기', { cls: 'btn' + (r.unlocked ? '' : ' btn-primary'), onClick: () => { m.close(); back(); } }));
    const m = openModal({ id: 'victory', title: r.first ? '지역 돌파' : '보스 처치', dismissible: false, body: h('div', { dataset: { screen: 'victory' }, class: 'reveal' },
      h('p', null, `${b.name} 처치 · ${r.timeSec}초`), rewardTiles(tiles),
      r.overflowed && r.overflowed.length ? h('p', { class: 'warn' }, `보관함이 가득 차 ${r.overflowed.length}개는 임시 보관함에 들어갔습니다.`) : null,
      r.unlocked ? h('p', { class: 'okc' }, `새 지역 개방: ${REGION_BY_ID[r.unlocked].name}`) : null,
      r.bossId === 'B01' && r.first ? h('p', { class: 'muted' }, '재료 던전 「별의 채석장」이 열렸습니다.') : null), actions });
    return m;
  }
  if (r.kind === 'boss' && !r.win) {
    const st = playerStats(app.state);
    const m = openModal({ id: 'defeat', title: '다시 준비하기', dismissible: false, body: h('div', { dataset: { screen: 'defeat' } },
      h('p', null, r.reason === 'timeout' ? `제한 시간 ${BALANCE.combat.bossTimeoutSec}초가 지났습니다.` : r.reason === 'forfeit' ? '도전을 중단했습니다.' : '세린이 쓰러졌습니다.'),
      h('p', { class: 'okc' }, '골드·장비 손실은 없습니다. 직전 사냥 위치로 돌아갑니다.'),
      h('div', { class: 'card' }, h('h3', null, '이렇게 강해질 수 있어요'),
        h('div', { class: 'kv' }, '공격력 강화', h('b', null, `현재 ${fmtFull(st.atk)}`)),
        h('div', { class: 'kv' }, '장비 강화', h('b', null, `광석 ${fmtFull(app.state.wallet.ore)}`)),
        h('div', { class: 'kv' }, '방패 돌진', h('b', null, '강공 예고 중 사용하면 피해 40% 감소')))),
      actions: [button('성장하러 가기', { cls: 'btn btn-primary', onClick: () => { m.close(); back(); app.setTab('growth'); } }), button('장비 확인', { cls: 'btn', onClick: () => { m.close(); back(); app.setTab('equipment'); } })] });
    return m;
  }
  if (r.kind === 'dungeon') {
    const tiles = [{ icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + r.ore, label: '강화 광석' }];
    if (r.gold) tiles.push({ icon: itemIcon(CURRENCY_ICONS.gold), value: '+' + fmt(r.gold), label: '골드' });
    const m = openModal({ id: 'dungeonResult', title: r.cleared ? `${r.stage}단계 클리어` : `${r.stage}단계 실패`, dismissible: false, body: h('div', { dataset: { screen: 'dungeon' } },
      h('p', null, r.cleared ? `${r.timeSec}초 · ${r.kills}마리 처치${r.record ? ' · 최고 기록 갱신' : ''}` : `${r.reason === 'timeout' ? '시간 초과' : r.reason === 'forfeit' ? '중단' : '패배'} · ${r.kills}/${BALANCE.dungeon.killTarget}마리. 입장권은 사용되었고 광석 30%를 받았습니다.`),
      rewardTiles(tiles)), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => { m.close(); back(); app.setTab('dungeon'); } })] });
    return m;
  }
  if (r.kind === 'trial') {
    const m = openModal({ id: 'trialResult', title: r.win ? '교관 시련 통과' : '교관 시련 실패', dismissible: false, body: h('div', { dataset: { screen: 'quest' } },
      h('p', null, r.win ? '교관 분신을 꺾었습니다. 이제 서약의 길을 고를 수 있습니다.' : '증표와 재료는 소모되지 않았습니다. 언제든 다시 도전할 수 있습니다.')),
      actions: [button(r.win ? '분기 선택하기' : '확인', { cls: 'btn btn-primary', onClick: () => { m.close(); back(); if (r.win) openPromotion(app); } })] });
    return m;
  }
}

// ======================= S11 offline =======================
export function openOffline(app) {
  const g = app.game;
  const c = g.state.offlineSnapshot.pendingClaim || g.claim;
  if (!c || modalOpen('offline')) return;
  const nothing = c.reason === 'unverified' || c.reason === 'short' || (c.exp === 0 && c.gold === 0 && !c.items.length);
  const tiles = [];
  if (!nothing) {
    tiles.push({ icon: itemIcon(CURRENCY_ICONS.gold), value: '+' + fmt(c.gold), label: '골드' }, { icon: itemIcon(CURRENCY_ICONS.exp), value: '+' + fmt(c.exp), label: prog.isPromotionLocked(g.state) ? '경험치(보관)' : '경험치' });
    if (c.ore) tiles.push({ icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + c.ore, label: '강화 광석' });
    const by = c.items.reduce((m2, it) => ((m2[it.rarity] = (m2[it.rarity] || 0) + 1), m2), {});
    for (const [r, n] of Object.entries(by)) tiles.push({ icon: itemIcon(r === 'rare' ? 'I02' : r === 'uncommon' ? 'I01' : 'I00'), value: `${n}개`, label: `${RARITY[r].name} 장비` });
  }
  const farm = c.farm ? `${REGION_BY_ID[c.farm.region].name} 웨이브 ${c.farm.wave} · 분당 ${fmt(c.farm.killsPerSec * 60)}마리` : '—';
  const body = h('div', { dataset: { screen: 'offline' } },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, img(portrait('serin_face'), '', 'face'), h('p', { style: { margin: 0 } }, nothing ? '기다리고 있었어요.' : '돌아오셨군요. 그동안 길을 지켜두었어요.')),
    h('h3', { style: { fontSize: '18px', margin: '8px 0 0' } }, `${fmtDuration(c.elapsedSec)}의 여정`),
    nothing ? h('p', { class: 'muted' }, c.reason === 'unverified' ? '아직 검증된 사냥터가 없어 방치 보상이 없습니다. 같은 웨이브에서 10마리씩 3번 쓰러지지 않고 사냥하면 그 사냥터가 방치 기준이 됩니다.' : `${BALANCE.offline.minSeconds}초 미만은 정산하지 않습니다.`)
      : rewardTiles(tiles),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '실제 경과', h('b', null, fmtDuration(c.elapsedSec))),
      h('div', { class: 'kv' }, '적용 시간', h('b', null, `${fmtDuration(c.appliedSec)} (최대 12시간)`)),
      c.lostSec ? h('div', { class: 'kv' }, '상한 초과(미지급)', h('b', null, fmtDuration(c.lostSec))) : null,
      h('div', { class: 'kv' }, '기준 사냥터', h('b', null, farm)),
      h('div', { class: 'kv' }, '효율', h('b', null, `${Math.round(c.efficiency * 100)}% · ×1 기준`)),
      c.convertedItems ? h('div', { class: 'kv' }, `장비 ${BALANCE.offline.maxEquipmentItems}개 초과분`, h('b', null, `${c.convertedItems}개 → 광석 ${c.convertedItems}`)) : null,
      c.diag.includes('clock-rollback') ? h('p', { class: 'warn' }, '기기 시계가 이전 접속보다 과거로 되돌아가 있어 경과 시간을 0으로 처리했습니다.') : null,
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '기본 보상만 지급: 경험치·골드·광석·희귀 이하 장비. 입장권·증표·보석은 없습니다. ×2·버프 제외. 광고 +25%는 후속 시안입니다.')));
  const m = openModal({ id: 'offline', title: '돌아오셨군요', dismissible: false, body, actions: [
    button(nothing ? '계속하기' : '보상 받기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = await g.claimOffline();
      if (!r.ok && r.reason !== 'duplicate') { fail(r); return; }  // save failed: modal stays, nothing granted
      m.close();
      if (!nothing && r.ok) {
        if (app.state.settings.sound) sfx('bell');
        const got = [];
        if (r.items && r.items.length) got.push(`장비 ${r.items.length}개`);
        if (r.overflowed && r.overflowed.length) toast(`보관함이 가득 차 ${r.overflowed.length}개를 임시 보관함에 두었습니다.`, 'error', 4000);
        toast(`방치 보상을 받았습니다${got.length ? ' · ' + got.join(', ') : ''}`, 'good');
      }
      app.applyView();
      app.showDailyPopups();
    } }),
    h('p', { class: 'muted', style: { margin: 0 } }, '받기 처리 중에는 버튼이 잠깁니다. 저장에 실패하면 지급하지 않고 다시 시도할 수 있습니다.')] });
  // spec 08 timing: dim 0–150, panel 150–350, items 350–650; reduced motion: fade only
  if (reduce(app)) body.querySelectorAll('.reward').forEach((e) => { e.style.animation = 'none'; e.style.opacity = 1; e.style.transform = 'none'; });
}

// ======================= S13 quest (promotion prep) =======================
export function openQuest(app) {
  const render = () => {
    const s = app.state;
    const cl = prog.promotionChecklist(s);
    const body = h('div', { dataset: { screen: 'quest' } },
      h('h3', { style: { fontSize: '18px', margin: '0 0 4px' } }, '별의 시험'),
      cl.items.map((it) => h('div', { class: 'check' + (it.ok ? ' ok' : '') },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, it.ok ? icon('check', 18) : ''),
        h('div', { class: 'c' }, h('b', null, it.label + (it.ok ? ' · 완료' : '')), it.hint ? h('span', { class: 'muted' }, it.hint) : null),
        h('span', { class: 'p' }, it.progress),
        !it.ok && it.go && it.id !== 'trial' ? button('바로 가기', { cls: 'btn go', onClick: () => go(app, it.go) }) : null)),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('div', { class: 'kv' }, '보관 경험치', h('b', null, fmtFull(s.player.pendingExp))),
        h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `Lv ${BALANCE.promotionLevel}부터 새 경험치는 보관되고, 승급 완료 후 순서대로 적용됩니다 (최대 Lv ${BALANCE.levelCap}). 시련에 실패해도 증표는 소모되지 않습니다.`)),
      h('p', { class: 'muted' }, '교관 분신은 세린의 훈련 동작을 은색으로 투영한 연습 상대입니다. 자동 전투만으로도 통과할 수 있고, 스킬을 직접 눌러 개입할 수도 있습니다.'));
    m.setBody(body);
    m.setActions([
      cl.canChoose ? button('분기 선택하기', { cls: 'btn btn-primary', onClick: () => { m.close(); openPromotion(app); } })
        : button(cl.canTrial ? '교관 시련 시작 (자동 전투)' : s.player.branch ? '승급 완료' : '조건을 먼저 채우세요', { cls: 'btn btn-primary', disabled: !cl.canTrial || app.game.mode !== 'FARM', onClick: () => { const r = app.game.startTrial(); if (!r.ok) return fail(r); m.close(); } })]);
  };
  const m = openModal({ id: 'quest', title: '승급 준비', body: h('div'), actions: [] });
  render();
}

// ======================= S12 promotion select =======================
export function openPromotion(app) {
  const s = app.state;
  const switching = !!s.player.branch;
  let pick = s.player.branch || null;
  const meta = spriteMeta().portraits;
  const render = () => {
    const fig = (id) => {
      const b = BRANCHES[id];
      const f = h('figure', { class: pick === id ? 'pick' : '' }, img(meta['promo_' + id].file, b.name), h('figcaption', null, h('b', null, b.name), h('span', { class: 'muted' }, b.role)));
      f.addEventListener('click', () => { pick = id; render(); });
      return f;
    };
    const sk = pick ? SKILLS[pick === 'knight' ? 'guardCounter' : 'berserkStrike'] : null;
    m.setBody(h('div', { dataset: { screen: 'promotion' } },
      h('div', { class: 'hero-art' }, fig('knight'), fig('berserker')),
      h('div', { class: 'btn-row', style: { margin: '8px 0' } }, ['knight', 'berserker'].map((id) => button(BRANCHES[id].name, { cls: 'btn' + (pick === id ? ' btn-gold' : ''), onClick: () => { pick = id; render(); } }))),
      pick ? h('div', { class: 'card' }, h('h3', null, BRANCHES[pick].name), h('p', { class: 'small', style: { margin: '0 0 6px' } }, BRANCHES[pick].desc),
        h('div', { class: 'kv' }, '무기', h('b', null, BRANCHES[pick].weapon)),
        h('div', { class: 'kv' }, '분기 능력', h('b', null, pick === 'knight' ? '체력 +15% · 방어력 +15%' : '공격력 +12%')),
        h('div', { class: 'kv' }, '신규 스킬', h('b', null, sk.name)), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, sk.desc)) : h('p', { class: 'muted' }, '두 갈래 중 하나를 고르세요. 얼굴·나이·머리색은 같고 무기·갑옷·자세가 바뀝니다.'),
      h('p', { class: 'muted' }, switching ? '분기 재전환은 MVP 개발 설정에서만 허용됩니다.' : '최초 1회 선택은 무료입니다. 레벨·장비·퀘스트는 유지되고 분기 스킬만 바뀝니다. 증표 20개는 확정 시에만 소모됩니다.'),
      h('p', { class: 'muted' }, '현재 전투 그림은 분기별 전신 원화 1장에 움직임 효과를 준 상태이며, 분기 전용 연속 전투 프레임은 후속 제작 대상입니다.')));
    const dev = app.state.settings.devTools;
    m.setActions([button(pick ? (switching ? `${BRANCHES[pick].name}로 재전환 (개발)` : `${BRANCHES[pick].name}로 각성`) : '분기를 선택하세요', { cls: 'btn btn-primary', disabled: !pick || (switching && (!dev || pick === s.player.branch)), onClick: () => confirmPromotion(app, pick, switching, m) })]);
  };
  const m = openModal({ id: 'promotion', title: switching ? '서약 분기' : '승급 선택', body: h('div'), actions: [] });
  render();
}
function confirmPromotion(app, branch, switching, parent) {
  const b = BRANCHES[branch];
  const c = openModal({ id: 'promoConfirm', title: '최종 확인', kind: 'center', body: h('p', null, `${b.name}(으)로 ${switching ? '재전환' : '각성'}합니다. ${switching ? '' : '시련의 증표 20개를 사용하고, 보관 경험치가 순서대로 적용됩니다.'}`),
    actions: [button('확정', { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = fail(await app.game.choosePromotion(branch, { dev: switching }));
      if (!r.ok) return;
      c.close(); parent.close();
      playPromotion(app, branch, r);
    } }), button('취소', { cls: 'btn', onClick: () => c.close() })] });
}
// spec 08: 0–400 current, 400–900 crest, 900–1400 new silhouette, 1400–2200 name/skill/rewards
function playPromotion(app, branch, r) {
  const meta = spriteMeta();
  const fast = reduce(app);
  const cur = img(meta.hero.idle.file, '세린', '');
  const nxt = img(meta.portraits['promo_' + branch].file, BRANCHES[branch].name, '');
  [cur, nxt].forEach((e) => Object.assign(e.style, { position: 'absolute', left: '50%', top: 0, height: '100%', transform: 'translateX(-50%)', transition: `opacity ${fast ? 150 : 500}ms` }));
  nxt.style.opacity = 0;
  const stage = h('div', { style: { position: 'relative', height: '300px' } }, cur, nxt);
  const info = h('div', { style: { opacity: 0, transition: 'opacity 300ms' } },
    h('h3', { style: { fontSize: '18px', margin: '8px 0 0', textAlign: 'center' } }, BRANCHES[branch].name),
    h('p', { style: { textAlign: 'center' } }, `신규 스킬 ${SKILLS[branch === 'knight' ? 'guardCounter' : 'berserkStrike'].name} · 4번 슬롯 해금`),
    r.exp && r.exp.amount ? h('p', { class: 'muted', style: { textAlign: 'center' } }, `보관 경험치 ${fmtFull(r.exp.amount)} 적용 · ${r.exp.levels}레벨 상승${r.exp.discarded ? ` · Lv ${BALANCE.levelCap} 초과분 ${fmtFull(r.exp.discarded)}은 MVP에서 적립되지 않음` : ''}`) : null);
  const m = openModal({ id: 'promoPlay', title: '서약 각성', dismissible: false, body: h('div', null, stage, info), actions: [button('계속', { cls: 'btn btn-primary', onClick: () => m.close() })] });
  if (app.state.settings.sound) sfx('rise');
  setTimeout(() => { cur.style.opacity = 0; nxt.style.opacity = 1; }, fast ? 0 : 900);
  setTimeout(() => { info.style.opacity = 1; if (!fast) app.renderer.kick(3, 100); }, fast ? 400 : 1400);
}

// ======================= S17 settings =======================
export function openSettings(app) {
  const render = () => {
    const s = app.state;
    const toggle = (key, label, after) => h('label', { class: 'switch-row' }, h('span', null, label), h('input', { type: 'checkbox', checked: !!s.settings[key], onChange: async (e) => { const r = fail(await app.game.setSetting(key, e.target.checked)); if (r.ok && after) after(e.target.checked); render(); } }));
    const fsMode = FS.mode();
    const body = h('div', { dataset: { screen: 'settings' } },
      h('h3', null, '화면'),
      fsMode === 'standalone' ? h('p', { class: 'muted' }, '홈 화면 앱으로 실행 중이라 이미 전체 화면이에요.')
        : fsMode === 'api' ? h('div', null,
          h('label', { class: 'switch-row' }, h('span', null, '시작할 때 전체 화면'), h('input', { type: 'checkbox', checked: FS.autoPref(), onChange: (e) => FS.setAutoPref(e.target.checked) })),
          button(FS.isFull() ? '전체 화면 끄기' : '지금 전체 화면으로', { cls: 'btn', onClick: async () => { if (FS.isFull()) await FS.exit(); else await FS.enter(); render(); } }))
        : button('전체 화면으로 쓰는 법 (아이폰)', { cls: 'btn', onClick: () => openFullscreenGuide() }),
      h('h3', null, '접근성'),
      toggle('reduceMotion', '움직임 줄이기 (흔들림·줌·섬광 제거)', () => app.applyA11y()),
      toggle('shake', '화면 흔들림'),
      h('div', { class: 'setting-block' }, h('span', null, '피해 숫자'), h('div', { class: 'seg', role: 'group', 'aria-label': '피해 숫자' }, [['all', '전부'], ['crit', '치명·피격만'], ['off', '끔']].map(([k, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(s.settings.damageNumbers === k), onClick: async () => { fail(await app.game.setSetting('damageNumbers', k)); render(); } }, l)))),
      h('h3', null, '오디오'),
      toggle('sound', '효과음 (합성 임시음)', (on) => { if (on) { enableAudio(s.settings.volume); sfx('bell'); } }),
      h('label', { class: 'field', for: 'vol' }, '음량'),
      h('input', { id: 'vol', type: 'range', min: 0, max: 1, step: 0.1, value: s.settings.volume, style: { width: '100%' }, onChange: async (e) => { setVolume(Number(e.target.value)); fail(await app.game.setSetting('volume', Number(e.target.value))); } }),
      h('h3', null, '저장'),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, '저장 위치', h('b', null, app.saver.kind === 'indexeddb' ? 'IndexedDB (이 브라우저)' : app.saver.kind === 'localStorage' ? 'localStorage (용량 작음)' : '메모리 (저장 안 됨)')),
        h('div', { class: 'kv' }, '마지막 저장', h('b', null, app.game.saveStatus.at ? new Date(app.game.saveStatus.at).toLocaleTimeString('ko-KR') : '—')),
        h('div', { class: 'kv' }, '저장 버전', h('b', null, `schema ${s.schemaVersion} · ${s.balanceVersion} · rev ${s.revision}`)),
        h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '이 기기 브라우저에만 저장됩니다. 다른 기기로 옮기려면 내보내기 파일을 사용하세요. 로컬 저장은 개발 도구로 수정할 수 있어 치트를 막지 못합니다.')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        button('저장 파일 내보내기', { cls: 'btn', onClick: () => downloadExport(app) }),
        button('저장 파일 가져오기', { cls: 'btn', onClick: () => openImport(app) }),
        button('데이터 초기화', { cls: 'btn btn-danger', onClick: () => openReset(app) })),
      h('details', { class: 'card', style: { marginTop: '10px' } }, h('summary', null, '개발 설정 (QA용)'),
        toggle('devTools', '개발 도구 사용'),
        s.settings.devTools ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } },
          button('다음 저장 1회 실패 시뮬레이션', { cls: 'btn', onClick: () => { app.saver.failNext = 1; toast('다음 저장이 실패합니다.', 'info'); } }),
          button('가속 세이브 불러오기 (Lv 29, 폐광 W10)', { cls: 'btn', busy: true, onClick: async () => { await loadDevSave(app, 'promo'); m.close(); } }),
          button('가속 세이브: 첫 보스 직전', { cls: 'btn', busy: true, onClick: async () => { await loadDevSave(app, 'boss1'); m.close(); } }),
          button('방치 정산 테스트: 마지막 접속을 13시간 전으로', { cls: 'btn', busy: true, onClick: async () => { await devOffline(app, 13 * 3600); m.close(); } }),
          button('입장권 날짜를 하루 전으로 (충전 테스트)', { cls: 'btn', busy: true, onClick: async () => { await app.game.transact('dev', (st) => { st.dungeon.lastDay -= 1; return { ok: true }; }); app.game.transact('dev2', (st) => ({ ok: true })); toast('다음 실행 때 입장권이 충전됩니다. 새로고침하세요.', 'info'); } }),
          h('p', { class: 'muted' }, '개발 설정은 저장 데이터를 바꿉니다. 테스트 전 내보내기를 권장합니다.')) : null));
    m.setBody(body);
  };
  const m = openModal({ id: 'settings', title: '환경 설정', body: h('div') });
  render();
}

export function downloadExport(app) {
  const text = app.game.exportJson();
  const blob = new Blob([text], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `asteria-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('저장 파일을 내보냈습니다.', 'good');
}

function openImport(app) {
  const ta = h('textarea', { class: 'io', 'aria-label': '저장 파일 내용', placeholder: '내보낸 JSON 내용을 붙여넣거나 파일을 선택하세요.' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': '저장 파일 선택', onChange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });
  const err = h('p', { class: 'warn', role: 'alert' });
  const m = openModal({ id: 'import', title: '저장 파일 가져오기', body: h('div', null, file, ta, err), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => {
    const r = parseExport(ta.value.trim());
    if (!r.ok) { err.textContent = r.error; return; }
    const st = r.state;
    const c = openModal({ id: 'importConfirm', title: '덮어쓰기 확인', kind: 'center', alert: true,
      body: h('div', null, h('p', null, '현재 진행을 아래 저장으로 덮어씁니다. 되돌리려면 먼저 현재 데이터를 내보내세요.'),
        h('div', { class: 'card' }, h('div', { class: 'kv' }, '가져올 저장', h('b', null, `Lv ${st.player.level} · ${REGION_BY_ID[st.progression.region].name} W${st.progression.wave}`)),
          h('div', { class: 'kv' }, '현재', h('b', null, `Lv ${app.state.player.level} · ${REGION_BY_ID[app.state.progression.region].name} W${app.state.progression.wave}`)),
          h('div', { class: 'kv' }, '내보낸 시각', h('b', null, r.exportedAt ? new Date(r.exportedAt).toLocaleString('ko-KR') : '알 수 없음')))),
      actions: [button('현재 데이터 먼저 내보내기', { cls: 'btn', onClick: () => downloadExport(app) }),
        button('덮어쓰기', { cls: 'btn btn-danger', busy: true, onClick: async () => { const res = fail(await app.game.importState(st)); if (res.ok) { closeAllModals(); toast('저장을 가져왔습니다.', 'good'); app.preload(); } } }),
        button('취소', { cls: 'btn', onClick: () => c.close() })] });
  } })] });
}

function openReset(app) {
  const input = h('input', { class: 'text', 'aria-label': '확인 문구 입력', placeholder: '초기화' });
  const m = openModal({ id: 'reset', title: '데이터 초기화', kind: 'center', alert: true, body: h('div', null,
    h('p', null, '모든 진행(레벨·장비·재화·승급)이 삭제되고 처음부터 시작합니다. 되돌릴 수 없습니다.'),
    button('먼저 현재 데이터 내보내기', { cls: 'btn', onClick: () => downloadExport(app) }),
    h('label', { class: 'field' }, '계속하려면 "초기화"를 입력하세요.'), input),
    actions: [button('초기화', { cls: 'btn btn-danger', busy: true, onClick: async () => {
      if (input.value.trim() !== '초기화') { toast('확인 문구가 일치하지 않습니다.', 'error'); return; }
      const r = fail(await app.game.resetGame());
      if (r.ok) { closeAllModals(); toast('새로 시작합니다.', 'info'); }
    } }), button('취소', { cls: 'btn', onClick: () => m.close() })] });
}

// ======================= S18 save error =======================
export function openSaveError(app, e) {
  if (modalOpen('saveerror') || e.reason === 'interval') return;
  if (e.conflict) return;   // conflict screen handles it
  openModal({ id: 'saveerror', title: '저장하지 못했습니다', alert: true, body: h('div', { dataset: { screen: 'saveerror' } },
    h('p', null, e.reason === 'offlineClaim' ? '방치 보상을 저장하지 못해 지급하지 않았습니다. 보상은 그대로 남아 있습니다.' : '방금 한 행동을 저장하지 못해 취소했습니다. 재화는 차감되지 않았습니다.'),
    h('p', { class: 'muted' }, `원인: ${e.error || '알 수 없음'} · 저장 공간이 부족하거나 브라우저가 저장을 막았을 수 있습니다.`)),
    actions: [button('다시 저장', { cls: 'btn btn-primary', busy: true, onClick: async () => { await app.game.checkpoint('retry'); if (app.game.saveStatus.ok) { closeAllModals(); toast('저장되었습니다.', 'good'); } } }),
      button('저장 파일 내보내기', { cls: 'btn', onClick: () => downloadExport(app) })] });
}

// ======================= S21 summon (expansion, disabled) =======================
export function openSummon(app) {
  openModal({ id: 'summon', title: '장비 소환 · 확장', body: h('div', { dataset: { screen: 'summon' } },
    h('p', null, '별의 유산(장비 소환)은 확장 시안입니다. 이번 MVP에서는 동작하지 않으며 보석·결제·광고도 없습니다.'),
    h('div', { class: 'card' }, h('h3', null, '확장 시 적용할 규칙'),
      h('div', { class: 'kv' }, '11회 묶음', h('b', null, '결과 4열 · NEW · 중복 처리 내역')),
      h('div', { class: 'kv' }, '천장', h('b', null, '테스트 예시 200 (확정 아님)')),
      h('div', { class: 'kv' }, '자동 소환', h('b', null, '예산 상한 · 횟수 · 전설 이상 정지')),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '확률표·가격은 서버 상품 정의 후 확정합니다. 캐릭터 소환이 아니라 장비 소환입니다.')),
    button('MVP 비활성', { cls: 'btn', disabled: true })) });
}

// ======================= S22 conflict =======================
export function openConflict(app) {
  if (modalOpen('conflict')) return;
  openModal({ id: 'conflict', title: '다른 탭에서 실행 중', dismissible: false, alert: true, body: h('div', { dataset: { screen: 'conflict' } },
    h('p', null, '아스테리아가 다른 탭이나 창에서 실행 중이라 이 탭의 전투와 재화 변경을 멈췄습니다. 중복 저장을 막기 위한 조치입니다.'),
    h('p', { class: 'muted' }, '이 탭에서 계속하면 다른 탭은 멈추고, 저장된 최신 진행을 다시 불러옵니다.')),
    actions: [button('이 탭에서 계속', { cls: 'btn btn-primary', busy: true, onClick: async () => { await app.onTakeover(); } })] });
}

// ======================= help =======================
function openHelp(app) {
  openModal({ id: 'help', title: '도움말', body: h('div', null,
    h('h3', null, '배속 ×2'), h('p', { class: 'small' }, '전경 전투만 2배속이 됩니다. 쿨타임·적 공격·등장도 함께 빨라집니다. 방치 보상은 항상 ×1 기준이며 ×2·버프를 포함하지 않습니다.'),
    h('h3', null, '방치 보상'), h('p', { class: 'small' }, `같은 웨이브에서 10마리씩 3번 연속(최소 60초) 쓰러지지 않고 사냥하면 그 사냥터가 방치 기준이 됩니다. 보상 = 측정 수익률 × 경과 시간(최대 12시간) × 75%. 방식: ${RATE_METHOD}.`),
    h('h3', null, '저장'), h('p', { class: 'small' }, '중요한 소비·보상은 저장이 확정된 뒤에만 반영되고 연출됩니다. 20초마다, 탭을 숨길 때, 주요 보상 직후 자동 저장합니다. 이 브라우저에만 저장되므로 기기 이동은 내보내기 파일로 합니다.'),
    h('h3', null, '서약 각성'), h('p', { class: 'small' }, `Lv ${BALANCE.promotionLevel} · 시련의 증표 20 · 폐광 파수꾼 처치 · 교관 시련. Lv ${BALANCE.promotion.tokenFromLevel}부터 Lv ${BALANCE.promotion.eligibleEnemyLevel}+ 적 5마리마다 증표 1개.`)) });
}

// ======================= dev saves (QA) =======================
async function loadDevSave(app, kind) {
  const { newGame } = await import('../core/state.js');
  const st = newGame(Date.now());
  st.settings = { ...app.state.settings };
  st.progression.firsts = { firstUpgrade: 1, firstEquip: 1 };
  if (kind === 'boss1') {
    st.player.level = 5; st.wallet.gold = 400; st.progression.wave = 10; st.progression.maxWave.meadow = 10;
    st.player.statsUpgrades = { atk: 8, hp: 6, def: 3, crit: 0, speed: 0 };
  } else {
    st.player.level = 29; st.player.exp = 0; st.wallet.gold = 5000; st.wallet.ore = 300; st.wallet.token = 18;
    st.player.statsUpgrades = { atk: 70, hp: 60, def: 30, crit: 20, speed: 25 };
    st.progression.unlockedRegions = ['meadow', 'desert', 'mine'];
    st.progression.bossCleared = { B01: true, B02: true };
    st.progression.firstClearClaimed = { B01: 'dev', B02: 'dev' };
    st.progression.maxWave = { meadow: 10, desert: 10, mine: 10 };
    st.progression.region = 'mine'; st.progression.wave = 10;
    st.dungeon.best = 6;
    const { makeItem } = await import('../core/items.js');
    const { makeRng } = await import('../core/util.js');
    const rng = makeRng(7);
    for (const slot of ['weapon', 'helmet', 'armor', 'accessory']) { const it = makeItem(st, { slot, rarity: 'rare', level: 28, rng, source: 'dev' }); it.enhance = 6; st.inventory.push(it); st.equipped[slot] = it.id; }
  }
  st.offlineSnapshot.lastActiveAt = Date.now();
  const r = fail(await app.game.importState(st));
  if (r.ok) { toast('가속 세이브를 불러왔습니다. (개발용)', 'info'); app.preload(); }
}
async function devOffline(app, sec) {
  await app.game.transact('devOffline', (s) => { s.offlineSnapshot.lastActiveAt = Date.now() - sec * 1000; return { ok: true }; });
  // commit sets lastActiveAt = now, so set it again directly on live state then simulate a return
  app.game.state.offlineSnapshot.lastActiveAt = Date.now() - sec * 1000;
  app.game.onVisible();
}


// ======================= rewards: attendance / return / profile =======================
const REWARD_INFO = {
  gold: { icon: CURRENCY_ICONS.gold, name: '골드' }, gem: { icon: CURRENCY_ICONS.gem, name: '보석' }, ore: { icon: CURRENCY_ICONS.ore, name: '강화 광석' },
  ticket: { icon: CURRENCY_ICONS.ticket, name: '입장권' }, eqTicket: { icon: CURRENCY_ICONS.chest, name: '장비 뽑기권' }, skTicket: { icon: CURRENCY_ICONS.goldChest, name: '스킬 뽑기권' },
};
export const rewardName = (k) => (REWARD_INFO[k] ? REWARD_INFO[k].name : k);
function rewardList(rw) { return Object.entries(rw).filter(([, v]) => v).map(([k, v]) => ({ icon: itemIcon(REWARD_INFO[k].icon), value: '+' + fmt(v), label: REWARD_INFO[k].name })); }
function rewardText(rw) { return Object.entries(rw).filter(([, v]) => v).map(([k, v]) => `${REWARD_INFO[k].name} +${fmt(v)}`).join(' · '); }

export function openAttendance(app, { auto = false } = {}) {
  const g = app.game;
  const st = attendanceStatus(g.state, Date.now());
  if (auto && !st.canClaim) return null;
  const lv = g.state.player.level;
  const grid = h('div', { class: 'att-grid', role: 'list' });
  ATTENDANCE.forEach((r, i) => {
    const got = i < (st.count % ATTENDANCE.length) || (st.count > 0 && st.count % ATTENDANCE.length === 0 && st.claimedToday);
    const today = i === st.index && st.canClaim;
    const rw = resolveReward(r, lv);
    const k = Object.keys(rw)[0];
    grid.appendChild(h('div', { class: 'att' + (got ? ' got' : '') + (today ? ' today' : '') + (r.big ? ' big' : ''), role: 'listitem', 'aria-label': `${i + 1}일차 ${rewardText(rw)}${got ? ' 받음' : today ? ' 오늘' : ''}` },
      h('span', { class: 'd' }, `${i + 1}일`), img(itemIcon(REWARD_INFO[k].icon), ''), h('b', null, fmt(rw[k])), Object.keys(rw).length > 1 ? h('span', { class: 'more' }, '+' + (Object.keys(rw).length - 1)) : null,
      got ? h('span', { class: 'stamp', 'aria-hidden': 'true' }, '✓') : null));
  });
  const todayRw = resolveReward(ATTENDANCE[st.index], lv);
  const body = h('div', { dataset: { screen: 'attendance' } },
    h('p', { class: 'modal-desc' }, `누적 출석 ${st.count}일 · ${st.cycle}회차. 빠진 날이 있어도 이어서 받을 수 있어요. 매일 00:00(한국 시간)에 바뀝니다.`),
    grid,
    st.rolledBack ? h('p', { class: 'warn' }, '기기 시계가 마지막 출석보다 과거라 오늘은 받을 수 없어요.') : null,
    st.canClaim ? h('div', { class: 'card' }, h('div', { class: 'kv' }, `오늘 (${st.index + 1}일차)`, h('b', null, rewardText(todayRw)))) : h('p', { class: 'muted' }, '오늘 출석 보상을 받았어요. 내일 다시 와 주세요.'));
  const m = openModal({ id: 'attendance', title: '출석 보상', body, actions: [
    st.canClaim ? button('오늘 보상 받기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = fail(await g.claimAttendance());
      if (!r.ok) return;
      if (app.state.settings.sound) sfx('bell');
      m.close();
      showGrant(app, `${r.day}일차 출석 보상`, r.reward, () => app.showDailyPopups());
    } }) : button('닫기', { cls: 'btn', onClick: () => m.close() })] });
  return m;
}

export function openReturnBonus(app) {
  const g = app.game;
  const p = g.state.returnBonus.pending;
  if (!p || modalOpen('return')) return null;
  const body = h('div', { dataset: { screen: 'return' } },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, img(portrait('serin_face'), '', 'face'),
      h('p', { style: { margin: 0 } }, `${p.days}일 만이에요. 다시 와 줘서 고마워요. 준비해 둔 게 있어요.`)),
    rewardTiles(rewardList(p.reward)),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '복귀 가속', h('b', null, `${p.boostHours}시간 동안 사냥 EXP·골드 ×${RETURN_BONUS.boost.exp}`)),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, `${RETURN_BONUS.minDays}일 이상 접속하지 않으면 한 번 받을 수 있어요. 오래 쉴수록 커집니다(3·7·14일). 방치 정산에는 가속이 적용되지 않아요.`)));
  const m = openModal({ id: 'return', title: '복귀 보상', dismissible: false, body, actions: [
    button('복귀 보상 받기', { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = fail(await g.claimReturn());
      if (!r.ok) return;
      if (app.state.settings.sound) sfx('bell');
      m.close();
      toast(`복귀 가속 시작 · ${r.boostHours}시간 EXP·골드 ×${RETURN_BONUS.boost.exp}`, 'good', 3500);
      app.showDailyPopups();
    } })] });
  if (reduce(app)) body.querySelectorAll('.reward').forEach((e) => { e.style.animation = 'none'; e.style.opacity = 1; e.style.transform = 'none'; });
  return m;
}

// Plays after the save is confirmed (callers only reach here on r.ok).
function showGrant(app, title, rw, after) {
  const body = h('div', { dataset: { screen: 'grant' } }, rewardTiles(rewardList(rw)));
  if (reduce(app)) body.querySelectorAll('.reward').forEach((e) => { e.style.animation = 'none'; e.style.opacity = 1; e.style.transform = 'none'; });
  const m = openModal({ id: 'grant', title, kind: 'center', body, onClose: () => after && after(), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => m.close() })] });
}

export function openProfile(app) {
  const g = app.game;
  const pid = globalThis.__asteria && globalThis.__asteria.profileId;
  const me = Profiles.get(pid);
  const nick = h('input', { class: 'text', type: 'text', maxlength: '10', value: g.state.profile.nickname || (me && me.nickname) || '', 'aria-label': '닉네임' });
  const err = h('p', { class: 'warn', 'aria-live': 'polite' });
  const st = playerStats(g.state);
  const body = h('div', { dataset: { screen: 'profile' } },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' } }, img(portrait('serin_face'), '', 'face'),
      h('div', null, h('b', { style: { fontSize: '20px' } }, g.state.profile.nickname || '모험가'), h('div', { class: 'muted' }, `게스트 · Lv ${g.state.player.level} · 전투력 ${fmt(powerRating(st))}`))),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '보석', h('b', null, fmt(g.state.wallet.gem))),
      h('div', { class: 'kv' }, '장비 / 스킬 뽑기권', h('b', null, `${g.state.wallet.eqTicket} / ${g.state.wallet.skTicket}`)),
      h('div', { class: 'kv' }, '누적 출석', h('b', null, `${g.state.attendance.count}일`)),
      boostActive(g.state, Date.now()) ? h('div', { class: 'kv' }, '복귀 가속', h('b', null, `${fmtDuration((g.state.returnBonus.boostUntil - Date.now()) / 1000)} 남음`)) : null,
      h('div', { class: 'kv' }, '시작한 날', h('b', null, new Date(g.state.createdAt).toLocaleDateString('ko-KR')))),
    h('label', { class: 'field' }, '닉네임 바꾸기'), nick, err,
    button('닉네임 저장', { cls: 'btn', busy: true, onClick: async () => {
      const v = nick.value.trim();
      const pr = Profiles.rename(pid, v);
      if (!pr.ok) { err.textContent = pr.reason; return; }
      const r = fail(await g.setNickname(v));
      if (r.ok) { err.textContent = ''; toast('닉네임을 바꿨어요.', 'good'); app.updateHud(true); }
    } }),
    h('p', { class: 'muted' }, '게스트 프로필은 이 기기 브라우저에만 저장됩니다. 다른 기기로 옮기려면 환경 설정 → 내보내기 파일을 쓰세요.'));
  const m = openModal({ id: 'profile', title: '프로필', body, actions: [
    button('프로필 바꾸기 (다른 게스트)', { cls: 'btn', onClick: () => {
      m.close();
      const cm = openModal({ id: 'switch', title: '프로필 바꾸기', kind: 'center', desc: '지금 진행은 저장된 상태로 남고, 시작 화면에서 다른 프로필을 고를 수 있어요.', actions: [
        button('시작 화면으로', { cls: 'btn btn-primary', busy: true, onClick: async () => { await g.checkpoint('switch'); location.href = location.pathname; } }),
        button('취소', { cls: 'btn', onClick: () => cm.close() })] });
    } }),
    button('환경 설정', { cls: 'btn', onClick: () => { m.close(); openSettings(app); } })] });
}


// iPhone Safari cannot make a page full screen; "홈 화면에 추가" opens it like an app.
export function openFullscreenGuide() {
  const step = (n, t) => h('div', { class: 'check' }, h('span', { class: 'mark' }, String(n)), h('div', { class: 'c' }, t));
  const m = openModal({ id: 'fsguide', title: '전체 화면으로 하기', body: h('div', { dataset: { screen: 'fsguide' } },
    h('p', { class: 'modal-desc' }, '아이폰 Safari는 웹페이지 전체 화면을 지원하지 않아요. 홈 화면에 추가하면 주소창 없이 앱처럼 열립니다.'),
    step(1, h('span', null, 'Safari 아래쪽 ', h('strong', null, '공유 버튼'), '(네모에서 화살표)을 눌러요.')),
    step(2, h('span', null, '목록에서 ', h('strong', null, '홈 화면에 추가'), '를 골라요.')),
    step(3, h('span', null, '오른쪽 위 ', h('strong', null, '추가'), '를 누르고, 홈 화면의 아스테리아 아이콘으로 실행해요.')),
    h('p', { class: 'muted' }, '홈 화면 앱은 Safari와 저장소가 따로라서, 처음 열면 새 프로필로 시작돼요. 기존 진행을 옮기려면 Safari에서 환경 설정 → 내보내기 → 홈 화면 앱에서 가져오기를 해 주세요.')),
    actions: [button('알겠어요', { cls: 'btn btn-primary', onClick: () => m.close() })] });
}
