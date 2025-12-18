// Personal Dashboard - Drag and Drop Module
// Handles card and item drag-drop functionality

import { editState, dragState, currentData, currentSections } from '../state.js';
import { $, showToast } from '../utils.js';
import { markDirtyAndSave, refreshEditingClasses } from './edit-mode.js';

// --- Initialize drag handlers for a card
export function initializeDragHandlers(cardElement, sectionId) {
  if (!cardElement || !editState.enabled) return;

  // Make card draggable
  cardElement.draggable = true;
  cardElement.style.cursor = 'move';

  // Drag start
  cardElement.addEventListener('dragstart', (e) => {
    // Prevent dragging if clicking on buttons or interactive elements
    if (e.target.tagName === 'BUTTON' ||
        e.target.tagName === 'A' ||
        e.target.tagName === 'INPUT' ||
        e.target.closest('button') ||
        e.target.closest('.editable') ||
        e.target.closest('.icon-btn') ||
        e.target.closest('.list-item')) {
      e.preventDefault();
      return;
    }

    dragState.draggedElement = cardElement;
    dragState.draggedSection = sectionId;

    // Add dragging class for visual feedback
    cardElement.classList.add('dragging');

    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sectionId);

    // Create drop indicator if it doesn't exist
    if (!dragState.dropIndicator) {
      dragState.dropIndicator = document.createElement('div');
      dragState.dropIndicator.className = 'drop-indicator';
      dragState.dropIndicator.style.position = 'absolute';
      dragState.dropIndicator.style.zIndex = '1000';
      dragState.dropIndicator.style.pointerEvents = 'none';
      dragState.dropIndicator.innerHTML = '<div class="drop-line"></div>';
      document.body.appendChild(dragState.dropIndicator);
    }
    // Make sure indicator starts hidden
    dragState.dropIndicator.style.display = 'none';
  });

  // Drag end
  cardElement.addEventListener('dragend', (e) => {
    // Remove dragging class
    cardElement.classList.remove('dragging');

    // Hide drop indicator
    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }

    // Reset drag state
    dragState.draggedElement = null;
    dragState.draggedSection = null;
    dragState.potentialDropZone = null;
    dragState.potentialDropPosition = null;
  });
}

