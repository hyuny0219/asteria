// v5 screens: 특성 (talent trees), 환생 (rebirth), 균열 (rift). Grants go through
// game.transact; reveals start only after r.ok. Icons are placeholders keyed by id
// (TALENT_ICONS / V5_ICONS) until the emblem board arrives.
import { CURRENCY_ICONS, SKILLS } from '../data/content.js';
import { TALENT_ICONS, TALENT_NODES, TALENT_RULES, TALENT_TREES } from '../data/talents.js';
import { itemIcon, skillIcon } from '../render/assets.js';
import * as T from '../core/talents.js';
import * as RB from '../core/rebirth.js';
import * as RF from '../core/rift.js';
import { fmt, fmtFull, fmtPct } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { costChip, fail, rewardTiles } from './screens.js';

// placeholder icon ids (swap when the v5 emblem board lands)
// Interim per-tree icons (existing skill/rune icons) until tree emblems are drawn.
const TREE_ICON = TALENT_ICONS;   // GPT F emblems
// GPT F rift blessing emblems: R00 공격 · R01 방어 · R02 속도/치명 · R03 회복 · R04 시간/충전 · R05 회피
const BLESS_ICON = { b_atk: 'R00', b_atk2: 'R00', b_glass: 'R00', b_cdmg: 'R00', b_hp: 'R01', b_def: 'R01', b_guard: 'R01', b_thorns: 'R01',
  b_crit: 'R02', b_aspd: 'R02', b_combo: 'R02', b_berserk: 'R02', b_echo: 'R02', b_steal: 'R03', b_regen: 'R03', b_heal: 'R03',
  b_ult: 'R04', b_cdr: 'R04', b_greed: 'R04', b_evade: 'R05' };
export const V5_ICONS = Object.freeze({ talents: 'V00', rebirth: 'V01', rift: 'V02', blessing: 'V03', curse: 'V12', essence: 'V14' });
const ico = (id) => { try { return img(skillIcon(id), '', 'emblem'); } catch { return null; } };
const curIcon = (k) => img(itemIcon(CURRENCY_ICONS[k]), '');
const RNAME = { common: '일반', rare: '희귀', epic: '영웅' };

