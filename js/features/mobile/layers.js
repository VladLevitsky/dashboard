// Personal Dashboard - Mobile shell: layers and the Back button
// A "layer" is anything Back should close: the shell's own sheets and pushed
// screens, and every reused modal (calendar, editors, item creator, help…).
// Each is registered once with { id, root(), isOpen(), back(), kind }; the
// last registration of an id wins (F3 replaces the interim writer layers).
//
// History, phones only (the "depth model", core/mobile-nav.js):
//   one history entry per open layer, plus one base entry while a tab other
//   than Tasks shows. Entries are pushed with { mx: depth } as soon as a layer
//   is seen open: a MutationObserver (body children + each known root's
//   hidden / class) schedules syncHistory() in a microtask, so a layer opened
//   by a tap is pushed inside that tap (with user activation, so Chromium
//   never marks the entry skippable). Closing trims with history.go(-n) and an
//   ignore counter. popstate never pushes: Back = keep, so no layer refuses
//   to close and nothing needs re-pushing.
// Desktop preview: no history; Escape closes the top layer when it is a SHELL
// one (the reused modals keep their own Escape handling, unless focus was left
// in the shell under them).
// Phones: history.scrollRestoration is 'manual' while started (trims would
// otherwise restore a stale scroll position).

import { planHistory, pickTopLayer, planBack } from '../../core/mobile-nav.js';
import { isItemCreatorOpen, closeItemCreator } from '../item-creator.js';
import { closeFileManager } from '../file-manager.js';

const layers = new Map();      // id -> def
const openedAt = new Map();    // id -> open order (set when first seen open)
let openSeq = 0;

let ctx = null;                // { phone, getTab(), setTab(tab, opts) } while started
let depth = 0;                 // history entries the shell owns above its base
let ignorePops = 0;            // popstates caused by our own history.go(-n)
let syncQueued = false;
let pendingAfterPop = false;
let bodyObserver = null;
let rootObserver = null;
let savedScrollRestoration = null;   // the page's own value, put back on stop (phones)
const observedRoots = new WeakSet();

// --- Registry -----------------------------------------------------------------

export function registerLayer(def) {
  if (!def || !def.id || typeof def.isOpen !== 'function' || typeof def.back !== 'function') {
    throw new Error('registerLayer needs { id, isOpen(), back() }');
  }
  const entry = { kind: 'reused', root: () => null, ...def };
  layers.set(def.id, entry);
  if (ctx) observeRoot(safeRoot(entry));
  return () => { if (layers.get(def.id) === entry) { layers.delete(def.id); openedAt.delete(def.id); } };
}

function safeRoot(def) {
  try { return def.root ? def.root() : null; } catch { return null; }
}

function safeOpen(def) {
  try { return !!def.isOpen(); } catch { return false; }
}

// Numeric z-index of the element or its nearest positioned ancestor with one
function zOf(el) {
  for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position !== 'static' && cs.zIndex !== 'auto') {
      const z = parseInt(cs.zIndex, 10);
      if (Number.isFinite(z)) return z;
    }
  }
  return 0;
}

// Open layers as [{ id, def, z, openedAt }]; keeps the open order current
export function openLayers() {
  const list = [];
  layers.forEach((def, id) => {
    if (!safeOpen(def)) { openedAt.delete(id); return; }
    if (!openedAt.has(id)) openedAt.set(id, ++openSeq);
    const root = safeRoot(def);
    list.push({ id, def, z: root ? zOf(root) : 0, openedAt: openedAt.get(id) });
  });
  return list;
}

export function topLayer() {
  return pickTopLayer(openLayers());
}

export function anyLayerOpen(kind = null) {
  return openLayers().some(l => !kind || l.def.kind === kind);
}

// Close the top layer the way Back does. Returns its id (or null)
export function closeTopLayer(kind = null) {
  const open = openLayers().filter(l => !kind || l.def.kind === kind);
  const top = pickTopLayer(open);
  if (!top) return null;
  try { top.def.back(); } catch (err) { console.error('[mobile] layer back failed', top.id, err); }
  queueMicrotask(() => {
    if (safeOpen(top.def)) console.warn('[mobile] layer did not close on back', top.id);
  });
  return top.id;
}

// --- History (phones) ---------------------------------------------------------

export function syncHistory() {
  if (!ctx || !ctx.phone) return;
  if (ignorePops > 0) { pendingAfterPop = true; return; }
  const want = openLayers().length + (ctx.getTab() !== 'tasks' ? 1 : 0);
  const plan = planHistory({ depth, want });
  if (plan.push) {
    for (let i = 0; i < plan.push; i++) {
      depth++;
      try { history.pushState({ mx: depth }, ''); } catch { depth--; break; }
    }
  } else if (plan.back) {
    ignorePops++;
    depth -= plan.back;
    try { history.go(-plan.back); } catch { ignorePops--; }
  }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => { syncQueued = false; syncHistory(); });
}

