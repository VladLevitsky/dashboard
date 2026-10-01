// Personal Dashboard - Task Time Tracking
// The stopwatch on every Tasks pill, the 1-second tick, and the Time Tracking
// panel (tracked tasks + a category donut). The log itself and all of its
// rules live in js/core/time-log.js, stored on model.timeTracking.
//
// The log is always read and written on `model`, never the edit-mode working
// copy, so a timer started mid-edit survives Cancel and Confirm can't rewind it.
//
// Ticking only rewrites the text of existing nodes (never replaces elements),
// so the glass visual layer's DOM observers don't re-measure the page every
// second, and it pauses while the tab is hidden.

import { model, editState, currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS } from '../constants.js';
import { saveModel } from '../core/storage.js';
import {
  normalizeTimeLog, startTaskTimer, stopActiveTimer, rememberTaskMeta, removeSession,
  clearTaskTime, getTaskTotalMs, getTaskTotals, MIN_SESSION_MS,
  TIME_RANGE_PRESETS, normalizeRangeFilter, resolveTimeRange, getTaskTotalsInRange, dayKeyToDate
} from '../core/time-log.js';
import { getTaskCategories, categoryColor } from './task-categories.js';

const STOPWATCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="14" r="8"></circle><line x1="12" y1="6" x2="12" y2="2"></line><line x1="9" y1="2" x2="15" y2="2"></line><line x1="12" y1="14" x2="12" y2="10"></line><line x1="12" y1="14" x2="15" y2="17"></line></svg>`;
const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 6 15 12 9 18"></polyline></svg>`;
const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

// ============================================================
// LOG ACCESS & TIMER ACTIONS
// ============================================================

function getLog() {
  if (!model.timeTracking || typeof model.timeTracking.tasks !== 'object' || !Array.isArray(model.timeTracking.removed)) {
    model.timeTracking = normalizeTimeLog(model.timeTracking);
  }
  return model.timeTracking;
}

// Look a task up wherever it may be: open, completed, or (mid-edit) only on
// the saved model. state: 'active' | 'done' | 'deleted'
function findTask(taskId) {
  const sources = currentData() === model ? [model] : [currentData(), model];
  for (const data of sources) {
    const open = (data.tasks || []).find(t => t.id === taskId);
    if (open) return { task: open, state: 'active' };
    const done = (data.completedTasks || []).find(t => t.id === taskId);
    if (done) return { task: done, state: 'done' };
  }
  return { task: null, state: 'deleted' };
}

function metaOf(task) {
  return { title: task.title || '', categoryId: task.categoryId || null };
}

export function isTaskTimerRunning(taskId) {
  const active = getLog().active;
  return !!active && active.taskId === taskId;
}

export function toggleTaskTimer(taskId) {
  if (isTaskTimerRunning(taskId)) {
    const title = findTask(taskId).task?.title || 'Untitled Task';
    const closed = stopTaskTimer();
    const ms = closed ? closed.end - closed.start : 0;
    showToast(ms >= MIN_SESSION_MS ? `Tracked ${formatDuration(ms)} on “${title}”` : 'Timer stopped');
    return;
  }
  const started = startTimerForTask(taskId);
  if (started.switchedFrom) {
    showToast(`Timer switched from “${started.switchedFrom.title}” to “${findTask(taskId).task?.title || 'Untitled Task'}”`);
  }
}

// Start this task's timer; never stops it (quick capture's !timer). Any other
// running timer is stopped and recorded first. The caller shows the toast.
// → { started, alreadyRunning?, start?, switchedFrom?: { taskId, title } }
export function startTimerForTask(taskId) {
  if (isTaskTimerRunning(taskId)) return { started: false, alreadyRunning: true };
  const { task, state } = findTask(taskId);
  if (!task || state !== 'active') return { started: false };

  const log = getLog();
  const previous = log.active ? findTask(log.active.taskId).task : null;
  const previousId = log.active ? log.active.taskId : null;
  if (previous) rememberTaskMeta(log, previous.id, metaOf(previous));
  const now = Date.now();
  const closed = startTaskTimer(log, taskId, metaOf(task), now);
  saveModel();
  refreshTimeTrackingUI();

  const switchedFrom = closed
    ? { taskId: previousId, title: previous ? (previous.title || 'Untitled Task') : 'the previous task' }
    : null;
  return { started: true, start: now, switchedFrom };
}

// Quick capture's Undo: take back a timer it started. A brand-new task loses
// all of its (seconds of) time; an existing task only loses that one session.
// A timer that the start switched off runs again, from now.
export function undoTimerStart({ taskId, start, wholeTask, previousTaskId }) {
  const log = getLog();
  const now = Date.now();
  if (wholeTask) {
    clearTaskTime(log, taskId, now);
  } else if (log.active && log.active.taskId === taskId && log.active.start === start) {
    log.active = null;
    log.changedAt = now;
    const entry = log.tasks[taskId];
    if (entry && entry.sessions.length === 0) delete log.tasks[taskId];
  } else {
    removeSession(log, taskId, start);
  }
  if (previousTaskId && !log.active) {
    const { task, state } = findTask(previousTaskId);
    if (task && state === 'active') startTaskTimer(log, previousTaskId, metaOf(task), now);
  }
  saveModel();
  refreshTimeTrackingUI();
}

