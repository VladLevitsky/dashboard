// Personal Dashboard - Mobile shell: the composer (unit F2)
// Tapping the + (or N in the desktop preview) opens a keyboard-docked
// composer IN THE SAME TAP: the DOM is built at init, open() shows it and
// focuses the input synchronously, so iOS raises the keyboard.
//
//   kinds    Task · Note · Idea · Project · Meeting (the text carries over)
//   line     one input read by the desktop quick-capture parser: dates, times,
//            !red !p !timer !cal !url: !category: !nodate, \ escapes, and
//            "@task" change mode (a pick becomes the ↳ target chip; leftover
//            text becomes a subtask, commands change that task)
//   tray     the effective colour, Primary, date, timer and category. A tray
//            tap REWRITES THE LINE (core/mobile-compose.js setTokenField), so
//            the line stays the only truth. Values the line leaves empty come
//            from where you are (the Tasks lens, else the last commit) and show
//            in a quieter "default" style
//   panel    the date row, category list, @ task list, !category: list or the
//            note card picker, in place of the tray (focus never leaves the input)
//   commit   the form's submit event is the only Add path (every IME's action
//            key works). Tasks commit through quick-capture.js createFromPlan /
//            updateFromPlan; the composer stays open for rapid entry and the
//            line shows "✓ Added … · Undo · Show" for 7 s (undoCapture)
//
// Every tray, panel and kind control prevents pointerdown, so the input keeps
// focus and the keyboard stays up; actions run on click. Back, a scrim tap or
// a drag down closes it and KEEPS the draft (also kept across reloads for
// 24 h, dashboard_mobile_compose.draft). Provides the 'composer' service and
// the 'composer' layer; writes html[data-mx-compose] and --mx-compose-h.

import { model } from '../../state.js';
import { saveModel } from '../../core/storage.js';
import { TASK_COLOR_LABELS } from '../../constants.js';
import { QUICK_CAPTURE_HELP, endAfter } from '../../core/quick-capture-parse.js';
import { meetingOccursOn } from '../../core/agenda.js';
import { firstLineTitle, shortDay } from '../../core/mobile-common.js';
import * as C from '../../core/mobile-compose.js';
import * as qc from '../quick-capture.js';
import * as tasksApi from '../tasks.js';
import * as projectsApi from '../projects.js';
import * as timeApi from '../time-tracking.js';
import * as categoriesApi from '../task-categories.js';
import * as notesApi from '../edit-mode.js';
import { getDataOwner } from '../../core/auth.js';
import { isGcalTasksReady, getGcalDefault } from '../google-calendar.js';
import { dueTimeOf, dueEndTimeOf, formatTimeKey, prefersHour12, timeKeyFromInput, shiftTimeKey } from '../../core/due-time.js';
import { openTimePicker, closeTimePicker } from './time-picker.js?v=2026-10-mobile-8';
import { openDatePicker, closeDatePicker } from './date-field.js?v=2026-10-mobile-8';

const CONFIRM_MS = 7000;
const DRAFT_DEBOUNCE = 300;
const OPEN_GUARD_MS = 350;        // presses this soon after open() are the opening tap's twin
const COMMIT_GUARD_MS = 600;      // an empty Add this soon after a commit is a double tap, not "close"
const PRIORITY_RGB = { red: '249 76 100', orange: '255 133 35', yellow: '242 189 24', blue: '61 151 248' };
const LOADING = 'Writing is still loading…';

const svg = (body, size = 22) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  expand: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
  send: svg('<line x1="12" y1="19" x2="12" y2="5.5"/><polyline points="5.5 12 12 5.5 18.5 12"/>', 22),
  star: svg('<polygon points="12 2.8 14.8 8.6 21.2 9.5 16.6 14 17.7 20.4 12 17.4 6.3 20.4 7.4 14 2.8 9.5 9.2 8.6 12 2.8"/>', 16),
  calendar: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>', 16),
  watch: svg('<circle cx="12" cy="13.5" r="7.5"/><line x1="12" y1="6" x2="12" y2="2.5"/><line x1="9.5" y1="2.5" x2="14.5" y2="2.5"/><polyline points="12 10 12 13.5 14.5 15.5"/>', 18),
  hash: svg('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>', 17),
  gcal: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8.5 15.2 11 17.6 15.5 13.2"/>', 17),
  info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><path d="M12 7.5h.01"/>', 18),
  close: svg('<line x1="17" y1="7" x2="7" y2="17"/><line x1="7" y1="7" x2="17" y2="17"/>', 14),
  back: svg('<polyline points="15 18 9 12 15 6"/>', 18),
  down: svg('<polyline points="6 9 12 15 18 9"/>', 14),
  target: svg('<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>', 15),
  check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>', 16),
};

const PLACEHOLDER = {
  task: 'Add a task…',
  note: 'Title (optional)',
  idea: 'Idea title',
  project: 'Project name',
  meeting: 'Meeting name',
};
const SUBMIT_LABEL = { task: 'Add task', note: 'Save note', idea: 'Save idea', project: 'Create & write', meeting: 'Start notes' };

let api = null;
let store = null;
let fieldsOwner = '';        // the account the text in the fields belongs to
let opener = null;           // what had the focus when it opened (a dismiss gives it back)
const els = {};
const trays = {};                 // kind -> { el, refs } (built once per kind)
const state = {
  open: false,
  kind: 'task',
  from: 'tasks',
  targetId: null,                 // @ change mode
  noteCard: null,                 // the Note kind's card
  meetingDate: null,              // the Meeting kind's date (YYYY-MM-DD)
  panel: null,                    // null | 'date' | 'category' | 'card' | 'picker'
  picker: null,                   // { kind, start, end, query, items, index }
  dismissed: null,                // a list closed with Esc stays closed for that word
  attempted: false,
  defaults: { color: 'blue', pinned: false, category: null, source: 'lens' },
  confirm: null,                  // { text, actions, until }
  message: null,                  // { text, level, until }: a short note in the line
  plan: null,
  shakeTimer: 0,
  openedAt: -Infinity,            // performance.now() of the last open (a double tap on + must not land on the tray)
  swallowClick: false,            // the press started inside that window: its click is dropped
  committedAt: -Infinity,         // performance.now() of the last commit (a double tap on Add must not close)
  meetingPicked: false,           // the Meeting date was picked (else it follows today)
};
let confirmTimer = 0;
let draftTimer = 0;
let liveTimer = 0;
let resizeObserver = null;
let lastComposeH = '';
let helpSheet = null;
const painted = {};               // last written values (only changed ones are written)

const $root = () => document.documentElement;

// ============================================================
// SMALL HELPERS
// ============================================================

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  return n;
}

function button(cls, { label = '', html = '', title = '', submit = false } = {}) {
  const b = el('button', cls, { type: submit ? 'submit' : 'button' });
  if (html) b.innerHTML = html;
  if (label) {
    const t = el('span', 'mx-compose-btn-label', { text: label });
    b.appendChild(t);
  }
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  return b;
}

// Write a text node only when it changed (no childList mutation for glass-glow)
function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) {
    if (t.data !== text) t.data = text;
  } else if (node.textContent !== text) {
    node.textContent = text;
  }
}

