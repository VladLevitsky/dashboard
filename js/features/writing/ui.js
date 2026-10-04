// Personal Dashboard - Writing UI primitives: icons, anchored menus, a
// caret-anchored list (slash / [[ / : menus build on it), popovers with
// inputs, positioning, <kbd> hints.
//
// Every popup root is appended to <body>, carries data-wr-ui (Card Notes and
// other outside-click handlers ignore it) and the classes `wr-pop` + its own
// class; position: fixed, z-index 100004 (writing.css section 2).
// One global stack owns Esc (capture phase, preventDefault + stopPropagation,
// so the Card Edit Modal / calendar / Today don't also close), outside
// pointerdown (capture) and repositioning on resize / scroll.

import { caretRect, getSelectionRange, restoreRange } from './dom.js';

// --- Icons (minimal strokes, currentColor) --------------------------------
const P = {
  text: '<path d="M5 6V4.5h14V6"/><line x1="12" y1="4.5" x2="12" y2="19.5"/><line x1="9" y1="19.5" x2="15" y2="19.5"/>',
  h1: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16.5 10.5L19 9v9" />',
  h2: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 11a2 2 0 0 1 4 0c0 1.5-4 3.5-4 7h4"/>',
  h3: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 9.5h4l-2.4 3a2.4 2.4 0 1 1-1.6 4.2"/>',
  bullet: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  numbered: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 5l1.5-1v5"/><path d="M3.5 13.2a1.3 1.3 0 0 1 2.5.5c0 1-2.5 1.8-2.5 3.3H6.2"/>',
  checklist: '<rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.6 17.4 6 18.8 8.4 16" stroke-width="1.6"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  indent: '<polyline points="3 8 7 12 3 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>',
  outdent: '<polyline points="7 8 3 12 7 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>',
  quote: '<line x1="5" y1="5" x2="5" y2="19"/><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="18" y2="12"/><line x1="10" y1="17" x2="15" y2="17"/>',
  divider: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="7" y1="6.5" x2="17" y2="6.5" opacity=".35"/><line x1="7" y1="17.5" x2="17" y2="17.5" opacity=".35"/>',
  callout: '<rect x="3" y="4" width="18" height="16" rx="4"/><line x1="8" y1="10" x2="8" y2="14.5"/><line x1="8" y1="7.2" x2="8" y2="7.3"/><line x1="11.5" y1="9.5" x2="17" y2="9.5"/><line x1="11.5" y1="14" x2="15.5" y2="14"/>',
  tip: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.9 10.6c.6.5.9 1.3.9 2.1V16h6v-.3c0-.8.3-1.6.9-2.1A6 6 0 0 0 12 3z"/>',
  decision: '<path d="M12 3l9 9-9 9-9-9z"/><polyline points="8.6 12 11 14.4 15.4 9.8"/>',
  warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  caution: '<polygon points="7.9 2.5 16.1 2.5 21.5 7.9 21.5 16.1 16.1 21.5 7.9 21.5 2.5 16.1 2.5 7.9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  toggle: '<path d="M5 7.5l4 4-4 4" /><line x1="12" y1="11.5" x2="21" y2="11.5"/><line x1="12" y1="17" x2="18" y2="17" opacity=".45"/>',
  code: '<rect x="3" y="4" width="18" height="16" rx="3"/><polyline points="9.5 9.5 7 12 9.5 14.5"/><polyline points="14.5 9.5 17 12 14.5 14.5"/>',
  inlineCode: '<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/><line x1="13.5" y1="5" x2="10.5" y2="19"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="3" y1="14.8" x2="21" y2="14.8"/><line x1="10" y1="4" x2="10" y2="20"/>',
  bold: '<path d="M6.5 4h7a4 4 0 0 1 0 8h-7z"/><path d="M6.5 12h8a4 4 0 0 1 0 8h-8z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  underline: '<path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/>',
  strike: '<path d="M16.5 7.2C16 5.4 14.3 4 12 4c-2.6 0-4.3 1.4-4.3 3.3 0 1.2.6 2.1 1.8 2.7"/><path d="M7.3 16.6C7.8 18.6 9.6 20 12 20c2.8 0 4.6-1.5 4.6-3.6 0-1-.4-1.8-1.2-2.4"/><line x1="4" y1="12" x2="20" y2="12"/>',
  highlight: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  clear: '<path d="M5 5h11"/><path d="M10.5 5L7.8 19"/><line x1="14.5" y1="14.5" x2="20" y2="20"/><line x1="20" y1="14.5" x2="14.5" y2="20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  date: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>',
  time: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  emoji: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>',
  mention: '<circle cx="12" cy="12" r="3.8"/><path d="M15.8 8.2V13a2.7 2.7 0 0 0 5.4 0v-1A9.2 9.2 0 1 0 17.6 19"/>',
  docRef: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><path d="M10.5 15.5l3-3"/><path d="M12 12.2l.9-.9a1.6 1.6 0 0 1 2.3 2.3l-.9.9"/><path d="M12 15.8l-.9.9a1.6 1.6 0 0 1-2.3-2.3l.9-.9"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><polyline points="21 15.5 15.5 10.5 6 19.5"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9.5" y1="21" x2="9.5" y2="9"/>',
  task: '<path d="M14 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><polyline points="14 2.5 14 8.5 20 8.5"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
  subtask: '<path d="M5 4v7a3 3 0 0 0 3 3h11"/><polyline points="15 10 19 14 15 18"/>',
  moveUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5.5 11.5 12 5 18.5 11.5"/>',
  moveDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5.5 12.5 12 19 18.5 12.5"/>',
  duplicate: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-6a5 5 0 0 0-5-5H4"/>',
  redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-6a5 5 0 0 1 5-5h11"/>',
  lineBreak: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  paste: '<path d="M16 4h1.5A1.5 1.5 0 0 1 19 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14A1.5 1.5 0 0 1 6.5 4H8"/><rect x="8" y="2.5" width="8" height="3.5" rx="1"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  find: '<circle cx="11" cy="11" r="7"/><line x1="20.5" y1="20.5" x2="16" y2="16"/>',
  replace: '<path d="M4 8h12l-3.5-3.5"/><path d="M20 16H8l3.5 3.5"/>',
  outline: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/>',
  focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  pdf: '<polyline points="6 9 6 2.5 18 2.5 18 9"/><path d="M6 18H4.5A2.5 2.5 0 0 1 2 15.5v-4A2.5 2.5 0 0 1 4.5 9h15a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H18"/><rect x="6" y="14" width="12" height="7.5" rx="1"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  copyRich: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/><line x1="12.5" y1="13" x2="17.5" y2="13"/><line x1="12.5" y1="16.5" x2="16" y2="16.5"/>',
  export: '<path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><polyline points="16 7 12 3 8 7"/><line x1="12" y1="3" x2="12" y2="15"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.6-2.7 4"/><line x1="12" y1="17.3" x2="12.01" y2="17.3"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronRight: '<polyline points="9 6 15 12 9 18"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};

