// Personal Dashboard - Calendar Module
// Month calendar of every dated item (reminders, tasks, subtasks, meetings),
// with the Due Today + Overdue list beside it. Opened from the notification
// badge on the profile photo, which counts what is due today or overdue.
// What counts as due lives in js/core/agenda.js (shared with the Today view).

import { currentData } from '../state.js';
import { $ } from '../utils.js';
import { PLACEHOLDER_URL } from '../constants.js';
import { getNextOccurrence, daysUntil } from './reminders.js';
import { toDateKey, fromDateKey } from '../core/quick-capture-parse.js';
import { collectDueItems, countDueItems, meetingDatesBetween, addDays } from '../core/agenda.js';

const TASK_COLOR_HEX = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', blue: '#3b82f6' };
const MEETING_COLOR = '#8b5cf6';
const REMINDER_COLOR = '#14b8a6';

const CALENDAR_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="16.5" rx="3"></rect><line x1="16" y1="2.5" x2="16" y2="6.5"></line><line x1="8" y1="2.5" x2="8" y2="6.5"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;

let calendarModal = null;
let displayedMonth = null; // { year, month } currently shown
let selectedDay = null;    // 'YYYY-MM-DD' of the selected day

// ============================================================
// WHAT IS DUE (shared with the Today view)
// ============================================================

// Whole days until a reminder's next date, counted like its card badge
export function reminderDaysLeft(reminder) {
  try {
    const next = getNextOccurrence(reminder.schedule);
    if (!(next instanceof Date) || isNaN(next.getTime())) return null;
    return daysUntil(next);
  } catch (e) {
    return null;
  }
}

// Everything due today or overdue (see collectDueItems in core/agenda.js)
export function getDueItems() {
  return collectDueItems(currentData(), { todayKey: toDateKey(new Date()), reminderDays: reminderDaysLeft });
}

function taskColorHex(color) {
  return TASK_COLOR_HEX[color] || TASK_COLOR_HEX.blue;
}

// Open a reminder the way its card does: its file, else its link
function openReminderTarget(reminder) {
  if (reminder.linkType === 'file' && reminder.fileId) {
    if (window.openFile) window.openFile(reminder.fileId, reminder.fileName);
  } else if (reminder.url && reminder.url !== PLACEHOLDER_URL) {
    window.open(reminder.url, '_blank', 'noopener,noreferrer');
  }
}

// ============================================================
// DATED ITEMS FOR THE MONTH GRID
// ============================================================

// Items dated between two day keys (inclusive), grouped by day
function getDatedItemsByDay(startKey, endKey) {
  const data = currentData();
  const byDay = {};
  const add = (item) => {
    if (!item.date || item.date < startKey || item.date > endKey) return;
    (byDay[item.date] = byDay[item.date] || []).push(item);
  };

  // 1. Reminders: their next date, as the card badge shows it (counters have none)
  (data.sections || []).forEach(section => {
    const cardData = data[section.id];
    if (!cardData || typeof cardData !== 'object') return;
    Object.values(cardData).forEach(group => {
      if (!group || !Array.isArray(group.reminders)) return;
      group.reminders.forEach(rem => {
        if (!rem || !rem.schedule || rem.type === 'interval') return;
        const next = getNextOccurrence(rem.schedule);
        if (!(next instanceof Date) || isNaN(next.getTime())) return;
        add({ type: 'reminder', title: rem.title || 'Reminder', date: toDateKey(next), color: REMINDER_COLOR, reminder: rem, detail: section.title || '' });
      });
    });
  });

  // 2. Tasks and their subtasks with due dates
  (data.tasks || []).forEach(task => {
    if (task.completed) return;
    if (task.dueDate) {
      add({ type: 'task', title: task.title || 'Untitled Task', date: task.dueDate, color: taskColorHex(task.color), taskId: task.id });
    }
    (task.subtasks || []).forEach(sub => {
      if (sub.completed || !sub.dueDate) return;
      add({ type: 'subtask', title: sub.title || 'Subtask', date: sub.dueDate, color: taskColorHex(task.color), taskId: task.id, detail: task.title || '' });
    });
  });

  // 3. Meetings: one-time dates and every recurring occurrence in range
  (data.meetings || []).forEach(meeting => {
    meetingDatesBetween(meeting, startKey, endKey).forEach(date => {
      add({ type: 'meeting', title: meeting.title || 'Meeting', date, color: MEETING_COLOR, meetingId: meeting.id, detail: meeting.type === 'routine' && meeting.repeat && meeting.repeat !== 'none' ? 'Recurring' : '' });
    });
  });

  return byDay;
}

