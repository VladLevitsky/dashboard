// Personal Dashboard - Mobile shell: Search (unit F5, W16)
// A pushed screen opened from the top bar's ⌕ (and `/` in the preview). The
// input is created and focused inside the opening tap, so iOS raises the
// keyboard. One query searches everything (core/mobile-links.js searchAll:
// accent / case folded, every word must match), in this order, 5 rows per
// group with "Show all n":
//   Tasks (title, subtasks, description) → the task editor
//   Writing (projects, ideas, meetings, notes; from the Write unit's index)
//   Links (real card items: they open, copy and toggle Quick Access as on a card)
//   Cards (switch to Links with that card open and in view)
//   Completed (↺ restores with Undo)
// Rows are patched by key, so typing never rebuilds the whole list. While the
// screen is open, saves re-run the query (a completed task drops out, a Quick
// Access toggle relights its item). The desktop #dashboard-search is never used.

import { model } from '../../state.js';
import * as tasksApi from '../tasks.js';
import { searchAll, cardSummary, isColorCode, localDayKey, linkedRefsSig } from '../../core/mobile-links.js';
import { rowSignature } from '../../core/mobile-tasks.js';
import { relativeTime } from '../../core/mobile-common.js';
import { createCardItemElement } from '../../components/sections.js';
import { enhance, buildIconCell, taskRowFor } from './card-items.js?v=2026-10-mobile-2';

const PER_GROUP = 5;
const DEBOUNCE_MS = 120;
const GROUPS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'writing', label: 'Writing' },
  { id: 'links', label: 'Links' },
  { id: 'cards', label: 'Cards' },
  { id: 'completed', label: 'Completed' },
];
const KIND_LABEL = { project: 'Project', idea: 'Idea', meeting: 'Meeting', note: 'Note' };
const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const CLEAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const RESTORE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg>';
const CARD_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
const PRIORITY_RGB = { red: '249 76 100', orange: '255 133 35', yellow: '242 189 24', blue: '61 151 248' };

let api = null;
let current = null;     // { screen, input, results, groups: Map, expanded: Set, query, timer, offSaved }

export function initSearch(shellApi) {
  api = shellApi;
}

export function isSearchOpen() {
  return !!(current && current.screen && current.screen.el.isConnected && !current.screen.el.dataset.closing);
}

function writerService() {
  const w = api && api.service('writer');
  return w && typeof w === 'object' ? w : null;
}

function searchDocs() {
  const w = writerService();
  if (!w || typeof w.searchIndex !== 'function') return null;
  try { return w.searchIndex() || []; } catch (err) { console.error('[mobile] writer.searchIndex failed', err); return []; }
}

// --- Open / close -----------------------------------------------------------------

// Opens the screen and focuses its input synchronously (call it from the tap)
export function openSearch(query = '') {
  if (!api) return null;
  if (isSearchOpen()) {
    if (query) { current.input.value = query; run(); }
    current.input.focus();
    return current.screen;
  }
  const state = { screen: null, input: null, results: null, groups: new Map(), expanded: new Set(), query: '', timer: 0, offSaved: null };
  current = state;
  state.screen = api.pushScreen({
    id: 'search',
    title: 'Search',
    build(body, screen) {
      screen.el.classList.add('mx-search');
      const bar = screen.el.querySelector('.mx-pushed-bar');
      const form = document.createElement('form');
      form.className = 'mx-search-field';
      form.setAttribute('role', 'search');
      form.innerHTML = SEARCH_SVG;
      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'mx-search-input';
      input.placeholder = 'Search tasks, writing, links';
      input.setAttribute('aria-label', 'Search everything');
      input.setAttribute('enterkeyhint', 'search');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'off');
      input.value = query || '';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'mx-search-clear';
      clear.setAttribute('aria-label', 'Clear');
      clear.innerHTML = CLEAR_SVG;
      clear.addEventListener('pointerdown', (e) => e.preventDefault());   // keep the keyboard up
      clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
      form.append(input, clear);
      form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(state.timer); run(); input.blur(); });
      input.addEventListener('input', () => {
        form.classList.toggle('has-text', input.value !== '');
        clearTimeout(state.timer);
        state.timer = setTimeout(run, DEBOUNCE_MS);
      });
      form.classList.toggle('has-text', input.value !== '');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'mx-search-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => screen.close());
      if (bar) bar.append(form, cancel);
      else body.appendChild(form);
      state.input = input;

      const results = document.createElement('div');
      results.className = 'mx-search-results';
      body.appendChild(results);
      state.results = results;
      enhance(results);
      // Synchronous focus inside the opening tap: iOS raises the keyboard
      input.focus({ preventScroll: true });
    },
    onClose() {
      clearTimeout(state.timer);
      if (state.offSaved) state.offSaved();
      if (current === state) current = null;
    },
  });
  const onSaved = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => run({ keepExpanded: true }), DEBOUNCE_MS);
  };
  window.addEventListener('model:saved', onSaved);
  // A new day changes due chips and reminder badges in the rows (their
  // signatures carry the day, so the re-run repaints them)
  const offDay = typeof api.on === 'function' ? api.on('day', onSaved) : null;
  state.offSaved = () => {
    window.removeEventListener('model:saved', onSaved);
    if (typeof offDay === 'function') offDay();
  };
  run();
  return state.screen;
}

