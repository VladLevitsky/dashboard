// Personal Dashboard - Mobile shell: the writer (unit F3)
// The 7 reused editors (task editor, subtask description, projects, ideas,
// meetings, the notepad and its note viewer) keep their own code. Under the
// shell, mobile-write.css turns each into the same full-screen writer frame;
// this module adds what CSS can't:
//   - opening read-first from the Write tab and the other tabs (open / create /
//     meetingJumpIn), recording "Continue writing"
//   - Back = keep: one adapter per surface replaces F0's interim layers, and the
//     frames' × (the back chevron) runs the same adapter. Back never asks a
//     confirm(); only the explicit Cancel / Discard buttons keep theirs
//   - shell-side baselines (writingApi.hooks.load) to tell a touched document
//     from an untouched one
//   - drafts: every open, dirty writer is snapshotted when the page hides and
//     offered back (a banner in the frame or over its read view, or a row on
//     the Write tab). A stored draft is dropped only when this frame session
//     snapshotted it, or the user restored or discarded it: never one the user
//     was not shown
//   - writer-bar extras injected once: the project title (tap = rename), the
//     ⋯ menu (Focus, Rename, Discard changes, the note viewer's Copy / Export /
//     Delete), the draft banner
//   - keyboard care: toolbar buttons keep the selection on pointerdown, the
//     subtask ⋮ dropdown closes when the frame scrolls
// Everything is keyed on the shell being mounted; desktop and tablet never see
// any of it (the injected nodes are hidden outside html[data-shell="mobile"]
// and removed on unmount).

import { model } from '../../state.js';
import { showToast } from '../../utils.js';
import { cleanEditorHtml, isEffectivelyEmpty, placeCaretAtEnd, placeCaretAtStart } from '../writing/dom.js';
import { firstLineTitle } from '../../core/mobile-common.js';
import {
  collectDocs, mergeRecent, recentDocs, pushDraft, dropDraft, draftKey, draftFor, draftDiffers, clockLabel,
  datedHeadingHtml, parseSubtaskNoteId,
} from '../../core/mobile-write.js';
import { orderCardsForMobile } from '../../core/mobile-common.js';
import * as tasksApi from '../tasks.js';
import * as projectsApi from '../projects.js';
import * as meetingsApi from '../meetings.js';
import * as notesApi from '../edit-mode.js';

const $ = (sel, root = document) => root.querySelector(sel);

// --- The 7 surfaces ------------------------------------------------------------
// key: our name; layer: the F0 layer id we replace; wr: the writing engine id
const SURFACES = [
  { key: 'task', layer: 'task-editor', root: '#task-editor-modal', editor: '#task-desc-editor', title: '#task-editor-name', close: '.task-editor-close-btn', wr: 'task' },
  { key: 'subtask', layer: 'subtask-desc', root: '#subtask-desc-modal', editor: '#subtask-desc-editor', close: '.subtask-desc-close-btn', wr: 'subtask' },
  { key: 'projects', layer: 'projects', root: '#projects-modal', editor: '#project-editor', close: '.projects-close-btn', wr: 'projects' },
  { key: 'ideas', layer: 'ideas', root: '#ideas-modal', editor: '#ideas-editor', title: '#ideas-title-input', close: '.ideas-close-btn', wr: 'ideas' },
  { key: 'meetings', layer: 'meetings', root: '#meetings-modal', editor: '#meetings-inline-desc-editor', title: '#meetings-inline-name', close: '.meetings-close-btn', wr: 'meetings' },
  { key: 'notepad', layer: 'notepad', root: '#notepad-popover', editor: '#notepad-editor', title: '#notepad-title', close: '#notepad-close', wr: 'notes' },
  { key: 'viewer', layer: 'note-viewer', root: '#note-viewer-modal', close: '#note-viewer-close' },
];
const BY_KEY = new Map(SURFACES.map(s => [s.key, s]));
const BY_WR = new Map(SURFACES.filter(s => s.wr).map(s => [s.wr, s]));
const ROOTS = SURFACES.map(s => s.root).join(', ');
const CLOSERS = SURFACES.map(s => `${s.root} ${s.close}`).join(', ');
// Toolbar buttons that must not take the caret away (Android drops the selection)
const TOOLBAR_BUTTONS = ':is(.wr-tb-btn, .task-desc-toolbar-btn, .projects-toolbar-btn, .ideas-toolbar-btn, .subtask-toolbar-btn, .notepad-toolbar-btn, .meetings-inline-toolbar-btn, .highlighter-btn, .highlighter-pen, .project-hyperlink-btn, .project-convert-task-btn, .meeting-hyperlink-btn, .meeting-convert-task-btn)';

const ICONS = {
  more: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
  draft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 8v4l2.5 2.5"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 4 3 11 10 11"/></svg>',
};

let api = null;
let store = null;
let mountedHooks = false;
let bypass = false;                // our own clicks on a frame's × go through
const baselines = new Map();       // surface key -> { title, html, fields }
const sessionDrafts = new Map();   // surface key -> Map(draftKey -> doc): drafts this frame session snapshotted (obsolete on close)
const wasOpen = new Map();         // surface key -> boolean
let taskDateBase = null;
let jumpIn = null;                 // { meetingId, after } while a jump-in heading is untouched
let viewerDoc = null;              // the note shown in the viewer: { sectionId, noteKey, subtaskNoteId }
let caretFrame = 0;
let frameObserver = null;
let rootObserver = null;
const observedRoots = new WeakSet();
let saveBtnObserver = null;
let onRecentChange = () => {};

// --- Small helpers ---------------------------------------------------------------
const mounted = () => !!(api && api.isMounted && api.isMounted());
const rootOf = (s) => $(s.root);
const isOpen = (s) => { const r = rootOf(s); return !!r && r.isConnected && !r.hidden; };
const editorOf = (s) => (s.editor ? $(s.editor) : null);

function normHtml(html) {
  const h = String(html || '').trim();
  return isEffectivelyEmpty(h) ? '' : h;
}

function editorHtml(editor) {
  if (!editor) return '';
  try { return normHtml(cleanEditorHtml(editor)); } catch { return normHtml(editor.innerHTML); }
}

function wrOpts(editor) {
  return (editor && editor._wr && editor._wr.opts) || {};
}

function docIdOf(editor) {
  const o = wrOpts(editor);
  try { return typeof o.getDocId === 'function' ? o.getDocId() : null; } catch { return null; }
}

function notifyChange(editor) {
  if (editor && editor._wr && typeof editor._wr.notifyChange === 'function') editor._wr.notifyChange();
}

// Click a frame control past our own × interception
function nativeClick(el) {
  if (!el) return;
  bypass = true;
  try { el.click(); } finally { bypass = false; }
}

