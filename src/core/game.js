// Game orchestrator: state machine, combat <-> state, transactions, offline flow.
//
// Modes: BOOT → LOAD → FARM ↔ BOSS; FARM → DEFEAT → FARM (death, 3 s);
//        DUNGEON → RESULT → FARM; PROMOTION_TRIAL → RESULT → FARM;
//        OFFLINE (claim pending, sim paused); CONFLICT (another tab owns the save).
// UI tab changes never change the mode. Hidden tab = sim stopped + settle on return.
//
// Transactions: `transact(fn)` runs fn on a clone of the state, commits the clone,
// and only on a successful commit swaps it in and emits the result. A failed save
// leaves the live state untouched, so nothing is spent or granted twice and no
// reward animation starts before the save is confirmed.
import * as steeds from './steeds.js';
import { BALANCE } from '../data/balance.js';
import { REGIONS, BOSSES, MONSTERS, REGION_BY_ID, waveLevel, DUNGEON, CLASSES, CLASS_SKILLS, SET_SLOTS } from '../data/content.js';
import { Battle, killRewards } from './combat.js';
import * as eco from './economy.js';
import { makeItem, rollRarity, rollSlot } from './items.js';
import * as prog from './progression.js';
import { FarmVerifier, applyClaim, computeClaim } from './offline.js';
import * as dun from './dungeon.js';
import { playerStats } from './stats.js';
import { markTx, newGame } from './state.js';
import * as rewards from './rewards.js';
import * as shop from './shop.js';
import { autoGrow } from './autogrow.js';
import * as talents from './talents.js';
import * as rebirth from './rebirth.js';
import * as rift from './rift.js';
import * as gacha from './gacha.js';
import * as missions from './missions.js';
import * as tower from './tower.js';
import * as raid from './raid.js';
import * as meta from './meta.js';
import * as stages from './stages.js';
import * as DF from './difficulty.js';
import * as mplus from './mplus.js';
import * as expedition from './expedition.js';
import * as gear from './gearplus.js';
import * as worldboss from './worldboss.js';
import * as craft from './crafting.js';
import * as mail from './mail.js';
import * as BD from './bossdaily.js';
import * as story from './story.js';
import * as TH from './theme.js';
import * as SYN from './synergy.js';
import { PASS } from '../data/meta.js';
import { deepClone, makeRng, uid } from './util.js';

const TICK = BALANCE.combat.tickMs;
const EQ = BALANCE.equipment;

export class Game {
  constructor({ saver, now = () => Date.now(), log = () => {} }) {
    this.saver = saver;
    this.now = now;
    this.log = log;
    this.mode = 'BOOT';
    this.listeners = {};
    this.acc = 0;
    this.busy = false;          // a transaction commit is in flight → sim paused
    this.verifier = new FarmVerifier();
    this.lastCheckpoint = 0;
    this.realSinceCheckpoint = 0;
    this.farm = null;           // farm battle (kept while boss/dungeon run)
    this.active = null;         // battle currently simulated & shown
    this.result = null;         // last boss/dungeon/trial result for the RESULT screen
    this.saveStatus = { ok: true, at: null, error: null };
    this.notices = [];
  }

