// Personal Dashboard - Mobile tasks: the pure rules (no DOM, Node-testable)
// The Tasks tab of the mobile shell (unit F1) shows one bucket at a time:
// a segment (Primary = pinned / Secondary) times a colour lens. Everything
// here is a plain function of the task list, so the counts, the default lens,
// where a moved task lands and how the colour is renumbered can be tested in
// Node against the real profile.
//
// Display order is the matrix's (tasks.js getTasksByColor): pinned first, then
// `order` ascending (missing = 0), then array position (a stable sort). A
// bucket is one colour x one group. Every placement renumbers the colours it
// touches 0..n-1 in display order, which also heals the gaps and collisions
// older data carries (orange 0,1,3,4,4).
//
// Day keys are local 'YYYY-MM-DD' (agenda.js rules, never toISOString).

import { dueState, daysBetween, addDays, TASK_COLOR_ORDER } from './agenda.js';
import { shortDay } from './mobile-common.js';

export const MOBILE_COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];
export const MOBILE_COLOR_LABELS = { red: 'Urgent & important', orange: 'Urgent', yellow: 'Important', blue: 'Later' };
export const SEGMENT_LABELS = { primary: 'Primary', secondary: 'Secondary' };

// Gesture constants for task-gestures.js (SPEC §2.4)
export const GESTURE = Object.freeze({
  SLOP: 8,                 // px a press may wander before it is a scroll / swipe
  LIFT_MS: 380,            // hold time that picks a task up
  SWIPE_MIN_DX: 10,
  SWIPE_RATIO: 1.5,        // |dx| > 1.5 |dy| = a horizontal swipe
  EDGE_GUARD: 24,          // px from either column edge: left to the OS (back swipe)
  SWIPE_COMMIT: 0.4,       // fraction of the row width that completes on release
  FLING_V: 0.65,           // px/ms ...
  FLING_MIN_DX: 64,        // ... with at least this travel
  REVEAL: 72,              // width of one revealed button; past it, swipe ← reveals
  AUTOSCROLL_ZONE: 64,
  AUTOSCROLL_MAX: 16,      // px per frame
});

// Unknown colours read as blue, the default (agenda.js colorRank rule)
export function normColor(color) {
  return MOBILE_COLOR_ORDER.includes(color) ? color : 'blue';
}

function list(tasks) {
  return Array.isArray(tasks) ? tasks.filter(t => t && typeof t === 'object') : [];
}

// The getTasksByColor order for one colour
export function displayOrder(tasks, color) {
  const c = normColor(color);
  return list(tasks)
    .map((task, i) => ({ task, i }))
    .filter(({ task }) => normColor(task.color) === c)
    .sort((a, b) =>
      (b.task.pinned ? 1 : 0) - (a.task.pinned ? 1 : 0) ||
      (a.task.order || 0) - (b.task.order || 0) ||
      a.i - b.i)
    .map(({ task }) => task);
}

// One colour x one group, in display order
export function bucket(tasks, color, pinned) {
  return displayOrder(tasks, color).filter(t => !!t.pinned === !!pinned);
}

// { primary: { total, red, orange, yellow, blue, hot: { red: bool, … } }, secondary: {…} }
// hot = a task in that bucket is due today or overdue
export function lensCounts(tasks, todayKey) {
  const make = () => ({ total: 0, red: 0, orange: 0, yellow: 0, blue: 0, hot: { red: false, orange: false, yellow: false, blue: false } });
  const out = { primary: make(), secondary: make() };
  list(tasks).forEach(task => {
    const seg = task.pinned ? out.primary : out.secondary;
    const c = normColor(task.color);
    seg.total++;
    seg[c]++;
    if (todayKey && dueState(task.dueDate, todayKey)) seg.hot[c] = true;
  });
  return out;
}

// The colour a segment opens on (SPEC §2.1):
//   1. the remembered colour (or 'all') for that segment, if its bucket is non-empty
//   2. else 'all' when the segment holds 10 tasks or fewer
//   3. else the first non-empty colour, red → blue
// segCounts = lensCounts(...)[segment]
export function defaultLens(segCounts, remembered) {
  const counts = segCounts || { total: 0 };
  if (remembered === 'all') return 'all';
  if (MOBILE_COLOR_ORDER.includes(remembered) && counts[remembered] > 0) return remembered;
  if ((counts.total || 0) <= 10) return 'all';
  return MOBILE_COLOR_ORDER.find(c => counts[c] > 0) || 'all';
}

