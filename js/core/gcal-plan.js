// Personal Dashboard - Google Calendar rules (pure: no DOM, Node-testable)
// Which tasks the Worker mirrors into the "Dashboard tasks" calendar, a cheap
// fingerprint of them (so the desktop knows when to upload quickly), and the
// layout of a day's busy blocks for the busy-time strip.
//
// Busy data comes from Google free/busy: only start/end times, never what the
// event is. Times are epoch ms (or ISO strings, parsed here). The caller passes
// the local day's real start and end (23 or 25 hours on DST days), so nothing
// here depends on the machine's time zone.

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = 3600000;
const DAY = 24 * HOUR;

// A task the Worker puts in Google Calendar: flag on and a valid due date
export function isCalendarTask(task) {
  return !!task && task.gcal === true && typeof task.dueDate === 'string' && DATE_KEY_RE.test(task.dueDate);
}

// Everything the calendar shows for the flagged tasks (active and completed).
// Two models with the same signature need no calendar sync.
export function gcalSignature(data) {
  const parts = [];
  const add = (list, done) => {
    if (!Array.isArray(list)) return;
    for (const t of list) {
      if (isCalendarTask(t)) parts.push([t.id, t.title || '', t.dueDate, t.color || '', done ? 1 : 0].join('\u0001'));
    }
  };
  add(data && data.tasks, false);
  add(data && data.completedTasks, true);
  return parts.sort().join('\u0002');
}

function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

// Within an hour of a whole number of days and at least 23 h long: what an
// all-day (or multi-day) event marked Busy looks like in free/busy, even when
// the calendar's time zone shifts it off the browser's midnights
function isAllDayLike(len) {
  if (len < 23 * HOUR) return false;
  const days = Math.round(len / DAY);
  return Math.abs(len - days * DAY) <= HOUR;
}

// Does an all-day-like block belong to this local day? Each of its days is
// counted on the day that holds that day's midpoint, so an event shifted by a
// few hours still lands on one day, not two
function allDayBlockHits(start, end, dayStart, dayEnd) {
  const days = Math.max(1, Math.round((end - start) / DAY));
  const slice = (end - start) / days;
  for (let i = 0; i < days; i++) {
    const mid = start + (i + 0.5) * slice;
    if (mid >= dayStart && mid < dayEnd) return true;
  }
  return false;
}

// Position of a moment in the day, as a percentage (0-100, clamped)
export function pctOfDay(ms, dayStart, dayEnd) {
  const span = dayEnd - dayStart;
  if (!(span > 0)) return 0;
  const pct = ((ms - dayStart) / span) * 100;
  return Math.min(100, Math.max(0, pct));
}

// Lay out one day of free/busy.
// calendars: [{ id, busy: [{ start, end }], error? }]
// Returns { allDay, blocks, gaps, nextFree, busyMinutes, errors }:
// - allDay: a busy all-day / multi-day event covers the day (shown as a note,
//   never as a filled day)
// - blocks: timed busy blocks merged across calendars, clipped to the day,
//   with left / width percentages and the calendars they came from
// - gaps: the free stretches between them
// - nextFree: the first free stretch of 15 min or more from now (today only)
export function busyDayLayout(calendars, { dayStart, dayEnd, now = null } = {}) {
  const out = { allDay: false, blocks: [], gaps: [], nextFree: null, busyMinutes: 0, errors: [] };
  if (!(dayEnd > dayStart)) return out;

  const timed = [];
  for (const cal of Array.isArray(calendars) ? calendars : []) {
    if (!cal) continue;
    if (cal.error) out.errors.push(String(cal.id || ''));
    for (const b of Array.isArray(cal.busy) ? cal.busy : []) {
      const start = toMs(b && b.start);
      const end = toMs(b && b.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (isAllDayLike(end - start)) {
        if (allDayBlockHits(start, end, dayStart, dayEnd)) out.allDay = true;
        continue;
      }
      if (end <= dayStart || start >= dayEnd) continue;
      if (start <= dayStart && end >= dayEnd) {
        // A long timed event (a 3-day conference) covering this whole day
        out.allDay = true;
        continue;
      }
      timed.push({ start: Math.max(start, dayStart), end: Math.min(end, dayEnd), calendars: [String(cal.id || '')] });
    }
  }

  // Merge overlapping or touching blocks across calendars
  timed.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const b of timed) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
      for (const id of b.calendars) if (!last.calendars.includes(id)) last.calendars.push(id);
    } else {
      merged.push({ start: b.start, end: b.end, calendars: b.calendars.slice() });
    }
  }

  let cursor = dayStart;
  for (const b of merged) {
    const left = pctOfDay(b.start, dayStart, dayEnd);
    out.blocks.push({ ...b, left, width: pctOfDay(b.end, dayStart, dayEnd) - left });
    out.busyMinutes += Math.round((b.end - b.start) / 60000);
    if (b.start > cursor) out.gaps.push({ start: cursor, end: b.start, minutes: Math.round((b.start - cursor) / 60000) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < dayEnd) out.gaps.push({ start: cursor, end: dayEnd, minutes: Math.round((dayEnd - cursor) / 60000) });

  if (now != null && now >= dayStart && now < dayEnd) {
    for (const g of out.gaps) {
      const from = Math.max(g.start, now);
      if (g.end - from >= 15 * 60000) {
        out.nextFree = { start: from, end: g.end, minutes: Math.round((g.end - from) / 60000) };
        break;
      }
    }
  }
  return out;
}

// The range to ask Google for when showing one day: a day of padding on each
// side, so an all-day event shifted by a time zone arrives whole (free/busy
// clips periods to the range it was asked for)
export function busyFetchRange(dayStart, dayEnd) {
  return { from: dayStart - DAY, to: dayEnd + DAY };
}