function setAttr(node, name, value) {
  if (!node) return;
  if (value == null || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else {
    const v = value === true ? '' : String(value);
    if (node.getAttribute(name) !== v) node.setAttribute(name, v);
  }
}

function setClass(node, cls, on) {
  if (node && node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}

function setHidden(node, hidden) {
  if (node && node.hidden !== !!hidden) node.hidden = !!hidden;
}

function todayKey() {
  return C.toDateKey(new Date());
}

function categories() {
  try { return categoriesApi.getTaskCategories() || []; } catch { return []; }
}

function allTasks() {
  try { return tasksApi.getAllTasks() || []; } catch { return model.tasks || []; }
}

function getTask(id) {
  return id ? (tasksApi.getTaskById ? tasksApi.getTaskById(id) : allTasks().find(t => t.id === id)) || null : null;
}

function runningTaskId() {
  const active = model.timeTracking && model.timeTracking.active;
  return active ? active.taskId : null;
}

function writer() {
  const w = api && api.service('writer');
  return w && typeof w === 'object' ? w : null;
}

function focusInput() {
  const target = state.kind === 'note' || state.kind === 'idea'
    ? (document.activeElement === els.body ? els.body : els.input) : els.input;
  if (document.activeElement !== target) {
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

// ============================================================
// DOM (built once at init, inside #mx-layer-host)
// ============================================================

function ensureDom() {
  if (els.root) return true;
  const host = document.getElementById('mx-layer-host');
  if (!host) return false;

  els.scrim = el('div', 'mx-compose-scrim', { id: 'mx-composer-scrim', 'aria-hidden': 'true' });
  els.scrim.hidden = true;
  els.root = el('section', 'mx-composer', { id: 'mx-composer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Create', 'data-kind': 'task' });
  els.root.hidden = true;

  els.grab = el('div', 'mx-compose-grab', { 'aria-hidden': 'true', html: '<span class="mx-grabber"></span>' });

  els.kinds = el('div', 'mx-compose-kinds', { role: 'tablist', 'aria-label': 'What to create' });
  els.kindBtns = {};
  C.KINDS.forEach(k => {
    const b = el('button', 'mx-compose-kind', { type: 'button', role: 'tab', 'data-kind': k.id, 'aria-selected': 'false', text: k.label });
    b.addEventListener('click', () => setKind(k.id));
    els.kindBtns[k.id] = b;
    els.kinds.appendChild(b);
  });

  els.today = el('div', 'mx-compose-today');
  els.today.hidden = true;

  els.form = el('form', 'mx-compose-form', { id: 'mx-compose-form', novalidate: true, autocomplete: 'off' });
  els.field = el('div', 'mx-compose-field');
  els.target = el('span', 'mx-compose-target');
  els.target.hidden = true;
  els.targetDot = el('span', 'mx-compose-target-dot', { 'aria-hidden': 'true' });
  els.targetLabel = el('span', 'mx-compose-target-label');
  const targetGlyph = el('span', 'mx-compose-target-glyph', { 'aria-hidden': 'true', html: ICON.target });
  els.targetRemove = button('mx-compose-target-x', { html: ICON.close, title: 'Stop changing this task' });
  els.targetRemove.addEventListener('click', () => { clearTarget(); focusInput(); });
  els.target.append(targetGlyph, els.targetDot, els.targetLabel, els.targetRemove);
  els.input = el('input', 'mx-compose-input', {
    id: 'mx-compose-input', type: 'text', enterkeyhint: 'send', autocapitalize: 'sentences', autocorrect: 'on',
    spellcheck: 'true', autocomplete: 'off', 'aria-label': 'New task', placeholder: PLACEHOLDER.task,
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'mx-compose-panel',
  });
  els.field.append(els.target, els.input);
  els.details = button('mx-icon-btn mx-compose-details', { html: ICON.expand, title: 'Details: open in the task editor' });
  els.add = button('mx-compose-add', { html: ICON.send, title: SUBMIT_LABEL.task, submit: true });
  els.form.append(els.field, els.details, els.add);

  els.body = el('textarea', 'mx-compose-body', { rows: '2', 'aria-label': 'Text', placeholder: 'Write… Markdown works: - list, **bold**, [ ] to-do', autocapitalize: 'sentences', spellcheck: 'true' });
  els.body.hidden = true;

  els.line = el('div', 'mx-compose-line');
  els.lineMsg = el('p', 'mx-compose-line-msg');
  els.lineActions = el('span', 'mx-compose-line-actions');
  els.lineLive = el('span', 'mx-visually-hidden', { 'aria-live': 'polite' });
  els.info = button('mx-compose-info', { html: ICON.info, title: 'Commands you can type' });
  els.info.addEventListener('click', openHelp);
  els.line.append(els.lineMsg, els.lineActions, els.info, els.lineLive);

  els.trayHost = el('div', 'mx-compose-trayhost');
  els.panel = el('div', 'mx-compose-panel', { id: 'mx-compose-panel', role: 'listbox', 'aria-label': 'Choices' });
  els.panel.hidden = true;

  els.dateInput = el('input', 'mx-compose-date-input', { type: 'date', tabindex: '-1', 'aria-hidden': 'true' });
  els.dateInput.addEventListener('change', onDatePicked);
  // (times use the shell's own picker, time-picker.js: Chrome's native one
  // can't be typed into and its header can't be read on the app's theme)

  els.root.append(els.grab, els.kinds, els.today, els.form, els.body, els.line, els.trayHost, els.panel, els.dateInput);
  host.append(els.scrim, els.root);

  wireDom();
  return true;
}

function wireDom() {
  // Keep the input focused (and the keyboard up): nothing in the composer but
  // the text fields takes focus on press; actions run on click
  const keep = (e) => {
    const t = e.target;
    if (t === els.input || t === els.body || t === els.dateInput) return;
    e.preventDefault();
  };
  els.root.addEventListener('pointerdown', keep);
  els.root.addEventListener('mousedown', keep);
  // A double tap on the +: the second press lands where the tray now is. Drop
  // its click so it can't toggle a value or open a panel
  els.root.addEventListener('pointerdown', (e) => {
    state.swallowClick = performance.now() - state.openedAt < OPEN_GUARD_MS && e.target !== els.input && e.target !== els.body;
  }, true);
  els.root.addEventListener('click', (e) => {
    if (!state.swallowClick) return;
    state.swallowClick = false;
    if (e.detail === 0) return;      // a keyboard / implicit-submit click is never the twin
    e.preventDefault();
    e.stopPropagation();
  }, true);

  els.form.addEventListener('submit', onSubmit);
  els.input.addEventListener('input', onInput);
  els.input.addEventListener('keydown', onInputKeyDown);
  els.input.addEventListener('click', () => update());
  els.body.addEventListener('input', onBodyInput);
  els.details.addEventListener('click', onDetails);
  els.scrim.addEventListener('click', () => close({ keepDraft: true, refocus: true }));
  wireDragToClose();

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => writeComposeHeight());
    resizeObserver.observe(els.root);
  }
}

function writeComposeHeight() {
  if (!els.root || els.root.hidden) return;
  const h = Math.round(els.root.offsetHeight) + 'px';
  if (h === lastComposeH) return;
  lastComposeH = h;
  $root().style.setProperty('--mx-compose-h', h);
}

// 1 to 6 lines, measured (soft-wrapped lines and a wrapping placeholder count).
// Typing on only grows it (no style write unless the height changes); a
// shorter text, the first character (the placeholder goes), a kind switch or
// an open measures from the minimum again
let bodyLen = 0;
function autosizeBody(force = false) {
  const b = els.body;
  if (!b || b.hidden) return;
  const len = b.value.length;
  const shrink = force || len < bodyLen || (bodyLen === 0 && len > 0);   // fewer lines, or the placeholder went away
  bodyLen = len;
  if (!shrink && b.scrollHeight <= b.clientHeight) return;
  const cs = getComputedStyle(b);
  const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  const max = parseFloat(cs.maxHeight);
  if (shrink) b.style.height = '0px';            // min-height holds it at one line
  let want = Math.ceil(b.scrollHeight + border);
  if (Number.isFinite(max)) want = Math.min(want, Math.ceil(max));
  const next = want + 'px';
  if (b.style.height !== next) b.style.height = next;
}

// Grabber drag down (over 64px, or a fast flick) closes; less glides back
function wireDragToClose() {
  let start = null;
  let mover = null;
  els.grab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    mover = api.createMover(els.root);
    try { els.grab.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  els.grab.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    start.dy = Math.max(0, e.clientY - start.y);
    mover.moveTo(0, start.dy);
  });
  const end = (e) => {
    if (!start || (e && e.pointerId !== start.id)) return;
    const { dy, t } = start;
    const v = dy / Math.max(1, performance.now() - t);
    start = null;
    mover.release();
    if (dy > 64 || (dy > 20 && v > 0.5)) { close({ keepDraft: true, refocus: true }); return; }
    if (dy > 2) api.animate(els.root, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 160 });
  };
  els.grab.addEventListener('pointerup', end);
  els.grab.addEventListener('pointercancel', end);
}

// ============================================================
// OPEN / CLOSE
// ============================================================

function kindForWrite() {
  const ctx = api.getContext() || {};
  let f = ctx.writeFilter || (ctx.write && ctx.write.filter);
  if (!f) { try { f = api.store('write', { perAccount: true }).get('filter', null); } catch { f = null; } }
  const map = { project: 'project', projects: 'project', idea: 'idea', ideas: 'idea', meeting: 'meeting', meetings: 'meeting', note: 'note', notes: 'note' };
  return map[String(f || '').toLowerCase()] || 'task';
}

function storedLens() {
  try {
    const t = api.store('tasks');
    const segment = t.get('segment', null);
    const colors = t.get('color', null);
    if (!segment) return null;
    const color = colors && typeof colors === 'object' ? colors[segment] : null;
    return { segment, color: color || 'all' };
  } catch { return null; }
}

// lens: the caller's lens in place of the published one (composer.defaults)
function computeDefaults(from, lensOverride = null) {
  const ctx = api.getContext() || {};
  const lens = lensOverride || ctx.lens || storedLens();
  const last = store.get('last', null);
  const d = C.composerDefaults({ from, lens, last, tasks: allTasks() });
  return { color: d.color, pinned: d.pinned, category: null, source: d.source };
}

