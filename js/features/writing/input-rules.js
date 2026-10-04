// Personal Dashboard - Writing: markdown input rules (spec 7.1)
// Typing converts as you go: "# " "## " "### " headings, "- " / "* " bullets,
// "1. " numbers, "[] " / "[ ] " / "[x] " checklist, "> " quote, "---" divider
// (FULL editors also ``` code block, "!! " / "<> " callouts, "+ " toggle);
// **bold** *italic* ~~strike~~ `code` ==highlight== [text](url) on the closing
// delimiter; smart typography (-> → etc., pref smartTypography).
//
// Matching is pure (core/writing-rules.js). This side reads the caret's line,
// stays out of code, IME composition and pills, and edits only through
// execCommand, so Ctrl+Z works. Block rules use the registered commands (an
// unregistered one, e.g. codeBlock before blocks.js, simply doesn't fire);
// lists are made here so a new list never merges into a neighbouring list of
// another kind (Chrome merges any adjacent <ul>s, checklist or not).
//
// Backspace (or Ctrl+Z) right after a conversion, before any other key, gives
// back exactly what was typed: the conversion's steps are undone one by one
// until the typed text is back (its input events bound how many there are).
// A "\" before a marker keeps it as typed: block markers drop the backslash at
// once; inline / typography escapes drop it when the word is finished (next
// Space or Enter), except "\_" (so ¯\_(ツ)_/¯ keeps its backslash). Dropping
// a backslash is not a conversion: Backspace after it deletes as usual.

import { matchBlockTrigger, matchInlineTrigger, matchTypography, isEscapedAt, TYPOGRAPHY_RULES } from '../../core/writing-rules.js';

let api = null;
let dom = null;

const OBJ = '\uFFFC';   // a pill / chip / image / inline code in the line text: rules never reach into it
// Characters that can complete a rule (anything else is skipped at once)
const TRIGGER_CHARS = new Set([' ', '\u00A0', '-', '>', '=', ')', '*', '_', '~', '`']);
const INLINE_CHARS = '*_~=`)';
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn', 'OS', 'Hyper', 'Super', 'NumLock', 'ScrollLock']);
const LIST_KINDS = { bulletList: 'ul', numberedList: 'ol', checklist: 'checklist' };
const INLINE_TAGS = { bold: 'b', italic: 'i', strike: 's' };
// The same mark already inside the wrapped text is folded into the new one
const SAME_MARK = { bold: 'b, strong', italic: 'i, em', strike: 's, strike, del', highlight: 'mark.text-highlight', link: 'a' };
// Elements that hold lines rather than being one: their own text is never a block rule's line
const CONTAINERS = '.wr-callout, .wr-toggle, .wr-toggle-body, .wr-toggle-title';
const OPAQUE = 'code, img, svg, video, iframe, input, [contenteditable="false"]';
const BLOCK_ELEMENTS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'HR', 'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE', 'FIGURE']);
// "<-" then ">" reads "←>" (and "<=" then ">" reads "≤>"): Backspace gives back what was typed
const CHAINED = { '←>': '<-', '≤>': '<=' };

// The last conversion, while Backspace / Ctrl+Z may still revert it
let last = null;
// editor -> count of its changes (api.hooks.change: every input, ours too, and
// notifyChange): a cheap "still untouched" test, the document is never serialized
const changeCount = new WeakMap();
// Escapes that stopped an inline / typography rule: editor -> [{ node, offset, ch }]
const escapes = new WeakMap();

const norm = (s) => String(s || '').replace(/\u00A0/g, ' ');

function safe(fn, fallback = false) {
  try { return fn(); } catch (err) { console.error('[writing] input rule failed', err); return fallback; }
}

// --- Caret and offsets -----------------------------------------------------------

function caretOffsets(editor) {
  const r = dom.getSelectionRange(editor);
  return r ? dom.rangeToOffsets(r, editor) : null;
}

// Caret at a text offset from the editor start, leaning back (the end of the
// previous text, never the start of the next line)
function placeCaretAt(editor, off) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let pos = 0, lastNode = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length;
    if (off <= pos + len && (off > pos || (off === 0 && pos === 0))) { dom.placeCaret(n, off - pos); return true; }
    pos += len;
    lastNode = n;
  }
  if (lastNode) { dom.placeCaret(lastNode, lastNode.data.length); return true; }
  dom.placeCaretAtEnd(editor);
  return false;
}