export function closeSearch() {
  if (current && current.screen) current.screen.close();
}

// --- Results --------------------------------------------------------------------

function run({ keepExpanded = false } = {}) {
  const state = current;
  if (!state || !state.results) return;
  const query = state.input ? state.input.value : '';
  if (!keepExpanded && query !== state.query) state.expanded.clear();
  state.query = query;
  state.qa = JSON.stringify(model.quickAccessItems || null);
  const docs = searchDocs();
  const res = searchAll(query, {
    tasks: model.tasks || [],
    completed: model.completedTasks || [],
    docs: docs || [],
    cards: model.sections || [],
    data: model,
  });
  render(state, res, docs !== null);
}

function render(state, res, hasWriter) {
  const host = state.results;
  if (!res.terms.length) {
    showMessage(state, 'Search tasks, writing, links and cards. Every word has to match.');
    return;
  }
  const groups = GROUPS.filter(g => g.id !== 'writing' || hasWriter);
  const empty = groups.filter(g => res[g.id].length === 0);
  if (res.total === 0) {
    showMessage(state, `No matches for “${state.query.trim()}”.`);
    return;
  }
  const msg = host.querySelector(':scope > .mx-search-message');
  if (msg) msg.remove();
  let anchor = null;                                        // the last group placed (keeps the order)
  groups.forEach(g => {
    const list = res[g.id];
    let sec = state.groups.get(g.id);
    if (!list.length) {
      if (sec) { sec.el.remove(); state.groups.delete(g.id); }
      return;
    }
    if (!sec) sec = makeGroup(state, g);
    const next = anchor ? anchor.nextSibling : host.firstChild;
    if (next !== sec.el) host.insertBefore(sec.el, next);
    anchor = sec.el;
    const all = state.expanded.has(g.id);
    const shown = all ? list : list.slice(0, PER_GROUP);
    sec.caption.firstChild.data = `${g.label} · ${list.length}`;
    api.patchList(sec.list, shown, ROWS[g.id]);
    if (list.length > PER_GROUP && !all) {
      sec.more.hidden = false;
      sec.more.textContent = `Show all ${list.length}`;
    } else {
      sec.more.hidden = true;
    }
  });
  let zero = host.querySelector(':scope > .mx-search-zero');
  if (empty.length) {
    if (!zero) {
      zero = document.createElement('p');
      zero.className = 'mx-search-zero';
    }
    const text = empty.map(g => `${g.label} · 0`).join('   ');
    if (zero.textContent !== text) zero.textContent = text;
    if (host.lastChild !== zero) host.appendChild(zero);
  } else if (zero) {
    zero.remove();
  }
}

function showMessage(state, text) {
  const host = state.results;
  state.groups.forEach(sec => sec.el.remove());
  state.groups.clear();
  const zero = host.querySelector(':scope > .mx-search-zero');
  if (zero) zero.remove();
  let msg = host.querySelector(':scope > .mx-search-message');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'mx-search-message';
    host.appendChild(msg);
  }
  msg.textContent = text;
}

