// Personal Dashboard - Quick Capture
// Press N anywhere (or the bolt button in the header, shown in the Mobile
// layout only) to open a one-line bar above everything, type, press Enter:
//   Send deck to Marc fri !red !priority !timer !url:telcobridges.com
//   @<pick a task> tomorrow !orange fix the numbers   → changes that task
// The line is read by js/core/quick-capture-parse.js (pure rules). This module
// owns the bar: the @ task and !category: pickers (a pick becomes a chip in the
// field; Backspace at the start of the line removes the last one), the live
// preview, the ⓘ command reference, saving through the task editor's own
// functions, and a toast with Open / Undo.
//
// Off in edit mode: a task made there would only live in the working copy
// (gone on Cancel), while timers always write to the saved model.

import { editState } from '../state.js';
import { showToast } from '../utils.js';
import { saveModel } from '../core/storage.js';
import { TASK_COLOR_LABELS } from '../constants.js';
import { parseQuickCapture, fromDateKey, normalizeUrl, QUICK_CAPTURE_HELP } from '../core/quick-capture-parse.js';
import {
  getAllTasks, getTaskById, createTask, updateTask, deleteTask, openEditTaskModal,
  refreshTaskViews, generateSubtaskId
} from './tasks.js';
import { getTaskCategories, getTaskCategory, categoryColor } from './task-categories.js';
import { startTimerForTask, undoTimerStart, isTaskTimerRunning, syncTaskTimeMeta } from './time-tracking.js';

const COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];
const TOAST_MS = 7000;

const svg = (body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
const BOLT_SVG = svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>');
const INFO_SVG = svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><path d="M12 7.5h.01"/>');
const CLOSE_SVG = svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
const PLUS_SVG = svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');
const EDIT_SVG = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const SUBTASK_SVG = svg('<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>');
const CALENDAR_SVG = svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
const STAR_SVG = svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>');
const WATCH_SVG = svg('<circle cx="12" cy="14" r="8"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="9" y1="2" x2="15" y2="2"/><line x1="12" y1="14" x2="12" y2="10"/><line x1="12" y1="14" x2="15" y2="17"/>');
const LINK_SVG = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>');
const ALERT_SVG = svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><path d="M12 17h.01"/>');

// Module state
let root = null;            // the overlay (built on first open)
const els = {};
let tokens = [];            // picked chips in the field: { kind: 'task', taskId } | { kind: 'category', categoryId }
let picker = null;          // open list: { kind, start, end, query, items, index }
let dismissed = null;       // a list closed with Esc stays closed for that word: { kind, start }
let attempted = false;      // tried to save: quiet problems (no name yet) turn red
let lastFocus = null;
let toastTimer = null;
let toastVisible = false;

// ============================================================
// OPEN / CLOSE
// ============================================================

export function initQuickCapture() {
  document.addEventListener('keydown', onGlobalKeyDown);
  const toggle = document.getElementById('quick-capture-toggle');
  // A tap doesn't hand focus back to the button on close (no stray focus ring); a keyboard press does
  if (toggle) toggle.addEventListener('click', (e) => openQuickCapture({ restoreFocus: e.detail === 0 }));
}

export function openQuickCapture({ restoreFocus = true } = {}) {
  if (editState.enabled) {
    showToast('Quick capture is off in edit mode. Save or cancel your edits first');
    return;
  }
  ensureDom();
  if (!root.hidden) {
    els.input.focus();
    return;
  }
  lastFocus = restoreFocus ? document.activeElement : null;
  els.input.value = '';
  tokens = [];
  picker = null;
  dismissed = null;
  attempted = false;
  els.help.hidden = true;
  renderTokens();
  root.hidden = false;
  els.input.focus();
  requestAnimationFrame(() => root.classList.add('open'));
  update();
}

export function closeQuickCapture() {
  if (!root || root.hidden) return;
  picker = null;
  renderPicker();
  els.help.hidden = true;
  root.classList.remove('open');
  root.hidden = true;
  const back = lastFocus;
  lastFocus = null;
  if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') {
    back.focus({ preventScroll: true });
  }
}

// N opens the bar unless the key is meant for a text field
function onGlobalKeyDown(e) {
  if (e.defaultPrevented || e.repeat || e.isComposing) return;
  if (e.key !== 'n' && e.key !== 'N') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
  if (isTextField(target) || isTextField(deepActiveElement())) return;
  e.preventDefault();
  openQuickCapture();
}

