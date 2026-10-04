// Personal Dashboard - Writing doc tools (FULL editors)
// - Status bar: a quiet row under the editor (or on the left of the actions
//   row right under it): "248 words · 1,402 characters · 2 min read · ☑ 3/7",
//   "12 of 248 words · …" with a selection. Debounced, and it only rewrites
//   Text.data (glass-glow's observers stay asleep). Pref statusBar.
// - Outline: the toolbar / ⋯ / slash command lists H1–H3 in a popover; a pick
//   scrolls the heading into view and puts the caret at its start.
//   api.outline = { get(editor), active(editor), go(editor, el) } (focus mode
//   uses it for its rail); getOutline(editor) is exported too.
// - The text index find.js searches: the editor's text with a line break
//   between blocks, ZWSP dropped and NBSP read as a space, mapped back to the
//   text nodes (buildTextIndex / indexRange / indexOffset).

import { textStats } from '../../core/markdown.js';

let api = null;

// --- Text index ----------------------------------------------------------------
// Elements that end a line of text (a match never spans two of them)
const LINE_BREAKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE',
  'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'DETAILS', 'SUMMARY', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
const ZERO_WIDTH = /[\u200B\uFEFF]/;

// { text, segs: [{ node, start, end, map, locked }], byNode: Map }
// map (only for nodes holding ZWSP): raw offset of each kept character, plus
// the node length at the end. locked: inside contenteditable=false (task
// pills, chips): searchable, never replaced.
export function buildTextIndex(root) {
  const segs = [];
  const byNode = new Map();
  let text = '';
  // The last character, tracked: reading text[i] off the growing string
  // flattens it every time (quadratic on long documents)
  let last = '';
  const lineBreak = () => { if (last && last !== '\n') { text += '\n'; last = '\n'; } };
  const addText = (node, locked) => {
    const data = node.data;
    if (!data) return;
    const start = text.length;
    let map = null;
    let kept = data;
    if (ZERO_WIDTH.test(data)) {
      map = [];
      kept = '';
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (c === '\u200B' || c === '\uFEFF') continue;
        map.push(i);
        kept += c;
      }
      map.push(data.length);
      if (!kept) return;
    }
    const add = kept.replace(/\u00A0/g, ' ');
    text += add;
    last = add[add.length - 1];
    const seg = { node, start, end: text.length, map, locked };
    segs.push(seg);
    byNode.set(node, seg);
  };
  const walk = (parent, locked) => {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { addText(n, locked); continue; }
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute('data-wr-ephemeral') || n.classList.contains('editor-img-resize-handle')) continue;
      const tag = n.tagName;
      if (tag === 'BR' || tag === 'HR' || tag === 'IMG') { lineBreak(); continue; }
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'TEMPLATE') continue;
      const block = LINE_BREAKS.has(tag);
      if (block) lineBreak();
      walk(n, locked || n.getAttribute('contenteditable') === 'false');
      if (block) lineBreak();
    }
  };
  if (root) walk(root, false);
  return { text, segs, byNode };
}

// Raw node offset of virtual position v inside seg. Starts lean onto the next
// kept character, ends sit right after the previous one (ZWSPs stay outside).
function rawOffset(seg, v, isEnd) {
  const k = v - seg.start;
  if (!seg.map) return k;
  if (isEnd) return k > 0 ? seg.map[k - 1] + 1 : seg.map[0];
  return seg.map[k];
}

// Segment holding virtual position v: for a start the one where v < end, for
// an end the one where v > start
function segAt(index, v, isEnd) {
  const { segs } = index;
  let lo = 0, hi = segs.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segs[mid];
    if (isEnd ? v <= s.start : v < s.start) hi = mid - 1;
    else if (isEnd ? v > s.end : v >= s.end) lo = mid + 1;
    else { found = mid; break; }
  }
  return found >= 0 ? segs[found] : null;
}

