// Personal Dashboard - Mobile shell: Today (unit F4, entry module)
// The Today tab, rebuilt from the pure agenda rules (core/agenda.js through
// calendar.js getDueItems), so it always agrees with the due lens and the
// calendar. The desktop Today modal (today.js) is untouched and never opened.
//   1. Due & overdue: one tinted pane per colour (red → blue, agenda order).
//      Rows come from F1's taskRow service (mode 'today'); without F1 a plain
//      row of our own (ring, title, chip, stopwatch, swipe → to complete).
//      Due subtasks hang on a rail in their task's colour under it.
//   2. Meetings today (row → the meeting; Notes → F3's jump-in when present)
//   3. Reminders: the real card items (createCardItemElement), passed through
//      F5's items.enhance(host) when present
//   4. Coming up · next 7 days (compact rows), then Calendar ›
// Also provides the services `time` (time-sheet.js) and `more` (more-sheet.js).
//
// Rendering: signature-skipped, keyed patches only (api.patchList), so a
// save that changes nothing here costs no DOM work (glass-glow stays asleep).
// The shell forces a render on tab show, day change and theme change.

import { model } from '../../state.js';
import { saveModel } from '../../core/storage.js';
import { PLACEHOLDER_URL, TASK_COLOR_LABELS } from '../../constants.js';
import { buildToday, dueSummary, comingUp, comingKey } from '../../core/mobile-today.js';
import { phaseFor } from '../../core/mobile-common.js';
import { getDueItems, reminderDaysLeft } from '../calendar.js';
import * as tasksApi from '../tasks.js';
import { createTaskTimerControl, refreshTimeTrackingUI } from '../time-tracking.js';
import { createCardItemElement } from '../../components/sections.js';
import { getTaskCategories } from '../task-categories.js';
import * as mobileTasks from '../../core/mobile-tasks.js';
import { createTimeSheet } from './time-sheet.js?v=2026-10-mobile-1';
import { createMoreSheet } from './more-sheet.js?v=2026-10-mobile-1';

const SHORT_LABELS = { red: 'Urgent & important', orange: 'Urgent', yellow: 'Important', blue: 'Later' };
const COMING_DAYS = 7;
const COMING_MAX = 12;
const SWIPE = { SLOP: 8, MIN_DX: 10, RATIO: 1.5, EDGE: 24, COMMIT: 0.4, FLING_V: 0.65, FLING_DX: 64 };

const svg = (body, size = 18, width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const CHECK_SVG = svg('<polyline points="20 6 9 17 4 12"></polyline>', 14, 3);
const CHEVRON_SVG = svg('<polyline points="9 6 15 12 9 18"></polyline>', 16, 2.2);
const MEETING_SVG = svg('<rect x="3" y="4" width="18" height="13" rx="2.5"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>', 18);
const NOTES_SVG = svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>', 16);
const CLOCK_SVG = svg('<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline>', 15);
const SUBTASKS_SVG = svg('<rect x="3" y="4" width="18" height="16" rx="3"></rect><line x1="7" y1="9" x2="17" y2="9"></line><line x1="7" y1="13" x2="14" y2="13"></line>', 12, 2.2);
const CALENDAR_SVG = svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"></rect><line x1="16" y1="2.5" x2="16" y2="6.5"></line><line x1="8" y1="2.5" x2="8" y2="6.5"></line><line x1="3" y1="10" x2="21" y2="10"></line>', 16);
const SUN_SVG = svg('<circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"></path>', 26, 1.8);

let api = null;
let els = null;
let cache = null;            // { ctx, sig, view }: signature() → render() in the same flush

// --- Small helpers ------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== text) t.data = text; }
  else node.textContent = text;
}

function setHidden(node, hidden) {
  if (node && node.hidden !== hidden) node.hidden = hidden;
}

function svc(name) {
  return api ? api.service(name) : undefined;
}

function chipClass(text) {
  if (/^Overdue/.test(text)) return 'today-chip is-overdue';
  if (text === 'Today') return 'today-chip is-today';
  return 'today-chip is-context';
}

// --- Actions (F1 / F3 services, with fallbacks) ---------------------------------------

export function openTask(taskId) {
  const actions = svc('taskActions');
  if (actions && typeof actions.openTask === 'function') { actions.openTask(taskId); return; }
  if (window.openEditTaskModal) window.openEditTaskModal(taskId);
}