function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

// The focused element, looking inside shadow roots (the emoji picker's search box)
function deepActiveElement() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

// ============================================================
// DOM
// ============================================================

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'quick-capture';
  root.className = 'qc-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="qc-backdrop"></div>
    <div class="qc-dialog" role="dialog" aria-modal="true" aria-label="Quick capture">
      <div class="qc-field-wrap">
        <div class="qc-field">
          <span class="qc-field-icon" aria-hidden="true">${BOLT_SVG}</span>
          <div class="qc-tokens" hidden></div>
          <input type="text" class="qc-input" id="qc-input" role="combobox" aria-autocomplete="list"
            aria-expanded="false" aria-controls="qc-picker" aria-describedby="qc-preview"
            autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false"
            enterkeyhint="done" placeholder="New task… try: Send deck fri !red !timer" />
          <button type="button" class="qc-info-btn" title="All commands" aria-label="Show all commands" aria-haspopup="dialog">${INFO_SVG}</button>
        </div>
        <div class="qc-picker task-mention-dropdown" id="qc-picker" role="listbox" aria-label="Suggestions" hidden></div>
      </div>
      <div class="qc-preview" id="qc-preview"></div>
      <div class="qc-footer">
        <button type="button" class="qc-hint-link qc-footer-help" aria-haspopup="dialog">See all commands</button>
        <span class="qc-footer-keys" aria-hidden="true">
          <span><kbd>Enter</kbd> save</span>
          <span><kbd>Shift</kbd> + <kbd>Enter</kbd> save and open</span>
          <span><kbd>Esc</kbd> close</span>
        </span>
      </div>
    </div>
    <div class="qc-help" hidden>
      <div class="qc-help-backdrop"></div>
      <div class="qc-help-dialog" role="dialog" aria-modal="true" aria-labelledby="qc-help-title">
        <div class="qc-help-header">
          <h4 id="qc-help-title">Quick capture commands</h4>
          <button type="button" class="qc-help-close" title="Close" aria-label="Close">${CLOSE_SVG}</button>
        </div>
        <div class="qc-help-body"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  els.dialog = root.querySelector('.qc-dialog');
  els.tokens = root.querySelector('.qc-tokens');
  els.input = root.querySelector('.qc-input');
  els.info = root.querySelector('.qc-info-btn');
  els.footerHelp = root.querySelector('.qc-footer-help');
  els.picker = root.querySelector('.qc-picker');
  els.preview = root.querySelector('.qc-preview');
  els.help = root.querySelector('.qc-help');
  els.helpBody = root.querySelector('.qc-help-body');
  els.helpClose = root.querySelector('.qc-help-close');

  root.querySelector('.qc-backdrop').addEventListener('click', closeQuickCapture);
  root.querySelector('.qc-help-backdrop').addEventListener('click', () => closeHelp());
  els.helpClose.addEventListener('click', () => closeHelp());
  els.info.addEventListener('click', openHelp);
  els.footerHelp.addEventListener('mousedown', (e) => e.preventDefault());
  els.footerHelp.addEventListener('click', openHelp);

  els.input.addEventListener('input', () => {
    attempted = false;
    els.dialog.classList.remove('qc-shake');
    update();
  });
  els.input.addEventListener('keydown', onInputKeyDown);
  els.input.addEventListener('click', update);
  els.input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update();
  });

  // Picker: keep focus in the field, pick on click
  els.picker.addEventListener('mousedown', (e) => e.preventDefault());
  els.picker.addEventListener('click', (e) => {
    const option = e.target.closest('[data-qc-index]');
    if (option) pick(Number(option.dataset.qcIndex));
  });

  // Command reference: click an example to add it to the line
  els.helpBody.addEventListener('click', (e) => {
    const example = e.target.closest('[data-qc-insert]');
    if (example) insertText(example.dataset.qcInsert);
  });

  // Keys inside the bar never reach the page's own shortcuts
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!els.help.hidden) closeHelp();
      else closeQuickCapture();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
    e.stopPropagation();
  });
}

