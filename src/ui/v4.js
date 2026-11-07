// v4 screens: class picker, 뽑기(장비·스킬), 일일 미션, 능력치 포인트, 각인, 탑·레이드·던전 카드,
// 3차 승급. Every grant goes through game.transact; reveals start only after r.ok.
import { BALANCE } from '../data/balance.js';
import { BOSSES, BRANCHES, CLASSES, CLASS_IDS, CLASS_SKILLS, CURRENCY_ICONS, EMBLEMS, RARITY, RUNES, SKILLS, STAT_KEYS, STAT_NAMES, branchesOf } from '../data/content.js';
import { classPortrait, itemIcon, portrait, promoPortrait, skillIcon, spriteMeta } from '../render/assets.js';
import * as prog from '../core/progression.js';
import { nextLevelAt, quoteDraw, rateTable, skillRateTable, summonLevel } from '../core/gacha.js';
import { missionStatus } from '../core/missions.js';
import { floorLevel, floorReward, nextFloor } from '../core/tower.js';
import { triesLeft, raidBossHp } from '../core/raid.js';
import { dungeonState, nextRefillAt, stageLevel, stageReward } from '../core/dungeon.js';
import { statPointsFree, statResetCost } from '../core/economy.js';
import { runeValue } from '../core/stats.js';
import { rarityLabel } from '../core/items.js';
import { fmt, fmtFull, fmtPct } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, closeAllModals, h, icon, img, modalOpen, openModal, toast } from './dom.js';
import { fail, go, openBoss, openWorld, rewardTiles } from './screens.js';

const reduce = (app) => app.state.settings.reduceMotion;
const curIcon = (k) => img(itemIcon(CURRENCY_ICONS[k]), '');
const DIFF = { warrior: '쉬움', mage: '보통', archer: '보통', rogue: '어려움' };
const RANGE = { melee: '근접', ranged: '원거리' };

// Characters without their own art yet: Serin's art with a hue shift + an honest tag.
export function classArt(cls, cssClass = '') {
  const c = CLASSES[cls];
  return img(c.art ? classPortrait(cls, 'card') : portrait('serin_key'), `${c.hero} (${c.name})`, cssClass);
}
// The costume the player wears now: tier-1+ branch figure if it exists, else class art.
export function currentArt(state, cssClass = '', tier = prog.tierOf(state)) {
  const b = state.player.branch;
  const file = b && tier >= 1 ? promoPortrait(b, tier) : null;
  if (file) return img(file, BRANCHES[b].names[Math.min(3, tier) - 1], cssClass);
  return classArt(state.player.cls || 'warrior', cssClass);
}
const pendingTag = (cls) => (CLASSES[cls].artPending ? h('span', { class: 'pending-tag' }, '그림 준비 중') : null);

// ======================= class picker (new game) =======================
export function needsClassPick(state) {
  return !state.classChosen && state.player.level <= 2 && prog.tierOf(state) === 0;
}
export function openClassPicker(app, { onDone } = {}) {
  let pick = 'warrior';
  const render = () => {
    const c = CLASSES[pick];
    const cs = CLASS_SKILLS[pick];
    const cards = h('div', { class: 'class-cards', role: 'radiogroup', 'aria-label': '클래스' }, CLASS_IDS.map((id) => {
      const k = CLASSES[id];
      return h('button', { type: 'button', class: 'class-card' + (pick === id ? ' pick' : ''), role: 'radio', 'aria-checked': String(pick === id), onClick: () => { pick = id; render(); } },
        h('span', { class: 'art' }, classArt(id), pendingTag(id)), h('b', null, k.name), h('span', { class: 'muted' }, `${k.hero} · ${k.age}세`));
    }));
    const tree = branchesOf(pick).map((b) => h('div', { class: 'kv' }, BRANCHES[b].role, h('b', null, BRANCHES[b].names.join(' → '))));
    m.setBody(h('div', { dataset: { screen: 'classpick' } },
      h('p', { class: 'modal-desc' }, '나중에 메뉴 → 클래스 전환에서 1회 무료로 바꿀 수 있어요.'),
      cards,
      h('div', { class: 'card' },
        h('h3', null, `${c.name} · ${c.hero}`), h('p', { class: 'small', style: { margin: '0 0 6px' } }, c.desc),
        h('div', { class: 'kv' }, '역할', h('b', null, c.role)),
        h('div', { class: 'kv' }, '사거리 · 난이도', h('b', null, `${RANGE[c.range]} · ${DIFF[pick]}`)),
        h('div', { class: 'kv' }, '스킬', h('b', null, cs.base.map((id) => SKILLS[id].name).join(' · '))),
        h('div', { class: 'kv' }, '궁극기', h('b', null, SKILLS[cs.ult].name))),
      h('div', { class: 'card' }, h('h3', null, '승급 (Lv 30 · 60 · 90)'), tree),
      null));
    m.setActions([button(`${c.name}(으)로 시작`, { cls: 'btn btn-primary', busy: true, onClick: async () => {
      const r = fail(await app.game.chooseClass(pick));
      if (!r.ok) return;
      m.close();
      app.buildSkills(); app.updateHud(true); app.renderPanel();
      toast(`${c.name} ${c.hero}의 여정이 시작됩니다.`, 'good');
      if (onDone) onDone();
    } })]);
  };
  const m = openModal({ id: 'classpick', title: '클래스 선택', dismissible: false, body: h('div'), actions: [] });
  render();
  return m;
}

