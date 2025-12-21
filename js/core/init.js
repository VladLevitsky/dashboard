// Personal Dashboard - Initialization Module
// Handles application startup, event listeners, and UI wiring

import { model, editState, currentData, currentSections } from '../state.js';
import { $, $$, showToast, generateKey } from '../utils.js';
import { PLACEHOLDER_URL, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS, TIMER_UPDATE_INTERVAL_MS, APP_VERSION } from '../constants.js';
import { saveModel, restoreModel, exportBackupFile, deepMergeModel, cleanupOldBackups } from './storage.js';
import {
  toggleEditMode,
  hideEditPopover,
  applyDarkMode,
  toggleDarkMode,
  refreshEditingClasses,
  markDirtyAndSave,
  openEditPopover
} from '../features/edit-mode.js';
import {
  handleDragOver,
  handleDrop
} from '../features/drag-drop.js';
import {
  resetAllTimers,
  addNewTimer,
  updateTimerDisplay,
  renderTimers,
  toggleTimeTracking,
  getTimerInterval,
  setTimerInterval,
  clearTimerInterval
} from '../features/timers.js';
import {
  toggleQuickAccess,
  toggleSelectorMode,
  clearQuickAccess,
  renderQuickAccess,
  makeItemsSelectable,
  handleItemSelection,
  openQuickLinkModal,
  removeQuickLink
} from '../features/quick-access.js';
import {
  loadMediaLibrary,
  saveMediaLibrary,
  addFilesToMediaLibrary,
  persistImageFromLibraryEntry,
  loadManifestMedia,
  openMediaLibrary
} from '../features/media-library.js';
import {
  closeAllReminderLinks,
  closeAllListItemLinks
} from '../features/links.js';
import {
  renderBreakdownRows,
  updateBreakdownSum,
  cancelBreakdownModal,
  acceptBreakdownModal,
  getCurrentBreakdownReminder,
  setCurrentBreakdownReminder
} from '../features/reminders.js';
import { ensureSectionPlusButtons } from '../features/cards.js';

// Module state
let cardsCollapsed = false;

// Copy-text modal state
let currentCopyTextItem = null;
let currentCopyTextSection = null;

// ===== INITIALIZATION =====

export async function init() {
  await restoreModel();

  applyDarkMode();
  applyDisplayMode();
  if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
  if (window.renderAllSections) window.renderAllSections();
  wireUI();
  ensureSectionPlusButtons();
  refreshEditingClasses();

  // Initialize time tracking if it was expanded
  if (model.timeTrackingExpanded) {
    const card = $('#time-tracking-card');
    if (card) {
      card.hidden = false;
      setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
      renderTimers();
      // Start the update interval
      const timerInterval = getTimerInterval();
      if (timerInterval) clearInterval(timerInterval);
      setTimerInterval(setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS));
    }
  }

  // Ensure timer buttons are hidden initially if not in edit mode
  const buttonsContainer = $('#timer-buttons-container');
  if (buttonsContainer) {
    buttonsContainer.hidden = !editState.enabled;
  }

  // Initialize Quick Access if it was expanded
  if (model.quickAccessExpanded) {
    const card = $('#quick-access-card');
    if (card) {
      card.hidden = false;
      setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
      renderQuickAccess();
    }
  }

  // Initialize selector mode if it was active
  if (model.selectorModeActive) {
    const btn = $('#selector-mode-toggle');
    if (btn) {
      btn.classList.add('active');
      // Re-render sections to make items selectable
      setTimeout(() => makeItemsSelectable(), 100);
    }
  }
}

// ===== DISPLAY MODE =====

export function applyDisplayMode() {
  const data = currentData();
  const mode = data.displayMode || 'normal';

  if (mode === 'stacked') {
    document.body.classList.add('stacked-mode');
  } else {
    document.body.classList.remove('stacked-mode');
  }
}

