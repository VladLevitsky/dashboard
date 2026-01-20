// Personal Dashboard - Edit Mode Module
// Handles edit state toggling, popovers, and edit-related UI

import { model, editState, currentData, currentSections } from '../state.js';
import { $, deepClone, showToast, getColorForCurrentMode, setColorForCurrentMode } from '../utils.js';
import { saveModel } from '../core/storage.js';

// --- Toggle Edit Mode
export function toggleEditMode() {
  // Find the card closest to the center of the viewport to restore position after render
  const viewportCenter = window.scrollY + window.innerHeight / 2;
  let closestCard = null;
  let closestDistance = Infinity;

  document.querySelectorAll('.card, .two-col').forEach(card => {
    const rect = card.getBoundingClientRect();
    const cardCenter = window.scrollY + rect.top + rect.height / 2;
    const distance = Math.abs(cardCenter - viewportCenter);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestCard = card;
    }
  });

  // Get the card's ID to find it again after re-render
  const targetCardId = closestCard?.id || closestCard?.querySelector('.card')?.id;

  if (!editState.enabled) {
    editState.enabled = true;
    editState.working = deepClone(model);

    // Note: Legacy code to "ensure reminders structure" was removed here.
    // With unified cards (schemaVersion 3), section data like model["reminders"]
    // stores { subtitle: { icons: [], reminders: [], subtasks: [], copyPaste: [] }, ... }
    // The old code incorrectly converted these objects to empty arrays.

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
  $('#appearance-toggle').hidden = !editState.enabled;

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

  // Scroll the same card back into view after rendering
  if (targetCardId) {
    const targetCard = document.getElementById(targetCardId);
    if (targetCard) {
      // Scroll the card to roughly the same viewport position (center)
      targetCard.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
}

// --- Hide Edit Popover
export function hideEditPopover() {
  $('#edit-popover').hidden = true;
  editState.currentTarget = null;
  currentMoveContext = null;
  const moveSelector = $('#move-card-selector');
  if (moveSelector) moveSelector.hidden = true;
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

// --- Move context for edit popover (stores source info for moving items)
let currentMoveContext = null;

// --- Open Edit Popover
// cursorPos is optional: { x: clientX, y: clientY } - if provided, positions near cursor
// values.moveContext is optional: { sectionId, subtitle, itemType, itemKey } - if provided, enables move button
export function openEditPopover(targetEl, values, onDone, cursorPos) {
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
  const copyTextField = $('.field-copytext');
  const copyTextarea = $('#edit-copytext');
  const useCopyText = values.useCopyText === true;
  const hideUrl = values.hideUrl === true || useCopyText;

  // Show either URL field or Copy Text textarea
  urlField.hidden = hideUrl;
  urlField.style.display = hideUrl ? 'none' : '';

  if (copyTextField && copyTextarea) {
    copyTextField.hidden = !useCopyText;
    copyTextField.style.display = useCopyText ? '' : 'none';
    copyTextarea.value = useCopyText ? (values.copyText || '') : '';
  }

  $('#edit-image-field').hidden = values.allowImage ? false : true;
  $('#chosen-image-name').textContent = '';
  editState.chosenMedia = null;
  editState.chosenEmoji = null;
  // Hide emoji picker when opening popover
  const emojiContainer = $('#emoji-picker-container');
  if (emojiContainer) emojiContainer.hidden = true;

  // Delete button shows if allowed
  const delBtn = $('#edit-delete');
  const canDelete = values.allowDelete === true;
  delBtn.hidden = !canDelete;
  delBtn.onclick = () => {
    if (!editState.currentTarget) return;
    editState.currentTarget.onDone({ delete: true, accept: true });
    hideEditPopover();
  };

  // Move button shows if moveContext is provided
  const moveBtn = $('#edit-move');
  const moveSelector = $('#move-card-selector');
  currentMoveContext = values.moveContext || null;
  moveBtn.hidden = !currentMoveContext;
  if (moveSelector) moveSelector.hidden = true; // Always start with selector hidden

  // Make visible to measure height, then position
  pop.hidden = false;
  const popWidth = pop.offsetWidth || 320;
  const popHeight = pop.offsetHeight || 260;
  const margin = 12;

  // Get scroll offsets for absolute positioning
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  // Reset positioning
  pop.style.left = '';
  pop.style.right = '';
  pop.style.bottom = 'auto';

  let leftPos, topPos;

  if (cursorPos) {
    // Position near cursor, respecting viewport boundaries
    const cursorX = cursorPos.x;
    const cursorY = cursorPos.y;

    // Horizontal: try to position to the right of cursor, then left, then clamp
    const spaceOnRight = window.innerWidth - cursorX;
    const spaceOnLeft = cursorX;

    if (spaceOnRight >= popWidth + margin) {
      leftPos = cursorX + margin + scrollX;
    } else if (spaceOnLeft >= popWidth + margin) {
      leftPos = cursorX - popWidth - margin + scrollX;
    } else {
      // Clamp to viewport
      leftPos = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, cursorX - popWidth / 2)) + scrollX;
    }

    // Vertical: try to position below cursor, then above, then clamp
    const spaceBelow = window.innerHeight - cursorY;
    const spaceAbove = cursorY;

    if (spaceBelow >= popHeight + margin) {
      topPos = cursorY + margin + scrollY;
    } else if (spaceAbove >= popHeight + margin) {
      topPos = cursorY - popHeight - margin + scrollY;
    } else {
      // Clamp to viewport
      topPos = Math.max(margin, Math.min(window.innerHeight - popHeight - margin, cursorY - popHeight / 2)) + scrollY;
    }
  } else {
    // Fallback: position relative to element (original behavior)
    const spaceOnRight = window.innerWidth - rect.right;
    const spaceOnLeft = rect.left;

    if (spaceOnRight >= popWidth + margin) {
      leftPos = rect.right + margin + scrollX;
    } else if (spaceOnLeft >= popWidth + margin) {
      leftPos = rect.left - popWidth - margin + scrollX;
    } else {
      leftPos = Math.max(margin, window.innerWidth - popWidth - margin) + scrollX;
    }

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;

    if (spaceBelow >= popHeight || spaceBelow >= spaceAbove) {
      topPos = Math.min(window.innerHeight - popHeight - margin, rect.bottom + margin);
      topPos = Math.max(margin, topPos) + scrollY;
    } else {
      topPos = rect.top - popHeight - margin + scrollY;
      topPos = Math.max(margin + scrollY, topPos);
    }
  }

  pop.style.left = `${leftPos}px`;
  pop.style.top = `${topPos}px`;

  editState.currentTarget = { targetEl, onDone, config: values };
}

// --- Apply Dark Mode
export function applyDarkMode() {
  const isDark = model.darkMode;
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// --- Apply Glass Mode
export function applyGlassMode() {
  const isGlass = model.glassMode;
  document.body.setAttribute('data-style', isGlass ? 'glass' : 'solid');

  // Show/hide glass theme section in modal
  const glassThemeSection = $('#glass-theme-section');
  if (glassThemeSection) {
    glassThemeSection.hidden = !isGlass;
  }

  // Show/hide cursor shadow section in modal
  const cursorShadowSection = $('#cursor-shadow-section');
  if (cursorShadowSection) {
    cursorShadowSection.hidden = !isGlass;
  }
}

// --- Apply Glass Theme
export function applyGlassTheme() {
  const theme = model.glassTheme || 'classic';
  document.body.setAttribute('data-glass-theme', theme);
}

// --- Apply Cursor Shadow setting
export function applyCursorShadow() {
  const enabled = model.glassCursorShadow !== false;
  document.body.setAttribute('data-cursor-shadow', enabled ? 'on' : 'off');
}

// --- Set Dark Mode (used by appearance modal)
export function setDarkMode(isDark) {
  model.darkMode = isDark;
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

  // Update appearance modal buttons
  updateAppearanceModalButtons();
}

// --- Set Glass Mode (used by appearance modal)
export function setGlassMode(isGlass) {
  model.glassMode = isGlass;
  // Also update working copy if in edit mode
  if (editState.working) {
    editState.working.glassMode = model.glassMode;
  }
  applyGlassMode();

  // Re-render sections to update glass mode transparency styles
  if (window.renderAllSections) {
    window.renderAllSections();
  }

  // Re-add card buttons if in edit mode (after re-render)
  if (editState.enabled) {
    if (window.addCardButtons) window.addCardButtons();
    if (window.refreshEditingClasses) window.refreshEditingClasses();
  }

  // Update appearance modal buttons
  updateAppearanceModalButtons();
}

// --- Set Glass Theme (used by appearance modal)
export function setGlassTheme(theme) {
  model.glassTheme = theme;
  // Also update working copy if in edit mode
  if (editState.working) {
    editState.working.glassTheme = model.glassTheme;
  }
  applyGlassTheme();

  // Update the dropdown
  const select = $('#glass-theme-select');
  if (select) {
    select.value = theme;
  }
}

// --- Toggle Dark Mode (legacy function, kept for compatibility)
export function toggleDarkMode() {
  setDarkMode(!model.darkMode);
}

// --- Appearance Modal State (stores original values for cancel)
let appearanceOriginalState = null;

// --- Open Appearance Modal
export function openAppearanceModal() {
  const modal = $('#appearance-modal');
  if (modal) {
    // Store original state for cancel
    appearanceOriginalState = {
      darkMode: model.darkMode,
      glassMode: model.glassMode,
      glassTheme: model.glassTheme,
      glassCursorShadow: model.glassCursorShadow
    };
    modal.hidden = false;
    updateAppearanceModalButtons();

    // Show/hide glass-specific sections based on current glass mode
    const glassThemeSection = $('#glass-theme-section');
    if (glassThemeSection) {
      glassThemeSection.hidden = !model.glassMode;
    }
    const cursorShadowSection = $('#cursor-shadow-section');
    if (cursorShadowSection) {
      cursorShadowSection.hidden = !model.glassMode;
    }
  }
}

// --- Close Appearance Modal (just hides, doesn't save or revert)
export function closeAppearanceModal() {
  const modal = $('#appearance-modal');
  if (modal) {
    modal.hidden = true;
  }
  appearanceOriginalState = null;
}

// --- Accept Appearance Changes (save and close)
export function acceptAppearanceChanges() {
  // Changes are already applied to model, just save and close
  saveModel();
  closeAppearanceModal();
  showToast('Appearance saved');
}

// --- Cancel Appearance Changes (revert and close)
export function cancelAppearanceChanges() {
  if (appearanceOriginalState) {
    // Revert to original state
    model.darkMode = appearanceOriginalState.darkMode;
    model.glassMode = appearanceOriginalState.glassMode;
    model.glassTheme = appearanceOriginalState.glassTheme;
    model.glassCursorShadow = appearanceOriginalState.glassCursorShadow;

    // Also update working copy if in edit mode
    if (editState.working) {
      editState.working.darkMode = model.darkMode;
      editState.working.glassMode = model.glassMode;
      editState.working.glassTheme = model.glassTheme;
      editState.working.glassCursorShadow = model.glassCursorShadow;
    }

    // Apply the reverted states
    applyDarkMode();
    applyGlassMode();
    applyGlassTheme();
    applyCursorShadow();

    // Re-render if dark mode changed
    if (window.renderAllSections) {
      window.renderAllSections();
    }
    if (editState.enabled) {
      if (window.addCardButtons) window.addCardButtons();
      if (window.refreshEditingClasses) window.refreshEditingClasses();
    }
  }
  closeAppearanceModal();
}

// --- Update appearance modal button states
function updateAppearanceModalButtons() {
  const modal = $('#appearance-modal');
  if (!modal || modal.hidden) return;

  // Update theme buttons
  modal.querySelectorAll('.appearance-option[data-theme]').forEach(btn => {
    const isLight = btn.dataset.theme === 'light';
    const isActive = isLight ? !model.darkMode : model.darkMode;
    btn.classList.toggle('active', isActive);
  });

  // Update style buttons
  modal.querySelectorAll('.appearance-option[data-style]').forEach(btn => {
    const isSolid = btn.dataset.style === 'solid';
    const isActive = isSolid ? !model.glassMode : model.glassMode;
    btn.classList.toggle('active', isActive);
  });

  // Update glass theme dropdown visibility and value
  const glassThemeSection = $('#glass-theme-section');
  const glassThemeSelect = $('#glass-theme-select');
  if (glassThemeSection) {
    glassThemeSection.hidden = !model.glassMode;
  }
  if (glassThemeSelect) {
    glassThemeSelect.value = model.glassTheme || 'classic';
  }

  // Update cursor shadow toggle visibility and state
  const cursorShadowSection = $('#cursor-shadow-section');
  const cursorShadowToggle = $('#cursor-shadow-toggle');
  if (cursorShadowSection) {
    cursorShadowSection.hidden = !model.glassMode;
  }
  if (cursorShadowToggle) {
    cursorShadowToggle.checked = model.glassCursorShadow !== false;
  }
}

// --- Wire Appearance Modal Events (called from init)
export function wireAppearanceModalEvents() {
  const modal = $('#appearance-modal');
  if (!modal) return;

  // Close button (X) acts as cancel
  const closeBtn = $('#appearance-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', cancelAppearanceChanges);
  }

  // Backdrop click acts as cancel
  const backdrop = modal.querySelector('.appearance-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', cancelAppearanceChanges);
  }

  // Cancel button
  const cancelBtn = $('#appearance-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelAppearanceChanges);
  }

  // Accept button
  const acceptBtn = $('#appearance-accept');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', acceptAppearanceChanges);
  }

  // Theme option buttons (apply immediately for preview)
  modal.querySelectorAll('.appearance-option[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const isDark = btn.dataset.theme === 'dark';
      // Apply immediately but don't save yet
      model.darkMode = isDark;
      if (editState.working) {
        editState.working.darkMode = isDark;
      }
      applyDarkMode();
      updateAppearanceModalButtons();

      // Re-render sections for theme colors
      if (window.renderAllSections) {
        window.renderAllSections();
      }
      if (editState.enabled) {
        if (window.addCardButtons) window.addCardButtons();
        if (window.refreshEditingClasses) window.refreshEditingClasses();
      }
    });
  });

  // Style option buttons (apply immediately for preview)
  modal.querySelectorAll('.appearance-option[data-style]').forEach(btn => {
    btn.addEventListener('click', () => {
      const isGlass = btn.dataset.style === 'glass';
      // Apply immediately but don't save yet
      model.glassMode = isGlass;
      if (editState.working) {
        editState.working.glassMode = isGlass;
      }
      applyGlassMode();
      updateAppearanceModalButtons();
    });
  });

  // Glass theme dropdown (apply immediately for preview)
  const glassThemeSelect = $('#glass-theme-select');
  if (glassThemeSelect) {
    glassThemeSelect.addEventListener('change', () => {
      const theme = glassThemeSelect.value;
      model.glassTheme = theme;
      if (editState.working) {
        editState.working.glassTheme = theme;
      }
      applyGlassTheme();
    });
  }

  // Cursor shadow toggle (apply immediately for preview)
  const cursorShadowToggle = $('#cursor-shadow-toggle');
  if (cursorShadowToggle) {
    cursorShadowToggle.addEventListener('change', () => {
      const enabled = cursorShadowToggle.checked;
      model.glassCursorShadow = enabled;
      if (editState.working) {
        editState.working.glassCursorShadow = enabled;
      }
      applyCursorShadow();
    });
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

  // Default colors based on section type
  let defaultColorLight = '#fff4e5'; // Default yellow
  let defaultColorDark = '#334155';
  if (sectionType === 'tools') {
    defaultColorLight = '#e6fff3'; // Green
    defaultColorDark = '#1e3a3a';
  } else if (sectionType === 'unified') {
    defaultColorLight = '#f7fafc'; // Neutral grey (matches reminder items)
    defaultColorDark = '#334155';
  }
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

// ========== Move Item Feature ==========

// --- Toggle Move Card Selector
export function toggleMoveCardSelector() {
  const selector = $('#move-card-selector');
  if (!selector || !currentMoveContext) return;

  const isVisible = !selector.hidden;
  if (isVisible) {
    selector.hidden = true;
  } else {
    populateMoveCardList();
    selector.hidden = false;
  }
}

// --- Populate Move Card List
function populateMoveCardList() {
  const list = $('#move-card-list');
  if (!list || !currentMoveContext) return;

  list.innerHTML = '';

  const sections = currentSections() || [];
  const sourceSectionId = currentMoveContext.sectionId;

  // Get all available cards (excluding the source card)
  sections.forEach(section => {
    // Skip the source card
    if (section.id === sourceSectionId) return;
    // Skip non-unified cards (two-col containers don't store items)
    if (section.type !== 'unified') return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'move-card-option';
    btn.textContent = section.title || section.id;
    btn.addEventListener('click', () => {
      handleMoveToCard(section.id);
    });
    list.appendChild(btn);
  });

  // If no valid targets, show a message
  if (list.children.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'move-card-option';
    msg.style.color = 'var(--muted)';
    msg.style.cursor = 'default';
    msg.textContent = 'No other cards available';
    list.appendChild(msg);
  }
}

// --- Handle Move To Card
function handleMoveToCard(targetSectionId) {
  if (!currentMoveContext) return;

  const { sectionId: sourceSectionId, subtitle: sourceSubtitle, itemType, itemKey } = currentMoveContext;
  const data = currentData();

  // Get source collection
  const sourceData = data[sourceSectionId];
  if (!sourceData || !sourceData[sourceSubtitle]) {
    showToast('Source not found');
    return;
  }

  const sourceCollection = sourceData[sourceSubtitle][itemType];
  if (!Array.isArray(sourceCollection)) {
    showToast('Invalid source collection');
    return;
  }

  // Find and remove the item from source
  const itemIndex = sourceCollection.findIndex(item => item.key === itemKey);
  if (itemIndex === -1) {
    showToast('Item not found');
    return;
  }

  const [movedItem] = sourceCollection.splice(itemIndex, 1);

  // Ensure target card has data structure
  if (!data[targetSectionId]) {
    data[targetSectionId] = {};
  }
  if (!data[targetSectionId]['_default']) {
    data[targetSectionId]['_default'] = {};
  }
  if (!Array.isArray(data[targetSectionId]['_default'][itemType])) {
    data[targetSectionId]['_default'][itemType] = [];
  }

  // Add item to end of target's _default subtitle
  data[targetSectionId]['_default'][itemType].push(movedItem);

  // Save and re-render
  markDirtyAndSave();
  hideEditPopover();

  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled && window.addCardButtons) window.addCardButtons();

  showToast('Item moved');
}