// Run fn with window.confirm answered by `answer` (and tell whether it asked)
function withConfirm(answer, fn) {
  const original = window.confirm;
  let asked = false;
  window.confirm = () => { asked = true; return answer; };
  try { fn(); } finally { window.confirm = original; }
  return asked;
}

function focusEnd(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  placeCaretAtEnd(el);
}

// --- Notes: the notepad's open doc ('card:sectionId:noteKey' / 'subtask:id:noteKey')
function notepadDoc() {
  const raw = String(docIdOf($('#notepad-editor')) || '');
  const first = raw.indexOf(':');
  const last = raw.lastIndexOf(':');
  if (first < 0 || last <= first) return null;
  const type = raw.slice(0, first);
  const mid = raw.slice(first + 1, last);
  const noteKey = raw.slice(last + 1) || 'new';
  if (type === 'subtask') {
    const ref = parseSubtaskNoteId(mid);
    return { type, subtaskNoteId: mid, sectionId: ref ? ref.sectionId : '', noteKey };
  }
  return { type: 'card', sectionId: mid, noteKey };
}

function notesListFor(doc) {
  if (!doc) return [];
  const list = doc.type === 'subtask'
    ? (model.subtaskNotes || {})[doc.subtaskNoteId]
    : (model.cardNotes || {})[doc.sectionId];
  return Array.isArray(list) ? list : [];
}

// --- Snapshots and dirty checks ---------------------------------------------------
function meetingFields() {
  const val = (sel) => { const el = $(sel); return el ? el.value : ''; };
  const links = [...document.querySelectorAll('#meetings-inline-link-rows .meeting-link-row')].map(row => [
    (row.querySelector('.meeting-link-title') || {}).value || '', (row.querySelector('.meeting-link-url') || {}).value || '',
  ]);
  const files = [...document.querySelectorAll('#meetings-inline-file-rows .meeting-file-row')].map(row => row.dataset.fileId || '');
  return JSON.stringify([val('#meetings-inline-type'), val('#meetings-inline-date'), val('#meetings-inline-repeat'),
    val('#meetings-inline-weekly-type'), val('#meetings-inline-monthly-type'), links, files]);
}

function snapshot(s) {
  const title = s.title ? ($(s.title) || {}).value || '' : '';
  const snap = { title: String(title).trim(), html: editorHtml(editorOf(s)) };
  if (s.key === 'meetings') snap.fields = meetingFields();
  return snap;
}

function isDirty(s) {
  if (s.key === 'notepad' && typeof notesApi.isNotepadDirty === 'function') return !!notesApi.isNotepadDirty();
  const base = baselines.get(s.key);
  if (!base) {
    // No load seen (opened before the shell): an empty document is clean
    const now = snapshot(s);
    return !!(now.title || now.html);
  }
  const now = snapshot(s);
  return now.title !== base.title || now.html !== base.html || (s.key === 'meetings' && now.fields !== base.fields);
}

// --- Recent ("Continue writing") -----------------------------------------------------
function recordRecent(entry) {
  if (!store || !entry || !entry.kind || !entry.id) return;
  store.set('recent', mergeRecent(store.get('recent', []), { ...entry, at: Date.now() }));
  onRecentChange();
}

// --- Drafts -------------------------------------------------------------------------
function readDrafts() {
  const d = store ? store.get('drafts', []) : [];
  return Array.isArray(d) ? d : [];
}

function writeDrafts(list) {
  if (store) store.set('drafts', list.length ? list : undefined);
  onRecentChange();
}

function forgetDraft(match) {
  if (!match) return;
  const list = readDrafts();
  const next = dropDraft(list, match);
  if (next.length !== list.length) writeDrafts(next);
}

// A draft this frame session owns: snapshotted from it on hide. Closing the
// frame (kept, saved or cancelled) drops exactly these. A draft left by an
// earlier page (a page kill) is not owned: it stays until the user restores or
// discards it from its banner, even when the doc is edited and saved meanwhile
function markSession(key, doc) {
  if (!doc) return;
  let m = sessionDrafts.get(key);
  if (!m) { m = new Map(); sessionDrafts.set(key, m); }
  m.set(draftKey(doc), doc);
}

function ownsDraft(doc) {
  const m = doc ? sessionDrafts.get(doc.surface) : null;
  return !!m && m.has(draftKey(doc));
}

// The doc was kept, saved or discarded: drop the draft this session took of
// it. A never-saved doc's draft ('new') is dropped only by its own frame
// session (onFrameClose), since an unrelated recovered draft of the same
// surface shares its key
function forgetDoc(doc) {
  if (doc && doc.docId && doc.docId !== 'new' && ownsDraft(doc)) forgetDraft(doc);
}

// Where the open document of a surface lives (for drafts and recent)
function currentDoc(s) {
  const editor = editorOf(s);
  switch (s.key) {
    case 'notepad': {
      const d = notepadDoc();
      if (!d) return null;
      return { surface: 'notepad', docId: d.noteKey === 'new' ? 'new' : d.noteKey, sectionId: d.sectionId, subtaskNoteId: d.subtaskNoteId || null };
    }
    case 'projects': case 'ideas': case 'meetings': case 'task': case 'subtask':
      return { surface: s.key, docId: String(docIdOf(editor) || 'new') };
    default:
      return null;
  }
}

function draftOf(s) {
  const doc = currentDoc(s);
  if (!doc) return null;
  const editor = editorOf(s);
  let html = editorHtml(editor);
  let title = s.title ? (($(s.title) || {}).value || '').trim() : '';
  if (s.key === 'task') {
    const wrap = $('#task-desc-editor-wrap');
    if (wrap && wrap.hidden) html = normHtml(($('#task-desc-view-content') || {}).innerHTML || '');
  }
  if (s.key === 'meetings') {
    const date = ($('#meetings-inline-date') || {}).value || '';
    if (date) doc.date = date;
  }
  return { ...doc, title, html, at: Date.now() };
}

// Snapshot every open, dirty writer (page hide); projects simply save
function keepAll({ reason = 'hide' } = {}) {
  let list = readDrafts();
  let changed = false;
  SURFACES.forEach(s => {
    if (!isOpen(s) || s.key === 'viewer') return;
    if (s.key === 'projects') {
      const ed = editorOf(s);
      if (ed && ed._wr && isDirty(s)) { try { ed._wr.run('save'); } catch { /* best effort */ } }
      return;
    }
    if (s.key === 'meetings' && !$('#meetings-inline-name')) return;   // view / list: nothing typed
    if (s.key === 'ideas' && $('#ideas-editor-section') && $('#ideas-editor-section').hidden) return;
    if (!isDirty(s)) return;
    const d = draftOf(s);
    if (!d || (!d.html && !d.title)) return;
    list = pushDraft(list, { ...d, reason });
    markSession(s.key, d);
    changed = true;
  });
  if (changed) writeDrafts(list);
  return changed;
}

