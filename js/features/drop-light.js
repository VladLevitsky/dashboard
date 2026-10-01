// Personal Dashboard - Drop light
// The glowing line that shows where something will land: between items while
// reordering them in edit mode, and between icons while placing a separator.
//
// One element for the whole page, fixed to the viewport, above the Card Edit
// Modal (z-index in styles.css). It moves through a PAUSED Web Animation
// (transform / width / height keyframes), the same trick as glass-fx.js: no
// inline style or attribute is written per move, so glass-glow.js's
// MutationObservers don't re-measure every card on every dragover. Only
// show / hide (hidden) and an orientation change (class) touch the DOM.
// Between targets it glides (eased rAF that stops once settled); reduced
// motion snaps. The look lives in glass-fx.css section 11b.

const EASE = 0.38;
const still = matchMedia('(prefers-reduced-motion: reduce)');

let el = null;
let anim = null;
let shown = false;
let vertical = null;
let target = null;   // { x, y, w, h } viewport px, the beam's own box
let pos = null;      // eased position actually drawn
let frame = 0;

function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'drop-light';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  el.innerHTML = '<span class="drop-light-beam"></span>';
  document.body.appendChild(el);
  return el;
}

function write() {
  const frameKf = {
    transform: `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`,
    width: `${pos.w.toFixed(1)}px`,
    height: `${pos.h.toFixed(1)}px`
  };
  const frames = [frameKf, frameKf];
  if (anim) {
    anim.effect.setKeyframes(frames);
    return;
  }
  try {
    anim = el.animate(frames, { duration: 1000, fill: 'both' });
    anim.pause();
    anim.currentTime = 0;
  } catch {
    // No Web Animations: fall back to inline styles
    anim = null;
    Object.assign(el.style, frameKf);
  }
}

function tick() {
  frame = 0;
  if (!shown) return;
  let moving = false;
  for (const k of ['x', 'y', 'w', 'h']) {
    const d = target[k] - pos[k];
    if (Math.abs(d) > 0.4) {
      pos[k] += d * EASE;
      moving = true;
    } else {
      pos[k] = target[k];
    }
  }
  write();
  if (moving) frame = requestAnimationFrame(tick);
}

// Show the line. A vertical line runs from (x, y) down `length` px; a
// horizontal one from (x, y) right `length` px. x/y are viewport coordinates
// of the line's centre-line start.
export function showDropLight({ x, y, length, vertical: isVertical }) {
  ensure();
  const thick = 3;
  const next = isVertical
    ? { x: x - thick / 2, y, w: thick, h: Math.max(length, 8) }
    : { x, y: y - thick / 2, w: Math.max(length, 8), h: thick };

  if (vertical !== !!isVertical) {
    vertical = !!isVertical;
    el.classList.toggle('is-vertical', vertical);
    el.classList.toggle('is-horizontal', !vertical);
    // Keyframe properties stay the same, but snap: gliding from a vertical
    // box into a horizontal one would smear through a square
    pos = null;
  }
  target = next;

  if (!shown || !pos || still.matches) {
    pos = { ...next };
    write();
    if (!shown) {
      shown = true;
      el.hidden = false;
    }
    return;
  }
  if (!frame) frame = requestAnimationFrame(tick);
}

export function hideDropLight() {
  if (!el || !shown) return;
  shown = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  el.hidden = true;
}

export function isDropLightShown() {
  return shown;
}