function makeGroup(state, g) {
  const el = document.createElement('section');
  el.className = `mx-search-group mx-search-group--${g.id}`;
  el.dataset.group = g.id;
  const caption = document.createElement('h3');
  caption.className = 'mx-caption';
  caption.appendChild(document.createTextNode(g.label));
  const list = document.createElement('div');
  list.className = 'mx-search-list';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'mx-btn mx-btn-quiet mx-search-more';
  more.hidden = true;
  more.addEventListener('click', () => { state.expanded.add(g.id); run({ keepExpanded: true }); });
  el.append(caption, list, more);
  const sec = { el, caption, list, more };
  state.groups.set(g.id, sec);
  return sec;
}

// --- Rows ----------------------------------------------------------------------------

// A row rebuilds when anything it shows changes: the task row's own signature
// (title, colour, due, subtasks, description, links, category, day) plus the
// category's name and slot; a link row's item, label, caption, Quick Access
// light, linking tasks (the indicator), its subtitle colour and the theme
const categorySig = (id) => {
  const c = id && Array.isArray(model.taskCategories) ? model.taskCategories.find(x => x && x.id === id) : null;
  return c ? `${c.name}:${c.slot}` : '';
};
const taskSig = (t) => `${rowSignature(t, localDayKey())}|${categorySig(t.categoryId)}|${t.order ?? ''}`;
const qaSig = () => (current && current.qa) || '';
const themeSig = () => `${document.body.dataset.theme || 'light'}|${document.body.dataset.glassTheme || 'classic'}|${model.darkMode ? 1 : 0}`;
const linkSig = (h) => JSON.stringify([h.item, h.label || '', h.caption, qaSig(), linkedRefsSig(model.tasks, h.sectionId),
  (model.subtitleColors && model.subtitleColors[`${h.sectionId}:${h.subtitle}`]) || null, themeSig(), localDayKey()]);

function docRow({ doc, snippet }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mx-row mx-doc-row';
  b.dataset.kind = doc.kind;
  const kind = document.createElement('span');
  kind.className = 'mx-row-kicker';
  kind.textContent = doc.meta && typeof doc.meta === 'string' ? `${KIND_LABEL[doc.kind] || 'Doc'} · ${doc.meta}` : (KIND_LABEL[doc.kind] || 'Doc');
  const title = document.createElement('span');
  title.className = 'mx-row-title';
  title.textContent = doc.title || 'Untitled';
  b.append(kind, title);
  if (snippet) {
    const s = document.createElement('span');
    s.className = 'mx-row-snippet';
    s.textContent = snippet;
    b.appendChild(s);
  }
  b.addEventListener('click', (e) => {
    // The notepad's document click-outside listener must not see the opening tap
    e.stopPropagation();
    const w = writerService();
    if (w && typeof w.open === 'function') {
      w.open(doc.kind, doc.id, { sectionId: doc.sectionId, subtaskNoteId: doc.subtaskNoteId, noteKey: doc.noteKey, doc, from: 'search' });
    }
  });
  return b;
}

function linkRow(hit) {
  const wrap = document.createElement('div');
  wrap.className = 'mx-search-item';
  wrap.dataset.type = hit.type;
  const cap = document.createElement('p');
  cap.className = 'mx-search-where';
  cap.textContent = hit.caption;
  if (hit.type === 'icon') {
    const row = document.createElement('div');
    row.className = 'mx-search-icon-row';
    const cell = buildIconCell(hit.item, hit.sectionId, hit.subtitle, hit.label);
    if (cell) {
      const label = cell.querySelector('.mx-icon-label');
      if (label) label.remove();
      cell.classList.add('mx-icon-cell--solo');
      row.appendChild(cell);
    }
    const names = document.createElement('div');
    names.className = 'mx-search-icon-names';
    const t = document.createElement('span');
    t.className = 'mx-row-title';
    t.textContent = hit.label;
    names.append(t, cap);
    row.appendChild(names);
    wrap.appendChild(row);
    return wrap;
  }
  wrap.appendChild(cap);
  const cls = hit.type === 'reminder' ? 'unified-reminders-group'
    : hit.type === 'subtask' ? 'unified-subtasks-group'
      : (isColorCode(String(hit.item.copyText || '').trim()) ? 'unified-swatch-group' : 'unified-copypaste-group');
  const group = document.createElement('div');
  group.className = cls;
  const el = createCardItemElement(hit.type, hit.item, hit.sectionId, hit.subtitle);
  if (el) group.appendChild(el);
  wrap.appendChild(group);
  return wrap;
}

