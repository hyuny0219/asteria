// Small DOM toolkit: element builder, icons, accessible modals, busy buttons, toasts.
import { ICONS } from './icons.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function icon(name, size = 24, label = null) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${ICONS[name] || ''}</svg>`;
  return span;
}

// GPT M skill grade frame: wraps an icon so the grade frame (rare..mythic) sits over its
// edge (styles: .sgf). Common skills get no frame and the icon is returned as is.
export function gradeFramed(el, grade) {
  if (!grade || grade === 'common') return el;
  return h('span', { class: `sgf sgf-${grade}` }, el);
}
export const GRADE_UP_ICON = 'assets/runtime/frame_sg_up.webp';

export function img(src, alt = '', cls = '') {
  const el = document.createElement('img');
  el.src = src; el.alt = alt; el.decoding = 'async'; el.draggable = false;
  if (cls) el.className = cls;
  return el;
}

// ---------- busy buttons ----------
// Runs fn once; while pending the button shows a spinner + "처리 중" and ignores clicks.
// Focus returns to the same button afterwards (or to `focusAfter`).
export function busyButton(btn, fn) {
  btn.addEventListener('click', async (ev) => {
    if (btn.dataset.busy === '1' || btn.disabled) { ev.preventDefault(); return; }
    btn.dataset.busy = '1';
    const label = btn.innerHTML;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-busy');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>처리 중</span>';
    try { await fn(ev); }
    finally {
      if (btn.isConnected) {
        btn.innerHTML = label;
        btn.dataset.busy = '0';
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
        if (document.activeElement === document.body) btn.focus({ preventScroll: true });
      }
    }
  });
  return btn;
}
export function button(label, { cls = 'btn', onClick, busy = false, disabled = false, ariaLabel = null, title = null, dataset = null } = {}) {
  const b = h('button', { type: 'button', class: cls, disabled, 'aria-label': ariaLabel, title });
  if (dataset) Object.assign(b.dataset, dataset);
  if (typeof label === 'string') b.textContent = label; else append(b, [label]);
  if (onClick) { if (busy) busyButton(b, onClick); else b.addEventListener('click', onClick); }
  return b;
}

// ---------- modals ----------
const stack = [];
let root = null;
export function initModals(el) { root = el; document.addEventListener('keydown', onKey, true); }

// v18 뒤로 가기: 맨 위 창을 닫음. 닫을 수 없는 창(저장 실패 등)이면 아무것도 안 하고 true(뒤로 가기 소비).
export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  if (top.dismissible) top.close('back');
  return true;
}

function focusables(el) {
  return [...el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
}
function onKey(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    if (top.dismissible) { e.preventDefault(); e.stopPropagation(); top.close('escape'); }
    return;
  }
  if (e.key === 'Tab') {
    const f = focusables(top.panel);
    if (!f.length) { e.preventDefault(); top.panel.focus(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!top.panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
}

/**
 * openModal({id, title, desc, body, actions, dismissible, onClose, kind})
 * Background input is blocked by the overlay and `inert` on the app shell.
 * Returns a handle {close, panel, update(body)}.
 */
export function openModal(o) {
  const existing = stack.find((m) => m.id && m.id === o.id);
  if (existing) existing.close('replace');
  const titleId = 'm-title-' + Math.random().toString(36).slice(2, 8);
  const descId = o.desc ? titleId + '-d' : null;
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'modal-overlay' + (o.kind ? ' modal-' + o.kind : ''), dataset: { screen: o.id || '' } });
  const panel = h('div', { class: 'modal', role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': descId, tabindex: '-1' });
  const header = h('div', { class: 'modal-head' },
    h('h2', { id: titleId, class: 'modal-title' }, o.title),
    o.dismissible !== false ? button(icon('close', 22), { cls: 'icon-btn', ariaLabel: '닫기', onClick: () => handle.close('button') }) : null);
  const bodyEl = h('div', { class: 'modal-body' });
  if (o.desc) bodyEl.appendChild(h('p', { id: descId, class: 'modal-desc' }, o.desc));
  if (o.body) append(bodyEl, [o.body]);
  const actions = h('div', { class: 'modal-actions' });
  if (o.actions) append(actions, o.actions);
  panel.append(header, bodyEl);
  if (o.actions && o.actions.length) panel.appendChild(actions);
  overlay.appendChild(panel);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && o.dismissible !== false && o.backdropClose !== false) handle.close('backdrop'); });
  root.appendChild(overlay);
  const shell = document.getElementById('app');
  if (shell) shell.inert = true;
  const handle = {
    id: o.id, panel, body: bodyEl, dismissible: o.dismissible !== false,
    closed: false,
    close(reason = 'code') {
      if (handle.closed) return;
      handle.closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      overlay.remove();
      if (!stack.length && shell) shell.inert = false;
      if (o.onClose) o.onClose(reason);
      const target = o.returnFocus || prevFocus;
      if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    },
    setBody(node) { clear(bodyEl); if (o.desc) bodyEl.appendChild(h('p', { id: descId, class: 'modal-desc' }, o.desc)); append(bodyEl, [node]); },
    setActions(list) { clear(actions); append(actions, list); if (!actions.isConnected) panel.appendChild(actions); },
  };
  stack.push(handle);
  requestAnimationFrame(() => {
    const f = focusables(panel);
    (o.initialFocus ? panel.querySelector(o.initialFocus) : f.find((x) => x.classList.contains('btn-primary')) || f[0] || panel).focus({ preventScroll: true });
  });
  return handle;
}
export function closeAllModals(except = null) { for (const m of [...stack]) if (m.id !== except) m.close('closeAll'); }
export function topModal() { return stack[stack.length - 1] || null; }
export function modalOpen(id) { return id === undefined ? stack.length > 0 : stack.some((m) => m.id === id); }

// ---------- toasts (secondary info only; critical errors use modals) ----------
let toastEl = null;
export function initToasts(el) { toastEl = el; }
export function toast(text, kind = 'info', ms = 2600) {
  if (!toastEl) return;
  const t = h('div', { class: 'toast toast-' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);
  toastEl.appendChild(t);
  while (toastEl.children.length > 2) toastEl.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
