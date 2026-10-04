// Personal Dashboard - Writing: paste
// Clean paste (pasted HTML goes through the allowlist sanitizer), pasted
// Markdown turned into formatting with an Undo toast (pref markdownPaste),
// Ctrl+Shift+V for plain text, text-only paste inside code, and multi-line
// VS Code snippets as code blocks (full editors). Image files stay with
// rich-text-images.js (attachImageUpload); data: images inside pasted HTML go
// through its upload path afterwards (signed out they stay inline, as before).
// Everything is inserted with execCommand, so Ctrl+Z undoes a paste.

import { sanitizeRichHtml, markdownToHtml, looksLikeMarkdown, htmlToPlainText } from '../../core/markdown.js';
import { uploadPastedImages } from '../rich-text-images.js';

let api = null;
let dom = null;
let plainUntil = 0;   // Ctrl+Shift+V was pressed: the next paste is plain text
let changeSeq = 0;    // edits in any writing editor (guards the Undo toast)
let selectAll = null; // { editor, offsets }: the selection Ctrl+A made, until a click or a key moves it

const BLOCK_SEL = 'div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table, hr';
// Tells Chrome's paste that the fragment starts / ends with a line break, so
// its first block isn't merged into the line before it
const NEWLINE_MARK = '<br class="Apple-interchange-newline">';
const ZWSP = String.fromCharCode(0x200B);
const NBSP = String.fromCharCode(0xA0);
const EMPTY_TEXT = new RegExp('[\\s' + String.fromCharCode(0xA0, 0x200B, 0xFEFF) + ']', 'g');

// links.js asks before turning a pasted URL into a link
export function isPlainPasteArmed() { return Date.now() < plainUntil; }

// dom.replaceRangeHtml (one undo step, no &nbsp; at the edges), safe for a
// line that is the only child of the editor / a quote / a callout: when an
// insertHTML empties such a <div> (replaceRangeHtml also takes the character
// on each side), Chrome drops the <div> and the text lands straight in the
// container. There the whole line is replaced by a <div> holding its new
// content instead. opts.select leaves html's text selected; otherwise the
// caret ends right after it. Also used by links.js.
export function replaceInline(editor, range, html, opts = {}) {
  const line = dom.blockOf(range.startContainer, editor);
  const parent = line && line.parentNode;
  const alone = !!parent && line.tagName === 'DIV' && !line.attributes.length &&
    line === dom.blockOf(range.endContainer, editor) &&
    [...parent.childNodes].every(n => n === line || (n.nodeType === 3 && !n.data.trim()));
  if (!alone) return dom.replaceRangeHtml(range, html, opts);
  const base = dom.rangeToOffsets(range, editor);
  const wasEmpty = isEmptyLine(line);
  const head = document.createRange();
  head.selectNodeContents(line);
  head.setEnd(range.startContainer, range.startOffset);
  const tail = document.createRange();
  tail.selectNodeContents(line);
  tail.setStart(range.endContainer, range.endOffset);
  // Like replaceRangeHtml: a U+200B after a trailing inline element at the
  // end of the line keeps typing outside it
  const zwsp = opts.zwsp || 'auto';
  const pad = zwsp === 'always' || (zwsp === 'auto' && !hasContent(line, range.endContainer, range.endOffset, 'after') && /<\/[a-z][a-z0-9]*>$/i.test(html)) ? ZWSP : '';
  const holder = document.createElement('div');
  holder.appendChild(head.cloneContents());
  const mid = document.createElement('template');
  mid.innerHTML = html + pad;
  holder.appendChild(mid.content);
  holder.appendChild(tail.cloneContents());
  // Copies of live editing UI (image resize handles, writing UI) stay behind
  holder.querySelectorAll('[data-wr-ephemeral], .editor-img-resize-handle').forEach(el => el.remove());
  holder.querySelectorAll('.editor-img-resize-wrap').forEach(w => w.replaceWith(...w.childNodes));
  // The empty line's <br> placeholder goes once it has content
  if (wasEmpty && holder.lastChild && holder.lastChild.nodeName === 'BR' && holder.textContent) holder.lastChild.remove();
  const all = document.createRange();
  all.selectNodeContents(line);
  select(all);
  if (!dom.insertHTML(`<div>${holder.innerHTML}</div>`)) return false;
  if (base) {
    const len = textLength(html);
    const end = base.start + len + pad.length;
    const back = opts.select
      ? dom.offsetsToRange(editor, { start: base.start, end: base.start + len })
      : dom.offsetsToRange(editor, { start: end, end }, { caretAfter: true });
    if (back) select(back);
  }
  return true;
}

