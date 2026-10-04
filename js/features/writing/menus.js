// Personal Dashboard - Writing menus: the / slash menu, @ dates, [[ links to
// projects / meetings / ideas and : emoji. All four are caret-anchored lists
// (ui.createCaretList) the editor keeps typing into: the editor keeps focus,
// keys reach the list through a keydown hook, rows are picked with Enter /
// Tab / a click, Esc closes the list and leaves the text as typed.
// Also the commands behind them: date, time, emoji (picker popover), docRef,
// image (file picker into the existing image upload).
//
// One trigger is live at a time (the "session"). It is remembered as its line
// (block) and the text offset of its first character in that line, so the
// query is always re-read from the live text: typing, Backspace, undo and IME
// all just work. The list closes when the caret leaves the query, on blur, or
// by each list's own rules (see update()).
//
// In editors that have the @ task list (projects, meetings, card notes) the
// dates live inside that list (projects.js, via mentionDateItems /
// insertDateChipAt below); the others get a dates-only @ list here.

import { slashItemsFor, WRITING_GROUPS, formatKeysText } from '../../core/writing-commands.js';
import { parseQuickCapture, toDateKey } from '../../core/quick-capture-parse.js';
import { templatesFor } from '../../core/writing-templates.js';
import * as dom from './dom.js';
import * as ui from './ui.js';
import {
  dateChipHtml, dateChipLabel, dateLongLabel, relativeDay, isDateKey,
  refChipHtml, refTitle, listRefDocs, REF_TYPES, CHIP_ICONS, noteDateKeysIn, insertChip, lineRangeAt
} from './refs.js';

let API = null;
const SPACE = /[\s\u00A0\u200B\uFEFF]/;
const MAX_TEXT = 100000;

// --- Text positions inside a line -----------------------------------------------
// Offsets count text-node characters exactly like Range.toString() (what
// dom.textBeforeCaret returns), chips included.
function pointAt(block, offset) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length;
    if (offset < pos + len) return { node: n, offset: offset - pos };
    pos += len;
  }
  return null;
}

function lineOf(range, editor) {
  return dom.blockOf(range.startContainer, editor) || editor;
}

function inLockedNode(node, editor) {
  return !!dom.closestIn(node, '[contenteditable="false"]', editor);
}

// Replace range with an inline chip and a space after it (refs.insertChip)
function insertChipOver(editor, range, html) {
  const ok = insertChip(editor, range, html);
  noteDateKeysIn(editor);
  return ok;
}

// --- Dates (quick-capture rules: today, tmr, fri, next fri, 3d, eow, 21/12, Dec 21…) ---
// The whole text must be one date phrase ("by fri" or "fri 3pm" are not)
function parseDateQuery(text, now = new Date()) {
  const t = String(text || '').trim();
  if (!t || t.length > 32) return null;
  const r = parseQuickCapture(t, { now });
  if (!r.dueDate || !r.dateSpan || r.hasErrors) return null;
  if (r.dateSpan.start !== 0 || r.dateSpan.end !== t.length) return null;
  return r.dueDate;
}

// Phrases offered while typing (label, what the parser reads)
const DATE_WORDS = [
  ['Today', 'today'], ['Tomorrow', 'tomorrow'],
  ['Monday', 'mon'], ['Tuesday', 'tue'], ['Wednesday', 'wed'], ['Thursday', 'thu'], ['Friday', 'fri'], ['Saturday', 'sat'], ['Sunday', 'sun'],
  ['Next Monday', 'next mon'], ['Next Tuesday', 'next tue'], ['Next Wednesday', 'next wed'], ['Next Thursday', 'next thu'],
  ['Next Friday', 'next fri'], ['Next Saturday', 'next sat'], ['Next Sunday', 'next sun'],
  ['End of week', 'eow'], ['End of month', 'eom'], ['In 1 week', '1w'], ['In 2 weeks', '2w']
];
const DATE_DEFAULTS = ['Today', 'Tomorrow', 'End of week', 'Monday', 'End of month'];

