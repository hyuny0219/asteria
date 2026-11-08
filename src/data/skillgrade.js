// v11 스킬 등급 (뽑기형). A skill's grade comes from skill draws: the best card ever drawn
// for that skill. Grades reuse the equipment rarity keys/colours (uncommon is skipped).
// Effects are skill mods merged into stats.skillMods (same path as 각성/고유 효과), so damage
// still lands on the battle's hit events.
export const SKILL_GRADES = Object.freeze(['common', 'rare', 'epic', 'legendary', 'mythic']);
export const GRADE_NAME = Object.freeze({ common: '일반', rare: '희귀', epic: '영웅', legendary: '전설', mythic: '신화' });
export const gradeIndex = (g) => Math.max(0, SKILL_GRADES.indexOf(g || 'common'));

// per-grade base effect (all skills, ultimates included)
export const GRADE_EFFECT = Object.freeze({
  common: { coefMul: 1, cdMul: 1 },
  rare: { coefMul: 1.06, cdMul: 1 },
  epic: { coefMul: 1.12, cdMul: 0.93 },
  legendary: { coefMul: 1.2, cdMul: 0.9 },
  mythic: { coefMul: 1.32, cdMul: 0.86 },
});

// 전설 이상 보너스 효과 (per skill; 신화는 mythic 값). Uses the same mod keys as 각성.
const B = (name, desc, legendary, mythic) => Object.freeze({ name, desc, legendary, mythic });
export const GRADE_BONUS = Object.freeze({
  // 전사
  strike: B('예리한 칼날', '치명 확률 +{v}', { critBonusAdd: 0.15 }, { critBonusAdd: 0.3 }),
  shieldCharge: B('단단한 돌진', '방어 시간 +{v}초', { guardAdd: 1 }, { guardAdd: 2 }),
  warCry: B('울려 퍼지는 함성', '지속 +{v}초', { buffSecAdd: 3 }, { buffSecAdd: 6 }),
  guardCounter: B('생명의 반격', '반격 때 HP {v} 회복', { heal: 0.015 }, { heal: 0.03 }),
  berserkStrike: B('도륙', 'HP {v} 이하 적에게 2배', { execute: 0.2 }, { execute: 0.3 }),
  w_judgement: B('심판의 사슬', '기절 +{v}초', { stunAdd: 0.5 }, { stunAdd: 1 }),
  w_whirl: B('잔상 회전', '한 번 더 ({v})', { echo: 0.35 }, { echo: 0.6 }),
  starSlash: B('별의 파편', '기절 {v}초', { stunAdd: 0.6 }, { stunAdd: 1.2 }),
  // 마법사
  m_fireball: B('잔불', '한 번 더 ({v})', { echo: 0.3 }, { echo: 0.5 }),
  m_frost: B('서리 낙인', '얼림 +{v}초', { stunAdd: 0.4 }, { stunAdd: 0.8 }),
  m_shield: B('두꺼운 마력', '흡수량 +{v}', { shieldAdd: 0.06 }, { shieldAdd: 0.12 }),
  m_chain: B('번개 사슬', '한 번 더 ({v})', { echo: 0.35 }, { echo: 0.6 }),
  m_curse: B('깊은 저주', '지속 피해 ×{v}', { dotMul: 1.3 }, { dotMul: 1.6 }),
  m_blizzard: B('얼어붙은 땅', '얼림 +{v}초', { stunAdd: 0.4 }, { stunAdd: 0.8 }),
  m_drain: B('생명 착취', '회복 +{v}', { heal: 0.04 }, { heal: 0.08 }),
  m_meteor: B('잔해 낙하', '기절 {v}초', { stunAdd: 0.6 }, { stunAdd: 1.2 }),
  // 궁수
  a_aim: B('약점 포착', '치명 확률 +{v}', { critBonusAdd: 0.15 }, { critBonusAdd: 0.3 }),
  a_multi: B('여분의 화살', '+{v}발', { hitsAdd: 1 }, { hitsAdd: 2 }),
  a_leap: B('바람의 발걸음', '회피 +{v}초', { evadeAdd: 0.8 }, { evadeAdd: 1.5 }),
  a_pierce: B('관통 화살촉', '치명 확률 +{v}', { critBonusAdd: 0.15 }, { critBonusAdd: 0.3 }),
  a_beast: B('굶주린 야수', '지속 피해 ×{v}', { dotMul: 1.3 }, { dotMul: 1.6 }),
  a_snipe: B('마무리 사격', 'HP {v} 이하 적에게 2배', { execute: 0.2 }, { execute: 0.3 }),
  a_pack: B('사냥 함성', '쓸 때 HP {v} 회복', { heal: 0.03 }, { heal: 0.06 }),
  a_rain: B('연속 낙하', '+{v}번', { hitsAdd: 1 }, { hitsAdd: 2 }),
  // 도적
  r_stab: B('그림자 찌르기', '한 번 더 ({v})', { echo: 0.3 }, { echo: 0.5 }),
  r_poison: B('짙은 독', '지속 피해 ×{v}', { dotMul: 1.3 }, { dotMul: 1.6 }),
  r_shadow: B('긴 그림자', '회피 +{v}초', { evadeAdd: 0.8 }, { evadeAdd: 1.5 }),
  r_execute: B('확실한 처형', '2배 기준 HP +{v}p', { execute: 0.35 }, { execute: 0.45 }),
  r_smoke: B('독 연기', '{v}초간 독 피해', { dotAdd: { coefPerSec: 0.25, sec: 3 } }, { dotAdd: { coefPerSec: 0.4, sec: 4 } }),
  r_shadowstrike: B('그림자 일격', '치명 확률 +{v}', { critBonusAdd: 0.15 }, { critBonusAdd: 0.3 }),
  r_illusion: B('분신 강화', '한 번 더 ({v})', { echo: 0.35 }, { echo: 0.6 }),
  r_blades: B('칼날 소용돌이', '+{v}번', { hitsAdd: 2 }, { hitsAdd: 4 }),
});

// readable value for the {v} slot of a bonus
export function bonusText(id, grade) {
  const b = GRADE_BONUS[id];
  if (!b || gradeIndex(grade) < gradeIndex('legendary')) return null;
  const m = b[grade === 'mythic' ? 'mythic' : 'legendary'];
  const [k, v] = Object.entries(m)[0];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const val = k === 'critBonusAdd' || k === 'heal' || k === 'shieldAdd' || k === 'execute' ? pct(v)
    : k === 'echo' ? pct(v) : k === 'dotAdd' ? String(v.sec) : String(v);
  return { name: b.name, text: b.desc.replace('{v}', val) };
}