// ======================= 뽑기 =======================
const RATE_NAMES_SK = { common: '스킬북 3권 (일반)', rare: '스킬북 8권 (희귀)', epic: '스킬북 20권 (영웅)', legendary: '고유 각인 (전설)' };
export function freeDrawAvailable(state) { return (state.wallet.eqTicket || 0) > 0 || (state.wallet.skTicket || 0) > 0; }

export function openGacha(app, tab = 'eq') {
  const render = () => {
    const s = app.state;
    const isEq = tab === 'eq';
    const kind = isEq ? 'equipment' : 'skill';
    const G = BALANCE.gacha[kind];
    const g = isEq ? s.gacha.eq : s.gacha.sk;
    const wallet = h('div', { class: 'wallet-row' },
      h('span', { class: 'cur' }, curIcon('gem'), fmtFull(s.wallet.gem)),
      h('span', { class: 'cur' }, curIcon('chest'), `${s.wallet.eqTicket || 0}`), h('span', { class: 'muted' }, '장비권'),
      h('span', { class: 'cur' }, curIcon('goldChest'), `${s.wallet.skTicket || 0}`), h('span', { class: 'muted' }, '스킬권'));
    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': '뽑기 종류' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(isEq), 'aria-pressed': String(isEq), onClick: () => { tab = 'eq'; render(); } }, '장비 뽑기'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(!isEq), 'aria-pressed': String(!isEq), onClick: () => { tab = 'sk'; render(); } }, '스킬 뽑기'));
    const pityLeft = G.pity - g.pity;
    const lines = [];
    if (isEq) {
      const lv = summonLevel(g.draws);
      const nx = nextLevelAt(g.draws);
      const prevAt = BALANCE.gacha.equipment.levelAt[lv - 1] || 0;
      lines.push(h('div', { class: 'kv' }, '소환 레벨', h('b', null, `Lv ${lv}${nx ? ` · 다음 ${nx - g.draws}회` : ' · 최고'}`)),
        nx ? h('div', { class: 'pbar', role: 'progressbar', 'aria-label': '소환 레벨 진행', 'aria-valuenow': String(g.draws - prevAt), 'aria-valuemax': String(nx - prevAt) }, h('i', { style: { width: `${((g.draws - prevAt) / (nx - prevAt)) * 100}%` } })) : null);
    }
    lines.push(h('div', { class: 'kv' }, isEq ? '전설 확정까지' : '고유 각인 확정까지', h('b', null, `${pityLeft}회`)),
      h('div', { class: 'pbar gold', role: 'progressbar', 'aria-label': '천장 진행', 'aria-valuenow': String(g.pity), 'aria-valuemax': String(G.pity) }, h('i', { style: { width: `${(g.pity / G.pity) * 100}%` } })),
      h('div', { class: 'kv' }, '누적 뽑기', h('b', null, `${fmtFull(g.draws)}회`)));
    const table = isEq ? rateTable(summonLevel(g.draws)) : skillRateTable();
    const rates = h('details', { class: 'card', open: true }, h('summary', { class: 'small' }, `확률 공개${isEq ? ` (소환 Lv ${summonLevel(g.draws)})` : ''}`),
      Object.entries(table).map(([r, p]) => h('div', { class: 'kv' }, h('span', { class: `rar r-${r}` }, isEq ? rarityLabel(r) : RATE_NAMES_SK[r]), h('b', null, fmtPct(p, p < 0.001 ? 3 : 2)))),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, isEq
        ? `장비 레벨은 지금 레벨(Lv ${s.player.level}), 부위는 무작위입니다. ${G.pity}회 동안 전설 이상이 없으면 ${G.pity}번째는 전설 확정이고, 전설·신화가 나오면 횟수가 0으로 돌아갑니다. 소환 레벨은 누적 뽑기 수로 오르며 상위 등급 확률이 조금씩 올라갑니다.`
        : `스킬북은 지금 배운 ${CLASSES[s.player.cls || 'warrior'].name} 스킬 중 하나에 들어갑니다. 각인 ${Object.keys(RUNES).length}종은 모든 클래스 공용이며 중복이면 각인 레벨 +1(최대 ${BALANCE.runes.maxLevel}). ${G.pity}회째는 각인 확정입니다.`));
    const drawBtn = (n) => {
      const q = quoteDraw(s, kind, n);
      const cost = [q.tickets ? `뽑기권 ${q.tickets}` : null, q.gem ? `보석 ${fmtFull(q.gem)}` : null].filter(Boolean).join(' + ');
      const b = button('', { cls: 'btn draw-btn' + (n === 11 ? ' btn-primary' : ''), disabled: !q.ok, busy: true, ariaLabel: `${n}회 뽑기 · ${q.ok ? cost : `보석 ${fmtFull(q.shortGem)} 부족`}`, onClick: async () => {
        const r = fail(await (isEq ? app.game.drawEquipment(n) : app.game.drawSkill(n)));
        if (!r.ok) return;
        if (app.state.settings.sound) sfx('bell');
        showDrawResults(app, isEq, r, () => render());
        render();
      } });
      b.append(h('b', null, `${n}회 뽑기`), h('small', null, q.ok ? cost : `보석 ${fmtFull(q.shortGem)} 부족`));
      return b;
    };
    m.setBody(h('div', { dataset: { screen: isEq ? 'gacha' : 'gachaskill' } },
      tabs, wallet, h('div', { class: 'card' }, lines), rates,
      h('p', { class: 'muted' }, '실제 결제·광고는 없습니다. 보석과 뽑기권은 출석, 일일 미션, 보스 최초 처치, 시련의 탑, 레이드, 복귀 보상으로만 얻어요.')));
    m.setActions([h('div', { class: 'btn-row' }, drawBtn(1), drawBtn(11))]);
  };
  const m = openModal({ id: 'gacha', title: '뽑기 · 별의 유산', body: h('div'), actions: [] });
  render();
  return m;
}