function trapFocus(e) {
  // In page order: field, ⓘ, any clickable preview chip, "See all commands"
  const list = els.help.hidden
    ? [els.input, els.info, ...els.preview.querySelectorAll('button'), els.footerHelp]
    : [els.helpClose, ...els.helpBody.querySelectorAll('button')];
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !list.includes(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !list.includes(active))) {
    e.preventDefault();
    first.focus();
  }
}

// ============================================================
// FIELD: keys, chips, pickers
// ============================================================

function onInputKeyDown(e) {
  if (e.isComposing || e.keyCode === 229) return;

  if (picker) {
    const count = picker.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        picker.index = picker.index < 0 ? 0 : (picker.index + step + count) % count;
        highlightPicker();
      }
      return;
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && count && !e.shiftKey)) {
      // While a list is open, Enter picks from it; it never saves by accident
      e.preventDefault();
      if (count && picker.index >= 0) pick(picker.index);
      else dismissPicker();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissPicker();
      return;
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeQuickCapture();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    submit({ openAfter: e.shiftKey });
    return;
  }
  if (e.key === 'Backspace' && tokens.length && els.input.selectionStart === 0 && els.input.selectionEnd === 0) {
    e.preventDefault();
    tokens.pop();
    renderTokens();
    update();
  }
}

