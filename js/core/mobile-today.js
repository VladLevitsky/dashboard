// Personal Dashboard - Mobile shell: Today rules (pure: no DOM, Node-testable)
// The Today tab is rebuilt from the agenda (core/agenda.js), so it always
// agrees with the due lens and the calendar: buildToday() only SHAPES what
// collectDueItems() returned (one lane per colour, red → blue, agenda order
// kept inside a lane); comingUp() lists what falls in the next few days.
//
// Dates are 'YYYY-MM-DD' local day keys (agenda.js rules, never toISOString).

import { TASK_COLOR_ORDER, countDueItems, addDays, daysBetween, dueState, meetingDatesBetween } from './agenda.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Unknown colours read as blue (the agenda's colorRank rule)
export function laneColor(color) {
  return TASK_COLOR_ORDER.includes(color) ? color : 'blue';
}

// 'Today' | 'Overdue · 3d' for an agenda due state
export function dueChipText(due) {
  if (!due) return '';
  return due.when === 'today' ? 'Today' : `Overdue · ${due.days}d`;
}

// The chip a context-only task shows (only its subtasks are due)
export function contextChipText(subtaskCount) {
  return subtaskCount === 1 ? 'Subtask due' : `${subtaskCount} subtasks due`;
}

// due = collectDueItems(...) →
// { count, lanes: [{ color, entries: [{ task, due, subtasks, contextOnly, chip }] }],
//   meetings, reminders, totals: { tasks, subtasks, meetings, reminders } }
// count === countDueItems(due) === the sum of totals. Empty lanes are left out.
export function buildToday(due, { todayKey } = {}) {
  const src = due || { tasks: [], meetings: [], reminders: [] };
  const byColor = new Map(TASK_COLOR_ORDER.map(c => [c, []]));
  let subtaskTotal = 0;
  (src.tasks || []).forEach(entry => {
    if (!entry || !entry.task) return;
    const subtasks = Array.isArray(entry.subtasks) ? entry.subtasks : [];
    subtaskTotal += subtasks.length;
    const contextOnly = !entry.due;
    byColor.get(laneColor(entry.task.color)).push({
      task: entry.task,
      due: entry.due || null,
      subtasks,
      contextOnly,
      chip: contextOnly ? contextChipText(subtasks.length) : dueChipText(entry.due),
    });
  });
  const lanes = TASK_COLOR_ORDER
    .map(color => ({ color, entries: byColor.get(color) }))
    .filter(lane => lane.entries.length > 0);
  const meetings = (src.meetings || []).slice();
  const reminders = (src.reminders || []).slice();
  return {
    todayKey: todayKey || null,
    count: countDueItems({ tasks: src.tasks || [], meetings, reminders }),
    lanes,
    meetings,
    reminders,
    totals: {
      // A context-only task (only its subtasks are due) is counted through
      // those subtasks, as countDueItems does, so the parts add up to count
      tasks: lanes.reduce((n, lane) => n + lane.entries.filter(e => !e.contextOnly).length, 0),
      subtasks: subtaskTotal,
      meetings: meetings.length,
      reminders: reminders.length,
    },
  };
}

// "6 tasks · 2 reminders" (only the parts that are there; '' when nothing)
export function dueSummary(today) {
  const t = (today && today.totals) || {};
  const part = (n, one, many) => (n > 0 ? `${n} ${n === 1 ? one : many}` : null);
  return [
    part(t.tasks, 'task', 'tasks'),
    part(t.subtasks, 'subtask', 'subtasks'),
    part(t.meetings, 'meeting', 'meetings'),
    part(t.reminders, 'reminder', 'reminders'),
  ].filter(Boolean).join(' · ');
}

// 'Mon 5' for a day key
export function comingDayLabel(dateKey) {
  if (typeof dateKey !== 'string' || !DATE_KEY_RE.test(dateKey)) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
}

const KIND_RANK = { task: 0, subtask: 1, meeting: 2, reminder: 3 };

// What falls in the next `days` days (tomorrow .. today+days), soonest first:
// open tasks and subtasks by due date, meeting occurrences, and dated
// reminders whose next date is 1..days away (reminderDays(reminder) counts like
// the card badge; counters have no date).
// → [{ kind, date, days, label, title, taskId?, subtaskId?, color?, meetingId?,
//      reminder?, sectionId?, subtitle?, detail? }]
export function comingUp(data, { todayKey, days = 7, reminderDays = null } = {}) {
  if (!data || typeof todayKey !== 'string' || !DATE_KEY_RE.test(todayKey)) return [];
  const first = addDays(todayKey, 1);
  const last = addDays(todayKey, days);
  const inRange = (key) => typeof key === 'string' && DATE_KEY_RE.test(key) && key >= first && key <= last;
  const out = [];
  const push = (item) => out.push({ ...item, days: daysBetween(todayKey, item.date), label: comingDayLabel(item.date) });

  (data.tasks || []).forEach(task => {
    if (!task || task.completed) return;
    const title = task.title || 'Untitled task';
    if (inRange(task.dueDate)) {
      push({ kind: 'task', date: task.dueDate, title, taskId: task.id, color: laneColor(task.color) });
    }
    (Array.isArray(task.subtasks) ? task.subtasks : []).forEach(sub => {
      if (!sub || sub.completed || !sub.title || !String(sub.title).trim()) return;
      // A subtask already due today is in Due & overdue, not here
      if (!inRange(sub.dueDate) || dueState(sub.dueDate, todayKey)) return;
      push({ kind: 'subtask', date: sub.dueDate, title: sub.title, taskId: task.id, subtaskId: sub.id,
        color: laneColor(task.color), detail: title });
    });
  });

  (data.meetings || []).forEach(meeting => {
    meetingDatesBetween(meeting, first, last).forEach(date => {
      push({ kind: 'meeting', date, title: meeting.title || 'Meeting', meetingId: meeting.id });
    });
  });

  if (typeof reminderDays === 'function') {
    (data.sections || []).forEach(section => {
      const card = section && data[section.id];
      if (!card || typeof card !== 'object') return;
      Object.keys(card).forEach(subtitle => {
        const group = card[subtitle];
        if (!group || !Array.isArray(group.reminders)) return;
        group.reminders.forEach(reminder => {
          if (!reminder || reminder.type === 'interval' || !reminder.schedule) return;
          let d = null;
          try { d = reminderDays(reminder); } catch { d = null; }
          if (typeof d !== 'number' || !Number.isFinite(d) || d < 1 || d > days) return;
          push({ kind: 'reminder', date: addDays(todayKey, d), title: reminder.title || 'Reminder', reminder,
            sectionId: section.id, subtitle, detail: section.title || '' });
        });
      });
    });
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    String(a.title).localeCompare(String(b.title)));
  return out;
}

// A stable key for one coming-up row (keyed patching)
export function comingKey(item) {
  if (!item) return '';
  if (item.kind === 'task') return `task|${item.taskId}`;
  if (item.kind === 'subtask') return `sub|${item.taskId}|${item.subtaskId}`;
  if (item.kind === 'meeting') return `meet|${item.meetingId}|${item.date}`;
  return `rem|${item.sectionId}|${item.subtitle}|${item.reminder && item.reminder.key}`;
}
