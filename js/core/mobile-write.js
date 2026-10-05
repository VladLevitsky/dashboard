// Personal Dashboard - Mobile shell: writing rules (pure, Node-testable)
// What the Write tab lists and how: every project, idea, meeting and card /
// subtask note as one flat "doc" list (plain-text previews, word counts, the
// meeting's next date), search over it, the dated heading a meeting jump-in
// adds, and the two small per-browser lists the writer keeps (recently opened
// docs and unsaved drafts). No DOM access; never mutates its inputs (legacy
// string notes are converted in memory only, the desktop migrates them on
// open).

import { htmlToPlainText, textStats } from './markdown.js';
import { meetingDatesBetween, meetingOccursOn, addDays } from './agenda.js';
import { orderCardsForMobile, cardTitle, relativeTime } from './mobile-common.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DOC_KINDS = ['project', 'idea', 'meeting', 'note'];
export const RECENT_MAX = 12;
export const DRAFTS_MAX = 10;

// --- Plain text (cached by HTML string: notes run to 30 KB) -------------------
const textCache = new Map();
const TEXT_CACHE_MAX = 400;

export function docText(html) {
  const raw = html == null ? '' : String(html);
  if (!raw) return '';
  const hit = textCache.get(raw);
  if (hit !== undefined) return hit;
  let text;
  try {
    // Tags, or entities ('&lt;div…' in a note typed as text), go through the parser
    text = /<[a-z!/]|&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(raw) ? htmlToPlainText(raw) : raw.replace(/\r\n?/g, '\n').trim();
  } catch {
    text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value);
  textCache.set(raw, text);
  return text;
}

// One line, at most `len` characters (the ellipsis included). With a query:
// the text around its first match (matchSnippet). snippet(text, max) still works
export function snippet(text, q, len) {
  if (typeof q === 'number') return plainSnippet(text, q);
  const max = Number.isFinite(len) ? len : 90;
  return q && String(q).trim() ? matchSnippet(text, q, max) : plainSnippet(text, max);
}

function plainSnippet(text, max = 90) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return line.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

// The preview under a title: the text without a first line that only repeats the title
export function previewText(title, text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length && title && lines[0].toLowerCase() === String(title).trim().toLowerCase()) lines.shift();
  return lines.join(' · ');
}

// '412 words', '1.1k words', '' when empty
export function formatWords(n) {
  const count = Number(n) || 0;
  if (!count) return '';
  if (count < 1000) return `${count} word${count === 1 ? '' : 's'}`;
  const k = count / 1000;
  return `${k >= 10 ? Math.round(k) : (Math.round(k * 10) / 10)}k words`;
}

// Checklist items in rich text: { done, total }
export function checklistProgress(html) {
  const raw = String(html || '');
  if (!/class="[^"]*\bchecklist\b/.test(raw)) return { done: 0, total: 0 };
  let total = 0, done = 0;
  // <li> directly inside a ul.checklist; "checked" in its class marks it done
  const lists = raw.split(/<ul\b[^>]*class="[^"]*\bchecklist\b[^"]*"[^>]*>/i).slice(1);
  lists.forEach(part => {
    const body = part.split(/<\/ul>/i)[0];
    const items = body.match(/<li\b[^>]*>/gi) || [];
    items.forEach(tag => {
      total++;
      if (/class="[^"]*\bchecked\b/i.test(tag)) done++;
    });
  });
  return { done, total };
}