// "Unsaved text from 10:42 · Restore · Discard" at the top of a frame's
// document, under the writer bar (never under the lifted primary action)
const BANNER_HOSTS = {
  projects: () => ({ parent: $('#projects-body') }),
  ideas: () => ({ parent: $('#ideas-editor-section') }),
  meetings: () => { const d = $('#meetings-view-section .meeting-editor-description'); return { parent: d ? d.parentElement : null }; },
  notepad: () => ({ parent: $('#notepad-popover'), before: $('#notepad-title') }),
  task: () => ({ parent: $('#task-editor-modal .task-editor-description') }),
  subtask: () => ({ parent: $('#subtask-desc-modal .subtask-desc-body') }),
};

function removeBanner(s) {
  const r = rootOf(s);
  if (r) r.querySelectorAll('.mx-draft-banner').forEach(b => b.remove());
}

function makeBanner(draft, onRestore) {
  const banner = document.createElement('div');
  banner.className = 'mx-draft-banner';
  banner.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'mx-draft-text';
  text.innerHTML = ICONS.draft;
  text.append(` Unsaved text from ${clockLabel(draft.at)}`);
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'mx-draft-btn mx-draft-restore';
  restore.textContent = 'Restore';
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'mx-draft-btn';
  discard.textContent = 'Discard';
  restore.addEventListener('click', () => { banner.remove(); onRestore(); });
  discard.addEventListener('click', () => { forgetDraft(draft); banner.remove(); });
  banner.append(text, restore, discard);
  return banner;
}

function placeBanner(banner, { parent, before } = {}) {
  if (!parent) return false;
  if (before && before.parentElement === parent) parent.insertBefore(banner, before);
  else parent.prepend(banner);
  return true;
}

// Put a draft into the open editor of its surface
function applyDraft(s, draft) {
  const editor = editorOf(s);
  if (s.title && draft.title) { const t = $(s.title); if (t) t.value = draft.title; }
  if (s.key === 'meetings' && draft.date) { const d = $('#meetings-inline-date'); if (d) d.value = draft.date; }
  if (editor) { editor.innerHTML = draft.html || ''; notifyChange(editor); }
  forgetDraft(draft);
  removeBanner(s);
  if (api) api.toast('Unsaved text restored');
}

function maybeOfferDraft(s) {
  removeBanner(s);
  if (!mounted() || !BANNER_HOSTS[s.key]) return;
  const doc = currentDoc(s);
  if (!doc || doc.docId === 'new') return;
  const draft = draftFor(readDrafts(), doc.surface, doc.docId, doc.sectionId);
  if (!draft) return;
  const now = snapshot(s);
  if (!draftDiffers(draft, now)) { forgetDraft(draft); return; }
  placeBanner(makeBanner(draft, () => applyDraft(s, draft)), BANNER_HOSTS[s.key]());
}

// The same banner over a read view (a task's description, an idea, a meeting,
// a note in the viewer): Restore opens the editor and puts the draft in it
function storedHtml(html) {
  try { return normHtml(cleanEditorHtml(String(html || ''))); } catch { return normHtml(html); }
}

function viewDraft(s) {
  const drafts = readDrafts();
  if (!drafts.length) return null;
  if (s.key === 'task') {
    // A task with a description opens read-first (no editor load, so no
    // maybeOfferDraft); without one it opens editing and the load hook offers it
    const wrap = $('#task-desc-editor-wrap');
    if (!wrap || !wrap.hidden) return null;
    const id = docIdOf($('#task-desc-editor'));
    const task = id && id !== 'new' ? (model.tasks || []).find(t => t.id === id) : null;
    if (!task) return null;
    const draft = draftFor(drafts, 'task', id);
    if (!draft || !draftDiffers(draft, { title: task.title || '', html: storedHtml(task.description) }) || !draftDiffers(draft, draftOf(s))) return null;
    return { draft, target: s, host: BANNER_HOSTS.task(), edit: () => nativeClick($('#task-desc-edit-btn')) };
  }
  if (s.key === 'ideas') {
    const section = $('#ideas-view-section');
    if (!section || section.hidden) return null;
    const id = docIdOf($('#ideas-editor'));
    const idea = id && id !== 'new' ? (model.ideas || []).find(i => i.id === id) : null;
    if (!idea) return null;
    const draft = draftFor(drafts, 'ideas', id);
    if (!draft || !draftDiffers(draft, { title: idea.title || '', html: storedHtml(idea.description) })) return null;
    return { draft, target: BY_KEY.get('ideas'), host: { parent: section }, edit: () => nativeClick($('#ideas-view-edit')) };
  }
  if (s.key === 'meetings') {
    const section = $('#meetings-view-section');
    if (!section || section.hidden || $('#meetings-inline-name')) return null;
    const active = $('#meetings-modal .meetings-item.active');
    const id = active ? active.dataset.meetingId : '';
    const m = id ? (model.meetings || []).find(x => x.id === id) : null;
    if (!m) return null;
    const draft = draftFor(drafts, 'meetings', id);
    if (!draft || !draftDiffers(draft, { title: m.title || '', html: storedHtml(m.description) })) return null;
    return { draft, target: BY_KEY.get('meetings'), host: { parent: section }, edit: () => nativeClick($('#meetings-view-edit')) };
  }
  if (s.key === 'viewer') {
    const d = viewerDoc;
    if (!d) return null;
    const list = notesListFor({ type: d.subtaskNoteId ? 'subtask' : 'card', sectionId: d.sectionId, subtaskNoteId: d.subtaskNoteId });
    const note = list.find(n => n.key === d.noteKey);
    if (!note) return null;
    const draft = draftFor(drafts, 'notepad', d.noteKey, d.sectionId);
    if (!draft || !draftDiffers(draft, { title: note.title || '', html: storedHtml(note.content) })) return null;
    return {
      draft, target: BY_KEY.get('notepad'),
      host: { parent: $('#note-viewer-modal .note-viewer-dialog'), before: $('#note-viewer-content') },
      edit: () => nativeClick($('#note-viewer-edit')),
    };
  }
  return null;
}

function offerViewDraft(s) {
  if (!mounted() || !isOpen(s)) return;
  const root = rootOf(s);
  if (root) root.querySelectorAll('.mx-draft-banner-view').forEach(b => b.remove());
  const offer = viewDraft(s);
  if (!offer) return;
  const banner = makeBanner(offer.draft, () => {
    offer.edit();
    applyDraft(offer.target, offer.draft);
    if (api) api.syncHistory();
  });
  banner.classList.add('mx-draft-banner-view');
  placeBanner(banner, offer.host);
}

