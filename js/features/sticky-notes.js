// Personal Dashboard - Sticky Notes Feature
// Ephemeral sticky notes that can be dragged and dropped anywhere on the dashboard
// Persisted in localStorage (separate from main model, one set per dashboard), deleted only when user clicks X

import { editState } from '../state.js';
import { $, $$ } from '../utils.js';
import { getDataOwner } from '../core/auth.js';

const STICKY_NOTES_STORAGE_KEY = 'personal_dashboard_sticky_notes';
const STICKY_COLOR_STORAGE_KEY = 'personal_dashboard_sticky_color';

// --- One set of notes per dashboard ---
// Notes stay on this browser (never synced), but each dashboard has its own:
// an account's ('…_sticky_notes@<username>', its color likewise), also while
// its session has ended without a sign-out (getDataOwner); the signed-out
// dashboard keeps the original keys. Before this rule every dashboard on the
// browser shared one set: the notes from before the split (stamped once per
// browser) go to the first account that opens the dashboard after it, with
// the color chosen then (user decision 2026-10-18); until then they show
// signed out. Notes made signed out since the split stay there
const SPLIT_KEY = STICKY_NOTES_STORAGE_KEY + '__split';
const CLAIMED_KEY = STICKY_NOTES_STORAGE_KEY + '__claimed'; // the account that took them

function ownerKey(key, owner) {
  return owner ? `${key}@${owner}` : key;
}

function splitTime() {
  try {
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    if (stored > 0) return stored;
    const now = Date.now();
    localStorage.setItem(SPLIT_KEY, String(now));
    return now;
  } catch { return 0; }
}
splitTime(); // stamped on the first load of this build

// A note made before the split (ids are 'sticky-<ms>')
function madeBeforeSplit(note, split) {
  const made = parseInt(String(note && note.id).replace(/^sticky-/, ''), 10);
  return !(made > 0) || made < split;
}

function readNotes(key) {
  try {
    const raw = localStorage.getItem(key);
    const notes = raw ? JSON.parse(raw) : [];
    return Array.isArray(notes) ? notes : [];
  } catch { return []; }
}

// The first account to open the dashboard after the split takes the notes
// from before it (once per browser: no other account ever gets them)
function claimNotesFromBeforeSplit(owner) {
  if (!owner) return;
  try {
    if (localStorage.getItem(CLAIMED_KEY)) return;
    const split = splitTime();
    if (!split) return;
    const shared = readNotes(STICKY_NOTES_STORAGE_KEY);
    const before = shared.filter(n => madeBeforeSplit(n, split));
    if (before.length) {
      const ownNotesKey = ownerKey(STICKY_NOTES_STORAGE_KEY, owner);
      const own = readNotes(ownNotesKey);
      const ids = new Set(own.map(n => n && n.id));
      localStorage.setItem(ownNotesKey, JSON.stringify([...own, ...before.filter(n => !ids.has(n && n.id))]));
    }
    const color = localStorage.getItem(STICKY_COLOR_STORAGE_KEY);
    const ownColorKey = ownerKey(STICKY_COLOR_STORAGE_KEY, owner);
    if (color && localStorage.getItem(ownColorKey) === null) localStorage.setItem(ownColorKey, color);
    // Marked taken before they leave the shared set: if that write fails, no
    // other account takes them
    localStorage.setItem(CLAIMED_KEY, owner);
    if (before.length) {
      localStorage.setItem(STICKY_NOTES_STORAGE_KEY, JSON.stringify(shared.filter(n => !madeBeforeSplit(n, split))));
    }
  } catch (e) {
    console.error('Error moving sticky notes to the account:', e);
  }
}

// Pastel color definitions
const STICKY_COLORS = {
  yellow: { body: '#f9ed80', header: '#ede277', border: '#e2cb6a' },
  purple: { body: '#e0c8f0', header: '#d4b8e8', border: '#c8a8dc' },
  green: { body: '#c8f0d4', header: '#b8e4c6', border: '#a8d8b8' },
  blue: { body: '#c8e0f5', header: '#b8d4ed', border: '#a8c8e0' }
};

