// Personal Dashboard - Mobile shell: shared DOM helpers
// Keyed list patching, paused-WAAPI movers, reduced-motion aware animations,
// haptics, per-browser storage and a few small controls (segmented, chip).
// The rules every helper follows (glass-glow.js watches the whole document):
// no innerHTML rebuilds of live lists, no transforms left on elements, no
// inline style writes per frame. Units import these through the shell api,
// or directly with the ?v= specifier.

import { getUsername } from '../../core/auth.js';

const reducedMotionQuery = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return null; }
})();

export function reduceMotion() {
  return !!(reducedMotionQuery && reducedMotionQuery.matches);
}

// One-shot animation that leaves nothing behind (fill: none). Null when
// motion is reduced or Web Animations are missing.
export function animate(el, keyframes, opts = {}) {
  if (!el || reduceMotion() || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, { duration: 200, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', ...opts, fill: 'none' });
  } catch {
    return null;
  }
}

// Move an element every frame without writing its style: a paused Web
// Animation whose single keyframe is replaced (the drop-light.js trick).
// release() cancels it, so the element keeps no transform.
export function createMover(el) {
  let anim = null;
  return {
    moveTo(x, y, scale = 1) {
      if (!el) return;
      const frame = { transform: `translate(${(+x || 0).toFixed(1)}px, ${(+y || 0).toFixed(1)}px) scale(${scale})` };
      try {
        if (anim) {
          anim.effect.setKeyframes([frame, frame]);
        } else {
          anim = el.animate([frame, frame], { duration: 1000, fill: 'both' });
          anim.pause();
          anim.currentTime = 0;
        }
      } catch {
        anim = null;
      }
    },
    release() {
      if (anim) { try { anim.cancel(); } catch { /* already gone */ } }
      anim = null;
    },
  };
}

const HAPTICS = { tick: 8, lift: 10, commit: 14 };
export function haptic(kind = 'tick') {
  try {
    if (navigator.vibrate) navigator.vibrate(HAPTICS[kind] || HAPTICS.tick);
  } catch { /* not allowed (no user activation) */ }
}

// Per-browser state under localStorage 'dashboard_mobile_<ns>' (one JSON
// object per namespace). Never synced, never in the model.
// { perAccount: true } (unsaved writing: 'write', 'compose') adds the signed-in
// account to the key ('dashboard_mobile_<ns>@<username>'; signed out: the bare
// key), worked out on every access like the profile's own scoped key, so one
// account's drafts never show under another on a shared phone
export function store(ns, { perAccount = false } = {}) {
  const keyOf = () => {
    const user = perAccount ? getUsername() : '';
    return 'dashboard_mobile_' + ns + (user ? '@' + user : '');
  };
  const read = () => {
    try {
      const raw = localStorage.getItem(keyOf());
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  };
  return {
    get(name, fallback) {
      const obj = read();
      return Object.prototype.hasOwnProperty.call(obj, name) ? obj[name] : fallback;
    },
    set(name, value) {
      const obj = read();
      if (value === undefined) delete obj[name]; else obj[name] = value;
      try { localStorage.setItem(keyOf(), JSON.stringify(obj)); } catch { /* private mode / quota */ }
    },
  };
}

// Keyed list patch. Rows are recreated only when their signature changes;
// otherwise the same element is kept (and moved if the order changed), so
// scroll position, focus and running animations survive a re-render.
// Children the patcher did not create (e.g. glass-glow's highlight span) are
// left where they are.
export function patchList(container, items, { key, sig, create, update } = {}) {
  if (!container || typeof key !== 'function' || typeof create !== 'function') return;
  const prev = container._mxRows || new Map();
  const next = new Map();
  const order = [];
  (items || []).forEach((item, i) => {
    const k = String(key(item, i));
    if (next.has(k)) return;                   // duplicate key: first wins
    const s = typeof sig === 'function' ? String(sig(item, i)) : '';
    const old = prev.get(k);
    let el;
    if (old && old.sig === s) {
      el = old.el;
      if (typeof update === 'function') update(el, item, i);
    } else {
      el = create(item, i);
      if (!el) return;
      el._mxKey = k;
      if (old && old.el.parentNode === container) old.el.replaceWith(el);
    }
    next.set(k, { el, sig: s });
    order.push(el);
  });
  // Remove rows that are gone
  const keep = new Set(order);
  prev.forEach(row => {
    if (!keep.has(row.el) && row.el.parentNode === container) row.el.remove();
  });
  // Put rows in order, touching the DOM only where the order differs
  let cursor = container.firstChild;
  const managed = (n) => n && n.nodeType === 1 && n._mxKey !== undefined;
  for (const el of order) {
    while (cursor && cursor !== el && !managed(cursor)) cursor = cursor.nextSibling;
    if (cursor === el) { cursor = cursor.nextSibling; continue; }
    container.insertBefore(el, cursor);
  }
  container._mxRows = next;
}

export function visuallyHidden(text) {
  const span = document.createElement('span');
  span.className = 'mx-visually-hidden';
  span.textContent = text;
  return span;
}

// A pill chip (36px look, 44px hit). opts: { label, count?, dotRgb?, selected?, title?, onClick? }
export function chip({ label = '', count = null, dotRgb = null, selected = false, title = '', onClick = null } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mx-chip';
  btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
  if (dotRgb) {
    btn.style.setProperty('--priority-rgb', dotRgb);
    const dot = document.createElement('span');
    dot.className = 'mx-chip-dot';
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(dot);
  }
  if (label) {
    const text = document.createElement('span');
    text.className = 'mx-chip-label';
    text.textContent = label;
    btn.appendChild(text);
  }
  if (count != null) {
    const c = document.createElement('span');
    c.className = 'mx-chip-count';
    c.textContent = String(count);
    btn.appendChild(c);
  }
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

// Segmented control. options: [{ value, label, count? }]. Returns the element
// with .setValue(v) and .setCounts({ value: n }); onChange(value) on a tap.
export function segmented({ options = [], value = null, label = '', onChange = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'mx-seg';
  wrap.setAttribute('role', 'tablist');
  if (label) wrap.setAttribute('aria-label', label);
  const buttons = new Map();
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mx-seg-opt';
    btn.setAttribute('role', 'tab');
    btn.dataset.value = opt.value;
    const text = document.createElement('span');
    text.className = 'mx-seg-label';
    text.textContent = opt.label;
    btn.appendChild(text);
    if (opt.count != null) {
      const c = document.createElement('span');
      c.className = 'mx-seg-count';
      c.textContent = String(opt.count);
      btn.appendChild(c);
    }
    btn.addEventListener('click', () => {
      if (wrap.value === opt.value) return;
      wrap.setValue(opt.value);
      if (onChange) onChange(opt.value);
    });
    buttons.set(opt.value, btn);
    wrap.appendChild(btn);
  });
  wrap.setValue = (v) => {
    wrap.value = v;
    buttons.forEach((btn, val) => btn.setAttribute('aria-selected', val === v ? 'true' : 'false'));
  };
  wrap.setCounts = (counts = {}) => {
    buttons.forEach((btn, val) => {
      const c = btn.querySelector('.mx-seg-count');
      if (c && counts[val] != null && c.firstChild && c.firstChild.data !== String(counts[val])) c.firstChild.data = String(counts[val]);
    });
  };
  wrap.setValue(value == null && options.length ? options[0].value : value);
  return wrap;
}