function renderTokens() {
  const box = els.tokens;
  box.textContent = '';
  tokens.forEach((token, index) => {
    const chip = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'qc-token-label';
    let name;
    if (token.kind === 'task') {
      const task = getTaskById(token.taskId);
      const color = task && COLOR_ORDER.includes(task.color) ? task.color : 'blue';
      chip.className = `qc-token qc-token-task task-bubble-${color}`;
      name = task ? (task.title || 'Untitled Task') : 'Task not found';
      label.textContent = name;
      chip.title = `Changing “${name}”`;
    } else {
      const category = getTaskCategory(token.categoryId);
      chip.className = 'qc-token qc-token-cat task-category-chip active';
      chip.style.setProperty('--chip-color', categoryColor(category));
      const dot = document.createElement('span');
      dot.className = 'task-category-dot';
      chip.appendChild(dot);
      name = category ? category.name : 'Deleted category';
      label.textContent = name;
      chip.title = `Category: ${name}`;
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'qc-token-remove';
    remove.tabIndex = -1;
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.innerHTML = CLOSE_SVG;
    remove.addEventListener('mousedown', (e) => e.preventDefault());
    remove.addEventListener('click', () => {
      tokens.splice(index, 1);
      renderTokens();
      els.input.focus();
      update();
    });
    chip.append(label, remove);
    box.appendChild(chip);
  });
  box.hidden = tokens.length === 0;
}

// Where the caret is: typing "@…" or "!category:…" opens a list
function detectPicker() {
  const input = els.input;
  const caret = input.selectionStart;
  if (caret == null || caret !== input.selectionEnd) return null;
  const value = input.value;
  const before = value.slice(0, caret);
  // The rest of the word after the caret goes too when a pick replaces it
  const end = caret + (/^\S*/.exec(value.slice(caret))[0].length);

  const category = /(^|\s)(!(?:category|cat):)"([^"]*)$/i.exec(before) || /(^|\s)(!(?:category|cat):)([^\s"]*)$/i.exec(before);
  if (category) {
    return { kind: 'category', start: category.index + category[1].length, end, query: category[3] };
  }
  const at = before.lastIndexOf('@');
  if (at !== -1 && (at === 0 || /\s/.test(before[at - 1]))) {
    const query = before.slice(at + 1);
    // A command, an escape or another @ ends the task search
    if (!/(^|\s)[!\\@]/.test(query) && query.length <= 80) return { kind: 'task', start: at, end, query };
  }
  return null;
}

function colorRank(color) {
  const i = COLOR_ORDER.indexOf(color);
  return i === -1 ? COLOR_ORDER.length - 1 : i;
}

function taskMatches(query) {
  const q = query.replace(/^\s+/, '').toLowerCase();
  return getAllTasks()
    .filter(t => !t.completed && (!q || (t.title || '').toLowerCase().includes(q)))
    .sort((a, b) => colorRank(a.color) - colorRank(b.color)
      || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (a.order || 0) - (b.order || 0));
}

function categoryMatches(query) {
  const q = query.trim().toLowerCase();
  const categories = getTaskCategories();
  if (!q) return [...categories];
  const name = (c) => c.name.toLowerCase();
  const starts = categories.filter(c => name(c).startsWith(q));
  return [...starts, ...categories.filter(c => !starts.includes(c) && name(c).includes(q))];
}

function updatePicker() {
  const ctx = detectPicker();
  if (!ctx) {
    dismissed = null;
    picker = null;
    renderPicker();
    return;
  }
  if (dismissed && dismissed.kind === ctx.kind && dismissed.start === ctx.start) {
    picker = null;
    renderPicker();
    return;
  }
  dismissed = null;
  const items = ctx.kind === 'task' ? taskMatches(ctx.query) : categoryMatches(ctx.query);
  // Nothing matches and a space was typed: the @ was just text, step aside
  if (ctx.kind === 'task' && items.length === 0 && /\s$/.test(ctx.query)) {
    dismissed = { kind: ctx.kind, start: ctx.start };
    picker = null;
    renderPicker();
    return;
  }
  const same = picker && picker.kind === ctx.kind && picker.start === ctx.start && picker.query === ctx.query;
  const index = same ? Math.min(picker.index, items.length - 1) : (items.length ? 0 : -1);
  picker = { ...ctx, items, index };
  renderPicker();
}

function renderPicker() {
  const box = els.picker;
  box.textContent = '';
  if (!picker) {
    box.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
    els.input.removeAttribute('aria-activedescendant');
    return;
  }
  box.classList.toggle('qc-picker-cats', picker.kind === 'category');

  if (picker.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'task-mention-empty qc-picker-empty';
    if (picker.kind === 'task') empty.textContent = 'No matching tasks. Keep typing, or press Esc to keep it as text';
    else empty.textContent = getTaskCategories().length ? 'No matching category' : 'No categories yet. Add them in edit mode → Settings → Tasks';
    box.appendChild(empty);
  } else if (picker.kind === 'task') {
    // One column per matrix color, like the @ list in notes
    let column = null;
    let columnColor = null;
    picker.items.forEach((task, index) => {
      const color = COLOR_ORDER.includes(task.color) ? task.color : 'blue';
      if (color !== columnColor) {
        column = document.createElement('div');
        column.className = 'task-mention-col';
        column.setAttribute('role', 'group');
        column.setAttribute('aria-label', TASK_COLOR_LABELS[color]);
        box.appendChild(column);
        columnColor = color;
      }
      const option = document.createElement('div');
      option.className = `task-mention-item task-bubble-${color}`;
      option.id = `qc-option-${index}`;
      option.setAttribute('role', 'option');
      option.dataset.qcIndex = index;
      const title = document.createElement('span');
      title.className = 'task-mention-item-title';
      title.textContent = task.title || 'Untitled';
      option.appendChild(title);
      if (task.pinned) {
        const badge = document.createElement('span');
        badge.className = 'task-mention-primary-badge';
        badge.textContent = 'P';
        badge.title = 'Primary';
        option.appendChild(badge);
      }
      column.appendChild(option);
    });
  } else {
    picker.items.forEach((category, index) => {
      const option = document.createElement('div');
      option.className = 'task-category-chip qc-cat-option';
      option.style.setProperty('--chip-color', categoryColor(category));
      option.id = `qc-option-${index}`;
      option.setAttribute('role', 'option');
      option.dataset.qcIndex = index;
      const dot = document.createElement('span');
      dot.className = 'task-category-dot';
      const name = document.createElement('span');
      name.className = 'task-category-name';
      name.textContent = category.name;
      option.append(dot, name);
      box.appendChild(option);
    });
  }
  box.hidden = false;
  els.input.setAttribute('aria-expanded', 'true');
  highlightPicker();
}

function highlightPicker() {
  const options = els.picker.querySelectorAll('[data-qc-index]');
  options.forEach(option => {
    const on = picker && Number(option.dataset.qcIndex) === picker.index;
    option.classList.toggle('selected', on);
    option.setAttribute('aria-selected', String(on));
    if (on) {
      option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      els.input.setAttribute('aria-activedescendant', option.id);
    }
  });
  if (!picker || picker.index < 0) els.input.removeAttribute('aria-activedescendant');
}

function pick(index) {
  if (!picker) return;
  const item = picker.items[index];
  if (!item) return;
  const { kind, start, end } = picker;
  removeRange(start, end);
  // One task and one category per line: a new pick replaces the old chip
  tokens = tokens.filter(t => t.kind !== kind);
  tokens.push(kind === 'task' ? { kind, taskId: item.id } : { kind, categoryId: item.id });
  picker = null;
  dismissed = null;
  renderTokens();
  els.input.focus();
  update();
}

function dismissPicker() {
  if (!picker) return;
  dismissed = { kind: picker.kind, start: picker.start };
  picker = null;
  update();
}

// Cut [start, end) out of the field, leaving one space where it was
function removeRange(start, end) {
  const value = els.input.value;
  let before = value.slice(0, start);
  let after = value.slice(end);
  if (/\s$/.test(before) && /^\s/.test(after)) after = after.replace(/^\s+/, '');
  if (!before.trim()) {
    before = '';
    after = after.replace(/^\s+/, '');
  }
  els.input.value = before + after;
  els.input.setSelectionRange(before.length, before.length);
}

function insertText(text) {
  const input = els.input;
  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  input.value = before + lead + text + value.slice(end);
  const caret = (before + lead + text).length;
  closeHelp();
  input.setSelectionRange(caret, caret);
  update();
}

// "Not a date": put a \ in front of the phrase so it stays text
function keepDateAsText(span) {
  if (!span) return;
  const input = els.input;
  const caret = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, span.start) + '\\' + input.value.slice(span.start);
  const next = caret >= span.start ? caret + 1 : caret;
  input.focus();
  input.setSelectionRange(next, next);
  update();
}

