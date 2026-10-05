// Personal Dashboard - Mobile shell: task actions (unit F1)
// Every task write the shell makes goes through here, straight to the data
// API (completeTask, updateTask, restoreCompletedTask, ...), then
// refreshTimeTrackingUI() / refreshProjectHighlights(). Nothing here calls
// refreshTaskViews() (that would render the whole grid and the matrix): the
// shell repaints through the model:saved funnel. Every placement and every
// completion can be undone:
//   - placeTaskWithUndo: planPlacement (pure) → recolour through updateTask →
//     applyPlacement → one save; Undo restores the snapshot of the colours it
//     touched, unless the list changed since (colorsSignature)
//   - completeWithUndo: the ring fills, the row folds away, completeTask; the
//     completions made while the toast is up join one "3 completed · Undo",
//     which puts each task back at its exact index (reverse order)
// Also the actions sheet (⋯ / hold in Today / the screen-reader button).
// The service object is `taskActions` (SPEC §9.9).

import {
  getAllTasks, getTaskById, updateTask, completeTask, deleteTask, openEditTaskModal, restoreCompletedTask, generateSubtaskId,
} from '../tasks.js';
import { refreshTimeTrackingUI, toggleTaskTimer, isTaskTimerRunning } from '../time-tracking.js';
import { saveModel } from '../../core/storage.js';
import { toDateKey, fromDateKey } from '../../core/quick-capture-parse.js';
import { addDays } from '../../core/agenda.js';
import { shortDay } from '../../core/mobile-common.js';
import {
  planPlacement, applyPlacement, snapshotColors, colorsSignature, restoreSnapshot, bucket, normColor,
  completeSubtaskUpdates, MOBILE_COLOR_LABELS, SEGMENT_LABELS,
} from '../../core/mobile-tasks.js';
import { buildMeta, ICONS } from './task-row.js?v=2026-10-mobile-1';
import { shieldTaps } from './task-gestures.js?v=2026-10-mobile-1';

const BATCH_MS = 7000;
const SUBTASKS_SHOWN = 6;

const svg = (body, size = 22) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const SHEET_ICONS = {
  done: svg('<circle cx="12" cy="12" r="9"></circle><polyline points="8.5 12.5 11 15 15.5 9.5"></polyline>'),
  timer: svg('<circle cx="12" cy="13.5" r="7.5"></circle><line x1="12" y1="13.5" x2="12" y2="10"></line><line x1="10" y1="2.5" x2="14" y2="2.5"></line><line x1="12" y1="2.5" x2="12" y2="6"></line>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2"></rect>'),
  open: svg('<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>'),
  move: svg('<polyline points="8 4 8 20"></polyline><polyline points="4.5 7.5 8 4 11.5 7.5"></polyline><polyline points="16 20 16 4"></polyline><polyline points="12.5 16.5 16 20 19.5 16.5"></polyline>', 20),
  place: svg('<path d="M18 11V7a2 2 0 0 0-4 0v3"></path><path d="M14 10V5a2 2 0 0 0-4 0v5"></path><path d="M10 9.5V7a2 2 0 0 0-4 0v7.5"></path><path d="M18 9a2 2 0 0 1 4 0v4a8 8 0 0 1-8 8h-2a8 8 0 0 1-6-2.7L3.3 15.3a2 2 0 0 1 2.8-2.8L8 14"></path>', 20),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>', 20),
  chevron: svg('<polyline points="9 6 15 12 9 18"></polyline>', 18),
  trash: svg('<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>', 20),
};