// Stop the running timer (records the session)
export function stopTaskTimer() {
  const log = getLog();
  if (!log.active) return null;
  const { task } = findTask(log.active.taskId);
  if (task) rememberTaskMeta(log, task.id, metaOf(task));
  const closed = stopActiveTimer(log, Date.now());
  saveModel();
  refreshTimeTrackingUI();
  return closed;
}

// tasks.js: before a task is completed or deleted
export function stopTimerForTask(taskId) {
  if (isTaskTimerRunning(taskId)) stopTaskTimer();
}

// tasks.js: after a task's title/category changes (the caller saves).
// Keeps the log's copy current so history still reads right if the task is deleted.
export function syncTaskTimeMeta(task) {
  if (!task || !getLog().tasks[task.id]) return;
  rememberTaskMeta(getLog(), task.id, metaOf(task));
}

// A running timer whose task vanished (deleted elsewhere, an import, or a task
// created mid-edit and then cancelled) is closed so it can't run forever
function reconcileActiveTimer() {
  const log = getLog();
  if (!log.active) return;
  const { task, state } = findTask(log.active.taskId);
  if (state === 'active') return;
  const end = state === 'done' && task.completedAt ? Math.min(task.completedAt, Date.now()) : Date.now();
  if (task) rememberTaskMeta(log, task.id, metaOf(task));
  stopActiveTimer(log, end);
  saveModel();
}

// ============================================================
// FORMATTING
// ============================================================

const pad2 = (n) => String(n).padStart(2, '0');

// Stopwatch style: 0:45 → 12:05 → 1:02:33
export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

// Compact: 40s · 12m · 3h · 3h 12m
export function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// The chart refreshes once a minute, so it speaks in minutes
function formatChartDuration(ms) {
  return ms < 60000 ? '<1m' : formatDuration(ms);
}

function formatPercent(fraction) {
  const pct = fraction * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

const timeFmt = { hour: 'numeric', minute: '2-digit' };
const dayFmt = { weekday: 'short', month: 'short', day: 'numeric' };

// Update a label through its text node: no element churn for observers
function setText(el, text) {
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE && !node.nextSibling) {
    if (node.data !== text) node.data = text;
  } else {
    el.textContent = text;
  }
}

function textSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// ============================================================
// PILL TIMER (Tasks panel)
// ============================================================

export function createTaskTimerControl(task) {
  const wrap = document.createElement('div');
  wrap.className = 'task-timer';
  wrap.dataset.timerTask = task.id;

  // Elapsed time sits above the icon while running
  const label = document.createElement('span');
  label.className = 'task-timer-time';
  label.appendChild(document.createTextNode(''));

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'task-timer-btn';
  btn.draggable = false;
  btn.innerHTML = STOPWATCH_SVG;
  // Keep the pill's long-press (pin) and click (open editor) out of it
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTaskTimer(task.id);
  });

  wrap.append(label, btn);
  paintTimerControl(wrap, Date.now());
  return wrap;
}

function paintTimerControl(wrap, now) {
  const taskId = wrap.dataset.timerTask;
  const log = getLog();
  const running = !!log.active && log.active.taskId === taskId;
  const total = getTaskTotalMs(log, taskId, now);
  const label = wrap.querySelector('.task-timer-time');
  const btn = wrap.querySelector('.task-timer-btn');

  wrap.classList.toggle('is-running', running);
  const pill = wrap.closest('.eisenhower-task');
  if (pill) pill.classList.toggle('is-timing', running);

  if (running) {
    label.dataset.liveTimer = taskId;
    setText(label, formatClock(total));
  } else {
    delete label.dataset.liveTimer;
    setText(label, '');
  }

  const title = running ? 'Stop timer' : (total > 0 ? `Start timer (${formatDuration(total)} tracked)` : 'Start timer');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.setAttribute('aria-pressed', running ? 'true' : 'false');
}

// ============================================================
// TICK (1 second, aligned to the running timer's whole seconds)
// ============================================================

let tickHandle = null;
let lastMinute = -1;

function scheduleTick() {
  if (tickHandle) {
    clearTimeout(tickHandle);
    tickHandle = null;
  }
  const active = getLog().active;
  if (!active || document.visibilityState === 'hidden') return;
  const elapsed = Math.max(0, Date.now() - active.start);
  const delay = 1000 - (elapsed % 1000) + 15;
  tickHandle = setTimeout(() => {
    tickHandle = null;
    tick();
    scheduleTick();
  }, delay);
}