function showDrawResults(app, isEq, r, after) {
  const order = (x) => RARITY[x] ? RARITY[x].order : 0;
  const res = r.results;
  const best = res.reduce((b, x) => (order(isEq ? x.item.rarity : x.rarity) > order(isEq ? b.item.rarity : b.rarity) ? x : b), res[0]);
  const bestR = isEq ? best.item.rarity : best.rarity;
  const fast = reduce(app);
  const grid = h('div', { class: 'draw-grid' + (fast ? '' : ' reveal') }, res.map((x, i) => {
    const rar = isEq ? x.item.rarity : x.rarity;
    const top = x === best && order(rar) >= 3;
    let pic, name, sub;
    if (isEq) { pic = img(itemIcon(x.item.look), ''); name = x.item.name; sub = rarityLabel(rar); }
    else if (x.kind === 'rune') { pic = RUNES[x.rune].icon ? img(skillIcon(RUNES[x.rune].icon), '') : icon('star', 30); name = `각인 · ${RUNES[x.rune].name}`; sub = x.capped ? '최대 레벨 · 보석 +100' : `Lv ${x.level}${x.dupe ? ' (중복)' : ' NEW'}`; }
    else { pic = img(skillIcon(SKILLS[x.skill].icon), ''); name = SKILLS[x.skill].name; sub = `스킬북 ×${x.books}`; }
    return h('div', { class: `draw r-${rar}${top ? ' top' : ''}`, style: fast ? null : { animationDelay: `${150 + i * 70}ms` } },
      h('span', { class: `mk r-${rar}` }, RARITY[rar] ? RARITY[rar].mark : ''), pic, h('b', null, name), h('span', { class: 'muted' }, sub), x.pity ? h('span', { class: 'tag' }, '천장') : null);
  }));
  const head = order(bestR) >= 4 ? h('p', { class: 'draw-best', role: 'status' }, `${RARITY[bestR].name} 등급 획득!`) : h('p', { class: 'muted', role: 'status' }, `최고 등급: ${RARITY[bestR] ? RARITY[bestR].name : ''}`);
  const extra = [];
  if (r.overflowed && r.overflowed.length) extra.push(h('p', { class: 'warn' }, `보관함이 가득 차 ${r.overflowed.length}개는 임시 보관함에 들어갔습니다.`));
  if (r.converted && r.converted.length) extra.push(h('p', { class: 'warn' }, `임시 보관함도 가득 차 ${r.converted.length}개는 강화 광석으로 바뀌었습니다.`));
  const m = openModal({ id: 'gachaResult', title: `${isEq ? '장비' : '스킬'} 뽑기 결과 · ${res.length}회`, body: h('div', { dataset: { screen: 'gachaResult' } }, head, grid, ...extra),
    onClose: after, actions: [button('확인', { cls: 'btn btn-primary', onClick: () => m.close() })] });
  if (!fast && order(bestR) >= 4) setTimeout(() => app.renderer && app.renderer.kick(2, 90), 200);
}

