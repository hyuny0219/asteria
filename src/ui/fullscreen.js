// Full-screen mode for phones.
// - Android Chrome / Samsung Internet / desktop: Fullscreen API (+ portrait lock).
// - iPhone Safari has no page fullscreen API; the only way is "홈 화면에 추가",
//   which opens the game standalone (manifest display: standalone). We show a guide.
// The preference lives in localStorage (per device, not in the save file).
const PREF = 'asteria-fullscreen-auto';

const d = document;
export const isStandalone = () => !!(matchMedia('(display-mode: standalone)').matches || navigator.standalone);
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const supported = () => !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
export const isFull = () => !!(d.fullscreenElement || d.webkitFullscreenElement);
export const isTouch = () => matchMedia('(pointer: coarse)').matches;

export function autoPref() {
  try { const v = localStorage.getItem(PREF); return v === null ? isTouch() : v === '1'; } catch { return false; }
}
export function setAutoPref(on) { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch { /* ignore */ } }

// Must be called from a user gesture (tap). Resolves true when fullscreen is on.
export async function enter() {
  if (isFull()) return true;
  const el = d.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
  } catch { return false; }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('portrait'); } catch { /* not allowed on this device */ }
  return true;
}
export async function exit() {
  try {
    if (d.exitFullscreen && d.fullscreenElement) await d.exitFullscreen();
    else if (d.webkitExitFullscreen && d.webkitFullscreenElement) d.webkitExitFullscreen();
  } catch { /* ignore */ }
}
export function onChange(fn) {
  d.addEventListener('fullscreenchange', fn);
  d.addEventListener('webkitfullscreenchange', fn);
}

// What the button should do on this device.
export function mode() {
  if (isStandalone()) return 'standalone';      // already app-like, nothing to do
  if (supported()) return 'api';
  if (isIOS()) return 'ios-guide';
  return 'none';
}

export const ICON_ENTER = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
export const ICON_EXIT = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
