// Personal Dashboard - Card Resize Handles
// Attaches drag handles to card edges in edit mode.
// All grid math is delegated to grid-engine.js.

import { editState, currentSections } from '../state.js';
import { markDirtyAndSave } from './edit-mode.js';
import {
  MIN_COL_SPAN, MIN_ROW_SPAN, FIRST_DATA_ROW,
  getCellSize, getGridCols, getDeviceConfig, mouseToGridCell, resolveCollisions, getMinRowSpan
} from './grid-engine.js';

const HANDLE_CLASS = {
  width:  'card-resize-handle-right',
  height: 'card-resize-handle-bottom',
  left:   'card-resize-handle-left',
  top:    'card-resize-handle-top',
};

let activeResize = null;

// ============================================================
// HANDLE CREATION
// ============================================================

export function initializeResizeHandles(cardEl, sectionId) {
  if (!editState.enabled) return;
  if (cardEl.classList.contains('app-header') || cardEl.classList.contains('time-tracking-card') ||
      cardEl.classList.contains('quick-access-card') || cardEl.classList.contains('eisenhower-card')) return;

  cardEl.querySelectorAll('.card-resize-handle-right, .card-resize-handle-bottom, .card-resize-handle-left, .card-resize-handle-top')
    .forEach(h => h.remove());

  // type → CSS class. All four edges resize; opposite edge stays anchored.
  const handles = [
    ['width',  'card-resize-handle-right'],
    ['height', 'card-resize-handle-bottom'],
    ['left',   'card-resize-handle-left'],
    ['top',    'card-resize-handle-top'],
  ];
  handles.forEach(([type, cls]) => {
    const h = document.createElement('div');
    h.className = cls;
    h.addEventListener('mousedown', (e) => startResize(e, type, sectionId, cardEl));
    cardEl.appendChild(h);
  });
}

export function removeResizeHandles() {
  document.querySelectorAll('.card-resize-handle-right, .card-resize-handle-bottom, .card-resize-handle-left, .card-resize-handle-top')
    .forEach(h => h.remove());
}

// ============================================================
// RESIZE LOGIC
// ============================================================

function startResize(e, type, sectionId, cardEl) {
  e.preventDefault();
  e.stopPropagation();

  // Mobile single-column mode: width is locked (handles are CSS-hidden too)
  if ((type === 'width' || type === 'left') && getDeviceConfig().singleColumn) return;

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
    currentCol: null,
    currentRow: null,
    currentColSpan: null,
    currentRowSpan: null,
  };

  const handle = cardEl.querySelector('.' + HANDLE_CLASS[type]);
  if (handle) handle.classList.add('active');

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e) {
  if (!activeResize) return;
  const { type, cardEl, indicator, cellSize, startCol, startRow, startColSpan, startRowSpan } = activeResize;
  if (cellSize <= 0) return;

  // Single source of truth for coordinates: engine handles zoom, padding, header offset
  const cell = mouseToGridCell(e.clientX, e.clientY);
  let label = '';

  if (type === 'width') {
    // Right edge follows the mouse; left edge anchored
    let newColSpan = Math.max(MIN_COL_SPAN, cell.col - startCol + 1);
    newColSpan = Math.min(newColSpan, getGridCols() - startCol + 1);

    cardEl.style.gridColumn = `${startCol} / span ${newColSpan}`;
    activeResize.currentColSpan = newColSpan;
    label = `${newColSpan} cols`;

  } else if (type === 'left') {
    // Left edge follows the mouse; RIGHT edge anchored
    const rightEdge = startCol + startColSpan; // exclusive
    let newCol = Math.max(1, Math.min(cell.col, rightEdge - MIN_COL_SPAN));
    const newColSpan = rightEdge - newCol;

    cardEl.style.gridColumn = `${newCol} / span ${newColSpan}`;
    activeResize.currentCol = newCol;
    activeResize.currentColSpan = newColSpan;
    label = `${newColSpan} cols`;

  } else if (type === 'height') {
    // Bottom edge follows the mouse; top edge anchored
    let newRowSpan = Math.max(MIN_ROW_SPAN, cell.row - startRow + 1);

    // Content must always fit — never shrink below content height
    const minRows = getMinRowSpan(cardEl, cellSize);
    if (newRowSpan < minRows) newRowSpan = minRows;

    cardEl.style.gridRow = `${startRow} / span ${newRowSpan}`;
    activeResize.currentRowSpan = newRowSpan;
    label = `${newRowSpan} rows`;

  } else if (type === 'top') {
    // Top edge follows the mouse; BOTTOM edge anchored
    const bottomEdge = startRow + startRowSpan; // exclusive
    const minRows = Math.max(MIN_ROW_SPAN, getMinRowSpan(cardEl, cellSize));
    let newRow = Math.max(FIRST_DATA_ROW, Math.min(cell.row, bottomEdge - minRows));
    const newRowSpan = bottomEdge - newRow;

    cardEl.style.gridRow = `${newRow} / span ${newRowSpan}`;
    activeResize.currentRow = newRow;
    activeResize.currentRowSpan = newRowSpan;
    label = `${newRowSpan} rows`;
  }

  indicator.textContent = label;
  indicator.style.display = 'block';
  indicator.style.left = `${e.clientX + 14}px`;
  indicator.style.top = `${e.clientY - 22}px`;
}

function onResizeEnd() {
  if (!activeResize) return;
  const { type, sectionId, cardEl, indicator } = activeResize;

  cardEl.querySelectorAll('.card-resize-handle-right.active, .card-resize-handle-bottom.active, .card-resize-handle-left.active, .card-resize-handle-top.active')
    .forEach(h => h.classList.remove('active'));

  const section = currentSections().find(s => s.id === sectionId);
  if (section) {
    if (type === 'width' && activeResize.currentColSpan) {
      section.gridColSpan = activeResize.currentColSpan;
    }
    if (type === 'left' && activeResize.currentColSpan) {
      section.gridCol = activeResize.currentCol;
      section.gridColSpan = activeResize.currentColSpan;
    }
    if (type === 'height' && activeResize.currentRowSpan) {
      section.gridRowSpan = activeResize.currentRowSpan;
    }
    if (type === 'top' && activeResize.currentRowSpan) {
      section.gridRow = activeResize.currentRow;
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