// A Range over virtual [start, end) or null
export function indexRange(index, start, end) {
  const a = segAt(index, start, false);
  const b = segAt(index, end, true);
  if (!a || !b) return null;
  const range = document.createRange();
  try {
    range.setStart(a.node, rawOffset(a, start, false));
    range.setEnd(b.node, rawOffset(b, end, true));
  } catch {
    return null;
  }
  return range;
}

// Segments a virtual span touches (binary search: Replace all asks per match)
export function indexSegments(index, start, end) {
  const { segs } = index;
  let lo = 0, hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].end > start) hi = mid; else lo = mid + 1;
  }
  const out = [];
  for (let i = lo; i < segs.length && segs[i].start < end; i++) out.push(segs[i]);
  return out;
}

// Raw offset inside a segment's text node for virtual position v (see rawOffset)
export function indexRawOffset(seg, v, isEnd = false) {
  return rawOffset(seg, v, isEnd);
}

// Virtual offset of a DOM point (text node offset or element child position)
export function indexOffset(index, node, offset) {
  if (!node) return 0;
  if (node.nodeType === 3) {
    const seg = index.byNode.get(node);
    if (seg) {
      if (!seg.map) return seg.start + Math.min(offset, seg.end - seg.start);
      let kept = 0;
      while (kept < seg.map.length - 1 && seg.map[kept] < offset) kept++;
      return seg.start + kept;
    }
  }
  // Element point (or an unindexed text node): the first segment at/after it
  const probe = document.createRange();
  try { probe.setStart(node, offset); } catch { return 0; }
  probe.collapse(true);
  const { segs } = index;
  let lo = 0, hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let cmp;
    try { cmp = probe.comparePoint(segs[mid].node, 0); } catch { cmp = 1; }
    if (cmp < 0) lo = mid + 1; else hi = mid;
  }
  return lo < segs.length ? segs[lo].start : index.text.length;
}

// --- Geometry --------------------------------------------------------------------
export function isShown(el) {
  return !!(el && el.isConnected && el.getClientRects().length);
}

function scrollers(from) {
  const out = [];
  for (let el = from; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (/(auto|scroll|overlay)/.test(oy) && el.scrollHeight > el.clientHeight + 1) out.push(el);
  }
  return out;
}

// Scroll the editor (and scrolling ancestors inside the dialog, never the
// page) so getRect() is visible: centered when it was out of view, or with
// its top near the top of the editor when the editor scrolls (align 'top',
// for headings; outer scrollers only move as far as needed)
export function revealRect(getRect, from, { align = 'center', margin = 28 } = {}) {
  scrollers(from).forEach((el) => {
    const r = getRect();
    if (!r || (!r.width && !r.height && !r.top)) return;
    const box = el.getBoundingClientRect();
    const top = box.top + el.clientTop;
    const bottom = top + el.clientHeight;
    const m = Math.min(margin, el.clientHeight / 4);
    if (align === 'top' && el === from) {
      el.scrollTop += r.top - top - m;
      return;
    }
    if (r.top >= top + m && r.bottom <= bottom - m) return;
    el.scrollTop += (r.top + r.bottom) / 2 - (top + bottom) / 2;
  });
}

export function scrollRangeIntoView(range, editor, opts) {
  if (!range) return;
  const rectOf = () => {
    const rects = range.getClientRects();
    return rects.length ? rects[0] : range.getBoundingClientRect();
  };
  revealRect(rectOf, editor, opts);
}

// Closed toggle sections holding node are opened (their state is saved, so
// the caller notifies). Returns true when something opened.
export function revealInEditor(node, editor) {
  let opened = false;
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el !== editor) {
    if (el.classList && el.classList.contains('wr-toggle-body')) {
      const toggle = el.parentElement;
      if (toggle && toggle.classList.contains('wr-toggle') && toggle.getAttribute('data-open') === 'false') {
        toggle.setAttribute('data-open', 'true');
        opened = true;
      }
    }
    el = el.parentElement;
  }
  return opened;
}