function cardRow(hit) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mx-row mx-card-row';
  const glyph = document.createElement('span');
  glyph.className = 'mx-row-glyph';
  glyph.innerHTML = CARD_SVG;
  const t = document.createElement('span');
  t.className = 'mx-row-title';
  t.textContent = hit.title;
  const meta = document.createElement('span');
  meta.className = 'mx-row-meta';
  meta.textContent = cardSummary(model[hit.sectionId]).label;
  b.append(glyph, t, meta);
  b.addEventListener('click', () => {
    closeSearch();
    const links = api.service('links');
    if (links && typeof links.revealCard === 'function') links.revealCard(hit.sectionId);
    else api.navigate('links', { reveal: { sectionId: hit.sectionId } });
  });
  return b;
}

function restoreTask(id) {
  const actions = api.service('taskActions');
  if (actions && typeof actions.restoreWithUndo === 'function') { actions.restoreWithUndo(id); return true; }
  if (typeof tasksApi.restoreCompletedTask === 'function') {
    tasksApi.restoreCompletedTask(id);
    if (window.refreshTaskViews) window.refreshTaskViews();
    api.toast('Restored');
    return true;
  }
  return false;
}

function canRestore() {
  const actions = api.service('taskActions');
  return !!(actions && typeof actions.restoreWithUndo === 'function') || typeof tasksApi.restoreCompletedTask === 'function';
}

function doneRow(task) {
  const row = document.createElement('div');
  row.className = 'mx-row mx-done-row';
  row.style.setProperty('--priority-rgb', PRIORITY_RGB[task.color] || PRIORITY_RGB.blue);
  const ring = document.createElement('span');
  ring.className = 'mx-done-ring';
  ring.innerHTML = CHECK_SVG;
  const names = document.createElement('span');
  names.className = 'mx-done-names';
  const t = document.createElement('span');
  t.className = 'mx-row-title';
  t.textContent = task.title || 'Untitled task';
  names.appendChild(t);
  const at = Number(task.completedAt) || Date.parse(task.completedAt);
  if (Number.isFinite(at) && at > 0) {
    const m = document.createElement('span');
    m.className = 'mx-row-meta';
    m.textContent = `Completed ${relativeTime(at, Date.now())}`;
    names.appendChild(m);
  }
  row.append(ring, names);
  if (canRestore()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mx-icon-btn mx-restore-btn';
    b.innerHTML = RESTORE_SVG;
    b.setAttribute('aria-label', `Restore “${task.title || 'task'}”`);
    b.title = 'Restore';
    b.addEventListener('click', () => restoreTask(task.id));
    row.appendChild(b);
  }
  return row;
}

const ROWS = {
  tasks: { key: (t) => t.id, sig: taskSig, create: (t) => taskRowFor(t, { mode: 'search' }) },
  writing: { key: (h) => `${h.doc.kind}:${h.doc.id}`, sig: (h) => `${h.doc.title}|${h.snippet}|${h.doc.meta || ''}`, create: docRow },
  links: {
    key: (h) => `${h.type}:${h.sectionId}:${h.subtitle}:${h.item.key}`,
    sig: linkSig,
    create: linkRow,
  },
  cards: { key: (h) => h.sectionId, sig: (h) => `${h.title}|${cardSummary(model[h.sectionId]).label}`, create: cardRow },
  completed: { key: (t) => t.id, sig: (t) => `${t.title}|${t.completedAt}|${localDayKey()}`, create: doneRow },
};
