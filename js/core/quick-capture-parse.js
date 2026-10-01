// Personal Dashboard - Quick Capture parser (pure rules, no DOM)
// Reads the one line typed into the quick capture bar, e.g.
//   "Send deck to Marc fri !red !timer"
// and says what it means: the leftover text (the task name, or a new subtask
// when an existing task is picked), a due date, a matrix color, Primary on/off,
// the timer, links and a category, plus any problems. Errors block saving
// (an unknown command, an impossible date); warnings don't (two colors: the
// last one wins). No imports, so Reference/quick-capture-test.mjs runs it in Node.
//
// Every recognized piece keeps its position in the text, so the bar can turn a
// false match back into plain text: a "\" before a word keeps it as text
// ("\fri", "\!red", "\@marc").
//
// Dates are day-first (21/12/26 is 21 December) and are built from the local
// calendar day, never through UTC.

// --- Commands: !name or !name:value (case-insensitive)
// Lookup tables have no prototype, so words like "constructor" or "toString"
// in a task name can't match a built-in Object property.
const table = (entries) => Object.freeze(Object.assign(Object.create(null), entries));

const COMMANDS = table({
  task: { kind: 'task' },
  red: { kind: 'color', color: 'red' },
  r: { kind: 'color', color: 'red' },
  orange: { kind: 'color', color: 'orange' },
  o: { kind: 'color', color: 'orange' },
  yellow: { kind: 'color', color: 'yellow' },
  y: { kind: 'color', color: 'yellow' },
  blue: { kind: 'color', color: 'blue' },
  b: { kind: 'color', color: 'blue' },
  priority: { kind: 'pin', value: true },
  primary: { kind: 'pin', value: true },
  nopriority: { kind: 'pin', value: false },
  noprimary: { kind: 'pin', value: false },
  timer: { kind: 'timer' },
  nodate: { kind: 'nodate' },
  url: { kind: 'url', needsValue: true },
  category: { kind: 'category', needsValue: true },
  cat: { kind: 'category', needsValue: true },
});

// Names offered in "Did you mean …?" (the one-letter colors would match anything)
const SUGGESTABLE = Object.keys(COMMANDS).filter(name => name.length >= 3);

// --- Date vocabulary
const WEEKDAYS = table({
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
});

const MONTHS = table({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
});

