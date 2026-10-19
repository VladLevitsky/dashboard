// Personal Dashboard - Due times (pure: no DOM, Node-testable)
// A task can have a time on its due date: task.dueTime = 'HH:MM' (24 h, the
// wall clock where it was set) and task.dueTz = the IANA time zone it was set
// in, so its Google Calendar event lands at the moment that was meant whichever
// device syncs. A time only exists with a due date: updateTask drops it with
// the date (settleDueTime). Labels follow the browser's 12 / 24-hour habit.
// A timed task can also end: task.dueEndTime = 'HH:MM' on the same day,
// strictly after dueTime, in the same zone (dueTz). It goes with the time,
// and moving the start keeps the length (settleDueTime).

const TIME_KEY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isTimeKey(value) {
  return typeof value === 'string' && TIME_KEY_RE.test(value);
}

// (15, 30) → '15:30'; null when it isn't a time of day
export function toTimeKey(hours, minutes = 0) {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// '15:30' → 930 (minutes after midnight); null when it isn't a time
export function timeKeyMinutes(key) {
  const m = TIME_KEY_RE.exec(key || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// 930 → '15:30'; null outside the day (0..1439)
export function minutesToTimeKey(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return null;
  return toTimeKey(Math.floor(minutes / 60), minutes % 60);
}

// '15:30' moved by delta minutes; null when it leaves the day
export function shiftTimeKey(key, delta) {
  const mins = timeKeyMinutes(key);
  if (mins == null || !Number.isInteger(delta)) return null;
  return minutesToTimeKey(mins + delta);
}

// What <input type="time"> gives ('15:30' or '15:30:00') → '15:30' | null
export function timeKeyFromInput(value) {
  const v = String(value || '').slice(0, 5);
  return isTimeKey(v) ? v : null;
}

// The task's due time, only while it also has a due date
export function dueTimeOf(task) {
  return task && typeof task.dueDate === 'string' && DATE_KEY_RE.test(task.dueDate) && isTimeKey(task.dueTime)
    ? task.dueTime
    : null;
}

// The task's end time, only while it has a due time and ends after it
export function dueEndTimeOf(task) {
  const start = dueTimeOf(task);
  return start && isTimeKey(task.dueEndTime) && task.dueEndTime > start ? task.dueEndTime : null;
}

// This browser's IANA time zone ('America/Toronto'), or null
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// What updateTask keeps after an update: no date (or no real time) → no time
// and no end; a time that was just set (or changed) is stamped with this
// device's zone. Only then: editing a task's title on a trip never moves its
// event. The end: a start that moved takes its end along (same length; past
// midnight it goes), an end that isn't after the start goes, and an end the
// update didn't touch on a task that had no start goes too (an orphan an
// older build left behind never comes back with a new start).
// timeTouched: the update carried dueTime (and no dueTz of its own)
// endTouched: the update carried dueEndTime (null = remove it)
export function settleDueTime(task, {
  timeTouched = false, previousTime = null, endTouched = false, previousEnd = null, tz = null,
} = {}) {
  if (!task) return task;
  if (!(typeof task.dueDate === 'string' && DATE_KEY_RE.test(task.dueDate)) || !isTimeKey(task.dueTime)) {
    delete task.dueTime;
    delete task.dueTz;
    delete task.dueEndTime;
    return task;
  }
  if (!endTouched) {
    if (!isTimeKey(previousTime)) delete task.dueEndTime;
    else if (task.dueTime !== previousTime && isTimeKey(previousEnd)) {
      const moved = shiftTimeKey(previousEnd, timeKeyMinutes(task.dueTime) - timeKeyMinutes(previousTime));
      if (moved) task.dueEndTime = moved;
      else delete task.dueEndTime;
    }
  }
  if ('dueEndTime' in task && !(isTimeKey(task.dueEndTime) && task.dueEndTime > task.dueTime)) delete task.dueEndTime;
  if (timeTouched && (task.dueTime !== previousTime || !task.dueTz)) {
    if (tz) task.dueTz = tz;
    else delete task.dueTz;
  }
  if (!task.dueTz) delete task.dueTz;
  return task;
}

// --- Labels ------------------------------------------------------------------

const formatters = new Map();
function formatter(locale, options) {
  const key = `${locale || ''}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

// Does this locale write 3:00 PM (true) or 15:00 (false)?
export function prefersHour12(locale) {
  try {
    const cycle = formatter(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    if (cycle) return cycle === 'h12' || cycle === 'h11';
    return /\D(am|pm)|[ap]\.?\s?m/i.test(formatter(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, 15)));
  } catch {
    return true;
  }
}

// '15:30' → '3:30 PM' / '15:30' (the locale's own way, like the busy strip).
// compact: '3 PM' for a whole hour in 12-hour locales (24-hour ones keep '15:00')
export function formatTimeKey(key, { compact = false, locale } = {}) {
  const mins = timeKeyMinutes(key);
  if (mins == null) return '';
  try {
    return formatter(locale, timeOptions(mins, compact, prefersHour12(locale))).format(minutesDate(mins));
  } catch {
    return key;
  }
}

function minutesDate(mins) {
  return new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
}

function timeOptions(mins, compact, hour12) {
  return compact && mins % 60 === 0 && hour12
    ? { hour: 'numeric' }
    : { hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit' };   // 3:30 PM · 09:30
}

// A start and an end → '3–4:30 PM' (one AM / PM when both share it),
// '11 AM – 1 PM', '15:00–16:30'. No end (or one that isn't after the start):
// just the start, as formatTimeKey writes it. compact as in formatTimeKey
export function formatTimeRange(start, end, { compact = false, locale } = {}) {
  const from = timeKeyMinutes(start);
  if (from == null) return '';
  const to = timeKeyMinutes(end);
  const startLabel = formatTimeKey(start, { compact, locale });
  if (to == null || to <= from) return startLabel;
  const endLabel = formatTimeKey(end, { compact, locale });
  let hour12 = true;
  try { hour12 = prefersHour12(locale); } catch { /* keep 12-hour */ }
  if (!hour12) return `${startLabel}–${endLabel}`;
  if ((from < 720) === (to < 720)) {
    // Same half of the day: the start without its AM / PM
    try {
      const bare = formatter(locale, timeOptions(from, compact, true)).formatToParts(minutesDate(from))
        .filter(part => part.type !== 'dayPeriod')
        .map(part => part.value)
        .join('')
        .replace(/[\s   ]+/g, ' ')
        .trim();
      if (/\d/.test(bare)) return `${bare}–${endLabel}`;
    } catch { /* fall through to the spaced form */ }
  }
  return `${startLabel} – ${endLabel}`;
}

// What someone typed in a time field → { key, meridiem, guessed } |
// { empty: true } | { error }. Takes '3', '330', '1530', '3:30', '3.30',
// '3h30', '3pm', '3:30 p.m.', 'noon', 'midnight'. With am / pm it is a
// 12-hour time; without, 0, 13-23 or a leading zero reads as 24-hour. A bare
// 1-12 in a 12-hour locale takes the meridiem given (the AM / PM switch
// beside the field), else a guess (7-11 morning, 12 and 1-6 afternoon:
// guessed: true, so the field can show it was a guess). 24-hour: as typed.
export function parseTypedTime(text, { hour12 = true, meridiem = null } = {}) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return { empty: true };
  if (raw === 'noon') return { key: '12:00', meridiem: 'pm', guessed: false };
  if (raw === 'midnight') return { key: '00:00', meridiem: 'am', guessed: false };
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:([ap])\.?\s*(?:m\.?)?)?$/.exec(raw);
  if (!m) return { error: 'Type a time like 3:30' };
  let hours = Number(m[1]);
  const minutes = m[2] == null ? 0 : Number(m[2]);
  if (minutes > 59) return { error: 'Minutes go up to 59' };
  const suffix = m[3] ? (m[3] === 'a' ? 'am' : 'pm') : null;
  let guessed = false;
  if (suffix) {
    if (hours < 1 || hours > 12) return { error: 'With AM or PM the hour is 1 to 12' };
    hours = (hours % 12) + (suffix === 'pm' ? 12 : 0);
  } else if (hours > 23) {
    return { error: 'Hours go up to 23' };
  } else if (hour12 && hours >= 1 && hours <= 12 && !(m[1].length === 2 && m[1][0] === '0')) {
    let half = meridiem === 'am' || meridiem === 'pm' ? meridiem : null;
    if (!half) {
      half = hours >= 7 && hours <= 11 ? 'am' : 'pm';
      guessed = true;
    }
    hours = (hours % 12) + (half === 'pm' ? 12 : 0);
  }
  const key = toTimeKey(hours, minutes);
  return key ? { key, meridiem: hours < 12 ? 'am' : 'pm', guessed } : { error: 'Type a time like 3:30' };
}

// Epoch ms → '3:30' / '3' (12-hour, no AM/PM) or '15:30': labels that sit
// on an hour axis, which says the rest
export function shortClock(ms, hour12 = true) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  if (!hour12) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12);
}