export const ICON_NAMES = Object.keys(P);

export function icon(name, size = 16, extraClass = '') {
  const body = P[name] || P.text;
  return `<svg class="wr-icon${extraClass ? ' ' + extraClass : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

// --- <kbd> hints -----------------------------------------------------------
function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// parts = ['Ctrl', 'B'] -> <span class="wr-kbd"><kbd>Ctrl</kbd><kbd>B</kbd></span>
export function kbdHtml(parts) {
  if (!parts || !parts.length) return '';
  return `<span class="wr-kbd">${parts.map(p => `<kbd>${esc(p)}</kbd>`).join('')}</span>`;
}

// --- Positioning -------------------------------------------------------------
const MARGIN = 8;

function rectOf(anchor) {
  if (!anchor) return null;
  if (typeof anchor.getBoundingClientRect === 'function') return anchor.getBoundingClientRect();
  if ('x' in anchor && 'y' in anchor && !('width' in anchor)) return new DOMRect(anchor.x, anchor.y, 0, 0);
  return anchor;
}

// Inline styles are only written when they change: glass-glow.js observes
// style mutations page-wide, and popups are repositioned on every scroll
// and keystroke
function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

// Place el (position:fixed) below the anchor rect, flipping above when there
// is no room, clamped 8px inside the viewport.
// placement: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'
export function positionPopup(el, anchor, opts = {}) {
  const rect = rectOf(anchor);
  if (!el || !rect) return;
  const gap = opts.gap ?? 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Natural size, measured where the popup already is when that can't
  // change it. From 0,0 the first time, or when the right edge may be
  // squeezing its width; without the max-height clamp when one is on
  let w = el.offsetWidth, h = el.offsetHeight;
  const curLeft = parseFloat(el.style.left);
  const placed = Number.isFinite(curLeft) && el.style.top !== '';
  const squeezed = !placed || curLeft + w > vw - MARGIN + 0.5;
  if (squeezed || el.style.maxHeight) {
    setStyle(el, 'maxHeight', '');
    if (squeezed) { setStyle(el, 'left', '0px'); setStyle(el, 'top', '0px'); }
    w = el.offsetWidth;
    h = el.offsetHeight;
  }
  let maxHeight = '';
  const placement = opts.placement || 'bottom-start';
  let left, top;
  if (placement === 'right-start') {
    left = rect.right + gap;
    if (left + w > vw - MARGIN) left = rect.left - gap - w;
    top = rect.top;
  } else {
    left = placement.endsWith('end') ? rect.right - w : rect.left;
    const below = vh - rect.bottom - gap - MARGIN;
    const above = rect.top - gap - MARGIN;
    const preferTop = placement.startsWith('top');
    if ((preferTop && h <= above) || (!preferTop && h > below && above > below)) {
      top = rect.top - gap - h;
      if (top < MARGIN) { maxHeight = Math.max(120, above) + 'px'; top = MARGIN; }
    } else {
      top = rect.bottom + gap;
      if (h > below) maxHeight = Math.max(120, below) + 'px';
    }
  }
  left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
  // Clamp with the height it will really have (the max-height just chosen), so a
  // shortened menu is never pulled back up over the line being typed
  const effH = maxHeight ? Math.min(h, parseFloat(maxHeight)) : h;
  top = Math.max(MARGIN, Math.min(top, vh - Math.min(effH, vh - 2 * MARGIN) - MARGIN));
  setStyle(el, 'maxHeight', maxHeight);
  setStyle(el, 'left', Math.round(left) + 'px');
  setStyle(el, 'top', Math.round(top) + 'px');
}

// Place el under the caret (or the range), above when there is no room.
// Empty lines have no caret rect: dom.caretRect falls back to the block.
export function positionAtCaret(el, range, editor, opts = {}) {
  const rect = caretRect(range || getSelectionRange(editor), editor);
  if (!rect) return;
  positionPopup(el, rect, { gap: 4, ...opts });
}

// A list opened by a trigger ('/', '@', '[[', ':'): starts at the trigger's x,
// and treats every line from the trigger to the caret as the anchor, so a
// query that wrapped onto the next line is never covered either
export function positionUnderTrigger(el, triggerRange, editor, opts = {}) {
  const caret = getSelectionRange(editor);
  const a = caretRect(triggerRange || caret, editor);
  if (!a) return;
  let rect = a;
  const c = caret && triggerRange ? caretRect(caret, editor) : null;
  if (c && (c.bottom > a.bottom + 1 || c.top < a.top - 1)) {
    const top = Math.min(a.top, c.top), bottom = Math.max(a.bottom, c.bottom);
    rect = new DOMRect(a.left, top, a.width, bottom - top);
  }
  positionPopup(el, rect, { gap: 4, ...opts });
}

// --- Popup stack (Esc, outside click, reposition) ---------------------------
const stack = [];
let globalsInstalled = false;

function installGlobals() {
  if (globalsInstalled) return;
  globalsInstalled = true;
  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      top.close('escape');
      return;
    }
    if (top.onKey && top.onKey(e) === true) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!stack.length) return;
    const target = e.target;
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (!entry) continue;
      if (entry.el.contains(target)) return;
      if (entry.ignore && entry.ignore.some(node => node && node.contains && node.contains(target))) return;
      if (entry.closeOnOutside === false) continue;
      entry.close('outside');
    }
  }, true);
  const reposition = (e) => {
    stack.forEach(entry => {
      if (e && e.type === 'scroll' && e.target && e.target.nodeType === 1 && entry.el.contains(e.target)) return;
      if (entry.reposition) entry.reposition();
    });
  };
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
}

function pushEntry(entry) {
  installGlobals();
  stack.push(entry);
}

function removeEntry(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
}

export function isOpen() { return stack.length > 0; }
export function topPopup() { return stack[stack.length - 1] || null; }
export function closeAll(reason = 'api') { [...stack].reverse().forEach(entry => entry.close(reason)); }

// --- Menu view (rows, headers, selection) -----------------------------------
// The inside of one .wr-menu-item row: icon tile, label (+ description), check,
// right hint. Shared with lists built elsewhere (the @ task list's date rows)
export function menuRowHtml(item, showCheck = false) {
  let html = '';
  if (item.icon !== false) html += `<span class="wr-menu-icon">${item.iconHtml || (item.icon ? icon(item.icon, 16) : '')}</span>`;
  html += `<span class="wr-menu-text"><span class="wr-menu-label">${esc(item.label)}</span>${item.description ? `<span class="wr-menu-desc">${esc(item.description)}</span>` : ''}</span>`;
  if (item.active && showCheck) html += `<span class="wr-menu-check">${icon('check', 14)}</span>`;
  if (item.kbd && item.kbd.length) html += `<span class="wr-menu-hint">${kbdHtml(item.kbd)}</span>`;
  else if (item.hint) html += `<span class="wr-menu-hint">${esc(item.hint)}</span>`;
  return html;
}

// items: [{ id, label, icon?, hint?, kbd?: [parts], group?, disabled?, active?, danger?, description?, run? }]
// A change of `group` between rows draws a header.
class MenuView {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.items = [];
    this.rows = [];
    this.index = -1;
    this.body = document.createElement('div');
    this.body.className = 'wr-menu-body';
    root.appendChild(this.body);
    if (opts.footer) {
      const foot = document.createElement('div');
      foot.className = 'wr-menu-footer';
      foot.textContent = opts.footer;
      root.appendChild(foot);
    }
    root.addEventListener('mousedown', e => e.preventDefault());
    root.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.wr-menu-item');
      if (!row || row.classList.contains('is-disabled')) return;
      const i = Number(row.dataset.index);
      if (i !== this.index) this.select(i, false);
    });
    root.addEventListener('click', (e) => {
      const row = e.target.closest('.wr-menu-item');
      if (!row || row.classList.contains('is-disabled')) return;
      this.pick(Number(row.dataset.index));
    });
  }

  render(items) {
    this.items = items || [];
    this.body.textContent = '';
    this.rows = [];
    let lastGroup = null;
    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'wr-menu-empty';
      empty.textContent = this.opts.emptyText || 'No matches';
      this.body.appendChild(empty);
    }
    this.items.forEach((item, i) => {
      if (item.group && item.group !== lastGroup) {
        const header = document.createElement('div');
        header.className = 'wr-menu-header';
        header.textContent = item.group;
        this.body.appendChild(header);
      }
      lastGroup = item.group || lastGroup;
      const row = document.createElement('div');
      row.className = 'wr-menu-item';
      row.setAttribute('role', this.opts.role === 'listbox' ? 'option' : 'menuitem');
      row.dataset.index = String(i);
      if (item.id) row.dataset.id = item.id;
      if (item.disabled) { row.classList.add('is-disabled'); row.setAttribute('aria-disabled', 'true'); }
      if (item.danger) row.classList.add('is-danger');
      if (item.active) row.classList.add('is-active');
      if (item.className) row.classList.add(...String(item.className).split(' ').filter(Boolean));
      row.innerHTML = menuRowHtml(item, this.opts.showCheck);
      this.body.appendChild(row);
      this.rows.push(row);
    });
    this.index = -1;
    if (this.opts.selectFirst !== false) {
      const first = this.items.findIndex(it => !it.disabled);
      if (first >= 0) this.select(first, false);
    }
  }

  select(i, scroll = true) {
    if (this.rows[this.index]) {
      this.rows[this.index].classList.remove('is-selected');
      this.rows[this.index].removeAttribute('aria-selected');
    }
    this.index = i;
    const row = this.rows[i];
    if (!row) return;
    row.classList.add('is-selected');
    row.setAttribute('aria-selected', 'true');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  move(delta) {
    const n = this.items.length;
    if (!n) return;
    let i = this.index < 0 ? (delta > 0 ? -1 : n) : this.index;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.items[i].disabled) break;
    }
    this.select(i);
  }

  edge(toEnd) {
    const order = this.items.map((_, i) => i);
    if (toEnd) order.reverse();
    const i = order.find(k => !this.items[k].disabled);
    if (i != null) this.select(i);
  }

  pick(i = this.index) {
    const item = this.items[i];
    if (!item || item.disabled) return false;
    this.opts.onPick && this.opts.onPick(item, i);
    return true;
  }

  // Keyboard: arrows, Home/End, Enter/Tab pick. Returns true when consumed.
  handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case 'ArrowDown': this.move(1); return true;
      case 'ArrowUp': this.move(-1); return true;
      case 'Home': if (!this.items.length) return false; this.edge(false); return true;
      case 'End': if (!this.items.length) return false; this.edge(true); return true;
      case 'Enter':
      case 'Tab':
        if (this.index < 0 || !this.items[this.index]) return false;
        return this.pick();
      default: return false;
    }
  }
}

// --- Anchored menu (toolbar dropdowns, ⋯, export, block style) --------------
// opts: { anchor (Element | DOMRect | {x,y}), items, onPick(item), onClose(reason),
//         className, placement, footer, showCheck, title, editor, keyboard (default true),
//         minWidth }
// Focus stays where it is (rows never take focus); with keyboard:true the
// arrow keys / Enter drive the menu while it is open and any other key closes it.
export function openMenu(opts) {
  const root = document.createElement('div');
  root.className = 'wr-pop wr-menu' + (opts.className ? ' ' + opts.className : '');
  root.dataset.wrUi = '';
  root.setAttribute('role', 'menu');
  if (opts.title) {
    const title = document.createElement('div');
    title.className = 'wr-menu-title';
    title.textContent = opts.title;
    root.appendChild(title);
  }
  if (opts.minWidth) root.style.minWidth = opts.minWidth + 'px';
  let closed = false;
  const entry = {
    el: root,
    ignore: opts.anchor && opts.anchor.nodeType === 1 ? [opts.anchor] : [],
    closeOnOutside: true,
    close: (reason = 'api') => {
      if (closed) return;
      closed = true;
      removeEntry(entry);
      root.remove();
      if (opts.anchor && opts.anchor.nodeType === 1) opts.anchor.removeAttribute('aria-expanded');
      opts.onClose && opts.onClose(reason);
    },
    reposition: () => positionPopup(root, opts.anchor, { placement: opts.placement })
  };
  const view = new MenuView(root, {
    ...opts,
    onPick: (item, i) => {
      entry.close('pick');
      if (item.run) item.run(item, i);
      opts.onPick && opts.onPick(item, i);
    }
  });
  if (opts.keyboard !== false) {
    entry.onKey = (e) => {
      if (view.handleKey(e)) return true;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return false;
      // Space on the focused anchor button picks: passed through, its keyup
      // would click the button again and reopen the menu
      if (e.key === ' ' && opts.anchor && document.activeElement === opts.anchor) {
        if (!view.pick()) entry.close('key');
        return true;
      }
      entry.close('key');
      return false;
    };
  }
  view.render(opts.items || []);
  document.body.appendChild(root);
  pushEntry(entry);
  if (opts.anchor && opts.anchor.nodeType === 1) opts.anchor.setAttribute('aria-expanded', 'true');
  entry.reposition();
  root.classList.add('open');
  return {
    el: root,
    close: entry.close,
    update: (items) => { view.render(items); entry.reposition(); },
    isOpen: () => !closed,
    view
  };
}

// --- Caret-anchored list (slash, [[, :, @ dates) ----------------------------
// Keys are NOT taken globally (only Esc and outside clicks are): the owner
// calls list.handleKey(e) from an api.hooks.keydown hook, so it decides what
// Enter / Tab mean. Rows never take focus; the editor keeps the caret.
// opts: { className, onPick(item), onClose(reason), footer, emptyText, role }
export function createCaretList(opts = {}) {
  let root = null, view = null, entry = null, editor = null, anchorRange = null;

  function build() {
    root = document.createElement('div');
    root.className = 'wr-pop wr-menu wr-caret-list' + (opts.className ? ' ' + opts.className : '');
    root.dataset.wrUi = '';
    root.setAttribute('role', opts.role || 'listbox');
    view = new MenuView(root, {
      role: opts.role || 'listbox',
      footer: opts.footer,
      emptyText: opts.emptyText,
      onPick: (item, i) => { opts.onPick && opts.onPick(item, i); }
    });
  }

  function reposition() {
    if (!root) return;
    positionUnderTrigger(root, anchorRange, editor, opts.position);
  }

  const api = {
    get el() { return root; },
    isOpen: () => !!entry,
    // range: where to anchor (usually the trigger character); items: rows
    open(range, items, ed) {
      editor = ed || editor;
      anchorRange = range ? range.cloneRange() : null;
      if (!root) build();
      view.render(items || []);
      if (!entry) {
        entry = { el: root, close: (reason) => api.close(reason), reposition, closeOnOutside: true };
        document.body.appendChild(root);
        pushEntry(entry);
        root.classList.add('open');
      }
      reposition();
    },
    update(items) {
      if (!view) return;
      view.render(items || []);
      if (entry) reposition();
    },
    close(reason = 'api') {
      if (!entry) return;
      const e = entry;
      entry = null;
      removeEntry(e);
      if (root) { root.remove(); root.classList.remove('open'); }
      opts.onClose && opts.onClose(reason);
    },
    move: (d) => view && view.move(d),
    pick: () => !!view && view.pick(),
    selectedItem: () => (view ? view.items[view.index] || null : null),
    handleKey: (e) => (entry && view ? view.handleKey(e) : false),
    reposition
  };
  return api;
}

// --- Popover with inputs (link editor, table tools...) ----------------------
// opts: { anchor, className, content (Element), editor, placement, focus (Element),
//         restoreSelection (default true), onClose(reason), closeOnOutside (default true) }
// The editor's selection is saved at open and put back on close, so a
// command run afterwards targets what the user had selected.
export function openPopover(opts) {
  const root = document.createElement('div');
  root.className = 'wr-pop wr-popover' + (opts.className ? ' ' + opts.className : '');
  root.dataset.wrUi = '';
  root.setAttribute('role', opts.role || 'dialog');
  if (opts.content) root.appendChild(opts.content);
  const savedRange = opts.editor ? getSelectionRange(opts.editor)?.cloneRange() || null : null;
  let closed = false;
  const entry = {
    el: root,
    ignore: opts.anchor && opts.anchor.nodeType === 1 ? [opts.anchor] : [],
    closeOnOutside: opts.closeOnOutside !== false,
    close: (reason = 'api') => {
      if (closed) return;
      closed = true;
      removeEntry(entry);
      root.remove();
      if (opts.restoreSelection !== false && savedRange && opts.editor && reason !== 'outside') restoreRange(savedRange, opts.editor);
      opts.onClose && opts.onClose(reason);
    },
    reposition: () => positionPopup(root, opts.anchor || (savedRange ? caretRect(savedRange, opts.editor) : null), { placement: opts.placement })
  };
  root.addEventListener('mousedown', (e) => {
    // Inputs and buttons keep their focus behaviour; empty areas don't steal the caret
    if (!e.target.closest('input, textarea, select, button, [contenteditable="true"]')) e.preventDefault();
  });
  document.body.appendChild(root);
  pushEntry(entry);
  entry.reposition();
  root.classList.add('open');
  if (opts.focus) requestAnimationFrame(() => { try { opts.focus.focus(); opts.focus.select?.(); } catch {} });
  return { el: root, close: entry.close, savedRange, reposition: entry.reposition, isOpen: () => !closed };
}

// Is the node inside writing UI (a menu, popover, toolbar addition)?
export function isWritingUi(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!(el && el.closest && el.closest('[data-wr-ui]'));
}
