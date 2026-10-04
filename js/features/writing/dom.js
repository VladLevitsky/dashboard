// Personal Dashboard - Writing DOM helpers (selection, blocks, exec wrapper,
// canonical HTML). No imports and nothing runs at load, so utils.js can use
// cleanEditorHtml / isEffectivelyEmpty and Node tests that import utils.js
// still load.

// --- Blocks the writing features understand
export const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'UL', 'OL', 'TABLE', 'HR']);
const LINE_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'TD', 'TH', 'BLOCKQUOTE']);
// Nodes that count as content even without text
const CONTENT_SELECTOR = 'img, hr, table, pre, .wr-callout, .wr-toggle, .wr-date, .wr-ref, .project-task-highlight';
const EMPTY_TEXT = /[\s\u00A0\u200B\uFEFF]/g;

// --- Canonical HTML -------------------------------------------------------

function toTemplate(htmlOrElement) {
  const tpl = document.createElement('template');
  tpl.innerHTML = typeof htmlOrElement === 'string' ? htmlOrElement : (htmlOrElement?.innerHTML || '');
  return tpl;
}

// What an editor saves: the image-resize wrapper unwrapped, writing UI
// (data-wr-ephemeral) removed, hydrated R2 image src stripped. Parsed in an
// inert <template> (no image loads, no scripts).
export function cleanEditorHtml(htmlOrElement) {
  if (htmlOrElement == null) return '';
  if (typeof document === 'undefined') return typeof htmlOrElement === 'string' ? htmlOrElement : '';
  const tpl = toTemplate(htmlOrElement);
  const root = tpl.content;
  root.querySelectorAll('[data-wr-ephemeral]').forEach(el => el.remove());
  root.querySelectorAll('.editor-img-resize-wrap').forEach(wrap => {
    wrap.querySelectorAll('.editor-img-resize-handle').forEach(h => h.remove());
    wrap.replaceWith(...Array.from(wrap.childNodes));
  });
  root.querySelectorAll('img[data-r2-file-id][src]').forEach(img => img.removeAttribute('src'));
  // a toggle opened / closed by a reader in a view is not an edit
  root.querySelectorAll('[data-wr-open]').forEach(el => el.removeAttribute('data-wr-open'));
  return tpl.innerHTML;
}

// True when there is no visible text and no content node (image, divider,
// table, code block, callout, toggle, chips, task pill)
export function isEffectivelyEmpty(html) {
  if (!html) return true;
  if (typeof document === 'undefined') {
    const stripped = String(html).replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').replace(/<\/?(div|p|span|ul|ol|li)\b[^>]*>/gi, '').trim();
    return !stripped;
  }
  const root = toTemplate(html).content;
  if ((root.textContent || '').replace(EMPTY_TEXT, '')) return false;
  return !root.querySelector(CONTENT_SELECTOR);
}

// --- Escaping / URLs ------------------------------------------------------

