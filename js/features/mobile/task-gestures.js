// Personal Dashboard - Mobile shell: the task row touch model (unit F1)
// One controller per list (Tasks) or per row (rows lent to Today). States:
//
//   idle ─pointerdown on a row (not its buttons; 24px from the column edges)─► pressing
//   pressing: moved > 8px, horizontal (|dx| > 10, > 1.5|dy|)  → swiping
//             moved > 8px otherwise                           → idle (the browser scrolls)
//             380ms still, or 'contextmenu'                   → lifted
//             up / cancel                                      → idle (a plain tap: click opens)
//   lifted:   (renders deferred) first post-lift touchmove not cancelable → idle (the browser scrolls)
//             moved > 8px → dragging ('list'); released still → Lift & place ('list') / actions sheet ('today')
//   dragging: a ghost follows the finger; targets are static rects captured at the lift (gaps, pane
//             headers, colour chips, the other segment); near the chrome edges the page auto-scrolls.
//             Release over a target places it (Undo toast); anywhere else glides back.
//   swiping:  the pill follows dx. → past 40% (or a fling) completes; ← past 72px reveals two buttons
//             (it never commits); otherwise it springs back.
//
// Movement never writes style per frame: the ghost, the pill offset and the
// drop light move through paused Web Animations (ui.createMover, drop-light.js),
// so glass-glow's MutationObservers stay asleep. The touched node is never
// moved or removed mid-gesture (the source row only turns visibility:hidden).
// One non-passive touchmove listener on the list cancels scrolling only while
// a row is lifted, dragged or swiped.

import { GESTURE } from '../../core/mobile-tasks.js';
import { showDropLight, hideDropLight } from '../drop-light.js';

const G = GESTURE;
const SKIP = '.mx-check, .task-timer, .mx-row-actions, .mx-row-open, .mx-swipe-under button, .mx-gap';

// --- The one revealed row (swipe ←), shared by every controller -------------------

let revealed = null;        // { slot, pill, anim }
let revealGuard = null;     // document listeners while a row is revealed
let closingEvent = null;    // the pointerdown that closed a reveal starts nothing else

function reduce() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Animate the pill's x offset; keep: true holds the end (a fill-forwards animation, cancelled later)
function glide(el, from, to, ms, keep = false) {
  if (!el || typeof el.animate !== 'function') return null;
  if (reduce()) ms = 1;
  try {
    return el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration: ms, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)', fill: keep ? 'forwards' : 'none' });
  } catch { return null; }
}

export function closeAnyReveal({ immediate = false } = {}) {
  if (!revealed) return;
  const { slot, pill, anim } = revealed;
  revealed = null;
  if (revealGuard) { revealGuard(); revealGuard = null; }
  const done = () => {
    if (anim) { try { anim.cancel(); } catch { /* gone */ } }
    if (!revealed || revealed.slot !== slot) delete slot.dataset.swipe;
  };
  if (immediate || !pill.isConnected) { done(); return; }
  const back = glide(pill, -2 * G.REVEAL, 0, 160);
  if (anim) { try { anim.cancel(); } catch { /* gone */ } }
  if (back) back.onfinish = done; else done();
}

export function isRevealOpen() {
  return !!revealed;
}

// Swallow the click that follows a lift, a swipe or a closing tap
function suppressClick() {
  let timer = 0;
  const off = () => { window.removeEventListener('click', h, true); clearTimeout(timer); };
  const h = (e) => {
    if (!e.isTrusted) return;          // a click code dispatches (el.click()) is never the user's
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); off();
  };
  window.addEventListener('click', h, true);
  timer = setTimeout(off, 380);
}

// A tap that opens something (the task editor, a sheet, the Completed screen)
// shields the next ~350 ms: the second tap of a double tap would otherwise land
// inside what just opened (a colour swatch, the date field, Restore) and, with
// Back = keep, change the task by accident. The shielded touch gets no
// handlers, no focus and no click (touchend / mousedown are cancelled); a touch
// that starts inside the window is swallowed until it ends.
const SHIELD_MS = 350;
const SHIELD_TYPES = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'contextmenu'];
let shield = null;          // { until, pointers: Set, timer }

