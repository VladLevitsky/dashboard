// Personal Dashboard - Writing blocks: callouts, toggles, code blocks, tables,
// dividers, headings / quotes / text as block types, moving and duplicating
// blocks, the Enter / Backspace / Tab rules inside those blocks, the table
// tools bar, and the delegated clicks (callout icon cycles the kind, toggle
// chevron, code "Copy") that also work in the read-only views.
//
// Undo: every structural edit is ONE insertHTML, so one Ctrl+Z undoes it.
// The run of sibling nodes an edit touches is cloned into a detached holder,
// changed there with plain DOM calls, and written back over the original run
// (editRegion -> writeRegion). Chrome's insertHTML merges the edges of what it
// inserts into the neighbouring paragraphs and nests blocks inside emptied
// ones, so the write is framed: a throwaway plain line (ZWSP) goes in just
// before the run, the range runs from the end of that line to the deep end of
// the run, and the inserted HTML starts with an empty sentinel line. Both are
// removed right after. The result is checked against the intended HTML; if
// Chrome still did something else, its step is undone and the edit is done by
// hand (notifyChange) instead.
//
// The selection survives as <wr-mark> elements in the holder, turned into
// per-line text offsets (data-wr-mk-s / -e / -c) just before the write and
// resolved (then removed) right after it. Elements an edit needs to find in
// its holder are tagged (data-wr-t) only while the run is cloned.

import * as dom from './dom.js';
import { positionPopup } from './ui.js';

const KINDS = ['note', 'tip', 'decision', 'warning', 'caution'];
const KIND_OF_COMMAND = { callout: 'note', calloutTip: 'tip', calloutDecision: 'decision', calloutWarning: 'warning', calloutCaution: 'caution' };

const ZWSP = '\u200B';
const SENTINEL = '<div data-wr-s="" data-wr-ephemeral=""><br></div>';
const BLOCKISH = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR',
  'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD']);
const VOID = new Set(['BR', 'IMG', 'HR', 'INPUT', 'WBR']);
const FLOW_SELECTOR = '.wr-callout, .wr-toggle-body, blockquote';
const MARK = 'wr-mark';
const MARK_TAG = 'WR-MARK';
const MK_ATTR = { s: 'data-wr-mk-s', e: 'data-wr-mk-e', c: 'data-wr-mk-c' };
const MK_SELECTOR = '[data-wr-mk-s], [data-wr-mk-e], [data-wr-mk-c]';

// Clicks that drive in-content UI (drawn with pseudo-elements, writing.css 4)
const CHEVRON_ZONE = 26;   // toggle title: chevron column
const GUTTER_ZONE = 36;    // callout: icon column ...
const GUTTER_TOP = 40;     // ... beside the first line
const COPY_ZONE_W = 84;    // code block: "Copy" in the header strip ...
const COPY_ZONE_H = 30;
const LANG_ZONE_W = 110;   // ... and its language label (editors: click to set it)

let api = null;
const writes = new WeakMap(); // editor -> recent writes [{ original, inserted, before, after, state }]

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------
const isEl = (n, tag) => !!n && n.nodeType === 1 && (!tag || n.tagName === tag);
const isHeading = (el) => isEl(el) && /^H[1-6]$/.test(el.tagName);
const isInline = (n) => !!n && (n.nodeType === 3 || (n.nodeType === 1 && !BLOCKISH.has(n.tagName)));
const isFlowEl = (el) => isEl(el) && el.matches(FLOW_SELECTOR);
const isMark = (n) => isEl(n, MARK_TAG);
const isLocked = (n) => isEl(n) && n.getAttribute('contenteditable') === 'false';
const indexOf = (n) => Array.prototype.indexOf.call(n.parentNode.childNodes, n);
const hasText = (s) => !!String(s || '').replace(/[\s\u00A0\u200B\uFEFF]/g, '');

function hasBlockChild(el) {
  for (const c of el.childNodes) if (c.nodeType === 1 && BLOCKISH.has(c.tagName) && c.tagName !== 'LI') return true;
  return false;
}

// A line: the innermost block that holds text (div / p / h1-6 / li / pre /
// td / th, a toggle title, a legacy text-only blockquote)
function isLineEl(el) {
  if (!isEl(el)) return false;
  const t = el.tagName;
  if (t === 'LI' || t === 'PRE' || t === 'TD' || t === 'TH' || /^H[1-6]$/.test(t)) return true;
  if (t === 'DIV' || t === 'P' || t === 'BLOCKQUOTE') {
    if (el.classList.contains('wr-callout') || el.classList.contains('wr-toggle') || el.classList.contains('wr-toggle-body')) return false;
    return !hasBlockChild(el);
  }
  return false;
}

function lineOf(node, root) {
  let el = dom.elementOf(node);
  while (el && el !== root) {
    if (isLineEl(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function linesIn(root) {
  return [...root.querySelectorAll('*')].filter(isLineEl);
}

// No text (beyond spaces / ZWSP) and nothing visible like an image or a pill
function isBlankLine(el) {
  if (!el) return false;
  if (hasText(el.textContent)) return false;
  return !el.querySelector('img, hr, table, pre, [contenteditable="false"], ul, ol');
}

// A plain line in a flow: div / p without a class, holding inline content only
function isPlainLine(el) {
  return isEl(el) && (el.tagName === 'DIV' || el.tagName === 'P') && !el.className && isLineEl(el);
}

// An empty unit of a flow: a blank plain line, or a bare <br> / blank text run
function isBlankUnit(region) {
  if (!region) return false;
  const nodes = siblingsBetween(region.first, region.last);
  if (nodes.length === 1 && isPlainLine(nodes[0])) return isBlankLine(nodes[0]);
  return nodes.every(n => (n.nodeType === 3 && !hasText(n.data)) || isEl(n, 'BR'));
}

// Siblings, skipping whitespace-only text
function prevBlock(n) {
  let p = n.previousSibling;
  while (p && p.nodeType === 3 && !hasText(p.data)) p = p.previousSibling;
  return p;
}
function nextBlock(n) {
  let p = n.nextSibling;
  while (p && p.nodeType === 3 && !hasText(p.data)) p = p.nextSibling;
  return p;
}

// A plain <div> / <p> holding blocks: Chrome wraps a list made from a line
// (typed "[] " / "- " or the toolbar list buttons) in one, together with the
// lines typed after the list. It draws nothing, so its blocks are a flow of
// their own: a command works on the caret's line in it, not on the group.
function isWrapperEl(el) {
  return isEl(el) && (el.tagName === 'DIV' || el.tagName === 'P') && !el.className && !isLocked(el) &&
    !el.hasAttribute('data-wr-ephemeral') && hasBlockChild(el);
}

// The flow holding node: a callout, toggle body or quote, a plain wrapper
// (boxesOnly: not those) or the editor
function flowOf(node, editor, boxesOnly) {
  let el = dom.elementOf(node);
  while (el && el !== editor) {
    if (isFlowEl(el) || (!boxesOnly && isWrapperEl(el))) return el;
    el = el.parentElement;
  }
  return editor;
}

// The ancestor-or-self of node that is a direct child of flow
function unitIn(node, flow) {
  let n = node;
  while (n && n.parentNode !== flow) n = n.parentNode;
  return n;
}

// Inline siblings directly in a flow are one line (a "run"): take it whole
function runStart(n) {
  if (!isInline(n)) return n;
  while (n.previousSibling && isInline(n.previousSibling)) n = n.previousSibling;
  return n;
}
function runEnd(n) {
  if (!isInline(n)) return n;
  while (n.nextSibling && isInline(n.nextSibling)) n = n.nextSibling;
  return n;
}

// The box a flow belongs to (a toggle body's box is the whole toggle)
function containerOf(flow) {
  return flow.classList.contains('wr-toggle-body') ? flow.parentElement : flow;
}

function siblingsBetween(first, last) {
  const out = [];
  for (let n = first; n; n = n.nextSibling) { out.push(n); if (n === last) break; }
  return out;
}

// A range boundary pushed down into text (or next to a <br> / image / pill),
// so markers land inside lines, never between blocks
function deepPoint(node, offset, isEnd) {
  let n = node, o = offset;
  const atom = (c) => c.nodeType === 1 && (VOID.has(c.tagName) || isLocked(c));
  while (n.nodeType === 1 && n.childNodes.length && !isLocked(n) && !VOID.has(n.tagName)) {
    o = Math.min(o, n.childNodes.length);
    if (isEnd && o > 0) {
      const c = n.childNodes[o - 1];
      if (atom(c)) break;
      n = c; o = c.nodeType === 1 ? c.childNodes.length : c.data.length;
    } else if (o < n.childNodes.length) {
      const c = n.childNodes[o];
      if (atom(c)) break;
      n = c; o = 0;
    } else {
      const c = n.childNodes[n.childNodes.length - 1];
      if (atom(c)) break;
      n = c; o = c.nodeType === 1 ? c.childNodes.length : c.data.length;
    }
  }
  // after a line's trailing <br> (its placeholder) is the same spot as before it
  if (n.nodeType === 1 && o > 0 && o === n.childNodes.length && isEl(n.childNodes[o - 1], 'BR')) o--;
  return [n, o];
}

// The leaf node at a boundary (ends lean back into the node before)
function pointNode(container, offset, isEnd) {
  const [n, o] = deepPoint(container, offset, isEnd);
  if (n.nodeType === 1 && n.childNodes.length) return n.childNodes[Math.max(0, Math.min(isEnd ? o - 1 : o, n.childNodes.length - 1))];
  return n;
}

function makeMark(kind) {
  const m = document.createElement(MARK);
  m.setAttribute('data-k', kind);
  return m;
}

// Text offset of (node, offset) inside root (Range.toString length)
function textOffset(root, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
}

// Position at a text offset inside root; never inside a task pill / chip
// (moved next to it). An empty line gives (its deepest first element, 0).
// forward: at the end of one text node and the start of the next, take the
// next one (the caret was after a bold / link, not inside it).
function positionAt(root, offset, forward) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0, last = null;
  const outside = (t, after) => {
    const lock = dom.elementOf(t).closest('[contenteditable="false"]');
    if (!lock || lock === root || !root.contains(lock)) return null;
    return [lock.parentNode, indexOf(lock) + (after ? 1 : 0)];
  };
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    last = t;
    const len = t.data.length;
    if (offset < pos + len || (offset === pos + len && !forward)) return outside(t, offset - pos > 0) || [t, offset - pos];
    pos += len;
  }
  if (last) return outside(last, true) || [last, last.data.length];
  let n = root;
  while (n.firstChild && n.firstChild.nodeType === 1 && !VOID.has(n.firstChild.tagName) && !isLocked(n.firstChild)) n = n.firstChild;
  return [n, 0];
}

function selectRange(range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretInto(el, atEnd) {
  if (!el) return;
  const [n, o] = positionAt(el, atEnd ? (el.textContent || '').length : 0);
  const r = document.createRange();
  r.setStart(n, o);
  r.collapse(true);
  selectRange(r);
}

function focusEditor(editor) {
  if (document.activeElement === editor || editor.contains(document.activeElement)) return;
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
}

function revealCaret(editor) {
  const range = dom.getSelectionRange(editor);
  if (!range) return;
  const el = dom.elementOf(dom.anchorNode(range));
  if (el && el.scrollIntoView) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old engines */ }
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// The holder: a detached copy of the run being edited
// ---------------------------------------------------------------------------

// Clone first..last (siblings in flow), drop <wr-mark>s at the selection
function cloneRegion(flow, first, last, range) {
  const holder = document.createElement('div');
  const nodes = siblingsBetween(first, last);
  const base = indexOf(first);
  nodes.forEach(n => holder.appendChild(n.cloneNode(true)));
  if (range) {
    const s = deepPoint(range.startContainer, range.startOffset, false);
    const e = range.collapsed ? s : deepPoint(range.endContainer, range.endOffset, true);
    const points = range.collapsed ? [['c', s]] : [['e', e], ['s', s]];
    points.forEach(([kind, [node, offset]]) => {
      const spot = mapPoint(flow, base, nodes.length, holder, node, offset);
      if (spot) insertAtPoint(spot[0], spot[1], makeMark(kind));
    });
  }
  return holder;
}

// (node, offset) in the live flow -> the same point in the holder
function mapPoint(flow, base, count, holder, node, offset) {
  if (node === flow) {
    const k = offset - base;
    return k < 0 || k > count ? null : [holder, k];
  }
  const path = [];
  let n = node;
  while (n && n.parentNode !== flow) { path.unshift(indexOf(n)); n = n.parentNode; }
  if (!n) return null;
  const k = indexOf(n) - base;
  if (k < 0 || k >= count) return null;
  let c = holder.childNodes[k];
  for (const i of path) c = c && c.childNodes[i];
  return c ? [c, offset] : null;
}

function insertAtPoint(container, offset, mark) {
  if (container.nodeType === 3) {
    const off = Math.min(offset, container.data.length);
    if (off <= 0) container.parentNode.insertBefore(mark, container);
    else if (off >= container.data.length) container.parentNode.insertBefore(mark, container.nextSibling);
    else container.parentNode.insertBefore(mark, container.splitText(off));
  } else {
    container.insertBefore(mark, container.childNodes[offset] || null);
  }
}

// Canonical shape inside the holder (and its flows): inline runs wrapped in
// <div>, whitespace-only text between blocks dropped, the image-resize
// wrapper unwrapped, writing UI removed, the invisible <br> after text
// dropped (Chrome drops it too, and the write is verified)
function normalizeHolder(holder) {
  holder.querySelectorAll('[data-wr-ephemeral]').forEach(el => el.remove());
  holder.querySelectorAll('.editor-img-resize-wrap').forEach(wrap => {
    wrap.querySelectorAll('.editor-img-resize-handle').forEach(h => h.remove());
    wrap.replaceWith(...wrap.childNodes);
  });
  [holder, ...holder.querySelectorAll(FLOW_SELECTOR)].forEach(wrapRuns);
  holder.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6, li, td, th').forEach(dropTrailingBr);
}

function wrapRuns(flow) {
  let run = [];
  const flush = (before) => {
    if (!run.length) return;
    const content = run.some(n => (n.nodeType === 1 && !isMark(n)) || (n.nodeType === 3 && hasText(n.data)));
    const marks = run.filter(isMark);
    if (content) {
      const div = document.createElement('div');
      flow.insertBefore(div, before);
      run.forEach(n => div.appendChild(n));
      ensureFilled(div);
    } else {
      // only spaces between blocks: dropped (a marker there joins a neighbour line)
      run.forEach(n => { if (!isMark(n)) n.remove(); });
      if (marks.length) {
        const prevEl = run[0].previousSibling;
        const prevLine = isEl(prevEl) ? (isLineEl(prevEl) ? prevEl : linesIn(prevEl).pop()) : null;
        const nextLine = isEl(before) ? (isLineEl(before) ? before : linesIn(before)[0]) : null;
        if (prevLine && !nextLine) marks.forEach(m => prevLine.appendChild(m));
        else if (nextLine) marks.forEach(m => nextLine.insertBefore(m, nextLine.firstChild));
        else { const div = document.createElement('div'); flow.insertBefore(div, before); marks.forEach(m => div.appendChild(m)); ensureFilled(div); }
      }
    }
    run = [];
  };
  [...flow.childNodes].forEach(n => { if (isInline(n)) run.push(n); else flush(n); });
  flush(null);
}

function dropTrailingBr(el) {
  const last = el.lastChild;
  if (!isEl(last, 'BR')) return;
  let prev = last.previousSibling;
  while (prev && (isMark(prev) || (prev.nodeType === 3 && !prev.data))) prev = prev.previousSibling;
  if (!prev || isEl(prev, 'BR') || (isEl(prev) && BLOCKISH.has(prev.tagName))) return;
  last.remove();
}

// Inline content of a line (an <li> keeps its nested lists out)
function inlineChildren(line) {
  return [...line.childNodes].filter(n => !(isEl(n) && (n.tagName === 'UL' || n.tagName === 'OL')));
}

function ensureFilled(el) {
  if (!hasText(el.textContent) && !el.querySelector('br, img, hr, table, [contenteditable="false"]')) el.appendChild(document.createElement('br'));
  return el;
}

// A new <tag> holding line's inline content (markers move with it)
function retag(line, tag) {
  const el = document.createElement(tag);
  inlineChildren(line).forEach(n => el.appendChild(n));
  dropTrailingBr(el);
  return ensureFilled(el);
}

function emptyLine(withCaret) {
  const div = document.createElement('div');
  if (withCaret) div.appendChild(makeMark('c'));
  div.appendChild(document.createElement('br'));
  return div;
}

function marksIn(root) { return [...root.querySelectorAll(MARK)]; }
function dropMarks(root) { marksIn(root).forEach(m => m.remove()); }

function startMark(root) { return marksIn(root).find(m => m.getAttribute('data-k') !== 'e') || null; }
function endMark(root) { return marksIn(root).find(m => m.getAttribute('data-k') === 'e') || startMark(root); }

// Lines of the holder the selection covers (start line .. end line)
function selectedLines(holder) {
  const s = startMark(holder), e = endMark(holder);
  if (!s) return [];
  const sLine = lineOf(s, holder), eLine = lineOf(e, holder);
  return linesIn(holder).filter(l => {
    if (l === sLine || l === eLine) return true;
    const afterStart = s.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING;
    const beforeEnd = e.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_PRECEDING;
    return !!(afterStart && beforeEnd) && !l.contains(s);
  });
}

// Children of parent from the one holding the start marker to the one
// holding the end marker (the selected units of a flow)
function markedChildren(parent) {
  const kids = [...parent.childNodes];
  const s = startMark(parent), e = endMark(parent);
  if (!s) return [];
  const i = kids.findIndex(k => k === s || (k.nodeType === 1 && k.contains(s)));
  const j = kids.findIndex(k => k === e || (k.nodeType === 1 && k.contains(e)));
  return i < 0 || j < 0 ? [] : kids.slice(i, j + 1);
}

// Markers -> per-line text offsets (attributes survive insertHTML)
function finalizeMarks(holder) {
  marksIn(holder).forEach(m => {
    let line = lineOf(m, holder);
    if (!line) {
      const next = linesIn(holder).find(l => m.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (next) { next.insertBefore(m, next.firstChild); line = next; }
    }
    if (line) {
      // right after an inline element (bold, link...), not inside its end
      const prev = m.previousSibling;
      const forward = !!prev && prev.nodeType === 1 && !isEl(prev, 'BR') ? '+' : '';
      line.setAttribute(MK_ATTR[m.getAttribute('data-k')] || MK_ATTR.c, textOffset(line, m, 0) + forward);
    }
    m.remove();
  });
  holder.normalize();
}

// After the write: the selection goes back where the markers were
function restoreMarks(nodes, editor) {
  const elements = nodes.filter(n => n.nodeType === 1);
  const find = (attr) => {
    for (const n of elements) {
      if (n.hasAttribute(attr)) return n;
      const el = n.querySelector(`[${attr}]`);
      if (el) return el;
    }
    return null;
  };
  const pos = (attr) => {
    const el = find(attr);
    if (!el) return null;
    const value = el.getAttribute(attr);
    return positionAt(el, parseInt(value, 10) || 0, value.endsWith('+'));
  };
  const c = pos(MK_ATTR.c), s = pos(MK_ATTR.s), e = pos(MK_ATTR.e);
  elements.forEach(n => [n, ...n.querySelectorAll(MK_SELECTOR)].forEach(el => Object.values(MK_ATTR).forEach(a => el.removeAttribute(a))));
  const r = document.createRange();
  try {
    if (c) { r.setStart(c[0], c[1]); r.collapse(true); }
    else if (s && e) { r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]); }
    else if (s || e) { const p = s || e; r.setStart(p[0], p[1]); r.collapse(true); }
    else return false;
  } catch { return false; }
  focusEditor(editor);
  selectRange(r);
  return true;
}

// ---------------------------------------------------------------------------
// The write (one undo step, verified, with a manual fallback)
// ---------------------------------------------------------------------------

// Deep end of a node: inside its last text, before a trailing <br>
function deepEnd(node) {
  let n = node;
  while (n.nodeType === 1 && n.lastChild && n.lastChild.nodeName !== 'BR' && n.lastChild.nodeType === 1 && !isLocked(n.lastChild)) n = n.lastChild;
  if (n.nodeType === 1 && n.lastChild && n.lastChild.nodeType === 3) return [n.lastChild, n.lastChild.data.length];
  if (n.nodeType === 3) return [n, n.data.length];
  if (n.lastChild && n.lastChild.nodeName === 'BR') return [n, n.childNodes.length - 1];
  return [n, n.childNodes.length];
}

function serializeNodes(nodes) {
  const holder = document.createElement('div');
  nodes.forEach(n => holder.appendChild(n.cloneNode(true)));
  return holder.innerHTML;
}

const looseHtml = (html) => html.replace(/&nbsp;|\u00A0/g, ' ');

function cleanupSentinels(root) {
  root.querySelectorAll('[data-wr-s]').forEach(n => n.remove());
}

// Closed toggles in some nodes (and the nodes themselves)
function closedToggles(nodes) {
  const out = [];
  nodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches('.wr-toggle[data-open="false"]')) out.push(n);
    out.push(...n.querySelectorAll('.wr-toggle[data-open="false"]'));
  });
  return out;
}

