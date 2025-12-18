// Personal Dashboard - Edit Mode Module
// Handles edit state toggling, popovers, and edit-related UI

import { model, editState, currentData } from '../state.js';
import { $, deepClone, showToast, getColorForCurrentMode, setColorForCurrentMode } from '../utils.js';
import { saveModel } from '../core/storage.js';

// --- Toggle Edit Mode
export function toggleEditMode() {
  if (!editState.enabled) {
    editState.enabled = true;
    editState.working = deepClone(model);

    // Ensure reminders structure is properly maintained in working data
    if (editState.working.reminders && typeof editState.working.reminders === 'object') {
      Object.keys(editState.working.reminders).forEach(subtitle => {
        if (!Array.isArray(editState.working.reminders[subtitle])) {
          editState.working.reminders[subtitle] = [];
        }
      });
    }

    editState.dirty = false;
  } else {
    // Exiting edit mode - just discard working copy
    editState.enabled = false;
    editState.working = null;
    editState.dirty = false;
    // Remove drag handlers when exiting edit mode
    if (window.removeDragHandlers) window.removeDragHandlers();
  }

  $('#edit-toggle').classList.toggle('active', editState.enabled);
  if (window.refreshEditingClasses) window.refreshEditingClasses();
  $('#edit-fab-group').hidden = !editState.enabled;
  $('#dark-mode-toggle').hidden = !editState.enabled;

  $('#override-links').hidden = !editState.enabled;
  $('#import-links').hidden = !editState.enabled;
  if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();

  if (!editState.enabled) {
    hideEditPopover();
    hideCalendarPopover();
  }

  // Close any open reminder and list item link bubbles when toggling edit mode
  if (window.closeAllReminderLinks) window.closeAllReminderLinks();
  if (window.closeAllListItemLinks) window.closeAllListItemLinks();

  if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
  if (window.renderAllSections) window.renderAllSections();

  if (editState.enabled) {
    if (window.addCardButtons) window.addCardButtons();
  }

  // Re-render timers if the time tracking card is visible
  const timeCard = $('#time-tracking-card');
  if (timeCard && !timeCard.hidden) {
    if (window.renderTimers) window.renderTimers();
  }

  if (window.refreshEditingClasses) window.refreshEditingClasses();
}

// --- Hide Edit Popover
export function hideEditPopover() {
  $('#edit-popover').hidden = true;
  editState.currentTarget = null;
}

// --- Hide Calendar Popover
export function hideCalendarPopover() {
  $('#calendar-popover').hidden = true;
  editState.currentCalendarTarget = null;
}

// --- Hide Interval Popover
export function hideIntervalPopover() {
  const pop = $('#interval-popover');
  if (pop) pop.hidden = true;
}

// --- Open Edit Popover
export function openEditPopover(targetEl, values, onDone) {
  const pop = $('#edit-popover');
  const rect = targetEl.getBoundingClientRect();
  $('#edit-text').value = values.text || '';
  $('#edit-url').value = values.url || '';
  const hideText = values.hideText === true || !('text' in values);
  const textField = $('.field-text');
  const textInput = $('#edit-text');
  if (hideText) {
    textField.hidden = true;
    textField.style.display = 'none';
    if (textInput) { textInput.disabled = true; textInput.value = ''; }
  } else {
    textField.hidden = false;
    textField.style.display = '';
    if (textInput) { textInput.disabled = false; }
  }
  const urlField = $('.field-url');
  const hideUrl = values.hideUrl === true;
  urlField.hidden = hideUrl;
  urlField.style.display = hideUrl ? 'none' : '';
  $('#edit-image-field').hidden = values.allowImage ? false : true;
  $('#chosen-image-name').textContent = '';
  editState.chosenMedia = null;

  // Delete button shows if allowed
  const delBtn = $('#edit-delete');
  const canDelete = values.allowDelete === true;
  delBtn.hidden = !canDelete;
  delBtn.onclick = () => {
    if (!editState.currentTarget) return;
    editState.currentTarget.onDone({ delete: true, accept: true });
    hideEditPopover();
  };

  // Make visible to measure height, then position
  pop.hidden = false;
  const popWidth = pop.offsetWidth || 320;
  const popHeight = pop.offsetHeight || 260;
  const margin = 12;

  // Horizontal positioning: check if element is on the right side of the screen
  const spaceOnRight = window.innerWidth - rect.right;
  const spaceOnLeft = rect.left;

  // Reset both left and right before setting new position
  pop.style.left = '';
  pop.style.right = '';

  if (spaceOnRight >= popWidth + margin) {
    pop.style.left = `${rect.right + margin}px`;
  } else if (spaceOnLeft >= popWidth + margin) {
    pop.style.left = `${rect.left - popWidth - margin}px`;
  } else {
    pop.style.right = `${Math.max(20, margin)}px`;
  }

  // Decide whether to show below or above based on available space
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  if (spaceBelow >= popHeight || spaceBelow >= spaceAbove) {
    pop.style.bottom = 'auto';
    const top = Math.min(window.innerHeight - popHeight - margin, rect.bottom + margin);
    pop.style.top = `${Math.max(margin, top)}px`;
  } else {
    pop.style.top = 'auto';
    const bottom = Math.max(84, window.innerHeight - rect.top + margin);
    pop.style.bottom = `${bottom}px`;
  }
  editState.currentTarget = { targetEl, onDone, config: values };
}

