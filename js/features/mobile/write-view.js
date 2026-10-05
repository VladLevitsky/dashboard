// Personal Dashboard - Mobile shell: Write (unit F3)
// The Write tab (W11): a search field, sticky filter chips (All · Projects ·
// Ideas · Meetings · Notes, plus "in: <card> ×" when opened from a card),
// "Continue writing" cards, recovered drafts, then Projects, Ideas, Meetings
// and Notes grouped by card in desktop reading order. Rows open read-first
// through the writer (writer.js), which also turns the 7 reused editors into
// full-screen writer frames with Back = keep. Provides the screen 'write' and
// the service 'writer'.
// Data comes from the pure collectDocs (core/mobile-write.js); lists are keyed
// patches (api.patchList), the chip counts are Text.data writes.

import { model } from '../../state.js';
import { htmlToMarkdown } from '../../core/markdown.js';
import { meetingOccursOn } from '../../core/agenda.js';
import { orderCardsForMobile, cardTitle, relativeTime } from '../../core/mobile-common.js';
import {
  collectDocs, countByKind, groupNotesByCard, searchDocs, snippet, previewText, matchSnippet,
  recentDocs, unsavedDrafts, dropDraft,
} from '../../core/mobile-write.js';
import * as tasksApi from '../tasks.js';
import * as projectsApi from '../projects.js';
import { createWriter } from './writer.js?v=2026-10-mobile-2';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'project', label: 'Projects' },
  { value: 'idea', label: 'Ideas' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'note', label: 'Notes' },
];
const SECTIONS = [
  { kind: 'project', label: 'Projects', add: 'New project' },
  { kind: 'idea', label: 'Ideas', add: 'New idea' },
  { kind: 'meeting', label: 'Meetings', add: 'New meeting' },
  { kind: 'note', label: 'Notes', add: 'New note' },
];
const KIND_LABEL = { project: 'Project', idea: 'Idea', meeting: 'Meeting', note: 'Note' };
const SURFACE_KIND = { ideas: 'idea', meetings: 'meeting', notepad: 'note', task: 'task', projects: 'project' };
const SEARCH_DEBOUNCE = 120;

const SVG = (body, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const GLYPHS = {
  project: SVG('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'),
  idea: SVG('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.9 10.6c.6.5.9 1.3.9 2.1V16h6v-.3c0-.8.3-1.6.9-2.1A6 6 0 0 0 12 3z"/>'),
  meeting: SVG('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  note: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>'),
  task: SVG('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  search: SVG('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 18),
  clear: SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 16),
  plus: SVG('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 20),
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  pin: SVG('<path d="M9 3h6l-1.2 5.6L17 11.5V14H7v-2.5l3.2-2.9z"/><line x1="12" y1="14" x2="12" y2="21"/>', 13),
  draft: SVG('<path d="M12 8v4l2.5 2.5"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 4 3 11 10 11"/>', 20),
  open: SVG('<polyline points="9 18 15 12 9 6"/>', 18),
  rename: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>', 18),
  trash: SVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18),
  copy: SVG('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 18),
  pinRow: SVG('<path d="M9 3h6l-1.2 5.6L17 11.5V14H7v-2.5l3.2-2.9z"/><line x1="12" y1="14" x2="12" y2="21"/>', 18),
  today: SVG('<path d="M12 5v14"/><path d="M5 12h14"/>', 18),
};

let api = null;
let store = null;
let writer = null;
let view = null;           // DOM refs once mounted
let query = '';
let searchTimer = 0;
let version = 0;           // bumped when recent / drafts change (per-browser state)

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function todayKeyOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== text) t.data = text; } else node.textContent = text;
}

// Writes only real changes: every write queues records for glass-glow's observers
function setHidden(node, hidden) {
  if (node && node.hidden !== hidden) node.hidden = hidden;
}