// Replace first..last (siblings in flow) with html in one undo step.
// Returns { nodes, undoable } (the manual nodes on fallback) or null.
// Chrome's editing only sees rendered content: a closed toggle's hidden body
// would be left behind by the delete and dropped from the insert, so closed
// toggles are shown (data-wr-reveal, writing.css 4) while the step runs.
function writeRegion(editor, flow, first, last, html) {
  const hidden = closedToggles(siblingsBetween(first, last));
  hidden.forEach(t => t.setAttribute('data-wr-reveal', ''));
  try { return writeFramed(editor, flow, first, last, html); }
  finally { hidden.forEach(t => t.removeAttribute('data-wr-reveal')); }
}

function writeFramed(editor, flow, first, last, html) {
  const next = last.nextSibling;
  const frame = document.createElement('div');
  frame.setAttribute('data-wr-s', '');
  frame.setAttribute('data-wr-ephemeral', '');
  frame.textContent = ZWSP;
  flow.insertBefore(frame, first);
  const range = document.createRange();
  range.setStart(frame.firstChild, 1);
  const [en, eo] = deepEnd(last);
  try { range.setEnd(en, eo); } catch { range.setEndAfter(last); }
  focusEditor(editor);
  selectRange(range);
  const ok = dom.exec('insertHTML', SENTINEL + html);
  let inserted = null;
  if (ok) {
    const s = frame.nextSibling;
    if (isEl(s) && s.hasAttribute('data-wr-s') && s.parentNode === flow && (!next || next.parentNode === flow)) {
      inserted = [];
      for (let n = s.nextSibling; n && n !== next; n = n.nextSibling) inserted.push(n);
    }
  }
  frame.remove();
  cleanupSentinels(editor);
  if (inserted && looseHtml(serializeNodes(inserted)) === looseHtml(html)) return { nodes: inserted, undoable: true };
  if (ok) {
    // Chrome did something else: take its step back and do it by hand
    dom.exec('undo');
    cleanupSentinels(editor);
  }
  if (!first.isConnected || first.parentNode !== flow || !last.isConnected) return null;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.childNodes];
  closedToggles(nodes).forEach(t => t.removeAttribute('data-wr-reveal'));
  siblingsBetween(first, last).forEach((n, i) => { if (i === 0) n.replaceWith(...nodes); else n.remove(); });
  return { nodes, undoable: false };
}

// Clone a region, let fn(holder, tagged) change the copy, write it back and
// restore the selection. fn returns false to cancel. opts: { range, tags:
// { name: liveElement }, reveal }. Returns true when written.
function editRegion(ctx, region, fn, opts = {}) {
  if (!region || !region.first) return false;
  const editor = ctx.editor;
  const { flow, first, last } = region;
  const range = opts.range === undefined ? dom.getSelectionRange(editor) : opts.range;
  const before = rangeRecord(range, editor);
  // one element may carry several names (a single list item is first and last)
  const names = new Map();
  Object.entries(opts.tags || {}).forEach(([name, el]) => { if (el) names.set(el, [...(names.get(el) || []), name]); });
  names.forEach((list, el) => el.setAttribute('data-wr-t', list.join(' ')));
  let holder;
  try { holder = cloneRegion(flow, first, last, range); }
  finally { names.forEach((list, el) => el.removeAttribute('data-wr-t')); }
  const tagged = {};
  holder.querySelectorAll('[data-wr-t]').forEach(el => {
    el.getAttribute('data-wr-t').split(' ').forEach(name => { tagged[name] = el; });
    el.removeAttribute('data-wr-t');
  });
  normalizeHolder(holder);
  if (fn(holder, tagged) === false) return false;
  finalizeMarks(holder);
  closedToggles([holder]).forEach(t => t.setAttribute('data-wr-reveal', ''));
  const result = writeRegion(editor, flow, first, last, holder.innerHTML);
  if (!result) return false;
  result.nodes.forEach(n => { if (n.nodeType === 1) [n, ...n.querySelectorAll('[data-wr-reveal]')].forEach(t => t.removeAttribute('data-wr-reveal')); });
  restoreMarks(result.nodes, editor);
  if (result.undoable) {
    const list = writes.get(editor) || [];
    list.push({
      original: first,
      inserted: result.nodes.find(n => n.nodeType === 1) || result.nodes[0] || null,
      before,
      after: rangeRecord(dom.getSelectionRange(editor), editor),
      state: 'done'
    });
    if (list.length > 30) list.shift();
    writes.set(editor, list);
  }
  api.notifyChange(editor);
  if (opts.reveal !== false) revealCaret(editor);
  return true;
}

// A selection kept for undo / redo: its nodes (undo puts the very same nodes
// back) and, as a fallback, its text offsets
function rangeRecord(range, editor) {
  if (!range) return null;
  return { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset, offsets: dom.rangeToOffsets(range, editor) };
}

function rangeFromRecord(rec, editor) {
  if (!rec) return null;
  if (editor.contains(rec.sc) && editor.contains(rec.ec)) {
    try {
      const r = document.createRange();
      r.setStart(rec.sc, Math.min(rec.so, dom.nodeLength(rec.sc)));
      r.setEnd(rec.ec, Math.min(rec.eo, dom.nodeLength(rec.ec)));
      return r;
    } catch { /* fall through */ }
  }
  return rec.offsets ? dom.offsetsToRange(editor, rec.offsets) : null;
}

// An empty editor gets a real line first. A lone <br> (what Chrome leaves
// once the last character is deleted) is empty too: the caret then sits on
// the editor itself, which is no unit of any flow.
function ensureLine(ctx) {
  const editor = ctx.editor;
  if ([...editor.childNodes].some(n => (n.nodeType === 1 && n.tagName !== 'BR') || (n.nodeType === 3 && hasText(n.data)))) return ctx;
  editor.textContent = '';
  const div = emptyLine(false);
  editor.appendChild(div);
  dom.placeCaret(div, 0);
  return api.context(editor);
}

