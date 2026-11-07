// v8 콘텐츠 UI: 쐐기 던전 (more systems are added below as they land).
import { CURRENCY_ICONS, RARITY } from '../data/content.js';
import { itemIcon, skillIcon } from '../render/assets.js';
import * as MP from '../core/mplus.js';
import { fmt } from '../core/util.js';
import { sfx } from '../platform/audio.js';
import { button, h, img, openModal } from './dom.js';
import { fail, itemRewards, rewardTiles } from './screens.js';

const ico = (id) => { try { return img(skillIcon(id), '', 'emblem'); } catch { return null; } };
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