// --- Wire Move Button Events (called from init)
export function wireMoveButtonEvents() {
  const moveBtn = $('#edit-move');
  if (moveBtn) {
    moveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMoveCardSelector();
    });
  }
}

// ========== Notepad Feature ==========

// Track current notepad state
let currentNotepadSectionId = null;
let notepadInEditMode = false;

// --- Render note text as HTML with bullet support
function renderNoteAsHtml(text) {
  if (!text || !text.trim()) return '';

  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let currentIndent = 0;

  lines.forEach(line => {
    // Check for bullet patterns: "* ", "  * " (indented), "- ", "  - "
    const bulletMatch = line.match(/^(\s*)[*-]\s(.*)$/);

    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      const content = bulletMatch[2];

      if (!inList) {
        html += '<ul>';
        inList = true;
        currentIndent = 0;
      }

      // Handle indent changes
      while (currentIndent < indent) {
        html += '<ul>';
        currentIndent++;
      }
      while (currentIndent > indent) {
        html += '</ul>';
        currentIndent--;
      }

      html += `<li>${escapeHtml(content)}</li>`;
    } else {
      // Close any open lists
      while (currentIndent > 0) {
        html += '</ul>';
        currentIndent--;
      }
      if (inList) {
        html += '</ul>';
        inList = false;
      }

      // Regular text line
      if (line.trim()) {
        html += `<div>${escapeHtml(line)}</div>`;
      } else {
        html += '<div>&nbsp;</div>';
      }
    }
  });

  // Close any remaining open lists
  while (currentIndent > 0) {
    html += '</ul>';
    currentIndent--;
  }
  if (inList) {
    html += '</ul>';
  }

  return html;
}

