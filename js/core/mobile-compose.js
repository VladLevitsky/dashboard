// Personal Dashboard - Mobile composer rules (pure, Node-testable; unit F2)
// The phone's keyboard-docked composer (js/features/mobile/composer.js) reads
// one line with the SAME parser as the desktop quick capture bar
// (quick-capture-parse.js): the line is the single source of truth. The thumb
// tray never keeps a value of its own; a tray tap rewrites the line's tokens
// (setTokenField) and the line is parsed again, so the two can't disagree.
// Values the line leaves empty fall back to context defaults (the Tasks lens
// the composer was opened from, else the last commit), which the tray shows in
// a quieter "default" style.
//
// Also here: the plan the composer commits (buildComposerPlan, a pure mirror
// of quick-capture.js buildPlan incl. every "@ task" update-mode issue), the
// date chips, the @ task list order, the note card picker order, the inline
// preview text, Markdown → stored HTML for notes and ideas, and draft age.
// No DOM access; never mutates its inputs.

import { parseQuickCapture, matchCategory, normalizeUrl, fromDateKey, toDateKey } from './quick-capture-parse.js';
import { markdownToHtml, sanitizeRichHtml } from './markdown.js';
import { orderCardsForMobile, cardTitle } from './mobile-common.js';

export const KINDS = Object.freeze([
  Object.freeze({ id: 'task', label: 'Task' }),
  Object.freeze({ id: 'note', label: 'Note' }),
  Object.freeze({ id: 'idea', label: 'Idea' }),
  Object.freeze({ id: 'project', label: 'Project' }),
  Object.freeze({ id: 'meeting', label: 'Meeting' }),
]);
export const KIND_IDS = Object.freeze(KINDS.map(k => k.id));

export const COLOR_ORDER = Object.freeze(['red', 'orange', 'yellow', 'blue']);
// Short labels (the mobile Tasks lens names); the full TASK_COLOR_LABELS stay in aria-labels
export const COLOR_SHORT = Object.freeze({ red: 'Urgent & important', orange: 'Urgent', yellow: 'Important', blue: 'Later' });

export const DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRAIL = '[,.;:!?)"\'\\]]*';
const COLOR_TOKEN = new RegExp(`^!(r|red|o|orange|y|yellow|b|blue)${TRAIL}$`, 'i');
const PIN_TOKEN = new RegExp(`^!(priority|primary|nopriority|noprimary)${TRAIL}$`, 'i');
const TIMER_TOKEN = new RegExp(`^!timer${TRAIL}$`, 'i');
const NODATE_TOKEN = new RegExp(`^!nodate${TRAIL}$`, 'i');
const CATEGORY_TOKEN = /^!(category|cat):/i;
const QUOTE_CLOSE = /"[,.;!?)]*$/;

const asDate = (now) => (now instanceof Date && !isNaN(now) ? now : new Date(Number.isFinite(now) ? now : Date.now()));

// ============================================================
// TOKENS: cut whole words out of the line, add one at the end
// ============================================================

function words(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// Remove [start, end) ranges, then collapse the spaces they leave behind
function cut(text, ranges) {
  if (!ranges.length) return tidy(text);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  sorted.forEach(r => {
    if (r.start < pos) { pos = Math.max(pos, r.end); return; }
    out += text.slice(pos, r.start) + ' ';
    pos = r.end;
  });
  out += text.slice(pos);
  return tidy(out);
}

function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function rangesOf(text, test) {
  return words(text).filter(w => test.test(w.raw));
}

// !category:Name / !cat:"Two words" (a quoted value may run over several words)
function categoryRanges(text) {
  const list = words(text);
  const ranges = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (!CATEGORY_TOKEN.test(w.raw)) continue;
    const value = w.raw.slice(w.raw.indexOf(':') + 1);
    let end = w.end;
    if (value.startsWith('"')) {
      const rest = value.slice(1);
      let closed = rest.length > 0 && QUOTE_CLOSE.test(rest);
      while (!closed && i + 1 < list.length) {
        i++;
        end = list[i].end;
        closed = QUOTE_CLOSE.test(list[i].raw);
      }
    }
    ranges.push({ start: w.start, end });
  }
  return ranges;
}

