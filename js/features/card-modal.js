// Personal Dashboard - Card Edit Modal
// When clicking a tile in edit mode, renders the full card (with all edit controls)
// floating on a backdrop. The card looks exactly like it did in the old inline edit mode.

import { editState, currentData, currentSections } from '../state.js';
import { $ } from '../utils.js';
import { markDirtyAndSave, hideEditPopover, hideCalendarPopover, hideIntervalPopover } from './edit-mode.js';

let currentModalSectionId = null;

export function openCardEditModal(sectionId) {
  const modal = $('#card-edit-modal');
  if (!modal) return;

  currentModalSectionId = sectionId;
  const data = currentData();
  const section = currentSections().find(s => s.id === sectionId);
  if (!section) return;

  // Size the modal panel to match the card's actual grid width
  const panel = modal.querySelector('.card-edit-panel');
  if (panel) {
    const gridCard = document.getElementById(sectionId);
    if (gridCard) {
      const mainEl = gridCard.closest('.app-main');
      const zoom = mainEl ? (parseFloat(getComputedStyle(mainEl).zoom) || 1) : 1;
      const actualWidth = gridCard.getBoundingClientRect().width / zoom;
      panel.style.width = `${actualWidth}px`;
    } else {
      // Fallback: proportion-based
      const gridSpan = section.gridSpan || 12;
      const pct = Math.round((gridSpan / 12) * 90);
      panel.style.width = `${pct}%`;
    }
  }

  // Render a full card element with edit mode into the panel
  const body = $('#card-edit-body');
  body.innerHTML = '';

  // Render the card exactly as it appears in inline edit mode
  const cardEl = window.createSectionElement ? window.createSectionElement(section) : null;
  if (cardEl) {
    cardEl.classList.add('editing');
    cardEl.id = sectionId + '-modal-card';
    // Remove tile-mode styles
    cardEl.style.cursor = 'default';
    cardEl.style.gridColumn = '';
    body.appendChild(cardEl);

    // Add edit buttons (delete, reorder, drag handlers) onto this card
    if (window.addCardButtons) {
      // Add just the edit controls for this single card
      const reorderButtons = window.createCardReorderButtons ? window.createCardReorderButtons(sectionId, section.type) : null;
      if (reorderButtons) {
        // Hide reorder in modal (doesn't make sense for single card)
        reorderButtons.style.display = 'none';
        cardEl.appendChild(reorderButtons);
      }
      const deleteBtn = window.createCardDeleteButton ? window.createCardDeleteButton(sectionId) : null;
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          closeCardEditModal();
        });
        cardEl.appendChild(deleteBtn);
      }

      // Close (X) button — rightmost, next to the delete button
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'card-modal-close-btn';
      closeBtn.title = 'Close';
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', closeCardEditModal);
      cardEl.appendChild(closeBtn);
    }
  }

  // Wire backdrop close
  const backdrop = modal.querySelector('.card-edit-backdrop');
  if (backdrop) backdrop.onclick = closeCardEditModal;

  // Wire Escape key
  modal._escHandler = (e) => {
    if (e.key === 'Escape') closeCardEditModal();
  };
  document.addEventListener('keydown', modal._escHandler);

  // Show modal
  modal.hidden = false;
}

export function closeCardEditModal() {
  const modal = $('#card-edit-modal');
  if (!modal) return;

  // Close any item-level editors still open for items inside this card —
  // their target elements are about to be destroyed with the modal.
  hideEditPopover();
  hideCalendarPopover();
  hideIntervalPopover();

  modal.hidden = true;
  if (modal._escHandler) {
    document.removeEventListener('keydown', modal._escHandler);
    modal._escHandler = null;
  }

  currentModalSectionId = null;

  // Re-render the tiles to reflect any changes made
  if (window.renderAllSections) window.renderAllSections();
}

export function getCurrentModalSectionId() {
  return currentModalSectionId;
}