export function openDisplayModeModal() {
  const toggleBtn = $('#display-mode-toggle');
  if (!toggleBtn) return;

  // Check if already open - if so, close it
  let container = toggleBtn._displayModeContainer;
  if (container && container.parentNode) {
    closeDisplayModeModal();
    return;
  }

  const data = currentData();

  // Create the bubble container
  container = document.createElement('div');
  container.className = 'display-mode-bubbles';

  // Normal mode option
  const normalBtn = document.createElement('button');
  normalBtn.type = 'button';
  normalBtn.className = 'display-mode-option' + (data.displayMode === 'normal' ? ' active' : '');
  normalBtn.dataset.mode = 'normal';
  normalBtn.title = 'Normal view';
  normalBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  `;
  normalBtn.style.animationDelay = '0ms';
  normalBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setDisplayMode('normal');
    closeDisplayModeModal();
  });

  // Stacked mode option
  const stackedBtn = document.createElement('button');
  stackedBtn.type = 'button';
  stackedBtn.className = 'display-mode-option' + (data.displayMode === 'stacked' ? ' active' : '');
  stackedBtn.dataset.mode = 'stacked';
  stackedBtn.title = 'Stacked view (for large screens)';
  stackedBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="9" height="18" rx="1" ry="1"/>
      <rect x="13" y="3" width="9" height="8" rx="1" ry="1"/>
      <rect x="13" y="13" width="9" height="8" rx="1" ry="1"/>
    </svg>
  `;
  stackedBtn.style.animationDelay = '50ms';
  stackedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setDisplayMode('stacked');
    closeDisplayModeModal();
  });

  container.appendChild(normalBtn);
  container.appendChild(stackedBtn);

  // Append to body for fixed positioning
  document.body.appendChild(container);
  toggleBtn._displayModeContainer = container;

  // Position above the toggle button
  const btnRect = toggleBtn.getBoundingClientRect();
  container.style.left = `${btnRect.left + btnRect.width / 2}px`;
  container.style.bottom = `${window.innerHeight - btnRect.top + 10}px`;

  // Trigger animation
  requestAnimationFrame(() => {
    container.classList.add('open');
  });
}

export function closeDisplayModeModal() {
  const toggleBtn = $('#display-mode-toggle');
  if (!toggleBtn) return;

  const container = toggleBtn._displayModeContainer;
  if (container && container.parentNode) {
    container.classList.remove('open');
    container.classList.add('closing');
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
      }
    }, 200);
    toggleBtn._displayModeContainer = null;
  }
}

export function setDisplayMode(mode) {
  // Always update both model and working copy to ensure display mode persists
  // Display mode is a UI preference, not content that should be "undoable"
  model.displayMode = mode;
  if (editState.working) {
    editState.working.displayMode = mode;
  }

  // Apply the display mode to the body
  applyDisplayMode();

  // Re-render sections with the new mode's section order
  if (window.renderAllSections) window.renderAllSections();

  // Re-apply edit mode UI if active
  if (editState.enabled) {
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    if (window.refreshEditingClasses) window.refreshEditingClasses();
  }

  // Save to localStorage
  saveModel();
}

// ===== COPY-PASTE MODAL =====

export function openCopyTextModal(item, sectionId) {
  currentCopyTextItem = item;
  currentCopyTextSection = sectionId;

  const modal = $('#copy-text-modal');
  const textarea = $('#copy-text-content');

  // Set current value
  textarea.value = item.copyText || item.text || '';

  // Show modal
  modal.hidden = false;

  // Focus textarea
  setTimeout(() => textarea.focus(), 100);
}

export function hideCopyTextModal() {
  const modal = $('#copy-text-modal');
  modal.hidden = true;
  currentCopyTextItem = null;
  currentCopyTextSection = null;
}

export function acceptCopyTextModal() {
  if (!currentCopyTextItem || !currentCopyTextSection) return;

  const textarea = $('#copy-text-content');
  const text = textarea.value.trim();

  if (!text) {
    showToast('Please enter some text');
    return;
  }

  // Update the item's copyText field
  currentCopyTextItem.copyText = text;

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();
  hideCopyTextModal();
  showToast('Copy text updated');
}

// ===== CARD COLLAPSE/EXPAND =====