// --- Apply Dark Mode
export function applyDarkMode() {
  const isDark = model.darkMode;
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const btn = $('#dark-mode-toggle');
  if (btn) {
    btn.classList.toggle('active', isDark);
  }
}

// --- Toggle Dark Mode
export function toggleDarkMode() {
  model.darkMode = !model.darkMode;
  // Also update working copy if in edit mode
  if (editState.working) {
    editState.working.darkMode = model.darkMode;
  }
  applyDarkMode();
  saveModel();

  // Re-render sections to update colors for the new theme
  if (window.renderAllSections) {
    window.renderAllSections();
  }

  // Re-add card buttons if in edit mode (after re-render)
  if (editState.enabled) {
    if (window.addCardButtons) window.addCardButtons();
    if (window.refreshEditingClasses) window.refreshEditingClasses();
  }

  // Update timer displays immediately to reflect new theme
  if (window.timerInterval && model.timeTrackingExpanded) {
    if (window.updateTimerDisplay) window.updateTimerDisplay();
  }
}

// --- Refresh Editing Classes on elements
export function refreshEditingClasses() {
  document.querySelectorAll('.card').forEach(card => {
    card.classList.toggle('editing', editState.enabled);
  });
  document.querySelectorAll('.editable').forEach(el => {
    el.classList.toggle('editing', editState.enabled);
  });
}

// --- Mark dirty and save (for edit operations)
export function markDirtyAndSave() {
  editState.dirty = true;

  // If NOT in edit mode, save immediately (for backwards compatibility)
  if (!editState.enabled) {
    saveModel();
  }
}

// --- Confirm Global Edit (accept changes)
export function confirmGlobalEdit() {
  if (!editState.working) return;

  // Deep merge working copy back to model
  if (window.deepMergeModel) {
    window.deepMergeModel(model, editState.working);
  }

  saveModel();
  editState.dirty = false;
  toggleEditMode();
  showToast('Changes saved');
}

// --- Cancel Global Edit (discard changes)
export function cancelGlobalEdit() {
  editState.dirty = false;
  toggleEditMode();
  showToast('Changes discarded');
}

