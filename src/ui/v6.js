// v5 part 2 screens: 도감, 업적·칭호, 무료 시즌 패스, 동료, 신화 제작.
// Every grant goes through game.transact; reveals start only after r.ok.
import { ACHIEVEMENTS, CODEX, CODEX_MONSTERS, CRAFT, PASS, PETS, PET_RULES, TITLES } from '../data/meta.js';
import { BOSSES, CURRENCY_ICONS, MONSTERS, RARITY, REGION_BY_ID, SLOT_NAMES } from '../data/content.js';
import * as WBm from '../core/worldboss.js';
import { itemIcon, petImage, skillIcon, spriteMeta } from '../render/assets.js';
import * as M from '../core/meta.js';
import { rarityLabel } from '../core/items.js';
import { fmt, fmtFull, fmtPct } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { fail, rewardTiles } from './screens.js';

// emblems from icons_v5 (V00–V15)
export const V6_ICONS = Object.freeze({ talents: 'V00', rebirth: 'V01', rift: 'V02', blessing: 'V03', codexMonster: 'V04', codexItem: 'V05', achievement: 'V06', title: 'V07', pass: 'V08', craft: 'V09', petEgg: 'V10', petFood: 'V11', curse: 'V12', relic: 'V13', essence: 'V14', crown: 'V15' });
const ico = (id, cls = 'emblem') => { try { return img(skillIcon(V6_ICONS[id] || id), '', cls); } catch { return null; } };
const STAT_KO = { atkPct: '공격력', hpPct: '체력', defPct: '방어력', goldPct: '골드 획득', critChance: '치명 확률', critDmg: '치명 피해', ultCharge: '궁극기 충전', regen: '초당 회복', evade: '회피', expPct: '경험치' };
export const bonusText = (b) => Object.entries(b || {}).map(([k, v]) => `${STAT_KO[k] || k} +${fmtPct(v, v < 0.01 ? 2 : 1)}`).join(' · ');
const REWARD_KO = { gem: '보석', eqTicket: '장비 뽑기권', skTicket: '스킬 뽑기권', petEgg: '정령 알', petFood: '정령 먹이', essence: '환생 정수', ore: '강화 광석', gold: '골드', ticket: '입장권' };
export const rewardText = (rw) => Object.entries(rw || {}).map(([k, v]) => (k === 'title' ? `칭호 「${TITLES[v].name}」` : k === 'titles' ? v.map((t) => `칭호 「${TITLES[t].name}」`).join(' · ') : `${REWARD_KO[k] || k} +${fmt(v)}`)).join(' · ');
function rewardIcons(rw) {
  const out = [];
  for (const [k, v] of Object.entries(rw || {})) {
    if (k === 'title' || k === 'titles') continue;
    const icon = k === 'petEgg' ? skillIcon('V10') : k === 'petFood' ? skillIcon('V11') : k === 'essence' ? skillIcon('V14') : itemIcon(CURRENCY_ICONS[k === 'eqTicket' ? 'chest' : k === 'skTicket' ? 'goldChest' : k] || CURRENCY_ICONS.gem);
    out.push({ icon, value: '+' + fmt(v), label: REWARD_KO[k] || k });
  }
  return out;
}
function grantModal(app, title, rw) {
  const body = h('div', { dataset: { screen: 'metaGrant' } }, rewardTiles(rewardIcons(rw)),
    (rw.title || rw.titles) ? h('p', { class: 'small', style: { textAlign: 'center' } }, rewardText({ ...(rw.title ? { title: rw.title } : {}), ...(rw.titles ? { titles: rw.titles } : {}) }) + ' 획득') : null);
  if (app.state.settings.reduceMotion) body.querySelectorAll('.reward').forEach((e) => { e.style.animation = 'none'; e.style.opacity = 1; e.style.transform = 'none'; });
  const m = openModal({ id: 'metaGrant', title, kind: 'center', body, actions: [button('확인', { cls: 'btn btn-primary', onClick: () => m.close() })] });
  if (app.state.settings.sound) sfx('bell');
}
const nameOf = (id) => (MONSTERS[id] ? MONSTERS[id].name : BOSSES[id] ? BOSSES[id].name : id);
function spriteOf(id) {
  const sm = spriteMeta();
  const def = MONSTERS[id] || BOSSES[id];
  const key = def && def.sprite ? def.sprite : id;
  return (sm.monsters[id] || sm.bosses[id] || sm.monsters[key] || sm.bosses[key] || {}).file || null;
}

