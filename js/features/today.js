// Personal Dashboard - Today view
// The header's Today button opens one panel: everything due today or overdue
// (tasks with their due subtasks, today's meetings, due reminders) beside the
// Quick Access items. It replaced the old Quick Access panel.
//
// Every item is the real, working one. Task pills come from the Tasks panel:
// click opens the editor, the stopwatch runs the timer, long-press pins.
// Card items come from the cards: they open their link or file, copy, show
// their badges, and long-press takes them in or out of Quick Access.
// What counts as due lives in js/core/agenda.js (shared with the calendar
// and the notification badge).

import { model, editState } from '../state.js';
import { showToast, colorToGlassRgba, glassCompensateColor, isColorCode } from '../utils.js';
import { TASK_COLOR_LABELS } from '../constants.js';
import { TASK_COLOR_ORDER, countDueItems } from '../core/agenda.js';
import { fromDateKey } from '../core/quick-capture-parse.js';
import { getDueItems, openCalendarView, ownsEscape } from './calendar.js';
import { createTaskPillElement, getTaskById, updateTask, refreshTaskViews } from './tasks.js';
import { createCardItemElement } from '../components/sections.js';
import { getQuickAccessItems, reconcileQuickAccessItems, openQuickLinkModal } from './quick-access.js';
import { showActionToast } from './quick-capture.js';

const svg = (body, size = 18, width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const CALENDAR_SVG = svg('<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>');
const CLOSE_SVG = svg('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 18, 2.2);
const LINK_ADD_SVG = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>', 16);
const LINK_SVG = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>', 14);
const CHECK_SVG = svg('<polyline points="20 6 9 17 4 12"></polyline>', 14);
const MEETING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="16" height="16" fill="none" stroke="currentColor" stroke-width="27" stroke-miterlimit="10" aria-hidden="true" focusable="false"><rect x="29.96" y="45.23" width="340.09" height="237.96" rx="21.96" ry="21.96"/><line x1="29.96" y1="354.77" x2="370.04" y2="354.77"/><line x1="200" y1="288.6" x2="200" y2="342.77"/><circle cx="200" cy="135" r="32" stroke-width="22"/><path d="M138 230 c0-35 28-62 62-62 s62 27 62 62" stroke-width="22" stroke-linecap="round"/></svg>`;
const CHEVRON_SVG = svg('<polyline points="9 6 15 12 9 18"></polyline>', 14, 2.2);

let root = null;
let els = {};
let lastFocus = null;
let renderQueued = false;

// ============================================================
// OPEN / CLOSE / REFRESH
// ============================================================

export function isTodayViewOpen() {
  return !!root && !root.hidden;
}

export function openTodayView() {
  if (editState.enabled) {
    showToast('Today is off in edit mode. Save or cancel your edits first');
    return;
  }
  ensureDom();
  if (!root.hidden) return;
  lastFocus = document.activeElement;
  // Repair Quick Access entries (renamed items, older entries), then drop the
  // ones whose item was deleted (the old panel did this on open)
  const repaired = getQuickAccessItems().repaired;
  reconcileQuickAccessItems();
  if (repaired && window.renderAllSections) window.renderAllSections();
  root.hidden = false;
  render();
  els.body.scrollTop = 0;
  els.dialog.focus({ preventScroll: true });
}

export function closeTodayView() {
  if (!root || root.hidden) return;
  root.hidden = true;
  const focus = lastFocus;
  lastFocus = null;
  if (focus && document.contains(focus) && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
}

export function toggleTodayView() {
  if (isTodayViewOpen()) closeTodayView();
  else openTodayView();
}

// Repaint after anything changed (tasks, cards, Quick Access, meetings).
// One change often triggers several refresh calls in a row (matrix, cards,
// badge), so they are coalesced into a single render right after.
export function refreshTodayView() {
  if (!isTodayViewOpen()) return;
  if (editState.enabled) {
    closeTodayView();
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (isTodayViewOpen()) render();
  });
}

// ============================================================
// DOM
// ============================================================

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'today-modal';
  root.className = 'today-modal';
  root.hidden = true;
  root.innerHTML = `
    <div class="today-backdrop"></div>
    <div class="today-dialog" role="dialog" aria-modal="true" aria-labelledby="today-title" tabindex="-1">
      <div class="today-header">
        <div class="today-title-block">
          <h4 id="today-title">Today</h4>
          <span class="today-date" id="today-date"></span>
        </div>
        <div class="today-header-actions">
          <button type="button" class="today-icon-btn" id="today-open-calendar" title="Calendar" aria-label="Open the calendar">${CALENDAR_SVG}</button>
          <button type="button" class="today-icon-btn" id="today-close" title="Close (Esc)" aria-label="Close">${CLOSE_SVG}</button>
        </div>
      </div>
      <div class="today-body" id="today-body">
        <section class="today-column today-due" aria-labelledby="today-due-heading">
          <div class="today-column-head">
            <h5 class="eisenhower-section-heading today-heading" id="today-due-heading">Due today &amp; overdue</h5>
            <span class="today-count" id="today-due-count" hidden></span>
          </div>
          <div class="today-column-content" id="today-due-content"></div>
        </section>
        <section class="today-column today-qa" aria-labelledby="today-qa-heading">
          <div class="today-column-head">
            <h5 class="eisenhower-section-heading today-heading" id="today-qa-heading">Quick Access</h5>
            <span class="today-count" id="today-qa-count" hidden></span>
            <button type="button" class="today-icon-btn today-add-link" id="today-add-link" title="Add quick link" aria-label="Add quick link">${LINK_ADD_SVG}</button>
          </div>
          <div class="today-column-content" id="today-qa-content"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  els = {
    dialog: root.querySelector('.today-dialog'),
    body: root.querySelector('#today-body'),
    date: root.querySelector('#today-date'),
    dueCount: root.querySelector('#today-due-count'),
    dueContent: root.querySelector('#today-due-content'),
    qaCount: root.querySelector('#today-qa-count'),
    qaContent: root.querySelector('#today-qa-content'),
  };

  root.querySelector('.today-backdrop').addEventListener('click', closeTodayView);
  root.querySelector('#today-close').addEventListener('click', closeTodayView);
  root.querySelector('#today-open-calendar').addEventListener('click', () => openCalendarView());
  root.querySelector('#today-add-link').addEventListener('click', () => openQuickLinkModal());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isTodayViewOpen() || !ownsEscape(root, e)) return;
    e.preventDefault();
    closeTodayView();
  });
}