// The live range a command works on (a triple-click's spill trimmed)
function workRange(ctx) {
  return ctx.range ? dom.trimRangeEnd(ctx.range, ctx.editor) || ctx.range : null;
}

// Selection -> { flow, first, last }: the units of the deepest flow holding
// both ends (inline runs taken whole)
function selectionRegion(ctx) {
  const editor = ctx.editor;
  const r = workRange(ctx);
  if (!r) return null;
  const a = pointNode(r.startContainer, r.startOffset, false);
  const b = r.collapsed ? a : pointNode(r.endContainer, r.endOffset, true);
  if (a === editor || b === editor || !editor.contains(a) || !editor.contains(b)) {
    if (!editor.firstChild) return null;
    return { flow: editor, first: editor.firstChild, last: editor.lastChild };
  }
  let flow = flowOf(a, editor);
  while (flow !== editor && !flow.contains(b)) flow = flowOf(flow.parentNode, editor);
  const ua = unitIn(a, flow), ub = unitIn(b, flow);
  if (!ua || !ub) return null;
  return { flow, first: runStart(ua), last: runEnd(ub) };
}

// The unit of node in its own flow (its run taken whole)
function unitRegion(node, editor) {
  const flow = flowOf(node, editor);
  const u = unitIn(node, flow);
  return u ? { flow, first: runStart(u), last: runEnd(u) } : null;
}

// An element as a unit of the flow around it
function nodeRegion(el, editor) {
  if (!el || !el.parentNode) return null;
  const flow = flowOf(el.parentNode, editor);
  const u = unitIn(el, flow);
  return u ? { flow, first: u, last: u } : null;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function makeCallout(kind, children) {
  const box = document.createElement('div');
  box.className = 'wr-callout';
  box.setAttribute('data-kind', KINDS.includes(kind) ? kind : 'note');
  children.forEach(c => box.appendChild(c));
  if (!box.firstChild) box.appendChild(emptyLine(false));
  return box;
}

function makeToggle(titleNodes, bodyChildren, open = true) {
  const t = document.createElement('div');
  t.className = 'wr-toggle';
  t.setAttribute('data-open', open ? 'true' : 'false');
  const title = document.createElement('div');
  title.className = 'wr-toggle-title';
  titleNodes.forEach(n => title.appendChild(n));
  dropTrailingBr(title);
  ensureFilled(title);
  const body = document.createElement('div');
  body.className = 'wr-toggle-body';
  bodyChildren.forEach(c => body.appendChild(c));
  if (!body.firstChild) body.appendChild(emptyLine(false));
  t.append(title, body);
  return t;
}

function cleanLang(lang) {
  return String(lang || '').toLowerCase().replace(/[^a-z0-9+#._-]/g, '').slice(0, 20);
}

// segments (strings and <wr-mark>s) -> <pre class="wr-code"><code>
function makeCode(segments, lang) {
  const pre = document.createElement('pre');
  pre.className = 'wr-code';
  pre.setAttribute('data-lang', cleanLang(lang));
  pre.appendChild(codeElement(segments));
  return pre;
}

function codeElement(segments) {
  const code = document.createElement('code');
  let text = '';
  const flush = () => { if (text) { code.appendChild(document.createTextNode(text)); text = ''; } };
  segments.forEach(s => { if (typeof s === 'string') text += s; else { flush(); code.appendChild(s); } });
  flush();
  if (!code.textContent) code.appendChild(document.createElement('br'));
  return code;
}

function cell(tag) {
  const c = document.createElement(tag);
  c.appendChild(document.createElement('br'));
  return c;
}

function makeTable(rows, cols, header = true) {
  const table = document.createElement('table');
  table.className = 'wr-table';
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) tr.appendChild(cell(header && r === 0 ? 'th' : 'td'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// ---------------------------------------------------------------------------
// Text <-> code
// ---------------------------------------------------------------------------

// Code lines of some units: one line per block, list items keep a marker,
// table cells are tab-separated, <wr-mark>s carried along
function codeSegments(units) {
  const lines = [[]];
  const cur = () => lines[lines.length - 1];
  const newLine = () => lines.push([]);
  const pushText = (s) => { const t = s.replace(/[\u200B\uFEFF]/g, '').replace(/\u00A0/g, ' '); if (t) cur().push(t); };
  // a line's last <br> is its placeholder, not a line break
  const trailing = (br) => { for (let s = br.nextSibling; s; s = s.nextSibling) if (!isMark(s) && !(s.nodeType === 3 && !s.data)) return false; return true; };
  const inline = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) pushText(n.data);
      else if (isMark(n)) cur().push(n);
      else if (isEl(n, 'BR')) { if (!trailing(n)) newLine(); }
      else if (isEl(n) && (n.tagName === 'UL' || n.tagName === 'OL' || n.tagName === 'IMG')) continue;
      else if (isEl(n)) inline(n);
    }
  };
  const preText = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) n.data.split('\n').forEach((part, i) => { if (i) newLine(); pushText(part); });
      else if (isMark(n)) cur().push(n);
      else if (isEl(n, 'BR')) newLine();
      else if (isEl(n)) preText(n);
    }
  };
  const block = (el, depth) => {
    if (el.nodeType === 3) { if (hasText(el.data)) { pushText(el.data); newLine(); } return; }
    if (isMark(el)) { cur().push(el); return; }
    if (!isEl(el)) return;
    const t = el.tagName;
    if (t === 'PRE') { preText(el); newLine(); return; }
    if (t === 'UL' || t === 'OL') {
      let num = 1;
      [...el.children].forEach(li => {
        if (li.tagName !== 'LI') return;
        const mark = el.classList.contains('checklist') ? (li.classList.contains('checked') ? '[x] ' : '[ ] ') : t === 'OL' ? `${num++}. ` : '- ';
        cur().push('  '.repeat(depth) + mark);
        inline(li);
        newLine();
        [...li.children].forEach(c => { if (c.tagName === 'UL' || c.tagName === 'OL') block(c, depth + 1); });
      });
      return;
    }
    if (t === 'TABLE') {
      el.querySelectorAll('tr').forEach(tr => {
        [...tr.children].forEach((c, i) => { if (i) cur().push('\t'); inline(c); });
        newLine();
      });
      return;
    }
    if (t === 'HR') { cur().push('---'); newLine(); return; }
    if (!isLineEl(el)) { [...el.childNodes].forEach(c => block(c, depth)); return; }
    inline(el);
    newLine();
  };
  units.forEach(u => block(u, 0));
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  const segs = [];
  lines.forEach((line, i) => { if (i) segs.push('\n'); segs.push(...line); });
  return segs;
}

// Code text -> line arrays of segments (a trailing newline is the caret
// placeholder, not a line)
function codeLines(pre) {
  const lines = [[]];
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        n.data.split('\n').forEach((part, i) => {
          if (i) lines.push([]);
          const t = part.replace(/[\u200B\uFEFF]/g, '');
          if (t) lines[lines.length - 1].push(t);
        });
      } else if (isMark(n)) lines[lines.length - 1].push(n);
      else if (isEl(n, 'BR')) lines.push([]);
      else if (isEl(n)) walk(n);
    }
  };
  walk(pre);
  if (lines.length > 1 && !lines[lines.length - 1].some(s => typeof s === 'string')) {
    const tail = lines.pop();
    lines[lines.length - 1].push(...tail);
  }
  return lines;
}

function linesToSegments(lines) {
  const segs = [];
  lines.forEach((line, i) => { if (i) segs.push('\n'); segs.push(...line); });
  return segs;
}

// Code -> text lines (spaces kept visible with NBSPs), markers carried along
function codeToLines(pre) {
  return codeLines(pre).map(segs => {
    const div = document.createElement('div');
    segs.forEach(s => {
      if (typeof s !== 'string') { div.appendChild(s); return; }
      div.appendChild(document.createTextNode(s.replace(/\t/g, '    ').replace(/ (?= )/g, '\u00A0').replace(/^ /, '\u00A0')));
    });
    return ensureFilled(div);
  });
}

// ---------------------------------------------------------------------------
// Lists: an item turned into a heading / text leaves its list, which is cut
// around it. Only items of a list that sits directly in a flow; deeper items
// fall back to the browser's own unlist (two undo steps).
// ---------------------------------------------------------------------------
function splitList(list, isSel, convert) {
  const out = [];
  let cur = null;
  const fresh = () => {
    const l = document.createElement(list.tagName.toLowerCase());
    if (list.className) l.className = list.className;
    return l;
  };
  [...list.childNodes].forEach(li => {
    if (!isEl(li, 'LI')) { if (cur) cur.appendChild(li); else li.remove(); return; }
    if (isSel(li)) {
      cur = null;
      const subs = [...li.children].filter(c => c.tagName === 'UL' || c.tagName === 'OL');
      out.push(convert(li));
      out.push(...subs);
    } else {
      if (!cur) { cur = fresh(); out.push(cur); }
      cur.appendChild(li);
    }
  });
  return out;
}

const nestedItems = (lines) => lines.some(l => l.tagName === 'LI' && l.parentElement && l.parentElement.closest('li'));