// --- Numbers -----------------------------------------------------------------------
const NUM = new Intl.NumberFormat('en-US');
const fmt = (n) => NUM.format(n);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

// --- Status bar --------------------------------------------------------------------
const statusStates = new WeakMap(); // editor -> state
const statusEditors = new Set();    // editors with a status bar (pruned when they leave the DOM)
const CHECK_ICON = '<svg class="wr-st-check-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><polyline points="8 12.5 11 15.5 16.5 9"/></svg>';
// An actions row right under the editor hosts the stats on its left
const STATUS_ROWS = '.task-desc-editor-actions';

function statusWanted(editor) {
  const st = api.stateOf(editor);
  if (!st || st.opts.tier !== 'full') return false;
  return st.features.statusBar !== false;
}

function part(cls) {
  const span = document.createElement('span');
  span.className = 'wr-status-part ' + cls;
  const t = document.createTextNode('');
  span.appendChild(t);
  return { span, t };
}

function createStatus(editor) {
  const el = document.createElement('div');
  el.className = 'wr-status';
  el.dataset.wrUi = '';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Document statistics');
  const words = part('wr-st-words');
  const chars = part('wr-st-chars');
  const read = part('wr-st-read');
  const check = document.createElement('span');
  check.className = 'wr-status-part wr-st-check';
  check.hidden = true;
  check.innerHTML = CHECK_ICON;
  const checkText = document.createTextNode('');
  check.appendChild(checkText);
  el.append(words.span, chars.span, read.span, check);
  const st = api.stateOf(editor);
  const host = st && st.opts.statusHost;
  const next = editor.nextElementSibling;
  if (host) {
    host.appendChild(el);
  } else if (next && next.matches(STATUS_ROWS)) {
    el.classList.add('wr-status-inline');
    next.prepend(el);
  } else {
    editor.after(el);
  }
  const state = {
    el, words: words.t, chars: chars.t, read: read.t, check, checkText,
    index: null, totals: null, dirty: true, showingSel: false, timer: 0, checkKey: ''
  };
  statusStates.set(editor, state);
  statusEditors.add(editor);
  el.hidden = api.prefs.get('statusBar') === false;
  return state;
}

function setText(node, value) {
  if (node.data !== value) node.data = value;
}

// A checklist item that holds nothing yet (the templates' blank action item,
// a fresh "[] " line): whitespace, NBSP and zero-width spaces only, and no
// image, chip or task pill
const ITEM_CONTENT = 'img, [contenteditable="false"], .project-task-highlight';
function isBlankItem(li) {
  if (/[^\s\u00A0\u200B\uFEFF]/.test(li.textContent)) return false;
  return !li.querySelector(ITEM_CONTENT);
}

function computeTotals(editor, state) {
  state.index = buildTextIndex(editor);
  const s = textStats(state.index.text);
  let items = 0, done = 0;
  editor.querySelectorAll('ul.checklist > li').forEach(li => {
    if (isBlankItem(li)) return;
    items++;
    if (li.classList.contains('checked')) done++;
  });
  state.totals = { words: s.words, chars: s.chars, minutes: s.readingMinutes, items, done };
  state.dirty = false;
}