// --- Dates ----------------------------------------------------------------------
function keyParts(key) {
  const m = DATE_KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

// 'Sep 14' / 'Mon 5'
function monthDay(key) { const d = keyParts(key); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : ''; }
function weekdayDay(key) { const d = keyParts(key); return d ? `${WEEKDAYS[d.getDay()]} ${d.getDate()}` : ''; }

function isRecurring(m) {
  return !!m && m.type === 'routine' && (m.repeat === 'weekly' || m.repeat === 'monthly');
}

// Meeting meta: 'Recurring · Sep 14', 'One-time · Oct 12', 'Weekly · next Mon 5',
// 'Monthly · today'. The next occurrence in the next 60 days, else its date
export function meetingWhenLabel(meeting, todayKey) {
  if (!meeting) return '';
  let kind;
  if (isRecurring(meeting)) {
    if (meeting.repeat === 'weekly') {
      const n = parseInt(meeting.repeatWeeks, 10) || 1;
      kind = n === 1 ? 'Weekly' : `Every ${n} weeks`;
    } else {
      kind = 'Monthly';
    }
  } else {
    kind = meeting.type === 'routine' ? 'Recurring' : 'One-time';
  }
  const hasDate = !!keyParts(meeting.date);
  if (!hasDate) return kind;
  if (DATE_KEY_RE.test(String(todayKey || ''))) {
    const next = meetingDatesBetween(meeting, todayKey, addDays(todayKey, 60))[0];
    if (next) {
      if (next === todayKey) return `${kind} · today`;
      if (isRecurring(meeting)) return `${kind} · next ${weekdayDay(next)}`;
      return `${kind} · ${monthDay(next)}`;
    }
  }
  return `${kind} · ${monthDay(meeting.date)}`;
}

// Meetings that happen on that day (agenda.js rules: a 'routine' meeting with
// no repeat rule only happens on its own date)
export function meetingsToday(data, todayKey) {
  const meetings = Array.isArray(data && data.meetings) ? data.meetings : [];
  return meetings.filter(m => m && meetingOccursOn(m, todayKey));
}

// The heading a meeting jump-in appends: an H2 holding a date chip, then an
// empty paragraph for the caret (canonical writing HTML, no whitespace)
export function datedHeadingHtml(dayKey) {
  const d = keyParts(dayKey);
  if (!d) return '';
  const label = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `<h2><span class="wr-date" data-date="${dayKey}" contenteditable="false">${label}</span></h2><p><br></p>`;
}

// --- Notes ----------------------------------------------------------------------
// A stored card's notes as an array (legacy plain-string notes become one note,
// in memory only)
export function notesArray(value, sectionId = '') {
  if (Array.isArray(value)) return value.filter(n => n && typeof n === 'object');
  if (typeof value === 'string' && value.trim()) {
    return [{ key: `legacy_${sectionId}`, title: 'Notes', content: value, legacy: true }];
  }
  return [];
}

// Pinned first, then the most recently edited, then the stored order
export function sortNotes(notes) {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => {
      const pa = a.note.pinned ? 1 : 0, pb = b.note.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ta = Number(a.note.updatedAt || a.note.createdAt) || 0;
      const tb = Number(b.note.updatedAt || b.note.createdAt) || 0;
      if (ta !== tb) return tb - ta;
      return a.index - b.index;
    })
    .map(x => x.note);
}

// 'sectionId:subtitle:itemKey' (subtitles may hold ':'): first and last colon
export function parseSubtaskNoteId(id) {
  const s = String(id || '');
  const first = s.indexOf(':');
  const last = s.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  return { sectionId: s.slice(0, first), subtitle: s.slice(first + 1, last), itemKey: s.slice(last + 1) };
}

function subtaskText(data, ref) {
  const card = data && data[ref.sectionId];
  const group = card && card[ref.subtitle];
  const list = group && Array.isArray(group.subtasks) ? group.subtasks : [];
  const item = list.find(s => s && s.key === ref.itemKey);
  return item ? String(item.text || '').trim() : '';
}