function tick() {
  const log = getLog();
  if (!log.active) return;
  const now = Date.now();
  const text = formatClock(getTaskTotalMs(log, log.active.taskId, now));
  document.querySelectorAll('[data-live-timer]').forEach(el => setText(el, text));

  // Minute-level figures (category totals, chart) only change once a minute
  const minute = Math.floor(now / 60000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    if (isPanelOpen()) updateCategoryChart(now);
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') tick();
  scheduleTick();
}

// Header stopwatch button shows a live dot while a timer runs
function updateHeaderIndicator() {
  const btn = $('#time-tracking-toggle');
  if (!btn) return;
  const log = getLog();
  const running = !!log.active;
  btn.classList.toggle('is-running', running);
  const title = running ? 'Time tracking (timer running)' : 'Time tracking';
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

// Repaint everything that shows timer state. Safe to call often.
export function refreshTimeTrackingUI() {
  reconcileActiveTimer();
  const now = Date.now();
  document.querySelectorAll('.task-timer[data-timer-task]').forEach(wrap => paintTimerControl(wrap, now));
  updateHeaderIndicator();
  if (isPanelOpen()) renderTimeTrackingPanel();
  scheduleTick();
}

// ============================================================
// TIME TRACKING PANEL (header stopwatch → slide-out card)
// ============================================================

const expandedTasks = new Set();
let pastGroupOpen = false;

function isPanelOpen() {
  const card = $('#time-tracking-card');
  return !!card && !card.hidden;
}

export function toggleTimeTracking() {
  const card = $('#time-tracking-card');
  if (!card) return;
  const data = currentData();
  data.timeTrackingExpanded = !data.timeTrackingExpanded;

  if (data.timeTrackingExpanded) {
    showPanel(card);
  } else {
    card.classList.remove('active');
    hideChartTooltip();
    closeRangePopover(false);
    setTimeout(() => { if (!card.classList.contains('active')) card.hidden = true; }, CARD_HIDE_DELAY_MS);
  }

  if (!editState.enabled) saveModel();
}

function showPanel(card) {
  card.hidden = false;
  renderTimeTrackingPanel();
  setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
}

export function renderTimeTrackingPanel() {
  const now = Date.now();
  renderTaskList(now);
  updateRangeButton();
  renderCategoryChart(now);
}

// --- Rows model: every task with tracked time, open ones first
function collectTrackedRows(now) {
  const log = getLog();
  const totals = getTaskTotals(log, now);
  return Object.keys(totals).map(taskId => {
    const { task, state } = findTask(taskId);
    const saved = log.tasks[taskId] || {};
    return {
      taskId,
      state,
      title: (task ? task.title : saved.title) || 'Untitled Task',
      categoryId: task ? (task.categoryId || null) : (saved.categoryId || null),
      total: totals[taskId],
      running: !!log.active && log.active.taskId === taskId
    };
  });
}

function renderTaskList(now) {
  const list = $('#tt-task-list');
  if (!list) return;
  list.innerHTML = '';

  const rows = collectTrackedRows(now);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tt-empty';
    empty.textContent = 'No tracked time yet. Start the stopwatch on any task in the Tasks panel.';
    list.appendChild(empty);
    return;
  }

  const open = rows.filter(r => r.state === 'active')
    .sort((a, b) => (b.running - a.running) || (b.total - a.total));
  const past = rows.filter(r => r.state !== 'active').sort((a, b) => b.total - a.total);

  if (open.length === 0) {
    const note = document.createElement('div');
    note.className = 'tt-empty';
    note.textContent = 'No open tasks with tracked time.';
    list.appendChild(note);
  }
  open.forEach(row => list.appendChild(buildTaskRow(row, now)));

  if (past.length > 0) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tt-past-toggle';
    toggle.setAttribute('aria-expanded', String(pastGroupOpen));
    toggle.innerHTML = CHEVRON_SVG;
    toggle.appendChild(textSpan('tt-past-toggle-label', `Completed (${past.length})`));
    toggle.appendChild(textSpan('tt-past-toggle-total', formatDuration(past.reduce((sum, r) => sum + r.total, 0))));

    const group = document.createElement('div');
    group.className = 'tt-past-group';
    group.hidden = !pastGroupOpen;
    past.forEach(row => group.appendChild(buildTaskRow(row, now)));

    toggle.addEventListener('click', () => {
      pastGroupOpen = !pastGroupOpen;
      toggle.setAttribute('aria-expanded', String(pastGroupOpen));
      group.hidden = !pastGroupOpen;
    });
    list.append(toggle, group);
  }
}

function buildCategoryChip(categoryId) {
  const category = categoryId ? getTaskCategories().find(c => c.id === categoryId) : null;
  const chip = document.createElement('span');
  chip.className = 'tt-cat-chip' + (category ? '' : ' is-none');
  const dot = document.createElement('span');
  dot.className = 'tt-cat-dot';
  dot.style.background = categoryColor(category);
  chip.append(dot, textSpan('tt-cat-name', category ? category.name : 'Uncategorized'));
  return chip;
}

