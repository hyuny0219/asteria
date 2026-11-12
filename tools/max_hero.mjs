#!/usr/bin/env node
// "지금 게임에서 만들 수 있는 가장 센 캐릭터" 세이브를 갈래별로 만듭니다 (하드 검증용).
//   Lv 100 · 초월 · 신화 장비 8칸(최고 옵션 · 고유 효과 최댓값) +15 · 스킬 Lv 30 · 신화 등급 · 각성 완성
//   각인 전부 Lv 5 · 동료 전부 Lv 30 ★5 · 탈것·날개 전부 Lv 50 ★5 · 환생 10회 + 정수 강화 최대
//   도감 전부 · 탑 250층 기준 특성 자동 배분 · 칭호 「아스테리아의 전설」 · 전사의 만찬
//   node tools/max_hero.mjs <outdir> [--awaken 0|1]
import fs from 'node:fs';
import { newGame } from '../src/core/state.js';
import { makeItem } from '../src/core/items.js';
import { makeRng } from '../src/core/util.js';
import { applyAutoStats, upgradeRoom } from '../src/core/economy.js';
import { unlockedSkills, slotCount } from '../src/core/progression.js';
import { autoAllocate } from '../src/core/talents.js';
import { REBIRTH } from '../src/core/rebirth.js';
import { BRANCHES, SKILLS, RUNES, CLASS_SKILLS } from '../src/data/content.js';
import { UNIQUES, AWAKENINGS } from '../src/data/gearplus.js';
import { PETS, PET_RULES, CODEX, CODEX_MONSTERS } from '../src/data/meta.js';
import { MOUNTS, WINGS, STEED } from '../src/data/steeds.js';
import { OATHS } from '../src/data/oath.js';
import { BALANCE } from '../src/data/balance.js';

const out = process.argv[2];
const pick = Number((process.argv.indexOf('--awaken') > 0 && process.argv[process.argv.indexOf('--awaken') + 1]) || 0);
fs.mkdirSync(out, { recursive: true });
const OPT = BALANCE.equipment.options;
const OFF = ['atkPct', 'critDmg', 'critChance', 'aspd'];
const DEF = ['hpPct', 'atkPct', 'defPct', 'cdr'];
const SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring', 'ring'];

for (const br of Object.keys(BRANCHES)) {
  const cls = BRANCHES[br].cls;
  const s = newGame(Date.now(), 7, cls);
  const now = Date.now();
  Object.assign(s.player, { level: 100, peakLevel: 100, tier: 4, branch: br });
  s.promotion.oath = OATHS[cls][0].id;
  s.tower.best = 250;
  // 환생
  s.rebirth.count = 10;
  for (const k of Object.keys(s.rebirth.levels)) s.rebirth.levels[k] = REBIRTH.upgrades[k].max;
  // 장비
  const rng = makeRng(5);
  const own = Object.keys(UNIQUES).filter((k) => UNIQUES[k].cls === cls);
  SLOTS.forEach((slot, i) => {
    const it = makeItem(s, { slot, rarity: 'mythic', level: 100, rng });
    const keys = ['weapon', 'gloves', 'ring'].includes(slot) ? OFF : DEF;
    it.options = [...keys.map((k) => ({ k, v: OPT[k][1] })), ...it.options.filter((o) => o.unique)];
    const uid = own[i % own.length];
    it.legend = { id: uid, v: UNIQUES[uid].range[1] };
    s.inventory.push(it);
    const key = slot === 'ring' ? (s.equipped.ring ? 'ring2' : 'ring') : slot;
    s.equipped[key in s.equipped ? key : slot] = it.id;
  });
  for (const k of Object.keys(s.slotEnhance)) s.slotEnhance[k] = BALANCE.equipment.enhanceMax;
  // 능력치 강화 (골드): 공·체·방 150회, 치명·속도는 상한까지
  s.player.statsUpgrades = { atk: 150, hp: 150, def: 150, crit: 0, speed: 0 };
  for (const k of ['crit', 'speed']) { const r = upgradeRoom(s, k); s.player.statsUpgrades[k] = Number.isFinite(r) ? r : 0; }
  applyAutoStats(s);
  // 스킬
  for (const id of Object.keys(SKILLS)) if (SKILLS[id].cls === cls) { s.skills.levels[id] = 30; s.skills.grades[id] = 'mythic'; if (AWAKENINGS[id]) s.skills.awaken[id] = pick; }
  const ids = unlockedSkills(s).filter((id) => SKILLS[id].kind !== 'ultimate');
  const mine = ids.filter((id) => SKILLS[id].unlock && SKILLS[id].unlock.branch === br).reverse();
  const order = [...mine, ...ids.filter((id) => !mine.includes(id))];
  s.skills.equipped = s.skills.equipped.map((_, i) => (i < slotCount(s) ? order[i] || null : null));
  for (const id of Object.keys(RUNES)) s.skills.runes.owned[id] = BALANCE.runes.maxLevel;
  s.skills.runes.equipped = ['focus', 'lifesteal'];
  // 동료 · 탈것 · 날개
  for (const id of Object.keys(PETS)) s.pets.owned[id] = { level: PET_RULES.maxLevel, stars: PET_RULES.maxStars, shards: 0 };
  s.pets.active = 'P02';
  for (const id of Object.keys(MOUNTS)) s.mounts.owned[id] = { lv: STEED.maxLevel, star: 5, shards: 0 };
  for (const id of Object.keys(WINGS)) s.wings.owned[id] = { lv: STEED.maxLevel, star: 5, shards: 0 };
  s.mounts.equipped = 'nightmare'; s.wings.equipped = 'abyss';
  // 도감 · 칭호 · 음식
  for (const id of CODEX_MONSTERS) s.codex.kills[id] = 1e6;
  for (const sl of CODEX.itemSlots) for (const r of BALANCE.equipment.rarities) s.codex.items[`${sl}:${r}`] = true;
  s.titles.owned = ['t_legend']; s.titles.equipped = 't_legend';
  s.craft = { ...(s.craft || {}), food: { id: 'feast', until: now + 365 * 864e5 } };
  // 특성 (탑 250층 · 환생 10회 기준 포인트)
  autoAllocate(s, 0); autoAllocate(s, 1);
  // 하드 열기
  s.progression.bossCleared = Object.fromEntries(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map((b) => [b, true]));
  fs.writeFileSync(`${out}/${br}.json`, JSON.stringify(s));
}
console.log('ok', Object.keys(BRANCHES).length, 'saves →', out, '· awaken', pick ? 'B' : 'A');
