// Personal Dashboard - Grid Engine
// Centralized grid math for the 24-column graph-paper layout.
//
// DESIGN PRINCIPLES:
// 1. ONE layout engine for both view and edit mode. Both use fixed square-cell
//    rows (grid-auto-rows: <cellSize>px). Edit mode is simply a zoomed-out
//    (0.7) preview of the exact same layout — WYSIWYG by construction.
// 2. The header occupies grid row 1 with auto height (grid-template-rows: auto).
//    Data cards live in rows 2+ which are uniform square cells. All row math
//    offsets by the real rendered header height.
// 3. Every card has explicit placement: gridCol / gridColSpan / gridRow /
//    gridRowSpan. No CSS auto-flow. Cards are positioned relative to the
//    grid only — never relative to each other.
// 4. Cards can never be smaller than their content: reconcileRowSpans() grows
//    a card's row span when its content outgrows it.
// 5. Per-device layout profiles (mobile/tablet/desktop) live in
//    section.layouts; the flat props are the active mode's working copy.

import { model, editState, currentSections } from '../state.js';

// ============================================================
// CONSTANTS
// ============================================================

export const GRID_COLS = 24; // legacy constant = tablet cols (kept for imports)
export const GRID_GAP = 16;
export const DEFAULT_COL_SPAN = 24;
export const DEFAULT_ROW_SPAN = 8;
export const MIN_COL_SPAN = 4;   // ~144px minimum card width
export const MIN_ROW_SPAN = 2;
export const FIRST_DATA_ROW = 2; // row 1 = header (auto height)

// ============================================================
// DEVICE LAYOUT MODES
// Three independent layout profiles. Each section stores per-mode
// placement in section.layouts = { tablet: {col,row,colSpan,rowSpan}, ... }.
// The flat gridCol/gridRow/gridColSpan/gridRowSpan props on each section are
// the ACTIVE WORKING LAYOUT — all engine/drag/resize code operates on them
// unchanged. hydrateLayout()/persistActiveLayout() swap profiles in and out.
// ============================================================

export const DEVICE_MODES = {
  mobile:  { cols: 4,  maxWidth: 520,  singleColumn: true  },
  tablet:  { cols: 24, maxWidth: 1260, singleColumn: false },
  desktop: { cols: 24, maxWidth: 2280, singleColumn: false }, // 140px side gaps on a 2560px screen
};

const DEVICE_MODE_STORAGE_KEY = 'dashboard_device_mode';

let _activeMode = null;

function autoDetectMode() {
  const w = window.screen?.width || window.innerWidth || 1280;
  if (w < 768) return 'mobile';
  if (w < 1600) return 'tablet';
  return 'desktop';
}

/** Currently active device mode ('mobile' | 'tablet' | 'desktop'). */
export function getActiveMode() {
  if (_activeMode && DEVICE_MODES[_activeMode]) return _activeMode;
  const stored = localStorage.getItem(DEVICE_MODE_STORAGE_KEY);
  _activeMode = DEVICE_MODES[stored] ? stored : autoDetectMode();
  return _activeMode;
}

/** Column count of the active mode. Engine-internal geometry uses this. */
export function getGridCols() {
  return DEVICE_MODES[getActiveMode()].cols;
}

export function getDeviceConfig() {
  return DEVICE_MODES[getActiveMode()];
}

// ============================================================
// CELL GEOMETRY (all JS-computed pixel values, never CSS %)
// ============================================================

/**
 * Compute the pixel size of one square grid cell from the container width.
 * All values are in LOGICAL (un-zoomed) pixels.
 */
export function getCellSize() {
  const main = document.querySelector('.app-main');
  if (!main) return { cellSize: 36, gap: GRID_GAP, zoom: 1, mainRect: null, main: null };

  const zoom = parseFloat(getComputedStyle(main).zoom) || 1;
  const mainRect = main.getBoundingClientRect();
  const cs = getComputedStyle(main);
  const padL = parseInt(cs.paddingLeft) || 0;
  const padR = parseInt(cs.paddingRight) || 0;

  const cols = getGridCols();
  const logicalWidth = mainRect.width / zoom;
  const usableWidth = logicalWidth - padL - padR;
  const cellSize = (usableWidth - (cols - 1) * GRID_GAP) / cols;

  return { cellSize, gap: GRID_GAP, zoom, mainRect, main };
}

