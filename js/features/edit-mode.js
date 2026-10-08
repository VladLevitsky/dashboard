// Personal Dashboard - Edit Mode Module
// Handles edit state toggling, popovers, and edit-related UI

import { model, editState, currentData, currentSections } from '../state.js';
import { $, deepClone, showToast, getColorForCurrentMode, setColorForCurrentMode, moveCursorAfterNode } from '../utils.js';
import { saveModel } from '../core/storage.js';
import { attachImageUpload } from './rich-text-images.js';
import { api as writingApi, attachWritingFeatures, attachWritingView } from './writing/editor.js';
import { cleanEditorHtml, isEffectivelyEmpty, unwrapInline, replaceRangeHtml, trimRangeEnd, expandToWholeInlines } from './writing/dom.js';
import { keyHint, isMacPlatform } from '../core/writing-commands.js';
import { sanitizeRichHtml, htmlHasRiskyStartTag } from '../core/markdown.js';
import { getActiveMode } from './grid-engine.js';

// --- Stored rich text about to go through innerHTML (defense in depth: import
// and load sanitize too). Markup that could run code goes through the
// allowlist sanitizer; everything else is kept exactly as saved. Only real
// start tags are read (tokenized like the browser does), so a plain-text note
// with code or escaped HTML in it ('const onLoad =', '&lt;a onclick=') shows
// as it is. Saved HTML comes from innerHTML, which never writes numeric
// entities, so '&#' in an attribute value (an obfuscated "javascript:") counts
// as suspicious too. A cleaned note keeps its newlines and indents (pre-wrap)
const RISKY_TAG = /^(script|iframe|frame|frameset|object|embed|applet|portal|style|svg|math|link|meta|base|form|template|noscript)$/;
const RISKY_VALUE = /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|vbscript\s*:|data\s*:\s*text\/html|&#|&(colon|tab|newline);/i;
// Handler-like text anywhere inside the tag counts too (<img/src=x/onerror=...>)
const RISKY_HANDLER = /[\s"'/]on[a-z]+\s*=/i;
const isRiskyRichHtml = (s) => htmlHasRiskyStartTag(s, (tag, attrs, source) => RISKY_TAG.test(tag) || RISKY_HANDLER.test(source) ||
  attrs.some(([name, value]) => name.startsWith('on') || (value != null && RISKY_VALUE.test(value))));
export function safeRichHtml(html) {
  const s = html == null ? '' : String(html);
  return s && isRiskyRichHtml(s) ? sanitizeRichHtml(s, { keepWhitespace: true }) : s;
}

// --- Toggle Edit Mode
export function toggleEditMode() {
  // The Mobile layout has no card editing (the shell shows no grid); leaving
  // edit mode always works
  if (!editState.enabled && getActiveMode() === 'mobile') {
    showToast('Card editing is on the tablet and desktop layouts');
    return;
  }

  // Find the card closest to the center of the viewport to restore position after render
  const viewportCenter = window.scrollY + window.innerHeight / 2;
  let closestCard = null;
  let closestDistance = Infinity;

  document.querySelectorAll('.card').forEach(card => {
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
  const addCardFab = $('#add-card-fab');
  if (addCardFab) addCardFab.hidden = !editState.enabled;

  // Toggle tile mode on the grid container
  const appMain = $('.app-main');
  if (appMain) {
    appMain.classList.toggle('edit-mode-tiles', editState.enabled);
  }

  // Recompute grid cell sizes (edit mode uses square cells, view mode uses auto rows)
  if (window.applyCellSize) window.applyCellSize();

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

  // Task timers read tasks from the working copy while editing: repaint them
  // (and close a timer whose task only existed in a cancelled edit)
  if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();

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
  // Undo the live invert preview; a saved change re-renders from the model
  if (editState.invertPreview) {
    const { els, original } = editState.invertPreview;
    els.forEach(el => el.classList.toggle('invert-dark', original));
    editState.invertPreview = null;
  }
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

  // "Invert colors in dark mode" toggle (icons only, shown in dark mode only since
  // it has no effect in light mode); flipping it previews on the icon
  const invertField = $('#edit-invert-dark-field');
  const invertInput = $('#edit-invert-dark');
  if (invertField && invertInput) {
    const showInvert = values.allowInvertDark === true && document.body.dataset.theme === 'dark';
    invertField.hidden = !showInvert;
    invertInput.checked = showInvert && values.invertDark === true;
    const previewEls = showInvert ? [...targetEl.querySelectorAll(':scope > img, :scope > .icon-emoji')] : [];
    editState.invertPreview = previewEls.length ? { els: previewEls, original: invertInput.checked } : null;
    invertInput.onchange = () => {
      if (editState.invertPreview) {
        editState.invertPreview.els.forEach(el => el.classList.toggle('invert-dark', invertInput.checked));
      }
    };
  }
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
        if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();

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
// In tile mode (edit-mode-tiles), cards on the grid do NOT get .editing —
// they render as view-mode to preserve real proportions. Only the modal card gets .editing.
export function refreshEditingClasses() {
  const main = document.querySelector('.app-main');
  const isTileMode = main && main.classList.contains('edit-mode-tiles');

  document.querySelectorAll('.card').forEach(card => {
    // Cards inside the modal always follow editState; grid cards never get .editing in tile mode
    const isInModal = card.closest('.card-edit-modal');
    if (isTileMode && !isInModal) {
      card.classList.remove('editing');
    } else {
      card.classList.toggle('editing', editState.enabled);
    }
  });
  document.querySelectorAll('.editable').forEach(el => {
    const isInModal = el.closest('.card-edit-modal');
    if (isTileMode && !isInModal) {
      el.classList.remove('editing');
    } else {
      el.classList.toggle('editing', editState.enabled);
    }
  });
}

// --- Mark dirty and save (for edit operations)
export function markDirtyAndSave() {
  editState.dirty = true;

  // Keep the active device-layout profile in sync with the flat working
  // layout after every mutation (drop, resize, reconcile, add/delete card).
  if (window.persistActiveLayout && window.currentSections) {
    window.persistActiveLayout(window.currentSections());
  }

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
let currentNoteContextType = null; // 'card' or 'subtask'
let currentSubtaskNoteId = null; // For subtask notes: "sectionId:subtitle:itemKey"
let viewerNoteKey = null; // Note shown in the viewer (kept apart from the one being edited)
let closeNoteColorPicker = null; // Set while the bubble color picker is open
let notepadOpener = null; // Element focused before the notepad opened (focus returns there)

// Note fields beyond { key, title, content, color } (all optional, saved as-is):
// pinned (true, key deleted when off), createdAt / updatedAt (epoch ms).
// updatedAt moves only when the title or content really changed.

// Pushpin glyph: bubbles of pinned notes, the viewer's Pin button
const NOTE_PIN_PATH = '<path d="M9 3h6l-1.2 5.6L17 11.5V14H7v-2.5l3.2-2.9z"/><line x1="12" y1="14" x2="12" y2="21"/>';
const NOTE_PIN_ICON = `<svg class="notepad-bubble-pin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${NOTE_PIN_PATH}</svg>`;

// Escape for HTML attributes (quotes too)
function noteAttr(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A stored bubble color is used only when it is a plain color value
function safeNoteColor(color) {
  return typeof color === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color.trim()) ? color.trim() : null;
}

function noteTime(note) {
  return Number(note && (note.updatedAt || note.createdAt)) || 0;
}

// Pinned first, then most recently edited. Notes from before timestamps come
// after, newest first (they were appended, so the array end is the newest).
function sortNotesForList(notes) {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => (Number(!!b.note.pinned) - Number(!!a.note.pinned)) ||
      (noteTime(b.note) - noteTime(a.note)) || (b.index - a.index))
    .map(entry => entry.note);
}

// Checklist progress of a note's HTML: { done, total } or null (no checklist).
// Every checklist item counts, nested ones too.
const noteProgressCache = new Map();
function noteChecklistProgress(html) {
  if (!html || html.indexOf('checklist') === -1) return null;
  if (noteProgressCache.has(html)) return noteProgressCache.get(html);
  const temp = document.createElement('template');
  temp.innerHTML = html;
  const items = temp.content.querySelectorAll('ul.checklist > li');
  const result = items.length
    ? { done: [...items].filter(li => li.classList.contains('checked')).length, total: items.length }
    : null;
  if (noteProgressCache.size > 300) noteProgressCache.clear();
  noteProgressCache.set(html, result);
  return result;
}

// "just now", "5m ago", "3h ago", "yesterday", "4d ago", "Sep 28", "Sep 28, 2025"
function formatNoteTime(ms, now = Date.now()) {
  const diff = now - ms;
  if (diff < 45000) return 'just now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  const then = new Date(ms);
  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= dayStart) return `${Math.max(1, Math.round(diff / 3600000))}h ago`;
  const days = Math.round((dayStart - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86400000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const opts = { month: 'short', day: 'numeric' };
  if (then.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString(undefined, opts);
}

function formatNoteDate(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Created Sep 28, 2026, 2:05 PM · Edited Oct 3, 2026, 9:12 AM" (only what is known)
function noteDatesTooltip(note) {
  const parts = [];
  if (note.createdAt) parts.push(`Created ${formatNoteDate(note.createdAt)}`);
  if (note.updatedAt && note.updatedAt !== note.createdAt) parts.push(`Edited ${formatNoteDate(note.updatedAt)}`);
  return parts.join(' · ');
}

// Where the open notepad's notes live
function noteStoreContext() {
  return { sectionId: currentNotepadSectionId, type: currentNoteContextType, subtaskId: currentSubtaskNoteId };
}

// Write a notes array back to the model (mirrored into the edit-mode working
// copy, like saveNote always did) and save. Notes never wait for Confirm.
function storeNotes(notes, ctx = noteStoreContext()) {
  const isSubtask = ctx.type === 'subtask' && ctx.subtaskId;
  const bucket = isSubtask ? 'subtaskNotes' : 'cardNotes';
  const id = isSubtask ? ctx.subtaskId : ctx.sectionId;
  if (!model[bucket] || typeof model[bucket] !== 'object') model[bucket] = {};
  model[bucket][id] = notes;
  if (editState.working) {
    if (!editState.working[bucket]) editState.working[bucket] = {};
    editState.working[bucket][id] = [...notes];
  }
  saveModel();
}

// Card button / subtask item indicators after a change
function refreshNoteIndicators(ctx = noteStoreContext()) {
  if (ctx.type === 'subtask' && ctx.subtaskId) {
    if (window.renderAllSections) window.renderAllSections();
  } else if (ctx.sectionId) {
    updateNotepadButtonIndicator(ctx.sectionId);
  }
}

// "Card title" or "Subtask text" shown next to the notepad heading
function notepadContextLabel(sectionId, contextType, subtaskId) {
  const section = currentSections().find(s => s.id === sectionId);
  if (contextType === 'subtask' && subtaskId) {
    const id = String(subtaskId);
    const first = id.indexOf(':');
    const last = id.lastIndexOf(':');
    const subtitle = first >= 0 && last > first ? id.slice(first + 1, last) : '';
    const itemKey = last >= 0 ? id.slice(last + 1) : '';
    const data = currentData();
    const item = data[sectionId]?.[subtitle]?.subtasks?.find(s => s.key === itemKey);
    if (item && item.text) return item.text;
  }
  return section ? section.title || '' : '';
}

// --- Generate unique key for notes
function generateNoteKey() {
  return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// --- Get notes array for a section or subtask (handles migration from old string format)
export function getNotesForSection(sectionId, contextType = 'card', subtaskId = null) {
  if (contextType === 'subtask' && subtaskId) {
    if (!model.subtaskNotes) return [];
    const notes = model.subtaskNotes[subtaskId];
    if (!notes) return [];
    return Array.isArray(notes) ? notes : [];
  }

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

  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);

  if (notes.length === 0) {
    listContainer.hidden = true;
    listContainer.textContent = '';
    return;
  }

  listContainer.hidden = false;
  const defaultBgColor = model.darkMode ? '#475569' : '#e6f3ff';
  const now = Date.now();
  // Pinned first (pin glyph), then most recently edited; checklist progress
  // on the bubble, "Edited …" in its tooltip
  listContainer.innerHTML = sortNotesForList(notes).map(note => {
    const bgColor = safeNoteColor(note.color) || defaultBgColor;
    const title = note.title || 'Untitled';
    const progress = noteChecklistProgress(note.content);
    const time = noteTime(note);
    const tip = [
      title,
      note.pinned ? 'Pinned' : '',
      time ? `Edited ${formatNoteTime(time, now)}` : '',
      progress ? `${progress.done} of ${progress.total} checked` : ''
    ].filter(Boolean).join(' · ');
    return `<button type="button" class="notepad-saved-bubble${note.pinned ? ' is-pinned' : ''}" data-key="${noteAttr(note.key)}" style="background: ${bgColor}" title="${noteAttr(tip)}">` +
      (note.pinned ? NOTE_PIN_ICON : '') +
      `<span class="notepad-bubble-title">${escapeHtml(title)}</span>` +
      (progress ? `<span class="notepad-bubble-progress${progress.done === progress.total ? ' is-done' : ''}" aria-label="${progress.done} of ${progress.total} checked">${progress.done}/${progress.total}</span>` : '') +
      '</button>';
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

  // The button toggles: a second click closes the open picker
  if (closeNoteColorPicker) {
    closeNoteColorPicker();
    return;
  }

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
  picker.className = 'link-color-popover notepad-color-popover';
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
    if (closeNoteColorPicker === closePicker) closeNoteColorPicker = null;
  };
  closeNoteColorPicker = closePicker; // Esc / closing the notepad close it too

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
export function openNotepad(sectionId, cursorPos, contextType = 'card', subtaskId = null) {
  const pop = $('#notepad-popover');
  if (!pop) return;

  // Already open with unsaved edits (another card's button, a search result...)
  if (!pop.hidden && notepadHasChanges() && !confirm('You have unsaved changes. Discard them?')) return;
  if (closeNoteColorPicker) closeNoteColorPicker();
  closeNoteViewer();
  if (pop.hidden) {
    const active = document.activeElement;
    notepadOpener = active && active !== document.body && !pop.contains(active) ? active : null;
  }

  currentNotepadSectionId = sectionId;
  currentNoteKey = null;
  currentNoteContextType = contextType;
  currentSubtaskNoteId = subtaskId;

  // Update header text based on context, with the card / subtask it belongs to
  const header = pop.querySelector('.notepad-popover-header h4');
  if (header) {
    header.textContent = contextType === 'subtask' ? 'Subtask Notes' : 'Card Notes';
    const where = notepadContextLabel(sectionId, contextType, subtaskId);
    header.title = where;
    pop.setAttribute('aria-label', header.textContent + (where ? ` · ${where}` : ''));
    if (where) {
      const span = document.createElement('span');
      span.className = 'notepad-context';
      span.textContent = where;
      header.appendChild(span);
    }
  }

  // Render saved notes at top
  renderSavedNotesList();

  // Clear editor for new note
  clearNotepadEditor();

  // Make visible to measure size
  pop.hidden = false;

  // Phones: a sheet pinned to the top of the screen (CSS), not a popover at the
  // tap point that can run below the fold
  const asSheet = window.innerWidth <= 600 || document.documentElement.dataset.shell === 'mobile';
  pop.classList.toggle('notepad-sheet', asSheet);
  if (asSheet) {
    pop.style.left = '';
    pop.style.top = '';
  }

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

  if (!asSheet) {
    pop.style.left = `${leftPos}px`;
    pop.style.top = `${topPos}px`;
  }

  // Capture initial state for unsaved changes detection
  notepadInitialState = { title: '', content: '' };
  const notepadEditor = $('#notepad-editor');
  if (notepadEditor && notepadEditor._wr) notepadEditor._wr.loaded();

  // Focus title input (not when the note viewer opened over it meanwhile, or
  // focus already moved into the notepad: no stray keyboard on phones)
  setTimeout(() => {
    const v = $('#note-viewer-modal');
    if ((v && !v.hidden) || pop.contains(document.activeElement)) return;
    const titleInput = $('#notepad-title');
    if (titleInput) titleInput.focus();
  }, 50);
}

// --- Enter edit mode for existing note
export function enterNotepadEditMode(noteKey) {
  if (!noteKey) return;
  currentNoteKey = noteKey;

  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
  const note = notes.find(n => n.key === noteKey);
  if (!note) return;

  const titleInput = $('#notepad-title');
  const editor = $('#notepad-editor');

  if (titleInput) titleInput.value = note.title || '';
  // Load HTML directly (content is now stored as HTML)
  if (editor) {
    editor.innerHTML = safeRichHtml(note.content);
    reconcileTaskHighlights(editor);
    const reconciled = editor.innerHTML;
    if (reconciled !== (note.content || '')) {
      note.content = reconciled;
      saveModel();
    }
  }

  // Writing features refresh what they own (chips...) before the baseline is taken
  if (editor && editor._wr) editor._wr.loaded();

  // Capture initial state for unsaved changes detection (same path as the check)
  notepadInitialState = {
    title: note.title || '',
    content: noteContentKey(editor ? editor.innerHTML : note.content)
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
  const currentContent = noteContentKey(editor?.innerHTML || '');
  return currentTitle !== notepadInitialState.title || currentContent !== notepadInitialState.content;
}

// For the mobile shell's Back = keep (unit F3)
export function isNotepadDirty() { return notepadHasChanges(); }

// Saved form of the editor content for comparisons ('' when effectively empty,
// so typing then deleting everything is not an unsaved change)
function noteContentKey(html) {
  const clean = sanitizeHtml(html || '').trim();
  return isEffectivelyEmpty(clean) ? '' : clean;
}

// --- Close Notepad Popover
// Only closeNotepad(true) skips the unsaved-changes prompt (click handlers
// pass their MouseEvent, which must not count as "force")
export function closeNotepad(force) {
  if (force !== true && notepadHasChanges()) {
    if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
      return;
    }
  }
  const pop = $('#notepad-popover');
  const viewer = $('#note-viewer-modal');
  const active = document.activeElement;
  const hadFocus = !!active && ((pop && pop.contains(active)) || (viewer && viewer.contains(active)));
  if (pop) {
    pop.hidden = true;
  }
  // Its viewer and color picker belong to it
  closeNoteViewer();
  if (closeNoteColorPicker) closeNoteColorPicker();
  // Keyboard users go back to the button that opened it
  const opener = notepadOpener;
  notepadOpener = null;
  if (hadFocus && opener && opener.isConnected && opener.offsetParent !== null) {
    try { opener.focus({ preventScroll: true }); } catch { /* not focusable */ }
  }
  currentNotepadSectionId = null;
  currentNoteKey = null;
  notepadInitialState = null;
  currentNoteContextType = null;
  currentSubtaskNoteId = null;
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
  // cleanEditorHtml: no image-resize wrapper, no writing UI, and R2 images
  // keep only their reference (the src is session-only). Parsed in an inert
  // <template>, so nothing loads while we look at it.
  const temp = document.createElement('template');
  temp.innerHTML = cleanEditorHtml(html || '');

  // Remove script tags and event handlers
  temp.content.querySelectorAll('script').forEach(el => el.remove());
  temp.content.querySelectorAll('*').forEach(el => {
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

  if (isEffectivelyEmpty(noteContent)) {
    showToast('Note is empty');
    return;
  }

  // Determine which storage to use based on context
  const isSubtask = currentNoteContextType === 'subtask' && currentSubtaskNoteId;
  let notes;

  if (isSubtask) {
    if (!model.subtaskNotes) model.subtaskNotes = {};
    if (!model.subtaskNotes[currentSubtaskNoteId]) model.subtaskNotes[currentSubtaskNoteId] = [];
    notes = model.subtaskNotes[currentSubtaskNoteId];
  } else {
    if (!model.cardNotes) model.cardNotes = {};
    if (!model.cardNotes[currentNotepadSectionId] || typeof model.cardNotes[currentNotepadSectionId] === 'string') {
      model.cardNotes[currentNotepadSectionId] = [];
    }
    notes = model.cardNotes[currentNotepadSectionId];
  }

  const now = Date.now();
  const noteIndex = currentNoteKey ? notes.findIndex(n => n.key === currentNoteKey) : -1;
  if (noteIndex !== -1) {
    // Update existing note (edited time only when the text really changed)
    const note = notes[noteIndex];
    if (note.title !== noteTitle || note.content !== noteContent) note.updatedAt = now;
    note.title = noteTitle;
    note.content = noteContent;
    if (currentNoteColor) {
      note.color = currentNoteColor;
    }
  } else {
    // Add new note (also when the note being edited was deleted meanwhile, so
    // the text isn't lost)
    notes.push({
      key: generateNoteKey(),
      title: noteTitle,
      content: noteContent,
      color: currentNoteColor || null,
      createdAt: now,
      updatedAt: now
    });
  }

  if (editState.working) {
    if (isSubtask) {
      if (!editState.working.subtaskNotes) editState.working.subtaskNotes = {};
      editState.working.subtaskNotes[currentSubtaskNoteId] = [...notes];
    } else {
      if (!editState.working.cardNotes) editState.working.cardNotes = {};
      editState.working.cardNotes[currentNotepadSectionId] = [...notes];
    }
  }

  saveModel();
  if (isSubtask) {
    // Re-render to update subtask note indicators
    if (window.renderAllSections) window.renderAllSections();
  } else {
    updateNotepadButtonIndicator(currentNotepadSectionId);
  }

  // Clear editor and refresh saved notes list
  clearNotepadEditor();
  currentNoteColor = null;
  notepadInitialState = { title: '', content: '' };
  if (editor._wr) editor._wr.loaded();
  renderSavedNotesList();

  showToast('Note saved');
}

// --- Delete a note
export function deleteNote(noteKey) {
  if (!currentNotepadSectionId || !noteKey) return;

  const isSubtask = currentNoteContextType === 'subtask' && currentSubtaskNoteId;
  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
  const noteIndex = notes.findIndex(n => n.key === noteKey);

  if (noteIndex === -1) return;

  const [removed] = notes.splice(noteIndex, 1);

  if (isSubtask) {
    model.subtaskNotes[currentSubtaskNoteId] = notes;
    if (editState.working?.subtaskNotes) {
      editState.working.subtaskNotes[currentSubtaskNoteId] = [...notes];
    }
  } else {
    model.cardNotes[currentNotepadSectionId] = notes;
    if (editState.working?.cardNotes) {
      editState.working.cardNotes[currentNotepadSectionId] = [...notes];
    }
  }

  saveModel();
  if (isSubtask) {
    if (window.renderAllSections) window.renderAllSections();
  } else {
    updateNotepadButtonIndicator(currentNotepadSectionId);
  }
  // What was removed, and where (the viewer's Undo puts it back)
  return { note: removed, index: noteIndex };
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
    temp.innerHTML = safeRichHtml(note.content);
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
    temp.innerHTML = safeRichHtml(note.content);
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

  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
  const note = notes.find(n => n.key === noteKey);
  if (!note) return;

  // The viewer has its own key: the note being edited (currentNoteKey) stays
  // put, so viewing another note can't make Save duplicate or misfile edits
  viewerNoteKey = noteKey;

  const titleEl = $('#note-viewer-title');
  const contentEl = $('#note-viewer-content');

  titleEl.textContent = note.title || 'Untitled';
  // Display HTML directly (content is now stored as HTML)
  contentEl.innerHTML = safeRichHtml(note.content);

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

  // Checklist items can be checked right here (keyboard too: see markViewerChecklist)
  markViewerChecklist(contentEl);

  // Writing view: safe link clicks, block / chip clicks, export menu
  attachWritingView(contentEl, {
    id: 'notes',
    getTitle: () => note.title || 'Untitled',
    getDocMeta: () => noteDocMeta(note.title || 'Untitled', note),
    actionsHost: modal.querySelector('.note-viewer-actions')
  });

  // Pin state, "Edited …", checklist progress
  renderNoteViewerMeta(note);

  const wasHidden = modal.hidden;
  modal.hidden = false;
  // Keyboard users land in the viewer; focus goes back to the bubble on close
  const dialog = modal.querySelector('.note-viewer-dialog');
  if (wasHidden && dialog) {
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    try { dialog.focus({ preventScroll: true }); } catch { dialog.focus(); }
  }
}

// --- Viewer header: Pin button state, "Edited …" and checklist progress
function renderNoteViewerMeta(note) {
  const pinBtn = $('#note-viewer-pin');
  if (pinBtn) {
    const pinned = !!note.pinned;
    pinBtn.classList.toggle('is-pinned', pinned);
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.title = pinned ? 'Unpin note' : 'Pin note to the top';
    pinBtn.setAttribute('aria-label', pinned ? 'Unpin note' : 'Pin note');
  }
  const meta = $('#note-viewer-meta');
  if (!meta) return;
  meta.textContent = '';
  const time = noteTime(note);
  if (time) {
    const edited = document.createElement('span');
    edited.className = 'note-viewer-edited';
    edited.textContent = `Edited ${formatNoteTime(time)}`;
    edited.title = noteDatesTooltip(note);
    meta.appendChild(edited);
  }
  const progress = noteChecklistProgress(note.content);
  if (progress) {
    const done = document.createElement('span');
    done.className = 'note-viewer-progress' + (progress.done === progress.total ? ' is-done' : '');
    done.textContent = `${progress.done}/${progress.total} checked`;
    meta.appendChild(done);
  }
  meta.hidden = !meta.childElementCount;
}

// Checklist items without a nested list become keyboard checkboxes (Space /
// Enter); every item's circle is clickable (wireNotepadEvents)
function markViewerChecklist(contentEl) {
  contentEl.querySelectorAll('ul.checklist > li').forEach(li => {
    if (li.querySelector('ul, ol')) return; // a checkbox can't hold a nested list
    li.tabIndex = 0;
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', String(li.classList.contains('checked')));
  });
}

// Check / uncheck an item in the viewer and save the note. The STORED html is
// changed (the rendered copy holds session-only image sources), by the item's
// position among all checklist items.
function toggleViewerChecklistItem(li) {
  const contentEl = $('#note-viewer-content');
  const key = viewerNoteKey;
  if (!contentEl || !key) return;
  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
  const note = notes.find(n => n.key === key);
  if (!note) return;
  const index = [...contentEl.querySelectorAll('ul.checklist > li')].indexOf(li);
  if (index < 0) return;
  const temp = document.createElement('template');
  temp.innerHTML = note.content || '';
  const stored = temp.content.querySelectorAll('ul.checklist > li')[index];
  if (!stored) return;
  const checked = !li.classList.contains('checked');
  stored.classList.toggle('checked', checked);
  if (!stored.classList.length) stored.removeAttribute('class');
  li.classList.toggle('checked', checked);
  if (li.hasAttribute('aria-checked')) li.setAttribute('aria-checked', String(checked));
  note.content = temp.innerHTML;
  note.updatedAt = Date.now();
  storeNotes(notes);

  // The same note open in the editor follows (unsaved edits there are kept;
  // only the same item, matched by position AND text, is flipped)
  const editor = $('#notepad-editor');
  if (currentNoteKey === key && editor) {
    const wasDirty = notepadHasChanges();
    const editorItem = editor.querySelectorAll('ul.checklist > li')[index];
    if (editorItem && editorItem.textContent === li.textContent) {
      editorItem.classList.toggle('checked', checked);
      if (!wasDirty && notepadInitialState) notepadInitialState.content = noteContentKey(editor.innerHTML);
    }
  }
  renderSavedNotesList();
  renderNoteViewerMeta(note);
}

// --- Pin / unpin the note in the viewer (pinned notes lead the bubble list)
export function toggleNotePinFromViewer() {
  const key = viewerNoteKey;
  if (!key) return;
  const notes = getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
  const note = notes.find(n => n.key === key);
  if (!note) return;
  if (note.pinned) delete note.pinned;
  else note.pinned = true;
  storeNotes(notes);
  renderSavedNotesList();
  renderNoteViewerMeta(note);
  showToast(note.pinned ? 'Note pinned to the top' : 'Note unpinned');
}

// --- Doc meta for exports (card title, subtask section, dates)
function noteDocMeta(title, note) {
  const section = currentSections().find(s => s.id === currentNotepadSectionId);
  const cardTitle = section ? section.title || '' : '';
  const fields = [];
  if (cardTitle) fields.push({ label: 'Card', value: cardTitle });
  if (currentNoteContextType === 'subtask' && currentSubtaskNoteId) {
    const subtitle = String(currentSubtaskNoteId).split(':')[1];
    if (subtitle && subtitle !== '_default') fields.push({ label: 'Section', value: subtitle });
    const subtask = notepadContextLabel(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId);
    if (subtask && subtask !== cardTitle) fields.push({ label: 'Subtask', value: subtask });
  }
  // The editor passes no note: the one being edited, if any
  const dated = note || (currentNoteKey
    ? getNotesForSection(currentNotepadSectionId, currentNoteContextType, currentSubtaskNoteId).find(n => n.key === currentNoteKey)
    : null);
  if (dated && dated.createdAt) fields.push({ label: 'Created', value: formatNoteDate(dated.createdAt) });
  if (dated && dated.updatedAt && dated.updatedAt !== dated.createdAt) fields.push({ label: 'Edited', value: formatNoteDate(dated.updatedAt) });
  return {
    kind: 'Note',
    title: title || 'Untitled',
    subtitle: currentNoteContextType === 'subtask' ? `Subtask note${cardTitle ? ' · ' + cardTitle : ''}` : cardTitle,
    fields
  };
}

// --- Close Note Viewer Modal
export function closeNoteViewer() {
  const modal = $('#note-viewer-modal');
  const key = viewerNoteKey;
  const hadFocus = !!(modal && !modal.hidden && modal.contains(document.activeElement));
  if (modal) {
    modal.hidden = true;
  }
  viewerNoteKey = null;
  // Focus back to the note's bubble (re-rendered bubbles are found by key)
  const pop = $('#notepad-popover');
  if (hadFocus && key && pop && !pop.hidden) {
    const bubble = [...pop.querySelectorAll('.notepad-saved-bubble')].find(b => b.dataset.key === key);
    if (bubble) bubble.focus({ preventScroll: true });
  }
}

// --- Edit note from viewer
export function editNoteFromViewer() {
  const noteKey = viewerNoteKey;
  if (!noteKey) return;
  // Already editing this note with unsaved changes: keep them
  if (currentNoteKey === noteKey && notepadHasChanges()) {
    closeNoteViewer();
    const editor = $('#notepad-editor');
    if (editor) editor.focus();
    return;
  }
  if (notepadHasChanges() && !confirm('You have unsaved changes. Discard them and edit this note?')) return;
  closeNoteViewer();
  enterNotepadEditMode(noteKey);
}

// --- Copy note from viewer (preserves rich formatting)
export function copyNoteFromViewer() {
  const contentEl = $('#note-viewer-content');
  if (!contentEl) return;

  // The viewer's keyboard-checkbox attributes are not part of the note
  const clone = contentEl.cloneNode(true);
  clone.querySelectorAll('li[role="checkbox"]').forEach(li => {
    li.removeAttribute('role');
    li.removeAttribute('tabindex');
    li.removeAttribute('aria-checked');
  });
  const htmlContent = clone.innerHTML;
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
  const noteKey = viewerNoteKey;
  if (!noteKey) return;

  if (!confirm('Delete this note?')) return;

  const ctx = noteStoreContext();
  const removed = deleteNote(noteKey);
  // The editor was showing this note: it goes too (Save would bring it back)
  if (currentNoteKey === noteKey) {
    clearNotepadEditor();
    notepadInitialState = { title: '', content: '' };
    const editor = $('#notepad-editor');
    if (editor && editor._wr) editor._wr.loaded();
  }
  closeNoteViewer();
  renderSavedNotesList();

  if (!removed) {
    showToast('Note deleted');
    return;
  }
  writingApi.actionToast('Note deleted', [{ label: 'Undo', run: () => restoreDeletedNote(removed, ctx) }]);
}

// Put a deleted note back where it was (the delete toast's Undo)
function restoreDeletedNote({ note, index }, ctx) {
  const notes = getNotesForSection(ctx.sectionId, ctx.type, ctx.subtaskId).slice();
  if (notes.some(n => n.key === note.key)) return;
  notes.splice(Math.min(index, notes.length), 0, note);
  storeNotes(notes, ctx);
  refreshNoteIndicators(ctx);
  const pop = $('#notepad-popover');
  if (pop && !pop.hidden && currentNotepadSectionId === ctx.sectionId &&
      currentNoteContextType === ctx.type && currentSubtaskNoteId === ctx.subtaskId) {
    renderSavedNotesList();
  }
  showToast('Note restored');
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

  // × and Cancel ask before dropping unsaved changes (no MouseEvent as "force")
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeNotepad());
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeNotepad());
  }
  // Title: Enter moves on to the note body
  const titleField = $('#notepad-title');
  if (titleField) {
    titleField.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && editor) {
        e.preventDefault();
        editor.focus();
        writingApi.dom.placeCaretAtEnd(editor);
      }
    });
  }
  // Ctrl/⌘+S anywhere in the notepad saves (the editor's own Ctrl+S is the
  // writing core's save command, which stops the event before it gets here)
  const notepadPop = $('#notepad-popover');
  if (notepadPop) {
    notepadPop.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.getModifierState && e.getModifierState('AltGraph')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNote();
      }
    });
  }
  // Esc: closes the topmost notepad layer (asks when there are unsaved changes)
  document.addEventListener('keydown', onNotepadEscape);
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

    // Click on task highlights or links in notepad editor
    editor.addEventListener('click', (e) => {
      // Hyperlinks — open in new tab
      const link = e.target.closest('a[href]');
      if (link && editor.contains(link)) {
        e.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
        return;
      }
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

  // Checklist click handler on card notes editor
  attachChecklistHandler(editor);
  attachImageResizeHandler(editor);
  attachImageUpload(editor, { label: 'Note', getTitle: () => $('#notepad-title')?.value });

  // Writing features (LITE tier: typing power, at most 2 new toolbar buttons)
  if (editor) {
    attachWritingFeatures(editor, {
      id: 'notes',
      tier: 'lite',
      toolbar: $('#notepad-popover .notepad-toolbar'),
      getTitle: () => ($('#notepad-title')?.value || '').trim() || 'Untitled',
      getDocMeta: () => noteDocMeta(($('#notepad-title')?.value || '').trim()),
      getDocId: () => `${currentNoteContextType || 'card'}:${currentSubtaskNoteId || currentNotepadSectionId || ''}:${currentNoteKey || 'new'}`,
      onSave: () => saveNote(),
      linkTask: true,
      makeTask: (text, range) => {
        if (!window.openAddTaskModalWithCallback) return;
        const sectionId = currentNotepadSectionId;
        window.openAddTaskModalWithCallback(text, (task) => {
          if (!task) return;
          if (wrapRangeWithTaskPill(range, task) && window.updateTask) {
            window.updateTask(task.id, { noteHighlight: { sectionId } });
          }
          writingApi.notifyChange(editor);
        });
      }
    });
  }

  // Toolbar button handlers
  const toolbarBtns = $$('.notepad-toolbar-btn');
  toolbarBtns.forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing focus from editor
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (btn.classList.contains('notepad-checklist-btn')) {
        runFormatCommand(editor, 'checklist');
        updateToolbarState();
        if (editor) editor.focus();
        return;
      }
      const command = btn.dataset.command;
      if (command) {
        runFormatCommand(editor, command);
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
    // Writing menus / popovers, the toast's Undo, and the task editor opened
    // from "Turn into task" or a task pill
    const isInsideWritingUi = e.target.closest('[data-wr-ui]') || e.target.closest('#qc-toast') || e.target.closest('#task-editor-modal');

    if (!isInsidePopover && !isNotepadButton && !isInsideViewer && !isInsideColorPicker && !isInsideHighlighter && !isInsideWritingUi) {
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
  const viewerPinBtn = $('#note-viewer-pin');
  if (viewerPinBtn) {
    viewerPinBtn.addEventListener('click', toggleNotePinFromViewer);
  }
  // Screen readers: the notepad and its viewer are dialogs
  if (notepadPop) notepadPop.setAttribute('role', 'dialog');
  const viewerDialog = document.querySelector('.note-viewer-dialog');
  if (viewerDialog) {
    viewerDialog.setAttribute('role', 'dialog');
    viewerDialog.setAttribute('aria-modal', 'true');
    viewerDialog.setAttribute('aria-labelledby', 'note-viewer-title');
    viewerDialog.setAttribute('tabindex', '-1');
  }

  // Viewer checklists: the circle (the editors' 24px gutter) or Space / Enter
  // on a focused item checks it, and the note is saved
  const viewerContent = $('#note-viewer-content');
  if (viewerContent) {
    viewerContent.addEventListener('click', (e) => {
      const li = e.target.closest && e.target.closest('ul.checklist > li');
      if (!li || !viewerContent.contains(li)) return;
      if (e.clientX - li.getBoundingClientRect().left >= 24) return;
      e.preventDefault();
      toggleViewerChecklistItem(li);
    });
    viewerContent.addEventListener('keydown', (e) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || e.ctrlKey || e.metaKey || e.altKey) return;
      const li = e.target;
      if (!li || li.getAttribute?.('role') !== 'checkbox' || !viewerContent.contains(li)) return;
      e.preventDefault();
      toggleViewerChecklistItem(li);
    });
  }
}

// Esc belongs to the notepad (or its viewer) when the key comes from inside it
// (or from nowhere in particular) and nothing else covers it: the task editor,
// Today, quick capture... handle their own. Peels one layer per press: a menu
// of the notepad, the color picker, the viewer, then the notepad itself.
function onNotepadEscape(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  const pop = $('#notepad-popover');
  if (!pop || pop.hidden) return;
  const viewer = $('#note-viewer-modal');
  const viewerOpen = !!(viewer && !viewer.hidden);
  const menus = [
    highlightContextMenu,
    taskLinkPicker,
    document.querySelector('.notepad-color-popover'),
    ...pop.querySelectorAll('.highlighter-color-dropdown')
  ].filter(Boolean);
  const roots = [pop, viewerOpen ? viewer : null, ...menus].filter(Boolean);
  const target = e.target;
  const fromInside = target && target.nodeType === 1 && roots.some(r => r.contains(target));
  if (!fromInside && target !== document.body && target !== document.documentElement) return;
  const layer = viewerOpen ? (viewer.querySelector('.note-viewer-dialog') || viewer) : pop;
  const rect = layer.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + Math.min(rect.height / 2, 60);
  if (x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !roots.some(r => r.contains(hit))) return;
  } else if (!fromInside) {
    return;
  }

  const shown = (el) => el && el.isConnected && el.style.display !== 'none' && !el.hidden;
  if (shown(taskLinkPicker)) { e.preventDefault(); hideTaskLinkPicker(); return; }
  if (shown(highlightContextMenu)) { e.preventDefault(); hideHighlightContextMenu(); return; }
  const swatches = [...pop.querySelectorAll('.highlighter-color-dropdown')].find(shown);
  if (swatches) { e.preventDefault(); swatches.style.display = 'none'; return; }
  if (closeNoteColorPicker) { e.preventDefault(); closeNoteColorPicker(); return; }
  e.preventDefault();
  if (viewerOpen) closeNoteViewer();
  else closeNotepad();
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
    // Inherit checklist class from parent list
    if (parentList.classList.contains('checklist')) {
      nestedList.classList.add('checklist');
    }
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
          const exitDiv = document.createElement('div');
          exitDiv.innerHTML = '<br>';
          if (ul.children.length === 0) {
            // List is now empty — replace it entirely
            ul.parentNode.insertBefore(exitDiv, ul);
            ul.remove();
          } else {
            // List still has items — insert plain line after the list
            if (ul.nextSibling) {
              ul.parentNode.insertBefore(exitDiv, ul.nextSibling);
            } else {
              ul.parentNode.appendChild(exitDiv);
            }
          }
          const range = document.createRange();
          range.setStart(exitDiv, 0);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return;
      }
      // Non-empty checklist item: browser will create new li, clean up checked class.
      // Done in the input event of this very Enter (the browser has just split
      // the item and the caret sits in the new one), never on a timer: a late
      // timer would uncheck whatever item holds the caret by then
      if (li.parentElement && li.parentElement.classList.contains('checklist')) {
        const host = e.currentTarget || editor;
        const onSplit = (ev) => {
          host.removeEventListener('input', onSplit);
          if (ev.inputType !== 'insertParagraph') return;
          const currentLi = isInListItem();
          if (currentLi && currentLi !== li) {
            currentLi.classList.remove('checked');
          }
        };
        host.addEventListener('input', onSplit);
        // Enter handled elsewhere (no input event): drop the listener
        setTimeout(() => host.removeEventListener('input', onSplit), 0);
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
    if (btn.classList.contains('notepad-checklist-btn')) {
      btn.classList.toggle('active', isInChecklist());
      return;
    }
    const command = btn.dataset.command;
    if (command) {
      const isActive = document.queryCommandState(command);
      btn.classList.toggle('active', isActive && !(command === 'insertUnorderedList' && isInChecklist()));
    }
  });
}

// --- Handle input in contenteditable to auto-convert markdown patterns
export function handleEditorInput(e) {
  const editor = e.target;
  // Writing editors get their (undoable) rules from writing/input-rules.js
  if (editor && (editor._wr || (editor.closest && editor.closest('.wr-editor')))) return;
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

  // Check for checklist pattern ([] followed by space)
  const checklistMatch = text.match(/^\[\] $/);
  if (checklistMatch && !isInList()) {
    const cursorAtEnd = range.startOffset === node.textContent.length;
    if (cursorAtEnd) {
      convertToChecklist(editor, node, selection);
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
  // Walk up from the text node to find the element that is a direct child
  // of the editor. Inline wrappers (b, i, span, mark, etc.) should not
  // prevent heading conversion.
  let blockToReplace = textNode.parentElement;
  while (blockToReplace && blockToReplace !== editor && blockToReplace.parentElement !== editor) {
    blockToReplace = blockToReplace.parentElement;
  }

  // Determine what to replace: the text node itself (if direct child of editor)
  // or the block/inline wrapper that is a direct child of the editor
  const nodeToReplace = (blockToReplace === editor) ? textNode : blockToReplace;
  if (!nodeToReplace || !nodeToReplace.parentElement) return;

  // Verify the block only contains the heading trigger text (no other meaningful content)
  const blockContent = (nodeToReplace === textNode ? textNode.textContent : blockToReplace.textContent)
    .replace(/\u00A0/g, ' ');
  if (!/^#{1,6} $/.test(blockContent)) return;

  // Create the heading element
  const heading = document.createElement(`h${level}`);
  heading.appendChild(document.createElement('br'));

  // Replace the node with the heading
  nodeToReplace.parentElement.replaceChild(heading, nodeToReplace);

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

// --- Convert text to checklist
function convertToChecklist(editor, textNode, selection) {
  let blockToReplace = textNode.parentElement;

  if (blockToReplace === editor) {
    const nodeContent = textNode.textContent.replace(/\u00A0/g, ' ');
    if (!/^\[\] $/.test(nodeContent)) return;
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    const li = document.createElement('li');
    li.appendChild(document.createElement('br'));
    ul.appendChild(li);
    editor.replaceChild(ul, textNode);

    const newRange = document.createRange();
    newRange.setStart(li, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return;
  }

  if ((blockToReplace.tagName !== 'DIV' && blockToReplace.tagName !== 'P') ||
      blockToReplace.parentElement !== editor) {
    return;
  }

  const blockContent = blockToReplace.textContent.replace(/\u00A0/g, ' ');
  if (!/^\[\] $/.test(blockContent)) return;

  const ul = document.createElement('ul');
  ul.className = 'checklist';
  const li = document.createElement('li');
  li.appendChild(document.createElement('br'));
  ul.appendChild(li);

  blockToReplace.parentElement.replaceChild(ul, blockToReplace);

  const newRange = document.createRange();
  newRange.setStart(li, 0);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);
}

// --- Legacy toolbar formatting buttons (B / I / U, lists, checklist). In a
// writing editor they run the writing command, so they follow the same rules
// as the keys and the writing toolbar (code blocks stay plain, one undo step);
// any other editor keeps the browser's own command
const LEGACY_FORMAT_COMMANDS = {
  bold: 'bold', italic: 'italic', underline: 'underline',
  insertUnorderedList: 'bulletList', insertOrderedList: 'numberedList', checklist: 'checklist'
};
export function runFormatCommand(editor, cmd) {
  const id = LEGACY_FORMAT_COMMANDS[cmd];
  if (editor && editor._wr && id && writingApi.hasCommand(id)) {
    writingApi.ensureSelection(editor);
    writingApi.runCommand(id, writingApi.context(editor), { source: 'toolbar' });
    return;
  }
  if (cmd === 'checklist') toggleChecklist(editor);
  else if (cmd) document.execCommand(cmd, false, null);
}

// --- Toggle checklist on current line/selection
// editorEl is optional — pass it when calling from context menu for reliable UL detection
export function toggleChecklist(editorEl) {
  const li = isInListItem();
  if (li) {
    const list = li.closest('ul, ol');
    if (list && list.classList.contains('checklist')) {
      // Already in checklist — manually unwrap each li into a paragraph
      const sel = window.getSelection();
      const fragment = document.createDocumentFragment();
      let cursorTarget = null;
      Array.from(list.children).forEach(child => {
        if (child.tagName !== 'LI') return;
        const div = document.createElement('div');
        Array.from(child.childNodes).forEach(cn => {
          if (cn.tagName === 'UL' || cn.tagName === 'OL') return;
          div.appendChild(cn.cloneNode(true));
        });
        if (!div.childNodes.length) div.appendChild(document.createElement('br'));
        if (child === li) cursorTarget = div;
        fragment.appendChild(div);
      });
      list.parentNode.replaceChild(fragment, list);
      if (cursorTarget && sel) {
        const range = document.createRange();
        range.setStart(cursorTarget, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return;
    }
    if (list && list.tagName === 'OL') {
      // In ordered list — convert to checklist
      const ul = document.createElement('ul');
      ul.className = 'checklist';
      while (list.firstChild) ul.appendChild(list.firstChild);
      list.parentNode.replaceChild(ul, list);
      return;
    }
    if (list && list.tagName === 'UL') {
      // In regular bullet list — convert to checklist
      list.classList.add('checklist');
      return;
    }
  }
  // Not in a list — create a checklist.
  const sel = window.getSelection();

  // If the editor is empty (or only has a <br>), directly create checklist markup
  // instead of relying on execCommand which may produce a plain bullet list.
  const activeEditor = editorEl || (sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null)?.closest?.('[contenteditable="true"]')
    || document.querySelector('[contenteditable="true"]:focus');
  if (activeEditor) {
    const content = activeEditor.innerHTML.replace(/<br\s*\/?>/gi, '').trim();
    if (!content || content === '<div></div>') {
      activeEditor.innerHTML = '';
      const ul = document.createElement('ul');
      ul.className = 'checklist';
      const li = document.createElement('li');
      li.appendChild(document.createElement('br'));
      ul.appendChild(li);
      activeEditor.appendChild(ul);
      // Place cursor inside the new li
      const range = document.createRange();
      range.setStart(li, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }

  // Find the block element containing the cursor so we can wrap it manually
  // if it contains contenteditable="false" elements (e.g. task highlights),
  // since execCommand('insertUnorderedList') loses such content.
  let cursorNode = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  let block = cursorNode;
  while (block && block !== editorEl && block.parentElement !== editorEl) {
    block = block.parentElement;
  }
  // Check if the block (or the line) contains non-editable elements
  const hasNonEditable = block && block !== editorEl &&
    block.querySelector && block.querySelector('[contenteditable="false"]');

  if (hasNonEditable && block.parentElement === editorEl) {
    // Manual wrapping — move all child nodes into a new checklist li
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    const newLi = document.createElement('li');
    while (block.firstChild) newLi.appendChild(block.firstChild);
    if (!newLi.childNodes.length) newLi.appendChild(document.createElement('br'));
    ul.appendChild(newLi);
    block.parentElement.replaceChild(ul, block);
    // Restore cursor
    const range = document.createRange();
    range.selectNodeContents(newLi);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  // Standard path — use execCommand for simple text lines
  const priorULs = editorEl ? new Set(editorEl.querySelectorAll('ul')) : null;
  document.execCommand('insertUnorderedList');
  // Try selection-based detection first
  const newLi = isInListItem();
  if (newLi) {
    const ul = newLi.closest('ul');
    if (ul && !ul.classList.contains('checklist')) {
      ul.classList.add('checklist');
      return;
    }
  }
  // Fallback: find the new UL by comparing DOM before/after execCommand
  if (priorULs) {
    for (const ul of editorEl.querySelectorAll('ul')) {
      if (!priorULs.has(ul) && !ul.classList.contains('checklist')) {
        ul.classList.add('checklist');
        return;
      }
    }
  }
  // Last resort: retry after browser tick
  setTimeout(() => {
    const retryLi = isInListItem();
    if (retryLi) {
      const ul = retryLi.closest('ul');
      if (ul && !ul.classList.contains('checklist')) ul.classList.add('checklist');
    }
  }, 0);
}

// --- Check if cursor is inside a checklist
export function isInChecklist() {
  const li = isInListItem();
  if (!li) return false;
  const list = li.closest('ul');
  return list && list.classList.contains('checklist');
}

// --- Attach click handler for checklist checkboxes in an editor
export function attachChecklistHandler(editor) {
  editor.addEventListener('mousedown', (e) => {
    // Walk up from target to find a checklist li
    let node = e.target;
    while (node && node !== editor) {
      if (node.tagName === 'LI' && node.parentElement && node.parentElement.classList.contains('checklist')) {
        const liRect = node.getBoundingClientRect();
        const clickX = e.clientX - liRect.left;
        // Click is in the checkbox area (the ::before circle in left padding)
        if (clickX < 24) {
          e.preventDefault();
          e.stopPropagation();
          node.classList.toggle('checked');
          // No input event fires: tell the writing core (projects autosave, status bar...)
          if (editor._wr) editor._wr.notifyChange();
        }
        return;
      }
      node = node.parentNode;
    }
  });
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
    <button type="button" class="highlight-context-item ctx-bold-btn" data-wr-hint="bold">
      <strong>B</strong>
      Bold
    </button>
    <button type="button" class="highlight-context-item ctx-italic-btn" data-wr-hint="italic">
      <em>I</em>
      Italic
    </button>
    <button type="button" class="highlight-context-item ctx-underline-btn" data-wr-hint="underline">
      <u>U</u>
      Underline
    </button>
    <button type="button" class="highlight-context-item ctx-strike-btn" data-wr-hint="strike">
      <s>S</s>
      Strikethrough
    </button>
    <button type="button" class="highlight-context-item ctx-code-btn" data-wr-hint="inlineCode">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/></svg>
      Inline code
    </button>
    <div class="highlight-context-divider ctx-lists-divider"></div>
    <button type="button" class="highlight-context-item ctx-bullet-list-btn" data-wr-hint="bulletList">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
      Bullet list
    </button>
    <button type="button" class="highlight-context-item ctx-numbered-list-btn" data-wr-hint="numberedList">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
      Numbered list
    </button>
    <button type="button" class="highlight-context-item ctx-checklist-btn" data-wr-hint="checklist">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.5 17 6 18.5 8.5 15.5" stroke-width="1.5"/></svg>
      Checklist
    </button>
    <div class="highlight-context-divider ctx-highlight-divider"></div>
    <button type="button" class="highlight-context-item highlight-apply-btn" data-wr-hint="highlight">
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
    <div class="highlight-context-divider ctx-link-divider"></div>
    <button type="button" class="highlight-context-item ctx-link-btn" data-wr-hint="link">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      Link…
    </button>
    <div class="highlight-context-divider ctx-link-task-divider"></div>
    <button type="button" class="highlight-context-item ctx-make-task-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="8.5 12.5 11 15 15.5 9.5"></polyline></svg>
      Turn into task
    </button>
    <button type="button" class="highlight-context-item ctx-add-subtask-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v7a3 3 0 0 0 3 3h11"></path><polyline points="15 10 19 14 15 18"></polyline></svg>
      Add as subtask
    </button>
    <button type="button" class="highlight-context-item ctx-link-task-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="12" y1="18" x2="12" y2="12"></line>
        <line x1="9" y1="15" x2="15" y2="15"></line>
      </svg>
      Link task
    </button>
    <div class="highlight-context-divider ctx-edit-link-divider"></div>
    <button type="button" class="highlight-context-item ctx-edit-link-text-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      Edit link text
    </button>
    <button type="button" class="highlight-context-item ctx-edit-link-url-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
      Edit link URL
    </button>
    <button type="button" class="highlight-context-item ctx-remove-link-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      Remove link
    </button>
  `;
  // Right-aligned shortcut hints from the writing command registry
  const mac = isMacPlatform();
  highlightContextMenu.querySelectorAll('[data-wr-hint]').forEach(btn => {
    const hint = keyHint(btn.dataset.wrHint, mac);
    if (!hint) return;
    const kbd = document.createElement('span');
    kbd.className = 'ctx-kbd';
    kbd.textContent = hint;
    btn.appendChild(kbd);
  });
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
  document.removeEventListener('keydown', onContextMenuKeydown, true);
}

// While the menu is open (capture, so it comes before the editor and the
// panels' own Esc): Esc closes the top-most layer (the task picker, then the
// menu); typing in the editor closes the menu and the key goes on as usual
function onContextMenuKeydown(e) {
  const menu = highlightContextMenu;
  if (!menu || menu.style.display === 'none') { // closed by an outside click
    document.removeEventListener('keydown', onContextMenuKeydown, true);
    return;
  }
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (taskLinkPicker && taskLinkPicker.style.display !== 'none') hideTaskLinkPicker();
    else hideHighlightContextMenu();
    return;
  }
  const t = e.target;
  if (t instanceof Node && (menu.contains(t) || (taskLinkPicker && taskLinkPicker.contains(t)))) return; // the picker's filter
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') hideHighlightContextMenu();
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

// New highlights carry no inline color: writing.css colors them from
// data-highlight-color, so they follow the theme (light / dark palettes).
// One-line selections go through execCommand('insertHTML') so Ctrl+Z undoes
// them; selections spanning blocks get one <mark> per text run (never a mark
// around block elements).
// True when the range starts, ends or crosses a code block of the editor
function rangeTouchesCodeBlock(range, editor) {
  const preOf = (node) => {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const pre = el && el.closest('pre');
    return pre && editor.contains(pre) ? pre : null;
  };
  if (preOf(range.startContainer) || preOf(range.endContainer)) return true;
  if (range.collapsed) return false;
  const c = range.commonAncestorContainer;
  const root = c.nodeType === Node.ELEMENT_NODE ? c : c.parentElement;
  return !!root && [...root.querySelectorAll('pre')].some(p => { try { return range.intersectsNode(p); } catch { return false; } });
}

export function applyHighlightToSelection(editor, colorName) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  let range = sel.getRangeAt(0);
  if (!editor || !editor.contains(range.commonAncestorContainer)) return false;
  const color = colorName || activeHighlightColor.name.toLowerCase();
  // A triple-click's spill into the next line is not part of the highlight
  const trimmed = trimRangeEnd(range, editor);
  if (trimmed !== range) {
    sel.removeAllRanges();
    sel.addRange(trimmed);
    range = trimmed;
  }
  // Code blocks stay plain text, as with Ctrl+B and Ctrl+Shift+H (the toolbar pen
  // and the right-click item come here directly): a mark there would also save
  // the editor's computed font into the code
  if (rangeTouchesCodeBlock(range, editor)) {
    hideHighlightContextMenu();
    showToast('Code blocks stay plain text');
    return false;
  }

  const blockOf = (node) => {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== editor) {
      if (/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|TD|TH)$/.test(el.tagName)) return el;
      el = el.parentElement;
    }
    return editor;
  };

  if (blockOf(range.startContainer) === blockOf(range.endContainer)) {
    // Over whole bold / link / code elements, so they stay (inside the mark)
    const whole = expandToWholeInlines(range, editor);
    const holder = document.createElement('div');
    holder.appendChild(whole.cloneContents());
    // A highlight inside a highlight: keep only the new one
    holder.querySelectorAll('mark.text-highlight').forEach(m => m.replaceWith(...m.childNodes));
    if (!holder.querySelector('div, p, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre, table')) {
      // replaceRangeHtml: no &nbsp; around the mark, and a U+200B after it
      // so typing continues unhighlighted
      const ok = replaceRangeHtml(whole,
        `<mark class="text-highlight" data-highlight-color="${color}">${holder.innerHTML}</mark>`, { zwsp: 'always' });
      if (ok) {
        hideHighlightContextMenu();
        return true;
      }
    }
  }

  // Across blocks: wrap each selected text run on its own (manual DOM)
  const rootNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const runs = [];
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node) || !node.data.replace(/[\s\u200B]/g, '')) continue;
    if (node.parentElement && node.parentElement.closest('mark.text-highlight, [contenteditable="false"]')) continue;
    runs.push(node);
  }
  const startNode = range.startContainer, startOffset = range.startOffset;
  const endNode = range.endContainer, endOffset = range.endOffset;
  let last = null;
  runs.forEach(text => {
    let target = text;
    if (text === endNode && endOffset < text.data.length) text.splitText(endOffset);
    if (text === startNode && startOffset > 0) target = text.splitText(startOffset);
    const mark = document.createElement('mark');
    mark.className = 'text-highlight';
    mark.dataset.highlightColor = color;
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    last = mark;
  });
  if (last) {
    const spacer = document.createTextNode('\u200B');
    last.parentNode.insertBefore(spacer, last.nextSibling);
    const newRange = document.createRange();
    newRange.setStartAfter(spacer);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    if (editor._wr) editor._wr.notifyChange();
  }
  hideHighlightContextMenu();
  return !!last;
}

// Unwrap the highlight at the caret (one undo step when possible, see unwrapInline)
export function removeHighlightFromSelection(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  const node = sel.anchorNode;
  if (!node || !editor.contains(node)) return false;

  const mark = node.nodeType === Node.TEXT_NODE
    ? node.parentElement?.closest('mark.text-highlight')
    : node.closest?.('mark.text-highlight');

  if (mark && editor.contains(mark)) {
    if (unwrapInline(mark) === 'manual' && editor._wr) editor._wr.notifyChange();
  }

  hideHighlightContextMenu();
  return !!mark;
}

// The editor (outermost contenteditable) holding the current non-empty selection, or null
function editorWithSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null;
  const start = sel.getRangeAt(0).commonAncestorContainer;
  const el = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
  let editor = el ? el.closest('[contenteditable="true"]') : null;
  while (editor && editor.parentElement && editor.parentElement.closest('[contenteditable="true"]')) {
    editor = editor.parentElement.closest('[contenteditable="true"]');
  }
  return editor;
}

// Wrap a saved range in a task pill (Turn into task). Returns the pill or null.
export function wrapRangeWithTaskPill(range, task) {
  if (!range || !task) return null;
  const span = document.createElement('span');
  span.className = 'project-task-highlight';
  span.dataset.taskId = task.id;
  span.dataset.highlightColor = task.color;
  span.style.backgroundColor = TASK_HIGHLIGHT_BG[task.color];
  span.style.borderBottom = `2px solid ${TASK_HIGHLIGHT_BORDER[task.color]}`;
  span.style.cursor = 'pointer';
  span.contentEditable = 'false';
  try {
    try {
      range.surroundContents(span);
    } catch (err) {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
  } catch (err) {
    return null; // the range went stale
  }
  if (span.parentNode) moveCursorAfterNode(span);
  return span;
}

let highlighterOutsideClickInstalled = false;

/**
 * Create a highlighter button with color picker dropdown for a toolbar.
 */
export function createHighlighterButton() {
  const wrapper = document.createElement('div');
  wrapper.className = 'highlighter-btn-wrapper';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'highlighter-toolbar-btn';
  btn.title = `Highlight the selection (${keyHint('highlight', isMacPlatform())}) · the color bar picks the color`;
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
    // With text selected the pen highlights it (current color); the color
    // bar, or a click without a selection, opens the swatches
    const editor = !e.target.closest('.highlighter-color-indicator') ? editorWithSelection() : null;
    if (editor) {
      dropdown.style.display = 'none';
      applyHighlightToSelection(editor);
      return;
    }
    document.querySelectorAll('.highlighter-color-dropdown').forEach(d => {
      if (d !== dropdown) d.style.display = 'none';
    });
    dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
  });

  // One document listener for every pen (meetings rebuilds its toolbar on each edit open)
  if (!highlighterOutsideClickInstalled) {
    highlighterOutsideClickInstalled = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.highlighter-color-dropdown').forEach(d => {
        if (d.style.display !== 'none') d.style.display = 'none';
      });
    });
  }

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
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    const hasSelection = !sel.isCollapsed && sel.toString().trim();

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

    // --- List buttons (always visible) — restore focus + selection so commands target the editor ---
    function restoreEditorFocus() {
      editor.focus();
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange.cloneRange());
    }

    // --- Writing commands (formatting, lists, strike, code, link, turn into task) through the registry ---
    const writing = editor._wr || null;
    function runWriting(id, fallback) {
      restoreEditorFocus();
      if (writing) writing.run(id, { source: 'context' });
      else if (fallback) fallback();
      hideHighlightContextMenu();
    }

    rewire('.ctx-bold-btn', () => runWriting('bold', () => document.execCommand('bold')));
    rewire('.ctx-italic-btn', () => runWriting('italic', () => document.execCommand('italic')));
    rewire('.ctx-underline-btn', () => runWriting('underline', () => document.execCommand('underline')));
    const strikeBtn = rewire('.ctx-strike-btn', () => runWriting('strike', () => document.execCommand('strikeThrough')));
    const codeBtn = rewire('.ctx-code-btn', () => runWriting('inlineCode'));
    const linkBtn = rewire('.ctx-link-btn', () => runWriting('link'));
    strikeBtn.style.display = '';
    codeBtn.style.display = writing ? '' : 'none';
    linkBtn.style.display = writing ? '' : 'none';
    menu.querySelector('.ctx-link-divider').style.display = writing ? '' : 'none';
    const insidePill = !!(savedRange.startContainer.parentElement && savedRange.startContainer.parentElement.closest('.project-task-highlight'));
    const canMakeTask = !!(writing && typeof writing.opts.makeTask === 'function' && hasSelection && !insidePill);
    const makeTaskBtn = rewire('.ctx-make-task-btn', () => runWriting('makeTask'));
    makeTaskBtn.style.display = canMakeTask ? '' : 'none';
    // Add as subtask (task description): the selection, or the caret's line
    const canAddSubtask = !!(writing && typeof writing.opts.addSubtask === 'function');
    const addSubtaskBtn = rewire('.ctx-add-subtask-btn', () => runWriting('addSubtask'));
    addSubtaskBtn.style.display = canAddSubtask ? '' : 'none';
    rewire('.ctx-bullet-list-btn', () => runWriting('bulletList', () => document.execCommand('insertUnorderedList')));
    rewire('.ctx-numbered-list-btn', () => runWriting('numberedList', () => document.execCommand('insertOrderedList')));
    rewire('.ctx-checklist-btn', () => runWriting('checklist', () => toggleChecklist(editor)));

    // --- Highlight / Remove highlight (only with selection) ---
    const highlightDivider = menu.querySelector('.ctx-highlight-divider');
    const applyBtn = rewire('.highlight-apply-btn', () => applyHighlightToSelection(editor));
    const removeBtn = rewire('.highlight-remove-btn', () => removeHighlightFromSelection(editor));

    if (hasSelection) {
      highlightDivider.style.display = '';
      applyBtn.style.display = '';
      const anchor = sel.anchorNode;
      const inHighlight = anchor && (
        anchor.nodeType === Node.TEXT_NODE
          ? anchor.parentElement?.closest('mark.text-highlight')
          : anchor.closest?.('mark.text-highlight')
      );
      removeBtn.style.display = inHighlight ? '' : 'none';
    } else {
      highlightDivider.style.display = 'none';
      applyBtn.style.display = 'none';
      removeBtn.style.display = 'none';
    }

    // --- Link task (only with selection + if enabled) ---
    const linkTaskBtn = menu.querySelector('.ctx-link-task-btn');
    const linkTaskDivider = menu.querySelector('.ctx-link-task-divider');
    linkTaskDivider.style.display = (canMakeTask || canAddSubtask) ? '' : 'none';
    if (opts.linkTask && hasSelection) {
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
      if (!canMakeTask && !canAddSubtask) linkTaskDivider.style.display = 'none';
      linkTaskBtn.style.display = 'none';
    }

    // --- Edit/Remove hyperlink (only when right-clicking on a link) ---
    const contextLink = e.target.closest('a[href]');
    const onLink = contextLink && editor.contains(contextLink);
    const editLinkDivider = menu.querySelector('.ctx-edit-link-divider');
    // Writing editors: the links module's popover (undoable); others keep the prompts
    const editInPopover = (focus) => {
      restoreEditorFocus();
      writing.run('link', { source: 'context', link: contextLink, focus });
      hideHighlightContextMenu();
    };
    const editLinkTextBtn = rewire('.ctx-edit-link-text-btn', () => {
      if (contextLink && writing) return editInPopover('text');
      if (contextLink) {
        const newText = prompt('Edit link text:', contextLink.textContent);
        if (newText !== null && newText.trim()) {
          contextLink.textContent = newText.trim();
        }
      }
      hideHighlightContextMenu();
    });
    const editLinkUrlBtn = rewire('.ctx-edit-link-url-btn', () => {
      if (contextLink && writing) return editInPopover('url');
      if (contextLink) {
        const newUrl = prompt('Edit link URL:', contextLink.href);
        if (newUrl !== null && newUrl.trim()) {
          contextLink.href = newUrl.trim();
        }
      }
      hideHighlightContextMenu();
    });
    const removeLinkBtn = rewire('.ctx-remove-link-btn', () => {
      if (contextLink && writing) {
        restoreEditorFocus();
        writing.run('link', { source: 'context', link: contextLink, action: 'remove' });
        hideHighlightContextMenu();
        return;
      }
      if (contextLink) {
        const text = document.createTextNode(contextLink.textContent);
        contextLink.parentNode.replaceChild(text, contextLink);
      }
      hideHighlightContextMenu();
    });
    if (onLink) {
      // On a link, Edit link text / URL replace the generic Link… item
      if (writing) { linkBtn.style.display = 'none'; menu.querySelector('.ctx-link-divider').style.display = 'none'; }
      editLinkDivider.style.display = '';
      editLinkTextBtn.style.display = '';
      editLinkUrlBtn.style.display = '';
      removeLinkBtn.style.display = '';
    } else {
      editLinkDivider.style.display = 'none';
      editLinkTextBtn.style.display = 'none';
      editLinkUrlBtn.style.display = 'none';
      removeLinkBtn.style.display = 'none';
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
    document.addEventListener('keydown', onContextMenuKeydown, true); // Esc / typing close it
  });
}

// ============================================================
// IMAGE RESIZE (shared across all rich-text editors)
// ============================================================

let _activeResizeOverlay = null;

function dismissImageResize() {
  if (_activeResizeOverlay && _activeResizeOverlay.parentNode) {
    const img = _activeResizeOverlay.querySelector('img');
    if (img) {
      _activeResizeOverlay.parentNode.insertBefore(img, _activeResizeOverlay);
    }
    _activeResizeOverlay.remove();
    _activeResizeOverlay = null;
  }
}

export function attachImageResizeHandler(editor) {
  editor.addEventListener('click', (e) => {
    if (e.target.tagName !== 'IMG') {
      // Click on non-image inside editor — dismiss any active overlay
      if (_activeResizeOverlay && _activeResizeOverlay.parentElement === editor) {
        dismissImageResize();
      }
      return;
    }

    e.preventDefault();
    const img = e.target;

    // If already selected (inside a resize wrapper), ignore
    if (img.parentElement && img.parentElement.classList.contains('editor-img-resize-wrap')) return;

    // Dismiss previous overlay if any
    dismissImageResize();

    // Wrap image in a resize container
    const wrapper = document.createElement('span');
    wrapper.className = 'editor-img-resize-wrap';
    wrapper.contentEditable = 'false';
    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    // Corner handles
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
      const h = document.createElement('span');
      h.className = `editor-img-resize-handle ${pos}`;
      h.dataset.handle = pos;
      wrapper.appendChild(h);
    });

    _activeResizeOverlay = wrapper;

    // Resize logic
    wrapper.addEventListener('mousedown', (ev) => {
      const handle = ev.target.dataset && ev.target.dataset.handle;
      if (!handle) return;
      ev.preventDefault();
      ev.stopPropagation();

      const startX = ev.clientX;
      const startY = ev.clientY;
      const startW = img.offsetWidth;
      const startH = img.offsetHeight;
      const aspect = startW / startH;
      const editorRect = editor.getBoundingClientRect();
      const maxW = editor.clientWidth - 24; // account for padding

      const onMove = (me) => {
        me.preventDefault();
        let dx = me.clientX - startX;
        let dy = me.clientY - startY;

        // Mirror delta for left-side handles
        if (handle === 'nw' || handle === 'sw') dx = -dx;
        if (handle === 'nw' || handle === 'ne') dy = -dy;

        // Use whichever delta is larger (aspect-ratio locked)
        let newW;
        if (Math.abs(dx) > Math.abs(dy)) {
          newW = startW + dx;
        } else {
          newW = startW + dy * aspect;
        }

        newW = Math.max(40, Math.min(newW, maxW));
        img.style.width = `${Math.round(newW)}px`;
        img.style.height = 'auto';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Dismiss on click outside the wrapper (but inside editor)
    // Use a one-time mousedown listener on document
    const onDocClick = (ev) => {
      if (!wrapper.contains(ev.target)) {
        // Unwrap: move img out, remove wrapper
        if (wrapper.parentNode) {
          wrapper.parentNode.insertBefore(img, wrapper);
          wrapper.remove();
        }
        _activeResizeOverlay = null;
        document.removeEventListener('mousedown', onDocClick, true);
      }
    };
    // Delay so this click doesn't immediately dismiss
    setTimeout(() => {
      document.addEventListener('mousedown', onDocClick, true);
    }, 0);
  });
}