// ======================= 도감 =======================
export function openCodex(app, tab = 'monster') {
  let m;
  const render = () => {
    const s = app.state;
    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': '도감 종류' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'monster'), 'aria-pressed': String(tab === 'monster'), onClick: () => { tab = 'monster'; render(); } }, '몬스터'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'item'), 'aria-pressed': String(tab === 'item'), onClick: () => { tab = 'item'; render(); } }, '장비'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'rare'), 'aria-pressed': String(tab === 'rare'), onClick: () => { tab = 'rare'; render(); } }, '희귀 정예'));
    const bonus = M.codexBonus(s);
    let list;
    if (tab === 'monster') {
      list = h('div', { class: 'codex-grid' }, CODEX_MONSTERS.map((id, i) => {
        const k = s.codex.kills[id] || 0;
        const tiers = BOSSES[id] ? CODEX.bossTiers : CODEX.monsterTiers;
        const t = M.codexTier(id, k);
        const next = tiers[t];
        const file = spriteOf(id);
        const seen = k > 0;
        const stat = CODEX.stats[i % CODEX.stats.length];
        return h('div', { class: 'codex-cell' + (seen ? '' : ' unseen') + (BOSSES[id] ? ' boss' : ''), 'aria-label': `${seen ? nameOf(id) : '미발견'} ${fmtFull(k)}마리, ${t}단계` },
          file ? img(file, '', 'cimg') : h('span', { class: 'cimg' }),
          h('b', null, seen ? nameOf(id) : '???'),
          h('span', { class: 'stars', 'aria-hidden': 'true' }, '★'.repeat(t) + '☆'.repeat(3 - t)),
          h('span', { class: 'muted' }, next ? `${fmtFull(k)}/${fmtFull(next)}` : `${fmtFull(k)} · 완료`),
          h('span', { class: 'cb' }, `${STAT_KO[stat]} +${fmtPct(CODEX.perTier, 2)}/단계`));
      }));
    } else if (tab === 'rare') {
      // v8 희귀 정예: one named elite per region (appears on stage clears while hunting)
      const got = (s.worldBoss && s.worldBoss.rares) || {};
      list = h('div', {}, h('div', { class: 'codex-grid' }, Object.entries(WBm.RARES).map(([reg, r]) => {
        const k = got[r.id] || 0;
        const file = spriteOf(r.base);
        return h('div', { class: 'codex-cell rare-cell' + (k ? '' : ' unseen'), 'aria-label': `${k ? r.name : '미발견'} ${k}회 처치` },
          file ? img(file, '', 'cimg') : h('span', { class: 'cimg' }),
          h('b', null, k ? r.name : '???'),
          h('span', { class: 'muted' }, `${(REGION_BY_ID[reg] || {}).name || reg}`),
          h('span', { class: 'cb' }, k ? `${k}회 처치` : '미발견'));
      })),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, `사냥 중 스테이지를 깰 때 ${Math.round(WBm.RARE_RULES.chance * 100)}% 확률로 그 지역의 희귀 정예가 나타나요. 처치하면 보석 ${WBm.RARE_RULES.gem} + 희귀 이상 장비 확정. ${WBm.rareCount(s)}/${Object.keys(WBm.RARES).length} 발견 · 모두 잡으면 칭호 「희귀 정예 사냥꾼」.`));
    } else {
      const rar = Object.keys(RARITY);
      list = h('div', { class: 'codex-table', role: 'table', 'aria-label': '장비 도감' },
        h('div', { class: 'ct-row head', role: 'row' }, h('span', null, ''), rar.map((r) => h('span', { class: `rar r-${r}` }, RARITY[r].mark))),
        CODEX.itemSlots.map((slot) => h('div', { class: 'ct-row', role: 'row' }, h('span', null, SLOT_NAMES[slot] || (slot === 'ring' ? '반지' : slot)),
          rar.map((r) => { const got = !!s.codex.items[`${slot}:${r}`]; return h('span', { class: 'ct-cell' + (got ? ' got' : ''), 'aria-label': `${SLOT_NAMES[slot] || slot} ${RARITY[r].name} ${got ? '획득' : '미획득'}` }, got ? '●' : '·'); }))),
        h('p', { class: 'muted', style: { margin: '6px 0 0' } }, `처음 얻은 부위×등급마다 공격력·체력 +${fmtPct(CODEX.itemPerEntry, 2)}. ${Object.keys(s.codex.items).length}/${M.codexItemTotal()} 수집.`));
    }
    const body = h('div', { dataset: { screen: 'codex' } },
      h('p', { class: 'modal-desc' }, '처치·수집 기록이 쌓이면 영구 능력치가 조금씩 올라요.'),
      tabs,
      h('div', { class: 'card', style: { marginTop: '8px' } }, h('div', { class: 'kv' }, '도감 보너스 합계', h('b', null, bonusText(bonus) || '아직 없음')),
        h('div', { class: 'kv' }, '몬스터 도감 단계', h('b', null, `${M.codexTiersTotal(s)} / ${CODEX_MONSTERS.length * 3}`))),
      list);
    if (!m) m = openModal({ id: 'codex', title: '도감', body, actions: [button('닫기', { cls: 'btn', onClick: () => m.close() })] }); else m.setBody(body);
  };
  render();
  return m;
}