// Turn the given lines of the holder into `tag` ('div' for text)
function convertLines(holder, lines, tag) {
  const lists = new Set();
  lines.forEach(line => {
    if (line.tagName === 'LI') { lists.add(line.parentElement); return; }
    if (['TD', 'TH', 'PRE'].includes(line.tagName) || line.classList.contains('wr-toggle-title')) return;
    if (line.tagName === tag.toUpperCase() && !line.attributes.length) return;
    line.replaceWith(retag(line, tag));
  });
  lists.forEach(list => {
    if (!holder.contains(list)) return;
    list.replaceWith(...splitList(list, li => lines.includes(li), li => retag(li, tag)));
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
// Typed markdown (input rules) sets a block type; it never toggles one off
const typedSource = (arg) => !!arg && /rule|input|markdown|typed|auto/i.test(String(arg.source || ''));

function liveSelectedLines(ctx) {
  const editor = ctx.editor;
  const r = workRange(ctx);
  const sLine = lineOf(pointNode(r.startContainer, r.startOffset, false), editor);
  if (r.collapsed) return sLine ? [sLine] : [];
  const eLine = lineOf(pointNode(r.endContainer, r.endOffset, true), editor);
  return linesIn(editor).filter(l => {
    if (l === sLine || l === eLine) return true;
    try { return r.intersectsNode(l) && !(sLine && l.contains(sLine)); } catch { return false; }
  });
}

function codeAt(ctx) {
  return ctx.range ? dom.closestIn(ctx.node, 'pre', ctx.editor) : null;
}
function cellAt(ctx) {
  return ctx.range ? dom.closestIn(ctx.node, 'td, th', ctx.editor) : null;
}

// Nested list items: the browser takes them out of the list (2 undo steps)
function legacyLineCommand(ctx, tag) {
  const li = dom.listItemOf(ctx.node, ctx.editor);
  if (li) dom.exec(li.parentElement.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
  if (tag !== 'div') dom.exec('formatBlock', tag);
  return true;
}

function headingCommand(level) {
  const tag = 'h' + level;
  const skip = (l) => ['TD', 'TH', 'PRE'].includes(l.tagName) || l.classList.contains('wr-toggle-title');
  return {
    run(ctx, arg) {
      if (!ctx.range) return false;
      ctx = ensureLine(ctx);
      const pre = codeAt(ctx);
      if (pre) {
        // Code -> text lines; the selected ones become the heading
        return editRegion(ctx, nodeRegion(pre, ctx.editor), (holder) => {
          const p = holder.querySelector('pre');
          p.replaceWith(...codeToLines(p));
          convertLines(holder, selectedLines(holder), tag);
        });
      }
      const live = liveSelectedLines(ctx).filter(l => !skip(l));
      if (nestedItems(live)) return legacyLineCommand(ctx, live.every(l => l.tagName === tag.toUpperCase()) ? 'div' : tag);
      // decided on the copy, where a bare first line is a <div> too
      editRegion(ctx, selectionRegion(ctx), (holder) => {
        const lines = selectedLines(holder).filter(l => !skip(l));
        if (!lines.length) return false;
        const all = lines.every(l => l.tagName === tag.toUpperCase());
        if (all && typedSource(arg)) return false;
        convertLines(holder, lines, all ? 'div' : tag);
      });
      return true;
    },
    isActive: (ctx) => api.blockKind(ctx) === tag
  };
}

// The box holding a node: innermost quote / callout / toggle / code block
function boxOf(node, editor) {
  let el = dom.elementOf(node);
  while (el && el !== editor) {
    if (el.tagName === 'PRE') return { kind: 'code', el };
    if (el.tagName === 'BLOCKQUOTE') return { kind: 'quote', el };
    if (el.classList.contains('wr-callout')) return { kind: 'callout', el };
    if (el.classList.contains('wr-toggle')) return { kind: 'toggle', el };
    if (el.tagName === 'TD' || el.tagName === 'TH') return null;
    el = el.parentElement;
  }
  return null;
}

// Callout / toggle / quote -> its lines, code -> text lines (top level of the holder)
function unwrapBoxes(holder, kind) {
  if (kind === 'code') {
    holder.querySelectorAll(':scope > pre').forEach(p => p.replaceWith(...codeToLines(p)));
  } else if (kind === 'toggle') {
    holder.querySelectorAll(':scope > .wr-toggle').forEach(t => {
      const title = t.querySelector(':scope > .wr-toggle-title');
      const body = t.querySelector(':scope > .wr-toggle-body');
      const out = [];
      if (title) out.push(retag(title, 'div'));
      if (body) out.push(...body.childNodes);
      t.replaceWith(...out);
    });
  } else {
    holder.querySelectorAll(kind === 'quote' ? ':scope > blockquote' : ':scope > .wr-callout').forEach(box => {
      const kids = [...box.childNodes];
      box.replaceWith(...(kids.length ? kids : [emptyLine(false)]));
    });
  }
}

// Selected lines leave the quotes they are in: each quote is cut around them
function liftQuotes(holder) {
  const lines = selectedLines(holder);
  [...holder.querySelectorAll('blockquote')].reverse().forEach(quote => {
    if (!lines.some(l => quote.contains(l) || l === quote)) return;
    const out = [];
    let cur = null;
    [...quote.childNodes].forEach(child => {
      const lifted = lines.some(l => l === child || (child.nodeType === 1 && child.contains(l)));
      if (lifted) { cur = null; out.push(child); }
      else {
        if (!cur) { cur = document.createElement('blockquote'); out.push(cur); }
        cur.appendChild(child);
      }
    });
    quote.replaceWith(...out);
  });
}

// The region for lifting lines out of quotes: a selection inside one quote
// takes that whole quote
function quoteRegion(ctx) {
  const editor = ctx.editor;
  const region = selectionRegion(ctx);
  if (!region) return null;
  let flow = region.flow;
  if (flow === editor) return region;
  let box = flow;
  while (box !== editor && box.tagName !== 'BLOCKQUOTE') box = flowOf(box.parentNode, editor);
  return box === editor ? region : nodeRegion(box, editor);
}

const paragraphCommand = {
  run(ctx) {
    if (!ctx.range) return false;
    ctx = ensureLine(ctx);
    const editor = ctx.editor;
    if (cellAt(ctx)) return true;
    const lines = liveSelectedLines(ctx);
    if (lines.some(isHeading)) {
      return editRegion(ctx, selectionRegion(ctx), (holder) => convertLines(holder, selectedLines(holder).filter(isHeading), 'div'));
    }
    const items = lines.filter(l => l.tagName === 'LI');
    if (items.length) {
      if (nestedItems(items)) return legacyLineCommand(ctx, 'div');
      return editRegion(ctx, selectionRegion(ctx), (holder) => convertLines(holder, selectedLines(holder).filter(l => l.tagName === 'LI'), 'div'));
    }
    const box = boxOf(ctx.node, editor);
    if (!box) return true;
    if (box.kind === 'quote') return editRegion(ctx, quoteRegion(ctx), liftQuotes);
    return editRegion(ctx, nodeRegion(box.el, editor), (holder) => unwrapBoxes(holder, box.kind));
  },
  isActive: (ctx) => api.blockKind(ctx) === 'text'
};

const quoteCommand = {
  run(ctx, arg) {
    if (!ctx.range) return false;
    ctx = ensureLine(ctx);
    const editor = ctx.editor;
    if (codeAt(ctx) || cellAt(ctx)) return true;
    const lines = liveSelectedLines(ctx);
    const quoted = lines.length && lines.every(l => dom.closestIn(l, 'blockquote', editor));
    if (quoted) {
      if (typedSource(arg)) return true;
      return editRegion(ctx, quoteRegion(ctx), liftQuotes);
    }
    if (nestedItems(lines)) return legacyLineCommand(ctx, 'blockquote');
    return editRegion(ctx, selectionRegion(ctx), (holder) => {
      // Consecutive lines / lists (and quotes, merged) go into one quote;
      // callouts, toggles, code, tables and dividers stay as they are
      const out = [];
      let cur = null;
      // plain wrappers draw nothing: their blocks are quoted like the others
      [...holder.childNodes].flatMap(n => isWrapperEl(n) ? [...n.childNodes] : [n]).forEach(n => {
        const quotable = isEl(n) && (isLineEl(n) || n.tagName === 'UL' || n.tagName === 'OL' || n.tagName === 'BLOCKQUOTE') &&
          !['PRE', 'TD', 'TH'].includes(n.tagName) && !n.classList.contains('wr-toggle-title');
        if (!quotable) { cur = null; out.push(n); return; }
        if (!cur) { cur = document.createElement('blockquote'); out.push(cur); }
        if (n.tagName === 'BLOCKQUOTE') cur.append(...n.childNodes);
        else cur.appendChild(n);
      });
      holder.replaceChildren(...out);
    });
  },
  isActive: (ctx) => !!(ctx.range && dom.closestIn(ctx.node, 'blockquote', ctx.editor)),
  // a toggle title holds one line of text: no quote there (the slash menu leaves it out)
  isAvailable: (ctx) => !inToggleTitle(ctx)
};

function inToggleTitle(ctx) {
  return !!(ctx && ctx.range && ctx.editor && dom.closestIn(ctx.node, '.wr-toggle-title', ctx.editor));
}

function calloutCommand(id) {
  const fixedKind = KIND_OF_COMMAND[id];
  return {
    run(ctx, arg) {
      if (!ctx.range) return false;
      ctx = ensureLine(ctx);
      const editor = ctx.editor;
      const kind = KINDS.includes(arg && arg.kind) ? arg.kind : fixedKind;
      const region = selectionRegion(ctx);
      if (!region) return false;
      // Inside a callout: another kind switches it, the same kind takes it
      // away (typed markdown never does)
      const inside = region.flow !== editor ? region.flow.closest('.wr-callout') : null;
      if (inside && editor.contains(inside)) {
        const same = (inside.getAttribute('data-kind') || 'note') === kind;
        if (same && typedSource(arg)) return true;
        return editRegion(ctx, nodeRegion(inside, editor), (holder) => {
          const box = holder.querySelector(':scope > .wr-callout');
          if (!box) return false;
          if (same) unwrapBoxes(holder, 'callout');
          else box.setAttribute('data-kind', kind);
        });
      }
      return editRegion(ctx, region, (holder) => {
        // Callouts inside the selection are flattened into the new one
        const kids = [];
        [...holder.childNodes].forEach(n => {
          if (isEl(n) && n.classList.contains('wr-callout')) kids.push(...n.childNodes);
          else kids.push(n);
        });
        holder.replaceChildren(makeCallout(kind, kids));
      });
    },
    isActive: (ctx) => {
      const box = ctx.range && dom.closestIn(ctx.node, '.wr-callout', ctx.editor);
      return !!box && (id === 'callout' || box.getAttribute('data-kind') === fixedKind);
    },
    isAvailable: (ctx) => ctx.tier === 'full'
  };
}

const toggleCommand = {
  run(ctx, arg) {
    if (!ctx.range) return false;
    ctx = ensureLine(ctx);
    const editor = ctx.editor;
    // In a toggle's title: the toggle goes (its title and body stay as lines)
    const title = dom.closestIn(ctx.node, '.wr-toggle-title', editor);
    if (title && title.parentElement.classList.contains('wr-toggle')) {
      if (typedSource(arg)) return true;
      return editRegion(ctx, nodeRegion(title.parentElement, editor), (holder) => unwrapBoxes(holder, 'toggle'));
    }
    // Elsewhere (a toggle body too): the selected blocks fold into a new
    // toggle; a first plain line or heading becomes its title
    return editRegion(ctx, selectionRegion(ctx), (holder) => {
      const units = [...holder.childNodes];
      let titleNodes = [];
      const first = units[0];
      if (first && (isPlainLine(first) || isHeading(first))) { units.shift(); titleNodes = inlineChildren(first); }
      if (!titleNodes.length || !titleNodes.some(n => !isEl(n, 'BR'))) {
        // an empty title takes the caret
        if (!titleNodes.some(isMark)) { dropMarks(holder); titleNodes = [makeMark('c')]; }
      }
      holder.replaceChildren(makeToggle(titleNodes, units, true));
    });
  },
  isActive: (ctx) => !!(ctx.range && dom.closestIn(ctx.node, '.wr-toggle', ctx.editor)),
  isAvailable: (ctx) => ctx.tier === 'full'
};

const codeBlockCommand = {
  run(ctx, arg) {
    if (!ctx.range) return false;
    if (ctx.tier !== 'full') {
      // LITE has no code blocks: Ctrl+E across lines (the core hands it here)
      // keeps the core's hint instead of falling through to the browser
      if (arg && arg.source === 'inlineCode') { api.toast('Inline code works within one line'); return true; }
      return false;
    }
    ctx = ensureLine(ctx);
    const editor = ctx.editor;
    const pre = codeAt(ctx);
    if (pre) {
      if (typedSource(arg)) return true;
      return editRegion(ctx, nodeRegion(pre, editor), (holder) => unwrapBoxes(holder, 'code'));
    }
    if (cellAt(ctx)) return insertAfterUnit(ctx, () => [makeCode([makeMark('c')], arg && arg.lang)], {});
    return editRegion(ctx, selectionRegion(ctx), (holder) => {
      holder.replaceChildren(makeCode(codeSegments([...holder.childNodes]), arg && arg.lang));
    });
  },
  isActive: (ctx) => !!codeAt(ctx)
};

// Insert block(s) after the caret's unit, or in place of an empty line.
// make() returns the nodes (a <wr-mark> in them takes the caret). A line to
// type in follows when nothing writable would come next.
function insertAfterUnit(ctx, make, opts) {
  ctx = ensureLine(ctx);
  const editor = ctx.editor;
  let anchor = ctx.node || dom.anchorNode(ctx.range);
  if (anchor === editor) {
    // the caret on the editor itself (before a bare <br>): that child's unit
    const kids = editor.childNodes;
    const r = ctx.range;
    anchor = r && r.startContainer === editor ? kids[Math.min(r.startOffset, kids.length - 1)] : editor.lastChild;
    if (!anchor) return false;
  }
  const box = dom.closestIn(anchor, 'table, pre', editor);
  const region = box ? nodeRegion(box, editor) : unitRegion(anchor, editor);
  if (!region) return false;
  const replace = !box && isBlankUnit(region);
  const after = nextBlock(region.last);
  const writableAfter = after && isEl(after) && (isLineEl(after) || after.tagName === 'UL' || after.tagName === 'OL') && !after.classList.contains('wr-toggle-title');
  let caretNext = false;
  const ok = editRegion(ctx, region, (holder) => {
    const made = make();
    if (!made || !made.length) return false;
    if (replace) holder.replaceChildren(...made);
    else { dropMarks(holder); holder.append(...made); }
    if (!marksIn(holder).length) {
      if (writableAfter) caretNext = true;
      else holder.appendChild(emptyLine(true));
    } else if (!writableAfter && opts.lineAfter) {
      holder.appendChild(emptyLine(false));
    }
  });
  if (ok && caretNext && after.isConnected) caretInto(isLineEl(after) ? after : (linesIn(after)[0] || after), false);
  return ok;
}

const dividerCommand = {
  run(ctx) {
    if (!ctx.range || codeAt(ctx)) return false;
    return insertAfterUnit(ctx, () => [document.createElement('hr')], {});
  }
};

const tableCommand = {
  run(ctx, arg) {
    if (!ctx.range) return false;
    const a = arg || {};
    let rows = parseInt(a.rows, 10), cols = parseInt(a.cols, 10);
    if (typeof a.size === 'string') {
      const m = a.size.match(/(\d+)\s*[x×*]\s*(\d+)/i);
      if (m) { cols = parseInt(m[1], 10); rows = parseInt(m[2], 10); }
    }
    rows = Math.min(30, Math.max(1, rows || 3));
    cols = Math.min(10, Math.max(1, cols || 3));
    return insertAfterUnit(ctx, () => {
      const table = makeTable(rows, cols, a.header !== false);
      const first = table.querySelector('th, td');
      first.insertBefore(makeMark('c'), first.firstChild);
      return [table];
    }, { lineAfter: true });
  },
  isAvailable: (ctx) => ctx.tier === 'full'
};

// Open / close a toggle. In views the state is the reader's only
// (data-wr-open, stripped from saved HTML); in editors it is saved.
function flipToggle(toggle, editor, view) {
  if (view) {
    const cur = toggle.getAttribute('data-wr-open') || toggle.getAttribute('data-open') || 'true';
    toggle.setAttribute('data-wr-open', cur === 'false' ? 'true' : 'false');
    return;
  }
  const open = toggle.getAttribute('data-open') !== 'false';
  toggle.setAttribute('data-open', open ? 'false' : 'true');
  if (open && editor) {
    // closing with the caret inside the body: the caret goes to the title
    const range = dom.getSelectionRange(editor);
    const body = toggle.querySelector(':scope > .wr-toggle-body');
    if (range && body && body.contains(range.startContainer)) caretInto(toggle.querySelector(':scope > .wr-toggle-title'), true);
  }
  if (editor) api.notifyChange(editor);
}

// Ctrl+Enter: checklist items (the core rule) and toggles
const toggleCheckCommand = {
  run(ctx) {
    if (dom.isInChecklistItem(ctx.node, ctx.editor)) {
      dom.listItemOf(ctx.node, ctx.editor).classList.toggle('checked');
      api.notifyChange(ctx.editor);
      return true;
    }
    const toggle = dom.closestIn(ctx.node, '.wr-toggle', ctx.editor);
    if (!toggle) return false;
    flipToggle(toggle, ctx.editor, false);
    return true;
  },
  isAvailable: (ctx) => !!(ctx.range && (dom.isInChecklistItem(ctx.node, ctx.editor) || dom.closestIn(ctx.node, '.wr-toggle', ctx.editor)))
};

// --- Move / duplicate ---------------------------------------------------------

// The selected list items, when the selection stays inside one list
function selectedItems(ctx) {
  const editor = ctx.editor;
  const r = workRange(ctx);
  const a = dom.listItemOf(pointNode(r.startContainer, r.startOffset, false), editor);
  const b = r.collapsed ? a : dom.listItemOf(pointNode(r.endContainer, r.endOffset, true), editor);
  if (!a || !b) return null;
  const up = (li) => { const p = li.parentElement && li.parentElement.closest('li'); return p && editor.contains(p) ? p : null; };
  const depth = (li) => { let d = 0; for (let p = li; p; p = up(p)) d++; return d; };
  let x = a, y = b;
  while (x && y && depth(x) > depth(y)) x = up(x);
  while (x && y && depth(y) > depth(x)) y = up(y);
  while (x && y && x.parentElement !== y.parentElement) { x = up(x); y = up(y); }
  if (!x || !y) return null;
  const list = x.parentElement;
  const items = [...list.children];
  const i = items.indexOf(x), j = items.indexOf(y);
  return { list, items: items.slice(Math.min(i, j), Math.max(i, j) + 1) };
}

// The outermost list holding a list, as a unit of its flow
function outerList(list, editor) {
  let top = list;
  for (let up = top.parentElement && top.parentElement.closest('ul, ol'); up && editor.contains(up); up = up.parentElement && up.parentElement.closest('ul, ol')) top = up;
  return top;
}

function moveItems(ctx, sel, dir) {
  const editor = ctx.editor;
  const first = sel.items[0], last = sel.items[sel.items.length - 1];
  const sibling = dir < 0 ? first.previousElementSibling : last.nextElementSibling;
  if (!sibling) return true;
  return editRegion(ctx, nodeRegion(outerList(sel.list, editor), editor), (holder, t) => {
    if (!t.sib || !t.first || !t.last) return false;
    if (dir < 0) t.last.after(t.sib); else t.first.before(t.sib);
  }, { tags: { sib: sibling, first, last } });
}

function duplicateItems(ctx, sel) {
  const editor = ctx.editor;
  const first = sel.items[0], last = sel.items[sel.items.length - 1];
  return editRegion(ctx, nodeRegion(outerList(sel.list, editor), editor), (holder, t) => {
    if (!t.first || !t.last) return false;
    const items = siblingsBetween(t.first, t.last).filter(n => isEl(n, 'LI'));
    const copies = items.map(n => cleanCopy(n.cloneNode(true)));
    items.forEach(dropMarks);
    t.last.after(...copies);
  }, { tags: { first, last } });
}

// A duplicate carries no upload token (the upload finishes on the original)
function cleanCopy(node) {
  if (node.nodeType !== 1) return node;
  [node, ...node.querySelectorAll('[data-r2-uploading]')].forEach(el => el.removeAttribute('data-r2-uploading'));
  return node;
}

function rowsOf(table) {
  return [...table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr')];
}
function hasHeaderRow(table) {
  const first = rowsOf(table)[0];
  return !!first && first.children.length > 0 && [...first.children].every(c => c.tagName === 'TH');
}

function moveRow(ctx, cellEl, dir) {
  const table = cellEl.closest('table');
  const rows = rowsOf(table);
  const tr = cellEl.parentElement;
  const i = rows.indexOf(tr), j = i + dir;
  if (j < 0 || j >= rows.length || (hasHeaderRow(table) && (i === 0 || j === 0))) return true;
  return editRegion(ctx, nodeRegion(table, ctx.editor), (holder, t) => {
    if (!t.row || !t.other) return false;
    if (dir < 0) t.row.after(t.other); else t.row.before(t.other);
  }, { tags: { row: tr, other: rows[j] } });
}

function duplicateRow(ctx, cellEl) {
  const table = cellEl.closest('table');
  return editRegion(ctx, nodeRegion(table, ctx.editor), (holder, t) => {
    if (!t.row) return false;
    const copy = cleanCopy(t.row.cloneNode(true));
    dropMarks(t.row);
    // a copy of the header row is a body row
    copy.querySelectorAll('th').forEach(th => { const td = document.createElement('td'); td.append(...th.childNodes); th.replaceWith(td); });
    t.row.after(copy);
  }, { tags: { row: cellEl.parentElement } });
}

// Blocks: the selected units of their flow move over the neighbouring
// block; at the edge of a callout / quote / toggle body they move out of it
function moveBlocks(ctx, dir) {
  const editor = ctx.editor;
  let region = selectionRegion(ctx);
  if (!region) return false;
  // a box whose whole content is selected moves as one
  while (region && region.flow !== editor && !prevBlock(region.first) && !nextBlock(region.last)) region = nodeRegion(containerOf(region.flow), editor);
  if (!region) return false;
  const { flow, first, last } = region;
  const neighbour = dir < 0 ? prevBlock(first) : nextBlock(last);
  if (neighbour) {
    const n = isInline(neighbour) ? (dir < 0 ? runStart(neighbour) : runEnd(neighbour)) : neighbour;
    // [neighbour][selection] -> [selection][neighbour] (and the other way)
    return editRegion(ctx, dir < 0 ? { flow, first: n, last } : { flow, first, last: n }, (holder) => {
      if (dir < 0) holder.appendChild(holder.firstChild);
      else holder.insertBefore(holder.lastChild, holder.firstChild);
    });
  }
  if (flow === editor) return true;
  if (isWrapperEl(flow)) {
    // a plain wrapper draws nothing: out of it AND over the block beside it
    const outer = nodeRegion(flow, editor);
    const nb = outer && (dir < 0 ? prevBlock(outer.first) : nextBlock(outer.last));
    if (!outer || (!nb && outer.flow === editor)) return true;
    if (nb) {
      const n = isInline(nb) ? (dir < 0 ? runStart(nb) : runEnd(nb)) : nb;
      return editRegion(ctx, dir < 0 ? { flow: outer.flow, first: n, last: flow } : { flow: outer.flow, first: flow, last: n }, (holder, t) => {
        const moving = t.flow ? markedChildren(t.flow) : [];
        if (!moving.length) return false;
        if (dir < 0) holder.firstChild.before(...moving); else holder.lastChild.after(...moving);
        if (!t.flow.firstChild) t.flow.remove();
      }, { tags: { flow } });
    }
  }
  // out of the box: before it (up) or after it (down)
  const box = containerOf(flow);
  return editRegion(ctx, nodeRegion(box, editor), (holder, t) => {
    const f = t.flow || holder.firstChild;
    const b = holder.firstChild;
    const moving = markedChildren(f);
    if (!moving.length || !b) return false;
    if (dir < 0) b.before(...moving); else b.after(...moving);
    if (!f.firstChild) f.appendChild(emptyLine(false));
  }, { tags: { flow } });
}

function duplicateBlocks(ctx) {
  return editRegion(ctx, selectionRegion(ctx), (holder) => {
    const units = [...holder.childNodes];
    const copies = units.map(n => cleanCopy(n.cloneNode(true)));
    units.forEach(u => { if (u.nodeType === 1) dropMarks(u); });
    holder.append(...copies);
  });
}

function moveCommand(dir) {
  return {
    run(ctx) {
      if (!ctx.range) return false;
      ctx = ensureLine(ctx);
      const pre = codeAt(ctx);
      if (pre && pre.contains(ctx.range.endContainer)) return moveCodeLines(ctx, pre, dir);
      const c = cellAt(ctx);
      if (c) return moveRow(ctx, c, dir);
      const items = selectedItems(ctx);
      if (items) return moveItems(ctx, items, dir);
      return moveBlocks(ctx, dir);
    }
  };
}

const duplicateCommand = {
  run(ctx) {
    if (!ctx.range) return false;
    ctx = ensureLine(ctx);
    const pre = codeAt(ctx);
    if (pre && pre.contains(ctx.range.endContainer)) return duplicateCodeLines(ctx, pre);
    const c = cellAt(ctx);
    if (c) return duplicateRow(ctx, c);
    const items = selectedItems(ctx);
    if (items) return duplicateItems(ctx, items);
    return duplicateBlocks(ctx);
  }
};

// ---------------------------------------------------------------------------
// Keys inside blocks (api.hooks.keydown, after the popup menus)
// ---------------------------------------------------------------------------

// Nothing but ZWSP (no pill / image / <br>) between the line start and the caret
function atLineStart(range, line) {
  if (!range || !range.collapsed || !line) return false;
  const r = document.createRange();
  r.selectNodeContents(line);
  try { r.setEnd(range.startContainer, range.startOffset); } catch { return false; }
  if (r.toString().replace(/[\u200B\uFEFF]/g, '')) return false;
  return !r.cloneContents().querySelector('img, [contenteditable="false"], br, hr');
}

function atLineEnd(range, line) {
  if (!range || !range.collapsed || !line) return false;
  const r = document.createRange();
  r.selectNodeContents(line);
  try { r.setStart(range.startContainer, range.startOffset); } catch { return false; }
  if (r.toString().replace(/[\u200B\uFEFF]/g, '')) return false;
  return !r.cloneContents().querySelector('img, [contenteditable="false"]');
}

// Code text before / after the selection inside the <pre> (<br> = newline)
function codeSides(range, pre) {
  const text = (r) => {
    const f = r.cloneContents();
    f.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    return f.textContent.replace(/[\u200B\uFEFF]/g, '');
  };
  const before = document.createRange();
  before.selectNodeContents(pre);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(pre);
  after.setStart(range.endContainer, range.endOffset);
  return { before: text(before), after: text(after) };
}

function codeKey(e, ctx, pre) {
  const editor = ctx.editor;
  const range = ctx.range;
  const k = e.key;
  if (k === 'Enter') {
    const { before, after } = codeSides(range, pre);
    const atEnd = after === '' || after === '\n';
    if (!e.shiftKey && range.collapsed && atEnd && before.endsWith('\n')) {
      // Enter on an empty last line: leave the code block
      editRegion(ctx, nodeRegion(pre, editor), (holder) => {
        const p = holder.querySelector('pre');
        dropMarks(p);
        const lines = codeLines(p).map(l => l.join(''));
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        if (!lines.length) { p.replaceWith(emptyLine(true)); return; }
        p.replaceChildren(codeElement([lines.join('\n')]));
        p.after(emptyLine(true));
      });
      return true;
    }
    if (!range.collapsed) dom.exec('delete');
    if (atEnd) {
      // a second newline keeps the new last line visible (Chrome drops it
      // as soon as something is typed there)
      dom.insertHTML(after === '\n' ? '\n' : '\n\n');
      const r = dom.getSelectionRange(editor);
      if (after !== '\n' && r && r.startContainer.nodeType === 3 && r.startContainer.data.slice(r.startOffset - 2, r.startOffset) === '\n\n') {
        const c = document.createRange();
        c.setStart(r.startContainer, r.startOffset - 1);
        c.collapse(true);
        selectRange(c);
      }
    } else {
      dom.insertHTML('\n');
    }
    return true;
  }
  if (k === 'Tab') {
    if (!e.shiftKey && range.collapsed) { dom.insertText('  '); return true; }
    codeIndent(ctx, pre, e.shiftKey);
    return true;
  }
  if (k === 'Backspace' && range.collapsed) {
    const { before, after } = codeSides(range, pre);
    if (before !== '') return false;
    // at the very start: an empty code block goes, a full one turns into text
    return editRegion(ctx, nodeRegion(pre, editor), (holder) => {
      if (!after.replace(/\n/g, '')) holder.replaceChildren(emptyLine(true));
      else unwrapBoxes(holder, 'code');
    });
  }
  if ((k === 'ArrowDown' || k === 'ArrowUp') && !e.shiftKey) return arrowOut(e, ctx, pre);
  return false;
}

// The code lines the selection covers: [first, last] (a selection ending at
// the very start of a line leaves that line out), or null
function markedLines(lines) {
  const sIdx = lines.findIndex(l => l.some(s => isMark(s) && s.getAttribute('data-k') !== 'e'));
  let eIdx = lines.findIndex(l => l.some(s => isMark(s) && s.getAttribute('data-k') === 'e'));
  if (sIdx < 0) return null;
  if (eIdx < 0) eIdx = sIdx;
  if (eIdx > sIdx && isMark(lines[eIdx][0]) && lines[eIdx][0].getAttribute('data-k') === 'e') eIdx--;
  return [sIdx, eIdx];
}

// Rewrite a code block's lines (fn(lines) changes the array; false = no change)
function editCode(ctx, pre, fn) {
  return editRegion(ctx, nodeRegion(pre, ctx.editor), (holder) => {
    const p = holder.querySelector('pre');
    const lines = codeLines(p);
    const span = markedLines(lines);
    if (!span || fn(lines, span) === false) return false;
    const lang = p.getAttribute('data-lang') || '';
    p.replaceChildren(codeElement(linesToSegments(lines)));
    p.setAttribute('data-lang', lang);
  }, { reveal: false });
}

// Alt+Shift+Up / Down in code: the selected lines move (at the edge, the
// whole code block moves); Ctrl+D: they are copied below, caret in the copy
function moveCodeLines(ctx, pre, dir) {
  const count = codeLines(pre.cloneNode(true)).length;
  const { before } = codeSides(ctx.range, pre);
  const f = ctx.range.cloneContents();
  f.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  const picked = f.textContent.replace(/\n$/, '');
  const first = before.split('\n').length - 1;
  const last = first + picked.split('\n').length - 1;
  if ((dir < 0 && first === 0) || (dir > 0 && last >= count - 1)) return moveBlocks(ctx, dir);
  return editCode(ctx, pre, (ls, [s, e]) => {
    if (dir < 0) ls.splice(e, 0, ls.splice(s - 1, 1)[0]);
    else ls.splice(s, 0, ls.splice(e + 1, 1)[0]);
  });
}

function duplicateCodeLines(ctx, pre) {
  return editCode(ctx, pre, (ls, [s, e]) => {
    const copies = ls.slice(s, e + 1);
    const plain = copies.map(l => l.filter(seg => typeof seg === 'string'));
    ls.splice(s, e - s + 1, ...plain, ...copies);
  });
}

// Tab / Shift+Tab over selected code lines: two spaces in / out, one step
function codeIndent(ctx, pre, out) {
  editCode(ctx, pre, (lines, [sIdx, eIdx]) => {
    let changed = false;
    for (let i = sIdx; i <= eIdx; i++) {
      const line = lines[i];
      if (!out) { line.unshift('  '); changed = true; continue; }
      // drop up to two leading spaces, or one tab (markers before them stay)
      let left = 2;
      for (let k = 0; k < line.length && left > 0; k++) {
        const s = line[k];
        if (typeof s !== 'string') continue;
        const lead = s.match(/^[ \t]*/)[0];
        if (!lead) break;
        const cut = lead[0] === '\t' ? 1 : Math.min(left, lead.length);
        line[k] = s.slice(cut);
        left = lead[0] === '\t' ? 0 : left - cut;
        changed = true;
        if (line[k]) break;
      }
    }
    return changed;
  });
}

// The block's last (first) line the caret can reach
function edgeLine(block, down) {
  if (block.classList.contains('wr-toggle') && block.getAttribute('data-open') === 'false') return block.querySelector(':scope > .wr-toggle-title');
  const lines = linesIn(block).filter(l => l.getClientRects().length);
  return down ? lines[lines.length - 1] : lines[0];
}

// ArrowDown on the last line of a box that ends the editor (or its own box),
// ArrowUp on the first line of a box that starts the editor: a new line to
// write in, outside the box
function arrowOut(e, ctx, block) {
  const editor = ctx.editor;
  const range = ctx.range;
  if (!range.collapsed) return false;
  const down = e.key === 'ArrowDown';
  let region = nodeRegion(block, editor);
  if (!region) return false;
  // at the edge of a plain wrapper, what comes after (before) the wrapper counts
  while (region && region.flow !== editor && isWrapperEl(region.flow) && !(down ? nextBlock(region.last) : prevBlock(region.first))) region = nodeRegion(region.flow, editor);
  if (!region) return false;
  if (down ? nextBlock(region.last) : prevBlock(region.first)) return false;
  if (!down && region.flow !== editor) return false;
  if (block.tagName === 'PRE') {
    const { before, after } = codeSides(range, block);
    if (down ? after.replace(/\n$/, '').includes('\n') : before.includes('\n')) return false;
  } else {
    const line = lineOf(ctx.node, editor);
    if (!line || line !== edgeLine(block, down)) return false;
    const rect = dom.caretRect(range, editor);
    const lr = line.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(line).lineHeight) || 20;
    if (!rect || (down ? rect.bottom < lr.bottom - lh * 0.75 : rect.top > lr.top + lh * 0.75)) return false;
  }
  return editRegion(ctx, region, (holder) => {
    dropMarks(holder);
    if (down) holder.appendChild(emptyLine(true));
    else holder.insertBefore(emptyLine(true), holder.firstChild);
  });
}

function tableKey(e, ctx, cellEl) {
  const editor = ctx.editor;
  const table = cellEl.closest('table');
  if (!table || !editor.contains(table)) return false;
  const k = e.key;
  if (k === 'Tab') {
    const cells = [...table.querySelectorAll('td, th')].filter(c => c.closest('table') === table);
    const i = cells.indexOf(cellEl);
    // Shift+Tab in the first cell: on to the table tools bar (keyboard access)
    if (e.shiftKey) { if (i > 0) selectCell(cells[i - 1]); else focusBar(editor); return true; }
    if (i < cells.length - 1) { selectCell(cells[i + 1]); return true; }
    // Tab in the last cell: a new row
    editRegion(ctx, nodeRegion(table, editor), (holder) => {
      dropMarks(holder);
      const rows = rowsOf(holder.querySelector('table'));
      const tr = document.createElement('tr');
      const width = Math.max(...rows.map(r => r.children.length));
      for (let c = 0; c < width; c++) tr.appendChild(cell('td'));
      tr.firstChild.insertBefore(makeMark('c'), tr.firstChild.firstChild);
      rows[rows.length - 1].after(tr);
    });
    return true;
  }
  if (k === 'Enter') {
    // a line break inside the cell (Enter would split it into <div>s)
    dom.exec('insertLineBreak');
    return true;
  }
  if ((k === 'ArrowDown' || k === 'ArrowUp') && !e.shiftKey) {
    const rows = rowsOf(table);
    if (cellEl.parentElement !== rows[k === 'ArrowDown' ? rows.length - 1 : 0]) return false;
    return arrowOut(e, ctx, table);
  }
  return false;
}

function selectCell(c) {
  if (hasText(c.textContent)) {
    const r = document.createRange();
    r.selectNodeContents(c);
    selectRange(r);
  } else {
    caretInto(c, false);
  }
  try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old engines */ }
}

function enterKey(ctx) {
  const editor = ctx.editor;
  const range = ctx.range;
  const line = lineOf(ctx.node, editor);
  if (!line) return false;
  // Toggle title: the text after the caret starts the body (or, when the
  // toggle is closed, the line after it)
  if (line.classList.contains('wr-toggle-title') && line.parentElement.classList.contains('wr-toggle')) {
    const toggle = line.parentElement;
    const open = toggle.getAttribute('data-open') !== 'false';
    // at the start of a title with text: an empty line above the toggle
    if (range.collapsed && atLineStart(range, line) && hasText(line.textContent)) {
      return editRegion(ctx, nodeRegion(toggle, editor), (holder) => { holder.insertBefore(emptyLine(false), holder.firstChild); });
    }
    if (!range.collapsed) { revealClosedToggles(range, editor); dom.exec('delete'); }
    return editRegion(ctx, nodeRegion(toggle, editor), (holder) => {
      const t = holder.firstChild;
      const title = t.querySelector(':scope > .wr-toggle-title');
      const body = t.querySelector(':scope > .wr-toggle-body');
      const mark = title && title.querySelector(MARK);
      if (!title || !body || !mark) return false;
      const tail = document.createRange();
      tail.setStartAfter(mark);
      tail.setEnd(title, title.childNodes.length);
      const moved = tail.extractContents();
      // the empty rest of a link / bold the caret ended does not start the next line
      [...moved.querySelectorAll('a, b, strong, i, em, u, s, del, strike, code, mark, span')].reverse()
        .forEach(el => { if (!el.textContent && !el.querySelector('img, br, [contenteditable="false"]')) el.remove(); });
      mark.remove();
      dropTrailingBr(title);
      ensureFilled(title);
      // an empty first line of the body takes the text (no extra line)
      const blank = open && isPlainLine(body.firstElementChild) && isBlankLine(body.firstElementChild) ? body.firstElementChild : null;
      const next = blank || document.createElement('div');
      next.textContent = '';
      next.appendChild(makeMark('c'));
      next.appendChild(moved);
      dropTrailingBr(next);
      ensureFilled(next);
      if (blank) return;
      if (open) body.insertBefore(next, body.firstChild);
      else t.after(next);
    }, { range: dom.getSelectionRange(editor) });
  }
  // Empty last line of a callout / quote / toggle body: leave the box
  if (range.collapsed && isPlainLine(line) && isBlankLine(line)) {
    const flow = line.parentElement;
    if (flow && flow !== editor && isFlowEl(flow) && !nextBlock(line)) {
      const box = containerOf(flow);
      const only = !prevBlock(line);
      const keep = only && flow.classList.contains('wr-toggle-body');
      return editRegion(ctx, nodeRegion(box, editor), (holder, t) => {
        const b = holder.firstChild;
        dropMarks(holder);
        if (only && !keep) { b.replaceWith(emptyLine(true)); return; }
        if (!keep && t.line) t.line.remove();
        b.after(emptyLine(true));
      }, { tags: { line } });
    }
  }
  return false;
}

function backspaceKey(ctx) {
  const editor = ctx.editor;
  const range = ctx.range;
  if (!range.collapsed) return false;
  const line = lineOf(ctx.node, editor);
  if (!line || !atLineStart(range, line)) return false;
  // Toggle title: the toggle goes, its title and body stay as lines
  if (line.classList.contains('wr-toggle-title') && line.parentElement.classList.contains('wr-toggle')) {
    return editRegion(ctx, nodeRegion(line.parentElement, editor), (holder) => unwrapBoxes(holder, 'toggle'));
  }
  // Heading: back to text
  if (isHeading(line) && line.parentElement && !line.closest('li')) {
    return editRegion(ctx, unitRegion(line, editor), (holder) => convertLines(holder, linesIn(holder).filter(isHeading).filter(h => h.querySelector(MARK)), 'div'));
  }
  const parent = line.parentElement;
  if (parent && parent !== editor && !prevBlock(line)) {
    // first line of a callout: the callout goes
    if (parent.classList.contains('wr-callout')) {
      return editRegion(ctx, nodeRegion(parent, editor), (holder) => unwrapBoxes(holder, 'callout'));
    }
    // first line of a quote: that line leaves it
    if (parent.tagName === 'BLOCKQUOTE') return editRegion(ctx, nodeRegion(parent, editor), liftQuotes);
    // first line of a toggle body: never merged into the title
    if (parent.classList.contains('wr-toggle-body')) {
      const toggle = parent.parentElement;
      const title = toggle.querySelector(':scope > .wr-toggle-title');
      if (isBlankLine(line) && nextBlock(line)) {
        return editRegion(ctx, nodeRegion(toggle, editor), (holder, t) => {
          dropMarks(holder);
          if (t.line) t.line.remove();
          const ttl = holder.querySelector(':scope > .wr-toggle > .wr-toggle-title');
          if (ttl) { dropTrailingBr(ttl); ttl.appendChild(makeMark('c')); ensureFilled(ttl); }
        }, { tags: { line } });
      }
      if (title) caretInto(title, true);
      return true;
    }
  }
  // Right after a closed toggle or a table: no merge into it (an empty line
  // goes and the caret moves in); an empty line after a code block goes too
  const flow = flowOf(line, editor);
  const unit = unitIn(line, flow);
  if (unit !== line) return false;
  const before = prevBlock(line);
  if (!isEl(before)) return false;
  const closed = before.classList.contains('wr-toggle') && before.getAttribute('data-open') === 'false';
  const isTable = before.tagName === 'TABLE';
  const isCode = before.tagName === 'PRE';
  if (!closed && !isTable && !(isCode && isBlankLine(line))) return false;
  if (isBlankLine(line)) {
    return editRegion(ctx, { flow, first: before, last: line }, (holder) => {
      dropMarks(holder);
      holder.lastChild.remove();
      const box = holder.firstChild;
      const target = closed ? box.querySelector(':scope > .wr-toggle-title') : isTable ? [...box.querySelectorAll('td, th')].pop() : (box.querySelector('code') || box);
      if (!target) return false;
      if (isCode) {
        target.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
        target.normalize();
        const tn = target.lastChild && target.lastChild.nodeType === 3 ? target.lastChild : null;
        if (tn) tn.data = tn.data.replace(/\n$/, '');
      } else dropTrailingBr(target);
      target.appendChild(makeMark('c'));
      ensureFilled(target);
    });
  }
  caretInto(closed ? before.querySelector(':scope > .wr-toggle-title') : [...before.querySelectorAll('td, th')].pop(), true);
  return true;
}

function deleteKey(ctx) {
  const range = ctx.range;
  if (!range.collapsed) return false;
  const line = lineOf(ctx.node, ctx.editor);
  if (!line || !line.classList.contains('wr-toggle-title') || !atLineEnd(range, line)) return false;
  // Delete at the end of a toggle title never pulls the body into it
  const toggle = line.parentElement;
  const body = toggle.querySelector(':scope > .wr-toggle-body');
  if (toggle.getAttribute('data-open') !== 'false' && body && body.firstElementChild) caretInto(linesIn(body)[0] || body.firstElementChild, false);
  return true;
}

function arrowKey(e, ctx) {
  if (e.shiftKey) return false;
  const editor = ctx.editor;
  // plain wrappers draw no box: the way out is the real box around them
  const flow = flowOf(ctx.node, editor, true);
  let unit = unitIn(ctx.node, flow);
  // a box ending its flow (or starting the editor) offers a way out
  let box = isEl(unit) && (unit.classList.contains('wr-callout') || unit.classList.contains('wr-toggle') || unit.tagName === 'BLOCKQUOTE') ? unit : null;
  if (!box) {
    const outer = flow !== editor ? containerOf(flow) : null;
    if (outer && !(e.key === 'ArrowDown' ? nextBlock(unit) : prevBlock(unit))) box = outer;
  }
  if (!box) return false;
  return arrowOut(e, ctx, box);
}

function onKeydown(e, ctx) {
  if (!ctx.editor || !ctx.range || ctx.view) return false;
  // Ctrl+Shift+. in a toggle title: the quote command is unavailable there, so say why
  if (e.shiftKey && (e.ctrlKey || e.metaKey) && inToggleTitle(ctx) && api.registry.matchKeyEvent(e, ctx.mac) === 'quote') {
    api.toast('Quotes can’t go in a toggle title');
    return true;
  }
  const k = e.key;
  if (k !== 'Enter' && k !== 'Backspace' && k !== 'Delete' && k !== 'Tab' && k !== 'ArrowDown' && k !== 'ArrowUp') return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const editor = ctx.editor;
  const pre = dom.closestIn(ctx.node, 'pre', editor);
  if (pre) return codeKey(e, ctx, pre) === true;
  const c = cellAt(ctx);
  if (c && tableKey(e, ctx, c)) return true;
  if (k === 'Enter' && !e.shiftKey) return enterKey(ctx) === true;
  if (k === 'Backspace') return backspaceKey(ctx) === true;
  if (k === 'Delete') return deleteKey(ctx) === true;
  if (k === 'ArrowDown' || k === 'ArrowUp') return arrowKey(e, ctx) === true;
  return false;
}

// Paste inside a code block: plain text, newlines kept as text
function onPaste(e, ctx) {
  if (!ctx.editor || ctx.view || !ctx.range) return false;
  // whoever pastes deletes the selection first: hidden toggle bodies too
  revealClosedToggles(ctx.range, ctx.editor);
  const pre = dom.closestIn(ctx.node, 'pre', ctx.editor);
  if (!pre) return false;
  const cd = e.clipboardData;
  if (!cd || [...(cd.items || [])].some(it => it.kind === 'file')) return false;
  const text = (cd.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (!text) return true;
  const { after } = codeSides(ctx.range, pre);
  const keepLast = (after === '' || after === '\n') && text.endsWith('\n') && after !== '\n';
  dom.insertHTML(escapeText(text) + (keepLast ? '\n' : ''));
  return true;
}

// ---------------------------------------------------------------------------
// Delegated clicks: callout icon, toggle chevron, code "Copy" (editors + views)
// ---------------------------------------------------------------------------
function zoneHit(e, root) {
  const t = e.target;
  if (!t || !t.closest || !root || !root.contains(t)) return null;
  const pre = t.closest('pre.wr-code');
  if (pre && root.contains(pre)) {
    const r = pre.getBoundingClientRect();
    if (e.clientY - r.top <= COPY_ZONE_H && r.right - e.clientX <= COPY_ZONE_W) return { type: 'copy', el: pre };
    if (e.clientY - r.top <= COPY_ZONE_H && e.clientX - r.left <= LANG_ZONE_W) return { type: 'lang', el: pre };
  }
  const title = t.closest('.wr-toggle-title');
  if (title && root.contains(title) && title.parentElement && title.parentElement.classList.contains('wr-toggle')) {
    const r = title.getBoundingClientRect();
    if (e.clientX - r.left <= CHEVRON_ZONE) return { type: 'toggle', el: title.parentElement };
  }
  if (t.classList && t.classList.contains('wr-callout')) {
    const r = t.getBoundingClientRect();
    if (e.clientX - r.left <= GUTTER_ZONE && e.clientY - r.top <= GUTTER_TOP) return { type: 'kind', el: t };
  }
  return null;
}

function copyCode(pre) {
  const clone = pre.cloneNode(true);
  clone.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  const text = clone.textContent.replace(/[\u200B\uFEFF]/g, '').replace(/\n$/, '');
  const done = () => api.toast('Code copied');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    api.toast(ok ? 'Code copied' : 'Couldn’t copy the code');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

// The code block's language: a small field over its label (editors)
function editLang(pre, editor) {
  const body = document.createElement('div');
  body.className = 'wr-lang-body';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'wr-lang-input';
  input.value = pre.getAttribute('data-lang') || '';
  input.placeholder = 'js, python, sql…';
  input.maxLength = 20;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Code block language');
  const hint = document.createElement('div');
  hint.className = 'wr-lang-hint';
  hint.textContent = 'Enter to set · Esc to cancel';
  body.append(input, hint);
  const r = pre.getBoundingClientRect();
  const pop = api.ui.openPopover({ anchor: new DOMRect(r.left + 6, r.top + 2, 90, 24), className: 'wr-lang-pop', content: body, editor, focus: input });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const lang = cleanLang(input.value);
    pop.close('pick');
    if (!pre.isConnected || lang === (pre.getAttribute('data-lang') || '')) return;
    pre.setAttribute('data-lang', lang);
    api.notifyChange(editor);
  });
}

function cycleKind(box, editor) {
  const cur = box.getAttribute('data-kind') || 'note';
  box.setAttribute('data-kind', KINDS[(KINDS.indexOf(cur) + 1) % KINDS.length]);
  api.notifyChange(editor);
}

function onClick(e, ctx) {
  const hit = zoneHit(e, ctx.view ? ctx.viewEl : ctx.editor);
  if (!hit) return false;
  if (hit.type === 'copy') { copyCode(hit.el); return true; }
  if (hit.type === 'toggle') { flipToggle(hit.el, ctx.view ? null : ctx.editor, ctx.view); return true; }
  if (hit.type === 'kind' && !ctx.view) { cycleKind(hit.el, ctx.editor); return true; }
  if (hit.type === 'lang' && !ctx.view) { editLang(hit.el, ctx.editor); return true; }
  return false;
}

// Pressing a zone keeps the caret where it was (views: only their own zones)
function onMouseDown(e) {
  if (e.button !== 0) return;
  const hit = zoneHit(e, e.currentTarget);
  if (!hit) return;
  if (e.currentTarget.classList.contains('wr-view') && (hit.type === 'kind' || hit.type === 'lang')) return;
  e.preventDefault();
}

// ---------------------------------------------------------------------------
// Structure repair after edits the browser made on its own (a selection
// deleted across a toggle's title and body, a split title...). Done by hand,
// outside the undo stack, so it must never fight it: a title / body made up
// here is a stand-in (remembered), removed again as soon as an undo brings
// the real one back; during an undo / redo nothing the browser knows about
// is moved, missing parts are only filled in.
// ---------------------------------------------------------------------------
const standIns = new WeakSet();
const lastInputType = new WeakMap(); // editor -> type of its latest beforeinput

function standIn(cls, child) {
  const el = document.createElement('div');
  el.className = cls;
  if (child) el.appendChild(child);
  standIns.add(el);
  return el;
}

function repair(editor, history) {
  let caret; // the selection, kept across the moves below (same nodes, same order)
  const moving = () => { if (caret === undefined) caret = rangeRecord(dom.getSelectionRange(editor), editor); };
  editor.querySelectorAll('.wr-toggle').forEach(t => {
    const parts = (cls) => {
      const list = [...t.children].filter(c => c.classList.contains(cls));
      if (list.length < 2) return list;
      // an undo brought the real one back: the blank stand-in goes
      const keep = list.filter(el => !(standIns.has(el) && isBlankLine(el)));
      if (!keep.length) keep.push(list[0]);
      list.forEach(el => { if (!keep.includes(el)) el.remove(); });
      return keep;
    };
    const titles = parts('wr-toggle-title');
    const bodies = parts('wr-toggle-body');
    if (!titles.length) titles.push(t.insertBefore(standIn('wr-toggle-title', document.createElement('br')), t.firstChild));
    if (!bodies.length) bodies.push(t.appendChild(standIn('wr-toggle-body', null))); // its line comes last
    const body = bodies[0];
    if (!history) {
      // a split title: the extra titles start the body
      if (titles.length > 1) moving();
      titles.slice(1).reverse().forEach(extra => {
        extra.classList.remove('wr-toggle-title');
        if (!extra.className) extra.removeAttribute('class');
        body.insertBefore(extra, body.firstChild);
      });
      // more than one body: one
      if (bodies.length > 1) moving();
      bodies.slice(1).forEach(extra => { body.append(...extra.childNodes); extra.remove(); });
      // anything else in the toggle (neither title nor body) would stay
      // visible when it closes: it goes to the start of the body
      const stray = [...t.childNodes].filter(n => n !== titles[0] && n !== body &&
        (n.nodeType === 1 ? !n.hasAttribute('data-wr-ephemeral') : n.nodeType === 3 && hasText(n.data)));
      if (stray.length) {
        moving();
        // loose text / inline nodes become a line
        const out = [];
        let line = null;
        stray.forEach(n => {
          if (!isInline(n)) { line = null; out.push(n); return; }
          if (!line) { line = document.createElement('div'); out.push(line); }
          line.appendChild(n);
        });
        body.prepend(...out);
      }
      if (titles[0] !== t.firstElementChild) { moving(); t.insertBefore(titles[0], t.firstChild); }
    }
    if (!body.firstChild) body.appendChild(emptyLine(false));
  });
  if (caret) {
    const r = rangeFromRecord(caret, editor);
    if (r) selectRange(r);
  }
}

// Chrome's editing skips what isn't rendered: a selection deleted (typed or
// pasted over) across a closed toggle would leave its hidden body behind,
// and the toggle around it. Closed toggles the selection touches are shown
// (data-wr-reveal, writing.css 4) until the edit is done.
const revealed = new Set();
let revealTimer = 0;

function revealClosedToggles(range, editor) {
  if (!range || range.collapsed) return;
  editor.querySelectorAll('.wr-toggle[data-open="false"]:not([data-wr-reveal])').forEach(t => {
    let hit = false;
    try { hit = range.intersectsNode(t); } catch { hit = false; }
    if (!hit) return;
    t.setAttribute('data-wr-reveal', '');
    revealed.add(t);
  });
  // the edit runs right after (same task); this is the fallback when it doesn't
  if (revealed.size && !revealTimer) revealTimer = setTimeout(unrevealToggles, 0);
}

function unrevealToggles() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = 0; }
  if (!revealed.size) return;
  revealed.forEach(t => t.removeAttribute('data-wr-reveal'));
  revealed.clear();
  // copies the browser made of a revealed toggle while splitting it
  api.editors().forEach(ed => ed.querySelectorAll('.wr-toggle[data-wr-reveal]').forEach(t => t.removeAttribute('data-wr-reveal')));
}

function onBeforeInput(e, ctx) {
  if (!ctx.editor || ctx.view) return false;
  const type = e.inputType || '';
  lastInputType.set(ctx.editor, type);
  if (/^(insert|delete)/.test(type)) revealClosedToggles(ctx.range, ctx.editor);
  return false;
}

// ---------------------------------------------------------------------------
// Table tools bar (floating, FULL editors)
// ---------------------------------------------------------------------------
const TT_ICONS = {
  rowAbove: '<rect x="3" y="12" width="18" height="9" rx="2"/><line x1="3" y1="16.5" x2="21" y2="16.5"/><line x1="12" y1="2.5" x2="12" y2="8.5"/><line x1="9" y1="5.5" x2="15" y2="5.5"/>',
  rowBelow: '<rect x="3" y="3" width="18" height="9" rx="2"/><line x1="3" y1="7.5" x2="21" y2="7.5"/><line x1="12" y1="15.5" x2="12" y2="21.5"/><line x1="9" y1="18.5" x2="15" y2="18.5"/>',
  colLeft: '<rect x="12" y="3" width="9" height="18" rx="2"/><line x1="16.5" y1="3" x2="16.5" y2="21"/><line x1="2.5" y1="12" x2="8.5" y2="12"/><line x1="5.5" y1="9" x2="5.5" y2="15"/>',
  colRight: '<rect x="3" y="3" width="9" height="18" rx="2"/><line x1="7.5" y1="3" x2="7.5" y2="21"/><line x1="15.5" y1="12" x2="21.5" y2="12"/><line x1="18.5" y1="9" x2="18.5" y2="15"/>',
  delRow: '<rect x="2.5" y="7" width="13" height="10" rx="2"/><line x1="2.5" y1="12" x2="15.5" y2="12" opacity=".5"/><line x1="18" y1="9.5" x2="22" y2="13.5"/><line x1="22" y1="9.5" x2="18" y2="13.5"/>',
  delCol: '<rect x="7" y="2.5" width="10" height="13" rx="2"/><line x1="12" y1="2.5" x2="12" y2="15.5" opacity=".5"/><line x1="10" y1="18" x2="14" y2="22"/><line x1="14" y1="18" x2="10" y2="22"/>',
  header: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18V6.5A2.5 2.5 0 0 0 18.5 4h-13A2.5 2.5 0 0 0 3 6.5z" fill="currentColor" stroke="none" opacity=".5"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="10" y1="9.5" x2="10" y2="20"/>',
  delTable: '<path d="M4 7h16"/><path d="M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7"/><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/>'
};
const TT_OPS = [
  ['rowAbove', 'Insert row above'], ['rowBelow', 'Insert row below'], ['colLeft', 'Insert column left'], ['colRight', 'Insert column right'],
  null, ['delRow', 'Delete row'], ['delCol', 'Delete column'], null, ['header', 'Header row'], null, ['delTable', 'Delete table']
];

let bar = null;           // { el, buttons, table, editor }
let barListening = false;
// The editor or table hidden / resized (a dialog closing) moves or hides the bar
const barObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (bar && bar.table) placeBar(); }) : null;