// The 'composer' service: open() focuses the input synchronously (inside the tap)
function open(opts = {}) {
  if (!ensureDom()) {
    if (window.openQuickCapture) window.openQuickCapture({ restoreFocus: false });
    return;
  }
  // Signed out or in as someone else since: that account's text stays in its
  // own draft; the fields show this account's
  if ((getDataOwner() || '') !== fieldsOwner && !state.open) {
    fieldsOwner = getDataOwner() || '';
    els.input.value = '';
    els.body.value = '';
    state.targetId = null;
    state.noteCard = null;
    restoreDraft();
  }
  const explicitKind = C.KIND_IDS.includes(opts.kind) ? opts.kind : null;
  if (state.open) {
    if (explicitKind && explicitKind !== state.kind) setKind(explicitKind);
    focusInput();
    return;
  }
  const from = opts.from || (api.getTab ? api.getTab() : 'tasks');
  state.from = from;
  const typed = els.input.value.trim() || els.body.value.trim() || state.targetId;
  let kind = explicitKind;
  if (!kind) kind = typed ? state.kind : (from === 'write' ? kindForWrite() : 'task');
  if (opts.prefill && typeof opts.prefill === 'object') {
    const pre = opts.prefill;
    const text = pre.text != null ? pre.text : pre.title;
    if (text != null) els.input.value = String(text);
    if (pre.body != null) els.body.value = String(pre.body);
    // A Write section ＋ on a card's notes: the note goes in that card
    if (pre.sectionId && (model.sections || []).some(s => s.id === pre.sectionId)) state.noteCard = pre.sectionId;
  } else if (typeof opts.prefill === 'string') {
    els.input.value = opts.prefill;
  }
  state.defaults = computeDefaults(from);
  state.attempted = false;
  state.panel = null;
  state.picker = null;
  state.dismissed = null;
  // The Meeting kind starts on today every time (a picked date lasts while it is open)
  state.meetingDate = todayKey();
  state.meetingPicked = false;
  clearMessage();
  applyKind(kind);

  // 1-3: show, flag <html>, focus (no await, timer or rAF before it: iOS)
  opener = document.activeElement;
  els.root.hidden = false;
  els.scrim.hidden = false;
  $root().setAttribute('data-mx-compose', '');
  state.open = true;
  state.openedAt = performance.now();
  state.swallowClick = false;
  try { els.input.focus({ preventScroll: true }); } catch { els.input.focus(); }
  try { const n = els.input.value.length; els.input.setSelectionRange(n, n); } catch { /* not a text input */ }

  // 4: then the unfold from the + (no fill: nothing keeps a transform)
  paint();
  autosizeBody(true);
  if (!window.visualViewport) els.root.classList.add('mx-composer--top');
  api.animate(els.root, [
    { transform: 'translateY(14px) scale(0.94)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)' });
  api.animate(els.scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  writeComposeHeight();
  api.syncHistory();
}

// refocus: a dismiss (scrim, drag down, Back / Escape) gives the focus back
// to what opened it, else the +. Closes that hand over to a writer don't
function close({ keepDraft = true, refocus = false } = {}) {
  if (!state.open) return;
  state.open = false;
  closeHelp();
  if (keepDraft) persistDraft(); else clearDraft();
  clearConfirm();
  state.panel = null;
  state.picker = null;
  if (els.root.contains(document.activeElement)) {
    try { document.activeElement.blur(); } catch { /* gone */ }
  }
  els.root.hidden = true;
  els.scrim.hidden = true;
  $root().removeAttribute('data-mx-compose');
  const back = opener;
  opener = null;
  if (refocus) {
    const target = back && back !== document.body && back.isConnected && !back.closest('[inert], [aria-hidden="true"], [hidden]')
      ? back : document.getElementById('mx-plus');
    if (target && !target.inert) { try { target.focus({ preventScroll: true }); } catch { /* gone */ } }
  }
  api.syncHistory();
}

function isOpen() {
  return state.open;
}

// ============================================================
// KINDS
// ============================================================

function applyKind(kind) {
  state.kind = C.KIND_IDS.includes(kind) ? kind : 'task';
  setAttr(els.root, 'data-kind', state.kind);
  C.KIND_IDS.forEach(k => setAttr(els.kindBtns[k], 'aria-selected', String(k === state.kind)));
  const textual = state.kind === 'note' || state.kind === 'idea';
  setHidden(els.body, !textual);
  setHidden(els.details, state.kind !== 'task');
  setHidden(els.add, state.kind !== 'task');
  setAttr(els.input, 'placeholder', PLACEHOLDER[state.kind]);
  setAttr(els.input, 'aria-label', { task: 'New task', note: 'Note title', idea: 'Idea title', project: 'Project name', meeting: 'Meeting name' }[state.kind]);
  setAttr(els.input, 'enterkeyhint', textual ? 'next' : (state.kind === 'task' ? 'send' : 'go'));
  setAttr(els.add, 'aria-label', SUBMIT_LABEL[state.kind]);
  els.add.title = SUBMIT_LABEL[state.kind];
  if (state.kind !== 'task') { state.picker = null; if (state.panel !== 'card') state.panel = null; }
  if (state.kind === 'note') noteCard();
  showTray(state.kind);
  renderToday();
}

function setKind(kind) {
  if (kind === state.kind) { focusInput(); return; }
  state.panel = null;
  state.attempted = false;
  clearMessage();
  applyKind(kind);
  clearConfirm();
  paint();
  autosizeBody(true);
  focusInput();
  scheduleDraft();
}

// ============================================================
// THE TRAY (one per kind, built once; painted in place)
// ============================================================

function showTray(kind) {
  if (!trays[kind]) trays[kind] = buildTray(kind);
  const t = trays[kind];
  if (els.trayHost.firstChild !== t.el) els.trayHost.replaceChildren(t.el);
}

function buildTray(kind) {
  const tray = el('div', `mx-compose-tray mx-compose-tray--${kind}`, { role: 'toolbar', 'aria-label': 'Options' });
  const refs = {};
  if (kind === 'task') {
    const dots = el('div', 'mx-tray-dots', { role: 'group', 'aria-label': 'Colour' });
    refs.dots = {};
    C.COLOR_ORDER.forEach(color => {
      const b = el('button', 'mx-tray-dot', { type: 'button', 'data-color': color, 'aria-pressed': 'false', 'aria-label': TASK_COLOR_LABELS[color], title: TASK_COLOR_LABELS[color] });
      b.style.setProperty('--priority-rgb', PRIORITY_RGB[color]);
      b.appendChild(el('span', 'mx-tray-dot-core', { 'aria-hidden': 'true' }));
      b.addEventListener('click', () => trayColor(color));
      refs.dots[color] = b;
      dots.appendChild(b);
    });
    refs.star = trayChip('mx-tray-star mx-tray-icon', ICON.star, '', trayPinned, 'Primary');
    refs.date = trayChip('mx-tray-date', ICON.calendar, 'Date', () => togglePanel('date'));
    // A due time sits under the date (the chip keeps its width, the tray its one row)
    refs.dateTime = el('span', 'mx-tray-chip-time');
    refs.dateTime.hidden = true;
    refs.date.appendChild(refs.dateTime);
    refs.timer = trayChip('mx-tray-timer mx-tray-icon', ICON.watch, '', trayTimer, 'Start its timer');
    refs.gcal = trayChip('mx-tray-gcal mx-tray-icon', ICON.gcal, '', trayGcal, 'Add to Google Calendar');
    refs.category = trayChip('mx-tray-cat mx-tray-icon', ICON.hash, '', () => togglePanel('category'), 'Category');
    tray.append(dots, refs.star, refs.date, refs.timer, refs.gcal, refs.category);
  } else if (kind === 'note') {
    const lab = el('span', 'mx-tray-label', { text: 'in:' });
    refs.card = trayChip('mx-tray-card', ICON.doc, 'Card', () => togglePanel('card'));
    refs.card.appendChild(el('span', 'mx-tray-caret', { html: ICON.down, 'aria-hidden': 'true' }));
    const spacer = el('span', 'mx-tray-spacer');
    refs.expand = actionButton('Expand', (e) => expandText('note', e));
    refs.save = actionButton('Save', null, true);
    tray.append(lab, refs.card, spacer, refs.expand, refs.save);
  } else if (kind === 'idea') {
    const hint = el('span', 'mx-tray-hint', { text: 'Saved to Ideas' });
    const spacer = el('span', 'mx-tray-spacer');
    refs.expand = actionButton('Expand', (e) => expandText('idea', e));
    refs.save = actionButton('Save', null, true);
    tray.append(hint, spacer, refs.expand, refs.save);
  } else if (kind === 'project') {
    const hint = el('span', 'mx-tray-hint', { text: 'Opens the project to write in' });
    const spacer = el('span', 'mx-tray-spacer');
    refs.save = actionButton('Create & write', null, true);
    tray.append(hint, spacer, refs.save);
  } else if (kind === 'meeting') {
    refs.when = trayChip('mx-tray-when', ICON.calendar, 'Today', pickMeetingDate);
    refs.when.appendChild(el('span', 'mx-tray-caret', { html: ICON.down, 'aria-hidden': 'true' }));
    const spacer = el('span', 'mx-tray-spacer');
    refs.save = actionButton('Start notes', null, true);
    tray.append(refs.when, spacer, refs.save);
  }
  return { el: tray, refs };
}

function trayChip(cls, icon, label, onClick, title = '') {
  const b = el('button', `mx-tray-chip ${cls}`, { type: 'button' });
  b.appendChild(el('span', 'mx-tray-chip-icon', { html: icon, 'aria-hidden': 'true' }));
  if (label) b.appendChild(el('span', 'mx-tray-chip-label', { text: label }));
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  b.addEventListener('click', onClick);
  return b;
}

// A text action; submit = the form's submit (form attribute), so Save / Create
// & write / Start notes go through the one submit path
function actionButton(label, onClick, submit = false) {
  const b = el('button', `mx-tray-action${submit ? ' mx-tray-action--primary' : ''}`, { type: submit ? 'submit' : 'button', text: label });
  if (submit) b.setAttribute('form', 'mx-compose-form');
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function sourceTitle(source) {
  if (source === 'lens') return 'From your Tasks lens';
  if (source === 'last') return 'Same as your last task';
  if (source === 'session') return 'Same as the task you just added';
  if (source === 'current') return 'The task’s current value';
  return '';
}

// Tray taps rewrite the line, then the line is parsed again (input event)
function rewrite(field, value) {
  const mode = state.targetId ? 'update' : 'create';
  const target = getTask(state.targetId);
  const defaults = mode === 'update' && target
    ? { color: target.color, pinned: !!target.pinned, gcal: target.gcal === true, time: dueTimeOf(target), end: dueEndTimeOf(target) }
    : { color: state.defaults.color, pinned: state.defaults.pinned, gcal: gcalDefault() };
  const r = C.setTokenField(els.input.value, field, value, { now: new Date(), categories: categories(), mode, defaults, hour12: prefersHour12() });
  // End on a space, so the next typed word never glues onto the token ("!orangeCall")
  const text = r.text ? `${r.text} ` : '';
  setLine(text, text.length);
}

function setLine(text, caret = text.length) {
  els.input.value = text;
  focusInput();
  try { els.input.setSelectionRange(caret, caret); } catch { /* not focusable */ }
  els.input.dispatchEvent(new Event('input', { bubbles: true }));
}

function trayColor(color) {
  api.haptic('tick');
  rewrite('color', color);
}

function trayPinned() {
  const eff = state.plan ? state.plan.effective : null;
  const target = getTask(state.targetId);
  const current = eff && eff.pinned != null ? eff.pinned : (target ? !!target.pinned : !!state.defaults.pinned);
  api.haptic('tick');
  rewrite('pinned', !current);
}

function trayTimer() {
  api.haptic('tick');
  rewrite('timer', true);
}

// Google Calendar: the last choice (google-calendar.js), only while connected
function gcalDefault() {
  return isGcalTasksReady() && getGcalDefault();
}

function trayGcal() {
  const eff = state.plan ? state.plan.effective : null;
  const target = getTask(state.targetId);
  const current = eff && eff.gcal != null ? eff.gcal : (target ? target.gcal === true : gcalDefault());
  api.haptic('tick');
  rewrite('gcal', !current);
}

function paintTray(plan) {
  const t = trays[state.kind];
  if (!t) return;
  const r = t.refs;
  if (state.kind === 'task') {
    const eff = plan.effective;
    const target = plan.mode === 'update' ? plan.target : null;
    const src = eff.sources;
    // Update mode: the line's values are set; the rest show the task as it is now
    const color = eff.color || (target ? target.color : null);
    const colorSrc = src.color || (target ? 'current' : null);
    C.COLOR_ORDER.forEach(c => {
      const b = r.dots[c];
      const on = c === color;
      setAttr(b, 'aria-pressed', String(on));
      setClass(b, 'is-set', on && colorSrc === 'line');
      setClass(b, 'is-default', on && colorSrc !== 'line');
      setAttr(b, 'title', on && colorSrc !== 'line' ? `${TASK_COLOR_LABELS[c]} · ${sourceTitle(colorSrc === 'default' ? state.defaults.source : colorSrc)}` : TASK_COLOR_LABELS[c]);
    });
    const pinned = eff.pinned != null ? eff.pinned : (target ? !!target.pinned : false);
    const pinSrc = src.pinned || (target ? 'current' : null);
    setAttr(r.star, 'aria-pressed', String(!!pinned));
    setClass(r.star, 'is-set', pinned && pinSrc === 'line');
    setClass(r.star, 'is-default', pinned && pinSrc !== 'line');
    setClass(r.star, 'is-off-set', !pinned && pinSrc === 'line');
    const starTitle = pinned ? (pinSrc === 'line' ? 'Primary' : `Primary · ${sourceTitle(pinSrc === 'default' ? state.defaults.source : pinSrc)}`) : 'Not Primary. Tap to make it Primary';
    setAttr(r.star, 'title', starTitle);
    setAttr(r.star, 'aria-label', starTitle);
    // The date (the line's, a time alone's day, else the task's own) and its time
    const ownDate = target && !eff.clearDate ? target.dueDate || null : null;
    const lineDate = eff.dueDate || (eff.dueTime && !ownDate ? eff.impliedDate : null);
    const due = lineDate || ownDate;
    const time = due ? (eff.dueTime || (target && !eff.clearTime && !eff.clearDate ? dueTimeOf(target) : null)) : null;
    const end = time ? effectiveEnd() : null;
    const lineSets = !!lineDate || src.time === 'line' || src.end === 'line';
    setText(r.date.querySelector('.mx-tray-chip-label'), eff.clearDate && plan.mode === 'update' ? 'No date' : (due ? C.trayDateLabel(due, new Date()) : 'Date'));
    setText(r.dateTime, time ? C.trayTimeLabel(time, end) : '');
    setHidden(r.dateTime, !time);
    setClass(r.date, 'has-time', !!time);
    setClass(r.date, 'is-set', lineSets || (eff.clearDate && plan.mode === 'update'));
    setClass(r.date, 'is-default', !lineSets && !!due);
    setClass(r.date, 'has-date', !!due);          // narrow phones drop the icon then
    setAttr(r.date, 'aria-pressed', String(state.panel === 'date'));
    const at = !time ? '' : end ? `, ${formatTimeKey(time)} to ${formatTimeKey(end)}` : ` at ${formatTimeKey(time)}`;
    setAttr(r.date, 'aria-label', due ? `Due ${C.describeDate(due, new Date())}${at}. Change the date or time` : 'Pick a due date');
    setAttr(r.timer, 'aria-pressed', String(!!eff.timer));
    setClass(r.timer, 'is-set', !!eff.timer);
    const gcalReady = isGcalTasksReady();
    setHidden(r.gcal, !gcalReady && src.gcal !== 'line');
    setClass(t.el, 'has-gcal', !r.gcal.hidden);   // one more chip: the tray tightens to stay one row
    const onGcal = eff.gcal != null ? eff.gcal : (target ? target.gcal === true : false);
    const gcalSrc = src.gcal || (target ? 'current' : null);
    setAttr(r.gcal, 'aria-pressed', String(!!onGcal));
    setClass(r.gcal, 'is-set', onGcal && gcalSrc === 'line');
    setClass(r.gcal, 'is-default', onGcal && gcalSrc !== 'line');
    setClass(r.gcal, 'is-off-set', !onGcal && gcalSrc === 'line');
    const gcalTitle = onGcal
      ? (gcalSrc === 'line' ? 'On Google Calendar' : `On Google Calendar · ${gcalSrc === 'current' ? 'as it is now' : 'your last choice'}`)
      : 'Not on Google Calendar. Tap to add it';
    setAttr(r.gcal, 'title', gcalTitle);
    setAttr(r.gcal, 'aria-label', gcalTitle);
    const cats = categories();
    setHidden(r.category, cats.length === 0);
    const cat = eff.category;
    setClass(r.category, 'is-set', !!cat && src.category === 'line');
    setClass(r.category, 'is-default', !!cat && src.category !== 'line');
    setAttr(r.category, 'aria-pressed', String(state.panel === 'category'));
    setAttr(r.category, 'title', cat ? `Category: ${cat.name}` : 'Category');
    let catLabel = r.category.querySelector('.mx-tray-chip-label');
    if (cat && !catLabel) { catLabel = el('span', 'mx-tray-chip-label'); r.category.appendChild(catLabel); }
    if (catLabel) { setText(catLabel, cat ? cat.name : ''); setHidden(catLabel, !cat); }
  } else if (state.kind === 'note') {
    const id = noteCard();
    const card = C.noteCardChoices(model, null).find(c => c.id === id);
    setText(r.card.querySelector('.mx-tray-chip-label'), card ? card.title : 'Card');
    setAttr(r.card, 'aria-label', `Save in ${card ? card.title : 'a card'}. Change the card`);
    setAttr(r.card, 'aria-pressed', String(state.panel === 'card'));
  } else if (state.kind === 'meeting') {
    const key = state.meetingDate || todayKey();
    const label = key === todayKey() ? `Today, ${shortDay(key).replace(',', '')}` : shortDay(key);
    setText(r.when.querySelector('.mx-tray-chip-label'), label);
    setAttr(r.when, 'aria-label', `Meeting date ${label}. Change it`);
  }
}

// ============================================================
// PANELS (in place of the tray)
// ============================================================

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  paintPanel(true);
  focusInput();
}

function closePanel() {
  if (!state.panel) return;
  state.panel = null;
  paintPanel(true);
}

function panelChip(label, { sub = '', selected = false, cls = '', onClick, title = '' } = {}) {
  const b = el('button', `mx-panel-chip ${cls}`.trim(), { type: 'button', role: 'option', 'aria-selected': String(!!selected) });
  b.appendChild(el('span', 'mx-panel-chip-label', { text: label }));
  if (sub) b.appendChild(el('span', 'mx-panel-chip-sub', { text: sub }));
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function panelBack(label = 'Back to options') {
  const b = button('mx-panel-back', { html: ICON.back, title: label });
  b.addEventListener('click', () => { state.picker = null; closePanel(); paint(); focusInput(); });
  return b;
}

// rebuild = the panel's content changed (open, another list, other rows)
function paintPanel(rebuild = false) {
  const name = state.picker ? 'picker' : state.panel;
  const show = !!name && state.open;
  setHidden(els.panel, !show);
  setHidden(els.trayHost, show);
  setAttr(els.input, 'aria-expanded', String(name === 'picker'));
  setAttr(els.root, 'data-panel', show ? name : null);
  if (!show) {
    if (painted.panelSig) { els.panel.replaceChildren(); painted.panelSig = ''; }
    els.input.removeAttribute('aria-activedescendant');
    return;
  }
  const sig = panelSignature(name);
  if (!rebuild && sig === painted.panelSig) { highlightPicker(); return; }
  painted.panelSig = sig;
  const nodes = [];
  if (name === 'date') nodes.push(...datePanel());
  else if (name === 'category') nodes.push(...categoryPanel());
  else if (name === 'card') nodes.push(...cardPanel());
  else if (name === 'picker') nodes.push(...pickerPanel());
  setAttr(els.panel, 'data-list', name);
  els.panel.replaceChildren(...nodes);
  highlightPicker();
}

function panelSignature(name) {
  if (name === 'picker' && state.picker) {
    return `picker|${state.picker.kind}|${state.picker.items.map(i => i.id).join(',')}`;
  }
  const eff = state.plan ? state.plan.effective : {};
  return `${name}|${eff.dueDate || ''}|${eff.clearDate ? 1 : 0}|${eff.dueTime || ''}|${eff.clearTime ? 1 : 0}|${effectiveEnd() || ''}|${eff.clearEnd ? 1 : 0}|${state.targetId || ''}|${eff.category ? eff.category.id : ''}|${state.noteCard || ''}|${todayKey()}`;
}

// The time in effect: the line's, else (changing a task) the task's own
function effectiveTime() {
  const eff = state.plan ? state.plan.effective : {};
  if (eff.dueTime) return eff.dueTime;
  const target = getTask(state.targetId);
  return target && !eff.clearTime && !eff.clearDate ? dueTimeOf(target) : null;
}

// The end in effect: the line's, else (changing a task) the task's own, moved
// with a new start the way updateTask will move it
function effectiveEnd() {
  const plan = state.plan;
  if (!plan || state.kind !== 'task' || !effectiveTime()) return null;
  return endAfter(plan.due, plan.mode === 'update' ? getTask(state.targetId) : null) || null;
}

function datePanel() {
  const eff = state.plan ? state.plan.effective : {};
  const row = el('div', 'mx-panel-row mx-panel-row--scroll', { role: 'group', 'aria-label': 'Due date and time' });
  row.appendChild(panelBack());
  C.dateChips(new Date()).forEach(chip => {
    row.appendChild(panelChip(chip.label, {
      sub: chip.id === 'today' || chip.id === 'tomorrow' || chip.id === 'next-mon' ? chip.sub : String(Number(chip.key.slice(8))),
      selected: eff.dueDate === chip.key,
      onClick: () => { api.haptic('tick'); state.panel = null; rewrite('date', chip.token); },
    }));
  });
  row.appendChild(panelChip('Pick…', { cls: 'mx-panel-chip--pick', onClick: pickTaskDate }));
  // A time on the due date (Google Calendar shows the task then)
  const time = effectiveTime();
  row.appendChild(panelChip(time ? formatTimeKey(time, { compact: true }) : 'Time…', {
    cls: 'mx-panel-chip--pick',
    sub: time ? 'time' : '',
    title: time ? 'Change the time' : 'Add a time',
    onClick: pickTaskTime,
  }));
  if (time) {
    // When it ends (Google Calendar blocks start to end; without one, 30 minutes)
    const end = effectiveEnd();
    row.appendChild(panelChip(end ? formatTimeKey(end, { compact: true }) : 'Ends…', {
      cls: 'mx-panel-chip--pick mx-panel-chip--end',
      sub: end ? 'ends' : '',
      title: end ? 'Change when it ends' : 'Add when it ends',
      onClick: pickTaskEnd,
    }));
    if (end) {
      row.appendChild(panelChip('No end', {
        cls: 'mx-panel-chip--quiet',
        onClick: () => { state.panel = null; rewrite('end', null); },
      }));
    }
    row.appendChild(panelChip('No time', {
      cls: 'mx-panel-chip--quiet',
      onClick: () => { state.panel = null; rewrite('time', null); },
    }));
  }
  row.appendChild(panelChip('No date', {
    cls: 'mx-panel-chip--quiet',
    selected: !!eff.clearDate,
    onClick: () => { state.panel = null; rewrite('date', null); },
  }));
  return [row];
}

function categoryPanel() {
  const cats = categories();
  const eff = state.plan ? state.plan.effective : {};
  const row = el('div', 'mx-panel-row mx-panel-row--scroll', { role: 'group', 'aria-label': 'Category' });
  row.appendChild(panelBack());
  if (!cats.length) {
    row.appendChild(el('p', 'mx-panel-hint', { text: 'No categories yet. Add them in More → Task categories.' }));
    return [row];
  }
  cats.forEach(cat => {
    const chip = panelChip(cat.name, {
      selected: !!eff.category && eff.category.id === cat.id,
      cls: 'mx-panel-chip--cat',
      onClick: () => { state.panel = null; rewrite('category', cat); },
    });
    try { chip.style.setProperty('--chip-color', categoriesApi.categoryColor(cat)); } catch { /* default tint */ }
    chip.prepend(el('span', 'mx-panel-cat-dot', { 'aria-hidden': 'true' }));
    row.appendChild(chip);
  });
  if (eff.category && state.plan.effective.sources.category === 'line') {
    row.appendChild(panelChip('None', { cls: 'mx-panel-chip--quiet', onClick: () => { state.panel = null; rewrite('category', null); } }));
  }
  return [row];
}

function cardPanel() {
  const list = el('div', 'mx-panel-list', { role: 'group', 'aria-label': 'Save the note in' });
  const head = el('div', 'mx-panel-head');
  head.append(panelBack('Back'), el('span', 'mx-panel-title', { text: 'Save in' }));
  list.appendChild(head);
  C.noteCardChoices(model, store.get('noteCard', null)).forEach(card => {
    const row = el('button', 'mx-panel-item', { type: 'button', role: 'option', 'aria-selected': String(card.id === state.noteCard) });
    row.append(el('span', 'mx-panel-item-title', { text: card.title }),
      el('span', 'mx-panel-item-meta', { text: card.count ? `${card.count} note${card.count === 1 ? '' : 's'}` : '' }));
    row.addEventListener('click', () => {
      state.noteCard = card.id;
      state.panel = null;
      paint();
      focusInput();
      scheduleDraft();
    });
    list.appendChild(row);
  });
  return [list];
}

function pickerPanel() {
  const p = state.picker;
  const box = el('div', 'mx-panel-list mx-panel-list--picker', { role: 'group', 'aria-label': p.kind === 'task' ? 'Change a task' : 'Category' });
  if (!p.items.length) {
    box.appendChild(el('p', 'mx-panel-hint', {
      text: p.kind === 'task' ? 'No matching tasks. Keep typing, or add a space to keep it as text'
        : (categories().length ? 'No matching category' : 'No categories yet. Add them in More → Task categories.'),
    }));
    return [box];
  }
  p.items.forEach((item, index) => {
    const row = el('button', 'mx-panel-item', { type: 'button', role: 'option', id: `mx-compose-opt-${index}`, 'data-index': String(index), 'aria-selected': 'false' });
    if (p.kind === 'task') {
      const color = C.COLOR_ORDER.includes(item.color) ? item.color : 'blue';
      const dot = el('span', 'mx-panel-item-dot', { 'aria-hidden': 'true' });
      dot.style.setProperty('--priority-rgb', PRIORITY_RGB[color]);
      row.append(dot, el('span', 'mx-panel-item-title', { text: item.title || 'Untitled task' }));
      if (item.pinned) row.appendChild(el('span', 'mx-panel-item-badge', { text: 'Primary' }));
      row.setAttribute('aria-label', `${item.title || 'Untitled task'}, ${TASK_COLOR_LABELS[color]}${item.pinned ? ', Primary' : ''}`);
    } else {
      const dot = el('span', 'mx-panel-cat-dot', { 'aria-hidden': 'true' });
      row.style.setProperty('--chip-color', categoriesApi.categoryColor(item));
      row.append(dot, el('span', 'mx-panel-item-title', { text: item.name }));
    }
    row.addEventListener('click', () => pick(index));
    box.appendChild(row);
  });
  return [box];
}

function highlightPicker() {
  if (!state.picker) return;
  els.panel.querySelectorAll('[data-index]').forEach(row => {
    const on = Number(row.dataset.index) === state.picker.index;
    setAttr(row, 'aria-selected', String(on));
    setClass(row, 'is-active', on);
    if (on) setAttr(els.input, 'aria-activedescendant', row.id);
  });
}

// Typing "@…" or "!category:…" opens a list (the desktop bar's rules)
function updatePicker() {
  if (state.kind !== 'task') { state.picker = null; return; }
  const ctx = C.detectPicker(els.input.value, els.input.selectionStart, els.input.selectionEnd);
  if (!ctx) { state.dismissed = null; state.picker = null; return; }
  if (state.dismissed && state.dismissed.kind === ctx.kind && state.dismissed.start === ctx.start) { state.picker = null; return; }
  state.dismissed = null;
  const items = ctx.kind === 'task' ? C.matchTasks(allTasks(), ctx.query, 4) : C.matchCategories(categories(), ctx.query);
  if (ctx.kind === 'task' && items.length === 0 && /\s$/.test(ctx.query)) {
    state.dismissed = { kind: ctx.kind, start: ctx.start };
    state.picker = null;
    return;
  }
  const prev = state.picker;
  const same = prev && prev.kind === ctx.kind && prev.start === ctx.start && prev.query === ctx.query;
  const index = same ? Math.min(prev.index, items.length - 1) : (items.length ? 0 : -1);
  state.picker = { ...ctx, items, index };
  state.panel = null;
}

function pick(index) {
  const p = state.picker;
  if (!p) return;
  const item = p.items[index];
  if (!item) return;
  api.haptic('tick');
  if (p.kind === 'task') {
    const r = C.removeRange(els.input.value, p.start, p.end);
    state.targetId = item.id;
    state.picker = null;
    state.dismissed = null;
    setLine(r.text, r.caret);
  } else {
    const value = els.input.value;
    const token = C.categoryToken(item, categories());
    const before = value.slice(0, p.start);
    const after = value.slice(p.end);
    let text = (before + token + (after && !/^\s/.test(after) ? ' ' : '') + after).replace(/\s+/g, ' ').trim();
    if (!after.trim()) text += ' ';     // the caret lands after a space, ready for the next word
    state.picker = null;
    setLine(text, Math.min(text.length, (before + token).length + 1));
  }
}

function dismissPicker() {
  if (!state.picker) return;
  state.dismissed = { kind: state.picker.kind, start: state.picker.start };
  state.picker = null;
  paint();
}

function clearTarget() {
  if (!state.targetId) return;
  state.targetId = null;
  update();
  scheduleDraft();
}

// The native calendar opens on the line's own date only: with none it opens
// on today with an empty value, so confirming today is a change (and fires).
// The line takes typed dates itself (fri, 21/12, Dec 21)
function pickTaskDate() {
  const eff = state.plan ? state.plan.effective : {};
  els.dateInput.value = eff.dueDate || '';
  showNativePicker();
}

// The meeting line is its title: the date is picked or typed in the date
// sheet (date-field.js, over the composer). Set on the date it shows counts
// as picked; the focus (and the keyboard) goes back to the line
function pickMeetingDate() {
  openDatePicker({
    value: state.meetingDate || todayKey(),
    title: 'Meeting date',
    returnFocus: els.input,
    onPick: (v) => {
      state.meetingDate = v;
      state.meetingPicked = true;
      paint();
      focusInput();
    },
  });
}

// The time picker (time-picker.js, over the composer) opens on the time in
// effect, else on the next whole hour. Set rewrites the line and gives the
// focus (and the keyboard) back to it; Cancel / Back just give it back
function pickTaskTime() {
  const time = effectiveTime();
  const next = new Date(Date.now() + 3600000);
  openTimePicker({
    value: time || `${String(next.getHours()).padStart(2, '0')}:00`,
    mode: 'start',
    title: time ? 'Change the time' : 'Add a time',
    hour12: prefersHour12(),
    returnFocus: els.input,
    onPick: onTimePicked,
    onClear: time ? () => { state.panel = null; rewrite('time', null); } : null,
  });
}

function onTimePicked(value) {
  const v = timeKeyFromInput(value);
  if (!v) return;
  // Set on the time already in effect leaves the line alone (setTokenField's
  // same value would remove the time and its range; Clear / No time do that)
  if (v === effectiveTime()) { closePanel(); return; }
  state.panel = null;
  rewrite('time', v);
}

// The end picker opens on the end in effect, else an hour after the start
// (times at or before the start are off in it)
function pickTaskEnd() {
  const start = effectiveTime();
  if (!start) return;
  const end = effectiveEnd();
  openTimePicker({
    value: end || shiftTimeKey(start, 60) || '23:59',
    mode: 'end',
    start,
    title: end ? 'Change when it ends' : 'When it ends',
    hour12: prefersHour12(),
    returnFocus: els.input,
    onPick: onEndPicked,
    onClear: end ? () => { state.panel = null; rewrite('end', null); } : null,
  });
}

function onEndPicked(value) {
  const v = timeKeyFromInput(value);
  const start = effectiveTime();
  if (!v || !start) return;
  if (v <= start) {
    showMessage(`It has to end after it starts (${formatTimeKey(start)})`);
    return;
  }
  state.panel = null;
  rewrite('end', v);
}

// Inside the tap (showPicker needs the user activation)
function showNativePicker(input = els.dateInput) {
  try {
    if (typeof input.showPicker === 'function') { input.showPicker(); return; }
  } catch { /* not allowed here: fall through */ }
  try { input.focus(); input.click(); } catch { /* no picker */ }
}

function onDatePicked() {
  const v = els.dateInput.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  // The date already in effect leaves the line alone (setTokenField's same
  // value would remove it; No date does that)
  const eff = state.plan ? state.plan.effective : {};
  if (v === eff.dueDate) { closePanel(); return; }
  state.panel = null;
  rewrite('date', v);
}

// ============================================================
// MEETING: today's recurring meetings (jump in) and the new one's date
// ============================================================

function renderToday() {
  const show = state.kind === 'meeting';
  const key = todayKey();
  const meetings = show ? (model.meetings || []).filter(m => { try { return meetingOccursOn(m, key); } catch { return false; } }) : [];
  const sig = show ? `${key}|${meetings.map(m => `${m.id}:${m.title}`).join(',')}` : '';
  if (sig === painted.today) return;
  painted.today = sig;
  setHidden(els.today, !meetings.length);
  if (!meetings.length) { els.today.replaceChildren(); return; }
  const label = el('span', 'mx-compose-today-label', { text: 'Today' });
  const row = el('div', 'mx-compose-today-row');
  meetings.forEach(m => {
    const b = el('button', 'mx-compose-today-chip', { type: 'button' });
    b.append(el('span', 'mx-compose-today-icon', { html: ICON.doc, 'aria-hidden': 'true' }),
      el('span', 'mx-compose-today-title', { text: m.title || 'Meeting' }),
      el('span', 'mx-compose-today-sub', { text: '· add today’s notes ›' }));
    b.setAttribute('aria-label', `${m.title || 'Meeting'}: add today’s notes`);
    b.addEventListener('click', () => jumpIntoMeeting(m.id));
    row.appendChild(b);
  });
  els.today.replaceChildren(label, row);
}

function jumpIntoMeeting(id) {
  const w = writer();
  if (!w || typeof w.meetingJumpIn !== 'function') { showMessage(LOADING, 'warning'); return; }
  close({ keepDraft: true });
  try { w.meetingJumpIn(id); } catch (err) { console.error('[mobile] meeting jump-in failed', err); }
}

// ============================================================
// INPUT, UPDATE, PAINT
// ============================================================

function onInput() {
  if (state.shakeTimer) { clearTimeout(state.shakeTimer); state.shakeTimer = 0; els.root.classList.remove('mx-shake'); }
  clearMessage();                   // what the new text does always shows (no stale "Undone: ...")
  update();
  scheduleDraft();
}

// Note / Idea body: grow, keep the draft, and drop a stale "Write something first"
function onBodyInput() {
  autosizeBody();
  scheduleDraft();
  const stale = state.message || (state.attempted && els.body.value.trim());
  if (!stale) return;
  clearMessage();
  if (els.body.value.trim()) state.attempted = false;
  paint();
}

function onInputKeyDown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  const p = state.picker;
  if (p) {
    const count = p.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) {
        p.index = p.index < 0 ? 0 : (p.index + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
        highlightPicker();
      }
      return;
    }
    if (e.key === 'Tab' && count && !e.shiftKey) { e.preventDefault(); pick(Math.max(0, p.index)); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissPicker(); return; }
  }
  if (e.key === 'Escape' && state.panel) { e.preventDefault(); e.stopPropagation(); closePanel(); paint(); return; }
  if (e.key === 'Backspace' && state.targetId && els.input.selectionStart === 0 && els.input.selectionEnd === 0) {
    e.preventDefault();
    clearTarget();
    return;
  }
  // Note / Idea: Enter in the title goes on to the body (the submit button saves)
  if (e.key === 'Enter' && (state.kind === 'note' || state.kind === 'idea')) {
    e.preventDefault();
    try { els.body.focus({ preventScroll: true }); } catch { els.body.focus(); }
  }
}

function currentPlan() {
  const target = getTask(state.targetId);
  const p = state.picker;
  return C.buildComposerPlan({
    text: els.input.value,
    targetId: state.targetId,
    target,
    defaults: { ...state.defaults, gcal: gcalDefault() },
    now: new Date(),
    categories: categories(),
    blank: p ? { start: p.start, end: p.end } : null,
    runningTaskId: runningTaskId(),
    gcalReady: isGcalTasksReady(),
  });
}

function update() {
  if (!els.root) return;
  updatePicker();
  paint();
}

function paint() {
  if (!els.root) return;
  const plan = state.kind === 'task' ? currentPlan() : null;
  state.plan = plan;
  renderToday();
  paintTarget();
  if (plan) paintTray(plan); else paintTray({ effective: {}, mode: 'create' });
  paintPanel();
  paintLine(plan);
}

function paintTarget() {
  const task = state.kind === 'task' ? getTask(state.targetId) : null;
  const show = !!state.targetId && state.kind === 'task';
  setHidden(els.target, !show);
  setAttr(els.root, 'data-mode', show ? 'update' : null);
  if (!show) return;
  const color = task && C.COLOR_ORDER.includes(task.color) ? task.color : 'blue';
  els.targetDot.style.setProperty('--priority-rgb', PRIORITY_RGB[color]);
  setText(els.targetLabel, task ? (task.title || 'Untitled task') : 'Task not found');
  setAttr(els.target, 'title', task ? `Changing “${task.title || 'Untitled task'}”` : 'That task was completed or deleted');
  setAttr(els.input, 'placeholder', 'Add a subtask, a date or a command…');
}

function paintLine(plan) {
  let msg;
  if (state.kind === 'task') {
    const typed = els.input.value.trim() !== '' || !!state.targetId;
    const running = runningTaskId();
    const runningTask = running && (!plan.target || plan.target.id !== running) ? getTask(running) : null;
    msg = C.lineFor(plan, { now: new Date(), attempted: state.attempted, typed, runningTitle: runningTask ? runningTask.title : null });
  } else {
    msg = kindLine();
  }
  // The inline confirmation stays for its 7 s unless the line has something to say
  // (an @ target's change preview wins: it says what Add will do to that task; so does
  // a warning just shown, like a line warning)
  const loudMessage = !!state.message && Date.now() < state.message.until && (state.message.level === 'warning' || state.message.level === 'error');
  if (state.confirm && Date.now() < state.confirm.until && !state.targetId && !loudMessage && (msg.level === 'preview' || msg.level === 'hint')) {
    writeLine(state.confirm.text, 'done', state.confirm.actions);
    return;
  }
  if (state.message && Date.now() < state.message.until && msg.level !== 'error') {
    writeLine(state.message.text, state.message.level, null);
    return;
  }
  writeLine(msg.text, msg.level, null);
}

function kindLine() {
  if (state.attempted && state.kind !== 'project' && state.kind !== 'meeting' && !els.input.value.trim() && !els.body.value.trim()) {
    return { level: 'error', text: 'Write something first' };
  }
  if (state.kind === 'note') return { level: 'hint', text: 'Saved to the card’s notes. Expand for the full editor' };
  if (state.kind === 'idea') return { level: 'hint', text: 'A title, then your thoughts. Expand for the full editor' };
  if (state.kind === 'project') return { level: 'hint', text: els.input.value.trim() ? `New project “${els.input.value.trim()}”` : 'Name it, then write' };
  return { level: 'hint', text: els.input.value.trim() ? `New meeting “${els.input.value.trim()}”` : 'A one-time meeting. Name it, then take notes' };
}

function writeLine(text, level, actions) {
  setAttr(els.line, 'data-level', level);
  setText(els.lineMsg, text);
  const sig = actions ? actions.map(a => a.label).join('|') + '|' + text : '';
  if (sig !== painted.actions) {
    painted.actions = sig;
    els.lineActions.replaceChildren(...(actions || []).map(a => {
      const b = el('button', 'mx-compose-line-btn', { type: 'button', text: a.label });
      b.addEventListener('click', (e) => a.run(e));
      return b;
    }));
  }
  setHidden(els.lineActions, !actions || !actions.length);
  setHidden(els.info, state.kind !== 'task' || !!(actions && actions.length));
  // Screen readers hear the line at most every 700 ms (typing changes it per key)
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => setText(els.lineLive, text), level === 'done' || level === 'error' ? 0 : 700);
}

