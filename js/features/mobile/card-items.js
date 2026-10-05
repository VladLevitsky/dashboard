// Personal Dashboard - Mobile shell: card items on touch (unit F5)
// The Links tab, Search and (through the `items` service) Today show the REAL
// card items (sections.js createCardItemElement): they open their link or
// file, copy, show their badges and toggle Quick Access on a long press,
// exactly as on a desktop card. This module adds what touch needs:
//   - enhance(host): a touch that moves more than 10px cancels the item's
//     750 ms long-press (the items only cancel on touchend / touchcancel, so a
//     slow scroll starting on an item would toggle Quick Access), no callout,
//     no text selection, no context menu; and the link / task toggles open the
//     item sheet instead of the floating bubbles (page-coordinate popups with
//     tiny targets)
//   - openItemSheet(type, item, sectionId, subtitle): the item's own link or
//     file, its links (link colours kept) and its linked tasks
//   - the builders the Links tab and Search share: icon cells with readable
//     labels (zoomed 64px tiles, never filtered), 1-column item groups, mini
//     thumbs, quick link pills
// Items are view-only on a phone: nothing here edits or deletes them.

import { model } from '../../state.js';
import { getColorForCurrentMode, colorToGlassRgba, glassCompensateColor, isColorCode } from '../../utils.js';
import { PLACEHOLDER_URL } from '../../constants.js';
import { setImageFromRef } from '../../core/file-service.js';
import { createCardItemElement } from '../../components/sections.js';
import { cardTitle } from '../../core/mobile-common.js';
import { normalizeGroups, labelForIcon, iconLabels } from '../../core/mobile-links.js';

export const ITEM_SELECTOR = '.icon-button, .unified-reminder-item, .unified-subtask-item, .unified-copypaste-item';
const SHEET_TOGGLES = '.icon-indicator, .reminder-links-toggle, .list-item-links-toggle, .reminder-tasks-toggle, .list-item-tasks-toggle';
// Parts of an item whose hold is not a long-press (sections.js skips them)
const NO_HOLD = `${SHEET_TOGGLES}, .icon-link-indicator, .icon-task-indicator, .list-item-notes-toggle`;
const MOVE_CANCEL_PX = 10;

const TYPE_BY_DATASET = { unifiedIcon: 'icon', unifiedReminder: 'reminder', unifiedSubtask: 'subtask', unifiedCopyPaste: 'copyPaste' };
const COLLECTION = { icon: 'icons', reminder: 'reminders', subtask: 'subtasks', copyPaste: 'copyPaste' };

const LINK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const FILE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const OPEN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"/></svg>';

let api = null;

export function initCardItems(shellApi) {
  api = shellApi;
}

// --- Item lookup --------------------------------------------------------------

export function itemTypeOf(el) {
  return el ? TYPE_BY_DATASET[el.dataset.type] || null : null;
}

// The live item a rendered card item stands for (by card, section and key)
export function findItem(type, sectionId, subtitle, key, data = model) {
  const group = data && data[sectionId] && data[sectionId][subtitle];
  const list = group && !Array.isArray(group) ? group[COLLECTION[type]] : (Array.isArray(group) ? group : null);
  return Array.isArray(list) ? list.find(i => i && i.key === key) || null : null;
}

function itemFromEl(el) {
  const type = itemTypeOf(el);
  if (!type) return null;
  const { section: sectionId, subtitle, key } = el.dataset;
  const item = findItem(type, sectionId, subtitle, key);
  return item ? { type, item, sectionId, subtitle } : null;
}

const hasRealUrl = (url) => typeof url === 'string' && url.trim() !== '' && url !== PLACEHOLDER_URL;

function openUrlSafely(url) {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) { try { w.opener = null; } catch { /* cross-origin already */ } }
}

// The item's own target: its file, else its link (never the placeholder)
export function openItemTarget(item) {
  if (!item) return false;
  if (item.linkType === 'file' && item.fileId) {
    if (window.openFile) window.openFile(item.fileId, item.fileName);
    return true;
  }
  if (hasRealUrl(item.url)) { openUrlSafely(item.url); return true; }
  return false;
}