// --- Escape HTML special characters
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Open Notepad Popover (in view mode)
export function openNotepad(sectionId, cursorPos) {
  const pop = $('#notepad-popover');
  if (!pop) return;

  currentNotepadSectionId = sectionId;
  notepadInEditMode = false;

  // Get current note content
  const noteText = model.cardNotes?.[sectionId] || '';

  // Show view mode, hide edit mode
  const viewContainer = $('#notepad-view');
  const viewContent = $('#notepad-view-content');
  const editor = $('#notepad-editor');
  const actions = $('#notepad-actions');

  viewContainer.hidden = false;
  editor.hidden = true;
  actions.hidden = true;

  // Render the note content
  viewContent.innerHTML = renderNoteAsHtml(noteText);

  // Make visible to measure size
  pop.hidden = false;
  const popWidth = pop.offsetWidth || 384;
  const popHeight = pop.offsetHeight || 260;
  const margin = 12;

  // Get scroll offsets for absolute positioning
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  let leftPos, topPos;

  if (cursorPos) {
    const cursorX = cursorPos.x;
    const cursorY = cursorPos.y;

    // Horizontal: try right of cursor, then left, then clamp
    const spaceOnRight = window.innerWidth - cursorX;
    const spaceOnLeft = cursorX;

    if (spaceOnRight >= popWidth + margin) {
      leftPos = cursorX + margin + scrollX;
    } else if (spaceOnLeft >= popWidth + margin) {
      leftPos = cursorX - popWidth - margin + scrollX;
    } else {
      leftPos = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, cursorX - popWidth / 2)) + scrollX;
    }

    // Vertical: try below cursor, then above, then clamp
    const spaceBelow = window.innerHeight - cursorY;
    const spaceAbove = cursorY;

    if (spaceBelow >= popHeight + margin) {
      topPos = cursorY + margin + scrollY;
    } else if (spaceAbove >= popHeight + margin) {
      topPos = cursorY - popHeight - margin + scrollY;
    } else {
      topPos = Math.max(margin, Math.min(window.innerHeight - popHeight - margin, cursorY - popHeight / 2)) + scrollY;
    }
  } else {
    // Fallback: center on screen
    leftPos = (window.innerWidth - popWidth) / 2 + scrollX;
    topPos = (window.innerHeight - popHeight) / 2 + scrollY;
  }

  pop.style.left = `${leftPos}px`;
  pop.style.top = `${topPos}px`;
}