// --- The doc list ----------------------------------------------------------------
// data: the model (or a profile with the same top-level fields).
// opts: { cardOrder?: sections in reading order, todayKey?, now? }
// -> [{ kind, id, title, text, meta, words?, sectionId?, cardTitle?, location?,
//       subtaskNoteId?, noteKey?, pinned?, updatedAt?, checklist? }]
export function collectDocs(data, opts = {}) {
  const d = data || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const todayKey = opts.todayKey || '';
  const docs = [];

  (Array.isArray(d.projects) ? d.projects : []).forEach(p => {
    if (!p || !p.id) return;
    const text = docText(p.content);
    const words = text ? textStats(text).words : 0;
    docs.push({ kind: 'project', id: p.id, title: p.title || 'Untitled project', text, words, meta: formatWords(words) });
  });

  (Array.isArray(d.ideas) ? d.ideas : []).forEach(i => {
    if (!i || !i.id) return;
    const text = docText(i.description);
    const words = text ? textStats(text).words : 0;
    docs.push({ kind: 'idea', id: i.id, title: i.title || 'Untitled idea', text, words, meta: formatWords(words) });
  });

  (Array.isArray(d.meetings) ? d.meetings : []).forEach(m => {
    if (!m || !m.id) return;
    const text = docText(m.description);
    docs.push({ kind: 'meeting', id: m.id, title: m.title || 'Untitled meeting', text, date: m.date || null, meta: meetingWhenLabel(m, todayKey) });
  });

  const cards = Array.isArray(opts.cardOrder) ? opts.cardOrder : orderCardsForMobile(d.sections);
  const live = new Map(cards.filter(s => s && s.id).map(s => [s.id, s]));
  const noteDoc = (note, section, extra) => {
    const html = note.content || '';
    const text = docText(html);
    const checklist = checklistProgress(html);
    const at = Number(note.updatedAt || note.createdAt) || 0;
    const parts = [];
    if (at) parts.push(relativeTime(at, now, { short: true }));
    if (checklist.total) parts.push(`${checklist.done}/${checklist.total}`);
    return {
      kind: 'note',
      id: extra.subtaskNoteId ? `${extra.subtaskNoteId}#${note.key}` : `${section.id}#${note.key}`,
      noteKey: note.key,
      sectionId: section.id,
      cardTitle: cardTitle(d, section),
      title: note.title || 'Untitled',
      text,
      pinned: !!note.pinned,
      updatedAt: at || null,
      checklist,
      legacy: !!note.legacy,
      meta: parts.join(' · '),
      ...extra,
    };
  };

  // Card notes, card by card in reading order (deleted cards' notes are dropped)
  const cardNotes = d.cardNotes && typeof d.cardNotes === 'object' ? d.cardNotes : {};
  cards.forEach(section => {
    if (!section || !section.id) return;
    sortNotes(notesArray(cardNotes[section.id], section.id)).forEach(note => {
      docs.push(noteDoc(note, section, { location: cardTitle(d, section) }));
    });
  });

  // Subtask notes, after their card's own notes
  const subNotes = d.subtaskNotes && typeof d.subtaskNotes === 'object' ? d.subtaskNotes : {};
  const order = new Map(cards.map((s, i) => [s.id, i]));
  Object.keys(subNotes)
    .map(id => ({ id, ref: parseSubtaskNoteId(id) }))
    .filter(x => x.ref && live.has(x.ref.sectionId))
    .sort((a, b) => order.get(a.ref.sectionId) - order.get(b.ref.sectionId))
    .forEach(({ id, ref }) => {
      const section = live.get(ref.sectionId);
      const item = subtaskText(d, ref);
      const location = [cardTitle(d, section), ref.subtitle && ref.subtitle !== '_default' ? ref.subtitle : '', item].filter(Boolean).join(' › ');
      sortNotes(notesArray(subNotes[id], id)).forEach(note => {
        docs.push(noteDoc(note, section, { subtaskNoteId: id, location }));
      });
    });

  // Notes stay grouped by card: a card's subtask notes follow its card notes
  const kindRank = { project: 0, idea: 1, meeting: 2, note: 3 };
  return docs
    .map((doc, i) => ({ doc, i }))
    .sort((a, b) => {
      const k = kindRank[a.doc.kind] - kindRank[b.doc.kind];
      if (k) return k;
      if (a.doc.kind === 'note') {
        const c = (order.get(a.doc.sectionId) ?? 0) - (order.get(b.doc.sectionId) ?? 0);
        if (c) return c;
      }
      return a.i - b.i;
    })
    .map(x => x.doc);
}

export function countByKind(docs) {
  const counts = { all: 0, project: 0, idea: 0, meeting: 0, note: 0 };
  (docs || []).forEach(doc => { counts.all++; if (counts[doc.kind] != null) counts[doc.kind]++; });
  return counts;
}

// Notes grouped by card in the order they come: [{ sectionId, cardTitle, notes }]
export function groupNotesByCard(docs) {
  const groups = [];
  const byId = new Map();
  (docs || []).forEach(doc => {
    if (doc.kind !== 'note') return;
    let g = byId.get(doc.sectionId);
    if (!g) { g = { sectionId: doc.sectionId, cardTitle: doc.cardTitle, notes: [] }; byId.set(doc.sectionId, g); groups.push(g); }
    g.notes.push(doc);
  });
  return groups;
}