function renderStatus(editor) {
  const state = statusStates.get(editor);
  if (!state || !state.el.isConnected) return;
  if (state.el.hidden) return;
  if (state.dirty || !state.totals) computeTotals(editor, state);
  const t = state.totals;
  const range = api.dom.getSelectionRange(editor);
  let sel = null;
  if (range && !range.collapsed) {
    const a = indexOffset(state.index, range.startContainer, range.startOffset);
    const b = indexOffset(state.index, range.endContainer, range.endOffset);
    if (b > a) sel = textStats(state.index.text.slice(a, b));
  }
  state.showingSel = !!sel;
  if (sel) {
    setText(state.words, `${fmt(sel.words)} of ${plural(t.words, 'word', 'words')}`);
    setText(state.chars, `${fmt(sel.chars)} of ${plural(t.chars, 'character', 'characters')}`);
    setText(state.read, '');
  } else {
    setText(state.words, plural(t.words, 'word', 'words'));
    setText(state.chars, plural(t.chars, 'character', 'characters'));
    setText(state.read, t.words ? `${fmt(t.minutes)} min read` : '');
  }
  const key = t.items ? `${t.done}/${t.items}` : '';
  if (key !== state.checkKey) {
    state.checkKey = key;
    if (state.check.hidden !== !t.items) state.check.hidden = !t.items;
    setText(state.checkText, key);
    state.check.title = t.items ? `${t.done} of ${t.items} checklist items done` : '';
    state.check.dataset.complete = String(!!t.items && t.done === t.items);
  }
}

function scheduleStatus(editor, delay) {
  const state = statusStates.get(editor);
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.timer = 0; renderStatus(editor); }, delay);
}

function pruneStatus() {
  statusEditors.forEach(ed => { if (!ed.isConnected) statusEditors.delete(ed); });
}

function ensureStatus(editor) {
  if (!statusWanted(editor)) return null;
  let state = statusStates.get(editor);
  if (state && !state.el.isConnected) {
    statusStates.delete(editor);
    state = null;
  }
  return state || createStatus(editor);
}

// --- Outline -------------------------------------------------------------------------
function headingText(el) {
  return (el.textContent || '').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

// [{ level: 1-3, text, el }] in document order
export function getOutline(editor) {
  if (!editor) return [];
  return [...editor.querySelectorAll('h1, h2, h3')]
    .filter(el => !el.closest('[data-wr-ephemeral]'))
    .map(el => ({ level: Number(el.tagName.charAt(1)), text: headingText(el), el }));
}

// Index of the heading the writer is in: the last one before a visible caret,
// else the last one scrolled past the top of the editor's view (-1: none)
export function activeHeading(editor, list = getOutline(editor)) {
  if (!list.length) return -1;
  const view = scrollers(editor)[0];
  const box = view ? view.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const range = api && api.dom.getSelectionRange(editor);
  if (range) {
    const rect = api.dom.caretRect(range, editor);
    if (rect && rect.bottom >= box.top && rect.top <= box.bottom) {
      const caret = range.startContainer;
      let idx = -1;
      list.forEach((h, i) => {
        if (h.el === caret || h.el.contains(caret) || (h.el.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING)) idx = i;
      });
      return idx;
    }
  }
  let idx = -1;
  list.forEach((h, i) => { if (h.el.getBoundingClientRect().top <= box.top + 48) idx = i; });
  return idx;
}

const FLASH = 'wr-outline-flash';
let flashTimer = 0;
function flash(el) {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;
  const r = document.createRange();
  r.selectNodeContents(el);
  CSS.highlights.set(FLASH, new Highlight(r));
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => CSS.highlights.delete(FLASH), 1100);
}

// Scroll the heading near the top of the editor and put the caret at its start
export function goToHeading(editor, el) {
  if (!editor || !el || !editor.contains(el)) return false;
  if (revealInEditor(el, editor)) api.notifyChange(editor);
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  api.dom.placeCaretAtStart(el);
  revealRect(() => el.getBoundingClientRect(), editor, { align: 'top', margin: 14 });
  flash(el);
  return true;
}

let outlineMenu = null; // { menu, editor }

