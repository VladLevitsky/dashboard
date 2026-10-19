// Personal Dashboard - Typed dates (pure: no DOM, Node-testable)
// What a date field reads when someone types a date instead of picking one
// (the phone's date field, js/features/mobile/date-field.js). Day first, like
// quick capture (21/12 is 21 December), built from the local calendar day,
// never through UTC. A date field means nothing but a date, so it takes more
// than quick capture does:
//   - digits only, for a number pad that has no '/': 21 (the next 21st of a
//     month, today counts), 2112 (DDMM), 211226 (DDMMYY), 21122026 (DDMMYYYY,
//     else YYYYMMDD), 3 digits when only one reading is a real date (512 =
//     5/12; 112 asks for 4 digits: 0112 or 1102). The messages name these
//     digits-only forms first: an iPhone number pad has no separator at all
//   - day first with any of / - . , or a space: 21/12, 21-12, 21.12, 21 12,
//     21/12/26, 21-12-2026; and YYYY-M-D (2026-12-21)
//   - else the whole text has to be one quick-capture date: today, tmr, fri,
//     next fri, 3d, 2w, in 3 days, eow, eom, Dec 21, 21 Dec, 21st of December 2026
// A date without a year is its next occurrence (today counts; 29/2 waits for a
// leap year), so typing 15/10 on 19 October gives 15 October next year: the
// result says so (`rolled`), and dateHint() turns that into a line under the
// field. A date with a year may be in the past (`past`: an overdue date is
// allowed). min / max ('YYYY-MM-DD') make a date outside them an error.
//
//   parseTypedDate(text, { now, min, max }) → { key, rolled?, past? } | { empty } | { error }
//   dateWords(key, now)      'Fri, Oct 23' (', 2027' when it isn't this year)
//   dateWordsLong(key)       'Friday, October 23, 2026' (screen readers)
//   typedDateText(key, now)  what the box shows to edit: '23/10', or '23/10/2027'
//                            whenever the short form would read as another day
//   dateHint(result, now)    'Reads as Fri, Oct 15, 2027 · type 151026 (15/10/26) for this year' | 'In the past' | ''

import { parseQuickCapture, toDateKey, fromDateKey } from './quick-capture-parse.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const SEP = '[/\\-.,\\s]';
const SEPARATED = new RegExp(`^(\\d{1,4})\\s*${SEP}\\s*(\\d{1,2})(?:\\s*${SEP}\\s*(\\d{2}|\\d{4}))?$`);
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;
// A yearless date read as next year says how to get this year's only when this
// year's passed less than about half a year ago (typing 5/1 in late December
// means next January; 15/10 on 19 October may mean the overdue one)
const ROLLED_HINT_DAYS = 183;
// The usual 'what to type': the digits-only form first (every number pad has it)
const LIKE = 'Type a date like 2112 or 21/12';

function asDate(now) {
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  return isNaN(d) ? new Date() : d;
}