let messageTimer = 0;
function showMessage(text, level = 'warning', ms = 4000) {
  clearTimeout(messageTimer);
  state.message = { text, level, until: Date.now() + ms };
  paint();
  messageTimer = setTimeout(() => { if (state.message && Date.now() >= state.message.until) { state.message = null; if (state.open) paint(); } }, ms + 30);
}

function clearMessage() {
  clearTimeout(messageTimer);
  state.message = null;
}

function setConfirm(text, actions) {
  clearTimeout(confirmTimer);
  clearMessage();
  state.confirm = { text, actions, until: Date.now() + CONFIRM_MS };
  confirmTimer = setTimeout(() => { state.confirm = null; if (state.open) paint(); }, CONFIRM_MS + 20);
  paint();
}

function clearConfirm() {
  clearTimeout(confirmTimer);
  state.confirm = null;
}

function shake() {
  const root = els.root;
  root.classList.remove('mx-shake');
  void root.offsetWidth;            // restart the animation
  root.classList.add('mx-shake');
  clearTimeout(state.shakeTimer);
  state.shakeTimer = setTimeout(() => { root.classList.remove('mx-shake'); state.shakeTimer = 0; }, 1200);
  api.haptic('commit');
}

// ============================================================
// COMMIT
// ============================================================

function onSubmit(e) {
  e.preventDefault();
  if (!state.open) return;
  // A list is open: Add / the action key picks the highlighted row, never saves
  if (state.picker) {
    if (state.picker.items.length && state.picker.index >= 0) pick(state.picker.index);
    else dismissPicker();
    return;
  }
  // A double tap on Add / Save: the second, empty submit is not "close" (nor
  // "Write something first"); the confirmation and its Undo stay
  const textual = state.kind === 'note' || state.kind === 'idea';
  const empty = !els.input.value.trim() && !state.targetId && !(textual && els.body.value.trim());
  if (empty && performance.now() - state.committedAt < COMMIT_GUARD_MS) { focusInput(); return; }
  switch (state.kind) {
    case 'task': submitTask(); break;
    case 'note': saveNote(); break;
    case 'idea': saveIdea(); break;
    case 'project': createProjectNow(); break;
    case 'meeting': startMeeting(); break;
    default: break;
  }
}