function ttIcon(name) {
  return `<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TT_ICONS[name]}</svg>`;
}

function buildBar() {
  const el = document.createElement('div');
  el.className = 'wr-pop wr-table-tools';
  el.dataset.wrUi = '';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Table');
  const buttons = {};
  TT_OPS.forEach(op => {
    if (!op) {
      const sep = document.createElement('span');
      sep.className = 'wr-tt-sep';
      sep.setAttribute('aria-hidden', 'true');
      el.appendChild(sep);
      return;
    }
    const [id, label] = op;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wr-tt-btn' + (id === 'delTable' ? ' is-danger' : '');
    b.dataset.op = id;
    b.title = label;
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    b.innerHTML = ttIcon(id);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      const byKey = ev.detail === 0 && document.activeElement === b;
      runTableOp(id);
      // from the keyboard the focus stays on the button (ops can repeat)
      if (byKey && bar && bar.table && bar.el.isConnected) focusBarButton(bar.buttons[id].disabled ? null : bar.buttons[id]);
    });
    buttons[id] = b;
    el.appendChild(b);
  });
  // the editor keeps its caret: nothing in the bar takes focus on press
  el.addEventListener('mousedown', ev => ev.preventDefault());
  // keyboard (Shift+Tab in the first cell gets here): arrows move, Esc / Tab go back to the cell
  el.addEventListener('focusin', () => window.addEventListener('keydown', onBarKey, true));
  el.addEventListener('focusout', (ev) => {
    if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
    window.removeEventListener('keydown', onBarKey, true);
    if (bar && bar.editor && !(ev.relatedTarget && bar.editor.contains(ev.relatedTarget)) && document.activeElement !== bar.editor) {
      requestAnimationFrame(() => { if (bar && bar.editor && !bar.el.contains(document.activeElement) && !bar.editor.contains(document.activeElement)) hideBar(); });
    }
  });
  return { el, buttons, table: null, editor: null, range: null, placed: null };
}

