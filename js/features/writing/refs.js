// Personal Dashboard - Writing chips: date chips and links to projects,
// meetings and ideas (SPEC section 3):
//   <span class="wr-date" data-date="2026-10-09" contenteditable="false">Fri, Oct 9</span>
//   <span class="wr-ref" data-ref-type="project|meeting|idea" data-ref-id="…" contenteditable="false">Title</span>
// The data attribute is the stored value; the label is drawn from it every
// time an editor loads or a view renders (date labels, live titles; a link to
// something deleted becomes plain text). Nothing transient is written into a
// chip: today / past tints come from a generated stylesheet keyed on
// data-date, and "in 3 days" lives in a floating tip, not a title attribute.
//
// Clicks: in views a doc chip opens its target; in editors a plain click
// shows a small card (Open / Unlink, or the date with a date picker) and
// Ctrl/⌘+click opens straight away, like links.

import { currentData } from '../../state.js';
import { toDateKey, fromDateKey } from '../../core/quick-capture-parse.js';
import * as dom from './dom.js';
import * as ui from './ui.js';

let API = null;

// --- Dates --------------------------------------------------------------------
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MO_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function isDateKey(key) {
  return !!fromDateKey(key);
}

// Chip label: "Fri, Oct 9" (", 2027" when it isn't this year)
export function dateChipLabel(key, now = new Date()) {
  const d = fromDateKey(key);
  if (!d) return String(key || '');
  const base = `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

// "Friday, October 9" (year added when it isn't this year, or always with { year: true })
export function dateLongLabel(key, opts = {}) {
  const d = fromDateKey(key);
  if (!d) return String(key || '');
  const now = opts.now || new Date();
  const base = `${WD_LONG[d.getDay()]}, ${MO_LONG[d.getMonth()]} ${d.getDate()}`;
  return opts.year || d.getFullYear() !== now.getFullYear() ? `${base}, ${d.getFullYear()}` : base;
}

// Whole days from today to key (local calendar days, DST-proof)
export function daysFromToday(key, now = new Date()) {
  const d = fromDateKey(key);
  if (!d) return null;
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86400000);
}

// "today" · "tomorrow" · "in 3 days" · "2 weeks ago" · "in 4 months"
export function relativeDay(key, now = new Date()) {
  const n = daysFromToday(key, now);
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const abs = Math.abs(n);
  let text;
  if (abs < 14) text = `${abs} days`;
  else if (abs < 60) text = `${Math.round(abs / 7)} weeks`;
  else if (abs < 730) text = `${Math.round(abs / 30.44)} months`;
  else text = `${Math.round(abs / 365.25)} years`;
  return n > 0 ? `in ${text}` : `${text} ago`;
}

export function dateChipHtml(key) {
  return `<span class="wr-date" data-date="${dom.escapeHtml(key)}" contenteditable="false">${dom.escapeHtml(dateChipLabel(key))}</span>`;
}

// --- Doc refs -----------------------------------------------------------------
export const REF_TYPES = {
  project: { label: 'Project', plural: 'Projects', key: 'projects', untitled: 'Untitled project' },
  meeting: { label: 'Meeting', plural: 'Meetings', key: 'meetings', untitled: 'Untitled meeting' },
  idea: { label: 'Idea', plural: 'Ideas', key: 'ideas', untitled: 'Untitled idea' }
};

function docsOf(type) {
  const def = REF_TYPES[type];
  const data = currentData() || {};
  const list = def ? data[def.key] : null;
  return Array.isArray(list) ? list.filter(d => d && typeof d.id === 'string') : [];
}

export function listRefDocs(type) {
  return docsOf(type);
}

export function findRef(type, id) {
  if (!id) return null;
  return docsOf(type).find(d => d.id === id) || null;
}

export function refTitle(type, doc) {
  const title = doc && typeof doc.title === 'string' ? doc.title.replace(/\s+/g, ' ').trim() : '';
  return title || (REF_TYPES[type] ? REF_TYPES[type].untitled : 'Untitled');
}

export function refChipHtml(type, id, title) {
  return `<span class="wr-ref" data-ref-type="${dom.escapeHtml(type)}" data-ref-id="${dom.escapeHtml(id)}" contenteditable="false">${dom.escapeHtml(title)}</span>`;
}

// --- Inserting a chip (undoable) ---------------------------------------------------
const SPACE = /[\s\u00A0\u200B\uFEFF]/;

// The line holding node as a range: its block (a list item without its
// sub-list), or the run of inline nodes between block siblings when the text
// sits straight in the editor (Chrome's first line)
export function lineRangeAt(node, editor) {
  const r = document.createRange();
  const block = dom.blockOf(node, editor);
  if (block) {
    r.selectNodeContents(block);
    if (block.tagName === 'LI') {
      const sub = [...block.children].find(c => c.tagName === 'UL' || c.tagName === 'OL');
      if (sub) r.setEndBefore(sub);
    }
    return r;
  }
  const isBreak = (n) => n.nodeType === 1 && (dom.BLOCK_TAGS.has(n.tagName) || n.tagName === 'BR');
  const top = dom.topBlockOf(node, editor);
  if (!top) { r.selectNodeContents(editor); return r; }
  let first = top, last = top;
  while (first.previousSibling && !isBreak(first.previousSibling)) first = first.previousSibling;
  while (last.nextSibling && !isBreak(last.nextSibling)) last = last.nextSibling;
  r.setStartBefore(first);
  r.setEndAfter(last);
  return r;
}

// The character right after range's end in its line ('' at the end of the line)
export function charAfter(range, editor) {
  const r = lineRangeAt(range.endContainer, editor);
  try { r.setStart(range.endContainer, range.endOffset); } catch { return ''; }
  return r.toString().charAt(0);
}

function charBefore(range, editor) {
  const r = lineRangeAt(range.startContainer, editor);
  try { r.setEnd(range.startContainer, range.startOffset); } catch { return ''; }
  const text = r.toString();
  return text.charAt(text.length - 1);
}

function htmlText(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent;
}

// Put chipHtml over range (a typed trigger, a selection, the caret or an old
// chip) with a space after it unless one is there (opts.space false: never),
// caret after; a U+200B leads the chip (so the caret has somewhere to sit).
// Chrome's insertHTML misplaces a non-editable span in a <div> / heading line:
// at the start or the end of the line it lands OUTSIDE the line. In list
// items and table cells it is placed right, but stripped to text unless text
// leads the fragment. So: in li / td / th one insertHTML (one undo step);
// elsewhere the spacer and the space are typed first and the chip goes in
// between them, mid-line (two undo steps).
export function insertChip(editor, range, chipHtml, opts = {}) {
  if (!editor || !range) return false;
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  const base = dom.rangeToOffsets(range, editor);
  if (!base) return false;
  // A spacer left before (by an earlier chip or a task pill) is reused
  if (charBefore(range, editor) === '\u200B') {
    const grown = dom.offsetsToRange(editor, { start: base.start - 1, end: base.end });
    if (grown) { range = grown; base.start -= 1; }
  }
  const next = charAfter(range, editor);
  const space = opts.space !== false && !(next && SPACE.test(next));
  // Something must follow the chip in its line (a trailing plain space is dropped)
  const tail = space ? (next ? ' ' : '\u00A0') : (next ? '' : '\u200B');
  const line = dom.blockOf(range.startContainer, editor);
  dom.restoreRange(range, editor);
  let ok;
  if (line && /^(LI|TD|TH)$/.test(line.tagName)) {
    ok = dom.insertHTML('\u200B' + chipHtml + tail);
  } else {
    ok = dom.insertText('\u200B' + tail);
    const mid = ok ? dom.offsetsToRange(editor, { start: base.start + 1, end: base.start + 1 }) : null;
    if (!mid) return false;
    dom.restoreRange(mid, editor);
    ok = dom.insertHTML(chipHtml);
  }
  // Caret after the chip and its space. A collapsed offset leans into the next
  // text node, which at the end of a line is the next line / cell: there, end
  // the range on the last character instead
  const at = base.start + 1 + htmlText(chipHtml).length + tail.length;
  const caret = tail
    ? dom.offsetsToRange(editor, { start: at - 1, end: at })
    : dom.offsetsToRange(editor, { start: at, end: at }, { caretAfter: true });
  if (caret) {
    caret.collapse(false);
    dom.restoreRange(caret, editor);
  }
  return ok;
}

// --- Refresh: labels from the stored value, live titles, deleted -> text ------
// Returns true when something changed. Used on editor load (before the
// unsaved-changes baseline is taken) and on every view render.
export function refreshChips(root) {
  if (!root || !root.querySelectorAll) return false;
  let changed = false;
  const now = new Date();
  root.querySelectorAll('span.wr-date[data-date]').forEach(chip => {
    const key = chip.dataset.date;
    if (!isDateKey(key)) return;
    const label = dateChipLabel(key, now);
    if (chip.textContent !== label) { chip.textContent = label; changed = true; }
    if (chip.getAttribute('contenteditable') !== 'false') { chip.setAttribute('contenteditable', 'false'); changed = true; }
    noteDateKey(key);
  });
  root.querySelectorAll('span.wr-ref[data-ref-type]').forEach(chip => {
    const type = chip.dataset.refType;
    if (!REF_TYPES[type]) return;
    const doc = findRef(type, chip.dataset.refId);
    if (!doc) {
      // The target was deleted: keep the words, drop the link
      chip.replaceWith(document.createTextNode(chip.textContent || ''));
      changed = true;
      return;
    }
    const title = refTitle(type, doc);
    if (chip.textContent !== title) { chip.textContent = title; changed = true; }
    if (chip.getAttribute('contenteditable') !== 'false') { chip.setAttribute('contenteditable', 'false'); changed = true; }
  });
  return changed;
}

// --- Today / past tints: a generated stylesheet keyed on data-date ------------
// (chips never carry a state class, so nothing stale is ever saved)
const seenKeys = new Set();
let stateSheet = null;
let styleEl = null;
let stateSig = '';
let midnightTimer = 0;

function noteDateKey(key) {
  if (!key || seenKeys.has(key)) return;
  seenKeys.add(key);
  scheduleDateStates();
}

export function noteDateKeysIn(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('span.wr-date[data-date]').forEach(c => noteDateKey(c.dataset.date));
}

let statesQueued = false;
function scheduleDateStates() {
  if (statesQueued) return;
  statesQueued = true;
  queueMicrotask(() => { statesQueued = false; applyDateStates(); });
}

function applyDateStates() {
  const today = toDateKey(new Date());
  const past = [...seenKeys].filter(k => k < today && isDateKey(k)).sort();
  const sig = today + '|' + past.join(',');
  if (sig === stateSig) return;
  stateSig = sig;
  const sel = (k) => `.wr-date[data-date="${k}"]`;
  let css = `${sel(today)}{--wr-date-state-bg:var(--wr-date-today-bg);--wr-date-state-ink:var(--wr-date-today-ink);--wr-date-state-edge:var(--wr-date-today-edge);--wr-date-state-weight:650}`;
  if (past.length) css += `:is(${past.map(sel).join(',')}){--wr-date-state-bg:var(--wr-date-past-bg);--wr-date-state-ink:var(--wr-date-past-ink);--wr-date-state-edge:var(--wr-date-past-edge)}`;
  try {
    if (!stateSheet && !styleEl && typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
      stateSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, stateSheet];
    }
    if (stateSheet) { stateSheet.replaceSync(css); return; }
  } catch { stateSheet = null; }
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.dataset.wrUi = '';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

// Re-tint at midnight (a tab left open overnight)
function scheduleMidnight() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  midnightTimer = setTimeout(() => {
    applyDateStates();
    document.querySelectorAll('.wr-view').forEach(v => refreshChips(v));
    scheduleMidnight();
  }, Math.min(next - now, 2147483000));
}

// --- Opening a doc ---------------------------------------------------------------
const MODAL_OF = { project: '#projects-modal', meeting: '#meetings-modal', idea: '#ideas-modal' };

// z-index of the top-level layer holding el (the modal it sits in)
function layerZ(el) {
  let z = 0;
  for (let n = el && el.nodeType === 1 ? el : el && el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position !== 'static') {
      const v = parseInt(cs.zIndex, 10);
      if (!Number.isNaN(v)) z = v; // keep going: the outermost layer decides
    }
  }
  return z;
}

// A target modal that opens under the one the chip is in (projects 10002 under
// the task editor 10010) is lifted above it until it closes again
function liftAbove(modal, z) {
  if (!modal || modal.hidden || !z) return;
  const own = parseInt(getComputedStyle(modal).zIndex, 10) || 0;
  if (own > z) return;
  const before = modal.style.zIndex;
  modal.style.zIndex = String(z + 1);
  const mo = new MutationObserver(() => {
    if (!modal.isConnected || modal.hidden) {
      modal.style.zIndex = before;
      mo.disconnect();
    }
  });
  mo.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
}

// Editors whose text changed since they loaded (for "leave this idea?")
const baselines = new WeakMap();
function editorChanged(editor) {
  if (!editor || !baselines.has(editor)) return false;
  return dom.cleanEditorHtml(editor) !== baselines.get(editor);
}

export function openRef(type, id, sourceEl) {
  const def = REF_TYPES[type];
  if (!def) return false;
  const doc = findRef(type, id);
  if (!doc) {
    API && API.toast(`That ${def.label.toLowerCase()} was deleted`);
    return false;
  }
  const modalSel = MODAL_OF[type];
  const before = document.querySelector(modalSel);
  const sameModal = !!(before && sourceEl && before.contains(sourceEl));
  const sourceEditor = sourceEl && sourceEl.closest ? sourceEl.closest('.wr-editor') : null;
  // Ideas has no unsaved-changes check of its own: ask before replacing an edited idea
  if (type === 'idea' && sameModal && sourceEditor && editorChanged(sourceEditor) &&
      !window.confirm(`Open “${refTitle(type, doc)}”? Changes to this idea that aren’t saved will be lost.`)) {
    return false;
  }
  const z = sameModal ? 0 : layerZ(sourceEl);
  const open = { project: window.openProjectsModal, meeting: window.openMeetingsModal, idea: window.openIdeasModal }[type];
  if (typeof open !== 'function') return false;
  if (open(id) === false) return false; // the target asked and was told no
  liftAbove(document.querySelector(modalSel), z);
  return true;
}

// --- Cards (click in an editor / a date in a view) --------------------------------
const SVG = (body) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const CHIP_ICONS = {
  date: SVG('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  project: SVG('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
  meeting: SVG('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.6 14.6A4.5 4.5 0 0 1 21 19"/>'),
  idea: SVG('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.9 10.6c.6.5.9 1.3.9 2.1V16h6v-.3c0-.8.3-1.6.9-2.1A6 6 0 0 0 12 3z"/>'),
  open: SVG('<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>')
};

let card = null;      // the open card popover
let cardChip = null;

function closeCard() {
  if (card && card.isOpen()) card.close('api');
  card = null;
  cardChip = null;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function cardHead(iconHtml, kicker, title, sub) {
  const head = el('div', 'wr-chip-card-head');
  const icon = el('span', 'wr-chip-card-icon');
  icon.innerHTML = iconHtml;
  const text = el('div', 'wr-chip-card-text');
  if (kicker) text.appendChild(el('div', 'wr-chip-card-kicker', kicker));
  const t = el('div', 'wr-chip-card-title', title);
  text.appendChild(t);
  let subEl = null;
  if (sub != null) { subEl = el('div', 'wr-chip-card-sub', sub); text.appendChild(subEl); }
  head.append(icon, text);
  return { head, titleEl: t, subEl };
}

function cardButton(label, cls, onClick, iconHtml) {
  const b = el('button', 'wr-chip-btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  if (iconHtml) b.innerHTML = iconHtml;
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

// A chip in an editor becomes another chip ({ chip }), plain text ({ text })
// or nothing ({}), undoably
function replaceChip(editor, chip, what) {
  if (!editor || !chip || !chip.isConnected) return false;
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  const r = document.createRange();
  r.selectNode(chip);
  let ok;
  if (what.chip) {
    ok = insertChip(editor, r, what.chip, { space: false });
  } else {
    dom.restoreRange(r, editor);
    ok = what.text ? dom.insertText(what.text) : dom.exec('delete');
  }
  API.notifyChange(editor);
  return ok;
}

// Date card: the full date and how far away it is; in an editor also a date
// picker (Set / Enter applies, Esc or a click elsewhere leaves it) and Remove
function showDateCard(chip, ctx) {
  closeCard();
  const editor = ctx.view ? null : ctx.editor;
  const key = chip.dataset.date;
  const { head, titleEl, subEl } = cardHead(CHIP_ICONS.date, 'Date', dateLongLabel(key, { year: true }), relativeDay(key));
  const body = el('div', 'wr-chip-card wr-date-card');
  body.appendChild(head);
  if (editor) {
    const row = el('label', 'wr-chip-card-field');
    row.appendChild(el('span', 'wr-chip-card-label', 'Change date'));
    const input = el('input', 'wr-chip-input');
    input.type = 'date';
    input.value = key;
    row.appendChild(input);
    body.appendChild(row);
    const apply = () => {
      const next = input.value;
      closeCard(); // puts the caret back in the editor
      if (isDateKey(next) && next !== chip.dataset.date) {
        replaceChip(editor, chip, { chip: dateChipHtml(next) });
        noteDateKey(next);
      }
    };
    // Preview while picking; nothing changes until Set
    input.addEventListener('input', () => {
      if (!isDateKey(input.value)) return;
      titleEl.textContent = dateLongLabel(input.value, { year: true });
      if (subEl) subEl.textContent = relativeDay(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
    });
    const actions = el('div', 'wr-chip-card-actions');
    actions.appendChild(cardButton('Set date', 'is-primary', apply));
    actions.appendChild(cardButton('Remove', 'is-quiet', () => {
      closeCard();
      replaceChip(editor, chip, {});
    }));
    body.appendChild(actions);
  }
  openCard(chip, body, editor);
}

function showRefCard(chip, ctx) {
  closeCard();
  const editor = ctx.editor;
  const type = chip.dataset.refType;
  const def = REF_TYPES[type];
  const doc = findRef(type, chip.dataset.refId);
  const { head } = cardHead(CHIP_ICONS[type] || CHIP_ICONS.project, def ? def.label : 'Link', doc ? refTitle(type, doc) : chip.textContent, null);
  const body = el('div', 'wr-chip-card wr-ref-card');
  body.dataset.refType = type;
  body.appendChild(head);
  const actions = el('div', 'wr-chip-card-actions');
  actions.appendChild(cardButton('Open', 'is-primary', () => {
    const id = chip.dataset.refId;
    closeCard();
    openRef(type, id, chip);
  }, CHIP_ICONS.open));
  actions.appendChild(cardButton('Unlink', 'is-quiet', () => {
    const target = chip;
    closeCard();
    // Keep the words as plain text (undoable)
    replaceChip(editor, target, { text: target.textContent || '' });
  }));
  body.appendChild(actions);
  body.appendChild(el('div', 'wr-chip-card-hint', `${API.registry.isMac ? '⌘' : 'Ctrl'}+click opens it directly`));
  openCard(chip, body, editor);
}

function openCard(chip, content, editor) {
  hideTip();
  cardChip = chip;
  card = ui.openPopover({
    anchor: chip,
    content,
    editor: editor || null,
    className: 'wr-chip-pop',
    placement: 'bottom-start',
    onClose: () => { card = null; cardChip = null; }
  });
}

// --- Hover tip ----------------------------------------------------------------------
let tipEl = null;
let tipTimer = 0;
let tipChip = null;

function tipText(chip) {
  if (chip.classList.contains('wr-date')) {
    const key = chip.dataset.date;
    if (!isDateKey(key)) return '';
    return `${dateLongLabel(key, { year: true })} · ${relativeDay(key)}`;
  }
  const def = REF_TYPES[chip.dataset.refType];
  if (!def) return '';
  const inEditor = !!chip.closest('.wr-editor');
  return `${def.label} · ${inEditor ? (API.registry.isMac ? '⌘' : 'Ctrl') + '+click to open' : 'Click to open'}`;
}

function showTip(chip) {
  tipTimer = 0;
  if (!chip.isConnected || card) return;
  const text = tipText(chip);
  if (!text) return;
  if (!tipEl) {
    tipEl = el('div', 'wr-pop wr-chip-tip');
    tipEl.dataset.wrUi = '';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.appendChild(document.createTextNode(''));
  }
  tipEl.firstChild.data = text;
  document.body.appendChild(tipEl);
  ui.positionPopup(tipEl, chip, { placement: 'top-start', gap: 6 });
}

function hideTip() {
  if (tipTimer) { clearTimeout(tipTimer); tipTimer = 0; }
  tipChip = null;
  if (tipEl && tipEl.isConnected) tipEl.remove();
}

function chipAt(target) {
  const t = target && target.nodeType === 1 ? target : target && target.parentElement;
  const chip = t && t.closest ? t.closest('span.wr-date, span.wr-ref') : null;
  return chip && chip.closest('.wr-doc') ? chip : null;
}

function installTip() {
  const canHover = () => !window.matchMedia || window.matchMedia('(hover: hover)').matches;
  document.addEventListener('mouseover', (e) => {
    const chip = chipAt(e.target);
    if (chip === tipChip) return;
    hideTip();
    if (!chip || !canHover()) return;
    tipChip = chip;
    tipTimer = setTimeout(() => showTip(chip), 450);
  }, { passive: true });
  document.addEventListener('mouseout', (e) => {
    if (tipChip && !(e.relatedTarget && tipChip.contains(e.relatedTarget))) hideTip();
  }, { passive: true });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  document.addEventListener('scroll', hideTip, { capture: true, passive: true });
}

// --- Install -------------------------------------------------------------------------
export function install(api) {
  API = api;
  installTip();
  scheduleMidnight();

  // Labels / titles when an editor gets content, and when a view renders
  api.onAttach((editor) => { refreshChips(editor); baselines.set(editor, dom.cleanEditorHtml(editor)); });
  api.hooks.load.push((editor) => {
    refreshChips(editor);
    baselines.set(editor, dom.cleanEditorHtml(editor));
    if (cardChip && editor.contains(cardChip)) closeCard();
  });
  api.onViewAttach((viewEl) => { refreshChips(viewEl); });

  // New chips (typed, pasted, restored by undo) get their today / past tint
  const pending = new Set();
  let timer = 0;
  api.hooks.change.push((editor) => {
    pending.add(editor);
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      pending.forEach(ed => { if (ed.isConnected) noteDateKeysIn(ed); });
      pending.clear();
    }, 400);
  });

  // Chip clicks (editors and views)
  api.hooks.click.push((e, ctx) => {
    const root = ctx.view ? ctx.viewEl : ctx.editor;
    const chip = chipAt(e.target);
    if (!chip || !root || !root.contains(chip)) return false;
    if (chip.classList.contains('wr-ref')) {
      if (!REF_TYPES[chip.dataset.refType]) return false;
      if (ctx.view || dom.isMod(e, ctx.mac)) openRef(chip.dataset.refType, chip.dataset.refId, chip);
      else showRefCard(chip, ctx);
      return true;
    }
    if (!isDateKey(chip.dataset.date)) return false;
    if (cardChip === chip) { closeCard(); return true; }
    showDateCard(chip, ctx);
    return true;
  });
}