const normText = (s) => String(s || '').replace(/\r\n?/g, '\n');

function hasImageFile(data) {
  return [...(data.items || [])].some(item => item.kind === 'file' && item.type.startsWith('image/')) ||
    [...(data.files || [])].some(file => file.type.startsWith('image/'));
}

// VS Code puts its language mode on the clipboard: '' when absent
function vscodeMode(data) {
  if (!data.types || ![...data.types].includes('vscode-editor-data')) return null;
  try { return String(JSON.parse(data.getData('vscode-editor-data') || '{}').mode || '').toLowerCase(); } catch { return ''; }
}

const LANG_ALIASES = { javascript: 'js', typescript: 'ts', javascriptreact: 'jsx', typescriptreact: 'tsx', shellscript: 'sh', python: 'py', csharp: 'cs', plaintext: '' };
function codeBlockHtml(text, mode) {
  const lang = mode in LANG_ALIASES ? LANG_ALIASES[mode] : mode;
  const attr = /^[a-z0-9+#-]{1,20}$/.test(lang) ? ` data-lang="${lang}"` : '';
  return `<pre class="wr-code"${attr}><code>${dom.escapeHtml(text.replace(/\n+$/, ''))}</code></pre>`;
}

function select(range) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

const isPlainLine = (el) => !!el && el.tagName === 'DIV' && !el.className && !el.querySelector(BLOCK_SEL);
const isEmptyLine = (el) => isPlainLine(el) && !el.textContent.replace(EMPTY_TEXT, '') && !el.querySelector('img, [contenteditable="false"]');
// A pasted block Chrome must not merge with the line it lands in (code,
// callouts, lists, tables...): anything but a plain line or inline content
const isStructured = (n) => !!n && n.nodeType === 1 && n.matches(BLOCK_SEL) && !isPlainLine(n);

// Is there visible content between (node, offset) and the start / end of block?
function hasContent(block, node, offset, side) {
  const r = document.createRange();
  try {
    if (side === 'before') { r.selectNodeContents(block); r.setEnd(node, offset); } else { r.selectNodeContents(block); r.setStart(node, offset); }
  } catch { return true; }
  if (r.toString().replace(EMPTY_TEXT, '')) return true;
  const frag = r.cloneContents();
  return !!(frag.querySelector && frag.querySelector('img, hr, table, [contenteditable="false"]'));
}

function textLength(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent.length;
}

// Caret at a text offset of root, leaning back (end of the text before it)
function caretAtOffset(root, off) {
  if (off <= 0) return;
  const r = dom.offsetsToRange(root, { start: off - 1, end: off });
  if (!r) return;
  r.collapse(false);
  select(r);
}

// Top-level nodes of a fragment (whitespace-only text dropped)
function topNodes(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.childNodes].filter(n => n.nodeType === 1 || (n.nodeType === 3 && n.data.trim()));
}

// The fragment as inline HTML when it is one line (no blocks, or one plain div)
function inlineOnly(nodes) {
  if (!nodes.some(n => n.nodeType === 1 && n.matches(BLOCK_SEL))) {
    return nodes.map(n => (n.nodeType === 3 ? dom.escapeHtml(n.data) : n.outerHTML)).join('');
  }
  if (nodes.length === 1 && isPlainLine(nodes[0])) return nodes[0].innerHTML;
  return null;
}

