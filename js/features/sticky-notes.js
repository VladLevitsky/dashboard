// Personal Dashboard - Sticky Notes Feature
// Ephemeral sticky notes that can be dragged and dropped anywhere on the dashboard
// Persisted in localStorage (separate from main model), deleted only when user clicks X

import { editState } from '../state.js';
import { $ } from '../utils.js';

const STICKY_NOTES_STORAGE_KEY = 'personal_dashboard_sticky_notes';

// Track all active sticky notes
const stickyNotes = [];
let dragPreview = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Minimum drag distance before we consider it a drag vs click
const DRAG_THRESHOLD = 5;

// Initialize sticky notes feature
export function initStickyNotes() {
  const stickyBtn = $('#sticky-note-btn');
  if (!stickyBtn) return;

  // Load existing sticky notes from localStorage
  loadStickyNotes();

  // Update visibility based on edit mode
  updateStickyButtonVisibility();

  // Mouse events for drag-to-drop
  stickyBtn.addEventListener('mousedown', handleStickyDragStart);
  document.addEventListener('mousemove', handleStickyDragMove);
  document.addEventListener('mouseup', handleStickyDragEnd);

  // Touch events for mobile
  stickyBtn.addEventListener('touchstart', handleStickyTouchStart, { passive: false });
  document.addEventListener('touchmove', handleStickyTouchMove, { passive: false });
  document.addEventListener('touchend', handleStickyTouchEnd);
}

// Show/hide sticky button based on edit mode
export function updateStickyButtonVisibility() {
  const stickyBtn = $('#sticky-note-btn');
  if (!stickyBtn) return;

  // Only show when NOT in edit mode
  if (editState.enabled) {
    stickyBtn.hidden = true;
  } else {
    stickyBtn.hidden = false;
  }
}

// Load sticky notes from localStorage
function loadStickyNotes() {
  try {
    const stored = localStorage.getItem(STICKY_NOTES_STORAGE_KEY);
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
      fontSize: note.fontSize
    }));
    localStorage.setItem(STICKY_NOTES_STORAGE_KEY, JSON.stringify(notesData));
  } catch (e) {
    console.error('Error saving sticky notes:', e);
  }
}

// Create the drag preview element
function createDragPreview() {
  const preview = document.createElement('div');
  preview.className = 'sticky-note-preview';
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
function createStickyNote(x, y, content = '', fontSize = 21) {
  const id = 'sticky-' + Date.now();
  const noteData = { id, x, y, content, fontSize };

  createStickyNoteFromData(noteData);
  saveStickyNotes();
}

// Create a sticky note element from stored data
function createStickyNoteFromData(noteData) {
  const { id, x, y, content, fontSize } = noteData;

  const note = document.createElement('div');
  note.className = 'sticky-note';
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
    fontSize: fontSize || 21
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

  // Show delete button on focus/click
  note.addEventListener('click', () => {
    deleteBtn.style.opacity = '1';
  });

  // Hide delete button when clicking outside
  const hideDeleteHandler = (e) => {
    if (!note.contains(e.target)) {
      deleteBtn.style.opacity = '0';
    }
  };
  document.addEventListener('click', hideDeleteHandler);

  // Store handler reference for cleanup
  note._hideDeleteHandler = hideDeleteHandler;

  // Focus the body for typing only if it's a new note (empty content)
  if (!content) {
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

  // Start with base font size (21px after 15% scaling twice)
  let fontSize = 21;
  body.style.fontSize = fontSize + 'px';

  // Shrink font until content fits (minimum 10px)
  while (body.scrollHeight > maxHeight && fontSize > 10) {
    fontSize -= 0.5;
    body.style.fontSize = fontSize + 'px';
  }

  return fontSize;
}

// Clear all sticky notes (available manually if needed)
export function clearAllStickyNotes() {
  stickyNotes.forEach(n => {
    if (n.element._hideDeleteHandler) {
      document.removeEventListener('click', n.element._hideDeleteHandler);
    }
    n.element.remove();
  });
  stickyNotes.length = 0;
  saveStickyNotes();
}