// --- Handle drag over for determining drop zones
export function handleDragOver(e) {
  // Check for either regular card drag or two-col container drag
  if ((!dragState.draggedElement && !dragState.draggedTwoCol) || !editState.enabled) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Throttle the event to prevent performance issues
  const now = Date.now();
  if (now - dragState.lastDragOverTime < 50) return; // 50ms throttle
  dragState.lastDragOverTime = now;

  // Check if we're over the main area
  const main = document.querySelector('.app-main');
  if (!main) return;

  const allCards = Array.from(main.querySelectorAll('.card:not(.dragging)'));

  // If no other cards, hide indicator and return
  if (allCards.length === 0) {
    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }
    return;
  }

  // Get mouse position
  const mouseY = e.clientY;
  const mouseX = e.clientX;

  // Find the closest card
  let closestCard = null;
  let closestDistance = Infinity;
  let dropPosition = 'before'; // or 'after' or 'beside'

  allCards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const cardMiddleY = rect.top + rect.height / 2;
    const cardMiddleX = rect.left + rect.width / 2;

    // Check if we're near this card
    const distanceY = Math.abs(mouseY - cardMiddleY);

    if (distanceY < closestDistance) {
      closestDistance = distanceY;
      closestCard = card;

      // Determine drop position
      if (mouseY < cardMiddleY) {
        dropPosition = 'before';
      } else {
        dropPosition = 'after';
      }

      // Check if we're dragging to the side for two-column layout
      const horizontalDistance = Math.abs(mouseX - cardMiddleX);
      const verticalThreshold = rect.height * 0.3; // Within 30% of card height

      if (distanceY < verticalThreshold && horizontalDistance > rect.width * 0.4) {
        // Check if this card can form a two-column pair
        const data = currentData();
        const sections = currentSections();
        const cardSection = sections.find(s => s.id === card.id);
        const draggedSectionData = sections.find(s => s.id === dragState.draggedSection);

        // Allow two-column creation for any cards
        if (cardSection && draggedSectionData && cardSection.id !== draggedSectionData.id) {
          dropPosition = mouseX < cardMiddleX ? 'beside-left' : 'beside-right';
        }
      }
    }
  });

  // Check if we're trying to drop between two-column pair cards
  if (closestCard && (dropPosition === 'before' || dropPosition === 'after')) {
    const sections = currentSections();
    const cardSection = sections.find(s => s.id === closestCard.id);

    if (cardSection && cardSection.twoColumnPair) {
      // If dropping "before" the RIGHT card (pairIndex 1), redirect to "before" the LEFT card
      if (dropPosition === 'before' && cardSection.pairIndex === 1) {
        const cardIndex = sections.findIndex(s => s.id === closestCard.id);
        if (cardIndex > 0) {
          const leftCard = sections[cardIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            const leftCardEl = document.getElementById(leftCard.id);
            if (leftCardEl) {
              closestCard = leftCardEl;
            }
          }
        }
      }
      // If dropping "after" the LEFT card (pairIndex 0), redirect to "after" the RIGHT card
      else if (dropPosition === 'after' && cardSection.pairIndex === 0) {
        const cardIndex = sections.findIndex(s => s.id === closestCard.id);
        if (cardIndex < sections.length - 1) {
          const rightCard = sections[cardIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            const rightCardEl = document.getElementById(rightCard.id);
            if (rightCardEl) {
              closestCard = rightCardEl;
            }
          }
        }
      }
    }
  }

  // Update drop indicator position
  if (closestCard && dragState.dropIndicator) {
    const rect = closestCard.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Make indicator visible
    dragState.dropIndicator.style.display = 'block';

    // Position the drop indicator absolutely
    if (dropPosition === 'before') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop - 6}px`;
      dragState.dropIndicator.style.width = `${rect.width}px`;
      dragState.dropIndicator.style.height = '4px';
      dragState.dropIndicator.className = 'drop-indicator horizontal';
    } else if (dropPosition === 'after') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft}px`;
      dragState.dropIndicator.style.top = `${rect.bottom + scrollTop + 2}px`;
      dragState.dropIndicator.style.width = `${rect.width}px`;
      dragState.dropIndicator.style.height = '4px';
      dragState.dropIndicator.className = 'drop-indicator horizontal';
    } else if (dropPosition === 'beside-left') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft - 6}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop}px`;
      dragState.dropIndicator.style.width = '4px';
      dragState.dropIndicator.style.height = `${rect.height}px`;
      dragState.dropIndicator.className = 'drop-indicator vertical beside-left';
    } else if (dropPosition === 'beside-right') {
      dragState.dropIndicator.style.left = `${rect.right + scrollLeft + 2}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop}px`;
      dragState.dropIndicator.style.width = '4px';
      dragState.dropIndicator.style.height = `${rect.height}px`;
      dragState.dropIndicator.className = 'drop-indicator vertical beside-right';
    }

    dragState.potentialDropZone = closestCard.id;
    dragState.potentialDropPosition = dropPosition;
  } else if (dragState.dropIndicator) {
    // Hide indicator if no valid drop zone
    dragState.dropIndicator.style.display = 'none';
  }
}

// --- Handle drop for two-column container (moves both cards together)
function handleTwoColDrop(e, sections) {
  const firstCardId = dragState.draggedSection;
  const secondCardId = dragState.draggedSecondSection;

  const firstIndex = sections.findIndex(s => s.id === firstCardId);
  const secondIndex = sections.findIndex(s => s.id === secondCardId);

  if (firstIndex === -1 || secondIndex === -1) return;

  // Get the target
  let targetIndex = sections.findIndex(s => s.id === dragState.potentialDropZone);

  // If target is part of the dragged pair, ignore
  if (dragState.potentialDropZone === firstCardId || dragState.potentialDropZone === secondCardId) return;

  if (targetIndex === -1) return;

  let position = dragState.potentialDropPosition;

  // Prevent wedging cards between two-column pair cards
  if (position === 'before' || position === 'after') {
    const targetCard = sections[targetIndex];
    if (targetCard && targetCard.twoColumnPair) {
      if (position === 'before' && targetCard.pairIndex === 1) {
        if (targetIndex > 0) {
          const leftCard = sections[targetIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            targetIndex = targetIndex - 1;
          }
        }
      }
      else if (position === 'after' && targetCard.pairIndex === 0) {
        if (targetIndex < sections.length - 1) {
          const rightCard = sections[targetIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            targetIndex = targetIndex + 1;
          }
        }
      }
    }
  }

  // Don't allow beside positioning when dragging a two-col
  if (position === 'beside-left' || position === 'beside-right') {
    showToast('Two-column pairs must stay together');
    return;
  }

  // Get both cards
  const firstCard = sections[firstIndex];
  const secondCard = sections[secondIndex];

  // Determine which card is actually first in the array
  const lowerIndex = Math.min(firstIndex, secondIndex);
  const higherIndex = Math.max(firstIndex, secondIndex);

  // Remove both cards
  const cardAtHigher = sections.splice(higherIndex, 1)[0];
  const cardAtLower = sections.splice(lowerIndex, 1)[0];

  // Recalculate target index after removals
  let adjustedTargetIndex = targetIndex;
  if (targetIndex > higherIndex) adjustedTargetIndex -= 1;
  if (targetIndex > lowerIndex) adjustedTargetIndex -= 1;

  // Calculate insertion index
  let insertIndex = adjustedTargetIndex;
  if (position === 'after') {
    insertIndex = adjustedTargetIndex + 1;
  }

  // Insert both cards at the new position
  const leftCard = cardAtLower.pairIndex === 0 ? cardAtLower : cardAtHigher;
  const rightCard = cardAtLower.pairIndex === 0 ? cardAtHigher : cardAtLower;

  sections.splice(insertIndex, 0, leftCard, rightCard);

  // Update and re-render
  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled) {
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  showToast('Cards moved');
}

// --- Handle drop event
export function handleDrop(e) {
  e.preventDefault();

  if (!dragState.draggedSection || !dragState.potentialDropZone || !editState.enabled) return;

  const data = currentData();
  const sections = currentSections();

  // Handle two-column container drop
  if (dragState.draggedTwoCol) {
    handleTwoColDrop(e, sections);
    return;
  }

  const draggedIndex = sections.findIndex(s => s.id === dragState.draggedSection);
  let targetIndex = sections.findIndex(s => s.id === dragState.potentialDropZone);

  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  let position = dragState.potentialDropPosition;

  // Prevent wedging cards between two-column pair cards
  if (position === 'before' || position === 'after') {
    const targetCard = sections[targetIndex];
    if (targetCard && targetCard.twoColumnPair) {
      if (position === 'before' && targetCard.pairIndex === 1) {
        if (targetIndex > 0) {
          const leftCard = sections[targetIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            targetIndex = targetIndex - 1;
          }
        }
      }
      else if (position === 'after' && targetCard.pairIndex === 0) {
        if (targetIndex < sections.length - 1) {
          const rightCard = sections[targetIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            targetIndex = targetIndex + 1;
          }
        }
      }
    }
  }

  if (position === 'beside-left' || position === 'beside-right') {
    // Create two-column layout
    const draggedCard = sections[draggedIndex];
    const targetCard = sections[targetIndex];

    // Break existing pairs if needed
    if (draggedCard.twoColumnPair) {
      const draggedPairIndex = draggedCard.pairIndex === 0 ? draggedIndex + 1 : draggedIndex - 1;
      if (draggedPairIndex >= 0 && draggedPairIndex < sections.length) {
        const draggedPairCard = sections[draggedPairIndex];
        if (draggedPairCard && draggedPairCard.twoColumnPair) {
          delete draggedPairCard.twoColumnPair;
          delete draggedPairCard.pairIndex;
        }
      }
    }

    if (targetCard.twoColumnPair) {
      const targetPairIndex = targetCard.pairIndex === 0 ? targetIndex + 1 : targetIndex - 1;
      if (targetPairIndex >= 0 && targetPairIndex < sections.length) {
        const targetPairCard = sections[targetPairIndex];
        if (targetPairCard && targetPairCard.twoColumnPair) {
          delete targetPairCard.twoColumnPair;
          delete targetPairCard.pairIndex;
        }
      }
    }

    // Remove dragged card from its current position
    sections.splice(draggedIndex, 1);

    // Update target index after removal
    const newTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

    // Set two-column properties
    draggedCard.twoColumnPair = true;
    targetCard.twoColumnPair = true;

    if (position === 'beside-left') {
      draggedCard.pairIndex = 0;
      targetCard.pairIndex = 1;
      sections.splice(newTargetIndex, 0, draggedCard);
    } else {
      draggedCard.pairIndex = 1;
      targetCard.pairIndex = 0;
      sections.splice(newTargetIndex + 1, 0, draggedCard);
    }
  } else {
    // Normal reordering
    const draggedCard = sections[draggedIndex];

    // Break existing pair if needed
    if (draggedCard.twoColumnPair) {
      const pairIndex = draggedCard.pairIndex === 0 ? draggedIndex + 1 : draggedIndex - 1;
      const pairCard = sections[pairIndex];
      if (pairCard && pairCard.twoColumnPair) {
        delete pairCard.twoColumnPair;
        delete pairCard.pairIndex;
      }
      delete draggedCard.twoColumnPair;
      delete draggedCard.pairIndex;
    }

    // Remove from current position
    sections.splice(draggedIndex, 1);

    // Calculate new index
    let newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    if (position === 'after') {
      newIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }

    // Insert at new position
    sections.splice(newIndex, 0, draggedCard);
  }

  // Update and re-render
  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();
  if (editState.enabled) {
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  if (position === 'beside-left' || position === 'beside-right') {
    showToast('Two-column layout created');
  } else {
    showToast('Card moved');
  }
}

// --- Initialize drag handlers for items (icons, list items)
export function initializeItemDragHandlers(element, itemKey, sectionKey) {
  if (!element || !editState.enabled) return;

  // Make item draggable
  element.draggable = true;
  element.style.cursor = 'grab';

  // Drag start
  element.addEventListener('dragstart', (e) => {
    e.stopPropagation();

    dragState.draggedItem = element;
    dragState.draggedItemKey = itemKey;
    dragState.draggedItemSection = sectionKey;

    element.classList.add('item-dragging');
    element.style.cursor = 'grabbing';

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemKey);

    // Create item drop indicator if it doesn't exist
    if (!dragState.itemDropIndicator) {
      dragState.itemDropIndicator = document.createElement('div');
      dragState.itemDropIndicator.className = 'item-drop-indicator';
      dragState.itemDropIndicator.style.position = 'absolute';
      dragState.itemDropIndicator.style.zIndex = '1001';
      dragState.itemDropIndicator.style.pointerEvents = 'none';
      dragState.itemDropIndicator.innerHTML = '<div class="item-drop-line"></div>';
      document.body.appendChild(dragState.itemDropIndicator);
    }
    dragState.itemDropIndicator.style.display = 'none';
  });

  // Drag end
  element.addEventListener('dragend', (e) => {
    e.stopPropagation();

    element.classList.remove('item-dragging');
    element.style.cursor = 'grab';

    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'none';
    }

    dragState.draggedItem = null;
    dragState.draggedItemKey = null;
    dragState.draggedItemSection = null;
  });
}

// --- Initialize container-level drag handlers for better drop zone coverage
export function initializeContainerDragHandlers(container, sectionKey) {
  if (!container || !editState.enabled) return;

  // Check if already initialized
  if (container.dataset.dragInitialized) return;
  container.dataset.dragInitialized = 'true';

  const isIconContainer = container.classList.contains('icon-grid') || container.classList.contains('icon-row');

  // Determine gap size based on container type
  let gapSize = 12;
  if (container.classList.contains('icon-grid')) {
    gapSize = 16;
  } else if (container.classList.contains('icon-row')) {
    gapSize = 24;
  }
  const halfGap = gapSize / 2;

  // Drag over - detect where to drop
  container.addEventListener('dragover', (e) => {
    if (!dragState.draggedItem || !editState.enabled) return;
    if (dragState.draggedItemSection !== sectionKey) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const mouseX = e.clientX;
    const mouseY = e.clientY;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Get all draggable items in this container
    const items = Array.from(container.querySelectorAll('[data-key]')).filter(item =>
      !item.classList.contains('add-tile') &&
      !item.classList.contains('item-dragging') &&
      !item.classList.contains('icon-separator')
    );

    if (items.length === 0) {
      dragState.itemDropIndicator.style.display = 'none';
      return;
    }

    let closestItem = null;
    let closestDistance = Infinity;
    let dropPosition = 'before';

    if (isIconContainer) {
      // Group items by row
      const itemsByRow = [];
      const rowTolerance = 10;

      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top;

        let rowGroup = itemsByRow.find(row => Math.abs(row.top - itemTop) < rowTolerance);
        if (!rowGroup) {
          rowGroup = { top: itemTop, items: [] };
          itemsByRow.push(rowGroup);
        }
        rowGroup.items.push({ element: item, rect });
      });

      itemsByRow.sort((a, b) => a.top - b.top);
      itemsByRow.forEach(row => {
        row.items.sort((a, b) => a.rect.left - b.rect.left);
      });

      // Find target row
      let targetRow = null;
      let closestRowDistance = Infinity;

      itemsByRow.forEach(row => {
        const rowTop = row.items[0].rect.top;
        const rowBottom = row.items[0].rect.bottom;
        const rowCenterY = (rowTop + rowBottom) / 2;
        const distance = Math.abs(mouseY - rowCenterY);

        if (distance < closestRowDistance) {
          closestRowDistance = distance;
          targetRow = row;
        }
      });

      // Find closest item in target row
      if (targetRow && targetRow.items.length > 0) {
        targetRow.items.forEach(({ element: item, rect }) => {
          const itemCenterX = rect.left + rect.width / 2;
          const distance = Math.abs(mouseX - itemCenterX);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = item;
            dropPosition = mouseX < itemCenterX ? 'before' : 'after';
          }
        });

        const lastInRow = targetRow.items[targetRow.items.length - 1];
        if (lastInRow && mouseX > lastInRow.rect.right + halfGap) {
          closestItem = lastInRow.element;
          dropPosition = 'after';
        }
      }
    } else {
      // Vertical list
      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(mouseY - itemCenterY);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          dropPosition = mouseY < itemCenterY ? 'before' : 'after';
        }
      });

      const lastItem = items[items.length - 1];
      if (lastItem) {
        const lastRect = lastItem.getBoundingClientRect();
        if (mouseY > lastRect.bottom + halfGap) {
          closestItem = lastItem;
          dropPosition = 'after';
        }
      }
    }

    if (closestItem && dragState.itemDropIndicator) {
      const rect = closestItem.getBoundingClientRect();
      dragState.itemDropIndicator.style.display = 'block';

      dragState.itemDropIndicator.dataset.targetKey = closestItem.dataset.key;
      dragState.itemDropIndicator.dataset.position = dropPosition;

      if (isIconContainer) {
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.left = `${rect.right + scrollLeft + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.top = `${rect.top + scrollTop}px`;
        dragState.itemDropIndicator.style.width = '3px';
        dragState.itemDropIndicator.style.height = `${rect.height}px`;
        dragState.itemDropIndicator.className = 'item-drop-indicator vertical';
      } else {
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.top = `${rect.top + scrollTop - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.top = `${rect.bottom + scrollTop + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
      }
    }
  });

  // Drop - reorder the item
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;
    if (dragState.draggedItemSection !== sectionKey) return;

    const data = currentData();

    // Handle composite keys for copy-paste items
    let collection;
    if (sectionKey.includes(':')) {
      const [sectionId, subtitle] = sectionKey.split(':');
      collection = data[sectionId]?.[subtitle];
    } else {
      collection = data[sectionKey];
    }

    if (!Array.isArray(collection)) return;

    const targetKey = dragState.itemDropIndicator?.dataset.targetKey;
    const position = dragState.itemDropIndicator?.dataset.position;

    if (!targetKey) return;

    const draggedIndex = collection.findIndex(item => item.key === dragState.draggedItemKey);
    const targetIndex = collection.findIndex(item => item.key === targetKey);

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    let finalIndex;
    if (position === 'before') {
      finalIndex = targetIndex;
    } else {
      finalIndex = targetIndex + 1;
    }

    if (finalIndex === draggedIndex || finalIndex === draggedIndex + 1) return;

    const [draggedItem] = collection.splice(draggedIndex, 1);

    let newIndex;
    if (draggedIndex < finalIndex) {
      newIndex = finalIndex - 1;
    } else {
      newIndex = finalIndex;
    }

    collection.splice(newIndex, 0, draggedItem);

    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    if (editState.enabled) {
      if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    showToast('Item moved');
  });
}

