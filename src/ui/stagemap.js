// 스테이지 지도 (v7): region background + winding path + 10 stage nodes + boss node.
// Opened from the 모험 tab and the region chip on the battle strip (replaces 지역 선택).
import { BALANCE } from '../data/balance.js';
import { BOSSES, REGIONS, REGION_BY_ID, MONSTERS, waveLevel } from '../data/content.js';
import * as prog from '../core/progression.js';
import * as ST from '../core/stages.js';
import * as DF from '../core/difficulty.js';
import { bgMeta, itemIcon, spriteMeta } from '../render/assets.js';
import { CURRENCY_ICONS } from '../data/content.js';
import { fmt } from '../core/util.js';
import { button, h, img, openModal, toast } from './dom.js';
import { openBoss } from './screens.js';

// Node positions in % of the map box, bottom → top (1..10, then boss).
const POS = [[15, 85], [39, 80], [63, 84], [85, 72], [63, 62], [37, 60], [15, 49], [32, 37], [58, 36], [83, 27], [60, 12]];
const NODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'boss'];

// Catmull-Rom through points → cubic Bézier path (viewBox 0..100).
function pathThrough(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
function rewardLine(rw) {
  return h('div', { class: 'stage-rw' }, [['gem', rw.gem], ['ore', rw.ore], ['gold', rw.gold]].filter(([, v]) => v > 0).map(([k, v]) =>
    h('span', { class: 'rw' }, img(itemIcon(CURRENCY_ICONS[k]), ''), h('b', null, fmt(v)))));
}

// Builds the map UI. `ui` keeps {region, sel} across rebuilds; `rerender` redraws;
// `close` runs after the player leaves (starts a hunt / opens the boss).
function buildStage(app, ui, rerender, close) {
  // a difficulty switch (chip, victory button, rebirth) re-centres the map on the new hunt
  const dNow = DF.curDiff(app.state);
  if (ui.diffFor && ui.diffFor !== dNow) { ui.region = null; ui.sel = null; }
  ui.diffFor = dNow;
  let region = ui.region || app.state.progression.region;
  let sel = ui.sel === undefined ? null : ui.sel;   // selected node (1..10 | 'boss'); null → current stage
  const render = () => { ui.region = region; ui.sel = sel; rerender(); };
  {
    const s = app.state;
    const p = s.progression;
    const r = REGION_BY_ID[region];
    const open = prog.regionUnlocked(s, r.id);
    const status = (n) => ST.nodeStatus(s, r.id, n, open);
    const current = NODES.find((n) => status(n) === 'current') || null;
    if (sel === null || (typeof sel === 'number' && sel > 10)) sel = (p.region === r.id ? p.wave : null) || current || (open ? 10 : 1);
    const d = DF.curDiff(s);
    const T = DF.track(s, d);
    const pre = DF.prefix(d);
    const stars = T.stars;
    // ---- difficulty chips (이지 · 노말 · 하드): picking one moves the hunt to its last stage
    const busyMode = app.game.mode !== 'FARM';
    const diffSeg = h('div', { class: 'seg diff-seg', role: 'tablist', 'aria-label': '난이도' }, DF.DIFF_IDS.map((x) => {
      const ok = DF.diffOpen(s, x);
      return h('button', { type: 'button', role: 'tab', class: `diff-chip d-${x}${ok ? '' : ' locked'}`, 'aria-pressed': String(x === d), 'aria-selected': String(x === d), dataset: { diff: x },
        'aria-label': `${DF.diffName(x)}${ok ? '' : ' 잠김 · ' + DF.lockText(x)}`,
        onClick: async () => {
          if (x === d) return;
          if (!ok) { toast(`${DF.diffName(x)} 잠김 · ${DF.lockText(x)}`, 'info'); return; }
          if (busyMode) { toast('전투가 끝난 뒤에 바꿀 수 있어요.', 'info'); return; }
          const res = await app.game.switchDifficulty(x);
          if (!res.ok) { toast(res.reason === 'busy' ? '잠시 후 다시 시도해 주세요.' : res.reason === 'level' ? `Lv ${res.need} 이상에서 들어갈 수 있어요.` : '난이도를 바꿀 수 없습니다.', 'error'); return; }
          toast(`${DF.diffName(x)} ${ST.stageLabel(res.region, res.wave)}에서 사냥합니다.`, 'info');
          region = null; sel = null; ui.region = null; ui.sel = null; rerender();
        } }, ok ? DF.diffName(x) : `🔒 ${DF.diffName(x)}`);
    }));
    const diffNote = !DF.enemyMul(d, r.id, 1) ? null : (() => {
      const m = DF.enemyMul(d, r.id, 1), mb = DF.enemyMul(d, r.id, 'boss');
      if (d === 'easy') return h('p', { class: 'muted small diff-note d-easy' }, `2막 · 적 Lv 100 · 이 지역 체력 ×${m.hp.toFixed(2)}–${mb.hp.toFixed(2)} · 공격 ×${m.atk.toFixed(2)}–${mb.atk.toFixed(2)}`);
      return h('p', { class: 'muted small diff-note d-' + d }, `${DF.diffName(d)} · 적 Lv ${DF.DIFFICULTY[d].level} · 이 지역 체력 ×${m.hp.toFixed(2)}–${mb.hp.toFixed(2)} · 공격 ×${m.atk.toFixed(2)}–${mb.atk.toFixed(2)} · 골드 ×${DF.DIFFICULTY[d].gold} · 첫 클리어 보상 ×${DF.firstClearMul(d)}`);
    })();
    // ---- header: auto-advance toggle
    const auto = s.stages.auto !== false;
    const head = h('div', { class: 'stage-head' },
      h('span', { class: 'muted' }, '다음 스테이지 자동 진행'),
      h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(auto), 'aria-label': '다음 스테이지 자동 진행', dataset: { act: 'stage-auto' },
        onClick: async () => { const res = await app.game.setStageAuto(!auto); if (!res.ok) toast('잠시 후 다시 시도해 주세요.', 'error'); render(); } }, h('i')));
    // ---- region tabs (all 10, with lock / stars)
    // v19: 1막(1~10) / 2막(11~20) 나눠 보기 — 지금 보는 지역의 막이 기본
    const act = (r.act || 1);
    const act2Open = prog.regionUnlocked(s, 'r11');
    const actSeg = h('div', { class: 'seg act-seg', role: 'tablist', 'aria-label': '막' }, [1, 2].map((k) => {
      const ok = k === 1 || act2Open;
      return h('button', { type: 'button', role: 'tab', class: 'act-chip' + (ok ? '' : ' locked'), 'aria-pressed': String(k === act), 'aria-selected': String(k === act), dataset: { act: 'act-' + k },
        onClick: () => {
          if (k === act) return;
          if (!ok) { toast(`2막은 ${DF.prefix(d)}${BOSSES.B10.name}을 쓰러뜨리면 열려요.`, 'info'); return; }
          const first = REGIONS.filter((x) => (x.act || 1) === k);
          const cur = first.filter((x) => prog.regionUnlocked(s, x.id));
          region = (cur[cur.length - 1] || first[0]).id; sel = null; render();
        } }, k === 1 ? '1막 · 별이 꺼진 밤' : ok ? '2막 · 성좌 원정' : '🔒 2막 · 성좌 원정');
    }));
    const tabs = h('div', { class: 'tabs stage-tabs', role: 'tablist', 'aria-label': '지역' }, REGIONS.filter((x) => (x.act || 1) === act).map((x) => {
      const ok = prog.regionUnlocked(s, x.id);
      const rs = ST.regionStars(s, x.id);
      return h('button', { type: 'button', class: 'tab' + (ok ? '' : ' locked'), role: 'tab', 'aria-selected': String(x.id === region), dataset: { region: x.id },
        'aria-label': `${x.order + 1}. ${x.name}${ok ? ` 별 ${rs.got}/${rs.max}` : ' 잠김'}`, onClick: () => { region = x.id; sel = null; render(); } },
        `${x.order + 1}. ${x.name}`, h('small', null, ok ? ` ★${rs.got}` : ' 🔒'));
    }));
    // ---- the map
    // GPT I map art (painted road) when present; otherwise battle bg + drawn trail
    const mapArt = (spriteMeta().maps || {})[r.id] || null;
    const pos = mapArt ? mapArt.nodes : POS;
    const bg = mapArt || bgMeta(r.bg);
    const map = h('div', { class: 'stage-map' + (mapArt ? ' art' : '') + (open ? '' : ' locked'), dataset: { screen: 'stagemap' }, style: bg ? { backgroundImage: `url(${bg.file})` } : {} });
    const svg = svgEl('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'stage-path', 'aria-hidden': 'true' });
    if (!mapArt) svg.append(svgEl('path', { d: pathThrough(POS), class: 'trail' }));
    const doneIdx = NODES.reduce((a, n, i) => (status(n) === 'cleared' ? i : a), -1);
    const reach = current ? NODES.indexOf(current) : doneIdx;
    if (reach > 0) svg.append(svgEl('path', { d: mapArt ? 'M' + mapArt.path.slice(0, mapArt.nodeIdx[reach] + 1).map((q) => q.join(',')).join(' L') : pathThrough(POS.slice(0, reach + 1)), class: 'trail-done' }));
    map.append(svg);
    const rs = ST.regionStars(s, r.id);
    map.append(h('div', { class: 'stage-title' }, h('b', null, `${pre}${r.order + 1}. ${r.name}`), h('span', null, `${d === 'easy' ? r.label : 'Lv ' + DF.DIFFICULTY[d].level} · ★ ${rs.got}/${rs.max}`)));
    NODES.forEach((n, i) => {
      const stt = status(n);
      const key = ST.stageKey(r.id, n);
      const got = stars[key] || 0;
      const here = p.region === r.id && p.wave === n;
      const boss = n === 'boss';
      const art = boss ? spriteMeta().bosses[r.boss] : null;
      const node = h('button', { type: 'button', class: `stage-node ${stt}${boss ? ' boss' : ''}${sel === n ? ' sel' : ''}${here ? ' here' : ''}`, dataset: { node: String(n), status: stt },
        style: { left: pos[i][0] + '%', top: pos[i][1] + '%' },
        'aria-label': `${ST.stageLabel(r.id, n)} ${{ cleared: '클리어', current: '진행 중', locked: '잠김' }[stt]}${got ? ` 별 ${got}개` : ''}${here ? ' · 사냥 중' : ''}`,
        'aria-pressed': String(sel === n), onClick: () => { sel = n; render(); } },
        boss && art ? img(art.file, '') : h('span', { class: 'n' }, stt === 'locked' ? '🔒' : String(n)),
        stt === 'cleared' ? h('span', { class: 'ck', 'aria-hidden': 'true' }, '✓') : null,
        h('span', { class: 'lb' }, boss ? '보스' : ST.stageLabel(r.id, n)),
        got ? h('span', { class: 'st', 'aria-hidden': 'true' }, starText(got)) : null);
      map.append(node);
    });
    if (!open) {
      const prev = REGIONS[r.order - 1];
      map.append(h('div', { class: 'stage-lock' }, h('b', null, '🔒 잠긴 지역'), h('span', null, prev ? `${pre}${BOSSES[prev.boss].name} 처치 시 열림` : '')));
    }
    // ---- node detail
    const n = sel;
    const stt = status(n);
    const key = ST.stageKey(r.id, n);
    const got = stars[key] || 0;
    const claimed = !!T.claimed[key];
    const boss = n === 'boss';
    const lv = boss ? DF.bossLevel(d, r.boss) : DF.farmLevel(d, r.id, n);
    const em = DF.enemyMul(d, r.id, n);
    const here = p.region === r.id && p.wave === n;
    let action;
    if (boss) {
      action = button(!open ? '잠긴 지역입니다' : stt === 'locked' ? `${r.order + 1}-10 도달 시 도전` : T.bossCleared[r.boss] ? '보스 재도전' : '보스 도전', { cls: 'btn btn-primary', disabled: stt === 'locked', dataset: { act: 'stage-go' },
        onClick: () => { close(); openBoss(app, r.boss); } });
    } else {
      action = button(!open ? '잠긴 지역입니다' : stt === 'locked' ? '이전 스테이지를 깨면 열립니다' : here ? '이 스테이지에서 사냥 중' : '여기서 사냥', { cls: 'btn btn-primary', disabled: stt === 'locked' || here, busy: true, dataset: { act: 'stage-go' },
        onClick: async () => {
          const res = await app.game.setFarm(r.id, n, s.stages.auto !== false);
          if (!res.ok) { toast(res.reason === 'busy' ? '잠시 후 다시 시도해 주세요.' : '이 스테이지로 갈 수 없습니다.', 'error'); return; }
          toast(`${pre}${ST.stageLabel(r.id, n)}에서 사냥합니다.${s.stages.auto === false ? ' (자동 진행 꺼짐)' : ''}`, 'info');
          close();
        } });
    }
    const detail = h('div', { class: 'card stage-detail', dataset: { detail: String(n) } },
      h('div', { class: 'stage-dh' }, h('b', null, `${pre}${ST.stageLabel(r.id, n)}${boss ? ' ' + BOSSES[r.boss].name : ''}`),
        h('span', { class: 'stage-badge ' + stt }, { cleared: '클리어', current: '진행 중', locked: '잠김' }[stt]), h('span', { class: 'spacer', style: { flex: 1 } }),
        h('span', { class: 'stars', 'aria-label': `별 ${got}개` }, starText(got))),
      h('div', { class: 'kv' }, '적', h('b', null, boss ? `Lv ${lv} 보스` : `Lv ${lv} · ${r.monsters.map((id) => MONSTERS[id] ? MONSTERS[id].name : id).join('·')}`)),
      em ? h('div', { class: 'kv' }, '강화 배율', h('b', { class: 'd-' + d }, `체력 ×${em.hp.toFixed(2)} · 공격 ×${em.atk.toFixed(2)}`)) : null,
      h('div', { class: 'kv' }, '별 조건', h('b', null, boss ? `★ 처치 · ★★ 처치 · ★★★ ${ST.starTimeSec('boss')}초 안에` : `★ ${BALANCE.combat.waveKillTarget}마리 · ★★ 사망 없이 · ★★★ ${ST.starTimeSec(n)}초 안에`)),
      h('div', { class: 'kv' }, '최초 클리어 보상', claimed ? h('b', { class: 'okc' }, '받음 ✓') : rewardLine(ST.stageReward(r.id, n, d))),
      action);
    ui.region = region; ui.sel = sel;
    // keep the tab strip scrolled to the selected region
    // region strip: centre the chosen region only when it changed; otherwise keep where the player scrolled it
    const recentre = ui.tabsFor !== region;
    ui.tabsFor = region;
    tabs.addEventListener('scroll', () => { ui.tabsLeft = tabs.scrollLeft; }, { passive: true });
    requestAnimationFrame(() => {
      if (!recentre && ui.tabsLeft != null) { tabs.scrollLeft = ui.tabsLeft; return; }
      const t = tabs.querySelector('[aria-selected="true"]'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    return h('div', { class: 'stage-wrap', dataset: { screen: 'world', diff: d } }, diffSeg, actSeg, diffNote, head, tabs, map, detail,
      h('p', { class: 'muted small', style: { margin: '6px 2px 0' } }, `스테이지 = 웨이브. 적 10마리를 처치하면 클리어입니다. 보스를 처치하면 다음 지역이 열립니다. 마지막 지역 보스(${BOSSES[DF.lastRegion().boss].name})를 처치하면 다음 난이도가 열립니다. 자동 진행을 끄면 고른 스테이지에서 계속 사냥합니다.`));
  }
}

// Modal version (kept for direct calls).
export function openStageMap(app, focus = null) {
  const ui = { region: focus || null, sel: null };
  const m = openModal({ id: 'world', title: '스테이지 지도', body: h('div'), kind: 'full' });
  const draw = () => m.setBody(buildStage(app, ui, draw, () => m.close()));
  draw();
  return m;
}

// What the map shows. The stage tab only rebuilds when this changes (not on every kill / gold tick).
export function stageSig(app) {
  const s = app.state;
  if (!s) return null;
  const p = s.progression, st = s.stages || {}, d = DF.curDiff(s), t = DF.track(s, d);
  return [d, DF.DIFF_IDS.map((x) => DF.diffOpen(s, x) ? 1 : 0).join(''), p.region, p.wave, app.game.mode, (t.unlockedRegions || []).join(), JSON.stringify(t.maxWave || {}), Object.keys(t.bossCleared || {}).length,
    JSON.stringify(t.stars || {}), Object.keys(t.claimed || {}).length, st.auto, p.autoAdvance, s.player.level >= 100 ? 100 : Math.floor(s.player.level / 10)].join('|');
}

// Bottom-tab version (선배 요청: 스테이지가 하단 첫 탭). Selection survives the
// once-a-second panel rebuild via app.stageUi.
export function stagePanel(app) {
  if (!app.stageUi) app.stageUi = { region: null, sel: null };
  const root = h('div', { class: 'panel', dataset: { screen: 'main' }, style: { height: '100%', margin: 0 } });
  root.appendChild(h('div', { class: 'panel-head' }, h('h2', null, '스테이지')));
  const sc = h('div', { class: 'panel-scroll stage-panel' });
  sc.appendChild(buildStage(app, app.stageUi, () => app.renderPanel(), () => app.setTab('battle')));   // 사냥 시작 → 전투 탭
  root.appendChild(sc);
  return root;
}