// --- Enter edit mode for notepad
export function enterNotepadEditMode() {
  if (notepadInEditMode) return;
  notepadInEditMode = true;

  const viewContainer = $('#notepad-view');
  const editor = $('#notepad-editor');
  const actions = $('#notepad-actions');

  // Get current note content
  const noteText = model.cardNotes?.[currentNotepadSectionId] || '';

  // Convert plain text to HTML for contenteditable
  editor.innerHTML = renderNoteAsHtml(noteText);

  // Switch to edit mode
  viewContainer.hidden = true;
  editor.hidden = false;
  actions.hidden = false;

  // Focus and place cursor at end
  setTimeout(() => {
    editor.focus();
    // Move cursor to end
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, 50);
}

// --- Close Notepad Popover
export function closeNotepad() {
  const pop = $('#notepad-popover');
  if (pop) {
    pop.hidden = true;
  }
  currentNotepadSectionId = null;
  notepadInEditMode = false;
}

// --- Convert contenteditable HTML back to plain text with bullet markers
function editorHtmlToText(element) {
  let result = '';

  function processNode(node, indent = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    if (tag === 'ul') {
      let ulText = '';
      for (const child of node.childNodes) {
        ulText += processNode(child, indent);
      }
      return ulText;
    }

    if (tag === 'li') {
      const indentStr = '  '.repeat(indent);
      let liText = indentStr + '* ';
      for (const child of node.childNodes) {
        if (child.tagName && child.tagName.toLowerCase() === 'ul') {
          liText += '\n' + processNode(child, indent + 1);
        } else {
          liText += processNode(child, indent);
        }
      }
      return liText.trimEnd() + '\n';
    }

    if (tag === 'div' || tag === 'p') {
      let text = '';
      for (const child of node.childNodes) {
        text += processNode(child, indent);
      }
      return text + '\n';
    }

    if (tag === 'br') {
      return '\n';
    }

    // Default: process children
    let text = '';
    for (const child of node.childNodes) {
      text += processNode(child, indent);
    }
    return text;
  }

  for (const child of element.childNodes) {
    result += processNode(child, 0);
  }

  // Clean up multiple newlines and trim
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// --- Save Note
export function saveNote() {
  if (!currentNotepadSectionId) return;

  const editor = $('#notepad-editor');
  const noteText = editorHtmlToText(editor).trim();

  // Initialize cardNotes if needed
  if (!model.cardNotes) {
    model.cardNotes = {};
  }

  // Save or remove the note
  if (noteText) {
    model.cardNotes[currentNotepadSectionId] = noteText;
  } else {
    delete model.cardNotes[currentNotepadSectionId];
  }

  // Also update working copy if in edit mode
  if (editState.working) {
    if (!editState.working.cardNotes) {
      editState.working.cardNotes = {};
    }
    if (noteText) {
      editState.working.cardNotes[currentNotepadSectionId] = noteText;
    } else {
      delete editState.working.cardNotes[currentNotepadSectionId];
    }
  }

  // Save to localStorage
  saveModel();

  // Update the notepad button indicator
  updateNotepadButtonIndicator(currentNotepadSectionId);

  closeNotepad();
  showToast('Note saved');
}

// --- Update notepad button indicator (show dot if has note)
export function updateNotepadButtonIndicator(sectionId) {
  const card = document.getElementById(sectionId);
  if (!card) return;

  const notepadBtn = card.querySelector('.card-notepad-btn');
  if (!notepadBtn) return;

  const hasNote = model.cardNotes?.[sectionId]?.trim();
  notepadBtn.classList.toggle('has-note', !!hasNote);
}

// --- Wire up notepad event listeners (called from init)
export function wireNotepadEvents() {
  const closeBtn = $('#notepad-close');
  const cancelBtn = $('#notepad-cancel');
  const saveBtn = $('#notepad-save');
  const viewContainer = $('#notepad-view');
  const editor = $('#notepad-editor');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeNotepad);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeNotepad);
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', saveNote);
  }

  // Click on view container to enter edit mode
  if (viewContainer) {
    viewContainer.addEventListener('click', enterNotepadEditMode);
  }

  // Keyboard support for bullet points in contenteditable
  if (editor) {
    editor.addEventListener('keydown', handleEditorKeydown);
    editor.addEventListener('input', handleEditorInput);
  }

  // Close on click outside
  document.addEventListener('click', (e) => {
    const pop = $('#notepad-popover');
    if (!pop || pop.hidden) return;

    const isInsidePopover = e.target.closest('#notepad-popover');
    const isNotepadButton = e.target.closest('.card-notepad-btn');

    if (!isInsidePopover && !isNotepadButton) {
      closeNotepad();
    }
  });
}

