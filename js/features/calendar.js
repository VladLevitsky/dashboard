// Personal Dashboard - Calendar Module
// Full calendar view that aggregates all dated items: reminders, tasks, subtasks, meetings

import { currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { getNextOccurrence } from './reminders.js';

let calendarModal = null;
let displayedMonth = null; // { year, month } currently shown
let selectedDay = null;    // Date string 'YYYY-MM-DD' of selected day

// ============================================================
// GATHER ALL DATED ITEMS
// ============================================================

function getAllDatedItems() {
  const data = currentData();
  const items = [];

  // 1. Reminders with schedules
  const sections = data.sections || [];
  sections.forEach(section => {
    const cardData = data[section.id];
    if (!cardData || typeof cardData !== 'object') return;
    Object.entries(cardData).forEach(([subtitle, group]) => {
      if (!group || !group.reminders) return;
      group.reminders.forEach(rem => {
        if (!rem.schedule) return;
        const nextDate = getNextOccurrence(rem.schedule);
        if (nextDate && !isNaN(nextDate.getTime())) {
          items.push({
            type: 'reminder',
            title: rem.title || 'Reminder',
            date: toDateStr(nextDate),
            color: '#ef4444',
            sectionTitle: section.title,
            schedule: rem.schedule
          });
        }
      });
    });
  });

  // 2. Tasks with due dates
  const tasks = data.tasks || [];
  tasks.forEach(task => {
    if (task.completed) return;
    if (task.dueDate) {
      items.push({
        type: 'task',
        title: task.title || 'Task',
        date: task.dueDate,
        color: getTaskColor(task.color),
        taskId: task.id
      });
    }
    // 2b. Subtasks with due dates
    if (task.subtasks) {
      task.subtasks.forEach(sub => {
        if (sub.completed) return;
        if (sub.dueDate) {
          items.push({
            type: 'subtask',
            title: sub.title || 'Subtask',
            date: sub.dueDate,
            color: getTaskColor(task.color),
            parentTask: task.title,
            taskId: task.id
          });
        }
      });
    }
  });

  // 3. Meetings with dates
  const meetings = data.meetings || [];
  meetings.forEach(meeting => {
    if (!meeting.date) return;
    if (meeting.type === 'routine' && meeting.repeat) {
      // Generate occurrences for the displayed month
      const occurrences = getRecurringMeetingDates(meeting);
      occurrences.forEach(dateStr => {
        items.push({
          type: 'meeting',
          title: meeting.title || 'Meeting',
          date: dateStr,
          color: '#8b5cf6',
          meetingId: meeting.id,
          recurring: true
        });
      });
    } else {
      items.push({
        type: 'meeting',
        title: meeting.title || 'Meeting',
        date: meeting.date,
        color: '#8b5cf6',
        meetingId: meeting.id
      });
    }
  });

  return items;
}

function getRecurringMeetingDates(meeting) {
  if (!meeting.date || !displayedMonth) return [];
  const dates = [];
  const baseDate = new Date(meeting.date + 'T00:00:00');
  if (isNaN(baseDate.getTime())) return [];

  const year = displayedMonth.year;
  const month = displayedMonth.month;
  // Check dates within the displayed month (with some padding for visible prev/next month days)
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month + 2, 0);

  if (meeting.repeat === 'weekly') {
    const interval = (meeting.repeatWeeks || 1) * 7;
    let d = new Date(baseDate);
    // Move to first occurrence at or after start
    if (d < start) {
      const diff = Math.ceil((start - d) / (interval * 86400000));
      d.setDate(d.getDate() + diff * interval);
    }
    while (d <= end) {
      dates.push(toDateStr(d));
      d = new Date(d);
      d.setDate(d.getDate() + interval);
    }
  } else if (meeting.repeat === 'monthly') {
    if (meeting.repeatMonthlyType === 'firstWeekday') {
      const weekday = baseDate.getDay();
      for (let m = month - 1; m <= month + 1; m++) {
        const y = m < 0 ? year - 1 : m > 11 ? year + 1 : year;
        const adjustedM = ((m % 12) + 12) % 12;
        const first = new Date(y, adjustedM, 1);
        const diff = (weekday - first.getDay() + 7) % 7;
        const d = new Date(y, adjustedM, 1 + diff);
        if (d >= start && d <= end) dates.push(toDateStr(d));
      }
    } else {
      const dayOfMonth = baseDate.getDate();
      for (let m = month - 1; m <= month + 1; m++) {
        const y = m < 0 ? year - 1 : m > 11 ? year + 1 : year;
        const adjustedM = ((m % 12) + 12) % 12;
        const d = new Date(y, adjustedM, dayOfMonth);
        if (d.getMonth() === adjustedM && d >= start && d <= end) dates.push(toDateStr(d));
      }
    }
  }
  return dates;
}