function hasOwnTarget(item) {
  return !!item && ((item.linkType === 'file' && item.fileId) || hasRealUrl(item.url));
}

// --- Touch enhancement --------------------------------------------------------------

// A finger on an item holds the shell's renders (§9.4): the item's 750 ms
// long-press toggles Quick Access, which re-renders the cards, and a rebuild
// under the finger would (a) send the release's click to a NEW element, whose
// long-press guard never fired, so the hold would also open the link or copy,
// and (b) send later touchmoves to the detached element, so a scroll could no
// longer cancel the hold. The hold is released a moment after the finger
// lifts, once the synthetic click has landed; the shell then repaints once.
const GESTURE_RELEASE_MS = 400;
const GESTURE_SAFETY_MS = 10000;   // a lost touchend never freezes the screen
const HOLD_MS = 700;               // a still touch this long has fired the long-press (750 ms, from its own touchstart)
const SWALLOW_MS = 600;

let gesture = null;   // { timer } while this module holds the shell's gesture flag
const GESTURE_OWNER = 'card-items';   // its own hold: another unit's (a Today swipe) can overlap it
let hold = null;      // the current / last item touch: { item, t0, x, y, moved, endT }

function takeGesture() {
  if (!api || typeof api.setGestureActive !== 'function') return;
  if (gesture) { clearTimeout(gesture.timer); }
  else { api.setGestureActive(true, GESTURE_OWNER); gesture = {}; }
  gesture.timer = setTimeout(releaseGesture, GESTURE_SAFETY_MS);
}

function releaseGesture(delay = 0) {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  const done = () => {
    if (!gesture) return;
    gesture = null;
    api.setGestureActive(false, GESTURE_OWNER);
  };
  if (delay > 0) gesture.timer = setTimeout(done, delay); else done();
}

// The click a long hold ends with is swallowed. The item's own guard
// (longPressTriggered) can't be trusted on touch: the compatibility mousedown
// that follows touchend restarts its long-press and clears the flag, and an
// element rebuilt under the finger never had it. Every press starts with a
// touchstart / mousedown that resets the item's state, so nothing is left
// pending on the item.
let windowGuards = false;
function installWindowGuards() {
  if (windowGuards) return;
  windowGuards = true;
  // Every new touch starts clean (window capture runs before the host's)
  window.addEventListener('touchstart', () => { hold = null; }, { capture: true, passive: true });
  window.addEventListener('click', (e) => {
    const h = hold;
    if (!h) return;
    const now = performance.now();
    const end = h.endT == null ? now : h.endT;
    hold = null;
    if (h.moved || end - h.t0 < HOLD_MS || now - end > SWALLOW_MS) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

// Idempotent per host; the host keeps working for items added later
export function enhance(host) {
  if (!host || host._mxItems) return;
  host._mxItems = true;
  host.classList.add('mx-items');
  installWindowGuards();
  let touch = null;
  host.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    const item = t && e.target && e.target.closest ? e.target.closest(ITEM_SELECTOR) : null;
    touch = item && host.contains(item) && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, item, done: false } : null;
    if (!touch) return;
    takeGesture();
    // A long hold on a toggle is just a tap on it (no long-press there)
    const onToggle = !!(e.target.closest && e.target.closest(NO_HOLD));
    hold = onToggle ? null : { item, t0: performance.now(), x: t.clientX, y: t.clientY, moved: false, endT: null };
  }, { capture: true, passive: true });
  host.addEventListener('touchmove', (e) => {
    if (!touch || touch.done) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > MOVE_CANCEL_PX) {
      touch.done = true;
      if (hold) hold.moved = true;
      // The item's own long-press listener cancels on touchcancel
      touch.item.dispatchEvent(new Event('touchcancel'));
    }
  }, { capture: true, passive: true });
  const end = (e) => {
    // Our own touchcancel (sent to the item above) is not the finger lifting
    if (!e.isTrusted) return;
    if (hold && hold.endT == null) hold.endT = performance.now();
    releaseGesture(GESTURE_RELEASE_MS);
    touch = null;
  };
  host.addEventListener('touchend', end, { capture: true, passive: true });
  host.addEventListener('touchcancel', end, { capture: true, passive: true });
  host.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.closest && e.target.closest(ITEM_SELECTOR)) e.preventDefault();
  });
  // Link / task toggles open the item sheet; the bubbles never open
  host.addEventListener('click', (e) => {
    const toggle = e.target && e.target.closest ? e.target.closest(SHEET_TOGGLES) : null;
    if (!toggle || !host.contains(toggle)) return;
    e.stopPropagation();
    e.preventDefault();
    const hit = itemFromEl(toggle.closest(ITEM_SELECTOR));
    if (hit) openItemSheet(hit.type, hit.item, hit.sectionId, hit.subtitle);
  }, true);
}