// --- Open Color Picker for section bubbles
export function openColorPicker(sectionId, sectionType) {
  const data = currentData();

  // Initialize sectionColors if it doesn't exist
  if (!data.sectionColors) {
    data.sectionColors = {};
  }

  const defaultColorLight = sectionType === 'tools' ? '#e6fff3' : '#fff4e5';
  const defaultColorDark = sectionType === 'tools' ? '#1e3a3a' : '#334155';
  const currentColor = getColorForCurrentMode(data.sectionColors[sectionId], defaultColorLight, defaultColorDark);
  const modeLabel = model.darkMode ? 'Dark Mode' : 'Light Mode';

  // Create color picker modal
  const modal = document.createElement('div');
  modal.className = 'color-picker-modal';
  modal.innerHTML = `
    <div class="color-picker-dialog">
      <h3>Choose Bubble Color</h3>
      <p class="color-picker-mode-label">Setting color for: <strong>${modeLabel}</strong></p>
      <div class="color-picker-content">
        <input type="color" id="color-input" value="${currentColor}">
        <div class="color-presets">
          <button type="button" class="color-preset" data-color="#fff4e5" style="background: #fff4e5;" title="Default Yellow"></button>
          <button type="button" class="color-preset" data-color="#e6fff3" style="background: #e6fff3;" title="Default Green"></button>
          <button type="button" class="color-preset" data-color="#ffe6f0" style="background: #ffe6f0;" title="Pink"></button>
          <button type="button" class="color-preset" data-color="#e6f3ff" style="background: #e6f3ff;" title="Blue"></button>
          <button type="button" class="color-preset" data-color="#f3e6ff" style="background: #f3e6ff;" title="Purple"></button>
          <button type="button" class="color-preset" data-color="#fff6e6" style="background: #fff6e6;" title="Orange"></button>
          <button type="button" class="color-preset" data-color="#e6ffe6" style="background: #e6ffe6;" title="Mint"></button>
          <button type="button" class="color-preset" data-color="#ffe6e6" style="background: #ffe6e6;" title="Red"></button>
        </div>
      </div>
      <div class="color-picker-actions">
        <button type="button" id="color-picker-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="color-picker-apply" class="btn-primary">Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Handle preset clicks
  modal.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      $('#color-input').value = color;
    });
  });

  // Handle cancel
  $('#color-picker-cancel').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // Handle apply
  $('#color-picker-apply').addEventListener('click', () => {
    const selectedColor = $('#color-input').value;

    // Store color for current mode
    data.sectionColors[sectionId] = setColorForCurrentMode(
      data.sectionColors[sectionId],
      selectedColor
    );

    markDirtyAndSave();
    document.body.removeChild(modal);

    // Re-render to show new color
    if (window.renderAllSections) window.renderAllSections();
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

// --- Open Subtitle Color Picker
export function openSubtitleColorPicker(sectionId, subtitle) {
  const data = currentData();

  // Initialize subtitleColors if it doesn't exist
  if (!data.subtitleColors) {
    data.subtitleColors = {};
  }

  const colorKey = `${sectionId}:${subtitle}`;
  const defaultColorLight = '#f7fafc';
  const defaultColorDark = '#334155';
  const currentColor = getColorForCurrentMode(data.subtitleColors[colorKey], defaultColorLight, defaultColorDark);
  const modeLabel = model.darkMode ? 'Dark Mode' : 'Light Mode';

  // Create color picker modal
  const modal = document.createElement('div');
  modal.className = 'color-picker-modal';
  modal.innerHTML = `
    <div class="color-picker-dialog">
      <h3>Choose Subtitle Color</h3>
      <p class="color-picker-mode-label">Setting color for: <strong>${modeLabel}</strong></p>
      <p class="color-picker-subtitle-label">Subtitle: <strong>${subtitle}</strong></p>
      <div class="color-picker-content">
        <input type="color" id="color-input" value="${currentColor}">
        <div class="color-presets">
          <button type="button" class="color-preset" data-color="#f7fafc" style="background: #f7fafc;" title="Default Gray"></button>
          <button type="button" class="color-preset" data-color="#fff4e5" style="background: #fff4e5;" title="Yellow"></button>
          <button type="button" class="color-preset" data-color="#e6fff3" style="background: #e6fff3;" title="Green"></button>
          <button type="button" class="color-preset" data-color="#ffe6f0" style="background: #ffe6f0;" title="Pink"></button>
          <button type="button" class="color-preset" data-color="#e6f3ff" style="background: #e6f3ff;" title="Blue"></button>
          <button type="button" class="color-preset" data-color="#f3e6ff" style="background: #f3e6ff;" title="Purple"></button>
          <button type="button" class="color-preset" data-color="#fff6e6" style="background: #fff6e6;" title="Orange"></button>
          <button type="button" class="color-preset" data-color="#ffe6e6" style="background: #ffe6e6;" title="Red"></button>
        </div>
      </div>
      <div class="color-picker-actions">
        <button type="button" id="color-picker-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="color-picker-apply" class="btn-primary">Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Handle preset clicks
  modal.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      $('#color-input').value = color;
    });
  });

  // Handle cancel
  $('#color-picker-cancel').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // Handle apply
  $('#color-picker-apply').addEventListener('click', () => {
    const selectedColor = $('#color-input').value;

    // Store color for current mode
    data.subtitleColors[colorKey] = setColorForCurrentMode(
      data.subtitleColors[colorKey],
      selectedColor
    );

    markDirtyAndSave();
    document.body.removeChild(modal);

    // Re-render to show new color
    if (window.renderAllSections) window.renderAllSections();
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}
