// Personal Dashboard - Mobile shell: the Tasks tab (unit F1, entry module)
// One bucket at a time: the Primary | Secondary segment in the top-bar slot
// times a sticky row of colour chips (All · red · orange · yellow · blue, with
// counts and an overdue hot dot). Primary opens on its first busy colour (red,
// 12 rows), Secondary on All. A single-colour lens is one tinted pane (the
// matrix's own .eisenhower-priority-card-<c>); the All lens is one pane per
// colour, empty ones as a dimmed header that still takes a drop.
//
// Rows (task-row.js) keep the pill look and the live stopwatch; gestures
// (task-gestures.js): tap = open (read-first), ◯ = complete (batched Undo),
// swipe → = complete, swipe ← = reveal ⇣/⇡ and ⋯, hold = lift → drag to a
// gap / chip / the other segment, or release still = Lift & place (carry
// mode: glowing gaps, tap where it goes; Back / Esc / Cancel leave it).
// Lists are keyed patches (ui.patchList), the screen signature skips renders
// that would change nothing, and renders never happen under a finger.
//
// Provides: screen 'tasks' (+ topbar segment), services taskRow / taskActions /
// completed, layer 'carry', context { lens }.
// State per browser: localStorage dashboard_mobile_tasks = { segment, color: { primary, secondary }, hintDone }.

import { getAllTasks, getTaskById, getCompletedTasks } from '../tasks.js';
import { getTaskCategories } from '../task-categories.js';
import { dueState } from '../../core/agenda.js';
import {
  MOBILE_COLOR_ORDER, MOBILE_COLOR_LABELS, SEGMENT_LABELS, lensCounts, defaultLens, lensTasks, rowSignature, normColor,
} from '../../core/mobile-tasks.js';
import { createTaskRow, fullColorLabel } from './task-row.js?v=2026-10-mobile-1';
import { attachGestures, closeAnyReveal } from './task-gestures.js?v=2026-10-mobile-1';
import { createTaskActions } from './task-actions.js?v=2026-10-mobile-1';
import { openMoveSheet } from './move-sheet.js?v=2026-10-mobile-1';
import { openCompleted } from './completed-view.js?v=2026-10-mobile-1';

const PRIORITY_RGB = { red: '249 76 100', orange: '255 133 35', yellow: '242 189 24', blue: '61 151 248' };
const CHECK_DONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="5 12.5 10 17 19 7.5"></polyline></svg>';
const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 6 15 12 9 18"></polyline></svg>';
const GRIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="5" y1="8" x2="19" y2="8"></line><line x1="5" y1="12" x2="19" y2="12"></line><line x1="5" y1="16" x2="19" y2="16"></line></svg>';
const CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== text) t.data = text; } else node.textContent = text;
}