function setAttr(node, name, value) {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

// --- State --------------------------------------------------------------------------
function getFilter() {
  const f = store.get('filter', 'all');
  return FILTERS.some(x => x.value === f) ? f : 'all';
}

function getCard() {
  const id = store.get('card', null);
  return id && (model.sections || []).some(s => s.id === id) ? id : null;
}

function setFilter(value) {
  store.set('filter', value);
  if (value !== 'note' && value !== 'all') store.set('card', undefined);
  renderBody();
}

// A cheap fingerprint of everything the tab shows (FNV-1a over the writing data)
function fingerprint(data) {
  let h = 2166136261;
  const mix = (s) => {
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  };
  try {
    mix(JSON.stringify([data.projects, data.ideas, data.meetings, data.cardNotes, data.subtaskNotes, data.sectionTitles,
      (data.sections || []).map(s => [s.id, s.title, s.layouts && s.layouts.desktop])]));
  } catch { mix(Math.random()); }
  return h.toString(36);
}

// --- Mount ---------------------------------------------------------------------------
function mount(host) {
  const root = el('div', 'mx-write');

  const search = el('label', 'mx-write-search');
  const icon = el('span', 'mx-write-search-icon');
  icon.innerHTML = GLYPHS.search;
  const input = el('input', 'mx-write-search-input');
  input.type = 'search';
  input.placeholder = 'Search writing';
  input.setAttribute('aria-label', 'Search projects, ideas, meetings and notes');
  input.enterKeyHint = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const clear = el('button', 'mx-write-search-clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = GLYPHS.clear;
  clear.hidden = true;
  search.append(icon, input, clear);
  input.addEventListener('input', () => {
    setHidden(clear, !input.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = input.value.trim(); renderBody(); }, SEARCH_DEBOUNCE);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  clear.addEventListener('click', (e) => {
    e.preventDefault();
    input.value = '';
    clear.hidden = true;
    query = '';
    renderBody();
    input.focus();
  });

  const chips = el('div', 'mx-write-chips');
  chips.setAttribute('role', 'toolbar');
  chips.setAttribute('aria-label', 'Show');
  const chipRow = el('div', 'mx-write-chip-row');
  chips.appendChild(chipRow);
  const filterChips = new Map();
  FILTERS.forEach(f => {
    const c = api.ui.chip({ label: f.label, count: 0, onClick: () => setFilter(f.value) });
    c.dataset.filter = f.value;
    filterChips.set(f.value, c);
    chipRow.appendChild(c);
  });
  const cardChip = api.ui.chip({ label: 'in:', title: '' });
  cardChip.classList.add('mx-write-card-chip');
  cardChip.hidden = true;
  const cardName = el('span', 'mx-write-card-name', '');
  const cardX = el('span', 'mx-write-card-x');
  cardX.innerHTML = GLYPHS.clear;
  cardChip.append(cardName, cardX);
  cardChip.addEventListener('click', () => { store.set('card', undefined); renderBody(); });
  chipRow.appendChild(cardChip);

  const body = el('div', 'mx-write-body');

  // Continue writing
  const cont = el('section', 'mx-write-sec mx-write-continue');
  cont.hidden = true;
  const contHead = el('h2', 'mx-write-label', 'Continue writing');
  const contRow = el('div', 'mx-write-cards');
  contRow.setAttribute('role', 'list');
  cont.append(contHead, contRow);

  // Recovered drafts
  const drafts = el('section', 'mx-write-sec mx-write-drafts');
  drafts.hidden = true;
  const draftsHead = el('h2', 'mx-write-label', 'Recovered drafts');
  const draftsList = el('div', 'mx-write-list');
  draftsList.setAttribute('role', 'list');
  drafts.append(draftsHead, draftsList);

  body.append(cont, drafts);

  const sections = new Map();
  SECTIONS.forEach(def => {
    const sec = el('section', 'mx-write-sec');
    sec.dataset.kind = def.kind;
    const head = el('div', 'mx-write-head');
    const h = el('h2', 'mx-write-label', def.label);
    const count = el('span', 'mx-write-count', '0');
    const add = el('button', 'mx-write-add');
    add.type = 'button';
    add.setAttribute('aria-label', def.add);
    add.title = def.add;
    add.innerHTML = GLYPHS.plus;
    add.addEventListener('click', (e) => createFromSection(def.kind, e));
    head.append(h, count, add);
    sec.appendChild(head);
    let list = null;
    if (def.kind === 'note') {
      list = el('div', 'mx-write-groups');
    } else {
      list = el('div', 'mx-write-list');
      list.setAttribute('role', 'list');
    }
    const empty = el('p', 'mx-write-none', '');
    empty.hidden = true;
    sec.append(list, empty);
    body.appendChild(sec);
    sections.set(def.kind, { sec, count, list, empty });
  });

  const nothing = el('div', 'mx-write-empty');
  nothing.hidden = true;
  const nothingTitle = el('p', 'mx-write-empty-title', 'No matches');
  const nothingText = el('p', 'mx-write-empty-text', '');
  nothing.append(nothingTitle, nothingText);
  body.appendChild(nothing);

  root.append(search, chips, body);
  host.appendChild(root);
  view = { root, input, clear, chips, filterChips, cardChip, cardName, cont, contRow, drafts, draftsList, sections, nothing, nothingTitle, nothingText };
}

// --- Rows ------------------------------------------------------------------------------
function rowSig(doc) {
  return [doc.title, doc.meta, doc.pinned ? 1 : 0, query ? matchSnippet(doc.text, query, 90) : snippet(previewText(doc.title, doc.text), 90)].join('|');
}

function docRow(doc) {
  const row = el('div', 'mx-write-row');
  row.setAttribute('role', 'listitem');
  row.dataset.kind = doc.kind;
  row.dataset.id = doc.id;
  const main = el('button', 'mx-write-row-main');
  main.type = 'button';
  const glyph = el('span', 'mx-write-glyph');
  glyph.innerHTML = GLYPHS[doc.kind] || '';
  const text = el('span', 'mx-write-row-text');
  const titleLine = el('span', 'mx-write-row-titleline');
  const title = el('span', 'mx-write-row-title', doc.title);
  titleLine.appendChild(title);
  if (doc.pinned) {
    const pin = el('span', 'mx-write-pin');
    pin.innerHTML = GLYPHS.pin;
    pin.setAttribute('aria-label', 'Pinned');
    titleLine.appendChild(pin);
  }
  const snip = query ? matchSnippet(doc.text, query, 90) : snippet(previewText(doc.title, doc.text), 90);
  const sub = el('span', 'mx-write-row-snippet', snip || (doc.kind === 'meeting' ? 'No notes yet' : 'Empty'));
  if (!snip) sub.classList.add('is-empty');
  text.append(titleLine, sub);
  main.append(glyph, text);
  if (doc.meta) main.appendChild(el('span', 'mx-write-row-meta', doc.meta));
  main.setAttribute('aria-label', `${KIND_LABEL[doc.kind]}: ${doc.title}${doc.meta ? ', ' + doc.meta : ''}`);
  main.addEventListener('click', (e) => openDoc(doc, e));
  const more = el('button', 'mx-write-more');
  more.type = 'button';
  more.setAttribute('aria-label', `More for ${doc.title}`);
  more.innerHTML = GLYPHS.more;
  more.addEventListener('click', (e) => { e.stopPropagation(); openDocSheet(doc); });
  row.append(main, more);
  return row;
}

function cardFor(doc) {
  const card = el('button', 'mx-write-card');
  card.type = 'button';
  card.setAttribute('role', 'listitem');
  card.dataset.kind = doc.kind;
  const kicker = el('span', 'mx-write-card-kicker', doc.kind === 'note' && doc.cardTitle ? `Note · ${doc.cardTitle}` : KIND_LABEL[doc.kind]);
  const title = el('span', 'mx-write-card-title', doc.title);
  const prev = el('span', 'mx-write-card-preview', snippet(previewText(doc.title, doc.text), 140));
  card.append(kicker, title, prev);
  card.setAttribute('aria-label', `Continue ${KIND_LABEL[doc.kind].toLowerCase()}: ${doc.title}`);
  card.addEventListener('click', (e) => openDoc(doc, e));
  return card;
}

function draftRow(d) {
  const row = el('div', 'mx-write-row mx-write-draft');
  row.setAttribute('role', 'listitem');
  const main = el('button', 'mx-write-row-main');
  main.type = 'button';
  const glyph = el('span', 'mx-write-glyph');
  glyph.innerHTML = GLYPHS.draft;
  const text = el('span', 'mx-write-row-text');
  const kind = SURFACE_KIND[d.surface] || 'note';
  const title = d.title || snippet(previewText('', htmlText(d.html)), 60) || 'Untitled';
  text.append(el('span', 'mx-write-row-title', title),
    el('span', 'mx-write-row-snippet', `Recovered draft · ${kind === 'task' ? 'Task' : KIND_LABEL[kind]} · ${relativeTime(d.at, Date.now())}`));
  main.append(glyph, text);
  main.setAttribute('aria-label', `Recovered draft: ${title}. Open`);
  main.addEventListener('click', (e) => reopenDraft(d, e));
  const x = el('button', 'mx-write-more');
  x.type = 'button';
  x.setAttribute('aria-label', `Discard the draft ${title}`);
  x.innerHTML = GLYPHS.clear;
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Discard this recovered draft?')) return;
    store.set('drafts', dropDraft(store.get('drafts', []), d));
    bump();
  });
  row.append(main, x);
  return row;
}

function htmlText(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  return div.textContent || '';
}

// --- Render --------------------------------------------------------------------------------
function currentDocs(ctx) {
  const data = (ctx && ctx.data) || model;
  return collectDocs(data, { cardOrder: orderCardsForMobile(data.sections), todayKey: (ctx && ctx.todayKey) || todayKeyOf(), now: Date.now() });
}

let lastDocs = null;

function render(ctx) {
  if (!view) return;
  lastDocs = currentDocs(ctx);
  renderBody(lastDocs);
}

function renderBody(docsIn) {
  if (!view) return;
  const docs = docsIn || lastDocs || currentDocs();
  lastDocs = docs;
  const filter = getFilter();
  const card = getCard();

  // Chips: counts follow the search, selection follows the filter
  const searched = searchDocs(docs, query);
  const counts = countByKind(searched);
  view.filterChips.forEach((chip, value) => {
    setAttr(chip, 'aria-pressed', String(value === filter));
    setText(chip.querySelector('.mx-chip-count'), String(counts[value === 'all' ? 'all' : value] || 0));
  });
  const cardSection = card ? (model.sections || []).find(s => s.id === card) : null;
  setHidden(view.cardChip, !cardSection);
  if (cardSection) {
    const name = cardTitle(model, cardSection);
    setText(view.cardName, name);
    setAttr(view.cardChip, 'aria-label', `Showing notes in ${name}. Remove`);
    setAttr(view.cardChip, 'aria-pressed', 'true');
  }

  const shown = searchDocs(docs, query, { kind: filter, sectionId: cardSection ? card : null })
    .filter(d => !cardSection || d.kind === 'note');
  const plain = !query && filter === 'all' && !cardSection;

  // Continue writing (opened on this phone), recovered drafts
  const recent = plain ? recentDocs(store.get('recent', []), docs, 5) : [];
  setHidden(view.cont, !recent.length);
  api.patchList(view.contRow, recent, { key: d => `${d.kind}:${d.id}`, sig: d => `${d.title}|${d.text.length}|${d.cardTitle || ''}`, create: d => cardFor(d) });
  const drafts = plain ? unsavedDrafts(store.get('drafts', [])).filter(d => SURFACE_KIND[d.surface]) : [];
  setHidden(view.drafts, !drafts.length);
  api.patchList(view.draftsList, drafts, { key: d => `${d.surface}|${d.sectionId || ''}|${d.at}`, sig: d => `${d.title}|${d.at}`, create: d => draftRow(d) });

  let any = false;
  SECTIONS.forEach(def => {
    const s = view.sections.get(def.kind);
    const list = shown.filter(d => d.kind === def.kind);
    const visible = (filter === 'all' || filter === def.kind) && (!cardSection || def.kind === 'note') && (list.length > 0 || !query);
    setHidden(s.sec, !visible);
    setText(s.count, String(list.length));
    if (!visible) return;
    if (list.length) any = true;
    setHidden(s.empty, list.length > 0);
    if (!list.length) setText(s.empty, emptyText(def.kind));
    if (def.kind === 'note') renderNoteGroups(s.list, list);
    else api.patchList(s.list, list, { key: d => d.id, sig: rowSig, create: docRow });
  });

  const nothing = !!query && !any;
  setHidden(view.nothing, !nothing);
  if (nothing) setText(view.nothingText, `Nothing in your writing matches “${query}”.`);
}

function emptyText(kind) {
  return {
    project: 'No projects yet. Tap + to start one.',
    idea: 'No ideas yet. Tap + to catch one.',
    meeting: 'No meetings yet.',
    note: getCard() ? 'No notes on this card yet.' : 'No notes yet. Notes belong to a card.',
  }[kind];
}

function renderNoteGroups(container, notes) {
  const groups = groupNotesByCard(notes);
  api.patchList(container, groups, {
    key: g => g.sectionId,
    sig: g => g.cardTitle,
    create: g => {
      const wrap = el('div', 'mx-write-group');
      const head = el('h3', 'mx-write-group-head');
      head.append(el('span', 'mx-write-group-name', g.cardTitle), el('span', 'mx-write-group-count', ''));
      const list = el('div', 'mx-write-list');
      list.setAttribute('role', 'list');
      wrap.append(head, list);
      wrap._list = list;
      wrap._count = head.lastChild;
      return wrap;
    },
  });
  groups.forEach(g => {
    const wrap = [...container.children].find(n => n._mxKey === g.sectionId);
    if (!wrap) return;
    setText(wrap._count, String(g.notes.length));
    api.patchList(wrap._list, g.notes, { key: d => d.id, sig: rowSig, create: docRow });
  });
}

// --- Actions --------------------------------------------------------------------------------
function openDoc(doc, e) {
  // The notepad's document click-outside listener must not see the opening tap
  if (e) e.stopPropagation();
  if (!writer) return;
  writer.open(doc.kind, doc.id, { sectionId: doc.sectionId, noteKey: doc.noteKey, subtaskNoteId: doc.subtaskNoteId, doc });
}

function reopenDraft(d, e) {
  if (e) e.stopPropagation();
  const kind = SURFACE_KIND[d.surface];
  if (!kind || !writer) return;
  const fields = { title: d.title || '', html: d.html || '' };
  if (kind === 'note') { fields.sectionId = d.sectionId; if (d.subtaskNoteId) fields.subtaskNoteId = d.subtaskNoteId; }
  if (kind === 'meeting' && d.date) fields.date = d.date;
  store.set('drafts', dropDraft(store.get('drafts', []), d));
  writer.create(kind, fields);
  bump();
}

function createFromSection(kind, e) {
  if (e) e.stopPropagation();
  const card = getCard();
  const composer = api.service('composer');
  if (composer && typeof composer.open === 'function') {
    composer.open({ kind, from: 'write', prefill: kind === 'note' && card ? { sectionId: card } : undefined });
    return;
  }
  if (!writer) return;
  if (kind === 'note') writer.create('note', { sectionId: card || undefined });
  else writer.create(kind, {});
}

function sheetButton(label, glyph, run, { danger = false } = {}) {
  const b = el('button', 'mx-btn mx-btn-block mx-write-action' + (danger ? ' mx-btn-danger' : ''));
  b.type = 'button';
  const g = el('span', 'mx-write-action-glyph');
  g.innerHTML = glyph;
  b.append(g, el('span', 'mx-write-action-label', label));
  b.addEventListener('click', run);
  return b;
}

function openDocSheet(doc) {
  api.openSheet({
    id: 'write-doc',
    title: doc.title,
    build(body, sheet) {
      const where = el('p', 'mx-sheet-note mx-write-sheet-where',
        [KIND_LABEL[doc.kind], doc.kind === 'note' ? doc.location || doc.cardTitle : doc.meta].filter(Boolean).join(' · '));
      body.appendChild(where);
      const list = el('div', 'mx-list mx-write-actions');
      list.appendChild(sheetButton('Open', GLYPHS.open, (e) => { sheet.close({ immediate: true }); openDoc(doc, e); }));
      if (doc.kind === 'project' || doc.kind === 'idea') {
        list.appendChild(sheetButton('Rename', GLYPHS.rename, () => { sheet.close({ immediate: true }); openRenameSheet(doc); }));
        list.appendChild(sheetButton(`Delete ${doc.kind}…`, GLYPHS.trash, () => { sheet.close({ immediate: true }); deleteDoc(doc); }, { danger: true }));
      }
      if (doc.kind === 'meeting') {
        const m = (model.meetings || []).find(x => x.id === doc.id);
        if (m && meetingOccursOn(m, todayKeyOf())) {
          list.appendChild(sheetButton('Add today’s notes', GLYPHS.today, (e) => { e.stopPropagation(); sheet.close({ immediate: true }); writer.meetingJumpIn(doc.id); }));
        }
      }
      if (doc.kind === 'note') {
        if (!doc.legacy) {
          list.appendChild(sheetButton(doc.pinned ? 'Unpin' : 'Pin to the top', GLYPHS.pinRow, () => { togglePin(doc); sheet.close(); }));
        }
        list.appendChild(sheetButton('Copy as Markdown', GLYPHS.copy, () => { copyMarkdown(doc); sheet.close(); }));
      }
      body.appendChild(list);
    },
  });
}

function noteRecord(doc) {
  const list = doc.subtaskNoteId ? (model.subtaskNotes || {})[doc.subtaskNoteId] : (model.cardNotes || {})[doc.sectionId];
  return Array.isArray(list) ? list.find(n => n && n.key === doc.noteKey) || null : null;
}

function togglePin(doc) {
  const note = noteRecord(doc);
  if (!note) return;
  // The edited time stays as it is: pinning is not an edit
  if (note.pinned) delete note.pinned; else note.pinned = true;
  if (window.saveModel) window.saveModel();
  api.toast(note.pinned ? 'Pinned' : 'Unpinned');
}

function copyMarkdown(doc) {
  const note = noteRecord(doc);
  const legacy = doc.legacy ? (model.cardNotes || {})[doc.sectionId] : null;
  const html = note ? note.content : (typeof legacy === 'string' ? legacy : '');
  let md = '';
  try { md = htmlToMarkdown(html || ''); } catch { md = doc.text; }
  const text = (doc.title ? `# ${doc.title}\n\n` : '') + md;
  const done = () => api.toast('Copied as Markdown');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => api.toast('Couldn’t copy'));
  else api.toast('Couldn’t copy');
}