function submitTask() {
  // Add on an empty line closes (the draft is empty anyway)
  if (!els.input.value.trim() && !state.targetId) { close({ keepDraft: true }); return; }
  const record = commitTask();
  if (!record) return;
  const task = getTask(record.taskId);
  const name = clip(task ? task.title : 'Untitled task', 34);
  const actions = [
    { label: 'Undo', run: () => undoRecord(record) },
    { label: 'Show', run: () => showTask(record.taskId) },
  ];
  setConfirm(`✓ ${record.created ? 'Added' : 'Updated'} “${name}”`, actions);
}

// Create or update through the desktop bar's own functions. Returns the record
// (for Undo), or null when the line has an error (the composer shakes)
function commitTask() {
  const plan = currentPlan();
  if (plan.hasErrors) {
    state.attempted = true;
    state.confirm = null;
    paint();
    shake();
    return null;
  }
  const record = plan.mode === 'create' ? qc.createFromPlan(plan) : qc.updateFromPlan(plan);
  if (plan.parsed.timer && timeApi.startTimerForTask) record.timer = timeApi.startTimerForTask(record.taskId);
  try { if (tasksApi.refreshTaskViews) tasksApi.refreshTaskViews(); } catch (err) { console.error('[mobile] refreshTaskViews failed', err); }
  record.after = JSON.stringify(getTask(record.taskId));
  try { if (timeApi.refreshTimeTrackingUI) timeApi.refreshTimeTrackingUI(); } catch { /* repaints on its next tick */ }
  api.haptic('commit');
  state.committedAt = performance.now();

  if (plan.mode === 'create') {
    // Rapid entry keeps the colour, Primary and category; the date and timer reset
    state.defaults = { color: plan.parsed.color, pinned: plan.parsed.pinned === true, category: plan.category || null, source: 'session' };
    store.set('last', { color: plan.parsed.color, pinned: plan.parsed.pinned === true });
  }
  els.input.value = '';
  state.targetId = null;
  state.attempted = false;
  state.panel = null;
  state.picker = null;
  state.dismissed = null;
  clearDraft();
  focusInput();
  return record;
}

