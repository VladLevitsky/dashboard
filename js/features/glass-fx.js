// Glass FX v2 — pointer-caught rim light.
// The rim of the card under the pointer catches an iridescent light near the
// cursor, and the hovered tile / pill catches a small specular.
// Mechanics (performance rules):
//  - event driven: pointermove -> at most one rAF; the rAF eases toward the
//    pointer and STOPS once settled (no permanent loop)
//  - coordinates are registered custom properties (inherits: false) written
//    onto the hovered element's own ::after through a PAUSED Web Animation
//    (element.animate with pseudoElement '::after'). Only that pseudo element
//    is restyled: no stylesheet rule changes (which re-match styles page
//    wide), and no class, attribute or inline style is ever written, so
//    glass-glow.js's MutationObservers never wake. Being paused, the
//    animation never ticks; it is cancelled when the pointer leaves.
//  - a value is only rewritten when it moved by 0.5px or more
//  - each frame reads both boxes before writing either light
//  - gated by the fx flag, a fine hover-capable pointer and reduced motion
//  - held still while <html data-fx-hush> is set (typing / selecting, see
//    "Typing hush" below); the next pointer move after it lifts catches up
//  - the paint itself lives in glass-fx.css section 12 (:hover::after only)
(() => {
  if (window.__glassFx) return;              // one listener, even if imported twice
  window.__glassFx = true;

  const CARDS = 'section.card, .app-header.card';
  const ITEMS = '.icon-button, .unified-subtask-item, .list-item, .unified-copypaste-item, .copy-paste-item';
  const html = document.documentElement;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  for (const name of ['--fx-px', '--fx-py', '--fx-ix', '--fx-iy']) {
    try { CSS.registerProperty({ name, syntax: '<length>', inherits: false, initialValue: '-999px' }); } catch { /* already registered */ }
  }

  // One tracked target (card or item): eased position + its paused animation.
  function tracker(px, py, ease) {
    return { el: null, anim: null, px, py, ease, tx: 0, ty: 0, x: 0, y: 0, wx: NaN, wy: NaN };
  }
  const card = tracker('--fx-px', '--fx-py', 0.35);
  const item = tracker('--fx-ix', '--fx-iy', 0.5);
  let frame = 0, clientX = 0, clientY = 0;

  // Map viewport px into an element's own (unzoomed) box: edit mode zooms 0.7.
  function local(el) {
    const r = el.getBoundingClientRect();
    const sx = (r.width / el.offsetWidth) || 1, sy = (r.height / el.offsetHeight) || 1;
    return [(clientX - r.left) / sx, (clientY - r.top) / sy];
  }
  function write(t) {
    if (Math.abs(t.x - t.wx) < 0.5 && Math.abs(t.y - t.wy) < 0.5) return;
    t.wx = t.x; t.wy = t.y;
    const kf = { [t.px]: t.x.toFixed(1) + 'px', [t.py]: t.y.toFixed(1) + 'px' };
    const frames = [kf, kf];
    if (t.anim) { t.anim.effect.setKeyframes(frames); return; }
    try {
      t.anim = t.el.animate(frames, { pseudoElement: '::after', duration: 1000, fill: 'both' });
      t.anim.pause();
      t.anim.currentTime = 0;
    } catch { t.anim = null; }
  }
  function retarget(t, next) {
    if (next === t.el) return;
    if (t.anim) { t.anim.cancel(); t.anim = null; }
    t.el = next; t.wx = t.wy = NaN;
    // Entering a new element: snap, so the light never flashes at stale
    // coordinates carried over from the previous one.
    if (next) { [t.tx, t.ty] = local(next); t.x = t.tx; t.y = t.ty; write(t); }
  }
  // Reads only: ease toward the pointer. Returns whether the light should be written.
  function aim(t) {
    if (!t.el) return false;
    if (!t.el.isConnected) { retarget(t, null); return false; }
    [t.tx, t.ty] = local(t.el);
    t.x += (t.tx - t.x) * t.ease; t.y += (t.ty - t.y) * t.ease;
    return true;
  }
  const moving = (t) => !!t.el && (Math.abs(t.tx - t.x) > 0.5 || Math.abs(t.ty - t.y) > 0.5);
  function tick() {
    frame = 0;
    if (html.hasAttribute('data-fx-hush')) return;   // hold still; onMove restarts it
    // Both reads before either write: a write restyles a pseudo element, so a
    // box read after it would force a second style pass in the same frame.
    const aimCard = aim(card), aimItem = aim(item);
    if (aimCard) write(card);
    if (aimItem) write(item);
    if (moving(card) || moving(item)) frame = requestAnimationFrame(tick);
  }
  function onMove(e) {
    if (!fine.matches || still.matches || html.dataset.fx !== 'v2' || e.pointerType === 'touch') return;
    if (html.hasAttribute('data-fx-hush')) return;
    clientX = e.clientX; clientY = e.clientY;
    const target = e.target instanceof Element ? e.target : null;
    retarget(card, target && target.closest(CARDS));
    retarget(item, target && target.closest(ITEMS));
    if (!frame && (card.el || item.el)) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('pointermove', onMove, { passive: true });
})();

// Typing hush: <html data-fx-hush> for 1.5 s after the last keystroke into a
// text field (its input events too: paste, IME) or a selection change that
// leaves a non-empty text selection. While it is set the pointer light above
// holds still, so typing and drag-selecting frames don't also repaint a card's
// rim light. A plain click never hushes. (The endless lights no longer move at
// all: glass-fx.css 11d.) The flag lives on <html>, which glass-glow.js's body
// observers never see. Never in the mobile shell.
(() => {
  if (window.__glassFxHush) return;
  window.__glassFxHush = true;

  const html = document.documentElement;
  const inShell = () => html.dataset.shell === 'mobile';
  const flag = (name, value) => {
    if (html.getAttribute(name) === value) return;
    if (value === null) html.removeAttribute(name); else html.setAttribute(name, value);
  };

  // --- Hush ------------------------------------------------------------------
  const QUIET = 1500;
  const TEXT = /^(?:text|search|url|tel|email|password|number)$/;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0, last = 0, field = null;
  function lift() {
    const left = last + QUIET - performance.now();
    if (left > 16) { timer = setTimeout(lift, left); return; }
    timer = 0; field = null;
    flag('data-fx-hush', null);
  }
  // The attribute flips only at the start and the end of a burst.
  function hush() {
    last = performance.now();
    if (timer || still.matches || inShell()) return;
    flag('data-fx-hush', '');
    timer = setTimeout(lift, QUIET);
  }
  // The burst's field is remembered, so later keys skip isContentEditable
  // (it can flush style). Inside a shadow root (the emoji search) the target
  // is the host: the event's path names the real field.
  function onType(e) {
    let t = e.target;
    if (t !== field && t instanceof Element && t.shadowRoot) t = e.composedPath()[0];
    if (t !== field && !(t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT.test(t.type))
      || (t instanceof HTMLElement && t.isContentEditable))) return;
    field = t;
    hush();
  }
  addEventListener('keydown', onType, true);
  addEventListener('input', onType, true);
  // A text field holds its own selection (the document's stays collapsed).
  addEventListener('selectionchange', (e) => {
    if (timer && performance.now() - last < 300) return;   // hushed a moment ago: skip the read
    const t = e.target instanceof Element ? e.target : document.activeElement;
    let selected;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) selected = t.selectionStart !== t.selectionEnd;
    else { const s = document.getSelection(); selected = !!s && !s.isCollapsed; }
    if (selected) hush();
  }, true);

  // The mobile shell mounting (a computer's Mobile preview) clears the flag.
  new MutationObserver(() => {
    if (inShell() && timer) { clearTimeout(timer); timer = 0; field = null; flag('data-fx-hush', null); }
  }).observe(html, { attributes: true, attributeFilter: ['data-shell'] });
})();
