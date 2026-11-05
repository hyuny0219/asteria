// Browser persistence.
//
// IndexedDB 'asteria-nocturne' / store 'slots':
//   current       { data, sum, revision, savedAt, schemaVersion, balanceVersion }
//   previousGood  the last current that loaded/validated before this commit
// A commit is one readwrite transaction: verify stored revision == our revision
// (else conflict), move current → previousGood, write the new current. The commit
// resolves only on transaction 'complete', so "저장됨" is never shown early.
//
// One writer at a time: Web Locks 'asteria-writer' (ifAvailable). A second tab gets
// CONFLICT; "이 탭에서 계속" steals the lock and the first tab is told it lost it.
// Without Web Locks, a localStorage heartbeat is used instead.
//
// This is local-only data. Anyone with devtools can edit it; nothing here is a
// security boundary (documented in KNOWN_ISSUES.md).
import { hashString } from '../core/util.js';
import { SCHEMA_VERSION, migrate, validate } from '../core/state.js';

const DB = 'asteria-nocturne';
const STORE = 'slots';
const LS_KEY = 'asteria-nocturne-save';
const LOCK = 'asteria-writer';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis) || !globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function pack(state) {
  const data = JSON.stringify(state);
  return { data, sum: hashString(data), revision: state.revision, savedAt: state.savedAt, schemaVersion: state.schemaVersion, balanceVersion: state.balanceVersion };
}
export function unpack(rec) {
  if (!rec || typeof rec.data !== 'string') return { ok: false, error: 'missing' };
  if (hashString(rec.data) !== rec.sum) return { ok: false, error: 'checksum' };
  let s;
  try { s = JSON.parse(rec.data); } catch { return { ok: false, error: 'json' }; }
  if (s.schemaVersion > SCHEMA_VERSION) return { ok: false, error: 'newer-schema' };
  try { s = migrate(s); } catch (e) { return { ok: false, error: 'migration: ' + e.message }; }
  const problems = validate(s);
  if (problems.length) return { ok: false, error: 'invalid: ' + problems.join(',') };
  return { ok: true, state: s };
}

// Parse an exported file. Returns {ok, state, error}.
export function parseExport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: '파일 형식이 올바르지 않습니다 (JSON 아님).' }; }
  if (!obj || obj.format !== 'asteria-save' || !obj.state) return { ok: false, error: '아스테리아 저장 파일이 아닙니다.' };
  const r = unpack(pack(obj.state));
  if (!r.ok) return { ok: false, error: '저장 데이터가 손상되었거나 지원하지 않는 버전입니다. (' + r.error + ')' };
  return { ok: true, state: r.state, exportedAt: obj.exportedAt };
}

// ---------- writer lock ----------
export class WriterLock {
  constructor() { this.held = false; this.onLost = () => {}; this.release = null; this.id = Math.random().toString(36).slice(2); }
  async acquire({ steal = false } = {}) {
    if (globalThis.navigator && navigator.locks && navigator.locks.request) {
      return new Promise((resolve) => {
        const opts = steal ? { steal: true } : { ifAvailable: true };
        navigator.locks.request(LOCK, opts, (lock) => {
          if (!lock) { resolve(false); return undefined; }
          this.held = true;
          resolve(true);
          return new Promise((rel) => { this.release = rel; });
        }).catch(() => {
          // AbortError: another tab stole the lock
          if (this.held) { this.held = false; this.onLost(); }
        });
      });
    }
    return this.acquireHeartbeat(steal);
  }
  acquireHeartbeat(steal) {
    const key = LS_KEY + ':owner';
    const now = Date.now();
    let cur = null;
    try { cur = JSON.parse(localStorage.getItem(key) || 'null'); } catch { cur = null; }
    if (cur && cur.id !== this.id && now - cur.at < 6000 && !steal) return Promise.resolve(false);
    const beat = () => {
      try {
        const c = JSON.parse(localStorage.getItem(key) || 'null');
        if (c && c.id !== this.id) { this.held = false; clearInterval(this.timer); this.onLost(); return; }
        localStorage.setItem(key, JSON.stringify({ id: this.id, at: Date.now() }));
      } catch { /* ignore */ }
    };
    try { localStorage.setItem(key, JSON.stringify({ id: this.id, at: now })); } catch { return Promise.resolve(true); }
    this.held = true;
    this.timer = setInterval(beat, 2000);
    return Promise.resolve(true);
  }
}

