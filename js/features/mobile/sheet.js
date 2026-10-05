// Personal Dashboard - Mobile shell: sheets and pushed screens
// Sheets rise from the bottom of the phone column (grabber, optional title,
// a body the caller builds); pushed screens cover the column with a back bar
// (Completed, Search). Both live in #mx-layer-host, register a shell layer
// (so Back and, in the preview, Escape close the top one), make the shell
// behind them inert, and stack: z 940/950 for the first, +2 per extra one
// (max 958), always under every reused modal (lowest 1500). Closing one gives
// the focus back to the control that opened it.
// Motion is WAAPI with no fill (sheet in 220ms, out 160ms); nothing keeps a
// transform, so editors or popups opened from a sheet position correctly.

import { registerLayer, syncHistory, anyLayerOpen } from './layers.js?v=2026-10-mobile-1';
import { animate, createMover, reduceMotion } from './ui.js?v=2026-10-mobile-1';

const BACKGROUND = ['mx-topbar', 'mx-screens', 'mx-live', 'mx-carry', 'mx-dock', 'mx-plus'];
// The screens hold every row of every tab: toggling inert on them restyles
// the whole subtree (hundreds of ms per sheet on a phone with a long list).
// They are hidden from assistive tech instead (aria-hidden), the scrim takes
// the pointer, and focus that lands in them goes back to the top layer
const SCREENS = 'mx-screens';
const stack = [];              // open sheets / screens, bottom first
let uid = 0;
let focusGuard = false;

const CHEVRON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="15 18 9 12 15 6"></polyline></svg>';

function host() {
  return document.getElementById('mx-layer-host') || document.body;
}

// Everything under the top sheet is inert (shell chrome and lower sheets).
// While a task is carried (html[data-mx-carry], Lift & place) the dock and
// the + stay inert too, so a stray tap can't switch tabs mid-move.
const CARRY_INERT = new Set(['mx-dock', 'mx-plus']);
export function refreshInert() {
  const anyOpen = stack.length > 0;
  const carrying = document.documentElement.hasAttribute('data-mx-carry');
  BACKGROUND.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === SCREENS) {
      if (anyOpen !== el.hasAttribute('aria-hidden')) {
        if (anyOpen) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
      }
      return;
    }
    const inert = anyOpen || (carrying && CARRY_INERT.has(id));
    if (el.inert !== inert) el.inert = inert;
  });
  stack.forEach((entry, i) => {
    const inert = i < stack.length - 1;
    if (entry.el.inert !== inert) entry.el.inert = inert;
  });
}

function onFocusIn(e) {
  if (!stack.length) return;
  const screens = document.getElementById(SCREENS);
  if (!screens || !screens.contains(e.target)) return;
  const top = stack[stack.length - 1].el;
  try { top.focus({ preventScroll: true }); } catch { /* gone */ }
}

// Back to the control that opened the layer (keyboard and screen reader users
// keep their place), unless the focus already moved on: into an editor or a
// reused modal the layer opened, or the composer
function restoreFocus(opener, closing) {
  const active = document.activeElement;
  if (active && active !== document.body && !closing.contains(active)) return;
  if (anyLayerOpen('reused') || document.documentElement.hasAttribute('data-mx-compose')) return;
  const top = stack.length ? stack[stack.length - 1].el : null;
  let target = opener && opener.isConnected && !closing.contains(opener) &&
    !opener.closest('[inert], [aria-hidden="true"], [hidden]') ? opener : null;
  if (top && !(target && top.contains(target))) target = top;
  if (!target) target = document.querySelector('#mx-dock .mx-tab[aria-selected="true"]');
  if (target && typeof target.focus === 'function') {
    try { target.focus({ preventScroll: true }); } catch { /* gone */ }
  }
}

function zFor(level) {
  const k = Math.min(level, 4);
  return { scrim: k === 0 ? 940 : 949 + 2 * k, panel: 950 + 2 * k };
}