// --- Builders ------------------------------------------------------------------------

// A 20px (or `size`) picture of an icon: the same pixels as the tile, never
// filtered (only the user's own .invert-dark opt-in applies)
export function iconThumb(icon, size = 20) {
  const box = document.createElement('span');
  box.className = 'mx-thumb';
  box.style.setProperty('--mx-thumb', `${size}px`);
  box.setAttribute('aria-hidden', 'true');
  const ref = icon && icon.icon;
  const emoji = typeof ref === 'string' && ref.length <= 10 && !/[/.]/.test(ref) && !ref.startsWith('data:');
  if (emoji) {
    box.classList.add('mx-thumb--emoji');
    box.textContent = ref;
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    if (icon && icon.invertDark) img.classList.add('invert-dark');
    setImageFromRef(img, ref);
    box.appendChild(img);
  }
  return box;
}

// An icon tile (the real card item at 64px through zoom) with its label
// below it, outside the tile
export function buildIconCell(icon, sectionId, subtitle, label) {
  const cell = document.createElement('div');
  cell.className = 'mx-icon-cell';
  const zoom = document.createElement('div');
  zoom.className = 'mx-icon-zoom';
  const btn = createCardItemElement('icon', icon, sectionId, subtitle);
  if (!btn) return null;
  const target = icon.linkType === 'file' && icon.fileId ? (icon.fileName || 'File') : (icon.url || '');
  const name = label || labelForIcon(icon);
  btn.title = target || name;
  btn.setAttribute('aria-label', name);
  zoom.appendChild(btn);
  const text = document.createElement('span');
  text.className = 'mx-icon-label';
  text.textContent = name;
  text.setAttribute('aria-label', target ? `${name}, ${target}` : name);
  cell.append(zoom, text);
  return cell;
}

const inQuickAccess = (type, item, sectionId, subtitle) => {
  if (!window.isItemInQuickAccess) return false;
  if (type === 'icon') return window.isItemInQuickAccess({ type: 'icon', icon: item.icon, url: item.url, title: item.title || item.key, name: item.key, sectionType: sectionId, subtitle });
  if (type === 'reminder') return window.isItemInQuickAccess({ type: 'reminder', text: item.title, url: item.url, name: item.key, sectionType: sectionId, subtitle });
  if (type === 'copyPaste') return window.isItemInQuickAccess({ type: 'copyPaste', text: item.text, copyText: item.copyText || item.text, name: item.key, sectionType: sectionId, subtitle });
  return window.isItemInQuickAccess({ type: 'list', text: item.text, url: item.url, name: item.key, sectionType: sectionId, subtitle });
};

// Quick Access items first, as on a desktop card in view mode (icons within
// their own separator-delimited run; separators stay put)
function qaFirst(type, list, sectionId, subtitle) {
  if (type === 'icon') {
    const out = [];
    let run = [];
    const flush = () => {
      out.push(...run.filter(i => inQuickAccess('icon', i, sectionId, subtitle)), ...run.filter(i => !inQuickAccess('icon', i, sectionId, subtitle)));
      run = [];
    };
    list.forEach(i => { if (i.isDivider) { flush(); out.push(i); } else run.push(i); });
    flush();
    return out;
  }
  const yes = list.filter(i => inQuickAccess(type, i, sectionId, subtitle));
  return [...yes, ...list.filter(i => !yes.includes(i))];
}