function render() {
  const scrollTop = els.body.scrollTop;
  const now = new Date();
  els.date.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderDue();
  renderQuickAccess();
  els.body.scrollTop = scrollTop;
}

function setCount(el, n) {
  el.hidden = n === 0;
  el.textContent = n > 0 ? String(n) : '';
}

function subheading(text) {
  const h = document.createElement('h6');
  h.className = 'today-subheading';
  h.textContent = text;
  return h;
}

function emptyState(text) {
  const el = document.createElement('div');
  el.className = 'today-empty';
  el.textContent = text;
  return el;
}

// ============================================================
// DUE TODAY & OVERDUE
// ============================================================

function renderDue() {
  const due = getDueItems();
  const host = els.dueContent;
  host.textContent = '';
  setCount(els.dueCount, countDueItems(due));

  if (due.tasks.length === 0 && due.meetings.length === 0 && due.reminders.length === 0) {
    host.appendChild(emptyState('Nothing is due today or overdue.'));
    return;
  }

  // Tasks: one tinted group per priority color, red on top
  if (due.tasks.length > 0) {
    const tasksWrap = document.createElement('div');
    tasksWrap.className = 'today-tasks';
    TASK_COLOR_ORDER.forEach(color => {
      const entries = due.tasks.filter(({ task }) => (TASK_COLOR_ORDER.includes(task.color) ? task.color : 'blue') === color);
      if (entries.length === 0) return;
      const group = document.createElement('div');
      // The matrix column classes give the group its tint and the pills their hue
      group.className = `eisenhower-priority-card eisenhower-priority-card-${color} today-color-group`;
      const label = document.createElement('div');
      label.className = 'today-color-label';
      label.textContent = TASK_COLOR_LABELS[color] || '';
      group.appendChild(label);
      entries.forEach((entry, i) => group.appendChild(createTaskEntry(entry, i)));
      tasksWrap.appendChild(group);
    });
    host.appendChild(tasksWrap);
  }

  if (due.meetings.length > 0) {
    host.appendChild(subheading('Meetings today'));
    const list = document.createElement('div');
    list.className = 'today-meetings';
    due.meetings.forEach(entry => list.appendChild(createMeetingRow(entry)));
    host.appendChild(list);
  }

  if (due.reminders.length > 0) {
    host.appendChild(subheading('Reminders'));
    const group = document.createElement('div');
    group.className = 'unified-reminders-group today-reminders';
    due.reminders.forEach(({ reminder, sectionId, subtitle, sectionTitle }) => {
      const el = createCardItemElement('reminder', reminder, sectionId, subtitle);
      if (!el) return;
      el.title = subtitle && subtitle !== '_default' ? `${sectionTitle} › ${subtitle}` : sectionTitle;
      group.appendChild(el);
    });
    host.appendChild(group);
  }
}