// Track all active sticky notes
const stickyNotes = [];
let dragPreview = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let selectedColor = 'yellow';

// Whose notes are on screen (undefined until initStickyNotes) and the keys they
// were read from: saves go back there even while a sign-in or sign-out is
// still switching the dashboard (the session changes before it is shown)
let notesOwner;
let notesKey = STICKY_NOTES_STORAGE_KEY;
let colorKey = STICKY_COLOR_STORAGE_KEY;

// Minimum drag distance before we consider it a drag vs click
const DRAG_THRESHOLD = 5;

// Initialize sticky notes feature
export function initStickyNotes() {
  const stickyBtn = $('#sticky-note-btn');
  if (!stickyBtn) return;

  // Color preference and notes of whoever owns the dashboard
  showOwnerStickyNotes();

  // Update visibility based on edit mode
  updateStickyButtonVisibility();

  // Set up color picker buttons
  initColorPicker();

  // Mouse events for drag-to-drop
  stickyBtn.addEventListener('mousedown', handleStickyDragStart);
  document.addEventListener('mousemove', handleStickyDragMove);
  document.addEventListener('mouseup', handleStickyDragEnd);

  // Touch events for mobile
  stickyBtn.addEventListener('touchstart', handleStickyTouchStart, { passive: false });
  document.addEventListener('touchmove', handleStickyTouchMove, { passive: false });
  document.addEventListener('touchend', handleStickyTouchEnd);
}

// The dashboard's owner (getDataOwner: the account signed in, one whose
// session ended without a sign-out, else the signed-out dashboard): its color
// preference and its notes
function showOwnerStickyNotes() {
  const owner = getDataOwner();
  claimNotesFromBeforeSplit(owner);
  notesOwner = owner;
  notesKey = ownerKey(STICKY_NOTES_STORAGE_KEY, owner);
  colorKey = ownerKey(STICKY_COLOR_STORAGE_KEY, owner);
  loadSelectedColor();
  markSelectedColor();
  updateStickyButtonColor();
  loadStickyNotes();
}

// A sign-in or sign-out switched the dashboard on screen (auth-ui.js): its own
// notes replace the previous owner's. Phones never start sticky notes
export function refreshStickyNotes() {
  if (notesOwner === undefined || getDataOwner() === notesOwner) return;
  removeNoteElements();
  showOwnerStickyNotes();
}

// Initialize color picker buttons
function initColorPicker() {
  const colorBtns = $$('.sticky-color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectColor(btn.dataset.color);
    });
  });
}

// Load saved color from localStorage (yellow when this dashboard has none)
function loadSelectedColor() {
  selectedColor = 'yellow';
  try {
    const saved = localStorage.getItem(colorKey);
    if (saved && STICKY_COLORS[saved]) {
      selectedColor = saved;
    }
  } catch (e) {
    console.error('Error loading sticky color:', e);
  }
}

// Save selected color to localStorage
function saveSelectedColor() {
  try {
    localStorage.setItem(colorKey, selectedColor);
  } catch (e) {
    console.error('Error saving sticky color:', e);
  }
}

// Select a color
function selectColor(color) {
  if (!STICKY_COLORS[color]) return;

  selectedColor = color;
  saveSelectedColor();
  markSelectedColor();

  // Update sticky note button icon color
  updateStickyButtonColor();
}

// Update color picker button states
function markSelectedColor() {
  $$('.sticky-color-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === selectedColor);
  });
}

// Update the sticky note button icon to match selected color
function updateStickyButtonColor() {
  const stickyBtn = $('#sticky-note-btn');
  if (!stickyBtn) return;

  // Remove all color classes
  stickyBtn.classList.remove('sticky-yellow', 'sticky-purple', 'sticky-green', 'sticky-blue');
  // Add the selected color class
  stickyBtn.classList.add(`sticky-${selectedColor}`);
}

// Show/hide sticky button based on edit mode
export function updateStickyButtonVisibility() {
  const container = $('#sticky-note-container');
  if (!container) return;

  // Only show when NOT in edit mode
  if (editState.enabled) {
    container.hidden = true;
  } else {
    container.hidden = false;
  }
}