// Every date phrase the parser reads (with a "by" / "due" right before it) and every !nodate
function stripDates(text, now, categories) {
  let out = cut(text, rangesOf(text, NODATE_TOKEN));
  for (let i = 0; i < 5; i++) {
    const parsed = parseQuickCapture(out, { now, categories });
    const span = parsed.dateSpan;
    if (!span) break;
    let start = span.start;
    const lead = /(^|\s)(by|due)\s+$/i.exec(out.slice(0, start));
    if (lead) start = lead.index + lead[1].length;
    out = cut(out, [{ start, end: span.end }]);
  }
  return out;
}

// The category a tray / list pick means: an object with an id (matched by id),
// else a name (matched exactly, case-insensitive, else taken as given)
function resolveCategory(value, categories) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    const byId = value.id != null ? categories.find(c => c.id === value.id) : null;
    if (byId) return byId;
    return String(value.name || '').trim() ? value : null;
  }
  const name = String(value).trim();
  if (!name) return null;
  return categories.find(c => String(c.name || '').trim().toLowerCase() === name.toLowerCase()) || { name };
}

/**
 * The !category:"…" token that the parser reads back as exactly this
 * category. A name holding a double quote can't be written inside the quotes,
 * so the longest quote-free piece of it that still matches only this category
 * (matchCategory: exact, starts-with, contains) is written instead.
 * → '!category:"Name"'
 */
export function categoryToken(category, categories = []) {
  const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const name = squash(category && category.name);
  const list = Array.isArray(categories) ? categories : [];
  const resolves = (q) => {
    const found = matchCategory(q, list);
    return !!found.category && (category.id != null ? found.category.id === category.id : found.category.name === category.name);
  };
  if (!name.includes('"') && (!list.length || resolves(name))) return `!category:"${name}"`;
  const pieces = new Set();
  String(category.name || '').split('"').forEach(part => {
    for (let i = 0; i < part.length; i++) {
      for (let j = part.length; j > i; j--) {
        const q = squash(part.slice(i, j));
        if (q) pieces.add(q);
      }
    }
  });
  const best = [...pieces].sort((a, b) => b.length - a.length).find(resolves);
  return `!category:"${best || squash(name.replace(/"/g, ''))}"`;
}

const append = (text, token) => (token ? tidy(text ? `${text} ${token}` : token) : tidy(text));

/**
 * Rewrite the line for a tray tap. The line stays the only truth: the field's
 * tokens are cut out and (when the tapped value differs from the default) one
 * token is appended. Tapping the value the line already sets removes it, so
 * the field falls back to its default.
 * field: 'color' (value 'red'|'orange'|'yellow'|'blue'|null)
 *        'pinned' (true|false|null)
 *        'date' ('today'|'tomorrow'|'tue'…|'next mon'|'YYYY-MM-DD'|null = No date)
 *        'timer' (toggles; value ignored)
 *        'category' (a category { id, name }, or a name; null removes)
 * opts: { now, categories, mode: 'create'|'update', defaults: { color, pinned } }
 * → { text, caret }
 */
export function setTokenField(text, field, value, opts = {}) {
  const now = asDate(opts.now);
  const categories = Array.isArray(opts.categories) ? opts.categories : [];
  const mode = opts.mode === 'update' ? 'update' : 'create';
  const defaults = opts.defaults || {};
  const src = String(text || '');
  const parsed = parseQuickCapture(src, { now, categories });
  let out = src;

  switch (field) {
    case 'color': {
      out = cut(src, rangesOf(src, COLOR_TOKEN));
      const same = value && parsed.color === value;
      if (value && !same && value !== defaults.color) out = append(out, `!${value}`);
      break;
    }
    case 'pinned': {
      out = cut(src, rangesOf(src, PIN_TOKEN));
      const v = value == null ? null : !!value;
      const same = v !== null && parsed.pinned === v;
      if (v !== null && !same && v !== !!defaults.pinned) out = append(out, v ? '!priority' : '!nopriority');
      break;
    }
    case 'date': {
      out = stripDates(src, now, categories);
      if (value == null) {
        const already = parsed.clearDate;
        if (mode === 'update' && !already) out = append(out, '!nodate');
      } else {
        const token = String(value).trim().toLowerCase();
        const key = parseQuickCapture(token, { now }).dueDate;
        if (key && key !== parsed.dueDate) out = append(out, token);
      }
      break;
    }
    case 'timer': {
      out = parsed.timer ? cut(src, rangesOf(src, TIMER_TOKEN)) : append(src, '!timer');
      break;
    }
    case 'category': {
      out = cut(src, categoryRanges(src));
      const cat = resolveCategory(value, categories);
      const same = cat && parsed.category && (cat.id != null
        ? parsed.category.id === cat.id
        : (parsed.category.name || '').trim().toLowerCase() === String(cat.name || '').trim().toLowerCase());
      if (cat && !same) out = append(out, categoryToken(cat, categories));
      break;
    }
    default:
      out = tidy(src);
  }
  out = tidy(out);
  return { text: out, caret: out.length };
}

