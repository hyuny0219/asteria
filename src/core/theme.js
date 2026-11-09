// v14 주간 테마 (DOM-free). 주 번호는 raid/mplus와 같은 kstWeekIndex.
import { THEMES } from '../data/themes.js';
import { kstWeekIndex } from './raid.js';

export { THEMES };
export const themeFor = (now) => THEMES[((kstWeekIndex(now) % THEMES.length) + THEMES.length) % THEMES.length];
export const nextTheme = (now) => themeFor(now + 7 * 86400000);
export const weekEndsAt = (now) => (kstWeekIndex(now) + 1) * 7 * 86400000 - 3 * 86400000 - 9 * 3600000;
export const defaultTheme = () => ({ week: null, id: null, progress: 0, claimed: false });
export function refresh(state, now) {
  const w = kstWeekIndex(now);
  const t = state.theme && typeof state.theme === 'object' ? state.theme : (state.theme = defaultTheme());
  if (t.week !== w) { t.week = w; t.id = themeFor(now).id; t.progress = 0; t.claimed = false; }
  t.progress = Math.max(0, Number(t.progress) || 0);
  return t;
}
export function track(state, key, n, now) {
  const th = themeFor(now);
  if (th.challenge.key !== key || n <= 0) return;
  const t = refresh(state, now);
  if (!t.claimed) t.progress = Math.min(th.challenge.goal, t.progress + n);
}
export function status(state, now) {
  const th = themeFor(now);
  const t = refresh(state, now);
  return { theme: th, progress: t.progress, goal: th.challenge.goal, claimed: t.claimed, canClaim: !t.claimed && t.progress >= th.challenge.goal, endsAt: weekEndsAt(now), next: nextTheme(now) };
}
export function claim(state, now) {
  const st = status(state, now);
  if (st.claimed) return { ok: false, reason: 'claimed' };
  if (!st.canClaim) return { ok: false, reason: 'conditions' };
  const w = state.wallet;
  for (const [k, v] of Object.entries(st.theme.reward)) w[k] = (w[k] || 0) + v;
  state.theme.claimed = true;
  return { ok: true, reward: { ...st.theme.reward }, theme: st.theme.id };
}
// 화면 사냥 보상 배율 (방치 정산 제외)
export const bonus = (now) => themeFor(now).bonus;
export const mod = (now) => themeFor(now).mod;