function formatDay(dateKey) {
  const date = fromDateKey(dateKey);
  return date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : dateKey;
}

// "Today" or "Overdue · 3d"
function dueChip(due) {
  const chip = document.createElement('span');
  chip.className = `today-chip ${due.when === 'today' ? 'is-today' : 'is-overdue'}`;
  if (due.when === 'today') {
    chip.textContent = 'Today';
    chip.title = 'Due today';
  } else {
    chip.textContent = `Overdue · ${due.days}d`;
    chip.title = `Was due ${formatDay(due.date)} (${due.days} day${due.days === 1 ? '' : 's'} ago)`;
  }
  return chip;
}

// A task pill (exactly as in the Tasks panel) with its due subtasks below it.
// When only a subtask is due, the pill steps back (outlined, dimmer) and says
// so, and the subtask rows below carry the due dates.
// Pinned pills breathe; in the matrix their phase comes from :nth-child, but
// here every pill is the first child of its entry, so give each its own beat
// (the same 3 durations x 4 delays the matrix cycles through)
const PIN_DURATIONS = ['6.3s', '7.7s', '5.4s'];
const PIN_DELAYS = ['-2.2s', '-5.1s', '-0.9s', '-3.7s'];

function createTaskEntry({ task, due, subtasks }, index) {
  const entry = document.createElement('div');
  entry.className = 'today-task';

  const pill = createTaskPillElement(task);
  pill.style.setProperty('--fx-t-dur', PIN_DURATIONS[index % 3]);
  pill.style.setProperty('--fx-t-delay', PIN_DELAYS[index % 4]);
  const icons = pill.querySelector('.eisenhower-task-icons');
  if (due) {
    icons.prepend(dueChip(due));
  } else {
    pill.classList.add('today-task-context');
    const chip = document.createElement('span');
    chip.className = 'today-chip is-context';
    chip.textContent = subtasks.length === 1 ? 'Subtask due' : `${subtasks.length} subtasks due`;
    chip.title = task.dueDate ? `The task itself is due ${formatDay(task.dueDate)}` : 'The task itself has no due date';
    icons.prepend(chip);
  }
  entry.appendChild(pill);

  if (subtasks.length > 0) {
    const list = document.createElement('div');
    list.className = 'today-subtasks';
    subtasks.forEach(item => list.appendChild(createSubtaskRow(task, item)));
    entry.appendChild(list);
  }
  return entry;
}

// Subtask row (same glass bubble as in the task editor): the check completes
// it (with Undo), anywhere else opens the task
function createSubtaskRow(task, { subtask, due }) {
  const row = document.createElement('div');
  row.className = 'task-subtask-row subtask-bubble today-subtask' + (subtask.important ? ' subtask-bubble-important' : '');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = `Open “${task.title || 'Untitled Task'}”`;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'task-subtask-complete-btn';
  check.title = 'Mark complete';
  check.setAttribute('aria-label', `Complete “${subtask.title}”`);
  check.innerHTML = CHECK_SVG;
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    completeSubtask(task.id, subtask);
  });

  const title = document.createElement('span');
  title.className = 'today-subtask-title';
  title.textContent = subtask.title;

  row.append(check, title, dueChip(due));

  const open = () => { if (window.openEditTaskModal) window.openEditTaskModal(task.id); };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return row;
}

