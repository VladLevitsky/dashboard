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
//  - gated by the fx flag, a fine hover-capable pointer and reduced motion
//  - the paint itself lives in glass-fx.css section 12 (:hover::after only)
(() => {
  if (window.__glassFx) return;              // one listener, even if imported twice
  window.__glassFx = true;

  const CARDS = 'section.card, .app-header.card';
  const ITEMS = '.icon-button, .unified-subtask-item, .list-item, .unified-copypaste-item, .copy-paste-item';
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
  function step(t) {
    if (!t.el) return false;
    if (!t.el.isConnected) { retarget(t, null); return false; }
    [t.tx, t.ty] = local(t.el);
    t.x += (t.tx - t.x) * t.ease; t.y += (t.ty - t.y) * t.ease;
    write(t);
    return Math.abs(t.tx - t.x) > 0.5 || Math.abs(t.ty - t.y) > 0.5;
  }
  function tick() {
    frame = 0;
    const movingCard = step(card);
    const movingItem = step(item);
    if (movingCard || movingItem) frame = requestAnimationFrame(tick);
  }
  function onMove(e) {
    if (!fine.matches || still.matches || document.documentElement.dataset.fx !== 'v2' || e.pointerType === 'touch') return;
    clientX = e.clientX; clientY = e.clientY;
    const target = e.target instanceof Element ? e.target : null;
    retarget(card, target && target.closest(CARDS));
    retarget(item, target && target.closest(ITEMS));
    if (!frame && (card.el || item.el)) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('pointermove', onMove, { passive: true });
})();
