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
  if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();

  if (!editState.enabled) {
    hideEditPopover();
    hideCalendarPopover();
  }

  // Close any open reminder, list item, and icon link bubbles when toggling edit mode
  if (window.closeAllReminderLinks) window.closeAllReminderLinks();
  if (window.closeAllListItemLinks) window.closeAllListItemLinks();
  if (window.closeAllIconLinks) window.closeAllIconLinks();

  // Clear search when toggling edit mode
  if (window.clearSearch) window.clearSearch();
  const searchInput = document.getElementById('dashboard-search');
  if (searchInput) {
    searchInput.value = '';
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.hidden = true;
  }

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

  // Update sticky note button visibility (only visible outside edit mode)
  if (window.updateStickyButtonVisibility) window.updateStickyButtonVisibility();

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

  // Link type dropdown and file upload
  const linkTypeField = $('#edit-link-type-field');
  const linkTypeSelect = $('#edit-link-type');
  const fileField = $('#edit-file-field');
  const fileInput = $('#edit-file-input');
  const fileChooseBtn = $('#edit-file-choose');
  const fileNameSpan = $('#edit-file-name');
  const showLinkType = !hideUrl && !useCopyText && values.allowFileLink === true;
  linkTypeField.hidden = !showLinkType;
  linkTypeField.style.display = showLinkType ? '' : 'none';

  // Reset file state
  editState.chosenFile = null;
  editState.chosenFileId = null;
  if (fileInput) fileInput.value = '';
  if (fileNameSpan) fileNameSpan.textContent = 'No file selected';

  // Detect if current item has a file link
  if (values.linkType === 'file' && values.fileId) {
    linkTypeSelect.value = 'file';
    urlField.hidden = true;
    urlField.style.display = 'none';
    fileField.hidden = false;
    if (fileNameSpan) fileNameSpan.textContent = values.fileName || values.fileId;
    editState.chosenFileId = values.fileId;
  } else {
    linkTypeSelect.value = 'url';
    fileField.hidden = true;
  }

  linkTypeSelect.onchange = () => {
    if (linkTypeSelect.value === 'file') {
      urlField.hidden = true;
      urlField.style.display = 'none';
      fileField.hidden = false;
    } else {
      urlField.hidden = false;
      urlField.style.display = '';
      fileField.hidden = true;
    }
  };

  if (fileChooseBtn) {
    fileChooseBtn.onclick = () => fileInput.click();
  }
  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        editState.chosenFile = file;
        if (fileNameSpan) fileNameSpan.textContent = file.name;
      }
    };
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

  // Icon links button shows if allowIconLinks is true
  const iconLinksBtn = $('#edit-icon-links');
  if (iconLinksBtn) {
    const showIconLinks = values.allowIconLinks === true;
    iconLinksBtn.hidden = !showIconLinks;
    // Store icon reference for links modal
    editState.currentIconRef = showIconLinks ? values.iconRef : null;
    editState.currentIconSectionId = showIconLinks ? values.iconSectionId : null;
    editState.currentIconSubtitle = showIconLinks ? values.iconSubtitle : null;
  }

  // Icon tasks button shows if allowIconTasks is true
  const iconTasksBtn = $('#edit-icon-tasks');
  if (iconTasksBtn) {
    const showIconTasks = values.allowIconTasks === true;
    iconTasksBtn.hidden = !showIconTasks;
  }

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

// --- Apply Glass Mode (always on)
export function applyGlassMode() {
  model.glassMode = true;
  document.body.setAttribute('data-style', 'glass');
}

// --- Apply Glass Theme
export function applyGlassTheme() {
  const theme = model.glassTheme || 'classic';
  document.body.setAttribute('data-glass-theme', theme);
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
    appearanceOriginalState = {
      darkMode: model.darkMode,
      glassTheme: model.glassTheme
    };
    modal.hidden = false;
    updateAppearanceModalButtons();
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
    model.darkMode = appearanceOriginalState.darkMode;
    model.glassTheme = appearanceOriginalState.glassTheme;

    if (editState.working) {
      editState.working.darkMode = model.darkMode;
      editState.working.glassTheme = model.glassTheme;
    }

    applyDarkMode();
    applyGlassTheme();

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

  // Update glass theme dropdown value
  const glassThemeSelect = $('#glass-theme-select');
  if (glassThemeSelect) {
    glassThemeSelect.value = model.glassTheme || 'classic';
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

  // Theme dropdown (apply immediately for preview)
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

  // JSON File Backup - Download
  const exportBtn = $('#settings-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try {
        const currentState = window.extractUrlOverrides ? window.extractUrlOverrides() : {};
        const json = JSON.stringify(currentState, null, 2);
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const filename = `Personal Dashboard (${dateStr}).json`;
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        showToast(`Backup saved as: ${filename}`);
      } catch (err) {
        showToast('Error creating backup file.');
      }
    });
  }

  // JSON File Backup - Upload
  const importBtn = $('#settings-import-btn');
  const importInput = $('#settings-import-input');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;

      if (!confirm('Warning: Uploading a backup will overwrite your entire current profile. All existing data will be replaced.\n\nAre you sure you want to continue?')) {
        importInput.value = '';
        return;
      }

      try {
        window.isImporting = true;
        window.skipUrlOverrides = false;
        window.localStorageRestored = false;

        const text = await file.text();
        const json = JSON.parse(text);

        if (!json || typeof json !== 'object') {
          throw new Error('Invalid file format');
        }

        if (window.applyUrlOverrides) window.applyUrlOverrides(json);
        if (window.renderAllSections) window.renderAllSections();

        await new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });

        window.isImporting = false;
        showToast('Profile restored from backup');
      } catch (err) {
        window.isImporting = false;
        showToast('Error importing backup file.');
      }
      importInput.value = '';
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

  // Immediate cloud save — cloudSave flushes queued R2 deletions on D1 success
  if (window.immediateCloudSave) {
    window.immediateCloudSave();
  }

  toggleEditMode();
  showToast('Changes saved');
}

