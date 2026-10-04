// Personal Dashboard - Writing: find & replace bar (FULL editors)
// Ctrl+F / Ctrl+H inside a FULL editor (anywhere else the browser keeps
// them), the toolbar Find button, /find and /replace open one slim bar right
// under the editor's toolbar (outside the contenteditable): query, match
// count, match case / whole word (Alt+C / Alt+W, not on a Mac: Option types
// characters there), previous / next (Enter, Shift+Enter, F3, Ctrl/⌘+G), and
// a replace row.
// - Matches are painted with the CSS Custom Highlight API (::highlight
//   wr-find / wr-find-current): no DOM writes, so undo, the saved HTML and
//   glass-glow's observers are untouched. Without the API the count, the
//   scrolling and the final selection still work.
// - Text is matched across formatting (bold, links, highlights) but never
//   across lines. Matches inside task pills / chips are found, not replaced.
// - Replace selects the match and runs insertText: one undo step. Replace all
//   is sequential insertText too (not one insertHTML over the document: Chrome
//   re-nests blocks when it pastes a whole document), last match first, one
//   undo step per edit (matches sharing a text node and a line share one
//   edit), at most 900 edits per click so the batch fits Chrome's 1,000-step
//   undo stack; then a toast offers Undo for the whole batch.
// - Matches follow edits (debounced); Esc (bar or editor), × or the toolbar
//   button closes the bar and selects the current match in the editor.
// api.find = { open(editor, { replace }), close(), isOpen(editor), bar() }

import { buildTextIndex, indexRange, indexSegments, indexRawOffset, indexOffset, revealInEditor, scrollRangeIntoView, isShown } from './doc-tools.js';

const HAS_HIGHLIGHTS = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
const HL_ALL = 'wr-find';
const HL_CURRENT = 'wr-find-current';
const MAX_MATCHES = 2000;
const NUM = new Intl.NumberFormat('en-US');
const fmtNum = (n) => NUM.format(n);
const SEARCH_DELAY = 60;   // while typing the query
const FOLLOW_DELAY = 160;  // while the document changes

const ARROW_UP = '<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 15 12 9 18 15"/></svg>';
const ARROW_DOWN = '<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>';

let api = null;
let bar = null;       // the one bar element, placed under whichever editor searches
let els = null;       // its parts
let session = null;   // { editor, index, matches, ranges, current, origin, saved, timer }
let batch = null;     // last Replace all, for its Undo
let lastQuery = '';
const options = { caseSensitive: false, wholeWord: false }; // remembered for the page session
let replaceShown = false;

// The editor's dialog closed (or its edit mode ended) with the bar open: the
// session ends quietly, so nothing stays painted for a hidden document
const hiddenWatch = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (!en.isIntersecting && session && en.target === bar && !isShown(bar)) closeFind({ restore: false });
  });
}) : null;

// --- Matching ----------------------------------------------------------------------
const REGEX_SPECIALS = new RegExp('[.*+?^${}()|[\\]\\\\]', 'g');

function cleanQuery(q) {
  return String(q || '').replace(/[\u200B\uFEFF]/g, '').replace(/\u00A0/g, ' ');
}

// sticky: for re-checking one match in place
function buildRegex(query, sticky = false) {
  const q = cleanQuery(query);
  if (!q) return null;
  let src = q.replace(REGEX_SPECIALS, '\\$&');
  if (options.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, (options.caseSensitive ? '' : 'i') + 'u' + (sticky ? 'y' : 'g'));
  } catch {
    return null;
  }
}

