// v8 콘텐츠 UI: 쐐기 던전 (more systems are added below as they land).
import { CURRENCY_ICONS, RARITY } from '../data/content.js';
import { itemIcon, skillIcon } from '../render/assets.js';
import * as MP from '../core/mplus.js';
import * as EX from '../core/expedition.js';
import * as WBm from '../core/worldboss.js';
import { BOSSES, SLOT_NAMES } from '../data/content.js';
import * as CR from '../core/crafting.js';
import { PETS } from '../data/meta.js';
import { fmt, fmtPct } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal, toast } from './dom.js';
import { fail, itemRewards, rewardTiles } from './screens.js';

const ico = (id) => { try { return img(skillIcon(id), '', 'emblem'); } catch { return null; } };
const jewelTiles = (js) => (js || []).map((g) => ({ icon: itemIcon(CURRENCY_ICONS.gem), value: CR.jewelName(g.type, g.lv), label: '보옥' }));
const pctTxt = (t) => Object.entries(t).map(([r, p]) => `${RARITY[r].name} ${Math.round(p * 1000) / 10}%`).join(' · ');

// ======================= 쐐기 던전 =======================
export function mplusCard(app) {
  const s = app.state;
  const now = Date.now();
  if (!MP.mplusOpen(s)) return h('div', { class: 'card locked-card', dataset: { screen: 'mplus' } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '쐐기 던전'), h('span', { class: 'muted' }, '잠김')), h('p', { class: 'muted', style: { margin: 0 } }, '폐광 파수꾼 처치(Lv 30) 시 열림'));
  const m = MP.refreshMplus(s, now);
  const aff = MP.affixesFor(now).map((a) => MP.AFFIXES[a].name).join(' · ');
  const left = MP.rewardedLeft(s, now);
  return h('div', { class: 'card', dataset: { screen: 'mplus' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, ico('R04'), h('b', { style: { color: 'var(--text)' } }, '쐐기 던전')), h('b', null, `열쇠 +${m.key}`)),
    h('div', { class: 'kv' }, '이번 주 변칙', h('b', null, aff)),
    h('div', { class: 'kv' }, '오늘 보상', h('b', null, `${left}/${MP.MPLUS.runsPerDay}회 남음 · 주간 최고 +${m.weekBest || 0}`)),
    m.vault ? h('div', { class: 'kv' }, h('span', { class: 'okc' }, '주간 금고 도착'), h('b', null, `지난주 +${m.vault.best}`)) : null,
    h('div', { class: 'btn-row' },
      button('쐐기 던전', { cls: 'btn btn-primary', disabled: app.game.mode !== 'FARM', onClick: () => openMplus(app) }),
      m.vault ? button('금고 열기', { cls: 'btn', busy: true, onClick: () => claimVault(app) }) : null));
}

async function claimVault(app) {
  const r = fail(await app.game.claimMplusVault());
  if (!r.ok) return;
  if (app.state.settings.sound) sfx('bell');
  const vm = openModal({ id: 'mplusVault', title: `주간 금고 · 지난주 +${r.best}`, kind: 'center', body: h('div', { dataset: { screen: 'mplusVault' } }, rewardTiles([
    { icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + r.reward.gem, label: '보석' },
    { icon: itemIcon(CURRENCY_ICONS.chest), value: '+' + r.reward.eqTicket, label: '장비 뽑기권' },
    r.reward.skTicket ? { icon: itemIcon(CURRENCY_ICONS.goldChest), value: '+' + r.reward.skTicket, label: '스킬 뽑기권' } : null].filter(Boolean))),
  actions: [button('확인', { cls: 'btn btn-primary', onClick: () => vm.close() })] });
  app.renderPanel();
}