function undoRecord(record) {
  clearConfirm();
  // silent: the line says what happened; no bottom toast while the composer is open (SPEC 3.5)
  try { qc.undoCapture(record, { silent: true }); } catch (err) { console.error('[mobile] undo failed', err); }
  try { if (timeApi.refreshTimeTrackingUI) timeApi.refreshTimeTrackingUI(); } catch { /* next tick */ }
  const gone = record.created ? !getTask(record.taskId) : JSON.stringify(getTask(record.taskId)) !== record.after;
  showMessage(gone ? (record.created ? 'Undone: the task is gone' : 'Undone: the task is back as it was') : 'Can’t undo: the task has changed since', gone ? 'hint' : 'warning', 3000);
  focusInput();
}

function showTask(taskId) {
  clearConfirm();
  close({ keepDraft: true });
  if (!getTask(taskId)) return;
  api.navigate('tasks', { reveal: { taskId } });
}

function onDetails() {
  if (state.kind !== 'task') return;
  const empty = !els.input.value.trim();
  if (empty) {
    const targetId = state.targetId;
    close({ keepDraft: true });
    if (targetId && getTask(targetId)) tasksApi.openEditTaskModal(targetId);
    else if (tasksApi.openAddTaskModal) tasksApi.openAddTaskModal();
    return;
  }
  const record = commitTask();
  if (!record) return;
  clearConfirm();
  close({ keepDraft: false });
  tasksApi.openEditTaskModal(record.taskId);
}

