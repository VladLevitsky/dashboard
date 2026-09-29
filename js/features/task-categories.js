// Personal Dashboard - Task Categories
// Category helpers (task.categoryId → { id, name, slot }) and the Task Settings
// modal (edit mode → Settings → Tasks). Categories are a setting: they are read
// from and saved straight to `model` (like the theme), never the edit-mode
// working copy. Each category owns a chart color slot, so its color never
// changes when others are added or removed.

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
let initialDraftJson = '';

const TRASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

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
      <div class="appearance-body">
        <div class="appearance-section">
          <div class="appearance-label">Categories</div>
          <div class="task-settings-cat-list" id="task-settings-cat-list"></div>
          <form class="task-settings-add-row" id="task-settings-add-form">
            <input type="text" id="task-settings-add-input" class="task-settings-input" maxlength="40" placeholder="New category" aria-label="New category name" autocomplete="off" />
            <button type="submit" id="task-settings-add-btn" class="appearance-backup-btn task-settings-add-btn">Add</button>
          </form>
          <p class="task-settings-hint" id="task-settings-hint"></p>
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
  initialDraftJson = JSON.stringify(draftCategories);
  $('#task-settings-add-input').value = '';
  renderDraftCategories();
  modal.hidden = false;
  $('#task-settings-add-input').focus();
}

function closeTaskSettingsModal(force = false) {
  const modal = $('#task-settings-modal');
  if (!modal || modal.hidden) return;
  if (!force && draftCategories && JSON.stringify(draftCategories) !== initialDraftJson) {
    if (!confirm('Discard your changes to task categories?')) return;
  }
  modal.hidden = true;
  draftCategories = null;
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
  saveModel();
  closeTaskSettingsModal(true);
  showToast('Task settings saved');
  if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();
}