// Load this dashboard's sticky notes from localStorage
function loadStickyNotes() {
  try {
    const stored = localStorage.getItem(notesKey);
    if (stored) {
      const notes = JSON.parse(stored);
      notes.forEach(noteData => {
        createStickyNoteFromData(noteData);
      });
    }
  } catch (e) {
    console.error('Error loading sticky notes:', e);
  }
}

// Save all sticky notes to localStorage
function saveStickyNotes() {
  try {
    const notesData = stickyNotes.map(note => ({
      id: note.id,
      x: note.x,
      y: note.y,
      content: note.content,
      fontSize: note.fontSize,
      color: note.color || 'yellow'
    }));
    localStorage.setItem(notesKey, JSON.stringify(notesData));
  } catch (e) {
    console.error('Error saving sticky notes:', e);
  }
}

// Create the drag preview element
function createDragPreview() {
  const preview = document.createElement('div');
  preview.className = `sticky-note-preview sticky-${selectedColor}`;
  preview.innerHTML = `
    <div class="sticky-note-header"></div>
    <div class="sticky-note-body"></div>
  `;
  document.body.appendChild(preview);
  return preview;
}

// Handle drag start
function handleStickyDragStart(e) {
  if (editState.enabled) return;

  e.preventDefault();
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  isDragging = false;

  // Create preview but don't show it yet
  dragPreview = createDragPreview();
  dragPreview.style.display = 'none';
}

// Handle drag move
function handleStickyDragMove(e) {
  if (!dragPreview) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Start showing preview once we've moved past threshold
  if (distance > DRAG_THRESHOLD) {
    isDragging = true;
    dragPreview.style.display = 'block';

    // Position preview with cursor at top-left corner
    dragPreview.style.left = e.clientX + 'px';
    dragPreview.style.top = e.clientY + 'px';
  }
}

// Handle drag end
function handleStickyDragEnd(e) {
  if (!dragPreview) return;

  if (isDragging) {
    // Drop the sticky note at current position
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Position relative to document (not viewport) so it scrolls with content
    const x = e.clientX + scrollX;
    const y = e.clientY + scrollY;

    createStickyNote(x, y);
  }

  // Clean up preview
  if (dragPreview) {
    dragPreview.remove();
    dragPreview = null;
  }
  isDragging = false;
}

// Touch event handlers
function handleStickyTouchStart(e) {
  if (editState.enabled) return;

  e.preventDefault();
  const touch = e.touches[0];
  dragStartX = touch.clientX;
  dragStartY = touch.clientY;
  isDragging = false;

  dragPreview = createDragPreview();
  dragPreview.style.display = 'none';
}

function handleStickyTouchMove(e) {
  if (!dragPreview) return;

  e.preventDefault();
  const touch = e.touches[0];
  const dx = touch.clientX - dragStartX;
  const dy = touch.clientY - dragStartY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > DRAG_THRESHOLD) {
    isDragging = true;
    dragPreview.style.display = 'block';
    dragPreview.style.left = touch.clientX + 'px';
    dragPreview.style.top = touch.clientY + 'px';
  }
}

function handleStickyTouchEnd(e) {
  if (!dragPreview) return;

  if (isDragging && e.changedTouches.length > 0) {
    const touch = e.changedTouches[0];
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const x = touch.clientX + scrollX;
    const y = touch.clientY + scrollY;

    createStickyNote(x, y);
  }

  if (dragPreview) {
    dragPreview.remove();
    dragPreview = null;
  }
  isDragging = false;
}

// Create a new sticky note at the given position
function createStickyNote(x, y, content = '', fontSize = 21, color = null) {
  const id = 'sticky-' + Date.now();
  const noteColor = color || selectedColor;
  const noteData = { id, x, y, content, fontSize, color: noteColor };

  createStickyNoteFromData(noteData, { isNew: true });
  saveStickyNotes();
}