// ============================================================
// DEFAULTS AND THE EFFECTIVE PLAN
// ============================================================

const isColor = (c) => COLOR_ORDER.includes(c);

// First colour in red → blue order that has open tasks in that segment
export function firstNonEmptyColor(tasks, segment = 'primary') {
  const wantPinned = segment !== 'secondary';
  const list = (Array.isArray(tasks) ? tasks : []).filter(t => t && !t.completed && !!t.pinned === wantPinned);
  return COLOR_ORDER.find(c => list.some(t => (isColor(t.color) ? t.color : 'blue') === c)) || null;
}

/**
 * Context defaults for the fields the line leaves empty.
 * from: the tab the composer opened from. lens: { segment, color } (the live
 * Tasks lens, or the stored one). last: the last commit { color, pinned }.
 * Opened from Tasks: pinned = Primary segment, colour = the lens colour (All:
 * the last colour, else the first non-empty colour of the segment, else blue).
 * From another tab: the last commit, else the lens read the same way.
 * → { color, pinned, source: 'lens'|'last' }
 */
export function composerDefaults({ from = 'tasks', lens = null, last = null, tasks = [] } = {}) {
  const fromLens = () => {
    const segment = lens && lens.segment === 'secondary' ? 'secondary' : 'primary';
    const lensColor = lens && isColor(lens.color) ? lens.color : 'all';
    const color = lensColor !== 'all' ? lensColor
      : ((last && isColor(last.color) ? last.color : null) || firstNonEmptyColor(tasks, segment) || 'blue');
    return { color, pinned: segment === 'primary', source: 'lens' };
  };
  if (from !== 'tasks' && last && isColor(last.color)) {
    return { color: last.color, pinned: !!last.pinned, source: 'last' };
  }
  return fromLens();
}

/**
 * Each field: the line's value, else (create mode) the default. In update mode
 * (an @ target) only the line counts. sources say where each value came from
 * ('line' | 'default' | null), which the tray shows as set / default styles.
 */
export function effectivePlan(parsed, defaults = {}, { mode = 'create' } = {}) {
  const p = parsed || {};
  const d = mode === 'update' ? {} : (defaults || {});
  const pick = (lineValue, def) => (lineValue != null
    ? { value: lineValue, source: 'line' }
    : def != null ? { value: def, source: 'default' } : { value: null, source: null });
  const color = pick(p.color || null, d.color || null);
  const pinned = pick(p.pinned == null ? null : p.pinned, d.pinned == null ? null : !!d.pinned);
  const category = pick(p.category || null, d.category || null);
  const dueDate = p.dueDate ? { value: p.dueDate, source: 'line' } : { value: null, source: p.clearDate ? 'line' : null };
  return {
    mode,
    color: color.value,
    pinned: pinned.value,
    category: category.value,
    dueDate: dueDate.value,
    clearDate: !!p.clearDate,
    timer: !!p.timer,
    sources: { color: color.source, pinned: pinned.source, category: category.source, date: dueDate.source, timer: p.timer ? 'line' : null },
  };
}

// Same reading as the task editor: taskLinks, else the legacy single link / file
export function linkListOf(task) {
  if (!task) return [];
  if (Array.isArray(task.taskLinks)) return task.taskLinks.map(l => ({ ...l }));
  if (task.link) return [{ type: 'url', value: task.link }];
  if (task.linkType === 'file' && task.fileId) return [{ type: 'file', fileId: task.fileId, fileName: task.fileName || '' }];
  return [];
}

const shortUrl = (url) => String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');

