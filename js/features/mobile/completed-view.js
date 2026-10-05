// Personal Dashboard - Mobile shell: the Completed screen (unit F1, W20)
// A pushed screen over the Tasks tab (the desktop #completed-tasks-modal is
// never opened on mobile). Completed tasks grouped by local day (Today,
// Yesterday, then "Tue, Sep 22"), 30 at a time. The emerald disc restores a
// task (to the end of its colour × group, with Undo); tapping the row opens a
// read sheet (description as plain text, Restore, Delete). "Clear all
// completed…" asks first. The list follows every save while it is open.

import { getCompletedTasks, deleteCompletedTask, clearCompletedTasks } from '../tasks.js';
import { htmlToPlainText } from '../../core/markdown.js';
import { toDateKey } from '../../core/quick-capture-parse.js';
import { addDays } from '../../core/agenda.js';
import { shortDay } from '../../core/mobile-common.js';
import { normColor, MOBILE_COLOR_LABELS } from '../../core/mobile-tasks.js';
import { ICONS } from './task-row.js?v=2026-10-mobile-1';
import { shieldTaps } from './task-gestures.js?v=2026-10-mobile-1';

const PAGE = 30;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function timeLabel(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

function dayLabel(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, -1)) return 'Yesterday';
  return shortDay(key) || 'Earlier';
}

// actions: the taskActions service
export function openCompleted(api, actions, { focusId = null } = {}) {
  let limit = PAGE;
  let screen = null;

  const titleText = () => `Completed · ${getCompletedTasks().length}`;

  function render() {
    if (!screen) return;
    const body = screen.body;
    const titleEl = screen.el.querySelector('.mx-pushed-title');
    if (titleEl && titleEl.textContent !== titleText()) titleEl.textContent = titleText();
    const keepScroll = body.scrollTop;
    body.replaceChildren();
    body.classList.add('mx-completed');
    const all = getCompletedTasks();
    if (!all.length) {
      const empty = el('div', 'mx-completed-empty');
      empty.append(el('p', 'mx-sheet-text', 'No completed tasks.'), el('p', 'mx-sheet-note', 'Tasks you complete show up here, newest first.'));
      body.append(empty);
      return;
    }
    const today = toDateKey(new Date());
    const shown = all.slice(0, limit);
    let lastKey = null;
    let group = null;
    shown.forEach(task => {
      const at = task.completedAt || 0;
      const key = at ? toDateKey(new Date(at)) : '';
      if (key !== lastKey) {
        lastKey = key;
        body.append(el('h3', 'mx-sec-label mx-day-label', key ? dayLabel(key, today) : 'Earlier'));
        group = el('div', 'mx-completed-group');
        group.setAttribute('role', 'list');
        body.append(group);
      }
      group.append(makeRow(task));
    });
    if (all.length > shown.length) {
      const more = el('div', 'mx-completed-more');
      more.append(el('span', 'mx-sheet-note', `${shown.length} shown`));
      const btn = el('button', 'mx-btn mx-show-more', `Show ${Math.min(PAGE, all.length - shown.length)} more`);
      btn.type = 'button';
      btn.addEventListener('click', () => { limit += PAGE; render(); });
      more.append(btn);
      body.append(more);
    }
    const clear = el('button', 'mx-btn mx-btn-quiet mx-btn-danger mx-clear-completed', 'Clear all completed…');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      const n = getCompletedTasks().length;
      if (!window.confirm(`Delete all ${n} completed task${n === 1 ? '' : 's'} for good? This can’t be undone.`)) return;
      clearCompletedTasks();
      api.toast('Completed tasks cleared');
    });
    body.append(clear);
    body.scrollTop = keepScroll;
  }

  function makeRow(task) {
    const color = normColor(task.color);
    const row = el('div', `mx-done-row mx-tone-${color}`);
    row.setAttribute('role', 'listitem');
    row.dataset.taskId = task.id;
    const disc = el('button', 'mx-done-disc');
    disc.type = 'button';
    disc.setAttribute('aria-label', `Restore “${task.title || 'Untitled Task'}”`);
    disc.innerHTML = `<span class="mx-done-lens" aria-hidden="true">${ICONS.check}</span>`;
    disc.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.restoreWithUndo(task.id);
    });
    const main = el('button', 'mx-done-main');
    main.type = 'button';
    main.append(el('span', 'mx-done-title', task.title || 'Untitled Task'));
    const meta = el('span', 'mx-done-meta');
    const dot = el('span', 'mx-done-dot');
    dot.setAttribute('aria-hidden', 'true');
    meta.append(dot, el('span', '', task.completedAt ? timeLabel(task.completedAt) : ''));
    main.append(meta);
    main.setAttribute('aria-label', `${task.title || 'Untitled Task'}, ${MOBILE_COLOR_LABELS[color]}, ${task.pinned ? 'Primary' : 'Secondary'}. Details`);
    main.addEventListener('click', () => openReadSheet(task.id));
    row.append(disc, main);
    return row;
  }

  function openReadSheet(taskId) {
    const task = getCompletedTasks().find(t => t.id === taskId);
    if (!task) return;
    shieldTaps();
    const sheet = api.openSheet({
      id: 'completed-read',
      size: 'auto',
      build(body) {
        body.classList.add('mx-read');
        const color = normColor(task.color);
        const head = el('div', `mx-actions-head mx-tone-${color}`);
        const dot = el('span', 'mx-actions-dot');
        dot.setAttribute('aria-hidden', 'true');
        head.append(dot, el('h2', 'mx-actions-title', task.title || 'Untitled Task'));
        body.append(head);
        const when = task.completedAt ? new Date(task.completedAt) : null;
        body.append(el('p', 'mx-actions-meta',
          `${task.pinned ? 'Primary' : 'Secondary'} · ${MOBILE_COLOR_LABELS[color]}${when ? ` · Completed ${shortDay(toDateKey(when))}, ${timeLabel(task.completedAt)}` : ''}`));
        const text = htmlToPlainText(task.description || '').trim();
        if (text) body.append(el('p', 'mx-read-text', text));
        const btns = el('div', 'mx-read-actions');
        const restore = el('button', 'mx-btn mx-btn-primary', 'Restore');
        restore.type = 'button';
        restore.addEventListener('click', () => { sheet.close(); actions.restoreWithUndo(taskId); });
        const del = el('button', 'mx-btn mx-btn-danger', 'Delete…');
        del.type = 'button';
        del.addEventListener('click', () => {
          if (!window.confirm(`Delete “${task.title || 'Untitled Task'}” for good? This can’t be undone.`)) return;
          sheet.close();
          deleteCompletedTask(taskId);
          api.toast('Completed task deleted');
        });
        btns.append(restore, del);
        body.append(btns);
      },
    });
  }

  const onSaved = () => render();
  shieldTaps();       // the second tap of a double tap on the link never hits a disc
  screen = api.pushScreen({
    id: 'completed',
    title: titleText(),
    build() { /* rendered right below */ },
    onClose() {
      window.removeEventListener('model:saved', onSaved);
      screen = null;
    },
  });
  window.addEventListener('model:saved', onSaved);
  render();
  if (focusId) {
    const idx = getCompletedTasks().findIndex(t => t.id === focusId);
    if (idx >= limit) { limit = Math.ceil((idx + 1) / PAGE) * PAGE; render(); }
    const row = screen.body.querySelector(`.mx-done-row[data-task-id="${CSS.escape(focusId)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('mx-just');
      setTimeout(() => row.classList.remove('mx-just'), 2700);
    }
  }
  return screen;
}