function buildTaskRow(row, now) {
  const item = document.createElement('div');
  item.className = 'tt-task' + (row.running ? ' is-running' : '') + (row.state !== 'active' ? ' is-past' : '');
  item.dataset.taskId = row.taskId;

  const line = document.createElement('div');
  line.className = 'tt-task-line';

  const expanded = expandedTasks.has(row.taskId);
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'tt-task-main';
  main.setAttribute('aria-expanded', String(expanded));
  main.title = expanded ? 'Hide sessions' : 'Show sessions';
  main.innerHTML = CHEVRON_SVG;
  main.appendChild(textSpan('tt-task-title', row.title));
  if (row.state === 'deleted') main.appendChild(textSpan('tt-task-tag', 'Deleted'));

  const time = document.createElement('span');
  time.className = 'tt-task-time';
  time.appendChild(document.createTextNode(formatClock(row.total)));
  if (row.running) time.dataset.liveTimer = row.taskId;

  line.append(main, buildCategoryChip(row.categoryId), time);

  if (row.state === 'active') {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'task-timer-btn tt-task-toggle' + (row.running ? ' is-running' : '');
    toggle.innerHTML = STOPWATCH_SVG;
    const label = row.running ? 'Stop timer' : 'Start timer';
    toggle.title = label;
    toggle.setAttribute('aria-label', `${label}: ${row.title}`);
    toggle.setAttribute('aria-pressed', String(row.running));
    toggle.addEventListener('click', () => toggleTaskTimer(row.taskId));
    line.appendChild(toggle);
  } else {
    line.appendChild(textSpan('tt-task-toggle-spacer', ''));
  }

  const sessions = document.createElement('div');
  sessions.className = 'tt-sessions';
  sessions.hidden = !expanded;
  if (expanded) renderSessions(sessions, row, now);

  main.addEventListener('click', () => {
    const open = !expandedTasks.has(row.taskId);
    if (open) expandedTasks.add(row.taskId); else expandedTasks.delete(row.taskId);
    main.setAttribute('aria-expanded', String(open));
    main.title = open ? 'Hide sessions' : 'Show sessions';
    sessions.hidden = !open;
    if (open) renderSessions(sessions, row, Date.now());
  });

  item.append(line, sessions);
  return item;
}

function renderSessions(container, row, now) {
  container.innerHTML = '';
  const log = getLog();
  const entry = log.tasks[row.taskId];
  const list = document.createElement('div');
  list.className = 'tt-session-list';

  if (log.active && log.active.taskId === row.taskId) {
    const running = document.createElement('div');
    running.className = 'tt-session is-running';
    const start = new Date(log.active.start);
    running.append(
      textSpan('tt-session-day', start.toLocaleDateString([], dayFmt)),
      textSpan('tt-session-range', `${start.toLocaleTimeString([], timeFmt)} – now`),
      textSpan('tt-session-duration', 'Running'),
      textSpan('tt-session-spacer', '')
    );
    list.appendChild(running);
  }

  const sessions = entry ? [...entry.sessions].reverse() : [];
  sessions.forEach(([startMs, endMs]) => {
    const start = new Date(startMs);
    const end = new Date(endMs);
    const nextDay = end.toDateString() !== start.toDateString();
    const el = document.createElement('div');
    el.className = 'tt-session';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tt-session-delete';
    del.title = 'Delete this session';
    del.setAttribute('aria-label', 'Delete this session');
    del.innerHTML = CLOSE_SVG;
    del.addEventListener('click', () => {
      const duration = formatDuration(endMs - startMs);
      if (!confirm(`Delete this ${duration} session from “${row.title}”?`)) return;
      removeSession(getLog(), row.taskId, startMs);
      saveModel();
      refreshTimeTrackingUI();
      showToast('Session deleted');
    });

    el.append(
      textSpan('tt-session-day', start.toLocaleDateString([], dayFmt)),
      textSpan('tt-session-range', `${start.toLocaleTimeString([], timeFmt)} – ${end.toLocaleTimeString([], timeFmt)}${nextDay ? ' (+1d)' : ''}`),
      textSpan('tt-session-duration', formatDuration(endMs - startMs)),
      del
    );
    list.appendChild(el);
  });
  container.appendChild(list);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'tt-clear-btn';
  clear.textContent = 'Clear all time';
  clear.addEventListener('click', () => {
    if (!confirm(`Delete all ${formatDuration(row.total)} of tracked time for “${row.title}”?`)) return;
    clearTaskTime(getLog(), row.taskId, Date.now());
    expandedTasks.delete(row.taskId);
    saveModel();
    refreshTimeTrackingUI();
    showToast('Tracked time cleared');
  });
  container.appendChild(clear);
}