// ======================= 일일 미션 =======================
export function openMissions(app) {
  const render = () => {
    const st = missionStatus(app.state, Date.now());
    const rows = st.list.map((x) => h('div', { class: 'check' + (x.claimed ? ' ok' : '') },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, x.claimed ? icon('check', 16) : ''),
      h('div', { class: 'c' }, h('b', null, x.name), h('div', { class: 'pbar', role: 'progressbar', 'aria-label': x.name, 'aria-valuenow': String(x.progress), 'aria-valuemax': String(x.target) }, h('i', { style: { width: `${(x.progress / x.target) * 100}%` } }))),
      h('span', { class: 'p' }, `${x.progress}/${x.target}`),
      x.claimed ? h('span', { class: 'muted' }, '완료') : button(x.done ? `보석 ${BALANCE.missions.gem}` : '진행 중', { cls: 'btn go' + (x.done ? ' btn-primary' : ''), disabled: !x.done, busy: true, onClick: async () => {
        const r = fail(await app.game.claimMission(x.id));
        if (r.ok) { toast(`보석 +${r.reward.gem}`, 'good'); render(); }
      } })));
    const b = BALANCE.missions.bonus;
    m.setBody(h('div', { dataset: { screen: 'missions' } },
      h('p', { class: 'modal-desc' }, '매일 00:00(한국 시간)에 새로 바뀝니다. 다섯 개를 모두 받으면 추가 보상이 있어요.'), rows,
      h('div', { class: 'card', style: { marginTop: '8px' } }, h('div', { class: 'kv' }, '모두 완료 보상', h('b', null, `보석 ${b.gem} · 장비 뽑기권 ${b.eqTicket} · 스킬 뽑기권 ${b.skTicket}`)),
        // 사냥 보급 진행 (v8)
        (() => { const SP = BALANCE.supply, k = (app.state.supply && app.state.supply.kills) || 0;
          return h('div', { class: 'kv', style: { marginTop: '6px' } }, '사냥 보급', h('span', { class: 'muted small' },
            `보석 ${SP.gem}: ${k % SP.gemEvery}/${SP.gemEvery} · 장비권: ${k % SP.eqEvery}/${SP.eqEvery} · 스킬권: ${k % SP.skEvery}/${SP.skEvery} 처치`)); })())));
    m.setActions([button(st.bonusClaimed ? '오늘 보상 완료' : st.canBonus ? '모두 완료 보상 받기' : `${st.list.filter((x) => x.claimed).length}/5 받음`, { cls: 'btn btn-primary', disabled: !st.canBonus, busy: true, onClick: async () => {
      const r = fail(await app.game.claimMissionBonus());
      if (r.ok) { toast(`보석 +${r.reward.gem} · 장비 뽑기권 +${r.reward.eqTicket}${r.reward.skTicket ? ` · 스킬 뽑기권 +${r.reward.skTicket}` : ''}`, 'good'); render(); }
    } })]);
  };
  const m = openModal({ id: 'missions', title: '일일 미션', body: h('div'), actions: [] });
  render();
}