// --- Back = keep: one adapter per surface ---------------------------------------------
function backTask() {
  const date = ($('#task-editor-date') || {}).value || '';
  // The stored due date is the baseline of an existing task (the editor's own
  // change check doesn't cover the date); a new one uses the date it opened with
  const taskId = docIdOf($('#task-desc-editor'));
  const stored = taskId && taskId !== 'new' ? (model.tasks || []).find(t => t.id === taskId) : null;
  const dateBase = stored ? (stored.dueDate || '') : taskDateBase;
  const dateChanged = dateBase !== null && date !== dateBase;
  let dirty = dateChanged;
  if (!dirty && typeof tasksApi.taskEditorHasChanges === 'function') {
    dirty = !!tasksApi.taskEditorHasChanges();
  } else if (!dirty) {
    // Without the export: let the task editor's own check answer (a clean
    // editor closes; a dirty one asks, and we say "stay")
    const asked = withConfirm(false, () => nativeClick($('#task-editor-modal .task-editor-close-btn')));
    if (!asked) return;
    dirty = true;
  }
  if (!dirty) { closeTaskClean(); return; }
  const name = $('#task-editor-name');
  if (name && !name.value.trim()) {
    const wrap = $('#task-desc-editor-wrap');
    const html = wrap && !wrap.hidden ? editorHtml($('#task-desc-editor')) : (($('#task-desc-view-content') || {}).innerHTML || '');
    name.value = firstLineTitle(html) || 'Untitled task';
  }
  const doc = currentDoc(BY_KEY.get('task'));
  nativeClick($('#task-editor-save'));
  if (isOpen(BY_KEY.get('task'))) closeTaskClean();            // a save that refused: never trap Back
  forgetDoc(doc);
}

function closeTaskClean() {
  if (typeof tasksApi.closeTaskEditorModal === 'function') { tasksApi.closeTaskEditorModal(true); return; }
  withConfirm(true, () => nativeClick($('#task-editor-modal .task-editor-close-btn')));
}

function backSubtask() {
  const s = BY_KEY.get('subtask');
  if (isDirty(s)) nativeClick($('#subtask-desc-save'));
  else nativeClick($('#subtask-desc-cancel'));
  if (isOpen(s)) { const m = rootOf(s); if (m) m.hidden = true; }
}

function backProjects() {
  const s = BY_KEY.get('projects');
  const dirty = isDirty(s);
  const id = docIdOf(editorOf(s));
  if (typeof projectsApi.closeProjectsModal === 'function') projectsApi.closeProjectsModal();
  else if (window.closeProjectsModal) window.closeProjectsModal();
  if (id) recordRecent({ kind: 'project', id });
  forgetDoc({ surface: 'projects', docId: id });
  if (dirty && api) api.toast('Saved');
}

function backIdeas({ discard = false } = {}) {
  const s = BY_KEY.get('ideas');
  const section = $('#ideas-editor-section');
  const editing = !!section && !section.hidden;
  if (editing && !discard && isDirty(s)) {
    const editor = editorOf(s);
    const title = $('#ideas-title-input');
    if (title && !title.value.trim()) title.value = firstLineTitle(editorHtml(editor)) || 'Untitled idea';
    const doc = currentDoc(s);
    const before = new Set((model.ideas || []).map(i => i.id));
    nativeClick($('#ideas-save-btn'));
    const saved = doc && doc.docId !== 'new' ? doc.docId : ((model.ideas || []).find(i => !before.has(i.id)) || {}).id;
    if (saved) recordRecent({ kind: 'idea', id: saved });
    forgetDoc(doc);
  }
  nativeClick($('#ideas-modal .ideas-close-btn'));
}

function backMeetings() {
  const s = BY_KEY.get('meetings');
  const name = $('#meetings-inline-name');
  const desc = editorOf(s);
  if (!name || !desc) { closeMeetings(); return; }
  const doc = currentDoc(s);
  // A jump-in heading nobody typed under: put the description back as it was.
  // Edits to the name, date, type or links still count (the dirty check
  // below compares them with the load baseline, taken before the heading)
  if (jumpIn && jumpIn.editor === desc && editorHtml(desc) === jumpIn.after) desc.innerHTML = jumpIn.pre;
  jumpIn = null;
  const isNew = !$('#meetings-inline-delete');
  const empty = !name.value.trim() && !editorHtml(desc);
  if ((isNew && empty) || !isDirty(s)) { closeMeetings(); return; }
  if (!name.value.trim()) name.value = 'Untitled meeting';
  const before = new Set((model.meetings || []).map(m => m.id));
  nativeClick($('#meetings-inline-save'));
  const saved = doc && doc.docId !== 'new' ? doc.docId : ((model.meetings || []).find(m => !before.has(m.id)) || {}).id;
  if (saved) recordRecent({ kind: 'meeting', id: saved });
  forgetDoc(doc);
  closeMeetings();
}

function closeMeetings() {
  if (typeof meetingsApi.closeMeetingsModal === 'function') meetingsApi.closeMeetingsModal(true);
  else if (window.closeMeetingsModal) window.closeMeetingsModal(true);
}

function backNotepad() {
  const s = BY_KEY.get('notepad');
  const close = () => { if (typeof notesApi.closeNotepad === 'function') notesApi.closeNotepad(true); };
  if (!isOpen(s)) return;
  if (!isDirty(s)) { close(); return; }
  const editor = editorOf(s);
  const body = editorHtml(editor);
  const doc = notepadDoc();
  if (!body) {
    if (api) api.toast('Empty note not saved'); else showToast('Empty note not saved');
    close();
    forgetDoc(currentDoc(s));
    return;
  }
  const title = $('#notepad-title');
  if (title && !title.value.trim()) title.value = firstLineTitle(body) || 'Untitled';
  const draft = currentDoc(s);
  const before = new Set(notesListFor(doc).map(n => n.key));
  if (typeof notesApi.saveNote === 'function') notesApi.saveNote();
  const key = doc && doc.noteKey !== 'new' ? doc.noteKey : (notesListFor(doc).find(n => !before.has(n.key)) || {}).key;
  if (key && doc) recordRecent({ kind: 'note', id: `${doc.subtaskNoteId || doc.sectionId}#${key}`, sectionId: doc.sectionId, noteKey: key, subtaskNoteId: doc.subtaskNoteId || undefined });
  forgetDoc(draft);
  close();
}

function backViewer() {
  if (typeof notesApi.closeNoteViewer === 'function') notesApi.closeNoteViewer();
  backNotepad();
  const pop = $('#notepad-popover');
  if (pop && !pop.hidden && typeof notesApi.closeNotepad === 'function') notesApi.closeNotepad(true);
}