function ideaList() {
  return typeof tasksApi.getAllIdeas === 'function' ? tasksApi.getAllIdeas() : (model.ideas || []);
}

function renameDoc(doc, title) {
  if (doc.kind === 'project') {
    if (typeof projectsApi.updateProject === 'function') projectsApi.updateProject(doc.id, { title });
  } else if (doc.kind === 'idea') {
    if (typeof tasksApi.updateIdea === 'function') tasksApi.updateIdea(doc.id, { title });
    else {
      const idea = ideaList().find(i => i.id === doc.id);
      if (idea) { idea.title = title; if (window.saveModel) window.saveModel(); }
    }
  }
}

function openRenameSheet(doc) {
  api.openSheet({
    id: 'write-rename',
    title: doc.kind === 'project' ? 'Rename project' : 'Rename idea',
    keyboardAware: true,
    build(body, sheet) {
      const form = el('form', 'mx-write-rename');
      const input = el('input', 'mx-write-rename-input');
      input.type = 'text';
      input.value = doc.title;
      input.maxLength = 120;
      input.enterKeyHint = 'done';
      input.setAttribute('aria-label', 'Name');
      const row = el('div', 'mx-write-rename-row');
      const cancel = el('button', 'mx-btn mx-btn-quiet', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => sheet.close());
      const save = el('button', 'mx-btn mx-btn-primary', 'Rename');
      save.type = 'submit';
      row.append(cancel, save);
      form.append(input, row);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (title && title !== doc.title) { renameDoc(doc, title); api.toast('Renamed'); }
        input.blur();
        sheet.close();
      });
      body.appendChild(form);
      // Focused inside the tap that opened the sheet: the keyboard comes up with it
      input.focus();
      input.select();
    },
  });
}