function selectBetween(a, b) {
  const r = document.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(b[0], b[1]);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

// --- The caret's line ------------------------------------------------------------
// Text from the line start up to the caret, plus a map back to the DOM.
// <br> and nested blocks read as "\n"; pills, chips, images and inline code as
// one OBJ character each. Text straight in the editor (Chrome's first line, or
// a line left bare by unlisting) is the run of inline siblings around the caret.

function lineNodes(editor, block, caretNode, caretOffset) {
  if (block) return { root: block, nodes: [...block.childNodes] };
  let top = caretNode;
  if (caretNode === editor) top = editor.childNodes[caretOffset - 1] || editor.childNodes[caretOffset] || null;
  else top = dom.topBlockOf(caretNode, editor);
  if (!top) return { root: editor, nodes: [] };
  const isBreak = (n) => n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'BR' || BLOCK_ELEMENTS.has(n.tagName));
  let first = top;
  while (first.previousSibling && !isBreak(first.previousSibling)) first = first.previousSibling;
  const nodes = [];
  for (let n = first; n; n = n.nextSibling) {
    nodes.push(n);
    if (n === top) break;
  }
  return { root: editor, nodes };
}

function readLine(editor, range) {
  if (!range || !range.collapsed) return null;
  const caretNode = range.endContainer;
  const caretOffset = range.endOffset;
  const block = dom.blockOf(dom.anchorNode(range), editor);
  const { root, nodes } = lineNodes(editor, block, caretNode, caretOffset);
  const caret = document.createRange();
  caret.setStart(caretNode, caretOffset);
  const segs = [];
  const objs = []; // { at, el }: what each OBJ character stands for
  let text = '';
  let done = false;
  const push = (str, node, nodeStart = 0) => {
    if (!str) return;
    segs.push({ node, start: text.length, len: str.length, nodeStart });
    text += str;
  };
  const after = (el) => { try { return caret.comparePoint(el, 0) > 0; } catch { return false; } };
  const visit = (node) => {
    if (done) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === caretNode) { push(node.data.slice(0, caretOffset), node); done = true; return; }
      if (after(node)) { done = true; return; }
      push(node.data, node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.hasAttribute('data-wr-ephemeral')) return;
    const holdsCaret = node === caretNode || node.contains(caretNode);
    if (!holdsCaret) {
      if (after(node)) { done = true; return; }
      if (node.tagName === 'BR') { push('\n', null); return; }
      if (node.matches(OPAQUE)) { objs.push({ at: text.length, el: node }); push(OBJ, null); return; }
      if (BLOCK_ELEMENTS.has(node.tagName)) { push('\n', null); return; }
    } else if (node !== caretNode && node.matches(OPAQUE)) {
      done = true; // the caret is inside code / a pill: no rules here
      text += OBJ;
      return;
    }
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (node === caretNode && i === caretOffset) { done = true; return; }
      visit(kids[i]);
      if (done) return;
    }
    if (node === caretNode) done = true;
  };
  if (root === caretNode) {
    // Caret set on the line element itself: only the children before it count
    for (let i = 0; i < caretOffset && i < root.childNodes.length; i++) visit(root.childNodes[i]);
  } else {
    for (const n of nodes) { visit(n); if (done) break; }
  }
  return { editor, root, block, nodes, text, segs, objs, caret: { node: caretNode, offset: caretOffset } };
}

// DOM point for a text offset of the line. lean 'next' for range starts (the
// start of the following text at a boundary), 'prev' for range ends. Never
// a point inside an OBJ / line break.
function pointAt(line, off, lean) {
  let fallback = null;
  for (const s of line.segs) {
    if (!s.node || off < s.start || off > s.start + s.len) continue;
    const pt = [s.node, s.nodeStart + off - s.start];
    if (off > s.start && off < s.start + s.len) return pt;
    if (lean === 'next' && off === s.start) return pt;
    if (lean === 'prev' && off === s.start + s.len) return pt;
    if (!fallback) fallback = pt;
  }
  return fallback;
}