// The panes of a lens: [{ color, tasks }] (the All lens gives all four, empty ones too)
export function lensTasks(tasks, segment, color) {
  const pinned = segment !== 'secondary';
  const colors = color === 'all' || !MOBILE_COLOR_ORDER.includes(color) ? MOBILE_COLOR_ORDER : [color];
  return colors.map(c => ({ color: c, tasks: bucket(tasks, c, pinned) }));
}

function clampIndex(index, length) {
  if (index === undefined || index === null || index === Infinity || Number.isNaN(Number(index))) return length;
  const n = Math.floor(Number(index));
  return Math.max(0, Math.min(n, length));
}

// Where a task lands. target = { color?, pinned?, index? }:
//   index = position inside the TARGET bucket (target colour x target group),
//   counted with the task removed; undefined / Infinity → the end; clamped.
//   A group change without an index follows the boundary rule: a demoted task
//   goes to the top of Secondary, a promoted one to the end of Primary, so it
//   stays next to the line it crossed. Any other target without an index (a
//   chip, a Move-sheet tile) is the end of that bucket.
// → null for an unknown task, else
//   { taskId, from: { color, pinned, index }, to: { color, pinned, index },
//     orders: [[id, order], …]   every task of the target colour renumbered 0..n-1
//                                (plus the source colour when the colour changes),
//     moved, colorChanged, pinnedChanged }
// A no-op (same bucket, same index) has moved:false and no orders.
export function planPlacement(tasks, taskId, { color, pinned, index } = {}) {
  const all = list(tasks);
  const task = all.find(t => t.id === taskId);
  if (!task) return null;
  const fromColor = normColor(task.color);
  const fromPinned = !!task.pinned;
  const fromIndex = bucket(all, fromColor, fromPinned).indexOf(task);
  const toColor = MOBILE_COLOR_ORDER.includes(color) ? color : fromColor;
  const toPinned = pinned === undefined || pinned === null ? fromPinned : !!pinned;
  const colorChanged = toColor !== fromColor;
  const pinnedChanged = toPinned !== fromPinned;

  const target = bucket(all, toColor, toPinned).filter(t => t !== task);
  let toIndex;
  if ((index === undefined || index === null) && pinnedChanged && !colorChanged) {
    toIndex = toPinned ? target.length : 0;
  } else {
    toIndex = clampIndex(index, target.length);
  }

  const from = { color: fromColor, pinned: fromPinned, index: fromIndex };
  const to = { color: toColor, pinned: toPinned, index: toIndex };
  const moved = colorChanged || pinnedChanged || toIndex !== fromIndex;
  if (!moved) return { taskId, from, to, orders: [], moved: false, colorChanged: false, pinnedChanged: false };

  const placed = [...target];
  placed.splice(toIndex, 0, task);
  const other = bucket(all, toColor, !toPinned).filter(t => t !== task);
  const sequence = toPinned ? [...placed, ...other] : [...other, ...placed];
  const orders = sequence.map((t, i) => [t.id, i]);
  if (colorChanged) {
    displayOrder(all, fromColor).filter(t => t !== task).forEach((t, i) => orders.push([t.id, i]));
  }
  return { taskId, from, to, orders, moved: true, colorChanged, pinnedChanged };
}

// Writes the plan: task.pinned (boolean) for the moved task and `order` for
// every pair. Never the colour (the caller recolours through updateTask, which
// also recolours highlights and the time log).
export function applyPlacement(tasks, plan) {
  if (!plan || !plan.moved) return false;
  const byId = new Map(list(tasks).map(t => [t.id, t]));
  const task = byId.get(plan.taskId);
  if (task) task.pinned = !!plan.to.pinned;
  (plan.orders || []).forEach(([id, order]) => {
    const t = byId.get(id);
    if (t) t.order = order;
  });
  return true;
}

// The index the boundary rule gives a group change
export function boundaryIndex(tasks, taskId, toPinned) {
  const all = list(tasks);
  const task = all.find(t => t.id === taskId);
  if (!task) return 0;
  if (!toPinned) return 0;
  return bucket(all, normColor(task.color), true).filter(t => t !== task).length;
}

// Top / Up / Down / Bottom inside the task's own bucket, clamped
export function stepIndex(tasks, taskId, step) {
  const all = list(tasks);
  const task = all.find(t => t.id === taskId);
  if (!task) return 0;
  const b = bucket(all, normColor(task.color), !!task.pinned);
  const i = b.indexOf(task);
  const last = b.length - 1;
  if (step === 'top') return 0;
  if (step === 'bottom') return Math.max(0, last);
  if (step === 'up') return Math.max(0, i - 1);
  if (step === 'down') return Math.min(Math.max(0, last), i + 1);
  return i;
}