// --- Cancel Global Edit (discard changes)
export function cancelGlobalEdit() {
  editState.dirty = false;
  if (window.clearPendingR2Deletions) window.clearPendingR2Deletions();
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
  const data = currentData();
  const sourceSectionId = currentMoveContext.sectionId;
  const isSubtitleMove = currentMoveContext.isSubtitle === true;

  // Get all available cards (excluding the source card)
  sections.forEach(section => {
    // Skip the source card
    if (section.id === sourceSectionId) return;
    // Skip non-unified cards (two-col containers don't store items)
    if (section.type !== 'unified') return;

    if (isSubtitleMove) {
      // Moving a subtitle - just show card names (subtitle will be added to that card)
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-card-option';
      btn.textContent = section.title || section.id;
      btn.addEventListener('click', () => {
        handleMoveSubtitleToCard(section.id);
      });
      list.appendChild(btn);
    } else {
      // Moving an item - show card headers with subtitle options
      const cardData = data[section.id] || {};
      const subtitles = Object.keys(cardData).filter(s => s !== '_default');

      if (subtitles.length > 0) {
        // Card has named subtitles - show card header and subtitle options
        const cardHeader = document.createElement('div');
        cardHeader.className = 'move-card-header';
        cardHeader.textContent = section.title || section.id;
        list.appendChild(cardHeader);

        // Add _default option (top of card)
        const defaultBtn = document.createElement('button');
        defaultBtn.type = 'button';
        defaultBtn.className = 'move-card-option move-subtitle-option';
        defaultBtn.textContent = '(Top of card)';
        defaultBtn.addEventListener('click', () => {
          handleMoveToCard(section.id, '_default');
        });
        list.appendChild(defaultBtn);

        // Add each subtitle as an option
        subtitles.forEach(subtitle => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'move-card-option move-subtitle-option';
          btn.textContent = subtitle;
          btn.addEventListener('click', () => {
            handleMoveToCard(section.id, subtitle);
          });
          list.appendChild(btn);
        });
      } else {
        // Card has no named subtitles - just show card option
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'move-card-option';
        btn.textContent = section.title || section.id;
        btn.addEventListener('click', () => {
          handleMoveToCard(section.id, '_default');
        });
        list.appendChild(btn);
      }
    }
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
function handleMoveToCard(targetSectionId, targetSubtitle = '_default') {
  if (!currentMoveContext) return;

  const { sectionId: sourceSectionId, subtitle: sourceSubtitle, itemType, itemKey } = currentMoveContext;
  const data = currentData();

  // Get source collection
  const sourceData = data[sourceSectionId];
  if (!sourceData || !sourceData[sourceSubtitle]) {
    showToast('Source not found');
    console.error('[MoveToCard] Source not found:', { sourceSectionId, sourceSubtitle, sourceData });
    return;
  }

  const sourceCollection = sourceData[sourceSubtitle][itemType];
  if (!Array.isArray(sourceCollection)) {
    showToast('Invalid source collection');
    console.error('[MoveToCard] Invalid source collection:', sourceData[sourceSubtitle]);
    return;
  }

  // Find and remove the item from source
  const itemIndex = sourceCollection.findIndex(item => item.key === itemKey);
  if (itemIndex === -1) {
    showToast('Item not found');
    console.error('[MoveToCard] Item not found in collection');
    return;
  }

  const [movedItem] = sourceCollection.splice(itemIndex, 1);

  // Ensure target card and subtitle have data structure
  if (!data[targetSectionId]) {
    data[targetSectionId] = {};
  }
  if (!data[targetSectionId][targetSubtitle]) {
    data[targetSectionId][targetSubtitle] = {
      icons: [],
      reminders: [],
      subtasks: [],
      copyPaste: []
    };
  }
  if (!Array.isArray(data[targetSectionId][targetSubtitle][itemType])) {
    data[targetSectionId][targetSubtitle][itemType] = [];
  }

  // Add item to end of target subtitle
  data[targetSectionId][targetSubtitle][itemType].push(movedItem);

  // Save and re-render
  markDirtyAndSave();
  hideEditPopover();

  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled && window.addCardButtons) window.addCardButtons();

  // Show toast with destination subtitle
  const subtitleLabel = targetSubtitle === '_default' ? '' : ` to "${targetSubtitle}"`;
  showToast(`Item moved${subtitleLabel}`);
}

// --- Handle Move Subtitle To Card (moves entire subtitle with all items)
function handleMoveSubtitleToCard(targetSectionId) {
  if (!currentMoveContext || !currentMoveContext.isSubtitle) return;

  const { sectionId: sourceSectionId, subtitle: sourceSubtitle } = currentMoveContext;
  const data = currentData();

  // Get source subtitle data
  const sourceData = data[sourceSectionId];
  if (!sourceData || !sourceData[sourceSubtitle]) {
    showToast('Subtitle not found');
    return;
  }

  // Check if target card already has this subtitle name
  if (!data[targetSectionId]) {
    data[targetSectionId] = {};
  }

  let finalSubtitleName = sourceSubtitle;
  if (data[targetSectionId][sourceSubtitle]) {
    // Subtitle name exists in target - append a number
    let counter = 2;
    while (data[targetSectionId][`${sourceSubtitle} ${counter}`]) {
      counter++;
    }
    finalSubtitleName = `${sourceSubtitle} ${counter}`;
  }

  // Move the subtitle data
  data[targetSectionId][finalSubtitleName] = sourceData[sourceSubtitle];
  delete sourceData[sourceSubtitle];

  // Also move subtitle color if it exists
  if (data.subtitleColors) {
    const oldColorKey = `${sourceSectionId}:${sourceSubtitle}`;
    const newColorKey = `${targetSectionId}:${finalSubtitleName}`;
    if (data.subtitleColors[oldColorKey]) {
      data.subtitleColors[newColorKey] = data.subtitleColors[oldColorKey];
      delete data.subtitleColors[oldColorKey];
    }
  }

  // Also move collapsed state if it exists
  if (data.collapsedSubtitles) {
    const oldCollapseKey = `${sourceSectionId}:${sourceSubtitle}`;
    const newCollapseKey = `${targetSectionId}:${finalSubtitleName}`;
    if (data.collapsedSubtitles[oldCollapseKey]) {
      data.collapsedSubtitles[newCollapseKey] = data.collapsedSubtitles[oldCollapseKey];
      delete data.collapsedSubtitles[oldCollapseKey];
    }
  }

  // Save and re-render
  markDirtyAndSave();
  hideEditPopover();

  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled && window.addCardButtons) window.addCardButtons();

  const targetSection = currentSections().find(s => s.id === targetSectionId);
  const targetName = targetSection ? (targetSection.title || targetSectionId) : targetSectionId;
  showToast(`"${sourceSubtitle}" moved to ${targetName}`);
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

// ========== Reorder Subtitles Modal ==========

let currentReorderSectionId = null;
let reorderDraggedItem = null;

export function openReorderSubtitlesModal(sectionId, event) {
  currentReorderSectionId = sectionId;
  const data = currentData();
  const cardData = data[sectionId] || {};

  // Get subtitles in current order (excluding _default)
  const subtitles = Object.keys(cardData).filter(s => s !== '_default');

  if (subtitles.length < 2) {
    showToast('Need at least 2 sections to reorder');
    return;
  }

  // Create modal if it doesn't exist
  let modal = $('#reorder-subtitles-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reorder-subtitles-modal';
    modal.className = 'reorder-subtitles-modal';
    modal.innerHTML = `
      <div class="reorder-modal-content">
        <div class="reorder-modal-header">
          <h3>Reorder Sections</h3>
          <button type="button" class="reorder-modal-close">&times;</button>
        </div>
        <div class="reorder-modal-body">
          <p class="reorder-hint">Drag to reorder sections</p>
          <ul id="reorder-subtitles-list" class="reorder-subtitles-list"></ul>
        </div>
        <div class="reorder-modal-footer">
          <button type="button" class="btn reorder-cancel">Cancel</button>
          <button type="button" class="btn primary reorder-save">Save Order</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Wire up close buttons
    modal.querySelector('.reorder-modal-close').addEventListener('click', closeReorderSubtitlesModal);
    modal.querySelector('.reorder-cancel').addEventListener('click', closeReorderSubtitlesModal);
    modal.querySelector('.reorder-save').addEventListener('click', saveSubtitleOrder);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeReorderSubtitlesModal();
    });
  }

  // Populate the list
  const list = $('#reorder-subtitles-list');
  list.innerHTML = '';

  subtitles.forEach((subtitle, index) => {
    const li = document.createElement('li');
    li.className = 'reorder-subtitle-item';
    li.dataset.subtitle = subtitle;
    li.draggable = true;
    li.innerHTML = `
      <span class="reorder-drag-handle">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="16" y2="6"></line>
          <line x1="8" y1="12" x2="16" y2="12"></line>
          <line x1="8" y1="18" x2="16" y2="18"></line>
        </svg>
      </span>
      <span class="reorder-subtitle-name">${subtitle}</span>
    `;

    // Drag events
    li.addEventListener('dragstart', handleReorderDragStart);
    li.addEventListener('dragend', handleReorderDragEnd);
    li.addEventListener('dragover', handleReorderDragOver);
    li.addEventListener('drop', handleReorderDrop);

    list.appendChild(li);
  });

  // Position modal near click
  const modalContent = modal.querySelector('.reorder-modal-content');
  modal.hidden = false;

  // Center the modal
  modalContent.style.position = 'fixed';
  modalContent.style.top = '50%';
  modalContent.style.left = '50%';
  modalContent.style.transform = 'translate(-50%, -50%)';
}

function closeReorderSubtitlesModal() {
  const modal = $('#reorder-subtitles-modal');
  if (modal) modal.hidden = true;
  currentReorderSectionId = null;
  reorderDraggedItem = null;
}

function handleReorderDragStart(e) {
  reorderDraggedItem = e.target.closest('.reorder-subtitle-item');
  reorderDraggedItem.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleReorderDragEnd(e) {
  if (reorderDraggedItem) {
    reorderDraggedItem.classList.remove('dragging');
  }
  // Remove all drag-over classes
  document.querySelectorAll('.reorder-subtitle-item.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
  reorderDraggedItem = null;
}

function handleReorderDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const item = e.target.closest('.reorder-subtitle-item');
  if (!item || item === reorderDraggedItem) return;

  // Remove drag-over from all items
  document.querySelectorAll('.reorder-subtitle-item.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });

  item.classList.add('drag-over');
}

function handleReorderDrop(e) {
  e.preventDefault();
  const targetItem = e.target.closest('.reorder-subtitle-item');
  if (!targetItem || !reorderDraggedItem || targetItem === reorderDraggedItem) return;

  const list = $('#reorder-subtitles-list');
  const items = Array.from(list.children);
  const draggedIndex = items.indexOf(reorderDraggedItem);
  const targetIndex = items.indexOf(targetItem);

  // Insert dragged item before or after target based on position
  if (draggedIndex < targetIndex) {
    targetItem.after(reorderDraggedItem);
  } else {
    targetItem.before(reorderDraggedItem);
  }

  targetItem.classList.remove('drag-over');
}

function saveSubtitleOrder() {
  if (!currentReorderSectionId) return;

  const list = $('#reorder-subtitles-list');
  const newOrder = Array.from(list.children).map(li => li.dataset.subtitle);

  const data = currentData();
  const cardData = data[currentReorderSectionId];
  if (!cardData) return;

  // Rebuild the card data with new subtitle order
  const newCardData = {};

  // Keep _default first if it exists
  if (cardData['_default']) {
    newCardData['_default'] = cardData['_default'];
  }

  // Add subtitles in new order
  newOrder.forEach(subtitle => {
    if (cardData[subtitle]) {
      newCardData[subtitle] = cardData[subtitle];
    }
  });

  // Replace card data
  data[currentReorderSectionId] = newCardData;

  markDirtyAndSave();
  closeReorderSubtitlesModal();

  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled && window.addCardButtons) window.addCardButtons();

  showToast('Section order updated');
}

// ========== Notepad Feature (Multi-Note) ==========

// Track current notepad state
let currentNotepadSectionId = null;
let currentNoteKey = null; // Key of the note being edited (null = new note)
let notepadInitialState = null; // For unsaved changes detection

// --- Generate unique key for notes
function generateNoteKey() {
  return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// --- Get notes array for a section (handles migration from old string format)
function getNotesForSection(sectionId) {
  if (!model.cardNotes) return [];
  const notes = model.cardNotes[sectionId];
  if (!notes) return [];

  // Migration: if it's a string (old format), convert to array
  if (typeof notes === 'string') {
    if (notes.trim()) {
      const migratedNote = {
        key: generateNoteKey(),
        title: 'Note',
        content: notes
      };
      model.cardNotes[sectionId] = [migratedNote];
      if (editState.working?.cardNotes) {
        editState.working.cardNotes[sectionId] = [migratedNote];
      }
      saveModel();
      return [migratedNote];
    }
    return [];
  }

  return Array.isArray(notes) ? notes : [];
}

// --- Render note text as HTML with bullet support
function renderNoteAsHtml(text) {
  if (!text || !text.trim()) return '';

  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let currentIndent = 0;

  lines.forEach(line => {
    const bulletMatch = line.match(/^(\s*)[*-]\s(.*)$/);

    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      const content = bulletMatch[2];

      if (!inList) {
        html += '<ul>';
        inList = true;
        currentIndent = 0;
      }

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
      while (currentIndent > 0) {
        html += '</ul>';
        currentIndent--;
      }
      if (inList) {
        html += '</ul>';
        inList = false;
      }

      if (line.trim()) {
        html += `<div>${escapeHtml(line)}</div>`;
      } else {
        html += '<div>&nbsp;</div>';
      }
    }
  });

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

// --- Render saved notes list at top of notepad
function renderSavedNotesList() {
  const listContainer = $('#notepad-saved-list');
  if (!listContainer) return;

  const notes = getNotesForSection(currentNotepadSectionId);

  if (notes.length === 0) {
    listContainer.hidden = true;
    return;
  }

  listContainer.hidden = false;
  const defaultBgColor = model.darkMode ? '#475569' : '#e6f3ff';
  listContainer.innerHTML = notes.map(note => {
    const bgColor = note.color || defaultBgColor;
    return `
      <button type="button" class="notepad-saved-bubble" data-key="${note.key}" style="background: ${bgColor}">
        ${escapeHtml(note.title || 'Untitled')}
      </button>
    `;
  }).join('');

  // Add click handlers
  listContainer.querySelectorAll('.notepad-saved-bubble').forEach(bubble => {
    bubble.addEventListener('click', () => {
      openNoteViewer(bubble.dataset.key);
    });
  });
}

// --- Update note color preview button
function updateNoteColorPreview() {
  const colorBtn = $('#notepad-color-btn');
  if (!colorBtn) return;
  const defaultColor = model.darkMode ? '#475569' : '#e6f3ff';
  const color = currentNoteColor || defaultColor;
  colorBtn.style.background = color;
}

// --- Open note color picker (matches link color picker style exactly)
export function openNoteColorPicker() {
  const colorBtn = $('#notepad-color-btn');
  if (!colorBtn) return;

  // Close any existing picker
  const existingPicker = document.querySelector('.link-color-popover');
  if (existingPicker) {
    existingPicker.remove();
  }

  const defaultColorLight = '#e6f3ff';
  const defaultColorDark = '#475569';
  const currentColor = currentNoteColor || (model.darkMode ? defaultColorDark : defaultColorLight);
  const modeLabel = model.darkMode ? 'Dark' : 'Light';

  const picker = document.createElement('div');
  picker.className = 'link-color-popover';
  picker.innerHTML = `
    <div class="link-color-popover-header">
      <span>Bubble Color (${modeLabel})</span>
    </div>
    <div class="link-color-popover-content">
      <input type="color" class="link-color-input" value="${currentColor}">
      <div class="link-color-presets">
        <button type="button" class="color-preset-small" data-color="#f7fafc" style="background: #f7fafc;" title="Gray"></button>
        <button type="button" class="color-preset-small" data-color="#fff4e5" style="background: #fff4e5;" title="Yellow"></button>
        <button type="button" class="color-preset-small" data-color="#e6fff3" style="background: #e6fff3;" title="Green"></button>
        <button type="button" class="color-preset-small" data-color="#ffe6f0" style="background: #ffe6f0;" title="Pink"></button>
        <button type="button" class="color-preset-small" data-color="#e6f3ff" style="background: #e6f3ff;" title="Blue"></button>
        <button type="button" class="color-preset-small" data-color="#f3e6ff" style="background: #f3e6ff;" title="Purple"></button>
        <button type="button" class="color-preset-small" data-color="#fff6e6" style="background: #fff6e6;" title="Orange"></button>
        <button type="button" class="color-preset-small" data-color="#ffe6e6" style="background: #ffe6e6;" title="Red"></button>
      </div>
    </div>
  `;
  document.body.appendChild(picker);

  // Position picker near the button
  const btnRect = colorBtn.getBoundingClientRect();
  const popoverWidth = 200;
  const popoverHeight = picker.offsetHeight || 120;
  const margin = 8;

  let left = btnRect.left;
  let top = btnRect.bottom + margin;

  // Adjust if overflowing right
  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin;
  }

  // Adjust if overflowing bottom - show above instead
  if (top + popoverHeight > window.innerHeight - margin) {
    top = btnRect.top - popoverHeight - margin;
  }

  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;

  // Handle color input change
  const colorInput = picker.querySelector('.link-color-input');
  colorInput.addEventListener('input', (e) => {
    currentNoteColor = e.target.value;
    updateNoteColorPreview();
  });

  // Close picker helper
  const closePicker = () => {
    picker.remove();
    document.removeEventListener('click', closeHandler);
  };

  // Handle preset clicks - close popover after selection
  picker.querySelectorAll('.color-preset-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newColor = btn.dataset.color;
      colorInput.value = newColor;
      currentNoteColor = newColor;
      updateNoteColorPreview();
      closePicker();
    });
  });

  // Close on click outside
  const closeHandler = (e) => {
    if (!picker.contains(e.target) && e.target !== colorBtn) {
      closePicker();
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// --- Clear editor fields
function clearNotepadEditor() {
  const titleInput = $('#notepad-title');
  const editor = $('#notepad-editor');
  if (titleInput) titleInput.value = '';
  if (editor) editor.innerHTML = '';
  currentNoteKey = null;
  currentNoteColor = null;
  updateNoteColorPreview();
}

// --- Open Notepad Popover
export function openNotepad(sectionId, cursorPos) {
  const pop = $('#notepad-popover');
  if (!pop) return;

  currentNotepadSectionId = sectionId;
  currentNoteKey = null;

  // Render saved notes at top
  renderSavedNotesList();

  // Clear editor for new note
  clearNotepadEditor();

  // Make visible to measure size
  pop.hidden = false;
  const popWidth = pop.offsetWidth || 384;
  const popHeight = pop.offsetHeight || 300;
  const margin = 12;

  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  let leftPos, topPos;

  if (cursorPos) {
    const cursorX = cursorPos.x;
    const cursorY = cursorPos.y;

    const spaceOnRight = window.innerWidth - cursorX;
    const spaceOnLeft = cursorX;

    if (spaceOnRight >= popWidth + margin) {
      leftPos = cursorX + margin + scrollX;
    } else if (spaceOnLeft >= popWidth + margin) {
      leftPos = cursorX - popWidth - margin + scrollX;
    } else {
      leftPos = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, cursorX - popWidth / 2)) + scrollX;
    }

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
    leftPos = (window.innerWidth - popWidth) / 2 + scrollX;
    topPos = (window.innerHeight - popHeight) / 2 + scrollY;
  }

  pop.style.left = `${leftPos}px`;
  pop.style.top = `${topPos}px`;

  // Capture initial state for unsaved changes detection
  notepadInitialState = { title: '', content: '' };

  // Focus title input
  setTimeout(() => {
    const titleInput = $('#notepad-title');
    if (titleInput) titleInput.focus();
  }, 50);
}

// --- Enter edit mode for existing note
export function enterNotepadEditMode(noteKey) {
  if (!noteKey) return;
  currentNoteKey = noteKey;

  const notes = getNotesForSection(currentNotepadSectionId);
  const note = notes.find(n => n.key === noteKey);
  if (!note) return;

  const titleInput = $('#notepad-title');
  const editor = $('#notepad-editor');

  if (titleInput) titleInput.value = note.title || '';
  // Load HTML directly (content is now stored as HTML)
  if (editor) {
    editor.innerHTML = note.content || '';
    reconcileTaskHighlights(editor);
    const reconciled = editor.innerHTML;
    if (reconciled !== (note.content || '')) {
      note.content = reconciled;
      saveModel();
    }
  }

  // Capture initial state for unsaved changes detection
  notepadInitialState = {
    title: note.title || '',
    content: sanitizeHtml(note.content || '').trim()
  };

  // Set current color for editing
  currentNoteColor = note.color || null;
  updateNoteColorPreview();

  setTimeout(() => {
    if (editor) {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, 50);
}

// --- Check if notepad has unsaved changes
function notepadHasChanges() {
  if (!notepadInitialState) return false;
  const titleInput = $('#notepad-title');
  const editor = $('#notepad-editor');
  const currentTitle = titleInput?.value || '';
  const currentContent = sanitizeHtml(editor?.innerHTML || '').trim();
  return currentTitle !== notepadInitialState.title || currentContent !== notepadInitialState.content;
}

// --- Close Notepad Popover
export function closeNotepad(force) {
  if (!force && notepadHasChanges()) {
    if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
      return;
    }
  }
  const pop = $('#notepad-popover');
  if (pop) {
    pop.hidden = true;
  }
  currentNotepadSectionId = null;
  currentNoteKey = null;
  notepadInitialState = null;
}

// --- Convert contenteditable HTML back to plain text
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

    let text = '';
    for (const child of node.childNodes) {
      text += processNode(child, indent);
    }
    return text;
  }

  for (const child of element.childNodes) {
    result += processNode(child, 0);
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// --- Sanitize HTML content (allow only safe tags)
function sanitizeHtml(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Remove script tags and event handlers
  temp.querySelectorAll('script').forEach(el => el.remove());
  temp.querySelectorAll('*').forEach(el => {
    // Remove event handler attributes
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return temp.innerHTML;
}

// --- Current note color (for new notes)
let currentNoteColor = null;

// --- Save Note
export function saveNote() {
  if (!currentNotepadSectionId) return;

  const editor = $('#notepad-editor');
  const titleInput = $('#notepad-title');
  const noteTitle = titleInput.value.trim() || 'Untitled';
  const noteContent = sanitizeHtml(editor.innerHTML).trim();

  if (!noteContent || noteContent === '<br>' || noteContent === '<div><br></div>') {
    showToast('Note is empty');
    return;
  }

  if (!model.cardNotes) {
    model.cardNotes = {};
  }
  if (!model.cardNotes[currentNotepadSectionId] || typeof model.cardNotes[currentNotepadSectionId] === 'string') {
    model.cardNotes[currentNotepadSectionId] = [];
  }

  const notes = model.cardNotes[currentNotepadSectionId];

  if (currentNoteKey) {
    // Update existing note
    const noteIndex = notes.findIndex(n => n.key === currentNoteKey);
    if (noteIndex !== -1) {
      notes[noteIndex].title = noteTitle;
      notes[noteIndex].content = noteContent;
      if (currentNoteColor) {
        notes[noteIndex].color = currentNoteColor;
      }
    }
  } else {
    // Add new note
    notes.push({
      key: generateNoteKey(),
      title: noteTitle,
      content: noteContent,
      color: currentNoteColor || null
    });
  }

  if (editState.working) {
    if (!editState.working.cardNotes) {
      editState.working.cardNotes = {};
    }
    editState.working.cardNotes[currentNotepadSectionId] = [...notes];
  }

  saveModel();
  updateNotepadButtonIndicator(currentNotepadSectionId);

  // Clear editor and refresh saved notes list
  clearNotepadEditor();
  currentNoteColor = null;
  notepadInitialState = { title: '', content: '' };
  renderSavedNotesList();

  showToast('Note saved');
}

// --- Delete a note
export function deleteNote(noteKey) {
  if (!currentNotepadSectionId || !noteKey) return;

  const notes = getNotesForSection(currentNotepadSectionId);
  const noteIndex = notes.findIndex(n => n.key === noteKey);

  if (noteIndex === -1) return;

  notes.splice(noteIndex, 1);
  model.cardNotes[currentNotepadSectionId] = notes;

  if (editState.working?.cardNotes) {
    editState.working.cardNotes[currentNotepadSectionId] = [...notes];
  }

  saveModel();
  updateNotepadButtonIndicator(currentNotepadSectionId);
}

// --- Reconcile all task highlights in a DOM element based on actual task status
// This is the robust approach: instead of relying on events, check actual state
export function reconcileTaskHighlights(container) {
  if (!container) return;
  const spans = container.querySelectorAll('span.project-task-highlight');
  if (spans.length === 0) return;

  const allActive = window.getAllTasks ? window.getAllTasks() : [];
  const allCompleted = window.getCompletedTasks ? window.getCompletedTasks() : [];

  const completedBg = 'rgba(34, 197, 94, 0.3)';
  const completedBorder = 'rgba(34, 197, 94, 0.6)';
  const colorBg = {
    blue: 'rgba(59, 130, 246, 0.25)',
    yellow: 'rgba(234, 179, 8, 0.25)',
    orange: 'rgba(249, 115, 22, 0.25)',
    red: 'rgba(239, 68, 68, 0.25)'
  };
  const colorBorder = {
    blue: 'rgba(59, 130, 246, 0.6)',
    yellow: 'rgba(234, 179, 8, 0.6)',
    orange: 'rgba(249, 115, 22, 0.6)',
    red: 'rgba(239, 68, 68, 0.6)'
  };

  spans.forEach(span => {
    const taskId = span.dataset.taskId;
    if (!taskId) return;

    const activeTask = allActive.find(t => t.id === taskId);
    const completedTask = allCompleted.find(t => t.id === taskId);

    if (completedTask) {
      // Task is completed → mark green
      span.dataset.highlightColor = 'completed';
      span.style.backgroundColor = completedBg;
      span.style.borderBottom = `2px solid ${completedBorder}`;
      span.classList.add('completed');
      span.style.cursor = 'default';
    } else if (activeTask) {
      // Task is active → ensure correct color
      const color = activeTask.color || 'blue';
      if (span.dataset.highlightColor === 'completed') {
        // Was marked completed but task is active again (uncompleted)
        span.dataset.highlightColor = color;
        span.style.backgroundColor = colorBg[color] || colorBg.blue;
        span.style.borderBottom = `2px solid ${colorBorder[color] || colorBorder.blue}`;
        span.classList.remove('completed');
        span.style.cursor = 'pointer';
      }
    } else {
      // Task not found (deleted) → revert to plain text
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    }
  });
}

// --- Reconcile highlights in stored HTML string, returns updated HTML
export function reconcileTaskHighlightsInHtml(html) {
  if (!html) return html;
  if (!html.includes('project-task-highlight')) return html;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  reconcileTaskHighlights(temp);
  return temp.innerHTML;
}

// --- Remove card note task highlight (revert to plain text, keep text)
export function removeNoteTaskHighlight(sectionId, taskId) {
  if (!model.cardNotes || !model.cardNotes[sectionId]) return;
  const notes = model.cardNotes[sectionId];
  if (!Array.isArray(notes)) return;

  notes.forEach(note => {
    if (!note.content) return;
    const temp = document.createElement('div');
    temp.innerHTML = note.content;
    let changed = false;
    temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
      changed = true;
    });
    if (changed) {
      note.content = temp.innerHTML;
    }
  });

  saveModel();

  // Update live notepad editor if open
  const editor = $('#notepad-editor');
  if (editor) {
    editor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
  }
}

// --- Mark card note task highlight as completed (turns green)
export function markNoteTaskHighlightCompleted(sectionId, taskId) {
  if (!model.cardNotes || !model.cardNotes[sectionId]) return;
  const notes = model.cardNotes[sectionId];
  if (!Array.isArray(notes)) return;

  const completedBg = 'rgba(34, 197, 94, 0.3)';
  const completedBorder = 'rgba(34, 197, 94, 0.6)';

  notes.forEach(note => {
    if (!note.content) return;
    const temp = document.createElement('div');
    temp.innerHTML = note.content;
    let changed = false;
    temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      span.dataset.highlightColor = 'completed';
      span.style.backgroundColor = completedBg;
      span.style.borderBottom = '2px solid ' + completedBorder;
      span.classList.add('completed');
      span.style.cursor = 'default';
      changed = true;
    });
    if (changed) {
      note.content = temp.innerHTML;
    }
  });

  saveModel();

  // Update live notepad editor if open
  const editor = $('#notepad-editor');
  if (editor) {
    editor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      span.dataset.highlightColor = 'completed';
      span.style.backgroundColor = completedBg;
      span.style.borderBottom = '2px solid ' + completedBorder;
      span.classList.add('completed');
      span.style.cursor = 'default';
    });
  }
}

// --- Open Note Viewer Modal (read-only)
export function openNoteViewer(noteKey) {
  const modal = $('#note-viewer-modal');
  if (!modal) return;

  const notes = getNotesForSection(currentNotepadSectionId);
  const note = notes.find(n => n.key === noteKey);
  if (!note) return;

  currentNoteKey = noteKey;

  const titleEl = $('#note-viewer-title');
  const contentEl = $('#note-viewer-content');

  titleEl.textContent = note.title || 'Untitled';
  // Display HTML directly (content is now stored as HTML)
  contentEl.innerHTML = note.content || '';

  // Reconcile highlights based on actual task status (completed → green, deleted → plain text)
  reconcileTaskHighlights(contentEl);

  // Persist any changes back to the stored note
  const reconciledHtml = contentEl.innerHTML;
  if (reconciledHtml !== (note.content || '')) {
    note.content = reconciledHtml;
    saveModel();
  }

  // Click on task highlights in note viewer to open linked task
  contentEl.querySelectorAll('span.project-task-highlight').forEach(span => {
    if (!span.classList.contains('completed')) {
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => {
        const taskId = span.dataset.taskId;
        if (taskId && window.openEditTaskModal) {
          window.openEditTaskModal(taskId);
        }
      });
    }
  });

  modal.hidden = false;
}

// --- Close Note Viewer Modal
export function closeNoteViewer() {
  const modal = $('#note-viewer-modal');
  if (modal) {
    modal.hidden = true;
  }
  currentNoteKey = null;
}

// --- Edit note from viewer
export function editNoteFromViewer() {
  const noteKey = currentNoteKey;
  closeNoteViewer();
  enterNotepadEditMode(noteKey);
}

// --- Copy note from viewer (preserves rich formatting)
export function copyNoteFromViewer() {
  const contentEl = $('#note-viewer-content');
  if (!contentEl) return;

  const htmlContent = contentEl.innerHTML;
  const plainText = contentEl.innerText;

  if (navigator.clipboard && window.ClipboardItem) {
    const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });
    navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
    ]).then(() => showToast('Note copied'))
      .catch(() => {
        navigator.clipboard.writeText(plainText).then(() => showToast('Note copied as text'));
      });
  } else {
    navigator.clipboard.writeText(plainText).then(() => showToast('Note copied as text'));
  }
}

// --- Delete note from viewer
export function deleteNoteFromViewer() {
  const noteKey = currentNoteKey;
  if (!noteKey) return;

  if (!confirm('Delete this note?')) return;

  deleteNote(noteKey);
  closeNoteViewer();
  renderSavedNotesList();

  showToast('Note deleted');
}

// --- Update notepad button indicator
export function updateNotepadButtonIndicator(sectionId) {
  const card = document.getElementById(sectionId);
  if (!card) return;

  const notepadBtn = card.querySelector('.card-notepad-btn');
  if (!notepadBtn) return;

  const notes = getNotesForSection(sectionId);
  notepadBtn.classList.toggle('has-note', notes.length > 0);
}

// Placeholder for toggleSavedNotesList (no longer needed but exported)
export function toggleSavedNotesList() {}

// --- Wire up notepad event listeners
export function wireNotepadEvents() {
  const closeBtn = $('#notepad-close');
  const cancelBtn = $('#notepad-cancel');
  const saveBtn = $('#notepad-save');
  const colorBtn = $('#notepad-color-btn');
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
  if (colorBtn) {
    colorBtn.addEventListener('click', openNoteColorPicker);
  }

  if (editor) {
    editor.addEventListener('keydown', handleEditorKeydown);
    editor.addEventListener('input', handleEditorInput);
    // Update toolbar state after keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+U)
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        // Delay to allow browser to process the formatting command
        setTimeout(updateToolbarState, 0);
      }
    });
    // @ mention autocomplete for linking existing tasks in card notes
    if (window.attachTaskMention) {
      window.attachTaskMention(editor, (task) => {
        if (window.updateTask) {
          window.updateTask(task.id, {
            noteHighlight: { sectionId: currentNotepadSectionId }
          });
        }
      });
    }

    // Highlighter context menu on notepad editor (with Link task)
    attachHighlighterContextMenu(editor, {
      linkTask: true,
      onTaskLinked: (task) => {
        if (window.updateTask) {
          window.updateTask(task.id, {
            noteHighlight: { sectionId: currentNotepadSectionId }
          });
        }
      }
    });

    // Click on task highlights in notepad editor to open linked task
    editor.addEventListener('click', (e) => {
      const highlight = e.target.closest('span.project-task-highlight');
      if (highlight && !highlight.classList.contains('completed')) {
        const taskId = highlight.dataset.taskId;
        if (taskId && window.openEditTaskModal) {
          window.openEditTaskModal(taskId);
        }
      }
    });
  }

  // Highlighter button in notepad toolbar
  const hlSlot = $('#notepad-highlighter-slot');
  if (hlSlot) {
    hlSlot.appendChild(createHighlighterButton());
  }

  // Toolbar button handlers
  const toolbarBtns = $$('.notepad-toolbar-btn');
  toolbarBtns.forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing focus from editor
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const command = btn.dataset.command;
      if (command) {
        document.execCommand(command, false, null);
        // Update active state
        updateToolbarState();
        // Refocus editor
        if (editor) editor.focus();
      }
    });
  });

  // Update toolbar state on selection change
  document.addEventListener('selectionchange', () => {
    const pop = $('#notepad-popover');
    if (pop && !pop.hidden) {
      updateToolbarState();
    }
  });

  // Click outside notepad: prompt for unsaved changes instead of auto-closing
  document.addEventListener('click', (e) => {
    const pop = $('#notepad-popover');
    if (!pop || pop.hidden) return;

    const isInsidePopover = e.target.closest('#notepad-popover');
    const isNotepadButton = e.target.closest('.card-notepad-btn');
    const isInsideViewer = e.target.closest('#note-viewer-modal');
    const isInsideColorPicker = e.target.closest('.link-color-popover');

    const isInsideHighlighter = e.target.closest('.highlight-context-menu') || e.target.closest('.highlighter-color-dropdown') || e.target.closest('.task-link-picker') || e.target.closest('.task-mention-dropdown');

    if (!isInsidePopover && !isNotepadButton && !isInsideViewer && !isInsideColorPicker && !isInsideHighlighter) {
      closeNotepad();
    }
  });

  // Wire up note viewer modal events
  const viewerCloseBtn = $('#note-viewer-close');
  const viewerEditBtn = $('#note-viewer-edit');
  const viewerDeleteBtn = $('#note-viewer-delete');
  const viewerBackdrop = document.querySelector('.note-viewer-backdrop');

  if (viewerCloseBtn) {
    viewerCloseBtn.addEventListener('click', closeNoteViewer);
  }
  if (viewerEditBtn) {
    viewerEditBtn.addEventListener('click', editNoteFromViewer);
  }
  if (viewerDeleteBtn) {
    viewerDeleteBtn.addEventListener('click', deleteNoteFromViewer);
  }
  const viewerCopyBtn = $('#note-viewer-copy');
  if (viewerCopyBtn) {
    viewerCopyBtn.addEventListener('click', copyNoteFromViewer);
  }
  if (viewerBackdrop) {
    viewerBackdrop.addEventListener('click', closeNoteViewer);
  }
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

// --- Check if cursor is inside a list (UL or OL)
function isInList() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;

  let node = selection.anchorNode;
  while (node && node !== document.body) {
    if (node.tagName === 'UL' || node.tagName === 'OL') return node;
    node = node.parentNode;
  }
  return null;
}

// --- Indent a list item: wrap it in a nested list under the previous sibling
// Supports up to 4 nesting levels (browser may allow more, but we cap it)
function indentListItem(li) {
  const parentList = li.parentNode; // UL or OL
  if (!parentList) return;

  // Don't indent if already 4 levels deep
  let depth = 0;
  let walk = parentList;
  while (walk) {
    if (walk.tagName === 'UL' || walk.tagName === 'OL') depth++;
    walk = walk.parentNode;
  }
  if (depth >= 4) return;

  // Must have a previous sibling LI to nest under
  const prevLi = li.previousElementSibling;
  if (!prevLi || prevLi.tagName !== 'LI') return;

  // Find or create a nested list inside the previous LI (same type as parent)
  const listTag = parentList.tagName; // UL or OL
  let nestedList = prevLi.querySelector(`:scope > ${listTag}`);
  if (!nestedList) {
    nestedList = document.createElement(listTag);
    prevLi.appendChild(nestedList);
  }

  // Move the LI into the nested list
  nestedList.appendChild(li);

  // Place cursor at start of the moved item
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(li, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// --- Outdent a list item: move it up one nesting level
function outdentListItem(li) {
  const parentList = li.parentNode; // UL or OL
  if (!parentList) return;

  const grandparentLi = parentList.parentNode;
  // Can only outdent if nested (parent list is inside another LI)
  if (!grandparentLi || grandparentLi.tagName !== 'LI') return;

  const outerList = grandparentLi.parentNode; // The outer UL or OL

  // Move any sibling LIs after this one into a new nested list under this LI
  const followingSiblings = [];
  let next = li.nextElementSibling;
  while (next) {
    followingSiblings.push(next);
    next = next.nextElementSibling;
  }
  if (followingSiblings.length > 0) {
    let subList = li.querySelector(`:scope > ${parentList.tagName}`);
    if (!subList) {
      subList = document.createElement(parentList.tagName);
      li.appendChild(subList);
    }
    followingSiblings.forEach(sib => subList.appendChild(sib));
  }

  // Insert this LI after the grandparent LI in the outer list
  if (grandparentLi.nextSibling) {
    outerList.insertBefore(li, grandparentLi.nextSibling);
  } else {
    outerList.appendChild(li);
  }

  // Clean up empty nested list
  if (parentList.children.length === 0) {
    parentList.remove();
  }

  // Place cursor at start of the moved item
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(li, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// --- Handle keydown in contenteditable editor
export function handleEditorKeydown(e) {
  const editor = e.target;

  if (e.key === 'Tab') {
    e.preventDefault();
    const li = isInListItem();

    if (li) {
      if (e.shiftKey) {
        outdentListItem(li);
      } else {
        indentListItem(li);
      }
    }
    return;
  }

  if (e.key === 'Backspace') {
    const li = isInListItem();
    if (li) {
      // Check if cursor is at the very beginning of the list item
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const isAtStart = isCursorAtStartOfElement(li, range);

      if (isAtStart) {
        e.preventDefault();

        const ul = li.parentNode;
        const parentLi = ul.parentNode.tagName === 'LI' ? ul.parentNode : null;

        // Create a div with the list item's content
        const div = document.createElement('div');
        while (li.firstChild) {
          div.appendChild(li.firstChild);
        }
        if (!div.hasChildNodes()) {
          div.innerHTML = '<br>';
        }

        // Get position of this li among siblings
        const liIndex = Array.from(ul.children).indexOf(li);
        const isFirstItem = liIndex === 0;
        const isLastItem = liIndex === ul.children.length - 1;

        li.remove();

        if (parentLi) {
          // Nested list: insert after parent li
          if (parentLi.nextSibling) {
            parentLi.parentNode.insertBefore(div, parentLi.nextSibling);
          } else {
            parentLi.parentNode.appendChild(div);
          }
        } else if (isFirstItem) {
          // First item: insert before the ul
          ul.parentNode.insertBefore(div, ul);
        } else {
          // Middle or last item: insert after the ul
          if (ul.nextSibling) {
            ul.parentNode.insertBefore(div, ul.nextSibling);
          } else {
            ul.parentNode.appendChild(div);
          }
        }

        // Remove empty ul if needed
        if (ul.children.length === 0) {
          ul.remove();
        }

        // Place cursor at start of the new div
        const newRange = document.createRange();
        newRange.setStart(div, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        return;
      }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    const li = isInListItem();
    if (li) {
      // Check if the list item is empty
      const text = li.textContent.trim();
      if (!text) {
        e.preventDefault();
        const ul = li.parentNode;
        const parentLi = ul.parentNode.tagName === 'LI' ? ul.parentNode : null;

        if (parentLi) {
          // Nested list: outdent the empty item (move up one level)
          li.remove();
          if (ul.children.length === 0) ul.remove();
          // Create a new empty LI in the parent list
          const outerList = parentLi.parentNode;
          const newLi = document.createElement('li');
          newLi.appendChild(document.createElement('br'));
          if (parentLi.nextSibling) {
            outerList.insertBefore(newLi, parentLi.nextSibling);
          } else {
            outerList.appendChild(newLi);
          }
          const range = document.createRange();
          range.setStart(newLi, 0);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          // Top-level list: exit the list
          li.remove();
          if (ul.children.length === 0) {
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
        }
        return;
      }
    }
  }
}

// --- Check if cursor is at the very start of an element
function isCursorAtStartOfElement(element, range) {
  if (!range.collapsed) return false;

  // Check if cursor is at offset 0
  if (range.startOffset !== 0) return false;

  // Walk up from the cursor position to see if we're at the start
  let node = range.startContainer;
  while (node && node !== element) {
    // If this node has previous siblings with content, we're not at start
    let prev = node.previousSibling;
    while (prev) {
      if (prev.textContent && prev.textContent.length > 0) {
        return false;
      }
      prev = prev.previousSibling;
    }
    node = node.parentNode;
  }

  return true;
}

// --- Update toolbar button active states
function updateToolbarState() {
  const toolbarBtns = $$('.notepad-toolbar-btn');
  toolbarBtns.forEach(btn => {
    const command = btn.dataset.command;
    if (command) {
      const isActive = document.queryCommandState(command);
      btn.classList.toggle('active', isActive);
    }
  });
}

// --- Handle input in contenteditable to auto-convert markdown patterns
export function handleEditorInput(e) {
  const editor = e.target;
  const selection = window.getSelection();
  if (!selection.rangeCount) { return; }

  const range = selection.getRangeAt(0);
  let node = range.startContainer;

  // Only process text nodes
  if (node.nodeType !== Node.TEXT_NODE) return;

  // Normalize non-breaking spaces to regular spaces for pattern matching
  const text = node.textContent.replace(/\u00A0/g, ' ');

  // Check for markdown heading patterns (# ## ### etc. followed by space)
  const headingMatch = text.match(/^(#{1,6}) $/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const cursorAtEnd = range.startOffset === node.textContent.length;
    if (cursorAtEnd) {
      convertToHeading(editor, node, level, selection);
      return;
    }
  }

  // Check for numbered list pattern (only "1. " triggers conversion)
  const numberedMatch = text.match(/^1\. $/);
  if (numberedMatch && !isInList()) {
    const cursorAtEnd = range.startOffset === node.textContent.length;
    if (cursorAtEnd) {
      convertToNumberedList(editor, node, selection);
      return;
    }
  }

  // Check for bullet list patterns (* or -)
  const bulletMatch = text.match(/^[*\-] $/);
  if (!bulletMatch) return;

  // Cursor must be at the end
  const cursorAtEndBullet = range.startOffset === node.textContent.length;
  if (!cursorAtEndBullet) return;

  // Check if we're not already in a list
  if (isInList()) return;

  // Find the block element containing this text (div created by Enter key)
  let blockToReplace = node.parentElement;

  // If parent is the editor itself (text node is a direct child)
  if (blockToReplace === editor) {
    // Create a new list and replace only the text node
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.appendChild(document.createElement('br')); // Empty li needs br for cursor
    ul.appendChild(li);
    editor.replaceChild(ul, node);

    // Place cursor in the list item
    const newRange = document.createRange();
    newRange.setStart(li, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return;
  }

  // Block must be a div or p that's a direct child of the editor
  if ((blockToReplace.tagName !== 'DIV' && blockToReplace.tagName !== 'P') ||
      blockToReplace.parentElement !== editor) {
    return;
  }

  // Verify this block ONLY contains "* " or "- " (no other content)
  const blockContent = blockToReplace.textContent.replace(/\u00A0/g, ' ');
  if (!/^[*\-] $/.test(blockContent)) return;

  // Create a new list item
  const ul = document.createElement('ul');
  const li = document.createElement('li');
  li.appendChild(document.createElement('br')); // Empty li needs br for cursor
  ul.appendChild(li);

  // Replace the block with the list
  blockToReplace.parentElement.replaceChild(ul, blockToReplace);

  // Place cursor in the list item
  const newRange = document.createRange();
  newRange.setStart(li, 0);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);
}

// --- Convert text to heading (h1-h6)
function convertToHeading(editor, textNode, level, selection) {
  let blockToReplace = textNode.parentElement;

  // If parent is the editor itself (text node is a direct child)
  if (blockToReplace === editor) {
    const heading = document.createElement(`h${level}`);
    heading.appendChild(document.createElement('br'));
    // Replace only the text node, preserving all other editor content
    editor.replaceChild(heading, textNode);

    const newRange = document.createRange();
    newRange.setStart(heading, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return;
  }

  // Block must be a div or p that's a direct child of the editor
  if ((blockToReplace.tagName !== 'DIV' && blockToReplace.tagName !== 'P') ||
      blockToReplace.parentElement !== editor) {
    return;
  }

  // Verify this block ONLY contains the heading trigger (no other meaningful content)
  const blockContent = blockToReplace.textContent.replace(/\u00A0/g, ' ');
  if (!/^#{1,6} $/.test(blockContent)) return;

  // Create the heading element
  const heading = document.createElement(`h${level}`);
  heading.appendChild(document.createElement('br'));

  // Replace the block with the heading
  blockToReplace.parentElement.replaceChild(heading, blockToReplace);

  // Place cursor in the heading
  const newRange = document.createRange();
  newRange.setStart(heading, 0);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);
}

// --- Convert text to numbered list
function convertToNumberedList(editor, textNode, selection) {
  let blockToReplace = textNode.parentElement;

  // If parent is the editor itself (text node is a direct child)
  if (blockToReplace === editor) {
    const ol = document.createElement('ol');
    const li = document.createElement('li');
    li.appendChild(document.createElement('br'));
    ol.appendChild(li);
    // Replace only the text node, preserving all other editor content
    editor.replaceChild(ol, textNode);

    const newRange = document.createRange();
    newRange.setStart(li, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return;
  }

  // Block must be a div or p that's a direct child of the editor
  if ((blockToReplace.tagName !== 'DIV' && blockToReplace.tagName !== 'P') ||
      blockToReplace.parentElement !== editor) {
    return;
  }

  // Create a numbered list
  const ol = document.createElement('ol');
  const li = document.createElement('li');
  li.appendChild(document.createElement('br'));
  ol.appendChild(li);

  // Replace the block with the list
  blockToReplace.parentElement.replaceChild(ol, blockToReplace);

  // Place cursor in the list item
  const newRange = document.createRange();
  newRange.setStart(li, 0);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);
}

// ============================================================
// TEXT HIGHLIGHTER (shared across all rich-text editors)
// ============================================================

const HIGHLIGHT_PASTEL_COLORS = [
  { name: 'Yellow', color: 'rgba(253, 230, 138, 0.6)', dark: 'rgba(253, 230, 138, 0.3)' },
  { name: 'Green',  color: 'rgba(167, 243, 208, 0.6)', dark: 'rgba(167, 243, 208, 0.3)' },
  { name: 'Blue',   color: 'rgba(191, 219, 254, 0.6)', dark: 'rgba(191, 219, 254, 0.3)' },
  { name: 'Pink',   color: 'rgba(252, 205, 213, 0.6)', dark: 'rgba(252, 205, 213, 0.3)' },
  { name: 'Purple', color: 'rgba(221, 204, 255, 0.6)', dark: 'rgba(221, 204, 255, 0.3)' }
];

let activeHighlightColor = HIGHLIGHT_PASTEL_COLORS[0];
let highlightContextMenu = null;

// Task highlight colors (duplicated from projects.js to avoid circular import)
const TASK_HIGHLIGHT_BG = {
  blue: 'rgba(59, 130, 246, 0.25)',
  yellow: 'rgba(234, 179, 8, 0.25)',
  orange: 'rgba(249, 115, 22, 0.25)',
  red: 'rgba(239, 68, 68, 0.25)'
};
const TASK_HIGHLIGHT_BORDER = {
  blue: 'rgba(59, 130, 246, 0.6)',
  yellow: 'rgba(234, 179, 8, 0.6)',
  orange: 'rgba(249, 115, 22, 0.6)',
  red: 'rgba(239, 68, 68, 0.6)'
};
const TASK_LINK_COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];

function getHighlightContextMenu() {
  if (highlightContextMenu) return highlightContextMenu;
  highlightContextMenu = document.createElement('div');
  highlightContextMenu.className = 'highlight-context-menu';
  highlightContextMenu.style.display = 'none';
  highlightContextMenu.innerHTML = `
    <button type="button" class="highlight-context-item ctx-bold-btn">
      <strong>B</strong>
      Bold
    </button>
    <button type="button" class="highlight-context-item ctx-italic-btn">
      <em>I</em>
      Italic
    </button>
    <button type="button" class="highlight-context-item ctx-underline-btn">
      <u>U</u>
      Underline
    </button>
    <div class="highlight-context-divider"></div>
    <button type="button" class="highlight-context-item highlight-apply-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>
      Highlight
    </button>
    <button type="button" class="highlight-context-item highlight-remove-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      Remove highlight
    </button>
    <div class="highlight-context-divider ctx-link-task-divider"></div>
    <button type="button" class="highlight-context-item ctx-link-task-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="12" y1="18" x2="12" y2="12"></line>
        <line x1="9" y1="15" x2="15" y2="15"></line>
      </svg>
      Link task
    </button>
  `;
  document.body.appendChild(highlightContextMenu);
  highlightContextMenu.addEventListener('mousedown', e => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (!highlightContextMenu.contains(e.target)) {
      highlightContextMenu.style.display = 'none';
    }
  });
  return highlightContextMenu;
}

function hideHighlightContextMenu() {
  const menu = getHighlightContextMenu();
  menu.style.display = 'none';
  hideTaskLinkPicker();
}

// ---- Task Link Picker (for "Link task" context menu item) ----
let taskLinkPicker = null;

function getTaskLinkPicker() {
  if (taskLinkPicker) return taskLinkPicker;
  taskLinkPicker = document.createElement('div');
  taskLinkPicker.className = 'task-link-picker';
  taskLinkPicker.style.display = 'none';
  taskLinkPicker.addEventListener('mousedown', e => e.preventDefault());
  document.body.appendChild(taskLinkPicker);
  document.addEventListener('click', (e) => {
    if (taskLinkPicker && !taskLinkPicker.contains(e.target) &&
        !e.target.closest('.highlight-context-menu')) {
      hideTaskLinkPicker();
    }
  });
  return taskLinkPicker;
}

function hideTaskLinkPicker() {
  const picker = getTaskLinkPicker();
  picker.style.display = 'none';
}

function showTaskLinkPicker(x, y, editor, savedRange, onTaskLinked) {
  const picker = getTaskLinkPicker();
  const allTasks = window.getAllTasks ? window.getAllTasks().filter(t => !t.completed) : [];

  if (allTasks.length === 0) {
    picker.innerHTML = '<div class="task-link-picker-empty">No tasks available</div>';
    picker.style.left = `${x}px`;
    picker.style.top = `${y}px`;
    picker.style.display = 'flex';
    return;
  }

  picker.innerHTML = '<input type="text" class="task-link-picker-filter" placeholder="Filter tasks...">';
  const filterInput = picker.querySelector('.task-link-picker-filter');
  const colsWrap = document.createElement('div');
  colsWrap.className = 'task-link-picker-cols';
  picker.appendChild(colsWrap);

  function renderTasks(query) {
    colsWrap.innerHTML = '';
    const lower = (query || '').toLowerCase();
    const filtered = lower ? allTasks.filter(t => (t.title || '').toLowerCase().includes(lower)) : allTasks;

    if (filtered.length === 0) {
      colsWrap.innerHTML = '<div class="task-link-picker-empty">No matching tasks</div>';
      return;
    }

    TASK_LINK_COLOR_ORDER.forEach(color => {
      const colorTasks = filtered.filter(t => t.color === color).sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.order || 0) - (b.order || 0);
      });
      if (colorTasks.length === 0) return;

      const col = document.createElement('div');
      col.className = 'task-link-picker-col';

      colorTasks.forEach(task => {
        const item = document.createElement('div');
        item.className = `task-mention-item task-bubble-${color}`;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'task-mention-item-title';
        titleSpan.textContent = task.title || 'Untitled';
        item.appendChild(titleSpan);
        if (task.pinned) {
          const badge = document.createElement('span');
          badge.className = 'task-mention-primary-badge';
          badge.textContent = 'P';
          item.appendChild(badge);
        }
        item.addEventListener('click', () => {
          // Wrap the saved selection with a task highlight span
          try {
            const span = document.createElement('span');
            span.className = 'project-task-highlight';
            span.dataset.taskId = task.id;
            span.dataset.highlightColor = task.color;
            span.style.backgroundColor = TASK_HIGHLIGHT_BG[task.color];
            span.style.borderBottom = `2px solid ${TASK_HIGHLIGHT_BORDER[task.color]}`;
            span.style.cursor = 'pointer';
            span.contentEditable = 'false';

            try {
              savedRange.surroundContents(span);
            } catch (err) {
              const contents = savedRange.extractContents();
              span.appendChild(contents);
              savedRange.insertNode(span);
            }
          } catch (err) { /* range may be stale */ }

          hideTaskLinkPicker();
          hideHighlightContextMenu();
          if (onTaskLinked) onTaskLinked(task);
        });
        col.appendChild(item);
      });
      colsWrap.appendChild(col);
    });
  }

  renderTasks('');
  filterInput.addEventListener('input', () => renderTasks(filterInput.value));

  // Show offscreen to measure, then clamp to viewport
  picker.style.visibility = 'hidden';
  picker.style.display = 'flex';
  picker.style.left = '0px';
  picker.style.top = '0px';
  const pw = picker.offsetWidth;
  const ph = picker.offsetHeight;
  picker.style.visibility = '';

  let left = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
  let top = Math.max(8, Math.min(y, window.innerHeight - ph - 8));
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
  filterInput.focus();
}

function applyHighlightToSelection(editor) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bg = isDark ? activeHighlightColor.dark : activeHighlightColor.color;

  const mark = document.createElement('mark');
  mark.className = 'text-highlight';
  mark.style.backgroundColor = bg;
  mark.dataset.highlightColor = activeHighlightColor.name.toLowerCase();

  try {
    range.surroundContents(mark);
  } catch (e) {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }

  // Move cursor after the mark so subsequent typing is unhighlighted
  const spacer = document.createTextNode('\u200B');
  if (mark.nextSibling) {
    mark.parentNode.insertBefore(spacer, mark.nextSibling);
  } else {
    mark.parentNode.appendChild(spacer);
  }
  const newRange = document.createRange();
  newRange.setStartAfter(spacer);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);

  hideHighlightContextMenu();
}

function removeHighlightFromSelection(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const node = sel.anchorNode;
  if (!node || !editor.contains(node)) return;

  const mark = node.nodeType === Node.TEXT_NODE
    ? node.parentElement?.closest('mark.text-highlight')
    : node.closest?.('mark.text-highlight');

  if (mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }

  sel.removeAllRanges();
  hideHighlightContextMenu();
}

/**
 * Create a highlighter button with color picker dropdown for a toolbar.
 */
export function createHighlighterButton() {
  const wrapper = document.createElement('div');
  wrapper.className = 'highlighter-btn-wrapper';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'highlighter-toolbar-btn';
  btn.title = 'Highlighter';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>
    <span class="highlighter-color-indicator"></span>
  `;

  const indicator = btn.querySelector('.highlighter-color-indicator');
  indicator.style.backgroundColor = activeHighlightColor.color;

  const dropdown = document.createElement('div');
  dropdown.className = 'highlighter-color-dropdown';
  dropdown.style.display = 'none';

  HIGHLIGHT_PASTEL_COLORS.forEach(c => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'highlighter-swatch';
    if (c.name === activeHighlightColor.name) swatch.classList.add('active');
    swatch.style.backgroundColor = c.color;
    swatch.title = c.name;
    swatch.addEventListener('mousedown', e => e.preventDefault());
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      activeHighlightColor = c;
      document.querySelectorAll('.highlighter-color-indicator').forEach(ind => {
        ind.style.backgroundColor = c.color;
      });
      document.querySelectorAll('.highlighter-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.title === c.name);
      });
      dropdown.style.display = 'none';
    });
    dropdown.appendChild(swatch);
  });

  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.highlighter-color-dropdown').forEach(d => {
      if (d !== dropdown) d.style.display = 'none';
    });
    dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
  });

  document.addEventListener('click', () => { dropdown.style.display = 'none'; });

  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);
  return wrapper;
}

