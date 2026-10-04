// Personal Dashboard - Writing features core
// attachWritingFeatures(editor, opts) gives one of the 6 rich-text editors the
// shared writing engine: capture-phase key dispatch (registry shortcuts +
// module hooks), link-click handling, the toolbar additions (block style,
// strike / code / link, Insert menu, document tools with a ⋯ overflow), the
// basic commands, preferences, and the hook points stage-2 modules use.
// attachWritingView(viewEl, opts) does the read-only side (task / ideas /
// meetings views, note viewer).
//
// Modules (menus, blocks, input-rules, links, paste, find, doc-tools, focus,
// export, help, refs) each export install(api); they run once, in
// that order, the first time anything attaches (never at import time, so the
// edit-mode <-> editor import cycle stays safe).
//
// Command contract: api.registerCommand(id, { run(ctx, arg), isActive?(ctx),
// isAvailable?(ctx) }). run returns false when it did nothing (then a key is
// left to the browser); anything else counts as handled. arg is an object
// with at least { source: 'key' | 'toolbar' | 'menu' | 'slash' | 'context' }
// and, from the toolbar, { anchor: <button> }.
// Hook contract: api.hooks.<name>.push(fn); fn(event, ctx) returns true when
// it consumed the event (core then preventDefault + stopImmediatePropagation
// for keydown / click / paste / beforeinput). Extra hooks beyond the event
// ones: hooks.load (editor content was (re)loaded: fn(editor, ctx)) and
// hooks.change (after input / notifyChange: fn(editor, ctx)).

import { WRITING_COMMANDS, getCommand, matchKeyEvent, formatKeys, formatKeysText, keyHint, commandTitle, isMacPlatform, commandsFor, slashItemsFor, buildWritingHelp } from '../../core/writing-commands.js';
import * as dom from './dom.js';
import * as ui from './ui.js';
import { showToast } from '../../utils.js';
import { toggleChecklist, applyHighlightToSelection, removeHighlightFromSelection } from '../edit-mode.js';
import { install as installMenus } from './menus.js';
import { install as installBlocks } from './blocks.js';
import { install as installInputRules } from './input-rules.js';
import { install as installLinks } from './links.js';
import { install as installPaste } from './paste.js';
import { install as installFind } from './find.js';
import { install as installDocTools } from './doc-tools.js';
import { install as installFocus } from './focus.js';
import { install as installExport } from './export.js';
import { install as installHelp } from './help.js';
import { install as installRefs } from './refs.js';

const MODULES = [
  ['menus', installMenus], ['blocks', installBlocks], ['input-rules', installInputRules],
  ['links', installLinks], ['paste', installPaste], ['find', installFind], ['doc-tools', installDocTools],
  ['focus', installFocus], ['export', installExport], ['help', installHelp],
  ['refs', installRefs]
];

const MAC = isMacPlatform();
const DOC_EDITORS = ['projects', 'meetings', 'task', 'ideas'];
// Mod+F / H / P are only taken inside FULL editors
const FULL_ONLY_KEYS = new Set(['find', 'replace', 'exportPdf']);

// --- Preferences (per browser) ---------------------------------------------
const PREFS_KEY = 'dashboard_writing_prefs';
const PREF_DEFAULTS = { smartTypography: true, autolink: true, markdownPaste: true, statusBar: true, typewriter: false };
const prefListeners = [];
let prefCache = null;

function readPrefs() {
  if (prefCache) return prefCache;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { stored = {}; }
  prefCache = { ...PREF_DEFAULTS, ...(typeof stored === 'object' ? stored : {}) };
  return prefCache;
}

const prefs = {
  defaults: { ...PREF_DEFAULTS },
  get(key) { return readPrefs()[key]; },
  all() { return { ...readPrefs() }; },
  set(key, value) {
    const next = { ...readPrefs(), [key]: value };
    prefCache = next;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private window */ }
    prefListeners.forEach(fn => { try { fn(key, value, next); } catch (err) { console.error(err); } });
  },
  onChange(fn) { prefListeners.push(fn); }
};

// --- Action toast (lazy: avoids a static import cycle with quick-capture.js)
let qcModule = null;
function actionToast(message, actions) {
  if (qcModule) return qcModule.showActionToast(message, actions);
  import('../quick-capture.js').then(m => { qcModule = m; m.showActionToast(message, actions); }).catch(() => showToast(message));
}

// --- State -----------------------------------------------------------------
const commands = new Map();          // id -> { run, isActive?, isAvailable? }
const states = new WeakMap();        // editor -> state
const viewStates = new WeakMap();    // view element -> state
const liveEditors = new Set();       // attached editors (pruned when they leave the DOM)
const attachFns = [];
const viewAttachFns = [];
let lastEditor = null;
let installed = false;

const hooks = { keydown: [], input: [], beforeinput: [], selection: [], click: [], paste: [], composition: [], load: [], change: [] };

// Forget editors that left the DOM (meetings rebuilds its editor on every
// edit open) and stop observing their toolbars
function pruneEditors() {
  liveEditors.forEach(ed => {
    if (ed.isConnected) return;
    liveEditors.delete(ed);
    const st = states.get(ed);
    if (st && st.observing && toolbarObserver && st.opts.toolbar) {
      toolbarObserver.unobserve(st.opts.toolbar);
      st.observing = false;
    }
  });
}

function safeCall(fn, ...args) {
  try { return fn(...args); } catch (err) { console.error('[writing]', err); return false; }
}