/**
 * Y offset (logical px, from the container's border-box top) where data row 2 begins.
 * = header bottom + one gap. Falls back to padding-top if no header.
 */
export function getGridOriginY(main) {
  const m = main || document.querySelector('.app-main');
  if (!m) return 0;
  const header = m.querySelector('.app-header');
  if (header) {
    // offsetTop/offsetHeight are logical layout px (unaffected by CSS zoom).
    return header.offsetTop + header.offsetHeight + GRID_GAP;
  }
  return parseInt(getComputedStyle(m).paddingTop) || 0;
}

/**
 * Apply computed cell sizes to the grid container as explicit pixel values.
 * Row 1 (header) is auto-height; all other rows are square cells — in BOTH modes.
 */
export function applyCellSize() {
  const main0 = document.querySelector('.app-main');
  if (!main0) return;

  // Device mode drives container width and column count.
  // Set max-width FIRST so getCellSize() measures the correct width.
  const mode = getActiveMode();
  const cfg = DEVICE_MODES[mode];
  main0.style.maxWidth = `${cfg.maxWidth}px`;
  document.body.dataset.device = mode;

  const { cellSize, main } = getCellSize();
  if (!main || cellSize <= 0) return;

  const colSize = Math.floor(cellSize * 100) / 100; // avoid sub-pixel drift

  main.style.gridTemplateColumns = `repeat(${getGridCols()}, ${colSize}px)`;
  main.style.gridTemplateRows = 'auto'; // row 1 = header, sized by content
  main.style.gridAutoRows = `${colSize}px`; // rows 2+ = square cells (both modes)

  // Variables for the grid overlay
  const cs = getComputedStyle(main);
  const padL = parseInt(cs.paddingLeft) || 0;
  main.style.setProperty('--cell-size', `${colSize}px`);
  main.style.setProperty('--grid-gap', `${GRID_GAP}px`);
  main.style.setProperty('--grid-pad-left', `${padL}px`);
  main.style.setProperty('--grid-origin-y', `${getGridOriginY(main)}px`);
}

// ============================================================
// COORDINATE CONVERSION
// ============================================================

/**
 * Convert viewport mouse coordinates to a grid cell (1-based col, 2+ row).
 * Accounts for zoom, container position, padding, and header offset.
 */
export function mouseToGridCell(clientX, clientY) {
  const { cellSize, zoom, mainRect, main } = getCellSize();
  if (!main || !mainRect || cellSize <= 0) return { col: 1, row: FIRST_DATA_ROW };

  const padL = parseInt(getComputedStyle(main).paddingLeft) || 0;
  const originY = getGridOriginY(main);

  // Logical coords relative to the container's border-box origin
  const relX = (clientX - mainRect.left) / zoom - padL;
  const relY = (clientY - mainRect.top) / zoom;

  const col = Math.floor(relX / (cellSize + GRID_GAP)) + 1;
  const row = FIRST_DATA_ROW + Math.floor((relY - originY) / (cellSize + GRID_GAP));

  return {
    col: Math.max(1, Math.min(col, getGridCols())),
    row: Math.max(FIRST_DATA_ROW, row)
  };
}

// ============================================================
// CARD PLACEMENT (identical in both modes)
// ============================================================

/**
 * Apply explicit grid placement to a card element.
 * Optional `display` override ({row, rowSpan}) is used in view mode when
 * collapsed cards free up space — the STORED layout is never modified.
 */
export function applyGridPlacement(el, section, display) {
  const colSpan = section.gridColSpan || getGridCols();
  const rowSpan = (display && display.rowSpan) || section.gridRowSpan || DEFAULT_ROW_SPAN;
  const row = (display && display.row) || section.gridRow;

  if (section.gridCol && row) {
    el.style.gridColumn = `${section.gridCol} / span ${colSpan}`;
    el.style.gridRow = `${row} / span ${rowSpan}`;
  } else {
    // Not yet positioned (autoAssign will fix on next pass)
    el.style.gridColumn = `span ${colSpan}`;
  }
}

