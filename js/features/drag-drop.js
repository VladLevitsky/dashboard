// Personal Dashboard - Drag and Drop Module
// Handles card and item drag-drop functionality

import { editState, dragState, currentData, currentSections } from '../state.js';
import { $, showToast } from '../utils.js';
import { markDirtyAndSave, refreshEditingClasses } from './edit-mode.js';
import {
  DEFAULT_ROW_SPAN,
  mouseToGridCell, computeDropPosition, resolveCollisions
} from './grid-engine.js';

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

    // Record the ANCHOR OFFSET: which cell within the card was grabbed.
    // This keeps the ghost aligned with where the card visually sits under
    // the cursor, instead of snapping the card's top-left to the mouse.
    const section = currentSections().find(s => s.id === sectionId);
    const grabCell = mouseToGridCell(e.clientX, e.clientY);
    if (section && section.gridCol && section.gridRow) {
      dragState.dragOffsetCol = Math.max(0, grabCell.col - section.gridCol);
      dragState.dragOffsetRow = Math.max(0, grabCell.row - section.gridRow);
    } else {
      dragState.dragOffsetCol = 0;
      dragState.dragOffsetRow = 0;
    }

    // Add dragging class for visual feedback
    cardElement.classList.add('dragging');

    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sectionId);

    // Ghost will be created in handleDragOver
  });

  // Drag end — clean up ghost
  cardElement.addEventListener('dragend', (e) => {
    cardElement.classList.remove('dragging');

    // Remove grid ghost
    if (dragState.gridGhost) {
      dragState.gridGhost.remove();
      dragState.gridGhost = null;
    }
    // Also hide legacy indicator if present
    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }

    dragState.draggedElement = null;
    dragState.draggedSection = null;
    dragState.potentialDropCol = null;
    dragState.potentialDropRow = null;
    dragState.potentialDropColSpan = null;
    dragState.dragOffsetCol = 0;
    dragState.dragOffsetRow = 0;
  });
}

// --- Handle drag over: show a ghost at the card's FINAL resting position.
// The ghost position is computed by the same function used on drop, so what
// you see is exactly where the card will land (including slide-under snapping).
export function handleDragOver(e) {
  if (!dragState.draggedElement || !editState.enabled) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const now = Date.now();
  if (now - dragState.lastDragOverTime < 30) return;
  dragState.lastDragOverTime = now;

  const main = document.querySelector('.app-main');
  if (!main) return;

  const sections = currentSections();
  const section = sections.find(s => s.id === dragState.draggedSection);
  if (!section) return;

  // Anchor-adjusted target: subtract the grab offset so the card's top-left
  // lands where the card (not the cursor) visually is
  const mouse = mouseToGridCell(e.clientX, e.clientY);
  const rawCol = mouse.col - (dragState.dragOffsetCol || 0);
  const rawRow = mouse.row - (dragState.dragOffsetRow || 0);

  // Compute the exact final resting position (clamp + shrink + slide-under)
  const pos = computeDropPosition(sections, section.id, rawCol, rawRow);
  if (!pos) return;

  // Store for handleDrop — drop uses these exact values, no recomputation
  dragState.potentialDropCol = pos.col;
  dragState.potentialDropRow = pos.row;
  dragState.potentialDropColSpan = pos.colSpan;

  // Create or update ghost (a grid child using grid placement)
  if (!dragState.gridGhost) {
    dragState.gridGhost = document.createElement('div');
    dragState.gridGhost.className = 'grid-drag-ghost';
    main.appendChild(dragState.gridGhost);
  }

  const rowSpan = section.gridRowSpan || DEFAULT_ROW_SPAN;
  const ghost = dragState.gridGhost;
  ghost.style.display = 'block';
  ghost.style.gridColumn = `${pos.col} / span ${pos.colSpan}`;
  ghost.style.gridRow = `${pos.row} / span ${rowSpan}`;
}