// ======================= 특성 =======================
export function openTalents(app, treeId = null) {
  const g = app.game;
  let m;
  let tree = treeId;
  const render = () => {
    const s = g.state;
    const trees = T.treesFor(s);
    tree = tree && trees.includes(tree) ? tree : (s.player.branch && trees.includes(s.player.branch) ? s.player.branch : trees[0]);
    if (!T.talentsOpen(s)) {
      const body = h('div', { dataset: { screen: 'talents' } }, h('p', { class: 'modal-desc' }, `1차 승급(Lv ${30}) 후에 열립니다. Lv ${TALENT_RULES.fromLevel}부터 레벨마다 1포인트, 시련의 탑 ${TALENT_RULES.perTowerFloors}층마다 1포인트를 얻어요.`));
      if (!m) m = openModal({ id: 'talents', title: '특성', body, actions: [button('닫기', { cls: 'btn', onClick: () => m.close() })] }); else m.setBody(body);
      return;
    }
    const t = s.talents;
    const free = T.pointsFree(s);
    const cost = T.respecCost(s, Date.now());
    const tabs = h('div', { class: 'seg tal-tabs', role: 'tablist', 'aria-label': '특성 트리' }, trees.map((id) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === tree), 'aria-pressed': String(id === tree), onClick: () => { tree = id; render(); } },
      img(skillIcon(TREE_ICON[id] || 'V00'), ''), `${TALENT_TREES[id].name} ${T.treeSpent(s, id)}`)));
    const presets = h('div', { class: 'seg', role: 'group', 'aria-label': '프리셋' }, [0, 1].map((i) => h('button', { type: 'button', 'aria-pressed': String(t.active === i), onClick: async () => { if (t.active !== i) { const r = fail(await g.talentPreset(i)); if (r.ok) render(); } } },
      i === 0 ? '사냥용' : '보스용')));
    const td = TALENT_TREES[tree];
    const rows = td.rows.map((row, r) => {
      const gateNeed = TALENT_RULES.rowGate * r;
      const above = Object.entries(t.presets[t.active]).reduce((a, [nid, rk]) => a + (TALENT_NODES[nid] && TALENT_NODES[nid].tree === tree && TALENT_NODES[nid].row < r ? rk : 0), 0);
      const open = above >= gateNeed;
      return h('div', { class: 'tal-row' + (open ? '' : ' locked') },
        h('span', { class: 'tal-gate' }, open ? `${r + 1}줄` : `${gateNeed - above}점 더`),
        row.map((nd) => {
          const rk = T.rankOf(s, nd.id);
          const can = T.canRank(s, nd.id).ok;
          return h('button', { type: 'button', class: 'tal-node' + (nd.capstone ? ' cap' : '') + (rk >= nd.max ? ' full' : '') + (rk ? ' on' : ''), dataset: { key: 'tal-' + nd.id },
            'aria-label': `${nd.name} ${rk}/${nd.max} · ${nd.desc}${can ? ' · 찍기' : ''}`, disabled: !can && rk === 0 && !open,
            onClick: async () => {
              if (!can) { toast(rk >= nd.max ? '최대 단계입니다' : free <= 0 ? '남은 특성 포인트가 없습니다' : `윗줄에 ${gateNeed}점을 먼저 써야 합니다`, 'info'); return; }
              const res = fail(await g.talentRank(nd.id));
              if (res.ok) { if (s.settings.sound) sfx('metal'); render(); }
            } },
            h('b', null, nd.name), h('span', { class: 'rk' }, `${rk}/${nd.max}`), h('span', { class: 'ds' }, nd.desc));
        }));
    });
    const body = h('div', { dataset: { screen: 'talents' } },
      h('div', { class: 'kv' }, '특성 포인트', h('b', null, `남음 ${free} / 총 ${T.pointsTotal(s)}`)),
      h('p', { class: 'muted', style: { margin: '0 0 6px' } }, `Lv ${TALENT_RULES.fromLevel}부터 레벨마다 1점(환생해도 유지) · 탑 ${TALENT_RULES.perTowerFloors}층마다 1점 · 환생마다 ${TALENT_RULES.perRebirth}점. 두 갈래 트리를 섞어 찍을 수 있어요.`),
      presets,
      h('label', { class: 'switch-row' }, h('span', null, '보스·레이드·탑·균열에서 보스용 자동 사용'), h('input', { type: 'checkbox', checked: !!t.autoSwitch, onChange: async (e) => { fail(await g.talentAutoSwitch(e.target.checked)); render(); } })),
      h('label', { class: 'switch-row' }, h('span', null, '추천대로 자동 찍기'), h('input', { type: 'checkbox', checked: !!t.auto, onChange: async (e) => { const r = fail(await g.talentAuto(e.target.checked)); if (r.ok && r.given) toast(`${r.given}점을 추천대로 찍었어요.`, 'good'); render(); } })),
      tabs,
      h('p', { class: 'small', style: { margin: '6px 0' } }, h('b', null, td.name), ` · ${td.theme}`),
      h('div', { class: 'tal-tree' }, rows));
    const actions = [
      button(cost ? '초기화' : '초기화 · 오늘 무료', { cls: 'btn' + (cost ? ' with-cost' : ''), disabled: T.pointsSpent(s) === 0 || (cost && s.wallet.gold < cost), onClick: () => {
        const cm = openModal({ id: 'talentRespec', title: '특성을 초기화할까요?', kind: 'center', desc: `${t.active === 0 ? '사냥용' : '보스용'} 프리셋의 특성 ${T.pointsSpent(s)}점을 모두 돌려받습니다. ${cost ? `골드 ${fmtFull(cost)}가 듭니다.` : '오늘 1회 무료입니다.'} 다른 프리셋은 그대로예요.`, actions: [
          button('초기화', { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await g.talentRespec()); if (r.ok) { cm.close(); render(); } } }),
          button('취소', { cls: 'btn', onClick: () => cm.close() })] });
      } }),
      button('닫기', { cls: 'btn', onClick: () => m.close() })];
    if (cost) actions[0].append(' ', costChip('gold', cost, s.wallet.gold < cost));
    if (!m) m = openModal({ id: 'talents', title: '특성', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= 환생 =======================
export function openRebirth(app) {
  const g = app.game;
  let m;
  const render = () => {
    const s = g.state;
    const pv = RB.preview(s);
    const rb = s.rebirth;
    const mul = RB.rebirthMultipliers(s);
    const ups = Object.entries(RB.REBIRTH.upgrades).map(([k, u]) => {
      const lv = rb.levels[k] || 0;
      const c = lv >= u.max ? null : RB.upgradeCost(k, lv);
      return h('div', { class: 'shop-item' },
        ico(V5_ICONS.rebirth),
        h('div', { class: 'si' }, h('b', null, `${u.name} Lv ${lv}`), h('span', { class: 'muted' }, `${u.desc} ×${mul[k].toFixed(2)} → ×${(mul[k] + u.per).toFixed(2)}`)),
        button(c === null ? '최대' : `정수 ${c}`, { cls: 'btn' + (c !== null && rb.essence >= c ? ' btn-primary' : ''), disabled: c === null || rb.essence < c, busy: true, onClick: async () => { const r = fail(await g.rebirthUpgrade(k)); if (r.ok) render(); } }));
    });
    const body = h('div', { dataset: { screen: 'rebirth' } },
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, '환생 횟수', h('b', null, `${rb.count}회`)),
        h('div', { class: 'kv' }, '환생 정수', h('b', null, `${fmtFull(rb.essence)} (누적 ${fmtFull(rb.totalEssence)})`)),
        h('div', { class: 'kv' }, '조건', h('b', null, pv.ok ? '초월 Lv 50 달성 · 환생 가능' : (s.player.tier || 0) < 4 ? '초월(4차 전직) 후 초월 Lv 50' : `초월 Lv 50 필요 (현재 초월 Lv ${s.player.ascLv || 0})`)),
        h('div', { class: 'kv' }, '이번 환생으로 얻는 정수', h('b', null, `${pv.essence} (기본 30 + 탑 최고층 ×0.5 + 환생 횟수 ×5)`))),
      h('div', { class: 'section-title' }, '영구 강화 (정수 사용)'),
      h('div', { class: 'shop-list' }, ups),
      h('div', { class: 'section-title' }, '환생하면'),
      h('div', { class: 'card' }, h('b', { class: 'warn' }, '초기화되는 것'), h('ul', { class: 'small', style: { margin: '4px 0 6px', paddingLeft: '18px' } }, pv.resets.map((x) => h('li', null, x))),
        h('b', { class: 'okc' }, '그대로 남는 것'), h('ul', { class: 'small', style: { margin: '4px 0 0', paddingLeft: '18px' } }, pv.keeps.map((x) => h('li', null, x)))));
    const actions = [
      button(pv.ok ? `환생하기 · 정수 +${pv.essence}` : '초월 Lv 50에 환생할 수 있어요', { cls: 'btn btn-primary', disabled: !pv.ok || g.mode !== 'FARM', onClick: () => {
        const cm = openModal({ id: 'rebirthConfirm', title: '정말 환생할까요?', kind: 'center',
          desc: `레벨이 1, 초월 레벨이 0이 되고 골드(${fmt(s.wallet.gold)})와 골드 자동 강화 단계가 사라집니다. 장비·승급 단계·스킬·특성·보석은 그대로이고, 환생 정수 ${pv.essence}를 얻습니다. 되돌릴 수 없어요.`,
          actions: [
            button('환생하기', { cls: 'btn btn-danger', busy: true, onClick: async () => {
              const r = fail(await g.doRebirth());
              if (!r.ok) return;
              cm.close(); m.close();
              if (s.settings.sound) sfx('bell');
              app.buildSkills(); app.updateHud(true); app.renderPanel();
              toast(`${r.count}번째 환생 · 환생 정수 +${r.essence}`, 'good', 3500);
            } }),
            button('취소', { cls: 'btn', onClick: () => cm.close() })] });
      } }),
      button('닫기', { cls: 'btn', onClick: () => m.close() })];
    if (!m) m = openModal({ id: 'rebirth', title: '환생', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= 균열 =======================
export function riftCard(app) {
  const s = app.state;
  const now = Date.now();
  if (!RF.riftOpen(s)) return h('div', { class: 'card locked-card', dataset: { screen: 'rift' } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '균열'), h('span', { class: 'muted' }, '잠김')), h('p', { class: 'muted', style: { margin: 0 } }, '폐광 파수꾼 처치 시 열림'));
  const run = s.rift.run;
  const curse = RF.curseFor(now);
  const left = RF.runsLeft(s, now);
  const lines = [
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, ico(V5_ICONS.rift), h('b', { style: { color: 'var(--text)' } }, '균열')), h('b', null, `최고 ${s.rift.best}층 · 오늘 ${left}/${RF.RIFT.freeRunsPerDay}회`)),
    h('div', { class: 'kv' }, `이번 주 저주 · ${curse.name}`, h('b', null, curse.desc)),
  ];
  if (run) lines.push(h('div', { class: 'kv' }, '진행 중', h('b', null, `${run.floor}층 · 축복 ${run.blessings.length}개 · HP ${Math.round(run.hpPct * 100)}%`)));
  lines.push(h('p', { class: 'muted', style: { margin: '2px 0 6px' } }, `층마다 ${RF.RIFT.timeSec}초 안에 ${RF.RIFT.killTarget}마리. 깰 때마다 축복 3개 중 1개를 고르고 HP는 이어집니다. 끝날 때 깬 층 수만큼 보상.`));
  const btns = run
    ? [run.choices ? button('축복 고르기', { cls: 'btn btn-primary', onClick: () => openBlessingPick(app) }) : button(`${run.floor}층 이어하기`, { cls: 'btn btn-primary', disabled: app.game.mode !== 'FARM', onClick: () => startFloor(app) }),
      button('여기서 마치기', { cls: 'btn', onClick: () => confirmEnd(app) })]
    : [button(left > 0 ? '균열 입장 · 무료' : '오늘 횟수 모두 사용', { cls: 'btn btn-primary', disabled: left <= 0 || app.game.mode !== 'FARM', onClick: () => startFloor(app) })];
  return h('div', { class: 'card', dataset: { screen: 'rift' } }, lines, h('div', { class: 'btn-row' }, btns));
}

async function startFloor(app) {
  const r = await app.game.startRift();
  if (!r.ok) { if (r.reason === 'choice') return openBlessingPick(app); fail(r); }
}

function confirmEnd(app) {
  const run = app.state.rift.run;
  if (!run) return;
  const rw = RF.rewardFor(app.state, run.cleared, run);
  const cm = openModal({ id: 'riftEnd', title: '균열을 마칠까요?', kind: 'center', desc: `${run.cleared}층까지의 보상을 받고 이번 도전을 끝냅니다. 보석 ${rw.gem} · 광석 ${rw.ore} · 골드 ${fmt(rw.gold)}${rw.books ? ` · 스킬북 ${rw.books}` : ''}${rw.essence ? ` · 환생 정수 ${rw.essence}` : ''}.`, actions: [
    button('보상 받고 마치기', { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.riftEnd()); if (r.ok) { cm.close(); showRiftReward(app, r); app.renderPanel(); } } }),
    button('취소', { cls: 'btn', onClick: () => cm.close() })] });
}

