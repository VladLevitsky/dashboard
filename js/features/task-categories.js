// Personal Dashboard - Task Categories
// Category helpers (task.categoryId → { id, name, slot }) and the Task Settings
// modal (edit mode → Settings → Tasks): categories and subtask templates.
// Both are settings: read from and saved straight to `model` (like the theme),
// never the edit-mode working copy. Each category owns a chart color slot, so
// its color never changes when others are added or removed.

import { model, currentData, normalizeTaskCategories } from '../state.js';
import { $, showToast } from '../utils.js';
import { MAX_TASK_CATEGORIES } from '../constants.js';
import { saveModel } from '../core/storage.js';

// --- Helpers

export function getTaskCategories() {
  if (!Array.isArray(model.taskCategories)) {
    model.taskCategories = normalizeTaskCategories(model.taskCategories);
  }
  return model.taskCategories;
}

export function getTaskCategory(categoryId) {
  if (!categoryId) return null;
  return getTaskCategories().find(c => c.id === categoryId) || null;
}

// CSS color for a category's swatch/slice (light/dark values live in styles.css)
export function categoryColor(category) {
  return category ? `var(--task-cat-${category.slot})` : 'var(--task-cat-none)';
}

function generateCategoryId() {
  return 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function lowestFreeSlot(categories) {
  const used = new Set(categories.map(c => c.slot));
  for (let slot = 1; slot <= MAX_TASK_CATEGORIES; slot++) {
    if (!used.has(slot)) return slot;
  }
  return 0;
}

// --- Task Settings modal

let draftCategories = null;
let draftTemplates = null;
let initialDraftJson = '';

function draftJson() {
  return JSON.stringify({ categories: draftCategories, templates: draftTemplates });
}

const TRASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const CHEVRON_SVG = `<svg class="task-settings-tpl-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg>`;
const GRIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
const X_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const PLUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;

function getTaskSettingsModal() {
  let modal = $('#task-settings-modal');
  if (modal) return modal;

  // Reuses the Settings modal's classes so it shares the Settings look (and glass styling)
  modal = document.createElement('div');
  modal.id = 'task-settings-modal';
  modal.className = 'appearance-modal task-settings-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="appearance-backdrop"></div>
    <div class="appearance-dialog task-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="task-settings-title">
      <div class="appearance-header">
        <h4 id="task-settings-title">Task Settings</h4>
        <button type="button" class="appearance-close-btn" id="task-settings-close" title="Close" aria-label="Close">&times;</button>
      </div>
      <div class="appearance-body task-settings-body">
        <div class="task-settings-columns">
          <div class="appearance-section task-settings-col task-settings-col-tpl">
            <div class="appearance-label">Subtask templates</div>
            <div class="task-settings-tpl-list" id="task-settings-tpl-list"></div>
            <p class="task-settings-hint task-settings-tpl-hint" id="task-settings-tpl-hint"></p>
          </div>
          <div class="appearance-section task-settings-col task-settings-col-cats">
            <div class="appearance-label">Categories</div>
            <div class="task-settings-cat-list" id="task-settings-cat-list"></div>
            <form class="task-settings-add-row" id="task-settings-add-form">
              <input type="text" id="task-settings-add-input" class="task-settings-input" maxlength="40" placeholder="New category" aria-label="New category name" autocomplete="off" />
              <button type="submit" id="task-settings-add-btn" class="appearance-backup-btn task-settings-add-btn">Add</button>
            </form>
            <p class="task-settings-hint" id="task-settings-hint"></p>
          </div>
        </div>
      </div>
      <div class="appearance-actions">
        <button type="button" id="task-settings-cancel" class="appearance-btn secondary">Cancel</button>
        <button type="button" id="task-settings-save" class="appearance-btn primary">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.appearance-backdrop').addEventListener('click', () => closeTaskSettingsModal());
  $('#task-settings-close').addEventListener('click', () => closeTaskSettingsModal());
  $('#task-settings-cancel').addEventListener('click', () => closeTaskSettingsModal());
  $('#task-settings-save').addEventListener('click', saveTaskSettings);
  $('#task-settings-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addDraftCategory();
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeTaskSettingsModal();
    }
  });
  return modal;
}

export function openTaskSettingsModal() {
  const modal = getTaskSettingsModal();
  draftCategories = getTaskCategories().map(c => ({ ...c }));
  draftTemplates = cloneTemplates(model.subtaskTemplates);
  initialDraftJson = draftJson();
  $('#task-settings-add-input').value = '';
  renderDraftCategories();
  renderDraftTemplates();
  modal.hidden = false;
  $('#task-settings-add-input').focus();
}