export function setupCardCollapseExpand() {
  // Use event delegation on the main container
  const main = $('.app-main');
  if (!main) return;

  main.addEventListener('click', (e) => {
    // Only work when NOT in edit mode
    if (editState.enabled) return;

    // Check if there are any open link containers (reminder or list item links)
    const openLinkContainers = document.querySelectorAll('.reminder-links-expanded, .list-item-links-expanded');
    if (openLinkContainers.length > 0) {
      // If click is inside a link container or on a link toggle button, let it handle itself
      const isInsideLinks = e.target.closest('.reminder-links-expanded, .list-item-links-expanded, .reminder-links-toggle, .list-item-links-toggle');
      if (!isInsideLinks) {
        // Close all open link containers and prevent card collapse
        closeAllReminderLinks();
        closeAllListItemLinks();
        return;
      }
    }

    const clickedCard = e.target.closest('.card');
    if (!clickedCard) return;

    // Check if click was on an interactive element
    const isInteractive = e.target.closest('a, button, input, .editable, .reminder-item, .icon-button, .list-item, .copy-paste-item');

    if (cardsCollapsed) {
      // If cards are collapsed, clicking any card expands all and scrolls to it
      expandAllCards();
      setTimeout(() => {
        clickedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (!isInteractive) {
      // If cards are not collapsed and click is on empty space, collapse all
      collapseAllCards();
    }
  });
}

export function collapseAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.add('collapsed'));
  twoColContainers.forEach(container => container.classList.add('collapsed'));

  cardsCollapsed = true;
}

export function expandAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.remove('collapsed'));
  twoColContainers.forEach(container => container.classList.remove('collapsed'));

  cardsCollapsed = false;
}

// ===== HEADER AND TITLES =====

export function renderHeaderAndTitles() {
  const data = currentData();
  const logoEl = $('.company-logo');
  if (logoEl) {
    // Apply logo transform if set
    const logoZoom = data.header.companyLogoZoom || 1;
    const logoXPercent = data.header.companyLogoXPercent || 0;
    const logoYPercent = data.header.companyLogoYPercent || 0;

    const applyLogoTransformFn = () => {
      if (window.applyLogoTransform) {
        window.applyLogoTransform(logoEl, logoZoom, logoXPercent, logoYPercent);
      }
    };

    // Always set onload handler first, then set/refresh src
    logoEl.onload = applyLogoTransformFn;
    logoEl.src = data.header.companyLogoSrc;

    // If image is already complete (cached), manually trigger transform
    if (logoEl.complete && logoEl.naturalWidth) {
      applyLogoTransformFn();
    }
  }
  const profileEl = $('.profile-photo');
  if (profileEl) {
    // Apply transform if set
    const zoom = data.header.profilePhotoZoom || 1;
    const xPercent = data.header.profilePhotoXPercent || 0;
    const yPercent = data.header.profilePhotoYPercent || 0;

    // Set up onload handler BEFORE setting src to ensure transform is applied
    // whether image is cached or needs to load
    const applyTransform = () => {
      if (window.applyProfilePhotoTransform) {
        window.applyProfilePhotoTransform(profileEl, zoom, xPercent, yPercent);
      }
    };

    // Always set onload handler first, then set/refresh src
    // This ensures transform is applied whether image is cached or newly loaded
    profileEl.onload = applyTransform;
    profileEl.src = data.header.profilePhotoSrc;

    // If image is already complete (cached), manually trigger transform
    // since onload may not fire for cached images
    if (profileEl.complete && profileEl.naturalWidth) {
      applyTransform();
    }
  }
  const nameEl = $('.profile-name');
  if (nameEl) nameEl.textContent = data.header.profileName;
  const titleEl = $('.profile-title');
  if (titleEl) titleEl.textContent = data.header.profileTitle;
  $$('.section-title').forEach(h => {
    const key = h.dataset.section;
    if (key && data.sectionTitles[key]) h.textContent = data.sectionTitles[key];
  });
}

// ===== WIRE UI =====