function consume(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

// --- Context -----------------------------------------------------------------
function activeEditor() {
  if (lastEditor && lastEditor.isConnected) return lastEditor;
  pruneEditors();
  const focused = document.activeElement;
  for (const ed of liveEditors) if (ed === focused || ed.contains(focused)) return ed;
  return null;
}

function editorForNode(node) {
  if (!node) return null;
  pruneEditors();
  for (const ed of liveEditors) if (ed === node || ed.contains(node)) return ed;
  return null;
}

function context(editor) {
  const ed = editor || activeEditor();
  const st = ed ? states.get(ed) : null;
  const sel = window.getSelection();
  const range = ed ? dom.getSelectionRange(ed) : null;
  const node = range ? dom.anchorNode(range) : null; // caret node (element-level ranges resolved)
  return {
    editor: ed,
    opts: st ? st.opts : {},
    id: st ? st.opts.id : null,
    tier: st ? st.opts.tier : null,
    features: st ? st.features : {},
    sel,
    range,
    node,
    block: node ? dom.blockOf(node, ed) : null,
    mac: MAC,
    view: false,
    api
  };
}

function viewContext(viewEl) {
  const vs = viewStates.get(viewEl);
  return { editor: null, viewEl, opts: vs ? vs.opts : {}, id: vs ? vs.opts.id : null, tier: null, sel: window.getSelection(), range: null, block: null, mac: MAC, view: true, api };
}

// Selection inside the editor, or put one back (last caret, else the end)
function ensureSelection(editor) {
  if (!editor) return;
  if (dom.getSelectionRange(editor)) {
    if (document.activeElement !== editor && !editor.contains(document.activeElement)) {
      try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
    }
    return;
  }
  const st = states.get(editor);
  const saved = st && st.lastRange;
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  if (saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) {
    dom.restoreRange(saved, editor);
  } else {
    dom.placeCaretAtEnd(editor);
  }
}

// --- Commands ----------------------------------------------------------------
function registerCommand(id, impl) {
  if (!id || !impl || typeof impl.run !== 'function') return;
  commands.set(id, impl);
  if (installed) scheduleToolbarRebuild();
}

function hasCommand(id) { return commands.has(id); }

function isAvailable(id, ctx) {
  const impl = commands.get(id);
  if (!impl) return false;
  if (!impl.isAvailable) return true;
  return !!safeCall(impl.isAvailable, ctx || context());
}

function runCommand(id, ctx, arg) {
  const impl = commands.get(id);
  if (!impl) return false;
  const c = ctx || context();
  if (impl.isAvailable && !safeCall(impl.isAvailable, c)) return false;
  let result;
  try {
    result = impl.run(c, arg || { source: 'api' });
  } catch (err) {
    console.error('[writing] command failed:', id, err);
    return false;
  }
  if (c.editor) scheduleRefresh(c.editor);
  return result !== false;
}

function notifyChange(editor) {
  const ed = editor || activeEditor();
  const st = ed && states.get(ed);
  if (!st) return;
  if (st.opts.onChange) safeCall(st.opts.onChange);
  queueChange(ed);
}

function notifyLoad(editor) {
  const ed = editor || activeEditor();
  const st = ed && states.get(ed);
  if (!st) return;
  const ctx = context(ed);
  bumpGeneration(st);
  hooks.load.forEach(fn => safeCall(fn, ed, ctx));
  resetUndo(st);
  scheduleRefresh(ed);
}

// --- Undo boundary -------------------------------------------------------------
// Chrome keeps one undo stack for the whole page. Projects tabs, the task
// description and ideas load other docs into the same element, so after a
// switch Ctrl+Z / Ctrl+Y would replay the previous doc's steps into this one
// (and autosave / Save would keep the result). Two guards:
// - every editor counts the input events since its content was (re)loaded
//   (never fewer than Chrome's undo steps: Chrome merges typing, the count
//   doesn't) and refuses Undo / Redo past them
// - an undo / redo that puts back a node which left the editor before the
//   last load (another doc's step) is taken back at once. Other steps of an
//   old doc only touch its detached nodes: nothing changes here
function resetUndo(st) {
  st.undoDepth = 0;
  st.redoDepth = 0;
}

// Direct children that leave the editor are tagged with the doc generation
// they left in: only those can come back through another doc's undo step
// (every other node of the old doc is detached with them)
function watchChildren(editor, st) {
  st.gen = 0;
  st.leftIn = new WeakMap();
  if (typeof MutationObserver !== 'function') return;
  st.childWatch = new MutationObserver(records => noteRemoved(st, records));
  st.childWatch.observe(editor, { childList: true });
}

function noteRemoved(st, records) {
  records.forEach(r => r.removedNodes.forEach(n => {
    const gen = st.leftIn.get(n);
    if (gen === undefined || gen >= st.gen) st.leftIn.set(n, st.gen);
  }));
}

// New doc in the element: what left so far belongs to the previous one
function bumpGeneration(st) {
  if (st.childWatch) noteRemoved(st, st.childWatch.takeRecords());
  st.gen++;
}

// After an undo / redo: the old doc's nodes it put back (none normally)
function foreignNodes(editor, st) {
  if (!st.childWatch) return [];
  const records = st.childWatch.takeRecords();
  const foreign = [];
  records.forEach(r => r.addedNodes.forEach(n => {
    const gen = st.leftIn.get(n);
    if (gen !== undefined && gen < st.gen && n.parentNode === editor) foreign.push(n);
  }));
  noteRemoved(st, records);
  return foreign;
}

// Take back an undo / redo that reached another doc: the opposite command
// restores both the content and the browser's stacks (by hand if it can't)
function revertForeign(editor, st, type, foreign) {
  st.correcting = true;
  try { document.execCommand(type === 'historyUndo' ? 'redo' : 'undo'); } catch { /* refused */ } finally { st.correcting = false; }
  const left = foreign.filter(n => n.parentNode === editor);
  if (left.length) {
    left.forEach(n => n.remove());
    notifyChange(editor);
  }
  noteRemoved(st, st.childWatch.takeRecords());
  if (type === 'historyUndo') st.undoDepth = 0;
  else st.redoDepth = 0;
  const saved = st.lastRange;
  if (saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) dom.restoreRange(saved, editor);
}

// One input event on the editor. Returns false when it was another doc's
// undo / redo (already taken back)
function trackUndo(editor, st, e) {
  const type = e.inputType || '';
  if (type === 'historyUndo' || type === 'historyRedo') {
    const foreign = foreignNodes(editor, st);
    if (foreign.length) { revertForeign(editor, st, type, foreign); return false; }
    if (type === 'historyUndo') { st.undoDepth = Math.max(0, st.undoDepth - 1); st.redoDepth++; }
    else { st.redoDepth = Math.max(0, st.redoDepth - 1); st.undoDepth++; }
    return true;
  }
  st.redoDepth = 0; // a new edit clears the browser's redo stack
  st.undoDepth++;
  return true;
}

// 'undo' | 'redo' | null for a key event
function historyKey(e) {
  if (e.altKey || !dom.isMod(e, MAC)) return null;
  const key = String(e.key || '').toLowerCase();
  const latin = /^[a-z]$/.test(key);
  if (key === 'z' || (!latin && e.keyCode === 90)) return e.shiftKey ? 'redo' : 'undo';
  if (!MAC && !e.shiftKey && (key === 'y' || (!latin && e.keyCode === 89))) return 'redo';
  return null;
}

function historyAllowed(editor, kind) {
  const st = states.get(editor);
  if (!st || st.undoDepth == null) return true;
  return (kind === 'redo' ? st.redoDepth : st.undoDepth) > 0;
}

// --- Block helpers shared by core commands ------------------------------------
const BLOCK_LABELS = {
  text: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  quote: 'Quote', code: 'Code', callout: 'Callout', toggle: 'Toggle', checklist: 'Checklist', bullet: 'Bulleted list', numbered: 'Numbered list'
};

// Innermost block type at the caret
function blockKind(ctx) {
  const range = ctx && ctx.range;
  if (!range) return 'text';
  let el = dom.elementOf(ctx.node || dom.anchorNode(range));
  while (el && el !== ctx.editor) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return tag.toLowerCase();
    if (tag === 'BLOCKQUOTE') return 'quote';
    if (tag === 'PRE') return 'code';
    if (el.classList.contains('wr-callout')) return 'callout';
    if (el.classList.contains('wr-toggle')) return 'toggle';
    if (tag === 'LI') {
      const list = el.parentElement;
      if (list && list.tagName === 'OL') return 'numbered';
      return list && list.classList.contains('checklist') ? 'checklist' : 'bullet';
    }
    el = el.parentElement;
  }
  return 'text';
}

function currentList(ctx) {
  const li = ctx.range ? dom.listItemOf(ctx.node || dom.anchorNode(ctx.range), ctx.editor) : null;
  return li ? li.parentElement : null;
}

function inside(ctx, selector) {
  return ctx.range ? dom.closestIn(ctx.node || dom.anchorNode(ctx.range), selector, ctx.editor) : null;
}