// --- Handle drop: place the card exactly where the ghost showed it.
export function handleDrop(e) {
  e.preventDefault();

  if (!dragState.draggedSection || !editState.enabled) return;
  if (!dragState.potentialDropCol || !dragState.potentialDropRow) return;

  const sections = currentSections();
  const section = sections.find(s => s.id === dragState.draggedSection);
  if (!section) return;

  // Apply the exact position the ghost was showing
  section.gridCol = dragState.potentialDropCol;
  section.gridRow = dragState.potentialDropRow;
  if (dragState.potentialDropColSpan) {
    section.gridColSpan = dragState.potentialDropColSpan;
  }

  // Push down any cards at/below that the placed card now overlaps.
  // (Cards above were already avoided by slide-under in computeDropPosition.)
  resolveCollisions(sections, section.id);

  // Clean up ghost
  if (dragState.gridGhost) {
    dragState.gridGhost.remove();
    dragState.gridGhost = null;
  }

  // Reset drop state
  dragState.potentialDropCol = null;
  dragState.potentialDropRow = null;
  dragState.potentialDropColSpan = null;

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();
  showToast('Card moved');
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

  const isIconContainer = container.classList.contains('icon-grid') ||
                          container.classList.contains('icon-row') ||
                          container.classList.contains('unified-icons-group');

  // Check if container is a 2-column grid (subtasks, reminders, copy-paste)
  const isGridContainer = container.classList.contains('unified-subtasks-group') ||
                          container.classList.contains('unified-reminders-group') ||
                          container.classList.contains('unified-copypaste-group');

  // Determine gap size based on container type
  let gapSize = 12;
  if (container.classList.contains('icon-grid') || container.classList.contains('unified-icons-group')) {
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

    // Get all draggable items in this container (including separators for proper positioning)
    const items = Array.from(container.querySelectorAll('[data-key]')).filter(item =>
      !item.classList.contains('add-tile') &&
      !item.classList.contains('unified-add-tile') &&
      !item.classList.contains('item-dragging')
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
    } else if (isGridContainer) {
      // 2-column grid: use column-based detection to avoid picking items from wrong row
      // Determine which column the mouse is in based on container midpoint (more forgiving than item bounds)
      const containerRect = container.getBoundingClientRect();
      const containerMidX = containerRect.left + containerRect.width / 2;
      const mouseInLeftHalf = mouseX < containerMidX;

      // Filter items to those in the same column based on their center position
      const columnItems = items.filter(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2;
        const itemInLeftHalf = itemCenterX < containerMidX;
        return itemInLeftHalf === mouseInLeftHalf;
      });

      const searchItems = columnItems.length > 0 ? columnItems : items;

      // Find closest item vertically within the column
      searchItems.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(mouseY - itemCenterY);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          dropPosition = mouseY < itemCenterY ? 'before' : 'after';
        }
      });
    } else {
      // Vertical list (single column)
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
        // Vertical indicator for icon grids
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.left = `${rect.right + scrollLeft + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.top = `${rect.top + scrollTop}px`;
        dragState.itemDropIndicator.style.width = '3px';
        dragState.itemDropIndicator.style.height = `${rect.height}px`;
        dragState.itemDropIndicator.className = 'item-drop-indicator vertical';
      } else if (isGridContainer) {
        // Horizontal indicator for 2-column grids (subtasks, reminders, copy-paste)
        // Shows above/below the target item to indicate array insertion point
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.top = `${rect.top + scrollTop - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.top = `${rect.bottom + scrollTop + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
      } else {
        // Horizontal indicator for single-column lists
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
    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;
    // Only handle same-section drops; let cross-card drops bubble to card handler
    if (dragState.draggedItemSection !== sectionKey) return;

    e.preventDefault();
    e.stopPropagation();

    const data = currentData();

    // Handle composite keys for unified card items
    // Format: sectionId:subtitle:itemType (e.g., "myCard:General:icons")
    // Or legacy format: sectionId:subtitle (for old copy-paste)
    // Or simple format: sectionId (for legacy cards)
    let collection;
    const parts = sectionKey.split(':');
    if (parts.length === 3) {
      // Unified card format: sectionId:subtitle:itemType
      const [sectionId, subtitle, itemType] = parts;
      collection = data[sectionId]?.[subtitle]?.[itemType];
    } else if (parts.length === 2) {
      // Legacy copy-paste format: sectionId:subtitle
      const [sectionId, subtitle] = parts;
      const subtitleData = data[sectionId]?.[subtitle];
      // Check if it's unified format (has itemType arrays) or legacy (direct array)
      if (subtitleData && Array.isArray(subtitleData)) {
        collection = subtitleData;
      } else if (subtitleData && subtitleData.copyPaste) {
        collection = subtitleData.copyPaste;
      }
    } else {
      collection = data[sectionKey];
    }

    if (!Array.isArray(collection)) return;

    // Calculate target directly from drop position instead of relying on indicator
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    const items = Array.from(container.querySelectorAll('[data-key]')).filter(item =>
      !item.classList.contains('add-tile') &&
      !item.classList.contains('unified-add-tile') &&
      !item.classList.contains('item-dragging')
    );

    if (items.length === 0) return;

    // Find closest item and determine position
    let closestItem = null;
    let closestDistance = Infinity;
    let dropPosition = 'after';

    if (isGridContainer) {
      // 2-column grid: use column-based detection to avoid picking items from wrong row
      // Determine which column the mouse is in based on container midpoint (more forgiving than item bounds)
      const containerRect = container.getBoundingClientRect();
      const containerMidX = containerRect.left + containerRect.width / 2;
      const mouseInLeftHalf = mouseX < containerMidX;

      // Filter items to those in the same column based on their center position
      const columnItems = items.filter(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2;
        const itemInLeftHalf = itemCenterX < containerMidX;
        return itemInLeftHalf === mouseInLeftHalf;
      });

      const searchItems = columnItems.length > 0 ? columnItems : items;

      // Find closest item vertically within the column
      searchItems.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(mouseY - itemCenterY);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          dropPosition = mouseY < itemCenterY ? 'before' : 'after';
        }
      });
    } else {
      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2;
        const itemCenterY = rect.top + rect.height / 2;

        // For icon containers, use weighted distance
        // For others, use Y distance
        let distance;
        if (isIconContainer) {
          distance = Math.abs(mouseX - itemCenterX) + Math.abs(mouseY - itemCenterY) * 0.5;
        } else {
          distance = Math.abs(mouseY - itemCenterY);
        }

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          // Determine before/after based on container type
          if (isIconContainer) {
            dropPosition = mouseX < itemCenterX ? 'before' : 'after';
          } else {
            dropPosition = mouseY < itemCenterY ? 'before' : 'after';
          }
        }
      });
    }

    if (!closestItem) return;

    const targetKey = closestItem.dataset.key;
    let position = dropPosition;

    const draggedIndex = collection.findIndex(item => item.key === dragState.draggedItemKey);
    const targetIndex = collection.findIndex(item => item.key === targetKey);

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    let finalIndex;
    if (position === 'before') {
      finalIndex = targetIndex;
    } else {
      finalIndex = targetIndex + 1;
    }

    // Skip if effectively no change
    // For 2-column grids: finalIndex === draggedIndex + 1 IS a change when draggedIndex is even
    // (same-row column swap from left to right)
    const isSameRowColumnSwap = isGridContainer && (draggedIndex % 2 === 0) && (finalIndex === draggedIndex + 1);

    if (finalIndex === draggedIndex) return;
    if (finalIndex === draggedIndex + 1 && !isSameRowColumnSwap) return;

    const [draggedItem] = collection.splice(draggedIndex, 1);

    let newIndex;
    if (isSameRowColumnSwap) {
      // For same-row column swap, insert at finalIndex (don't subtract 1)
      // This places the item in the right column after the shifted item
      newIndex = finalIndex;
    } else if (draggedIndex < finalIndex) {
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
    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;

    const draggedSectionSubtitle = dragState.draggedItemSection;
    const currentSectionSubtitle = `${sectionId}:${subtitle}`;

    // Only handle same-section drops; let cross-card drops bubble to card handler
    if (draggedSectionSubtitle !== currentSectionSubtitle) return;

    e.preventDefault();
    e.stopPropagation();

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
    // Clear drop zone initialization flag so it can be re-initialized
    delete card.dataset.dropZoneInitialized;
  });

  // Remove items draggability (including unified card items)
  // Note: unified icons use .icon-button class, same as legacy icons
  const items = document.querySelectorAll('.icon-button, .list-item, .reminder-item, .unified-subtask-item, .unified-reminder-item, .unified-copypaste-item');
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

  // Remove drop-target class from all cards
  document.querySelectorAll('.card.drop-target').forEach(card => {
    card.classList.remove('drop-target');
  });
}

// --- Initialize card as a drop zone for cross-card item moves
export function initializeCardDropZone(cardElement, targetSectionId) {
  if (!cardElement || !editState.enabled) return;

  // Prevent duplicate initialization
  if (cardElement.dataset.dropZoneInitialized) return;
  cardElement.dataset.dropZoneInitialized = 'true';

  // Dragover - highlight card and detect target subtitle
  cardElement.addEventListener('dragover', (e) => {
    // Only handle item drags, not card drags
    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;

    // Parse source section and subtitle from dragged item
    const [sourceSectionId, sourceSubtitle] = dragState.draggedItemSection.split(':');

    // Detect which subtitle is being hovered
    const subtitleGroups = cardElement.querySelectorAll('.unified-content-group');
    let detectedSubtitle = '_default';
    let hoveredGroup = null;

    subtitleGroups.forEach(group => {
      const rect = group.getBoundingClientRect();
      // Check if mouse is within this group's bounds
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        detectedSubtitle = group.dataset.subtitle || '_default';
        hoveredGroup = group;
      }
    });

    // Check if this is a valid drop target:
    // - Cross-card drag (different sectionId), OR
    // - Same-card but different subtitle (cross-subtitle move)
    const isCrossCard = sourceSectionId !== targetSectionId;
    const isCrossSubtitle = sourceSubtitle !== detectedSubtitle;

    if (isCrossCard || isCrossSubtitle) {
      e.preventDefault();

      // Only show card-level highlight for cross-card drags
      if (isCrossCard) {
        cardElement.classList.add('drop-target');
      }

      // Store detected subtitle for drop handler
      dragState.targetSubtitle = detectedSubtitle;

      // Visual feedback: highlight the target subtitle area
      // Remove previous highlights
      cardElement.querySelectorAll('.subtitle-drop-target').forEach(el => {
        el.classList.remove('subtitle-drop-target');
      });

      if (hoveredGroup) {
        // Highlight the content group
        hoveredGroup.classList.add('subtitle-drop-target');

        // Also highlight the subtitle wrapper if it exists (for named subtitles)
        if (detectedSubtitle !== '_default') {
          const wrapper = hoveredGroup.previousElementSibling;
          if (wrapper && wrapper.classList.contains('unified-subtitle-wrapper')) {
            wrapper.classList.add('subtitle-drop-target');
          }
        }
      }
    } else {
      // Same card, same subtitle - clear highlights (let container handlers deal with it)
      cardElement.querySelectorAll('.subtitle-drop-target').forEach(el => {
        el.classList.remove('subtitle-drop-target');
      });
      dragState.targetSubtitle = null;
    }
  });

  // Dragleave - remove highlight
  cardElement.addEventListener('dragleave', (e) => {
    // Only remove if actually leaving the card (not entering a child)
    if (!cardElement.contains(e.relatedTarget)) {
      cardElement.classList.remove('drop-target');
      // Clear subtitle highlights
      cardElement.querySelectorAll('.subtitle-drop-target').forEach(el => {
        el.classList.remove('subtitle-drop-target');
      });
      dragState.targetSubtitle = null;
    }
  });

  // Drop - move item to this card
  cardElement.addEventListener('drop', (e) => {
    cardElement.classList.remove('drop-target');
    // Clear subtitle highlights
    cardElement.querySelectorAll('.subtitle-drop-target').forEach(el => {
      el.classList.remove('subtitle-drop-target');
    });

    // Only handle item drags
    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;

    const [sourceSectionId, sourceSubtitle, sourceType] = dragState.draggedItemSection.split(':');

    // Validate we have all required parts
    if (!sourceSubtitle || !sourceType) return;

    // Get target subtitle (detected during dragover)
    const targetSubtitle = dragState.targetSubtitle || '_default';

    // Handle cross-card drops OR same-card cross-subtitle drops
    const isCrossCard = sourceSectionId !== targetSectionId;
    const isCrossSubtitle = sourceSubtitle !== targetSubtitle;

    // Skip if same card AND same subtitle (handled by container drag handlers)
    if (!isCrossCard && !isCrossSubtitle) return;

    e.preventDefault();
    e.stopPropagation();

    const data = currentData();

    // Get source collection and find item
    const sourceCollection = data[sourceSectionId]?.[sourceSubtitle]?.[sourceType];
    if (!Array.isArray(sourceCollection)) return;

    const draggedIndex = sourceCollection.findIndex(item => item.key === dragState.draggedItemKey);
    if (draggedIndex === -1) return;

    const [draggedItem] = sourceCollection.splice(draggedIndex, 1);

    // Ensure target section and subtitle exist with item type array
    if (!data[targetSectionId]) data[targetSectionId] = {};
    if (!data[targetSectionId][targetSubtitle]) {
      data[targetSectionId][targetSubtitle] = {
        icons: [],
        reminders: [],
        subtasks: [],
        copyPaste: []
      };
    }
    if (!data[targetSectionId][targetSubtitle][sourceType]) {
      data[targetSectionId][targetSubtitle][sourceType] = [];
    }

    // Add to end of target collection
    data[targetSectionId][targetSubtitle][sourceType].push(draggedItem);

    // Clear drag state
    dragState.draggedItemKey = null;
    dragState.draggedItemSection = null;
    dragState.targetSubtitle = null;

    // Persist and re-render
    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    if (editState.enabled) {
      if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    // Show toast with destination subtitle
    const subtitleLabel = targetSubtitle === '_default' ? '' : ` to "${targetSubtitle}"`;
    showToast(`Item moved${subtitleLabel}`);
  });
}