export function shieldTaps(ms = SHIELD_MS) {
  const until = performance.now() + ms;
  if (shield) {
    shield.until = Math.max(shield.until, until);
    clearTimeout(shield.timer);
    shield.timer = setTimeout(maybeDropShield, ms + 20);
    return;
  }
  const s = { until, pointers: new Set(), timer: 0, hardStop: performance.now() + 3000 };
  const h = (e) => {
    // Only the user's own second tap is swallowed: a click another unit
    // dispatches (Back = keep's Save, Restore → Edit) must still land
    if (!e.isTrusted) return;
    const t = e.type;
    const active = performance.now() < s.until;
    if (t === 'pointerdown') {
      if (!active) { maybeDropShield(); return; }
      s.pointers.add(e.pointerId);
    } else if (!active && !s.pointers.size) {
      maybeDropShield();
      return;
    }
    if (t === 'pointerup' || t === 'pointercancel') {
      s.pointers.delete(e.pointerId);
      // the click (and compat mouse events) of this pointer still follow
      s.until = Math.max(s.until, performance.now() + 100);
      clearTimeout(s.timer);
      s.timer = setTimeout(maybeDropShield, 120);
    }
    if (e.cancelable && t !== 'touchstart' && t !== 'pointerup' && t !== 'pointercancel') e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  s.handler = h;
  SHIELD_TYPES.forEach(t => window.addEventListener(t, h, { capture: true, passive: false }));
  s.timer = setTimeout(maybeDropShield, ms + 20);
  shield = s;
}

function maybeDropShield() {
  const s = shield;
  if (!s) return;
  const now = performance.now();
  if ((s.pointers.size || now < s.until) && now < s.hardStop) {
    clearTimeout(s.timer);
    s.timer = setTimeout(maybeDropShield, Math.max(20, s.until - now + 20));
    return;
  }
  clearTimeout(s.timer);
  SHIELD_TYPES.forEach(t => window.removeEventListener(t, s.handler, { capture: true }));
  shield = null;
}

function setReveal(slot, pill, anim) {
  revealed = { slot, pill, anim };
  // The first tap anywhere else only closes it; scrolling closes it too
  const onDown = (e) => {
    if (!revealed) return;
    if (revealed.slot.contains(e.target) && e.target.closest('.mx-swipe-under button')) return;
    closingEvent = e;
    closeAnyReveal();
    suppressClick();
  };
  const onScroll = () => closeAnyReveal();
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  revealGuard = () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('scroll', onScroll);
  };
}

// --- The controller ------------------------------------------------------------------