// Take the line(s) out of their list, undoably
function unlist(ctx) {
  const list = currentList(ctx);
  if (!list) return;
  dom.exec(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
}

function setBlock(ctx, tag) {
  dom.exec('formatBlock', tag);
}

// Take the line out of its quote. formatBlock can't lift a line that is a
// <div> inside the blockquote (the canonical shape); outdent can, and a line
// left bare in the editor is then wrapped back into a <div>
function unquote(ctx) {
  const quote = inside(ctx, 'blockquote');
  if (quote && !quote.querySelector(BLOCK_SELECTOR)) { setBlock(ctx, 'div'); return; }
  dom.exec('outdent');
  const c = context(ctx.editor);
  if (c.node && (c.node === ctx.editor || c.node.parentNode === ctx.editor)) setBlock(c, 'div');
}

function headingCommand(level) {
  const tag = 'h' + level;
  return {
    run(ctx) {
      if (!ctx.range) return false;
      if (blockKind(ctx) === tag) { setBlock(ctx, 'div'); return true; }
      if (currentList(ctx)) { unlist(ctx); ctx = context(ctx.editor); }
      setBlock(ctx, tag);
      return true;
    },
    isActive: (ctx) => blockKind(ctx) === tag
  };
}

const BLOCK_SELECTOR = 'div, p, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre, table, hr';

// Selection starts and ends in the same line-level block
function sameLine(ctx, range) {
  return dom.blockOf(range.startContainer, ctx.editor) === dom.blockOf(range.endContainer, ctx.editor);
}

// The range a format command works on: a triple-click's spill into the start
// of the next line is dropped (the live selection follows, so execCommand and
// the highlighter see the same range)
function lineRange(ctx) {
  const range = ctx.range;
  const trimmed = dom.trimRangeEnd(range, ctx.editor);
  if (trimmed && trimmed !== range) {
    dom.restoreRange(trimmed, ctx.editor);
    ctx.range = trimmed;
    ctx.node = dom.anchorNode(trimmed);
    ctx.block = ctx.node ? dom.blockOf(ctx.node, ctx.editor) : null;
  }
  return ctx.range;
}

// Lists and inline formatting don't go into code blocks (the export drops
// them, and a list would nest inside the <pre>): true, with a toast, when
// the selection starts, ends or crosses one. Commands then return true so
// the browser's own Ctrl+B / I / U doesn't run either.
function refuseInCodeBlock(ctx) {
  const range = ctx.range;
  if (!range) return false;
  const pre = (node) => dom.closestIn(node, 'pre', ctx.editor);
  let hit = !!(pre(range.startContainer) || pre(range.endContainer));
  if (!hit && !range.collapsed) {
    const root = dom.elementOf(range.commonAncestorContainer);
    hit = !!root && [...root.querySelectorAll('pre')].some(p => { try { return range.intersectsNode(p); } catch { return false; } });
  }
  if (hit) showToast('Code blocks stay plain text');
  return hit;
}

function wrapEscaped(tag, text) {
  return `<${tag}>${dom.escapeHtml(text)}</${tag}>`;
}

// Inline formatting that Clear formatting removes. Links stay, and so do task
// pills / writing chips (contenteditable=false or a wr-* class)
const CLEAR_TAGS = 'b, strong, i, em, u, s, strike, del, code, mark, font, sub, sup, big, small, span';
function keptInline(el) {
  return el.getAttribute('contenteditable') === 'false' || /(^|\s)wr-/.test(el.getAttribute('class') || '') || !!el.closest('[contenteditable="false"]');
}

// A one-line selection that neither starts nor ends inside formatting is
// replaced by a cleaned copy: ONE undo step (removeFormat leaves highlights,
// and unwrapping them afterwards would take more steps). Returns false when
// the slower path must run.
function clearInlineInOneStep(ctx, selected) {
  if (!sameLine(ctx, selected)) return false;
  // "…<b>more</b>" selected up to the end of the bold: take the whole element
  const range = dom.expandToWholeInlines(selected, ctx.editor);
  const line = dom.blockOf(range.startContainer, ctx.editor) || ctx.editor;
  for (const point of [range.startContainer, range.endContainer]) {
    for (let el = dom.elementOf(point); el && el !== line && el !== ctx.editor; el = el.parentElement) {
      if (el.matches(CLEAR_TAGS)) return false;
    }
  }
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  if (holder.querySelector(BLOCK_SELECTOR)) return false;
  let changed = false;
  [...holder.querySelectorAll(CLEAR_TAGS)].reverse().forEach(el => {
    if (keptInline(el)) return;
    el.replaceWith(...el.childNodes);
    changed = true;
  });
  holder.querySelectorAll('[style]').forEach(el => {
    if (keptInline(el)) return;
    el.removeAttribute('style');
    changed = true;
  });
  if (!changed) return true; // nothing inline to clear
  return dom.replaceRangeHtml(range, holder.innerHTML);
}

// --- Core commands (stage-2 modules may re-register better versions) ----------
function registerCoreCommands() {
  registerCommand('paragraph', {
    run(ctx) {
      if (!ctx.range) return false;
      if (currentList(ctx)) { unlist(ctx); ctx = context(ctx.editor); }
      const kind = blockKind(ctx);
      if (kind === 'quote') unquote(ctx);
      else if (/^h[1-6]$/.test(kind)) setBlock(ctx, 'div');
      return true;
    },
    isActive: (ctx) => blockKind(ctx) === 'text'
  });
  registerCommand('heading1', headingCommand(1));
  registerCommand('heading2', headingCommand(2));
  registerCommand('heading3', headingCommand(3));

  registerCommand('quote', {
    run(ctx) {
      if (!ctx.range) return false;
      if (inside(ctx, 'blockquote')) { unquote(ctx); return true; }
      if (currentList(ctx)) { unlist(ctx); ctx = context(ctx.editor); }
      setBlock(ctx, 'blockquote');
      return true;
    },
    isActive: (ctx) => !!inside(ctx, 'blockquote')
  });

  registerCommand('bulletList', {
    run(ctx) {
      if (!ctx.range) return false;
      if (refuseInCodeBlock(ctx)) return true;
      const list = currentList(ctx);
      if (list && list.tagName === 'UL' && list.classList.contains('checklist')) {
        // Checklist -> plain bullets keeps the items (class change only)
        list.classList.remove('checklist');
        list.querySelectorAll(':scope > li.checked').forEach(li => li.classList.remove('checked'));
        notifyChange(ctx.editor);
        return true;
      }
      dom.exec('insertUnorderedList');
      return true;
    },
    isActive: (ctx) => blockKind(ctx) === 'bullet'
  });

  registerCommand('numberedList', {
    run(ctx) {
      if (!ctx.range) return false;
      if (refuseInCodeBlock(ctx)) return true;
      dom.exec('insertOrderedList');
      const list = currentList(context(ctx.editor));
      if (list && list.tagName === 'OL' && list.classList.contains('checklist')) {
        list.classList.remove('checklist');
        notifyChange(ctx.editor);
      }
      return true;
    },
    isActive: (ctx) => blockKind(ctx) === 'numbered'
  });

  registerCommand('checklist', {
    run(ctx) {
      if (!ctx.range) return false;
      if (refuseInCodeBlock(ctx)) return true;
      toggleChecklist(ctx.editor);
      notifyChange(ctx.editor);
      return true;
    },
    isActive: (ctx) => blockKind(ctx) === 'checklist'
  });

  registerCommand('toggleCheck', {
    run(ctx) {
      const li = dom.listItemOf(ctx.node, ctx.editor);
      li.classList.toggle('checked');
      notifyChange(ctx.editor);
      return true;
    },
    isAvailable: (ctx) => !!(ctx.range && dom.isInChecklistItem(ctx.node, ctx.editor))
  });

  ['bold', 'italic', 'underline'].forEach(cmd => {
    registerCommand(cmd, {
      run: (ctx) => {
        if (!ctx.range) return false;
        if (!refuseInCodeBlock(ctx)) dom.exec(cmd);
        return true;
      },
      // queryCommandState reads the page's selection, wherever it is
      isActive: (ctx) => !!(ctx && ctx.range) && dom.queryState(cmd)
    });
  });

  // Canonical <s> (the browser's strikeThrough writes <strike>): wrap / unwrap
  // with insertHTML inside one line; across lines or at a bare caret the
  // native command does it (readers accept <strike> too)
  registerCommand('strike', {
    run(ctx) {
      const range = lineRange(ctx);
      if (!range) return false;
      if (refuseInCodeBlock(ctx)) return true;
      const struck = inside(ctx, 's, strike, del');
      if (struck && (range.collapsed || struck.contains(range.endContainer))) {
        if (dom.unwrapInline(struck) === 'manual') notifyChange(ctx.editor);
        return true;
      }
      if (!range.collapsed && sameLine(ctx, range)) {
        // Over whole bold / link / highlight elements, so they stay (inside the <s>)
        const whole = dom.expandToWholeInlines(range, ctx.editor);
        const holder = document.createElement('div');
        holder.appendChild(whole.cloneContents());
        holder.querySelectorAll('s, strike, del').forEach(el => el.replaceWith(...el.childNodes));
        if (!holder.querySelector(BLOCK_SELECTOR) && holder.textContent.trim()) {
          dom.replaceRangeHtml(whole, `<s>${holder.innerHTML}</s>`, { select: true });
          return true;
        }
      }
      dom.exec('strikeThrough');
      return true;
    },
    isActive: (ctx) => !!ctx.range && (!!inside(ctx, 's, strike, del') || dom.queryState('strikeThrough'))
  });

  registerCommand('inlineCode', {
    run(ctx) {
      const range = lineRange(ctx);
      if (!range || inside(ctx, 'pre')) return false;
      const code = inside(ctx, 'code');
      if (code && (range.collapsed || code.contains(range.endContainer))) {
        // Unwrap (undoable when there is text before it, see dom.unwrapInline)
        if (dom.unwrapInline(code) === 'manual') notifyChange(ctx.editor);
        return true;
      }
      if (range.collapsed) {
        if (!dom.replaceRangeHtml(range, '<code>\u200B</code>')) return true;
        // Put the caret inside the new (empty) code so typing lands there:
        // the last ZWSP-only <code> before the caret in this line
        const r = dom.getSelectionRange(ctx.editor);
        if (!r) return true;
        const line = dom.blockOf(dom.anchorNode(r), ctx.editor) || ctx.editor;
        const target = [...line.querySelectorAll('code')]
          .filter(c => c.textContent === '\u200B' && !c.closest('pre') && r.comparePoint(c, 0) < 0)
          .pop();
        if (target) dom.placeCaretAtEnd(target);
        return true;
      }
      // Code holds text only: wrapping range.toString() would delete images
      // and flatten task pills / chips (the link to the task is lost)
      const whole = dom.expandToWholeInlines(range, ctx.editor);
      const holder = document.createElement('div');
      holder.appendChild(whole.cloneContents());
      if (holder.querySelector('[contenteditable="false"], img, hr, table')) {
        showToast('Inline code is for text: task pills and images can’t go inside it');
        return true;
      }
      // Across lines (Range.toString() has no line breaks between <div>s or at
      // <br>, so wrapping it would merge the lines): a code block when blocks.js has one
      const text = range.toString();
      if (!sameLine(ctx, range) || /\n/.test(text) || holder.querySelector('br')) {
        if (hasCommand('codeBlock')) return runCommand('codeBlock', ctx, { source: 'inlineCode' });
        showToast('Inline code works within one line');
        return true;
      }
      // Links stay links (code inside them); other formatting gives way to code
      if (holder.querySelector('a[href]')) {
        [...holder.querySelectorAll('*')].reverse().forEach(el => { if (el.tagName !== 'A') el.replaceWith(...el.childNodes); });
        holder.normalize();
        const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
        const texts = [];
        for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.data.trim()) texts.push(t);
        texts.forEach(t => { const code = document.createElement('code'); t.replaceWith(code); code.appendChild(t); });
        dom.replaceRangeHtml(whole, holder.innerHTML, { select: true });
      } else {
        dom.replaceRangeHtml(whole, wrapEscaped('code', text), { select: true });
      }
      return true;
    },
    isActive: (ctx) => !!inside(ctx, 'code') && !inside(ctx, 'pre')
  });

  registerCommand('highlight', {
    run(ctx) {
      const range = lineRange(ctx);
      if (!range) return false;
      const mark = inside(ctx, 'mark.text-highlight');
      if (mark && (range.collapsed || mark.contains(range.endContainer))) {
        removeHighlightFromSelection(ctx.editor);
      } else if (!range.collapsed && range.toString().trim()) {
        // Like Ctrl+B: no marks in code (taking an old one off still works)
        if (refuseInCodeBlock(ctx)) return true;
        applyHighlightToSelection(ctx.editor);
      } else {
        return false;
      }
      notifyChange(ctx.editor);
      return true;
    },
    isActive: (ctx) => !!inside(ctx, 'mark.text-highlight')
  });

  registerCommand('clearFormat', {
    run(ctx) {
      let range = lineRange(ctx);
      if (!range) return false;
      let manual = false;
      if (!range.collapsed) {
        const offsets = dom.rangeToOffsets(range, ctx.editor);
        if (!clearInlineInOneStep(ctx, range)) {
          // removeFormat also strips the inline tint of task pills
          // (contenteditable=false): note it and put it back afterwards
          const kept = [...ctx.editor.querySelectorAll('[contenteditable="false"][style]')]
            .filter(el => { try { return range.intersectsNode(el); } catch { return false; } })
            .map(el => ({ el, style: el.getAttribute('style'), taskId: el.dataset.taskId || null }));
          dom.exec('removeFormat');
          kept.forEach(({ el, style, taskId }) => {
            let node = el.isConnected ? el : null;
            if (!node && taskId) node = [...ctx.editor.querySelectorAll('[contenteditable="false"]')].find(n => n.dataset.taskId === taskId && n.getAttribute('style') !== style) || null;
            if (node && node.getAttribute('style') !== style) node.setAttribute('style', style);
          });
          // removeFormat leaves highlights (and keeps code / s it didn't reach):
          // unwrap them one undo step each
          range = dom.getSelectionRange(ctx.editor) || range;
          const left = [...ctx.editor.querySelectorAll('mark.text-highlight, code, s, strike, del')]
            .filter(el => !(el.tagName === 'CODE' && el.closest('pre')))
            .filter(el => { try { return range.intersectsNode(el); } catch { return false; } });
          left.forEach(el => { if (el.isConnected && dom.unwrapInline(el) === 'manual') manual = true; });
        }
        // Keep the cleared text selected
        const back = dom.offsetsToRange(ctx.editor, offsets);
        if (back) dom.restoreRange(back, ctx.editor);
      }
      const c = context(ctx.editor);
      const kind = blockKind(c);
      if (kind === 'quote') unquote(c);
      else if (/^h[1-6]$/.test(kind)) setBlock(c, 'div');
      if (manual) notifyChange(ctx.editor);
      return true;
    }
  });

  registerCommand('divider', {
    run(ctx) {
      if (!ctx.range) return false;
      dom.insertHTML('<hr><div><br></div>');
      return true;
    }
  });

  // Fallback link (the links module replaces it with the Ctrl+K popover)
  registerCommand('link', {
    run(ctx) {
      const range = ctx.range;
      if (!range) return false;
      const saved = range.cloneRange();
      const existing = inside(ctx, 'a[href]');
      const answer = window.prompt(existing ? 'Edit link (leave empty to remove):' : 'Link URL:', existing ? existing.getAttribute('href') : 'https://');
      dom.restoreRange(saved, ctx.editor);
      if (answer === null) return true;
      const trimmed = answer.trim();
      if (!trimmed || trimmed === 'https://') {
        if (existing) { dom.selectNode(existing); dom.exec('unlink'); }
        return true;
      }
      const url = dom.safeUrl(trimmed);
      if (!url) { showToast('Links must be http(s):// or mailto:'); return true; }
      if (existing) {
        dom.selectNode(existing);
        dom.insertHTML(`<a href="${dom.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${existing.innerHTML}</a>`);
      } else if (saved.collapsed) {
        dom.insertHTML(`<a href="${dom.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${dom.escapeHtml(trimmed)}</a>&#8203;`);
      } else {
        const frag = document.createElement('div');
        frag.appendChild(saved.cloneContents());
        frag.querySelectorAll('a').forEach(a => a.replaceWith(...Array.from(a.childNodes)));
        dom.replaceRangeHtml(saved, `<a href="${dom.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${frag.innerHTML}</a>`);
      }
      return true;
    },
    isActive: (ctx) => !!inside(ctx, 'a[href]')
  });

  registerCommand('save', {
    run(ctx) { ctx.opts.onSave(); return true; },
    isAvailable: (ctx) => typeof ctx.opts.onSave === 'function'
  });

  registerCommand('help', {
    run(ctx) {
      if (typeof window.openWritingHelp === 'function') {
        window.openWritingHelp(ctx.tier === 'lite' ? 'notes' : 'writing');
      } else {
        showToast('Tip: type / for blocks, Ctrl+B / I / U to format');
      }
      return true;
    }
  });

  registerCommand('makeTask', {
    run(ctx) {
      const text = ctx.range.toString().trim();
      ctx.opts.makeTask(text, ctx.range.cloneRange());
      return true;
    },
    isAvailable: (ctx) => typeof ctx.opts.makeTask === 'function' && !!ctx.range && !ctx.range.collapsed &&
      !!ctx.range.toString().trim() && !inside(ctx, '.project-task-highlight')
  });

  registerCommand('addSubtask', {
    run(ctx) {
      let text = ctx.range && !ctx.range.collapsed ? ctx.range.toString() : '';
      if (!text.trim() && ctx.range) {
        const block = dom.blockOf(ctx.node, ctx.editor);
        text = block ? block.textContent : '';
      }
      text = text.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
      if (!text) { showToast('Select text (or put the caret on a line) to add it as a subtask'); return true; }
      ctx.opts.addSubtask(text);
      return true;
    },
    isAvailable: (ctx) => typeof ctx.opts.addSubtask === 'function' && !!ctx.range
  });

  registerCommand('mention', {
    run(ctx) {
      if (!ctx.range) return false;
      const before = dom.textBeforeCaret(ctx.range, ctx.editor, 1);
      // A real insertText so the @ task list opens (it listens for input)
      document.execCommand('insertText', false, (before && !/\s/.test(before) ? ' ' : '') + '@');
      return true;
    },
    isAvailable: (ctx) => !!ctx.opts.linkTask
  });
}

