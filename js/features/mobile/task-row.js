// Personal Dashboard - Mobile shell: one task row (unit F1)
// A row keeps the matrix pill's look (the same .eisenhower-task glass, the
// pinned light body and its breathing, the stopwatch crystal) but is built for
// a thumb: a 44px complete ring on the left, a 2-line title, a quiet meta line
// (due, subtasks, description, links, category) and the real stopwatch from
// time-tracking.js on the right, so refreshTimeTrackingUI() and the 1s tick
// keep it live with no code here.
//
// DOM (keyed by task id, no element ids):
//   div.mx-task-slot[data-task-id][role=listitem]      static; holds the swipe underlay
//     div.mx-swipe-under                                emerald "Done" (→) / two azure buttons (←)
//     div.mx-task.eisenhower-task.task-bubble-<c>[.eisenhower-task-pinned][role=group]
//       button.mx-check > span.mx-ring                  complete (instant, batched Undo)
//       div.mx-task-main > .mx-task-title + .mx-task-meta
//       button.mx-visually-hidden.mx-row-open           "Open …" (screen readers)
//       div.task-timer (createTaskTimerControl)         44px hit through its wrapper
//       button.mx-visually-hidden.mx-row-actions        "Actions for …" (screen readers, keyboard)
// The breathing phase is set inline once from the task id (each pill is the
// only child of its slot, so :nth-child phases would all match), so a move
// never rewrites style. Gestures live in task-gestures.js; this module only
// wires taps.
// Modes: 'list' (Tasks: every gesture), 'today' (swipes; a hold opens the
// actions sheet), 'search' (taps only: a colour dot instead of the ring, no
// stopwatch, no swipes).

import { createTaskTimerControl } from '../time-tracking.js';
import { getTaskCategory, categoryColor } from '../task-categories.js';
import { phaseFor } from '../../core/mobile-common.js';
import { rowMeta, normColor, MOBILE_COLOR_LABELS } from '../../core/mobile-tasks.js';
import { TASK_COLOR_LABELS } from '../../constants.js';
import { closeAnyReveal } from './task-gestures.js?v=2026-10-mobile-2';

// A double tap on a stopwatch would start and at once stop the timer (and
// stop the one that was running before it): the user's second tap on any row
// stopwatch within this window is dropped
const TIMER_REPEAT_MS = 400;
let lastTimerTap = -Infinity;

const svg = (body, size = 14) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
export const ICONS = {
  subs: svg('<polyline points="4 7 6 9 9.5 5.5"></polyline><line x1="13" y1="7" x2="20" y2="7"></line><polyline points="4 15.5 6 17.5 9.5 14"></polyline><line x1="13" y1="16" x2="20" y2="16"></line>'),
  desc: svg('<line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="14" y2="18"></line>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>'),
  date: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"></rect><line x1="16" y1="3" x2="16" y2="7"></line><line x1="8" y1="3" x2="8" y2="7"></line><line x1="3.5" y1="10" x2="20.5" y2="10"></line>'),
  check: svg('<polyline points="5 12.5 10 17 19 7.5"></polyline>', 22),
  down: svg('<line x1="12" y1="4" x2="12" y2="17"></line><polyline points="6 11.5 12 17.5 18 11.5"></polyline><line x1="5" y1="21" x2="19" y2="21"></line>', 20),
  up: svg('<line x1="12" y1="20" x2="12" y2="7"></line><polyline points="6 12.5 12 6.5 18 12.5"></polyline><line x1="5" y1="3" x2="19" y2="3"></line>', 20),
  more: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>',
};

export function colorLabel(color) {
  return MOBILE_COLOR_LABELS[normColor(color)];
}

export function fullColorLabel(color) {
  return TASK_COLOR_LABELS[normColor(color)] || '';
}

function metaItem(cls, html, text, title) {
  const el = document.createElement('span');
  el.className = 'mx-meta-item' + (cls ? ' ' + cls : '');
  if (html) el.innerHTML = html;
  if (text) el.appendChild(document.createTextNode(text));
  if (title) el.title = title;
  return el;
}

// The meta line's children (also used by the actions sheet header)
export function buildMeta(task, todayKey, { chip = null } = {}) {
  const m = rowMeta(task, todayKey);
  const out = [];
  if (chip) {
    out.push(typeof chip === 'string' ? Object.assign(document.createElement('span'), { className: 'today-chip is-context', textContent: chip }) : chip);
  } else if (m.due) {
    if (m.due.kind === 'today' || m.due.kind === 'overdue') {
      const c = document.createElement('span');
      c.className = `today-chip ${m.due.kind === 'today' ? 'is-today' : 'is-overdue'}`;
      c.textContent = m.due.text;
      out.push(c);
    } else {
      out.push(metaItem('mx-meta-date', ICONS.date, m.due.text, `Due ${m.due.text}`));
    }
  }
  if (m.subs) out.push(metaItem('mx-meta-subs', ICONS.subs, `${m.subs.done}/${m.subs.total}`, `${m.subs.done} of ${m.subs.total} subtasks done`));
  if (m.desc) out.push(metaItem('mx-meta-desc', ICONS.desc, '', 'Has a description'));
  if (m.links) out.push(metaItem('mx-meta-links', ICONS.link, String(m.links), `${m.links} link${m.links === 1 ? '' : 's'}`));
  const cat = m.categoryId ? getTaskCategory(m.categoryId) : null;
  if (cat) {
    const el = metaItem('mx-meta-cat', '', '', `Category: ${cat.name}`);
    const dot = document.createElement('span');
    dot.className = 'mx-cat-dot';
    dot.style.background = categoryColor(cat);
    el.append(dot, document.createTextNode(cat.name));
    out.push(el);
  }
  return out;
}