function onPopState(e) {
  if (!ctx) return;
  if (ignorePops > 0) {
    ignorePops--;
    if (ignorePops === 0 && pendingAfterPop) { pendingAfterPop = false; scheduleSync(); }
    return;
  }
  const state = e.state && typeof e.state === 'object' ? e.state : null;
  depth = state && Number.isFinite(state.mx) ? state.mx : 0;
  const top = topLayer();
  const action = planBack({ top, tab: ctx.getTab(), home: 'tasks' });
  if (action === 'close') {
    closeTopLayer();
    scheduleSync();
  } else if (action === 'home') {
    ctx.setTab('tasks', { fromBack: true });
    scheduleSync();
  }
  // 'exit': the browser leaves the app (or this is the first entry): nothing to do
}

// --- Observation ------------------------------------------------------------

function observeRoot(el) {
  if (!el || !rootObserver || observedRoots.has(el)) return;
  observedRoots.add(el);
  rootObserver.observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] });
}

function observeKnownRoots() {
  layers.forEach(def => observeRoot(safeRoot(def)));
}

function onBodyMutations() {
  observeKnownRoots();
  scheduleSync();
}

// Desktop preview: Escape closes the top layer when it is a shell one (sheets,
// pushed screens). A reused modal on top keeps its own Escape handling, except
// when focus was left in a sheet under it: the modal then ignores the key
// (calendar.js ownsEscape), so it is closed here the way Back closes it
function onPreviewKeyDown(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || !ctx || ctx.phone) return;
  const open = openLayers();
  const top = pickTopLayer(open);
  if (!top) return;
  if (top.def.kind !== 'shell') {
    // Focus left in a sheet or in the shell's own chrome (the due lens that
    // opened the calendar, a dock tab), or nowhere (writer.open blurs, so a
    // doc opened to read leaves it on <body>) is "under" the reused modal: its
    // own Escape handling ignores the key there, so the shell closes it the
    // way Back does on a phone
    const t = e.target;
    const focusUnder = t && t.nodeType === 1 && (t === document.body || open.some(l => {
      if (l.def.kind !== 'shell') return false;
      const root = safeRoot(l.def);
      return !!root && root.contains(t);
    }) || !!t.closest('#mobile-shell'));
    if (!focusUnder) return;
  }
  if (closeTopLayer()) e.preventDefault();
}

export function startLayers({ phone, getTab, setTab }) {
  if (ctx) return;
  ctx = { phone: !!phone, getTab, setTab };
  rootObserver = new MutationObserver(scheduleSync);
  bodyObserver = new MutationObserver(onBodyMutations);
  bodyObserver.observe(document.body, { childList: true });
  observeKnownRoots();
  if (ctx.phone) {
    // Entries left over from before a reload are trimmed (no layer is open yet)
    depth = history.state && Number.isFinite(history.state.mx) ? history.state.mx : 0;
    // Every close trims its entry with history.go(-n); with 'auto' the browser
    // would restore that entry's saved scroll when the traversal lands, and
    // the page jumps after a sheet or pushed screen closes
    if ('scrollRestoration' in history) {
      savedScrollRestoration = history.scrollRestoration;
      history.scrollRestoration = 'manual';
    }
    window.addEventListener('popstate', onPopState);
    syncHistory();
  } else {
    document.addEventListener('keydown', onPreviewKeyDown);
  }
}

export function stopLayers() {
  if (!ctx) return;
  if (bodyObserver) bodyObserver.disconnect();
  if (rootObserver) rootObserver.disconnect();
  bodyObserver = rootObserver = null;
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('keydown', onPreviewKeyDown);
  if (savedScrollRestoration !== null) {
    try { history.scrollRestoration = savedScrollRestoration; } catch { /* read-only */ }
    savedScrollRestoration = null;
  }
  ctx = null;
  openedAt.clear();
}

export function historyDepth() {
  return depth;
}

// --- Built-in layers -----------------------------------------------------------

const byId = (id) => () => document.getElementById(id);
const shown = (el) => !!el && !el.hidden && el.isConnected;
const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); };
const firstVisible = (sel) => [...document.querySelectorAll(sel)].find(el => !el.hidden && el.getClientRects().length > 0) || null;
const escapeOn = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));

const MENUS = '.wr-pop, .highlight-context-menu, .highlighter-color-dropdown, .task-link-picker, .task-mention-dropdown';