// --- Event handlers (per editor) ---------------------------------------------
function onKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.getModifierState && e.getModifierState('AltGraph')) return;
  const editor = e.currentTarget;
  const ctx = context(editor);
  for (const fn of hooks.keydown) {
    if (safeCall(fn, e, ctx) === true) { consume(e); return; }
  }
  // Undo / Redo past this doc's own steps would edit it with another doc's
  const hist = historyKey(e);
  if (hist && !historyAllowed(editor, hist)) { consume(e); return; }
  const id = matchKeyEvent(e, MAC);
  if (!id) return;
  if (FULL_ONLY_KEYS.has(id) && ctx.tier !== 'full') return;
  if (!commands.has(id)) return; // not built yet: let the browser act
  if (runCommand(id, ctx, { source: 'key' })) consume(e);
}

// Input rules never see our own execCommand edits (they would re-fire), but
// change listeners (status bar, outline...) hear about every edit, once per
// microtask, after the command has finished.
function onInput(e) {
  const editor = e.currentTarget;
  const st = states.get(editor);
  // Another doc's undo taken back (and the command that takes it back): no edit
  if (st && (st.correcting || !trackUndo(editor, st, e))) { e.stopImmediatePropagation(); return; }
  if (!dom.isExecuting()) {
    const ctx = context(editor);
    for (const fn of hooks.input) {
      if (safeCall(fn, e, ctx) === true) break;
    }
  }
  queueChange(editor);
}