// ============================================================
// PLAN + PREVIEW
// ============================================================

function linkListOf(task) {
  // Same reading as the task editor: taskLinks, else the legacy single link/file
  if (Array.isArray(task.taskLinks)) return task.taskLinks.map(l => ({ ...l }));
  if (task.link) return [{ type: 'url', value: task.link }];
  if (task.linkType === 'file' && task.fileId) return [{ type: 'file', fileId: task.fileId, fileName: task.fileName || '' }];
  return [];
}

function runningTask() {
  return getAllTasks().find(t => isTaskTimerRunning(t.id)) || null;
}

function buildPlan() {
  const text = els.input.value;
  // While a list is open, its "@…" / "!category:…" isn't part of the line yet
  // (blanked with spaces so every position stays the same)
  const parseText = picker
    ? text.slice(0, picker.start) + ' '.repeat(picker.end - picker.start) + text.slice(picker.end)
    : text;
  const parsed = parseQuickCapture(parseText, { now: new Date(), categories: getTaskCategories() });
  const issues = [...parsed.issues];

  const taskToken = tokens.find(t => t.kind === 'task');
  const categoryToken = tokens.find(t => t.kind === 'category');
  const target = taskToken ? getTaskById(taskToken.taskId) : null;
  const mode = taskToken ? 'update' : 'create';

  let category = categoryToken ? getTaskCategory(categoryToken.categoryId) : null;
  if (categoryToken && !category) issues.push({ level: 'error', message: 'That category was deleted. Remove its chip and pick another' });
  if (parsed.category) {
    if (category && category.id !== parsed.category.id) issues.push({ level: 'warning', message: 'Two categories: using the last one' });
    category = parsed.category;
  }

  let urls = parsed.urls;
  if (mode === 'update') {
    if (!target) {
      issues.push({ level: 'error', message: 'That task was completed or deleted. Remove its chip and pick another' });
    } else {
      if (parsed.explicitTask) issues.push({ level: 'warning', message: '!task is ignored when you change an existing task' });
      const existing = new Set(linkListOf(target).filter(l => l.type === 'url').map(l => normalizeUrl(l.value) || l.value));
      const already = urls.filter(u => existing.has(u));
      if (already.length) issues.push({ level: 'warning', message: `Already linked: ${already.map(shortUrl).join(', ')}` });
      urls = urls.filter(u => !existing.has(u));
      const timerRunning = isTaskTimerRunning(target.id);
      if (parsed.timer && timerRunning) issues.push({ level: 'warning', message: 'Its timer is already running' });
      // Only real differences count, so "updated" is never shown for a no-op
      const changes = parsed.title
        || (parsed.color && parsed.color !== target.color)
        || (parsed.pinned !== null && parsed.pinned !== !!target.pinned)
        || (parsed.timer && !timerRunning)
        || urls.length
        || (category && category.id !== target.categoryId)
        || (parsed.dueDate && parsed.dueDate !== target.dueDate)
        || (parsed.clearDate && !!target.dueDate);
      const asked = parsed.color || parsed.pinned !== null || parsed.timer || parsed.urls.length ||
        category || parsed.dueDate || parsed.clearDate;
      if (!changes) {
        issues.push(asked
          ? { level: 'error', message: 'The task already looks like that: nothing would change' }
          : { level: 'error', quiet: true, message: 'Add what to change: a date, a command, or text for a new subtask' });
      }
    }
  } else if (!parsed.title) {
    issues.push({ level: 'error', quiet: true, message: 'Type a name for the task' });
  }

  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return { mode, target, parsed, category, urls, issues, hasErrors: issues.some(i => i.level === 'error') };
}