// Text after the caret to the end of the line (the divider fires only on an
// otherwise empty line)
function textAfter(line) {
  const r = document.createRange();
  try {
    r.setStart(line.caret.node, line.caret.offset);
    if (line.block) r.setEnd(line.block, line.block.childNodes.length);
    else {
      let end = line.nodes[line.nodes.length - 1] || line.caret.node;
      while (end.nextSibling && !(end.nextSibling.nodeType === Node.ELEMENT_NODE && (end.nextSibling.tagName === 'BR' || BLOCK_ELEMENTS.has(end.nextSibling.tagName)))) end = end.nextSibling;
      r.setEndAfter(end);
    }
  } catch { return ''; }
  return r.toString();
}

// --- Conversions and their revert ---------------------------------------------------

// Run fn, counting the input events it causes: one per DOM-changing
// execCommand, so at most that many undo steps (Chrome may merge a delete and
// an insertText that follow each other into one typing step)
function counted(editor, fn) {
  let steps = 0;
  const count = () => { steps++; };
  editor.addEventListener('input', count, true);
  let ok = false;
  try { ok = fn(); } catch (err) { console.error('[writing] input rule failed', err); ok = false; }
  finally { editor.removeEventListener('input', count, true); }
  return { ok, steps };
}

// Undo one step at a time (at most max) until the text is what was typed.
// Every conversion's first step changes the text (the marker or delimiters
// go), so the text matches again exactly when all of its steps are undone.
function undoUntil(editor, textBefore, max) {
  const target = norm(textBefore);
  let undone = 0;
  while (undone < max && norm(editor.textContent) !== target) {
    if (!dom.exec('undo')) break;
    undone++;
  }
  return { undone, ok: norm(editor.textContent) === target };
}

// Convert in one go and remember how to give the typed text back.
// extra: { restore?() (manual DOM to put back after the undo), chained?: literal,
//          revertible?: false (escapes: Backspace then deletes as usual) }
function applyConversion(editor, fn, extra = {}) {
  const textBefore = editor.textContent;
  const caretBefore = caretOffsets(editor);
  if (!caretBefore) return false;
  const res = counted(editor, fn);
  if (!res.ok) {
    // Half done (e.g. the marker deleted but the block command refused): put it back
    if (res.steps) { undoUntil(editor, textBefore, res.steps); placeCaretAt(editor, caretBefore.start); }
    return false;
  }
  if (!res.steps && !extra.restore) return false;
  if (extra.restore) api.notifyChange(editor); // a class changed by hand (no input event for it)
  if (extra.revertible === false) { last = null; return true; }
  const rec = {
    editor,
    steps: res.steps,
    textBefore,
    caretBefore,
    restore: extra.restore || null,
    chained: extra.chained || null,
    changes: -1,
    length: -1,
    caret: caretOffsets(editor)
  };
  last = rec;
  // The conversion's own change notice runs in a microtask queued before this
  // one, with the change listeners (they may touch the content: writing UI,
  // chip titles): "untouched" is the state once they are done
  queueMicrotask(() => {
    if (last !== rec || !editor.isConnected) return;
    rec.changes = changeCount.get(editor) || 0;
    rec.length = editor.textContent.length;
    rec.caret = caretOffsets(editor) || rec.caret;
  });
  return true;
}

// Still exactly as the conversion left it: no change since (no input, no
// command, no notifyChange), same text length, caret not moved
function fresh(rec, ctx) {
  if (!rec || !ctx || ctx.editor !== rec.editor || !rec.editor.isConnected) return false;
  const r = ctx.range;
  if (!r || !r.collapsed || rec.changes !== (changeCount.get(rec.editor) || 0)) return false;
  if (rec.editor.textContent.length !== rec.length) return false;
  const off = dom.rangeToOffsets(r, rec.editor);
  return !!(off && rec.caret && off.start === rec.caret.start);
}