// ======================= 능력치 포인트 (growth tab) =======================
export function statPointsCard(app) {
  const s = app.state;
  const free = statPointsFree(s);
  const main = CLASSES[s.player.cls || 'warrior'].mainStat;
  const wrap = h('div', { class: 'card', dataset: { screen: 'statpoints' } },
    h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '능력치 포인트'), h('b', null, `남은 포인트 ${free}`)),
    h('div', { class: 'stat-grid' }, STAT_KEYS.map((k) => h('div', { class: 'stat-pt' + (k === main ? ' main' : '') },
      h('span', null, STAT_NAMES[k]), h('b', null, String(s.player.stats[k] || 0)),
      button('+', { cls: 'chip-btn', ariaLabel: `${STAT_NAMES[k]} +1`, disabled: free <= 0, busy: true, onClick: async () => fail(await app.game.allocateStat(k, 1)) }),
      button('+10', { cls: 'chip-btn', ariaLabel: `${STAT_NAMES[k]} +10`, disabled: free < 1, busy: true, onClick: async () => fail(await app.game.allocateStat(k, Math.min(10, statPointsFree(app.state)))) })))),
    h('label', { class: 'switch-row' }, h('span', null, `레벨업 시 자동 분배 (${CLASSES[s.player.cls || 'warrior'].name} 추천)`), h('input', { type: 'checkbox', checked: !!s.player.statAuto, onChange: async (e) => fail(await app.game.setAutoStats(e.target.checked)) })),
    h('div', { class: 'btn-row' }, button(`초기화 · 골드 ${fmt(statResetCost(s))}`, { cls: 'btn', busy: true, onClick: async () => { const r = fail(await app.game.resetStats()); if (r.ok) toast('능력치 포인트를 돌려받았어요.', 'good'); } })),
    h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `레벨마다 ${BALANCE.statPoints.perLevel}포인트. 주 능력치(${STAT_NAMES[main]})는 공격력 +${BALANCE.statPoints.mainAtk}, VIT는 HP·방어, AGI는 공속·회피·치명, WIS는 스킬 쿨타임 감소입니다. 직접 찍으면 자동 분배가 꺼져요.`));
  return wrap;
}

// ======================= 각인 (skills tab) =======================
export function runesCard(app) {
  const s = app.state;
  const R = s.skills.runes;
  const owned = Object.entries(R.owned || {}).filter(([, lv]) => lv > 0);
  const slotEl = (i) => {
    const id = R.equipped[i];
    return h('div', { class: 'skill-line' }, h('span', { class: 'rune-ic' + (id ? ' on' : '') }, id && RUNES[id].icon ? img(skillIcon(RUNES[id].icon), '') : icon('star', 22)),
      h('div', null, h('div', { class: 't' }, `각인 ${i + 1} · ${id ? `${RUNES[id].name} Lv ${R.owned[id]}` : '비어 있음'}`), h('div', { class: 'muted' }, id ? runeText(id, R.owned[id]) : '스킬 뽑기의 전설 결과로 얻어요.')),
      id ? button('해제', { cls: 'chip-btn', busy: true, onClick: async () => fail(await app.game.unequipRune(i)) }) : null);
  };
  return h('div', { dataset: { screen: 'runes' } },
    h('div', { class: 'section-title' }, `고유 각인 · ${owned.length}/${Object.keys(RUNES).length}종`),
    slotEl(0), slotEl(1),
    owned.length ? h('div', { class: 'rune-list' }, owned.map(([id, lv]) => {
      const at = R.equipped.indexOf(id);
      return h('div', { class: 'kv' }, h('span', { class: 'rune-name' }, RUNES[id].icon ? img(skillIcon(RUNES[id].icon), '', 'rune-mini') : null, `${RUNES[id].name} Lv ${lv}`, h('span', { class: 'muted' }, ` · ${runeText(id, lv)}`)),
        at >= 0 ? h('b', null, `${at + 1}번 장착`) : h('span', { class: 'btn-row', style: { gap: '4px' } },
          button('1번', { cls: 'chip-btn', busy: true, onClick: async () => fail(await app.game.equipRune(id, 0)) }),
          button('2번', { cls: 'chip-btn', busy: true, onClick: async () => fail(await app.game.equipRune(id, 1)) })));
    })) : h('p', { class: 'muted' }, '아직 각인이 없어요.'),
    button('스킬 뽑기로 가기', { cls: 'btn', onClick: () => openGacha(app, 'sk') }));
}
function runeText(id, lv) {
  const r = RUNES[id];
  const v = runeValue(id, lv);
  return r.desc.replace(/\d+%/, `${Math.round(v * 1000) / 10}%`);
}

