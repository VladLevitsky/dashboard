// Personal Dashboard - Due times (pure: no DOM, Node-testable)
// A task can have a time on its due date: task.dueTime = 'HH:MM' (24 h, the
// wall clock where it was set) and task.dueTz = the IANA time zone it was set
// in, so its Google Calendar event lands at the moment that was meant whichever
// device syncs. A time only exists with a due date: updateTask drops it with
// the date (settleDueTime). Labels follow the browser's 12 / 24-hour habit.

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

// This browser's IANA time zone ('America/Toronto'), or null
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// What updateTask keeps after an update: no date (or no real time) → no time;
// a time that was just set (or changed) is stamped with this device's zone.
// Only then: editing a task's title on a trip never moves its event.
// timeTouched: the update carried dueTime (and no dueTz of its own)
export function settleDueTime(task, { timeTouched = false, previousTime = null, tz = null } = {}) {
  if (!task) return task;
  if (!(typeof task.dueDate === 'string' && DATE_KEY_RE.test(task.dueDate)) || !isTimeKey(task.dueTime)) {
    delete task.dueTime;
    delete task.dueTz;
    return task;
  }
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
  const at = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
  try {
    const hour12 = prefersHour12(locale);
    const options = compact && mins % 60 === 0 && hour12
      ? { hour: 'numeric' }
      : { hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit' };   // 3:30 PM · 09:30
    return formatter(locale, options).format(at);
  } catch {
    return key;
  }
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