export function openMplus(app) {
  const s = app.state;
  const now = Date.now();
  const m = MP.refreshMplus(s, now);
  const key = m.key;
  const affs = MP.affixesFor(now);
  const R = MP.MPLUS.reward;
  const left = MP.rewardedLeft(s, now);
  const rows = Object.entries(MP.MPLUS.dungeons).map(([id, d]) => h('div', { class: 'mp-row' },
    h('div', { class: 'mp-name' }, h('b', null, d.name), h('span', { class: 'muted small' }, `최고 +${m.best[id] || 0} · 시간 내 +${m.bestTimed[id] || 0}`)),
    button(`+${key} 도전`, { cls: 'btn btn-primary', busy: true, disabled: app.game.mode !== 'FARM', onClick: async () => { const r = fail(await app.game.startMplus(id)); if (r.ok) modal.close(); } })));
  const body = h('div', { dataset: { screen: 'mplusPick' } },
    h('p', { class: 'modal-desc' }, `적 ${MP.MPLUS.trash}마리를 쓰러뜨리면 던전 보스가 나와요. ${MP.MPLUS.timeSec}초 안에 보스까지 잡으면 열쇠가 오르고, 남은 시간이 ${MP.MPLUS.plus2 * 100}% 이상이면 +2, ${MP.MPLUS.plus3 * 100}% 이상이면 +3. 시간을 넘겨 끝내면 열쇠는 그대로, 실패·포기하면 1단계 내려가요(최소 +${MP.MPLUS.minKey}).`),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, '현재 열쇠', h('b', null, `+${key} · 적 Lv ${MP.enemyLevel(s)} · 강도 ×${MP.keyMul(key).toFixed(2)}`)),
      ...affs.map((a) => h('div', { class: 'kv' }, `변칙 · ${MP.AFFIXES[a].name}`, h('b', null, MP.AFFIXES[a].desc))),
      h('div', { class: 'kv' }, '보상(시간 내)', h('b', null, `보석 ${R.gemBase + R.gemPerKey * key} · 광석 ${R.oreBase + R.orePerKey * key} · 장비 1(+3이면 2)`)),
      h('div', { class: 'kv' }, '장비 등급 확률', h('span', { class: 'muted small' }, pctTxt(MP.rarityTable(key)))),
      h('div', { class: 'kv' }, '오늘 보상 횟수', h('b', null, `${left}/${MP.MPLUS.runsPerDay} (다 쓰면 열쇠만 오르내려요)`))),
    h('div', { class: 'section-title' }, '던전 고르기'), rows,
    h('div', { class: 'card', style: { marginTop: '8px' } },
      h('div', { class: 'kv' }, '이번 주 최고(시간 내)', h('b', null, `+${m.weekBest || 0}`)),
      h('div', { class: 'kv' }, '다음 주 금고', h('b', null, m.weekBest ? (() => { const v = MP.vaultReward(m.weekBest); return `보석 ${v.gem} · 장비권 ${v.eqTicket}${v.skTicket ? ` · 스킬권 ${v.skTicket}` : ''}`; })() : '시간 내 완료 기록이 있으면 생겨요'))));
  const modal = openModal({ id: 'mplus', title: '쐐기 던전', body, kind: 'full' });
  return modal;
}

export function openMplusResult(app, r, back) {
  const name = (MP.MPLUS.dungeons[r.dungeon] || {}).name || '';
  const tiles = [];
  if (r.reward.gem) tiles.push({ icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + r.reward.gem, label: '보석' });
  if (r.reward.ore) tiles.push({ icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + r.reward.ore, label: '강화 광석' });
  tiles.push(...itemRewards(r.items || []));
  tiles.push(...jewelTiles(r.jewels));
  const head = r.result === 'timed' ? `시간 내 완료 · ${fmt(r.timeSec)}초` : r.result === 'overtime' ? `시간 초과 완료 · ${fmt(r.timeSec)}초` : r.reason === 'forfeit' ? '포기' : r.reason === 'timeout' ? '제한 시간 초과(실패)' : '실패';
  const keyTxt = r.result === 'timed' ? `열쇠 +${r.key} → +${r.newKey} (▲${r.delta})` : r.result === 'overtime' ? `열쇠 +${r.newKey} 유지` : `열쇠 +${r.key} → +${r.newKey}`;
  if (app.state.settings.sound && r.result === 'timed') sfx('bell');
  const m = openModal({ id: 'mplusResult', title: `쐐기 +${r.key} · ${name}`, dismissible: false,
    body: h('div', { dataset: { screen: 'mplusResult' }, class: 'reveal' },
      h('p', null, h('b', null, head)), h('p', { class: r.result === 'timed' ? 'okc' : r.result === 'fail' ? 'warn' : 'muted' }, keyTxt),
      tiles.length ? rewardTiles(tiles) : null,
      !r.rewarded ? h('p', { class: 'muted' }, '오늘 보상 횟수를 모두 써서 열쇠만 바뀌었어요.') : r.result === 'overtime' ? h('p', { class: 'muted' }, '시간을 넘겨 보상이 절반이고 장비 등급이 한 단계 낮아요.') : null,
      r.overflowed && r.overflowed.length ? h('p', { class: 'warn' }, `보관함이 가득 차 ${r.overflowed.length}개는 임시 보관함에 들어갔습니다.`) : null),
    actions: [
      button(`+${r.newKey} 바로 도전`, { cls: 'btn btn-primary', onClick: () => { m.close(); chainNext(app, back, r.dungeon); } }),
      button('확인', { cls: 'btn', onClick: () => { m.close(); back(); app.setTab('dungeon'); } })].filter(Boolean) });
  return m;
}