// ============================================================
// CATEGORIES PERIOD FILTER
// The funnel button above the category legend opens a popover: presets
// (applied on click), a custom From / To range (either side may stay empty)
// and Clear. The donut then counts only time inside the period; a session
// that crosses its edge counts in part (time-log.js). The choice is per
// browser (localStorage, not synced) and a preset is stored by name, so
// "This week" always means the current week. Default: all time.
// ============================================================

const RANGE_FILTER_KEY = 'dashboard_tt_range_filter';
const FILTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`;
let rangeFilter = loadRangeFilter();
let rangePop = null; // { el, btn, cleanup } while the popover is open
let rangeBtn = null;  // one button, moved into the chart on every render

// The chart re-renders (and empties its host) often, so the button is made
// once here and re-attached above the legend each time
function getRangeButton() {
  if (rangeBtn) return rangeBtn;
  rangeBtn = document.createElement('button');
  rangeBtn.type = 'button';
  rangeBtn.id = 'tt-range-btn';
  rangeBtn.className = 'tt-range-btn';
  rangeBtn.setAttribute('aria-haspopup', 'dialog');
  rangeBtn.setAttribute('aria-expanded', 'false');
  rangeBtn.setAttribute('aria-controls', 'tt-range-pop');
  rangeBtn.innerHTML = FILTER_SVG;
  const label = document.createElement('span');
  label.className = 'tt-range-btn-label';
  label.appendChild(document.createTextNode(''));
  rangeBtn.appendChild(label);
  rangeBtn.addEventListener('click', openRangePopover);
  updateRangeButton();
  return rangeBtn;
}

function loadRangeFilter() {
  try {
    return normalizeRangeFilter(JSON.parse(localStorage.getItem(RANGE_FILTER_KEY) || 'null'));
  } catch (e) {
    return null;
  }
}

function setRangeFilter(filter) {
  rangeFilter = normalizeRangeFilter(filter);
  try {
    if (rangeFilter) localStorage.setItem(RANGE_FILTER_KEY, JSON.stringify(rangeFilter));
    else localStorage.removeItem(RANGE_FILTER_KEY);
  } catch (e) { /* storage blocked: the filter still applies until the page reloads */ }
  updateRangeButton();
  if (isPanelOpen()) renderCategoryChart(Date.now());
}

const rangeDayFmt = { month: 'short', day: 'numeric' };

function formatDayKey(key, withYear) {
  return dayKeyToDate(key).toLocaleDateString([], withYear ? { ...rangeDayFmt, year: 'numeric' } : rangeDayFmt);
}

// "Sep 28 – Oct 4" · "Oct 1" · "Since Sep 3" · "Until Sep 30" (a year only when it isn't this year)
function formatRangeSpan(range, now = Date.now()) {
  if (!range) return 'All time';
  const thisYear = String(new Date(now).getFullYear());
  const withYear = [range.from, range.to].some(key => key && key.slice(0, 4) !== thisYear);
  if (range.from && range.to) {
    if (range.from === range.to) return formatDayKey(range.from, withYear);
    return `${formatDayKey(range.from, withYear)} – ${formatDayKey(range.to, withYear)}`;
  }
  return range.from ? `Since ${formatDayKey(range.from, withYear)}` : `Until ${formatDayKey(range.to, withYear)}`;
}

// What the button says: the preset's name, or the custom dates
function filterLabel(filter, now) {
  if (!filter) return 'All time';
  const preset = filter.preset ? TIME_RANGE_PRESETS.find(p => p.id === filter.preset) : null;
  return preset ? preset.label : formatRangeSpan(resolveTimeRange(filter, now), now);
}

function updateRangeButton() {
  const btn = getRangeButton();
  const now = Date.now();
  const label = filterLabel(rangeFilter, now);
  const labelEl = btn.querySelector('.tt-range-btn-label');
  if (labelEl) setText(labelEl, label);
  btn.classList.toggle('is-active', !!rangeFilter);
  btn.title = !rangeFilter ? 'Filter by period'
    : rangeFilter.preset ? `${label}: ${formatRangeSpan(resolveTimeRange(rangeFilter, now), now)}` : label;
  btn.setAttribute('aria-label', `Filter categories by period, showing ${label}`);
}

function dateField(parent, labelText, value) {
  const field = document.createElement('label');
  field.className = 'tt-range-field';
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'tt-range-date';
  input.value = value || '';
  field.append(textSpan('tt-range-field-label', labelText), input);
  parent.appendChild(field);
  return input;
}

function openRangePopover() {
  const btn = getRangeButton();
  if (!btn.isConnected) return;
  if (rangePop) {
    closeRangePopover(true);
    return;
  }
  hideChartTooltip();
  const now = Date.now();
  const current = resolveTimeRange(rangeFilter, now);

  const pop = document.createElement('div');
  pop.className = 'tt-range-pop';
  pop.id = 'tt-range-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Filter categories by period');

  // Presets apply straight away
  const presets = document.createElement('div');
  presets.className = 'tt-range-presets';
  TIME_RANGE_PRESETS.forEach(preset => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'tt-range-option';
    option.setAttribute('aria-pressed', String(!!rangeFilter && rangeFilter.preset === preset.id));
    option.append(
      textSpan('tt-range-option-name', preset.label),
      textSpan('tt-range-option-span', formatRangeSpan(resolveTimeRange({ preset: preset.id }, now), now))
    );
    option.addEventListener('click', () => {
      setRangeFilter({ preset: preset.id });
      closeRangePopover(true);
    });
    presets.appendChild(option);
  });

  // Custom range, prefilled with the period on show so it can be adjusted
  const fields = document.createElement('div');
  fields.className = 'tt-range-fields';
  const fromInput = dateField(fields, 'From', current ? current.from : '');
  const toInput = dateField(fields, 'To', current ? current.to : '');

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'tt-range-apply';
  apply.textContent = 'Apply';
  const syncBounds = () => {
    toInput.min = fromInput.value;
    fromInput.max = toInput.value;
    apply.disabled = !fromInput.value && !toInput.value;
  };
  [fromInput, toInput].forEach(input => {
    input.addEventListener('input', syncBounds);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !apply.disabled) {
        e.preventDefault();
        apply.click();
      }
    });
  });
  syncBounds();
  apply.addEventListener('click', () => {
    const filter = normalizeRangeFilter({ from: fromInput.value, to: toInput.value });
    if (!filter) return;
    setRangeFilter(filter);
    closeRangePopover(true);
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'tt-range-clear';
  clear.textContent = 'Clear';
  clear.title = 'Back to all time';
  clear.disabled = !rangeFilter;
  clear.addEventListener('click', () => {
    setRangeFilter(null);
    closeRangePopover(true);
  });

  const footer = document.createElement('div');
  footer.className = 'tt-range-footer';
  footer.append(clear, apply);

  pop.append(textSpan('tt-range-label', 'Period'), presets, textSpan('tt-range-label', 'Custom range'), fields, footer);
  document.body.appendChild(pop);

  // Close on a click outside, Esc, or focus moving away
  const onPointerDown = (e) => {
    if (!pop.contains(e.target) && !btn.contains(e.target)) closeRangePopover(false);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeRangePopover(true);
  };
  const onFocusOut = (e) => {
    const next = e.relatedTarget;
    if (next && !pop.contains(next) && next !== btn) closeRangePopover(false);
  };
  const onReflow = () => positionRangePopover();
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  pop.addEventListener('focusout', onFocusOut);
  window.addEventListener('resize', onReflow);
  window.addEventListener('scroll', onReflow, { capture: true, passive: true });

  rangePop = {
    el: pop,
    btn,
    cleanup: () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, { capture: true });
    }
  };
  btn.setAttribute('aria-expanded', 'true');
  positionRangePopover();
  pop.classList.add('open');
  const focusTarget = pop.querySelector('.tt-range-option[aria-pressed="true"]') || pop.querySelector('.tt-range-option');
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

// Under the button, kept inside the viewport; flips above when there's no room below
function positionRangePopover() {
  if (!rangePop) return;
  const { el, btn } = rangePop;
  const margin = 8;
  const box = btn.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.max(margin, Math.min(box.left, window.innerWidth - width - margin));
  let top = box.bottom + 8;
  if (top + height > window.innerHeight - margin) {
    top = box.top - 8 - height >= margin
      ? box.top - 8 - height
      : Math.max(margin, window.innerHeight - height - margin);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function closeRangePopover(returnFocus) {
  if (!rangePop) return;
  const { el, btn, cleanup } = rangePop;
  rangePop = null;
  cleanup();
  el.remove();
  btn.setAttribute('aria-expanded', 'false');
  if (returnFocus) btn.focus({ preventScroll: true });
}

// ============================================================
// CATEGORY DONUT
// Part-to-whole at a glance: at most 6 segments (the smallest categories fold
// into "Other"), 2px surface gaps between segments, slices in category order
// so each category's color and place stay put. The legend lists every value
// as text, so the chart never depends on color or hover alone.
// ============================================================

const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_GAP = 1.3; // viewBox units ≈ 2px at the rendered size
const MAX_SLICES = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

let chartState = null; // { key, slices: Map(key → { circle, value, pct }), center }

function computeCategorySlices(now) {
  const log = getLog();
  const totals = getTaskTotalsInRange(log, now, resolveTimeRange(rangeFilter, now));
  const categories = getTaskCategories();
  const byCategory = new Map();
  let uncategorized = 0;

  Object.entries(totals).forEach(([taskId, ms]) => {
    const { task } = findTask(taskId);
    const categoryId = task ? task.categoryId : (log.tasks[taskId] && log.tasks[taskId].categoryId);
    const category = categoryId ? categories.find(c => c.id === categoryId) : null;
    if (category) byCategory.set(category.id, (byCategory.get(category.id) || 0) + ms);
    else uncategorized += ms;
  });

  let slices = categories
    .filter(c => byCategory.get(c.id) > 0)
    .map(c => ({ key: c.id, name: c.name, color: categoryColor(c), ms: byCategory.get(c.id) }));

  const maxCategorySlices = uncategorized > 0 ? MAX_SLICES - 1 : MAX_SLICES;
  if (slices.length > maxCategorySlices) {
    const keep = new Set([...slices].sort((a, b) => b.ms - a.ms).slice(0, maxCategorySlices - 1).map(s => s.key));
    const folded = slices.filter(s => !keep.has(s.key));
    slices = slices.filter(s => keep.has(s.key));
    slices.push({
      key: '__other',
      name: 'Other',
      detail: folded.map(s => s.name).join(', '),
      color: 'var(--task-cat-other)',
      ms: folded.reduce((sum, s) => sum + s.ms, 0)
    });
  }
  if (uncategorized > 0) {
    slices.push({ key: '__none', name: 'Uncategorized', color: 'var(--task-cat-none)', ms: uncategorized });
  }
  return slices;
}

// Arc geometry for each slice (gap centered on each boundary)
function sliceArcs(slices, total) {
  let offset = 0;
  return slices.map(slice => {
    const length = total > 0 ? (slice.ms / total) * DONUT_C : 0;
    const drawn = slices.length > 1 ? Math.max(length - DONUT_GAP, 0.01) : DONUT_C;
    const start = slices.length > 1 ? offset + DONUT_GAP / 2 : 0;
    offset += length;
    return { dasharray: `${drawn} ${DONUT_C - drawn}`, dashoffset: String(-start) };
  });
}

function renderCategoryChart(now) {
  const host = $('#tt-category-chart');
  if (!host) return;
  hideChartTooltip();
  const filterBtn = getRangeButton();
  filterBtn.remove();
  host.innerHTML = '';
  chartState = null;

  const slices = computeCategorySlices(now);
  const total = slices.reduce((sum, s) => sum + s.ms, 0);
  if (total <= 0) {
    // The filter stays reachable while one is set, even with nothing to show
    const hasAnyTime = Object.keys(getTaskTotals(getLog(), now)).length > 0;
    if (rangeFilter || hasAnyTime) host.appendChild(filterBtn);
    else if (rangePop) closeRangePopover(false);
    const empty = document.createElement('div');
    empty.className = 'tt-empty';
    if (rangeFilter && hasAnyTime) {
      // There is time, just none in this period
      const span = formatRangeSpan(resolveTimeRange(rangeFilter, now));
      empty.textContent = `No tracked time in this period (${span}). `;
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'tt-range-reset';
      reset.textContent = 'Show all time';
      reset.addEventListener('click', () => setRangeFilter(null));
      empty.appendChild(reset);
    } else {
      empty.textContent = getTaskCategories().length > 0
        ? 'Your tracked time will be split by task category here.'
        : 'Add categories in Settings → Tasks (edit mode) to see how your time splits.';
    }
    host.appendChild(empty);
    positionRangePopover();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'tt-chart';

  // Donut
  const figure = document.createElement('div');
  figure.className = 'tt-donut';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Tracked time by category, ${rangeFilter ? filterLabel(rangeFilter, now) : 'all time'}: ` +
    slices.map(s => `${s.name} ${formatChartDuration(s.ms)}`).join(', '));

  const arcs = sliceArcs(slices, total);
  const sliceEls = new Map();
  slices.forEach((slice, i) => {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', 'tt-donut-slice');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', String(DONUT_R));
    circle.setAttribute('transform', 'rotate(-90 50 50)');
    circle.setAttribute('stroke-dasharray', arcs[i].dasharray);
    circle.setAttribute('stroke-dashoffset', arcs[i].dashoffset);
    circle.setAttribute('tabindex', '0');
    circle.style.stroke = slice.color;
    circle.dataset.key = slice.key;
    circle.addEventListener('pointerenter', (e) => showSliceTooltip(slice.key, e));
    circle.addEventListener('pointermove', (e) => positionChartTooltip(e));
    circle.addEventListener('pointerleave', () => { hideChartTooltip(); highlightSlice(null); });
    circle.addEventListener('focus', () => showSliceTooltip(slice.key, null));
    circle.addEventListener('blur', () => { hideChartTooltip(); highlightSlice(null); });
    svg.appendChild(circle);
    sliceEls.set(slice.key, { circle });
  });
  figure.appendChild(svg);

  const center = document.createElement('div');
  center.className = 'tt-donut-center';
  const centerValue = document.createElement('strong');
  centerValue.appendChild(document.createTextNode(formatChartDuration(total)));
  center.append(centerValue, textSpan('tt-donut-center-label', 'tracked'));
  figure.appendChild(center);

  const tooltip = document.createElement('div');
  tooltip.className = 'tt-chart-tooltip';
  tooltip.id = 'tt-chart-tooltip';
  tooltip.hidden = true;
  figure.appendChild(tooltip);

  // Legend (doubles as the table view: every value is readable as text)
  const legend = document.createElement('ul');
  legend.className = 'tt-legend';
  slices.forEach(slice => {
    const li = document.createElement('li');
    li.className = 'tt-legend-row';
    li.dataset.key = slice.key;
    if (slice.detail) li.title = slice.detail;
    const swatch = document.createElement('span');
    swatch.className = 'tt-legend-swatch';
    swatch.style.background = slice.color;
    const value = document.createElement('span');
    value.className = 'tt-legend-value';
    value.appendChild(document.createTextNode(formatChartDuration(slice.ms)));
    const pct = document.createElement('span');
    pct.className = 'tt-legend-pct';
    pct.appendChild(document.createTextNode(formatPercent(slice.ms / total)));
    li.append(swatch, textSpan('tt-legend-name', slice.name), value, pct);
    li.addEventListener('pointerenter', () => highlightSlice(slice.key));
    li.addEventListener('pointerleave', () => highlightSlice(null));
    legend.appendChild(li);
    Object.assign(sliceEls.get(slice.key), { value, pct });
  });

  // The filter sits on top of the legend, aligned with it (and moves with it
  // when the chart stacks on a narrow card)
  const legendCol = document.createElement('div');
  legendCol.className = 'tt-legend-col';
  legendCol.append(filterBtn, legend);

  wrap.append(figure, legendCol);
  host.appendChild(wrap);
  chartState = { key: slices.map(s => s.key).join('|'), slices: sliceEls, centerValue, data: slices, total };
  positionRangePopover();
}