const changePending = new Set();
function queueChange(editor) {
  if (changePending.has(editor)) return;
  changePending.add(editor);
  queueMicrotask(() => {
    changePending.delete(editor);
    if (!editor.isConnected || !states.get(editor)) return;
    const ctx = context(editor);
    hooks.change.forEach(fn => safeCall(fn, editor, ctx));
    scheduleRefresh(editor);
  });
}

function onBeforeInput(e) {
  const editor = e.currentTarget;
  const st = states.get(editor);
  // Edit menu / gestures as well as the keys
  if (st && (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') &&
      !historyAllowed(editor, e.inputType === 'historyUndo' ? 'undo' : 'redo')) { consume(e); return; }
  if (dom.isExecuting()) return;
  const ctx = context(editor);
  for (const fn of hooks.beforeinput) {
    if (safeCall(fn, e, ctx) === true) { e.preventDefault(); return; }
  }
}

function onPaste(e) {
  const ctx = context(e.currentTarget);
  for (const fn of hooks.paste) {
    if (safeCall(fn, e, ctx) === true) { consume(e); return; }
  }
}

function onComposition(e) {
  const ctx = context(e.currentTarget);
  hooks.composition.forEach(fn => safeCall(fn, e, ctx));
}

// Links: Ctrl/⌘+click opens safely in a new tab; a plain click only places
// the caret (and lets the links module show its card). Other clicks go to
// hooks.click (callout gutter, toggle chevron, code copy...).
function onClick(e) {
  const editor = e.currentTarget;
  const ctx = context(editor);
  const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (link && editor.contains(link)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (dom.isMod(e, MAC)) { dom.openSafe(link.getAttribute('href')); return; }
    ctx.link = link;
    hooks.click.forEach(fn => safeCall(fn, e, ctx));
    return;
  }
  for (const fn of hooks.click) {
    if (safeCall(fn, e, ctx) === true) { consume(e); return; }
  }
}

function onFocusIn(e) {
  lastEditor = e.currentTarget;
}

// --- Views -------------------------------------------------------------------
function onViewClick(e) {
  const viewEl = e.currentTarget;
  const ctx = viewContext(viewEl);
  const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (link && viewEl.contains(link)) {
    consume(e);
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    if (!dom.openSafe(href)) showToast('That link can’t be opened');
    return;
  }
  for (const fn of hooks.click) {
    if (safeCall(fn, e, ctx) === true) { consume(e); return; }
  }
}

// Call after (re)rendering a read-only container. Listeners are added once per
// element; onViewAttach functions run on every call (fn(viewEl, ctx, { first })).
// opts: { id, getTitle(), getDocMeta(), actionsHost? }
export function attachWritingView(viewEl, opts = {}) {
  if (!viewEl) return null;
  ensureInstalled();
  let vs = viewStates.get(viewEl);
  const first = !vs;
  if (!vs) {
    vs = { opts };
    viewStates.set(viewEl, vs);
    viewEl.classList.add('wr-doc', 'wr-view');
    viewEl.addEventListener('click', onViewClick, true);
    viewEl._wrView = vs;
  } else {
    vs.opts = opts;
  }
  const ctx = viewContext(viewEl);
  viewAttachFns.forEach(fn => safeCall(fn, viewEl, ctx, { first }));
  return vs;
}

// --- Global listeners (installed once) -----------------------------------------
let selRaf = 0;
function onSelectionChange() {
  if (selRaf) return;
  selRaf = requestAnimationFrame(() => {
    selRaf = 0;
    const sel = window.getSelection();
    const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const editor = editorForNode(node);
    if (!editor) {
      // The caret left the editor (Find's field, another input): its toolbar
      // stops showing the last caret's formats
      if (lastEditor && lastEditor.isConnected) refreshToolbar(lastEditor);
      return;
    }
    const st = states.get(editor);
    if (st) st.lastRange = sel.getRangeAt(0).cloneRange();
    lastEditor = editor;
    const ctx = context(editor);
    const evt = { type: 'selectionchange' };
    hooks.selection.forEach(fn => safeCall(fn, evt, ctx));
    refreshToolbar(editor);
  });
}

function installGlobals() {
  document.addEventListener('selectionchange', onSelectionChange);
}

function ensureInstalled() {
  if (installed) return;
  installed = true;
  try { document.execCommand('styleWithCSS', false, false); } catch { /* old engines */ }
  registerCoreCommands();
  installGlobals();
  MODULES.forEach(([name, install]) => {
    try { install(api); } catch (err) { console.error(`[writing] ${name} failed to install`, err); }
  });
}

// --- Toolbar -----------------------------------------------------------------
const BLOCK_STYLE_ITEMS = ['paragraph', 'heading1', 'heading2', 'heading3', 'quote', 'codeBlock', 'callout', 'toggle'];
const INSERT_ITEMS = [
  ['Blocks', ['callout', 'calloutTip', 'calloutDecision', 'calloutWarning', 'calloutCaution', 'toggle', 'codeBlock', 'table', 'divider']],
  // addSubtask: task description only (registry editors); Templates… stays last
  ['Insert', ['date', 'emoji', 'docRef', 'addSubtask', 'template']]
];
const RIGHT_ITEMS = ['find', 'outline', 'focus', 'export', 'help'];
const OVERFLOW_ORDER = ['outline', 'find', 'focus']; // first to fold into ⋯
const EXPORT_ITEMS = ['exportMd', 'exportPdf', 'copyMd', 'copyRich'];
const MENU_BUTTONS = new Set(['blockStyle', 'insertMenu', 'exportMenu', 'more']);

function commandAvailableFor(st, id) {
  if (!commands.has(id)) return false;
  const cmd = getCommand(id);
  if (!cmd) return true;
  if (!cmd.tiers.includes(st.opts.tier)) return false;
  if (cmd.editors && !cmd.editors.includes(st.opts.id)) return false;
  if (id === 'outline' && !st.features.outline) return false;
  if (id === 'template' && !st.features.templates) return false;
  if ((id === 'find' || id === 'replace') && !st.features.find) return false;
  if (id === 'focus' && !st.features.focus) return false;
  if (id === 'docRef' && !st.features.docRefs) return false;
  if (EXPORT_ITEMS.includes(id) && !st.features.export) return false;
  return true;
}

function hintFor(id) {
  const cmd = getCommand(id);
  if (!cmd) return {};
  if (cmd.keys && cmd.keys.length) return { kbd: formatKeys(cmd.keys[0], MAC) };
  if (cmd.markdown && !cmd.markdown.startsWith('(')) return { hint: cmd.markdown.trim() };
  return {};
}

function menuItem(st, id, extra = {}) {
  const cmd = getCommand(id) || { label: id, icon: 'text' };
  return { id, label: cmd.label, icon: cmd.icon, ...hintFor(id), ...extra };
}

function tbAttrs(el) {
  el.dataset.wrUi = '';
  el.dataset.wrTb = '';
  return el;
}

function makeDivider() {
  const d = document.createElement('span');
  d.className = 'wr-tb-divider';
  d.setAttribute('aria-hidden', 'true');
  return tbAttrs(d);
}

function makeButton(editor, id, opts = {}) {
  const cmd = getCommand(id);
  const label = opts.label || (cmd ? cmd.label : id);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wr-tb-btn' + (opts.className ? ' ' + opts.className : '');
  b.dataset.wrCmd = id;
  b.title = opts.title || commandTitle(id, MAC, label);
  b.setAttribute('aria-label', label);
  // Menu buttons say so; toggles start with a state (refreshToolbar keeps it)
  if (MENU_BUTTONS.has(id)) b.setAttribute('aria-haspopup', 'menu');
  else if (commands.get(id) && commands.get(id).isActive) b.setAttribute('aria-pressed', 'false');
  b.innerHTML = opts.html || ui.icon(opts.icon || (cmd && cmd.icon) || 'text', 16);
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (opts.onClick) { opts.onClick(b, e); return; }
    ensureSelection(editor);
    runCommand(id, context(editor), { source: 'toolbar', anchor: b });
  });
  return tbAttrs(b);
}