// --- Check if cursor is inside a list item
function isInListItem() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  let node = selection.anchorNode;
  while (node && node !== document.body) {
    if (node.tagName === 'LI') return node;
    node = node.parentNode;
  }
  return null;
}

// --- Check if cursor is inside a list
function isInList() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  let node = selection.anchorNode;
  while (node && node !== document.body) {
    if (node.tagName === 'UL') return node;
    node = node.parentNode;
  }
  return null;
}

// --- Handle keydown in contenteditable editor
function handleEditorKeydown(e) {
  const editor = e.target;

  if (e.key === 'Tab') {
    e.preventDefault();
    const li = isInListItem();

    if (li) {
      if (e.shiftKey) {
        // Shift+Tab: outdent
        document.execCommand('outdent', false, null);
      } else {
        // Tab: indent (create nested list)
        document.execCommand('indent', false, null);
      }
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    const li = isInListItem();
    if (li) {
      // Check if the list item is empty
      const text = li.textContent.trim();
      if (!text) {
        e.preventDefault();
        // Remove empty list item and exit list
        const ul = li.parentNode;
        const parentLi = ul.parentNode.tagName === 'LI' ? ul.parentNode : null;

        li.remove();

        // If this was nested, move cursor after parent li
        if (parentLi) {
          const range = document.createRange();
          range.setStartAfter(parentLi);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (ul.children.length === 0) {
          // Remove empty ul and add a line break
          const br = document.createElement('div');
          br.innerHTML = '<br>';
          ul.parentNode.insertBefore(br, ul);
          ul.remove();

          const range = document.createRange();
          range.setStart(br, 0);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return;
      }
    }
  }
}

// --- Handle input in contenteditable to auto-convert "* " to bullet
function handleEditorInput(e) {
  const editor = e.target;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  let node = range.startContainer;

  // Only process text nodes
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent;
  const cursorPos = range.startOffset;

  // Check for "* " or "- " pattern at start of text or after newline
  const beforeCursor = text.substring(0, cursorPos);

  // Pattern: text ends with "* " or "- " and it's at the beginning or after whitespace
  const bulletMatch = beforeCursor.match(/(^|[\n])([*-])\s$/);

  if (bulletMatch) {
    // Check if we're not already in a list
    if (!isInList()) {
      // Remove the "* " or "- " text
      const matchStart = beforeCursor.length - bulletMatch[0].length + (bulletMatch[1] ? bulletMatch[1].length : 0);
      const afterCursor = text.substring(cursorPos);
      const newText = text.substring(0, matchStart) + afterCursor;

      // Update the text node
      node.textContent = newText;

      // Create bullet list
      document.execCommand('insertUnorderedList', false, null);
    }
  }
}