// Give the typed text back. false when the undo stack didn't lead back to it
// (the conversion is then left as it was)
function revert(rec) {
  last = null;
  const { editor } = rec;
  const { undone, ok } = undoUntil(editor, rec.textBefore, rec.steps);
  if (!ok) {
    for (let i = 0; i < undone; i++) dom.exec('redo');
    return false;
  }
  if (rec.restore) safe(rec.restore);
  let caret = rec.caretBefore.start;
  if (rec.chained) {
    // "←>" -> "<->": the arrow typed first is spelled out again (one more undo step)
    const at = caret - 2;
    if (placeCaretAt(editor, at)) {
      const r = dom.getSelectionRange(editor);
      if (r && r.startContainer.nodeType === Node.TEXT_NODE && r.startContainer.data.length > r.startOffset) {
        const n = r.startContainer, o = r.startOffset;
        selectBetween([n, o], [n, o + 1]);
        if (dom.insertText(rec.chained)) caret += rec.chained.length - 1;
      }
    }
  }
  placeCaretAt(editor, caret);
  api.notifyChange(editor);
  return true;
}

// --- Block rules --------------------------------------------------------------------

function listKind(list) {
  if (list.tagName === 'OL') return 'ol';
  return list.classList.contains('checklist') ? 'checklist' : 'ul';
}