function toggleMenu(st, anchor, build) {
  if (st.menu && st.menu.isOpen()) {
    const same = st.menuAnchor === anchor;
    st.menu.close('toggle');
    if (same) return;
  }
  const opts = build();
  if (!opts || !opts.items || !opts.items.length) return;
  st.menuAnchor = anchor;
  st.menu = ui.openMenu({ anchor, ...opts, onClose: () => { st.menu = null; st.menuAnchor = null; } });
}

function runFromMenu(editor, id, anchor) {
  ensureSelection(editor);
  runCommand(id, context(editor), { source: 'toolbar', anchor });
}

function openBlockMenu(editor, st, anchor) {
  toggleMenu(st, anchor, () => {
    ensureSelection(editor);
    const kind = blockKind(context(editor));
    const kindToId = { text: 'paragraph', h1: 'heading1', h2: 'heading2', h3: 'heading3', quote: 'quote', code: 'codeBlock', callout: 'callout', toggle: 'toggle' };
    const items = BLOCK_STYLE_ITEMS.filter(id => commandAvailableFor(st, id))
      .map(id => menuItem(st, id, { active: kindToId[kind] === id, run: () => runFromMenu(editor, id, anchor) }));
    return { items, className: 'wr-block-menu', showCheck: true, title: 'Turn into' };
  });
}