// A short spoken summary of the meta line
export function metaSummary(task, todayKey) {
  const m = rowMeta(task, todayKey);
  const parts = [];
  if (m.due) parts.push(m.due.kind === 'overdue' ? `overdue ${m.due.days} days` : `due ${m.due.text}`);
  if (m.subs) parts.push(`${m.subs.done} of ${m.subs.total} subtasks done`);
  return parts.join(', ');
}

// task: the live task. opts: { mode, chip?, contextOnly?, todayKey, handlers: { open, complete, actions, toggleGroup } }
export function createTaskRow(task, opts = {}) {
  const mode = opts.mode || 'list';
  const h = opts.handlers || {};
  const color = normColor(task.color);
  const title = task.title || 'Untitled Task';
  const pinned = !!task.pinned;

  const slot = document.createElement('div');
  slot.className = `mx-task-slot mx-tone-${color} mx-mode-${mode}`;
  slot.dataset.taskId = task.id;
  slot.setAttribute('role', 'listitem');

  if (mode !== 'search') {
    const under = document.createElement('div');
    under.className = 'mx-swipe-under';
    under.setAttribute('aria-hidden', 'true');
    const done = document.createElement('div');
    done.className = 'mx-under-done';
    done.innerHTML = `${ICONS.check}<span>Done</span>`;
    const acts = document.createElement('div');
    acts.className = 'mx-under-actions';
    const group = document.createElement('button');
    group.type = 'button';
    group.className = 'mx-under-btn mx-under-group';
    group.tabIndex = -1;
    group.innerHTML = `${pinned ? ICONS.down : ICONS.up}<span>${pinned ? 'Secondary' : 'Primary'}</span>`;
    group.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAnyReveal({ immediate: true });
      if (h.toggleGroup) h.toggleGroup(task.id);
    });
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'mx-under-btn mx-under-more';
    more.tabIndex = -1;
    more.innerHTML = `${ICONS.more}<span>More</span>`;
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAnyReveal({ immediate: true });
      if (h.actions) h.actions(task.id);
    });
    acts.append(group, more);
    under.append(done, acts);
    slot.appendChild(under);
  }

  const pill = document.createElement('div');
  pill.className = `mx-task eisenhower-task task-bubble-${color}${pinned ? ' eisenhower-task-pinned' : ''}` +
    (opts.contextOnly ? ' is-context' : '');
  const phase = phaseFor(task.id);
  pill.style.setProperty('--fx-t-dur', phase.dur);
  pill.style.setProperty('--fx-t-delay', phase.delay);
  pill.tabIndex = 0;

  if (mode === 'search') {
    const dot = document.createElement('span');
    dot.className = 'mx-task-dot';
    dot.setAttribute('aria-hidden', 'true');
    pill.appendChild(dot);
  } else {
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'mx-check';
    check.setAttribute('aria-label', `Complete “${title}”`);
    check.innerHTML = `<span class="mx-ring" aria-hidden="true">${ICONS.check}</span>`;
    check.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (h.complete) h.complete(task.id, slot);
    });
    pill.appendChild(check);
  }

  const main = document.createElement('div');
  main.className = 'mx-task-main';
  const t = document.createElement('span');
  t.className = 'mx-task-title';
  t.textContent = title;
  main.appendChild(t);
  const metaNodes = buildMeta(task, opts.todayKey, { chip: opts.chip || null });
  if (metaNodes.length) {
    const meta = document.createElement('span');
    meta.className = 'mx-task-meta';
    meta.append(...metaNodes);
    main.appendChild(meta);
  }
  pill.appendChild(main);
  // The row is a named group, so its Complete, stopwatch and Actions buttons
  // stay reachable (role=button on the row would hide them: presentational
  // children). Opening it gets its own button for assistive tech, like Actions
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'mx-visually-hidden mx-row-open';
  openBtn.textContent = `Open ${title}`;
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (h.open) h.open(task.id);
  });
  pill.appendChild(openBtn);

  if (mode !== 'search') {
    const timer = createTaskTimerControl(task);
    timer.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const now = e.timeStamp;          // when the tap happened, even if a busy page handles it late
      if (now - lastTimerTap < TIMER_REPEAT_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastTimerTap = now;
    }, true);
    // The wrapper is the 44px hit area around the (smaller) stopwatch lens
    timer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === timer || e.target.classList.contains('task-timer-time')) {
        const btn = timer.querySelector('.task-timer-btn');
        if (btn) btn.click();
      }
    });
    pill.appendChild(timer);

    const actions = document.createElement('button');
    actions.type = 'button';
    actions.className = 'mx-visually-hidden mx-row-actions';
    actions.textContent = `Actions for ${title}`;
    actions.addEventListener('click', (e) => {
      e.stopPropagation();
      if (h.actions) h.actions(task.id);
    });
    pill.appendChild(actions);
  }

  const summary = metaSummary(task, opts.todayKey);
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', `${title}. ${pinned ? 'Primary' : 'Secondary'}, ${fullColorLabel(color)}${summary ? '. ' + summary : ''}`);

  pill.addEventListener('click', (e) => {
    if (e.target.closest('button, .task-timer')) return;
    e.stopPropagation();
    if (h.open) h.open(task.id);
  });
  pill.addEventListener('keydown', (e) => {
    if (e.target !== pill) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (h.open) h.open(task.id);
    }
  });
  // The OS long-press menu never opens on a row (the hold lifts it instead)
  slot.addEventListener('contextmenu', (e) => e.preventDefault());

  slot.appendChild(pill);
  return slot;
}