export function wireUI() {
  $('#edit-toggle').addEventListener('click', toggleEditMode);
  $('#dark-mode-toggle').addEventListener('click', toggleDarkMode);

  // Time tracking event handlers
  $('#time-tracking-toggle').addEventListener('click', toggleTimeTracking);
  $('#reset-all-timers').addEventListener('click', resetAllTimers);
  $('#add-timer-btn').addEventListener('click', addNewTimer);

  // Display mode toggle
  $('#display-mode-toggle').addEventListener('click', openDisplayModeModal);

  // Quick access event handlers
  $('#quick-access-toggle').addEventListener('click', toggleQuickAccess);
  $('#selector-mode-toggle').addEventListener('click', toggleSelectorMode);
  $('#quick-access-clear').addEventListener('click', clearQuickAccess);
  $('#quick-links-add').addEventListener('click', openQuickLinkModal);

  // Global drag and drop event listeners
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);

  // Global click handler for item selection in selector mode
  document.addEventListener('click', handleItemSelection, true);

  // Close reminder and list item link bubbles when clicking outside
  document.addEventListener('click', (e) => {
    const clickedOnReminderToggle = e.target.closest('.reminder-links-toggle');
    const clickedOnListItemToggle = e.target.closest('.list-item-links-toggle');
    const clickedOnBubble = e.target.closest('.reminder-link-bubble');
    if (!clickedOnReminderToggle && !clickedOnBubble) {
      closeAllReminderLinks();
    }
    if (!clickedOnListItemToggle && !clickedOnBubble) {
      closeAllListItemLinks();
    }
    // Close display mode bubbles when clicking outside
    const clickedOnDisplayToggle = e.target.closest('#display-mode-toggle');
    const clickedOnDisplayOption = e.target.closest('.display-mode-option');
    if (!clickedOnDisplayToggle && !clickedOnDisplayOption) {
      closeDisplayModeModal();
    }
  });

  document.addEventListener('dragenter', (e) => e.preventDefault());
  document.addEventListener('dragleave', (e) => e.preventDefault());

  $('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const copyTextarea = $('#edit-copytext');
    const copyText = copyTextarea ? copyTextarea.value : '';
    const payload = {
      text: $('#edit-text').value.trim(),
      url: $('#edit-url').value.trim(),
      copyText: copyText,
      chosenMedia: editState.chosenMedia || null,
      chosenEmoji: editState.chosenEmoji || null,
      accept: true
    };
    if (editState.currentTarget) editState.currentTarget.onDone(payload);
    hideEditPopover();
    // Re-render items that might show new text
    if (window.renderAllSections) window.renderAllSections();
    refreshEditingClasses();
  });

  $('#edit-cancel').addEventListener('click', () => {
    if (editState.currentTarget) editState.currentTarget.onDone({ accept: false });
    hideEditPopover();
  });

  // Global accept/cancel
  // Completely override the button behavior
  $('#edit-accept-global').onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!editState.enabled) return false;

    if (editState.working) {
      // Deep merge the working copy into the model to preserve all nested structures
      deepMergeModel(model, editState.working);
      saveModel();
      // Also create a timestamped backup file for longevity
      try { exportBackupFile(); } catch {}
      // Skip file persistence to avoid triggering Edge file system access
    }

    toggleEditMode();
    return false;
  };

  // Remove all other event listeners and prevent any default behavior
  $('#edit-accept-global').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });

  $('#edit-accept-global').addEventListener('mouseup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });

  $('#edit-accept-global').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });

  $('#edit-cancel-global').addEventListener('click', () => {
    if (!editState.enabled) return;
    toggleEditMode();
  });

  // Restore last backup flow
  const overrideBtn = $('#override-links');
  const importBtn = $('#import-links');
  const importInput = $('#import-links-input');
  const connectBtn = $('#connect-folder');

  // Override links confirmation - now downloads the file instead of trying to write directly
  overrideBtn.addEventListener('click', () => {
    try {
      // Extract current dashboard state (including new items)
      const currentState = window.extractUrlOverrides ? window.extractUrlOverrides() : {};
      const json = JSON.stringify(currentState, null, 2);

      // Generate filename with today's date
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const filename = `Personal Dashboard (${dateStr}).json`;

      // Create a download link to save the file
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Dashboard backup saved as: ${filename}`);
    } catch (error) {
      showToast('Error creating backup file.');
    }
  });

  // Import links from JSON without any server
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      // Set import flag to prevent automatic JSON file saving during import
      window.isImporting = true;

      // Clear the flags for manual imports to allow override application
      window.skipUrlOverrides = false;
      window.localStorageRestored = false;

      const text = await file.text();
      const json = JSON.parse(text);

      // Basic validation
      if (!json || typeof json !== 'object') {
        throw new Error('Invalid file format: not a valid JSON object');
      }

      // Validate critical data structures
      if (json._structure && !Array.isArray(json._structure.sections)) {
        throw new Error('Invalid file format: sections must be an array');
      }

      // Validate reminders structure if present
      if (json.reminders && typeof json.reminders !== 'object') {
        throw new Error('Invalid file format: reminders must be an object');
      }

      // Validate quick access items if present
      if (json.quickAccessItems) {
        if (!json.quickAccessItems.icons || !Array.isArray(json.quickAccessItems.icons)) {
          throw new Error('Invalid file format: quickAccessItems.icons must be an array');
        }
        if (!json.quickAccessItems.listItems || !Array.isArray(json.quickAccessItems.listItems)) {
          throw new Error('Invalid file format: quickAccessItems.listItems must be an array');
        }
      }

      // Optional: validate expected keys exist and warn if different version
      if (json._metadata && json._metadata.version && json._metadata.version !== APP_VERSION) {
        if (!confirm(`This file was exported from a different version (${json._metadata.version}). Import anyway?`)) {
          window.isImporting = false;
          return;
        }
      }

      if (window.applyUrlOverrides) window.applyUrlOverrides(json);

      // Re-render to show the imported data
      if (window.renderAllSections) window.renderAllSections();

      // Wait for rendering to complete using requestAnimationFrame (ensures DOM updates finish)
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve); // Double RAF ensures render completes
        });
      });

      // Clear import flag after render completes
      window.isImporting = false;

      showToast('Links imported. Press checkmark to keep them.');
    } catch (error) {
      console.error('JSON import error:', error);
      showToast(`Invalid JSON file: ${error.message}`);
      // Clear the import flag immediately on error
      window.isImporting = false;
    } finally {
      importInput.value = '';
    }
  });

  // Manually connect project folder (works on file:// if browser supports FS Access)
  connectBtn.addEventListener('click', async () => {
    const handle = await (window.selectProjectFolder ? window.selectProjectFolder() : null);
    showToast(handle ? 'Project folder connected.' : 'Could not connect folder.');
  });

  // Editable section titles
  $$('.section-title').forEach(titleEl => {
    titleEl.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const key = (e.currentTarget).dataset.section;
      const data = currentData();
      openEditPopover(titleEl, { text: data.sectionTitles[key], hideUrl: true }, ({ text, accept }) => {
        if (!accept) return;
        data.sectionTitles[key] = text || data.sectionTitles[key];
        markDirtyAndSave();
        renderHeaderAndTitles();
      });
    });
  });

  // Header editable fields - Logo with image editor
  const logoContainer = $('.company-logo-container');
  if (logoContainer) {
    logoContainer.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const data = currentData();
      // Open image editor for logo
      if (window.openImageEditor) {
        // Convert stored percentages back to pixel offsets for editor (180px frame)
        const editorFrameSize = 180;
        const xPixels = (data.header.companyLogoXPercent || 0) * editorFrameSize;
        const yPixels = (data.header.companyLogoYPercent || 0) * editorFrameSize;

        window.openImageEditor(
          data.header.companyLogoSrc,
          data.header.companyLogoZoom || 1,
          xPixels,
          yPixels,
          ({ src, zoom, xPercent, yPercent }) => {
            data.header.companyLogoSrc = src;
            data.header.companyLogoZoom = zoom;
            data.header.companyLogoXPercent = xPercent;
            data.header.companyLogoYPercent = yPercent;
            markDirtyAndSave();
            renderHeaderAndTitles();
          },
          'logo'  // Type: logo uses square frame and fit-inside zoom
        );
      }
    });
  }

  // Use container for click to ensure it works with transformed image
  const profileContainer = $('.profile-photo-container');
  if (profileContainer) {
    profileContainer.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const data = currentData();
      // Open image editor for profile photo
      if (window.openImageEditor) {
        // Convert stored percentages back to pixel offsets for editor (180px frame)
        const editorFrameSize = 180;
        const xPixels = (data.header.profilePhotoXPercent || 0) * editorFrameSize;
        const yPixels = (data.header.profilePhotoYPercent || 0) * editorFrameSize;

        window.openImageEditor(
          data.header.profilePhotoSrc,
          data.header.profilePhotoZoom || 1,
          xPixels,
          yPixels,
          ({ src, zoom, xPercent, yPercent }) => {
            data.header.profilePhotoSrc = src;
            data.header.profilePhotoZoom = zoom;
            data.header.profilePhotoXPercent = xPercent;
            data.header.profilePhotoYPercent = yPercent;
            markDirtyAndSave();
            renderHeaderAndTitles();
          },
          'profile'  // Type: profile uses circle frame and cover zoom
        );
      }
    });
  }

  $('.profile-name').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { text: data.header.profileName, hideUrl: true }, ({ text, accept }) => {
      if (!accept) return;
      data.header.profileName = text || data.header.profileName;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });

  $('.profile-title').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { text: data.header.profileTitle, hideUrl: true }, ({ text, accept }) => {
      if (!accept) return;
      data.header.profileTitle = text || data.header.profileTitle;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });

  // Hook up "Choose Image..." to open media library
  $('#choose-from-library').addEventListener('click', () => {
    // Hide emoji picker if open
    $('#emoji-picker-container').hidden = true;
    openMediaLibrary((chosen) => {
      editState.chosenMedia = chosen;
      editState.chosenEmoji = null;  // Clear emoji when image is chosen
      $('#chosen-image-name').textContent = chosen.name;
    });
  });

  // Hook up "Choose Emoji" button to toggle emoji picker
  $('#choose-emoji').addEventListener('click', () => {
    const container = $('#emoji-picker-container');
    container.hidden = !container.hidden;
  });

  // Handle emoji selection from emoji picker
  const emojiPicker = document.querySelector('emoji-picker');
  if (emojiPicker) {
    emojiPicker.addEventListener('emoji-click', (event) => {
      const emoji = event.detail.unicode;
      editState.chosenEmoji = emoji;
      editState.chosenMedia = null;  // Clear image when emoji is chosen
      $('#chosen-image-name').textContent = `Emoji: ${emoji}`;
      $('#emoji-picker-container').hidden = true;
    });
  }

  // Breakdown modal event listeners
  $('#breakdown-add-row').addEventListener('click', () => {
    const currentBreakdownReminder = getCurrentBreakdownReminder();
    if (!currentBreakdownReminder) return;
    if (!currentBreakdownReminder.breakdown.rows) {
      currentBreakdownReminder.breakdown.rows = [];
    }
    currentBreakdownReminder.breakdown.rows.push({ title: '', value: 0 });
    renderBreakdownRows();
  });

  $('#breakdown-lock').addEventListener('change', (e) => {
    const currentInput = $('#breakdown-current');
    currentInput.disabled = !e.target.checked;

    // If unlocking, recalculate sum
    const currentBreakdownReminder = getCurrentBreakdownReminder();
    if (!e.target.checked && currentBreakdownReminder) {
      updateBreakdownSum();
    }
  });

  $('#breakdown-accept').addEventListener('click', acceptBreakdownModal);
  $('#breakdown-cancel').addEventListener('click', cancelBreakdownModal);
  $('#breakdown-close').addEventListener('click', cancelBreakdownModal);

  // Close on backdrop click
  $('#breakdown-modal .breakdown-backdrop').addEventListener('click', cancelBreakdownModal);

  // Interval breakdown button
  $('#interval-breakdown-btn').addEventListener('click', () => {
    const currentBreakdownReminder = getCurrentBreakdownReminder();
    if (currentBreakdownReminder) {
      if (window.openBreakdownModal) window.openBreakdownModal(currentBreakdownReminder);
    }
  });

  // Copy-text modal event listeners
  $('#copy-text-accept').addEventListener('click', acceptCopyTextModal);
  $('#copy-text-cancel').addEventListener('click', hideCopyTextModal);
  $('#copy-text-close').addEventListener('click', hideCopyTextModal);

  // Close on backdrop click
  $('#copy-text-modal .copy-text-backdrop').addEventListener('click', hideCopyTextModal);

  // Card collapse/expand functionality (only in view mode)
  setupCardCollapseExpand();
}

// Cleanup timer interval on page unload to prevent memory leak
window.addEventListener('pagehide', () => {
  const timerInterval = getTimerInterval();
  if (timerInterval) {
    clearInterval(timerInterval);
    clearTimerInterval();
  }
});

// Run initialization when DOM is ready
document.addEventListener('DOMContentLoaded', init);
