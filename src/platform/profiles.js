// Guest profiles ("게스트 로그인"): up to 3 nicknamed save slots on this device.
// The registry is a small index in localStorage; each profile's save lives in its
// own namespace in IndexedDB (see save.js keyFor). No server, no password: anyone
// using this browser can open any profile. Moving devices = export/import file.
const KEY = 'asteria-profiles';
export const MAX_PROFILES = 3;
export const NICK_RULE = /^[0-9A-Za-z가-힣_]{2,10}$/;

function read() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && Array.isArray(r.list)) return r;
  } catch { /* fall through */ }
  return { list: [], last: null };
}
function write(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); return true; } catch { return false; } }

export function list() { return read().list; }
export function last() { const r = read(); return r.list.find((p) => p.id === r.last) || null; }
export function get(id) { return read().list.find((p) => p.id === id) || null; }

export function validNick(name) {
  const n = String(name || '').trim();
  if (!NICK_RULE.test(n)) return { ok: false, reason: '2~10자, 한글·영문·숫자·_ 만 쓸 수 있어요.' };
  if (read().list.some((p) => p.nickname === n)) return { ok: false, reason: '이 기기에 같은 닉네임이 이미 있어요.' };
  return { ok: true, name: n };
}

export function create(nickname, { id = null } = {}) {
  const r = read();
  if (r.list.length >= MAX_PROFILES) return { ok: false, reason: `프로필은 ${MAX_PROFILES}개까지 만들 수 있어요.` };
  const v = validNick(nickname);
  if (!v.ok) return v;
  const p = { id: id || 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nickname: v.name, createdAt: Date.now(), lastPlayedAt: Date.now(), level: 1, job: '' };
  r.list.push(p);
  r.last = p.id;
  write(r);
  return { ok: true, profile: p };
}

export function touch(id, meta) {
  const r = read();
  const p = r.list.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, meta, { lastPlayedAt: Date.now() });
  r.last = id;
  write(r);
}
export function setLast(id) { const r = read(); r.last = id; write(r); }
export function rename(id, nickname) {
  const r = read();
  const p = r.list.find((x) => x.id === id);
  if (!p) return { ok: false, reason: 'missing' };
  if (p.nickname !== nickname) { const v = validNick(nickname); if (!v.ok) return v; p.nickname = v.name; }
  write(r);
  return { ok: true };
}
export function remove(id) {
  const r = read();
  r.list = r.list.filter((p) => p.id !== id);
  if (r.last === id) r.last = r.list[0] ? r.list[0].id : null;
  write(r);
}