// Create a sticky note element from stored data
function createStickyNoteFromData(noteData, { isNew = false } = {}) {
  const { id, x, y, content, fontSize, color } = noteData;
  const noteColor = color || 'yellow';

  const note = document.createElement('div');
  note.className = `sticky-note sticky-${noteColor}`;
  note.id = id;
  note.style.left = x + 'px';
  note.style.top = y + 'px';

  note.innerHTML = `
    <div class="sticky-note-header">
      <button class="sticky-note-delete" title="Delete note" aria-label="Delete note">&times;</button>
    </div>
    <div class="sticky-note-body" contenteditable="true" placeholder="Type here..."></div>
  `;

  document.body.appendChild(note);

  const body = note.querySelector('.sticky-note-body');
  const deleteBtn = note.querySelector('.sticky-note-delete');

  // Set content and font size
  body.innerHTML = content;
  if (fontSize) {
    body.style.fontSize = fontSize + 'px';
  }

  // Store reference with position and content
  const noteRef = {
    id,
    element: note,
    x,
    y,
    content,
    fontSize: fontSize || 21,
    color: noteColor
  };
  stickyNotes.push(noteRef);

  // Wire up delete button
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteStickyNote(id);
  });

  // Handle text input and auto-sizing font
  body.addEventListener('input', () => {
    const newFontSize = adjustFontSize(body);
    noteRef.content = body.innerHTML;
    noteRef.fontSize = newFontSize;
    saveStickyNotes();
  });

  // Show delete button on click or focus
  const showDelete = () => {
    deleteBtn.style.opacity = '1';
  };
  note.addEventListener('click', showDelete);
  body.addEventListener('focus', showDelete);

  // Hide delete button when clicking outside or losing focus
  const hideDeleteHandler = (e) => {
    if (!note.contains(e.target)) {
      deleteBtn.style.opacity = '0';
    }
  };
  document.addEventListener('click', hideDeleteHandler);

  // Store handler reference for cleanup
  note._hideDeleteHandler = hideDeleteHandler;

  // Focus the body for typing only if it's a new note (one read from storage,
  // e.g. after a sign-in, never takes the focus)
  if (isNew) {
    setTimeout(() => body.focus(), 0);
  }

  return note;
}

// Delete a sticky note
function deleteStickyNote(id) {
  const index = stickyNotes.findIndex(n => n.id === id);
  if (index !== -1) {
    const note = stickyNotes[index];
    // Remove event listener
    if (note.element._hideDeleteHandler) {
      document.removeEventListener('click', note.element._hideDeleteHandler);
    }
    note.element.remove();
    stickyNotes.splice(index, 1);
    saveStickyNotes();
  }
}

// Adjust font size to fit content within the fixed container
function adjustFontSize(body) {
  const container = body.parentElement;
  const maxHeight = container.offsetHeight - body.offsetTop;

  // Fast path: the size the note already has still fits, nothing overflows the body (so its
  // scroll offset is 0 whichever sizes are tried) and the next size up no longer fits: the
  // scan below would end on this same size, after one forced layout per size tried from 16
  const current = parseFloat(body.style.fontSize);
  if (current >= 10 && current <= 16 && Number.isInteger(current * 2)) {
    const height = body.scrollHeight;
    if (height <= maxHeight && height <= body.clientHeight) {
      if (current === 16) return 16;
      body.style.fontSize = (current + 0.5) + 'px';
      const nextFits = body.scrollHeight <= maxHeight;
      body.style.fontSize = current + 'px';
      if (!nextFits) return current;
    }
  }

  // Start with base font size
  let fontSize = 16;
  body.style.fontSize = fontSize + 'px';

  // Shrink font until content fits (minimum 10px)
  while (body.scrollHeight > maxHeight && fontSize > 10) {
    fontSize -= 0.5;
    body.style.fontSize = fontSize + 'px';
  }

  return fontSize;
}

// Take the notes off the page (what is stored stays)
function removeNoteElements() {
  stickyNotes.forEach(n => {
    if (n.element._hideDeleteHandler) {
      document.removeEventListener('click', n.element._hideDeleteHandler);
    }
    n.element.remove();
  });
  stickyNotes.length = 0;
}

// Clear all sticky notes (available manually if needed)
export function clearAllStickyNotes() {
  removeNoteElements();
  saveStickyNotes();
}