function openMeeting(meetingId) {
  const writer = svc('writer');
  if (writer && typeof writer.open === 'function') { writer.open('meeting', meetingId); return; }
  if (window.openMeetingsModal) window.openMeetingsModal(meetingId);
}

function openReminder(reminder) {
  if (!reminder) return;
  if (reminder.linkType === 'file' && reminder.fileId) {
    if (window.openFile) window.openFile(reminder.fileId, reminder.fileName);
  } else if (reminder.url && reminder.url !== PLACEHOLDER_URL) {
    window.open(reminder.url, '_blank', 'noopener,noreferrer');
  }
}

// Complete a task with Undo: F1's batched completion when it is there, else
// complete + a single Undo that puts it back where it was
export function completeTaskWithUndo(taskId) {
  const actions = svc('taskActions');
  if (actions && typeof actions.completeWithUndo === 'function') { actions.completeWithUndo(taskId); return; }
  const tasks = model.tasks || [];
  const index = tasks.findIndex(t => t.id === taskId);
  if (index === -1) return;
  const task = tasks[index];
  const place = { color: task.color, pinned: !!task.pinned };
  const title = task.title || 'Untitled task';
  if (!tasksApi.completeTask(taskId)) return;
  refreshTimeTrackingUI();
  if (window.refreshProjectHighlights) window.refreshProjectHighlights();
  api.haptic('commit');
  api.toast(`Completed “${title}”`, [{ label: 'Undo', run: () => restoreTask(taskId, index, place) }]);
}

function restoreTask(taskId, index, place) {
  if (typeof tasksApi.restoreCompletedTask === 'function') {
    tasksApi.restoreCompletedTask(taskId, place);
    refreshTimeTrackingUI();
    return;
  }
  const done = model.completedTasks || [];
  const i = done.findIndex(t => t.id === taskId);
  if (i === -1) { api.toast('Can’t undo: that task is gone'); return; }
  const [task] = done.splice(i, 1);
  delete task.completed;
  delete task.completedAt;
  model.tasks = model.tasks || [];
  model.tasks.splice(Math.min(index, model.tasks.length), 0, task);
  saveModel();
  refreshTimeTrackingUI();
  if (window.refreshProjectHighlights) window.refreshProjectHighlights();
}

// Complete a due subtask (the task editor's rule: done also clears its
// importance and date), with Undo
function completeSubtaskWithUndo(taskId, subtaskId) {
  const actions = svc('taskActions');
  if (actions && typeof actions.completeSubtaskWithUndo === 'function') { actions.completeSubtaskWithUndo(taskId, subtaskId); return; }
  const task = tasksApi.getTaskById(taskId);
  const subtask = task && Array.isArray(task.subtasks) ? task.subtasks.find(s => s.id === subtaskId) : null;
  if (!subtask) return;
  const before = { completed: !!subtask.completed, important: !!subtask.important, dueDate: subtask.dueDate || null };
  subtask.completed = true;
  subtask.important = false;
  subtask.dueDate = null;
  tasksApi.updateTask(taskId, { subtasks: task.subtasks });
  api.haptic('commit');
  api.toast(`Completed “${subtask.title}”`, [{
    label: 'Undo',
    run: () => {
      const current = tasksApi.getTaskById(taskId);
      if (!current || !Array.isArray(current.subtasks) || !current.subtasks.includes(subtask)) {
        api.toast('Can’t undo: the task has changed since');
        return;
      }
      Object.assign(subtask, before);
      tasksApi.updateTask(taskId, { subtasks: current.subtasks });
    },
  }]);
}

function openComposer() {
  const composer = svc('composer');
  if (composer && typeof composer.open === 'function') { composer.open({ from: 'today' }); return; }
  if (window.openQuickCapture) window.openQuickCapture({ restoreFocus: false });
}

// --- View model (computed once per flush) ------------------------------------------------

function compute(ctx) {
  const today = buildToday(getDueItems(), { todayKey: ctx.todayKey });
  const coming = comingUp(model, { todayKey: ctx.todayKey, days: COMING_DAYS, reminderDays: reminderDaysLeft });
  const flags = {
    row: typeof svc('taskRow') === 'function',
    writer: !!(svc('writer') && typeof svc('writer').meetingJumpIn === 'function'),
    items: !!(svc('items') && typeof svc('items').enhance === 'function'),
  };
  return { today, coming, flags, theme: ctx.theme, todayKey: ctx.todayKey, categories: categoriesSig() };
}