function shortUrl(url) {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function truncate(text, max) {
  const s = (text || '').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function describeDue(key) {
  const date = fromDateKey(key);
  if (!date) return key;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date - today) / 86400000);
  const sameYear = date.getFullYear() === today.getFullYear();
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const relative = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday'
    : days > 1 ? `in ${days} days` : `${-days} days ago`;
  return `${label} · ${relative}`;
}

function previewChip({ icon, label, text, kind = '', title = '', dotColor = null, onClick = null }) {
  const chip = document.createElement(onClick ? 'button' : 'span');
  chip.className = `qc-pv${kind ? ` qc-pv-${kind}` : ''}`;
  if (onClick) {
    chip.type = 'button';
    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', onClick);
  }
  if (title) chip.title = title;
  if (dotColor) {
    const dot = document.createElement('span');
    dot.className = 'qc-pv-dot';
    dot.style.background = dotColor;
    chip.appendChild(dot);
  } else if (icon) {
    const holder = document.createElement('span');
    holder.className = 'qc-pv-icon';
    holder.innerHTML = icon;
    chip.appendChild(holder);
  }
  if (label) {
    const l = document.createElement('span');
    l.className = 'qc-pv-label';
    l.textContent = label;
    chip.appendChild(l);
  }
  if (text) {
    const t = document.createElement('span');
    t.className = 'qc-pv-text';
    t.textContent = text;
    chip.appendChild(t);
  }
  return chip;
}

const MATRIX_DOT = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', blue: '#3b82f6' };

function renderPreview(plan) {
  const box = els.preview;
  box.textContent = '';
  const typed = els.input.value.trim() !== '' || tokens.length > 0;

  if (!typed) {
    const hint = document.createElement('p');
    hint.className = 'qc-hint';
    const code = (text) => {
      const c = document.createElement('code');
      c.className = 'qc-code';
      c.textContent = text;
      return c;
    };
    hint.append('Add commands like ', code('fri'), ' ', code('!red'), ' ', code('!timer'),
      ', or type ', code('@'), ' to change a task you already have.');
    box.appendChild(hint);
    return;
  }

  const p = plan.parsed;
  const add = (opts) => box.appendChild(previewChip(opts));

  if (plan.mode === 'create') {
    add({ icon: PLUS_SVG, label: 'New task', text: p.title || '', kind: 'task' });
  } else if (plan.target) {
    add({ icon: EDIT_SVG, label: 'Change', text: plan.target.title || 'Untitled Task', kind: 'task' });
    if (p.title) add({ icon: SUBTASK_SVG, label: 'New subtask', text: p.title });
  }

  if (p.dueDate) {
    add({
      icon: CALENDAR_SVG, label: 'Due', text: describeDue(p.dueDate), kind: 'date',
      title: 'Not a date? Click to keep it as text',
      onClick: () => keepDateAsText(p.dateSpan),
    });
  } else if (p.clearDate) {
    add({ icon: CALENDAR_SVG, text: 'No due date' });
  }

  const color = p.color || (plan.mode === 'create' ? 'blue' : null);
  if (color) {
    add({ dotColor: MATRIX_DOT[color], text: TASK_COLOR_LABELS[color], kind: p.color ? '' : 'default', title: p.color ? '' : 'Default color' });
  }
  if (p.pinned !== null) add({ icon: STAR_SVG, text: p.pinned ? 'Primary' : 'Not primary' });

  if (p.timer && !(plan.target && isTaskTimerRunning(plan.target.id))) {
    const other = runningTask();
    const stops = other && (!plan.target || other.id !== plan.target.id);
    add({ icon: WATCH_SVG, label: 'Starts timer', text: stops ? `stops “${truncate(other.title, 28)}”` : '' });
  }
  plan.urls.forEach(url => add({ icon: LINK_SVG, text: shortUrl(url), title: url }));
  if (plan.category) add({ dotColor: categoryColor(plan.category), label: 'Category', text: plan.category.name });

  plan.issues.forEach(issue => {
    const kind = issue.quiet && !attempted ? 'hint' : issue.level;
    add({ icon: ALERT_SVG, text: issue.message, kind });
  });
}

