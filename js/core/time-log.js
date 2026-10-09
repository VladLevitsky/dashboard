// Personal Dashboard - Task Time Log (pure data helpers)
// No DOM and no imports, so the cloud-sync layer and the Node smoke test
// (Reference/time-log-test.mjs) can use it directly.
//
// The log lives at model.timeTracking and is saved with the profile:
//   {
//     active:    null | { taskId, start },  // the one running timer (epoch ms)
//     changedAt: 0,      // epoch ms of the last start/stop; the newest side wins a merge
//     resetAt:   0,      // epoch ms of the last import; older sessions come only from that side
//     tasks: {           // keyed by task id, so history outlives a deleted task
//       [taskId]: { title, categoryId, sessions: [[startMs, endMs], ...] }
//     },
//     removed: ['taskId@startMs', ...]  // deleted sessions, so a merge can't bring them back
//   }
// Sessions are [start, end] pairs of epoch ms, sorted oldest first.

// Shorter sessions are accidental double-clicks, not work
export const MIN_SESSION_MS = 1000;
const REMOVED_LIMIT = 2000;

export function createEmptyTimeLog() {
  return { active: null, changedAt: 0, resetAt: 0, tasks: {}, removed: [] };
}

const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const sessionKey = (taskId, start) => `${taskId}@${start}`;

// Collapse sessions that share a start time. When two devices stopped the
// same session, the earlier stop is the real one.
function dedupeSessions(sessions) {
  const byStart = new Map();
  for (const [start, end] of sessions) {
    const prev = byStart.get(start);
    if (prev === undefined || end < prev) byStart.set(start, end);
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]);
}

// Validate and copy a log read from storage, an import or the cloud
export function normalizeTimeLog(raw) {
  const log = createEmptyTimeLog();
  if (!raw || typeof raw !== 'object') return log;

  if (raw.active && typeof raw.active.taskId === 'string' && isTime(raw.active.start)) {
    log.active = { taskId: raw.active.taskId, start: raw.active.start };
  }
  if (isTime(raw.changedAt)) log.changedAt = raw.changedAt;
  if (isTime(raw.resetAt)) log.resetAt = raw.resetAt;

  if (raw.tasks && typeof raw.tasks === 'object') {
    for (const [taskId, entry] of Object.entries(raw.tasks)) {
      if (!entry || typeof entry !== 'object') continue;
      const sessions = Array.isArray(entry.sessions)
        ? entry.sessions.filter(s => Array.isArray(s) && isTime(s[0]) && isTime(s[1]) && s[1] > s[0])
        : [];
      const isActive = log.active && log.active.taskId === taskId;
      if (sessions.length === 0 && !isActive) continue;
      log.tasks[taskId] = {
        title: typeof entry.title === 'string' ? entry.title : '',
        categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : null,
        sessions: dedupeSessions(sessions)
      };
    }
  }

  if (Array.isArray(raw.removed)) {
    log.removed = raw.removed.filter(k => typeof k === 'string').slice(-REMOVED_LIMIT);
  }

  // A running timer always has an entry to hang its metadata on
  if (log.active && !log.tasks[log.active.taskId]) {
    log.tasks[log.active.taskId] = { title: '', categoryId: null, sessions: [] };
  }
  return log;
}

// Remember the task's current title/category so its history reads correctly
// even after the task is deleted
export function rememberTaskMeta(log, taskId, meta) {
  let entry = log.tasks[taskId];
  if (!entry) {
    entry = { title: '', categoryId: null, sessions: [] };
    log.tasks[taskId] = entry;
  }
  if (meta) {
    if (typeof meta.title === 'string') entry.title = meta.title;
    entry.categoryId = meta.categoryId || null;
  }
  return entry;
}

// Stop the running timer and record its session. Returns the closed
// { taskId, start, end } or null if nothing was running.
export function stopActiveTimer(log, now) {
  const active = log.active;
  if (!active) return null;
  const end = Math.max(now, active.start);
  log.active = null;
  log.changedAt = now;

  const entry = log.tasks[active.taskId] || rememberTaskMeta(log, active.taskId, null);
  if (end - active.start >= MIN_SESSION_MS) {
    entry.sessions = dedupeSessions([...entry.sessions, [active.start, end]]);
  } else if (entry.sessions.length === 0) {
    delete log.tasks[active.taskId];
  }
  return { taskId: active.taskId, start: active.start, end };
}

// Start a timer. Only one runs at a time, so any other timer is stopped
// (and recorded) first. Returns the session that was closed, if any.
export function startTaskTimer(log, taskId, meta, now) {
  if (log.active && log.active.taskId === taskId) return null;
  const closed = stopActiveTimer(log, now);
  rememberTaskMeta(log, taskId, meta);
  log.active = { taskId, start: now };
  log.changedAt = now;
  return closed;
}