function setAttr(node, name, value) {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function toggleClass(node, cls, on) {
  if (node && node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

export default {
  init(api) {
    const store = api.store('tasks');
    const lens = { segment: 'primary', color: 'red' };
    let lensReady = false;
    let carry = null;                 // { taskId, title }
    const els = {};
    let gestures = null;
    let dragHint = { dragging: false, kind: null, color: null };

    // --- Lens -----------------------------------------------------------------------

    function counts() {
      return lensCounts(getAllTasks(), dayKey());
    }

    function remembered(seg) {
      const c = store.get('color', {}) || {};
      return c[seg];
    }

    function resolveLens() {
      if (lensReady) return;
      lensReady = true;
      const seg = store.get('segment', 'primary') === 'secondary' ? 'secondary' : 'primary';
      lens.segment = seg;
      lens.color = defaultLens(counts()[seg], remembered(seg));
      publish();
    }

    function publish() {
      api.setContext({ lens: { segment: lens.segment, color: lens.color } });
    }

    function scrollTopIfNeeded() {
      if (window.scrollY > 0) window.scrollTo(0, 0);
    }

    function crossfade() {
      if (els.list) api.animate(els.list, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    }

    function setLens(color) {
      if (lens.color === color) return;
      closeAnyReveal({ immediate: true });
      lens.color = color;
      const c = { ...(store.get('color', {}) || {}) };
      c[lens.segment] = color;
      store.set('color', c);
      publish();
      scrollTopIfNeeded();
      api.render('lens');
      crossfade();
    }

    function setSegment(seg) {
      if (lens.segment === seg) return;
      closeAnyReveal({ immediate: true });
      lens.segment = seg;
      lens.color = defaultLens(counts()[seg], remembered(seg));
      store.set('segment', seg);
      publish();
      scrollTopIfNeeded();
      api.render('lens');
      crossfade();
    }

    // --- Screen DOM ---------------------------------------------------------------------

    function mount(host) {
      host.classList.add('mx-tasks-screen');
      const sub = el('div', 'mx-tasks-sub');
      sub.setAttribute('role', 'toolbar');
      sub.setAttribute('aria-label', 'Colour');
      els.chips = new Map();
      ['all', ...MOBILE_COLOR_ORDER].forEach((c, i) => {
        const b = el('button', 'mx-chip mx-lens-chip');
        b.type = 'button';
        b.dataset.lens = c;
        b.setAttribute('aria-pressed', 'false');
        if (c === 'all') {
          b.append(el('span', 'mx-chip-label', 'All'), el('span', 'mx-chip-count', '0'));
        } else {
          b.style.setProperty('--priority-rgb', PRIORITY_RGB[c]);
          const dot = el('span', 'mx-chip-dot');
          dot.setAttribute('aria-hidden', 'true');
          const hot = el('span', 'mx-chip-hot');
          hot.setAttribute('aria-hidden', 'true');
          hot.style.animationDelay = `${(i * -0.7).toFixed(1)}s`;
          hot.hidden = true;
          b.append(dot, el('span', 'mx-chip-count', '0'), hot);
        }
        b.addEventListener('click', () => setLens(c));
        els.chips.set(c, b);
        sub.append(b);
      });
      const list = el('div', 'mx-task-list');
      const footer = el('div', 'mx-tasks-foot');
      const done = el('button', 'mx-completed-link');
      done.type = 'button';
      done.innerHTML = `<span class="mx-completed-icon">${CHECK_DONE}</span><span class="mx-completed-text">0 completed</span><span class="mx-completed-chev">${CHEVRON}</span>`;
      done.addEventListener('click', () => openCompletedScreen());
      const hint = el('p', 'mx-tasks-hint');
      hint.hidden = true;
      hint.append(el('span', 'mx-hint-text', 'Swipe right to complete · hold a task to move it'));
      const hintClose = el('button', 'mx-hint-close');
      hintClose.type = 'button';
      hintClose.setAttribute('aria-label', 'Dismiss the tip');
      hintClose.innerHTML = CLOSE;
      hintClose.addEventListener('click', () => hintDone());
      hint.append(hintClose);
      footer.append(done, hint);
      // An empty All lens says it once, under the four dimmed headers
      const lensEmpty = el('p', 'mx-pane-empty mx-lens-empty');
      lensEmpty.hidden = true;
      host.append(sub, list, lensEmpty, footer);
      Object.assign(els, { host, sub, list, lensEmpty, footer, done, hint });
      gestures = attachGestures(list, { api, mode: 'list', actions, view: dragView, onUse: () => hintDone({ keepSpace: true }) });
    }

    // keepSpace (a lift or swipe has just started): the tip goes invisible but
    // keeps its height until the next render. Collapsing it under the finger
    // shortens the page; at the bottom of the list the browser then scrolls
    // up, every row jumps down under the gesture and the drop lands a row off.
    function hintDone({ keepSpace = false } = {}) {
      if (store.get('hintDone', false)) return;
      store.set('hintDone', true);
      if (!els.hint) return;
      if (keepSpace) els.hint.classList.add('is-leaving');
      else els.hint.hidden = true;
    }

    // --- Render ----------------------------------------------------------------------------

    function categoriesSig() {
      try { return getTaskCategories().map(c => `${c.id}:${c.name}:${c.slot}`).join(','); } catch { return ''; }
    }

    function signature(ctx) {
      const tasks = getAllTasks();
      const t = ctx.todayKey;
      let s = `${lens.segment}|${lens.color}|${carry ? carry.taskId : ''}|${t}|${getCompletedTasks().length}|${categoriesSig()}|${store.get('hintDone', false) ? 1 : 0}|${lens.color === 'all' ? composerColor() : ''}`;
      for (const task of tasks) s += `\n${task.id}:${task.order ?? ''}:${rowSignature(task, t)}`;
      return s;
    }

    function render(ctx) {
      resolveLens();
      const tasks = getAllTasks();
      if (carry && !getTaskById(carry.taskId)) {
        endCarry();
        api.toast('That task is no longer here');
      }
      const c = lensCounts(tasks, ctx.todayKey);
      paintChips(c);
      paintPanes(tasks, ctx.todayKey);
      paintFooter();
      paintSegmentTargets();
    }

    function paintChips(c) {
      const seg = c[lens.segment];
      els.chips.forEach((b, key) => {
        const n = key === 'all' ? seg.total : seg[key];
        setText(b.querySelector('.mx-chip-count'), String(n));
        setAttr(b, 'aria-pressed', lens.color === key ? 'true' : 'false');
        toggleClass(b, 'is-empty', key !== 'all' && n === 0);
        const label = key === 'all' ? `All · ${n} task${n === 1 ? '' : 's'}` : `${fullColorLabel(key)} · ${n} task${n === 1 ? '' : 's'}${seg.hot[key] ? ', some due or overdue' : ''}`;
        setAttr(b, 'aria-label', label);
        setAttr(b, 'title', key === 'all' ? 'All colours' : fullColorLabel(key));
        if (key !== 'all') {
          const hot = b.querySelector('.mx-chip-hot');
          if (hot && hot.hidden === !!seg.hot[key]) hot.hidden = !seg.hot[key];
        }
      });
    }

    function paneItems(tasks) {
      return lensTasks(tasks, lens.segment, lens.color);
    }

    // The colour + gives a new task from this lens (the empty state names it).
    // The composer's own answer when F2 offers one; else its rule read the same
    // way: the lens colour, on All the last commit, else the first colour with
    // tasks in the segment, else blue
    function composerColor() {
      if (lens.color !== 'all') return lens.color;
      const comp = api.service && api.service('composer');
      if (comp && typeof comp.defaults === 'function') {
        try {
          const d = comp.defaults({ from: 'tasks', lens: { ...lens } });
          if (d && MOBILE_COLOR_ORDER.includes(d.color)) return d.color;
        } catch { /* fall through to the same rule */ }
      }
      try {
        const last = api.store('compose', { perAccount: true }).get('last', null);
        if (last && MOBILE_COLOR_ORDER.includes(last.color)) return last.color;
      } catch { /* no composer state */ }
      const wantPinned = lens.segment === 'primary';
      const live = getAllTasks().filter(t => !!t.pinned === wantPinned);
      return MOBILE_COLOR_ORDER.find(c => live.some(t => normColor(t.color) === c)) || 'blue';
    }

    let lensRows = 0;
    function paintPanes(tasks, today) {
      const items = paneItems(tasks);
      const single = lens.color !== 'all';
      lensRows = items.reduce((n, p) => n + p.tasks.length, 0);
      const allEmpty = !single && lensRows === 0
        ? `Nothing here. Tap + to add a task to ${MOBILE_COLOR_LABELS[composerColor()]} · ${SEGMENT_LABELS[lens.segment]}`
        : '';
      if (els.lensEmpty.hidden === !!allEmpty) els.lensEmpty.hidden = !allEmpty;
      if (allEmpty) setText(els.lensEmpty, allEmpty);
      api.patchList(els.list, items, {
        key: (p) => p.color,
        sig: (p) => p.color,
        create: (p) => { const pane = createPane(p.color); paintPane(pane, p, today, single); return pane; },
        update: (pane, p) => paintPane(pane, p, today, single),
      });
    }

    function createPane(color) {
      const pane = el('section', `mx-pane eisenhower-priority-card eisenhower-priority-card-${color}`);
      pane.dataset.color = color;
      const head = el('header', 'mx-pane-head');
      const h = el('h2', 'mx-pane-title');
      const dot = el('span', 'mx-pane-dot');
      dot.setAttribute('aria-hidden', 'true');
      h.append(dot, el('span', 'mx-pane-label', MOBILE_COLOR_LABELS[color]), el('span', 'mx-pane-count', '0'));
      const chips = el('span', 'mx-pane-chips');
      head.append(h, chips);
      const rows = el('div', 'mx-pane-rows');
      rows.setAttribute('role', 'list');
      rows.setAttribute('aria-label', fullColorLabel(color));
      const empty = el('p', 'mx-pane-empty');
      empty.hidden = true;
      pane.append(head, rows, empty);
      pane._mx = { head, h, chips, rows, empty, color, chipSig: '' };
      return pane;
    }

    function paintPane(pane, { color, tasks }, today, single) {
      const p = pane._mx;
      const n = tasks.length;
      setText(h3count(p), String(n));
      setAttr(p.h, 'aria-label', `${fullColorLabel(color)} · ${n} task${n === 1 ? '' : 's'}`);
      toggleClass(pane, 'is-empty', n === 0 && !single);
      // Quiet due chips
      let overdue = 0;
      let dueToday = 0;
      tasks.forEach(t => { const d = dueState(t.dueDate, today); if (d) { if (d.when === 'today') dueToday++; else overdue++; } });
      const chipSig = `${overdue}|${dueToday}`;
      if (p.chipSig !== chipSig) {
        p.chipSig = chipSig;
        const nodes = [];
        if (overdue) nodes.push(el('span', 'today-chip is-overdue', `${overdue} overdue`));
        if (dueToday) nodes.push(el('span', 'today-chip is-today', `${dueToday} today`));
        p.chips.replaceChildren(...nodes);
      }
      // Empty single lens: say where + would put a new task
      const emptyMsg = n === 0 && single
        ? `Nothing here. Tap + to add a task to ${MOBILE_COLOR_LABELS[color]} · ${SEGMENT_LABELS[lens.segment]}`
        : '';
      if (p.empty.hidden === !!emptyMsg) p.empty.hidden = !emptyMsg;
      if (emptyMsg) setText(p.empty, emptyMsg);
      paintRows(p.rows, color, tasks, today);
    }

    function h3count(p) {
      return p.h.querySelector('.mx-pane-count');
    }

    function rowSig(task, today) {
      const cat = task.categoryId ? categoriesSig() : '';
      return `${rowSignature(task, today)}|${cat}`;
    }

    function paintRows(container, color, tasks, today) {
      const items = [];
      const carried = carry ? tasks.find(t => t.id === carry.taskId) : null;
      if (!carry) {
        tasks.forEach(t => items.push({ kind: 'row', key: t.id, task: t }));
      } else {
        const ci = carried ? tasks.indexOf(carried) : -1;
        const others = tasks.filter(t => t !== carried);
        const emitted = new Set();
        let k = 0;
        let gi = 0;
        const gap = (index) => {
          if (index === ci || emitted.has(index)) return;
          emitted.add(index);
          const next = others[index];
          items.push({
            kind: 'gap', key: `gap:${index}`, index, i: gi++, color,
            label: next ? `Place before “${next.title || 'Untitled Task'}”` : `Place at the end of ${MOBILE_COLOR_LABELS[color]}`,
          });
        };
        tasks.forEach(t => {
          if (t !== carried) gap(k);
          items.push({ kind: 'row', key: t.id, task: t });
          if (t !== carried) k++;
        });
        gap(others.length);
      }
      api.patchList(container, items, {
        key: (it) => it.key,
        sig: (it) => (it.kind === 'gap' ? `${it.index}|${it.label}|${it.i}` : rowSig(it.task, today)),
        create: (it) => {
          if (it.kind === 'gap') return createGap(it);
          const row = createTaskRow(it.task, { mode: 'list', todayKey: today, handlers: rowHandlers });
          toggleClass(row, 'is-carried', !!carry && carry.taskId === it.task.id);
          return row;
        },
        update: (node, it) => {
          if (it.kind === 'row') {
            toggleClass(node, 'is-carried', !!carry && carry.taskId === it.task.id);
            if (node.hidden && !node.dataset.state) node.hidden = false;
          }
        },
      });
    }

    function createGap(it) {
      const b = el('button', 'mx-gap');
      b.type = 'button';
      b.setAttribute('aria-label', it.label);
      b.style.setProperty('--i', String(it.i));
      b.innerHTML = '<span class="mx-gap-beam" aria-hidden="true"></span>';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!carry) return;
        const id = carry.taskId;
        endCarry();
        actions.placeTaskWithUndo(id, { color: it.color, pinned: lens.segment === 'primary', index: it.index });
      });
      return b;
    }

    function paintFooter() {
      const n = getCompletedTasks().length;
      if (els.done.hidden === (n > 0)) els.done.hidden = n === 0;
      setText(els.done.querySelector('.mx-completed-text'), `${n} completed`);
      setAttr(els.done, 'aria-label', `${n} completed task${n === 1 ? '' : 's'}. Open the list`);
      // The gesture tip only shows over rows it can talk about
      const showHint = !store.get('hintDone', false) && lensRows > 0;
      if (els.hint.hidden === showHint) els.hint.hidden = !showHint;
      if (!showHint && els.hint.classList.contains('is-leaving')) els.hint.classList.remove('is-leaving');
    }

    // --- The segment in the top bar ---------------------------------------------------------

    let seg = null;
    function topbar(slot) {
      resolveLens();
      const c = counts();
      if (!seg || seg.parentNode !== slot) {
        seg = api.ui.segmented({
          label: 'Task group',
          options: [
            { value: 'primary', label: SEGMENT_LABELS.primary, count: c.primary.total },
            { value: 'secondary', label: SEGMENT_LABELS.secondary, count: c.secondary.total },
          ],
          value: lens.segment,
          onChange: (v) => setSegment(v),
        });
        seg.classList.add('mx-tasks-seg');
        slot.replaceChildren(seg);
      }
      if (seg.value !== lens.segment) seg.setValue(lens.segment);
      seg.setCounts({ primary: c.primary.total, secondary: c.secondary.total });
      paintSegmentTargets();
    }

    function segOption(value) {
      return seg && seg.isConnected ? seg.querySelector(`.mx-seg-opt[data-value="${value}"]`) : null;
    }

    function otherSegment() {
      return lens.segment === 'primary' ? 'secondary' : 'primary';
    }

    function paintSegmentTargets() {
      if (!seg) return;
      const on = !!carry || dragHint.dragging;
      seg.querySelectorAll('.mx-seg-opt').forEach(o => {
        const isOther = o.dataset.value === otherSegment();
        toggleClass(o, 'is-target', on && isOther);
        toggleClass(o, 'is-hover', dragHint.kind === 'segment' && isOther);
      });
      els.chips && els.chips.forEach((b, key) => {
        toggleClass(b, 'is-target', on && key !== 'all' && (carry ? key !== lens.color : true));
        toggleClass(b, 'is-hover', dragHint.kind === 'chip' && dragHint.color === key);
      });
    }

    // --- Drag view (task-gestures.js) ----------------------------------------------------------

    const dragView = {
      // Static targets captured at the lift (document coordinates for the list)
      dragTargets(taskId) {
        const sy = window.scrollY;
        const panes = [...els.list.querySelectorAll(':scope > .mx-pane')].map(pane => {
          const r = pane.getBoundingClientRect();
          const head = pane._mx.head.getBoundingClientRect();
          const rowsBox = pane._mx.rows.getBoundingClientRect();
          const rows = [...pane._mx.rows.querySelectorAll(':scope > .mx-task-slot')]
            .filter(s => s.dataset.taskId !== taskId && !s.hidden)
            .map(s => { const b = s.getBoundingClientRect(); return { top: b.top + sy, bottom: b.bottom + sy }; });
          return {
            color: pane.dataset.color, top: r.top + sy, bottom: r.bottom + sy, headBottom: head.bottom + sy,
            left: rowsBox.left, width: rowsBox.width, rows,
          };
        });
        const chips = MOBILE_COLOR_ORDER.map(c => ({ color: c, el: els.chips.get(c) }));
        return { panes, chips, sub: els.sub, segOther: segOption(otherSegment()), pinned: lens.segment === 'primary' };
      },
      setDragHint(h) {
        if (h && h.dragging !== undefined) dragHint = { dragging: h.dragging, kind: null, color: null };
        else dragHint = { ...dragHint, kind: h ? h.kind : null, color: h ? h.color : null };
        paintSegmentTargets();
        els.list.querySelectorAll(':scope > .mx-pane').forEach(pane => {
          toggleClass(pane._mx.head, 'is-hover', dragHint.kind === 'header' && dragHint.color === pane.dataset.color);
        });
      },
      startCarry: (id) => startCarry(id),
    };

    // --- Lift & place (carry mode) --------------------------------------------------------------

    let carryBound = false;
    function carryDock() {
      const dock = document.getElementById('mx-carry');
      if (!dock) return null;
      if (!carryBound || !dock.querySelector('.mx-carry-text')) {
        carryBound = true;
        dock.setAttribute('role', 'group');
        dock.setAttribute('aria-label', 'Moving a task');
        const grip = el('span', 'mx-carry-grip');
        grip.innerHTML = GRIP;
        grip.setAttribute('aria-hidden', 'true');
        const text = el('span', 'mx-carry-text');
        text.setAttribute('aria-live', 'polite');
        const move = el('button', 'mx-carry-btn mx-carry-move', 'Move…');
        move.type = 'button';
        move.addEventListener('click', () => {
          if (!carry) return;
          const id = carry.taskId;
          endCarry();
          view.openMoveSheet(id);
        });
        const cancel = el('button', 'mx-carry-btn mx-carry-cancel', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => cancelCarry());
        dock.replaceChildren(grip, text, move, cancel);
      }
      return dock;
    }

    function startCarry(taskId, { fromKeyboard = false } = {}) {
      const task = getTaskById(taskId);
      if (!task) return;
      // From another tab (a Today row's actions sheet): the gaps live on Tasks, so
      // go there first (its hide() would end a carry started before the switch)
      if (api.getTab() !== 'tasks') api.navigate('tasks', { reveal: { taskId } });
      closeAnyReveal({ immediate: true });
      if (gestures) gestures.cancel();
      // The carried task's own bucket is on screen when the carry starts
      const seg = task.pinned ? 'primary' : 'secondary';
      if (lens.segment !== seg) { lens.segment = seg; lens.color = 'all'; store.set('segment', seg); publish(); }
      if (lens.color !== 'all' && lens.color !== normColor(task.color)) { lens.color = normColor(task.color); publish(); }
      carry = { taskId, title: task.title || 'Untitled Task' };
      const dock = carryDock();
      if (dock) setText(dock.querySelector('.mx-carry-text'), `Moving “${carry.title}”`);
      document.documentElement.setAttribute('data-mx-carry', '');
      hintDone();
      api.render('lens');
      api.syncHistory();
      if (fromKeyboard) requestAnimationFrame(() => { const gap = els.list.querySelector('.mx-gap'); if (gap) gap.focus(); });
    }

    function endCarry() {
      if (!carry) return;
      carry = null;
      document.documentElement.removeAttribute('data-mx-carry');
      api.render('lens');
      api.syncHistory();
    }

    function cancelCarry() {
      if (!carry) return;
      const id = carry.taskId;
      endCarry();
      requestAnimationFrame(() => { const row = rowEl(id); if (row) row.querySelector('.mx-task')?.focus({ preventScroll: true }); });
    }

    // --- Rows, flash, reveal -------------------------------------------------------------------

    function rowEl(id) {
      return els.list ? els.list.querySelector(`.mx-task-slot[data-task-id="${CSS.escape(id)}"]`) : null;
    }

    function flash(id) {
      // after the render the save queued
      const run = () => {
        const row = rowEl(id);
        if (!row) return;
        row.classList.remove('mx-just');
        void row.offsetWidth;
        row.classList.add('mx-just');
        clearTimeout(row._mxJust);
        row._mxJust = setTimeout(() => row.classList.remove('mx-just'), 2700);
      };
      requestAnimationFrame(run);
    }

    function revealTask(id) {
      const task = getTaskById(id);
      if (!task) return;
      if (api.getTab() !== 'tasks') { api.navigate('tasks', { reveal: { taskId: id } }); return; }
      reveal({ taskId: id });
    }

    function reveal(target) {
      const task = target && target.taskId ? getTaskById(target.taskId) : null;
      if (!task) return;
      resolveLens();
      const seg = task.pinned ? 'primary' : 'secondary';
      const color = normColor(task.color);
      let changed = false;
      if (lens.segment !== seg) {
        lens.segment = seg;
        lens.color = remembered(seg) === 'all' ? 'all' : color;
        store.set('segment', seg);
        changed = true;
      } else if (lens.color !== 'all' && lens.color !== color) {
        lens.color = color;
        changed = true;
      }
      if (changed) { publish(); api.render('lens'); }
      requestAnimationFrame(() => {
        const row = rowEl(task.id);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: api.reduceMotion() ? 'auto' : 'smooth' });
        flash(task.id);
      });
    }

    function openCompletedScreen(opts = {}) {
      closeAnyReveal({ immediate: true });
      return openCompleted(api, actions, opts);
    }

    // --- Wiring -----------------------------------------------------------------------------

    const view = {
      rowEl,
      flash,
      startCarry: (id, o) => startCarry(id, o),
      revealTask,
      openMoveSheet: (id) => openMoveSheet(api, actions, view, id),
    };
    const actions = createTaskActions(api, view);

    const rowHandlers = {
      open: (id) => actions.openTask(id),
      complete: (id, slot) => actions.completeWithUndo(id, { slot }),
      actions: (id) => actions.openActionsSheet(id),
      toggleGroup: (id) => actions.toggleGroupWithUndo(id),
    };

    // Rows lent to other tabs: Today ('today': swipes, a hold opens the actions
    // sheet) and Search ('search': taps only)
    function taskRow(task, opts = {}) {
      const mode = opts.mode === 'today' || opts.mode === 'search' ? opts.mode : 'today';
      const row = createTaskRow(task, { mode, chip: opts.chip || null, contextOnly: !!opts.contextOnly, todayKey: dayKey(), handlers: rowHandlers });
      if (mode === 'today') attachGestures(row, { api, mode: 'today', actions });
      return row;
    }

    api.registerScreen({
      id: 'tasks',
      title: 'Tasks',
      icon: 'tasks',
      mount,
      signature,
      render,
      topbar,
      reveal,
      hide() {
        closeAnyReveal({ immediate: true });
        if (gestures) gestures.cancel();
        if (carry) endCarry();
      },
    });
    api.provide('taskRow', taskRow);
    api.provide('taskActions', actions);
    api.provide('completed', { open: (opts) => openCompletedScreen(opts || {}) });
    api.registerLayer({
      id: 'carry',
      kind: 'shell',
      root: () => document.getElementById('mx-carry'),
      isOpen: () => !!carry,
      back: () => cancelCarry(),
    });
    api.on('unmount', () => {
      closeAnyReveal({ immediate: true });
      if (gestures) gestures.cancel();
      if (carry) {
        carry = null;
        document.documentElement.removeAttribute('data-mx-carry');
      }
    });
    resolveLens();
  },
};