// ============================================================
// CALENDAR MODAL
// ============================================================

function getCalendarModal() {
  if (calendarModal) return calendarModal;
  calendarModal = document.createElement('div');
  calendarModal.id = 'calendar-view-modal';
  calendarModal.className = 'calendar-view-modal';
  calendarModal.hidden = true;
  calendarModal.innerHTML = `
    <div class="calendar-view-backdrop"></div>
    <div class="calendar-view-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-title">
      <div class="calendar-view-header">
        <h4 id="cal-title">Calendar</h4>
        <button type="button" class="calendar-view-close" title="Close (Esc)" aria-label="Close">&times;</button>
      </div>
      <div class="calendar-view-body">
        <div class="calendar-view-main">
          <div class="calendar-view-nav">
            <button type="button" class="calendar-view-nav-btn" id="cal-prev" title="Previous month" aria-label="Previous month">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button type="button" class="calendar-view-month-label" id="cal-month-label" title="Back to today"></button>
            <button type="button" class="calendar-view-nav-btn" id="cal-next" title="Next month" aria-label="Next month">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
          <div class="calendar-view-weekdays">
            <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
          </div>
          <div class="calendar-view-grid" id="cal-grid"></div>
          <div class="calendar-view-day-items" id="cal-day-items"></div>
        </div>
        <aside class="calendar-view-due" id="cal-due" aria-label="Due today and overdue"></aside>
      </div>
    </div>
  `;
  document.body.appendChild(calendarModal);

  calendarModal.querySelector('.calendar-view-backdrop').addEventListener('click', closeCalendarView);
  calendarModal.querySelector('.calendar-view-close').addEventListener('click', closeCalendarView);
  $('#cal-prev').addEventListener('click', () => navigateMonth(-1));
  $('#cal-next').addEventListener('click', () => navigateMonth(1));
  $('#cal-month-label').addEventListener('click', () => {
    const now = new Date();
    displayedMonth = { year: now.getFullYear(), month: now.getMonth() };
    selectedDay = null;
    renderCalendarGrid();
  });
  // Esc closes the calendar unless something opened on top of it (task editor, meeting)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || calendarModal.hidden || !ownsEscape(calendarModal, e)) return;
    e.preventDefault();
    closeCalendarView();
  });

  return calendarModal;
}

// Esc belongs to this modal when nothing has handled it yet, focus isn't in
// another window (task editor, quick capture...) and nothing covers the dialog
export function ownsEscape(modal, e) {
  if (e.defaultPrevented) return false;
  if (e.target !== document.body && !modal.contains(e.target)) return false;
  const dialog = modal.querySelector('[role="dialog"]') || modal;
  const rect = dialog.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 60));
  return !!hit && modal.contains(hit);
}

function navigateMonth(delta) {
  displayedMonth.month += delta;
  if (displayedMonth.month > 11) { displayedMonth.month = 0; displayedMonth.year++; }
  if (displayedMonth.month < 0) { displayedMonth.month = 11; displayedMonth.year--; }
  selectedDay = null;
  renderCalendarGrid();
}

// Opens on this month with no day picked: today's items are already listed
// on the right, so the list under the grid waits for a click on a day
export function openCalendarView() {
  const modal = getCalendarModal();
  const now = new Date();
  displayedMonth = { year: now.getFullYear(), month: now.getMonth() };
  selectedDay = null;
  modal.hidden = false;
  renderCalendarGrid();
}

export function closeCalendarView() {
  const modal = getCalendarModal();
  modal.hidden = true;
}

// Re-render an open calendar after items changed elsewhere
export function refreshCalendarView() {
  if (!calendarModal || calendarModal.hidden || !displayedMonth) return;
  renderCalendarGrid();
}

// ============================================================
// RENDER CALENDAR
// ============================================================