function openOutline(ctx, arg = {}) {
  const editor = ctx.editor;
  if (!editor) return false;
  if (outlineMenu && outlineMenu.menu.isOpen()) {
    const same = outlineMenu.editor === editor;
    outlineMenu.menu.close('toggle');
    if (same && arg.source === 'toolbar') return true;
  }
  const list = getOutline(editor);
  const active = activeHeading(editor, list);
  const minLevel = list.reduce((m, h) => Math.min(m, h.level), 3);
  const { keyHint } = api.registry;
  const items = list.length ? list.map((h, i) => ({
    id: 'heading-' + i,
    label: h.text || 'Untitled heading',
    icon: false,
    hint: 'H' + h.level,
    active: i === active,
    className: `wr-outline-item wr-outline-l${h.level - minLevel + 1}${h.text ? '' : ' is-untitled'}`,
    run: () => goToHeading(editor, h.el)
  })) : [{
    id: 'empty',
    label: 'No headings yet',
    description: `Type # and a space, or press ${keyHint('heading1', api.registry.isMac)}`,
    icon: 'outline',
    disabled: true,
    className: 'wr-outline-empty'
  }];
  const anchor = arg.anchor && arg.anchor.isConnected ? arg.anchor : (ctx.range ? api.dom.caretRect(ctx.range, editor) : editor);
  const menu = api.ui.openMenu({
    anchor,
    items,
    className: 'wr-outline-menu',
    title: list.length ? `Outline · ${list.length} heading${list.length === 1 ? '' : 's'}` : 'Outline',
    placement: arg.anchor ? 'bottom-end' : 'bottom-start',
    onClose: () => { if (outlineMenu && outlineMenu.menu === menu) outlineMenu = null; }
  });
  outlineMenu = { menu, editor };
  if (active >= 0) menu.view.select(active);
  return true;
}

// --- Install -------------------------------------------------------------------------
export function install(writingApi) {
  api = writingApi;

  api.outline = {
    get: getOutline,
    active: (editor) => activeHeading(editor),
    go: goToHeading
  };
  api.statusBar = {
    get: (editor) => { const s = statusStates.get(editor); return s ? s.el : null; },
    refresh: (editor) => { const s = statusStates.get(editor); if (s) { s.dirty = true; renderStatus(editor); } }
  };

  api.registerCommand('outline', {
    run: (ctx, arg) => openOutline(ctx, arg),
    isAvailable: (ctx) => !!ctx.editor && ctx.tier === 'full' && !!ctx.features.outline
  });

  api.onAttach((editor) => {
    pruneStatus(); // meetings rebuilds its editor on every open
    const state = ensureStatus(editor);
    if (state) renderStatus(editor);
  });

  api.hooks.load.push((editor) => {
    const state = ensureStatus(editor);
    if (!state) return;
    state.dirty = true;
    clearTimeout(state.timer);
    renderStatus(editor);
  });

  api.hooks.change.push((editor) => {
    const state = ensureStatus(editor); // (re)created if its row was re-rendered away
    if (!state) return;
    state.dirty = true;
    scheduleStatus(editor, 300);
  });

  // Selection only: the totals (and their index) are reused. While an edit is
  // pending (typing moves the caret too) its own, longer debounce renders the
  // selection as well, so typing never recounts the document per keystroke.
  api.hooks.selection.push((evt, ctx) => {
    const state = ctx.editor && statusStates.get(ctx.editor);
    if (state && !state.dirty) scheduleStatus(ctx.editor, 140);
  });

  // A selection that leaves the editor (click elsewhere) puts the totals back
  document.addEventListener('selectionchange', () => {
    statusEditors.forEach(ed => {
      const s = statusStates.get(ed);
      if (!s || !s.showingSel || s.dirty) return;
      if (!ed.isConnected) return;
      const r = api.dom.getSelectionRange(ed);
      if (!r || r.collapsed) scheduleStatus(ed, 140);
    });
  });

  api.prefs.onChange((key, value) => {
    if (key !== 'statusBar') return;
    pruneStatus();
    statusEditors.forEach(ed => {
      const s = statusStates.get(ed);
      if (!s) return;
      const hide = value === false;
      if (s.el.hidden !== hide) s.el.hidden = hide;
      if (!hide) { s.dirty = true; renderStatus(ed); }
    });
  });
}