// F1's row shows the title, colour, Primary, due date, subtask count,
// description, link count and category, so its own rowSignature decides when
// a row is rebuilt (plus what Today adds: chip, context, the due-subtask rail);
// a category rename or recolour rebuilds the rows that show one
function categoriesSig() {
  try { return getTaskCategories().map(c => `${c.id}:${c.name}:${c.slot}`).join(','); } catch { return ''; }
}

function rowSig(task, todayKey) {
  if (typeof mobileTasks.rowSignature === 'function') {
    try { return mobileTasks.rowSignature(task, todayKey); } catch { /* fall through */ }
  }
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  const links = Array.isArray(task.taskLinks) ? task.taskLinks.length : (task.link ? 1 : 0);
  return [task.title, task.color, !!task.pinned, task.dueDate || '', subs.filter(s => s && s.completed).length,
    subs.length, task.description ? 1 : 0, links, task.categoryId || ''].join('|');
}

function entrySig(entry, view) {
  const t = entry.task;
  return [rowSig(t, view.todayKey), t.categoryId ? view.categories : '', entry.chip, entry.contextOnly ? 1 : 0,
    entry.subtasks.map(s => `${s.subtask.id}:${s.subtask.title}:${s.due.days}`).join(','), view.flags.row ? 1 : 0].join('|');
}

// The card item bakes in its Quick Access light and its section colour when it
// is created, so both are part of what decides a rebuild
function reminderSig(r, view) {
  const rem = r.reminder;
  let inQA = false;
  try {
    inQA = !!(window.isItemInQuickAccess && window.isItemInQuickAccess({
      type: 'reminder', text: rem.title, url: rem.url, name: rem.key, sectionType: r.sectionId, subtitle: r.subtitle,
    }));
  } catch { inQA = false; }
  const color = model.subtitleColors && model.subtitleColors[`${r.sectionId}:${r.subtitle}`];
  return [rem.title, rem.url || '', rem.linkType || '', rem.fileId || '', r.days, view.theme, view.todayKey,
    view.flags.items ? 1 : 0, JSON.stringify(rem.schedule || null), (rem.links || []).length,
    inQA ? 1 : 0, color ? JSON.stringify(color) : ''].join('|');
}

function comingSig(item) {
  return [item.date, item.title, item.color || '', item.detail || ''].join('|');
}

function signature(ctx) {
  const view = compute(ctx);
  const t = view.today;
  const sig = [
    view.todayKey, view.theme, ctx.glassTheme,
    view.flags.row, view.flags.writer, view.flags.items,
    t.lanes.map(l => `${l.color}[${l.entries.map(e => `${e.task.id}~${entrySig(e, view)}`).join(';')}]`).join(''),
    t.meetings.map(m => `${m.meeting.id}:${m.meeting.title}:${m.recurring}`).join(';'),
    t.reminders.map(r => `${r.sectionId}|${r.subtitle}|${r.reminder.key}~${reminderSig(r, view)}`).join(';'),
    view.coming.map(i => `${comingKey(i)}~${comingSig(i)}`).join(';'),
  ].join('#');
  cache = { ctx, sig, view };
  return sig;
}

// --- DOM: screen skeleton -----------------------------------------------------------------

function section(className, title) {
  const s = el('section', `mx-today-section ${className}`);
  const head = el('h2', 'mx-today-head');
  const label = el('span', 'mx-today-head-label', title);
  const extra = el('span', 'mx-today-head-extra');
  head.append(label, extra);
  s.appendChild(head);
  return { s, head, extra };
}