// ============================================================
// COLLAPSED-CARD DISPLAY LAYOUT (view mode only)
// Collapsed cards shrink to title-bar height and cards below them move UP
// by exactly the freed rows — per column, so intentional white space
// elsewhere in the design is preserved. Pure derivation: stored layout
// (section.gridRow/gridRowSpan) is never touched, expanding restores all.
// ============================================================

/** Rows needed to show just a card's title bar (~72px) in the current mode. */
export function getCollapsedRowSpan() {
  const { cellSize } = getCellSize();
  const TITLE_BAR_PX = 72;
  if (cellSize <= 0) return 2;
  return Math.max(1, Math.ceil((TITLE_BAR_PX + GRID_GAP) / (cellSize + GRID_GAP)));
}

/**
 * Compute display positions given the collapsed-card map.
 * @returns Map<sectionId, {row, rowSpan}>
 */
export function computeDisplayLayout(sections, collapsedMap) {
  const map = new Map();
  const collapsed = collapsedMap || {};
  const cols = getGridCols();
  const cards = sections.filter(s => s.gridCol && s.gridRow && s.type !== 'header');
  if (cards.length === 0) return map;

  const collapsedSpan = getCollapsedRowSpan();

  // Freed-space contributions from each collapsed card
  const shrunk = cards
    .filter(c => collapsed[c.id])
    .map(c => {
      const storedSpan = c.gridRowSpan || DEFAULT_ROW_SPAN;
      return {
        top: c.gridRow,
        left: c.gridCol,
        right: c.gridCol + (c.gridColSpan || cols),
        freed: Math.max(0, storedSpan - Math.min(collapsedSpan, storedSpan)),
      };
    })
    .filter(k => k.freed > 0);

  const sorted = [...cards].sort((a, b) =>
    (a.gridRow - b.gridRow) || (a.gridCol - b.gridCol)
  );
  const placed = []; // finalized display rects

  for (const c of sorted) {
    const span = c.gridColSpan || cols;
    const storedSpan = c.gridRowSpan || DEFAULT_ROW_SPAN;
    const dispSpan = collapsed[c.id] ? Math.min(collapsedSpan, storedSpan) : storedSpan;

    // Rise allowance = the MAXIMUM freed space across the columns this card
    // spans. Columns that didn't actually clear are handled by the
    // blocker-settle pass below (the card lands on whatever still blocks it),
    // so using max lets content rise fully into space vacated by collapse
    // while never eating white space that collapse didn't create (freed = 0
    // when nothing above is collapsed → no movement at all).
    let maxFreed = 0;
    for (let col = c.gridCol; col < c.gridCol + span; col++) {
      let f = 0;
      for (const k of shrunk) {
        if (k.top < c.gridRow && col >= k.left && col < k.right) f += k.freed;
      }
      if (f > maxFreed) maxFreed = f;
    }

    let row = Math.max(FIRST_DATA_ROW, c.gridRow - maxFreed);

    // Settle below any already-placed card it would now overlap
    let changed = true;
    let guard = 0;
    while (changed && guard++ < placed.length + 2) {
      changed = false;
      for (const p of placed) {
        const colsOverlap = c.gridCol < p.right && (c.gridCol + span) > p.left;
        const rowsOverlap = row < p.bottom && (row + dispSpan) > p.top;
        if (colsOverlap && rowsOverlap) { row = p.bottom; changed = true; }
      }
    }
    // Never sink below the designed position
    if (row > c.gridRow) row = c.gridRow;

    placed.push({ top: row, bottom: row + dispSpan, left: c.gridCol, right: c.gridCol + span });
    map.set(c.id, { row, rowSpan: dispSpan });
  }

  return map;
}

// ============================================================
// DROP POSITION (shared by drag ghost and drop handler)
// ============================================================

/**
 * Compute the final resting position for a card dropped at (rawCol, rawRow).
 * 1. Clamps to grid bounds.
 * 2. Auto-shrinks colSpan if the card is too wide for the space right of rawCol.
 * 3. Slide-under: if the target overlaps a card that starts ABOVE the target row,
 *    the target slides down below that card (the upper card is never displaced).
 * Cards starting at or below the target row are NOT considered here — they get
 * pushed down by resolveCollisions() after the drop.
 *
 * Pure function: does not mutate anything.
 */