// Next key without leaving the battle screen (like the tower). startMplus is async (it
// saves the attempt first), so the immersive view is kept and dropped only on failure.
function chainNext(app, back, dungeon) {
  app.chainSession(back, () => ({ ok: true }));
  app.game.startMplus(dungeon).then((res) => {
    if (res.ok) return;
    fail(res);
    app.forcedBattleView = false; app.applyView(); app.setImmersive(false); app.renderSession();
  });
}

export const mplusDot = (s) => MP.mplusOpen(s) && (!!(s.mplus && s.mplus.vault) || MP.rewardedLeft(s, Date.now()) > 0);

// ======================= 원정 파견 =======================
const hm = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const rwTxt = (type, n) => `${EX.EXP_REWARD_NAMES[type]} ×${n}`;

export function expeditionCard(app) {
  const s = app.state;
  const now = Date.now();
  if (!EX.expeditionOpen(s)) return h('div', { class: 'card locked-card', dataset: { screen: 'expedition' } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '원정 파견'), h('span', { class: 'muted' }, '잠김')), h('p', { class: 'muted', style: { margin: 0 } }, '첫 동료를 얻으면 열림 (메뉴 › 동료 · 정령 알 부화)'));
  const e = EX.refreshExpedition(s, now);
  const busy = e.slots.filter(Boolean).length;
  const ready = EX.readyCount(s, now);
  return h('div', { class: 'card', dataset: { screen: 'expedition' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, ico('V10'), h('b', { style: { color: 'var(--text)' } }, '원정 파견')), h('b', null, `${busy}/${EX.EXPEDITION.slots} 진행 중`)),
    h('div', { class: 'kv' }, '오늘 원정 목록', h('b', null, `${e.board.length}개 남음 · 매일 00:00 갱신`)),
    ready ? h('div', { class: 'kv' }, h('span', { class: 'okc' }, `${ready}개 원정 완료`), h('b', null, '보상 받기')) : null,
    h('div', { class: 'btn-row' }, button(ready ? `보상 받기 (${ready})` : '원정 보내기', { cls: 'btn btn-primary', onClick: () => openExpedition(app) })));
}