function groupLabel(pinned) {
  return pinned ? SEGMENT_LABELS.primary : SEGMENT_LABELS.secondary;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function todayKey() {
  return toDateKey(new Date());
}

// view: { rowEl(id), flash(id), startCarry(id, { fromKeyboard }), revealTask(id), openMoveSheet(id) }
export function createTaskActions(api, view) {
  const pending = new Set();            // completions in flight (animating out)
  let batch = null;                     // { entries, msg, timer }

  function repaintExtras() {
    try { refreshTimeTrackingUI(); } catch (err) { console.error('[mobile] refreshTimeTrackingUI failed', err); }
    if (window.refreshProjectHighlights) {
      try { window.refreshProjectHighlights(); } catch (err) { console.error('[mobile] refreshProjectHighlights failed', err); }
    }
  }

  // --- Placement ------------------------------------------------------------------

  // target = { color?, pinned?, index? } (mobile-tasks.js planPlacement). Returns { plan, undo } or null
  function placeTaskWithUndo(taskId, target = {}, { quiet = false, flash = true } = {}) {
    const plan = planPlacement(getAllTasks(), taskId, target);
    if (!plan || !plan.moved) return null;
    const colors = [...new Set([plan.from.color, plan.to.color])];
    const snap = snapshotColors(getAllTasks(), colors);
    if (plan.colorChanged) updateTask(taskId, { color: plan.to.color });
    applyPlacement(getAllTasks(), plan);
    saveModel();
    const after = colorsSignature(getAllTasks(), colors);
    repaintExtras();
    if (flash && view.flash) view.flash(taskId);

    const undo = () => {
      if (colorsSignature(getAllTasks(), colors) !== after) {
        api.toast('Can’t undo: the list changed since');
        return false;
      }
      if (plan.colorChanged && getTaskById(taskId)) updateTask(taskId, { color: plan.from.color });
      restoreSnapshot(getAllTasks(), snap);
      saveModel();
      repaintExtras();
      if (view.flash) view.flash(taskId);
      return true;
    };
    if (!quiet) {
      let msg;
      if (plan.colorChanged) msg = `Moved to ${MOBILE_COLOR_LABELS[plan.to.color]} · ${groupLabel(plan.to.pinned)}`;
      else if (plan.pinnedChanged) msg = `Moved to ${groupLabel(plan.to.pinned)}`;
      else msg = `Moved to position ${plan.to.index + 1}`;
      api.toast(msg, [{ label: 'Undo', run: undo }]);
    }
    return { plan, undo };
  }

  // ⇣ Secondary / ⇡ Primary (boundary rule: next to the line it crosses)
  function toggleGroupWithUndo(taskId) {
    const task = getTaskById(taskId);
    if (!task) return null;
    return placeTaskWithUndo(taskId, { pinned: !task.pinned });
  }

  // --- Completion -----------------------------------------------------------------------

  function toastShows(msg) {
    const t = document.getElementById('qc-toast');
    if (!t || t.hidden) return false;
    const m = t.querySelector('.qc-toast-msg');
    return !!m && m.textContent === msg;
  }

  function joinBatch(entry) {
    if (!batch || !toastShows(batch.msg)) batch = { entries: [], msg: '', timer: 0 };
    const b = batch;
    b.entries.push(entry);
    clearTimeout(b.timer);
    b.msg = b.entries.length === 1 ? `Completed “${entry.title}”` : `${b.entries.length} completed`;
    api.toast(b.msg, [{ label: 'Undo', run: () => undoBatch(b) }]);
    b.timer = setTimeout(() => { if (batch === b) batch = null; }, BATCH_MS);
  }

  function undoBatch(b) {
    if (batch === b) batch = null;
    clearTimeout(b.timer);
    const restored = [];
    [...b.entries].reverse().forEach(({ id, color, pinned, index }) => {
      const task = restoreCompletedTask(id, { color, pinned });
      if (!task) return;
      placeTaskWithUndo(id, { color, pinned, index }, { quiet: true, flash: false });
      restored.push(id);
    });
    if (!restored.length) { api.toast('Can’t undo: already restored'); return; }
    repaintExtras();
    restored.forEach(id => view.flash && view.flash(id));
  }

  // Instant complete: the ring fills (120 ms), the row folds (220 ms), then
  // completeTask. opts: { slot?, swiped?, onAbort? }
  function completeWithUndo(taskId, opts = {}) {
    const task = getTaskById(taskId);
    if (!task || pending.has(taskId)) { if (opts.onAbort) opts.onAbort(); return false; }
    const color = normColor(task.color);
    const pinned = !!task.pinned;
    const title = task.title || 'Untitled Task';
    pending.add(taskId);
    const slot = opts.slot && opts.slot.isConnected ? opts.slot : (view.rowEl ? view.rowEl(taskId) : null);

    const finish = () => {
      pending.delete(taskId);
      const live = getTaskById(taskId);
      if (!live) { if (opts.onAbort) opts.onAbort(); return; }
      // The exact place it held, taken right before it leaves
      const index = bucket(getAllTasks(), color, pinned).indexOf(live);
      if (slot) slot.hidden = true;
      completeTask(taskId);
      repaintExtras();
      api.haptic('commit');
      joinBatch({ id: taskId, title, color, pinned, index });
    };

    if (!slot || api.reduceMotion()) { finish(); return true; }
    slot.dataset.state = 'completing';
    const fold = () => {
      const h = slot.getBoundingClientRect().height;
      const a = api.animate(slot, [
        { height: `${h}px`, opacity: 1, marginBottom: '0px' },
        { height: '0px', opacity: 0, marginBottom: '-6px' },
      ], { duration: 220, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
      if (a) { a.onfinish = finish; a.oncancel = finish; } else finish();
    };
    setTimeout(fold, opts.swiped ? 0 : 140);
    return true;
  }

  function restoreWithUndo(taskId) {
    const task = restoreCompletedTask(taskId);
    if (!task) return null;
    repaintExtras();
    const color = normColor(task.color);
    api.toast(`Restored to ${MOBILE_COLOR_LABELS[color]} · ${groupLabel(!!task.pinned)}`, [{
      label: 'Undo',
      run: () => {
        if (!getTaskById(taskId)) { api.toast('Can’t undo: the task has changed since'); return; }
        completeTask(taskId);
        repaintExtras();
      },
    }]);
    if (view.flash) view.flash(taskId);
    return task;
  }

  function completeSubtaskWithUndo(taskId, subtaskId) {
    const task = getTaskById(taskId);
    if (!task || !Array.isArray(task.subtasks)) return false;
    const sub = task.subtasks.find(s => s && s.id === subtaskId);
    if (!sub) return false;
    const before = task.subtasks;
    const next = completeSubtaskUpdates(before, subtaskId);
    updateTask(taskId, { subtasks: next });
    api.toast(`Completed “${sub.title || 'Subtask'}”`, [{
      label: 'Undo',
      run: () => {
        const cur = getTaskById(taskId);
        if (!cur || cur.subtasks !== next) { api.toast('Can’t undo: the task has changed since'); return; }
        updateTask(taskId, { subtasks: before });
      },
    }]);
    return true;
  }

  function setDueWithUndo(taskId, key) {
    const task = getTaskById(taskId);
    if (!task) return;
    const before = task.dueDate || null;
    const nextKey = key || null;
    if (before === nextKey) return;
    updateTask(taskId, { dueDate: nextKey });
    if (window.updateNotificationBadge) {
      try { window.updateNotificationBadge(); } catch { /* the shell's due lens repaints on save anyway */ }
    }
    api.toast(nextKey ? `Due ${shortDay(nextKey)}` : 'Due date cleared', [{
      label: 'Undo',
      run: () => { if (getTaskById(taskId)) updateTask(taskId, { dueDate: before }); },
    }]);
  }

  function openTask(taskId) {
    if (!getTaskById(taskId)) return;
    openEditTaskModal(taskId);
    shieldTaps();       // a double tap's second tap never lands in the editor
  }

  function toggleTimer(taskId) {
    if (!getTaskById(taskId)) return;
    toggleTaskTimer(taskId);
    refreshTimeTrackingUI();
  }

  // --- Actions sheet (W5) -----------------------------------------------------------------

  function dueChoices() {
    const today = todayKey();
    const date = fromDateKey(today);
    const dow = date.getDay();
    let toFri = (5 - dow + 7) % 7;
    const out = [{ label: 'Today', key: today }, { label: 'Tomorrow', key: addDays(today, 1) }];
    if (toFri >= 2) out.push({ label: 'Fri', key: addDays(today, toFri) });
    else out.push({ label: 'Next Mon', key: addDays(today, ((1 - dow + 7) % 7) || 7) });
    return out;
  }

  function openActionsSheet(taskId) {
    if (!getTaskById(taskId)) return null;
    shieldTaps();
    let showAllSubs = false;
    const sheet = api.openSheet({
      id: 'task-actions',
      size: 'auto',
      keyboardAware: true,
      build(body, handle) {
        const task = getTaskById(taskId);
        if (!task) { handle.close({ immediate: true }); return; }
        const color = normColor(task.color);
        body.className = `mx-sheet-body mx-actions mx-tone-${color}`;
        const pinned = !!task.pinned;

        // Header: dot + title, then group · colour · meta
        const head = el('div', `mx-actions-head mx-tone-${color}`);
        const dot = el('span', 'mx-actions-dot');
        dot.setAttribute('aria-hidden', 'true');
        const h = el('h2', 'mx-actions-title', task.title || 'Untitled Task');
        head.append(dot, h);
        const meta = el('p', 'mx-actions-meta');
        meta.append(el('span', '', `${groupLabel(pinned)} · ${MOBILE_COLOR_LABELS[color]}`));
        buildMeta(task, todayKey()).forEach(n => meta.append(n));
        body.append(head, meta);

        // Three big actions
        const big = el('div', 'mx-actions-big');
        const bigBtn = (cls, icon, label, run) => {
          const b = el('button', `mx-big-btn ${cls}`);
          b.type = 'button';
          b.innerHTML = icon;
          b.appendChild(el('span', '', label));
          b.addEventListener('click', run);
          return b;
        };
        const running = isTaskTimerRunning(taskId);
        big.append(
          bigBtn('mx-big-done', SHEET_ICONS.done, 'Done', () => { handle.close(); completeWithUndo(taskId); }),
          bigBtn(`mx-big-timer${running ? ' is-running' : ''}`, running ? SHEET_ICONS.stop : SHEET_ICONS.timer, running ? 'Stop' : 'Start',
            () => { toggleTimer(taskId); handle.update(); }),
          bigBtn('mx-big-open', SHEET_ICONS.open, 'Open', () => { handle.close({ immediate: true }); openTask(taskId); }),
        );
        body.append(big);

        // Open subtasks (complete with Undo) and a quick add
        const subs = (Array.isArray(task.subtasks) ? task.subtasks : []).filter(s => s && !s.completed && String(s.title || '').trim());
        const subSec = el('section', 'mx-actions-sec');
        subSec.append(el('h3', 'mx-sec-label', subs.length ? `Subtasks · ${subs.length} open` : 'Subtasks'));
        const list = el('div', 'mx-sub-list');
        const shown = showAllSubs ? subs : subs.slice(0, SUBTASKS_SHOWN);
        shown.forEach(s => {
          const row = el('div', 'mx-sub-row');
          const ring = el('button', 'mx-check mx-sub-check');
          ring.type = 'button';
          ring.setAttribute('aria-label', `Complete subtask “${s.title}”`);
          ring.innerHTML = `<span class="mx-ring" aria-hidden="true">${ICONS.check}</span>`;
          ring.addEventListener('click', () => {
            ring.closest('.mx-sub-row').dataset.state = 'completing';
            setTimeout(() => { completeSubtaskWithUndo(taskId, s.id); handle.update(); }, api.reduceMotion() ? 0 : 160);
          });
          const t = el('span', 'mx-sub-title', s.title);
          row.append(ring, t);
          if (s.dueDate) {
            const st = el('span', 'mx-sub-due', shortDay(s.dueDate));
            row.append(st);
          }
          list.append(row);
        });
        if (subs.length > shown.length) {
          const more = el('button', 'mx-link-btn', `+${subs.length - shown.length} more`);
          more.type = 'button';
          more.addEventListener('click', () => { showAllSubs = true; handle.update(); });
          list.append(more);
        }
        const add = el('form', 'mx-sub-add');
        add.setAttribute('autocomplete', 'off');
        const plus = el('span', 'mx-sub-add-icon');
        plus.innerHTML = SHEET_ICONS.plus;
        const input = el('input', 'mx-sub-input');
        input.type = 'text';
        input.placeholder = 'Add subtask…';
        input.setAttribute('aria-label', 'Add a subtask');
        input.enterKeyHint = 'done';
        add.append(plus, input);
        add.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          const cur = getTaskById(taskId);
          if (!text || !cur) return;
          const next = [...(Array.isArray(cur.subtasks) ? cur.subtasks : []), { id: generateSubtaskId(), title: text, description: '', completed: false, important: false }];
          updateTask(taskId, { subtasks: next });
          input.value = '';
          api.toast(`Added “${text}”`);
          handle.update();
          const again = handle.body.querySelector('.mx-sub-input');
          if (again) again.focus({ preventScroll: true });
        });
        list.append(add);
        subSec.append(list);
        body.append(subSec);

        // Due date chips
        const dueSec = el('section', 'mx-actions-sec');
        dueSec.append(el('h3', 'mx-sec-label', task.dueDate ? `Due · ${shortDay(task.dueDate)}` : 'Due'));
        const chips = el('div', 'mx-chip-row');
        dueChoices().forEach(c => {
          const b = el('button', 'mx-chip', c.label);
          b.type = 'button';
          b.setAttribute('aria-pressed', task.dueDate === c.key ? 'true' : 'false');
          b.title = shortDay(c.key);
          b.addEventListener('click', () => { setDueWithUndo(taskId, c.key); handle.update(); });
          chips.append(b);
        });
        const pick = el('label', 'mx-chip mx-chip-pick');
        pick.append(el('span', '', 'Pick…'));
        const date = el('input', 'mx-date-input');
        date.type = 'date';
        date.value = task.dueDate || '';
        date.setAttribute('aria-label', 'Pick a due date');
        date.addEventListener('change', () => { if (date.value) { setDueWithUndo(taskId, date.value); handle.update(); } });
        pick.append(date);
        chips.append(pick);
        if (task.dueDate) {
          const clear = el('button', 'mx-chip mx-chip-quiet', 'Clear');
          clear.type = 'button';
          clear.addEventListener('click', () => { setDueWithUndo(taskId, null); handle.update(); });
          chips.append(clear);
        }
        dueSec.append(chips);
        body.append(dueSec);

        // Move, place, group, delete
        const rows = el('div', 'mx-actions-list');
        const rowBtn = (cls, icon, label, run, chevron = false) => {
          const b = el('button', `mx-row-btn ${cls}`);
          b.type = 'button';
          b.innerHTML = icon;
          b.appendChild(el('span', 'mx-row-btn-label', label));
          if (chevron) { const c = el('span', 'mx-row-btn-chev'); c.innerHTML = SHEET_ICONS.chevron; b.appendChild(c); }
          b.addEventListener('click', run);
          return b;
        };
        rows.append(
          rowBtn('mx-act-move', SHEET_ICONS.move, 'Move…', () => { handle.close({ immediate: true }); if (view.openMoveSheet) view.openMoveSheet(taskId); }, true),
          rowBtn('mx-act-place', SHEET_ICONS.place, 'Place in list', (e) => {
            handle.close({ immediate: true });
            if (view.startCarry) view.startCarry(taskId, { fromKeyboard: e.detail === 0 });
          }, true),
          rowBtn('mx-act-group', pinned ? ICONS.down : ICONS.up, pinned ? 'Move to Secondary' : 'Move to Primary', () => {
            handle.close();
            toggleGroupWithUndo(taskId);
          }),
          rowBtn('mx-act-delete mx-danger', SHEET_ICONS.trash, 'Delete task…', () => {
            const cur = getTaskById(taskId);
            if (!cur) { handle.close(); return; }
            if (!window.confirm(`Delete “${cur.title || 'Untitled Task'}”? This can’t be undone.`)) return;
            handle.close();
            deleteTask(taskId);
            repaintExtras();
            api.toast('Task deleted');
          }),
        );
        body.append(rows);
      },
    });
    return sheet;
  }

  return {
    openTask,
    completeWithUndo,
    completeSubtaskWithUndo,
    restoreWithUndo,
    placeTaskWithUndo,
    toggleGroupWithUndo,
    setDueWithUndo,
    toggleTimer,
    openActionsSheet,
    openMoveSheet: (id) => (view.openMoveSheet ? view.openMoveSheet(id) : null),
    revealTask: (id) => (view.revealTask ? view.revealTask(id) : null),
    startCarry: (id) => (view.startCarry ? view.startCarry(id) : null),
  };
}