// The explicit Save of an idea or a note: the desktop falls back to a blank
// "new" form under its list; the shell hides that list, so show the saved
// document in its read view instead (Back then closes it)
function saveIdea() {
  const s = BY_KEY.get('ideas');
  const editor = editorOf(s);
  const title = $('#ideas-title-input');
  const doc = currentDoc(s);
  const body = editorHtml(editor);
  if (title && !title.value.trim()) {
    if (!body) { nativeClick($('#ideas-save-btn')); return; }        // nothing yet: its own "Please enter a title"
    title.value = firstLineTitle(body) || 'Untitled idea';
  }
  const before = new Set((model.ideas || []).map(i => i.id));
  nativeClick($('#ideas-save-btn'));
  const saved = doc && doc.docId !== 'new' ? doc.docId : ((model.ideas || []).find(i => !before.has(i.id)) || {}).id;
  forgetDoc(doc);
  if (!saved) return;
  recordRecent({ kind: 'idea', id: saved });
  (tasksApi.openIdeasModal || window.openIdeasModal)(saved);
  offerViewDraft(s);
}

function saveNoteAndView() {
  const s = BY_KEY.get('notepad');
  const editor = editorOf(s);
  const body = editorHtml(editor);
  const doc = notepadDoc();
  if (!body || !doc || typeof notesApi.saveNote !== 'function') { nativeClick($('#notepad-save')); return; }   // "Note is empty"
  const title = $('#notepad-title');
  if (title && !title.value.trim()) title.value = firstLineTitle(body) || 'Untitled';
  const draft = currentDoc(s);
  const before = new Set(notesListFor(doc).map(n => n.key));
  notesApi.saveNote();
  const key = doc.noteKey !== 'new' && notesListFor(doc).some(n => n.key === doc.noteKey)
    ? doc.noteKey : (notesListFor(doc).find(n => !before.has(n.key)) || {}).key;
  forgetDoc(draft);
  if (!key) return;
  recordRecent({ kind: 'note', id: `${doc.subtaskNoteId || doc.sectionId}#${key}`, sectionId: doc.sectionId, noteKey: key, subtaskNoteId: doc.subtaskNoteId || undefined });
  if (typeof notesApi.openNoteViewer === 'function') {
    notesApi.openNoteViewer(key);
    viewerDoc = { sectionId: doc.sectionId, noteKey: key, subtaskNoteId: doc.subtaskNoteId || null };
  }
}

// Delete from the viewer's ⋯: the note is gone, so is its frame
function deleteFromViewer() {
  const d = viewerDoc;
  nativeClick($('#note-viewer-delete'));
  if (isOpen(BY_KEY.get('viewer'))) return;                       // the confirm said no
  if (d) forgetDraft({ surface: 'notepad', docId: d.noteKey, sectionId: d.sectionId });
  backNotepad();
  if (api) api.syncHistory();
}

const SAVERS = { '#ideas-save-btn': saveIdea, '#notepad-save': saveNoteAndView };
const SAVER_SEL = Object.keys(SAVERS).join(', ');

const BACK = {
  task: backTask, subtask: backSubtask, projects: backProjects, ideas: () => backIdeas(),
  meetings: backMeetings, notepad: backNotepad, viewer: backViewer,
};

// The frames' × (the back chevron) runs the same adapter; the idea / note
// Save shows what it saved
function onCloserClick(e) {
  if (bypass || !mounted()) return;
  const saver = e.target && e.target.closest ? e.target.closest(SAVER_SEL) : null;
  if (saver) {
    const run = SAVERS[Object.keys(SAVERS).find(sel => saver.matches(sel))];
    e.preventDefault();
    e.stopImmediatePropagation();
    try { run(); } catch (err) { console.error('[mobile] writer save failed', err); }
    if (api) api.syncHistory();
    return;
  }
  const btn = e.target && e.target.closest ? e.target.closest(CLOSERS) : null;
  if (!btn) return;
  const s = SURFACES.find(x => btn.matches(`${x.root} ${x.close}`));
  if (!s) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  runBack(s);
}

function runBack(s) {
  try { BACK[s.key](); } catch (err) { console.error('[mobile] writer back failed', s.key, err); }
  if (api) api.syncHistory();
}

// --- Frames: open / close transitions, decorations ---------------------------------------
function onFrameOpen(s) {
  if (s.key === 'task') {
    taskDateBase = ($('#task-editor-date') || {}).value || '';
    // The frame's one scroller keeps its offset across opens: every task opens at its name
    const body = $('#task-editor-modal .task-editor-body');
    if (body) body.scrollTop = 0;
  }
  decorate(s);
  offerViewDraft(s);
}

function onFrameClose(s) {
  if (s.key === 'task') taskDateBase = null;
  if (s.key === 'meetings') jumpIn = null;
  if (s.key === 'viewer') viewerDoc = null;
  removeBanner(s);
  // Kept, saved or cancelled: the drafts this session took (or edited past)
  // are history. Drafts of docs only looked at stay
  const owned = sessionDrafts.get(s.key);
  if (owned) owned.forEach(doc => forgetDraft(doc));
  sessionDrafts.delete(s.key);
}

function checkFrames() {
  SURFACES.forEach(s => {
    const root = rootOf(s);
    if (root && rootObserver && !observedRoots.has(root)) {
      observedRoots.add(root);
      rootObserver.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    }
    const open = isOpen(s);
    if (open === !!wasOpen.get(s.key)) return;
    wasOpen.set(s.key, open);
    if (!mounted()) return;
    if (open) onFrameOpen(s); else onFrameClose(s);
  });
}

function makeMoreButton(label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mx-writer-more';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.title = label;
  btn.dataset.wrUi = '';
  btn.innerHTML = ICONS.more;
  return btn;
}

function openMoreMenu(btn, items) {
  const wui = window.writingApi && window.writingApi.ui;
  const list = items.filter(Boolean);
  if (!wui || !list.length) return;
  wui.openMenu({ anchor: btn, items: list, placement: 'bottom-end', className: 'mx-writer-menu', keyboard: true, minWidth: 210 });
}

function focusItem(editorSel) {
  const fm = window.writingApi && window.writingApi.focusMode;
  const editor = $(editorSel);
  if (!fm || !editor || !editor._wr || !editor.getClientRects().length) return null;
  return { id: 'focus', label: 'Focus mode', icon: 'focus', run: () => fm.enter(editor) };
}

function decorate(s) {
  if (!mounted()) return;
  const root = rootOf(s);
  if (!root) return;
  if (s.key === 'projects') decorateProjects(root);
  if (s.key === 'ideas') decorateIdeas(root);
  if (s.key === 'meetings') decorateMeetings(root);
  if (s.key === 'viewer') decorateViewer(root);
}