function barButtons() {
  return bar ? Object.values(bar.buttons).filter(b => !b.disabled) : [];
}

function focusBarButton(b) {
  const list = barButtons();
  const target = b && list.includes(b) ? b : list[0];
  if (!target) return;
  Object.values(bar.buttons).forEach(x => { x.tabIndex = x === target ? 0 : -1; });
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
}

// Into the bar from the table (the caret is kept to come back to)
function focusBar(editor) {
  if (!bar || !bar.table || bar.editor !== editor || !bar.el.isConnected) return false;
  const range = dom.getSelectionRange(editor);
  bar.range = range ? range.cloneRange() : null;
  focusBarButton(null);
  return true;
}

function leaveBar() {
  if (!bar || !bar.editor) return;
  const editor = bar.editor;
  const range = bar.range;
  const table = bar.table;
  focusEditor(editor);
  if (range && editor.contains(range.startContainer)) selectRange(range);
  else if (table && table.isConnected) caretInto(table.querySelector('td, th'), false);
}

function onBarKey(e) {
  if (!bar || !bar.el.contains(document.activeElement)) return;
  const list = barButtons();
  const i = list.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = list[(i + 1) % list.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
  else if (e.key === 'Home') next = list[0];
  else if (e.key === 'End') next = list[list.length - 1];
  else if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    leaveBar();
    return;
  } else return;
  e.preventDefault();
  e.stopPropagation();
  focusBarButton(next);
}