export function computeDropPosition(sections, movedId, rawCol, rawRow) {
  const moved = sections.find(s => s.id === movedId);
  if (!moved) return null;

  const cols = getGridCols();
  const cfg = getDeviceConfig();
  let colSpan = moved.gridColSpan || cols;
  const rowSpan = moved.gridRowSpan || DEFAULT_ROW_SPAN;

  let col, row;

  if (cfg.singleColumn) {
    // Mobile: full-width stack — dragging only reorders vertically
    col = 1;
    colSpan = cols;
    row = Math.max(FIRST_DATA_ROW, rawRow);
  } else {
    // Smooth right-boundary clamp: the left edge can never go past the last
    // column where a MIN_COL_SPAN card still fits. This makes the ghost stop
    // at the boundary rather than teleporting sideways.
    col = Math.max(1, Math.min(rawCol, cols - MIN_COL_SPAN + 1));
    row = Math.max(FIRST_DATA_ROW, rawRow);

    // Auto-shrink to fit the space right of col (never below MIN_COL_SPAN,
    // which is guaranteed to fit by the clamp above)
    const maxSpan = cols - col + 1;
    if (colSpan > maxSpan) colSpan = maxSpan;
  }

  const others = sections.filter(s =>
    s.id !== movedId && s.gridCol && s.gridRow && s.type !== 'header'
  );

  // Slide-under: repeat until stable (sliding down may reveal new upper overlaps)
  for (let pass = 0; pass < 25; pass++) {
    let slid = false;
    for (const other of others) {
      const oTop = other.gridRow;
      const oBottom = other.gridRow + (other.gridRowSpan || DEFAULT_ROW_SPAN);
      const oLeft = other.gridCol;
      const oRight = other.gridCol + (other.gridColSpan || cols);

      const colsOverlap = col < oRight && (col + colSpan) > oLeft;
      const rowsOverlap = row < oBottom && (row + rowSpan) > oTop;

      // Only slide under cards that START strictly above the target row
      if (colsOverlap && rowsOverlap && oTop < row) {
        row = oBottom;
        slid = true;
      }
    }
    if (!slid) break;
  }

  return { col, row, colSpan };
}

// ============================================================
// COLLISION RESOLUTION
// ============================================================

export function rectsOverlap(a, b) {
  const fallbackSpan = getGridCols();
  const aRight = (a.gridCol || 1) + (a.gridColSpan || fallbackSpan);
  const bRight = (b.gridCol || 1) + (b.gridColSpan || fallbackSpan);
  const aBottom = (a.gridRow || 1) + (a.gridRowSpan || DEFAULT_ROW_SPAN);
  const bBottom = (b.gridRow || 1) + (b.gridRowSpan || DEFAULT_ROW_SPAN);
  return (a.gridCol || 1) < bRight && aRight > (b.gridCol || 1) &&
         (a.gridRow || 1) < bBottom && aBottom > (b.gridRow || 1);
}

/**
 * After a card is placed (drop or resize), push any card it overlaps downward,
 * then cascade until stable. The moved card itself never moves here —
 * computeDropPosition() already guaranteed it doesn't overlap anything above it.
 */
export function resolveCollisions(sections, movedId) {
  const moved = sections.find(s => s.id === movedId);
  if (!moved || !moved.gridCol || !moved.gridRow) return;

  const cards = sections.filter(s => s.gridCol && s.gridRow && s.type !== 'header');

  // Direct pass: anything the moved card overlaps goes below it
  for (const other of cards) {
    if (other.id === movedId) continue;
    if (rectsOverlap(moved, other)) {
      other.gridRow = moved.gridRow + (moved.gridRowSpan || DEFAULT_ROW_SPAN);
    }
  }

  // Cascade: stabilize all remaining overlaps top-down (never move the moved card)
  stabilize(cards, movedId);
}

/**
 * Global stabilization: resolve all overlaps by pushing lower cards down.
 * Optionally pins one card (pinnedId) that must never move.
 */