function getTaskColor(color) {
  const map = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', blue: '#3b82f6' };
  return map[color] || '#3b82f6';
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    <div class="calendar-view-dialog">
      <div class="calendar-view-header">
        <h4>Calendar</h4>
        <button type="button" class="calendar-view-close" title="Close">&times;</button>
      </div>
      <div class="calendar-view-body">
        <div class="calendar-view-nav">
          <button type="button" class="calendar-view-nav-btn" id="cal-prev" title="Previous month">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <span class="calendar-view-month-label" id="cal-month-label"></span>
          <button type="button" class="calendar-view-nav-btn" id="cal-next" title="Next month">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
        <div class="calendar-view-weekdays">
          <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
        </div>
        <div class="calendar-view-grid" id="cal-grid"></div>
        <div class="calendar-view-day-items" id="cal-day-items"></div>
      </div>
    </div>
  `;
  document.body.appendChild(calendarModal);

  calendarModal.querySelector('.calendar-view-backdrop').addEventListener('click', closeCalendarView);
  calendarModal.querySelector('.calendar-view-close').addEventListener('click', closeCalendarView);
  $('#cal-prev').addEventListener('click', () => navigateMonth(-1));
  $('#cal-next').addEventListener('click', () => navigateMonth(1));

  return calendarModal;
}

function navigateMonth(delta) {
  displayedMonth.month += delta;
  if (displayedMonth.month > 11) { displayedMonth.month = 0; displayedMonth.year++; }
  if (displayedMonth.month < 0) { displayedMonth.month = 11; displayedMonth.year--; }
  selectedDay = null;
  renderCalendarGrid();
}

export function openCalendarView() {
  const modal = getCalendarModal();
  const now = new Date();
  displayedMonth = { year: now.getFullYear(), month: now.getMonth() };
  selectedDay = toDateStr(now);
  modal.hidden = false;
  renderCalendarGrid();
}

export function closeCalendarView() {
  const modal = getCalendarModal();
  modal.hidden = true;
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

  const allItems = getAllDatedItems();
  const itemsByDate = {};
  allItems.forEach(item => {
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  });

  const year = displayedMonth.year;
  const month = displayedMonth.month;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayStr = toDateStr(new Date());

  // Previous month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const d = new Date(year, month - 1, day);
    grid.appendChild(createDayCell(d, toDateStr(d), itemsByDate, true, todayStr));
  }

  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    grid.appendChild(createDayCell(d, toDateStr(d), itemsByDate, false, todayStr));
  }

  // Next month padding to fill 6 rows
  const totalCells = grid.children.length;
  const remaining = (Math.ceil(totalCells / 7) * 7) - totalCells;
  for (let day = 1; day <= remaining; day++) {
    const d = new Date(year, month + 1, day);
    grid.appendChild(createDayCell(d, toDateStr(d), itemsByDate, true, todayStr));
  }

  renderDayItems(itemsByDate);
}

function createDayCell(date, dateStr, itemsByDate, isOtherMonth, todayStr) {
  const cell = document.createElement('div');
  cell.className = 'calendar-view-day';
  if (isOtherMonth) cell.classList.add('other-month');
  if (dateStr === todayStr) cell.classList.add('today');
  if (dateStr === selectedDay) cell.classList.add('selected');

  const dayNum = document.createElement('span');
  dayNum.className = 'calendar-view-day-num';
  dayNum.textContent = date.getDate();
  cell.appendChild(dayNum);

  const dateItems = itemsByDate[dateStr];
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
    document.querySelectorAll('.calendar-view-day.selected').forEach(el => el.classList.remove('selected'));
    cell.classList.add('selected');
    renderDayItems(itemsByDate);
  });

  return cell;
}

function renderDayItems(itemsByDate) {
  const container = $('#cal-day-items');
  container.innerHTML = '';

  if (!selectedDay) return;

  const items = itemsByDate[selectedDay] || [];
  if (items.length === 0) {
    container.innerHTML = '<div class="calendar-view-no-items">No items on this day</div>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'calendar-view-item';

    const dot = document.createElement('span');
    dot.className = 'calendar-view-item-dot';
    dot.style.backgroundColor = item.color;

    const label = document.createElement('span');
    label.className = 'calendar-view-item-label';

    const typeTag = document.createElement('span');
    typeTag.className = 'calendar-view-item-type';
    typeTag.textContent = item.type === 'subtask' ? 'Subtask' :
      item.type.charAt(0).toUpperCase() + item.type.slice(1);

    const title = document.createElement('span');
    title.className = 'calendar-view-item-title';
    title.textContent = item.title;

    label.appendChild(typeTag);
    label.appendChild(title);

    row.appendChild(dot);
    row.appendChild(label);

    // Click to open the relevant editor
    if (item.type === 'task' || item.type === 'subtask') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        if (item.taskId && window.openEditTaskModal) {
          window.openEditTaskModal(item.taskId);
        }
      });
    } else if (item.type === 'meeting') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        if (item.meetingId && window.openMeetingsModal) {
          window.openMeetingsModal();
        }
      });
    }

    container.appendChild(row);
  });
}

// ============================================================
// NOTIFICATION BADGE + POPOVER
// ============================================================

let notificationPopover = null;

function getUrgentItems() {
  const todayStr = toDateStr(new Date());
  const allItems = getAllDatedItems();
  const dueToday = [];
  const overdue = [];

  allItems.forEach(item => {
    if (!item.date) return;
    if (item.date === todayStr) {
      dueToday.push(item);
    } else if (item.date < todayStr) {
      overdue.push(item);
    }
  });

  return { dueToday, overdue };
}

export function updateNotificationBadge() {
  const badge = $('#notification-badge');
  if (!badge) return;

  const { dueToday, overdue } = getUrgentItems();
  const total = dueToday.length + overdue.length;

  if (total > 0) {
    badge.textContent = total;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function getNotificationPopover() {
  if (notificationPopover) return notificationPopover;
  notificationPopover = document.createElement('div');
  notificationPopover.className = 'notification-popover';
  notificationPopover.style.display = 'none';
  document.body.appendChild(notificationPopover);
  notificationPopover.addEventListener('mousedown', e => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (notificationPopover && !notificationPopover.contains(e.target) && !e.target.closest('#notification-badge')) {
      notificationPopover.style.display = 'none';
    }
  });
  return notificationPopover;
}

function showNotificationPopover() {
  const popover = getNotificationPopover();
  const badge = $('#notification-badge');
  const { dueToday, overdue } = getUrgentItems();

  if (dueToday.length === 0 && overdue.length === 0) return;

  popover.innerHTML = '';

  if (dueToday.length > 0) {
    const section = document.createElement('div');
    section.className = 'notification-section';
    const header = document.createElement('div');
    header.className = 'notification-section-header';
    header.textContent = 'Due Today';
    section.appendChild(header);
    dueToday.forEach(item => section.appendChild(createNotificationItem(item)));
    popover.appendChild(section);
  }

  if (overdue.length > 0) {
    const section = document.createElement('div');
    section.className = 'notification-section';
    const header = document.createElement('div');
    header.className = 'notification-section-header notification-section-overdue';
    header.textContent = 'Overdue';
    section.appendChild(header);
    overdue.forEach(item => section.appendChild(createNotificationItem(item)));
    popover.appendChild(section);
  }

  // Position relative to badge, clamped to viewport
  const rect = badge.getBoundingClientRect();
  popover.style.display = '';
  popover.style.visibility = 'hidden';
  popover.style.left = '0px';
  popover.style.top = '0px';
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  popover.style.visibility = '';

  let left = rect.right - pw;
  let top = rect.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function createNotificationItem(item) {
  const row = document.createElement('div');
  row.className = 'notification-item';

  const dot = document.createElement('span');
  dot.className = 'notification-item-dot';
  dot.style.backgroundColor = item.color;

  const info = document.createElement('div');
  info.className = 'notification-item-info';

  const title = document.createElement('span');
  title.className = 'notification-item-title';
  title.textContent = item.title;

  const type = document.createElement('span');
  type.className = 'notification-item-type';
  type.textContent = item.type.charAt(0).toUpperCase() + item.type.slice(1);

  info.appendChild(title);
  info.appendChild(type);
  row.appendChild(dot);
  row.appendChild(info);

  if (item.type === 'task' || item.type === 'subtask') {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      notificationPopover.style.display = 'none';
      if (item.taskId && window.openEditTaskModal) window.openEditTaskModal(item.taskId);
    });
  } else if (item.type === 'meeting') {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      notificationPopover.style.display = 'none';
      if (window.openMeetingsModal) window.openMeetingsModal();
    });
  }

  return row;
}

export function wireNotificationBadge() {
  const badge = $('#notification-badge');
  if (!badge) return;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    const popover = getNotificationPopover();
    if (popover.style.display !== 'none') {
      popover.style.display = 'none';
    } else {
      showNotificationPopover();
    }
  });
  updateNotificationBadge();
}