function group(className, type, list, sectionId, subtitle) {
  if (!list.length) return null;
  const el = document.createElement('div');
  el.className = className;
  list.forEach(item => {
    const node = createCardItemElement(type, item, sectionId, subtitle);
    if (node) el.appendChild(node);
  });
  return el.children.length ? el : null;
}

// The open card's content: one block per named section (caption + items).
// Empty sections are left out. Returns the keys it rendered (new-item glow).
export function buildCardBody(body, sectionId, data = model) {
  const groups = normalizeGroups(data[sectionId]);
  const allIcons = groups.flatMap(g => g.icons);
  const labels = iconLabels(allIcons);
  const labelOf = new Map(allIcons.map((icon, i) => [icon, labels[i]]));
  const keys = [];
  let any = false;
  groups.forEach(g => {
    const total = g.icons.length + g.reminders.length + g.subtasks.length + g.copyPaste.length;
    if (!total) return;
    any = true;
    const block = document.createElement('div');
    block.className = 'unified-content-group mx-card-group';
    block.dataset.subtitle = g.subtitle;
    if (g.subtitle && g.subtitle !== '_default') {
      const cap = document.createElement('h3');
      cap.className = 'mx-sub-caption';
      cap.textContent = g.subtitle;
      block.appendChild(cap);
    }
    if (g.icons.length) {
      const grid = document.createElement('div');
      grid.className = 'unified-icons-group mx-icon-grid';
      qaFirst('icon', g.icons, sectionId, g.subtitle).forEach(icon => {
        if (icon.isDivider) {
          const sep = document.createElement('div');
          sep.className = 'mx-icon-sep';
          sep.setAttribute('role', 'separator');
          grid.appendChild(sep);
          return;
        }
        const cell = buildIconCell(icon, sectionId, g.subtitle, labelOf.get(icon));
        if (cell) { grid.appendChild(cell); keys.push(`${g.subtitle}|${icon.key}`); }
      });
      block.appendChild(grid);
    }
    const regular = g.copyPaste.filter(c => !isColorCode(String(c.copyText || '').trim()));
    const swatches = g.copyPaste.filter(c => isColorCode(String(c.copyText || '').trim()));
    [
      group('unified-reminders-group', 'reminder', qaFirst('reminder', g.reminders, sectionId, g.subtitle), sectionId, g.subtitle),
      group('unified-subtasks-group', 'subtask', qaFirst('subtask', g.subtasks, sectionId, g.subtitle), sectionId, g.subtitle),
      group('unified-copypaste-group', 'copyPaste', qaFirst('copyPaste', regular, sectionId, g.subtitle), sectionId, g.subtitle),
      group('unified-swatch-group', 'copyPaste', qaFirst('copyPaste', swatches, sectionId, g.subtitle), sectionId, g.subtitle),
    ].forEach(el => { if (el) block.appendChild(el); });
    [...g.reminders, ...g.subtasks, ...g.copyPaste].forEach(i => keys.push(`${g.subtitle}|${i.key}`));
    body.appendChild(block);
  });
  if (!any) {
    const p = document.createElement('p');
    p.className = 'mx-card-empty';
    p.textContent = 'Nothing on this card yet. Use ＋ to add an icon, a link, a reminder or a snippet.';
    body.appendChild(p);
  }
  return keys;
}

// Quick links (added with ＋ Link) look like card subtasks, as in the Today view
export function buildQuickLinkPill(link) {
  const pill = document.createElement('div');
  pill.className = 'unified-subtask-item mx-quick-link';
  pill.tabIndex = 0;
  pill.setAttribute('role', 'link');
  pill.title = link.url;
  const base = model.darkMode ? glassCompensateColor('#334155') : '#f7fafc';
  pill.style.background = colorToGlassRgba(base, 0.55);
  const left = document.createElement('div');
  left.className = 'unified-subtask-left';
  const icon = document.createElement('span');
  icon.className = 'mx-quick-link-icon';
  icon.innerHTML = LINK_SVG;
  const text = document.createElement('span');
  text.className = 'mx-quick-link-text';
  text.textContent = link.title || link.url;
  left.append(icon, text);
  pill.appendChild(left);
  const open = () => openUrlSafely(link.url);
  pill.addEventListener('click', open);
  pill.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
  return pill;
}