// Same rule as the task editor's check: done also clears its importance and date
function completeSubtask(taskId, subtask) {
  const task = getTaskById(taskId);
  if (!task || !Array.isArray(task.subtasks) || !task.subtasks.includes(subtask)) return;
  const before = { completed: !!subtask.completed, important: !!subtask.important, dueDate: subtask.dueDate || null };
  subtask.completed = true;
  subtask.important = false;
  subtask.dueDate = null;
  updateTask(taskId, { subtasks: task.subtasks });
  refreshTaskViews();

  showActionToast(`Completed “${subtask.title}”`, [{
    label: 'Undo',
    run: () => {
      const current = getTaskById(taskId);
      if (!current || !Array.isArray(current.subtasks) || !current.subtasks.includes(subtask)) {
        showToast('Can’t undo: the task has changed since');
        return;
      }
      Object.assign(subtask, before);
      updateTask(taskId, { subtasks: current.subtasks });
      refreshTaskViews();
    }
  }]);
}

function createMeetingRow({ meeting, recurring }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'today-meeting';
  row.title = 'Open meeting';

  const icon = document.createElement('span');
  icon.className = 'today-meeting-icon';
  icon.innerHTML = MEETING_SVG;

  const title = document.createElement('span');
  title.className = 'today-meeting-title';
  title.textContent = meeting.title || 'Untitled meeting';

  row.append(icon, title);
  if (recurring) {
    const tag = document.createElement('span');
    tag.className = 'today-chip is-meeting';
    tag.textContent = 'Recurring';
    row.appendChild(tag);
  }
  const chevron = document.createElement('span');
  chevron.className = 'today-meeting-chevron';
  chevron.innerHTML = CHEVRON_SVG;
  row.appendChild(chevron);

  row.addEventListener('click', () => {
    if (window.openMeetingsModal) window.openMeetingsModal(meeting.id);
  });
  return row;
}

// ============================================================
// QUICK ACCESS
// ============================================================

function renderQuickAccess() {
  const qa = getQuickAccessItems();
  const host = els.qaContent;
  host.textContent = '';
  const total = qa.icons.length + qa.reminders.length + qa.subtasks.length + qa.copyPaste.length + qa.quickLinks.length;
  setCount(els.qaCount, total);

  if (total === 0) {
    host.appendChild(emptyState('Hold any icon or item on a card for a moment to add it here. Hold it again to take it out.'));
    return;
  }

  // Card order: icons, reminders, subtasks, copy-paste (color swatches in their own row)
  const group = (className, entries, type) => {
    if (entries.length === 0) return;
    const el = document.createElement('div');
    el.className = className;
    entries.forEach(({ item, sectionId, subtitle }) => {
      const itemEl = createCardItemElement(type, item, sectionId, subtitle);
      if (itemEl) el.appendChild(itemEl);
    });
    if (el.children.length > 0) host.appendChild(el);
  };
  group('unified-icons-group today-qa-icons', qa.icons, 'icon');
  group('unified-reminders-group', qa.reminders, 'reminder');
  group('unified-subtasks-group', qa.subtasks, 'subtask');
  const isSwatch = ({ item }) => isColorCode((item.copyText || '').trim());
  group('unified-copypaste-group', qa.copyPaste.filter(e => !isSwatch(e)), 'copyPaste');
  group('unified-swatch-group', qa.copyPaste.filter(isSwatch), 'copyPaste');

  if (qa.quickLinks.length > 0) {
    if (host.children.length > 0) host.appendChild(subheading('Links'));
    const links = document.createElement('div');
    links.className = 'unified-subtasks-group today-quick-links';
    qa.quickLinks.forEach(link => links.appendChild(createQuickLinkPill(link)));
    host.appendChild(links);
  }
}

// Quick links (added with the link button) look like card subtasks
function createQuickLinkPill(link) {
  const pill = document.createElement('div');
  pill.className = 'unified-subtask-item today-quick-link';
  pill.tabIndex = 0;
  pill.setAttribute('role', 'link');
  pill.title = link.url;
  const base = model.darkMode ? glassCompensateColor('#334155') : '#f7fafc';
  pill.style.background = colorToGlassRgba(base, 0.55);
  pill.style.backdropFilter = 'blur(8px)';
  pill.style.webkitBackdropFilter = 'blur(8px)';

  const left = document.createElement('div');
  left.className = 'unified-subtask-left';
  const icon = document.createElement('span');
  icon.className = 'today-quick-link-icon';
  icon.innerHTML = LINK_SVG;
  const text = document.createElement('span');
  text.textContent = link.title || link.url;
  left.append(icon, text);
  pill.appendChild(left);

  const open = () => window.open(link.url, '_blank', 'noopener,noreferrer');
  pill.addEventListener('click', open);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); open(); }
  });
  return pill;
}