export function openExpedition(app) {
  let timer = null;
  let pickFor = null;   // expedition id whose "동료 바꾸기" list is open
  const m = openModal({ id: 'expedition', title: '원정 파견', body: h('div'), kind: 'full', onClose: () => clearInterval(timer) });
  const diff = (x) => (x.hours <= 2 ? '쉬움' : x.hours <= 4 ? '보통' : '어려움');
  const render = () => {
    const s = app.state;
    const now = Date.now();
    const e = EX.refreshExpedition(s, now);
    const busy = EX.busyPets(s);
    const pets = Object.keys(s.pets.owned);
    const freePets = pets.filter((p) => !busy.has(p));
    const freeSlots = e.slots.filter((x) => !x).length;
    const ready = EX.readyCount(s, now);
    const running = e.slots.map((x, i) => [x, i]).filter(([x]) => x);
    const canAuto = freeSlots > 0 && freePets.length > 0 && e.board.length > 0;
    // 1) 한눈에: 칸 · 쉬는 동료 · 큰 버튼 두 개
    const top = h('div', { class: 'card exp-top' },
      h('div', { class: 'kv' }, '파견 칸', h('b', null, `${running.length}/${EX.EXPEDITION.slots} 사용 중`)),
      h('div', { class: 'kv' }, '쉬는 동료', h('b', null, freePets.length ? freePets.map(EX.petName).join(', ') : '없음 (모두 원정 중)')),
      h('div', { class: 'btn-row' },
        ready ? button(`보상 받기 (${ready})`, { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.claimAllExpeditions()); if (r.ok) { showExpResults(app, r.results); render(); } } }) : null,
        button(canAuto ? '자동 파견' : freePets.length ? (freeSlots ? '보낼 원정 없음' : '파견 칸이 가득 참') : '쉬는 동료 없음', { cls: 'btn' + (ready ? '' : ' btn-primary'), disabled: !canAuto, busy: true,
          onClick: async () => { const r = fail(await app.game.sendExpeditionAuto()); if (r.ok) { toast(`${r.sent.length}곳에 원정을 보냈어요`, 'good'); render(); } } })),
      h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, '자동 파견: 쉬는 동료를 성공률이 좋은 원정에 알아서 보내요. 동료 한 마리는 원정 하나만 갈 수 있어요.'));
    // 2) 진행 중 (진행 막대)
    const runRows = running.map(([x, i]) => {
      const done = now >= x.endAt, p = Math.min(1, (now - x.startAt) / (x.endAt - x.startAt));
      return h('div', { class: 'card exp-run' },
        h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, `${x.exp.name}`), h('b', null, rwTxt(x.exp.type, x.exp.amount))),
        h('div', { class: 'muted small' }, `${EX.petName(x.pet)} · 성공 ${Math.round(x.chance * 100)}%`),
        h('div', { class: 'exp-bar' }, h('i', { style: { width: Math.round(p * 100) + '%' } })),
        done ? button('받기', { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = fail(await app.game.claimExpedition(i)); if (r.ok) { showExpResults(app, [r]); render(); } } })
          : h('div', { class: 'small', dataset: { end: x.endAt } }, `남은 시간 ${hm(x.endAt - now)}`));
    });
    // 3) 오늘의 원정: 보상 크게, 버튼 하나 (가장 성공률 높은 쉬는 동료가 감)
    const board = e.board.map((x) => {
      const best = EX.bestPetFor(s, x, busy);
      const why = !freeSlots ? '파견 칸이 가득 참' : !best ? '쉬는 동료 없음' : null;
      const send = async (pid) => { const r = fail(await app.game.sendExpedition(x.id, pid)); if (r.ok) { pickFor = null; render(); } };
      return h('div', { class: 'card exp-card' },
        h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, `${x.name}`), h('b', { class: 'exp-reward' }, rwTxt(x.type, x.amount))),
        h('div', { class: 'muted small' }, `${x.hours}시간 · 난이도 ${diff(x)}${best ? ` · ${EX.petName(best.pet)} 보내면 성공 ${Math.round(best.chance * 100)}%` : ''}`),
        h('div', { class: 'btn-row' },
          button(why || `${best ? EX.petName(best.pet) : ''} 보내기`, { cls: 'btn btn-primary', disabled: !!why, busy: true, onClick: () => send(best.pet) }),
          freePets.length > 1 && !why ? button(pickFor === x.id ? '닫기' : '동료 바꾸기', { cls: 'btn', onClick: () => { pickFor = pickFor === x.id ? null : x.id; render(); } }) : null),
        pickFor === x.id ? h('div', { class: 'exp-pets' }, freePets.map((pid) => {
          const ch = EX.successChance(s, pid, x).success;
          return button(`${EX.petName(pid)} · 성공 ${Math.round(ch * 100)}%`, { cls: 'btn small-btn', busy: true, onClick: () => send(pid) });
        })) : null);
    });
    m.setBody(h('div', { dataset: { screen: 'expeditionList' } },
      top,
      running.length ? h('div', { class: 'section-title' }, '진행 중') : null, ...runRows,
      h('div', { class: 'section-title' }, `오늘의 원정 ${e.board.length}개 · 00:00 갱신`),
      board.length ? board : h('p', { class: 'muted' }, '오늘 원정을 모두 보냈어요. 00:00(KST)에 새 목록이 와요.'),
      h('p', { class: 'muted small' }, `원정은 앱을 꺼도 실제 시간으로 진행되고, 원정 중인 동료도 전투는 계속 도와요. 동료 레벨·별이 높을수록 성공률이 올라요. 대성공이면 보상 2배, 실패해도 30%. 보유 재료: 달빛 약초 ${s.craft.herb} · 야수 고기 ${s.craft.meat} · 동료 먹이 ${s.pets.food}`)));
  };
  render();
  timer = setInterval(() => {
    const els = m.el ? m.el.querySelectorAll('[data-end]') : document.querySelectorAll('[data-screen="expeditionList"] [data-end]');
    let done = false;
    for (const el of els) { const left = Number(el.dataset.end) - Date.now(); if (left <= 0) done = true; else el.textContent = `남은 시간 ${hm(left)}`; }
    if (done) render();
  }, 1000);
  return m;
}

