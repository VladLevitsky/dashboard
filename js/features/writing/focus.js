// Personal Dashboard - Writing: focus mode (FULL editors). Ctrl+Shift+F, the
// toolbar's Focus button or /focus: the editor and its toolbar (plus the
// writing bars next to them: find bar, status line...) move into a calm
// body-level glass sheet: content column ~760px, larger type, the toolbar
// fades while typing and comes back on mouse move. Esc, Exit or Focus again
// put everything back where it was (DOM position, scroll positions, caret);
// nothing is left behind on the page.
// Moving (rather than restyling in place) is deliberate: the glass dialogs'
// backdrop-filter / overflow trap position:fixed descendants. The sheet
// stacks just above the window the editor lives in, so what opens from the
// text (task editor from a pill, Turn into task) still lands on top of it.
// If that window closes or re-renders meanwhile (Ctrl+S in the task / subtask /
// ideas / meetings editors), focus mode ends by itself.
// Typewriter scrolling (pref 'typewriter', focus mode only): on input, never
// on clicks, the caret line stays near 40% of the height. Outline rail on
// wide screens (>= 1100px) when doc-tools provides api.outline; its status
// line (api.statusBar) comes along wherever it sits. Bars opened while in
// focus (find) are kept under the toolbar. Phones: a full-screen sheet that
// stays above the on-screen keyboard.
// api.focusMode = { isActive(editor?), enter(editor), exit() }.

import { getSelectionRange, restoreRange, rangeToOffsets, offsetsToRange, caretRect, placeCaret } from './dom.js';

const RAIL_MIN_WIDTH = 1100;
const DEFAULT_Z = 10040;              // --wr-z-focus
const TYPEWRITER_AT = 0.4;
// Inward corners: "leave full screen"
const EXIT_ICON = '<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 3v3a3 3 0 0 1-3 3H3"/><path d="M21 9h-3a3 3 0 0 1-3-3V3"/><path d="M3 15h3a3 3 0 0 1 3 3v3"/><path d="M15 21v-3a3 3 0 0 1 3-3h3"/></svg>';
// The typing line held in the middle: "typewriter scrolling"
const TW_ICON = '<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="7" y1="5" x2="17" y2="5" opacity=".45"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="7" y1="19" x2="17" y2="19" opacity=".45"/><path d="M3 9.5 5.5 12 3 14.5"/><path d="M21 9.5 18.5 12 21 14.5"/></svg>';
// Legacy popups that don't close on Esc themselves: Esc closes them first
const LEGACY_POPUPS = '.highlight-context-menu, .highlighter-color-dropdown, .task-link-picker';

let API = null;
let F = null;   // the active focus session