export function registerBuiltInLayers() {
  const reg = (def) => registerLayer({ kind: 'reused', ...def });

  reg({ id: 'calendar', root: byId('calendar-view-modal'), isOpen: () => shown(byId('calendar-view-modal')()),
    back: () => window.closeCalendarView && window.closeCalendarView() });
  reg({ id: 'item-creator', root: () => document.querySelector('.ic-overlay'), isOpen: () => isItemCreatorOpen(),
    back: () => closeItemCreator() });
  reg({ id: 'media-library', root: byId('media-library'), isOpen: () => shown(byId('media-library')()),
    back: () => click('#media-close') });
  reg({ id: 'quick-capture', root: byId('quick-capture'), isOpen: () => shown(byId('quick-capture')()),
    back: () => window.closeQuickCapture && window.closeQuickCapture() });
  reg({ id: 'quick-link', root: () => document.querySelector('.quick-link-modal'),
    isOpen: () => shown(document.querySelector('.quick-link-modal')), back: () => click('#quick-link-cancel') });
  reg({ id: 'help', root: byId('wr-help'), isOpen: () => shown(byId('wr-help')()), back: () => click('#wr-help .wr-help-close') });
  reg({ id: 'focus', root: () => document.querySelector('.wr-focus'),
    isOpen: () => !!(window.writingApi && window.writingApi.focusMode && window.writingApi.focusMode.isActive()),
    back: () => window.writingApi.focusMode.exit() });
  reg({ id: 'file-manager', root: byId('file-manager-modal'),
    isOpen: () => { const m = byId('file-manager-modal')(); return !!m && m.classList.contains('active'); },
    back: () => closeFileManager() });
  reg({ id: 'task-settings', root: byId('task-settings-modal'), isOpen: () => shown(byId('task-settings-modal')()),
    back: () => {
      // Back = keep: a changed draft is saved; an unchanged one just closes.
      // Cancel asks only when the draft changed, so a silenced confirm tells us.
      const original = window.confirm;
      let changed = false;
      window.confirm = () => { changed = true; return false; };
      try { click('#task-settings-cancel'); } finally { window.confirm = original; }
      if (changed) click('#task-settings-save');
    } });
  reg({ id: 'appearance', root: byId('appearance-modal'), isOpen: () => shown(byId('appearance-modal')()),
    back: () => window.cancelAppearanceChanges && window.cancelAppearanceChanges() });
  reg({ id: 'auth', root: byId('auth-modal'), isOpen: () => shown(byId('auth-modal')()), back: () => click('#auth-close') });
  reg({ id: 'range-pop', root: () => document.querySelector('.tt-range-pop'),
    isOpen: () => !!document.querySelector('.tt-range-pop'), back: () => escapeOn(document) });
  reg({ id: 'menus', root: () => firstVisible(MENUS), isOpen: () => !!firstVisible(MENUS),
    back: () => escapeOn(document.activeElement && document.activeElement !== document.body ? document.activeElement : document) });
  reg({ id: 'subtask-menu', root: () => firstVisible('.task-subtask-menu-dropdown'),
    isOpen: () => !!firstVisible('.task-subtask-menu-dropdown'),
    back: () => { const s = document.querySelector('.task-editor-content'); if (s) s.dispatchEvent(new Event('scroll')); } });

  // Interim writer layers: their plain close. F3 replaces all seven with
  // back = keep adapters (§4.7) by registering the same ids.
  reg({ id: 'task-editor', root: byId('task-editor-modal'), isOpen: () => shown(byId('task-editor-modal')()),
    back: () => click('#task-editor-modal .task-editor-close-btn') });
  reg({ id: 'subtask-desc', root: byId('subtask-desc-modal'), isOpen: () => shown(byId('subtask-desc-modal')()),
    back: () => click('#subtask-desc-cancel') });
  reg({ id: 'projects', root: byId('projects-modal'), isOpen: () => shown(byId('projects-modal')()),
    back: () => window.closeProjectsModal && window.closeProjectsModal() });
  reg({ id: 'ideas', root: byId('ideas-modal'), isOpen: () => shown(byId('ideas-modal')()),
    back: () => click('#ideas-modal .ideas-close-btn') });
  reg({ id: 'meetings', root: byId('meetings-modal'), isOpen: () => shown(byId('meetings-modal')()),
    back: () => window.closeMeetingsModal && window.closeMeetingsModal() });
  reg({ id: 'notepad', root: byId('notepad-popover'), isOpen: () => shown(byId('notepad-popover')()),
    back: () => window.closeNotepad && window.closeNotepad() });
  reg({ id: 'note-viewer', root: byId('note-viewer-modal'), isOpen: () => shown(byId('note-viewer-modal')()),
    back: () => window.closeNoteViewer && window.closeNoteViewer() });
}