// One entry per line (list items, plain lines, inline runs); null when the
// fragment holds blocks that can't become lines (tables, code, callouts...)
function flatLines(nodes) {
  const lines = [];
  let run = '';
  const flush = () => { if (run.trim()) lines.push({ html: run, checked: false }); run = ''; };
  for (const n of nodes) {
    if (n.nodeType === 3) { run += dom.escapeHtml(n.data); continue; }
    const tag = n.tagName;
    if (tag === 'UL' || tag === 'OL') {
      flush();
      for (const li of n.children) {
        if (li.tagName === 'LI') lines.push({ html: li.innerHTML, checked: li.classList.contains('checked') });
      }
      continue;
    }
    if (/^(DIV|P|H[1-6])$/.test(tag) && !n.className && !n.querySelector(BLOCK_SEL)) {
      flush();
      if (n.innerHTML.trim()) lines.push({ html: n.innerHTML, checked: false });
      continue;
    }
    if (!n.matches(BLOCK_SEL)) { run += n.outerHTML; continue; }
    return null;
  }
  flush();
  return lines.length ? lines : null;
}

// --- Inserting -------------------------------------------------------------------
// Insert pasted HTML at the selection. Returns { steps (undo steps used), line
// (the empty line it filled, for Undo) } or null.
function insertRich(ctx, html, plain) {
  const editor = ctx.editor;
  let range = dom.getSelectionRange(editor);
  if (!range) return null;
  let node = dom.anchorNode(range);
  const nodes = topNodes(html);
  if (!nodes.length) return null;
  // Ctrl+A that starts or ends in a toggle title: the paste replaces the
  // whole doc (a closed toggle's hidden body too), never lands in the title
  if (isSelectAll(editor, range) && (titleOf(range.startContainer, editor) || titleOf(range.endContainer, editor))) {
    const res = replaceDoc(ctx, nodes);
    if (res) return res;
  }
  // Headings and header cells: plain text (Chrome would add font-size /
  // font-weight spans to keep the pasted text looking like it did)
  if (dom.closestIn(node, 'h1, h2, h3, h4, h5, h6, th', editor)) {
    return dom.insertText(plain || htmlToPlainText(html)) ? { steps: 1, plain: true } : null;
  }
  // One line: replaceRangeHtml keeps the spaces around it (no &nbsp;) and
  // stops Chrome turning a trailing <code> / <mark> into a styled <span>
  const inline = inlineOnly(nodes);
  if (inline != null) return replaceInline(editor, range, inline) ? { steps: 1 } : null;
  // Toggle title: one line (the rest goes to the body). A triple-click also
  // selects the start of the next line: not part of the title selection
  const title = titleOf(node, editor);
  if (title && !range.collapsed && !title.contains(range.endContainer)) {
    const trimmed = dom.trimRangeEnd(range, editor);
    if (trimmed !== range && title.contains(trimmed.endContainer)) { select(trimmed); range = trimmed; }
  }
  if (title && (range.collapsed || title.contains(range.endContainer))) {
    const res = pasteInTitle(ctx, title, splitPasted(nodes));
    if (res) return res;
  }
  // Table cell: the lines stay in the cell, separated by line breaks
  if (dom.closestIn(node, 'td', editor)) {
    const lines = flatLines(nodes);
    const ok = lines ? dom.insertHTML(lines.map(l => l.html).join('<br>')) : dom.insertText(plain || htmlToPlainText(html));
    return ok ? { steps: 1 } : null;
  }
  // List item: lines become items of the same list
  if (dom.listItemOf(node, editor)) {
    const lines = flatLines(nodes);
    if (lines) {
      const items = lines.map(l => `<li${l.checked ? ' class="checked"' : ''}>${l.html}</li>`).join('');
      return dom.insertHTML(`<ul>${items}</ul>`) ? { steps: 1 } : null;
    }
  }
  // Blocks over a selection: Chrome's paste over a range nests them inside
  // the line (or drops it), so the selection goes first (one more undo step)
  let deleted = 0;
  if (!range.collapsed) {
    if (!dom.exec('delete')) return null;
    deleted = 1;
    range = dom.getSelectionRange(editor);
    if (!range) { dom.exec('undo'); return null; }
    node = dom.anchorNode(range);
  }
  const line = dom.blockOf(node, editor);
  const inTitle = deleted && titleOf(node, editor);
  const res = inTitle ? pasteInTitle(ctx, inTitle, splitPasted(nodes))
    : line && isEmptyLine(line) ? insertOnEmptyLine(editor, line, html) : insertBlocks(editor, range, html, nodes);
  if (!res) {
    if (deleted) dom.exec('undo');
    return null;
  }
  // After a delete, Undo puts the selection back itself (no line to return to)
  return deleted ? { steps: res.steps + deleted } : res;
}