const clip = (s, max) => { const t = String(s || '').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };

// --- Note: saved straight into the card's notes (no editor) ------------------------

function noteFields() {
  const title = els.input.value.trim();
  const md = els.body.value;
  const html = C.bodyToHtml(md);
  return { title, md, html };
}

// The Note kind's card. One that no longer exists (deleted on another device
// and pulled in, or named by a day-old draft) falls back to the default card,
// so the tray chip, Save and Expand always agree on a live card (null: none)
function noteCard() {
  const live = state.noteCard && C.noteCardChoices(model, null).some(c => c.id === state.noteCard);
  if (!live) state.noteCard = C.defaultNoteCard(model, store.get('noteCard', null));
  return state.noteCard;
}

function saveNote() {
  const { title, md, html } = noteFields();
  if (!title && !md.trim()) { state.attempted = true; paint(); shake(); return; }
  const sectionId = noteCard();
  if (!sectionId) { showMessage('There is no card to keep the note in', 'error'); return; }
  const list = notesApi.getNotesForSection(sectionId);
  if (!model.cardNotes || typeof model.cardNotes !== 'object') model.cardNotes = {};
  if (model.cardNotes[sectionId] !== list) model.cardNotes[sectionId] = list;
  const note = C.makeNote({ title: title || firstLineTitle(html) || 'Untitled', html, now: Date.now() });
  list.push(note);
  saveModel();
  store.set('noteCard', sectionId);
  api.haptic('commit');
  state.committedAt = performance.now();
  clearTextFields();
  setConfirm('✓ Note saved', [{ label: 'Open', run: (e) => openNote(sectionId, note.key, e) }]);
}