// ======================= 모험: 던전 3종 · 탑 · 레이드 =======================
const DUNGEON_INFO = {
  quarry: { reward: (rw) => `강화 광석 ${rw.ore} · 골드 ${fmt(rw.gold)}`, why: '장비 강화 재료' },
  gold: { reward: (rw) => `골드 ${fmt(rw.gold)}`, why: '골드 성장·승급 비용' },
  books: { reward: (rw) => `스킬북 ${rw.books}권 · 골드 ${fmt(rw.gold)}`, why: '스킬 레벨업' },
};
export function dungeonCard(app, type) {
  const s = app.state;
  const D = BALANCE.dungeons[type];
  const d = dungeonState(s, type);
  if (!prog.dungeonOpen(s, type)) {
    return h('div', { class: 'card locked-card', dataset: { screen: 'dungeon-' + type } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, D.name), h('span', { class: 'muted' }, icon('lock', 14), ' 잠김')),
      h('p', { class: 'muted', style: { margin: 0 } }, `${BOSSES[D.unlockBoss].name} 처치 시 열림 · ${DUNGEON_INFO[type].why}`));
  }
  const next = Math.min(d.best + 1, 99);
  const rw = stageReward(next, type);
  const free = app.game.mode === 'FARM';
  return h('div', { class: 'card', dataset: { screen: 'dungeon-' + type } },
    h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, D.name), h('span', { class: 'cur' }, curIcon('ticket'), `${d.tickets}/${BALANCE.dungeon.ticketCap}`)),
    h('div', { class: 'kv' }, '최고 기록', h('b', null, d.best ? `${d.best}단계` : '없음')),
    h('div', { class: 'kv' }, `${next}단계`, h('b', null, `Lv ${stageLevel(next)} · ${DUNGEON_INFO[type].reward(rw)}`)),
    h('div', { class: 'btn-row', style: { marginTop: '6px' } },
      button(d.best ? `${d.best}단계 소탕` : '소탕 불가', { cls: 'btn', disabled: !d.best || d.tickets <= 0, busy: true, onClick: async () => {
        const r = fail(await app.game.sweepDungeon(type));
        if (r.ok) toast(`${D.name} ${r.stage}단계 소탕 · ${DUNGEON_INFO[type].reward(r)}`, 'good');
      } }),
      button(`${next}단계 도전`, { cls: 'btn btn-primary', disabled: d.tickets <= 0 || !free, busy: true, onClick: async () => {
        const r = fail(await app.game.enterDungeon(type, next));
        if (r.ok) toast(`${D.name} ${next}단계 시작`, 'info');
      } })),
    d.tickets <= 0 ? h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `입장권 없음 · ${new Date(nextRefillAt(Date.now())).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })} 00:00 +${BALANCE.dungeon.dailyTickets}`) : null);
}

export function towerCard(app) {
  const s = app.state;
  if (!prog.towerOpen(s)) return h('div', { class: 'card locked-card', dataset: { screen: 'tower' } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '시련의 탑'), h('span', { class: 'muted' }, '잠김')), h('p', { class: 'muted', style: { margin: 0 } }, `${BOSSES.B03.name} 처치 시 열림`));
  const f = nextFloor(s);
  const rw = floorReward(f);
  const T = BALANCE.tower;
  return h('div', { class: 'card', dataset: { screen: 'tower' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, img(skillIcon(EMBLEMS.tower), '', 'emblem'), h('b', { style: { color: 'var(--text)' } }, '시련의 탑')), h('b', null, `최고 ${s.tower.best || 0}층`)),
    h('div', { class: 'kv' }, `${f}층 · Lv ${floorLevel(f)}`, h('b', null, [`보석 ${rw.gem}`, rw.awakenStone ? `각성석 ${rw.awakenStone}` : null, rw.starShard ? `별의 파편 ${rw.starShard}` : null].filter(Boolean).join(' · '))),
    h('p', { class: 'muted', style: { margin: '2px 0 6px' } }, `입장권 없이 언제든 · ${T.timeSec}초 안에 ${T.killTarget}마리 · 층 보상은 처음 깰 때 한 번. 2차 승급 조건 5층.`),
    button(`${f}층 도전`, { cls: 'btn btn-primary', disabled: app.game.mode !== 'FARM', onClick: () => { const r = app.game.startTower(); if (!r.ok) fail(r); } }));
}