function renderCalendarGrid() {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  $('#cal-month-label').textContent = `${monthNames[displayedMonth.month]} ${displayedMonth.year}`;

  const grid = $('#cal-grid');
  grid.innerHTML = '';

  const year = displayedMonth.year;
  const month = displayedMonth.month;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const startKey = toDateKey(new Date(year, month, 1 - firstDay));
  const endKey = addDays(startKey, totalCells - 1);
  const itemsByDay = getDatedItemsByDay(startKey, endKey);
  const todayKey = toDateKey(new Date());

  for (let i = 0; i < totalCells; i++) {
    const key = addDays(startKey, i);
    const date = fromDateKey(key);
    grid.appendChild(createDayCell(date, key, itemsByDay, date.getMonth() !== month, todayKey));
  }

  renderDayItems(itemsByDay);
  renderDuePanel();
}

function createDayCell(date, dateStr, itemsByDay, isOtherMonth, todayStr) {
  const cell = document.createElement('div');
  cell.className = 'calendar-view-day';
  if (isOtherMonth) cell.classList.add('other-month');
  if (dateStr === todayStr) cell.classList.add('today');
  if (dateStr === selectedDay) cell.classList.add('selected');

  const dayNum = document.createElement('span');
  dayNum.className = 'calendar-view-day-num';
  dayNum.textContent = date.getDate();
  cell.appendChild(dayNum);

  const dateItems = itemsByDay[dateStr];
  if (dateItems && dateItems.length > 0) {
    const indicator = document.createElement('span');
    indicator.className = 'calendar-view-day-indicator';
    const dot = document.createElement('span');
    dot.className = 'calendar-view-dot';
    indicator.appendChild(dot);
    if (dateItems.length > 1) {
      const count = document.createElement('span');
      count.className = 'calendar-view-dot-count';
      count.textContent = `+${dateItems.length - 1}`;
      indicator.appendChild(count);
    }
    cell.appendChild(indicator);
  }

  cell.addEventListener('click', () => {
    selectedDay = dateStr;
    calendarModal.querySelectorAll('.calendar-view-day.selected').forEach(el => el.classList.remove('selected'));
    cell.classList.add('selected');
    renderDayItems(itemsByDay);
  });

  return cell;
}