function onBarViewportChange() { if (bar && bar.table) placeBar(); }

function showBar(editor, table) {
  if (!bar) bar = buildBar();
  const fresh = !bar.el.isConnected;
  if (barObserver && (bar.table !== table || bar.editor !== editor)) {
    barObserver.disconnect();
    barObserver.observe(editor);
    barObserver.observe(table);
  }
  if (fresh || bar.table !== table || bar.editor !== editor) bar.placed = null;
  bar.table = table;
  bar.editor = editor;
  if (!bar.el.isConnected) document.body.appendChild(bar.el);
  if (fresh) {
    bar.el.classList.remove('open');
    void bar.el.offsetWidth;
    bar.el.classList.add('open');
  }
  if (!barListening) {
    barListening = true;
    window.addEventListener('resize', onBarViewportChange);
    document.addEventListener('scroll', onBarViewportChange, true);
  }
  syncBarState();
  placeBar();
}

function hideBar() {
  if (!bar) return;
  if (barObserver) barObserver.disconnect();
  window.removeEventListener('keydown', onBarKey, true);
  bar.table = null;
  bar.editor = null;
  bar.range = null;
  bar.placed = null;
  if (bar.el.isConnected) bar.el.remove();
  if (barListening) {
    barListening = false;
    window.removeEventListener('resize', onBarViewportChange);
    document.removeEventListener('scroll', onBarViewportChange, true);
  }
}