// Once a minute while a timer runs: move arcs and numbers in place, or rebuild
// if the set of slices changed
function updateCategoryChart(now) {
  const slices = computeCategorySlices(now);
  const key = slices.map(s => s.key).join('|');
  if (!chartState || chartState.key !== key) {
    renderCategoryChart(now);
    return;
  }
  const total = slices.reduce((sum, s) => sum + s.ms, 0);
  const arcs = sliceArcs(slices, total);
  slices.forEach((slice, i) => {
    const els = chartState.slices.get(slice.key);
    els.circle.setAttribute('stroke-dasharray', arcs[i].dasharray);
    els.circle.setAttribute('stroke-dashoffset', arcs[i].dashoffset);
    setText(els.value, formatChartDuration(slice.ms));
    setText(els.pct, formatPercent(slice.ms / total));
  });
  setText(chartState.centerValue, formatChartDuration(total));
  chartState.data = slices;
  chartState.total = total;
}

function highlightSlice(key) {
  const host = $('#tt-category-chart');
  if (!host) return;
  host.querySelectorAll('.tt-donut-slice').forEach(c => {
    c.classList.toggle('is-hover', c.dataset.key === key);
    c.classList.toggle('is-dimmed', key !== null && c.dataset.key !== key);
  });
  host.querySelectorAll('.tt-legend-row').forEach(r => r.classList.toggle('is-hover', r.dataset.key === key));
}