export function raidCard(app) {
  const s = app.state;
  const R = BALANCE.raid;
  const open = prog.raidOpen(s);
  const left = triesLeft(s, Date.now());
  return h('div', { class: 'card' + (open ? '' : ' locked-card'), dataset: { screen: 'raid' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, img(skillIcon(EMBLEMS.raid), '', 'emblem'), h('b', { style: { color: 'var(--text)' } }, '주간 레이드 · 심연의 문')), h('b', null, open ? `이번 주 ${left}/${R.weeklyTries}회` : '잠김')),
    h('div', { class: 'kv' }, '최고 기록', h('b', null, s.raid.best ? `${s.raid.bestGrade} · 피해 ${fmt(s.raid.best)}` : '없음')),
    h('p', { class: 'muted', style: { margin: '2px 0 6px' } }, open ? `${R.timeSec}초 동안 ${BOSSES[R.boss].name}에게 준 피해로 등급(D~S)이 정해져요. S 등급은 전설 장비 확정(신화 0.5%) + 별의 파편. 매주 월요일 00:00(KST) 초기화.`
      : `Lv ${R.unlockLevel} 이상 · ${BOSSES[R.unlockBoss].name} 처치 후 열려요.`),
    open ? button(left > 0 ? '레이드 도전 · 1회 사용' : '이번 주 횟수 모두 사용', { cls: 'btn btn-primary', disabled: left <= 0 || app.game.mode !== 'FARM', busy: true, onClick: async () => fail(await app.game.startRaid()) }) : null);
}

// ======================= results: tower / raid =======================
export function openTowerResult(app, r, back) {
  const tiles = [];
  if (r.reward) {
    tiles.push({ icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + r.reward.gem, label: '보석' });
    if (r.reward.awakenStone) tiles.push({ icon: itemIcon(CURRENCY_ICONS.awakenStone), value: '+' + r.reward.awakenStone, label: '각성석' });
    if (r.reward.starShard) tiles.push({ icon: itemIcon(CURRENCY_ICONS.starShard), value: '+' + r.reward.starShard, label: '별의 파편' });
  }
  const m = openModal({ id: 'towerResult', title: r.cleared ? `시련의 탑 ${r.floor}층 돌파` : `시련의 탑 ${r.floor}층 실패`, dismissible: false,
    body: h('div', { dataset: { screen: 'towerResult' } },
      h('p', null, r.cleared ? `${r.timeSec}초 · ${r.kills}마리 처치${r.record ? ' · 최고 기록 갱신' : ' · 이미 깬 층이라 보상 없음'}` : `${r.reason === 'timeout' ? '시간 초과' : r.reason === 'forfeit' ? '중단' : '패배'} · 잃은 것은 없어요. 성장하고 다시 도전하세요.`),
      tiles.length ? rewardTiles(tiles) : null),
    actions: [r.cleared ? button(`${r.floor + 1}층 바로 도전`, { cls: 'btn btn-primary', onClick: () => { m.close(); const x = app.chainSession(back, () => app.game.startTower()); if (!x || !x.ok) fail(x || { ok: false }); } }) : null,
      button('확인', { cls: 'btn' + (r.cleared ? '' : ' btn-primary'), onClick: () => { m.close(); back(); app.setTab('dungeon'); } })].filter(Boolean) });
  return m;
}
export function openRaidResult(app, r, back, itemRewards) {
  const tiles = [{ icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + (r.reward.gem || 0), label: '보석' }];
  if (r.reward.starShard) tiles.push({ icon: itemIcon(CURRENCY_ICONS.starShard), value: '+' + r.reward.starShard, label: '별의 파편' });
  tiles.push(...itemRewards(r.items || []));
  const m = openModal({ id: 'raidResult', title: `레이드 결과 · ${r.grade} 등급`, dismissible: false,
    body: h('div', { dataset: { screen: 'raidResult' } },
      h('p', { class: 'raid-grade g-' + r.grade }, r.grade),
      h('p', { style: { textAlign: 'center' } }, `누적 피해 ${fmtFull(r.damage)} · 보스 체력의 ${fmtPct(r.share, 1)}`),
      rewardTiles(tiles),
      h('p', { class: 'muted' }, `등급 기준: S 100% · A 70% · B 45% · C 25% (보스 최대 체력 ${fmt(raidBossHp())} 대비).`)),
    actions: [button('확인', { cls: 'btn btn-primary', onClick: () => { m.close(); back(); app.setTab('dungeon'); } })] });
  return m;
}