function closeTaskSettingsModal(force = false) {
  const modal = $('#task-settings-modal');
  if (!modal || modal.hidden) return;
  if (!force && draftCategories && draftJson() !== initialDraftJson) {
    if (!confirm('Discard your changes to task settings?')) return;
  }
  modal.hidden = true;
  draftCategories = null;
  draftTemplates = null;
}

function renderDraftCategories() {
  const list = $('#task-settings-cat-list');
  list.innerHTML = '';

  if (draftCategories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'task-settings-empty';
    empty.textContent = 'No categories yet.';
    list.appendChild(empty);
  }

  draftCategories.forEach((category, index) => {
    const row = document.createElement('div');
    row.className = 'task-settings-cat-row';

    const swatch = document.createElement('span');
    swatch.className = 'task-settings-swatch';
    swatch.style.background = categoryColor(category);
    swatch.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-settings-input';
    input.maxLength = 40;
    input.value = category.name;
    input.setAttribute('aria-label', 'Category name');
    input.addEventListener('input', () => { category.name = input.value; });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'task-settings-delete-btn';
    deleteBtn.title = `Delete “${category.name}”`;
    deleteBtn.setAttribute('aria-label', deleteBtn.title);
    deleteBtn.innerHTML = TRASH_SVG;
    deleteBtn.addEventListener('click', () => {
      draftCategories.splice(index, 1);
      renderDraftCategories();
    });

    row.append(swatch, input, deleteBtn);
    list.appendChild(row);
  });

  const full = draftCategories.length >= MAX_TASK_CATEGORIES;
  $('#task-settings-add-input').disabled = full;
  $('#task-settings-add-btn').disabled = full;
  $('#task-settings-hint').textContent = full
    ? `That's the maximum of ${MAX_TASK_CATEGORIES} categories. Delete one to add another.`
    : `Up to ${MAX_TASK_CATEGORIES} categories. Colors are assigned automatically and match the time tracking chart.`;
}

function addDraftCategory() {
  const input = $('#task-settings-add-input');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  if (draftCategories.length >= MAX_TASK_CATEGORIES) return;
  if (draftCategories.some(c => c.name.trim().toLowerCase() === name.toLowerCase())) {
    showToast(`“${name}” already exists`);
    input.select();
    return;
  }
  draftCategories.push({ id: generateCategoryId(), name, slot: lowestFreeSlot(draftCategories) });
  input.value = '';
  renderDraftCategories();
  input.focus();
}

function saveTaskSettings() {
  // A name typed into the add field but not added yet still counts
  if ($('#task-settings-add-input').value.trim()) addDraftCategory();

  const names = draftCategories.map(c => c.name.trim());
  if (names.some(n => !n)) {
    showToast('Category names can’t be empty');
    return;
  }
  const lower = names.map(n => n.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    showToast('Two categories have the same name');
    return;
  }

  // Templates: blank subtask lines are dropped; a name and one subtask are required
  const templates = draftTemplates.map(t => ({
    ...t,
    name: t.name.trim(),
    items: t.items.map(i => ({ ...i, title: i.title.trim() })).filter(i => i.title)
  }));
  const unnamed = templates.findIndex(t => !t.name);
  if (unnamed >= 0) {
    showToast('Template names can’t be empty');
    revealTemplate(unnamed, 'name');
    return;
  }
  const empty = templates.findIndex(t => t.items.length === 0);
  if (empty >= 0) {
    showToast(`“${templates[empty].name}” needs at least one subtask`);
    revealTemplate(empty, 'items');
    return;
  }

  // Deleted categories that tasks still use: their tasks become Uncategorized
  const keptIds = new Set(draftCategories.map(c => c.id));
  const removed = getTaskCategories().filter(c => !keptIds.has(c.id));
  if (removed.length > 0) {
    const data = currentData();
    const removedIds = new Set(removed.map(c => c.id));
    const inUse = [...(data.tasks || []), ...(data.completedTasks || [])]
      .filter(t => t.categoryId && removedIds.has(t.categoryId)).length;
    if (inUse > 0) {
      const names = removed.map(c => `“${c.name}”`).join(', ');
      const msg = inUse === 1
        ? `1 task uses ${names}. It'll become Uncategorized, including its tracked time.\n\nSave anyway?`
        : `${inUse} tasks use ${names}. They'll become Uncategorized, including their tracked time.\n\nSave anyway?`;
      if (!confirm(msg)) return;
    }
  }

  model.taskCategories = normalizeTaskCategories(draftCategories.map(c => ({ ...c, name: c.name.trim() })));
  model.subtaskTemplates = templates;
  saveModel();
  closeTaskSettingsModal(true);
  showToast('Task settings saved');
  if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();
}