function decorateProjects(root) {
  const bar = root.querySelector('.projects-title-bar');
  if (!bar) return;
  let title = bar.querySelector('.mx-writer-title');
  if (!title) {
    title = document.createElement('button');
    title.type = 'button';
    title.className = 'mx-writer-title';
    title.dataset.wrUi = '';
    title.addEventListener('click', () => renameProjectInFrame(title));
    bar.insertBefore(title, bar.querySelector('.projects-close-btn'));
    const more = makeMoreButton('More');
    more.addEventListener('click', () => {
      const id = docIdOf($('#project-editor'));
      openMoreMenu(more, [
        focusItem('#project-editor'),
        { id: 'rename', label: 'Rename', icon: 'text', run: () => renameProjectInFrame(title) },
        id ? { id: 'delete', label: 'Delete project…', icon: 'close', danger: true, run: () => deleteProjectFromFrame(id) } : null,
      ]);
    });
    bar.appendChild(more);
  }
  refreshProjectTitle();
  watchProjectSave(root);
}

function projectById(id) {
  const list = typeof projectsApi.getAllProjects === 'function' ? projectsApi.getAllProjects() : (model.projects || []);
  return list.find(p => p.id === id) || null;
}

function refreshProjectTitle() {
  const btn = $('#projects-modal .mx-writer-title');
  if (!btn) return;
  const p = projectById(docIdOf($('#project-editor')));
  const text = p ? (p.title || 'Untitled project') : 'Projects';
  if (btn.textContent !== text) btn.textContent = text;
  btn.setAttribute('aria-label', `${text}. Rename`);
}

// "Saved" in the writer bar follows the autosave (the ✓ button's dirty / saved classes)
function watchProjectSave(root) {
  const btn = root.querySelector('#project-save-btn');
  if (!btn || btn._mxWatched) return;
  btn._mxWatched = true;
  if (!saveBtnObserver) saveBtnObserver = new MutationObserver(() => paintProjectStatus());
  saveBtnObserver.observe(btn, { attributes: true, attributeFilter: ['class'] });
  paintProjectStatus();
}

function paintProjectStatus() {
  const btn = $('#project-save-btn');
  const label = $('#project-save-label');
  if (!btn || !label || !mounted()) return;
  const state = btn.classList.contains('dirty') ? 'dirty' : 'saved';
  if (label.dataset.mxState !== state) label.dataset.mxState = state;
}

// Rename inside the frame: a writing popover (the shell's sheets sit under
// every reused modal)
function renameProjectInFrame(anchor) {
  const id = docIdOf($('#project-editor'));
  const p = projectById(id);
  const wui = window.writingApi && window.writingApi.ui;
  if (!p || !wui) return;
  const form = document.createElement('form');
  form.className = 'mx-rename-pop';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mx-rename-input';
  input.value = p.title || '';
  input.setAttribute('aria-label', 'Project name');
  input.maxLength = 120;
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'mx-rename-save';
  save.textContent = 'Rename';
  form.append(input, save);
  const pop = wui.openPopover({ anchor, content: form, className: 'mx-rename-popover', placement: 'bottom-start', focus: input });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (title && title !== p.title) {
      if (typeof projectsApi.updateProject === 'function') projectsApi.updateProject(id, { title });
      else { p.title = title; window.saveModel && window.saveModel(); }
      refreshProjectTitle();
      if (api) api.toast('Renamed');
    }
    pop.close('done');
  });
}

function deleteProjectFromFrame(id) {
  const p = projectById(id);
  if (!p || !confirm(`Delete "${p.title || 'Untitled project'}"? This cannot be undone.`)) return;
  // Close first (it saves the open project), then delete
  if (typeof projectsApi.closeProjectsModal === 'function') projectsApi.closeProjectsModal();
  if (typeof projectsApi.deleteProject === 'function') projectsApi.deleteProject(id);
  if (api) { api.toast('Project deleted'); api.syncHistory(); }
}

function decorateIdeas(root) {
  const header = root.querySelector('.ideas-header');
  if (!header || header.querySelector('.mx-writer-more')) return;
  const more = makeMoreButton('More');
  more.addEventListener('click', () => {
    const section = $('#ideas-editor-section');
    const editing = !!section && !section.hidden;
    openMoreMenu(more, editing ? [
      focusItem('#ideas-editor'),
      { id: 'discard', label: 'Discard changes', icon: 'undo', danger: true, run: () => discardIdea() },
    ] : [
      { id: 'edit', label: 'Edit', icon: 'text', run: () => nativeClick($('#ideas-view-edit')) },
    ]);
  });
  header.insertBefore(more, header.querySelector('.ideas-close-btn'));
}

function discardIdea() {
  const s = BY_KEY.get('ideas');
  if (isDirty(s) && !confirm('Discard your changes to this idea?')) return;
  forgetDoc(currentDoc(s));
  backIdeas({ discard: true });
  if (api) api.syncHistory();
}

function decorateMeetings(root) {
  const header = root.querySelector('.meetings-header');
  if (!header || header.querySelector('.mx-writer-more')) return;
  const more = makeMoreButton('More');
  more.addEventListener('click', () => {
    const editing = !!$('#meetings-inline-name');
    openMoreMenu(more, editing ? [
      focusItem('#meetings-inline-desc-editor'),
    ] : [
      $('#meetings-view-edit') ? { id: 'edit', label: 'Edit', icon: 'text', run: () => nativeClick($('#meetings-view-edit')) } : null,
    ]);
  });
  header.appendChild(more);
}

// "Content Creation" (or "Card › Subtitle › item") under the note's title
function paintViewerWhere(root) {
  const header = root.querySelector('.note-viewer-header');
  if (!header) return;
  let where = header.querySelector('.mx-viewer-where');
  if (!where) {
    where = document.createElement('p');
    where.className = 'mx-viewer-where';
    const meta = header.querySelector('.note-viewer-meta');
    header.insertBefore(where, meta || null);
  }
  const d = notepadDoc();
  const section = d ? (model.sections || []).find(x => x.id === d.sectionId) : null;
  let text = section ? ((model.sectionTitles || {})[section.id] || section.title || '') : '';
  if (d && d.type === 'subtask') {
    const ref = parseSubtaskNoteId(d.subtaskNoteId);
    if (ref && ref.subtitle && ref.subtitle !== '_default') text += ` › ${ref.subtitle}`;
  }
  if (where.textContent !== text) where.textContent = text;
  where.hidden = !text;
}