function showRiftReward(app, r) {
  const rw = r.reward;
  const tiles = [];
  if (rw.gem) tiles.push({ icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + rw.gem, label: '보석' });
  if (rw.ore) tiles.push({ icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + rw.ore, label: '강화 광석' });
  if (rw.gold) tiles.push({ icon: itemIcon(CURRENCY_ICONS.gold), value: '+' + fmt(rw.gold), label: '골드' });
  if (rw.books) tiles.push({ icon: itemIcon(CURRENCY_ICONS.skillBook || CURRENCY_ICONS.goldChest), value: '+' + rw.books, label: '스킬북' });
  if (rw.essence) tiles.push({ icon: skillIcon(V5_ICONS.essence), value: '+' + rw.essence, label: '환생 정수' });
  if (r.petEgg) tiles.push({ icon: skillIcon('V10'), value: '+' + r.petEgg, label: '정령 알' });
  const m = openModal({ id: 'riftResult', title: `균열 ${r.cleared}층 도달`, kind: 'center', body: h('div', { dataset: { screen: 'riftResult' } },
    h('p', null, r.cleared ? `축복 ${r.blessings.length}개와 함께 ${r.cleared}층까지 내려갔어요.` : '첫 층을 넘지 못했어요. 성장하고 다시 도전해요.'),
    tiles.length ? rewardTiles(tiles) : null), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => { m.close(); app.setTab('dungeon'); } })] });
  return m;
}

