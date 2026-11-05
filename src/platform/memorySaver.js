// In-memory saver with the same contract as the IndexedDB saver. Used by tests,
// the balance simulator, and as a last-resort fallback (clearly shown as unsaved).
import { hashString } from '../core/util.js';

export class MemorySaver {
  constructor({ failNext = 0 } = {}) {
    this.slots = { current: null, previousGood: null };
    this.failNext = failNext;
    this.commits = 0;
    this.kind = 'memory';
  }
  async load() {
    if (!this.slots.current) return { status: 'empty', state: null };
    const s = JSON.parse(this.slots.current.data);
    return { status: 'ok', state: s };
  }
  async commit(state) {
    if (this.failNext > 0) { this.failNext--; return { ok: false, error: 'simulated failure' }; }
    const stored = this.slots.current ? JSON.parse(this.slots.current.data).revision : 0;
    if (stored !== state.revision) return { ok: false, conflict: true, error: 'revision conflict' };
    state.revision = stored + 1;
    const data = JSON.stringify(state);
    this.slots.previousGood = this.slots.current;
    this.slots.current = { data, sum: hashString(data) };
    this.commits++;
    return { ok: true, revision: state.revision };
  }
}