// ---------- savers ----------
export class IdbSaver {
  constructor() { this.kind = 'indexeddb'; this.db = null; this.failNext = 0; this.knownRevision = 0; }
  async init() { this.db = await openDb(); }
  tx(mode) { return this.db.transaction(STORE, mode).objectStore(STORE); }
  get(key) { return new Promise((res, rej) => { const r = this.tx('readonly').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  async load() {
    try {
      const cur = await this.get('current');
      const prev = await this.get('previousGood');
      if (!cur) {
        if (prev) { const p = unpack(prev); if (p.ok) return { status: 'corrupt', error: 'current missing', previous: p.state }; }
        return { status: 'empty', state: null };
      }
      const c = unpack(cur);
      if (c.ok) { this.knownRevision = c.state.revision; return { status: 'ok', state: c.state }; }
      const p = prev ? unpack(prev) : { ok: false };
      return { status: 'corrupt', error: c.error, previous: p.ok ? p.state : null };
    } catch (e) {
      return { status: 'error', error: String(e && e.message || e) };
    }
  }

  commit(state) {
    if (this.failNext > 0) { this.failNext--; return Promise.resolve({ ok: false, error: '저장 실패 시뮬레이션 (개발 설정)' }); }
    return new Promise((resolve) => {
      let t;
      try { t = this.db.transaction(STORE, 'readwrite'); } catch (e) { resolve({ ok: false, error: String(e.message || e) }); return; }
      const store = t.objectStore(STORE);
      const expected = state.revision;
      let result = null;
      const getReq = store.get('current');
      getReq.onsuccess = () => {
        const cur = getReq.result;
        const stored = cur ? cur.revision : 0;
        if (stored !== expected) { result = { ok: false, conflict: true, error: `revision ${stored} ≠ ${expected}` }; t.abort(); return; }
        state.revision = expected + 1;
        const rec = pack(state);
        if (cur && unpack(cur).ok) store.put(cur, 'previousGood');
        store.put(rec, 'current');
        result = { ok: true, revision: state.revision };
      };
      t.oncomplete = () => { this.knownRevision = state.revision; resolve(result || { ok: true }); };
      t.onabort = () => {
        if (result && result.ok) { state.revision = expected; result = { ok: false, error: String(t.error && t.error.name || 'aborted') }; }
        resolve(result || { ok: false, error: String(t.error && t.error.message || 'aborted') });
      };
      t.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); };
    });
  }

  async restorePrevious() {
    const prev = await this.get('previousGood');
    const p = unpack(prev);
    if (!p.ok) return { ok: false, error: p.error };
    const cur = await this.get('current');
    p.state.revision = cur ? cur.revision : 0;
    return { ok: true, state: p.state };
  }
  async wipe() {
    return new Promise((res) => { const t = this.db.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear(); t.oncomplete = () => res({ ok: true }); t.onabort = () => res({ ok: false }); });
  }
}

export class LocalStorageSaver {
  constructor() { this.kind = 'localStorage'; this.failNext = 0; }
  async init() { localStorage.setItem(LS_KEY + ':probe', '1'); localStorage.removeItem(LS_KEY + ':probe'); }
  read(k) { try { return JSON.parse(localStorage.getItem(LS_KEY + ':' + k) || 'null'); } catch { return null; } }
  async load() {
    const cur = this.read('current');
    const prev = this.read('previousGood');
    if (!cur) return prev && unpack(prev).ok ? { status: 'corrupt', error: 'current missing', previous: unpack(prev).state } : { status: 'empty', state: null };
    const c = unpack(cur);
    if (c.ok) return { status: 'ok', state: c.state };
    const p = prev ? unpack(prev) : { ok: false };
    return { status: 'corrupt', error: c.error, previous: p.ok ? p.state : null };
  }
  async commit(state) {
    if (this.failNext > 0) { this.failNext--; return { ok: false, error: '저장 실패 시뮬레이션 (개발 설정)' }; }
    const cur = this.read('current');
    const stored = cur ? cur.revision : 0;
    if (stored !== state.revision) return { ok: false, conflict: true, error: 'revision conflict' };
    const expected = state.revision;
    state.revision = expected + 1;
    try {
      if (cur) localStorage.setItem(LS_KEY + ':previousGood', JSON.stringify(cur));
      localStorage.setItem(LS_KEY + ':current', JSON.stringify(pack(state)));
      return { ok: true, revision: state.revision };
    } catch (e) {
      state.revision = expected;
      return { ok: false, error: String(e.name || e.message || e) };
    }
  }
  async restorePrevious() {
    const p = unpack(this.read('previousGood'));
    if (!p.ok) return { ok: false, error: p.error };
    const cur = this.read('current');
    p.state.revision = cur ? cur.revision : 0;
    return { ok: true, state: p.state };
  }
  async wipe() { localStorage.removeItem(LS_KEY + ':current'); localStorage.removeItem(LS_KEY + ':previousGood'); return { ok: true }; }
}

// Pick the best available store. Returns {saver, warning}.
export async function createSaver() {
  try { const s = new IdbSaver(); await s.init(); return { saver: s, warning: null }; }
  catch (e) {
    try { const s = new LocalStorageSaver(); await s.init(); return { saver: s, warning: 'IndexedDB를 사용할 수 없어 브라우저 로컬 저장소(용량 작음)에 저장합니다.' }; }
    catch { return { saver: null, warning: '이 브라우저에서는 저장할 수 없습니다. 진행 내용이 보존되지 않습니다.' }; }
  }
}