/**
 * The plan the composer commits: a pure mirror of quick-capture.js
 * buildPlan() (same messages), with the line as the only source and the
 * context defaults folded in (create mode only).
 * args: { text, targetId?, target? (the live task or null), defaults?, now?,
 *         categories?, blank?: { start, end } (an open @ / !category: list),
 *         runningTaskId? }
 * → { mode, target, parsed, category, urls, issues, hasErrors, effective }
 *   parsed.color / parsed.pinned carry the effective values in create mode, so
 *   createFromPlan(plan) (quick-capture.js) commits exactly what the tray shows.
 */
export function buildComposerPlan({ text = '', targetId = null, target = null, defaults = {}, now, categories = [], blank = null, runningTaskId = null } = {}) {
  const src = String(text || '');
  const parseText = blank && blank.end > blank.start
    ? src.slice(0, blank.start) + ' '.repeat(blank.end - blank.start) + src.slice(blank.end)
    : src;
  const parsed = parseQuickCapture(parseText, { now: asDate(now), categories });
  const issues = [...parsed.issues];
  const mode = targetId || target ? 'update' : 'create';
  const task = mode === 'update' ? target : null;
  let category = parsed.category || null;
  let urls = parsed.urls;

  if (mode === 'update') {
    if (!task) {
      issues.push({ level: 'error', message: 'That task was completed or deleted. Remove its chip and pick another' });
    } else {
      if (parsed.explicitTask) issues.push({ level: 'warning', message: '!task is ignored when you change an existing task' });
      const existing = new Set(linkListOf(task).filter(l => l.type === 'url').map(l => normalizeUrl(l.value) || l.value));
      const already = urls.filter(u => existing.has(u));
      if (already.length) issues.push({ level: 'warning', message: `Already linked: ${already.map(shortUrl).join(', ')}` });
      urls = urls.filter(u => !existing.has(u));
      const timerRunning = !!runningTaskId && runningTaskId === task.id;
      if (parsed.timer && timerRunning) issues.push({ level: 'warning', message: 'Its timer is already running' });
      const changes = parsed.title
        || (parsed.color && parsed.color !== task.color)
        || (parsed.pinned !== null && parsed.pinned !== !!task.pinned)
        || (parsed.timer && !timerRunning)
        || urls.length
        || (category && category.id !== task.categoryId)
        || (parsed.dueDate && parsed.dueDate !== task.dueDate)
        || (parsed.clearDate && !!task.dueDate);
      const asked = parsed.color || parsed.pinned !== null || parsed.timer || parsed.urls.length ||
        category || parsed.dueDate || parsed.clearDate;
      if (!changes) {
        issues.push(asked
          ? { level: 'error', message: 'The task already looks like that: nothing would change' }
          : { level: 'error', quiet: true, message: 'Add what to change: a date, a command, or text for a new subtask' });
      }
    }
  } else if (!parsed.title) {
    issues.push({ level: 'error', quiet: true, message: 'Type a name for the task' });
  }

  const effective = effectivePlan(parsed, defaults, { mode });
  if (mode === 'create') category = effective.category;
  const planParsed = mode === 'create'
    ? { ...parsed, color: effective.color || 'blue', pinned: effective.pinned === true }
    : { ...parsed };
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return { mode, target: task, parsed: planParsed, category, urls, issues, hasErrors: issues.some(i => i.level === 'error'), effective };
}

// ============================================================
// THE LINE (preview text) AND LABELS
// ============================================================