export function openBlessingPick(app) {
  const run = app.state.rift.run;
  if (!run || !run.choices) return null;
  const cards = run.choices.map((id) => {
    const b = RF.BLESSINGS[id];
    return h('button', { type: 'button', class: `bless r-${b.r}`, dataset: { key: 'bless-' + id }, 'aria-label': `${b.name} ${RNAME[b.r]} · ${b.desc}`, onClick: async () => {
      const r = fail(await app.game.riftPick(id));
      if (!r.ok) return;
      m.close();
      if (app.state.settings.sound) sfx('bell');
      afterPick(app);
    } }, h('span', { class: 'br' }, img(skillIcon(BLESS_ICON[id] || 'V03'), ''), RNAME[b.r]), h('b', null, b.name), h('span', { class: 'ds' }, b.desc));
  });
  const owned = run.blessings.map((id) => RF.BLESSINGS[id].name);
  const m = openModal({ id: 'riftBless', title: `${run.cleared}층 돌파 · 축복 선택`, dismissible: false, body: h('div', { dataset: { screen: 'riftBless' } },
    h('p', { class: 'modal-desc' }, `HP ${Math.round(run.hpPct * 100)}%로 다음 층에 들어갑니다. 하나를 고르세요.`),
    h('div', { class: 'bless-list' }, cards),
    owned.length ? h('p', { class: 'muted' }, `지금 축복: ${owned.join(', ')}`) : null) });
  return m;
}