const DAY_WORD = /^(\d{1,2})(st|nd|rd|th)?$/;
const YEAR_WORD = /^\d{4}$/;
const TRAIL_PUNCT = /[,.;:!?)"'\]]+$/;
const LEAD_PUNCT = /^[("'[]+/;

// ============================================================
// DATE HELPERS (local calendar days)
// ============================================================

function makeDate(y, m, d) {
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfDay(date) {
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addDays(date, n) {
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate() + n);
}

function isRealDate(y, m, d) {
  const date = makeDate(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// This coming weekday: today when it already is that day
function weekdayDate(today, weekday) {
  return addDays(today, (weekday - today.getDay() + 7) % 7);
}

// 'YYYY-MM-DD' from local parts (what task.dueDate stores)
export function toDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? makeDate(+m[1], +m[2], +m[3]) : null;
}

// Day + month (+ optional year) → { date, past } | { error } | null (not a date at all)
function resolveDayMonth(today, d, m, y, label) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y != null) {
    if (y < 100) y += 2000;
    if (y < 1900 || y > 2199) return null;
    if (!isRealDate(y, m, d)) return { error: `${label} isn't a real date` };
    const date = makeDate(y, m, d);
    return { date, past: date < today };
  }
  // No year: the next time this day comes around (today counts). 29 Feb waits for a leap year.
  for (let year = today.getFullYear(); year <= today.getFullYear() + 8; year++) {
    if (!isRealDate(year, m, d)) continue;
    const date = makeDate(year, m, d);
    if (date >= today) return { date };
  }
  return { error: `${label} isn't a real date` };
}

// ============================================================
// TOKENS
// ============================================================

function tokenize(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const escaped = raw.length > 1 && raw[0] === '\\';
    const body = escaped ? raw.slice(1) : raw;
    const trimmed = body.replace(LEAD_PUNCT, '');
    const trailMatch = TRAIL_PUNCT.exec(trimmed);
    const core = trailMatch ? trimmed.slice(0, trailMatch.index) : trimmed;
    tokens.push({
      raw,                                // exactly as typed
      text: body,                         // without the escape backslash
      start: m.index,
      end: m.index + raw.length,
      escaped,
      word: core.toLowerCase(),           // for matching: no wrapping punctuation
      wordCase: core,
      trail: trailMatch ? trailMatch[0] : '',
    });
  }
  return tokens;
}

// ============================================================
// DATE PHRASES
// ============================================================

// Match a date phrase starting at token i. Returns null (not a date) or
// { length, date, past? } | { length, error }.
function matchDate(tokens, i, today) {
  const tok = (k) => tokens[i + k] || null;
  // Later words of a phrase can't be escaped (an escape ends the phrase)
  const word = (k) => {
    const t = tok(k);
    if (!t || (k > 0 && t.escaped)) return null;
    return t.word;
  };
  const trail = (k) => (tok(k) ? tok(k).trail : '');
  const t0 = word(0);
  if (!t0) return null;
  const one = (date) => ({ length: 1, date });
  const label = (n) => tokens.slice(i, i + n).map(t => t.text).join(' ').replace(TRAIL_PUNCT, '');

  if (t0 === 'today') return one(today);
  if (t0 === 'tomorrow' || t0 === 'tmr' || t0 === 'tmrw') return one(addDays(today, 1));
  if (t0 === 'eow') return one(weekdayDate(today, 5));
  if (t0 === 'eom') return one(makeDate(today.getFullYear(), today.getMonth() + 2, 0));

  // next fri: a week after this coming Friday
  if (t0 === 'next' && !trail(0) && WEEKDAYS[word(1)] !== undefined) {
    return { length: 2, date: addDays(weekdayDate(today, WEEKDAYS[word(1)]), 7) };
  }
  if (WEEKDAYS[t0] !== undefined) return one(weekdayDate(today, WEEKDAYS[t0]));

  // in 3 days · in 2 weeks · in 3d
  if (t0 === 'in' && !trail(0)) {
    const n1 = word(1);
    const short = n1 && /^(\d{1,3})([dw])$/.exec(n1);
    if (short) return { length: 2, date: addDays(today, +short[1] * (short[2] === 'w' ? 7 : 1)) };
    if (n1 && /^\d{1,3}$/.test(n1) && !trail(1)) {
      const unit = word(2);
      if (unit && /^(days?|d)$/.test(unit)) return { length: 3, date: addDays(today, +n1) };
      if (unit && /^(weeks?|w|wks?)$/.test(unit)) return { length: 3, date: addDays(today, +n1 * 7) };
    }
  }

  // 3d · 2w (lowercase only, so "3D printer" stays text)
  const short = /^(\d{1,3})([dw])$/.exec(tok(0).wordCase);
  if (short) return one(addDays(today, +short[1] * (short[2] === 'w' ? 7 : 1)));

  // Dec 21 · Dec 21st · December 21st, 2026
  const month = MONTHS[t0];
  if (month && (trail(0) === '' || trail(0) === '.')) {
    const day = word(1) && DAY_WORD.exec(word(1));
    if (day) {
      const year = word(2);
      if ((trail(1) === '' || trail(1) === ',') && year && YEAR_WORD.test(year)) {
        const r = resolveDayMonth(today, +day[1], month, +year, label(3));
        if (r) return { length: 3, ...r };
      }
      const r = resolveDayMonth(today, +day[1], month, null, label(2));
      if (r) return { length: 2, ...r };
    }
  }

  // 21 Dec · 21st Dec · 21st of December 2026
  const dayFirst = DAY_WORD.exec(t0);
  if (dayFirst && !trail(0)) {
    const k = word(1) === 'of' && !trail(1) ? 2 : 1;
    const month2 = MONTHS[word(k)];
    if (month2) {
      const year = word(k + 1);
      if (['', ',', '.'].includes(trail(k)) && year && YEAR_WORD.test(year)) {
        const r = resolveDayMonth(today, +dayFirst[1], month2, +year, label(k + 2));
        if (r) return { length: k + 2, ...r };
      }
      const r = resolveDayMonth(today, +dayFirst[1], month2, null, label(k + 1));
      if (r) return { length: k + 1, ...r };
    }
  }

  // Numeric, day first: 21/12 · 21/12/26 · 21/12/2026 · 21-12-2026 · 21.12.2026 · 2026-12-21
  if (t0 === '24/7') return null; // "24/7 support", not 24 July
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t0))) {
    const r = resolveDayMonth(today, +m[3], +m[2], +m[1], label(1));
    return r ? { length: 1, ...r } : null;
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t0))) {
    const r = resolveDayMonth(today, +m[1], +m[2], m[3] ? +m[3] : null, label(1));
    return r ? { length: 1, ...r } : null;
  }
  if ((m = /^(\d{1,2})([-.])(\d{1,2})\2(\d{2}|\d{4})$/.exec(t0))) {
    const r = resolveDayMonth(today, +m[1], +m[3], +m[4], label(1));
    return r ? { length: 1, ...r } : null;
  }
  return null;
}