// Blocks pasted into a line with text. Chrome merges the first pasted block
// into the line and the rest of the line into the last one, which mangles
// code blocks, callouts and toggles (styled spans, lost wrappers). So a
// structured first block gets a placeholder line in front (it merges instead,
// leaving a U+200B at the end of the line) and a structured last block with
// text after the caret gets a trailing newline (the rest stays its own line).
// Plain lines keep the usual paste behavior.
function insertBlocks(editor, range, html, nodes) {
  const startLine = dom.blockOf(range.startContainer, editor) || editor;
  const endLine = dom.blockOf(range.endContainer, editor) || editor;
  const pre = isStructured(nodes[0]) && hasContent(startLine, range.startContainer, range.startOffset, 'before') ? `<div>${ZWSP}</div>` : '';
  const post = isStructured(nodes[nodes.length - 1]) && hasContent(endLine, range.endContainer, range.endOffset, 'after') ? NEWLINE_MARK : '';
  const start = dom.rangeToOffsets(range, editor);
  if (!dom.insertHTML(pre + html + post)) return null;
  // After the trailing newline Chrome leaves the caret on the next line
  if (post && start) caretAtOffset(editor, start.start + textLength(pre + html));
  return { steps: 1 };
}

// Blocks pasted on an empty line. Chrome nests them inside that line's <div>
// unless the paste replaces the line and ends right before a line with text,
// so: the only line in the editor -> type a placeholder and paste over it
// (two undo steps); a text line follows -> replace [line, start of that line);
// otherwise first add a helper line (one undo step) that stays as the line
// after the paste.
function insertOnEmptyLine(editor, line, html) {
  const original = line;
  if (line.parentNode === editor && editor.children.length === 1 && !editor.textContent.replace(EMPTY_TEXT, '')) {
    dom.placeCaret(line, 0);
    if (!dom.insertText(ZWSP)) return dom.insertHTML(html) ? { steps: 1 } : null;
    const t = line.isConnected && line.firstChild && line.firstChild.nodeType === 3 && line.firstChild.data === ZWSP ? line.firstChild : null;
    if (t && editor.children.length === 1) {
      const r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 1);
      select(r);
      if (dom.insertHTML(html)) return { steps: 2, line: original };
    }
    dom.exec('undo'); // not the shape expected: take the placeholder back
    if (!line.isConnected) return dom.insertHTML(html) ? { steps: 1 } : null;
  }
  let steps = 0;
  let next = line.nextElementSibling;
  if (!isPlainLine(next) || isEmptyLine(next)) {
    dom.placeCaret(line, 0);
    if (!dom.insertText('\n' + ZWSP)) return dom.insertHTML(html) ? { steps: 1 } : null;
    steps = 1;
    next = line.isConnected ? line.nextElementSibling : null;
    if (!line.isConnected || !isEmptyLine(line) || !isPlainLine(next)) {
      // Not the shape expected: take the helper back, paste the usual way
      dom.exec('undo');
      return dom.insertHTML(html) ? { steps: 1 } : null;
    }
  }
  const before = document.createRange();
  before.selectNodeContents(editor);
  before.setEndBefore(line);
  const start = before.toString().length;
  const r = document.createRange();
  r.setStartBefore(line);
  r.setEnd(next, 0);
  select(r);
  if (!dom.insertHTML(html + NEWLINE_MARK)) {
    if (steps) dom.exec('undo'); // the helper line
    return null;
  }
  // Chrome leaves the caret on the next line: put it after the pasted text
  caretAtOffset(editor, start + textLength(html));
  return { steps: steps + 1, line: original };
}

// --- Toggle titles ---------------------------------------------------------------
// A toggle title is one line. Chrome splits it around pasted lines / blocks
// and leaves them between the title and the body (still shown when the toggle
// is closed), so blocks.js rewrites the toggle in one undo step instead.

function titleOf(node, editor) {
  const title = node ? dom.closestIn(node, '.wr-toggle-title', editor) : null;
  return title && title.parentElement && title.parentElement.classList.contains('wr-toggle') ? title : null;
}

