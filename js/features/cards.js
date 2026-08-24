// Personal Dashboard - Cards Module
// Handles card management (add, delete, move, reorder)

import { editState, currentData, currentSections, ensureSectionInBothArrays, removeSectionFromBothArrays } from '../state.js';
import { $, $$, showToast, generateSectionId, generateUniqueCardTitle, generateKey } from '../utils.js';
import { PLACEHOLDER_URL } from '../constants.js';
import { markDirtyAndSave, refreshEditingClasses, openColorPicker } from './edit-mode.js';

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
  ensureSectionInBothArrays(newSection);

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

  removeSectionFromBothArrays(sectionId);
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
  btn.textContent = '×';
  btn.title = 'Delete this card';
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

// ===== GAP-BASED ADD BUTTON SYSTEM =====

export function addGapButtons() {
  const data = currentData();
  const main = $('.app-main');

  // Remove existing gap buttons
  const existingGapButtons = main.querySelectorAll('.gap-add-btn');
  existingGapButtons.forEach(btn => btn.remove());

  if (!editState.enabled) return;

  // Get all direct children of main (cards and two-col containers)
  const children = Array.from(main.children);
  const sections = currentSections();

  // Build a mapping of DOM positions to section indices
  let sectionIndex = 0;
  const domToSectionMap = [0]; // First gap is before index 0

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.classList.contains('two-col')) {
      // Two-column container - count both sections inside it
      const cards = child.querySelectorAll('.card');
      sectionIndex += cards.length;
    } else if (child.classList.contains('card')) {
      // Regular card - count one section
      sectionIndex += 1;
    }

    // The gap after this element maps to this section index
    domToSectionMap.push(sectionIndex);
  }

  // Add gap buttons with correct section indices
  for (let i = 0; i <= children.length; i++) {
    const targetSectionIndex = domToSectionMap[i];
    const gapBtn = createGapAddButton(targetSectionIndex);

    if (i === 0) {
      // First gap (before first element)
      main.insertBefore(gapBtn, main.firstChild);
    } else if (i === children.length) {
      // Last gap (after last element)
      main.appendChild(gapBtn);
    } else {
      // Gap between elements
      main.insertBefore(gapBtn, children[i]);
    }

    // Show the button since we're in edit mode
    gapBtn.style.display = 'flex';
  }
}

// Gap-based add button
export function createGapAddButton(targetIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gap-add-btn';
  btn.textContent = '+';
  btn.title = 'Add new card here';
  btn.dataset.targetIndex = targetIndex;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    createCard(targetIndex);
  });
  return btn;
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
    title: generateUniqueCardTitle('New Card')
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

  // Insert the new section into current display mode's sections array
  sections.splice(actualTargetIndex, 0, newSection);
  // Also add to the other sections array (for when switching modes)
  ensureSectionInBothArrays(newSection);

  // Add to sectionTitles
  data.sectionTitles[newSection.id] = newSection.title;

  if (window.renderAllSections) window.renderAllSections();
}