// --- Search ---------------------------------------------------------------------
export function foldText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Every word of the query in the title or the text (case and accents folded).
// opts: { kind?: 'all'|kind, sectionId? }
export function searchDocs(docs, query, opts = {}) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const kind = opts.kind && opts.kind !== 'all' ? opts.kind : null;
  return (docs || []).filter(doc => {
    if (kind && doc.kind !== kind) return false;
    if (opts.sectionId && doc.sectionId !== opts.sectionId) return false;
    if (!words.length) return true;
    const hay = foldText(`${doc.title}\n${doc.text}\n${doc.cardTitle || ''}`);
    return words.every(w => hay.includes(w));
  });
}

// ~90 characters of text around the first match (or the start)
export function matchSnippet(text, query, max = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const w = foldText(query).split(/\s+/).filter(Boolean)[0];
  if (!w) return plainSnippet(t, max);
  const at = foldText(t).indexOf(w);
  if (at < 0 || at < max / 2) return plainSnippet(t, max);
  const start = Math.max(0, at - Math.round(max / 3));
  return '…' + plainSnippet(t.slice(start), max - 1);
}

// --- Recent docs and drafts (per browser) -----------------------------------------
// { kind, id, sectionId?, noteKey?, at }; the same doc only once, newest first
export function recentKey(entry) {
  return entry ? `${entry.kind}:${entry.id}` : '';
}

export function mergeRecent(list, entry, max = RECENT_MAX) {
  const prev = Array.isArray(list) ? list.filter(e => e && e.kind && e.id) : [];
  if (!entry || !entry.kind || !entry.id) return prev.slice(0, max);
  const key = recentKey(entry);
  const next = [{ ...entry, at: Number.isFinite(entry.at) ? entry.at : Date.now() }, ...prev.filter(e => recentKey(e) !== key)];
  return next.slice(0, max);
}

// Recent entries that still exist, as docs (at most n)
export function recentDocs(recent, docs, n = 5) {
  const byKey = new Map((docs || []).map(doc => [`${doc.kind}:${doc.id}`, doc]));
  const out = [];
  (Array.isArray(recent) ? recent : []).forEach(e => {
    const doc = byKey.get(recentKey(e));
    if (doc && out.length < n && !out.includes(doc)) out.push(doc);
  });
  return out;
}

// A draft: { surface, docId, sectionId?, noteKey?, title, html, at }
export function draftKey(d) {
  return d ? `${d.surface}|${d.docId || 'new'}|${d.sectionId || ''}` : '';
}

// Newest first, one per doc, at most `max`
export function pushDraft(drafts, draft, max = DRAFTS_MAX) {
  const prev = Array.isArray(drafts) ? drafts.filter(d => d && d.surface) : [];
  if (!draft || !draft.surface) return prev.slice(0, max);
  const key = draftKey(draft);
  const entry = { ...draft, at: Number.isFinite(draft.at) ? draft.at : Date.now() };
  return [entry, ...prev.filter(d => draftKey(d) !== key)]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, max);
}

export function dropDraft(drafts, match) {
  const prev = Array.isArray(drafts) ? drafts : [];
  const key = draftKey(match);
  return prev.filter(d => draftKey(d) !== key);
}

// The draft kept for one doc (or null)
export function draftFor(drafts, surface, docId, sectionId) {
  const key = draftKey({ surface, docId: docId || 'new', sectionId });
  return (Array.isArray(drafts) ? drafts : []).find(d => d && draftKey(d) === key) || null;
}

// Drafts of docs that were never saved (offered at the top of the Write tab)
export function unsavedDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).filter(d => d && (!d.docId || d.docId === 'new'));
}

// Is a draft worth offering back over what is stored now?
export function draftDiffers(draft, saved) {
  if (!draft) return false;
  const norm = (h) => String(h || '').replace(/\s+/g, ' ').trim();
  return norm(draft.html) !== norm(saved && saved.html) || String(draft.title || '').trim() !== String((saved && saved.title) || '').trim();
}

// '10:42' (24 h, local) for "Unsaved text from 10:42"
export function clockLabel(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