// --- Subtask templates section
// A template ({ id, name, items: [{ title }] }) is saved from the task editor's
// save icon and applied by holding the + under Subtasks (tasks.js). Here: pick
// one to open it, rename it, edit / add / remove / reorder its subtasks, or
// delete it. Everything stays in the draft until Save.

function cloneTemplates(list) {
  return (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object').map(t => ({
    ...t,
    name: typeof t.name === 'string' ? t.name : '',
    items: (Array.isArray(t.items) ? t.items : [])
      .filter(i => i && typeof i === 'object')
      .map(i => ({ ...i, title: typeof i.title === 'string' ? i.title : '' }))
  }));
}

function subtaskCountLabel(tpl) {
  const n = tpl.items.filter(i => i.title.trim()).length;
  return n === 1 ? '1 subtask' : `${n} subtasks`;
}

function renderDraftTemplates(openIndex = -1) {
  const list = $('#task-settings-tpl-list');
  list.innerHTML = '';
  draftTemplates.forEach((tpl, index) => list.appendChild(buildTemplateRow(tpl, index === openIndex)));
  $('#task-settings-tpl-hint').textContent = draftTemplates.length
    ? 'Click a template to edit it. To use one, press and hold the + under Subtasks in the task editor.'
    : 'No templates yet. In the task editor, add subtasks, then click the save icon beside the + to keep them as a template.';
}

function setTemplateOpen(wrap, open) {
  wrap.classList.toggle('is-open', open);
  wrap.querySelector('.task-settings-tpl-toggle').setAttribute('aria-expanded', String(open));
  wrap.querySelector('.task-settings-tpl-body').hidden = !open;
}

// Open one template (closing the others) and focus the field that needs fixing
function revealTemplate(index, field) {
  const list = $('#task-settings-tpl-list');
  const wrap = list.children[index];
  if (!wrap) return;
  [...list.children].forEach(w => setTemplateOpen(w, w === wrap));
  const target = field === 'name'
    ? wrap.querySelector('.task-settings-tpl-name-input')
    : wrap.querySelector('.task-settings-tpl-item input') || wrap.querySelector('.task-settings-tpl-add');
  if (target) target.focus();
  wrap.scrollIntoView({ block: 'nearest' });
}