// 'YYYY-MM-DD' -> 'Fri, Oct 9' ('Today' / 'Tomorrow' when close; the year when not this year)
export function describeDate(key, now) {
  const date = fromDateKey(key);
  if (!date) return '';
  const today = asDate(now);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date - t0) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const base = `${WEEKDAY_SHORT[date.getDay()]}, ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === t0.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

// The tray's date chip: 'Today', 'Tomorrow', 'Fri 9', 'Oct 21', 'Oct 21, 2027'
export function trayDateLabel(key, now) {
  const date = fromDateKey(key);
  if (!date) return 'Date';
  const today = asDate(now);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date - t0) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}`;
  const base = `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === t0.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

const clip = (s, max) => { const t = String(s || '').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };

/**
 * What the line shows: the first error (blocks Add), else the first warning,
 * else the preview ("New task · Fri, Oct 9 · starts timer").
 * Quiet errors (no name yet) only turn red after an Add was tried.
 * → { level: 'error'|'warning'|'preview'|'hint', text }
 */
export function lineFor(plan, { now, attempted = false, typed = true, runningTitle = null } = {}) {
  if (!plan) return { level: 'hint', text: '' };
  const errors = plan.issues.filter(i => i.level === 'error');
  const loud = errors.find(i => !i.quiet) || (attempted ? errors[0] : null);
  if (loud) return { level: 'error', text: loud.message };
  const warning = plan.issues.find(i => i.level === 'warning');
  if (warning) return { level: 'warning', text: warning.message };
  if (!typed) {
    return plan.mode === 'update'
      ? { level: 'hint', text: 'Add a date, a command, or text for a new subtask' }
      : { level: 'hint', text: 'Type a task. Add fri, !red, !timer, or @ to change one' };
  }
  if (errors.length) return { level: 'hint', text: errors[0].message };
  const p = plan.parsed;
  const parts = [];
  if (plan.mode === 'update') {
    parts.push(`Change “${clip(plan.target && plan.target.title, 28) || 'Untitled'}”`);
    if (p.title) parts.push(`new subtask “${clip(p.title, 24)}”`);
    if (p.color && plan.target && p.color !== plan.target.color) parts.push(COLOR_SHORT[p.color]);
    if (p.pinned !== null && plan.target && p.pinned !== !!plan.target.pinned) parts.push(p.pinned ? 'Primary' : 'Secondary');
  } else {
    parts.push('New task');
  }
  if (p.dueDate) parts.push(describeDate(p.dueDate, now));
  else if (p.clearDate && plan.mode === 'update') parts.push('no due date');
  if (p.timer) parts.push(runningTitle ? `starts timer, stops “${clip(runningTitle, 18)}”` : 'starts timer');
  if (plan.urls && plan.urls.length) parts.push(plan.urls.length === 1 ? shortUrl(plan.urls[0]) : `${plan.urls.length} links`);
  if (plan.category) parts.push(`# ${plan.category.name}`);
  return { level: 'preview', text: parts.join(' · ') };
}

// ============================================================
// PICKERS: date chips, the @ task list, the !category: list
// ============================================================

/**
 * The date panel: Today, Tomorrow, the weekdays of the next 2-6 days, Next Mon.
 * (Pick… and No date are added by the panel.) Each chip carries the token a
 * tap writes into the line and the day it means (read by the parser itself).
 * → [{ id, label, sub, token, key }]
 */
export function dateChips(now) {
  const today = asDate(now);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = (n) => new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + n);
  const keyOf = (token) => parseQuickCapture(token, { now: today }).dueDate;
  const sub = (d) => `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`;
  const chips = [
    { id: 'today', label: 'Today', token: 'today', date: day(0) },
    { id: 'tomorrow', label: 'Tomorrow', token: 'tomorrow', date: day(1) },
  ];
  for (let n = 2; n <= 6; n++) {
    const d = day(n);
    const name = WEEKDAY_SHORT[d.getDay()];
    chips.push({ id: name.toLowerCase(), label: name, token: name.toLowerCase(), date: d });
  }
  chips.push({ id: 'next-mon', label: 'Next Mon', token: 'next mon', date: null });
  return chips.map(c => {
    const key = keyOf(c.token);
    const d = fromDateKey(key);
    return { id: c.id, label: c.label, sub: d ? sub(d) : '', token: c.token, key };
  });
}

/**
 * The @ list: open tasks whose title contains the query, red → blue, Primary
 * first, then their order. At most `limit` rows.
 */
export function matchTasks(tasks, query = '', limit = 4) {
  const q = String(query || '').replace(/^\s+/, '').toLowerCase();
  const rank = (c) => { const i = COLOR_ORDER.indexOf(c); return i === -1 ? COLOR_ORDER.length - 1 : i; };
  return (Array.isArray(tasks) ? tasks : [])
    .filter(t => t && !t.completed && (!q || String(t.title || '').toLowerCase().includes(q)))
    .sort((a, b) => rank(a.color) - rank(b.color)
      || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (a.order || 0) - (b.order || 0))
    .slice(0, Math.max(0, limit));
}

