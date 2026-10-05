// Personal Dashboard - Mobile shell: the Time sheet (unit F4, service `time`)
// Opened from the now-playing lane (and More › Time tracking). On top: the
// running timer (title, a big live clock, Stop / Complete / Open). Below it:
// the desktop Time Tracking panel itself, RE-HOSTED: #time-tracking-card is
// moved into the sheet on open and put back exactly where it was on close
// (or unmount). toggleTimeTracking() is never called, so the synced
// model.timeTrackingExpanded is never written. The sheet sits at z 950, under
// the period popover (.tt-range-pop, 9000), so the funnel filter works.
// The clock carries data-live-timer: the existing 1 s tick writes its text
// (Text.data only); this module only writes it once when the block appears.

import { model } from '../../state.js';
import { getTaskById } from '../tasks.js';
import { getTaskTotalMs } from '../../core/time-log.js';
import { formatClock, renderTimeTrackingPanel, stopTaskTimer } from '../time-tracking.js';

const svg = (body, size = 18, width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const STOP_SVG = '<span class="mx-time-stop-glyph" aria-hidden="true"></span>';
const CHECK_SVG = svg('<circle cx="12" cy="12" r="9"></circle><polyline points="8 12.5 11 15.5 16.5 9.5"></polyline>', 18, 2.2);
const OPEN_SVG = svg('<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>', 17, 2.2);

export function createTimeSheet(api, { complete, openTask }) {
  let handle = null;
  let hosted = null;         // { card, parent, next, hidden, hadActive }
  let live = null;           // the running block's nodes
  let liveKey = null;
  let onSaved = null;

  function hostCard(container) {
    const card = document.getElementById('time-tracking-card');
    if (!card || hosted) return;
    hosted = {
      card,
      parent: card.parentNode,
      next: card.nextSibling,
      hidden: card.hidden,
      hadActive: card.classList.contains('active'),
    };
    container.appendChild(card);
    card.hidden = false;
    card.classList.add('active', 'mx-hosted');
    try { renderTimeTrackingPanel(); } catch (err) { console.error('[mobile] time panel render failed', err); }
  }

  // Put the card back exactly (same parent, same next sibling), with its
  // hidden state and .active as they were
  function returnCard() {
    if (!hosted) return;
    const { card, parent, next, hidden, hadActive } = hosted;
    hosted = null;
    // A period popover left open belongs to the hosted panel: close it
    if (document.querySelector('.tt-range-pop')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    }
    card.classList.remove('mx-hosted');
    if (!hadActive) card.classList.remove('active');
    if (parent) parent.insertBefore(card, next && next.parentNode === parent ? next : null);
    card.hidden = hidden;
  }

  function buildLive(body) {
    const box = document.createElement('section');
    box.className = 'mx-time-live';
    box.setAttribute('aria-label', 'Running timer');
    const head = document.createElement('div');
    head.className = 'mx-time-live-head';
    const orb = document.createElement('span');
    orb.className = 'mx-time-orb';
    orb.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'mx-time-title';
    head.append(orb, title);
    const clock = document.createElement('div');
    clock.className = 'mx-time-clock';
    clock.setAttribute('aria-hidden', 'true');
    const actions = document.createElement('div');
    actions.className = 'mx-time-actions';
    const btn = (cls, html, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mx-btn mx-time-btn ${cls}`;
      b.innerHTML = `${html}<span>${label}</span>`;
      b.addEventListener('click', fn);
      actions.appendChild(b);
      return b;
    };
    const activeId = () => (model.timeTracking && model.timeTracking.active ? model.timeTracking.active.taskId : null);
    btn('mx-time-stop', STOP_SVG, 'Stop', () => { stopTaskTimer(); paintLive(); });
    const done = btn('mx-time-complete', CHECK_SVG, 'Complete', () => { const id = activeId(); if (id) complete(id); paintLive(); });
    const open = btn('mx-time-open', OPEN_SVG, 'Open', () => { const id = activeId(); if (id) openTask(id); });
    box.append(head, clock, actions);
    body.appendChild(box);
    live = { box, title, clock, done, open };
    liveKey = null;
  }

  // Show / hide / retitle the running block. Called on open and after every
  // save while the sheet is open (cheap: compares the running id + title)
  function paintLive() {
    if (!live) return;
    const log = model.timeTracking;
    const active = log && log.active ? log.active : null;
    const task = active ? getTaskById(active.taskId) : null;
    const title = active
      ? ((task && task.title) || (log.tasks && log.tasks[active.taskId] && log.tasks[active.taskId].title) || 'Task')
      : '';
    const key = active ? `${active.taskId}|${title}|${!!task}` : '';
    if (key === liveKey) return;
    liveKey = key;
    live.box.hidden = !active;
    if (!active) {
      delete live.clock.dataset.liveTimer;
      return;
    }
    live.title.textContent = title;
    // The 1 s tick (time-tracking.js) writes every [data-live-timer]
    live.clock.dataset.liveTimer = active.taskId;
    live.clock.textContent = formatClock(getTaskTotalMs(log, active.taskId, Date.now()));
    live.box.setAttribute('aria-label', `Timer running on ${title}`);
    // A deleted task can't be completed or opened
    live.done.hidden = !task;
    live.open.hidden = !task;
  }

  function openSheet() {
    if (handle) return handle;
    handle = api.openSheet({
      id: 'time',
      title: 'Time tracking',
      size: 'tall',
      build(body) {
        body.classList.add('mx-time-body');
        buildLive(body);
        const host = document.createElement('div');
        host.className = 'mx-time-host';
        body.appendChild(host);
        hostCard(host);
        paintLive();
      },
      onClose() {
        if (onSaved) window.removeEventListener('model:saved', onSaved);
        onSaved = null;
        returnCard();
        live = null;
        handle = null;
      },
    });
    handle.el.classList.add('mx-time-sheet');
    onSaved = () => paintLive();
    window.addEventListener('model:saved', onSaved);
    return handle;
  }

  // The preview switching to Tablet / Desktop: the card goes home first
  api.on('unmount', () => {
    if (handle) handle.close({ immediate: true });
    returnCard();
  });

  return {
    openSheet,
    isOpen: () => !!handle,
  };
}