function update() {
  if (!root) return;
  updatePicker();
  renderPreview(buildPlan());
}

// ============================================================
// SAVE / UNDO
// ============================================================

function submit({ openAfter = false } = {}) {
  if (picker) return;
  const plan = buildPlan();
  if (plan.hasErrors) {
    attempted = true;
    renderPreview(plan);
    els.dialog.classList.remove('qc-shake');
    void els.dialog.offsetWidth; // restart the animation
    els.dialog.classList.add('qc-shake');
    return;
  }

  const record = plan.mode === 'create' ? createFromPlan(plan) : updateFromPlan(plan);
  if (plan.parsed.timer) record.timer = startTimerForTask(record.taskId);

  closeQuickCapture();
  refreshTaskViews();
  const task = getTaskById(record.taskId);
  record.after = JSON.stringify(task);

  const name = truncate(task?.title || 'Untitled Task', 40);
  let message = record.created ? `Task “${name}” created` : `“${name}” updated`;
  if (record.timer && record.timer.started) {
    message += record.timer.switchedFrom
      ? ` · timer switched from “${truncate(record.timer.switchedFrom.title, 24)}”`
      : ' · timer started';
  }

  const editorOpen = !!document.querySelector('#task-editor-modal:not([hidden])');
  if (openAfter && !editorOpen) {
    hideActionToast();
    openEditTaskModal(record.taskId);
    showToast(message);
    return;
  }
  showActionToast(message, [
    { label: 'Open', run: () => { if (getTaskById(record.taskId)) openEditTaskModal(record.taskId); } },
    { label: 'Undo', run: () => undo(record) },
  ]);
}

function createFromPlan(plan) {
  const p = plan.parsed;
  // Same calls as the task editor's Save: createTask, then updateTask with the rest
  const task = createTask(p.title, p.color || 'blue', null, plan.urls[0] || null);
  const updates = { pinned: p.pinned === true };
  if (plan.category) updates.categoryId = plan.category.id;
  if (p.dueDate) updates.dueDate = p.dueDate;
  if (plan.urls.length) updates.taskLinks = plan.urls.map(value => ({ type: 'url', value }));
  updateTask(task.id, updates);
  return { taskId: task.id, created: true, before: null };
}

function updateFromPlan(plan) {
  const task = plan.target;
  const p = plan.parsed;
  const before = JSON.parse(JSON.stringify(task));
  const updates = {};
  if (p.color && p.color !== task.color) updates.color = p.color;
  if (p.pinned !== null) updates.pinned = p.pinned;
  if (plan.category) updates.categoryId = plan.category.id;
  if (p.dueDate) updates.dueDate = p.dueDate;
  else if (p.clearDate) updates.dueDate = null;
  if (plan.urls.length) {
    const links = [...linkListOf(task), ...plan.urls.map(value => ({ type: 'url', value }))];
    updates.taskLinks = links;
    const firstUrl = links.find(l => l.type === 'url');
    updates.link = firstUrl ? firstUrl.value : null;
  }
  if (p.title) {
    updates.subtasks = [...(task.subtasks || []),
      { id: generateSubtaskId(), title: p.title, description: '', completed: false, important: false }];
  }
  updateTask(task.id, updates);
  return { taskId: task.id, created: false, before };
}

function undo(record) {
  const task = getTaskById(record.taskId);
  if (!task || JSON.stringify(task) !== record.after) {
    showToast('Can’t undo: the task has changed since');
    return;
  }
  if (record.timer && record.timer.started) {
    undoTimerStart({
      taskId: record.taskId,
      start: record.timer.start,
      wholeTask: record.created,
      previousTaskId: record.timer.switchedFrom ? record.timer.switchedFrom.taskId : null,
    });
  }
  if (record.created) {
    deleteTask(record.taskId);
  } else {
    // Put the task back exactly as it was (order and highlights included)
    Object.keys(task).forEach(key => { if (!(key in record.before)) delete task[key]; });
    Object.assign(task, JSON.parse(JSON.stringify(record.before)));
    syncTaskTimeMeta(task);
    saveModel();
    if (task.projectHighlight && window.refreshProjectHighlights) window.refreshProjectHighlights();
  }
  refreshTaskViews();
  showToast(record.created ? 'Task removed' : 'Change undone');
}