// The notepad closes on a document click outside it: this click must not reach the document
function openNote(sectionId, key, event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  close({ keepDraft: true });
  const w = writer();
  if (w && typeof w.open === 'function') {
    try { if (w.open('note', key, { sectionId, event }) !== false) return; } catch (err) { console.error('[mobile] writer.open failed', err); }
  }
  if (notesApi.openNotepad) notesApi.openNotepad(sectionId);
  if (notesApi.openNoteViewer) notesApi.openNoteViewer(key);
}

// --- Idea --------------------------------------------------------------------

function createIdeaRecord(title, html) {
  if (typeof tasksApi.createIdea === 'function') return tasksApi.createIdea(title, html);
  // F1's export not there yet: the same record tasks.js createIdea makes
  if (!Array.isArray(model.ideas)) model.ideas = [];
  const idea = { id: 'idea-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9), title: title || '', description: html || '' };
  model.ideas.push(idea);
  saveModel();
  return idea;
}

function saveIdea() {
  const { title, md, html } = noteFields();
  if (!title && !md.trim()) { state.attempted = true; paint(); shake(); return; }
  const idea = createIdeaRecord(title || firstLineTitle(html) || 'Untitled idea', html);
  api.haptic('commit');
  state.committedAt = performance.now();
  clearTextFields();
  setConfirm('✓ Idea saved', [{ label: 'Open', run: (e) => openIdea(idea.id, e) }]);
}

function openIdea(id, event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  close({ keepDraft: true });
  const w = writer();
  if (w && typeof w.open === 'function') {
    try { if (w.open('idea', id, { event }) !== false) return; } catch (err) { console.error('[mobile] writer.open failed', err); }
  }
  if (tasksApi.openIdeasModal) tasksApi.openIdeasModal(id);
}

// Expand: the full writer, prefilled (inside the tap, so the keyboard carries
// over). The composer closes first (it blurs its field); when the writer then
// can't open, the text goes back into the composer and its draft
function expandText(kind, event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  const { title, md, html } = noteFields();
  const w = writer();
  if (w && typeof w.create === 'function') {
    const sectionId = kind === 'note' ? noteCard() : null;
    if (kind === 'note' && !sectionId) { showMessage('There is no card to keep the note in', 'error'); return; }
    const line = els.input.value;
    clearTextFields();
    close({ keepDraft: false });
    let opened = false;
    try {
      if (kind === 'note') { store.set('noteCard', sectionId); opened = w.create('note', { sectionId, title, html, event }) !== false; }
      else opened = w.create('idea', { title, html, event }) !== false;
    } catch (err) { console.error('[mobile] writer.create failed', err); }
    if (!opened) {
      els.input.value = line;
      els.body.value = md;
      persistDraft();
      api.toast("Couldn't open the writer. Your text is still in +");
    }
    return;
  }
  if (kind === 'idea') {
    // Fallback: the idea is kept and opened in the Ideas window
    const idea = createIdeaRecord(title || firstLineTitle(html) || 'Untitled idea', html);
    clearTextFields();
    close({ keepDraft: false });
    if (tasksApi.openIdeasModal) tasksApi.openIdeasModal(idea.id);
    return;
  }
  showMessage(LOADING);
}

// --- Project: create, then write ------------------------------------------------

function createProjectNow() {
  const title = els.input.value.trim() || 'Untitled project';
  const w = writer();
  clearTextFields();
  close({ keepDraft: false });
  if (w && typeof w.create === 'function') {
    try { w.create('project', { title }); return; } catch (err) { console.error('[mobile] writer.create failed', err); }
  }
  // Fallback: the same two steps the writer takes
  const project = projectsApi.createProject ? projectsApi.createProject(title) : null;
  const openModal = projectsApi.openProjectsModal || window.openProjectsModal;
  if (openModal) openModal(project ? project.id : undefined);
}

// --- Meeting: a new one-time meeting, straight into its notes ----------------------

function startMeeting() {
  const w = writer();
  if (!w || typeof w.create !== 'function') { showMessage(LOADING); return; }
  const title = els.input.value.trim() || 'Meeting';
  const date = state.meetingDate || todayKey();
  state.meetingDate = todayKey();
  state.meetingPicked = false;
  clearTextFields();
  close({ keepDraft: false });
  try { w.create('meeting', { title, date }); } catch (err) { console.error('[mobile] writer.create failed', err); }
}

function clearTextFields() {
  els.input.value = '';
  els.body.value = '';
  state.targetId = null;
  state.attempted = false;
  state.panel = null;
  clearDraft();
  autosizeBody();
  paint();
}

// ============================================================
// DRAFT (per browser, 24 h)
// ============================================================

function draftNow() {
  return {
    kind: state.kind,
    text: els.input.value,
    body: els.body.value,
    targetTaskId: state.targetId,
    noteCard: state.noteCard,
    at: Date.now(),
  };
}

function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, DRAFT_DEBOUNCE);
}

function persistDraft() {
  clearTimeout(draftTimer);
  if (!els.root) return;
  const d = draftNow();
  if (C.draftIsFresh(d, d.at)) store.set('draft', d); else store.set('draft', undefined);
}

function clearDraft() {
  clearTimeout(draftTimer);
  store.set('draft', undefined);
}

function restoreDraft() {
  const d = store.get('draft', null);
  if (!C.draftIsFresh(d, Date.now())) { if (d) store.set('draft', undefined); return; }
  els.input.value = String(d.text || '');
  els.body.value = String(d.body || '');
  state.targetId = d.targetTaskId && getTask(d.targetTaskId) ? d.targetTaskId : null;
  if (d.noteCard) state.noteCard = d.noteCard;
  if (C.KIND_IDS.includes(d.kind)) state.kind = d.kind;
}

// ============================================================
// COMMAND HELP (ⓘ): a sheet above the composer; an example tap inserts it
// ============================================================

function openHelp() {
  if (helpSheet) return;
  helpSheet = api.openSheet({
    id: 'compose-help',
    title: 'Type it in the line',
    size: 'tall',
    build(body) {
      const wrap = el('div', 'mx-compose-help');
      QUICK_CAPTURE_HELP.forEach(group => {
        const sec = el('section', 'mx-compose-help-group');
        sec.appendChild(el('h3', 'mx-compose-help-title', { text: group.title }));
        group.rows.forEach(row => {
          const r = el('div', 'mx-compose-help-row');
          const ex = el('div', 'mx-compose-help-examples');
          row.examples.forEach(x => {
            if (x.insert) {
              const b = el('button', 'mx-compose-help-ex', { type: 'button', text: x.text });
              if (x.color) b.style.setProperty('--priority-rgb', PRIORITY_RGB[x.color]);
              b.addEventListener('click', () => insertExample(x.insert));
              ex.appendChild(b);
            } else {
              ex.appendChild(el('code', 'mx-compose-help-code', { text: x.text }));
            }
          });
          r.append(ex, el('p', 'mx-compose-help-meaning', { text: row.meaning }));
          sec.appendChild(r);
        });
        wrap.appendChild(sec);
      });
      body.appendChild(wrap);
    },
    onClose() { helpSheet = null; },
  });
  // Above the composer (sheets stack from 950; the composer is 980)
  if (helpSheet && helpSheet.el) {
    helpSheet.el.style.zIndex = '986';
    const scrim = helpSheet.el.previousElementSibling;
    if (scrim && scrim.classList.contains('mx-scrim')) scrim.style.zIndex = '985';
  }
}

function closeHelp() {
  if (helpSheet) helpSheet.close({ immediate: true });
  helpSheet = null;
}

function insertExample(insert) {
  closeHelp();
  if (state.kind !== 'task') applyKind('task');
  const value = els.input.value;
  const lead = value && !/\s$/.test(value) ? ' ' : '';
  setLine(value + lead + insert);
}

// ============================================================
// INIT
// ============================================================

export default {
  init(shellApi) {
    api = shellApi;
    store = api.store('compose', { perAccount: true });
    fieldsOwner = getDataOwner() || '';
    ensureDom();
    restoreDraft();
    if (els.root) applyKind(state.kind);

    api.provide('composer', {
      open: (opts) => open(opts || {}),
      close: (opts) => close(opts || {}),
      isOpen,
      // What a new task would get from where you are (Tasks' empty-lens line names it)
      defaults: ({ from = 'tasks', lens = null } = {}) => {
        const d = computeDefaults(from, lens && typeof lens === 'object' ? lens : null);
        return { color: d.color, pinned: d.pinned, source: d.source };
      },
    });
    api.registerLayer({
      id: 'composer',
      kind: 'shell',
      root: () => els.root || null,
      isOpen: () => state.open,
      back: () => close({ keepDraft: true, refocus: true }),
    });
    api.on('hide', () => { if (state.open || els.input?.value || els.body?.value) persistDraft(); });
    api.on('unmount', () => { closeTimePicker({ immediate: true }); closeDatePicker({ immediate: true }); close({ keepDraft: true }); });
    api.on('day', () => {
      if (!state.meetingPicked) state.meetingDate = todayKey();
      if (state.open) paint();
    });
  },
};

// Test / debugging handle
export const composerDebug = {
  state: () => ({ ...state, text: els.input ? els.input.value : '', body: els.body ? els.body.value : '' }),
  plan: () => (els.root ? currentPlan() : null),
};
