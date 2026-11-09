// 스킬 형태 해석: 전직 단계(tier)·갈래(branch)에 따라 스킬 정의를 돌려주는 단 한 곳.
// 지금은 그대로(SKILLS[id])를 돌려줍니다. 승급마다 기본 스킬이 진화하는 후속 작업(이름·모습·메커니즘)은
// 여기에 { [id]: { [tier]: overrides } } 표를 더하고 이 함수만 바꾸면 전투(combat.js)가 따라갑니다.
import { SKILLS } from '../data/content.js';

export function skillDef(id, ctx = null) {   // ctx: { tier, branch, cls }
  return SKILLS[id];
}