// --- Helpers ----------------------------------------------------------------------
function visible(el) {
  if (!el || !el.isConnected || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

// The outermost positioned ancestor with a z-index (the window the editor
// lives in) and that z-index
function originWindow(node) {
  let z = 0, win = null;
  for (let n = node && node.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position !== 'static' && cs.zIndex !== 'auto') {
      const v = parseInt(cs.zIndex, 10);
      if (Number.isFinite(v)) { z = v; win = n; }
    }
  }
  return { z, win };
}

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function docMeta(st) {
  let meta = {};
  try { meta = (st.opts.getDocMeta && st.opts.getDocMeta()) || {}; } catch { meta = {}; }
  let title = '';
  try { title = String((st.opts.getTitle && st.opts.getTitle()) || meta.title || '').trim(); } catch { title = meta.title || ''; }
  return { kind: meta.kind || '', title };
}

// Was the window the editor came from closed ('hidden') or rebuilt ('gone')?
function contextLost(s) {
  if (!s.edMarker.isConnected) return 'gone';
  const parent = s.edMarker.parentElement;
  if (!parent || !parent.getClientRects().length) return 'hidden';
  return null;
}

// The caret / selection as node + offset pairs: moving the editor collapses
// live Ranges, but its nodes stay the same (text offsets are the fallback;
// they can't tell the end of a line from the start of the next)
function saveCaret(editor, range) {
  if (!range) return null;
  return { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset, offsets: rangeToOffsets(range, editor) };
}

function putCaret(editor, saved) {
  if (!saved) return false;
  let range = null;
  if (editor.contains(saved.sc) && editor.contains(saved.ec)) {
    const len = (n) => (n.nodeType === Node.TEXT_NODE ? n.data.length : n.childNodes.length);
    try {
      range = document.createRange();
      range.setStart(saved.sc, Math.min(saved.so, len(saved.sc)));
      range.setEnd(saved.ec, Math.min(saved.eo, len(saved.ec)));
    } catch { range = null; }
  }
  if (!range && saved.offsets) range = offsetsToRange(editor, saved.offsets);
  if (range) restoreRange(range, editor);
  return !!range;
}

// doc-tools' status line for this editor (null without that module)
function statusLine(editor) {
  const sb = API.statusBar;
  if (!sb || typeof sb.get !== 'function') return null;
  let el = null;
  try { el = sb.get(editor); } catch { el = null; }
  return el && el.nodeType === 1 && el.isConnected && !el.contains(editor) ? el : null;
}

// Move a node, keeping the focus (and text selection) of a field inside it:
// a focused element taken out of the document loses its focus
function moveKeepingFocus(node, move) {
  const a = document.activeElement;
  const had = !!(a && a !== document.body && node.contains(a));
  let start = null, end = null, dir;
  if (had) { try { start = a.selectionStart; end = a.selectionEnd; dir = a.selectionDirection; } catch { /* not a text field */ } }
  move();
  if (had && document.activeElement !== a && a.isConnected) {
    try { a.focus({ preventScroll: true }); } catch { a.focus(); }
    if (start != null) { try { a.setSelectionRange(start, end, dir); } catch { /* not a text field */ } }
  }
}

// Writing bars a module puts right before the editor while it is in the
// column (find places its bar there when the toolbar has another parent):
// up under the toolbar, where they stay in view
function onColumnMutations() {
  if (!F) return;
  const s = F;
  for (const n of [...s.column.children]) {
    if (n === s.editor) break;
    if (n.hasAttribute('data-wr-ui')) moveKeepingFocus(n, () => s.bar.appendChild(n));
  }
}

// Phones: the on-screen keyboard shrinks the visual viewport, not the fixed
// sheet; keep the sheet inside what is visible so the caret line stays in view
function fitViewport() {
  if (!F) return;
  const vv = window.visualViewport;
  const s = F;
  const keyboard = !!vv && Math.abs(vv.scale - 1) < 0.01 && vv.height < window.innerHeight - 40;
  const top = keyboard ? Math.round(vv.offsetTop) + 'px' : '';
  const height = keyboard ? Math.round(vv.height) + 'px' : '';
  if (s.host.style.top !== top) s.host.style.top = top;
  if (s.host.style.height !== height) {
    s.host.style.height = height;
    s.host.style.bottom = keyboard ? 'auto' : '';
    if (keyboard) requestAnimationFrame(() => { if (F === s) revealInSheet(); });
  }
}

// Caret line back into the calm part of the sheet when it slipped out of view
function revealInSheet() {
  if (!F) return;
  const r = getSelectionRange(F.editor);
  const rect = r ? caretRect(r, F.editor) : null;
  if (!rect) return;
  const box = F.scroller.getBoundingClientRect();
  if (rect.bottom > box.top + box.height * 0.7 || rect.top < box.top) F.scroller.scrollTop += rect.top - (box.top + box.height * 0.35);
}

// Keep the caret inside the editor's own scroll box (only that box scrolls)
function revealCaret(editor) {
  const range = getSelectionRange(editor);
  if (!range) return;
  const rect = caretRect(range, editor);
  if (!rect) return;
  const box = editor.getBoundingClientRect();
  if (rect.top < box.top + 4) editor.scrollTop -= box.top + 4 - rect.top + 12;
  else if (rect.bottom > box.bottom - 4) editor.scrollTop += rect.bottom - box.bottom + 4 + 12;
}

// --- Outline rail (only with doc-tools' api.outline) ---------------------------------
function outlineGetter() {
  const o = API.outline;
  if (o && typeof o.get === 'function') return (ed) => o.get(ed);
  if (typeof o === 'function') return o;
  if (typeof API.getOutline === 'function') return API.getOutline;
  return null;
}

// Accepts the likely shapes ({ level, text, el } and friends); headings by index otherwise
function readOutline(editor) {
  const get = outlineGetter();
  if (!get) return null;
  let items;
  try { items = get(editor); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const headings = [...editor.querySelectorAll('h1, h2, h3')];
  return items.map((it, i) => {
    const raw = it && (it.el || it.element || it.node || it.heading || it.target);
    const el = raw && raw.nodeType === 1 && editor.contains(raw) ? raw : (headings[i] || null);
    const tagLevel = el && /^H([1-6])$/.test(el.tagName) ? Number(el.tagName[1]) : 1;
    const level = Math.min(3, Math.max(1, Number(it && (it.level || it.depth)) || tagLevel));
    const text = String((it && (it.text ?? it.title ?? it.label)) ?? (el ? el.textContent : '')).replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    return { el, level, text };
  }).filter(it => it.el || it.text);
}

function railWanted() {
  return !!outlineGetter() && window.innerWidth >= RAIL_MIN_WIDTH;
}

function renderRail() {
  if (!F) return;
  const s = F;
  const want = railWanted();
  if (s.rail.hidden === want) s.rail.hidden = !want;
  if (!want) return;
  const items = readOutline(s.editor) || [];
  s.railItems = items;
  while (s.railRows.length < items.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wr-focus-rail-item';
    b.tabIndex = -1;
    b.appendChild(document.createTextNode(''));
    s.railList.appendChild(b);
    s.railRows.push(b);
  }
  while (s.railRows.length > items.length) s.railRows.pop().remove();
  items.forEach((it, i) => {
    const b = s.railRows[i];
    const text = it.text || 'Untitled heading';
    if (b.firstChild.data !== text) b.firstChild.data = text;
    if (b.dataset.level !== String(it.level)) b.dataset.level = String(it.level);
    if (b.dataset.index !== String(i)) b.dataset.index = String(i);
    if (b.title !== text) b.title = text;
  });
  const empty = !items.length;
  if (s.railEmpty.hidden === empty) s.railEmpty.hidden = !empty;
  markActive();
}

function scheduleRail() {
  if (!F || F.railTimer) return;
  F.railTimer = setTimeout(() => { if (F) { F.railTimer = 0; renderRail(); } }, 250);
}

// The heading the caret is under (or, without a caret, the one at the top)
function markActive() {
  if (!F || F.rail.hidden || !F.railItems.length) return;
  const s = F;
  let index = -1;
  const range = getSelectionRange(s.editor);
  if (range) {
    s.railItems.forEach((it, i) => {
      if (!it.el) return;
      if (it.el === range.startContainer || it.el.contains(range.startContainer) ||
          (it.el.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)) index = i;
    });
  } else {
    const line = s.scroller.getBoundingClientRect().top + s.scroller.clientHeight * 0.3;
    s.railItems.forEach((it, i) => { if (it.el && it.el.getBoundingClientRect().top <= line) index = i; });
  }
  // One tab stop for the whole rail (the current heading); arrows move inside
  const stop = index >= 0 ? index : 0;
  s.railRows.forEach((b, i) => {
    const on = i === index;
    if (b.hasAttribute('aria-current') !== on) {
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    const tab = i === stop ? 0 : -1;
    if (b.tabIndex !== tab && !b.contains(document.activeElement)) b.tabIndex = tab;
  });
}

function onRailKey(e) {
  if (!F || e.ctrlKey || e.metaKey || e.altKey) return;
  const rows = F.railRows;
  const i = rows.indexOf(document.activeElement);
  if (i < 0) return;
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
  if (to == null) return;
  e.preventDefault();
  const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
  rows.forEach(b => { b.tabIndex = b === next ? 0 : -1; });
  next.focus();
}

function onRailClick(e) {
  const b = e.target.closest('.wr-focus-rail-item');
  if (!b || !F) return;
  const it = F.railItems[Number(b.dataset.index)];
  const heading = it && it.el;
  if (!heading || !F.editor.contains(heading)) return;
  const top = heading.getBoundingClientRect().top - F.scroller.getBoundingClientRect().top + F.scroller.scrollTop - 72;
  F.scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
  try { F.editor.focus({ preventScroll: true }); } catch { F.editor.focus(); }
  placeCaret(heading.firstChild && heading.firstChild.nodeType === Node.TEXT_NODE ? heading.firstChild : heading, 0);
  markActive();
}

// --- Typing: fading chrome, typewriter scrolling --------------------------------
function wake() {
  if (!F || !F.typing) return;
  F.typing = false;
  delete F.host.dataset.typing;   // a data-* flag: glass-glow doesn't re-measure on it
}

function onEditorInput() {
  if (!F) return;
  if (!F.typing) { F.typing = true; F.host.dataset.typing = ''; }
  if (API.prefs.get('typewriter')) {
    // Right away (before the browser scrolls the caret into view itself, so
    // the page moves once), and again next frame after any late edit
    typewriter();
    scheduleTypewriter();
  }
}

function typewriter() {
  if (!F) return;
  const range = getSelectionRange(F.editor);
  if (!range || !range.collapsed) return;
  const rect = caretRect(range, F.editor);
  if (!rect) return;
  const box = F.scroller.getBoundingClientRect();
  const delta = rect.top + rect.height / 2 - (box.top + box.height * TYPEWRITER_AT);
  if (Math.abs(delta) > 4) F.scroller.scrollTop += delta;
}

function scheduleTypewriter() {
  if (!F || F.twRaf) return;
  F.twRaf = requestAnimationFrame(() => {
    if (!F) return;
    F.twRaf = 0;
    typewriter();
  });
}

// The top row's toggle for the 'typewriter' preference (also in the
// writing preferences); switching it on brings the typing line to its place
function syncTypewriterButton() {
  if (!F || !F.twBtn) return;
  const on = String(!!API.prefs.get('typewriter'));
  if (F.twBtn.getAttribute('aria-pressed') !== on) F.twBtn.setAttribute('aria-pressed', on);
}

function onTypewriterToggle() {
  if (!F) return;
  const on = !API.prefs.get('typewriter');
  API.prefs.set('typewriter', on);
  syncTypewriterButton();
  if (on) { cancelTypewriter(); typewriter(); }
  API.toast(on ? 'Typewriter scrolling on' : 'Typewriter scrolling off');
}

// A click or a navigation key before that frame: the caret moved on purpose
function cancelTypewriter() {
  if (F && F.twRaf) { cancelAnimationFrame(F.twRaf); F.twRaf = 0; }
}

function onPointerDownCapture() {
  cancelTypewriter();
  wake();
}

// Real pointer movement only: Chrome sends a mousemove with the same screen
// position after the page scrolls under the pointer (typewriter scrolling)
function onPointerMove(e) {
  if (!F) return;
  if (F.px != null && Math.abs(e.screenX - F.px) + Math.abs(e.screenY - F.py) < 6) return;
  F.px = e.screenX;
  F.py = e.screenY;
  wake();
}

function onFocusIn(e) {
  if (F && !F.editor.contains(e.target)) wake();
}

// Something in the window behind the sheet took the focus (Ideas asks for a
// title on Ctrl+S): leave focus mode so it can be seen
function onDocFocusIn(e) {
  if (!F || !F.origin) return;
  const t = e.target;
  if (!(t instanceof Node) || F.host.contains(t) || !F.origin.contains(t)) return;
  exit({ reason: 'focus-left' });
}

// A press in the empty page around / below the text puts the caret at the end
function onPagePointerDown(e) {
  if (!F || e.button !== 0) return;
  const t = e.target;
  if (t !== F.scroller && t !== F.column && !(t.classList && t.classList.contains('wr-focus-layout'))) return;
  if (e.clientY < F.editor.getBoundingClientRect().bottom) return;
  e.preventDefault();
  try { F.editor.focus({ preventScroll: true }); } catch { F.editor.focus(); }
  const range = document.createRange();
  range.selectNodeContents(F.editor);
  range.collapse(false);
  restoreRange(range, F.editor);
}

// --- Keys --------------------------------------------------------------------------
function focusables(s) {
  return [...s.host.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')]
    .filter(n => !n.closest('[contenteditable="true"]:not(.wr-editor)') && (n === s.editor || !s.editor.contains(n)) && n.getClientRects().length);
}

// Capture: Tab stays in the sheet; after any key, check the editor's window
// is still there (its Ctrl+S may have closed it)
function onKeyCapture(e) {
  if (!F) return;
  if (!F.checkTimer) F.checkTimer = setTimeout(() => { if (F) { F.checkTimer = 0; checkContext(); } }, 0);
  cancelTypewriter(); // arrows / Home / End move the caret: never recentre for those
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
  const a = document.activeElement;
  if (!a || !F.host.contains(a) || a === F.editor || F.editor.contains(a)) return;
  const items = focusables(F);
  if (!items.length) return;
  const i = items.indexOf(a);
  if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
  else if (!e.shiftKey && (i === items.length - 1 || i < 0)) { e.preventDefault(); items[0].focus(); }
}

// Bubble: Esc leaves focus mode once nothing else wanted it (writing menus,
// @ list, find box, dialogs opened on top all come first)
function onKeyBubble(e) {
  if (!F || e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  const t = e.target;
  if (t !== document.body && !(t instanceof Node && F.host.contains(t))) return;
  if (t !== F.editor && !F.editor.contains(t) && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (API.ui.isOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  // Context menu, highlighter swatches, task picker: close those first
  const open = [...document.querySelectorAll(LEGACY_POPUPS)].filter(visible);
  if (open.length) { open.forEach(p => { p.style.display = 'none'; }); return; }
  exit({ reason: 'escape' });
}

function checkContext() {
  if (!F) return;
  const lost = contextLost(F);
  if (lost) exit({ lost, reason: 'context' });
}

// --- Enter / exit --------------------------------------------------------------------
function enter(editor) {
  const st = editor && API.stateOf(editor);
  if (!st || !editor.isConnected || !editor.getClientRects().length) return false;
  if (F) {
    if (F.editor === editor) return true;
    exit({ reason: 'switch' });
  }
  const toolbar = st.opts.toolbar && st.opts.toolbar.isConnected ? st.opts.toolbar : null;

  // What to put back: caret, and every scroll position around the editor
  const range = getSelectionRange(editor) || (st.lastRange && editor.contains(st.lastRange.startContainer) ? st.lastRange : null);
  const caret = saveCaret(editor, range);
  const scrolls = [];
  for (let n = editor.parentElement; n; n = n.parentElement) {
    if (n.scrollTop || n.scrollLeft) scrolls.push([n, n.scrollTop, n.scrollLeft]);
  }
  const editorScroll = editor.scrollTop;

  // Writing bars right after the toolbar (find bar) come along, and so does
  // the status line, wherever it sits (it may share the actions row under the
  // editor): a marker holds its place. Other UI next to the editor (template
  // hint) follows the editor by itself.
  API.ui.closeAll('focus');
  const barParts = [];
  if (toolbar) {
    for (let n = toolbar.nextElementSibling; n && n !== editor && n.hasAttribute('data-wr-ui'); n = n.nextElementSibling) barParts.push(n);
  }
  let status = statusLine(editor);
  if (!status) {
    const next = editor.nextElementSibling;
    if (next && next.matches('.wr-status[data-wr-ui]')) status = next;
  }
  if (status && (barParts.includes(status) || (toolbar && toolbar.contains(status)))) status = null;

  const { kind, title } = docMeta(st);
  const host = document.createElement('div');
  host.className = 'wr-focus';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', title ? `Focus mode: ${title}` : 'Focus mode');
  host.dataset.wrFor = st.opts.id || '';
  const origin = originWindow(editor);
  host.style.zIndex = String(origin.z ? origin.z + 1 : DEFAULT_Z);
  host.innerHTML = `
    <div class="wr-focus-top" data-wr-ui>
      <div class="wr-focus-doc"><span class="wr-focus-kind"></span><span class="wr-focus-title"></span></div>
      <button type="button" class="wr-focus-tw" aria-pressed="false" title="Typewriter scrolling: the line you type stays at the same height">${TW_ICON}<span class="wr-focus-tw-label">Typewriter</span></button>
      <button type="button" class="wr-focus-exit" title="Exit focus mode (Esc)">${EXIT_ICON}<span class="wr-focus-exit-label">Exit focus</span>${API.ui.kbdHtml(['Esc'])}</button>
    </div>
    <div class="wr-focus-bar"></div>
    <div class="wr-focus-scroll">
      <div class="wr-focus-layout">
        <nav class="wr-focus-rail" data-wr-ui aria-label="Outline" hidden>
          <div class="wr-focus-rail-head">Outline</div>
          <div class="wr-focus-rail-list"></div>
          <div class="wr-focus-rail-empty" hidden>Add headings with # or ${API.registry.formatKeysText ? API.registry.formatKeysText('Mod+Shift+1', API.registry.isMac) : 'Ctrl+Shift+1'}</div>
        </nav>
        <div class="wr-focus-column"></div>
      </div>
    </div>
    <div class="wr-focus-foot"></div>`;
  host.querySelector('.wr-focus-kind').textContent = kind;
  host.querySelector('.wr-focus-title').textContent = title || 'Untitled';
  if (!kind) host.querySelector('.wr-focus-kind').hidden = true;

  const s = {
    editor, st, toolbar, host, scrolls, editorScroll, origin: origin.win,
    bar: host.querySelector('.wr-focus-bar'),
    scroller: host.querySelector('.wr-focus-scroll'),
    column: host.querySelector('.wr-focus-column'),
    foot: host.querySelector('.wr-focus-foot'),
    rail: host.querySelector('.wr-focus-rail'),
    railList: host.querySelector('.wr-focus-rail-list'),
    railEmpty: host.querySelector('.wr-focus-rail-empty'),
    railRows: [], railItems: [], railTimer: 0,
    tbMarker: toolbar ? document.createComment('wr-focus toolbar') : null,
    edMarker: document.createComment('wr-focus editor'),
    status, stMarker: status ? document.createComment('wr-focus status') : null,
    typing: false, px: null, py: null, twRaf: 0, checkTimer: 0, interval: 0
  };

  // Markers first (they hold the places), then move
  if (toolbar) toolbar.before(s.tbMarker);
  editor.before(s.edMarker);
  if (status) status.before(s.stMarker);
  document.body.appendChild(host);
  if (toolbar) s.bar.append(toolbar, ...barParts);
  else s.bar.hidden = true;
  s.column.appendChild(editor);
  if (status) s.foot.appendChild(status);
  F = s;

  // Listeners for this session only (removed on exit)
  s.onExitClick = () => exit({ reason: 'button' });
  host.querySelector('.wr-focus-exit').addEventListener('click', s.onExitClick);
  s.twBtn = host.querySelector('.wr-focus-tw');
  s.twBtn.addEventListener('mousedown', e => e.preventDefault()); // the editor keeps its caret
  s.twBtn.addEventListener('click', onTypewriterToggle);
  syncTypewriterButton();
  s.rail.addEventListener('click', onRailClick);
  s.rail.addEventListener('keydown', onRailKey);
  editor.addEventListener('input', onEditorInput);
  host.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusin', onDocFocusIn, true);
  window.addEventListener('keydown', onKeyCapture, true);
  window.addEventListener('keydown', onKeyBubble);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDownCapture, true);
  s.onResize = () => renderRail();
  window.addEventListener('resize', s.onResize);
  s.onScroll = () => { if (!s.scrollRaf) s.scrollRaf = requestAnimationFrame(() => { s.scrollRaf = 0; if (F === s && !getSelectionRange(s.editor)) markActive(); }); };
  s.scroller.addEventListener('scroll', s.onScroll, { passive: true });
  s.scroller.addEventListener('pointerdown', onPagePointerDown);
  s.interval = setInterval(checkContext, 400);
  s.columnObserver = new MutationObserver(onColumnMutations);
  s.columnObserver.observe(s.column, { childList: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
    fitViewport();
  }

  // Caret back, scrolled into the calm part of the screen
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  putCaret(editor, caret);
  renderRail();
  requestAnimationFrame(() => {
    if (F !== s) return;
    revealInSheet();
    markActive();
  });
  API.refreshToolbar(editor);
  return true;
}

function exit(opts = {}) {
  const s = F;
  if (!s) return false;
  F = null;
  clearInterval(s.interval);
  clearTimeout(s.checkTimer);
  clearTimeout(s.railTimer);
  if (s.twRaf) cancelAnimationFrame(s.twRaf);
  if (s.scrollRaf) cancelAnimationFrame(s.scrollRaf);
  s.editor.removeEventListener('input', onEditorInput);
  s.host.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('focusin', onDocFocusIn, true);
  window.removeEventListener('keydown', onKeyCapture, true);
  window.removeEventListener('keydown', onKeyBubble);
  window.removeEventListener('pointermove', onPointerMove, { passive: true });
  window.removeEventListener('pointerdown', onPointerDownCapture, true);
  window.removeEventListener('resize', s.onResize);
  s.scroller.removeEventListener('scroll', s.onScroll, { passive: true });
  s.scroller.removeEventListener('pointerdown', onPagePointerDown);
  s.columnObserver.disconnect();
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', fitViewport);
    window.visualViewport.removeEventListener('scroll', fitViewport);
  }
  API.ui.closeAll('focus');

  const lost = opts.lost || contextLost(s);
  const active = document.activeElement;
  const hadFocus = !!(active && (active === s.editor || s.host.contains(active)));
  const caret = saveCaret(s.editor, getSelectionRange(s.editor));

  if (lost === 'gone') {
    // The window re-rendered without this editor (it was saved and rebuilt):
    // drop it, with its status line
    s.host.remove();
    if (s.tbMarker) s.tbMarker.remove();
    if (s.stMarker) s.stMarker.remove();
    return true;
  }

  // No scroll anchoring on the dialog while the toolbar settles (see settleScroll)
  const anchors = s.scrolls.map(([n]) => [n, n.style.overflowAnchor]);
  anchors.forEach(([n]) => { n.style.overflowAnchor = 'none'; });

  // Everything back in place, in the order it now has
  const barKids = [...s.bar.children].filter(n => n !== s.toolbar);
  const colKids = [...s.column.children];
  const footKids = [...s.foot.children].filter(n => n !== s.status);
  const keepFocusIn = barKids.find(n => n.contains(active)) || null; // e.g. the find box
  if (s.toolbar && s.tbMarker && s.tbMarker.isConnected) s.tbMarker.replaceWith(s.toolbar);
  else if (s.tbMarker) s.tbMarker.remove();
  s.edMarker.replaceWith(s.editor);
  if (s.status) {
    if (s.stMarker.isConnected) s.stMarker.replaceWith(s.status);
    else { s.stMarker.remove(); s.status.remove(); } // its row is gone: doc-tools makes a new one
  }
  // Bars opened meanwhile (find): where their module puts them, after the
  // toolbar when it shares the editor's parent, else right before the editor
  if (barKids.length) {
    const sameParent = !!(s.toolbar && s.toolbar.isConnected && s.toolbar.parentNode === s.editor.parentNode);
    let after = s.toolbar;
    barKids.forEach(n => moveKeepingFocus(n, () => {
      if (sameParent) { after.after(n); after = n; } else s.editor.before(n);
    }));
  }
  const at = colKids.indexOf(s.editor);
  colKids.slice(0, Math.max(0, at)).forEach(n => s.editor.before(n));
  let after = s.editor;
  colKids.slice(at + 1).concat(footKids).forEach(n => { after.after(n); after = n; });
  s.host.remove();

  // Scroll positions (the dialog may have clamped while the editor was away)
  const restoreScroll = () => {
    s.scrolls.forEach(([n, top, left]) => { if (n.isConnected) { n.scrollTop = top; n.scrollLeft = left; } });
    s.editor.scrollTop = s.editorScroll;
  };
  restoreScroll();

  // Focus button state (refreshToolbar needs a caret in the editor)
  s.toolbar && s.toolbar.querySelectorAll('[data-wr-cmd="focus"].active').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });

  if (!lost && hadFocus && !keepFocusIn) {
    try { s.editor.focus({ preventScroll: true }); } catch { s.editor.focus(); }
    // (after a reload the old caret means nothing: it stays at the start)
    const back = opts.reason !== 'load' && putCaret(s.editor, caret);
    restoreScroll();
    if (back) revealCaret(s.editor);
    API.refreshToolbar(s.editor);
  }

  settleScroll(s, anchors);
  return true;
}

// The toolbar comes back unfolded and folds its tools into ⋯ a few frames
// later (phones: its ResizeObserver, then a frame). Scroll anchoring would
// follow that height change and move the dialog, so it stays off on the saved
// scrollers until the toolbar's height has held for a few frames (measured
// after each frame's layout); then the scroll positions go back once more
// (unless focus mode started again meanwhile) and anchoring is back on.
function settleScroll(s, anchors) {
  const tb = s.toolbar;
  const height = () => (tb && tb.isConnected ? tb.offsetHeight : 0);
  let last = height(), still = 0, frames = 0;
  const check = () => {
    const h = height();
    still = h === last ? still + 1 : 0;
    last = h;
    if (still < 4 && ++frames < 60) { next(); return; }
    if (!F) s.scrolls.forEach(([n, top, left]) => { if (n.isConnected) { n.scrollTop = top; n.scrollLeft = left; } });
    anchors.forEach(([n, v]) => { n.style.overflowAnchor = v; });
  };
  const next = () => requestAnimationFrame(() => setTimeout(check, 0));
  next();
}

// --- Install ------------------------------------------------------------------------
export function install(api) {
  API = api;

  api.registerCommand('focus', {
    run(ctx) {
      if (!ctx.editor) return false;
      if (F && F.editor === ctx.editor) return exit({ reason: 'command' });
      return enter(ctx.editor);
    },
    isActive: (ctx) => !!(F && F.editor === ctx.editor),
    isAvailable: (ctx) => !!(ctx.editor && ctx.tier === 'full' && ctx.features && ctx.features.focus)
  });

  // Another doc loaded into this editor (ideas clears it after Save): the
  // doc you were focusing on is gone, so is focus mode
  api.hooks.load.push((editor) => { if (F && F.editor === editor) exit({ reason: 'load' }); });
  // Rail follows the text and the caret
  api.hooks.change.push((editor) => { if (F && F.editor === editor && !F.rail.hidden) scheduleRail(); });
  api.hooks.selection.push((e, ctx) => { if (F && ctx.editor === F.editor) markActive(); return false; });
  // The preference changed elsewhere (writing preferences): the toggle follows
  api.prefs.onChange((key) => { if (key === 'typewriter') syncTypewriterButton(); });

  api.focusMode = {
    isActive: (editor) => !!F && (!editor || F.editor === editor),
    enter: (editor) => enter(editor || api.activeEditor()),
    exit: () => exit({ reason: 'api' }),
    editor: () => (F ? F.editor : null)
  };
}