// ======================= 승급 (tiers 1–3) =======================
export function openPromotionTier(app, tier) {
  const s = app.state;
  const br = BRANCHES[s.player.branch];
  const cl = prog.promotionChecklist(s, tier);
  const name = br.names[tier - 1];
  const m = openModal({ id: 'promotion', title: `${tier}차 승급 · ${name}`, body: h('div', { dataset: { screen: 'promotion' } },
    h('div', { class: 'hero-art' }, h('figure', null, currentArt(s), h('figcaption', null, h('b', null, '지금'), h('span', { class: 'muted' }, prog.tierName(s) || CLASSES[s.player.cls || 'warrior'].name))),
      h('figure', { class: 'pick' }, currentArt(s, '', tier), h('figcaption', null, h('b', null, name), h('span', { class: 'muted' }, br.role)))),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '승급 능력', h('b', null, passiveText(br.tiers[tier - 1]))),
      tier === 2 ? h('div', { class: 'kv' }, '신규 스킬', h('b', null, `${SKILLS[br.skills[1]].name} · 5번 슬롯`)) : null,
      tier === 2 ? h('div', { class: 'kv' }, '궁극기', h('b', null, '피해 +50%')) : null,
      tier === 3 ? h('div', { class: 'kv' }, '최종 궁극기', h('b', null, `${br.finalUlt} (피해 ×2)`)) : null,
      cl.items.filter((i) => i.cost).map((i) => h('div', { class: 'kv' }, `사용: ${i.label}`, h('b', null, fmtFull(i.cost))))),
    h('p', { class: 'muted' }, '레벨·장비는 그대로이고, 보관된 경험치가 바로 적용돼요. 재료는 확정할 때만 사용됩니다.')),
    actions: [button(cl.canPromote ? `${name}(으)로 승급` : '조건을 먼저 채우세요', { cls: 'btn btn-primary', disabled: !cl.canPromote, busy: true, onClick: async () => {
      const r = fail(await app.game.promote(tier));
      if (!r.ok) return;
      m.close();
      celebratePromotion(app, r);
    } })] });
}
export function passiveText(p) {
  const N = { atk: '공격력', hp: '체력', def: '방어력', crit: '치명타', critDmg: '치명 피해', aspd: '공속', cdr: '쿨 감소', evade: '회피' };
  return Object.entries(p).map(([k, v]) => `${N[k] || k} +${Math.round(v * 100)}%`).join(' · ');
}
export function celebratePromotion(app, r) {
  const s = app.state;
  const br = BRANCHES[r.branch];
  const fast = reduce(app);
  const fig = currentArt(s, 'promo-art');
  const info = h('div', { class: 'promo-info', style: fast ? null : { opacity: 0, transition: 'opacity 300ms' } },
    h('h3', null, `${r.tier}차 승급 · ${r.name}`),
    h('p', null, r.tier === 1 ? `${SKILLS[br.skills[0]].name} 획득 · 4번 슬롯 해금` : r.tier === 2 ? `${SKILLS[br.skills[1]].name} 획득 · 5번 슬롯 해금 · 궁극기 강화` : `최종 궁극기 ${br.finalUlt}`),
    r.exp && r.exp.amount ? h('p', { class: 'muted' }, `보관 경험치 ${fmtFull(r.exp.amount)} 적용 · ${r.exp.levels}레벨 상승`) : null);
  const m = openModal({ id: 'promoPlay', title: '승급 완료', dismissible: false, body: h('div', { dataset: { screen: 'promoPlay' } }, h('div', { class: 'promo-stage' }, fig), info),
    actions: [button('계속', { cls: 'btn btn-primary', onClick: () => m.close() })] });
  if (app.state.settings.sound) sfx('rise');
  if (!fast) setTimeout(() => { info.style.opacity = 1; app.renderer && app.renderer.kick(3, 100); }, 900);
  app.buildSkills(); app.updateHud(true);
}

// menu tiles added by v4 (read by screens.menuTiles via globalThis.__menuExtras)
export function v4Tiles(app) {
  const s = app.state;
  const ms = missionStatus(s, Date.now());
  return [
    { id: 'gacha', ic: 'equipment', t: '뽑기', s: `보석 ${fmt(s.wallet.gem)} · 권 ${(s.wallet.eqTicket || 0) + (s.wallet.skTicket || 0)}`, dot: freeDrawAvailable(s), on: () => openGacha(app, (s.wallet.eqTicket || 0) > 0 || !(s.wallet.skTicket > 0) ? 'eq' : 'sk') },
    { id: 'missions', ic: 'check', t: '일일 미션', s: `${ms.list.filter((x) => x.claimed).length}/5 완료`, dot: ms.claimable > 0 || ms.canBonus, on: () => openMissions(app) },
  ];
}
export { go, openBoss, openWorld, closeAllModals, modalOpen };
