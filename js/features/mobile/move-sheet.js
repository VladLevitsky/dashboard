// Personal Dashboard - Mobile shell: the Move sheet (unit F1, W6)
// The precise, tap-only way to move a task: a GROUP switch, the colour picker
// as a real 2×2 Eisenhower matrix (urgent / not urgent across, important /
// not important down) and POSITION steps. Every tap applies live through
// placeTaskWithUndo(…, { quiet: true }), so the list behind re-renders; the
// sheet takes one snapshot of all four colours when it opens and closing it
// shows ONE summary toast whose Undo restores that snapshot (and the colour),
// unless the list changed since.

import { getAllTasks, getTaskById, updateTask } from '../tasks.js';
import { saveModel } from '../../core/storage.js';
import {
  MOBILE_COLOR_ORDER, MOBILE_COLOR_LABELS, SEGMENT_LABELS, bucket, normColor, stepIndex, snapshotColors, colorsSignature, restoreSnapshot,
} from '../../core/mobile-tasks.js';
import { fullColorLabel } from './task-row.js?v=2026-10-mobile-1';
import { shieldTaps } from './task-gestures.js?v=2026-10-mobile-1';

// [row][col]: important on top, urgent on the left
const GRID = [['red', 'yellow'], ['orange', 'blue']];
const STEPS = [
  { step: 'top', label: 'Top', icon: '<polyline points="6 11 12 5 18 11"></polyline><line x1="5" y1="19" x2="19" y2="19"></line>' },
  { step: 'up', label: 'Up', icon: '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="6 11 12 5 18 11"></polyline>' },
  { step: 'down', label: 'Down', icon: '<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="6 13 12 19 18 13"></polyline>' },
  { step: 'bottom', label: 'Bottom', icon: '<polyline points="6 13 12 19 18 13"></polyline><line x1="5" y1="5" x2="19" y2="5"></line>' },
];
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

// actions: the taskActions service; view: { flash(id) }
export function openMoveSheet(api, actions, view, taskId) {
  const start = getTaskById(taskId);
  if (!start) return null;
  const snap = snapshotColors(getAllTasks(), MOBILE_COLOR_ORDER);
  const startSig = colorsSignature(getAllTasks(), MOBILE_COLOR_ORDER);
  const original = { color: normColor(start.color), pinned: !!start.pinned };
  const title = start.title || 'Untitled Task';
  shieldTaps();

  const apply = (target) => {
    if (!getTaskById(taskId)) return;
    actions.placeTaskWithUndo(taskId, target, { quiet: true });
    handle.update();
  };

  const handle = api.openSheet({
    id: 'task-move',
    size: 'auto',
    title: `Move “${title}”`,
    build(body) {
      const task = getTaskById(taskId);
      body.classList.add('mx-move');
      if (!task) {
        body.append(el('p', 'mx-sheet-text', 'That task is no longer here.'));
        return;
      }
      const color = normColor(task.color);
      const pinned = !!task.pinned;
      const all = getAllTasks();

      // GROUP
      const groupRow = el('div', 'mx-move-row');
      groupRow.append(el('span', 'mx-sec-label', 'Group'));
      const seg = api.ui.segmented({
        label: 'Group',
        options: [{ value: 'primary', label: SEGMENT_LABELS.primary }, { value: 'secondary', label: SEGMENT_LABELS.secondary }],
        value: pinned ? 'primary' : 'secondary',
        onChange: (v) => apply({ pinned: v === 'primary' }),
      });
      seg.classList.add('mx-move-seg');
      groupRow.append(seg);
      body.append(groupRow);

      // The 2×2 matrix
      const matrix = el('div', 'mx-move-matrix');
      matrix.setAttribute('role', 'group');
      matrix.setAttribute('aria-label', 'Priority');
      matrix.append(el('span', 'mx-axis mx-axis-corner'), el('span', 'mx-axis mx-axis-col', 'Urgent'), el('span', 'mx-axis mx-axis-col', 'Not urgent'));
      GRID.forEach((row, r) => {
        matrix.append(el('span', 'mx-axis mx-axis-row', r === 0 ? 'Important' : 'Not important'));
        row.forEach(c => {
          const tile = el('button', `mx-move-tile mx-tone-${c}`);
          tile.type = 'button';
          tile.dataset.color = c;
          const n = bucket(all, c, pinned).filter(t => t.id !== taskId).length + (c === color ? 1 : 0);
          const current = c === color;
          tile.setAttribute('aria-pressed', current ? 'true' : 'false');
          tile.setAttribute('aria-label', `${fullColorLabel(c)} · ${n} task${n === 1 ? '' : 's'}${current ? ' (current)' : ''}`);
          const dot = el('span', 'mx-tile-dot');
          dot.setAttribute('aria-hidden', 'true');
          tile.append(dot, el('span', 'mx-tile-label', MOBILE_COLOR_LABELS[c]), el('span', 'mx-tile-count', String(n)));
          tile.addEventListener('click', () => { if (c !== normColor(getTaskById(taskId)?.color)) apply({ color: c }); });
          matrix.append(tile);
        });
      });
      body.append(matrix);

      // POSITION
      const b = bucket(all, color, pinned);
      const index = b.findIndex(t => t.id === taskId);
      const posRow = el('div', 'mx-move-row mx-move-pos');
      const posLabel = el('span', 'mx-sec-label', `Position ${index + 1} of ${b.length}`);
      posRow.append(posLabel);
      const steps = el('div', 'mx-move-steps');
      STEPS.forEach(({ step, label, icon }) => {
        const btn = el('button', 'mx-btn mx-step-btn');
        btn.type = 'button';
        btn.innerHTML = svg(icon);
        btn.append(el('span', '', label));
        const to = stepIndex(all, taskId, step);
        btn.disabled = to === index;
        btn.addEventListener('click', () => apply({ index: stepIndex(getAllTasks(), taskId, step) }));
        steps.append(btn);
      });
      posRow.append(steps);
      body.append(posRow);

      const foot = el('div', 'mx-move-foot');
      const done = el('button', 'mx-btn mx-btn-primary mx-move-done', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => handle.close());
      foot.append(done);
      body.append(foot);
    },
    onClose() {
      const task = getTaskById(taskId);
      const nowSig = colorsSignature(getAllTasks(), MOBILE_COLOR_ORDER);
      if (!task || nowSig === startSig) return;
      const color = normColor(task.color);
      const pinned = !!task.pinned;
      const index = bucket(getAllTasks(), color, pinned).findIndex(t => t.id === taskId);
      const after = nowSig;
      api.toast(`Moved to ${MOBILE_COLOR_LABELS[color]} · ${pinned ? 'Primary' : 'Secondary'}, position ${index + 1}`, [{
        label: 'Undo',
        run: () => {
          if (colorsSignature(getAllTasks(), MOBILE_COLOR_ORDER) !== after) { api.toast('Can’t undo: the list changed since'); return; }
          const cur = getTaskById(taskId);
          if (cur && normColor(cur.color) !== original.color) updateTask(taskId, { color: original.color });
          restoreSnapshot(getAllTasks(), snap);
          saveModel();
          if (view && view.flash) view.flash(taskId);
        },
      }]);
    },
  });
  return handle;
}