function deleteDoc(doc) {
  if (!confirm(`Delete “${doc.title}”? This cannot be undone.`)) return;
  if (doc.kind === 'project') {
    if (typeof projectsApi.deleteProject === 'function') projectsApi.deleteProject(doc.id);
  } else if (doc.kind === 'idea') {
    if (typeof tasksApi.deleteIdea === 'function') tasksApi.deleteIdea(doc.id);
    else {
      const ideas = ideaList();
      const i = ideas.findIndex(x => x.id === doc.id);
      if (i >= 0) { ideas.splice(i, 1); if (window.saveModel) window.saveModel(); }
    }
  }
  api.toast(doc.kind === 'project' ? 'Project deleted' : 'Idea deleted');
}

// Write tab with the Notes filter and that card's chip (Links "Notes n")
function showNotesFor(sectionId) {
  store.set('filter', 'note');
  store.set('card', sectionId || undefined);
  query = '';
  if (view) { view.input.value = ''; view.clear.hidden = true; }
  if (api.getTab() !== 'write') api.navigate('write');
  else renderBody();
  window.scrollTo(0, 0);
}

function bump() {
  version++;
  if (api && api.isMounted && api.isMounted()) api.render('write');
}

// --- Entry ----------------------------------------------------------------------------------
export default {
  init(shellApi) {
    api = shellApi;
    store = api.store('write', { perAccount: true });
    writer = createWriter(api, { onChange: bump });
    api.provide('writer', {
      open: writer.open,
      create: writer.create,
      meetingJumpIn: writer.meetingJumpIn,
      showNotesFor,
      recent: writer.recent,
      searchIndex: writer.searchIndex,
      keepAll: writer.keepAll,
      anyOpen: writer.anyOpen,
    });
    api.registerScreen({
      id: 'write',
      title: 'Write',
      icon: 'write',
      mount,
      signature: (ctx) => `${fingerprint(ctx.data || model)}|${version}|${ctx.todayKey}`,
      render,
      reveal: (target) => { if (target && target.sectionId) showNotesFor(target.sectionId); },
    });
  },
};