// Quick Access entries ({ icons, reminders, subtasks, copyPaste: [{ item,
// sectionId, subtitle }], quickLinks }) as real items, in card order
export function buildQuickAccess(host, qa) {
  const icons = qa.icons || [];
  if (icons.length) {
    const labels = iconLabels(icons.map(e => e.item));
    const grid = document.createElement('div');
    grid.className = 'unified-icons-group mx-icon-grid mx-qa-icons';
    icons.forEach((e, i) => {
      const cell = buildIconCell(e.item, e.sectionId, e.subtitle, labels[i]);
      if (cell) grid.appendChild(cell);
    });
    if (grid.children.length) host.appendChild(grid);
  }
  const add = (className, entries, type) => {
    if (!entries.length) return;
    const el = document.createElement('div');
    el.className = className;
    entries.forEach(({ item, sectionId, subtitle }) => {
      const node = createCardItemElement(type, item, sectionId, subtitle);
      if (node) el.appendChild(node);
    });
    if (el.children.length) host.appendChild(el);
  };
  add('unified-reminders-group', qa.reminders || [], 'reminder');
  add('unified-subtasks-group', qa.subtasks || [], 'subtask');
  const isSwatchEntry = ({ item }) => isColorCode(String(item.copyText || '').trim());
  add('unified-copypaste-group', (qa.copyPaste || []).filter(e => !isSwatchEntry(e)), 'copyPaste');
  add('unified-swatch-group', (qa.copyPaste || []).filter(isSwatchEntry), 'copyPaste');
  if ((qa.quickLinks || []).length) {
    const links = document.createElement('div');
    links.className = 'unified-subtasks-group mx-quick-links';
    qa.quickLinks.forEach(link => links.appendChild(buildQuickLinkPill(link)));
    host.appendChild(links);
  }
}

// --- Item sheet (W15) -----------------------------------------------------------------

function caption(text) {
  const h = document.createElement('h3');
  h.className = 'mx-caption';
  h.textContent = text;
  return h;
}

function itemLabel(type, item, sectionId) {
  if (type === 'icon') {
    const groups = normalizeGroups(model[sectionId]);
    const icons = groups.flatMap(g => g.icons);
    const i = icons.indexOf(item);
    return i >= 0 ? iconLabels(icons)[i] : labelForIcon(item);
  }
  if (type === 'reminder') return item.title || item.name || 'Reminder';
  return item.text || item.copyText || 'Item';
}

function linkPill(link) {
  const color = getColorForCurrentMode(link.color || null, '#f7fafc', '#475569');
  const tinted = model.darkMode && window.glassCompensateColor ? window.glassCompensateColor(color) : color;
  if (link.type === 'file') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reminder-link-bubble reminder-file-bubble mx-link-pill';
    b.style.background = colorToGlassRgba(tinted, 0.62);
    b.innerHTML = FILE_SVG;
    const t = document.createElement('span');
    t.className = 'mx-link-pill-text';
    t.textContent = link.title || link.fileName || 'File';
    b.appendChild(t);
    b.addEventListener('click', () => { if (link.fileId && window.openFile) window.openFile(link.fileId, link.fileName); });
    return b;
  }
  const a = document.createElement('a');
  a.className = 'reminder-link-bubble mx-link-pill';
  a.href = link.url || '#';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.background = colorToGlassRgba(tinted, 0.62);
  a.innerHTML = LINK_SVG;
  const t = document.createElement('span');
  t.className = 'mx-link-pill-text';
  t.textContent = link.title || link.url || 'Link';
  a.appendChild(t);
  a.title = link.url || '';
  a.addEventListener('click', (e) => { if (!link.url) e.preventDefault(); });
  return a;
}