// ============================================================
// VALUES: links, categories, typo suggestions
// ============================================================

// "telcobridges.com" → "https://telcobridges.com". Only http(s) links; null when it isn't one.
export function normalizeUrl(value) {
  const v = (value || '').trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let url;
  try { url = new URL(withScheme); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname !== 'localhost' && !url.hostname.includes('.')) return null;
  return withScheme;
}

// Find a category by (part of) its name: exact, then starts-with, then contains.
// → { category } | { ambiguous: [categories] } | {}
export function matchCategory(query, categories) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return {};
  const list = Array.isArray(categories) ? categories : [];
  const name = (c) => (c.name || '').trim().toLowerCase();
  const exact = list.find(c => name(c) === q);
  if (exact) return { category: exact };
  for (const test of [(c) => name(c).startsWith(q), (c) => name(c).includes(q)]) {
    const hits = list.filter(test);
    if (hits.length === 1) return { category: hits[0] };
    if (hits.length > 1) return { ambiguous: hits };
  }
  return {};
}

// Typos: insert, delete, change or swap two neighbouring letters ("rde" → "red" is 1)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function suggestCommand(name) {
  if (name.length < 2) return null;
  const allowed = name.length <= 4 ? 1 : 2; // short words need a close match
  let best = null;
  let bestDistance = allowed + 1;
  for (const candidate of SUGGESTABLE) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}

// ============================================================
// PARSE
// ============================================================

/**
 * Parse one quick capture line.
 * @param {string} text
 * @param {{ now?: Date, categories?: Array<{id, name, slot}> }} options
 * @returns {{
 *   title: string, explicitTask: boolean, color: string|null, pinned: boolean|null,
 *   timer: boolean, urls: string[], category: object|null, dueDate: string|null,
 *   clearDate: boolean, past: boolean, dateSpan: {start, end}|null,
 *   issues: Array<{ level: 'error'|'warning', message: string, start: number, end: number }>,
 *   hasErrors: boolean
 * }}
 */