function mount(host) {
  const root = el('div', 'mx-today');

  const due = section('mx-today-due', 'Due & overdue');
  const lanes = el('div', 'mx-today-lanes');
  due.s.appendChild(lanes);

  const meetings = section('mx-today-meetings', 'Meetings today');
  const meetingList = el('div', 'mx-today-meeting-list');
  meetingList.setAttribute('role', 'list');
  meetings.s.appendChild(meetingList);

  const reminders = section('mx-today-reminders-section', 'Reminders');
  const remHost = el('div', 'mx-today-reminders-host');
  const remGroup = el('div', 'unified-reminders-group mx-today-reminders');
  remHost.appendChild(remGroup);
  reminders.s.appendChild(remHost);

  const coming = section('mx-today-coming', `Coming up · next ${COMING_DAYS} days`);
  const comingList = el('div', 'mx-today-coming-list');
  comingList.setAttribute('role', 'list');
  const comingEmpty = el('p', 'mx-today-coming-empty', 'Nothing dated this week.');
  coming.s.append(comingList, comingEmpty);

  // Empty state: nothing due today
  const empty = el('div', 'mx-today-empty');
  const emptyGlyph = el('span', 'mx-today-empty-glyph');
  emptyGlyph.innerHTML = SUN_SVG;
  const emptyTitle = el('p', 'mx-today-empty-title', 'Nothing due today.');
  const capture = el('button', 'mx-btn mx-today-capture', 'Capture something?');
  capture.type = 'button';
  // The composer focuses its input inside this tap (iOS raises the keyboard)
  capture.addEventListener('click', () => openComposer());
  empty.append(emptyGlyph, emptyTitle, capture);

  const foot = el('div', 'mx-today-foot');
  const cal = el('button', 'mx-today-calendar');
  cal.type = 'button';
  cal.innerHTML = `${CALENDAR_SVG}<span>Calendar</span>${CHEVRON_SVG}`;
  cal.addEventListener('click', (e) => {
    e.stopPropagation();
    // calendar.js only takes an Escape aimed at the page or the calendar: drop
    // focus from this button first, so Esc closes it in the desktop preview
    if (document.activeElement === cal) cal.blur();
    if (window.openCalendarView) window.openCalendarView();
  });
  foot.appendChild(cal);

  root.append(empty, due.s, meetings.s, reminders.s, coming.s, foot);
  host.appendChild(root);
  els = { root, empty, due, lanes, meetings, meetingList, reminders, remHost, remGroup, coming, comingList, comingEmpty };
}

// --- DOM: panes and rows ------------------------------------------------------------------------

function createPane(lane) {
  const c = lane.color;
  const pane = el('div', `mx-pane mx-today-pane eisenhower-priority-card eisenhower-priority-card-${c}`);
  pane.dataset.color = c;
  const head = el('div', 'mx-today-pane-head');
  const dot = el('span', 'mx-today-pane-dot');
  dot.setAttribute('aria-hidden', 'true');
  const label = el('span', 'mx-today-pane-label', SHORT_LABELS[c]);
  label.title = TASK_COLOR_LABELS[c] || '';
  const count = el('span', 'mx-today-pane-count', '0');
  head.append(dot, label, count);
  const list = el('div', 'mx-today-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', TASK_COLOR_LABELS[c] || SHORT_LABELS[c]);
  pane.append(head, list);
  pane._count = count;
  pane._list = list;
  return pane;
}

function updatePane(pane, lane, view) {
  setText(pane._count, String(lane.entries.length));
  api.patchList(pane._list, lane.entries, {
    key: (e) => e.task.id,
    sig: (e) => entrySig(e, view),
    create: (e) => createEntry(e, view),
  });
}

function createEntry(entry, view) {
  const { task } = entry;
  const wrap = el('div', 'mx-today-entry');
  wrap.dataset.taskId = task.id;
  wrap.setAttribute('role', 'listitem');
  if (entry.contextOnly) wrap.classList.add('is-context');

  let row = null;
  const taskRow = svc('taskRow');
  if (view.flags.row && typeof taskRow === 'function') {
    try {
      // The chip goes in as an element, so it keeps its own tone (overdue red,
      // today azure, context grey); F1 also accepts a plain string (context tone)
      const chip = entry.chip ? el('span', chipClass(entry.chip), entry.chip) : null;
      if (chip) chip.title = entry.contextOnly
        ? (task.dueDate ? `The task itself is due ${task.dueDate}` : 'The task itself has no due date')
        : (entry.due && entry.due.when === 'overdue' ? `Was due ${entry.due.date} (${entry.due.days} days ago)` : 'Due today');
      row = taskRow(task, { mode: 'today', chip, contextOnly: entry.contextOnly });
    } catch (err) {
      console.error('[mobile] taskRow failed', err);
      row = null;
    }
  }
  if (!row) row = createFallbackRow(entry);
  // The entry is the list item (the row plus its subtask rail); F1's slot is a
  // list item in the Tasks list, here it is just the row inside this one
  if (row.getAttribute('role') === 'listitem') row.removeAttribute('role');
  wrap.appendChild(row);

  if (entry.subtasks.length > 0) {
    const rail = el('div', 'mx-today-subs');
    rail.setAttribute('role', 'list');
    rail.setAttribute('aria-label', `Due subtasks of ${task.title || 'Untitled task'}`);
    entry.subtasks.forEach(item => rail.appendChild(createSubtaskRow(task, item)));
    wrap.appendChild(rail);
  }
  return wrap;
}