// opts: { api, mode: 'list'|'today', actions: taskActions, view? (list mode: dragTargets(id),
//         setDragHint(hint), startCarry(id)), onUse?() }
export function attachGestures(root, opts) {
  const { api, mode = 'list' } = opts;
  let g = null;            // the gesture in progress
  const owner = Symbol(`task-gestures:${mode}`);   // this controller's hold on the shell's gesture flag

  const actions = () => opts.actions || {};

  function columnRect() {
    const col = document.getElementById('mx-screens');
    const r = col ? col.getBoundingClientRect() : null;
    return r && r.width ? { left: r.left, right: r.right } : { left: 0, right: window.innerWidth };
  }

  function listen(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('pointermove', onMove, true);
    document[fn]('pointerup', onUp, true);
    document[fn]('pointercancel', onCancel, true);
    document[fn]('keydown', onKey, true);
    document[fn]('visibilitychange', onHidden);
    window[fn]('scroll', onScroll, { passive: true, capture: true });
  }

  // The page scrolled under a press: it was a scroll, never a hold (some
  // browsers scroll without a pointercancel, or before a pointermove arrives)
  function onScroll() {
    if (g && g.state === 'pressing' && Math.abs(window.scrollY - g.sy) > 1) end();
  }

  function onDown(e) {
    if (g) return;
    if (e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const slot = e.target.closest('.mx-task-slot');
    if (!slot || !root.contains(slot) || slot.dataset.state) return;
    if (document.documentElement.hasAttribute('data-mx-carry')) return;
    if (e.target.closest(SKIP)) return;
    if (revealed || e === closingEvent) return;              // this tap only closes the reveal
    const col = columnRect();
    if (e.clientX < col.left + G.EDGE_GUARD || e.clientX > col.right - G.EDGE_GUARD) return;
    const pill = slot.querySelector('.mx-task');
    if (!pill) return;
    const now = performance.now();
    g = {
      state: 'pressing', id: e.pointerId, type: e.pointerType, slot, pill, taskId: slot.dataset.taskId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, pts: [[e.clientX, now]], timer: 0,
      sy: window.scrollY,
    };
    g.timer = setTimeout(() => lift(), G.LIFT_MS);
    listen(true);
  }

  function onContextMenu(e) {
    const slot = e.target.closest('.mx-task-slot');
    if (!slot || !root.contains(slot)) return;
    e.preventDefault();
    if (g && g.state === 'pressing' && g.slot === slot) { lift(); return; }
    // A right-click in the desktop preview: the actions sheet
    if (!g && e.pointerType !== 'touch' && !document.documentElement.hasAttribute('data-mx-carry') && !e.target.closest(SKIP)) {
      const a = actions();
      if (a.openActionsSheet) a.openActionsSheet(slot.dataset.taskId);
    }
  }

  // Non-passive: cancels the page scroll only while a row is lifted, dragged or swiped
  function onTouchMove(e) {
    if (!g || g.state === 'pressing') return;
    if (!e.cancelable) {
      if (g.state === 'lifted') abandon();
      return;
    }
    e.preventDefault();
  }

  function onMove(e) {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX;
    g.y = e.clientY;
    const now = performance.now();
    g.pts.push([e.clientX, now]);
    if (g.pts.length > 8) g.pts.shift();
    const dx = g.x - g.x0;
    const dy = g.y - g.y0;
    if (g.state === 'pressing') {
      if (Math.hypot(dx, dy) <= G.SLOP) return;
      clearTimeout(g.timer);
      if (Math.abs(dx) > G.SWIPE_MIN_DX && Math.abs(dx) > G.SWIPE_RATIO * Math.abs(dy)) startSwipe();
      else end();                                             // a scroll: the browser takes it
      return;
    }
    if (g.state === 'lifted') {
      if (Math.hypot(dx, dy) <= G.SLOP) return;
      if (mode === 'list' && opts.view) startDrag();
      else abandon();
      return;
    }
    if (g.state === 'dragging') { moveDrag(); return; }
    if (g.state === 'swiping') moveSwipe(dx);
  }

  function onUp(e) {
    if (!g || e.pointerId !== g.id) return;
    const s = g.state;
    if (s === 'pressing') { end(); return; }                  // a tap: the click opens the task
    suppressClick();
    if (s === 'lifted') {
      const id = g.taskId;
      const { ghost, mover, slot } = finishLift();
      if (slot) slot.classList.remove('is-lifted');
      if (mode === 'list' && opts.view) {
        dropGhost(ghost, mover);
        opts.view.startCarry(id);
      } else {
        const a = actions();
        if (a.openActionsSheet) a.openActionsSheet(id);
      }
      return;
    }
    if (s === 'dragging') { drop(); return; }
    if (s === 'swiping') releaseSwipe();
  }

  function onCancel(e) {
    if (!g || (e && e.pointerId !== undefined && e.pointerId !== g.id)) return;
    if (g.state === 'pressing') { end(); return; }
    if (g.state === 'lifted') { abandon(); return; }
    if (g.state === 'dragging') { cancelDrag(); return; }
    if (g.state === 'swiping') springBack();
  }

  function onKey(e) {
    if (e.key === 'Escape' && g && g.state !== 'pressing') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  function onHidden() {
    if (document.visibilityState === 'hidden') onCancel();
  }

  // Back to idle (listeners off, renders resume)
  function end() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.raf) cancelAnimationFrame(g.raf);
    const wasActive = g.state !== 'pressing';
    g = null;
    listen(false);
    if (wasActive) api.setGestureActive(false, owner);
  }

  // --- Lift ---------------------------------------------------------------------

  function lift() {
    if (!g || g.state !== 'pressing') return;
    clearTimeout(g.timer);
    if (Math.abs(window.scrollY - g.sy) > 1 || Math.hypot(g.x - g.x0, g.y - g.y0) > G.SLOP) { end(); return; }
    g.state = 'lifted';
    api.setGestureActive(true, owner);
    api.haptic('lift');
    closeAnyReveal({ immediate: true });
    if (opts.onUse) opts.onUse();
    if (mode === 'list' && opts.view) {
      makeGhost();
      g.slot.classList.add('is-lifted');
      g.targets = opts.view.dragTargets(g.taskId);
      opts.view.setDragHint({ dragging: true });
    } else {
      api.animate(g.pill, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260 });
    }
  }

  // A lift that the browser turned into a scroll, or a hold that moved in Today: nothing happens
  function abandon() {
    if (!g) return;
    const { ghost, mover, slot } = finishLift();
    if (mover) mover.release();
    if (ghost) ghost.remove();
    if (slot) slot.classList.remove('is-lifted');
  }

  // Common clean-up after a lift: listeners off, renders resume. The ghost
  // and its mover are handed back to the caller (they are not touched here)
  function finishLift() {
    if (!g) return { ghost: null, mover: null, cur: { x: 0, y: 0 }, slot: null };
    hideDropLight();
    const out = { ghost: g.ghost, mover: g.mover, cur: { x: g.x - g.x0, y: g.y - g.y0 }, slot: g.slot };
    g.ghost = null;
    g.mover = null;
    if (opts.view && mode === 'list') opts.view.setDragHint({ dragging: false });
    end();
    return out;
  }

  function makeGhost() {
    const r = g.pill.getBoundingClientRect();
    const layer = document.getElementById('mx-drag-layer') || document.body;
    const ghost = document.createElement('div');
    ghost.className = `mx-ghost mx-tone-${g.slot.className.match(/mx-tone-(\w+)/)?.[1] || 'blue'}`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    const clone = g.pill.cloneNode(true);
    clone.classList.add('dragging');
    clone.removeAttribute('tabindex');
    clone.querySelectorAll('.mx-row-actions, .mx-row-open').forEach(n => n.remove());
    clone.querySelectorAll('[data-live-timer]').forEach(n => delete n.dataset.liveTimer);
    clone.querySelectorAll('[data-timer-task]').forEach(n => delete n.dataset.timerTask);
    ghost.appendChild(clone);
    layer.appendChild(ghost);
    g.ghost = ghost;
    g.mover = api.createMover(ghost);
    g.mover.moveTo(0, 0, 1.03);
  }

  function dropGhost(ghost, mover) {
    if (mover) mover.release();
    if (!ghost) return;
    const a = api.animate(ghost, [{ transform: 'scale(1.03)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }], { duration: 140 });
    ghost.style.opacity = '0';
    if (a) a.onfinish = () => ghost.remove(); else ghost.remove();
  }

  // --- Drag -----------------------------------------------------------------------

  function startDrag() {
    g.state = 'dragging';
    g.target = null;
    moveDrag();
    const loop = () => {
      if (!g || g.state !== 'dragging') return;
      autoScroll();
      g.raf = requestAnimationFrame(loop);
    };
    g.raf = requestAnimationFrame(loop);
  }

  function moveDrag() {
    if (!g || !g.mover) return;
    g.mover.moveTo(g.x - g.x0, g.y - g.y0, 1.03);
    const t = hitTest(g.x, g.y);
    const key = t ? `${t.kind}|${t.color}|${t.pinned}|${t.index}` : '';
    if (key === g.targetKey) return;
    g.targetKey = key;
    g.target = t;
    opts.view.setDragHint(t ? { kind: t.kind, color: t.color, pinned: t.pinned } : { kind: null });
    if (t && t.beam) {
      showDropLight({ x: t.beam.x, y: t.beam.y - window.scrollY, length: t.beam.length, vertical: false });
    } else {
      hideDropLight();
    }
    if (t) api.haptic('tick');
  }

  function inside(r, x, y, pad = 0) {
    return r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function hitTest(x, y) {
    const T = g.targets;
    if (!T) return null;
    // The other segment (fixed top bar) and the colour chips (sticky): live rects
    if (T.segOther && inside(T.segOther.getBoundingClientRect(), x, y, 4)) return { kind: 'segment', pinned: !T.pinned };
    for (const c of T.chips) {
      if (inside(c.el.getBoundingClientRect(), x, y, 2)) return { kind: 'chip', color: c.color, pinned: T.pinned };
    }
    const subBottom = T.sub ? T.sub.getBoundingClientRect().bottom : 0;
    if (y < subBottom || y > chromeTop()) return null;          // over the chrome: no drop
    // Gaps: rects captured at the lift, in document coordinates
    const docY = y + window.scrollY;
    const panes = T.panes;
    for (let p = 0; p < panes.length; p++) {
      const pane = panes[p];
      const prev = panes[p - 1];
      const next = panes[p + 1];
      const zoneTop = prev ? (prev.bottom + pane.top) / 2 : -Infinity;
      const zoneBottom = next ? (pane.bottom + next.top) / 2 : pane.bottom + 56;
      if (docY < zoneTop || docY >= zoneBottom) continue;
      if (docY < pane.headBottom || !pane.rows.length) return { kind: 'header', color: pane.color, pinned: T.pinned, index: 0 };
      const rows = pane.rows;
      let i = 0;
      while (i < rows.length && docY > (rows[i].top + rows[i].bottom) / 2) i++;
      let beamY;
      if (i === 0) beamY = (pane.headBottom + rows[0].top) / 2;
      else if (i === rows.length) beamY = rows[i - 1].bottom + 4;
      else beamY = (rows[i - 1].bottom + rows[i].top) / 2;
      return { kind: 'gap', color: pane.color, pinned: T.pinned, index: i, beam: { x: pane.left + 6, y: beamY, length: Math.max(40, pane.width - 12) } };
    }
    return null;
  }

  // Top of the bottom chrome (lane, carry dock or dock, whichever is highest)
  function chromeTop() {
    let bottom = window.innerHeight;
    ['mx-live', 'mx-carry', 'mx-dock'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < bottom) bottom = r.top;
    });
    return bottom;
  }

  function autoScroll() {
    const T = g.targets;
    const top = T && T.sub ? T.sub.getBoundingClientRect().bottom : 0;
    const bottom = chromeTop();
    const y = g.y;
    let v = 0;
    if (y >= top && y < top + G.AUTOSCROLL_ZONE) v = -G.AUTOSCROLL_MAX * ((top + G.AUTOSCROLL_ZONE - y) / G.AUTOSCROLL_ZONE);
    else if (y > bottom - G.AUTOSCROLL_ZONE) v = G.AUTOSCROLL_MAX * Math.min(1, (y - (bottom - G.AUTOSCROLL_ZONE)) / G.AUTOSCROLL_ZONE);
    if (!v) return;
    const before = window.scrollY;
    window.scrollBy(0, v);
    if (window.scrollY !== before) { g.targetKey = undefined; moveDrag(); }
  }

  function drop() {
    const t = g.target;
    const id = g.taskId;
    if (!t) { cancelDrag(); return; }
    const target = t.kind === 'segment' ? { pinned: t.pinned }
      : t.kind === 'chip' ? { color: t.color, pinned: t.pinned }
        : { color: t.color, pinned: t.pinned, index: t.index };
    const lifted = finishLift();
    const a = actions();
    const res = a.placeTaskWithUndo ? a.placeTaskWithUndo(id, target) : null;
    if (res) {
      if (lifted.mover) lifted.mover.release();
      if (lifted.ghost) lifted.ghost.remove();
      if (lifted.slot) lifted.slot.classList.remove('is-lifted');
    } else {
      glideHome(lifted);                                     // same place: nothing saved
    }
  }

  function cancelDrag() {
    glideHome(finishLift());
  }

  // The ghost glides back to the row (160 ms), then the row shows again
  function glideHome({ ghost, mover, cur, slot }) {
    const finish = () => {
      if (ghost) ghost.remove();
      if (slot) slot.classList.remove('is-lifted');
    };
    if (mover) mover.release();
    if (!ghost) { finish(); return; }
    const a = api.animate(ghost, [
      { transform: `translate(${cur.x}px, ${cur.y}px) scale(1.03)` },
      { transform: 'translate(0px, 0px) scale(1)' },
    ], { duration: 160 });
    if (a) {
      // fill-less: the ghost keeps its end pose (home) until it is removed
      a.onfinish = finish;
      a.oncancel = finish;
    } else {
      finish();
    }
  }

  // --- Swipe ----------------------------------------------------------------------------

  function startSwipe() {
    g.state = 'swiping';
    api.setGestureActive(true, owner);
    g.width = g.slot.getBoundingClientRect().width || 300;
    g.mover = api.createMover(g.pill);
    g.armed = false;
    if (opts.onUse) opts.onUse();
    moveSwipe(g.x - g.x0);
  }

  function offsetFor(dx) {
    const R = G.REVEAL;
    if (dx >= 0) return Math.min(dx, g.width);
    if (dx > -2 * R) return dx;
    return -2 * R - (-dx - 2 * R) * 0.35;                   // rubber band past both buttons
  }

  function moveSwipe(dx) {
    const off = offsetFor(dx);
    g.off = off;
    const side = off >= 0 ? 'done' : 'reveal';
    if (g.slot.dataset.swipe !== side) g.slot.dataset.swipe = side;
    const armed = off > g.width * G.SWIPE_COMMIT;
    if (armed !== g.armed) {
      g.armed = armed;
      if (armed) { g.slot.dataset.armed = ''; api.haptic('tick'); } else delete g.slot.dataset.armed;
    }
    g.mover.moveTo(off, 0);
  }

  function velocity() {
    const pts = g.pts;
    if (pts.length < 2) return 0;
    const [x1, t1] = pts[pts.length - 1];
    let k = pts.length - 2;
    while (k > 0 && t1 - pts[k][1] < 60) k--;
    const [x0, t0] = pts[k];
    return (x1 - x0) / Math.max(1, t1 - t0);
  }

  function releaseSwipe() {
    const off = g.off || 0;
    const { slot, pill, mover, taskId, width } = g;
    const v = velocity();
    const commit = off > width * G.SWIPE_COMMIT || (v > G.FLING_V && off >= G.FLING_MIN_DX);
    g.mover = null;
    end();
    if (commit) {
      api.haptic('commit');
      slot.dataset.armed = '';
      const out = glide(pill, off, width, 140, true);
      if (mover) mover.release();
      const a = actions();
      const go = () => {
        if (a.completeWithUndo) a.completeWithUndo(taskId, { slot, swiped: true, onAbort: () => { if (out) out.cancel(); delete slot.dataset.swipe; delete slot.dataset.armed; } });
      };
      if (out) out.onfinish = go; else go();
      return;
    }
    if (off < -G.REVEAL) {
      const hold = glide(pill, off, -2 * G.REVEAL, 160, true);
      if (mover) mover.release();
      setReveal(slot, pill, hold);
      return;
    }
    const back = glide(pill, off, 0, 160);
    if (mover) mover.release();
    const done = () => { delete slot.dataset.swipe; delete slot.dataset.armed; };
    if (back) back.onfinish = done; else done();
  }

  function springBack() {
    const { slot, pill, mover } = g;
    const off = g.off || 0;
    g.mover = null;
    end();
    const back = glide(pill, off, 0, 160);
    if (mover) mover.release();
    const done = () => { delete slot.dataset.swipe; delete slot.dataset.armed; };
    if (back) back.onfinish = done; else done();
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('touchmove', onTouchMove, { passive: false });

  return {
    cancel() { if (g) onCancel(); },
    isActive: () => !!g,
    detach() {
      if (g) onCancel();
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('touchmove', onTouchMove);
    },
  };
}