// Toast with buttons (the shared #toast is text only)
function showActionToast(message, actions) {
  let toast = document.getElementById('qc-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'qc-toast';
    toast.className = 'qc-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    toast.addEventListener('mouseleave', () => {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideActionToast, 2500);
    });
    document.body.appendChild(toast);
  }
  clearTimeout(toastTimer);
  toast.textContent = '';
  const text = document.createElement('span');
  text.className = 'qc-toast-msg';
  text.textContent = message;
  toast.appendChild(text);
  actions.forEach(({ label, run }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qc-toast-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      hideActionToast();
      run();
    });
    toast.appendChild(btn);
  });
  toastVisible = true;
  toast.hidden = false;
  requestAnimationFrame(() => { if (toastVisible) toast.classList.add('show'); });
  toastTimer = setTimeout(hideActionToast, TOAST_MS);
}

function hideActionToast() {
  const toast = document.getElementById('qc-toast');
  if (!toast) return;
  toastVisible = false;
  clearTimeout(toastTimer);
  toast.classList.remove('show');
  setTimeout(() => { if (!toastVisible) toast.hidden = true; }, 220);
}

// ============================================================
// COMMAND REFERENCE (ⓘ)
// ============================================================

const KEY_ROWS = [
  [['Enter'], 'Save'],
  [['Shift', 'Enter'], 'Save, then open the task'],
  [['Esc'], 'Close (or close an open list)'],
  [['Tab'], 'Pick from an open list (Enter works too)'],
  [['Backspace'], 'At the start of the line, removes the last chip'],
];

function renderHelp() {
  const body = els.helpBody;
  if (body.childElementCount) return;

  QUICK_CAPTURE_HELP.forEach(section => {
    const block = document.createElement('section');
    block.className = 'qc-help-section';
    const heading = document.createElement('h5');
    heading.textContent = section.title;
    block.appendChild(heading);
    section.rows.forEach(row => {
      const line = document.createElement('div');
      line.className = 'qc-help-row';
      const examples = document.createElement('div');
      examples.className = 'qc-help-examples';
      row.examples.forEach(example => {
        const el = document.createElement(example.insert ? 'button' : 'span');
        el.className = 'qc-code' + (example.color ? ` task-bubble-${example.color}` : '');
        el.textContent = example.text;
        if (example.insert) {
          el.type = 'button';
          el.dataset.qcInsert = example.insert;
          el.title = `Add ${example.text}`;
        }
        examples.appendChild(el);
      });
      const meaning = document.createElement('div');
      meaning.className = 'qc-help-meaning';
      meaning.textContent = row.meaning;
      line.append(examples, meaning);
      block.appendChild(line);
    });
    body.appendChild(block);
  });

  const keys = document.createElement('section');
  keys.className = 'qc-help-section';
  const heading = document.createElement('h5');
  heading.textContent = 'Keys';
  keys.appendChild(heading);
  KEY_ROWS.forEach(([combo, meaning]) => {
    const line = document.createElement('div');
    line.className = 'qc-help-row';
    const examples = document.createElement('div');
    examples.className = 'qc-help-examples';
    combo.forEach((key, i) => {
      if (i) examples.append(' + ');
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      examples.appendChild(kbd);
    });
    const text = document.createElement('div');
    text.className = 'qc-help-meaning';
    text.textContent = meaning;
    line.append(examples, text);
    keys.appendChild(line);
  });
  body.appendChild(keys);

  const foot = document.createElement('p');
  foot.className = 'qc-help-foot';
  foot.textContent = 'Click a command to add it to your line. Commands can go anywhere in the line.';
  body.appendChild(foot);
}

function openHelp() {
  ensureDom();
  renderHelp();
  els.help.hidden = false;
  els.helpBody.scrollTop = 0;
  els.helpClose.focus();
}

function closeHelp() {
  if (!els.help || els.help.hidden) return;
  els.help.hidden = true;
  els.input.focus();
}