function showExpResults(app, results) {
  if (app.state.settings.sound) sfx('bell');
  const RES = { great: '대성공! ×2', success: '성공', fail: '실패 · 30%' };
  const lines = results.map((r) => h('div', { class: 'kv' }, `${r.name} · ${EX.petName(r.pet)}`, h('b', { class: r.result === 'fail' ? 'warn' : 'okc' }, `${RES[r.result]} · ${r.jewels && r.jewels.length ? r.jewels.map((g) => CR.jewelName(g.type, g.lv)).join(', ') : rwTxt(r.type, r.amount)}`)));
  const rm = openModal({ id: 'expResult', title: '원정 결과', kind: 'center', body: h('div', { dataset: { screen: 'expResult' } }, lines), actions: [button('확인', { cls: 'btn btn-primary', onClick: () => rm.close() })] });
}
export const expeditionDot = (s) => EX.expeditionOpen(s) && (EX.readyCount(s, Date.now()) > 0 || (s.expedition && s.expedition.slots.some((x) => !x) && (s.expedition.board || []).length > 0));

// ======================= 월드 보스 =======================
const hhmm = (ms) => { const d = new Date(ms + 9 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export function worldBossCard(app) {
  const s = app.state;
  const now = Date.now();
  if (!WBm.worldBossOpen(s)) return h('div', { class: 'card locked-card', dataset: { screen: 'worldBoss' } }, h('div', { class: 'kv' }, h('b', { style: { color: 'var(--text)' } }, '월드 보스'), h('span', { class: 'muted' }, '잠김')), h('p', { class: 'muted', style: { margin: 0 } }, '폐광 파수꾼 처치 시 열림'));
  const c = WBm.canChallenge(s, now);
  const boss = BOSSES[WBm.worldBossId(now)];
  const win = WBm.currentWindow(now);
  const status = c.ok ? `지금 열림 · ${String(win.hour).padStart(2, '0')}:00~${String(win.hour + 1).padStart(2, '0')}:00` : c.reason === 'used' ? `이번 시간 도전 완료 · 다음 ${hhmm(c.next.start)}` : `다음 ${c.next ? hhmm(c.next.start) : ''}`;
  return h('div', { class: 'card' + (c.ok ? ' hot-card' : ''), dataset: { screen: 'worldBoss' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, ico('V15'), h('b', { style: { color: 'var(--text)' } }, `월드 보스 · ${boss.name}`)), h('b', null, c.ok ? '도전 가능' : '대기')),
    h('div', { class: 'kv' }, '시간대(매일)', h('b', null, '12시 · 18시 · 21시 (각 1시간, 1회)')),
    h('div', { class: 'kv' }, '상태', h('b', null, status)),
    h('div', { class: 'kv' }, '최고 기록', h('b', null, s.worldBoss.best ? `${s.worldBoss.bestGrade} · 피해 ${fmt(s.worldBoss.best)}` : '없음')),
    h('p', { class: 'muted', style: { margin: '2px 0 6px' } }, `${WBm.WB.timeSec}초 동안 준 피해로 등급(D~S). 보석·광석, B 이상 장비 뽑기권, A·S는 장비 확정. 보스는 요일마다 바뀌어요.`),
    button(c.ok ? '월드 보스 도전' : c.reason === 'used' ? '다음 시간대에 도전' : '시간대가 아니에요', { cls: 'btn btn-primary', disabled: !c.ok || app.game.mode !== 'FARM', busy: true, onClick: async () => fail(await app.game.startWorldBoss()) }));
}

export function openWorldBossResult(app, r, back) {
  const tiles = [{ icon: itemIcon(CURRENCY_ICONS.gem), value: '+' + r.reward.gem, label: '보석' }, { icon: itemIcon(CURRENCY_ICONS.ore), value: '+' + r.reward.ore, label: '강화 광석' }];
  if (r.reward.eqTicket) tiles.push({ icon: itemIcon(CURRENCY_ICONS.chest), value: '+' + r.reward.eqTicket, label: '장비 뽑기권' });
  if (r.reward.skTicket) tiles.push({ icon: itemIcon(CURRENCY_ICONS.goldChest), value: '+' + r.reward.skTicket, label: '스킬 뽑기권' });
  tiles.push(...itemRewards(r.items || []));
  tiles.push(...jewelTiles(r.jewels));
  if (app.state.settings.sound) sfx('bell');
  const m = openModal({ id: 'worldBossResult', title: `월드 보스 · ${r.grade} 등급`, dismissible: false,
    body: h('div', { dataset: { screen: 'worldBossResult' }, class: 'reveal' },
      h('p', null, `피해 ${fmt(r.damage)} · 보스 체력의 ${Math.round(r.share * 100)}%`),
      h('p', { class: 'muted small' }, `등급 기준: ${WBm.WB.grades.filter(([g]) => g !== 'D').map(([g, t]) => `${g} ${Math.round(t * 100)}%`).join(' · ')}`),
      rewardTiles(tiles),
      r.overflowed && r.overflowed.length ? h('p', { class: 'warn' }, `보관함이 가득 차 ${r.overflowed.length}개는 임시 보관함에 들어갔습니다.`) : null),
    actions: [button('확인', { cls: 'btn btn-primary', onClick: () => { m.close(); back(); app.setTab('dungeon'); } })] });
  return m;
}
export const worldBossDot = (s) => WBm.canChallenge(s, Date.now()).ok;

// ======================= 제작소: 보옥 · 마부 · 버프 음식 =======================
const EQ_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'];
const pct1 = (v) => `+${Math.round(v * 1000) / 10}%`;
const jewelText = (g) => `${CR.jewelName(g.t, g.lv)} · ${CR.JEWELS[g.t].label} ${pct1(CR.JEWELS[g.t].values[g.lv - 1])}`;

export function workshopCard(app) {
  const s = app.state;
  const now = Date.now();
  const c = s.craft || {};
  const jewels = Object.values(c.jewels || {}).reduce((a, b) => a + b, 0);
  const f = CR.activeFood(s, now);
  return h('div', { class: 'card', dataset: { screen: 'workshopCard' } },
    h('div', { class: 'kv' }, h('span', { class: 'card-title' }, ico('V09'), h('b', { style: { color: 'var(--text)' } }, '제작소 · 보옥 · 마부 · 음식')), h('b', null, `보옥 ${jewels}개`)),
    h('div', { class: 'kv' }, '재료', h('b', null, `달빛 약초 ${c.herb || 0} · 야수 고기 ${c.meat || 0}`)),
    h('div', { class: 'kv' }, '버프 음식', h('b', null, f ? `${CR.FOODS[f.id].name} · ${Math.ceil((f.until - now) / 60000)}분 남음` : '없음')),
    h('div', { class: 'btn-row' }, button('제작소 열기', { cls: 'btn btn-primary', onClick: () => openWorkshop(app) })));
}

export function openWorkshop(app, tab = 'jewel', focusItem = null) {
  let pick = null;   // { itemId, idx } while choosing a jewel for a socket
  const m = openModal({ id: 'workshop', title: '제작소', body: h('div'), kind: 'full', onClose: () => app.renderPanel && app.renderPanel() });
  const seg = () => h('div', { class: 'seg', role: 'tablist', 'aria-label': '제작소' }, [['jewel', '보옥'], ['enchant', '마부'], ['food', '버프 음식']].map(([k, t]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), 'aria-pressed': String(tab === k), onClick: () => { tab = k; pick = null; render(); } }, t)));
  const act = async (p) => { const r = fail(await p); if (r.ok) render(); return r; };

  const jewelTab = (s) => {
    const items = [];
    for (const k of EQ_SLOTS) { const it = s.equipped[k] && s.inventory.find((i) => i.id === s.equipped[k]); if (it && CR.socketCount(it)) items.push([k, it]); }
    if (focusItem) { const it = s.inventory.find((i) => i.id === focusItem); if (it && CR.socketCount(it) && !items.some(([, x]) => x.id === it.id)) items.unshift([null, it]); }
    const rows = items.length ? items.map(([k, it]) => h('div', { class: 'card ws-item' },
      h('div', { class: 'kv' }, h('span', { class: 'card-title' }, img(itemIcon(it.look), '', 'emblem'), h('b', { style: { color: 'var(--text)' } }, `${k ? SLOT_NAMES[k] + ' · ' : ''}${it.name}`)), h('span', { class: `rar r-${it.rarity}` }, RARITY[it.rarity].name)),
      h('div', { class: 'ws-sockets' }, Array.from({ length: CR.socketCount(it) }, (_, i) => {
        const g = it.gems && it.gems[i];
        const sel = pick && pick.itemId === it.id && pick.idx === i;
        return g ? button(jewelText(g), { cls: 'btn small-btn jewel-' + g.t, ariaLabel: `${jewelText(g)} 빼기`, busy: true, onClick: () => act(app.game.unsocketJewel(it.id, i)) })
          : button(sel ? '보옥을 고르세요 ↓' : `빈 홈 ${i + 1} +`, { cls: 'btn small-btn' + (sel ? ' btn-primary' : ''), onClick: () => { pick = sel ? null : { itemId: it.id, idx: i }; render(); } });
      })))) : [h('p', { class: 'muted' }, '홈이 있는 장비를 끼고 있지 않아요. 영웅 1칸 · 전설 2칸 · 신화 3칸.')];
    const bag = Object.entries(s.craft.jewels || {}).filter(([, n]) => n > 0).map(([k, n]) => { const [t, lv] = k.split(':'); return { t, lv: Number(lv), n }; })
      .sort((a, b) => CR.JEWEL_TYPES.indexOf(a.t) - CR.JEWEL_TYPES.indexOf(b.t) || b.lv - a.lv);
    const bagRows = bag.length ? bag.map((j) => h('div', { class: 'mp-row' },
      h('div', { class: 'mp-name' }, h('b', { class: 'jewel-' + j.t }, `${CR.jewelName(j.t, j.lv)} ×${j.n}`), h('span', { class: 'muted small' }, `${CR.JEWELS[j.t].label} ${pct1(CR.JEWELS[j.t].values[j.lv - 1])}`)),
      pick ? button('끼우기', { cls: 'btn btn-primary', busy: true, onClick: async () => { const r = await act(app.game.socketJewel(pick.itemId, pick.idx, j.t, j.lv)); if (r.ok) { pick = null; render(); } } })
        : button(j.lv >= CR.MAX_JEWEL_LV ? '최대' : `합성 3→1`, { cls: 'btn', disabled: j.n < 3 || j.lv >= CR.MAX_JEWEL_LV, busy: true, onClick: () => act(app.game.combineJewel(j.t, j.lv)) }))) : [h('p', { class: 'muted' }, '가방이 비었어요. 쐐기 던전(시간 내), 월드 보스(B 이상), 보옥 원정에서 얻어요.')];
    return [h('p', { class: 'modal-desc' }, '장비 홈에 보옥을 끼우면 능력치가 올라요. 빼기는 무료, 장비를 분해하면 보옥은 가방으로 돌아와요. 같은 보옥 3개로 다음 단계 1개를 만들어요(최대 5단계).'),
      h('div', { class: 'section-title' }, '장착 장비의 홈'), ...rows,
      h('div', { class: 'section-title' }, pick ? '끼울 보옥 고르기' : '보옥 가방'), ...bagRows,
      h('p', { class: 'muted small' }, `단계별 효과: ${CR.JEWEL_TYPES.map((t) => `${CR.JEWELS[t].name}(${CR.JEWELS[t].label}) ${CR.JEWELS[t].values.map((v) => pct1(v).slice(1)).join('/')}`).join(' · ')}`)];
  };

  const enchantTab = (s) => {
    const C = CR.ENCHANT.cost;
    if (!CR.enchantOpen(s)) return [h('p', { class: 'muted' }, '폐광 파수꾼을 처치하면 마부가 열려요.')];
    const total = CR.ENCHANT.options.reduce((a, o) => a + o.w, 0);
    return [h('p', { class: 'modal-desc' }, `장비 슬롯마다 추가 옵션 1줄을 붙여요. 슬롯 강화처럼 장비를 바꿔도 그대로예요. 다시 굴리면 새 옵션으로 바뀌어요(잠금 없음). 비용: 강화 광석 ${C.ore} · 각성석 ${C.awakenStone}.`),
      h('div', { class: 'kv' }, '보유', h('b', null, `강화 광석 ${fmt(s.wallet.ore)} · 각성석 ${s.wallet.awakenStone || 0}`)),
      ...EQ_SLOTS.map((k) => { const e = s.craft.enchant[k]; return h('div', { class: 'mp-row', dataset: { slot: k } },
        h('div', { class: 'mp-name' }, h('b', null, SLOT_NAMES[k]), h('span', { class: e ? 'okc small' : 'muted small' }, e ? `${CR.enchantLabel(e)} ${pct1(e.value)}` : '마부 없음')),
        button(e ? '다시 굴리기' : '마부', { cls: 'btn' + (e ? '' : ' btn-primary'), disabled: s.wallet.ore < C.ore || (s.wallet.awakenStone || 0) < C.awakenStone, busy: true, onClick: () => act(app.game.enchantSlot(k)) })); }),
      h('p', { class: 'muted small' }, '옵션 확률·범위: ' + CR.ENCHANT.options.map((o) => `${o.label} ${Math.round(o.w / total * 100)}% (${pct1(o.min).slice(1)}~${pct1(o.max).slice(1)})`).join(' · '))];
  };

  const foodTab = (s) => {
    const now = Date.now();
    const f = CR.activeFood(s, now);
    return [h('p', { class: 'modal-desc' }, `원정에서 모은 재료로 음식을 만들어요. ${CR.FOOD_MIN}분 동안 효과, 한 번에 하나만(새로 먹으면 바뀌어요).`),
      h('div', { class: 'kv' }, '재료', h('b', null, `달빛 약초 ${s.craft.herb || 0} · 야수 고기 ${s.craft.meat || 0}`)),
      h('div', { class: 'kv' }, '지금 효과', h('b', null, f ? `${CR.FOODS[f.id].name} (${CR.FOODS[f.id].desc}) · ${Math.ceil((f.until - now) / 60000)}분` : '없음')),
      ...Object.entries(CR.FOODS).map(([id, x]) => h('div', { class: 'mp-row' },
        h('div', { class: 'mp-name' }, h('b', null, `${x.name} · ${x.desc}`), h('span', { class: 'muted small' }, `약초 ${x.cost.herb} · 고기 ${x.cost.meat}`)),
        button('만들어 먹기', { cls: 'btn btn-primary', disabled: (s.craft.herb || 0) < x.cost.herb || (s.craft.meat || 0) < x.cost.meat, busy: true, onClick: async () => { const r = await act(app.game.cookFood(id)); if (r.ok) toast(`${x.name} · ${x.desc} ${CR.FOOD_MIN}분`, 'good'); } })))];
  };

  const render = () => {
    const s = app.state;
    const content = tab === 'jewel' ? jewelTab(s) : tab === 'enchant' ? enchantTab(s) : foodTab(s);
    m.setBody(h('div', { dataset: { screen: 'workshop', tab } }, seg(), ...content));
  };
  render();
  return m;
}
export const v8Tiles = (app) => [{ id: 'workshop', ic: 'equipment', em: 'V09', t: '제작소', s: '보옥 · 마부 · 음식', on: () => openWorkshop(app) }];