function fallbackTaskRow(task) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mx-row mx-task-fallback';
  b.style.setProperty('--priority-rgb', ({ red: '249 76 100', orange: '255 133 35', yellow: '242 189 24', blue: '61 151 248' })[task.color] || '61 151 248');
  const dot = document.createElement('span');
  dot.className = 'mx-row-dot';
  dot.setAttribute('aria-hidden', 'true');
  const t = document.createElement('span');
  t.className = 'mx-row-title';
  t.textContent = task.title || 'Untitled task';
  b.append(dot, t);
  b.addEventListener('click', () => {
    const actions = api && api.service('taskActions');
    if (actions && typeof actions.openTask === 'function') actions.openTask(task.id);
    else if (window.openEditTaskModal) window.openEditTaskModal(task.id);
  });
  return b;
}

// A task row from the Tasks unit (F1) when it is loaded, else a plain row
export function taskRowFor(task, opts = { mode: 'search' }) {
  const rowFn = api && api.service('taskRow');
  if (typeof rowFn === 'function') {
    try {
      const el = rowFn(task, opts);
      if (el) return el;
    } catch (err) { console.error('[mobile] taskRow failed', err); }
  }
  return fallbackTaskRow(task);
}

export function openItemSheet(type, item, sectionId, subtitle) {
  if (!api || !item) return null;
  const tasks = window.getTasksForItem && COLLECTION[type] && type !== 'copyPaste' ? window.getTasksForItem(type, item.key, sectionId) : [];
  const label = itemLabel(type, item, sectionId);
  const section = (model.sections || []).find(s => s.id === sectionId);
  return api.openSheet({
    id: 'item',
    title: '',
    size: 'auto',
    build(body, sheet) {
      sheet.el.classList.add('mx-item-sheet');
      sheet.el.setAttribute('aria-label', label);
      const head = document.createElement('header');
      head.className = 'mx-item-head';
      if (type === 'icon') head.appendChild(iconThumb(item, 40));
      const names = document.createElement('div');
      names.className = 'mx-item-names';
      const h = document.createElement('h2');
      h.className = 'mx-item-title';
      h.textContent = label;
      names.appendChild(h);
      if (section) {
        const where = document.createElement('p');
        where.className = 'mx-item-where';
        where.textContent = subtitle && subtitle !== '_default' ? `${cardTitle(model, section)} › ${subtitle}` : cardTitle(model, section);
        names.appendChild(where);
      }
      head.appendChild(names);
      if (type === 'copyPaste') {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'mx-btn mx-item-open';
        copy.textContent = 'Copy';
        copy.addEventListener('click', () => {
          const text = item.copyText || item.text || '';
          Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(text))
            .then(() => api.toast('Copied to clipboard!'), () => api.toast('Couldn’t copy'));
        });
        head.appendChild(copy);
      } else if (hasOwnTarget(item)) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'mx-btn mx-item-open';
        open.innerHTML = `<span>Open</span>${OPEN_SVG}`;
        open.setAttribute('aria-label', `Open ${label}`);
        open.addEventListener('click', () => openItemTarget(item));
        head.appendChild(open);
      }
      body.appendChild(head);

      const links = Array.isArray(item.links) ? item.links.filter(l => l && typeof l === 'object') : [];
      const real = links.filter(l => l.type !== 'section');
      if (links.length) {
        body.appendChild(caption(`Links · ${real.length}`));
        const list = document.createElement('div');
        list.className = 'mx-link-list';
        links.forEach(link => {
          if (link.type === 'section') {
            const d = document.createElement('p');
            d.className = 'mx-link-divider';
            d.textContent = link.title || '';
            list.appendChild(d);
          } else {
            list.appendChild(linkPill(link));
          }
        });
        body.appendChild(list);
      }

      if (type !== 'copyPaste') {
        body.appendChild(caption(`Tasks · ${tasks.length}`));
        if (tasks.length) {
          const list = document.createElement('div');
          list.className = 'mx-item-tasks';
          tasks.forEach(task => list.appendChild(taskRowFor(task, { mode: 'search' })));
          body.appendChild(list);
        }
      }

      const foot = document.createElement('p');
      foot.className = 'mx-sheet-note mx-item-foot';
      foot.textContent = 'Hold an item to add it to Quick Access.';
      body.appendChild(foot);
    },
  });
}