// Is range still the selection Ctrl+A made in this editor?
function isSelectAll(editor, range) {
  if (!selectAll || selectAll.editor !== editor || range.collapsed) return false;
  // A paste right after Ctrl+A (before the timer below read the selection)
  // sees the selection the select-all made: a click or a key would have reset it
  if (!selectAll.offsets) selectAll.offsets = dom.rangeToOffsets(range, editor);
  if (!selectAll.offsets) return false;
  const now = dom.rangeToOffsets(range, editor);
  return !!now && now.start === selectAll.offsets.start && now.end === selectAll.offsets.end;
}

const isLineNode = (n) => n.nodeType === 1 && /^(DIV|P|H[1-6])$/.test(n.tagName) && !n.className && !n.querySelector(BLOCK_SEL);

// Copies of the pasted nodes as blocks (inline runs become lines)
function asBlocks(nodes) {
  const out = [];
  let run = null;
  for (const n of nodes) {
    if (n.nodeType === 1 && n.matches(BLOCK_SEL)) { run = null; out.push(n.cloneNode(true)); continue; }
    if (!run) { run = document.createElement('div'); out.push(run); }
    run.appendChild(n.cloneNode(true));
  }
  return out;
}

// { first: inline HTML that continues the caret's line, blocks: the rest }
function splitPasted(nodes) {
  let i = 0, first = '';
  while (i < nodes.length && !(nodes[i].nodeType === 1 && nodes[i].matches(BLOCK_SEL))) {
    first += nodes[i].nodeType === 3 ? dom.escapeHtml(nodes[i].data) : nodes[i].outerHTML;
    i++;
  }
  if (!first.trim() && i < nodes.length && isLineNode(nodes[i])) first = nodes[i++].innerHTML;
  return { first, blocks: asBlocks(nodes.slice(i)) };
}

// The caret marker at the end of the last block's last line (list item,
// cell, code, plain line), else on a new empty line after the blocks
function markEnd(blocks, caret) {
  const last = blocks[blocks.length - 1];
  const all = last ? [last, ...last.querySelectorAll('*')] : [];
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (el.tagName === 'PRE') { (el.querySelector('code') || el).appendChild(caret); return blocks; }
    if (/^(DIV|P|H[1-6]|LI|TD|TH)$/.test(el.tagName) && !el.querySelector(BLOCK_SEL) && !el.closest('pre')) {
      if (el.lastChild && el.lastChild.nodeName === 'BR' && el.childNodes.length > 1) el.lastChild.remove();
      el.appendChild(caret);
      return blocks;
    }
  }
  const line = document.createElement('div');
  line.append(caret, document.createElement('br'));
  return [...blocks, line];
}

const hasContentNodes = (frag) => !!frag.textContent.replace(EMPTY_TEXT, '') || !!(frag.querySelector && frag.querySelector('img, [contenteditable="false"]'));

// One plain-text line as HTML (spaces kept like insertText does)
const plainLineHtml = (line) => dom.escapeHtml(line).replace(/^ | (?= )| $/g, NBSP);

// Plain text lines as { first, blocks }
function splitText(text) {
  const lines = text.split('\n');
  return {
    first: plainLineHtml(lines[0]),
    blocks: lines.slice(1).map(line => {
      const div = document.createElement('div');
      div.innerHTML = plainLineHtml(line) || '<br>';
      return div;
    })
  };
}