function stabilize(cards, pinnedId) {
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    // Sort top-to-bottom so pushes propagate downward deterministically
    const sorted = [...cards].sort((a, b) =>
      (a.gridRow - b.gridRow) || (a.gridCol - b.gridCol)
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const upper = sorted[i];
        const lower = sorted[j];
        if (!rectsOverlap(upper, lower)) continue;

        // Push whichever card is not pinned; prefer pushing the lower one
        let push = lower, anchor = upper;
        if (lower.id === pinnedId) { push = upper; anchor = lower; }

        const newRow = anchor.gridRow + (anchor.gridRowSpan || DEFAULT_ROW_SPAN);
        if (push.gridRow < newRow) {
          push.gridRow = newRow;
          changed = true;
        }
      }
    }
    if (!changed) return;
  }
}

/**
 * Public wrapper: stabilize all cards with no pinned card.
 */
export function resolveAllCollisions(sections) {
  const cards = sections.filter(s => s.gridCol && s.gridRow && s.type !== 'header');
  stabilize(cards, null);
}

// ============================================================
// CONTENT MEASUREMENT & MINIMUM SIZE
// ============================================================

/**
 * Measure a card's real content height (logical px): the bottom edge of its
 * lowest statically-positioned child + bottom padding. Ignores absolutely
 * positioned children (resize handles, floating buttons) which would otherwise
 * report the card's full grid-area height.
 */
