import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, migrate } from '../src/core/state.js';
import { drawSkill, skillGrade, skillRateTable } from '../src/core/gacha.js';
import { skillMods } from '../src/core/gearplus.js';
import { BALANCE } from '../src/data/balance.js';
import { GRADE_BONUS, GRADE_EFFECT, SKILL_GRADES, bonusText } from '../src/data/skillgrade.js';
import { SKILLS } from '../src/data/content.js';
import { makeRng } from '../src/core/util.js';

const T0 = Date.UTC(2026, 10, 8, 3, 0, 0);
const GS = BALANCE.gacha.skill;
// rng whose weighted() always returns a fixed key and whose () returns 0 (first skill in the pool)
const fixed = (key) => { const b = makeRng(1); return Object.assign(() => 0, { weighted: () => key, pick: b.pick, int: b.int }); };
const rich = () => { const s = newGame(T0); s.wallet.gem = 1e7; return s; };

test('스킬 등급: published table sums to 1 and every skill has a grade bonus', () => {
  const t = skillRateTable();
  assert.ok(Math.abs(Object.values(t).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(Object.keys(t).filter((k) => k !== 'rune'), SKILL_GRADES);
  for (const id of Object.keys(SKILLS)) { assert.ok(GRADE_BONUS[id], id); assert.ok(bonusText(id, 'mythic'), id); }
});

test('스킬 카드: higher grade upgrades (old grade books returned), same/lower only gives books', () => {
  const s = rich();
  const sk = s.skills.equipped[0];
  let r = drawSkill(s, 1, fixed('epic'));
  assert.equal(r.results[0].kind, 'card');
  assert.equal(r.results[0].skill, sk);
  assert.equal(r.results[0].upgraded, true);
  assert.equal(skillGrade(s, sk), 'epic');
  assert.equal(s.skills.books[sk], GS.books.epic);
  r = drawSkill(s, 1, fixed('rare'));                       // lower: books only
  assert.equal(r.results[0].upgraded, false);
  assert.equal(skillGrade(s, sk), 'epic');
  assert.equal(s.skills.books[sk], GS.books.epic + GS.books.rare);
  r = drawSkill(s, 1, fixed('legendary'));                  // upgrade: legendary books + epic refund
  assert.equal(r.results[0].upgraded, true);
  assert.equal(r.results[0].books, GS.books.legendary + GS.books.epic);
  assert.equal(skillGrade(s, sk), 'legendary');
});

test('신화 천장: the 150th draw without a mythic is a mythic card; rune pity still at 100', () => {
  const s = rich();
  for (let i = 0; i < GS.mythicPity - 1; i++) { s.gacha.sk.pity = 0; drawSkill(s, 1, fixed('common')); }
  assert.equal(s.gacha.sk.mythPity, GS.mythicPity - 1);
  s.gacha.sk.pity = 0;
  const r = drawSkill(s, 1, fixed('common'));
  assert.equal(r.results[0].rarity, 'mythic');
  assert.equal(r.results[0].pity, true);
  assert.equal(s.gacha.sk.mythPity, 0);
  const s2 = rich();
  for (let i = 0; i < GS.pity - 1; i++) drawSkill(s2, 1, fixed('common'));
  assert.equal(drawSkill(s2, 1, fixed('common')).results[0].kind, 'rune');
});

test('등급 효과는 skillMods로 들어간다 (전설: 배율·대기·보너스)', () => {
  const s = newGame(T0);
  const sk = s.skills.equipped[0];
  s.skills.grades = { [sk]: 'legendary' };
  const m = skillMods(s)[sk];
  assert.equal(m.coefMul, GRADE_EFFECT.legendary.coefMul);
  assert.equal(m.cdMul, GRADE_EFFECT.legendary.cdMul);
  for (const k of Object.keys(GRADE_BONUS[sk].legendary)) assert.ok(m[k] !== undefined, k);
});

test('기존 세이브: grades 없이도 열리고 레벨·스킬북·각성은 그대로 (전부 일반)', () => {
  const s = newGame(T0);
  delete s.skills.grades;
  s.skills.levels = { strike: 7 }; s.skills.books = { strike: 33 }; s.skills.awaken = { strike: 1 };
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(m.skills.grades, {});
  assert.equal(m.skills.levels.strike, 7);
  assert.equal(m.skills.books.strike, 33);
  assert.equal(m.skills.awaken.strike, 1);
  assert.equal(skillGrade(m, 'strike'), 'common');
});