/**
 * Attach right-click context menu to a contenteditable editor.
 * @param {HTMLElement} editor
 * @param {Object} [options]
 * @param {boolean} [options.linkTask] - Show "Link task" option
 * @param {Function} [options.onTaskLinked] - Called with (task) after linking
 */
export function attachHighlighterContextMenu(editor, options) {
  const opts = options || {};

  editor.addEventListener('contextmenu', (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (!sel.toString().trim()) return;

    e.preventDefault();
    hideTaskLinkPicker();

    const menu = getHighlightContextMenu();
    const savedRange = range.cloneRange();

    // --- Bold / Italic / Underline ---
    function rewire(selector, handler) {
      const old = menu.querySelector(selector);
      const btn = old.cloneNode(true);
      old.parentNode.replaceChild(btn, old);
      btn.addEventListener('mousedown', ev => ev.preventDefault());
      btn.addEventListener('click', handler);
      return btn;
    }

    rewire('.ctx-bold-btn', () => { document.execCommand('bold'); hideHighlightContextMenu(); });
    rewire('.ctx-italic-btn', () => { document.execCommand('italic'); hideHighlightContextMenu(); });
    rewire('.ctx-underline-btn', () => { document.execCommand('underline'); hideHighlightContextMenu(); });

    // --- Highlight / Remove highlight ---
    rewire('.highlight-apply-btn', () => applyHighlightToSelection(editor));
    const removeBtn = rewire('.highlight-remove-btn', () => removeHighlightFromSelection(editor));

    const anchor = sel.anchorNode;
    const inHighlight = anchor && (
      anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement?.closest('mark.text-highlight')
        : anchor.closest?.('mark.text-highlight')
    );
    removeBtn.style.display = inHighlight ? '' : 'none';

    // --- Link task ---
    const linkTaskBtn = menu.querySelector('.ctx-link-task-btn');
    const linkTaskDivider = menu.querySelector('.ctx-link-task-divider');
    if (opts.linkTask) {
      linkTaskDivider.style.display = '';
      const newLinkBtn = linkTaskBtn.cloneNode(true);
      linkTaskBtn.parentNode.replaceChild(newLinkBtn, linkTaskBtn);
      newLinkBtn.style.display = '';
      newLinkBtn.addEventListener('mousedown', ev => ev.preventDefault());
      newLinkBtn.addEventListener('click', () => {
        const rect = newLinkBtn.getBoundingClientRect();
        showTaskLinkPicker(rect.right + 4, rect.top, editor, savedRange, opts.onTaskLinked);
      });
    } else {
      linkTaskDivider.style.display = 'none';
      linkTaskBtn.style.display = 'none';
    }

    // Show offscreen to measure, then clamp to viewport
    menu.style.visibility = 'hidden';
    menu.style.display = '';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.visibility = '';

    const menuLeft = Math.max(8, Math.min(e.clientX, window.innerWidth - mw - 8));
    const menuTop = Math.max(8, Math.min(e.clientY, window.innerHeight - mh - 8));
    menu.style.left = `${menuLeft}px`;
    menu.style.top = `${menuTop}px`;
  });
}