function decorateViewer(root) {
  paintViewerWhere(root);
  const actions = root.querySelector('.note-viewer-actions');
  if (!actions || actions.querySelector('.mx-writer-more')) return;
  const more = makeMoreButton('More');
  more.addEventListener('click', () => {
    const content = $('#note-viewer-content');
    const wa = window.writingApi;
    const runView = (id) => {
      if (!wa || !content) return;
      wa.runCommand(id, { editor: null, viewEl: content, view: true, opts: {}, id: 'notes', api: wa, sel: window.getSelection() });
    };
    openMoreMenu(more, [
      { id: 'copy', label: 'Copy note', icon: 'copy', run: () => nativeClick($('#note-viewer-copy')) },
      wa ? { id: 'copyMd', label: 'Copy as Markdown', icon: 'code', run: () => runView('copyMd') } : null,
      wa ? { id: 'exportMd', label: 'Download Markdown', icon: 'download', run: () => runView('exportMd') } : null,
      wa ? { id: 'exportPdf', label: 'Export PDF', icon: 'pdf', run: () => runView('exportPdf') } : null,
      { id: 'delete', label: 'Delete note…', icon: 'close', danger: true, run: () => deleteFromViewer() },
    ]);
  });
  actions.appendChild(more);
}

function undecorate() {
  document.querySelectorAll('.mx-writer-title, .mx-writer-more, .mx-draft-banner, .mx-viewer-where').forEach(el => el.remove());
  const label = $('#project-save-label');
  if (label) delete label.dataset.mxState;
}

// --- writingApi.hooks.load: baselines, the project title, drafts ------------------------
function onEditorLoad(editor) {
  const s = BY_WR.get(editor && editor.dataset ? editor.dataset.wrEditor : '');
  if (!s || !mounted()) return;
  baselines.set(s.key, snapshot(s));
  if (s.key === 'projects') refreshProjectTitle();
  maybeOfferDraft(s);
}

// --- Opening (read-first) ------------------------------------------------------------------
function open(kind, id, opts = {}) {
  if (opts.event && typeof opts.event.stopPropagation === 'function') opts.event.stopPropagation();
  switch (kind) {
    case 'project': {
      const fn = projectsApi.openProjectsModal || window.openProjectsModal;
      if (!fn) return false;
      fn(id);
      // openProjectsModal focuses the editor; blurring in the same task means
      // no keyboard: the project opens to read, a tap in the text edits
      const a = document.activeElement;
      if (a && a !== document.body && typeof a.blur === 'function') a.blur();
      recordRecent({ kind: 'project', id });
      return true;
    }
    case 'idea': {
      const fn = tasksApi.openIdeasModal || window.openIdeasModal;
      if (!fn) return false;
      fn(id);
      recordRecent({ kind: 'idea', id });
      offerViewDraft(BY_KEY.get('ideas'));
      return true;
    }
    case 'meeting': {
      const fn = meetingsApi.openMeetingsModal || window.openMeetingsModal;
      if (!fn) return false;
      fn(id);
      recordRecent({ kind: 'meeting', id });
      offerViewDraft(BY_KEY.get('meetings'));
      return true;
    }
    case 'note': {
      // id: 'sectionId#noteKey' (a Write doc), or the bare note key with opts.sectionId
      const raw = String(id || '');
      const hash = raw.lastIndexOf('#');
      const sub = opts.subtaskNoteId || null;
      let noteKey = opts.noteKey || (hash >= 0 ? raw.slice(hash + 1) : raw);
      let sectionId = opts.sectionId || (hash >= 0 ? raw.slice(0, hash) : '');
      if (sub && !opts.sectionId) sectionId = (parseSubtaskNoteId(sub) || {}).sectionId || sectionId;
      if (!sectionId || !noteKey || typeof notesApi.openNotepad !== 'function') return false;
      if (sub) notesApi.openNotepad(sectionId, null, 'subtask', sub);
      else notesApi.openNotepad(sectionId);
      // A legacy plain-text note ('legacy_<card>') was just migrated by
      // openNotepad under a new key: it is the card's only note
      const list = notesListFor({ type: sub ? 'subtask' : 'card', sectionId, subtaskNoteId: sub });
      if (noteKey.startsWith('legacy_') && !list.some(n => n.key === noteKey) && list.length) noteKey = list[0].key;
      notesApi.openNoteViewer(noteKey);
      viewerDoc = { sectionId, noteKey, subtaskNoteId: sub };
      recordRecent({ kind: 'note', id: `${sub || sectionId}#${noteKey}`, sectionId, noteKey, subtaskNoteId: sub || undefined });
      offerViewDraft(BY_KEY.get('viewer'));
      return true;
    }
    case 'task': {
      const actions = api && api.service('taskActions');
      if (actions && typeof actions.openTask === 'function') actions.openTask(id);
      else if (tasksApi.openEditTaskModal) {
        tasksApi.openEditTaskModal(id);
        const a = document.activeElement;
        if (a && a !== document.body && typeof a.blur === 'function') a.blur();
      }
      return true;
    }
    default:
      return false;
  }
}

// --- Creating -------------------------------------------------------------------------------
function create(kind, fields = {}) {
  const f = fields || {};
  if (f.event && typeof f.event.stopPropagation === 'function') f.event.stopPropagation();
  switch (kind) {
    case 'note': {
      // A card that no longer exists (a recovered draft's) falls back to the first one
      const known = f.sectionId && (model.sections || []).some(x => x.id === f.sectionId) ? f.sectionId : null;
      const sectionId = known || (orderCardsForMobile(model.sections)[0] || {}).id;
      if (!sectionId || typeof notesApi.openNotepad !== 'function') return false;
      if (f.subtaskNoteId) notesApi.openNotepad(sectionId, null, 'subtask', f.subtaskNoteId);
      else notesApi.openNotepad(sectionId);
      const title = $('#notepad-title');
      const editor = $('#notepad-editor');
      if (title) title.value = f.title || '';
      if (editor) {
        if (f.html) editor.innerHTML = f.html;
        notifyChange(editor);
        focusEnd(editor);
      }
      return true;
    }
    case 'idea': {
      const fn = tasksApi.openIdeasModal || window.openIdeasModal;
      if (!fn) return false;
      fn();
      const title = $('#ideas-title-input');
      const editor = $('#ideas-editor');
      if (title) title.value = f.title || '';
      if (editor) {
        if (f.html) editor.innerHTML = f.html;
        notifyChange(editor);
      }
      if (editor && (f.html || f.title || !title)) focusEnd(editor);
      else if (title) title.focus();
      return true;
    }
    case 'project': {
      if (typeof projectsApi.createProject !== 'function') return false;
      const p = projectsApi.createProject((f.title || '').trim() || 'Untitled project');
      (projectsApi.openProjectsModal || window.openProjectsModal)(p.id);
      const editor = $('#project-editor');
      if (editor && f.html) { editor.innerHTML = f.html; notifyChange(editor); focusEnd(editor); }
      recordRecent({ kind: 'project', id: p.id });
      return p;
    }
    case 'meeting': {
      const fn = meetingsApi.openMeetingsModal || window.openMeetingsModal;
      if (!fn) return false;
      fn();
      const add = $('#meetings-add-btn');
      if (add) add.click();
      const name = $('#meetings-inline-name');
      const date = $('#meetings-inline-date');
      const type = $('#meetings-inline-type');
      if (name) name.value = f.title || '';
      if (date && f.date) date.value = f.date;
      if (type) { type.value = 'one-time'; type.dispatchEvent(new Event('change')); }
      const editor = $('#meetings-inline-desc-editor');
      if (editor) {
        if (f.html) { editor.innerHTML = f.html; notifyChange(editor); }
        focusEnd(editor);
      }
      return true;
    }
    case 'task': {
      const fn = tasksApi.openAddTaskModalWithCallback || window.openAddTaskModalWithCallback;
      if (!fn) return false;
      fn(f.title || '', null);
      const editor = $('#task-desc-editor');
      const wrap = $('#task-desc-editor-wrap');
      if (f.html && editor && wrap && !wrap.hidden) { editor.innerHTML = f.html; notifyChange(editor); }
      return true;
    }
    default:
      return false;
  }
}