export function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// http(s) / mailto / in-page '#…' only. Bare domains get https://.
export function safeUrl(raw) {
  if (raw == null) return null;
  let url = String(raw).trim();
  if (!url) return null;
  if (url.startsWith('#')) return url;
  if (/^mailto:/i.test(url)) return /^mailto:[^\s<>"]+$/i.test(url) ? url : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) return null;
  if (!/^https?:\/\//i.test(url)) {
    if (/^\/\//.test(url)) url = 'https:' + url;
    else if (/^[^\s/]+\.[^\s/]{2,}/.test(url)) url = 'https://' + url;
    else return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// Open a link from content in a new tab, never navigating the dashboard away
export function openSafe(href) {
  const url = safeUrl(href);
  if (!url) return false;
  if (url.startsWith('#')) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

// --- Selection ------------------------------------------------------------

export function getSelectionRange(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (editor && !editor.contains(range.commonAncestorContainer)) return null;
  return range;
}

export function restoreRange(range, editor) {
  if (!range) return false;
  if (editor && document.activeElement !== editor && !editor.contains(document.activeElement)) {
    try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  }
  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function placeCaret(node, offset = 0) {
  const sel = window.getSelection();
  if (!sel || !node) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, nodeLength(node)));
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretAtStart(el) { placeCaret(el, 0); }

export function placeCaretAtEnd(el) {
  const sel = window.getSelection();
  if (!sel || !el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function selectNodeContents(el) {
  const sel = window.getSelection();
  if (!sel || !el) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

export function selectNode(el) {
  const sel = window.getSelection();
  if (!sel || !el) return null;
  const range = document.createRange();
  range.selectNode(el);
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

export function nodeLength(node) {
  return node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length;
}

export function selectedText(editor) {
  const range = getSelectionRange(editor);
  return range && !range.collapsed ? range.toString() : '';
}

// --- Walking --------------------------------------------------------------

export function elementOf(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

// The node the caret really sits in. A range set on an element (editor.focus()
// + "caret at the end" gives (editor, childCount)) is resolved to the nearest
// leaf: the child before the offset at the end, else the child at the offset.
export function anchorNode(range) {
  if (!range) return null;
  let node = range.startContainer;
  let offset = range.startOffset;
  while (node && node.nodeType === Node.ELEMENT_NODE && node.childNodes.length) {
    const atEnd = offset >= node.childNodes.length;
    const child = node.childNodes[atEnd ? node.childNodes.length - 1 : offset];
    if (!child || child.nodeName === 'BR' || child.nodeName === 'IMG' || child.nodeName === 'HR') {
      return child && child.nodeName !== 'BR' ? child : node;
    }
    node = child;
    offset = atEnd ? (node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length) : 0;
  }
  return node;
}

// Closest ancestor matching selector, stopping at (and excluding) the editor
export function closestIn(node, selector, editor) {
  let el = elementOf(node);
  while (el && el !== editor) {
    if (el.matches && el.matches(selector)) return el;
    el = el.parentElement;
  }
  return null;
}

// The line-level block holding node: div/p/h1-6/li/pre/td/th (or a text
// node / inline that sits straight in the editor -> null)
export function blockOf(node, editor) {
  let el = elementOf(node);
  while (el && el !== editor) {
    if (LINE_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

// The editor's direct child that holds node
export function topBlockOf(node, editor) {
  let cur = node;
  while (cur && cur.parentNode && cur.parentNode !== editor) cur = cur.parentNode;
  return cur && cur.parentNode === editor ? cur : null;
}

// A triple-click selects a line plus the very start of the next one (end =
// (nextLine, 0)). Returns the range with its end pulled back to the end of
// the last selected text before that line, or the range itself when nothing
// needs trimming.
export function trimRangeEnd(range, editor) {
  if (!range || range.collapsed) return range;
  const endBlock = blockOf(range.endContainer, editor);
  if (!endBlock || endBlock === blockOf(range.startContainer, editor)) return range;
  const head = document.createRange();
  head.setStart(endBlock, 0);
  try { head.setEnd(range.endContainer, range.endOffset); } catch { return range; }
  const picked = head.cloneContents();
  if (head.toString().length || (picked.querySelector && picked.querySelector('img, hr, table, [contenteditable="false"]'))) return range;
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last = null, node;
  while ((node = walker.nextNode())) {
    if (endBlock.contains(node)) break;
    if (node.data.length && range.intersectsNode(node)) last = node;
  }
  if (!last) return range;
  const trimmed = range.cloneRange();
  trimmed.setEnd(last, last.data.length);
  return trimmed;
}

// Grow a range over the inline elements whose whole content it covers
// (selecting the text of <b>two</b> or a link's text gives a range INSIDE
// them). insertHTML over such a range deletes the element, so a wrap would
// lose the bold / link / highlight around the text; over the grown range the
// clone carries the element and it is re-inserted inside the new wrapper.
export function expandToWholeInlines(range, editor) {
  if (!range || range.collapsed) return range;
  const r = range.cloneRange();
  const isStop = (el) => !el || el === editor || el.nodeType !== Node.ELEMENT_NODE || BLOCK_TAGS.has(el.tagName) ||
    el.getAttribute('contenteditable') != null || (editor && !editor.contains(el));
  // Nothing visible from point a to point b (b before a counts as nothing)
  const nothingBetween = (an, ao, bn, bo) => {
    const t = document.createRange();
    try { t.setStart(an, ao); t.setEnd(bn, bo); } catch { return false; }
    if (t.collapsed) return true;
    if (t.toString().length) return false;
    const f = t.cloneContents();
    return !f.querySelector('img, br, hr, [contenteditable="false"]');
  };
  for (;;) {
    const c = r.startContainer;
    if (r.startOffset !== 0) break;
    const el = c.nodeType === Node.TEXT_NODE ? (c.previousSibling ? null : c.parentNode) : c;
    if (isStop(el)) break;
    if (!nothingBetween(r.endContainer, r.endOffset, el, el.childNodes.length)) break; // ends inside el
    r.setStartBefore(el);
  }
  for (;;) {
    const c = r.endContainer;
    if (r.endOffset !== nodeLength(c)) break;
    const el = c.nodeType === Node.TEXT_NODE ? (c.nextSibling ? null : c.parentNode) : c;
    if (isStop(el)) break;
    if (!nothingBetween(el, 0, r.startContainer, r.startOffset)) break; // starts inside el
    r.setEndAfter(el);
  }
  return r;
}

// Character offsets of a range inside root (text only). They survive edits
// that change only markup (unwrapping, re-inserting the same text), unlike
// node references: rangeToOffsets before, offsetsToRange after.
export function rangeToOffsets(range, root) {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch { return null; }
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

// At a node boundary the start goes into the next text node and the end
// stays in the previous one, so a selected word sits INSIDE its element
// (<code>|two|</code>, not |<code>two</code>|). opts.caretAfter: a collapsed
// range at offsets.start that also leans forward (outside a trailing element),
// but never past the end of its line: text offsets carry no line breaks, so at
// the end of a line the next text node is the next line / cell / list item.
// There the caret stays on its line, after the inline elements it ends.
export function offsetsToRange(root, offsets, opts = {}) {
  if (!root || !offsets) return null;
  const list = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { list.push({ node: n, start: pos }); pos += n.data.length; }
  const caretAfter = !!opts.caretAfter;
  // Is next on the same visual line as the end of node (same line block, no
  // line break or image between, not inside a chip)?
  const sameLine = (node, next) => {
    if (blockOf(node, root) !== blockOf(next, root) || closestIn(next, '[contenteditable="false"]', root)) return false;
    const gap = document.createRange();
    try { gap.setStart(node, node.data.length); gap.setEnd(next, 0); } catch { return false; }
    return !gap.cloneContents().querySelector('br, img, hr');
  };
  const locate = (off, forward) => {
    for (let i = 0; i < list.length; i++) {
      const { node, start } = list[i];
      const end = start + node.data.length;
      if (off < start) continue;
      if (off < end) return [node, off - start];
      if (off === end) {
        if (forward && i + 1 < list.length && (!caretAfter || sameLine(node, list[i + 1].node))) continue;
        return [node, off - start];
      }
    }
    return null;
  };
  const s = locate(offsets.start, true);
  if (!s) return null;
  const range = document.createRange();
  range.setStart(s[0], s[1]);
  if (caretAfter && s[1] === s[0].data.length) {
    // Last text of its line: step out of the inline elements it ends (link,
    // bold, chip...), never out of the line or a code block
    const [node] = s;
    const block = blockOf(node, root);
    if (!block || block.tagName !== 'PRE') {
      const rest = document.createRange();
      let top = null;
      for (let el = node.parentElement; el && el !== root && !BLOCK_TAGS.has(el.tagName); el = el.parentElement) {
        rest.setStart(node, node.data.length);
        rest.setEnd(el, el.childNodes.length);
        if (rest.toString().length || rest.cloneContents().querySelector('br, img, hr')) break;
        top = el;
      }
      if (top) range.setStartAfter(top);
    }
  }
  if (caretAfter || offsets.end === offsets.start) { range.collapse(true); return range; }
  const e = locate(offsets.end, false);
  if (!e) return null;
  range.setEnd(e[0], e[1]);
  return range;
}

// Outermost contenteditable holding node (the editor)
function editableRoot(node) {
  let root = elementOf(node);
  root = root && root.closest('[contenteditable="true"]');
  while (root && root.parentElement && root.parentElement.closest('[contenteditable="true"]')) {
    root = root.parentElement.closest('[contenteditable="true"]');
  }
  return root;
}

function htmlTextLength(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent.length;
}

export function listItemOf(node, editor) {
  return closestIn(node, 'li', editor);
}

export function isInCode(node, editor) {
  return !!closestIn(node, 'pre, code', editor);
}

export function isInChecklistItem(node, editor) {
  const li = listItemOf(node, editor);
  return !!(li && li.parentElement && li.parentElement.tagName === 'UL' && li.parentElement.classList.contains('checklist'));
}

// Text of the current block before the caret (for typed triggers)
export function textBeforeCaret(range, editor, max = 200) {
  if (!range) return '';
  const block = blockOf(range.startContainer, editor) || editor;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch { return ''; }
  const text = pre.toString();
  return text.length > max ? text.slice(-max) : text;
}

// --- execCommand wrapper ----------------------------------------------------
// execCommand fires input events synchronously; editor.js skips its input
// hooks while one of ours is running, so rules never re-fire on our own edits.
// Re-entrancy guard: an exec() asked for from inside another one (an input
// listener reacting to our own edit) is refused instead of nesting, because
// a nested execCommand corrupts the undo step (Chrome may also drop it).
let execDepth = 0;

export function isExecuting() { return execDepth > 0; }

export function exec(command, value = null) {
  if (execDepth > 0) {
    console.warn('[writing] nested execCommand refused:', command);
    return false;
  }
  execDepth++;
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  } finally {
    execDepth--;
  }
}

export function insertHTML(html) { return exec('insertHTML', html); }
export function insertText(text) { return exec('insertText', text); }

// --- Undo-safe inline wrap / unwrap (insertHTML) -------------------------------
// Chrome's insertHTML has two habits that damage content:
// - spaces at the edges of the inserted fragment (or right next to it) become
//   &nbsp; ("alpha <code>beta</code>" -> "alpha&nbsp;<code>beta</code>");
// - a fragment that ENDS with an inline element at the end of a line is
//   re-serialized: <code>/<mark> come back as <span style="font-family...">.
// So the replaced range is padded out to the nearest visible character on
// each side (through adjacent text nodes of the same parent) and those
// characters are re-inserted, and an inline element that would end the
// fragment gets a trailing U+200B.
const PAD_SPACE = /[ \u00A0\u200B]/; // spaces, and the zero-width spacers left after marks

// Text before (node, offset) back to and including one visible character
// (spaces may sit in their own text node, e.g. after removeFormat: the scan
// continues through adjacent text siblings; only spaces -> null, since
// re-inserting them would not help)
function padBefore(node, offset) {
  if (node && node.nodeType === Node.ELEMENT_NODE) { // (el, k): the text just before child k
    const prev = node.childNodes[offset - 1];
    if (!prev || prev.nodeType !== Node.TEXT_NODE) return null;
    node = prev;
    offset = prev.data.length;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  let n = node, i = offset;
  for (;;) {
    while (i > 0 && PAD_SPACE.test(n.data[i - 1])) i--;
    if (i > 0) break;
    const prev = n.previousSibling;
    if (!prev || prev.nodeType !== Node.TEXT_NODE) return null;
    n = prev;
    i = n.data.length;
  }
  i--;
  const r = document.createRange();
  r.setStart(n, i);
  r.setEnd(node, offset);
  return { node: n, offset: i, text: r.toString() };
}

// Text after (node, offset) up to and including one visible character
function padAfter(node, offset) {
  if (node && node.nodeType === Node.ELEMENT_NODE) { // (el, k): the text starting at child k
    const next = node.childNodes[offset];
    if (!next || next.nodeType !== Node.TEXT_NODE) return null;
    node = next;
    offset = 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  let n = node, i = offset;
  for (;;) {
    while (i < n.data.length && PAD_SPACE.test(n.data[i])) i++;
    if (i < n.data.length) break;
    const next = n.nextSibling;
    if (!next || next.nodeType !== Node.TEXT_NODE) return null;
    n = next;
    i = 0;
  }
  i++;
  const r = document.createRange();
  r.setStart(node, offset);
  r.setEnd(n, i);
  return { node: n, offset: i, text: r.toString() };
}

function selectRange(range) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// insertHTML(padded html) over r, then select html's text (opts.select) or put
// the caret right after html + tail. Placed by text offsets from the editor
// start, so it doesn't matter how Chrome split or merged the text nodes.
function insertPadded(r, pre, html, tail, post, select) {
  const root = editableRoot(r.startContainer);
  const base = root ? rangeToOffsets(r, root) : null;
  selectRange(r);
  const ok = exec('insertHTML', escapeHtml(pre ? pre.text : '') + html + tail + escapeHtml(post ? post.text : ''));
  if (!ok || !base || !root.isConnected) return ok;
  const start = base.start + (pre ? pre.text.length : 0);
  const end = start + htmlTextLength(html);
  const back = select
    ? offsetsToRange(root, { start, end })
    : offsetsToRange(root, { start: end + tail.length, end: end + tail.length }, { caretAfter: true });
  if (back) selectRange(back);
  return ok;
}

// Replace range with html in one undo step without the damage above.
// opts.zwsp: 'auto' (default: a U+200B after a trailing inline element when no
// text follows), 'always' (keeps typing outside, like the highlighter always
// did) or 'never'. opts.select: leave html's text selected (so the same
// command toggles it back, like Ctrl+B); otherwise the caret ends right after
// html (after the U+200B when one was added).
export function replaceRangeHtml(range, html, opts = {}) {
  if (!range) return false;
  const pre = padBefore(range.startContainer, range.startOffset);
  const post = padAfter(range.endContainer, range.endOffset);
  const zwsp = opts.zwsp || 'auto';
  const tail = zwsp === 'always' || (zwsp === 'auto' && !post && /<\/[a-z][a-z0-9]*>$/i.test(html)) ? '\u200B' : '';
  const r = document.createRange();
  if (pre) r.setStart(pre.node, pre.offset); else r.setStart(range.startContainer, range.startOffset);
  if (post) r.setEnd(post.node, post.offset); else r.setEnd(range.endContainer, range.endOffset);
  return insertPadded(r, pre, html, tail, post, !!opts.select);
}

// Replace an inline element (mark, code, s...) by its content in ONE undo
// step. insertHTML over the element alone re-creates it (Chrome keeps the
// style of what it replaces), so the replaced range reaches into the text
// next to it (padded as above) and that text is re-inserted. An element alone
// on its line is replaced by a bare <span> (Chrome drops it, and the style).
// Returns 'exec' (undoable), 'manual' (DOM surgery: caller must notifyChange)
// or false.
export function unwrapInline(el) {
  if (!el || !el.parentNode) return false;
  const prev = el.previousSibling;
  const next = el.nextSibling;
  if (el.textContent) {
    const pre = prev && prev.nodeType === Node.TEXT_NODE ? padBefore(prev, prev.data.length) : null;
    const post = next && next.nodeType === Node.TEXT_NODE ? padAfter(next, 0) : null;
    const range = document.createRange();
    if (pre || post) {
      if (pre) range.setStart(pre.node, pre.offset); else range.setStartBefore(el);
      if (post) range.setEnd(post.node, post.offset); else range.setEndAfter(el);
    } else {
      range.selectNode(el);
    }
    // The unwrapped text stays selected (the same command wraps it again)
    const html = pre || post ? el.innerHTML : `<span>${el.innerHTML}</span>`;
    if (insertPadded(range, pre, html, '', post, true)) return 'exec';
  }
  const parent = el.parentNode;
  const last = el.lastChild;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  if (last) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return 'manual';
}

export function queryState(command) {
  try { return document.queryCommandState(command); } catch { return false; }
}

// --- Caret geometry --------------------------------------------------------

function usableRect(rect) {
  return rect && (rect.width > 0 || rect.height > 0) && !(rect.top === 0 && rect.left === 0 && rect.height === 0);
}

// Viewport rect of the caret / range. A collapsed range in an empty line has
// no rects, so fall back to the neighbouring character, then the block.
export function caretRect(range, editor) {
  if (!range) return editor ? editor.getBoundingClientRect() : null;
  const rects = range.getClientRects();
  if (rects.length && usableRect(rects[rects.length - 1])) {
    const r = range.collapsed ? rects[0] : range.getBoundingClientRect();
    if (usableRect(r)) return r;
  }
  const r0 = range.getBoundingClientRect();
  if (usableRect(r0)) return r0;
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE && node.data.length) {
    const probe = document.createRange();
    if (offset > 0) {
      probe.setStart(node, offset - 1); probe.setEnd(node, offset);
      const r = probe.getBoundingClientRect();
      if (usableRect(r)) return new DOMRect(r.right, r.top, 0, r.height);
    } else {
      probe.setStart(node, 0); probe.setEnd(node, 1);
      const r = probe.getBoundingClientRect();
      if (usableRect(r)) return new DOMRect(r.left, r.top, 0, r.height);
    }
  }
  const block = blockOf(node, editor) || elementOf(node) || editor;
  if (block) {
    const r = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18;
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padTop = parseFloat(style.paddingTop) || 0;
    return new DOMRect(r.left + padLeft, r.top + padTop, 0, Math.min(lh, r.height || lh));
  }
  return null;
}

// --- Misc -----------------------------------------------------------------

export function isMod(e, mac) {
  return mac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
}

// Is el (or its shadow host) a typing target? Used by global key guards
export function isTypingTarget(el) {
  let node = el;
  while (node && node.shadowRoot && node.shadowRoot.activeElement) node = node.shadowRoot.activeElement;
  if (!node || !node.tagName) return false;
  if (node.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || !!node.closest?.('emoji-picker');
}