// Up to MAX_MATCHES; out.capped when there are more
function findMatches(text, re) {
  const out = [];
  out.capped = false;
  if (!re) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    if (out.length === MAX_MATCHES) { out.capped = true; break; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function isLocked(index, m) {
  return indexSegments(index, m.start, m.end).some(s => s.locked);
}

// --- Highlights ---------------------------------------------------------------------
function paint() {
  if (!HAS_HIGHLIGHTS || !session) return;
  const ranges = session.ranges.filter(Boolean);
  if (ranges.length) CSS.highlights.set(HL_ALL, new Highlight(...ranges));
  else CSS.highlights.delete(HL_ALL);
  paintCurrent();
}

function paintCurrent() {
  if (!HAS_HIGHLIGHTS || !session) return;
  const r = session.ranges[session.current];
  if (r) {
    const h = new Highlight(r);
    h.priority = 1;
    CSS.highlights.set(HL_CURRENT, h);
  } else {
    CSS.highlights.delete(HL_CURRENT);
  }
}

function clearHighlights() {
  if (!HAS_HIGHLIGHTS) return;
  CSS.highlights.delete(HL_ALL);
  CSS.highlights.delete(HL_CURRENT);
}

// --- Bar ------------------------------------------------------------------------------
function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function button(cls, act, label, title, html) {
  const b = el('button', cls, { type: 'button', 'aria-label': label, title });
  if (act) b.dataset.act = act;
  b.innerHTML = html;
  return b;
}

function keysText(spec) {
  return api.registry.formatKeysText(spec, api.registry.isMac);
}

function buildBar() {
  const { icon } = api.ui;
  const root = el('div', 'wr-find', { role: 'search', 'aria-label': 'Find in document' });
  root.dataset.wrUi = '';

  // Row 1: [▸] [🔍 query 3/12 Aa ab] [↑] [↓] [×]
  const row = el('div', 'wr-find-row');
  // Chevron beside the field; narrow bars (toggle next to ↑ ↓) show the replace glyph instead
  const toggle = button('wr-find-btn wr-find-toggle', 'toggleReplace', 'Show replace', `Replace (${keysText('Mod+H')})`,
    icon('chevronRight', 14, 'wr-find-toggle-chevron') + icon('replace', 15, 'wr-find-toggle-glyph'));
  toggle.setAttribute('aria-expanded', 'false');
  const field = el('div', 'wr-find-field');
  field.innerHTML = icon('find', 14, 'wr-find-field-icon');
  const query = el('input', 'wr-find-input', { type: 'text', placeholder: 'Find', 'aria-label': 'Find in document', spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'search' });
  query.dataset.role = 'query';
  const count = el('span', 'wr-find-count', { 'aria-live': 'polite' });
  const countText = document.createTextNode('');
  count.appendChild(countText);
  // (no Alt+C / Alt+W on a Mac: see optionShortcut)
  const optTitle = (name, keys) => (api.registry.isMac ? name : `${name} (${keysText(keys)})`);
  const caseBtn = button('wr-find-opt', 'caseSensitive', 'Match case', optTitle('Match case', 'Alt+C'), '<span class="wr-find-aa" aria-hidden="true">Aa</span>');
  const wordBtn = button('wr-find-opt', 'wholeWord', 'Whole word', optTitle('Whole word', 'Alt+W'), '<span class="wr-find-ww" aria-hidden="true">ab</span>');
  caseBtn.setAttribute('aria-pressed', String(options.caseSensitive));
  wordBtn.setAttribute('aria-pressed', String(options.wholeWord));
  field.append(query, count, caseBtn, wordBtn);
  const prev = button('wr-find-btn', 'prev', 'Previous match', 'Previous match (Shift+Enter, Shift+F3)', ARROW_UP);
  const next = button('wr-find-btn', 'next', 'Next match', 'Next match (Enter, F3)', ARROW_DOWN);
  const close = button('wr-find-btn wr-find-close', 'close', 'Close find', 'Close (Esc)', icon('close', 15));
  const nav = el('div', 'wr-find-nav');
  nav.append(prev, next);
  row.append(toggle, field, nav, close);

  // Row 2: [replace field] [Replace] [Replace all]
  const rrow = el('div', 'wr-find-row wr-find-replace-row');
  rrow.hidden = true;
  const rfield = el('div', 'wr-find-field');
  rfield.innerHTML = icon('replace', 14, 'wr-find-field-icon');
  const replace = el('input', 'wr-find-input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false', autocomplete: 'off' });
  replace.dataset.role = 'replace';
  rfield.append(replace);
  const one = button('wr-find-action', 'replace', 'Replace', 'Replace this match (Enter)', 'Replace');
  const all = button('wr-find-action', 'replaceAll', 'Replace all', `Replace every match (${keysText('Mod+Enter')})`, 'Replace all');
  const actions = el('div', 'wr-find-actions');
  actions.append(one, all);
  rrow.append(el('span', 'wr-find-spacer', { 'aria-hidden': 'true' }), rfield, actions);
  root.append(row, rrow);

  // Buttons keep the focus where it was (query field or editor); a click on a
  // field's padding focuses its input
  root.addEventListener('mousedown', (e) => {
    if (e.target.closest('input')) return;
    e.preventDefault();
    const f = e.target.closest('.wr-find-field');
    if (f && !e.target.closest('button')) f.querySelector('input').focus();
  });
  root.addEventListener('click', onBarClick);
  root.addEventListener('keydown', onBarKeydown);
  query.addEventListener('input', () => {
    if (!session) return;
    lastQuery = query.value;
    later({ reveal: true }, SEARCH_DELAY);
  });

  bar = root;
  els = { root, toggle, query, count, countText, caseBtn, wordBtn, prev, next, close, rrow, replace, one, all };
}

function setReplaceShown(show) {
  replaceShown = !!show;
  if (!els) return;
  if (els.rrow.hidden === replaceShown) els.rrow.hidden = !replaceShown;
  els.toggle.setAttribute('aria-expanded', String(replaceShown));
  els.toggle.setAttribute('aria-label', replaceShown ? 'Hide replace' : 'Show replace');
}

function setDisabled(btn, off) {
  if (btn.disabled !== off) btn.disabled = off;
}

function updateCount() {
  if (!els || !session) return;
  const n = session.matches.length;
  const q = cleanQuery(els.query.value);
  let text = '';
  if (q) {
    if (!n) text = 'No results';
    else text = `${session.current + 1}/${session.matches.capped ? MAX_MATCHES + '+' : n}`;
  }
  if (els.countText.data !== text) els.countText.data = text;
  const empty = String(!!q && !n);
  if (els.count.dataset.empty !== empty) els.count.dataset.empty = empty;
  setDisabled(els.prev, n < 1);
  setDisabled(els.next, n < 1);
  setDisabled(els.one, n < 1);
  setDisabled(els.all, n < 1);
}

function setToolbarActive(editor, on) {
  const st = editor && api.stateOf(editor);
  const btn = st && st.buttons && st.buttons.get('find');
  if (!btn) return;
  if (btn.classList.contains('active') !== on) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

// --- Session ---------------------------------------------------------------------------
function isOpenFor(editor) {
  return !!session && session.editor === editor && !!bar && bar.isConnected;
}

function placeBar(editor) {
  const st = api.stateOf(editor);
  const toolbar = st && st.opts.toolbar;
  if (toolbar && toolbar.parentNode === editor.parentNode) {
    if (toolbar.nextElementSibling !== bar) toolbar.after(bar);
  } else if (editor.previousElementSibling !== bar) {
    editor.before(bar);
  }
}

// One clean line of selected text seeds the query
function selectionSeed(range) {
  if (!range || range.collapsed) return null;
  const t = cleanQuery(range.toString());
  if (!t.trim() || /[\r\n]/.test(t) || t.length > 120) return null;
  return t;
}

function openFind(editor, { replace = false } = {}) {
  if (!editor || !editor.isConnected) return false;
  if (!bar) buildBar();
  if (session && session.editor !== editor) closeFind({ restore: false });
  const range = api.dom.getSelectionRange(editor);
  const seed = selectionSeed(range);
  const first = !session;
  if (first) {
    session = { editor, index: null, matches: [], ranges: [], current: -1, origin: 0, saved: null, savedRange: null, timer: 0, pending: null };
    placeBar(editor);
    setReplaceShown(replace);
    if (hiddenWatch) hiddenWatch.observe(bar);
  } else {
    clearTimeout(session.timer);
    session.timer = 0;
    session.pending = null;
    placeBar(editor);
    if (replace) setReplaceShown(true);
  }
  if (range) {
    // A live copy follows the edits made meanwhile (Replace all); the text
    // offsets are the fallback
    session.saved = api.dom.rangeToOffsets(range, editor);
    session.savedRange = range.cloneRange();
  }
  if (seed != null) els.query.value = seed;
  else if (first && !els.query.value) els.query.value = lastQuery;
  lastQuery = els.query.value;
  // Search from the caret: the first match at or after it is the current one
  const index = buildTextIndex(editor);
  session.index = index;
  session.origin = range ? indexOffset(index, range.startContainer, range.startOffset) : 0;
  session.current = -1;
  search({ reveal: true, origin: session.origin, index });
  setToolbarActive(editor, true);
  const target = replace && cleanQuery(els.query.value) ? els.replace : els.query;
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  target.select();
  return true;
}

// restore: give the editor the focus back, with the current match selected
// (or the caret it had when the bar opened). Closed while writing (Esc or the
// toolbar button with the caret in the text), the caret stays where it is.
function closeFind({ restore = true } = {}) {
  if (!session) return;
  const s = session;
  clearTimeout(s.timer);
  const hadFocus = !!bar && bar.contains(document.activeElement);
  const writing = !hadFocus && s.editor.contains(document.activeElement);
  let target = null;
  if (restore && !writing && s.editor.isConnected && s.matches.length && s.current >= 0) {
    // Fresh offsets, and only if the match is still there
    const index = buildTextIndex(s.editor);
    const m = s.matches[s.current];
    const sticky = els && buildRegex(els.query.value, true);
    if (sticky) {
      sticky.lastIndex = m.start;
      const again = sticky.exec(index.text);
      if (again && again[0].length === m.end - m.start) target = indexRange(index, m.start, m.end);
    }
  }
  clearHighlights();
  session = null;
  if (hiddenWatch && bar) hiddenWatch.unobserve(bar);
  if (bar) bar.remove();
  setToolbarActive(s.editor, false);
  if (!restore || writing || !isShown(s.editor)) return;
  try { s.editor.focus({ preventScroll: true }); } catch { s.editor.focus(); }
  const kept = s.savedRange;
  if (target) {
    api.dom.restoreRange(target, s.editor);
  } else if (kept && s.editor.contains(kept.startContainer) && s.editor.contains(kept.endContainer)) {
    api.dom.restoreRange(kept, s.editor);
  } else if (s.saved) {
    const back = api.dom.offsetsToRange(s.editor, s.saved);
    if (back) api.dom.restoreRange(back, s.editor);
  } else if (hadFocus) {
    api.dom.placeCaretAtEnd(s.editor);
  }
}

// Re-run the search. origin: virtual offset the current match should be at or
// after (else it stays where it was); reveal: scroll the current match into view
function search({ reveal = false, origin = null, index = null } = {}) {
  if (!session) return;
  const { editor } = session;
  if (!editor.isConnected) { closeFind({ restore: false }); return; }
  // The editor + toolbar moved (focus mode): follow, unless that would blur the query
  if (bar && bar.isConnected && !bar.contains(document.activeElement)) placeBar(editor);
  const idx = index || buildTextIndex(editor);
  const matches = findMatches(idx.text, buildRegex(els.query.value));
  const prev = session.matches[session.current];
  const anchor = origin != null ? origin : (prev ? prev.start : session.origin);
  let current = -1;
  if (matches.length) {
    current = matches.findIndex(m => m.start >= anchor);
    if (current < 0) current = 0;
  }
  session.index = idx;
  session.matches = matches;
  session.current = current;
  session.ranges = matches.map(m => indexRange(idx, m.start, m.end));
  paint();
  updateCount();
  if (reveal) revealCurrent(false);
}

function revealCurrent(openHidden) {
  if (!session) return;
  const r = session.ranges[session.current];
  if (!r) return;
  if (openHidden && revealInEditor(r.startContainer, session.editor)) api.notifyChange(session.editor);
  scrollRangeIntoView(r, session.editor);
}

function step(delta) {
  if (!session || !session.matches.length) return;
  const n = session.matches.length;
  session.current = (session.current + delta + n) % n;
  session.origin = session.matches[session.current].start;
  paintCurrent();
  updateCount();
  revealCurrent(true);
}

// A search soon (typing the query, following edits); flushSearch() runs a
// pending one right away (Enter right after typing)
function later(opts, delay) {
  if (!session) return;
  clearTimeout(session.timer);
  session.pending = opts;
  session.timer = setTimeout(() => {
    if (!session) return;
    session.timer = 0;
    const o = session.pending;
    session.pending = null;
    search(o || {});
  }, delay);
}

function flushSearch() {
  if (!session || !session.pending) return;
  clearTimeout(session.timer);
  session.timer = 0;
  const o = session.pending;
  session.pending = null;
  search(o);
}

function scheduleFollow(delay = FOLLOW_DELAY) {
  if (!session) return;
  // A pending query search (it reveals) wins over a plain follow-up
  later(session.pending && session.pending.reveal ? session.pending : {}, delay);
}

// --- Replace -------------------------------------------------------------------------------
// (a copy goes to the selection: the selection would otherwise take the
// Range object over and move it)
function replaceRange(editor, range, text) {
  if (!range) return false;
  api.dom.restoreRange(range.cloneRange(), editor);
  return text ? api.dom.insertText(text) : api.dom.exec('delete');
}

// Two matches in one text node share an edit only when the raw text between
// them stays on one line (insertText turns a newline into <br> or a new
// block: code blocks, legacy newline text) and the saved caret isn't in it
function joinable(seg, prev, m, keep) {
  const from = indexRawOffset(seg, prev.end, true);
  const to = indexRawOffset(seg, m.start, false);
  if (/[\r\n]/.test(seg.node.data.slice(from, to))) return false;
  if (!keep) return true;
  const inGap = (n, o) => n === seg.node && o >= from && o <= to;
  return !inGap(keep.startContainer, keep.startOffset) && !inGap(keep.endContainer, keep.endOffset);
}

// Replace all plan: consecutive matches inside one text node become ONE edit
// (one insertText over the span between them, one undo step); a match across
// formatting is an edit of its own. Each edit keeps a live Range (it follows
// the DOM while later edits run) and the text it must still hold.
function planEdits(index, matches, rep, keep) {
  const edits = [];
  let locked = 0;
  for (const m of matches) {
    const segs = indexSegments(index, m.start, m.end);
    if (!segs.length) continue;
    if (segs.some(s => s.locked)) { locked++; continue; }
    const seg = segs.length === 1 ? segs[0] : null;
    const last = edits[edits.length - 1];
    if (seg && last && last.seg === seg && joinable(seg, last.matches[last.matches.length - 1], m, keep)) { last.matches.push(m); continue; }
    edits.push({ seg, matches: [m] });
  }
  edits.forEach((ed) => {
    const first = ed.matches[0];
    const lastM = ed.matches[ed.matches.length - 1];
    if (ed.seg) {
      // Raw node text between the first match's start and the last one's end,
      // every match swapped for the replacement (ZWSP / NBSP around them kept)
      const { seg } = ed;
      const data = seg.node.data;
      const a = indexRawOffset(seg, first.start, false);
      const b = indexRawOffset(seg, lastM.end, true);
      let out = '', pos = a;
      ed.matches.forEach((m) => {
        out += data.slice(pos, indexRawOffset(seg, m.start, false)) + rep;
        pos = indexRawOffset(seg, m.end, true);
      });
      out += data.slice(pos, b);
      const range = document.createRange();
      range.setStart(seg.node, a);
      range.setEnd(seg.node, b);
      ed.range = range;
      ed.expect = data.slice(a, b);
      ed.text = out;
    } else {
      ed.range = indexRange(index, first.start, lastM.end);
      ed.expect = ed.range ? ed.range.toString() : null;
      ed.text = rep;
    }
  });
  return { edits: edits.filter(ed => ed.range), locked };
}

function focusReplaceField() {
  if (!els) return;
  try { els.replace.focus({ preventScroll: true }); } catch { els.replace.focus(); }
}

function replaceOne() {
  if (!session) return;
  search();
  const { editor } = session;
  const m = session.matches[session.current];
  if (!m) return;
  if (isLocked(session.index, m)) {
    api.toast('That match is inside a task pill or chip, so it stays as it is');
    step(1);
    return;
  }
  const rep = els.replace.value;
  const r = session.ranges[session.current];
  if (r && revealInEditor(r.startContainer, editor)) api.notifyChange(editor);
  const ok = replaceRange(editor, indexRange(buildTextIndex(editor), m.start, m.end), rep);
  if (!ok) { api.toast('That match couldn’t be replaced'); focusReplaceField(); return; }
  dropBatch();
  search({ origin: m.start + cleanQuery(rep).length, reveal: true });
  focusReplaceField();
}

// Replace all: the saved caret (live Range) inside or at the end of a replaced
// span goes after the new text; the DOM alone would leave it before
function replaceKeepingCaret(editor, range, text) {
  const keep = session && session.savedRange;
  let carry = false;
  if (keep && keep.collapsed && range) {
    try {
      carry = range.comparePoint(keep.startContainer, keep.startOffset) === 0 &&
        keep.compareBoundaryPoints(Range.START_TO_START, range) > 0;
    } catch { carry = false; }
  }
  const ok = replaceRange(editor, range, text);
  const sel = ok && carry ? window.getSelection() : null;
  if (sel && sel.rangeCount) {
    const now = sel.getRangeAt(0);
    keep.setStart(now.endContainer, now.endOffset);
    keep.collapse(true);
  }
  return ok;
}

// One planned edit, last to first. Its live Range must still hold the text it
// was planned on; if an earlier edit disturbed the DOM, each match is found
// again at its offset (unchanged: only text after it was edited so far).
// Returns { matches, steps } (steps = undo steps it took)
function applyEdit(editor, ed, rep, sticky) {
  const r = ed.range;
  if (r.startContainer.isConnected && r.endContainer.isConnected && r.toString() === ed.expect) {
    return replaceKeepingCaret(editor, r, ed.text) ? { matches: ed.matches.length, steps: 1 } : { matches: 0, steps: 0 };
  }
  let matches = 0, steps = 0;
  for (let i = ed.matches.length - 1; i >= 0; i--) {
    const m = ed.matches[i];
    const index = buildTextIndex(editor);
    sticky.lastIndex = m.start;
    const again = sticky.exec(index.text);
    if (!again || again[0].length !== m.end - m.start || isLocked(index, m)) continue;
    if (replaceKeepingCaret(editor, indexRange(index, m.start, m.end), rep)) { matches++; steps++; }
  }
  return { matches, steps };
}

// Chrome keeps 1,000 undo steps: one Replace all stays inside that, so its
// toast Undo (and Ctrl+Z) can always take it all back
const EDIT_BUDGET = 900;
const STEP_LIMIT = 990;

// Sequential insertText, last match first (one undo step per edit; matches in
// the same text node share one), then a toast offers Undo for the whole batch
function replaceAll() {
  if (!session) return;
  search();
  const { editor } = session;
  if (!session.matches.length) return;
  const rep = els.replace.value;
  const sticky = buildRegex(els.query.value, true);
  // insertText needs rendered text: open the closed toggles that hold matches
  // (an attribute change: the text index stays valid)
  let opened = false;
  session.ranges.forEach(r => { if (r && revealInEditor(r.startContainer, editor)) opened = true; });
  if (opened) api.notifyChange(editor);
  const total = session.matches.length;
  const capped = !!session.matches.capped;
  const { edits, locked } = planEdits(session.index, session.matches, rep, session.savedRange);
  const todo = edits.slice(0, EDIT_BUDGET);
  let done = 0, steps = 0, stopped = false;
  for (let i = todo.length - 1; i >= 0; i--) {
    // (a disturbed edit falls back to one step per match)
    if (steps + todo[i].matches.length > STEP_LIMIT) { stopped = true; break; }
    const res = applyEdit(editor, todo[i], rep, sticky);
    done += res.matches;
    steps += res.steps;
  }
  search({ reveal: false });
  focusReplaceField();
  if (!done) {
    api.toast(locked ? 'Those matches are inside task pills or chips, so they stay as they are' : 'Nothing was replaced');
    return;
  }
  // More than one batch holds (or more than the 2,000 counted): say so
  const more = edits.length > todo.length || capped || stopped;
  const kept = locked ? ` · ${locked} in task pills left as they are` : '';
  const msg = more
    ? `Replaced ${fmtNum(done)} of ${capped ? 'over ' : ''}${fmtNum(total)} matches · Replace all again for the rest`
    : `Replaced ${fmtNum(done)} match${done === 1 ? '' : 'es'}${kept}`;
  const mine = { editor, steps, html: editor.innerHTML };
  startBatch(mine);
  // After the change listeners queued by those edits have run
  queueMicrotask(() => { if (!mine.stale) mine.html = editor.innerHTML; });
  api.actionToast(msg, [{ label: 'Undo', run: () => undoBatch(mine) }]);
}

// The toast Undo replays exactly this batch's undo steps. The browser keeps
// one undo stack for the whole page, so any edit made since (in the editor, the
// find fields or anywhere else) makes that unsafe: the batch goes stale.
function onAnyInput() {
  if (batch) batch.stale = true;
  endBatchWatch();
}
function endBatchWatch() {
  document.removeEventListener('input', onAnyInput, true);
}
function startBatch(b) {
  b.stale = false;
  batch = b;
  endBatchWatch();
  document.addEventListener('input', onAnyInput, true);
}
function dropBatch() {
  batch = null;
  endBatchWatch();
}

function undoBatch(b) {
  const { editor } = b;
  if (batch !== b || b.stale || !editor.isConnected || editor.innerHTML !== b.html) {
    if (batch === b) dropBatch();
    api.toast(`Something changed since, so that Undo is gone: ${keysText('Mod+Z')} in the text still undoes step by step`);
    return;
  }
  dropBatch();
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  for (let i = 0; i < b.steps; i++) api.dom.exec('undo');
  api.notifyChange(editor);
  if (session && session.editor === editor) search();
}

// --- Bar events ------------------------------------------------------------------------------
function toggleOption(name) {
  options[name] = !options[name];
  const btn = name === 'caseSensitive' ? els.caseBtn : els.wordBtn;
  btn.setAttribute('aria-pressed', String(options[name]));
  search({ reveal: true, origin: session ? session.origin : 0 });
}

function onBarClick(e) {
  const b = e.target.closest('button');
  if (!b || !session) return;
  switch (b.dataset.act) {
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'close': closeFind(); break;
    case 'toggleReplace':
      setReplaceShown(!replaceShown);
      if (replaceShown) focusReplaceField(); else els.query.focus();
      break;
    case 'caseSensitive':
    case 'wholeWord': toggleOption(b.dataset.act); break;
    case 'replace': replaceOne(); break;
    case 'replaceAll': replaceAll(); break;
  }
}

// The browser's find-again keys: F3 / Shift+F3, Ctrl/⌘+G / Shift+Ctrl/⌘+G
function isFindAgain(e, mod) {
  if (e.altKey) return false;
  if (e.key === 'F3') return !e.ctrlKey && !e.metaKey;
  return mod && (e.code === 'KeyG' || e.key.toLowerCase() === 'g');
}

function onBarKeydown(e) {
  if (!session || e.isComposing || e.keyCode === 229) return;
  const mod = api.dom.isMod(e, api.registry.isMac);
  const inReplace = e.target === els.replace;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Enter' && !e.altKey) {
    if (inReplace) {
      stop();
      if (mod) replaceAll(); else replaceOne();
      return;
    }
    if (e.target === els.query && !mod) {
      stop();
      flushSearch(); // typed then Enter at once: search the new text first
      step(e.shiftKey ? -1 : 1);
    }
    return;
  }
  if (isFindAgain(e, mod)) { stop(); flushSearch(); step(e.shiftKey ? -1 : 1); return; }
  if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
    stop();
    els.query.focus();
    els.query.select();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
    stop();
    setReplaceShown(true);
    focusReplaceField();
    els.replace.select();
    return;
  }
  const opt = optionShortcut(e);
  if (opt) { stop(); toggleOption(opt); }
}