  // ---------- events ----------
  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => { this.listeners[type] = this.listeners[type].filter((f) => f !== fn); }; }
  emit(type, payload) { for (const fn of this.listeners[type] || []) fn(payload); for (const fn of this.listeners['*'] || []) fn(type, payload); }
  setMode(m) { if (this.mode !== m) { const prev = this.mode; this.mode = m; this.emit('mode', { mode: m, prev }); } }

  // ---------- boot / load ----------
  async load() {
    this.setMode('LOAD');
    const res = await this.saver.load();
    this.loadInfo = res;
    if (res.status === 'conflict') { this.setMode('CONFLICT'); return res; }
    if (res.status === 'corrupt' || res.status === 'error') return res;     // UI offers previousGood / export / new game
    return this.start(res.state);
  }

  // Continue loading with a given state (null = new game). Also used after
  // restoring previousGood or wiping a corrupt save.
  async start(loaded) {
    this.state = loaded || newGame(this.now());
    if (loaded && this.loadInfo && this.loadInfo.status !== 'ok') this.state.diagnostics.recovered++;
    this.rng = makeRng(this.state.rngSeed);
    const isNew = !loaded;
    // fixed housekeeping that must be saved together
    const tickets = dun.refreshTickets(this.state, this.now());
    missions.refreshMissions(this.state, this.now());
    raid.refreshRaid(this.state, this.now());
    eco.applyAutoStats(this.state);
    mplus.refreshMplus(this.state, this.now());
    expedition.refreshExpedition(this.state, this.now());
    worldboss.refreshWorldBoss(this.state, this.now());
    mail.refreshMail(this.state, this.now());   // 운영 우편 배달 · 만료 정리 (saved with the housekeeping)
    const mpRefund = mplus.recoverRun(this.state);
    if (mpRefund) this.notices.push({ type: 'mplusRefund', ...mpRefund });
    const refund = dun.recoverPendingRun(this.state);
    if (refund) this.notices.push({ type: 'dungeonRefund', ...refund });
    if (tickets.rollback) this.notices.push({ type: 'clockRollback' });
    if (!isNew) rewards.prepareReturn(this.state, this.state.offlineSnapshot.lastActiveAt, this.now(), uid('ret'));
    this.startFarm();
    const pending = this.state.offlineSnapshot.pendingClaim;
    if (pending) {
      this.claim = pending;
      this.setMode('OFFLINE');
    } else if (!isNew) {
      this.prepareOffline();
    } else {
      this.state.offlineSnapshot.lastActiveAt = this.now();
      this.setMode('FARM');
    }
    const c = await this.commit('load');
    if (!c.ok && this.mode !== 'CONFLICT') this.emit('saveError', { reason: 'load', error: c.error });
    this.emit('loaded', { isNew, notices: this.notices });
    return { status: 'ok', isNew };
  }

  prepareOffline() {
    const now = this.now();
    const elapsed = (now - this.state.offlineSnapshot.lastActiveAt) / 1000;
    if (elapsed < BALANCE.offline.minSeconds && elapsed >= 0) {
      // short gap: nothing to settle, just continue
      this.state.offlineSnapshot.lastActiveAt = now;
      if (this.mode === 'LOAD' || this.mode === 'BOOT') this.setMode('FARM');
      return null;
    }
    const claim = computeClaim(this.state, now, uid('claim'));
    if (claim.diag.includes('clock-rollback')) this.state.diagnostics.clockRollbacks++;
    if (claim.diag.includes('future-clamped')) this.state.diagnostics.futureClamps++;
    // persist the claim first: reload / double tap shows the same claim, never a second one
    this.state.offlineSnapshot.pendingClaim = claim;
    this.state.offlineSnapshot.lastActiveAt = now;
    this.claim = claim;
    this.setMode('OFFLINE');
    return claim;
  }

  async claimOffline() {
    const claim = this.state.offlineSnapshot.pendingClaim;
    if (!claim) return { ok: false, reason: 'none' };
    const r = await this.transact('offlineClaim', (s) => {
      if (!markTx(s, claim.claimId)) return { ok: false, reason: 'duplicate' };
      return applyClaim(s, claim, prog.gainExp, eco.addItems);
    });
    if (r.ok || r.reason === 'duplicate') { this.claim = null; this.setMode('FARM'); this.acc = 0; }
    return r;
  }

  runAutoGrow() {
    if (!this.state) return null;
    const r = autoGrow(this.state);
    let tg = 0;
    if (this.state.talents && this.state.talents.auto && talents.pointsFree(this.state) > 0) tg = talents.autoAllocate(this.state);
    if (r.count || tg) { this.syncHero(); this.emit('autoGrow', r); }
    return r;
  }

  // ---------- 특성 ----------
  talentRank(id) { return this.transact('talent', (s) => talents.rankUp(s, id)); }
  talentRespec() { return this.transact('talentRespec', (s) => talents.respec(s, this.now())); }
  talentPreset(idx) { return this.transact('talentPreset', (s) => talents.setPreset(s, idx)); }
  talentAuto(on) { return this.transact('talentAuto', (s) => { s.talents.auto = !!on; const given = on ? talents.autoAllocate(s) : 0; return { ok: true, given }; }); }
  talentAutoSwitch(on) { return this.transact('talentAutoSwitch', (s) => { s.talents.autoSwitch = !!on; return { ok: true }; }); }

  // ---------- 환생 ----------
  doRebirth() {
    if (this.mode !== 'FARM') return Promise.resolve({ ok: false, reason: 'mode' });
    return this.transact('rebirth', (s) => rebirth.doRebirth(s, this.now())).then((r) => { if (r.ok) { this.startFarm(); this.emit('farmChanged', {}); } return r; });
  }
  rebirthUpgrade(key) { return this.transact('rebirthUp', (s) => rebirth.buyUpgrade(s, key)); }

  // ---------- 균열 ----------
  // Starts a new run (uses a free run) or continues the saved one at its current floor.
  async startRift() {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    let run = this.state.rift.run;
    if (!run) {
      const r = await this.transact('riftBegin', (s) => rift.beginRun(s, uid('rift'), this.now()));
      if (!r.ok) return r;
      run = this.state.rift.run;
    }
    if (run.choices) return { ok: false, reason: 'choice', choices: run.choices };
    const cfg = rift.floorConfig(this.state, run);
    this.session = { kind: 'rift', id: run.id, floor: run.floor, bg: cfg.bg, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'rift', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'rift', rift: { mods: rift.runMods(run), curse: run.curse } }), rift: { ...cfg, hpPct: run.hpPct } });
    this.acc = 0;
    this.setMode('DUNGEON');
    this.emit('session', this.session);
    return { ok: true, floor: run.floor };
  }
  // ---------- 쐐기 던전 ----------
  async startMplus(dungeon) {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    const id = uid('mplus');
    const r = await this.transact('mplusBegin', (s) => mplus.beginRun(s, dungeon, id, this.now()));
    if (!r.ok) return r;
    const run = this.state.mplus.run;
    const cfg = mplus.runConfig(this.state, dungeon, run.key, run.affixes);
    this.session = { kind: 'mplus', id, dungeon, key: run.key, affixes: run.affixes, bg: cfg.bg, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'mplus', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'mplus' }), mplus: cfg });
    this.acc = 0;
    this.setMode('DUNGEON');
    this.emit('session', this.session);
    return { ok: true, key: run.key };
  }
  // ---------- 월드 보스 ----------
  async startWorldBoss() {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    const id = uid('wb');
    const r = await this.transact('worldBossEnter', (s) => worldboss.beginWorldBoss(s, id, this.now()));
    if (!r.ok) return r;
    const cfg = worldboss.battleConfig(this.state, this.now());
    this.active = new Battle({ kind: 'world', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'world' }), world: cfg });
    this.session = { kind: 'world', id, bossId: cfg.boss, bossHp: this.active.worldHp, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.acc = 0;
    this.setMode('BOSS');
    this.emit('session', this.session);
    return { ok: true };
  }
  // ---------- 제작·강화 확장 (보옥 · 마부 · 버프 음식) ----------
  socketJewel(itemId, idx, t, lv) { return this.transact('jewel', (s) => craft.socket(s, itemId, idx, t, lv)); }
  unsocketJewel(itemId, idx) { return this.transact('jewel', (s) => craft.unsocket(s, itemId, idx)); }
  combineJewel(t, lv) { return this.transact('jewel', (s) => craft.combine(s, t, lv)); }
  enchantSlot(slot) { return this.transact('enchant', (s) => craft.enchantRoll(s, slot, this.rng)); }
  cookFood(id) { return this.transact('cook', (s) => craft.cook(s, id, this.now())); }
  // ---------- 원정 파견 ----------
  sendExpedition(expId, petId) { return this.transact('expSend', (s) => expedition.send(s, expId, petId, this.now())); }
  sendExpeditionAuto() { return this.transact('expSend', (s) => expedition.sendAuto(s, this.now())); }
  claimExpedition(slot) { return this.transact('expClaim', (s) => expedition.claim(s, slot, this.now())); }
  // 우편함 · 쿠폰 (mail.js)
  async refreshMail() {
    if (!this.state) return { ok: false, reason: 'noState' };
    const now = this.now();
    const probe = mail.refreshMail(deepClone(this.state), now);   // dry run: save only when something changes
    if (!probe.added && !probe.expired && !probe.removed) return { ok: true, noop: true };
    return this.transact('mailRefresh', (s) => ({ ok: true, ...mail.refreshMail(s, now) }));
  }
  claimMail(id) { return this.transact('mailClaim', (s) => mail.claimMail(s, id, this.now())); }
  claimAllMail() { return this.transact('mailClaim', (s) => mail.claimAllMail(s, this.now())); }
  async redeemCoupon(code) {
    if (!mail.normalizeCoupon(code)) return { ok: false, reason: 'coupon-empty' };
    const hash = await mail.hashCoupon(code);
    return this.transact('coupon', (s) => mail.redeemCouponHash(s, hash, this.now()));
  }
  // ---------- v10 장비·스킬 확장 ----------
  extractLegend(id) { return this.transact('extract', (s) => gear.extractLegend(s, id)); }
  imprintLegend(id, uid) { return this.transact('imprint', (s) => gear.imprintLegend(s, id, uid)); }
  setAwaken(skillId, pick) { return this.transact('awaken', (s) => gear.setAwaken(s, skillId, pick, this.now())); }
  saveLoadout(idx, name = null) { return this.transact('loadoutSave', (s) => gear.saveLoadout(s, idx, name)); }
  renameLoadout(idx, name) { return this.transact('loadoutName', (s) => gear.renameLoadout(s, idx, name)); }
  applyLoadout(idx) { return this.transact('loadoutApply', (s) => gear.applyLoadout(s, idx, prog.unlockedSkills(s))); }
  setLoadoutAuto(on, map = null) { return this.transact('loadoutAuto', (s) => gear.setLoadoutAuto(s, on, map)); }
  // v12 탈것 · 날개
  steedEquip(kind, id) { return this.transact('steed', (s) => steeds.equip(s, kind, id)).then((r) => { if (r.ok) this.syncHero(); return r; }); }
  steedLevel(kind, id, steps) { return this.transact('steed', (s) => steeds.levelUp(s, kind, id, steps)).then((r) => { if (r.ok) this.syncHero(); return r; }); }
  steedStar(kind, id) { return this.transact('steed', (s) => steeds.starUp(s, kind, id)).then((r) => { if (r.ok) this.syncHero(); return r; }); }
  steedSummon(kind, n) { return this.transact('steedSummon', (s) => steeds.summon(s, kind, n, this.rng)).then((r) => { if (r.ok) this.syncHero(); return r; }); }
  levelUpItem(id, steps) { return this.transact('itemLevel', (s) => gear.levelUpItem(s, id, steps)); }
  reforge(id, optIdx) { return this.transact('reforge', (s) => gear.reforge(s, id, optIdx, this.rng)); }
  storySeen(key) { return this.transact('story', (s) => ({ ok: true, fresh: story.markSeen(s, key, this.now()) })); }
  rarityUp(baseId, matIds) { return this.transact('rarityUp', (s) => gear.rarityUp(s, baseId, matIds, this.rng)); }
  bulkRarityUp(maxTo, slot = null) { return this.transact('bulkRarityUp', (s) => gear.bulkRarityUp(s, maxTo, slot, this.rng)); }
  claimAllExpeditions() { return this.transact('expClaim', (s) => expedition.claimAll(s, this.now())); }
  claimTheme() { return this.transact('themeClaim', (s) => TH.claim(s, this.now())); }
  claimMplusVault() { return this.transact('mplusVault', (s) => mplus.claimVault(s, this.now())); }
  riftPick(id) { return this.transact('riftPick', (s) => rift.pickBlessing(s, id)); }
  riftEnd() { return this.transact('riftEnd', (s) => rift.endRun(s, this.now(), this.rng, this.bookSkills(s))); }

  // ---------- daily / return rewards ----------
  claimAttendance() { return this.transact('attendance', (s) => rewards.claimAttendance(s, this.now())); }
  claimReturn() { return this.transact('returnBonus', (s) => rewards.claimReturn(s, this.now())); }
  setNickname(name) { return this.transact('nickname', (s) => { s.profile.nickname = name; return { ok: true }; }); }

  // ---------- hero config for battles ----------
  // opts.session: a boss/raid/tower/trial/rift fight (talent preset 2 when auto-switch is on)
  // opts.rift: run blessings + weekly curse
  heroCfg(opts = this.activeOpts || {}) {
    const s = this.state;
    const cls = s.player.cls || 'warrior';
    const t = s.talents;
    const preset = opts.session && t && t.autoSwitch ? 1 : (t ? t.active : 0);
    // v10 프리셋 자동 교체: the battle uses the mapped loadout as a view — the worn gear is not changed
    const L = gear.loadoutFor(s, opts.kind || (opts.session ? 'boss' : 'farm'));
    let view = s;
    if (L) {
      const r = gear.resolveLoadout(s, L, prog.unlockedSkills(s));
      const skills = r.skills.slice(0, s.skills.equipped.length).map((id, i) => (i < prog.slotCount(s) ? id : null));
      view = { ...s, equipped: r.equipped, skills: { ...s.skills, equipped: skills, runes: s.skills.runes ? { ...s.skills.runes, equipped: r.runes.length ? r.runes : s.skills.runes.equipped } : s.skills.runes } };
    }
    return { stats: playerStats(view, { preset, rift: opts.rift || null }), pet: s.pets ? meta.petPower(s) : null, skills: view.skills, branch: s.player.branch, cls, tier: prog.tierOf(s), ult: CLASS_SKILLS[cls].ult, range: CLASSES[cls].range, skillLevel: (id) => prog.skillLevel(s, id), loadout: L ? L.name : null, oath: (prog.oathOf(s) || {}).fx || null };
  }
  syncHero() {
    if (this.farm) this.farm.updateStats(this.heroCfg({}));
    if (this.active && this.active !== this.farm) this.active.updateStats(this.heroCfg(this.activeOpts || { session: true }));
  }
  sessionHero(opts = { session: true }) { this.activeOpts = opts; return this.heroCfg(opts); }

  startFarm() {
    const s = this.state;
    const region = REGION_BY_ID[s.progression.region];
    this.farm = new Battle({
      kind: 'farm', rng: this.rng, hero: this.heroCfg({}),
      farm: {
        monsters: region.monsters,
        levelFn: () => DF.farmLevel(DF.curDiff(this.state), this.state.progression.region, this.state.progression.wave),
        mulFn: () => DF.enemyMul(DF.curDiff(this.state), this.state.progression.region, this.state.progression.wave),
        eliteAllowed: () => this.state.progression.wave >= BALANCE.monster.elite.fromWave,
        killsFn: () => this.state.progression.waveKills,
        stageFn: () => DF.curDiff(this.state) + ':' + this.state.progression.region + '-' + this.state.progression.wave,
        themeFn: () => TH.mod(this.now()),   // v14 주간 테마 규칙 (화면 사냥만)
      },
    });
    this.active = this.farm;
    this.verifier.reset();
    this.verifier.start(s.progression.region, s.progression.wave, 0);
  }

  // ---------- main loop ----------
  // realDtMs: wall time since last call (caller caps it). Returns ticks run.
  advance(realDtMs) {
    if (!this.state || this.busy) return 0;
    if (this.stageQueue && this.stageQueue.length) this.flushStageClears();
    if (!['FARM', 'BOSS', 'DUNGEON', 'PROMOTION_TRIAL', 'DEFEAT'].includes(this.mode)) return 0;
    const speed = this.state.settings.speed === 2 ? 2 : 1;
    this.acc += realDtMs * speed;
    let n = 0;
    while (this.acc >= TICK && n < 200) {
      this.acc -= TICK;
      this.active.step();
      n++;
      if ((this.mode === 'FARM' || this.mode === 'DEFEAT') && this.active === this.farm && !this.farm.traveling) this.stageRun().ms += TICK;   // stars: combat time only
      if (this.mode === 'FARM' && this.active === this.farm) {
        const p = this.state.progression;
        p.fieldBossSec = (p.fieldBossSec || 0) + TICK / 1000;
        if (p.fieldBossSec >= BALANCE.combat.fieldBossEverySec && this.farm.spawnFieldBoss(waveLevel(p.region, p.wave))) p.fieldBossSec = 0;
      }
      this.process(this.active.drainEvents());
      if (this.busy) break;
    }
    // automatic growth: spend farming gold on upgrades every 2 s of play
    this.growAcc = (this.growAcc || 0) + realDtMs;
    if (this.growAcc >= 2000 && !this.busy && (this.mode === 'FARM' || this.mode === 'DEFEAT')) {
      this.growAcc = 0;
      this.runAutoGrow();
    }
    this.realSinceCheckpoint += realDtMs;
    if (this.realSinceCheckpoint >= BALANCE.save.checkpointSec * 1000 && !this.busy) {
      this.realSinceCheckpoint = 0;
      this.checkpoint('interval');
    }
    return n;
  }
  get alpha() { return this.acc / TICK; }

  // v14 시너지 도감: the first trigger of a combo is saved (own tx) with a small reward; the
  // reward toast is emitted only after the save succeeded.
  onSynergy(ev) {
    if (SYN.isFound(this.state, ev.id)) return;
    this.synPending ||= new Set();
    if (this.synPending.has(ev.id)) return;
    this.synPending.add(ev.id);
    this.transact('synergy', (s) => {
      const r = SYN.record(s, ev.id, this.now());
      if (r.first) meta.addPassXp(s, r.passXp, this.now());
      return { ...r, id: ev.id };
    }).then((r) => { this.synPending.delete(ev.id); if (r.ok && r.first) this.emit('synergyFound', r); });
  }

  process(events) {
    for (const ev of events) {
      if (ev.type === 'synergy') this.onSynergy(ev);
      if (this.active.kind === 'farm') this.processFarm(ev);
      else this.processSession(ev);
      this.emit('combat', ev);
    }
  }

  processFarm(ev) {
    const s = this.state;
    if (ev.type === 'kill') {
      const e = ev.enemy;
      const r = killRewards(e.level, { elite: e.elite, fieldBoss: e.fieldBoss });
      const mul = { ...rewards.farmMultipliers(s, this.now()) };
      const tb = TH.bonus(this.now());   // v14 주간 테마 보너스 (방치 정산에는 없음)
      mul.gold *= tb.gold || 1; mul.exp *= tb.exp || 1;
      TH.track(s, 'kills', 1, this.now());
      if (e.elite && !e.fieldBoss) TH.track(s, 'elites', 1, this.now());
      const pst = playerStats(s);
      const gp = (1 + (pst.goldPct || 0)) * pst.rebirth.gold;
      const pm = BALANCE.phase.rewardMul;   // v12: travel legs between phases → richer kills
      const dm = DF.rewardMul(DF.curDiff(s));   // 노말/하드 gold · exp
      r.gold = Math.floor(r.gold * pm * dm.gold * mul.gold * gp); r.exp = Math.floor(r.exp * pm * dm.exp * mul.exp * (1 + (pst.expPct || 0)) * pst.rebirth.exp);
      missions.track(s, 'kills', 1, this.now());
      meta.trackKill(s, e.id);
      meta.trackPassKill(s, this.now());
      const SP = BALANCE.supply;
      if (e.fieldBoss) { s.wallet.gem += SP.fieldBossGem; s.wallet.eqTicket += SP.fieldBossEqTicket; s.progression.counters.fieldBosses++; r.gem = SP.fieldBossGem; r.eqTicket = SP.fieldBossEqTicket; }
      else if (e.elite && this.rng() < SP.eliteGemChance * (tb.eliteGem || 1)) { s.wallet.gem += SP.eliteGem; r.gem = SP.eliteGem; }
      // 사냥 보급: every N foreground kills → gems / draw tickets
      s.supply ||= { kills: 0 };
      const sk = ++s.supply.kills;
      if (sk % SP.gemEvery === 0) { s.wallet.gem += SP.gem; r.supplyGem = SP.gem; }
      if (sk % SP.eqEvery === 0) { s.wallet.eqTicket += 1; r.supplyEq = 1; }
      if (sk % SP.skEvery === 0) { s.wallet.skTicket += 1; r.supplySk = 1; }
      s.wallet.gold += r.gold;
      const expRes = prog.gainExp(s, r.exp);
      const loot = this.rollLoot(e);
      if (e.rare) {   // 희귀 정예: gems + a rare-or-better piece, codex, title at 10/10
        const rr = worldboss.onRareKill(s, e.rare, e.level, this.rng);
        TH.track(s, 'rares', 1, this.now());
        const added = eco.addItems(s, [rr.item]);
        loot.items = loot.items.concat(added.stored, added.overflowed);
        r.rare = { id: e.rare, gem: rr.gem, item: rr.item, first: rr.first, title: rr.title };
      }
      const tok = prog.onTokenKill(s, e.level);
      s.progression.counters.kills++;
      // wave progress
      const p = s.progression;
      p.waveKills++;
      if (p.holdKills > 0) p.holdKills--;
      let advanced = false;
      if (p.waveKills >= BALANCE.combat.waveKillTarget) {
        p.waveKills = 0;
        // 스테이지 클리어 (wave = stage): stars from this run, first-clear reward once (own tx)
        const run = this.stageRun();
        this.queueStageClear(p.region, p.wave, { deaths: run.deaths, timeSec: run.ms / 1000 });
        this.run = null;
        TH.track(s, 'stages', 1, this.now());
        const rare = this.farm === this.active && worldboss.rollRare(p.region, this.rng, TH.mod(this.now()).rareChanceMul || 1);
        if (rare) this.farm.spawnRare(rare, DF.farmLevel(DF.curDiff(s), p.region, p.wave));
        if (p.holdKills > 0) { /* holding after a retreat */ }
        else if (p.wave < 10 && p.autoAdvance !== false) { p.wave++; advanced = true; }
        const tr = DF.track(s);
        tr.maxWave[p.region] = Math.max(tr.maxWave[p.region] || 1, p.wave);
        // after a rebirth, regions whose boss is already beaten are re-climbed automatically
        // (only when the next region's first wave is at most 5 levels above the hero)
        if (p.wave >= 10 && !advanced && p.autoAdvance !== false && s.rebirth?.count && !this.climbQueued) {
          const reg = REGIONS.find((x) => x.id === p.region);
          const next = REGIONS[REGIONS.indexOf(reg) + 1];
          if (reg && next && tr.bossCleared[reg.boss] && prog.regionUnlocked(s, next.id) && (!DF.isEasy(s) || next.minLv <= s.player.level + 5)) {
            this.climbQueued = true;
            queueMicrotask(() => this.setFarm(next.id, 1, true).finally(() => { this.climbQueued = false; }));
          }
        }
      }
      const vf = this.verifier.onKill(p.region, p.wave, e.level, this.active.t);
      if (vf) vf.diff = DF.curDiff(s);
      if (vf && !this.sameFarm(p.verifiedFarm, vf)) { p.verifiedFarm = vf; this.emit('farmVerified', vf); }
      this.emit('reward', { gold: r.gold, exp: r.exp, expRes, loot, token: tok, advanced, enemy: e, supplyEq: r.supplyEq, supplySk: r.supplySk, rare: r.rare });
      if (expRes.levels) { this.syncHero(); this.emit('levelUp', { level: s.player.level }); this.checkpoint('levelUp'); }
      if (e.fieldBoss) this.checkpoint('fieldBoss');
      // v14: 영웅 이상은 저장이 끝난 뒤에만 연출 (lootSaved) — 보상 저장 확정 전 획득 연출 금지
      const hi = loot.items.filter((i) => i.rarity === 'epic' || i.rarity === 'legendary' || i.rarity === 'mythic');
      if (hi.length) this.saveLoot(hi, e.x);
      else if (loot.items.length) this.checkpoint('loot');
    } else if (ev.type === 'heroDown') {
      s.progression.counters.deaths++;
      if (this.active === this.farm) this.stageRun().deaths++;
      this.verifier.onDeath();
      // idle-friendly: repeated deaths on one wave step back one wave for a while
      const p = s.progression;
      p.waveDeaths = (p.waveDeathsWave === p.wave ? (p.waveDeaths || 0) : 0) + 1;
      p.waveDeathsWave = p.wave;
      if (p.waveDeaths >= BALANCE.combat.retreatAfterDeaths && p.wave > 1) {
        p.wave -= 1; p.waveKills = 0; p.waveDeaths = 0;
        p.holdKills = BALANCE.combat.retreatHoldKills;
        this.emit('retreat', { wave: p.wave });
      }
      this.setMode('DEFEAT');
    } else if (ev.type === 'respawn') {
      this.verifier.start(s.progression.region, s.progression.wave, this.active.t);
      this.setMode('FARM');
    }
  }

  // transient per-stage run (combat ms + deaths); resets when the farm stage changes
  stageRun() {
    const p = this.state.progression;
    const key = DF.curDiff(this.state) + ':' + stages.stageKey(p.region, p.wave);
    if (!this.run || this.run.key !== key) this.run = { key, ms: 0, deaths: 0 };
    return this.run;
  }
  // Clears are committed in their own transaction (first-clear reward once). They wait in a
  // queue while another commit is in flight and are flushed by the loop — never dropped.
  queueStageClear(region, wave, run) {
    const d = DF.curDiff(this.state);
    const st = DF.track(this.state, d);
    const key = stages.stageKey(region, wave);
    if (st.claimed[key] && stages.starsFor(run, wave) <= (st.stars[key] || 0)) return;   // nothing to gain
    (this.stageQueue ||= []).push({ region, wave, run, d });
    queueMicrotask(() => this.flushStageClears());
  }
  async flushStageClears() {
    if (this.busy || this.flushingStages || !this.stageQueue || !this.stageQueue.length) return;
    this.flushingStages = true;
    try {
      while (this.stageQueue.length && !this.busy) {
        const q = this.stageQueue[0];
        const r = await this.transact('stageClear', (s) => stages.recordClear(s, q.region, q.wave, q.run, q.d || 'easy'));
        if (!r.ok && (r.reason === 'busy' || r.reason === 'save' || r.reason === 'conflict')) break;   // retry on next flush
        this.stageQueue.shift();
        if (r.ok && (r.first || r.improved)) this.emit('stageClear', r);   // UI shows it only after the commit
      }
    } finally { this.flushingStages = false; }
  }
  setStageAuto(on) {
    return this.transact('stageAuto', (s) => { s.stages.auto = !!on; s.progression.autoAdvance = !!on; return { ok: true, auto: !!on }; });
  }
  sameFarm(a, b) { return a && a.region === b.region && a.wave === b.wave && (a.diff || 'easy') === (b.diff || 'easy') && Math.abs(a.killsPerSec - b.killsPerSec) < 0.02; }

  rollLoot(e) {
    const s = this.state;
    const items = [];
    let ore = 0;
    let awaken = 0;
    if (e.fieldBoss) {
      const { mythic, ...noMythic } = EQ.bossRarity;
      items.push(makeItem(s, { slot: rollSlot(this.rng), rarity: rollRarity(this.rng, noMythic), level: e.level, rng: this.rng, source: 'fieldBoss' }));
    } else {
      const d = DF.curDiff(s);
      const D = DF.DIFFICULTY[d];
      const tb = TH.bonus(this.now());
      const chance = (e.elite ? EQ.eliteDropChance * (tb.eliteDrop || 1) : EQ.dropChance) * (1 + (playerStats(s).dropPct || 0)) * DF.rewardMul(d).drop;
      // 노말/하드: one richer table for every farm drop (elites still drop more often)
      const table = d !== 'easy' ? D.rarity : e.elite ? EQ.eliteRarity : EQ.rarityConditional;
      if (this.rng() < chance) items.push(makeItem(s, { slot: rollSlot(this.rng), rarity: rollRarity(this.rng, table), level: e.level, rng: this.rng }));
    }
    const R = BALANCE.monster.rewards;
    if (e.elite && this.rng() < R.oreChanceElite) ore += Math.round((1 + Math.floor(e.level / 8)) * (TH.bonus(this.now()).ore || 1));
    if (e.elite && e.level >= R.awakenFromLevel && this.rng() < R.awakenChanceElite) { awaken = 1; s.wallet.awakenStone += 1; }
    s.wallet.ore += ore;
    const added = eco.addItems(s, items);
    if (added.overflowed.length) this.emit('overflow', { count: s.overflow.length });
    return { items: added.stored.concat(added.overflowed), ore, awaken, overflowed: added.overflowed, autoDismantled: added.autoDismantled };
  }

  // ---------- sessions: boss / dungeon / trial ----------
  canChallengeBoss(bossId) {
    const b = BOSSES[bossId];
    const s = this.state;
    // (the weekly raid is its own session — startRaid; this is the stage boss fight)
    const t = DF.track(s);
    if (!prog.regionUnlocked(s, b.region)) return { ok: false, reason: 'region' };
    if ((t.maxWave[b.region] || 1) < 10) return { ok: false, reason: 'wave', need: 10, have: t.maxWave[b.region] || 1 };
    if (BD.isRepeat(s, bossId) && BD.left(s, this.now()) <= 0) return { ok: false, reason: 'bossDaily' };
    return { ok: true, repeat: BD.isRepeat(s, bossId), left: BD.left(s, this.now()) };
  }
  startBoss(bossId) {
    const c = this.canChallengeBoss(bossId);
    if (!c.ok || this.mode !== 'FARM') return c.ok ? { ok: false, reason: 'mode' } : c;
    missions.track(this.state, 'boss', 1, this.now());
    const d = DF.curDiff(this.state);
    this.session = { kind: 'boss', id: uid('boss'), bossId, diff: d, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    const diff = d === 'easy' ? null : { level: DF.bossLevel(d, bossId), mul: DF.enemyMul(d, BOSSES[bossId].region, 'boss') };
    this.active = new Battle({ kind: 'boss', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'boss' }), boss: { id: bossId, diff } });
    this.acc = 0;
    this.setMode('BOSS');
    this.emit('session', this.session);
    return { ok: true };
  }
  startTrial(tier = null) {
    tier = tier || prog.nextTier(this.state);
    const cl = prog.promotionChecklist(this.state, tier);
    if (!cl.canTrial || this.mode !== 'FARM') return { ok: false, reason: cl.canTrial ? 'mode' : 'conditions' };
    this.session = { kind: 'trial', id: uid('trial'), tier, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'trial', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'trial' }), trial: { tier } });
    this.acc = 0;
    this.setMode('PROMOTION_TRIAL');
    this.emit('session', this.session);
    return { ok: true };
  }
  // enterDungeon(stage) keeps the v3 signature (quarry); enterDungeon(type, stage) for others.
  async enterDungeon(a, b) {
    const type = typeof a === 'string' ? a : 'quarry';
    const stage = typeof a === 'string' ? b : a;
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    if (!prog.dungeonOpen(this.state, type)) return { ok: false, reason: 'locked' };
    const runId = uid('run');
    const r = await this.transact('dungeonEnter', (s) => { const x = dun.beginRun(s, stage, runId, this.now(), type); if (x.ok) missions.track(s, 'dungeon', 1, this.now()); return x; });
    if (!r.ok) return r;
    this.session = { kind: 'dungeon', type, id: runId, stage, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'dungeon', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'dungeon' }), dungeon: dun.runConfig(type, stage) });
    this.acc = 0;
    this.setMode('DUNGEON');
    this.emit('session', this.session);
    return { ok: true };
  }
  async sweepDungeon(type = 'quarry') {
    return this.transact('dungeonSweep', (s) => { const x = dun.sweep(s, { type, skills: this.bookSkills(s), rng: this.rng }); if (x.ok) missions.track(s, 'dungeon', 1, this.now()); return x; });
  }
  bookSkills(s) { const u = prog.unlockedSkills(s); const ult = prog.ultId(s); return u.filter((id) => id !== ult); }

  startTower() {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    if (!prog.towerOpen(this.state)) return { ok: false, reason: 'locked' };
    const floor = tower.nextFloor(this.state);
    this.session = { kind: 'tower', id: uid('tower'), floor, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'tower', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'tower' }), tower: tower.towerConfig(floor) });
    this.acc = 0;
    this.setMode('DUNGEON');
    this.emit('session', this.session);
    return { ok: true, floor };
  }
  async startRaid() {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    if (!prog.raidOpen(this.state)) return { ok: false, reason: 'locked' };
    const id = uid('raid');
    const r = await this.transact('raidEnter', (s) => raid.beginRaid(s, this.now()));
    if (!r.ok) return r;
    this.session = { kind: 'raid', id, bossId: BALANCE.raid.boss, startedAt: this.now(), viewBefore: this.state.settings.battleView };
    this.active = new Battle({ kind: 'raid', rng: this.rng, hero: this.sessionHero({ session: true, kind: 'raid' }) });
    this.acc = 0;
    this.setMode('BOSS');
    this.emit('session', this.session);
    return { ok: true };
  }

  processSession(ev) {
    if (ev.type !== 'victory' && ev.type !== 'defeat') return;
    const sess = this.session;
    const win = ev.type === 'victory';
    this.busy = true;   // stop simulating the finished battle
    queueMicrotask(() => this.finishSession(sess, win, ev).catch((err) => this.log('finish error', err)));
  }

  async finishSession(sess, win, ev) {
    this.busy = false;
    let r;
    if (sess.kind === 'boss') {
      r = await this.transact('bossResult', (s) => {
        if (!markTx(s, sess.id)) return { ok: false, reason: 'duplicate' };
        const res = { ok: true, win, bossId: sess.bossId, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
        if (!win) { s.progression.counters.bossLosses++; return res; }
        s.progression.counters.bossWins++;
        TH.track(s, 'bossWins', 1, this.now());
        meta.trackKill(s, sess.bossId);
        meta.addPassXp(s, PASS.xp.boss, this.now());
        const b = BOSSES[sess.bossId];
        const d = sess.diff || 'easy';
        // 반복 처치는 하루 3회만 보상 (첫 처치는 횟수 없음)
        if (BD.isRepeat(s, sess.bossId, d)) {
          if (!BD.consume(s, this.now())) { res.noReward = true; return res; }
          res.dailyLeft = BD.left(s, this.now());
        }
        const dm = DF.rewardMul(d);
        const rw = killRewards(DF.bossLevel(d, sess.bossId), { boss: true });
        rw.gold = Math.floor(rw.gold * dm.gold); rw.exp = Math.floor(rw.exp * dm.exp);
        s.wallet.gold += rw.gold;
        res.gold = rw.gold;
        res.exp = rw.exp;
        res.expRes = prog.gainExp(s, rw.exp);
        res.diff = d;
        const cleared = prog.onBossCleared(s, sess.bossId, d);
        if (REGION_BY_ID[BOSSES[sess.bossId].region]?.boss === sess.bossId) res.stage = stages.recordClear(s, BOSSES[sess.bossId].region, 'boss', { deaths: 0, timeSec: ev.t / 1000 }, d);
        res.first = cleared.first;
        if (cleared.first) Object.assign(res, story.onBossFirstClear(s, sess.bossId, d, this.now()));   // v14 보스 기록·엔딩
        res.unlocked = cleared.unlocked;
        res.diffUnlocked = cleared.diffUnlocked;
        const items = [];
        const order = Object.keys(BOSSES).indexOf(sess.bossId);
        const setSlot = () => SET_SLOTS[Math.floor(this.rng() * SET_SLOTS.length)];
        const fcKey = d === 'easy' ? sess.bossId : `${d}:${sess.bossId}`;
        if (d !== 'easy') {
          // 노말/하드: own first clear (epic/legendary Lv 100 piece, gems/ore × firstClearMul), richer repeats
          const D = DF.DIFFICULTY[d];
          const lv = DF.bossLevel(d, sess.bossId);
          if (cleared.first && !s.progression.firstClearClaimed[fcKey]) {
            s.progression.firstClearClaimed[fcKey] = sess.id;
            const m = DF.firstClearMul(d);
            items.push(makeItem(s, { slot: setSlot(), rarity: rollRarity(this.rng, D.bossFirst), level: lv, rng: this.rng, source: 'firstClear', set: b.region }));
            s.wallet.ore += 30 * (order + 1) * m; res.ore = 30 * (order + 1) * m;
            s.wallet.gem += 100 * m; res.gem = 100 * m;
            s.wallet.starShard += D.order; res.starShard = D.order;
          } else {
            const { mythic, ...table } = EQ.bossRarity;
            items.push(makeItem(s, { slot: setSlot(), rarity: 'rare', level: lv, rng: this.rng, source: 'boss', set: b.region }));
            items.push(makeItem(s, { slot: this.rng() < 0.5 ? setSlot() : rollSlot(this.rng), rarity: rollRarity(this.rng, table), level: lv, rng: this.rng, source: 'boss', set: b.region }));
            // v17: 노말·하드 보스 반복 처치는 그날 첫 승리에 파편이 확정(×난이도), 이후는 15%×난이도 확률
            if (s.bossDaily && s.bossDaily.used === 1) { s.wallet.starShard += D.order; res.starShard = D.order; res.dailyShard = true; }
            else if (this.rng() < 0.15 * D.order) { s.wallet.starShard += 1; res.starShard = 1; }
          }
        } else if (cleared.first && !s.progression.firstClearClaimed[sess.bossId]) {
          s.progression.firstClearClaimed[sess.bossId] = sess.id;
          // first clear: a guaranteed piece (rare for the first three bosses, epic after), ore and gems
          const slot = sess.bossId === 'B01' ? 'weapon' : sess.bossId === 'B02' ? 'armor' : order === 2 ? 'necklace' : setSlot();
          items.push(makeItem(s, { slot, rarity: order < 3 ? 'rare' : 'epic', level: b.level, rng: this.rng, source: 'firstClear', set: b.region }));
          s.wallet.ore += 30 * (order + 1);
          res.ore = 30 * (order + 1);
          s.wallet.gem += 100; res.gem = 100;
          s.pets.eggs += 1; res.petEgg = 1;
          if (sess.bossId === 'B09') { s.wallet.starShard += 1; res.starShard = 1; }
        } else {
          // repeat: one uncommon set piece guaranteed + the boss table (no mythic outside the raid)
          const { mythic, ...table } = EQ.bossRarity;
          items.push(makeItem(s, { slot: setSlot(), rarity: 'uncommon', level: b.level, rng: this.rng, source: 'boss', set: b.region }));
          if (order >= 2) items.push(makeItem(s, { slot: this.rng() < 0.5 ? setSlot() : rollSlot(this.rng), rarity: rollRarity(this.rng, table), level: b.level, rng: this.rng, source: 'boss', set: b.region }));
          if (sess.bossId === 'B09' && this.rng() < 0.3) { s.wallet.starShard += 1; res.starShard = 1; }
        }
        res.items = items;
        res.overflowed = eco.addItems(s, items).overflowed;
        return res;
      });
    } else if (sess.kind === 'dungeon') {
      r = await this.transact('dungeonResult', (s) => {
        const fr = dun.finishRun(s, sess.id, win, { type: sess.type || 'quarry', skills: this.bookSkills(s), rng: this.rng });
        return { ...fr, win, kills: ev.kills, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
      });
    } else if (sess.kind === 'tower') {
      r = await this.transact('towerResult', (s) => { const fr = tower.finishFloor(s, sess.floor, win); if (fr.record) meta.addPassXp(s, PASS.xp.towerRecord, this.now()); return { ...fr, win, kills: ev.kills, timeSec: Math.round(ev.t / 1000), reason: ev.reason }; });
    } else if (sess.kind === 'rift') {
      r = await this.transact('riftResult', (s) => {
        const fr = rift.finishFloor(s, sess.id, win, ev.hpPct || 0, this.now(), this.rng, this.bookSkills(s));
        if (fr.ended) {
          meta.addPassXp(s, PASS.xp.riftFloor * (fr.cleared || 0), this.now());
          if ((fr.cleared || 0) >= 10) { s.pets.eggs += 1; fr.petEgg = 1; }
        }
        return { ...fr, kills: ev.kills, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
      });
    } else if (sess.kind === 'world') {
      r = await this.transact('worldBossResult', (s) => {
        const fr = worldboss.finishWorldBoss(s, sess.id, ev.damage || 0, sess.bossHp, this.rng);
        if (fr.ok) fr.overflowed = eco.addItems(s, fr.items).overflowed;
        return { ...fr, win: true, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
      });
    } else if (sess.kind === 'mplus') {
      r = await this.transact('mplusResult', (s) => {
        const fr = mplus.finishRun(s, sess.id, { win, timeSec: Math.round(ev.t / 100) / 10 }, this.now(), this.rng);
        if (fr.ok) { fr.overflowed = eco.addItems(s, fr.items).overflowed; if (win) missions.track(s, 'dungeon', 1, this.now()); }
        return { ...fr, win, kills: ev.kills, reason: ev.reason };
      });
    } else if (sess.kind === 'raid') {
      r = await this.transact('raidResult', (s) => {
        if (!markTx(s, sess.id)) return { ok: false, reason: 'duplicate' };
        const fr = raid.finishRaid(s, ev.damage || 0, this.rng);
        fr.overflowed = eco.addItems(s, fr.items).overflowed;
        return { ...fr, win: true, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
      });
    } else if (sess.kind === 'trial') {
      r = await this.transact('trialResult', (s) => {
        if (win) { s.promotion.trials[sess.tier || 1] = true; if ((sess.tier || 1) === 1) s.promotion.trialCleared = true; }
        return { ok: true, win, tier: sess.tier || 1, timeSec: Math.round(ev.t / 1000), reason: ev.reason };
      });
    }
    // Save failed: keep the finished battle frozen and let the user retry the commit.
    if (!r.ok && r.reason === 'save') {
      this.pendingFinish = { sess, win, ev };
      this.setMode('RESULT');
      this.result = { kind: sess.kind, saveFailed: true };
      this.emit('result', this.result);
      return;
    }
    this.result = { kind: sess.kind, ...r, session: sess };
    this.setMode('RESULT');
    this.emit('result', this.result);
  }

  async retryFinish() {
    if (!this.pendingFinish) return { ok: false };
    const { sess, win, ev } = this.pendingFinish;
    this.pendingFinish = null;
    return this.finishSession(sess, win, ev);
  }

  // RESULT → FARM. The farm battle kept running state; it was simply not stepped.
  returnToFarm() {
    if (this.pendingFinish) return { ok: false, reason: 'unsaved' };
    const sess = this.session;
    this.session = null;
    this.active = this.farm;
    this.activeOpts = null;
    this.result = null;
    this.acc = 0;
    this.setMode('FARM');
    this.emit('session', null);
    return { ok: true, viewBefore: sess?.viewBefore };
  }

  // Leave a boss fight early (counts as a loss, no penalty).
  forfeit() {
    if (!this.active || this.active === this.farm || this.active.over) return;
    // a checkpoint save is being written: finish the session right after it, so the
    // result commit never races it (revision conflict → CONFLICT screen)
    if (this.busy) { setTimeout(() => this.forfeit(), 30); return; }
    this.active.finish('defeat', 'forfeit');
    this.process(this.active.drainEvents());
  }

  // ---------- farm location ----------
  async setFarm(regionId, wave, autoAdvance = true) {
    const r = await this.transact('setFarm', (s) => {
      if (!prog.regionUnlocked(s, regionId)) return { ok: false, reason: 'locked' };
      const max = DF.track(s).maxWave[regionId] || 1;
      if (wave > max) return { ok: false, reason: 'wave' };
      s.progression.region = regionId;
      s.progression.wave = wave;
      s.progression.waveKills = 0;
      s.progression.autoAdvance = autoAdvance;
      return { ok: true };
    });
    if (r.ok && this.mode === 'FARM') { this.startFarm(); this.emit('farmChanged', {}); }
    return r;
  }

  // 난이도 전환: farm moves to that difficulty's last position (FARM mode only)
  async switchDifficulty(d) {
    if (this.mode !== 'FARM') return { ok: false, reason: 'mode' };
    const r = await this.transact('difficulty', (s) => DF.switchDiff(s, d));
    if (r.ok) { this.run = null; if (this.mode === 'FARM') this.startFarm(); this.emit('farmChanged', {}); }
    return r;
  }

  // ---------- player actions ----------
  buyUpgrade(stat, want) { return this.transact('upgrade', (s) => eco.buyUpgrade(s, stat, want)); }
  equip(id, slot = null) { return this.transact('equip', (s) => eco.equip(s, id, slot)); }
  unequip(slot) { return this.transact('unequip', (s) => eco.unequip(s, slot)); }
  autoEquip() { return this.transact('autoEquip', (s) => eco.autoEquip(s)); }
  setLock(id, v) { return this.transact('lock', (s) => eco.setLock(s, id, v)); }
  dismissNotice(key) { return this.transact('notice', (s) => { if (!s.notices || !s.notices[key]) return { ok: false, reason: 'none' }; delete s.notices[key]; return { ok: true }; }); }
  // slot enhancement (schema 6): `slot` = weapon … ring1 / ring2
  enhance(slot) { return this.transact('enhance', (s) => { const r = eco.enhance(s, slot, this.rng); if (r.ok) missions.track(s, 'enhance', 1, this.now()); return r; }); }
  dismantle(ids) { return this.transact('dismantle', (s) => eco.dismantle(s, ids)); }
  moveOverflow() { return this.transact('overflow', (s) => eco.moveOverflow(s)); }
  markSeen(ids) { for (const it of this.state.inventory) if (ids.includes(it.id)) it.isNew = false; }
  choosePromotion(branch, opts) { return this.transact('promotion', (s) => prog.choosePromotion(s, branch, opts)); }
  promote(tier, branch = null) { return this.transact('promotion', (s) => prog.promote(s, tier, branch, this.now())); }
  setOath(id) { return this.transact('oath', (s) => prog.setOath(s, id)); }
  // Class is chosen once, at the very start (before real progress).
  chooseClass(cls) {
    return this.transact('chooseClass', (s) => {
      if (!CLASSES[cls]) return { ok: false, reason: 'class' };
      if (s.classChosen || s.player.level > 2 || prog.tierOf(s) > 0) return { ok: false, reason: 'class-locked' };
      s.player.cls = cls;
      s.skills.equipped = [...CLASS_SKILLS[cls].base, null, null];
      for (const k of Object.keys(s.player.stats)) s.player.stats[k] = 0;
      eco.applyAutoStats(s);
      s.classChosen = true;
      return { ok: true, cls };
    });
  }
  // Later class changes: first one free, then a 클래스 전환권 (shop.js).
  changeClass(cls, branch = null) { if (this.mode !== 'FARM') return Promise.resolve({ ok: false, reason: 'mode' }); return this.transact('changeClass', (s) => shop.changeClass(s, cls, branch)); }
  buyShop(id) { return this.transact('shop', (s) => shop.buy(s, id, this.now())); }
  drawEquipment(n) {
    return this.transact('drawEquipment', (s) => {
      const r = gacha.drawEquipment(s, n, this.rng);
      if (!r.ok) return r;
      missions.track(s, 'draw', 1, this.now());
      const added = eco.addItems(s, r.items);
      return { ...r, overflowed: added.overflowed, converted: added.converted };
    });
  }
  drawSkill(n) { return this.transact('drawSkill', (s) => { const r = gacha.drawSkill(s, n, this.rng); if (r.ok) missions.track(s, 'draw', 1, this.now()); return r; }); }
  levelSkill(id) { return this.transact('levelSkill', (s) => prog.levelSkill(s, id)); }
  equipRune(id, slot) { return this.transact('rune', (s) => gacha.equipRune(s, id, slot)); }
  unequipRune(slot) { return this.transact('rune', (s) => gacha.unequipRune(s, slot)); }
  allocateStat(key, n = 1) { return this.transact('stat', (s) => eco.allocateStat(s, key, n)); }
  resetStats() { return this.transact('stat', (s) => eco.resetStats(s)); }
  setAutoStats(on) { return this.transact('stat', (s) => eco.setAutoStats(s, on)); }
  setAutoDismantle(v) { return this.transact('setting', (s) => { if (!['off', 'common', 'uncommon', 'rare'].includes(v)) return { ok: false, reason: 'value' }; s.settings.autoDismantle = v; return { ok: true }; }); }
  claimMission(id) { return this.transact('mission', (s) => { const r = missions.claimMission(s, id, this.now()); if (r.ok) { meta.addPassXp(s, PASS.xp.mission, this.now()); r.passXp = PASS.xp.mission; } return r; }); }
  claimMissionBonus() { return this.transact('missionBonus', (s) => { const r = missions.claimMissionBonus(s, this.now()); if (r.ok) { meta.addPassXp(s, PASS.xp.missionBonus, this.now()); r.passXp = PASS.xp.missionBonus; } return r; }); }
  // ---------- 도감 · 업적 · 칭호 · 시즌 패스 · 동료 · 신화 제작 ----------
  claimAchievement(id) { return this.transact('achievement', (s) => meta.claimAchievement(s, id)); }
  claimAllAchievements() { return this.transact('achievement', (s) => meta.claimAllAchievements(s)); }
  equipTitle(id) { return this.transact('title', (s) => meta.equipTitle(s, id)); }
  claimPass(level) { return this.transact('pass', (s) => meta.claimPass(s, level, this.now())); }
  claimAllPass() { return this.transact('pass', (s) => meta.claimAllPass(s, this.now())); }
  hatchEgg() { return this.transact('pet', (s) => meta.hatchEgg(s, this.rng)); }
  feedPet(id) { return this.transact('pet', (s) => meta.feedPet(s, id)); }
  starUpPet(id) { return this.transact('pet', (s) => meta.starUpPet(s, id)); }
  setActivePet(id) { return this.transact('pet', (s) => meta.setActivePet(s, id)); }
  craftMythic(slot) {
    return this.transact('craft', (s) => {
      const r = meta.craftMythic(s, slot, this.rng);
      if (!r.ok) return r;
      const added = eco.addItems(s, [r.item]);
      return { ...r, overflowed: added.overflowed };
    });
  }
  setSkillSlot(idx, skillId) {
    return this.transact('skillSlot', (s) => {
      const max = prog.slotCount(s);
      if (idx >= max) return { ok: false, reason: 'locked-slot' };
      if (skillId && !prog.unlockedSkills(s).includes(skillId)) return { ok: false, reason: 'locked-skill' };
      if (skillId === prog.ultId(s)) return { ok: false, reason: 'locked-skill' };
      const eq = s.skills.equipped;
      const at = skillId ? eq.indexOf(skillId) : -1;
      if (at >= 0) eq[at] = eq[idx];       // swap if already equipped elsewhere
      eq[idx] = skillId;
      return { ok: true };
    });
  }
  setUltAuto(mode) { return this.transact('ultAuto', (s) => { s.skills.ultAuto = mode; return { ok: true }; }); }
  setAutoCast(v) { return this.transact('autoCast', (s) => { s.skills.autoCast = v; return { ok: true }; }); }
  setSetting(k, v) { return this.transact('setting', (s) => { s.settings[k] = v; return { ok: true }; }); }
  castManual(id) { return this.active ? this.active.castManual(id) : false; }

  // ---------- persistence ----------
  async transact(label, fn) {
    if (!this.state) return { ok: false, reason: 'noState' };
    if (this.busy) return { ok: false, reason: 'busy' };
    if (this.mode === 'CONFLICT') return { ok: false, reason: 'conflict' };
    this.busy = true;
    try {
      const draft = deepClone(this.state);
      const res = fn(draft) || { ok: true };
      if (!res.ok) return res;
      draft.rngSeed = this.rng.state();
      const c = await this.commitState(draft, label);
      if (!c.ok) {
        this.emit('saveError', { reason: label, error: c.error, conflict: c.conflict });
        return { ok: false, reason: c.conflict ? 'conflict' : 'save', error: c.error };
      }
      this.state = draft;
      this.syncHero();
      this.emit('tx', { label, res });
      this.emit('state', this.state);
      return res;
    } finally {
      this.busy = false;
    }
  }

  async commitState(s, label) {
    s.savedAt = this.now();
    s.offlineSnapshot.lastActiveAt = this.mode === 'OFFLINE' ? s.offlineSnapshot.lastActiveAt : this.now();
    const c = await this.saver.commit(s, label);
    if (c.ok) { this.saveStatus = { ok: true, at: s.savedAt, error: null }; }
    else {
      this.state && this.state.diagnostics && this.state.diagnostics.saveFailures++;
      this.saveStatus = { ok: false, at: this.saveStatus.at, error: c.error };
      if (c.conflict) this.setMode('CONFLICT');
    }
    this.emit('saveStatus', this.saveStatus);
    return c;
  }

  async commit(label) {
    if (!this.state) return { ok: false };
    this.state.rngSeed = this.rng.state();
    return this.commitState(this.state, label);
  }

  // Notable farm drops: commit (waiting briefly if another save is running), then announce.
  async saveLoot(items, x) {
    for (let i = 0; i < 30; i++) {
      if (!this.state || this.mode === 'CONFLICT') return { ok: false };
      if (!this.busy) {
        this.busy = true;
        let c;
        try { c = await this.commit('loot'); } finally { this.busy = false; }
        if (c && c.ok) this.emit('lootSaved', { items, x });
        return c;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, reason: 'busy' };
  }

  // Routine progress (kills, gold). Live state is saved as-is.
  async checkpoint(label) {
    if (this.busy || this.mode === 'CONFLICT' || !this.state) return;
    this.busy = true;
    try { await this.commit(label); } finally { this.busy = false; }
  }

  async onHidden() {
    this.hidden = true;
    if (this.mode === 'CONFLICT' || !this.state) return;
    await this.checkpoint('hidden');
  }
  onVisible() {
    this.hidden = false;
    this.acc = 0;          // never replay the hidden time as foreground ticks
    if (!this.state || this.mode === 'CONFLICT') return;
    if (this.mode === 'FARM' || this.mode === 'DEFEAT') {
      const claim = this.prepareOffline();
      if (claim) this.commit('offlinePrepared').then((c) => { if (!c.ok) this.emit('saveError', { reason: 'offline', error: c.error }); });
    }
    this.emit('state', this.state);
  }

  // Export / import / reset (UI asks for confirmation before calling these).
  exportJson() { return JSON.stringify({ format: 'asteria-save', exportedAt: this.now(), state: this.state }, null, 1); }
  async importState(next) {
    return this.replaceState(next, 'import');
  }
  async resetGame() { return this.replaceState(newGame(this.now()), 'reset'); }
  async replaceState(next, label) {
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true;
    try {
      next.revision = this.state ? this.state.revision : (next.revision || 0);
      const c = await this.commitState(next, label);
      if (!c.ok) return { ok: false, reason: 'save', error: c.error };
      this.state = next;
      this.rng = makeRng(next.rngSeed);
      this.session = null; this.result = null; this.claim = null;
      this.startFarm();
      this.setMode('FARM');
      this.emit('state', this.state);
      return { ok: true };
    } finally { this.busy = false; }
  }
}

export { MONSTERS };