// [{ key, label, hint }]: the exact date first, then phrases starting with the query
export function dateSuggestions(query, opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit || 6;
  const raw = String(query || '');
  const q = raw.toLowerCase().replace(/\s+/g, ' ').replace(/^ /, '');
  const out = [];
  const seen = new Set();
  const add = (key, label, hint) => {
    if (!key || seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push({ key, label, hint });
  };
  const word = ([label, parse]) => {
    const key = parseDateQuery(parse, now);
    add(key, label, key ? dateChipLabel(key, now) : '');
  };
  if (!q) {
    if (opts.defaults) DATE_DEFAULTS.forEach(name => word(DATE_WORDS.find(w => w[0] === name)));
    return out;
  }
  // "@today " with a space: the user moved on, unless a longer phrase continues ("next ")
  if (!/\s$/.test(raw)) {
    const key = parseDateQuery(raw, now);
    // A phrase from the list ("tomorrow", "fri") keeps its row ("Tomorrow · Mon, Oct 5"), so the row
    // doesn't change as the word is finished; anything else reads "Monday, December 21 · in 3 months"
    const w = key && DATE_WORDS.find(([label, parse]) => (label.toLowerCase() === q || parse === q) && parseDateQuery(parse, now) === key);
    if (w) add(key, w[0], dateChipLabel(key, now));
    else if (key) add(key, dateLongLabel(key, { now }), relativeDay(key, now));
  }
  if (opts.prefixes !== false) {
    DATE_WORDS.forEach(w => {
      const phrase = w[0].toLowerCase();
      if (phrase.startsWith(q) && phrase !== q.trim()) word(w);
    });
  }
  return out;
}

// For the @ task list (projects.js): a Date row when the query reads as a date
// (labelled exactly like the same query's first row in the @ dates list)
export function mentionDateItems(query) {
  if (/\s$/.test(String(query || ''))) return [];
  return dateSuggestions(query, { prefixes: false, limit: 1 });
}

// One date row, the same for the @ dates list here and the @ task list's Date
// section (projects.js): icon tile, label, the date or "in 3 days" on the right
function dateRowItem(d) {
  return { id: 'date', key: d.key, dateKey: d.key, label: d.label, hint: d.hint, icon: 'date' };
}
// The row as an element (.wr-menu-item, styled by .wr-date-menu's rules in writing.css section 6)
export function dateRowElement(d, className = '') {
  const row = document.createElement('div');
  row.className = 'wr-menu-item' + (className ? ' ' + className : '');
  row.setAttribute('role', 'option');
  row.dataset.date = d.key;
  row.innerHTML = ui.menuRowHtml(dateRowItem(d));
  return row;
}

// Replace "@query" (node[start, end)) with a date chip, undoably
export function insertDateChipAt(editor, node, start, end, key) {
  if (!editor || !node || !node.isConnected || node.nodeType !== 3 || !isDateKey(key)) return false;
  const r = document.createRange();
  try {
    r.setStart(node, start);
    r.setEnd(node, Math.min(end, node.data.length));
  } catch { return false; }
  if (r.toString().charAt(0) !== '@') return false;
  return insertChipOver(editor, r, dateChipHtml(key));
}

// --- Recent slash picks (per browser) -----------------------------------------------
const RECENT_KEY = 'dashboard_writing_recent';
const RECENT_MAX = 5;

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter(id => typeof id === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function pushRecent(id) {
  const list = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private window */ }
}

// --- Slash items --------------------------------------------------------------------
// Sections of the unfiltered list (registry ids; anything new lands in its registry group)
const SLASH_SECTIONS = [
  ['Text', ['paragraph', 'heading1', 'heading2', 'heading3']],
  ['Lists', ['bulletList', 'numberedList', 'checklist']],
  ['Blocks', ['quote', 'callout', 'calloutTip', 'calloutDecision', 'calloutWarning', 'calloutCaution', 'toggle', 'codeBlock', 'table', 'divider']],
  ['Insert', ['link', 'date', 'time', 'emoji', 'mention', 'docRef', 'image', 'makeTask', 'addSubtask']],
  ['Templates', ['template']],
  ['Actions', ['clearFormat', 'duplicate']],
  ['Document', ['find', 'replace', 'outline', 'focus', 'exportMd', 'exportPdf', 'copyMd', 'copyRich', 'help']]
];
const SECTION_ORDER = new Map();
SLASH_SECTIONS.forEach(([, ids], s) => ids.forEach((id, i) => SECTION_ORDER.set(id, s * 100 + i)));

// Commands that only make sense with a document feature on (same gates as the toolbar)
const FEATURE_OF = {
  outline: 'outline', template: 'templates', find: 'find', replace: 'find', focus: 'focus',
  docRef: 'docRefs', exportMd: 'export', exportPdf: 'export', copyMd: 'export', copyRich: 'export'
};

function slashCommands(ctx) {
  const st = API.stateOf(ctx.editor);
  if (!st) return [];
  return slashItemsFor(st.opts.tier, st.opts.id).filter(cmd => {
    if (!API.hasCommand(cmd.id)) return false; // not built (yet): hidden
    const feature = FEATURE_OF[cmd.id];
    if (feature && !st.features[feature]) return false;
    // Turn into task works on the line from the slash menu (no selection needed)
    if (cmd.id === 'makeTask') return typeof st.opts.makeTask === 'function';
    return API.isAvailable(cmd.id, ctx);
  });
}

function rowHint(cmd) {
  if (cmd.keys && cmd.keys.length) return { kbd: API.registry.formatKeys(cmd.keys[0], API.registry.isMac) };
  if (cmd.markdown && !cmd.markdown.startsWith('(')) return { hint: cmd.markdown.trim() };
  return {};
}

function slashRow(cmd, extra = {}) {
  return { id: cmd.id, key: cmd.id + (extra.keySuffix || ''), label: cmd.label, icon: cmd.icon || 'text', ...rowHint(cmd), ...extra };
}

// 0 exact name · 1 a name starts with it · 2 a word starts with it (or every
// word of a multi-word query does) · 3 contains · -1 no match
function scoreNames(names, q) {
  if (names.some(n => n === q)) return 0;
  if (names.some(n => n.startsWith(q))) return 1;
  const words = names.flatMap(n => n.split(/[^a-z0-9#+?]+/)).filter(Boolean);
  if (words.some(w => w.startsWith(q))) return 2;
  const parts = q.split(' ').filter(Boolean);
  if (parts.length > 1 && parts.every(p => words.some(w => w.startsWith(p)))) return 2;
  if (q.length >= 2 && names.some(n => n.includes(q))) return 3;
  return -1;
}

function commandNames(cmd, editorId) {
  const names = [cmd.label.toLowerCase().replace(/…/g, ''), ...(cmd.slash || []).map(s => s.toLowerCase())];
  if (cmd.id === 'template') templatesFor(editorId).forEach(t => names.push(t.name.toLowerCase()));
  return names;
}

function slashMenuItems(query, sess) {
  const cmds = sess.cmds;
  const recent = readRecent();
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) {
    const items = [];
    recent.map(id => cmds.find(c => c.id === id)).filter(Boolean)
      .forEach(c => items.push(slashRow(c, { group: 'Recent', keySuffix: ':recent' })));
    const placed = new Set();
    SLASH_SECTIONS.forEach(([group, ids]) => ids.forEach(id => {
      const c = cmds.find(x => x.id === id);
      if (c) { items.push(slashRow(c, { group })); placed.add(id); }
    }));
    WRITING_GROUPS.forEach(g => cmds.filter(c => !placed.has(c.id) && c.group === g.id)
      .forEach(c => items.push(slashRow(c, { group: g.label }))));
    return items;
  }
  const editorId = sess.editorId;
  const found = [];
  cmds.forEach(c => {
    const s = scoreNames(commandNames(c, editorId), q);
    if (s < 0) return;
    const extra = {};
    // Found by a template's name ("/meeting notes"): say which ones it offers
    if (c.id === 'template' && scoreNames(commandNames({ ...c, id: '' }, editorId), q) < 0) {
      const names = templatesFor(editorId).map(t => t.name);
      if (names.length) extra.description = names.join(', ');
    }
    found.push({ c, s, extra });
  });
  // "/table 3x4": columns × rows (Word's grid picker reads the same way)
  const size = /^(\S+?)\s*(\d{1,2})\s*[x×*]\s*(\d{1,2})$/i.exec(q);
  const table = cmds.find(c => c.id === 'table');
  if (size && table && scoreNames(commandNames(table, editorId), size[1]) >= 0 && scoreNames(commandNames(table, editorId), size[1]) <= 2) {
    const cols = Math.max(1, Math.min(10, +size[2]));
    const rows = Math.max(1, Math.min(30, +size[3]));
    found.push({ c: table, s: -1, extra: { arg: { cols, rows }, label: `Table ${cols} × ${rows}`, description: `${cols} column${cols > 1 ? 's' : ''} × ${rows} row${rows > 1 ? 's' : ''}`, keySuffix: `:${cols}x${rows}` } });
  }
  // "/code python": a code block in that language
  const lang = /^(\S+)\s+([a-z][\w#+.-]{0,14})$/i.exec(q);
  const code = cmds.find(c => c.id === 'codeBlock');
  if (lang && code && scoreNames(commandNames(code, editorId), q) < 0) {
    const s = scoreNames(commandNames(code, editorId), lang[1]);
    if (s >= 0 && s <= 2) found.push({ c: code, s: -1, extra: { arg: { lang: lang[2].toLowerCase() }, description: `Language: ${lang[2].toLowerCase()}`, keySuffix: `:${lang[2]}` } });
  }
  // "/tomorrow", "/fri", "/date 21/12": that date's chip (instead of today's)
  const date = cmds.find(c => c.id === 'date');
  if (date) {
    const m = /^(?:date|day)\s+(.+)$/.exec(q);
    const key = parseDateQuery(m ? m[1] : q);
    if (key) {
      for (let i = found.length - 1; i >= 0; i--) if (found[i].c.id === 'date') found.splice(i, 1);
      found.push({ c: date, s: -2, extra: { arg: { dateKey: key }, label: dateLongLabel(key), hint: relativeDay(key), keySuffix: `:${key}` } });
    }
  }
  const rank = (id) => { const i = recent.indexOf(id); return i < 0 ? 99 : i; };
  found.sort((a, b) => a.s - b.s || rank(a.c.id) - rank(b.c.id) ||
    (SECTION_ORDER.get(a.c.id) ?? 9999) - (SECTION_ORDER.get(b.c.id) ?? 9999));
  return found.map(({ c, extra }) => slashRow(c, extra));
}

// --- [[ items -------------------------------------------------------------------------
const SELF_TYPE = { projects: 'project', meetings: 'meeting', ideas: 'idea' };

// Recurring meetings are stored as type 'routine' (meetings.js)
function meetingHint(m) {
  if (m.type === 'routine' || m.type === 'recurring') return 'Recurring';
  return isDateKey(m.date) ? dateChipLabel(m.date) : '';
}

function refItems(query, sess) {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const st = API.stateOf(sess.editor);
  const selfType = st ? SELF_TYPE[st.opts.id] : null;
  let selfId = null;
  try { selfId = st && st.opts.getDocId ? st.opts.getDocId() : null; } catch { selfId = null; }
  const per = q ? 8 : 5;
  const items = [];
  Object.keys(REF_TYPES).forEach(type => {
    const scored = [];
    listRefDocs(type).forEach((doc, i) => {
      if (type === selfType && doc.id === selfId) return; // not a link to itself
      const title = refTitle(type, doc);
      const s = q ? scoreNames([title.toLowerCase()], q) : 0;
      if (s >= 0) scored.push({ doc, title, s, i });
    });
    scored.sort((a, b) => a.s - b.s || a.i - b.i);
    scored.slice(0, per).forEach(({ doc, title }) => {
      items.push({
        id: 'ref', key: `${type}:${doc.id}`, type, refId: doc.id, title, label: title,
        group: REF_TYPES[type].plural, iconHtml: CHIP_ICONS[type], className: `wr-ref-row is-${type}`,
        hint: type === 'meeting' ? meetingHint(doc) : ''
      });
    });
  });
  return items;
}

// --- : emoji --------------------------------------------------------------------------
// The emoji-picker-element database (the same IndexedDB the picker uses),
// loaded on first use. Until it is ready, or offline, a short built-in list.
const EMOJI_DB_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/database.js';
const EMOJI_MAX = 8;
const EMOJI_FALLBACK = [
  ['😀', 'grinning face', 'grinning'], ['😃', 'grinning face with big eyes', 'smiley'], ['😄', 'grinning face with smiling eyes', 'smile'],
  ['😁', 'beaming face with smiling eyes', 'grin'], ['😆', 'grinning squinting face', 'laughing'], ['😅', 'grinning face with sweat', 'sweat_smile'],
  ['😂', 'face with tears of joy', 'joy'], ['🙂', 'slightly smiling face', 'slightly_smiling_face'], ['😉', 'winking face', 'wink'],
  ['😊', 'smiling face with smiling eyes', 'blush'], ['😍', 'smiling face with heart-eyes', 'heart_eyes'], ['😎', 'smiling face with sunglasses', 'sunglasses'],
  ['🤔', 'thinking face', 'thinking'], ['😐', 'neutral face', 'neutral_face'], ['🙄', 'face with rolling eyes', 'roll_eyes'],
  ['😴', 'sleeping face', 'sleeping'], ['😢', 'crying face', 'cry'], ['😭', 'loudly crying face', 'sob'], ['😡', 'enraged face', 'rage'],
  ['😱', 'face screaming in fear', 'scream'], ['🤯', 'exploding head', 'exploding_head'], ['🥳', 'partying face', 'partying_face'],
  ['🙏', 'folded hands', 'pray'], ['👍', 'thumbs up', 'thumbsup', '+1'], ['👎', 'thumbs down', 'thumbsdown', '-1'], ['👏', 'clapping hands', 'clap'],
  ['🙌', 'raising hands', 'raised_hands'], ['👋', 'waving hand', 'wave'], ['💪', 'flexed biceps', 'muscle'], ['👀', 'eyes', 'eyes'],
  ['👉', 'backhand index pointing right', 'point_right'], ['👈', 'backhand index pointing left', 'point_left'],
  ['✅', 'check mark button', 'white_check_mark'], ['✔️', 'check mark', 'heavy_check_mark'], ['❌', 'cross mark', 'x'],
  ['⚠️', 'warning', 'warning'], ['❗', 'red exclamation mark', 'exclamation'], ['❓', 'red question mark', 'question'],
  ['💡', 'light bulb', 'bulb'], ['🔥', 'fire', 'fire'], ['⭐', 'star', 'star'], ['✨', 'sparkles', 'sparkles'], ['🎉', 'party popper', 'tada'],
  ['🚀', 'rocket', 'rocket'], ['📌', 'pushpin', 'pushpin'], ['📎', 'paperclip', 'paperclip'], ['📅', 'calendar', 'date'],
  ['🗓️', 'spiral calendar', 'spiral_calendar'], ['⏰', 'alarm clock', 'alarm_clock'], ['⏳', 'hourglass not done', 'hourglass'],
  ['📝', 'memo', 'memo'], ['📊', 'bar chart', 'bar_chart'], ['📈', 'chart increasing', 'chart_with_upwards_trend'],
  ['📉', 'chart decreasing', 'chart_with_downwards_trend'], ['💰', 'money bag', 'moneybag'], ['💼', 'briefcase', 'briefcase'],
  ['📧', 'e-mail', 'email'], ['📞', 'telephone receiver', 'telephone_receiver'], ['💬', 'speech balloon', 'speech_balloon'],
  ['🔗', 'link', 'link'], ['🔒', 'locked', 'lock'], ['🔑', 'key', 'key'], ['🛠️', 'hammer and wrench', 'hammer_and_wrench'],
  ['⚙️', 'gear', 'gear'], ['🐛', 'bug', 'bug'], ['🎯', 'bullseye', 'dart'], ['🏆', 'trophy', 'trophy'], ['📣', 'megaphone', 'mega'],
  ['🔔', 'bell', 'bell'], ['❤️', 'red heart', 'heart'], ['💙', 'blue heart', 'blue_heart'], ['💚', 'green heart', 'green_heart'],
  ['☕', 'hot beverage', 'coffee'], ['🍕', 'pizza', 'pizza'], ['🎂', 'birthday cake', 'birthday'], ['☀️', 'sun', 'sunny'],
  ['🌧️', 'cloud with rain', 'cloud_with_rain'], ['❄️', 'snowflake', 'snowflake'], ['🌍', 'globe showing Europe-Africa', 'earth_africa']
].map(([unicode, name, ...codes]) => ({ unicode, name, codes }));

let emojiDb = null;
let emojiDbLoading = null;
let emojiDbFailed = false;

function loadEmojiDb() {
  if (emojiDb || emojiDbFailed) return Promise.resolve(emojiDb);
  if (emojiDbLoading) return emojiDbLoading;
  emojiDbLoading = import(EMOJI_DB_URL).then(async (mod) => {
    const Database = mod.default || mod.Database;
    const db = new Database();
    await db.ready();
    emojiDb = db;
    return db;
  }).catch((err) => {
    emojiDbFailed = true;
    console.warn('[writing] emoji search uses the built-in list:', err && err.message ? err.message : err);
    return null;
  });
  return emojiDbLoading;
}

// The shortcode to show: the shortest one the query starts, else the shortest
function emojiCode(q, codes) {
  const byLen = [...codes].sort((a, b) => a.length - b.length);
  return byLen.find(c => c.startsWith(q)) || byLen[0] || '';
}

// Lower is better: exact shortcode, shortcode prefix (shorter first), name
// prefix, word prefix, contains; -1 = no match
function emojiRank(q, codes, name) {
  if (codes.includes(q)) return 0;
  const pre = codes.filter(c => c.startsWith(q));
  if (pre.length) return 1 + Math.min(...pre.map(c => c.length)) / 100;
  if (name.startsWith(q)) return 2;
  if (name.split(/[\s-]+/).some(w => w.startsWith(q))) return 3;
  return codes.some(c => c.includes(q)) ? 4 : -1;
}

function fallbackEmoji(q) {
  return EMOJI_FALLBACK
    .map((e, i) => ({ e, i, r: emojiRank(q, e.codes, e.name.toLowerCase()) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, EMOJI_MAX)
    .map(({ e }) => ({ unicode: e.unicode, name: e.name, code: emojiCode(q, e.codes) }));
}

async function searchEmoji(q) {
  if (!emojiDb) return fallbackEmoji(q);
  let found = [];
  try { found = await emojiDb.getEmojiBySearchQuery(q.replace(/_/g, ' ')); } catch { found = []; }
  const list = (found || [])
    .filter(e => e && e.unicode && (!e.version || e.version <= 14))
    .map((e, i) => {
      const codes = (e.shortcodes || []).map(s => s.toLowerCase());
      return { e, i, codes, r: emojiRank(q, codes, (e.annotation || '').toLowerCase()) };
    })
    .sort((a, b) => (a.r < 0 ? 9 : a.r) - (b.r < 0 ? 9 : b.r) || a.i - b.i)
    .slice(0, EMOJI_MAX)
    .map(({ e, codes }) => ({ unicode: e.unicode, name: e.annotation || '', code: emojiCode(q, codes) }));
  return list.length ? list : fallbackEmoji(q);
}

// The emoji whose shortcode is exactly code, or null
async function exactEmoji(code) {
  if (emojiDb) {
    try {
      const e = await emojiDb.getEmojiByShortcode(code);
      if (e && e.unicode) return e.unicode;
    } catch { /* fall back to the built-in list */ }
  }
  const hit = EMOJI_FALLBACK.find(e => e.codes.includes(code));
  return hit ? hit.unicode : null;
}

function emojiRows(list) {
  return list.map(e => ({
    id: 'emoji', key: e.unicode, unicode: e.unicode, label: e.name || e.unicode,
    iconHtml: `<span class="wr-emoji-glyph">${dom.escapeHtml(e.unicode)}</span>`,
    hint: e.code ? `:${e.code}:` : '', className: 'wr-emoji-row'
  }));
}

// --- Sessions ----------------------------------------------------------------------------
const KIND_OPTS = {
  slash: { className: 'wr-slash-menu', emptyText: 'No matching commands', footer: ' ' },
  date: { className: 'wr-date-menu', footer: 'Also: fri · next mon · 3d · 2w · 21/12 · Dec 21' },
  refs: { className: 'wr-ref-menu', emptyText: 'No matching projects, meetings or ideas', footer: '↑↓ to move · Enter to link · Esc to close' },
  emoji: { className: 'wr-emoji-menu', footer: '↑↓ to move · Enter to insert · Esc to close' }
};
const TRIGGERS = { slash: '/', date: '@', refs: '[[', emoji: ':' };

const S = { kind: null, editor: null, block: null, offset: 0, trigger: '', list: null, query: null, sig: '', hit: 0, cmds: null, editorId: null, seq: 0 };
let dismissed = null; // { kind, editor, block, offset }: Esc'd, don't reopen for the same trigger
const lists = {};

// Screen readers: the editor keeps focus, the list's selected row is its
// active descendant (attributes on the editor element itself are never saved)
function syncAria() {
  const ed = S.editor;
  const el = S.list && S.list.el;
  if (!ed || !el || !S.list.isOpen()) return;
  if (!el.id) el.id = `wr-${S.kind}-list`;
  el.querySelectorAll('.wr-menu-item').forEach((row, i) => { row.id = `${el.id}-${i}`; });
  const row = el.querySelector('.wr-menu-item.is-selected');
  ed.setAttribute('aria-controls', el.id);
  if (row) ed.setAttribute('aria-activedescendant', row.id);
  else ed.removeAttribute('aria-activedescendant');
}

function clearAria(ed) {
  if (!ed) return;
  ed.removeAttribute('aria-controls');
  ed.removeAttribute('aria-activedescendant');
}

function resetSession() {
  clearAria(S.editor);
  Object.assign(S, { kind: null, editor: null, block: null, offset: 0, trigger: '', list: null, query: null, sig: '', hit: 0, cmds: null, editorId: null });
  S.seq++;
}

function listFor(kind) {
  if (lists[kind]) return lists[kind];
  const o = KIND_OPTS[kind];
  const list = ui.createCaretList({
    className: o.className,
    emptyText: o.emptyText,
    footer: o.footer,
    onPick: (item) => pick(kind, item),
    onClose: (reason) => {
      if (S.kind !== kind || S.list !== list) return; // we closed it ourselves
      if (reason === 'escape' || reason === 'outside') dismissed = { kind, editor: S.editor, block: S.block, offset: S.offset };
      resetSession();
    }
  });
  lists[kind] = list;
  return list;
}

function isDismissed(kind, editor, block, offset) {
  return !!dismissed && dismissed.kind === kind && dismissed.editor === editor && dismissed.block === block && dismissed.offset === offset;
}

function closeSession(reason = 'api') {
  const list = S.list;
  resetSession();
  if (list && list.isOpen()) list.close(reason);
  return false;
}

function openSession(kind, ctx, offset) {
  if (S.kind) closeSession('replace');
  const st = API.stateOf(ctx.editor);
  S.kind = kind;
  S.editor = ctx.editor;
  S.block = lineOf(ctx.range, ctx.editor);
  S.offset = offset;
  S.trigger = TRIGGERS[kind];
  S.list = listFor(kind);
  S.editorId = st ? st.opts.id : null;
  S.cmds = kind === 'slash' ? slashCommands(ctx) : null;
  dismissed = null;
  if (kind === 'emoji') loadEmojiDb().then(() => { if (S.kind === 'emoji') update(true); });
  update(true);
}

// The text typed after the trigger, or null when the caret left it
function readQuery() {
  const ed = S.editor;
  if (!ed || !ed.isConnected) return null;
  const range = dom.getSelectionRange(ed);
  if (!range || !range.collapsed) return null;
  if (lineOf(range, ed) !== S.block) return null;
  const text = dom.textBeforeCaret(range, ed, MAX_TEXT);
  const end = S.offset + S.trigger.length;
  if (text.length < end || text.slice(S.offset, end) !== S.trigger) return null;
  return text.slice(end);
}

function anchorRange() {
  const p = pointAt(S.block, S.offset);
  if (!p) return dom.getSelectionRange(S.editor);
  const r = document.createRange();
  r.setStart(p.node, p.offset);
  r.setEnd(p.node, Math.min(p.offset + 1, p.node.data.length));
  return r;
}

function render(items) {
  // Rows re-render when a label or hint changes too, not only the keys
  const sig = items.map(i => `${i.key || i.id}\u0001${i.label || ''}\u0001${i.hint || ''}`).join('|');
  if (S.list.isOpen()) {
    if (sig !== S.sig) S.list.update(items);
    else S.list.reposition(); // the query may have wrapped onto the next line
  } else {
    S.list.open(anchorRange(), items, S.editor);
    if (S.kind === 'slash') decorateSlashFooter(S.list);
  }
  S.sig = sig;
  syncAria();
}

// Re-read the query and refresh (or close) the list
function update(force = false) {
  if (!S.kind) return;
  const q = readQuery();
  if (q == null) { closeSession('caret'); return; }
  if (!force && q === S.query && S.list.isOpen()) return;
  S.query = q;
  switch (S.kind) {
    case 'slash': {
      // "/ " is a slash in a sentence; two spaces end it; so does a long run of no matches
      if (/^\s/.test(q) || /\s\s/.test(q) || q.length > 40) { closeSession('nomatch'); return; }
      const items = slashMenuItems(q, S);
      if (items.length) S.hit = q.length;
      else if (/\s$/.test(q) || q.length >= S.hit + 4) { closeSession('nomatch'); return; }
      render(items);
      return;
    }
    case 'date': {
      if (q.length > 24 || /^\s/.test(q)) { closeSession('nomatch'); return; }
      const items = dateSuggestions(q, { defaults: true }).map(dateRowItem);
      if (!items.length) { closeSession('nomatch'); return; }
      render(items);
      return;
    }
    case 'refs': {
      if (/[\]\n]/.test(q) || q.length > 60) { closeSession('nomatch'); return; }
      const items = refItems(q, S);
      if (items.length) S.hit = q.length;
      else if (q.length >= S.hit + 4) { closeSession('nomatch'); return; }
      render(items);
      return;
    }
    case 'emoji': {
      // ":thumbsup:" with its closing colon: that emoji straight away
      const closed = /^([a-z0-9_+-]*[a-z][a-z0-9_+-]*):$/i.exec(q);
      if (closed) {
        const seq = S.seq;
        exactEmoji(closed[1].toLowerCase()).then(unicode => {
          if (S.seq !== seq || S.kind !== 'emoji' || S.query !== q) return;
          if (unicode) pick('emoji', { unicode });
          else closeSession('nomatch');
        });
        return;
      }
      if (!/^[a-z0-9_+-]*[a-z][a-z0-9_+-]*$/i.test(q) || q.length < 2 || q.length > 30) { closeSession('nomatch'); return; }
      const seq = S.seq;
      const query = q.toLowerCase();
      searchEmoji(query).then(list => {
        if (S.seq !== seq || S.kind !== 'emoji' || S.query !== q) return;
        if (!list.length) { closeSession('nomatch'); return; }
        render(emojiRows(list));
      });
      return;
    }
    default:
  }
}

// --- Trigger detection (typed text) --------------------------------------------------
function refsEnabled(st) {
  return !!st && st.opts.tier === 'full' && !!st.features.docRefs;
}

function detect(ctx, data) {
  const range = ctx.range;
  if (!range || !range.collapsed || !ctx.editor) return;
  if (dom.isInCode(ctx.node, ctx.editor) || inLockedNode(ctx.node, ctx.editor)) return;
  const st = API.stateOf(ctx.editor);
  if (!st) return;
  const text = dom.textBeforeCaret(range, ctx.editor, MAX_TEXT);
  if (!text) return;
  const block = lineOf(range, ctx.editor);
  const last = data.charAt(data.length - 1);
  const i = text.length - 1;
  // "/" at the start of a line or after a space (not in "and/or", URLs, 21/12)
  if (last === '/' && text[i] === '/' && (i === 0 || SPACE.test(text[i - 1]))) {
    openSession('slash', ctx, i);
    return;
  }
  // "[[" (full editors)
  if (last === '[' && text.endsWith('[[') && !text.endsWith('[[[') && refsEnabled(st)) {
    openSession('refs', ctx, text.length - 2);
    return;
  }
  // "@date" where there is no @ task list
  if (!ctx.editor._taskMention) {
    const m = /(^|[\s\u00A0\u200B])@([^@\n]{0,24})$/.exec(text);
    if (m) {
      const at = m.index + m[1].length;
      if (last === '@') dismissed = null;
      if (!isDismissed('date', ctx.editor, block, at)) openSession('date', ctx, at);
      return;
    }
  }
  // ":sm" after a space (not 10:30 or :) )
  const em = /(^|[\s\u00A0\u200B(\[{"'“‘])(:)([a-z0-9_+-]{2,30})$/i.exec(text);
  if (em && /[a-z]/i.test(em[3])) {
    const at = em.index + em[1].length;
    if (!isDismissed('emoji', ctx.editor, block, at)) openSession('emoji', ctx, at);
  } else if (last === ':') {
    dismissed = null;
  }
}

// --- Picks --------------------------------------------------------------------------------
function snapshot() {
  return { kind: S.kind, editor: S.editor, block: S.block, offset: S.offset, trigger: S.trigger };
}

// Trigger + query (from the trigger to the caret) as a range
function triggerRange(sess) {
  const ed = sess.editor;
  if (!ed || !ed.isConnected) return null;
  API.ensureSelection(ed);
  const caret = dom.getSelectionRange(ed);
  const start = pointAt(sess.block, sess.offset);
  if (!caret || !start) return null;
  const r = document.createRange();
  try {
    r.setStart(start.node, start.offset);
    r.setEnd(caret.endContainer, caret.endOffset);
  } catch { return null; }
  if (r.collapsed || !r.toString().startsWith(sess.trigger)) return null;
  return r;
}

// Delete "/query" (one undo step) and leave the caret there
function deleteTrigger(sess) {
  const r = triggerRange(sess);
  if (!r) return false;
  dom.restoreRange(r, sess.editor);
  dom.exec('delete');
  return true;
}

function pick(kind, item) {
  const sess = snapshot();
  closeSession('pick');
  if (!sess.editor) return;
  switch (kind) {
    case 'slash': pickSlash(item, sess); break;
    case 'date': {
      const r = triggerRange(sess);
      if (r) insertChipOver(sess.editor, r, dateChipHtml(item.dateKey));
      break;
    }
    case 'refs': {
      const r = triggerRange(sess);
      if (r) insertChipOver(sess.editor, r, refChipHtml(item.type, item.refId, item.title));
      break;
    }
    case 'emoji': {
      const r = triggerRange(sess);
      if (!r) break;
      dom.restoreRange(r, sess.editor);
      dom.insertText(item.unicode);
      break;
    }
    default:
  }
}

function pickSlash(item, sess) {
  if (!deleteTrigger(sess)) return;
  const editor = sess.editor;
  if (item.id !== 'help') pushRecent(item.id);
  let ctx = API.context(editor);
  if (item.id === 'makeTask') {
    // Turn the current line into a task
    const r = ctx.node ? lineRangeAt(ctx.node, editor) : null;
    if (!r || !r.toString().replace(/[\s\u200B]+/g, '')) {
      API.toast('Write the task on this line first, then pick Turn into task');
      return;
    }
    dom.restoreRange(r, editor);
    ctx = API.context(editor);
  }
  API.runCommand(item.id, ctx, { source: 'slash', ...(item.arg || {}) });
}

// The slash footer: key hints, and "all commands" opens the reference
function decorateSlashFooter(list) {
  const foot = list.el && list.el.querySelector('.wr-menu-footer');
  if (!foot || foot.dataset.wrDone) return;
  foot.dataset.wrDone = '1';
  foot.textContent = '';
  const keys = document.createElement('span');
  keys.className = 'wr-slash-keys';
  keys.textContent = '↑↓ to move · Enter to pick · Esc to close';
  const help = document.createElement('span');
  help.className = 'wr-slash-help';
  help.setAttribute('role', 'button');
  const touch = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  help.textContent = touch ? 'All commands' : `${formatKeysText('Mod+Slash', API.registry.isMac)} all commands`;
  help.addEventListener('click', () => {
    if (S.kind !== 'slash') return;
    pick('slash', { id: 'help' });
  });
  foot.append(keys, help);
}

// --- Commands ---------------------------------------------------------------------------
function timeText(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// Insert html at the caret (replacing a selection), chip-style
function insertChipAtCaret(ctx, html) {
  const range = ctx.range;
  if (!range) return false;
  return insertChipOver(ctx.editor, range.cloneRange(), html);
}

// Open a session for text that was just inserted by a command (input hooks
// don't see our own edits)
function openAfterInsert(kind, editor, triggerLength) {
  const ctx = API.context(editor);
  if (!ctx.range) return;
  const text = dom.textBeforeCaret(ctx.range, editor, MAX_TEXT);
  openSession(kind, ctx, text.length - triggerLength);
}

let picker = null;      // the <emoji-picker> element, made on first use (init.js binds the FIRST one in the page)
let pickerPop = null;

function openEmojiPicker(ctx) {
  const editor = ctx.editor;
  if (!customElements.get('emoji-picker')) {
    // Not loaded (offline): type ':' and a name instead
    dom.insertText(':');
    API.toast('Type a name after the colon, like :smile');
    return true;
  }
  if (pickerPop && pickerPop.isOpen()) pickerPop.close('api');
  if (!picker) {
    picker = document.createElement('emoji-picker');
    picker.className = 'wr-emoji-picker';
  }
  const host = document.createElement('div');
  host.className = 'wr-emoji-pop-body';
  host.appendChild(picker);
  const onPick = (ev) => {
    const unicode = ev.detail && ev.detail.unicode;
    if (pickerPop) pickerPop.close('pick'); // puts the caret back
    if (unicode) dom.insertText(unicode);
  };
  picker.addEventListener('emoji-click', onPick);
  pickerPop = ui.openPopover({
    content: host,
    editor,
    className: 'wr-emoji-pop',
    placement: 'bottom-start',
    onClose: () => {
      picker.removeEventListener('emoji-click', onPick);
      if (picker.parentNode) picker.parentNode.removeChild(picker);
      pickerPop = null;
    }
  });
  // Focus its search box (not on touch screens: the keyboard would cover it)
  if (!window.matchMedia || !window.matchMedia('(hover: none)').matches) {
    const focusSearch = (tries) => {
      const input = picker.shadowRoot && picker.shadowRoot.querySelector('input');
      if (input) input.focus();
      else if (tries > 0) setTimeout(() => focusSearch(tries - 1), 80);
    };
    requestAnimationFrame(() => focusSearch(6));
  }
  return true;
}

// Image: a file picker that hands the files to the editor's paste upload
// (rich-text-images.js), exactly like pasting a screenshot. The input stays
// in the page until the dialog closes (a detached one can be garbage
// collected while the dialog is open, and then nothing is inserted).
let fileInput = null;

function pickImage(ctx) {
  const editor = ctx.editor;
  const saved = ctx.range ? ctx.range.cloneRange() : null;
  if (fileInput) fileInput.remove();
  const input = document.createElement('input');
  fileInput = input;
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.hidden = true;
  input.dataset.wrUi = '';
  const done = () => {
    input.remove();
    if (fileInput === input) fileInput = null;
  };
  input.addEventListener('cancel', done, { once: true });
  input.addEventListener('change', () => {
    const files = [...(input.files || [])].filter(f => f.type && f.type.startsWith('image/'));
    done();
    if (!files.length || !editor.isConnected) return;
    if (saved && editor.contains(saved.startContainer)) dom.restoreRange(saved, editor);
    else API.ensureSelection(editor);
    const data = new DataTransfer();
    files.forEach(f => data.items.add(f));
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, { once: true });
  document.body.appendChild(input);
  input.click();
  return true;
}

function registerCommands(api) {
  // Today's chip, or arg.dateKey's ("/tomorrow" in the slash menu)
  api.registerCommand('date', {
    run(ctx, arg) {
      if (!ctx.range) return false;
      const key = arg && isDateKey(arg.dateKey) ? arg.dateKey : toDateKey(new Date());
      insertChipAtCaret(ctx, dateChipHtml(key));
      return true;
    }
  });
  api.registerCommand('time', {
    run(ctx) {
      if (!ctx.range) return false;
      dom.insertText(timeText());
      return true;
    }
  });
  api.registerCommand('emoji', {
    run(ctx) {
      if (!ctx.range) return false;
      return openEmojiPicker(ctx);
    }
  });
  api.registerCommand('docRef', {
    run(ctx) {
      if (!ctx.range) return false;
      const before = dom.textBeforeCaret(ctx.range, ctx.editor, 1);
      dom.insertText((before && !SPACE.test(before) ? ' ' : '') + '[[');
      openAfterInsert('refs', ctx.editor, 2);
      return true;
    },
    isAvailable: (ctx) => refsEnabled(API.stateOf(ctx.editor))
  });
  api.registerCommand('image', {
    run: (ctx) => pickImage(ctx),
    isAvailable: (ctx) => !!(ctx.editor && ctx.editor._imageUploadAttached)
  });
}

// --- Install ---------------------------------------------------------------------------------
export function install(api) {
  API = api;
  registerCommands(api);

  // Typing: refresh the live list, or notice a new trigger
  api.hooks.input.push((e, ctx) => {
    if (!ctx.editor) return false;
    if (S.kind && S.editor !== ctx.editor) closeSession('editor');
    if (S.kind) {
      update();
      if (S.kind) return false;
    }
    if (e.inputType === 'insertText' && e.data) detect(ctx, e.data);
    return false; // never stop the input rules
  });
  api.hooks.composition.push((e, ctx) => {
    if (S.kind) update();
    else if (e.data && ctx.range) detect(ctx, e.data);
    return false;
  });

  // Keys while a list is open: arrows, Home / End, Enter / Tab pick
  api.hooks.keydown.push((e, ctx) => {
    if (!S.kind || !S.list || !S.list.isOpen() || ctx.editor !== S.editor) return false;
    // A shortcut (Ctrl+S, Ctrl+B...) ends the list and does its own thing.
    // Alt / Option alone types characters on some layouts (Mac dead keys): left alone
    if (e.ctrlKey || e.metaKey) {
      if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) closeSession('key');
      return false;
    }
    if (e.altKey) return false;
    switch (e.key) {
      case 'Enter':
      case 'Tab':
        if (e.key === 'Enter' && e.shiftKey) { closeSession('key'); return false; }
        if (!S.list.selectedItem()) { closeSession('key'); return false; }
        return S.list.handleKey(e) === true;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        const used = S.list.handleKey(e) === true;
        if (used) syncAria();
        return used;
      }
      default:
        return false;
    }
  });

  // Caret moved: still inside the query?
  api.hooks.selection.push((evt, ctx) => {
    if (!S.kind) return false;
    if (ctx.editor !== S.editor) closeSession('caret');
    else update();
    return false;
  });

  // New content in the editor (switching docs, restore...)
  api.hooks.load.push((editor) => { if (S.editor === editor) closeSession('load'); });

  // The editor lost focus (not to our own list, and not because the window did)
  document.addEventListener('focusout', (e) => {
    const ed = S.editor;
    if (!S.kind || !ed || !(e.target === ed || ed.contains(e.target))) return;
    const to = e.relatedTarget;
    if (to && (ed.contains(to) || ui.isWritingUi(to))) return;
    setTimeout(() => {
      if (S.editor === ed && document.hasFocus() && !ed.contains(document.activeElement)) closeSession('blur');
    }, 0);
  }, true);
}
