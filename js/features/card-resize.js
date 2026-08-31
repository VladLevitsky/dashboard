// Personal Dashboard - Card Resize Handles
// Attaches drag handles to card edges in edit mode.
// All grid math is delegated to grid-engine.js.

import { editState, currentSections } from '../state.js';
import { markDirtyAndSave } from './edit-mode.js';
import {
  MIN_COL_SPAN, MIN_ROW_SPAN,
  getCellSize, getGridCols, getDeviceConfig, mouseToGridCell, resolveCollisions, getMinRowSpan
} from './grid-engine.js';

let activeResize = null;

// ============================================================
// HANDLE CREATION
// ============================================================

export function initializeResizeHandles(cardEl, sectionId) {
  if (!editState.enabled) return;
  if (cardEl.classList.contains('app-header') || cardEl.classList.contains('time-tracking-card') ||
      cardEl.classList.contains('quick-access-card') || cardEl.classList.contains('eisenhower-card')) return;

  cardEl.querySelectorAll('.card-resize-handle-right, .card-resize-handle-bottom').forEach(h => h.remove());

  const rightHandle = document.createElement('div');
  rightHandle.className = 'card-resize-handle-right';
  rightHandle.addEventListener('mousedown', (e) => startResize(e, 'width', sectionId, cardEl));
  cardEl.appendChild(rightHandle);

  const bottomHandle = document.createElement('div');
  bottomHandle.className = 'card-resize-handle-bottom';
  bottomHandle.addEventListener('mousedown', (e) => startResize(e, 'height', sectionId, cardEl));
  cardEl.appendChild(bottomHandle);
}

export function removeResizeHandles() {
  document.querySelectorAll('.card-resize-handle-right, .card-resize-handle-bottom').forEach(h => h.remove());
}

// ============================================================
// RESIZE LOGIC
// ============================================================

function startResize(e, type, sectionId, cardEl) {
  e.preventDefault();
  e.stopPropagation();

  // Mobile single-column mode: width is locked (handle is CSS-hidden too)
  if (type === 'width' && getDeviceConfig().singleColumn) return;

  const section = currentSections().find(s => s.id === sectionId);
  if (!section) return;

  const { cellSize, zoom, mainRect } = getCellSize();

  const indicator = document.createElement('div');
  indicator.className = 'resize-span-indicator';
  indicator.style.display = 'none';
  document.body.appendChild(indicator);

  activeResize = {
    type, sectionId, cardEl, indicator,
    cellSize, zoom, mainRect,
    startCol: section.gridCol || 1,
    startRow: section.gridRow || 2,
    startColSpan: section.gridColSpan || 24,
    startRowSpan: section.gridRowSpan || 8,
    currentColSpan: null,
    currentRowSpan: null,
  };

  const handle = type === 'width'
    ? cardEl.querySelector('.card-resize-handle-right')
    : cardEl.querySelector('.card-resize-handle-bottom');
  if (handle) handle.classList.add('active');

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e) {
  if (!activeResize) return;
  const { type, cardEl, indicator, cellSize, startCol, startRow } = activeResize;
  if (cellSize <= 0) return;

  // Single source of truth for coordinates: engine handles zoom, padding, header offset
  const cell = mouseToGridCell(e.clientX, e.clientY);

  if (type === 'width') {
    // The mouse is over the cell that should become the card's LAST column
    let newColSpan = Math.max(MIN_COL_SPAN, cell.col - startCol + 1);
    newColSpan = Math.min(newColSpan, getGridCols() - startCol + 1);

    cardEl.style.gridColumn = `${startCol} / span ${newColSpan}`;
    activeResize.currentColSpan = newColSpan;

    indicator.textContent = `${newColSpan} cols`;
    indicator.style.display = 'block';
    indicator.style.left = `${e.clientX + 14}px`;
    indicator.style.top = `${e.clientY - 22}px`;

  } else {
    // The mouse is over the cell that should become the card's LAST row
    let newRowSpan = Math.max(MIN_ROW_SPAN, cell.row - startRow + 1);

    // Content must always fit — never shrink below content height
    const minRows = getMinRowSpan(cardEl, cellSize);
    if (newRowSpan < minRows) newRowSpan = minRows;

    cardEl.style.gridRow = `${startRow} / span ${newRowSpan}`;
    activeResize.currentRowSpan = newRowSpan;

    indicator.textContent = `${newRowSpan} rows`;
    indicator.style.display = 'block';
    indicator.style.left = `${e.clientX + 14}px`;
    indicator.style.top = `${e.clientY - 22}px`;
  }
}

function onResizeEnd() {
  if (!activeResize) return;
  const { type, sectionId, cardEl, indicator } = activeResize;

  cardEl.querySelectorAll('.card-resize-handle-right.active, .card-resize-handle-bottom.active')
    .forEach(h => h.classList.remove('active'));

  const section = currentSections().find(s => s.id === sectionId);
  if (section) {
    if (type === 'width' && activeResize.currentColSpan) {
      section.gridColSpan = activeResize.currentColSpan;
    }
    if (type === 'height' && activeResize.currentRowSpan) {
      section.gridRowSpan = activeResize.currentRowSpan;
    }
    resolveCollisions(currentSections(), sectionId);
    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
  }

  if (indicator && indicator.parentNode) indicator.remove();
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  activeResize = null;
}

// Legacy no-op kept only because main.js still exposes it on window
export function snapshotGridPositions() {}