function syncBarState() {
  if (!bar || !bar.table) return;
  const header = hasHeaderRow(bar.table);
  const b = bar.buttons.header;
  if (b.classList.contains('is-on') !== header) b.classList.toggle('is-on', header);
  if (b.getAttribute('aria-pressed') !== String(header)) b.setAttribute('aria-pressed', String(header));
  const range = dom.getSelectionRange(bar.editor);
  const c = range && dom.closestIn(dom.anchorNode(range), 'td, th', bar.editor);
  const onHeader = !!(c && header && rowsOf(bar.table)[0] === c.parentElement);
  if (bar.buttons.rowAbove.disabled !== onHeader) bar.buttons.rowAbove.disabled = onHeader;
}

// Under the table (over the line after it), so the line above, often its
// heading, stays readable. Above the table when its bottom is outside the
// editor's visible area (or the viewport has no room under it); just inside
// the top of that area when both edges have scrolled away. Placed again only
// when the table, the editor or the viewport moved: every style write wakes
// glass-glow's page-wide observers, and this runs on each caret move.
function placeBar() {
  if (!bar || !bar.table || !bar.table.isConnected || !bar.editor || !bar.editor.isConnected || !bar.editor.getClientRects().length) { hideBar(); return; }
  const t = bar.table.getBoundingClientRect();
  const ed = bar.editor.getBoundingClientRect();
  // (a cell growing wider while typing moves nothing: the bar starts at the table's left)
  const key = [t.left, t.top, t.bottom, t.width >= 1, ed.left, ed.top, ed.bottom, window.innerWidth, window.innerHeight].map(Number).map(Math.round).join(',');
  if (key === bar.placed) return;
  bar.placed = key;
  const top = Math.max(t.top, ed.top);
  const bottom = Math.min(t.bottom, ed.bottom);
  if (bottom <= top || t.width < 1) { if (bar.el.style.visibility !== 'hidden') bar.el.style.visibility = 'hidden'; return; }
  if (bar.el.style.visibility) bar.el.style.visibility = '';
  const left = Math.max(t.left, ed.left);
  const width = Math.min(t.width, ed.width);
  const h = bar.el.offsetHeight || 38;
  if (t.bottom <= ed.bottom + 1 && t.bottom + 6 + h <= window.innerHeight - 8) {
    positionPopup(bar.el, new DOMRect(left, t.bottom, width, 0), { placement: 'bottom-start', gap: 6 });
  } else if (t.top >= ed.top - 1) {
    positionPopup(bar.el, new DOMRect(left, t.top, width, 0), { placement: 'top-start', gap: 6 });
  } else {
    positionPopup(bar.el, new DOMRect(left, top, width, 0), { placement: 'bottom-start', gap: 4 });
  }
}

function updateBar(ctx) {
  const editor = ctx.editor;
  if (!editor || ctx.view || ctx.tier !== 'full' || !ctx.range) { if (bar && bar.editor === editor) hideBar(); return; }
  const c = dom.closestIn(ctx.node, 'td, th', editor);
  const table = c && c.closest('table');
  if (!table || !editor.contains(table)) { if (bar && bar.table) hideBar(); return; }
  showBar(editor, table);
}

function runTableOp(op) {
  if (!bar || !bar.table || !bar.editor) return;
  const editor = bar.editor;
  const table = bar.table;
  const range = dom.getSelectionRange(editor);
  let c = range && dom.closestIn(dom.anchorNode(range), 'td, th', editor);
  if (!c || c.closest('table') !== table) {
    c = table.querySelector('td, th');
    if (!c) return;
    caretInto(c, false);
  }
  const ctx = api.context(editor);
  const ci = [...c.parentElement.children].indexOf(c);
  if (op === 'delTable') {
    editRegion(ctx, nodeRegion(table, editor), (holder) => holder.replaceChildren(emptyLine(true)));
    hideBar();
    return;
  }
  editRegion(ctx, nodeRegion(table, editor), (holder, tg) => {
    const t = holder.querySelector('table');
    const row = tg.row;
    if (!t || !row) return false;
    const rs = rowsOf(t);
    const ri = rs.indexOf(row);
    const width = Math.max(...rs.map(r => r.children.length));
    const header = hasHeaderRow(t);
    const put = (target) => { dropMarks(holder); if (target) target.insertBefore(makeMark('c'), target.firstChild); };
    if (op === 'rowAbove' || op === 'rowBelow') {
      const tr = document.createElement('tr');
      for (let k = 0; k < width; k++) tr.appendChild(cell('td'));
      if (op === 'rowAbove') row.before(tr); else row.after(tr);
      put(tr.children[Math.min(ci, width - 1)]);
    } else if (op === 'colLeft' || op === 'colRight') {
      let target = null;
      rs.forEach((r, k) => {
        const ref = r.children[Math.min(ci, r.children.length - 1)];
        const nc = cell(header && k === 0 ? 'th' : 'td');
        if (!ref) r.appendChild(nc);
        else if (op === 'colLeft') ref.before(nc); else ref.after(nc);
        if (k === ri) target = nc;
      });
      put(target);
    } else if (op === 'delRow') {
      if (rs.length <= 1) { holder.replaceChildren(emptyLine(true)); return; }
      row.remove();
      const left = rowsOf(t);
      const nr = left[Math.min(ri, left.length - 1)];
      put(nr.children[Math.min(ci, nr.children.length - 1)]);
    } else if (op === 'delCol') {
      if (width <= 1) { holder.replaceChildren(emptyLine(true)); return; }
      rs.forEach(r => { const x = r.children[Math.min(ci, r.children.length - 1)]; if (x) x.remove(); });
      put(row.children[Math.min(ci, row.children.length - 1)]);
    } else if (op === 'header') {
      [...rs[0].children].forEach(x => {
        const n = document.createElement(header ? 'td' : 'th');
        n.append(...x.childNodes);
        x.replaceWith(n);
      });
    }
  }, { tags: { row: c.parentElement } });
  updateBar(api.context(editor));
  // where Esc from the bar goes back to: the cell the op left the caret in
  const after = dom.getSelectionRange(editor);
  if (bar && bar.editor === editor && after) bar.range = after.cloneRange();
}

// ---------------------------------------------------------------------------
// Undo / redo: Chrome restores the framed range (gone by then), so the caret
// goes back to where it was before the edit (after it, for a redo); a
// sentinel a redo brought back is dropped
// ---------------------------------------------------------------------------
function onHistoryInput(e) {
  if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
  const editor = e.currentTarget;
  cleanupSentinels(editor);
  const list = writes.get(editor);
  if (!list) return;
  const undo = e.inputType === 'historyUndo';
  for (let i = list.length - 1; i >= 0; i--) {
    const rec = list[i];
    if (!rec.original || !rec.inserted) continue;
    const back = rec.original.isConnected && editor.contains(rec.original) && !rec.inserted.isConnected;
    const fwd = rec.inserted.isConnected && editor.contains(rec.inserted) && !rec.original.isConnected;
    if (undo && rec.state === 'done' && back) {
      rec.state = 'undone';
      const r = rangeFromRecord(rec.before, editor);
      if (r) selectRange(r);
      return;
    }
    if (!undo && rec.state === 'undone' && fwd) {
      rec.state = 'done';
      const r = rangeFromRecord(rec.after, editor);
      if (r) selectRange(r);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------
export function install(writingApi) {
  api = writingApi;
  // For paste.js: rewrite one block of a flow (or the whole doc: el = the
  // editor) in one undo step. fn(holder, mark) edits a copy that holds the
  // selection markers (<wr-mark data-k="c|s|e">); mark('c') makes a caret one.
  api.rewriteBlock = (ctx, el, fn) => editRegion(ctx,
    el === ctx.editor ? (el.firstChild ? { flow: el, first: el.firstChild, last: el.lastChild } : null) : nodeRegion(el, ctx.editor),
    (holder) => fn(holder, makeMark));

  api.registerCommand('paragraph', paragraphCommand);
  api.registerCommand('heading1', headingCommand(1));
  api.registerCommand('heading2', headingCommand(2));
  api.registerCommand('heading3', headingCommand(3));
  api.registerCommand('quote', quoteCommand);
  api.registerCommand('divider', dividerCommand);
  Object.keys(KIND_OF_COMMAND).forEach(id => api.registerCommand(id, calloutCommand(id)));
  api.registerCommand('toggle', toggleCommand);
  api.registerCommand('codeBlock', codeBlockCommand);
  api.registerCommand('table', tableCommand);
  api.registerCommand('toggleCheck', toggleCheckCommand);
  api.registerCommand('moveUp', moveCommand(-1));
  api.registerCommand('moveDown', moveCommand(1));
  api.registerCommand('duplicate', duplicateCommand);

  api.hooks.keydown.push(onKeydown);
  api.hooks.paste.push(onPaste);
  api.hooks.click.push(onClick);
  api.hooks.selection.push((e, ctx) => updateBar(ctx));
  api.hooks.beforeinput.push(onBeforeInput);
  api.hooks.change.push((editor) => {
    unrevealToggles();
    const type = lastInputType.get(editor);
    lastInputType.delete(editor);
    repair(editor, type === 'historyUndo' || type === 'historyRedo');
    if (bar && bar.editor === editor) {
      if (!bar.table || !bar.table.isConnected) updateBar(api.context(editor));
      else { syncBarState(); placeBar(); }
    }
  });

  api.onAttach((editor) => {
    editor.addEventListener('mousedown', onMouseDown, true);
    editor.addEventListener('input', onHistoryInput);
    editor.addEventListener('focusout', (e) => {
      if (!bar || bar.editor !== editor) return;
      const to = e.relatedTarget;
      if (to && (editor.contains(to) || bar.el.contains(to))) return;
      hideBar();
    });
  });
  api.onViewAttach((viewEl, ctx, info) => {
    if (info && info.first) viewEl.addEventListener('mousedown', onMouseDown, true);
  });
}