// Categories for a typed "!category:que": starts-with first, then contains
export function matchCategories(categories, query = '') {
  const list = Array.isArray(categories) ? categories : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...list];
  const name = (c) => String(c.name || '').toLowerCase();
  const starts = list.filter(c => name(c).startsWith(q));
  return [...starts, ...list.filter(c => !starts.includes(c) && name(c).includes(q))];
}

/**
 * Where the caret is: typing "@…" (start of a word) opens the task list,
 * "!category:…" / "!cat:…" the category list (the desktop bar's rule).
 * → { kind: 'task'|'category', start, end, query } | null
 */
export function detectPicker(value, caret, caretEnd = caret) {
  const text = String(value || '');
  if (caret == null || caret !== caretEnd) return null;
  const before = text.slice(0, caret);
  const end = caret + (/^\S*/.exec(text.slice(caret))[0].length);
  const category = /(^|\s)(!(?:category|cat):)"([^"]*)$/i.exec(before) || /(^|\s)(!(?:category|cat):)([^\s"]*)$/i.exec(before);
  if (category) return { kind: 'category', start: category.index + category[1].length, end, query: category[3] };
  const at = before.lastIndexOf('@');
  if (at !== -1 && (at === 0 || /\s/.test(before[at - 1]))) {
    const query = before.slice(at + 1);
    if (!/(^|\s)[!\\@]/.test(query) && query.length <= 80) return { kind: 'task', start: at, end, query };
  }
  return null;
}

// Cut [start, end) out of the line (a picked "@query"), leaving one space
export function removeRange(value, start, end) {
  const text = String(value || '');
  let before = text.slice(0, start);
  let after = text.slice(end);
  if (/\s$/.test(before) && /^\s/.test(after)) after = after.replace(/^\s+/, '');
  if (!before.trim()) { before = ''; after = after.replace(/^\s+/, ''); }
  return { text: before + after, caret: before.length };
}

// ============================================================
// OTHER KINDS: notes, ideas, meetings
// ============================================================

// Markdown typed in the body → the canonical, sanitized HTML notes and ideas store
export function bodyToHtml(md) {
  const src = String(md == null ? '' : md);
  if (!src.trim()) return '';
  return sanitizeRichHtml(markdownToHtml(src));
}

/**
 * Cards for the Note "in:" picker: the last used card first, then the
 * desktop reading order. → [{ id, title, count }]
 */
export function noteCardChoices(data, lastCardId = null) {
  const d = data || {};
  const notes = d.cardNotes || {};
  const count = (id) => (Array.isArray(notes[id]) ? notes[id].length : (typeof notes[id] === 'string' && notes[id].trim() ? 1 : 0));
  const cards = orderCardsForMobile(d.sections || []).map(s => ({ id: s.id, title: cardTitle(d, s), count: count(s.id) }));
  const i = cards.findIndex(c => c.id === lastCardId);
  if (i > 0) cards.unshift(cards.splice(i, 1)[0]);
  return cards;
}

// Default card for a new note: the last used one, else the first card in
// reading order that has notes, else the first card
export function defaultNoteCard(data, lastCardId = null) {
  const cards = noteCardChoices(data, null);
  if (lastCardId && cards.some(c => c.id === lastCardId)) return lastCardId;
  const withNotes = cards.find(c => c.count > 0);
  return withNotes ? withNotes.id : (cards[0] ? cards[0].id : null);
}

// A card note as the notepad stores it
export function makeNote({ title = '', html = '', now = Date.now(), rand = null } = {}) {
  const r = rand || Math.random().toString(36).slice(2, 11).padEnd(9, '0');
  return { key: `note_${now}_${r}`, title, content: html, createdAt: now, updatedAt: now };
}

// ============================================================
// DRAFTS
// ============================================================

// A kept draft comes back when it is under 24 h old and holds something
export function draftIsFresh(draft, now = Date.now()) {
  if (!draft || typeof draft !== 'object') return false;
  const at = Number(draft.at);
  if (!Number.isFinite(at)) return false;
  const age = asDate(now).getTime() - at;
  if (age < 0 || age >= DRAFT_MAX_AGE) return false;
  return !!(String(draft.text || '').trim() || String(draft.body || '').trim() || draft.targetTaskId);
}

export { toDateKey };