// Without F1: a plain row on the desktop pill glass (Primary keeps its
// breathing light body), ring to complete, title + chip, the stopwatch, and
// swipe → to complete. Tap opens the task.
function createFallbackRow(entry) {
  const { task } = entry;
  const color = task.color || 'blue';
  const title = task.title || 'Untitled task';
  const slot = el('div', 'mx-today-slot');
  const under = el('div', 'mx-today-under');
  under.setAttribute('aria-hidden', 'true');
  under.innerHTML = `${CHECK_SVG}<span>Done</span>`;

  const row = el('div', `mx-today-row eisenhower-task task-bubble-${color}${task.pinned ? ' eisenhower-task-pinned' : ''}`);
  row.dataset.taskId = task.id;
  if (entry.contextOnly) row.classList.add('today-task-context');
  if (task.pinned) {
    const phase = phaseFor(task.id);
    row.style.setProperty('--fx-t-dur', phase.dur);
    row.style.setProperty('--fx-t-delay', phase.delay);
  }

  const check = el('button', 'mx-today-check');
  check.type = 'button';
  check.setAttribute('aria-label', `Complete “${title}”`);
  check.innerHTML = `<span class="mx-today-ring">${CHECK_SVG}</span>`;
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (check.disabled) return;
    check.disabled = true;
    row.classList.add('is-completing');
    setTimeout(() => completeTaskWithUndo(task.id), api.reduceMotion() ? 0 : 140);
  });

  const main = el('div', 'mx-today-main');
  main.appendChild(el('span', 'mx-today-title', title));
  const meta = el('span', 'mx-today-meta');
  if (entry.chip) meta.appendChild(el('span', chipClass(entry.chip), entry.chip));
  const subs = Array.isArray(task.subtasks) ? task.subtasks.filter(s => s && s.title && String(s.title).trim()) : [];
  if (subs.length > 0) {
    const s = el('span', 'mx-today-subcount');
    s.innerHTML = SUBTASKS_SVG;
    s.appendChild(document.createTextNode(`${subs.filter(x => x.completed).length}/${subs.length}`));
    s.title = 'Subtasks done';
    meta.appendChild(s);
  }
  main.appendChild(meta);

  const timer = createTaskTimerControl(task);
  row.append(check, main, timer);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${title}. ${entry.chip}. Open`);
  row.addEventListener('click', (e) => {
    if (e.target.closest('.task-timer, .mx-today-check')) return;
    openTask(task.id);
  });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(task.id); }
  });
  row.addEventListener('contextmenu', (e) => e.preventDefault());
  slot.append(under, row);
  wireSwipe(slot, row, () => completeTaskWithUndo(task.id));
  return slot;
}

// Swipe → past 40% of the row (or a fling) completes it; anything less springs
// back. Pointer events (the slot is touch-action: pan-y, so vertical moves
// scroll); the row moves through a paused-WAAPI mover (no style writes).
function wireSwipe(slot, row, onCommit) {
  let s = null;
  const reset = () => {
    if (!s) return;
    const st = s;
    s = null;
    slot.classList.remove('is-swiping', 'is-armed');
    if (st.mover) st.mover.release();
    if (st.mode === 'swipe') api.setGestureActive(false, 'today-swipe');
  };
  slot.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    if (e.target.closest('button, .task-timer')) return;
    if (e.clientX < SWIPE.EDGE || e.clientX > window.innerWidth - SWIPE.EDGE) return;
    s = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, mode: 'press', mover: null, w: slot.getBoundingClientRect().width, last: [] };
  });
  slot.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (s.mode === 'press') {
      if (Math.hypot(dx, dy) <= SWIPE.SLOP) return;
      if (dx > SWIPE.MIN_DX && Math.abs(dx) > SWIPE.RATIO * Math.abs(dy)) {
        s.mode = 'swipe';
        api.setGestureActive(true, 'today-swipe');
        try { slot.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        s.mover = api.createMover(row);
        slot.classList.add('is-swiping');
      } else {
        s = null;          // the browser scrolls (or a leftward drag: nothing here)
        return;
      }
    }
    s.dx = Math.max(0, dx);
    s.last.push({ x: e.clientX, t: performance.now() });
    if (s.last.length > 5) s.last.shift();
    s.mover.moveTo(s.dx, 0);
    const armed = s.dx > SWIPE.COMMIT * s.w;
    if (armed !== slot.classList.contains('is-armed')) {
      slot.classList.toggle('is-armed', armed);
      if (armed) api.haptic('tick');
    }
  });
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    if (s.mode !== 'swipe') { s = null; return; }
    const first = s.last[0];
    const lastP = s.last[s.last.length - 1];
    const v = first && lastP && lastP.t > first.t ? (lastP.x - first.x) / (lastP.t - first.t) : 0;
    const commit = e.type === 'pointerup' && (s.dx > SWIPE.COMMIT * s.w || (v > SWIPE.FLING_V && s.dx >= SWIPE.FLING_DX));
    const dx = s.dx;
    // The click that follows a swipe must not open the task
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    reset();
    if (commit) {
      api.animate(row, [{ transform: `translateX(${dx}px)`, opacity: 1 }, { transform: `translateX(${dx + 60}px)`, opacity: 0 }], { duration: 140 });
      onCommit();
    } else if (dx > 2) {
      api.animate(row, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 160 });
    }
  };
  slot.addEventListener('pointerup', end);
  slot.addEventListener('pointercancel', end);
}

function createSubtaskRow(task, { subtask, due }) {
  const row = el('div', 'mx-today-sub');
  row.setAttribute('role', 'listitem');
  row.dataset.subtaskId = subtask.id || '';
  const check = el('button', 'mx-today-sub-check');
  check.type = 'button';
  check.setAttribute('aria-label', `Complete “${subtask.title}”`);
  check.innerHTML = `<span class="mx-today-ring">${CHECK_SVG}</span>`;
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (check.disabled) return;
    check.disabled = true;
    row.classList.add('is-completing');
    setTimeout(() => completeSubtaskWithUndo(task.id, subtask.id), api.reduceMotion() ? 0 : 140);
  });
  const open = el('button', 'mx-today-sub-open');
  open.type = 'button';
  open.setAttribute('aria-label', `${subtask.title}, in ${task.title || 'Untitled task'}. Open the task`);
  const title = el('span', 'mx-today-sub-title', subtask.title);
  const chipText = due.when === 'today' ? 'Today' : `Overdue · ${due.days}d`;
  open.append(title, el('span', chipClass(chipText), chipText));
  open.addEventListener('click', () => openTask(task.id));
  row.append(check, open);
  return row;
}

function createMeetingRow({ meeting, recurring }, view) {
  const row = el('div', 'mx-today-meeting');
  row.setAttribute('role', 'listitem');
  const main = el('button', 'mx-today-meeting-main');
  main.type = 'button';
  const icon = el('span', 'mx-today-meeting-icon');
  icon.innerHTML = MEETING_SVG;
  const text = el('span', 'mx-today-meeting-text');
  text.appendChild(el('span', 'mx-today-meeting-title', meeting.title || 'Untitled meeting'));
  if (recurring) text.appendChild(el('span', 'today-chip is-meeting', 'Recurring'));
  main.append(icon, text);
  main.setAttribute('aria-label', `Open the meeting ${meeting.title || 'Untitled meeting'}`);
  main.addEventListener('click', () => openMeeting(meeting.id));
  row.appendChild(main);
  if (view.flags.writer) {
    const notes = el('button', 'mx-btn mx-today-notes');
    notes.type = 'button';
    notes.innerHTML = `${NOTES_SVG}<span>Notes</span>`;
    notes.setAttribute('aria-label', `Add today’s notes to ${meeting.title || 'the meeting'}`);
    notes.addEventListener('click', (e) => {
      e.stopPropagation();
      const writer = svc('writer');
      if (writer && typeof writer.meetingJumpIn === 'function') writer.meetingJumpIn(meeting.id);
      else openMeeting(meeting.id);
    });
    row.appendChild(notes);
  }
  return row;
}

// A list item holding a real button (a role on the button itself would hide
// that it can be activated)
function createComingRow(item) {
  const wrap = el('div', 'mx-today-coming-item');
  wrap.setAttribute('role', 'listitem');
  const row = el('button', `mx-today-coming-row is-${item.kind}`);
  row.type = 'button';
  wrap.appendChild(row);
  const day = el('span', 'mx-today-coming-day', item.label);
  const mark = el('span', 'mx-today-coming-mark');
  mark.setAttribute('aria-hidden', 'true');
  if (item.kind === 'task' || item.kind === 'subtask') {
    mark.classList.add('is-dot');
    mark.dataset.color = item.color || 'blue';
  } else if (item.kind === 'meeting') {
    mark.innerHTML = MEETING_SVG;
  } else {
    mark.innerHTML = CLOCK_SVG;
  }
  const text = el('span', 'mx-today-coming-text');
  text.appendChild(el('span', 'mx-today-coming-title', item.title));
  if (item.kind === 'subtask' && item.detail) text.appendChild(el('span', 'mx-today-coming-detail', `in ${item.detail}`));
  row.append(day, mark, text);
  const kindLabel = { task: 'Task', subtask: 'Subtask', meeting: 'Meeting', reminder: 'Reminder' }[item.kind];
  row.setAttribute('aria-label', `${item.label}: ${kindLabel} ${item.title}`);
  row.addEventListener('click', () => {
    if (item.kind === 'task' || item.kind === 'subtask') openTask(item.taskId);
    else if (item.kind === 'meeting') openMeeting(item.meetingId);
    else openReminder(item.reminder);
  });
  return wrap;
}

// --- Render --------------------------------------------------------------------------------------

function render(ctx) {
  if (!els) return;
  const view = cache && cache.ctx === ctx ? cache.view : compute(ctx);
  const { today } = view;
  const nothing = today.count === 0;

  setHidden(els.empty, !nothing);
  setHidden(els.due.s, today.lanes.length === 0);
  setText(els.due.extra, dueSummary(today));
  api.patchList(els.lanes, today.lanes, {
    key: (lane) => lane.color,
    sig: (lane) => lane.color,
    create: (lane) => { const pane = createPane(lane); updatePane(pane, lane, view); return pane; },
    update: (pane, lane) => updatePane(pane, lane, view),
  });

  setHidden(els.meetings.s, today.meetings.length === 0);
  api.patchList(els.meetingList, today.meetings, {
    key: (m) => m.meeting.id,
    sig: (m) => `${m.meeting.title}|${m.recurring}|${view.flags.writer}`,
    create: (m) => createMeetingRow(m, view),
  });

  setHidden(els.reminders.s, today.reminders.length === 0);
  let added = false;
  api.patchList(els.remGroup, today.reminders, {
    key: (r) => `${r.sectionId}|${r.subtitle}|${r.reminder.key}`,
    sig: (r) => reminderSig(r, view),
    create: (r) => {
      added = true;
      const item = createCardItemElement('reminder', r.reminder, r.sectionId, r.subtitle);
      if (item) item.title = r.subtitle && r.subtitle !== '_default' ? `${r.sectionTitle} › ${r.subtitle}` : r.sectionTitle;
      return item;
    },
  });
  if (added && view.flags.items) {
    try { svc('items').enhance(els.remHost); } catch (err) { console.error('[mobile] items.enhance failed', err); }
  }

  const coming = view.coming.slice(0, COMING_MAX);
  setText(els.coming.extra, view.coming.length > COMING_MAX ? `${view.coming.length}` : '');
  setHidden(els.comingEmpty, coming.length > 0);
  api.patchList(els.comingList, coming, {
    key: comingKey,
    sig: comingSig,
    create: createComingRow,
  });
}

// --- Entry ------------------------------------------------------------------------------------------

export default {
  init(shellApi) {
    api = shellApi;
    api.registerScreen({
      id: 'today',
      title: 'Today',
      icon: 'today',
      mount,
      signature,
      render,
    });
    const time = createTimeSheet(api, { complete: completeTaskWithUndo, openTask });
    api.provide('time', time);
    api.provide('more', createMoreSheet(api, { openTime: () => time.openSheet() }));
    // Rows come from F1, Notes from F3, item touch from F5: when one of them
    // finishes loading after Today rendered, render again with it
    ['tasks', 'write', 'links'].forEach(unit => {
      api.use(unit).then(() => { if (api.getTab() === 'today') api.render('today-services'); }).catch(() => {});
    });
  },
};
