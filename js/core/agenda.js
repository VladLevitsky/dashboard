// Personal Dashboard - Agenda rules (pure: no DOM, Node-testable)
// What is due on a day: tasks and subtasks with a due date, meetings (one-time
// dates and every recurring occurrence) and dated reminders. The Today view,
// the calendar and the notification badge all read these rules, so they always
// agree on what is due.
//
// Dates are 'YYYY-MM-DD' keys built from the LOCAL calendar day (never through
// toISOString, which shifts the day in the evening west of UTC).

import { toDateKey, fromDateKey } from './quick-capture-parse.js';

// Red on top, then orange, yellow, blue (the matrix's urgency order)
export const TASK_COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Whole days from one day key to another (UTC math, so DST can't skew it)
export function daysBetween(fromKey, toKey) {
  return Math.round((keyToUtc(toKey) - keyToUtc(fromKey)) / MS_PER_DAY);
}

export function addDays(key, n) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + n);
  return toDateKey(date);
}

function isRecurringMeeting(meeting) {
  return meeting.type === 'routine' && (meeting.repeat === 'weekly' || meeting.repeat === 'monthly');
}

// Every day a meeting happens between two day keys (inclusive). A recurring
// meeting starts on its own date and never shows up before it.
export function meetingDatesBetween(meeting, startKey, endKey) {
  if (!meeting || typeof meeting.date !== 'string' || !DATE_KEY_RE.test(meeting.date)) return [];
  if (!isRecurringMeeting(meeting)) {
    return meeting.date >= startKey && meeting.date <= endKey ? [meeting.date] : [];
  }
  const baseKey = meeting.date;
  const base = fromDateKey(baseKey);
  if (!base || baseKey > endKey) return [];
  const from = baseKey > startKey ? baseKey : startKey;
  const dates = [];

  if (meeting.repeat === 'weekly') {
    const step = (parseInt(meeting.repeatWeeks, 10) || 1) * 7;
    const skip = Math.ceil(daysBetween(baseKey, from) / step);
    for (let key = addDays(baseKey, skip * step); key <= endKey; key = addDays(key, step)) {
      dates.push(key);
    }
    return dates;
  }

  // Monthly: the same day of the month (skipped in months that don't have it),
  // or the first of the base date's weekday in each month
  const first = fromDateKey(from);
  const last = fromDateKey(endKey);
  for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth()); m === 11 ? (y++, m = 0) : m++) {
    let day;
    if (meeting.repeatMonthlyType === 'firstWeekday') {
      day = new Date(y, m, 1 + ((base.getDay() - new Date(y, m, 1).getDay() + 7) % 7));
    } else {
      day = new Date(y, m, base.getDate());
      if (day.getMonth() !== m) continue;
    }
    const key = toDateKey(day);
    if (key >= from && key <= endKey) dates.push(key);
  }
  return dates;
}

export function meetingOccursOn(meeting, dateKey) {
  return meetingDatesBetween(meeting, dateKey, dateKey).length > 0;
}

// null when not due yet (or no valid date); else { when: 'today' | 'overdue', days, date }
export function dueState(dateKey, todayKey) {
  if (typeof dateKey !== 'string' || !DATE_KEY_RE.test(dateKey) || dateKey > todayKey) return null;
  const days = daysBetween(dateKey, todayKey);
  return { when: days === 0 ? 'today' : 'overdue', days, date: dateKey };
}

function colorRank(color) {
  const i = TASK_COLOR_ORDER.indexOf(color);
  return i === -1 ? TASK_COLOR_ORDER.length - 1 : i; // unknown colors read as blue, the default
}

// Everything due today or earlier.
//   reminderDays(reminder) → whole days until its next date (≤ 0 = due), or null
// → { tasks: [{ task, due, subtasks: [{ subtask, due }] }], meetings: [{ meeting, recurring }],
//     reminders: [{ reminder, sectionId, subtitle, sectionTitle, days }] }
// A task is listed when it is due itself, or when one of its open subtasks is
// (then `due` is null). Only due subtasks are listed under it.
export function collectDueItems(data, { todayKey, reminderDays }) {
  const tasks = [];
  (data.tasks || []).forEach(task => {
    if (!task || task.completed) return;
    const due = dueState(task.dueDate, todayKey);
    const subtasks = (Array.isArray(task.subtasks) ? task.subtasks : [])
      .filter(s => s && !s.completed && s.title && String(s.title).trim())
      .map(subtask => ({ subtask, due: dueState(subtask.dueDate, todayKey) }))
      .filter(entry => entry.due)
      .sort((a, b) => b.due.days - a.due.days);
    if (due || subtasks.length > 0) tasks.push({ task, due, subtasks });
  });
  // Color, then Primary (pinned) first like the matrix, then the oldest date
  // (task or subtask) first, then the matrix order
  const oldest = entry => Math.max(entry.due ? entry.due.days : -1, ...entry.subtasks.map(s => s.due.days));
  tasks.sort((a, b) =>
    colorRank(a.task.color) - colorRank(b.task.color) ||
    (b.task.pinned ? 1 : 0) - (a.task.pinned ? 1 : 0) ||
    oldest(b) - oldest(a) ||
    (a.task.order || 0) - (b.task.order || 0));

  const meetings = (data.meetings || [])
    .filter(meeting => meetingOccursOn(meeting, todayKey))
    .map(meeting => ({ meeting, recurring: isRecurringMeeting(meeting) }))
    .sort((a, b) => String(a.meeting.title || '').localeCompare(String(b.meeting.title || '')));

  const reminders = [];
  (data.sections || []).forEach(section => {
    const card = data[section.id];
    if (!card || typeof card !== 'object') return;
    // Card order: the unnamed group renders first
    const subtitles = Object.keys(card).sort((a, b) => (a === '_default' ? -1 : b === '_default' ? 1 : 0));
    subtitles.forEach(subtitle => {
      const group = card[subtitle];
      if (!group || !Array.isArray(group.reminders)) return;
      group.reminders.forEach(reminder => {
        // A counter (interval) reminder has no date, even if an old schedule is still stored
        if (!reminder || reminder.type === 'interval' || !reminder.schedule) return;
        const days = reminderDays(reminder);
        if (typeof days !== 'number' || !Number.isFinite(days) || days > 0) return;
        reminders.push({ reminder, sectionId: section.id, subtitle, sectionTitle: section.title || '', days });
      });
    });
  });
  // Most overdue first; card order otherwise (Array.sort is stable)
  reminders.sort((a, b) => a.days - b.days);

  return { tasks, meetings, reminders };
}

// The badge number: tasks due, plus subtasks due, meetings today and reminders due
export function countDueItems(due) {
  return due.tasks.reduce((n, entry) => n + (entry.due ? 1 : 0) + entry.subtasks.length, 0) +
    due.meetings.length + due.reminders.length;
}