export function parseQuickCapture(text, options = {}) {
  const now = options.now instanceof Date && !isNaN(options.now) ? options.now : new Date();
  const today = startOfDay(now);
  const categories = Array.isArray(options.categories) ? options.categories : [];
  const tokens = tokenize(text || '');

  const result = {
    title: '',
    explicitTask: false,
    color: null,
    pinned: null,
    timer: false,
    urls: [],
    category: null,
    dueDate: null,
    clearDate: false,
    past: false,
    dateSpan: null,
    issues: [],
    hasErrors: false,
  };
  const parts = [];                  // words that stay as text: { text, index }
  const seen = { date: false, color: false, pin: false, category: false };
  const issue = (level, message, start, end) => result.issues.push({ level, message, start, end });

  const setDate = (dueDate, span, past) => {
    if (seen.date) issue('warning', 'Two due dates: using the last one', span.start, span.end);
    seen.date = true;
    result.dueDate = dueDate;
    result.clearDate = !dueDate;
    result.past = !!past;
    result.dateSpan = dueDate ? span : null;
  };

  const handleCommand = (i) => {
    const t = tokens[i];
    const colon = t.raw.indexOf(':');
    let name = colon === -1 ? t.raw.slice(1).replace(TRAIL_PUNCT, '') : t.raw.slice(1, colon);
    let value = colon === -1 ? null : t.raw.slice(colon + 1);
    const key = name.toLowerCase();
    const def = /^[a-z]+$/.test(key) ? COMMANDS[key] : undefined;
    let last = i;
    const spanTo = (j) => ({ start: t.start, end: tokens[j].end });

    if (!def) {
      const hint = suggestCommand(key);
      const keep = `type \\!${name} to keep it as text`;
      issue('error', hint ? `Unknown command !${name}. Did you mean !${hint}? (or ${keep})` : `Unknown command !${name} (${keep})`, t.start, t.end);
      return i;
    }
    if (def.needsValue && value === null) {
      issue('error', def.kind === 'url'
        ? 'Put the link after a colon: !url:telcobridges.com'
        : 'Type !category: and pick one from the list', t.start, t.end);
      return i;
    }
    if (!def.needsValue && value !== null) {
      issue('error', `!${key} doesn't take a value`, t.start, t.end);
      return i;
    }

    switch (def.kind) {
      case 'task':
        result.explicitTask = true;
        break;
      case 'color':
        if (seen.color && result.color !== def.color) issue('warning', 'Two colors: using the last one', t.start, t.end);
        seen.color = true;
        result.color = def.color;
        break;
      case 'pin':
        if (seen.pin && result.pinned !== def.value) issue('warning', '!priority and !nopriority: using the last one', t.start, t.end);
        seen.pin = true;
        result.pinned = def.value;
        break;
      case 'timer':
        result.timer = true;
        break;
      case 'nodate':
        setDate(null, spanTo(i), false);
        break;
      case 'url': {
        const v = value.replace(/[,;!?)\]]+$/, '').replace(/\.+$/, '');
        const url = normalizeUrl(v);
        if (!url) {
          issue('error', v ? `"${v}" doesn't look like a link` : 'Put the link after the colon: !url:telcobridges.com', t.start, t.end);
        } else if (!result.urls.includes(url)) {
          result.urls.push(url);
        }
        break;
      }
      case 'category': {
        let query = value;
        if (query.startsWith('"')) {
          // !category:"Two words" may run over several tokens
          let joined = query.slice(1);
          const closing = /"[,.;!?)]*$/;
          let closed = joined.length > 0 && closing.test(joined);
          if (closed) joined = joined.replace(closing, '');
          while (!closed && last + 1 < tokens.length) {
            last++;
            const raw = tokens[last].raw;
            closed = closing.test(raw);
            joined += ' ' + (closed ? raw.replace(closing, '') : raw);
          }
          if (!closed) {
            issue('error', 'Close the quote after the category name', t.start, tokens[last].end);
            return last;
          }
          query = joined;
        } else {
          query = query.replace(TRAIL_PUNCT, '');
        }
        const span = spanTo(last);
        query = query.trim();
        if (!query) {
          issue('error', 'Type !category: and pick one from the list', span.start, span.end);
          break;
        }
        const found = matchCategory(query, categories);
        if (found.category) {
          if (seen.category && result.category && result.category.id !== found.category.id) {
            issue('warning', 'Two categories: using the last one', span.start, span.end);
          }
          seen.category = true;
          result.category = found.category;
        } else if (found.ambiguous) {
          const names = found.ambiguous.map(c => c.name).join(', ');
          issue('error', `"${query}" matches ${names}. Type more of the name`, span.start, span.end);
        } else if (categories.length === 0) {
          issue('error', 'No categories yet. Add them in edit mode → Settings → Tasks', span.start, span.end);
        } else {
          issue('error', `No category called "${query}"`, span.start, span.end);
        }
        break;
      }
    }
    return last;
  };

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // \word: keep as text. A whole date phrase stays text when its first word is escaped.
    if (t.escaped) {
      const m = matchDate(tokens, i, today);
      const n = m ? m.length : 1;
      for (let k = 0; k < n; k++) parts.push({ text: k === 0 ? t.text : tokens[i + k].raw, index: i + k });
      i += n;
      continue;
    }

    // !command (only at the start of a word, so "Great job!" stays text)
    if (/^![a-z]/i.test(t.raw)) {
      i = handleCommand(i) + 1;
      continue;
    }

    const m = matchDate(tokens, i, today);
    if (m) {
      const span = { start: t.start, end: tokens[i + m.length - 1].end };
      if (m.error) {
        issue('error', `${m.error} (type \\ before it to keep it as text)`, span.start, span.end);
        for (let k = 0; k < m.length; k++) parts.push({ text: tokens[i + k].raw, index: i + k });
      } else {
        // "due tomorrow" / "by fri": the deadline word goes with the date
        const prev = parts[parts.length - 1];
        if (prev && prev.index === i - 1 && !tokens[i - 1].escaped && /^(by|due)$/i.test(prev.text)) parts.pop();
        setDate(toDateKey(m.date), span, m.past);
      }
      i += m.length;
      continue;
    }

    parts.push({ text: t.raw, index: i });
    i++;
  }

  result.title = parts.map(p => p.text).join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .trim();
  if (result.past) {
    const span = result.dateSpan || { start: 0, end: 0 };
    issue('warning', 'That due date is in the past', span.start, span.end);
  }
  result.issues.sort((a, b) => (a.level === b.level ? a.start - b.start : a.level === 'error' ? -1 : 1));
  result.hasErrors = result.issues.some(x => x.level === 'error');
  return result;
}