// Alt+C / Alt+W toggle the options, by the letter the key types. Never on a
// Mac (Option+C types ç, Option+W ∑) nor with Ctrl+Alt / AltGr, which type
// characters too. Non-Latin layouts (Cyrillic, Greek...) go by key position.
function optionShortcut(e) {
  if (api.registry.isMac || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.getModifierState && e.getModifierState('AltGraph')) return null;
  const k = String(e.key || '').toLowerCase();
  let letter = k === 'c' || k === 'w' ? k : null;
  if (!letter && /^\p{L}$/u.test(k) && !/\p{Script=Latin}/u.test(k)) letter = { KeyC: 'c', KeyW: 'w' }[e.code] || null;
  return letter === 'c' ? 'caseSensitive' : letter === 'w' ? 'wholeWord' : null;
}

// Esc closes the bar from the bar or its editor, unless a menu / dropdown is
// open on top (those close first)
const OTHER_POPUPS = '.task-mention-dropdown, .highlight-context-menu, .task-link-picker';
function otherPopupOpen() {
  if (api.ui.isOpen()) return true;
  return [...document.querySelectorAll(OTHER_POPUPS)].some(n => !n.hidden && n.getClientRects().length && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden');
}

function onDocKeydown(e) {
  if (e.key !== 'Escape' || !session) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (!bar || !isShown(bar)) { closeFind({ restore: false }); return; }
  const t = e.target;
  const inBar = bar.contains(t);
  if (!inBar && !(t && session.editor.contains(t))) return;
  if (otherPopupOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  closeFind();
}

// --- Commands --------------------------------------------------------------------------------
function available(ctx) {
  return !!ctx.editor && ctx.tier === 'full' && ctx.features.find !== false;
}

export function install(writingApi) {
  api = writingApi;

  api.registerCommand('find', {
    run(ctx, arg = {}) {
      // The toolbar button toggles; Ctrl+F (and /find) always opens and focuses
      if (arg.source === 'toolbar' && isOpenFor(ctx.editor)) { closeFind(); return true; }
      return openFind(ctx.editor, { replace: false });
    },
    isActive: (ctx) => isOpenFor(ctx.editor),
    isAvailable: available
  });

  api.registerCommand('replace', {
    run: (ctx) => openFind(ctx.editor, { replace: true }),
    isAvailable: available
  });

  // F3 / Ctrl+G (Shift: back) from the editor while its bar is open
  api.hooks.keydown.push((e, ctx) => {
    if (!isOpenFor(ctx.editor) || !isFindAgain(e, api.dom.isMod(e, api.registry.isMac))) return false;
    step(e.shiftKey ? -1 : 1);
    return true;
  });

  // The bar stays under its toolbar if the editor moved (focus mode)
  api.hooks.selection.push((evt, ctx) => {
    if (isOpenFor(ctx.editor)) placeBar(ctx.editor);
  });

  // Matches follow the text
  api.hooks.change.push((editor) => {
    if (session && session.editor === editor) scheduleFollow();
  });

  // New content in the editor: keep searching when it stays on screen (another
  // project tab), else the doc was closed / switched: close
  api.hooks.load.push((editor) => {
    if (!session || session.editor !== editor) return;
    dropBatch();
    if (isShown(editor) && bar && bar.isConnected) scheduleFollow(0);
    else closeFind({ restore: false });
  });

  document.addEventListener('keydown', onDocKeydown, true);

  api.find = {
    open: (editor, opts) => openFind(editor || api.activeEditor(), opts || {}),
    close: () => closeFind(),
    isOpen: (editor) => (editor ? isOpenFor(editor) : !!session),
    bar: () => bar
  };
}