function insertMenuItems(st, editor, anchor) {
  const items = [];
  INSERT_ITEMS.forEach(([group, ids]) => {
    ids.filter(id => commandAvailableFor(st, id)).forEach(id => {
      items.push(menuItem(st, id, { group, run: () => runFromMenu(editor, id, anchor) }));
    });
  });
  return items;
}

function exportMenuItems(st, editor, anchor) {
  return EXPORT_ITEMS.filter(id => commandAvailableFor(st, id))
    .map(id => menuItem(st, id, { run: () => runFromMenu(editor, id, anchor) }));
}

function openExport(editor, st, anchor) {
  if (commands.has('exportMenu')) {
    if (st.menu) st.menu.close('toggle');
    ensureSelection(editor);
    runCommand('exportMenu', context(editor), { source: 'toolbar', anchor });
    return;
  }
  toggleMenu(st, anchor, () => ({ items: exportMenuItems(st, editor, anchor), className: 'wr-export-menu' }));
}

function rightButton(editor, st, id) {
  if (id === 'export') {
    if (!commands.has('exportMenu') && !exportMenuItems(st, editor, null).length) return null;
    const b = makeButton(editor, 'exportMenu', {
      label: 'Export',
      title: 'Export: Markdown, PDF, copy',
      className: 'wr-tb-export',
      html: ui.icon('export', 16) + ui.icon('chevronDown', 11, 'wr-tb-caret'),
      onClick: (btn) => openExport(editor, st, btn)
    });
    b.dataset.wrSlot = 'export';
    return b;
  }
  if (!commandAvailableFor(st, id)) return null;
  const b = makeButton(editor, id);
  b.dataset.wrSlot = id;
  return b;
}

// Rebuild this editor's additions (idempotent: removes what it added before)
function buildToolbar(editor, st) {
  const tb = st.opts.toolbar;
  if (!tb) return;
  tb.querySelectorAll('[data-wr-tb]').forEach(n => n.remove());
  st.buttons = new Map();
  st.blockLabel = null;
  const full = st.opts.tier === 'full';
  tb.classList.add('wr-toolbar', full ? 'wr-toolbar-full' : 'wr-toolbar-lite');

  const bold = tb.querySelector('[data-cmd="bold"], [data-command="bold"]');
  const underline = tb.querySelector('[data-cmd="underline"], [data-command="underline"]');
  const highlighter = tb.querySelector('.highlighter-btn-wrapper');
  const track = (b) => { if (b && b.dataset.wrCmd) st.buttons.set(b.dataset.wrCmd, b); return b; };

  // 1. Block style dropdown (FULL), before Bold
  if (full && bold) {
    const block = makeButton(editor, 'blockStyle', {
      label: 'Text style',
      title: 'Text style: heading, quote, code…',
      className: 'wr-tb-block',
      html: `<span class="wr-tb-block-label"></span>${ui.icon('chevronDown', 12, 'wr-tb-caret')}`,
      onClick: (btn) => openBlockMenu(editor, st, btn)
    });
    const labelEl = block.querySelector('.wr-tb-block-label');
    st.blockLabel = document.createTextNode('Text');
    labelEl.appendChild(st.blockLabel);
    bold.before(block, makeDivider());
  }

  // 2. After Underline: Strikethrough, Inline code, Link (LITE: Link only)
  if (underline) {
    const ids = full ? ['strike', 'inlineCode', 'link'] : ['link'];
    let after = underline;
    ids.forEach(id => {
      if (!commands.has(id)) return;
      const b = track(makeButton(editor, id));
      after.after(b);
      after = b;
    });
  }

  // 3. After the highlighter: + Insert menu (FULL)
  if (full) {
    const items = insertMenuItems(st, editor, null);
    if (items.length) {
      const plus = makeButton(editor, 'insertMenu', {
        label: 'Insert',
        title: 'Insert: callout, toggle, code, table, divider…',
        className: 'wr-tb-insert',
        icon: 'plus',
        onClick: (btn) => toggleMenu(st, btn, () => ({ items: insertMenuItems(st, editor, btn), className: 'wr-insert-menu', footer: 'Tip: type / in the text for every command' }))
      });
      if (highlighter) highlighter.after(plus); else tb.appendChild(plus);
    }
  }

  // 4. Right group
  if (full) {
    const right = tbAttrs(document.createElement('div'));
    right.className = 'wr-tb-right';
    RIGHT_ITEMS.forEach(id => {
      const b = rightButton(editor, st, id);
      if (!b) return;
      track(b);
      right.appendChild(b);
    });
    const more = makeButton(editor, 'more', {
      label: 'More tools',
      title: 'More tools',
      className: 'wr-tb-more',
      icon: 'more',
      onClick: (btn) => toggleMenu(st, btn, () => ({
        items: (st.overflowed || []).map(id => menuItem(st, id, { run: () => runFromMenu(editor, id, btn) })),
        className: 'wr-more-menu'
      }))
    });
    more.hidden = true;
    st.moreBtn = more;
    // ⋯ sits just before Export / Help so they stay at the far end
    const exportBtn = right.querySelector('[data-wr-slot="export"]') || right.querySelector('[data-wr-slot="help"]');
    if (exportBtn) right.insertBefore(more, exportBtn); else right.appendChild(more);
    if (right.childElementCount > 1) {
      const spacer = tb.querySelector('.projects-toolbar-spacer');
      const saveLabel = tb.querySelector('#project-save-label');
      if (spacer && saveLabel) saveLabel.before(right);
      else tb.appendChild(right);
      if (spacer) right.classList.add('wr-tb-right-inline');
    }
    st.right = right;
    observeToolbar(tb, st);
  } else if (commands.has('help')) {
    const help = track(makeButton(editor, 'help', { className: 'wr-tb-end' }));
    tb.appendChild(help);
  }
  st.overflowed = [];
  layoutOverflow(st);
  refreshToolbar(editor);
}

// --- Overflow (⋯) ----------------------------------------------------------------
const toolbarObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  entries.forEach(entry => {
    const st = entry.target._wrToolbarState;
    if (st) scheduleOverflow(st);
  });
}) : null;

function observeToolbar(tb, st) {
  tb._wrToolbarState = st;
  if (toolbarObserver && !st.observing) {
    toolbarObserver.observe(tb);
    st.observing = true;
  }
}

function scheduleOverflow(st) {
  if (st.overflowRaf) return;
  st.overflowRaf = requestAnimationFrame(() => {
    st.overflowRaf = 0;
    layoutOverflow(st);
  });
}

// How many rows the toolbar's visible items take. Items are centered, so
// tops differ: a new row starts when an item's top is below the bottom of the
// shortest item of the current row (empty spacers are ignored). The right
// group can wrap inside itself, so its buttons count one by one.
function toolbarRows(tb) {
  const rects = [];
  const add = (el) => {
    if (el.hidden || el.offsetParent === null) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    rects.push(r);
  };
  for (const child of tb.children) {
    if (child.classList.contains('wr-tb-right')) {
      if (!child.hidden) for (const b of child.children) add(b);
    } else {
      add(child);
    }
  }
  if (!rects.length) return 0;
  rects.sort((a, b) => a.top - b.top);
  let rows = 1, rowBottom = rects[0].bottom;
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].top >= rowBottom - 1) { rows++; rowBottom = rects[i].bottom; }
    else rowBottom = Math.min(rowBottom, rects[i].bottom);
  }
  return rows;
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