function afterPick(app) {
  const run = app.state.rift.run;
  const m = openModal({ id: 'riftNext', title: `${run.floor}층으로`, kind: 'center', desc: `축복 ${run.blessings.length}개 · HP ${Math.round(run.hpPct * 100)}%. 계속 내려갈까요, 지금까지 보상을 받고 마칠까요?`, actions: [
    button(`${run.floor}층 도전`, { cls: 'btn btn-primary', onClick: () => { m.close(); startFloor(app); } }),
    button('보상 받고 마치기', { cls: 'btn', onClick: () => { m.close(); confirmEnd(app); } })] });
}

// Called from openResult for session kind 'rift'.
export function openRiftResult(app, r, back) {
  back();
  if (r.win && r.choices) return openBlessingPick(app);
  if (r.ended) return showRiftReward(app, r);
  app.renderPanel();
  return null;
}

// ======================= menu tiles =======================
export function v5Tiles(app) {
  const s = app.state;
  const out = [];
  const open = T.talentsOpen(s);
  out.push({ id: 'talents', ic: 'star', em: V5_ICONS.talents, t: '특성', s: open ? `남은 포인트 ${T.pointsFree(s)}` : '1차 승급 후', dot: open && T.pointsFree(s) > 0 && !s.talents.auto, on: () => openTalents(app) });
  out.push({ id: 'rebirth', ic: 'growth', em: V5_ICONS.rebirth, t: '환생', s: s.rebirth.count ? `${s.rebirth.count}회 · 정수 ${s.rebirth.essence}` : '초월 Lv 50부터', dot: RB.canRebirth(s), on: () => openRebirth(app) });
  return out;
}
export const riftDot = (s) => RF.riftOpen(s) && (!!(s.rift.run && s.rift.run.choices) || RF.runsLeft(s, Date.now()) > 0);
export { fmtPct, SKILLS, TALENT_ICONS };