// Lines / blocks ({ first, blocks }) pasted with the selection in a toggle
// title: the first line continues the title; the rest goes to the start of
// the body (open) or right after the toggle (closed: like Enter in a title),
// and the title's text after the selection follows it.
function pasteInTitle(ctx, title, { first, blocks }) {
  if (typeof api.rewriteBlock !== 'function') return null;
  const ok = api.rewriteBlock(ctx, title.parentElement, (holder, mark) => {
    const t = holder.firstElementChild;
    const ttl = t && t.querySelector(':scope > .wr-toggle-title');
    const body = t && t.querySelector(':scope > .wr-toggle-body');
    const marks = ttl ? [...ttl.querySelectorAll('wr-mark')] : [];
    if (!body || !marks.length) return false;
    holder.querySelectorAll('wr-mark').forEach(m => { if (!ttl.contains(m)) m.remove(); });
    const s = marks.find(m => m.getAttribute('data-k') !== 'e') || marks[0];
    const e = marks.find(m => m.getAttribute('data-k') === 'e') || s;
    const r = document.createRange();
    r.setStartAfter(e);
    r.setEnd(ttl, ttl.childNodes.length);
    const tail = r.extractContents();
    if (e !== s) { r.setStartAfter(s); r.setEndBefore(e); r.deleteContents(); }
    marks.forEach(m => m.remove());
    const head = document.createElement('template');
    head.innerHTML = first;
    ttl.appendChild(head.content);
    const caret = mark('c');
    let out = blocks;
    const last = out[out.length - 1];
    if (!out.length) {
      ttl.append(caret, tail);
    } else if (isLineNode(last)) {
      if (last.lastChild && last.lastChild.nodeName === 'BR') last.lastChild.remove();
      last.append(caret, tail);
      if (!hasContentNodes(last)) last.appendChild(document.createElement('br'));
    } else {
      out = markEnd(out, caret);
      if (hasContentNodes(tail)) {
        const line = document.createElement('div');
        line.appendChild(tail);
        out = [...out, line];
      }
    }
    if (!hasContentNodes(ttl)) ttl.appendChild(document.createElement('br'));
    if (t.getAttribute('data-open') === 'false') {
      t.after(...out);
    } else {
      // a new toggle's one empty body line gives way
      const only = body.children.length === 1 && isLineNode(body.firstElementChild) && !hasContentNodes(body.firstElementChild) ? body.firstElementChild : null;
      if (only) only.replaceWith(...out); else body.prepend(...out);
    }
  });
  return ok ? { steps: 1 } : null;
}

// Ctrl+A + paste over a doc that starts / ends with a toggle: the pasted
// blocks become the whole doc (one undo step)
function replaceDoc(ctx, nodes) {
  if (typeof api.rewriteBlock !== 'function') return null;
  const blocks = asBlocks(nodes);
  if (!blocks.length) return null;
  const ok = api.rewriteBlock(ctx, ctx.editor, (holder, mark) => {
    holder.replaceChildren(...markEnd(blocks, mark('c')));
  });
  return ok ? { steps: 1 } : null;
}

function pastePlain(ctx, text) {
  if (!text) return false;
  insertPlain(ctx.editor, text);
  return true;
}

// insertText, except lines into a toggle title: Chrome would split the title
// (the extra titles then land in the body in reverse order)
function insertPlain(editor, text) {
  const range = dom.getSelectionRange(editor);
  // Ctrl+A that starts or ends in a toggle title (a closed toggle's body is
  // hidden, so the selection is only its title): the lines replace the whole
  // doc, the hidden body too, like an HTML paste or Ctrl+A + typing
  if (range && text.includes('\n') && isSelectAll(editor, range) &&
      (titleOf(range.startContainer, editor) || titleOf(range.endContainer, editor))) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const nodes = topNodes(lines.map(line => `<div>${plainLineHtml(line) || '<br>'}</div>`).join(''));
    if (replaceDoc(api.context(editor), nodes)) return true;
  }
  const title = range && text.includes('\n') ? titleOf(dom.anchorNode(range), editor) : null;
  if (title && (range.collapsed || title.contains(range.endContainer)) && pasteInTitle(api.context(editor), title, splitText(text))) return true;
  return dom.insertText(text);
}

function pasteMarkdown(ctx, text) {
  const html = markdownToHtml(text);
  if (!html || dom.isEffectivelyEmpty(html)) return pastePlain(ctx, text);
  const editor = ctx.editor;
  const res = insertRich(ctx, html, text);
  if (!res) return pastePlain(ctx, text);
  if (res.plain) return true; // a heading takes the text as it was
  // After the paste's own change notification (queued as a microtask)
  queueMicrotask(() => {
    const record = { seq: changeSeq, after: dom.cleanEditorHtml(editor), steps: res.steps, line: res.line || null, text };
    api.actionToast('Pasted as formatted Markdown', [{ label: 'Undo', run: () => undoMarkdown(editor, record) }]);
  });
  return true;
}