// --- Initialize drag handlers for reminder items
export function initializeReminderDragHandlers(element, itemKey, subtitle, sectionId) {
  if (!element || !editState.enabled) return;

  element.draggable = true;
  element.style.cursor = 'grab';

  // Drag start
  element.addEventListener('dragstart', (e) => {
    e.stopPropagation();

    dragState.draggedItem = element;
    dragState.draggedItemKey = itemKey;
    dragState.draggedItemSection = `${sectionId}:${subtitle}`;

    element.classList.add('item-dragging');
    element.style.cursor = 'grabbing';

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemKey);

    if (!dragState.itemDropIndicator) {
      dragState.itemDropIndicator = document.createElement('div');
      dragState.itemDropIndicator.className = 'item-drop-indicator';
      dragState.itemDropIndicator.style.position = 'absolute';
      dragState.itemDropIndicator.style.zIndex = '1001';
      dragState.itemDropIndicator.style.pointerEvents = 'none';
      dragState.itemDropIndicator.innerHTML = '<div class="item-drop-line"></div>';
      document.body.appendChild(dragState.itemDropIndicator);
    }
    dragState.itemDropIndicator.style.display = 'none';
  });

  // Drag end
  element.addEventListener('dragend', (e) => {
    e.stopPropagation();

    element.classList.remove('item-dragging');
    element.style.cursor = 'grab';

    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'none';
    }

    dragState.draggedItem = null;
    dragState.draggedItemKey = null;
    dragState.draggedItemSection = null;
  });

  // Drag over
  element.addEventListener('dragover', (e) => {
    if (!dragState.draggedItem || !editState.enabled) return;

    const draggedSectionSubtitle = dragState.draggedItemSection;
    const currentSectionSubtitle = `${sectionId}:${subtitle}`;

    if (draggedSectionSubtitle !== currentSectionSubtitle) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Check if this is the last item
    const data = currentData();
    let remindersData;
    if (sectionId === 'reminders') {
      remindersData = data.reminders;
    } else {
      remindersData = data[sectionId];
    }
    const collection = remindersData?.[subtitle] || [];
    const isLastItem = Array.isArray(collection) && collection[collection.length - 1]?.key === itemKey;

    const gapSize = 12;
    const halfGap = gapSize / 2;

    const isTopHalf = e.clientY < rect.top + rect.height / 2;

    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'block';

      if (isTopHalf) {
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        dragState.itemDropIndicator.style.top = `${rect.top + scrollTop - halfGap - 1.5}px`;
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
        dragState.itemDropIndicator.dataset.position = 'before';
        dragState.itemDropIndicator.dataset.targetKey = itemKey;
      } else if (isLastItem) {
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        dragState.itemDropIndicator.style.top = `${rect.bottom + scrollTop + halfGap - 1.5}px`;
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
        dragState.itemDropIndicator.dataset.position = 'after';
        dragState.itemDropIndicator.dataset.targetKey = itemKey;
      } else {
        dragState.itemDropIndicator.style.display = 'none';
      }
    }
  });

  // Drop
  element.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;

    const draggedSectionSubtitle = dragState.draggedItemSection;
    const currentSectionSubtitle = `${sectionId}:${subtitle}`;

    if (draggedSectionSubtitle !== currentSectionSubtitle) return;

    const data = currentData();

    let remindersData;
    if (sectionId === 'reminders') {
      remindersData = data.reminders;
    } else {
      remindersData = data[sectionId];
    }

    if (!remindersData || !remindersData[subtitle]) return;

    const collection = remindersData[subtitle];
    if (!Array.isArray(collection)) return;

    const draggedIndex = collection.findIndex(item => item.key === dragState.draggedItemKey);
    const targetIndex = collection.findIndex(item => item.key === itemKey);

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    const position = dragState.itemDropIndicator?.dataset.position;

    let finalIndex;
    if (position === 'before') {
      finalIndex = targetIndex;
    } else {
      finalIndex = targetIndex + 1;
    }

    if (finalIndex === draggedIndex || finalIndex === draggedIndex + 1) return;

    const [draggedItem] = collection.splice(draggedIndex, 1);

    let newIndex;
    if (draggedIndex < finalIndex) {
      newIndex = finalIndex - 1;
    } else {
      newIndex = finalIndex;
    }

    collection.splice(newIndex, 0, draggedItem);

    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    if (editState.enabled) {
      if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    showToast('Reminder moved');
  });
}

// --- Remove drag handlers from all cards
export function removeDragHandlers() {
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    card.draggable = false;
    card.style.cursor = '';
    card.classList.remove('dragging');
  });

  // Remove items draggability
  const items = document.querySelectorAll('.icon-button, .list-item, .reminder-item');
  items.forEach(item => {
    item.draggable = false;
    item.style.cursor = '';
    item.classList.remove('item-dragging');
  });

  // Remove drop indicator if it exists
  if (dragState.dropIndicator && dragState.dropIndicator.parentElement) {
    dragState.dropIndicator.parentElement.removeChild(dragState.dropIndicator);
    dragState.dropIndicator = null;
  }

  // Remove item drop indicator if it exists
  if (dragState.itemDropIndicator && dragState.itemDropIndicator.parentElement) {
    dragState.itemDropIndicator.parentElement.removeChild(dragState.itemDropIndicator);
    dragState.itemDropIndicator = null;
  }
}