// Delete one closed session
export function removeSession(log, taskId, start) {
  const entry = log.tasks[taskId];
  if (!entry) return false;
  const before = entry.sessions.length;
  entry.sessions = entry.sessions.filter(s => s[0] !== start);
  if (entry.sessions.length === before) return false;
  log.removed = [...log.removed, sessionKey(taskId, start)].slice(-REMOVED_LIMIT);
  if (entry.sessions.length === 0 && !(log.active && log.active.taskId === taskId)) {
    delete log.tasks[taskId];
  }
  return true;
}

// Delete all of a task's time, including a running session (not recorded)
export function clearTaskTime(log, taskId, now) {
  const entry = log.tasks[taskId];
  if (entry) {
    const keys = entry.sessions.map(s => sessionKey(taskId, s[0]));
    log.removed = [...log.removed, ...keys].slice(-REMOVED_LIMIT);
    delete log.tasks[taskId];
  }
  if (log.active && log.active.taskId === taskId) {
    log.active = null;
    log.changedAt = now;
  }
}

// Total tracked time for one task, including the running session
export function getTaskTotalMs(log, taskId, now) {
  let total = 0;
  const entry = log.tasks[taskId];
  if (entry) {
    for (const [start, end] of entry.sessions) total += end - start;
  }
  if (log.active && log.active.taskId === taskId && now > log.active.start) {
    total += now - log.active.start;
  }
  return total;
}

// { taskId: totalMs } for every task that has time
export function getTaskTotals(log, now) {
  const totals = {};
  for (const taskId of Object.keys(log.tasks)) {
    const total = getTaskTotalMs(log, taskId, now);
    if (total > 0) totals[taskId] = total;
  }
  return totals;
}

// ============================================================
// PERIODS (the Categories filter in the Time Tracking panel)
// Local calendar days, built with new Date(y, m, d) so DST days come out
// right. A filter is null (all time), { preset } or { from?, to? } with
// inclusive 'YYYY-MM-DD' day keys; a range is { start, end, from, to } with
// end exclusive and null for an open side.
// ============================================================

export const TIME_RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'last14', label: 'Last 14 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisYear', label: 'This year' }
];

const pad2 = (n) => String(n).padStart(2, '0');

export function toDayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 'YYYY-MM-DD' → local midnight, or null if it isn't a real day
export function dayKeyToDate(key) {
  const m = typeof key === 'string' ? key.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toDayKey(date) === key ? date : null;
}

// Validate a stored filter. Anything unknown reads as all time (null).
export function normalizeRangeFilter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.preset === 'string') {
    return TIME_RANGE_PRESETS.some(p => p.id === raw.preset) ? { preset: raw.preset } : null;
  }
  let from = dayKeyToDate(raw.from) ? raw.from : null;
  let to = dayKeyToDate(raw.to) ? raw.to : null;
  if (!from && !to) return null;
  if (from && to && from > to) [from, to] = [to, from];
  const filter = {};
  if (from) filter.from = from;
  if (to) filter.to = to;
  return filter;
}

// Weeks start on Monday (quick capture's "eow" is that week's Friday)
function presetDays(id, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  switch (id) {
    case 'today': return [today, new Date(y, m, d + 1)];
    case 'thisWeek': {
      const monday = d - ((today.getDay() + 6) % 7);
      return [new Date(y, m, monday), new Date(y, m, monday + 7)];
    }
    case 'last14': return [new Date(y, m, d - 13), new Date(y, m, d + 1)];
    case 'thisMonth': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
    case 'lastMonth': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
    case 'thisYear': return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
    default: return null;
  }
}

// The filter as a concrete range at `now`, or null for all time
export function resolveTimeRange(filter, nowMs) {
  const f = normalizeRangeFilter(filter);
  if (!f) return null;
  if (f.preset) {
    const [first, after] = presetDays(f.preset, new Date(nowMs));
    const last = new Date(after.getFullYear(), after.getMonth(), after.getDate() - 1);
    return { start: first.getTime(), end: after.getTime(), from: toDayKey(first), to: toDayKey(last) };
  }
  const first = f.from ? dayKeyToDate(f.from) : null;
  const last = f.to ? dayKeyToDate(f.to) : null;
  const after = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) : null;
  return {
    start: first ? first.getTime() : null,
    end: after ? after.getTime() : null,
    from: f.from || null,
    to: f.to || null
  };
}

// Time inside the range: a session that crosses a boundary counts only the
// part inside it, and the running session counts up to now
function overlapMs(start, end, range) {
  const from = range.start === null ? start : Math.max(start, range.start);
  const to = range.end === null ? end : Math.min(end, range.end);
  return Math.max(0, to - from);
}

// Does a session [start, end) touch the range? (null = all time)
export function sessionInRange(start, end, range) {
  return !range || overlapMs(start, end, range) > 0;
}

// One task's time inside the range (null = all time), running session included
export function getTaskTotalInRange(log, taskId, now, range) {
  if (!range) return getTaskTotalMs(log, taskId, now);
  let total = 0;
  const entry = log.tasks[taskId];
  if (entry) {
    for (const [start, end] of entry.sessions) total += overlapMs(start, end, range);
  }
  if (log.active && log.active.taskId === taskId && now > log.active.start) {
    total += overlapMs(log.active.start, now, range);
  }
  return total;
}