function startOfDay(now) {
  const d = asDate(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The date when y / m / d is a real calendar day (local), else null
function real(y, m, d) {
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

// 'YYYY-MM-DD' of a real local day
export function isDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && !!real(+m[1], +m[2], +m[3]);
}

// The next time day d of month m comes around (today counts): { dt, rolled }
function nextDayMonth(today, d, m) {
  for (let y = today.getFullYear(); y <= today.getFullYear() + 8; y++) {
    const dt = real(y, m, d);
    if (dt && dt >= today) return { dt, rolled: y > today.getFullYear() };
  }
  return null;
}

// The next day-of-month d: this month while still ahead (today counts), else a later one
function nextDayOfMonth(today, d) {
  for (let i = 0; i < 14; i++) {
    const y = today.getFullYear() + Math.floor((today.getMonth() + i) / 12);
    const m = ((today.getMonth() + i) % 12) + 1;
    const dt = real(y, m, d);
    if (dt && dt >= today) return dt;
  }
  return null;
}

// 26 → 2026; 2026 stays
function fullYear(y, digits) {
  return digits <= 2 ? 2000 + y : y;
}

// What a quick-capture reading may hold to count as just a date
function onlyADate(p) {
  if (!p || !p.dueDate) return false;
  if (p.title || p.explicitTask || p.color || p.pinned != null || p.timer || p.gcal != null) return false;
  if ((p.urls && p.urls.length) || p.category) return false;
  if (p.dueTime || p.clearTime || p.dueEndTime || p.clearEnd || p.clearDate) return false;
  // Two dates ('fri sat') or anything else said about it: not one date. Only
  // the past-date warning is fine (an overdue date is allowed here)
  return !(p.issues || []).some(i => i.level === 'error' || !/in the past/i.test(i.message));
}

export function parseTypedDate(text, { now = new Date(), min = null, max = null } = {}) {
  const raw = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (!raw) return { empty: true };
  const today = startOfDay(now);
  const bad = (error) => ({ error });
  const done = (dt, extra = {}) => {
    const key = toDateKey(dt);
    if (isDateKey(min) && key < min) return bad(`Not before ${dateWords(min, now)}`);
    if (isDateKey(max) && key > max) return bad(`Not after ${dateWords(max, now)}`);
    const out = { key, past: dt < today };
    if (extra.rolled) out.rolled = true;
    return out;
  };
  let m;

  // Digits only (a number pad)
  if (/^\d+$/.test(raw)) {
    const s = raw;
    if (s.length <= 2) {
      const d = +s;
      if (d < 1 || d > 31) return bad('Days go from 1 to 31');
      const dt = nextDayOfMonth(today, d);
      return dt ? done(dt) : bad(`No ${d}th coming up`);
    }
    if (s.length === 3) {
      const readings = [[+s.slice(0, 1), +s.slice(1)], [+s.slice(0, 2), +s.slice(2)]]
        .map(([d, mo]) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? nextDayMonth(today, d, mo) : null))
        .filter(Boolean);
      if (readings.length === 1) return done(readings[0].dt, { rolled: readings[0].rolled });
      if (readings.length === 2) return bad(`Type 4 digits: 0${s} (${s[0]}/${s.slice(1)}) or ${s.slice(0, 2)}0${s[2]} (${s.slice(0, 2)}/${s[2]})`);
      return bad(LIKE);
    }
    if (s.length === 4) {
      const d = +s.slice(0, 2);
      const mo = +s.slice(2);
      if (mo < 1 || mo > 12) return bad('Type day then month: 2112 = 21/12');
      const r = d >= 1 && d <= 31 ? nextDayMonth(today, d, mo) : null;
      return r ? done(r.dt, { rolled: r.rolled }) : bad(`${s.slice(0, 2)}/${s.slice(2)} isn't a real date`);
    }
    if (s.length === 6 || s.length === 8) {
      const d = +s.slice(0, 2);
      const mo = +s.slice(2, 4);
      let dt = real(fullYear(+s.slice(4), s.length - 4), mo, d);
      if (!dt && s.length === 8) dt = real(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6));   // 20261221
      return dt ? done(dt) : bad('Not a real date');
    }
    return bad(LIKE);
  }

  // Numbers with separators: d m [y] (day first), or yyyy m d
  if ((m = SEPARATED.exec(raw))) {
    if (m[1].length === 4) {
      if (!m[3] || m[3].length > 2) return bad('Type a date like 2026-12-21');
      const dt = real(+m[1], +m[2], +m[3]);
      return dt ? done(dt) : bad(`${raw} isn't a real date`);
    }
    if (m[1].length > 2) return bad(LIKE);
    const d = +m[1];
    const mo = +m[2];
    if (mo < 1 || mo > 12) return bad('Type day then month: 21/12');
    if (m[3]) {
      const dt = real(fullYear(+m[3], m[3].length), mo, d);
      return dt ? done(dt) : bad(`${raw} isn't a real date`);
    }
    const r = d >= 1 && d <= 31 ? nextDayMonth(today, d, mo) : null;
    return r ? done(r.dt, { rolled: r.rolled }) : bad(`${raw} isn't a real date`);
  }

  // The quick capture grammar: the whole text one date
  const p = parseQuickCapture(raw, { now: asDate(now) });
  if (onlyADate(p)) {
    const dt = fromDateKey(p.dueDate);
    // A month name without a year (Oct 15) is its next occurrence too
    const rolled = !!dt && dt.getFullYear() > today.getFullYear() && MONTH_WORD.test(raw) && !/\d{4}/.test(raw);
    return done(dt, { rolled });
  }
  const err = (p.issues || []).find(i => i.level === 'error');
  if (err && /real date/.test(err.message)) return bad(err.message);
  return bad('Type a date like 2112, 21/12 or fri');
}

// --- Labels ---------------------------------------------------------------------

function keyDate(key) {
  if (!isDateKey(key)) return null;
  return fromDateKey(key);
}

// 'Fri, Oct 23'; ', 2027' when it isn't this year
export function dateWords(key, now = new Date()) {
  const d = keyDate(key);
  if (!d) return '';
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === asDate(now).getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

// 'Friday, October 23, 2026'
export function dateWordsLong(key) {
  const d = keyDate(key);
  if (!d) return '';
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// What the box shows while editing, day first: '23/10' when that reads back
// as the same day (this year, today or later), else '23/10/2027'
export function typedDateText(key, now = new Date()) {
  const d = keyDate(key);
  if (!d) return '';
  const today = startOfDay(now);
  const short = `${d.getDate()}/${d.getMonth() + 1}`;
  return d.getFullYear() === today.getFullYear() && d >= today ? short : `${short}/${d.getFullYear()}`;
}

// The line under the field after a typed date: a yearless date read as a
// later year says so (and how to type this year's, when it is a real day), a
// date in the past says that quietly
export function dateHint(result, now = new Date()) {
  if (!result || !result.key) return '';
  const d = keyDate(result.key);
  if (!d) return '';
  const today = startOfDay(now);
  if (result.rolled) {
    const ahead = Math.round((d - today) / 86400000);
    if (ahead <= ROLLED_HINT_DAYS) return '';
    const y = today.getFullYear();
    const thisYear = real(y, d.getMonth() + 1, d.getDate());
    const yy = String(y).slice(-2);
    const pad = (n) => String(n).padStart(2, '0');
    const how = thisYear ? ` · type ${pad(d.getDate())}${pad(d.getMonth() + 1)}${yy} (${d.getDate()}/${d.getMonth() + 1}/${yy}) for this year` : '';
    return `Reads as ${dateWords(result.key, now)}${how}`;
  }
  if (result.past) return 'In the past';
  return '';
}
