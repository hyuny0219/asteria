#!/usr/bin/env node
// 갈래 티어표: 같은 레벨·같은 장비 조건에서 8갈래 × 1~4차 전투력 비교.
//   단일: 보스(HP를 크게 키움)를 정해진 시간 동안 때린 피해량과 생존 시간
//   광역: 탑 몇 층까지 깨는지 (몹 무리 정리 속도 + 생존)
// 장비·스탯은 tests/v4 "fitting hero"와 같은 방식. 펫·탈것·특성·룬은 빼고 순수 직업 차이만 봄.
//   node tools/branch_tierlist.mjs [--seeds 4] [--json out.json]
import { Battle } from '../src/core/combat.js';
import { newGame } from '../src/core/state.js';
import { playerStats } from '../src/core/stats.js';
import { makeItem } from '../src/core/items.js';
import { addItems, equip, applyAutoStats } from '../src/core/economy.js';
import { skillLevel, unlockedSkills, slotCount, tierOf, oathOptions, oathOf } from '../src/core/progression.js';
import { CLASSES, CLASS_SKILLS, BOSSES, SKILLS, BRANCHES } from '../src/data/content.js';
import { towerConfig } from '../src/core/tower.js';
import { makeRng } from '../src/core/util.js';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const SEEDS = Number(args.seeds || 4);
// 단계별 기준: [레벨, 장비 등급, 강화, 보스]
const STAGE = {
  1: { lv: 45, rarity: 'epic', enh: 6, boss: 'B04' },
  2: { lv: 75, rarity: 'legendary', enh: 10, boss: 'B07' },
  3: { lv: 95, rarity: 'legendary', enh: 13, boss: 'B09' },
  4: { lv: 100, rarity: 'legendary', enh: 15, boss: 'B10' },
};

function build(branch, tier) {
  const b = BRANCHES[branch]; const st = STAGE[tier];
  const s = newGame(0, 7, b.cls);
  s.player.level = st.lv; s.player.tier = tier; s.player.branch = branch;
  if (tier >= 4) s.promotion.oath = oathOptions(s)[0].id;
  applyAutoStats(s);
  const rng = makeRng(3);
  for (const slot of ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'necklace', 'ring', 'ring']) {
    const it = makeItem(s, { slot, rarity: st.rarity, level: BOSSES[st.boss].level, rng });
    addItems(s, [it]); equip(s, it.id);
  }
  for (const k of Object.keys(s.slotEnhance)) s.slotEnhance[k] = st.enh;
  s.player.statsUpgrades = { atk: 40 + 2 * st.lv, hp: 25 + st.lv, def: 10 + st.lv / 2, crit: 10 + st.lv, speed: 10 + st.lv };
  for (const id of unlockedSkills(s)) s.skills.levels[id] = Math.min(10, 1 + Math.floor(st.lv / 10));
  // 갈래 스킬을 먼저 넣고 남는 칸을 기본 스킬로 채움 (실제 자동 장착과 비슷하게)
  const ids = unlockedSkills(s).filter((id) => SKILLS[id].kind !== 'ultimate');
  const own = ids.filter((id) => SKILLS[id].unlock && SKILLS[id].unlock.branch === branch);
  const rest = ids.filter((id) => !own.includes(id));
  const order = [...own.reverse(), ...rest];
  const n = slotCount(s);
  s.skills.equipped = s.skills.equipped.map((_, i) => (i < n ? order[i] || null : null));
  return s;
}
const hero = (s) => ({ stats: playerStats(s), pet: null, skills: s.skills, branch: s.player.branch, cls: s.player.cls, tier: tierOf(s), ult: CLASS_SKILLS[s.player.cls].ult, range: CLASSES[s.player.cls].range, skillLevel: (id) => skillLevel(s, id), oath: (oathOf(s) || {}).fx || null });

function run(b) { let guard = 0; while (!b.over && guard++ < 400000) b.step(); return b; }

// 단일 대상: HP ×200 보스를 120초 동안 — 넣은 피해(보스 최대HP 기준 배수)와 버틴 시간
function single(s, tier, seed) {
  const st = STAGE[tier];
  const b = new Battle({ kind: 'world', rng: makeRng(seed), hero: hero(s), world: { boss: st.boss, level: BOSSES[st.boss].level, hpMul: 200, atkMul: 1, timeSec: 120 } });
  const bo = b.enemies.find((e) => e.boss); const max = bo.maxHp;
  run(b);
  return { dealt: (max - Math.max(0, bo.hp)) / (max / 200), alive: b.hero.dead ? b.t / 1000 : 120 };
}
// 광역: 탑 최고층 (층마다 시드 1번, 연속 실패 2번이면 종료)
function tower(s, seed) {
  let best = 0, fails = 0;
  for (let f = 1; f <= 300 && fails < 2; f++) {
    const b = run(new Battle({ kind: 'tower', rng: makeRng(seed * 1000 + f), hero: hero(s), tower: towerConfig(f) }));
    if (b.over === 'victory') { best = f; fails = 0; } else fails++;
  }
  return best;
}

const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
const out = {};
for (const tier of [1, 2, 3, 4]) {
  out[tier] = {};
  for (const br of Object.keys(BRANCHES)) {
    const s = build(br, tier);
    const sg = [], tw = [];
    for (let seed = 1; seed <= SEEDS; seed++) { sg.push(single(s, tier, seed)); tw.push(tower(s, seed)); }
    out[tier][br] = { name: BRANCHES[br].names[tier - 1], cls: BRANCHES[br].cls, dps: med(sg.map((r) => r.dealt)), alive: med(sg.map((r) => r.alive)), tower: med(tw) };
    process.stderr.write(`${tier}차 ${out[tier][br].name}: 단일 ${out[tier][br].dps.toFixed(2)} · 생존 ${out[tier][br].alive.toFixed(0)}s · 탑 ${out[tier][br].tower}\n`);
  }
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(out, null, 1));