// Like getTaskTotals, limited to a range (null = all time)
export function getTaskTotalsInRange(log, now, range) {
  if (!range) return getTaskTotals(log, now);
  const totals = {};
  for (const taskId of Object.keys(log.tasks)) {
    const total = getTaskTotalInRange(log, taskId, now, range);
    if (total > 0) totals[taskId] = total;
  }
  return totals;
}

// When the task was last timed (epoch ms; `now` while it runs), counting only
// sessions that touch the range and clamped to its end, so "Last month" sorts
// by activity inside last month. 0 = never in the range.
export function getTaskLastActive(log, taskId, now, range) {
  const end = range && range.end !== null ? range.end : Infinity;
  if (log.active && log.active.taskId === taskId && now > log.active.start &&
      sessionInRange(log.active.start, now, range)) {
    return Math.min(now, end);
  }
  let last = 0;
  const entry = log.tasks[taskId];
  if (entry) {
    for (const [start, stop] of entry.sessions) {
      if (sessionInRange(start, stop, range)) last = Math.max(last, Math.min(stop, end));
    }
  }
  return last;
}

// Merge two copies of the log (this device's and the cloud's) so neither
// device's sessions are lost when both tracked time before syncing.
// - Sessions: union, deduped by start (earliest end wins), minus tombstones.
// - Running timer: the side with the newer start/stop wins; the other side's
//   running session is closed at the moment it was superseded (one timer at a time).
// - Import: sessions that started before the newest import come only from the
//   side that performed it, so an imported backup really replaces older history.
export function mergeTimeLogs(localRaw, remoteRaw) {
  const L = normalizeTimeLog(localRaw);
  const R = normalizeTimeLog(remoteRaw);
  const out = createEmptyTimeLog();

  out.resetAt = Math.max(L.resetAt, R.resetAt);
  const keepFrom = (side) => (start) => start >= out.resetAt || side.resetAt === out.resetAt;
  const keepL = keepFrom(L);
  const keepR = keepFrom(R);

  out.removed = [...new Set([...R.removed, ...L.removed])].slice(-REMOVED_LIMIT);
  const removed = new Set(out.removed);

  const addSessions = (taskId, metaSide, sessions) => {
    if (!out.tasks[taskId]) {
      out.tasks[taskId] = { title: metaSide.title, categoryId: metaSide.categoryId, sessions: [] };
    }
    out.tasks[taskId].sessions.push(...sessions);
  };

  // Local metadata first: this device has the task's latest title/category
  for (const [taskId, entry] of Object.entries(L.tasks)) {
    addSessions(taskId, entry, entry.sessions.filter(s => keepL(s[0])));
  }
  for (const [taskId, entry] of Object.entries(R.tasks)) {
    addSessions(taskId, entry, entry.sessions.filter(s => keepR(s[0])));
  }

  // Running timer
  const localActive = L.active && keepL(L.active.start) ? L.active : null;
  const remoteActive = R.active && keepR(R.active.start) ? R.active : null;
  const remoteNewer = R.changedAt > L.changedAt;
  const winner = remoteNewer ? { active: remoteActive, changedAt: R.changedAt } : { active: localActive, changedAt: L.changedAt };
  const loserActive = remoteNewer ? localActive : remoteActive;
  const loserTasks = remoteNewer ? L.tasks : R.tasks;

  out.active = winner.active ? { ...winner.active } : null;
  out.changedAt = Math.max(L.changedAt, R.changedAt);

  const sameActive = winner.active && loserActive &&
    winner.active.taskId === loserActive.taskId && winner.active.start === loserActive.start;
  if (loserActive && !sameActive && winner.changedAt - loserActive.start >= MIN_SESSION_MS) {
    const meta = loserTasks[loserActive.taskId] || { title: '', categoryId: null };
    addSessions(loserActive.taskId, meta, [[loserActive.start, winner.changedAt]]);
  }

  // Dedupe, apply tombstones, drop empty entries
  for (const [taskId, entry] of Object.entries(out.tasks)) {
    entry.sessions = dedupeSessions(entry.sessions.filter(s => !removed.has(sessionKey(taskId, s[0]))));
    const isActive = out.active && out.active.taskId === taskId;
    if (entry.sessions.length === 0 && !isActive) delete out.tasks[taskId];
  }
  if (out.active && !out.tasks[out.active.taskId]) {
    out.tasks[out.active.taskId] = { title: '', categoryId: null, sessions: [] };
  }
  return out;
}

// Prepare an imported log: it replaces all history older than now. A timer
// that was running when the backup was exported closes at the export time.
export function prepareImportedTimeLog(raw, exportedAt, now) {
  const log = normalizeTimeLog(raw);
  if (log.active) {
    const end = isTime(exportedAt) ? Math.min(exportedAt, now) : log.active.start;
    stopActiveTimer(log, end);
  }
  log.changedAt = now;
  log.resetAt = now;
  return log;
}