function buildTemplateRow(tpl, open) {
  const wrap = document.createElement('div');
  wrap.className = 'task-settings-tpl';

  const head = document.createElement('div');
  head.className = 'task-settings-tpl-head';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'task-settings-tpl-toggle';
  toggle.innerHTML = CHEVRON_SVG;
  const nameEl = document.createElement('span');
  nameEl.className = 'task-settings-tpl-name';
  const countEl = document.createElement('span');
  countEl.className = 'task-settings-tpl-count';
  toggle.append(nameEl, countEl);
  toggle.addEventListener('click', () => {
    const opening = !wrap.classList.contains('is-open');
    [...wrap.parentNode.children].forEach(w => setTemplateOpen(w, opening && w === wrap));
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'task-settings-delete-btn';
  deleteBtn.innerHTML = TRASH_SVG;
  deleteBtn.addEventListener('click', () => {
    // Keep whichever other template is open
    const rows = [...wrap.parentNode.children];
    const openRow = rows.find(w => w.classList.contains('is-open') && w !== wrap);
    const keepOpen = openRow ? draftTemplates[rows.indexOf(openRow)] : null;
    draftTemplates = draftTemplates.filter(t => t !== tpl);
    renderDraftTemplates(keepOpen ? draftTemplates.indexOf(keepOpen) : -1);
  });

  head.append(toggle, deleteBtn);

  const body = document.createElement('div');
  body.className = 'task-settings-tpl-body';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'task-settings-input task-settings-tpl-name-input';
  nameInput.maxLength = 60;
  nameInput.value = tpl.name;
  nameInput.placeholder = 'Template name';
  nameInput.setAttribute('aria-label', 'Template name');
  nameInput.autocomplete = 'off';

  const items = document.createElement('div');
  items.className = 'task-settings-tpl-items';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'task-settings-tpl-add';
  addBtn.innerHTML = `${PLUS_SVG}<span>Add subtask</span>`;

  // Head labels follow the draft; written only when they change (typing path)
  const refreshHead = () => {
    const name = tpl.name.trim() || 'Untitled template';
    if (nameEl.textContent !== name) nameEl.textContent = name;
    nameEl.classList.toggle('is-untitled', !tpl.name.trim());
    const count = subtaskCountLabel(tpl);
    if (countEl.textContent !== count) countEl.textContent = count;
    const title = `Delete template “${name}”`;
    if (deleteBtn.title !== title) {
      deleteBtn.title = title;
      deleteBtn.setAttribute('aria-label', title);
    }
  };

  nameInput.addEventListener('input', () => {
    tpl.name = nameInput.value;
    refreshHead();
  });
  addBtn.addEventListener('click', () => {
    tpl.items.push({ title: '' });
    renderTemplateItems(tpl, items, refreshHead, tpl.items.length - 1);
  });

  body.append(nameInput, items, addBtn);
  wrap.append(head, body);
  renderTemplateItems(tpl, items, refreshHead);
  refreshHead();
  setTemplateOpen(wrap, open);
  return wrap;
}

function renderTemplateItems(tpl, itemsEl, onChange, focusIndex = -1) {
  itemsEl.innerHTML = '';
  tpl.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'task-settings-tpl-item';
    row.dataset.index = String(index);

    const grip = document.createElement('span');
    grip.className = 'task-settings-tpl-grip';
    grip.title = 'Drag to reorder';
    grip.innerHTML = GRIP_SVG;
    grip.addEventListener('pointerdown', (e) => startItemDrag(e, row, tpl, itemsEl, onChange));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-settings-input';
    input.value = item.title;
    input.placeholder = 'Subtask';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Subtask ${index + 1}`);
    input.addEventListener('input', () => {
      item.title = input.value;
      onChange();
    });
    input.addEventListener('keydown', (e) => onItemKeydown(e, tpl, index, itemsEl, onChange));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-settings-tpl-item-remove';
    remove.title = 'Remove subtask';
    remove.setAttribute('aria-label', 'Remove subtask');
    remove.innerHTML = X_SVG;
    remove.addEventListener('click', () => {
      tpl.items.splice(index, 1);
      renderTemplateItems(tpl, itemsEl, onChange);
      onChange();
    });

    row.append(grip, input, remove);
    itemsEl.appendChild(row);
  });

  const focusRow = focusIndex >= 0 ? itemsEl.children[focusIndex] : null;
  if (focusRow) {
    const input = focusRow.querySelector('input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

// Enter = new subtask below · Backspace on an empty one = remove it ·
// Alt+Shift+↑/↓ = move it (the writing engine's move-block keys)
function onItemKeydown(e, tpl, index, itemsEl, onChange) {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    tpl.items.splice(index + 1, 0, { title: '' });
    renderTemplateItems(tpl, itemsEl, onChange, index + 1);
  } else if (e.key === 'Backspace' && e.target.value === '' && tpl.items.length > 1) {
    e.preventDefault();
    tpl.items.splice(index, 1);
    renderTemplateItems(tpl, itemsEl, onChange, Math.max(0, index - 1));
    onChange();
  } else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= tpl.items.length) return;
    e.preventDefault();
    const [moved] = tpl.items.splice(index, 1);
    tpl.items.splice(to, 0, moved);
    renderTemplateItems(tpl, itemsEl, onChange, to);
  }
}

// Drag a subtask by its grip: the row moves live between its neighbours,
// the draft order is read back from the DOM on release. Listens on window,
// not pointer capture: moving the row in the DOM releases a capture.
function startItemDrag(e, row, tpl, itemsEl, onChange) {
  if (e.button !== 0) return;
  e.preventDefault();
  const pointerId = e.pointerId;
  row.classList.add('is-dragging');
  itemsEl.classList.add('is-sorting');

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const others = [...itemsEl.children].filter(r => r !== row);
    const before = others.find(r => {
      const box = r.getBoundingClientRect();
      return ev.clientY < box.top + box.height / 2;
    }) || null;
    const inPlace = before ? row.nextElementSibling === before : itemsEl.lastElementChild === row;
    if (!inPlace) itemsEl.insertBefore(row, before);
  };
  const onEnd = (ev) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    itemsEl.classList.remove('is-sorting');
    const order = [...itemsEl.children].map(r => tpl.items[Number(r.dataset.index)]);
    tpl.items.splice(0, tpl.items.length, ...order);
    renderTemplateItems(tpl, itemsEl, onChange);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}