// A right-group button past the toolbar's edge or the screen's
function rightGroupSpills(st) {
  const box = st.opts.toolbar.getBoundingClientRect();
  const edge = Math.min(box.right, window.innerWidth) + 1;
  for (const b of st.right.children) {
    if (!b.hidden && b.offsetParent !== null && b.getBoundingClientRect().right > edge) return true;
  }
  return false;
}

// Fold document tools into ⋯ only as far as it saves a row (or keeps them
// from running past the edge): a narrow editor whose formatting buttons wrap
// anyway keeps its tools on the second row instead of an almost empty one
// with ⋯. Export and Help never fold.
function layoutOverflow(st) {
  const tb = st.opts.toolbar;
  if (!tb || !st.right || !st.moreBtn) return;
  if (!tb.clientWidth) return; // hidden: try again on the next resize
  const slots = OVERFLOW_ORDER.map(id => st.right.querySelector(`[data-wr-slot="${id}"]`)).filter(Boolean);
  slots.forEach(b => setHidden(b, false));
  setHidden(st.moreBtn, true);
  st.overflowed = [];
  if (!slots.length) return;
  const rowsAll = toolbarRows(tb);
  const spills = rightGroupSpills(st);
  if (rowsAll <= 1 && !spills) return;
  setHidden(st.moreBtn, false);
  slots.forEach(b => setHidden(b, true));
  const rowsMin = toolbarRows(tb);
  if (rowsMin >= rowsAll && !spills) {
    slots.forEach(b => setHidden(b, false));
    setHidden(st.moreBtn, true);
    return;
  }
  // Bring tools back, most useful first, while the row count holds and
  // nothing runs past the edge
  for (const b of [...slots].reverse()) {
    setHidden(b, false);
    if (toolbarRows(tb) > rowsMin || rightGroupSpills(st)) { setHidden(b, true); break; }
  }
  st.overflowed = slots.filter(b => b.hidden).map(b => b.dataset.wrSlot);
  if (!st.overflowed.length) setHidden(st.moreBtn, true);
  // Keep the ⋯ list in toolbar order
  st.overflowed.sort((a, b) => RIGHT_ITEMS.indexOf(a) - RIGHT_ITEMS.indexOf(b));
}

// --- Toolbar state -------------------------------------------------------------
const refreshPending = new Set();
let refreshRaf = 0;

function scheduleRefresh(editor) {
  if (!editor) return;
  refreshPending.add(editor);
  if (refreshRaf) return;
  refreshRaf = requestAnimationFrame(() => {
    refreshRaf = 0;
    const list = [...refreshPending];
    refreshPending.clear();
    list.forEach(refreshToolbar);
  });
}

// Without a caret in the editor (another doc just loaded, Find's field has the
// focus...) nothing that depends on the caret shows as on and the block reads
// "Text": every caret-based isActive is false without ctx.range. Panel toggles
// (Find, Focus) still show their own state.
function refreshToolbar(editor) {
  const st = editor && states.get(editor);
  if (!st || !st.buttons) return;
  const ctx = context(editor);
  st.buttons.forEach((btn, id) => {
    const impl = commands.get(id);
    if (!impl || !impl.isActive) return;
    const active = !!safeCall(impl.isActive, ctx);
    if (btn.classList.contains('active') !== active) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  });
  if (st.blockLabel) {
    const label = BLOCK_LABELS[blockKind(ctx)] || 'Text';
    if (st.blockLabel.data !== label) st.blockLabel.data = label;
  }
}

let rebuildTimer = 0;
function scheduleToolbarRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0;
    pruneEditors();
    liveEditors.forEach(ed => { const st = states.get(ed); if (st) buildToolbar(ed, st); });
  }, 0);
}

// --- Attach ------------------------------------------------------------------------
function resolveFeatures(opts) {
  const full = opts.tier === 'full';
  const doc = DOC_EDITORS.includes(opts.id);
  return {
    outline: full && doc,
    templates: full, // every FULL editor (spec §1); writing-templates.js also targets subtask
    find: full,
    focus: full,
    export: full,
    docRefs: full,
    ...(opts.features || {})
  };
}

// opts: { id, tier: 'full' | 'lite', toolbar, getTitle(), getDocMeta(), getDocId?(),
//         onChange?(), onSave?(), linkTask?, makeTask?(text, range), addSubtask?(text),
//         statusHost?, features? }
export function attachWritingFeatures(editor, opts = {}) {
  if (!editor) return null;
  if (editor._wr) {
    // Already attached: refresh the options (same element, new closures)
    const st = states.get(editor);
    if (st) { Object.assign(st.opts, opts); st.features = resolveFeatures(st.opts); }
    return editor._wr;
  }
  ensureInstalled();
  pruneEditors();
  const st = {
    opts: { tier: 'full', getTitle: () => '', getDocMeta: () => ({ kind: 'Note', title: '' }), getDocId: () => null, ...opts },
    features: null,
    buttons: new Map(),
    lastRange: null,
    menu: null
  };
  st.features = resolveFeatures(st.opts);
  resetUndo(st);
  watchChildren(editor, st);
  states.set(editor, st);
  liveEditors.add(editor);
  editor.classList.add('wr-doc', 'wr-editor');
  editor.dataset.wrEditor = st.opts.id || '';
  editor.dataset.wrTier = st.opts.tier;

  editor.addEventListener('keydown', onKeydown, true);
  editor.addEventListener('input', onInput, true);
  editor.addEventListener('beforeinput', onBeforeInput, true);
  editor.addEventListener('paste', onPaste, true);
  editor.addEventListener('click', onClick, true);
  editor.addEventListener('compositionend', onComposition);
  editor.addEventListener('focusin', onFocusIn);

  const controller = {
    editor,
    get opts() { return st.opts; },
    get features() { return st.features; },
    context: () => context(editor),
    refresh: () => refreshToolbar(editor),
    rebuildToolbar: () => buildToolbar(editor, st),
    notifyChange: () => notifyChange(editor),
    loaded: () => notifyLoad(editor),
    run: (id, arg) => runCommand(id, context(editor), arg)
  };
  editor._wr = controller;

  buildToolbar(editor, st);
  const ctx = context(editor);
  attachFns.forEach(fn => safeCall(fn, editor, ctx));
  return controller;
}

// --- Public api ----------------------------------------------------------------------
export const api = {
  registerCommand,
  runCommand,
  hasCommand,
  isAvailable,
  context,
  activeEditor,
  editorForNode,
  editors: () => { pruneEditors(); return [...liveEditors]; },
  stateOf: (editor) => states.get(editor) || null,
  notifyChange,
  notifyLoad,
  onAttach(fn) { attachFns.push(fn); },
  onViewAttach(fn) { viewAttachFns.push(fn); },
  hooks,
  prefs,
  ui,
  dom,
  toast: showToast,
  actionToast,
  blockKind,
  blockLabel: (ctx) => BLOCK_LABELS[blockKind(ctx)] || 'Text',
  refreshToolbar,
  rebuildToolbars: scheduleToolbarRebuild,
  ensureSelection,
  registry: {
    WRITING_COMMANDS,
    getCommand,
    matchKeyEvent,
    formatKeys,
    formatKeysText,
    keyHint,
    commandTitle,
    commandsFor,
    slashItemsFor,
    buildWritingHelp,
    isMac: MAC
  }
};