function makeLayer(kind, opts, buildDom) {
  // One open copy per id: opening again replaces the old one
  const existing = stack.find(s => s.id === opts.id);
  if (existing) existing.handle.close({ immediate: true });

  if (!focusGuard) { focusGuard = true; document.addEventListener('focusin', onFocusIn, true); }
  const opener = document.activeElement;
  const level = stack.length;
  const z = zFor(level);
  const scrim = document.createElement('div');
  scrim.className = 'mx-scrim';
  scrim.style.zIndex = String(z.scrim);
  const { el, body } = buildDom();
  el.style.zIndex = String(z.panel);
  el.dataset.layerId = opts.id;

  let closed = false;
  let unregister = null;
  const entry = { id: opts.id, el, scrim };
  const handle = {
    el, body,
    // fromY: a sheet dragged down leaves from where the finger let go
    close({ immediate = false, fromY = 0 } = {}) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (unregister) unregister();
      refreshInert();
      restoreFocus(opener, el);
      const done = () => { scrim.remove(); el.remove(); };
      if (immediate || reduceMotion()) {
        done();
      } else {
        const y = Math.max(0, +fromY || 0);
        const out = kind === 'screen'
          ? [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(28px)', opacity: 0 }]
          : [{ transform: `translateY(${y}px)`, opacity: 1 }, { transform: `translateY(${y + 40}px)`, opacity: 0 }];
        const a = animate(el, out, { duration: 160, easing: 'ease-in' });
        animate(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
        // Out of the way right away; removed when the animation ends
        // (the resting opacity is 0, so nothing flashes back when the
        // fill-less animation ends a frame before the removal)
        el.inert = true;
        el.dataset.closing = '1';
        el.style.opacity = '0';
        scrim.style.opacity = '0';
        scrim.style.pointerEvents = 'none';
        if (a) { a.onfinish = done; a.oncancel = done; } else done();
      }
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (err) { console.error('[mobile] onClose failed', opts.id, err); }
      }
      syncHistory();
    },
  };
  entry.handle = handle;

  scrim.addEventListener('click', () => handle.close());
  host().append(scrim, el);
  stack.push(entry);
  unregister = registerLayer({
    id: `${kind}:${opts.id}`, kind: 'shell',
    root: () => el, isOpen: () => !closed, back: () => handle.close(),
  });
  refreshInert();

  const enter = kind === 'screen'
    ? [{ transform: 'translateX(28px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]
    : [{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
  animate(el, enter, { duration: 220 });
  animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
  syncHistory();
  return handle;
}

// Drag the grabber (or the header) down to close. Past the threshold the exit
// animation starts at the dragged offset before the mover lets go, so the
// sheet never snaps back up first
function wireDragToClose(handleEl, sheet, close) {
  let start = null;
  let mover = null;
  handleEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    mover = createMover(sheet);
    try { handleEl.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  handleEl.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    start.dy = Math.max(0, e.clientY - start.y);
    mover.moveTo(0, start.dy);
  });
  const end = (e) => {
    if (!start || (e && e.pointerId !== start.id)) return;
    const { dy, t } = start;
    const v = dy / Math.max(1, performance.now() - t);
    start = null;
    if (dy > 90 || (dy > 24 && v > 0.5)) {
      close(dy);
      mover.release();
      return;
    }
    mover.release();
    if (dy > 2) animate(sheet, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 160 });
  };
  handleEl.addEventListener('pointerup', end);
  handleEl.addEventListener('pointercancel', end);
}

// opts: { id, title?, size?: 'auto'|'tall'|'full', keyboardAware?, build(body, sheet), onClose?() }
// A sheet without a title is named by the first heading its body builds
export function openSheet(opts = {}) {
  const id = opts.id || `sheet-${++uid}`;
  let handle = null;
  const o = { ...opts, id };
  handle = makeLayer('sheet', o, () => {
    const el = document.createElement('section');
    el.className = `mx-sheet mx-sheet--${o.size || 'auto'}` + (o.keyboardAware ? ' mx-sheet--kb' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.tabIndex = -1;
    if (o.title) el.setAttribute('aria-label', o.title);
    const grab = document.createElement('div');
    grab.className = 'mx-sheet-grab';
    grab.innerHTML = '<span class="mx-grabber" aria-hidden="true"></span>';
    el.appendChild(grab);
    if (o.title) {
      const head = document.createElement('header');
      head.className = 'mx-sheet-head';
      const h = document.createElement('h2');
      h.className = 'mx-sheet-title';
      h.textContent = o.title;
      head.appendChild(h);
      el.appendChild(head);
    }
    const body = document.createElement('div');
    body.className = 'mx-sheet-body';
    el.appendChild(body);
    return { el, body };
  });
  const sheet = handle.el;
  wireDragToClose(sheet.querySelector('.mx-sheet-grab'), sheet, (dy) => handle.close({ fromY: dy }));
  const head = sheet.querySelector('.mx-sheet-head');
  if (head) wireDragToClose(head, sheet, (dy) => handle.close({ fromY: dy }));

  const build = () => {
    if (typeof o.build === 'function') {
      try { o.build(handle.body, handle); } catch (err) { console.error('[mobile] sheet build failed', id, err); }
    }
    if (!o.title) {
      const h = handle.body.querySelector('h1, h2, h3');
      if (h) {
        if (!h.id) h.id = `mx-sheet-h-${++uid}`;
        sheet.setAttribute('aria-labelledby', h.id);
      } else {
        sheet.removeAttribute('aria-labelledby');
      }
    }
  };
  handle.update = () => { handle.body.replaceChildren(); build(); };
  build();
  if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
  return handle;
}

// opts: { id, title, build(body, screen), onClose?() }
export function pushScreen(opts = {}) {
  const id = opts.id || `screen-${++uid}`;
  const o = { ...opts, id };
  const handle = makeLayer('screen', o, () => {
    const el = document.createElement('section');
    el.className = 'mx-pushed';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', o.title || '');
    el.tabIndex = -1;
    const bar = document.createElement('header');
    bar.className = 'mx-pushed-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mx-icon-btn mx-pushed-back';
    back.setAttribute('aria-label', 'Back');
    back.innerHTML = CHEVRON;
    const title = document.createElement('h2');
    title.className = 'mx-pushed-title';
    title.textContent = o.title || '';
    bar.append(back, title);
    const body = document.createElement('div');
    body.className = 'mx-pushed-body';
    el.append(bar, body);
    return { el, body };
  });
  handle.el.querySelector('.mx-pushed-back').addEventListener('click', () => handle.close());
  if (typeof o.build === 'function') {
    try { o.build(handle.body, handle); } catch (err) { console.error('[mobile] screen build failed', id, err); }
  }
  if (!handle.el.contains(document.activeElement)) handle.el.focus({ preventScroll: true });
  return handle;
}

export function closeAllSheets() {
  [...stack].reverse().forEach(s => s.handle.close({ immediate: true }));
}

export function openSheetCount() {
  return stack.length;
}