// ======================= 업적 · 칭호 =======================
export function openAchievements(app, tab = 'ach') {
  let m;
  const render = () => {
    const s = app.state;
    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': '업적 · 칭호' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'ach'), 'aria-pressed': String(tab === 'ach'), onClick: () => { tab = 'ach'; render(); } }, `업적 ${Object.keys(s.achievements.claimed).length}/${ACHIEVEMENTS.length}`),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'title'), 'aria-pressed': String(tab === 'title'), onClick: () => { tab = 'title'; render(); } }, `칭호 ${s.titles.owned.length}/${Object.keys(TITLES).length}`));
    let list;
    if (tab === 'ach') {
      const st = M.achievementStatus(s).sort((a, b) => (b.done && !b.claimed) - (a.done && !a.claimed) || a.claimed - b.claimed);
      list = h('div', null, st.map((a) => h('div', { class: 'check' + (a.claimed ? ' ok' : ''), dataset: { key: 'ach-' + a.id } },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, a.claimed ? '✓' : ''),
        h('div', { class: 'c' }, h('b', null, a.name), h('span', { class: 'muted' }, `${a.desc} · ${rewardText(a.reward)}${a.title ? ` · 칭호 「${TITLES[a.title].name}」` : ''}`),
          h('div', { class: 'pbar gold', role: 'progressbar', 'aria-label': a.name, 'aria-valuenow': String(a.value), 'aria-valuemax': String(a.goal) }, h('i', { style: { width: `${(a.value / a.goal) * 100}%` } }))),
        a.claimed ? h('span', { class: 'muted' }, '완료') : button(a.done ? '받기' : `${fmt(a.value)}/${fmt(a.goal)}`, { cls: 'btn go' + (a.done ? ' btn-primary' : ''), disabled: !a.done, busy: true, onClick: async () => {
          const r = fail(await app.game.claimAchievement(a.id));
          if (r.ok) { grantModal(app, a.name, r.reward); render(); }
        } }))));
    } else {
      list = h('div', null, Object.entries(TITLES).map(([id, t]) => {
        const owned = s.titles.owned.includes(id);
        const on = s.titles.equipped === id;
        const src = ACHIEVEMENTS.find((a) => a.title === id);
        return h('div', { class: 'check' + (on ? ' ok' : ''), dataset: { key: 'title-' + id } },
          h('span', { class: 'mark', 'aria-hidden': 'true' }, on ? '✓' : ''),
          h('div', { class: 'c' }, h('b', null, owned ? t.name : '???'), h('span', { class: 'muted' }, `${bonusText(t.bonus)} · ${src ? `업적 「${src.name}」` : id === 't_season' ? '시즌 패스 30레벨' : ''}`)),
          owned ? button(on ? '해제' : '장착', { cls: 'btn go' + (on ? '' : ' btn-primary'), busy: true, onClick: async () => { const r = fail(await app.game.equipTitle(on ? null : id)); if (r.ok) { app.updateHud(true); render(); } } }) : h('span', { class: 'muted' }, '미획득'));
      }));
    }
    const body = h('div', { dataset: { screen: tab === 'ach' ? 'achievements' : 'titles' } },
      h('p', { class: 'modal-desc' }, '업적을 달성하면 보석·정령 알·칭호를 받아요. 칭호는 하나만 장착하며 닉네임 아래에 보여요.'),
      tabs, h('div', { style: { marginTop: '8px' } }, list));
    const n = M.claimableAchievements(s);
    const actions = [tab === 'ach' && n ? button(`받을 수 있는 업적 ${n}개 모두 받기`, { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.claimAllAchievements()); if (r.ok) { grantModal(app, `업적 ${r.count}개 보상`, r.reward); render(); } } }) : null,
      button('닫기', { cls: 'btn', onClick: () => m.close() })].filter(Boolean);
    if (!m) m = openModal({ id: 'achievements', title: '업적 · 칭호', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= 무료 시즌 패스 =======================
export function openPass(app) {
  let m;
  const render = () => {
    const s = app.state;
    const now = Date.now();
    const st = M.passStatus(s, now);
    const X = PASS.xp;
    const track = h('div', { class: 'pass-track' }, PASS.rewards.map((rw, i) => {
      const lv = i + 1;
      const got = !!s.pass.claimed[lv];
      const can = lv <= st.level && !got;
      const k = Object.keys(rw).find((x) => x !== 'title');
      const icon = rewardIcons({ [k]: rw[k] })[0];
      return h('button', { type: 'button', class: 'pass-cell' + (got ? ' got' : '') + (can ? ' can' : '') + (rw.title ? ' big' : ''), disabled: !can, dataset: { key: 'pass-' + lv }, 'aria-label': `${lv}레벨 ${rewardText(rw)}${got ? ' 받음' : can ? ' 받기' : ''}`,
        onClick: async () => { const r = fail(await app.game.claimPass(lv)); if (r.ok) { grantModal(app, `시즌 패스 ${lv}레벨`, r.reward); render(); } } },
        h('span', { class: 'lv' }, `${lv}`), img(icon.icon, ''), h('b', null, fmt(rw[k])), rw.title ? h('span', { class: 'tt' }, '칭호') : null, got ? h('span', { class: 'stamp', 'aria-hidden': 'true' }, '✓') : null);
    }));
    const body = h('div', { dataset: { screen: 'pass' } },
      h('p', { class: 'modal-desc' }, `시즌 ${st.season} · ${st.daysLeft}일 남음. 무료 보상만 있는 패스예요 — 구매나 유료 트랙은 없어요.`),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, `패스 레벨 ${st.level} / ${PASS.levels}`, h('b', null, st.level >= PASS.levels ? '최고 레벨' : `${st.intoLevel} / ${st.perLevel} XP`)),
        h('div', { class: 'pbar gold', role: 'progressbar', 'aria-label': '패스 경험치', 'aria-valuenow': String(st.intoLevel), 'aria-valuemax': String(st.perLevel) }, h('i', { style: { width: `${(st.intoLevel / st.perLevel) * 100}%` } })),
        h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `XP: 일일 미션 ${X.mission} · 미션 완료 보상 ${X.missionBonus} · 보스 처치 ${X.boss} · 탑 기록 ${X.towerRecord} · 균열 층당 ${X.riftFloor} · 처치 100마리당 ${X.kills100}(하루 ${X.killsDailyCap}까지)`)),
      track);
    const actions = [st.claimable ? button(`받을 수 있는 보상 ${st.claimable}개 모두 받기`, { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.claimAllPass()); if (r.ok) { grantModal(app, `시즌 패스 보상 ${r.count}개`, r.reward); render(); } } }) : null,
      button('닫기', { cls: 'btn', onClick: () => m.close() })].filter(Boolean);
    if (!m) m = openModal({ id: 'pass', title: '시즌 패스 (무료)', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= 동료 =======================
export function openPets(app, focus = null) {
  let m;
  let sel = focus;
  const render = () => {
    const s = app.state;
    const P = s.pets;
    sel = sel && PETS[sel] ? sel : P.active || Object.keys(PETS)[0];
    const cards = h('div', { class: 'pet-cards', role: 'radiogroup', 'aria-label': '동료' }, Object.values(PETS).map((d) => {
      const own = P.owned[d.id];
      return h('button', { type: 'button', class: 'pet-card' + (sel === d.id ? ' pick' : '') + (own ? '' : ' unseen'), role: 'radio', 'aria-checked': String(sel === d.id), dataset: { key: 'pet-' + d.id }, onClick: () => { sel = d.id; render(); } },
        img(petImage(d.id), ''), h('b', null, own ? d.name : '???'),
        h('span', { class: 'muted' }, own ? `Lv ${own.level} · ${'★'.repeat(own.stars)}` : '미보유'),
        P.active === d.id ? h('span', { class: 'pending-tag' }, '동행 중') : null);
    }));
    const d = PETS[sel];
    const own = P.owned[sel];
    const pw = own ? M.petPower(s, sel) : null;
    const feedCost = own && own.level < PET_RULES.maxLevel ? PET_RULES.foodPerLevel(own.level) : null;
    const starNeed = own && own.stars < PET_RULES.maxStars ? PET_RULES.shardsForStar[own.stars - 1] : null;
    const detail = h('div', { class: 'card' },
      h('h3', null, own ? d.name : '아직 만나지 못한 동료'),
      h('p', { class: 'small', style: { margin: '0 0 6px' } }, d.desc),
      own ? h('div', null,
        h('div', { class: 'kv' }, '오라', h('b', null, bonusText(pw.aura))),
        h('div', { class: 'kv' }, '공격', h('b', null, `${d.attack.everySec}초마다 공격력 ${fmtPct(pw.coef, 0)}`)),
        h('div', { class: 'kv' }, '조각', h('b', null, `${own.shards}${starNeed ? ` / 다음 별 ${starNeed}` : ' · 최고 별'}`)),
        h('div', { class: 'btn-row', style: { marginTop: '6px' } },
          button(feedCost ? `먹이 ${feedCost} · 레벨업` : '최고 레벨', { cls: 'btn', disabled: !feedCost || P.food < feedCost, busy: true, onClick: async () => { const r = fail(await app.game.feedPet(sel)); if (r.ok) { toast(`${d.name} Lv ${r.level}`, 'good'); render(); } } }),
          button(starNeed ? `별 올리기 (조각 ${starNeed})` : '최고 별', { cls: 'btn', disabled: !starNeed || own.shards < starNeed, busy: true, onClick: async () => { const r = fail(await app.game.starUpPet(sel)); if (r.ok) { toast(`${d.name} ★${r.stars}`, 'good'); render(); } } })),
        button(P.active === sel ? '동행 해제' : '함께 다니기', { cls: 'btn' + (P.active === sel ? '' : ' btn-primary'), busy: true, onClick: async () => { const r = fail(await app.game.setActivePet(P.active === sel ? null : sel)); if (r.ok) { app.game.syncHero(); render(); } } }))
        : h('p', { class: 'muted' }, '정령 알을 부화하면 만날 수 있어요.'));
    const rate = fmtPct(1 / Object.keys(PETS).length, 1);
    const body = h('div', { dataset: { screen: 'pets' } },
      h('div', { class: 'wallet-row' }, h('span', { class: 'cur' }, ico('petEgg', 'cur-ico'), `알 ${P.eggs}`), h('span', { class: 'cur' }, ico('petFood', 'cur-ico'), `먹이 ${fmtFull(P.food)}`)),
      cards, detail,
      h('p', { class: 'muted' }, `정령 알은 업적·시즌 패스·보스 첫 처치·균열 10층 이상에서 얻어요(판매하지 않아요). 부화 확률은 6종 모두 ${rate}로 같고, 이미 있는 동료가 나오면 조각 1개가 됩니다.`));
    const actions = [button(P.eggs ? `정령 알 부화 (${P.eggs}개)` : '정령 알 없음', { cls: 'btn btn-primary', disabled: !P.eggs, busy: true, onClick: async () => {
      const r = fail(await app.game.hatchEgg());
      if (!r.ok) return;
      sel = r.id;
      if (app.state.settings.sound) sfx('bell');
      const body2 = h('div', { dataset: { screen: 'petHatch' }, style: { textAlign: 'center' } }, img(petImage(r.id), '', 'hatch-img'), h('h3', null, PETS[r.id].name), h('p', { class: 'muted' }, r.isNew ? '새 동료를 만났어요!' : `이미 함께하는 동료예요. 조각 +1 (${r.shards})`));
      const hm = openModal({ id: 'petHatch', title: '부화', kind: 'center', body: body2, actions: [button('확인', { cls: 'btn btn-primary', onClick: () => hm.close() })] });
      app.game.syncHero();
      render();
    } }), button('닫기', { cls: 'btn', onClick: () => m.close() })];
    if (!m) m = openModal({ id: 'pets', title: '동료 (정령)', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= 신화 제작 =======================
export function openCraft(app) {
  let m;
  let slot = 'weapon';
  const render = () => {
    const s = app.state;
    const q = M.craftQuote(s);
    const row = (k, label, icon) => h('div', { class: 'kv' + (q.have[k] < q.cost[k] ? ' short' : '') }, h('span', { class: 'card-title' }, icon, label), h('b', null, `${fmt(q.have[k])} / ${fmt(q.cost[k])}`));
    const slots = h('div', { class: 'tabs tabs-wrap', role: 'group', 'aria-label': '부위' }, CRAFT.slots.map((x) => h('button', { type: 'button', class: 'tab', 'aria-pressed': String(slot === x), onClick: () => { slot = x; render(); } }, SLOT_NAMES[x] || (x === 'ring' ? '반지' : x))));
    const body = h('div', { dataset: { screen: 'craft' } },
      h('p', { class: 'modal-desc' }, q.open ? '레이드·균열 재료로 원하는 부위의 신화(VI) 장비를 확정 제작해요. 무기는 지금 클래스의 무기로 만들어져요.' : `Lv ${CRAFT.unlock.level} 달성 또는 ${BOSSES[CRAFT.unlock.boss].name} 처치 후 열려요.`),
      h('div', { class: 'card' }, h('h3', null, '만들 부위'), slots),
      h('div', { class: 'card' }, h('h3', null, '필요 재료'),
        row('starShard', '별의 파편', img(itemIcon(CURRENCY_ICONS.starShard || CURRENCY_ICONS.gem), '', 'cur-ico')),
        row('essence', '환생 정수', ico('essence', 'cur-ico')),
        row('ore', '강화 광석', img(itemIcon(CURRENCY_ICONS.ore), '', 'cur-ico')),
        row('gold', '골드', img(itemIcon(CURRENCY_ICONS.gold), '', 'cur-ico')),
        h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '별의 파편: 레이드·시련의 탑 30층 이상·타락한 대천사. 환생 정수: 환생·균열·시즌 패스. 신화 고유 효과는 무작위로 붙어요.')));
    const actions = [button(q.ok ? `${SLOT_NAMES[slot] || '반지'} 신화 제작` : q.open ? '재료 부족' : '아직 잠김', { cls: 'btn btn-primary', disabled: !q.ok, busy: true, onClick: async () => {
      const r = fail(await app.game.craftMythic(slot));
      if (!r.ok) return;
      if (app.state.settings.sound) sfx('bell');
      const it = r.item;
      const b2 = h('div', { dataset: { screen: 'craftResult' }, style: { textAlign: 'center' } }, img(itemIcon(it.look), '', 'hatch-img'), h('h3', { class: 'rar r-mythic' }, `${rarityLabel(it.rarity)} ${it.name}`), h('p', { class: 'muted' }, `Lv ${it.level} · 장비 탭에서 장착할 수 있어요.`));
      const cm = openModal({ id: 'craftResult', title: '제작 완료', kind: 'center', body: b2, actions: [button('확인', { cls: 'btn btn-primary', onClick: () => cm.close() })] });
      render();
    } }), button('닫기', { cls: 'btn', onClick: () => m.close() })];
    if (!m) m = openModal({ id: 'craft', title: '신화 제작', body, actions }); else { m.setBody(body); m.setActions(actions); }
  };
  render();
  return m;
}

// ======================= menu tiles =======================
export function v6Tiles(app) {
  const s = app.state;
  const now = Date.now();
  const ps = M.passStatus(s, now);
  const ach = M.claimableAchievements(s);
  return [
    { id: 'pass', em: V6_ICONS.pass, t: '시즌 패스', s: `무료 · Lv ${ps.level}/${PASS.levels}`, dot: ps.claimable > 0, on: () => openPass(app) },
    { id: 'achievements', em: V6_ICONS.achievement, t: '업적·칭호', s: ach ? `받기 ${ach}개` : `${Object.keys(s.achievements.claimed).length}/${ACHIEVEMENTS.length}`, dot: ach > 0, on: () => openAchievements(app) },
    { id: 'pets', em: V6_ICONS.petEgg, t: '동료', s: s.pets.active ? `${PETS[s.pets.active].name} 동행` : s.pets.eggs ? `알 ${s.pets.eggs}개` : `${Object.keys(s.pets.owned).length}/6`, dot: s.pets.eggs > 0, on: () => openPets(app) },
    { id: 'codex', em: V6_ICONS.codexMonster, t: '도감', s: `${M.codexTiersTotal(s)}단계 · 장비 ${Object.keys(s.codex.items).length}`, on: () => openCodex(app) },
    { id: 'craft', em: V6_ICONS.craft, t: '신화 제작', s: M.craftOpen(s) ? (M.craftQuote(s).ok ? '제작 가능' : '재료 모으는 중') : 'Lv 90부터', dot: M.craftQuote(s).ok, on: () => openCraft(app) },
  ];
}