// --- Meeting jump-in: a dated heading at the end of the notes, the caret under it --------
function meetingJumpIn(meetingId, { todayKey } = {}) {
  const fn = meetingsApi.openMeetingsModal || window.openMeetingsModal;
  if (!fn) return false;
  fn(meetingId);
  const edit = $('#meetings-view-edit');
  if (!edit) return false;
  edit.click();
  const desc = $('#meetings-inline-desc-editor');
  if (!desc) return false;
  const pre = desc.innerHTML;
  const d = new Date();
  const key = todayKey || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const heading = datedHeadingHtml(key);
  if (!heading) return false;
  // An empty description holds just <br> / an empty line: replace it
  if (!editorHtml(desc)) desc.innerHTML = heading; else desc.insertAdjacentHTML('beforeend', heading);
  notifyChange(desc);
  const last = desc.lastElementChild;
  try { desc.focus({ preventScroll: true }); } catch { desc.focus(); }
  if (last) { placeCaretAtStart(last); last.scrollIntoView({ block: 'nearest' }); }
  jumpIn = { meetingId, editor: desc, pre: normHtml(pre) ? pre : '', after: editorHtml(desc) };
  recordRecent({ kind: 'meeting', id: meetingId });
  return true;
}

// --- Service ----------------------------------------------------------------------------------
function anyOpen() {
  return SURFACES.some(isOpen);
}

function searchIndex() {
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return collectDocs(model, { todayKey, now: Date.now() });
}

function recent(n = 5) {
  return recentDocs(store ? store.get('recent', []) : [], searchIndex(), n);
}

// --- Install --------------------------------------------------------------------------------
function onScrollCapture(e) {
  if (!mounted()) return;
  const t = e.target;
  if (!t || t.nodeType !== 1) return;
  const modal = t.closest && t.closest('#task-editor-modal');
  if (!modal) return;
  const content = modal.querySelector('.task-editor-content');
  if (content && t !== content) content.dispatchEvent(new Event('scroll'));
}

// Meetings and the task description scroll their whole form, the toolbar
// stuck at the bottom: keep the caret line above it (the CSS scroll-padding
// does this where the engine honours it for caret reveal)
const STUCK_TOOLBARS = [
  { editor: '#meetings-inline-desc-editor', toolbar: '#meetings-inline-toolbar', scroller: '#meetings-view-section' },
  { editor: '#task-desc-editor', toolbar: '#task-desc-editor-wrap > .task-desc-toolbar', scroller: '#task-editor-modal .task-editor-body' },
];

function caretRectIn(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;
  let rect = range.getClientRects()[0];
  if (!rect || (!rect.height && !rect.top)) {
    const n = range.startContainer.nodeType === 1 ? (range.startContainer.childNodes[range.startOffset] || range.startContainer) : range.startContainer.parentElement;
    rect = n && n.getBoundingClientRect ? n.getBoundingClientRect() : null;
  }
  return rect && rect.height ? rect : null;
}

function keepCaretAboveToolbar() {
  caretFrame = 0;
  if (!mounted()) return;
  const a = document.activeElement;
  const def = a && STUCK_TOOLBARS.find(d => a.matches(d.editor));
  if (!def) return;
  const toolbar = $(def.toolbar);
  const scroller = $(def.scroller);
  const caret = caretRectIn(a);
  if (!toolbar || !scroller || !caret) return;
  const limit = toolbar.getBoundingClientRect().top - 8;
  if (caret.bottom > limit) scroller.scrollTop += Math.ceil(caret.bottom - limit);
}

function onCaretMove() {
  if (caretFrame || !mounted()) return;
  caretFrame = requestAnimationFrame(keepCaretAboveToolbar);
}

function onPointerDownCapture(e) {
  if (!mounted()) return;
  const t = e.target;
  const btn = t && t.closest ? t.closest(TOOLBAR_BUTTONS) : null;
  if (btn && btn.closest(ROOTS)) e.preventDefault();
}

function installGlobal() {
  if (mountedHooks) return;
  mountedHooks = true;
  document.addEventListener('click', onCloserClick, true);
  document.addEventListener('scroll', onScrollCapture, true);
  document.addEventListener('pointerdown', onPointerDownCapture, true);
  document.addEventListener('selectionchange', onCaretMove);
  const wa = window.writingApi;
  if (wa && wa.hooks && Array.isArray(wa.hooks.load)) wa.hooks.load.push(onEditorLoad);
  rootObserver = new MutationObserver(checkFrames);
  frameObserver = new MutationObserver(checkFrames);
  frameObserver.observe(document.body, { childList: true });
  checkFrames();
}

function registerLayers() {
  SURFACES.forEach(s => {
    api.registerLayer({
      id: s.layer,
      kind: 'reused',
      root: () => rootOf(s),
      isOpen: () => isOpen(s),
      back: () => { try { BACK[s.key](); } catch (err) { console.error('[mobile] writer back failed', s.key, err); } },
    });
  });
}

export function createWriter(shellApi, { onChange } = {}) {
  api = shellApi;
  store = api.store('write', { perAccount: true });
  if (typeof onChange === 'function') onRecentChange = onChange;
  registerLayers();
  installGlobal();
  api.on('hide', () => { try { keepAll({ reason: 'hide' }); } catch (err) { console.error('[mobile] keepAll failed', err); } });
  api.on('mount', () => {
    SURFACES.forEach(s => { wasOpen.set(s.key, false); });
    checkFrames();
  });
  api.on('unmount', () => {
    undecorate();
    baselines.clear();
    sessionDrafts.clear();
    viewerDoc = null;
    jumpIn = null;
    taskDateBase = null;
  });
  return {
    open, create, meetingJumpIn, recent, searchIndex, keepAll, anyOpen,
    back: (key) => { const s = BY_KEY.get(key); if (s) runBack(s); },
    drafts: () => readDrafts(),
    discardDraft: (d) => forgetDraft(d),
  };
}