// ============================================================
// COMMAND REFERENCE (the ⓘ panel renders this list)
// ============================================================
// insert: what clicking the example adds to the bar (null = not insertable)

export const QUICK_CAPTURE_HELP = [
  {
    title: 'Task',
    rows: [
      { examples: [{ text: 'Send deck to Marc', insert: null }], meaning: 'Plain text is the task name' },
      { examples: [{ text: '@', insert: '@' }], meaning: 'Pick an existing task to change it. Any other text becomes a new subtask on it' },
      { examples: [{ text: '!task', insert: '!task ' }], meaning: 'Optional: a new task is the default' },
    ],
  },
  {
    title: 'Due date',
    rows: [
      { examples: [{ text: 'today', insert: 'today ' }, { text: 'tomorrow', insert: 'tomorrow ' }, { text: 'tmr', insert: 'tmr ' }], meaning: 'Today or tomorrow' },
      { examples: [{ text: 'fri', insert: 'fri ' }, { text: 'friday', insert: 'friday ' }, { text: 'next fri', insert: 'next fri ' }], meaning: 'This coming Friday (today if it is Friday), or the week after' },
      { examples: [{ text: '3d', insert: '3d ' }, { text: '2w', insert: '2w ' }, { text: 'in 3 days', insert: 'in 3 days ' }], meaning: 'Days or weeks from today' },
      { examples: [{ text: 'eow', insert: 'eow ' }, { text: 'eom', insert: 'eom ' }], meaning: 'End of this week (Friday) or of this month' },
      { examples: [{ text: 'Dec 21', insert: 'Dec 21 ' }, { text: 'Dec 21st', insert: 'Dec 21st ' }, { text: '21 Dec', insert: '21 Dec ' }, { text: '21st of December 2026', insert: '21st of December 2026 ' }], meaning: 'Month names, any case' },
      { examples: [{ text: '21/12', insert: '21/12 ' }, { text: '21/12/26', insert: '21/12/26 ' }, { text: '21/12/2026', insert: '21/12/2026 ' }, { text: '21-12-2026', insert: '21-12-2026 ' }, { text: '21.12.2026', insert: '21.12.2026 ' }, { text: '2026-12-21', insert: '2026-12-21 ' }], meaning: 'Day first. Without a year it means the next 21 Dec' },
      { examples: [{ text: '!nodate', insert: '!nodate ' }], meaning: 'Remove the due date' },
    ],
  },
  {
    title: 'Priority',
    rows: [
      { examples: [{ text: '!red', insert: '!red ', color: 'red' }, { text: '!orange', insert: '!orange ', color: 'orange' }, { text: '!yellow', insert: '!yellow ', color: 'yellow' }, { text: '!blue', insert: '!blue ', color: 'blue' }], meaning: 'Matrix color. Short: !r !o !y !b' },
      { examples: [{ text: '!priority', insert: '!priority ' }, { text: '!nopriority', insert: '!nopriority ' }], meaning: 'Primary on or off' },
    ],
  },
  {
    title: 'More',
    rows: [
      { examples: [{ text: '!timer', insert: '!timer ' }], meaning: 'Start its timer (any other timer stops and is saved)' },
      { examples: [{ text: '!url:telcobridges.com', insert: '!url:' }], meaning: 'Add a link (https:// is added for you)' },
      { examples: [{ text: '!category:', insert: '!category:' }, { text: '!cat:', insert: '!cat:' }], meaning: 'Pick a category from the list' },
      { examples: [{ text: '\\fri', insert: null }], meaning: 'A \\ keeps a word as text. Clicking the date chip does it for you' },
    ],
  },
];