// Undo = take the formatted paste back and insert the text as it was copied
function undoMarkdown(editor, rec) {
  if (!editor.isConnected) return;
  if (changeSeq !== rec.seq || dom.cleanEditorHtml(editor) !== rec.after) {
    api.toast('Can’t undo the formatting: the text changed since the paste');
    return;
  }
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  for (let i = 0; i < rec.steps; i++) dom.exec('undo');
  if (rec.line && rec.line.isConnected && editor.contains(rec.line)) dom.placeCaret(rec.line, 0);
  insertPlain(editor, rec.text);
  api.notifyChange(editor);
}

// --- Hooks -----------------------------------------------------------------------
function onKeydown(e, ctx) {
  const mod = dom.isMod(e, api.registry.isMac);
  const key = (e.key || '').toLowerCase();
  if (e.shiftKey && !e.altKey && (e.code === 'KeyV' || key === 'v') && mod) {
    plainUntil = Date.now() + 1500;
  }
  if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyA' || key === 'a')) {
    // Remember what the select-all selects (it happens after this handler)
    const editor = ctx && ctx.editor;
    selectAll = editor ? { editor, offsets: null } : null;
    if (editor) {
      setTimeout(() => {
        if (!selectAll || selectAll.editor !== editor || selectAll.offsets) return;
        const r = dom.getSelectionRange(editor);
        if (r) selectAll.offsets = dom.rangeToOffsets(r, editor);
        else selectAll = null; // the select-all didn't land in this editor
      }, 0);
    }
  } else if (!mod && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
    selectAll = null;
  }
  return false; // never consumed: the browser still fires the paste
}

function onPaste(e, ctx) {
  const data = e.clipboardData;
  const editor = ctx.editor;
  const plain = isPlainPasteArmed();
  plainUntil = 0;
  if (!data || !editor || !dom.getSelectionRange(editor)) return false;
  const text = normText(data.getData('text/plain'));
  const html = data.getData('text/html') || '';
  if (!text.trim() && hasImageFile(data)) return false; // image files: attachImageUpload
  if (!text && !html.trim()) return false;
  const node = ctx.node;
  const asText = () => text || htmlToPlainText(html);

  // Code: always the text as copied
  if (dom.closestIn(node, 'pre', editor)) {
    const t = asText();
    if (t) dom.insertHTML(dom.escapeHtml(t));
    return true;
  }
  if (dom.closestIn(node, 'code', editor)) return pastePlain(ctx, asText().replace(/\s*\n\s*/g, ' '));
  if (plain) return pastePlain(ctx, asText());

  const mode = vscodeMode(data);
  if (mode != null && text) {
    if (mode === 'markdown' && api.prefs.get('markdownPaste') && looksLikeMarkdown(text)) return pasteMarkdown(ctx, text);
    if (ctx.tier === 'full' && text.trim().includes('\n') && !['markdown', 'plaintext', ''].includes(mode)) {
      return insertRich(ctx, codeBlockHtml(text, mode), text) ? true : pastePlain(ctx, text);
    }
    return pastePlain(ctx, text);
  }

  if (html.trim()) {
    const clean = sanitizeRichHtml(html);
    if (dom.isEffectivelyEmpty(clean)) return text ? pastePlain(ctx, text) : false;
    // HTML that is only lines of text (a plain editor's copy): Markdown wins
    if (text && !/<(?!\/?(div|br)\b)[a-z]/i.test(clean) && api.prefs.get('markdownPaste') && looksLikeMarkdown(text)) return pasteMarkdown(ctx, text);
    if (!insertRich(ctx, clean, text)) return pastePlain(ctx, text);
    if (/<img\b[^>]*\ssrc="data:image\//i.test(clean)) setTimeout(() => uploadPastedImages(editor), 0);
    return true;
  }
  if (api.prefs.get('markdownPaste') && looksLikeMarkdown(text)) return pasteMarkdown(ctx, text);
  return pastePlain(ctx, text);
}

export function install(a) {
  api = a;
  dom = a.dom;
  api.hooks.keydown.push(onKeydown);
  api.hooks.paste.push(onPaste);
  api.hooks.click.push(() => { selectAll = null; return false; });
  api.hooks.load.push(() => { selectAll = null; });
  api.hooks.change.push(() => { changeSeq++; selectAll = null; });
}
