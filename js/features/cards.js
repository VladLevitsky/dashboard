// Personal Dashboard - Cards Module
// Handles card management (add, delete, move, reorder)

import { editState, currentData, currentSections } from '../state.js';
import { $, $$, showToast, generateSectionId, generateUniqueCardTitle, generateKey } from '../utils.js';
import { PLACEHOLDER_URL } from '../constants.js';
import { markDirtyAndSave, refreshEditingClasses, openColorPicker } from './edit-mode.js';
import { getGridCols } from './grid-engine.js';

// --- Add new card
export function onAddCard(targetSectionId) {
  const data = currentData();
  const sections = currentSections();
  const targetIndex = sections.findIndex(s => s.id === targetSectionId);
  if (targetIndex === -1) return;

  const targetSection = sections[targetIndex];
  let newCardType = 'newCard';
  let newCardStructure = 'regular';

  if (['analytics', 'tools'].includes(targetSection.type)) {
    newCardType = 'newCardAnalytics';
    newCardStructure = 'analytics-style';
  }

  const newSectionId = generateSectionId();
  const uniqueTitle = generateUniqueCardTitle('New Card');
  const newSection = {
    id: newSectionId,
    type: newCardType,
    title: uniqueTitle,
    structure: newCardStructure
  };

  sections.splice(targetIndex, 0, newSection);

  data[newSectionId] = [];
  data.sectionTitles[newSectionId] = uniqueTitle;

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();
}

// --- Delete card
export function onDeleteCard(sectionId) {
  if (!confirm('Delete this entire card? All items will be removed. This cannot be undone.')) {
    return;
  }

  const data = currentData();
  const sections = currentSections();
  const sectionIndex = sections.findIndex(s => s.id === sectionId);
  if (sectionIndex === -1) return;

  // Collect R2 fileIds from all items in this card for deferred cleanup
  const orphanFileIds = [];
  const cardData = data[sectionId];
  if (cardData && typeof cardData === 'object') {
    Object.values(cardData).forEach(group => {
      if (!group || typeof group !== 'object') return;
      ['icons', 'reminders', 'subtasks'].forEach(key => {
        if (group[key]) {
          group[key].forEach(item => {
            if (item.linkType === 'file' && item.fileId) orphanFileIds.push(item.fileId);
          });
        }
      });
    });
  }

  data.sections = data.sections.filter(s => s.id !== sectionId);
  delete data.sectionTitles[sectionId];
  delete data[sectionId];

  // Clean up associated data
  if (data.collapsedCards) {
    delete data.collapsedCards[sectionId];
  }
  if (data.cardNotes) {
    delete data.cardNotes[sectionId];
  }

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  // Deferred R2 cleanup after profile is persisted
  if (orphanFileIds.length > 0 && window.cleanupOrphanedR2Files) {
    window.cleanupOrphanedR2Files(orphanFileIds);
  }
}

// --- Move card up
export function moveCardUp(sectionId) {
  const sections = currentSections();
  const index = sections.findIndex(s => s.id === sectionId);

  if (index > 0) {
    const scrollY = window.scrollY;

    const currentCard = sections[index];
    const prevCard = sections[index - 1];

    sections[index] = prevCard;
    sections[index - 1] = currentCard;

    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    window.scrollTo(0, scrollY);
    showToast('Card moved up');
  }
}

// --- Move card down
export function moveCardDown(sectionId) {
  const sections = currentSections();
  const index = sections.findIndex(s => s.id === sectionId);

  if (index >= 0 && index < sections.length - 1) {
    const scrollY = window.scrollY;

    const currentCard = sections[index];
    const nextCard = sections[index + 1];

    sections[index] = nextCard;
    sections[index + 1] = currentCard;

    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    window.scrollTo(0, scrollY);
    showToast('Card moved down');
  }
}

// --- Create card add button
export function createCardAddButton(sectionId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-add-btn';
  btn.textContent = '+';
  btn.title = 'Add new card above this one';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    onAddCard(sectionId);
  });
  return btn;
}

// --- Create card delete button
export function createCardDeleteButton(sectionId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-delete-btn';
  btn.title = 'Delete this card';
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    onDeleteCard(sectionId);
  });
  return btn;
}

// --- Create card reorder buttons
export function createCardReorderButtons(sectionId, sectionType) {
  const container = document.createElement('div');
  container.className = 'card-reorder-buttons';

  if (['analytics', 'tools', 'newCardAnalytics'].includes(sectionType)) {
    const colorPickerBtn = document.createElement('button');
    colorPickerBtn.type = 'button';
    colorPickerBtn.className = 'color-picker-btn';
    colorPickerBtn.title = 'Change bubble color';
    colorPickerBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="9" fill="url(#colorGradient-${sectionId})" stroke="currentColor" stroke-width="1"/>
        <defs>
          <linearGradient id="colorGradient-${sectionId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
            <stop offset="25%" style="stop-color:#4ecdc4;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#ffe66d;stop-opacity:1" />
            <stop offset="75%" style="stop-color:#a8dadc;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#f1c0e8;stop-opacity:1" />
          </linearGradient>
        </defs>
      </svg>
    `;
    colorPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPicker(sectionId, sectionType);
    });
    container.appendChild(colorPickerBtn);
  }

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'card-reorder-btn';
  upBtn.title = 'Move card up';
  upBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"></path>
    </svg>
  `;
  upBtn.addEventListener('click', (e) => {
    e.preventDefault();
    moveCardUp(sectionId);
  });

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'card-reorder-btn';
  downBtn.title = 'Move card down';
  downBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
    </svg>
  `;
  downBtn.addEventListener('click', (e) => {
    e.preventDefault();
    moveCardDown(sectionId);
  });

  container.appendChild(upBtn);
  container.appendChild(downBtn);

  return container;
}

// --- Ensure section plus buttons exist
export function ensureSectionPlusButtons() {
  // This function is called by moveCardUp/moveCardDown
  // The actual implementation adds plus buttons between sections
  // For now, we rely on renderAllSections to handle this via addCardButtons
}

// Legacy stubs (no longer used - gap buttons replaced by Add Card FAB)
export function addGapButtons() {}
export function createGapAddButton() { return document.createElement('div');
}

// ===== CARD CREATION =====

export function createCard(targetIndex) {
  const data = currentData();
  const sections = currentSections();

  // Ensure the index is within bounds
  let actualTargetIndex = targetIndex;
  if (actualTargetIndex < 0) {
    actualTargetIndex = 0;
  } else if (actualTargetIndex > sections.length) {
    actualTargetIndex = sections.length;
  }

  // Create unified card that can hold icons, reminders, subtasks, and copy-paste items
  const newSection = {
    id: generateSectionId(),
    type: 'unified',
    title: generateUniqueCardTitle('New Card'),
    // Full width of the ACTIVE device mode; autoAssign places it, and
    // markDirtyAndSave's persistActiveLayout hook stores it in the profile.
    gridColSpan: getGridCols(),
    gridRowSpan: 8
  };

  // Initialize with unified structure (_default contains icons, reminders, subtasks, copyPaste)
  data[newSection.id] = {
    '_default': {
      icons: [],
      reminders: [],
      subtasks: [],
      copyPaste: []
    }
  };

  // Insert the new section into the sections array
  sections.splice(actualTargetIndex, 0, newSection);

  // Add to sectionTitles
  data.sectionTitles[newSection.id] = newSection.title;

  if (window.renderAllSections) window.renderAllSections();
}