function renderDayItems(itemsByDay) {
  const container = $('#cal-day-items');
  container.innerHTML = '';
  if (!selectedDay) {
    const hint = document.createElement('div');
    hint.className = 'calendar-view-day-hint';
    hint.textContent = 'Pick a day to see what’s on it';
    container.appendChild(hint);
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'calendar-view-list-heading';
  heading.textContent = fromDateKey(selectedDay).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  container.appendChild(heading);

  const items = itemsByDay[selectedDay] || [];
  if (items.length === 0) {
    container.appendChild(emptyLine('No items on this day'));
    return;
  }
  items.forEach(item => container.appendChild(createItemRow(item)));
}

// One clickable row: colored dot, type, title, an optional detail and chip
function createItemRow(item) {
  const row = document.createElement('div');
  row.className = 'calendar-view-item';

  const dot = document.createElement('span');
  dot.className = 'calendar-view-item-dot';
  dot.style.backgroundColor = item.color;

  const label = document.createElement('span');
  label.className = 'calendar-view-item-label';

  const typeTag = document.createElement('span');
  typeTag.className = 'calendar-view-item-type';
  typeTag.textContent = item.type === 'copyPaste' ? 'Item' : item.type.charAt(0).toUpperCase() + item.type.slice(1);

  const title = document.createElement('span');
  title.className = 'calendar-view-item-title';
  title.textContent = item.title;

  label.append(typeTag, title);
  if (item.detail) {
    const detail = document.createElement('span');
    detail.className = 'calendar-view-item-detail';
    detail.textContent = item.type === 'subtask' ? `in ${item.detail}` : item.detail;
    label.appendChild(detail);
  }
  row.append(dot, label);

  if (item.overdueDays) {
    const chip = document.createElement('span');
    chip.className = 'calendar-view-item-chip';
    chip.textContent = `${item.overdueDays}d`;
    chip.title = `${item.overdueDays} day${item.overdueDays === 1 ? '' : 's'} overdue`;
    row.appendChild(chip);
  }

  let open = null;
  if ((item.type === 'task' || item.type === 'subtask') && item.taskId) {
    open = () => window.openEditTaskModal && window.openEditTaskModal(item.taskId);
  } else if (item.type === 'meeting' && item.meetingId) {
    open = () => window.openMeetingsModal && window.openMeetingsModal(item.meetingId);
  } else if (item.type === 'reminder' && item.reminder &&
    ((item.reminder.linkType === 'file' && item.reminder.fileId) || (item.reminder.url && item.reminder.url !== PLACEHOLDER_URL))) {
    open = () => openReminderTarget(item.reminder);
  }
  if (open) {
    row.classList.add('is-clickable');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
  return row;
}

function emptyLine(text) {
  const el = document.createElement('div');
  el.className = 'calendar-view-no-items';
  el.textContent = text;
  return el;
}

// ============================================================
// DUE TODAY + OVERDUE (right of the calendar)
// ============================================================

// The due items as calendar rows, split into today / overdue (oldest first)
function getDueRows() {
  const due = getDueItems();
  const today = [];
  const overdue = [];
  const place = (row, days) => {
    if (days > 0) overdue.push({ ...row, overdueDays: days });
    else today.push(row);
  };

  due.tasks.forEach(({ task, due: own, subtasks }) => {
    const color = taskColorHex(task.color);
    if (own) place({ type: 'task', title: task.title || 'Untitled Task', color, taskId: task.id }, own.days);
    subtasks.forEach(({ subtask, due: subDue }) => {
      place({ type: 'subtask', title: subtask.title, color, taskId: task.id, detail: task.title || 'Untitled Task' }, subDue.days);
    });
  });
  due.meetings.forEach(({ meeting, recurring }) => {
    today.push({ type: 'meeting', title: meeting.title || 'Meeting', color: MEETING_COLOR, meetingId: meeting.id, detail: recurring ? 'Recurring' : '' });
  });
  due.reminders.forEach(({ reminder, sectionTitle, days }) => {
    place({ type: 'reminder', title: reminder.title || 'Reminder', color: REMINDER_COLOR, reminder, detail: sectionTitle }, -days);
  });

  overdue.sort((a, b) => b.overdueDays - a.overdueDays);
  return { today, overdue };
}

function renderDuePanel() {
  const panel = $('#cal-due');
  if (!panel) return;
  panel.innerHTML = '';
  const { today, overdue } = getDueRows();

  const addSection = (titleText, rows, extraClass, emptyText) => {
    const section = document.createElement('div');
    section.className = `calendar-view-due-section${extraClass ? ' ' + extraClass : ''}`;
    const heading = document.createElement('div');
    heading.className = 'calendar-view-list-heading';
    heading.textContent = titleText;
    if (rows.length > 0) {
      const count = document.createElement('span');
      count.className = 'calendar-view-list-count';
      count.textContent = rows.length;
      heading.appendChild(count);
    }
    section.appendChild(heading);
    if (rows.length === 0) section.appendChild(emptyLine(emptyText));
    rows.forEach(row => section.appendChild(createItemRow(row)));
    panel.appendChild(section);
  };

  addSection('Due Today', today, '', 'Nothing due today');
  if (overdue.length > 0) addSection('Overdue', overdue, 'is-overdue', '');
}

// ============================================================
// NOTIFICATION BADGE (profile photo) → opens the calendar
// ============================================================

// Always shown so the calendar stays one click away: the count when something
// is due today or overdue, a quiet calendar glyph otherwise. Everything else
// that lists due items (an open calendar, the Today view) repaints with it.
export function updateNotificationBadge() {
  const badge = $('#notification-badge');
  if (badge) {
    const total = countDueItems(getDueItems());
    const state = total > 0 ? String(total) : 'clear';
    if (badge.dataset.state !== state) {
      badge.dataset.state = state;
      badge.classList.toggle('is-clear', total === 0);
      if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
      } else {
        badge.innerHTML = CALENDAR_GLYPH;
      }
      const label = total > 0
        ? `${total} item${total === 1 ? '' : 's'} due today or overdue. Open the calendar`
        : 'Nothing due today. Open the calendar';
      badge.title = label;
      badge.setAttribute('aria-label', label);
    }
    badge.hidden = false;
  }
  refreshCalendarView();
  if (window.refreshTodayView) window.refreshTodayView();
}

export function wireNotificationBadge() {
  const badge = $('#notification-badge');
  if (!badge) return;
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCalendarView();
  };
  badge.addEventListener('click', open);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') open(e);
  });
  updateNotificationBadge();
}