function inColors(colors) {
  const set = new Set((Array.isArray(colors) ? colors : [colors]).map(normColor));
  return (t) => set.has(normColor(t.color));
}

// [{ id, color, pinned, order }] for every task in those colours (raw values,
// so a restore puts back exactly what was there, missing fields included)
export function snapshotColors(tasks, colors) {
  return list(tasks).filter(inColors(colors)).map(t => ({ id: t.id, color: t.color, pinned: t.pinned, order: t.order }));
}

// A stable string of id|color|pinned|order for those colours, sorted by id
export function colorsSignature(tasks, colors) {
  return list(tasks).filter(inColors(colors))
    .map(t => `${t.id}|${normColor(t.color)}|${t.pinned ? 1 : 0}|${t.order === undefined || t.order === null ? '' : t.order}`)
    .sort()
    .join(';');
}

// Writes pinned + order back by id (the colour is restored by the caller)
export function restoreSnapshot(tasks, snapshot) {
  const byId = new Map(list(tasks).map(t => [t.id, t]));
  (snapshot || []).forEach(s => {
    const t = byId.get(s.id);
    if (!t) return;
    if (s.pinned === undefined) delete t.pinned; else t.pinned = s.pinned;
    if (s.order === undefined) delete t.order; else t.order = s.order;
  });
}

function hasText(html) {
  if (typeof html !== 'string' || !html) return false;
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').trim().length > 0;
}

function linkCount(task) {
  if (Array.isArray(task.taskLinks) && task.taskLinks.length) return task.taskLinks.length;
  return typeof task.link === 'string' && task.link.trim() ? 1 : 0;
}

// The quiet line under a row title:
// { due: { kind: 'today'|'overdue'|'tomorrow'|'date', text, days?, date } | null,
//   subs: { done, total } | null, desc, links, categoryId }
export function rowMeta(task, todayKey) {
  const t = task || {};
  let due = null;
  const state = dueState(t.dueDate, todayKey);
  if (state) {
    due = state.when === 'today'
      ? { kind: 'today', text: 'Today', days: 0, date: state.date }
      : { kind: 'overdue', text: `Overdue · ${state.days}d`, days: state.days, date: state.date };
  } else if (typeof t.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) && todayKey) {
    const days = daysBetween(todayKey, t.dueDate);
    due = days === 1
      ? { kind: 'tomorrow', text: 'Tomorrow', days: -1, date: t.dueDate }
      : { kind: 'date', text: shortDay(t.dueDate) || t.dueDate, days: -days, date: t.dueDate };
  }
  const subtasks = (Array.isArray(t.subtasks) ? t.subtasks : []).filter(s => s && String(s.title || '').trim());
  const subs = subtasks.length ? { done: subtasks.filter(s => s.completed).length, total: subtasks.length } : null;
  return { due, subs, desc: hasText(t.description), links: linkCount(t), categoryId: t.categoryId || null };
}

// What a row shows; a row is rebuilt only when this changes
export function rowSignature(task, todayKey) {
  const t = task || {};
  const m = rowMeta(t, todayKey);
  return [t.title || '', normColor(t.color), t.pinned ? 1 : 0, t.dueDate || '',
    m.subs ? `${m.subs.done}/${m.subs.total}` : '', m.desc ? 1 : 0, m.links, m.categoryId || '', todayKey || ''].join('|');
}

// Tasks due in (today, today + days], soonest first (then colour, then display order)
export function upcomingTasks(tasks, todayKey, days = 7) {
  if (!todayKey) return [];
  const end = addDays(todayKey, days);
  const rank = (c) => TASK_COLOR_ORDER.indexOf(normColor(c));
  return list(tasks)
    .map((task, i) => ({ task, i }))
    .filter(({ task }) => !task.completed && typeof task.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) &&
      task.dueDate > todayKey && task.dueDate <= end)
    .sort((a, b) =>
      (a.task.dueDate < b.task.dueDate ? -1 : a.task.dueDate > b.task.dueDate ? 1 : 0) ||
      rank(a.task.color) - rank(b.task.color) ||
      (b.task.pinned ? 1 : 0) - (a.task.pinned ? 1 : 0) ||
      (a.task.order || 0) - (b.task.order || 0) || a.i - b.i)
    .map(({ task }) => task);
}

// The task editor's rule for a done subtask (today.js): completed, no longer
// important, no due date. Returns a new array; the input is not touched.
export function completeSubtaskUpdates(subtasks, subtaskId) {
  return (Array.isArray(subtasks) ? subtasks : []).map(s => {
    if (!s || s.id !== subtaskId) return s;
    const next = { ...s, completed: true, important: false };
    delete next.dueDate;
    return next;
  });
}