export function measureContentHeight(cardEl) {
  if (!cardEl) return 0;
  const cs = getComputedStyle(cardEl);
  const padBottom = parseInt(cs.paddingBottom) || 0;

  let maxBottom = 0;
  for (const child of cardEl.children) {
    const childCs = getComputedStyle(child);
    if (childCs.position === 'absolute' || childCs.position === 'fixed') continue;
    if (childCs.display === 'none') continue;
    const bottom = child.offsetTop + child.offsetHeight;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom + padBottom;
}

export function getMinColSpan() {
  return MIN_COL_SPAN;
}

/**
 * Minimum row span so the card's content fits.
 * area(rows) = rows*cell + (rows-1)*gap >= h  →  rows >= (h+gap)/(cell+gap)
 */
export function getMinRowSpan(cardEl, cellSize) {
  if (!cardEl || cellSize <= 0) return MIN_ROW_SPAN;
  const h = measureContentHeight(cardEl);
  const rows = Math.ceil((h + GRID_GAP) / (cellSize + GRID_GAP));
  return Math.max(MIN_ROW_SPAN, rows);
}

/**
 * After rendering, grow any card whose content is taller than its grid area,
 * then push affected neighbors down and re-apply placement styles in place.
 * Returns true if anything changed (caller should persist).
 */
export function reconcileRowSpans(sections) {
  const { cellSize } = getCellSize();
  if (cellSize <= 0) return false;

  const collapsedMap = (editState.working || model).collapsedCards || {};

  let changed = false;
  sections.forEach(section => {
    if (!section.gridCol || !section.gridRow || section.type === 'header') return;
    if (collapsedMap[section.id]) return; // collapsed: hidden content must not resize stored span
    delete section._viewRow; // strip legacy transient property

    const el = document.getElementById(section.id);
    if (!el) return;

    const minRows = getMinRowSpan(el, cellSize);
    if ((section.gridRowSpan || DEFAULT_ROW_SPAN) < minRows) {
      section.gridRowSpan = minRows;
      changed = true;
    }
  });

  if (changed) {
    resolveAllCollisions(sections);
    // Re-apply placement in place (no full re-render needed)
    sections.forEach(section => {
      const el = document.getElementById(section.id);
      if (el && section.gridCol && section.gridRow) {
        applyGridPlacement(el, section);
      }
    });
  }

  return changed;
}

// ============================================================
// AUTO-ASSIGN POSITIONS (migration / new cards)
// ============================================================

/**
 * Assign grid positions to sections that don't have them yet.
 * 2D bin-packing: scan rows top-down, columns left-right, first fit wins.
 */
export function autoAssignGridPositions(sections) {
  const needsAssign = sections.some(s => !s.gridRow && s.type !== 'header');
  if (!needsAssign) return;

  const occupied = {};
  const markOccupied = (col, row, colSpan, rowSpan) => {
    for (let r = row; r < row + rowSpan; r++) {
      if (!occupied[r]) occupied[r] = {};
      for (let c = col; c < col + colSpan; c++) occupied[r][c] = true;
    }
  };
  const isOpen = (col, row, colSpan, rowSpan) => {
    for (let r = row; r < row + rowSpan; r++) {
      if (!occupied[r]) continue;
      for (let c = col; c < col + colSpan; c++) {
        if (occupied[r][c]) return false;
      }
    }
    return true;
  };

  const cols = getGridCols();
  const cfg = getDeviceConfig();

  sections.forEach(section => {
    if (section.type === 'header') return;
    if (section.gridCol && section.gridRow) {
      markOccupied(
        section.gridCol, section.gridRow,
        section.gridColSpan || cols,
        section.gridRowSpan || DEFAULT_ROW_SPAN
      );
    }
  });

  sections.forEach(section => {
    if (section.type === 'header') return;
    if (section.gridCol && section.gridRow) return;

    const colSpan = cfg.singleColumn ? cols : Math.min(section.gridColSpan || cols, cols);
    const rowSpan = section.gridRowSpan || DEFAULT_ROW_SPAN;

    let placed = false;
    for (let row = FIRST_DATA_ROW; row < 500 && !placed; row++) {
      for (let col = 1; col <= cols - colSpan + 1 && !placed; col++) {
        if (isOpen(col, row, colSpan, rowSpan)) {
          section.gridCol = col;
          section.gridRow = row;
          section.gridColSpan = colSpan;
          section.gridRowSpan = rowSpan;
          markOccupied(col, row, colSpan, rowSpan);
          placed = true;
        }
      }
    }
  });
}

// ============================================================
// MIGRATION (12-col → 24-col) — kept for import path
// ============================================================

export function migrateToGrid24(data) {
  if (data.schemaVersion >= 7) return data;

  const migrateArray = (sections) => {
    if (!Array.isArray(sections)) return;
    sections.forEach(section => {
      if (section.gridCol) section.gridCol = (section.gridCol - 1) * 2 + 1;
      const oldSpan = section.gridColSpan || section.gridSpan || 12;
      section.gridColSpan = oldSpan * 2;
      if (section.gridRowSpan) section.gridRowSpan = section.gridRowSpan * 2;
      delete section.gridSpan;
      delete section.minHeight;
      delete section._viewRow;
    });
  };

  migrateArray(data.sections);
  // Defensive: handle partially-migrated backups that still carry sectionsStacked
  migrateArray(data.sectionsStacked);

  data.schemaVersion = 7;
  return data;
}

// ============================================================
// LAYOUT PROFILES (per-device: mobile / tablet / desktop)
// ============================================================

/**
 * Copy the flat working layout into layouts[activeMode].
 * Idempotent and cheap — called from markDirtyAndSave after every layout
 * mutation, and before every mode switch, so profiles are always fresh.
 */
export function persistActiveLayout(sections) {
  if (!Array.isArray(sections)) return;
  const mode = getActiveMode();
  sections.forEach(s => {
    if (s.type === 'header') return;
    if (!s.gridCol || !s.gridRow) return;
    if (!s.layouts) s.layouts = {};
    s.layouts[mode] = {
      col: s.gridCol,
      row: s.gridRow,
      colSpan: s.gridColSpan || getGridCols(),
      rowSpan: s.gridRowSpan || DEFAULT_ROW_SPAN,
    };
  });
}

/**
 * Seed a missing profile: cards stack full-width in the order of their
 * tablet arrangement (row, then col), at MIN_ROW_SPAN height — the existing
 * reconcileRowSpans() grows each card to its exact content height on the
 * first render in that mode. Desktop keeps each card's tablet colSpan.
 */
function seedProfile(sections, mode) {
  const cfg = DEVICE_MODES[mode];
  const cards = sections.filter(s => s.type !== 'header');

  // Order by the tablet profile (fall back to current flat props)
  const orderKey = (s) => {
    const t = s.layouts?.tablet;
    return [(t?.row ?? s.gridRow ?? 999), (t?.col ?? s.gridCol ?? 1)];
  };
  const ordered = [...cards].sort((a, b) => {
    const [ar, ac] = orderKey(a);
    const [br, bc] = orderKey(b);
    return ar - br || ac - bc;
  });

  let nextRow = FIRST_DATA_ROW;
  ordered.forEach(s => {
    if (!s.layouts) s.layouts = {};
    if (s.layouts[mode]) {
      // Already has this profile — just advance the packing cursor past it
      nextRow = Math.max(nextRow, s.layouts[mode].row + s.layouts[mode].rowSpan);
      return;
    }
    const tabletSpan = s.layouts.tablet?.colSpan ?? s.gridColSpan ?? cfg.cols;
    const colSpan = cfg.singleColumn ? cfg.cols : Math.min(tabletSpan, cfg.cols);
    s.layouts[mode] = { col: 1, row: nextRow, colSpan, rowSpan: MIN_ROW_SPAN };
    nextRow += MIN_ROW_SPAN;
  });
}

/**
 * Load layouts[mode] into the flat working props. Seeds the profile first
 * if any card is missing it.
 */
export function hydrateLayout(sections, mode) {
  if (!Array.isArray(sections) || !DEVICE_MODES[mode]) return;
  const cfg = DEVICE_MODES[mode];

  const missing = sections.some(s => s.type !== 'header' && !(s.layouts && s.layouts[mode]));
  if (missing) seedProfile(sections, mode);

  sections.forEach(s => {
    if (s.type === 'header') return;
    const p = s.layouts && s.layouts[mode];
    if (!p) return;
    s.gridCol = cfg.singleColumn ? 1 : p.col;
    s.gridRow = p.row;
    s.gridColSpan = cfg.singleColumn ? cfg.cols : Math.min(p.colSpan, cfg.cols);
    s.gridRowSpan = p.rowSpan;
  });
}

/**
 * Switch the active device mode: persist the current flat layout into its
 * profile, swap in the target profile, resize the container, re-render.
 * Works both in view mode and mid-edit (operates on currentSections()).
 */
export function switchDeviceMode(mode) {
  if (!DEVICE_MODES[mode] || mode === getActiveMode()) return;

  const sections = currentSections();

  // Save outgoing mode's layout into its profile
  persistActiveLayout(sections);

  // Activate the new mode (remember per-browser + in the synced model)
  _activeMode = mode;
  try { localStorage.setItem(DEVICE_MODE_STORAGE_KEY, mode); } catch (e) { /* private mode */ }
  model.lastActiveMode = mode;
  if (editState.working) editState.working.lastActiveMode = mode;

  // Swap in the new mode's layout
  hydrateLayout(sections, mode);

  applyCellSize();
  if (window.renderAllSections) window.renderAllSections();
  if (window.markDirtyAndSave) window.markDirtyAndSave();
  if (window.updateDeviceModeToggleIcon) window.updateDeviceModeToggleIcon();
}

// ============================================================
// MIGRATION v8: wrap flat layout into per-device profiles
// ============================================================

export function migrateToDeviceLayouts(data) {
  if (data.schemaVersion >= 8) return data;

  if (Array.isArray(data.sections)) {
    data.sections.forEach(section => {
      if (section.type === 'header') return;
      if (!section.layouts) section.layouts = {};
      // The pre-v8 flat layout was designed at 1260px/24 cols = tablet
      if (!section.layouts.tablet && section.gridCol && section.gridRow) {
        section.layouts.tablet = {
          col: section.gridCol,
          row: section.gridRow,
          colSpan: section.gridColSpan || 24,
          rowSpan: section.gridRowSpan || DEFAULT_ROW_SPAN,
        };
      }
    });
  }

  data.lastActiveMode = data.lastActiveMode || 'tablet';
  data.schemaVersion = 8;
  return data;
}

// ============================================================
// RESIZE OBSERVER
// ============================================================

let _resizeObserver = null;
let _resizeDebounce = null;

export function initResizeObserver() {
  if (_resizeObserver) return;

  const main = document.querySelector('.app-main');
  if (!main) return;

  _resizeObserver = new ResizeObserver(() => {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => {
      applyCellSize();
    }, 100);
  });

  _resizeObserver.observe(main);

  // Also observe the header: async-loading images can change its height,
  // which shifts the row origin (--grid-origin-y) for the entire grid.
  const header = main.querySelector('.app-header');
  if (header) _resizeObserver.observe(header);
}