function showSliceTooltip(key, event) {
  const tooltip = $('#tt-chart-tooltip');
  if (!tooltip || !chartState) return;
  const slice = chartState.data.find(s => s.key === key);
  if (!slice) return;
  highlightSlice(key);

  tooltip.innerHTML = '';
  const keyLine = document.createElement('span');
  keyLine.className = 'tt-tip-key';
  keyLine.style.background = slice.color;
  const text = document.createElement('span');
  text.className = 'tt-tip-text';
  text.append(
    textSpan('tt-tip-value', `${formatChartDuration(slice.ms)} · ${formatPercent(slice.ms / chartState.total)}`),
    textSpan('tt-tip-label', slice.detail ? `${slice.name} (${slice.detail})` : slice.name)
  );
  tooltip.append(keyLine, text);
  tooltip.hidden = false;
  positionChartTooltip(event);
}

function positionChartTooltip(event) {
  const tooltip = $('#tt-chart-tooltip');
  if (!tooltip || tooltip.hidden) return;
  const figure = tooltip.parentElement;
  const box = figure.getBoundingClientRect();
  // Keyboard focus has no pointer: sit above the donut's center
  const x = event ? event.clientX - box.left : box.width / 2;
  const y = event ? event.clientY - box.top : box.height / 2;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  // Near the top of the donut there's no room above the pointer: flip below
  tooltip.classList.toggle('is-below', y < tooltip.offsetHeight + 20);
}

function hideChartTooltip() {
  const tooltip = $('#tt-chart-tooltip');
  if (tooltip) tooltip.hidden = true;
}

// ============================================================
// INIT
// ============================================================

export function initTimeTracking() {
  const toggle = $('#time-tracking-toggle');
  if (toggle) toggle.addEventListener('click', toggleTimeTracking);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const card = $('#time-tracking-card');
  if (card && model.timeTrackingExpanded) showPanel(card);
  refreshTimeTrackingUI();
}
