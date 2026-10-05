// Personal Dashboard - Mobile shell: visual viewport tracking
// The on-screen keyboard shrinks the VISUAL viewport (Android and iOS alike,
// since interactive-widget is not set), not the layout one. Fixed shell parts
// that must sit on the keyboard (composer, writer toolbars, keyboard-aware
// sheets) read three variables written on <html>:
//   --mx-vvh    visual viewport height (px)
//   --mx-vv-top visual viewport offset from the layout top (px)
//   --mx-kb     height covered by the keyboard at the bottom (px)
// and html[data-mx-kb] is set while the keyboard is up (over 120px AND an
// editable element has focus, so a collapsing browser toolbar is no keyboard).
// Updates are rAF-throttled and only write a value that changed. Generalises
// the focus-mode fitViewport() of writing/focus.js. Without visualViewport
// the CSS defaults stay (100dvh, 0, 0).

let running = false;
let frame = 0;
const last = { vvh: '', top: '', kb: '', open: null };

function isEditable(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(el.type || '');
}

function write() {
  frame = 0;
  if (!running) return;
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  const vvh = Math.round(vv.height) + 'px';
  const top = Math.round(vv.offsetTop) + 'px';
  const kbPx = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const kb = kbPx + 'px';
  if (vvh !== last.vvh) { root.style.setProperty('--mx-vvh', vvh); last.vvh = vvh; }
  if (top !== last.top) { root.style.setProperty('--mx-vv-top', top); last.top = top; }
  if (kb !== last.kb) { root.style.setProperty('--mx-kb', kb); last.kb = kb; }
  const open = kbPx > 120 && isEditable(document.activeElement);
  if (open !== last.open) {
    last.open = open;
    if (open) root.setAttribute('data-mx-kb', ''); else root.removeAttribute('data-mx-kb');
  }
}

function schedule() {
  if (!running || frame) return;
  frame = requestAnimationFrame(write);
}

const TARGETS = () => [
  [window.visualViewport, 'resize'],
  [window.visualViewport, 'scroll'],
  [window, 'resize'],
  [window, 'orientationchange'],
  [document, 'focusin'],
  [document, 'focusout'],
];

export function startViewport() {
  if (running) return;
  running = true;
  TARGETS().forEach(([t, ev]) => { if (t) t.addEventListener(ev, schedule, { passive: true }); });
  write();
}

export function stopViewport() {
  if (!running) return;
  running = false;
  TARGETS().forEach(([t, ev]) => { if (t) t.removeEventListener(ev, schedule); });
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  const root = document.documentElement;
  ['--mx-vvh', '--mx-vv-top', '--mx-kb'].forEach(p => root.style.removeProperty(p));
  root.removeAttribute('data-mx-kb');
  last.vvh = last.top = last.kb = '';
  last.open = null;
}

export function keyboardHeight() {
  const v = parseFloat(last.kb);
  return Number.isFinite(v) ? v : 0;
}