// Make the caret's line a list of kind 'ul' | 'ol' | 'checklist' (undoable).
// An item of another list is taken out first. Neighbouring lists of another
// kind are made non-editable for the command, so Chrome can't merge into them.
function listify(editor, kind, attrs = {}) {
  let ctx = api.context(editor);
  const item = dom.listItemOf(ctx.node, editor);
  if (item) {
    if (!dom.exec(item.parentElement.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList')) return false;
    ctx = api.context(editor);
    if (dom.listItemOf(ctx.node, editor)) return false;
  }
  if (!ctx.node) return false;
  const lineEl = dom.blockOf(ctx.node, editor) || ctx.node;
  const parent = lineEl === editor ? editor : lineEl.parentNode;
  const others = parent ? [...parent.children].filter(el => (el.tagName === 'UL' || el.tagName === 'OL') && !el.contains(lineEl) && listKind(el) !== kind) : [];
  const before = new Set(editor.querySelectorAll('ul, ol'));
  others.forEach(el => el.setAttribute('contenteditable', 'false'));
  let ok;
  try {
    ok = dom.exec(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
  } finally {
    others.forEach(el => el.removeAttribute('contenteditable'));
  }
  if (!ok) return false;
  const li = dom.listItemOf(api.context(editor).node, editor);
  if (!li) return false;
  const list = li.parentElement;
  if (kind === 'checklist') {
    // The class goes on a list the command just made (undo removes it with the list)
    if (!list.classList.contains('checklist')) {
      if (before.has(list)) return false;
      list.classList.add('checklist');
    }
    if (attrs.checked) li.classList.add('checked');
  }
  return true;
}

// List markers typed at the start of a list item. The item's own kind: the
// marker just goes ("- " out of habit in a bullet list), "[x] " / "[ ] " check
// or uncheck a checklist item. Another kind converts the item ("- [ ] ").
function planInList(ctx, li, m) {
  const kind = LIST_KINDS[m.command];
  if (!kind) return null;
  const list = li.parentElement;
  const checked = !!(m.attrs && m.attrs.checked);
  if (listKind(list) === kind) {
    if (kind !== 'checklist' || checked === li.classList.contains('checked')) return { run: () => true };
    return {
      run: () => { li.classList.toggle('checked', checked); return true; },
      restore: () => li.classList.toggle('checked', !checked)
    };
  }
  const nested = !!dom.closestIn(list.parentElement, 'li', ctx.editor);
  if (!nested && !li.querySelector('ul, ol')) return { run: () => listify(ctx.editor, kind, m.attrs || {}) };
  // A nested one-item bullet list <-> checklist: restyle it in place
  if (list.tagName === 'UL' && kind !== 'ol' && list.children.length === 1) {
    const toChecklist = kind === 'checklist';
    const wasChecked = li.classList.contains('checked');
    return {
      run: () => { list.classList.toggle('checklist', toChecklist); li.classList.toggle('checked', toChecklist && checked); return true; },
      restore: () => { list.classList.toggle('checklist', !toChecklist); li.classList.toggle('checked', wasChecked); }
    };
  }
  return null;
}

// How the matched marker converts here, or null when it doesn't (no side effects)
function planBlock(ctx, line, m) {
  const { editor } = ctx;
  const cmd = m.command;
  const block = line.block;
  if (block && block.matches(CONTAINERS)) return null;
  if (dom.closestIn(ctx.node, '.wr-toggle-title', editor)) return null;
  const li = dom.listItemOf(ctx.node, editor);
  if (li) return planInList(ctx, li, m);
  if (block && /^H[1-6]$/.test(block.tagName)) {
    // In a heading only another heading level applies
    if (!/^heading[1-3]$/.test(cmd) || block.tagName === 'H' + cmd.slice(-1)) return null;
  }
  if (dom.closestIn(ctx.node, 'td, th', editor) && !LIST_KINDS[cmd]) return null;
  if (cmd === 'quote' && dom.closestIn(ctx.node, 'blockquote', editor)) return null;
  if (/^callout/.test(cmd) && dom.closestIn(ctx.node, '.wr-callout', editor)) return null;
  if (LIST_KINDS[cmd]) return { run: () => listify(editor, LIST_KINDS[cmd], m.attrs || {}) };
  if (!api.hasCommand(cmd) || !api.isAvailable(cmd, ctx)) return null;
  const def = api.registry.getCommand(cmd);
  if (def && (!def.tiers.includes(ctx.tier) || (def.editors && !def.editors.includes(ctx.id)))) return null;
  return { run: () => api.runCommand(cmd, api.context(editor), { source: 'markdown', ...(m.attrs || {}) }) !== false };
}

// Delete the marker (undoable), then convert
function runBlock(ctx, line, m, plan) {
  const start = pointAt(line, line.text.length - m.deleteLength, 'next');
  if (!start) return false;
  const end = [line.caret.node, line.caret.offset];
  return applyConversion(ctx.editor, () => {
    selectBetween(start, end); // a selection change also closes the browser's typing step
    if (!dom.exec('delete')) return false;
    return plan.run();
  }, { restore: plan.restore });
}

// "\# " -> "# ": the backslash goes, the marker stays as typed
function blockEscape(ctx, line, index, opts) {
  const stripped = line.text.slice(0, index) + line.text.slice(index + 1);
  const m = matchBlockTrigger(stripped, opts);
  if (!m || m.escape || !planBlock(ctx, line, m)) return false;
  const a = pointAt(line, index, 'next');
  const b = pointAt(line, index + 1, 'prev');
  if (!a || !b) return false;
  const editor = ctx.editor;
  const caret = caretOffsets(editor);
  return applyConversion(editor, () => {
    selectBetween(a, b);
    const ok = dom.exec('delete');
    if (caret) placeCaretAt(editor, caret.start - 1);
    return ok;
  }, { revertible: false });
}

function tryBlock(ctx, line, trigger) {
  const text = line.text;
  if (trigger === 'char' && !text.endsWith('-')) return false;
  if (text.length > 28 || text.includes('\n') || text.includes(OBJ)) return false;
  const opts = { tier: ctx.tier || 'full', trigger, textAfterCaret: trigger === 'char' ? textAfter(line) : '' };
  const m = matchBlockTrigger(text, opts);
  if (!m) return false;
  if (m.escape) return blockEscape(ctx, line, m.index, opts);
  const plan = planBlock(ctx, line, m);
  return plan ? runBlock(ctx, line, m, plan) : false;
}

// Enter ends the word too: pending escapes drop their backslash first (the
// key then goes on as usual). ``` (+ language) then Enter -> code block
// (FULL; only when blocks.js registers it).
function onEnterKey(e, ctx) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const { editor } = ctx;
  if (!editor) return false;
  if (escapes.has(editor)) {
    safe(() => {
      const line = ctx.range && ctx.range.collapsed ? readLine(editor, ctx.range) : null;
      if (line) dropEscapes(ctx, line); else escapes.delete(editor);
    });
    ctx = api.context(editor);
  }
  if (e.shiftKey || ctx.tier !== 'full' || !api.hasCommand('codeBlock')) return false;
  if (!ctx.range || !ctx.range.collapsed || dom.isInCode(ctx.node, editor)) return false;
  return safe(() => {
    const line = readLine(editor, ctx.range);
    if (!line || !line.text.includes('```') || line.text.length > 28 || /[\n\uFFFC]/.test(line.text)) return false;
    const m = matchBlockTrigger(line.text, { tier: 'full', trigger: 'enter' });
    if (!m || m.escape || m.command !== 'codeBlock') return false;
    if (textAfter(line).replace(/[\s\u200B\uFEFF]/g, '')) return false;
    const plan = planBlock(ctx, line, m);
    return plan ? runBlock(ctx, line, m, plan) : false;
  });
}

// --- Inline rules ---------------------------------------------------------------------

function highlightColor() {
  // The highlighter's current color (its swatches are kept in sync across editors)
  const sw = document.querySelector('.highlighter-swatch.active');
  const name = sw ? String(sw.title || '').toLowerCase() : '';
  return /^(yellow|green|blue|pink|purple)$/.test(name) ? name : 'yellow';
}

function unwrapAll(holder, selector) {
  [...holder.querySelectorAll(selector)].reverse().forEach(el => el.replaceWith(...el.childNodes));
}

function wrapHtml(m, inner, line) {
  if (m.command === 'inlineCode') {
    // Code holds plain text (the zero-width spacers left after marks go)
    const code = line.text.slice(m.innerStart, m.innerEnd).replace(/[\u200B\uFEFF]/g, '');
    return code.trim() ? `<code>${dom.escapeHtml(code)}</code>` : null;
  }
  const holder = document.createElement('div');
  holder.appendChild(inner.cloneContents());
  if (!holder.textContent.replace(/[\s\u200B\uFEFF]/g, '')) return null;
  if (SAME_MARK[m.command]) unwrapAll(holder, SAME_MARK[m.command]);
  if (m.command === 'link') {
    return `<a href="${dom.escapeHtml(m.href)}" target="_blank" rel="noopener noreferrer">${holder.innerHTML}</a>`;
  }
  if (m.command === 'highlight') {
    return `<mark class="text-highlight" data-highlight-color="${highlightColor()}">${holder.innerHTML}</mark>`;
  }
  const tag = INLINE_TAGS[m.command];
  return tag ? `<${tag}>${holder.innerHTML}</${tag}>` : null;
}

// Inline code may sit inside a bold / italic / strike / highlight / link;
// anything else that is not text (pills, chips, images, a line break) stops it
function wrappable(line, m) {
  const span = line.text.slice(m.start, m.end);
  if (span.includes('\n')) return false;
  if (!span.includes(OBJ)) return true;
  if (m.command === 'inlineCode') return false;
  return line.objs.filter(o => o.at >= m.start && o.at < m.end)
    .every(o => o.el.tagName === 'CODE' && !o.el.closest('pre') && !o.el.querySelector('[contenteditable="false"], img'));
}

// Both points inside the same inline elements (link, bold, mark...). A match
// that starts inside one and ends outside it would cut it in two
function inlineChain(node, stop) {
  const chain = [];
  for (let el = dom.elementOf(node); el && el !== stop && !BLOCK_ELEMENTS.has(el.tagName); el = el.parentElement) chain.push(el);
  return chain;
}

function sameInline(a, b, stop) {
  const x = inlineChain(a, stop);
  const y = inlineChain(b, stop);
  return x.length === y.length && x.every((el, i) => el === y[i]);
}

// A "\" that stopped a match: remembered, dropped when the word is finished
function noteEscape(editor, line, b) {
  const pt = pointAt(line, b, 'next');
  if (!pt || pt[0].data[pt[1]] !== '\\') return;
  const ch = line.text[b + 1];
  const list = escapes.get(editor) || [];
  if (!list.some(x => x.node === pt[0] && x.offset === pt[1])) list.push({ node: pt[0], offset: pt[1], ch });
  escapes.set(editor, list.slice(-8));
}

function noteInlineEscape(editor, line) {
  const text = line.text;
  const from = Math.max(0, text.length - 500);
  for (let b = text.length - 2; b >= from; b--) {
    if (text[b] !== '\\' || isEscapedAt(text, b)) continue;
    const ch = text[b + 1];
    if (!'*~=`['.includes(ch)) continue; // not "\_": ¯\_(ツ)_/¯ keeps its backslash
    const m = matchInlineTrigger(text.slice(0, b) + text.slice(b + 1));
    if (m && b >= m.start && b < m.end) noteEscape(editor, line, b);
  }
}

function tryInline(ctx, line, ch) {
  if (!INLINE_CHARS.includes(ch)) return false;
  const m = matchInlineTrigger(line.text);
  if (!m) { noteInlineEscape(ctx.editor, line); return false; }
  if (!wrappable(line, m)) return false;
  if (m.command === 'link' && dom.closestIn(ctx.node, 'a', ctx.editor)) return false; // no link inside a link
  const start = pointAt(line, m.start, 'next');
  const innerStart = pointAt(line, m.innerStart, 'next');
  const innerEnd = pointAt(line, m.innerEnd, 'prev');
  if (!start || !innerStart || !innerEnd) return false;
  if (!sameInline(start[0], line.caret.node, line.root)) return false;
  const inner = document.createRange();
  inner.setStart(innerStart[0], innerStart[1]);
  inner.setEnd(innerEnd[0], innerEnd[1]);
  const html = wrapHtml(m, inner, line);
  if (!html) return false;
  const whole = document.createRange();
  whole.setStart(start[0], start[1]);
  whole.setEnd(line.caret.node, line.caret.offset);
  // One insertHTML step; the U+200B after it keeps typing outside the new mark
  return applyConversion(ctx.editor, () => dom.replaceRangeHtml(whole, html, { zwsp: 'always' }));
}

// --- Smart typography -----------------------------------------------------------------

function noteTypographyEscape(editor, line) {
  const text = line.text;
  for (const rule of TYPOGRAPHY_RULES) {
    if (rule.spaced || !text.endsWith(rule.from)) continue;
    const b = text.length - rule.from.length - 1;
    if (b >= 0 && text[b] === '\\' && !isEscapedAt(text, b) && matchTypography(text.slice(0, b) + text.slice(b + 1))) {
      noteEscape(editor, line, b);
      return;
    }
  }
}

function tryTypography(ctx, line) {
  if (api.prefs.get('smartTypography') === false) return false;
  const text = line.text;
  const t = matchTypography(text);
  if (!t) { noteTypographyEscape(ctx.editor, line); return false; }
  const n = text.length;
  const orig = text.slice(n - t.length);
  if (/[\n\uFFFC]/.test(orig)) return false;
  // Replace only what differs (" -- " keeps its spaces)
  let p = 0;
  while (p < orig.length && p < t.replace.length && orig[p] === t.replace[p]) p++;
  let s = 0;
  while (s < orig.length - p && s < t.replace.length - p && orig[orig.length - 1 - s] === t.replace[t.replace.length - 1 - s]) s++;
  const a = pointAt(line, n - t.length + p, 'next');
  const b = pointAt(line, n - s, 'prev');
  if (!a || !b || !sameInline(a[0], b[0], line.root)) return false;
  const insert = t.replace.slice(p, t.replace.length - s);
  const editor = ctx.editor;
  const caret = caretOffsets(editor);
  return applyConversion(editor, () => {
    selectBetween(a, b);
    const ok = dom.insertText(insert);
    // Back to the end of what was typed (after the kept space of " -- ")
    if (ok && caret && s) placeCaretAt(editor, caret.start + t.replace.length - t.length);
    return ok;
  }, { chained: CHAINED[orig] || null });
}

// --- Escapes dropped at the end of the word -------------------------------------------

// The list only ever holds escapes noted since the last Space / Enter, so
// they belong to the word just finished (its closing delimiter at least);
// each must still be in this line, before the caret, and unchanged
function dropEscapes(ctx, line) {
  const { editor } = ctx;
  const list = escapes.get(editor);
  if (!list || !list.length) return false;
  escapes.delete(editor);
  const valid = list.filter(x => x.node.isConnected && x.node.data[x.offset] === '\\' && x.node.data[x.offset + 1] === x.ch &&
    line.segs.some(s => s.node === x.node && x.offset >= s.nodeStart && x.offset + 1 < s.nodeStart + s.len));
  if (!valid.length) return false;
  // Last first, so earlier positions stay valid
  valid.sort((x, y) => {
    if (x.node === y.node) return y.offset - x.offset;
    return x.node.compareDocumentPosition(y.node) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
  });
  const caret = caretOffsets(editor);
  return applyConversion(editor, () => {
    let ok = true;
    valid.forEach(x => {
      selectBetween([x.node, x.offset], [x.node, x.offset + 1]);
      ok = dom.exec('delete') && ok;
    });
    if (caret) placeCaretAt(editor, caret.start - valid.length);
    return ok;
  }, { revertible: false });
}

// --- Hooks --------------------------------------------------------------------------

function evaluate(editor, data) {
  const ch = data[data.length - 1];
  if (!TRIGGER_CHARS.has(ch)) return false; // most keys: nothing to read
  const ctx = api.context(editor);
  if (!ctx.editor || !ctx.range || !ctx.range.collapsed || !ctx.node) return false;
  if (dom.isInCode(ctx.node, editor) || dom.closestIn(ctx.node, '[contenteditable="false"]', editor)) return false;
  const line = readLine(editor, ctx.range);
  if (!line || line.text.endsWith(OBJ)) return false;
  const space = ch === ' ' || ch === '\u00A0';
  return tryBlock(ctx, line, space ? 'space' : 'char') ||
    tryInline(ctx, line, ch) ||
    tryTypography(ctx, line) ||
    (space && dropEscapes(ctx, line));
}

function onInput(e, ctx) {
  last = null; // any edit ends the revert window
  if (!ctx.editor || e.isComposing || e.inputType !== 'insertText' || !e.data) return false;
  return safe(() => evaluate(ctx.editor, e.data));
}

// IME / Android keyboards: rules run once the composition is committed
function onCompositionEnd(e, ctx) {
  const editor = ctx.editor;
  const data = e.data || '';
  if (!editor || !data) return false;
  setTimeout(() => {
    if (!editor.isConnected || dom.isExecuting()) return;
    if (document.activeElement !== editor && !editor.contains(document.activeElement)) return;
    safe(() => evaluate(editor, data));
  }, 0);
  return false;
}

// Backspace / Ctrl+Z right after a conversion: give the typed text back.
// Runs before every other keydown hook (blocks.js unwraps a heading on
// Backspace at its start, which would otherwise win).
function onRevertKey(e, ctx) {
  if (!last || MODIFIER_KEYS.has(e.key)) return false;
  const back = e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey;
  const undo = String(e.key).toLowerCase() === 'z' && dom.isMod(e, ctx.mac) && !e.shiftKey && !e.altKey;
  const rec = last;
  last = null;
  if ((!back && !undo) || !fresh(rec, ctx)) return false;
  return safe(() => revert(rec)) === true;
}

// Undo from the browser menu, and Backspace on phone keyboards (their keydown
// carries no key, so only beforeinput tells), right after a conversion
function onBeforeInput(e, ctx) {
  if ((e.inputType !== 'historyUndo' && e.inputType !== 'deleteContentBackward') || !last || e.isComposing) return false;
  const rec = last;
  last = null;
  if (!fresh(rec, ctx)) return false;
  return safe(() => revert(rec)) === true;
}

function onSelection(evt, ctx) {
  if (!last) return false;
  if (ctx.editor !== last.editor) { last = null; return false; }
  const r = ctx.range;
  const off = r && r.collapsed ? dom.rangeToOffsets(r, ctx.editor) : null;
  if (!off || !last.caret || off.start !== last.caret.start) last = null;
  return false;
}

function onClick() {
  last = null;
  return false;
}

export function install(a) {
  api = a;
  dom = a.dom;
  api.hooks.keydown.unshift(onRevertKey);
  api.hooks.keydown.push(onEnterKey);
  api.hooks.input.push(onInput);
  api.hooks.beforeinput.push(onBeforeInput);
  api.hooks.selection.push(onSelection);
  api.hooks.click.push(onClick);
  api.hooks.composition.push(onCompositionEnd);
  api.hooks.change.push((editor) => { changeCount.set(editor, (changeCount.get(editor) || 0) + 1); });
}
