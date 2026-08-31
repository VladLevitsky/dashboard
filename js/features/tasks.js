// Personal Dashboard - Tasks Module
// Handles Eisenhower Matrix task management with centralized task storage
// Tasks are color-coded (blue/yellow/orange/red) representing urgency and importance

import { model, editState, currentData, currentSections } from '../state.js';
import { $, showToast, createAnimatedBorder, normalizeDescHtml, openUrl } from '../utils.js';
import { markDirtyAndSave, handleEditorInput, handleEditorKeydown, createHighlighterButton, attachHighlighterContextMenu, toggleChecklist, isInChecklist, attachChecklistHandler } from './edit-mode.js';
import { saveModel } from '../core/storage.js';
import { uploadFile, openFile, setImageFromRef } from '../core/file-service.js';
import { TASK_COLORS, TASK_COLOR_LABELS, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS } from '../constants.js';

// Module state
let currentTasksReminder = null;
let currentTasksListItem = null;
let currentTasksListItemSectionId = null;
let currentEditingTaskId = null;
let currentItemSelectorCallback = null;

// Pre-linked item context (when adding task from an item)
let preLinkedItemContext = null;

// Edit mode drag state (module level for proper sharing)
let dragSrcIndex = null;
let dragTargetIndex = null;

// Color cycle order (Eisenhower Matrix)
// blue = Not Urgent & Not Important
// yellow = Not Urgent & Important
// orange = Urgent & Not Important
// red = Urgent & Important
const COLOR_CYCLE = TASK_COLORS;
const COLOR_LABELS = TASK_COLOR_LABELS;

// ============================================================
// CENTRAL TASK STORE - CRUD Operations
// ============================================================

// Generate unique task ID
export function generateTaskId() {
  return 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Get all tasks from central store
export function getAllTasks() {
  const data = currentData();
  return data.tasks || [];
}

// Get task by ID
export function getTaskById(taskId) {
  const tasks = getAllTasks();
  return tasks.find(t => t.id === taskId);
}

// Get tasks by color (pinned tasks float to top)
export function getTasksByColor(color) {
  const tasks = getAllTasks();
  return tasks.filter(t => t.color === color).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (a.order || 0) - (b.order || 0);
  });
}

// Get all linked item refs for a task (supports legacy single `linkedItem`)
export function getLinkedItems(task) {
  if (!task) return [];
  if (Array.isArray(task.linkedItems) && task.linkedItems.length > 0) return task.linkedItems;
  return task.linkedItem ? [task.linkedItem] : [];
}

// Compare two linked item refs
function sameItemRef(a, b) {
  return !!a && !!b && a.type === b.type && a.key === b.key && a.sectionId === b.sectionId;
}

// Get tasks for a specific item
export function getTasksForItem(type, key, sectionId) {
  const tasks = getAllTasks();
  return tasks.filter(t => getLinkedItems(t).some(li =>
    li.type === type && li.key === key && li.sectionId === sectionId
  ));
}

// Find item by linkedItem reference
function findItemByReference(linkedItem) {
  if (!linkedItem) return null;
  const data = currentData();
  const cardData = data[linkedItem.sectionId];
  if (!cardData || !cardData[linkedItem.subtitle]) return null;

  const subtitleData = cardData[linkedItem.subtitle];
  if (linkedItem.type === 'icon') {
    return subtitleData.icons?.find(i => i.key === linkedItem.key);
  } else if (linkedItem.type === 'reminder') {
    return subtitleData.reminders?.find(r => r.key === linkedItem.key);
  } else if (linkedItem.type === 'subtask') {
    return subtitleData.subtasks?.find(s => s.key === linkedItem.key);
  } else if (linkedItem.type === 'copyPaste') {
    return subtitleData.copyPaste?.find(c => c.key === linkedItem.key);
  }
  return null;
}

// Toggle task pinned state. Returns true if now pinned.
export function toggleTaskPinned(taskId) {
  const task = getTaskById(taskId);
  if (!task) return false;
  task.pinned = !task.pinned;
  saveModel();
  return task.pinned;
}

// Create a new task
export function createTask(title, color, linkedItem, link = null) {
  const data = currentData();
  data.tasks = data.tasks || [];

  const taskId = generateTaskId();
  const task = {
    id: taskId,
    title: title || '',
    color: color || 'blue',
    linkedItem: linkedItem,
    link: link || null,
    order: getTasksByColor(color).length
  };

  data.tasks.push(task);

  // Add reference to linked item
  if (linkedItem) {
    const item = findItemByReference(linkedItem);
    if (item) {
      item.taskIds = item.taskIds || [];
      if (!item.taskIds.includes(taskId)) {
        item.taskIds.push(taskId);
      }
    }
  }

  saveModel();
  return task;
}

// Update an existing task
export function updateTask(taskId, updates) {
  const data = currentData();
  const tasks = data.tasks || [];
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  // If changing linked item, update old and new item references
  if (updates.linkedItem && JSON.stringify(updates.linkedItem) !== JSON.stringify(task.linkedItem)) {
    // Remove from old item
    if (task.linkedItem) {
      const oldItem = findItemByReference(task.linkedItem);
      if (oldItem?.taskIds) {
        oldItem.taskIds = oldItem.taskIds.filter(id => id !== taskId);
      }
    }
    // Add to new item
    const newItem = findItemByReference(updates.linkedItem);
    if (newItem) {
      newItem.taskIds = newItem.taskIds || [];
      if (!newItem.taskIds.includes(taskId)) {
        newItem.taskIds.push(taskId);
      }
    }
  }

  // Queue old R2 files for cleanup if taskLinks are being replaced
  if (updates.taskLinks !== undefined && task.taskLinks) {
    const newFileIds = new Set(
      (updates.taskLinks || []).filter(l => l.type === 'file' && l.fileId).map(l => l.fileId)
    );
    const removedFileIds = task.taskLinks
      .filter(l => l.type === 'file' && l.fileId && !newFileIds.has(l.fileId))
      .map(l => l.fileId);
    if (removedFileIds.length > 0 && window.cleanupOrphanedR2Files) {
      window.cleanupOrphanedR2Files(removedFileIds);
    }
  }

  // If changing color, update order to be last in new color group
  const colorChanging = updates.color && updates.color !== task.color;
  if (colorChanging) {
    updates.order = getTasksByColor(updates.color).length;
  }

  Object.assign(task, updates);
  saveModel();

  // If color changed and task has a highlight, refresh it
  if (colorChanging) {
    if (task.projectHighlight && window.refreshProjectHighlights) {
      window.refreshProjectHighlights();
    }
    if (task.meetingHighlight && window.refreshMeetingHighlights) {
      window.refreshMeetingHighlights(task.meetingHighlight.meetingId, task.id, task.color);
    }
  }

  return task;
}

// Delete a task
export function deleteTask(taskId) {
  const data = currentData();
  const tasks = data.tasks || [];
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return false;

  const task = tasks[taskIndex];

  // Remove reference from linked items
  getLinkedItems(task).forEach(ref => {
    const item = findItemByReference(ref);
    if (item?.taskIds) {
      item.taskIds = item.taskIds.filter(id => id !== taskId);
    }
  });

  // Remove highlight links (revert to plain text, keep text)
  if (task.projectHighlight) {
    removeProjectHighlight(task.projectHighlight.projectId, taskId);
  }
  if (task.meetingHighlight) {
    removeMeetingHighlight(task.meetingHighlight.meetingId, taskId);
  }
  if (task.noteHighlight) {
    removeNoteHighlight(task.noteHighlight.sectionId, taskId);
  }

  // Collect R2 fileIds for deferred cleanup
  const orphanFileIds = [];
  if (task.taskLinks) {
    task.taskLinks.forEach(l => {
      if (l.type === 'file' && l.fileId) orphanFileIds.push(l.fileId);
    });
  }

  tasks.splice(taskIndex, 1);
  saveModel();

  // Clean up R2 files after profile is persisted
  if (orphanFileIds.length > 0 && window.cleanupOrphanedR2Files) {
    window.cleanupOrphanedR2Files(orphanFileIds);
  }

  return true;
}

// Complete a task (move to completed archive)
export function completeTask(taskId) {
  const data = currentData();
  const tasks = data.tasks || [];
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return false;

  const task = tasks[taskIndex];

  // Remove reference from linked items
  getLinkedItems(task).forEach(ref => {
    const item = findItemByReference(ref);
    if (item?.taskIds) {
      item.taskIds = item.taskIds.filter(id => id !== taskId);
    }
  });

  // Mark highlights as completed (turns green, link released)
  if (task.projectHighlight) {
    markProjectHighlightCompleted(task.projectHighlight.projectId, taskId);
  }
  if (task.meetingHighlight) {
    markMeetingHighlightCompleted(task.meetingHighlight.meetingId, taskId);
  }
  if (task.noteHighlight) {
    markNoteHighlightCompleted(task.noteHighlight.sectionId, taskId);
  }

  // Move to completed archive
  task.completed = true;
  task.completedAt = Date.now();
  data.completedTasks = data.completedTasks || [];
  data.completedTasks.push(task);

  // Remove from active tasks
  tasks.splice(taskIndex, 1);
  saveModel();
  return true;
}

// Get all completed tasks
export function getCompletedTasks() {
  const data = currentData();
  return (data.completedTasks || []).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

// Delete a completed task permanently (does NOT affect project highlights - they stay green)
export function deleteCompletedTask(taskId) {
  const data = currentData();
  data.completedTasks = data.completedTasks || [];
  const idx = data.completedTasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  const task = data.completedTasks[idx];
  // Remove highlights (revert to plain text)
  if (task.projectHighlight) {
    removeProjectHighlight(task.projectHighlight.projectId, taskId);
  }
  if (task.meetingHighlight) {
    removeMeetingHighlight(task.meetingHighlight.meetingId, taskId);
  }
  if (task.noteHighlight) {
    removeNoteHighlight(task.noteHighlight.sectionId, taskId);
  }
  const orphanFileIds = [];
  if (task.taskLinks) {
    task.taskLinks.forEach(l => {
      if (l.type === 'file' && l.fileId) orphanFileIds.push(l.fileId);
    });
  }

  data.completedTasks.splice(idx, 1);
  saveModel();

  if (orphanFileIds.length > 0 && window.cleanupOrphanedR2Files) {
    window.cleanupOrphanedR2Files(orphanFileIds);
  }

  return true;
}

// Clear all completed tasks permanently
export function clearCompletedTasks() {
  const data = currentData();
  // Collect R2 fileIds before clearing
  const orphanFileIds = [];
  (data.completedTasks || []).forEach(task => {
    if (task.projectHighlight) removeProjectHighlight(task.projectHighlight.projectId, task.id);
    if (task.meetingHighlight) removeMeetingHighlight(task.meetingHighlight.meetingId, task.id);
    if (task.noteHighlight) removeNoteHighlight(task.noteHighlight.sectionId, task.id);
    if (task.taskLinks) {
      task.taskLinks.forEach(l => {
        if (l.type === 'file' && l.fileId) orphanFileIds.push(l.fileId);
      });
    }
  });
  data.completedTasks = [];
  saveModel();

  if (orphanFileIds.length > 0 && window.cleanupOrphanedR2Files) {
    window.cleanupOrphanedR2Files(orphanFileIds);
  }
}

// Helper: remove project highlight (called when deleting a task)
function removeProjectHighlight(projectId, taskId) {
  if (window.removeProjectTaskHighlight) {
    window.removeProjectTaskHighlight(projectId, taskId);
  }
}

// Helper: mark project highlight as completed (called when completing a task)
function markProjectHighlightCompleted(projectId, taskId) {
  if (window.markProjectTaskHighlightCompleted) {
    window.markProjectTaskHighlightCompleted(projectId, taskId);
  }
}

// Helper: remove meeting highlight (called when deleting a task)
function removeMeetingHighlight(meetingId, taskId) {
  if (window.removeMeetingTaskHighlight) {
    window.removeMeetingTaskHighlight(meetingId, taskId);
  }
}

// Helper: mark meeting highlight as completed
function markMeetingHighlightCompleted(meetingId, taskId) {
  if (window.markMeetingTaskHighlightCompleted) {
    window.markMeetingTaskHighlightCompleted(meetingId, taskId);
  }
}

// Helper: mark card note highlight as completed
function markNoteHighlightCompleted(sectionId, taskId) {
  if (window.markNoteTaskHighlightCompleted) {
    window.markNoteTaskHighlightCompleted(sectionId, taskId);
  }
}

// Helper: remove card note highlight (revert to plain text)
function removeNoteHighlight(sectionId, taskId) {
  if (window.removeNoteTaskHighlight) {
    window.removeNoteTaskHighlight(sectionId, taskId);
  }
}

// Move task to a different color (for drag-drop between Eisenhower cards)
export function moveTaskToColor(taskId, newColor, newOrder = null) {
  const task = getTaskById(taskId);
  if (!task) return null;

  if (newOrder === null) {
    newOrder = getTasksByColor(newColor).length;
  }

  return updateTask(taskId, { color: newColor, order: newOrder });
}

// Reorder task within same color group
export function reorderTaskWithinColor(taskId, newOrder) {
  const task = getTaskById(taskId);
  if (!task) return null;

  const data = currentData();
  const tasksInColor = getTasksByColor(task.color);
  const currentIndex = tasksInColor.findIndex(t => t.id === taskId);

  if (currentIndex === -1) return null;

  // Remove from current position and insert at new position
  tasksInColor.splice(currentIndex, 1);
  tasksInColor.splice(newOrder, 0, task);

  // Update order values for all tasks in this color
  tasksInColor.forEach((t, idx) => {
    t.order = idx;
  });

  saveModel();
  return task;
}

// Clean up tasks when an item is deleted
export function cleanupTasksForItem(type, key, sectionId) {
  const data = currentData();
  const tasks = data.tasks || [];

  // Find and remove all tasks linked to this item
  const tasksToRemove = tasks.filter(t =>
    t.linkedItem &&
    t.linkedItem.type === type &&
    t.linkedItem.key === key &&
    t.linkedItem.sectionId === sectionId
  );

  tasksToRemove.forEach(task => {
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      tasks.splice(idx, 1);
    }
  });

  if (tasksToRemove.length > 0) {
    saveModel();
  }

  return tasksToRemove.length;
}

// --- Open tasks modal for reminder
export function openTasksModal(reminder) {
  currentTasksReminder = reminder;

  if (!reminder.tasks) {
    reminder.tasks = [];
  }

  let modal = $('#reminder-tasks-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reminder-tasks-modal';
    modal.className = 'reminder-tasks-modal';
    modal.innerHTML = `
      <div class="reminder-tasks-dialog">
        <h3>Manage Tasks</h3>
        <div class="reminder-tasks-content">
          <div id="reminder-tasks-list" class="reminder-tasks-list"></div>
          <button type="button" id="add-reminder-task-btn" class="btn-add-task">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Task
          </button>
        </div>
        <div class="reminder-tasks-actions">
          <button type="button" id="reminder-tasks-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="reminder-tasks-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    $('#add-reminder-task-btn').addEventListener('click', addTaskRow);
    $('#reminder-tasks-cancel').addEventListener('click', cancelTasksModal);
    $('#reminder-tasks-save').addEventListener('click', saveTasksModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelTasksModal();
      }
    });
  }

  renderTaskRows();
  modal.hidden = false;
}

// --- Render task rows for reminder
export function renderTaskRows() {
  const listContainer = $('#reminder-tasks-list');
  listContainer.innerHTML = '';

  if (!currentTasksReminder.tasks) {
    currentTasksReminder.tasks = [];
  }

  // Reset drag state
  dragSrcIndex = null;
  dragTargetIndex = null;

  // Create drop indicator
  const dropIndicator = document.createElement('div');
  dropIndicator.className = 'task-row-drop-indicator';
  listContainer.appendChild(dropIndicator);

  currentTasksReminder.tasks.forEach((task, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'reminder-task-row';
    rowDiv.draggable = true;
    rowDiv.dataset.index = index;

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'task-row-drag-handle';
    dragHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="6" r="1.5"></circle>
      <circle cx="15" cy="6" r="1.5"></circle>
      <circle cx="9" cy="12" r="1.5"></circle>
      <circle cx="15" cy="12" r="1.5"></circle>
      <circle cx="9" cy="18" r="1.5"></circle>
      <circle cx="15" cy="18" r="1.5"></circle>
    </svg>`;
    dragHandle.title = 'Drag to reorder';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Task title';
    titleInput.value = task.title || '';
    titleInput.className = 'task-title-input';
    titleInput.addEventListener('input', (e) => {
      task.title = e.target.value;
    });

    // Color selector buttons
    const colorContainer = document.createElement('div');
    colorContainer.className = 'task-color-selector';

    COLOR_CYCLE.forEach(color => {
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = `task-color-btn ${color}${task.color === color ? ' active' : ''}`;
      colorBtn.title = COLOR_LABELS[color] || color;
      colorBtn.addEventListener('click', () => {
        task.color = color;
        colorContainer.querySelectorAll('.task-color-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        colorBtn.classList.add('active');
      });
      colorContainer.appendChild(colorBtn);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete-task';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete task';
    deleteBtn.addEventListener('click', () => {
      currentTasksReminder.tasks.splice(index, 1);
      renderTaskRows();
    });

    // Drag events
    rowDiv.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      rowDiv.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      // Set drag image
      e.dataTransfer.setDragImage(rowDiv, 50, 20);
    });

    rowDiv.addEventListener('dragend', () => {
      rowDiv.classList.remove('dragging');
      dropIndicator.classList.remove('visible');

      // Perform the reorder if we have valid indices
      if (dragSrcIndex !== null && dragTargetIndex !== null && dragSrcIndex !== dragTargetIndex) {
        const tasks = currentTasksReminder.tasks;
        const [movedTask] = tasks.splice(dragSrcIndex, 1);
        const insertAt = dragSrcIndex < dragTargetIndex ? dragTargetIndex - 1 : dragTargetIndex;
        tasks.splice(insertAt, 0, movedTask);
        renderTaskRows();
      }

      dragSrcIndex = null;
      dragTargetIndex = null;
    });

    rowDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (dragSrcIndex === null) return;

      const rect = rowDiv.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const rowIndex = parseInt(rowDiv.dataset.index, 10);

      if (e.clientY < midY) {
        // Insert before this row
        dragTargetIndex = rowIndex;
        dropIndicator.style.top = `${rowDiv.offsetTop - 2}px`;
      } else {
        // Insert after this row
        dragTargetIndex = rowIndex + 1;
        dropIndicator.style.top = `${rowDiv.offsetTop + rowDiv.offsetHeight + 2}px`;
      }

      dropIndicator.classList.add('visible');
    });

    rowDiv.appendChild(dragHandle);
    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(colorContainer);
    rowDiv.appendChild(deleteBtn);
    listContainer.appendChild(rowDiv);
  });
}

// --- Add task row for reminder
export function addTaskRow() {
  if (!currentTasksReminder.tasks) {
    currentTasksReminder.tasks = [];
  }
  currentTasksReminder.tasks.push({ title: '', color: 'blue' });
  renderTaskRows();

  const inputs = document.querySelectorAll('#reminder-tasks-list .task-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// --- Cancel tasks modal
export function cancelTasksModal() {
  const modal = $('#reminder-tasks-modal');
  if (modal) modal.hidden = true;
  currentTasksReminder = null;
}

// --- Save tasks modal
export function saveTasksModal() {
  if (!currentTasksReminder) return;

  currentTasksReminder.tasks = currentTasksReminder.tasks.filter(
    task => task.title.trim()
  );

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  const modal = $('#reminder-tasks-modal');
  if (modal) modal.hidden = true;
  currentTasksReminder = null;
}

// --- Toggle reminder tasks in view mode
export function toggleReminderTasks(reminderKey, subtitle, sectionId, buttonEl) {
  // Query central store for tasks linked to this reminder
  const linkedTasks = getTasksForItem('reminder', reminderKey, sectionId);
  if (linkedTasks.length === 0) return;

  let tasksContainer = buttonEl._tasksContainer;

  if (tasksContainer && tasksContainer.parentNode) {
    // Close existing container
    const bubbles = tasksContainer.querySelectorAll('.reminder-task-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    tasksContainer.classList.remove('open');
    tasksContainer.classList.add('closing');
    setTimeout(() => {
      if (tasksContainer.parentNode) {
        tasksContainer.remove();
      }
    }, 250);
    buttonEl._tasksContainer = null;
  } else {
    // Open new container
    tasksContainer = document.createElement('div');
    tasksContainer.className = 'reminder-tasks-expanded';

    linkedTasks.forEach((task, index) => {
      const taskBubble = document.createElement('div');
      taskBubble.className = `reminder-task-bubble task-bubble-${task.color}`;
      taskBubble.textContent = task.title || 'Task';
      taskBubble.style.animationDelay = `${index * 50}ms`;
      taskBubble.dataset.taskId = task.id;

      // Click to open task editor
      taskBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditTaskModal(task.id);
      });

      tasksContainer.appendChild(taskBubble);
    });

    document.body.appendChild(tasksContainer);
    buttonEl._tasksContainer = tasksContainer;

    const buttonRect = buttonEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const margin = 20;
    let leftPos = buttonRect.right + margin + scrollX;
    let topPos = buttonRect.top + buttonRect.height / 2 + scrollY;

    requestAnimationFrame(() => {
      const containerWidth = tasksContainer.offsetWidth || 150;
      const containerHeight = tasksContainer.offsetHeight || 100;

      if (buttonRect.right + margin + containerWidth > window.innerWidth) {
        leftPos = buttonRect.left - containerWidth - margin + scrollX;
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      tasksContainer.style.left = `${leftPos}px`;
      tasksContainer.style.top = `${topPos}px`;
      tasksContainer.style.transform = 'translateY(-50%)';

      tasksContainer.classList.add('open');
    });
  }
}

// --- Cycle task color (red -> yellow -> green -> red)
function cycleTaskColor(task, bubbleEl, reminder, sectionId, subtitle) {
  // Get task index from the bubble element
  const taskIndex = parseInt(bubbleEl.dataset.index, 10);

  // Look up fresh reminder from currentData() to ensure we modify the actual model
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData) return;

  // Use subtitle directly if provided, otherwise fall back to searching all subtitles
  let actualReminder = null;
  if (subtitle && cardData[subtitle] && cardData[subtitle].reminders) {
    actualReminder = cardData[subtitle].reminders.find(r => r.key === reminder.key);
  }

  // Fallback: search all subtitles if not found with direct subtitle access
  if (!actualReminder) {
    for (const [sub, subtitleData] of Object.entries(cardData)) {
      if (subtitleData && subtitleData.reminders) {
        const foundReminder = subtitleData.reminders.find(r => r.key === reminder.key);
        if (foundReminder) {
          actualReminder = foundReminder;
          break;
        }
      }
    }
  }

  if (!actualReminder || !actualReminder.tasks || !actualReminder.tasks[taskIndex]) return;

  const actualTask = actualReminder.tasks[taskIndex];
  const currentColorIndex = COLOR_CYCLE.indexOf(actualTask.color);
  const nextIndex = (currentColorIndex + 1) % COLOR_CYCLE.length;
  const newColor = COLOR_CYCLE[nextIndex];

  actualTask.color = newColor;

  // Update bubble class
  bubbleEl.className = `reminder-task-bubble task-bubble-${newColor}`;

  // Save the change
  saveModel();
}

// --- Reorder tasks
function reorderTasks(reminder, fromIndex, toIndex, sectionId, buttonEl, subtitle) {
  // Look up fresh reminder from currentData() to ensure we modify the actual model
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData) return;

  // Use subtitle directly if provided, otherwise fall back to searching all subtitles
  let actualReminder = null;
  if (subtitle && cardData[subtitle] && cardData[subtitle].reminders) {
    actualReminder = cardData[subtitle].reminders.find(r => r.key === reminder.key);
  }

  // Fallback: search all subtitles if not found with direct subtitle access
  if (!actualReminder) {
    for (const [sub, subtitleData] of Object.entries(cardData)) {
      if (subtitleData && subtitleData.reminders) {
        const foundRem = subtitleData.reminders.find(r => r.key === reminder.key);
        if (foundRem) {
          actualReminder = foundRem;
          break;
        }
      }
    }
  }

  if (!actualReminder || !actualReminder.tasks) return;

  const tasks = actualReminder.tasks;
  const [movedTask] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, movedTask);

  // Save
  saveModel();

  // Animate DOM reorder in place
  const container = buttonEl._tasksContainer;
  if (container) {
    const bubbles = Array.from(container.querySelectorAll('.reminder-task-bubble'));
    const movedBubble = bubbles[fromIndex];

    if (movedBubble) {
      // Remove and reinsert at new position
      movedBubble.remove();
      const targetBubble = container.querySelectorAll('.reminder-task-bubble')[toIndex];
      if (targetBubble) {
        container.insertBefore(movedBubble, targetBubble);
      } else {
        // Insert before the drop indicator (which is last child)
        const dropIndicator = container.querySelector('.task-drop-indicator');
        container.insertBefore(movedBubble, dropIndicator);
      }

      // Update all data-index attributes
      container.querySelectorAll('.reminder-task-bubble').forEach((bubble, idx) => {
        bubble.dataset.index = idx;
      });

      // Add a brief highlight animation
      movedBubble.style.transform = 'scale(1.05)';
      movedBubble.style.transition = 'transform 0.15s ease';
      setTimeout(() => {
        movedBubble.style.transform = '';
        setTimeout(() => {
          movedBubble.style.transition = '';
        }, 150);
      }, 150);
    }
  }
}

// --- Close all open reminder task bubbles
export function closeAllReminderTasks() {
  const openContainers = document.querySelectorAll('.reminder-tasks-expanded');
  openContainers.forEach(container => {
    const bubbles = container.querySelectorAll('.reminder-task-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    container.classList.remove('open');
    container.classList.add('closing');
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
      }
    }, 250);
  });
  document.querySelectorAll('.reminder-tasks-toggle').forEach(btn => {
    btn._tasksContainer = null;
  });
}

// ============================================================
// ICON TASKS
// ============================================================

// --- Toggle icon tasks in view mode (shows tasks linked to this icon)
export function toggleIconTasks(iconKey, subtitle, sectionId, buttonEl) {
  const tasks = getTasksForItem('icon', iconKey, sectionId);
  if (!tasks || tasks.length === 0) return;

  let tasksContainer = buttonEl._tasksContainer;

  if (tasksContainer && tasksContainer.parentNode) {
    // Close existing container
    const bubbles = tasksContainer.querySelectorAll('.reminder-task-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    tasksContainer.classList.remove('open');
    tasksContainer.classList.add('closing');
    setTimeout(() => {
      if (tasksContainer.parentNode) {
        tasksContainer.remove();
      }
    }, 250);
    buttonEl._tasksContainer = null;
  } else {
    // Open new container
    tasksContainer = document.createElement('div');
    tasksContainer.className = 'reminder-tasks-expanded';

    tasks.forEach((task, index) => {
      const taskBubble = document.createElement('div');
      taskBubble.className = `reminder-task-bubble task-bubble-${task.color}`;
      taskBubble.textContent = task.title || 'Task';
      taskBubble.style.animationDelay = `${index * 50}ms`;
      taskBubble.dataset.taskId = task.id;

      // Click to edit task
      taskBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditTaskModal(task.id);
      });

      tasksContainer.appendChild(taskBubble);
    });

    document.body.appendChild(tasksContainer);
    buttonEl._tasksContainer = tasksContainer;

    const buttonRect = buttonEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const margin = 20;
    let leftPos = buttonRect.right + margin + scrollX;
    let topPos = buttonRect.top + buttonRect.height / 2 + scrollY;

    requestAnimationFrame(() => {
      const containerWidth = tasksContainer.offsetWidth || 150;
      const containerHeight = tasksContainer.offsetHeight || 100;

      if (buttonRect.right + margin + containerWidth > window.innerWidth) {
        leftPos = buttonRect.left - containerWidth - margin + scrollX;
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      tasksContainer.style.left = `${leftPos}px`;
      tasksContainer.style.top = `${topPos}px`;
      tasksContainer.style.transform = 'translateY(-50%)';

      tasksContainer.classList.add('open');
    });
  }
}

// --- Close all open icon task bubbles
export function closeAllIconTasks() {
  document.querySelectorAll('.icon-task-indicator').forEach(btn => {
    if (btn._tasksContainer && btn._tasksContainer.parentNode) {
      btn._tasksContainer.remove();
    }
    btn._tasksContainer = null;
  });
}

// --- Open icon tasks modal (for edit mode - shows linked tasks and allows adding)
export function openIconTasksModal(iconRef, sectionId, subtitle) {
  openItemTasksModal('icon', iconRef.key, sectionId, subtitle);
}

// ============================================================
// LIST ITEM TASKS (for subtasks)
// ============================================================

// --- Open tasks modal for list item
export function openListItemTasksModal(item, sectionId) {
  currentTasksListItem = item;
  currentTasksListItemSectionId = sectionId;

  if (!item.tasks) {
    item.tasks = [];
  }

  let modal = $('#list-item-tasks-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'list-item-tasks-modal';
    modal.className = 'reminder-tasks-modal';
    modal.innerHTML = `
      <div class="reminder-tasks-dialog">
        <h3>Manage Tasks</h3>
        <div class="reminder-tasks-content">
          <div id="list-item-tasks-list" class="reminder-tasks-list"></div>
          <button type="button" id="add-list-item-task-btn" class="btn-add-task">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Task
          </button>
        </div>
        <div class="reminder-tasks-actions">
          <button type="button" id="list-item-tasks-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="list-item-tasks-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    $('#add-list-item-task-btn').addEventListener('click', addListItemTaskRow);
    $('#list-item-tasks-cancel').addEventListener('click', cancelListItemTasksModal);
    $('#list-item-tasks-save').addEventListener('click', saveListItemTasksModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelListItemTasksModal();
      }
    });
  }

  renderListItemTaskRows();
  modal.hidden = false;
}

// --- Render task rows for list item
export function renderListItemTaskRows() {
  const listContainer = $('#list-item-tasks-list');
  listContainer.innerHTML = '';

  if (!currentTasksListItem.tasks) {
    currentTasksListItem.tasks = [];
  }

  // Reset drag state
  dragSrcIndex = null;
  dragTargetIndex = null;

  // Create drop indicator
  const dropIndicator = document.createElement('div');
  dropIndicator.className = 'task-row-drop-indicator';
  listContainer.appendChild(dropIndicator);

  currentTasksListItem.tasks.forEach((task, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'reminder-task-row';
    rowDiv.draggable = true;
    rowDiv.dataset.index = index;

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'task-row-drag-handle';
    dragHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="6" r="1.5"></circle>
      <circle cx="15" cy="6" r="1.5"></circle>
      <circle cx="9" cy="12" r="1.5"></circle>
      <circle cx="15" cy="12" r="1.5"></circle>
      <circle cx="9" cy="18" r="1.5"></circle>
      <circle cx="15" cy="18" r="1.5"></circle>
    </svg>`;
    dragHandle.title = 'Drag to reorder';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Task title';
    titleInput.value = task.title || '';
    titleInput.className = 'task-title-input';
    titleInput.addEventListener('input', (e) => {
      task.title = e.target.value;
    });

    // Color selector buttons
    const colorContainer = document.createElement('div');
    colorContainer.className = 'task-color-selector';

    COLOR_CYCLE.forEach(color => {
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = `task-color-btn ${color}${task.color === color ? ' active' : ''}`;
      colorBtn.title = COLOR_LABELS[color] || color;
      colorBtn.addEventListener('click', () => {
        task.color = color;
        colorContainer.querySelectorAll('.task-color-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        colorBtn.classList.add('active');
      });
      colorContainer.appendChild(colorBtn);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete-task';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete task';
    deleteBtn.addEventListener('click', () => {
      currentTasksListItem.tasks.splice(index, 1);
      renderListItemTaskRows();
    });

    // Drag events
    rowDiv.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      rowDiv.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      e.dataTransfer.setDragImage(rowDiv, 50, 20);
    });

    rowDiv.addEventListener('dragend', () => {
      rowDiv.classList.remove('dragging');
      dropIndicator.classList.remove('visible');

      // Perform the reorder if we have valid indices
      if (dragSrcIndex !== null && dragTargetIndex !== null && dragSrcIndex !== dragTargetIndex) {
        const tasks = currentTasksListItem.tasks;
        const [movedTask] = tasks.splice(dragSrcIndex, 1);
        const insertAt = dragSrcIndex < dragTargetIndex ? dragTargetIndex - 1 : dragTargetIndex;
        tasks.splice(insertAt, 0, movedTask);
        renderListItemTaskRows();
      }

      dragSrcIndex = null;
      dragTargetIndex = null;
    });

    rowDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (dragSrcIndex === null) return;

      const rect = rowDiv.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const rowIndex = parseInt(rowDiv.dataset.index, 10);

      if (e.clientY < midY) {
        dragTargetIndex = rowIndex;
        dropIndicator.style.top = `${rowDiv.offsetTop - 2}px`;
      } else {
        dragTargetIndex = rowIndex + 1;
        dropIndicator.style.top = `${rowDiv.offsetTop + rowDiv.offsetHeight + 2}px`;
      }

      dropIndicator.classList.add('visible');
    });

    rowDiv.appendChild(dragHandle);
    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(colorContainer);
    rowDiv.appendChild(deleteBtn);
    listContainer.appendChild(rowDiv);
  });
}

// --- Add task row for list item
export function addListItemTaskRow() {
  if (!currentTasksListItem.tasks) {
    currentTasksListItem.tasks = [];
  }
  currentTasksListItem.tasks.push({ title: '', color: 'blue' });
  renderListItemTaskRows();

  const inputs = document.querySelectorAll('#list-item-tasks-list .task-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// --- Cancel list item tasks modal
export function cancelListItemTasksModal() {
  const modal = $('#list-item-tasks-modal');
  if (modal) modal.hidden = true;
  currentTasksListItem = null;
  currentTasksListItemSectionId = null;
}

// --- Save list item tasks modal
export function saveListItemTasksModal() {
  if (!currentTasksListItem) return;

  currentTasksListItem.tasks = currentTasksListItem.tasks.filter(
    task => task.title.trim()
  );

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  const modal = $('#list-item-tasks-modal');
  if (modal) modal.hidden = true;
  currentTasksListItem = null;
  currentTasksListItemSectionId = null;
}

// --- Toggle list item tasks in view mode
export function toggleListItemTasks(itemKey, sectionId, subtitle, buttonEl) {
  // Query central store for tasks linked to this subtask
  const linkedTasks = getTasksForItem('subtask', itemKey, sectionId);
  if (linkedTasks.length === 0) return;

  let tasksContainer = buttonEl._tasksContainer;

  if (tasksContainer && tasksContainer.parentNode) {
    // Close existing container
    const bubbles = tasksContainer.querySelectorAll('.reminder-task-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    tasksContainer.classList.remove('open');
    tasksContainer.classList.add('closing');
    setTimeout(() => {
      if (tasksContainer.parentNode) {
        tasksContainer.remove();
      }
    }, 250);
    buttonEl._tasksContainer = null;
  } else {
    // Open new container
    tasksContainer = document.createElement('div');
    tasksContainer.className = 'reminder-tasks-expanded';

    linkedTasks.forEach((task, index) => {
      const taskBubble = document.createElement('div');
      taskBubble.className = `reminder-task-bubble task-bubble-${task.color}`;
      taskBubble.textContent = task.title || 'Task';
      taskBubble.style.animationDelay = `${index * 50}ms`;
      taskBubble.dataset.taskId = task.id;

      // Click to open task editor
      taskBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditTaskModal(task.id);
      });

      tasksContainer.appendChild(taskBubble);
    });

    document.body.appendChild(tasksContainer);
    buttonEl._tasksContainer = tasksContainer;

    const buttonRect = buttonEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const margin = 20;
    let leftPos = buttonRect.right + margin + scrollX;
    let topPos = buttonRect.top + buttonRect.height / 2 + scrollY;

    requestAnimationFrame(() => {
      const containerWidth = tasksContainer.offsetWidth || 150;
      const containerHeight = tasksContainer.offsetHeight || 100;

      if (buttonRect.right + margin + containerWidth > window.innerWidth) {
        leftPos = buttonRect.left - containerWidth - margin + scrollX;
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      tasksContainer.style.left = `${leftPos}px`;
      tasksContainer.style.top = `${topPos}px`;
      tasksContainer.style.transform = 'translateY(-50%)';

      tasksContainer.classList.add('open');
    });
  }
}

// --- Cycle list item task color
function cycleListItemTaskColor(task, bubbleEl, item, sectionId) {
  // Get task index from the bubble element
  const taskIndex = parseInt(bubbleEl.dataset.index, 10);

  // Look up fresh item from currentData() to ensure we modify the actual model
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData) return;

  let actualItem = null;
  for (const [subtitle, subtitleData] of Object.entries(cardData)) {
    if (subtitleData && subtitleData.subtasks) {
      const foundItem = subtitleData.subtasks.find(s => s.key === item.key);
      if (foundItem) {
        actualItem = foundItem;
        break;
      }
    }
  }

  if (!actualItem || !actualItem.tasks || !actualItem.tasks[taskIndex]) return;

  const actualTask = actualItem.tasks[taskIndex];
  const currentColorIndex = COLOR_CYCLE.indexOf(actualTask.color);
  const nextIndex = (currentColorIndex + 1) % COLOR_CYCLE.length;
  const newColor = COLOR_CYCLE[nextIndex];

  actualTask.color = newColor;

  // Update bubble class
  bubbleEl.className = `reminder-task-bubble task-bubble-${newColor}`;

  // Save the change
  saveModel();
}

// --- Reorder list item tasks
function reorderListItemTasks(item, fromIndex, toIndex, sectionId, buttonEl) {
  // Look up fresh item from currentData() to ensure we modify the actual model
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData) return;

  let actualItem = null;
  for (const [subtitle, subtitleData] of Object.entries(cardData)) {
    if (subtitleData && subtitleData.subtasks) {
      const foundItem = subtitleData.subtasks.find(s => s.key === item.key);
      if (foundItem) {
        actualItem = foundItem;
        break;
      }
    }
  }

  if (!actualItem || !actualItem.tasks) return;

  const tasks = actualItem.tasks;
  const [movedTask] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, movedTask);

  // Save
  saveModel();

  // Animate DOM reorder in place
  const container = buttonEl._tasksContainer;
  if (container) {
    const bubbles = Array.from(container.querySelectorAll('.reminder-task-bubble'));
    const movedBubble = bubbles[fromIndex];

    if (movedBubble) {
      // Remove and reinsert at new position
      movedBubble.remove();
      const targetBubble = container.querySelectorAll('.reminder-task-bubble')[toIndex];
      if (targetBubble) {
        container.insertBefore(movedBubble, targetBubble);
      } else {
        // Insert before the drop indicator (which is last child)
        const dropIndicator = container.querySelector('.task-drop-indicator');
        container.insertBefore(movedBubble, dropIndicator);
      }

      // Update all data-index attributes
      container.querySelectorAll('.reminder-task-bubble').forEach((bubble, idx) => {
        bubble.dataset.index = idx;
      });

      // Add a brief highlight animation
      movedBubble.style.transform = 'scale(1.05)';
      movedBubble.style.transition = 'transform 0.15s ease';
      setTimeout(() => {
        movedBubble.style.transform = '';
        setTimeout(() => {
          movedBubble.style.transition = '';
        }, 150);
      }, 150);
    }
  }
}

// --- Close all open list item task bubbles
export function closeAllListItemTasks() {
  document.querySelectorAll('.list-item-tasks-toggle').forEach(btn => {
    if (btn._tasksContainer && btn._tasksContainer.parentNode) {
      btn._tasksContainer.remove();
    }
    btn._tasksContainer = null;
  });
}

// ============================================================
// EISENHOWER MATRIX TASKS SUMMARY (Slide-out card)
// ============================================================

// Module state for tasks summary
let tasksSummaryExpanded = false;

// --- Toggle tasks summary card (Eisenhower Matrix)
export function toggleTasksSummary() {
  const card = $('#eisenhower-card');
  if (!card) return;

  tasksSummaryExpanded = !tasksSummaryExpanded;

  if (tasksSummaryExpanded) {
    // Close other slide-out panels (abort if user cancels unsaved changes)
    if (window.closeQuickAccess) window.closeQuickAccess();
    if (window.closeMeetingsModal) {
      window.closeMeetingsModal();
      const meetingsModal = document.querySelector('#meetings-modal');
      if (meetingsModal && !meetingsModal.hidden) {
        tasksSummaryExpanded = false;
        return;
      }
    }

    renderEisenhowerMatrix();
    card.hidden = false;
    setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
  } else {
    card.classList.remove('active');
    setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);
  }
}

// --- Alias for backwards compatibility
export function openTasksSummaryModal() {
  if (!tasksSummaryExpanded) {
    toggleTasksSummary();
  }
}

// --- Render Eisenhower Matrix with Important section + 4 cards
function renderEisenhowerMatrix() {
  const grid = $('#eisenhower-grid');
  if (!grid) return;

  grid.innerHTML = '';

  // --- Important section (pinned tasks only, same 4-column layout) ---
  const importantSection = document.createElement('div');
  importantSection.className = 'eisenhower-section';

  const importantHeading = document.createElement('h4');
  importantHeading.className = 'eisenhower-section-heading';
  importantHeading.textContent = 'Primary';
  importantSection.appendChild(importantHeading);

  const importantColumnsGrid = document.createElement('div');
  importantColumnsGrid.className = 'eisenhower-columns-grid';

  COLOR_CYCLE.forEach(color => {
    const card = createEisenhowerCard(color, true);
    importantColumnsGrid.appendChild(card);
  });

  importantSection.appendChild(importantColumnsGrid);
  grid.appendChild(importantSection);

  // --- Secondary section (non-pinned tasks only) ---
  const secondarySection = document.createElement('div');
  secondarySection.className = 'eisenhower-section';

  const secondaryHeading = document.createElement('h4');
  secondaryHeading.className = 'eisenhower-section-heading';
  secondaryHeading.textContent = 'Secondary';
  secondarySection.appendChild(secondaryHeading);

  const columnsGrid = document.createElement('div');
  columnsGrid.className = 'eisenhower-columns-grid';

  COLOR_CYCLE.forEach(color => {
    const card = createEisenhowerCard(color, false);
    columnsGrid.appendChild(card);
  });

  secondarySection.appendChild(columnsGrid);
  grid.appendChild(secondarySection);

  // --- Completed Tasks button ---
  const completedTasks = getCompletedTasks();
  const completedBtn = document.createElement('button');
  completedBtn.type = 'button';
  completedBtn.className = 'eisenhower-completed-btn';
  completedBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6L9 17l-5-5"></path>
    </svg>
    Completed Tasks${completedTasks.length > 0 ? ` (${completedTasks.length})` : ''}
  `;
  completedBtn.addEventListener('click', openCompletedTasksModal);
  grid.appendChild(completedBtn);

  // Initialize delete drop zone
  initDeleteDropZone();
}

// --- Create a single Eisenhower card for a color
// pinnedOnly: true = show only pinned (Important), false = show only non-pinned (Secondary)
function createEisenhowerCard(color, pinnedOnly) {
  const card = document.createElement('div');
  card.className = `eisenhower-priority-card eisenhower-priority-card-${color}`;
  card.dataset.color = color;

  // Header
  const header = document.createElement('div');
  header.className = 'eisenhower-card-header';
  header.textContent = COLOR_LABELS[color];
  card.appendChild(header);

  // Tasks container
  const tasksContainer = document.createElement('div');
  tasksContainer.className = 'eisenhower-card-tasks';
  tasksContainer.dataset.dropzone = color;

  // Get tasks for this color, filtered by pinned state
  const allTasks = getTasksByColor(color);
  const tasks = allTasks.filter(t => pinnedOnly ? t.pinned : !t.pinned);

  if (tasks.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'eisenhower-card-empty';
    emptyMsg.textContent = 'No tasks';
    tasksContainer.appendChild(emptyMsg);
  } else {
    tasks.forEach(task => {
      const taskEl = createEisenhowerTaskElement(task, color);
      tasksContainer.appendChild(taskEl);
    });
  }

  // Enable drop zone for drag-drop (both Important and Secondary cards)
  initEisenhowerDropZone(tasksContainer, color, pinnedOnly);

  card.appendChild(tasksContainer);
  return card;
}

// --- Create a task element within an Eisenhower card
// Border/light color pairs per Eisenhower color
const PINNED_BORDER_COLORS = {
  blue:   { border: '#4478e0', light: '#a8cfff' },
  yellow: { border: '#a88615', light: '#f8e06a' },
  orange: { border: '#d06e1e', light: '#fdd4a0' },
  red:    { border: '#d03030', light: '#ffb0b0' }
};

function createEisenhowerTaskElement(task, color) {
  if (!task) return document.createElement('div');

  const taskEl = document.createElement('div');
  taskEl.className = `eisenhower-task task-bubble-${color}${task.pinned ? ' eisenhower-task-pinned' : ''}`;
  taskEl.dataset.taskId = task.id || '';
  taskEl.draggable = true;

  // Task title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'eisenhower-task-title';
  titleSpan.textContent = task.title || 'Untitled Task';
  taskEl.appendChild(titleSpan);

  // Right side container for icons
  const iconsContainer = document.createElement('div');
  iconsContainer.className = 'eisenhower-task-icons';

  // Task link icon (if task has a link)
  if (task.link && typeof task.link === 'string' && task.link.trim()) {
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'eisenhower-task-link-btn';
    linkBtn.title = 'Task link';
    linkBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
    `;
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskLinkBubble(taskEl, task);
    });
    iconsContainer.appendChild(linkBtn);
  }

  // Linked item indicator
  if (task.linkedItem) {
    const linkedIndicator = document.createElement('span');
    linkedIndicator.className = 'eisenhower-task-linked';
    linkedIndicator.title = `Linked to ${task.linkedItem.type}`;
    linkedIndicator.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    iconsContainer.appendChild(linkedIndicator);
  }

  if (iconsContainer.children.length > 0) {
    taskEl.appendChild(iconsContainer);
  }

  // Long-press detection for pinning (view mode)
  let longPressTimer = null;
  let longPressTriggered = false;

  const startLongPress = (e) => {
    if (e.target.closest('.eisenhower-task-link-btn')) return;
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      const isNowPinned = toggleTaskPinned(task.id);

      showToast(isNowPinned ? 'Task pinned' : 'Task unpinned');
      renderEisenhowerMatrix();
    }, 750);
  };

  const cancelLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  taskEl.addEventListener('mousedown', startLongPress);
  taskEl.addEventListener('mouseup', cancelLongPress);
  taskEl.addEventListener('mouseleave', cancelLongPress);
  taskEl.addEventListener('touchstart', startLongPress, { passive: true });
  taskEl.addEventListener('touchend', cancelLongPress);
  taskEl.addEventListener('touchcancel', cancelLongPress);

  // Click to edit (skip if long press triggered)
  taskEl.addEventListener('click', (e) => {
    if (longPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggered = false;
      return;
    }
    if (e.target.closest('.eisenhower-task-link-btn')) return;
    e.stopPropagation();
    openEditTaskModal(task.id);
  });

  // Drag events
  taskEl.addEventListener('dragstart', (e) => {
    cancelLongPress();
    e.stopPropagation();
    taskEl.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  taskEl.addEventListener('dragend', () => {
    taskEl.classList.remove('dragging');
    // Remove all drop indicators
    document.querySelectorAll('.eisenhower-drop-indicator').forEach(el => el.remove());
  });

  return taskEl;
}

// --- Toggle task link bubble
function toggleTaskLinkBubble(taskEl, task) {
  if (!taskEl || !task || !task.link) return;

  // Close any existing bubbles
  document.querySelectorAll('.task-link-bubble').forEach(b => b.remove());

  // Check if bubble already exists for this task (by data attribute)
  if (taskEl.dataset.bubbleOpen === 'true') {
    taskEl.dataset.bubbleOpen = 'false';
    return;
  }

  // Create the bubble
  const bubble = document.createElement('div');
  bubble.className = 'task-link-bubble';

  const link = document.createElement('a');
  link.href = task.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'task-link-bubble-link';

  // Extract domain for display (without query parameters)
  let displayText = task.link;
  try {
    const url = new URL(task.link);
    // Show hostname only (e.g., www.example.com)
    displayText = url.hostname;
  } catch (e) {
    // Fallback: remove query params manually if URL parsing fails
    displayText = task.link.split('?')[0].split('#')[0];
  }
  link.textContent = displayText;

  link.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  bubble.appendChild(link);

  // Append to body for proper z-index stacking
  document.body.appendChild(bubble);

  // Position the bubble below the task element
  const rect = taskEl.getBoundingClientRect();
  bubble.style.position = 'fixed';
  bubble.style.top = `${rect.bottom + 4}px`;
  bubble.style.left = `${rect.right - bubble.offsetWidth}px`;

  // Mark that bubble is open for this task
  taskEl.dataset.bubbleOpen = 'true';

  // Close bubble when clicking outside
  const closeHandler = (e) => {
    if (!bubble.contains(e.target) && !e.target.closest('.eisenhower-task-link-btn')) {
      bubble.remove();
      taskEl.dataset.bubbleOpen = 'false';
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// --- Initialize drop zone for Eisenhower card
// targetPinned: true = Important section, false = Secondary section
function initEisenhowerDropZone(container, targetColor, targetPinned) {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Show drop indicator
    const dragging = document.querySelector('.eisenhower-task.dragging');
    if (!dragging) return;

    const afterElement = getDragAfterElement(container, e.clientY);
    let indicator = container.querySelector('.eisenhower-drop-indicator');

    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'eisenhower-drop-indicator';
      container.appendChild(indicator);
    }

    if (afterElement) {
      container.insertBefore(indicator, afterElement);
    } else {
      // At the end
      const emptyMsg = container.querySelector('.eisenhower-card-empty');
      if (emptyMsg) {
        container.insertBefore(indicator, emptyMsg);
      } else {
        container.appendChild(indicator);
      }
    }
  });

  container.addEventListener('dragleave', (e) => {
    // Only remove if leaving the container entirely
    if (!container.contains(e.relatedTarget)) {
      const indicator = container.querySelector('.eisenhower-drop-indicator');
      if (indicator) indicator.remove();
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const indicator = container.querySelector('.eisenhower-drop-indicator');
    if (indicator) indicator.remove();

    // Calculate new order based on position
    const tasks = Array.from(container.querySelectorAll('.eisenhower-task:not(.dragging)'));
    const afterElement = getDragAfterElement(container, e.clientY);
    let newOrder = tasks.length;

    if (afterElement) {
      newOrder = tasks.indexOf(afterElement);
    }

    // Move task to new color/position and update pinned state
    const task = getTaskById(taskId);
    if (task) {
      const pinnedChanged = task.pinned !== targetPinned;
      const colorChanged = task.color !== targetColor;

      if (colorChanged) {
        moveTaskToColor(taskId, targetColor, newOrder);
      } else {
        reorderTaskWithinColor(taskId, newOrder);
      }

      // Toggle pinned state if moving between Important and Secondary
      if (pinnedChanged) {
        task.pinned = targetPinned;

        saveModel();
        showToast(targetPinned ? 'Task pinned' : 'Task unpinned');
      }

      renderEisenhowerMatrix();
    }
  });
}

// --- Initialize delete drop zone (checkmark icon in header)
function initDeleteDropZone() {
  const dropTarget = $('#delete-task-drop');
  if (!dropTarget) return;

  dropTarget.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropTarget.classList.add('drag-hover');
  });

  dropTarget.addEventListener('dragleave', () => {
    dropTarget.classList.remove('drag-hover');
  });

  dropTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    dropTarget.classList.remove('drag-hover');
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = getTaskById(taskId);
    if (!task) return;

    completeTask(taskId);
    showToast('Task completed');
    renderEisenhowerMatrix();
    if (window.renderAllSections) window.renderAllSections();
    if (window.refreshProjectHighlights) window.refreshProjectHighlights();
  });
}

// --- Get element after which to insert during drag
function getDragAfterElement(container, y) {
  const tasks = [...container.querySelectorAll('.eisenhower-task:not(.dragging)')];

  return tasks.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- Close tasks summary card
export function closeTasksSummaryModal() {
  if (tasksSummaryExpanded) {
    toggleTasksSummary();
  }
}

// ============================================================
// ADD/EDIT TASK MODAL
// ============================================================

// Callback after task creation (used by Projects module)
let taskCreationCallback = null;

// --- Open modal to add a new task (optionally with a pre-linked item)
export function openAddTaskModal(preLinkedItem = null) {
  taskCreationCallback = null;
  currentEditingTaskId = null;
  preLinkedItemContext = preLinkedItem;
  openTaskEditorModal({
    title: '',
    color: 'blue',
    linkedItem: preLinkedItem
  }, 'Add Task');
}

// --- Open modal to add a new task with a callback on creation
// Used by Projects module to link highlights after task creation
export function openAddTaskModalWithCallback(prefillTitle, callback) {
  taskCreationCallback = callback;
  currentEditingTaskId = null;
  preLinkedItemContext = null;
  openTaskEditorModal({
    title: prefillTitle || '',
    color: 'blue',
    linkedItem: null
  }, 'Add Task');
}

// --- Open modal to edit an existing task
export function openEditTaskModal(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;

  currentEditingTaskId = taskId;
  preLinkedItemContext = null; // Allow editing the linked item when editing
  openTaskEditorModal(task, 'Edit Task');
}

// ============================================================
// UNIFIED ITEM TASKS MODAL (for icons, reminders, subtasks)
// Shows existing linked tasks as pills and allows adding new tasks
// ============================================================

let currentItemTasksContext = null;

// --- Open the item tasks modal for any item type
export function openItemTasksModal(itemType, itemKey, sectionId, subtitle) {
  currentItemTasksContext = { type: itemType, key: itemKey, sectionId, subtitle };

  let modal = $('#item-tasks-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'item-tasks-modal';
    modal.className = 'item-tasks-modal';
    modal.innerHTML = `
      <div class="item-tasks-backdrop"></div>
      <div class="item-tasks-dialog">
        <div class="item-tasks-header">
          <h4 id="item-tasks-title">Linked Tasks</h4>
          <button type="button" class="item-tasks-close-btn" title="Close">&times;</button>
        </div>
        <div class="item-tasks-content">
          <div id="item-tasks-pills" class="item-tasks-pills"></div>
          <button type="button" id="item-tasks-add-btn" class="btn-add-task">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Task
          </button>
        </div>
        <div class="item-tasks-actions">
          <button type="button" id="item-tasks-close" class="btn-primary">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.item-tasks-backdrop').addEventListener('click', closeItemTasksModal);
    modal.querySelector('.item-tasks-close-btn').addEventListener('click', closeItemTasksModal);
    $('#item-tasks-close').addEventListener('click', closeItemTasksModal);
    $('#item-tasks-add-btn').addEventListener('click', () => {
      if (currentItemTasksContext) {
        openItemTaskPickerModal();
      }
    });
  }

  renderItemTasksPills();
  modal.hidden = false;
}

// --- Render the task pills for the current item
function renderItemTasksPills() {
  const pillsContainer = $('#item-tasks-pills');
  if (!pillsContainer || !currentItemTasksContext) return;

  pillsContainer.innerHTML = '';

  // Query central store for tasks linked to this item
  const linkedTasks = getTasksForItem(
    currentItemTasksContext.type,
    currentItemTasksContext.key,
    currentItemTasksContext.sectionId
  );

  if (linkedTasks.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'item-tasks-empty';
    emptyMsg.textContent = 'No tasks linked to this item';
    pillsContainer.appendChild(emptyMsg);
  } else {
    linkedTasks.forEach(task => {
      const pill = document.createElement('div');
      pill.className = `item-task-pill task-bubble-${task.color}`;
      pill.dataset.taskId = task.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'item-task-pill-title';
      titleSpan.textContent = task.title || 'Untitled Task';
      pill.appendChild(titleSpan);

      const colorLabel = document.createElement('span');
      colorLabel.className = 'item-task-pill-color';
      colorLabel.textContent = COLOR_LABELS[task.color];
      pill.appendChild(colorLabel);

      // Click to edit
      pill.addEventListener('click', () => {
        closeItemTasksModal();
        openEditTaskModal(task.id);
      });

      pillsContainer.appendChild(pill);
    });
  }
}

// --- Close item tasks modal
function closeItemTasksModal() {
  const modal = $('#item-tasks-modal');
  if (modal) modal.hidden = true;
  currentItemTasksContext = null;
}

// --- Refresh the item tasks modal (called after task changes)
export function refreshItemTasksModal() {
  const modal = $('#item-tasks-modal');
  if (modal && !modal.hidden) {
    renderItemTasksPills();
  }
}

// ============================================================
// ITEM TASK PICKER (select an existing task to link to an item)
// Mirrors the @ mention dropdown: tasks grouped by priority color
// ============================================================

const PICKER_COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];

// --- Open the task picker on top of the item tasks modal
function openItemTaskPickerModal() {
  let modal = $('#item-task-picker-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'item-task-picker-modal';
    modal.className = 'item-task-picker-modal';
    modal.innerHTML = `
      <div class="item-task-picker-backdrop"></div>
      <div class="item-task-picker-dialog">
        <div class="item-task-picker-header">
          <h4>Select Task</h4>
          <button type="button" class="item-task-picker-close-btn" title="Close">&times;</button>
        </div>
        <div class="item-task-picker-search">
          <input type="text" id="item-task-picker-search-input" placeholder="Search tasks..." />
        </div>
        <div class="item-task-picker-list" id="item-task-picker-list"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.item-task-picker-backdrop').addEventListener('click', closeItemTaskPickerModal);
    modal.querySelector('.item-task-picker-close-btn').addEventListener('click', closeItemTaskPickerModal);
    $('#item-task-picker-search-input').addEventListener('input', (e) => {
      renderItemTaskPickerList(e.target.value.trim().toLowerCase());
    });
  }

  const searchInput = $('#item-task-picker-search-input');
  searchInput.value = '';
  renderItemTaskPickerList('');

  modal.hidden = false;
  searchInput.focus();
}

// --- Render task pills grouped by priority color (like @ mention dropdown)
function renderItemTaskPickerList(query) {
  const container = $('#item-task-picker-list');
  if (!container || !currentItemTasksContext) return;

  container.innerHTML = '';
  const ctx = currentItemTasksContext;

  // All active tasks not already linked to this item
  const candidates = getAllTasks()
    .filter(t => !t.completed)
    .filter(t => !getLinkedItems(t).some(li => sameItemRef(li, ctx)))
    .filter(t => !query || (t.title || '').toLowerCase().includes(query));

  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item-task-picker-empty';
    empty.textContent = 'No matching tasks';
    container.appendChild(empty);
    return;
  }

  PICKER_COLOR_ORDER.forEach(color => {
    const colorTasks = candidates
      .filter(t => t.color === color)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.order || 0) - (b.order || 0);
      });
    if (colorTasks.length === 0) return;

    const col = document.createElement('div');
    col.className = 'task-mention-col';

    colorTasks.forEach(task => {
      const item = document.createElement('div');
      item.className = `task-mention-item task-bubble-${color}`;
      item.dataset.taskId = task.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'task-mention-item-title';
      titleSpan.textContent = task.title || 'Untitled';
      item.appendChild(titleSpan);

      if (task.pinned) {
        const badge = document.createElement('span');
        badge.className = 'task-mention-primary-badge';
        badge.textContent = 'P';
        item.appendChild(badge);
      }

      item.addEventListener('click', () => linkTaskToCurrentItem(task));
      col.appendChild(item);
    });

    container.appendChild(col);
  });
}

// --- Link an existing task to the current item context
function linkTaskToCurrentItem(task) {
  if (!currentItemTasksContext) return;
  const ref = { ...currentItemTasksContext };

  const items = getLinkedItems(task).map(li => ({ ...li }));
  if (!items.some(li => sameItemRef(li, ref))) items.push(ref);
  task.linkedItems = items;
  task.linkedItem = items[0]; // Legacy compat: first ref

  // Keep item-side taskIds reference in sync (same as createTask)
  const item = findItemByReference(ref);
  if (item) {
    item.taskIds = item.taskIds || [];
    if (!item.taskIds.includes(task.id)) item.taskIds.push(task.id);
  }

  saveModel();
  closeItemTaskPickerModal();
  renderItemTasksPills();
  if (window.renderAllSections) window.renderAllSections();
  showToast('Task linked');
}

// --- Close the task picker
function closeItemTaskPickerModal() {
  const modal = $('#item-task-picker-modal');
  if (modal) modal.hidden = true;
}

// --- Description editor state
let descriptionEditing = false;

// --- Track initial state for unsaved changes detection
let taskEditorInitialState = null;

// --- Open the task editor modal (shared for add/edit)
function openTaskEditorModal(taskData, titleText) {
  let modal = $('#task-editor-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'task-editor-modal';
    modal.className = 'task-editor-modal';
    modal.innerHTML = `
      <div class="task-editor-backdrop"></div>
      <div class="task-editor-dialog">
        <div class="task-editor-header">
          <h4 id="task-editor-title">Add Task</h4>
          <button type="button" class="task-editor-close-btn" title="Close">&times;</button>
        </div>
        <div class="task-editor-body">
          <div class="task-editor-content">
            <div class="task-editor-field">
              <label for="task-editor-name">Task Name</label>
              <input type="text" id="task-editor-name" placeholder="Enter task name..." />
            </div>
            <div class="task-editor-field">
              <label>Priority</label>
              <div class="task-editor-colors" id="task-editor-colors"></div>
              <label class="task-editor-primary-label" id="task-editor-primary-label">
                <input type="checkbox" id="task-editor-primary-checkbox" />
                <span class="task-editor-primary-box"></span>
                <span>Primary</span>
              </label>
            </div>
            <div class="task-editor-field">
              <label for="task-editor-date">Due Date (Optional)</label>
              <input type="date" id="task-editor-date" />
            </div>
            <div class="task-editor-field">
              <label>Links &amp; Files</label>
              <div class="task-editor-links-list" id="task-editor-links-list"></div>
              <button type="button" id="task-editor-links-add" class="task-subtasks-add-btn" title="Add link or file">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div class="task-editor-field" id="task-editor-project-link-field" hidden>
              <label>Linked Project</label>
              <div class="task-editor-project-link" id="task-editor-project-link">
                <label class="task-editor-project-link-check">
                  <input type="checkbox" id="task-editor-project-linked-cb" checked />
                  <span class="task-editor-project-link-box"></span>
                </label>
                <a href="#" class="task-editor-project-link-text" id="task-editor-project-link-text"></a>
              </div>
            </div>
            <div class="task-editor-field">
              <label>Subtasks</label>
              <div class="task-subtasks-list" id="task-subtasks-list"></div>
              <button type="button" id="task-subtasks-add-btn" class="task-subtasks-add-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <div class="task-editor-field">
              <label>Link to Item (Optional)</label>
              <div class="task-editor-item-selector" id="task-editor-item-selector">
                <span class="task-editor-item-text">No item selected</span>
                <button type="button" class="task-editor-item-btn">Select Item</button>
              </div>
              <div class="task-editor-linked-items" id="task-editor-linked-items"></div>
            </div>
          </div>
          <div class="task-editor-description">
            <label>Description</label>
            <div class="task-desc-view" id="task-desc-view">
              <div class="task-desc-view-content" id="task-desc-view-content"></div>
              <div class="task-desc-view-empty">No description</div>
            </div>
            <button type="button" class="task-desc-edit-btn" id="task-desc-edit-btn" title="Edit description">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              Edit
            </button>
            <div class="task-desc-editor-wrap" id="task-desc-editor-wrap" hidden>
              <div class="task-desc-toolbar">
                <button type="button" class="task-desc-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
                <button type="button" class="task-desc-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
                <button type="button" class="task-desc-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                <div class="task-desc-toolbar-divider"></div>
                <button type="button" class="task-desc-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                </button>
                <button type="button" class="task-desc-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
                </button>
                <button type="button" class="task-desc-toolbar-btn checklist-toolbar-btn" title="Checklist">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.5 17 6 18.5 8.5 15.5" stroke-width="1.5"/></svg>
                </button>
              </div>
              <div id="task-desc-editor" class="task-desc-editor" contenteditable="true"></div>
              <div class="task-desc-editor-actions">
                <button type="button" id="task-desc-cancel" class="task-desc-icon-btn" title="Cancel">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button type="button" id="task-desc-save" class="task-desc-icon-btn task-desc-save-btn" title="Save">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="task-editor-actions">
          <div class="task-editor-actions-left">
            <button type="button" id="task-editor-delete" class="task-editor-delete-btn" hidden title="Delete task">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
            </button>
            <button type="button" id="task-editor-complete" class="task-editor-complete-btn" hidden title="Mark as completed">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6L9 17l-5-5"></path>
                  </svg>
            </button>
          </div>
          <div class="task-editor-actions-right">
            <button type="button" id="task-editor-cancel" class="btn-secondary">Cancel</button>
            <button type="button" id="task-editor-save" class="btn-primary">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on backdrop click
    modal.querySelector('.task-editor-backdrop').addEventListener('click', closeTaskEditorModal);
    modal.querySelector('.task-editor-close-btn').addEventListener('click', closeTaskEditorModal);

    // Description toolbar commands
    modal.querySelectorAll('.task-desc-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // Keep focus in editor
      btn.addEventListener('click', () => {
        if (btn.classList.contains('checklist-toolbar-btn')) {
          toggleChecklist();
          updateTaskToolbarState();
          $('#task-desc-editor').focus();
          return;
        }
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateTaskToolbarState();
        $('#task-desc-editor').focus();
      });
    });

    // Highlighter button in task description toolbar
    const taskDescToolbar = modal.querySelector('#task-desc-editor-wrap .task-desc-toolbar');
    if (taskDescToolbar) {
      const hlDiv = document.createElement('div');
      hlDiv.className = 'task-desc-toolbar-divider';
      taskDescToolbar.appendChild(hlDiv);
      taskDescToolbar.appendChild(createHighlighterButton());
    }

    // Markdown auto-convert in description editor (reuse Card Notes handler)
    const descEditor = modal.querySelector('#task-desc-editor');
    attachChecklistHandler(descEditor);
    attachHighlighterContextMenu(descEditor);
    descEditor.addEventListener('input', handleEditorInput);

    // Handle Tab/Shift+Tab for list nesting + toolbar updates on Ctrl+B/I/U
    descEditor.addEventListener('keydown', (e) => {
      handleEditorKeydown(e);
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateTaskToolbarState, 0);
      }
    });

    // Update toolbar on selection change
    document.addEventListener('selectionchange', () => {
      const modal = $('#task-editor-modal');
      if (modal && !modal.hidden) {
        updateTaskToolbarState();
      }
    });

    // Description edit button
    $('#task-desc-edit-btn').addEventListener('click', () => {
      enterDescriptionEditMode();
    });

    // Description save button
    $('#task-desc-save').addEventListener('click', () => {
      saveDescriptionFromEditor();
    });

    // Description cancel button
    $('#task-desc-cancel').addEventListener('click', () => {
      exitDescriptionEditMode();
    });

    // Subtasks add button
    $('#task-subtasks-add-btn').addEventListener('click', () => {
      addSubtaskToEditor();
    });
  }

  // Update title
  $('#task-editor-title').textContent = titleText;

  // Populate name field
  const nameInput = $('#task-editor-name');
  nameInput.value = taskData.title || '';

  // Populate date field
  const dateInput = $('#task-editor-date');
  dateInput.value = taskData.dueDate || '';

  // Populate links & files list
  let editorLinks = [];

  // Migrate old single link to array format
  if (taskData.taskLinks && Array.isArray(taskData.taskLinks)) {
    editorLinks = taskData.taskLinks.map(l => ({ ...l }));
  } else if (taskData.link) {
    editorLinks = [{ type: 'url', value: taskData.link }];
  } else if (taskData.linkType === 'file' && taskData.fileId) {
    editorLinks = [{ type: 'file', fileId: taskData.fileId, fileName: taskData.fileName || '' }];
  }

  function renderEditorLinks() {
    const list = $('#task-editor-links-list');
    if (!list) return;
    list.innerHTML = '';

    editorLinks.forEach((linkItem, idx) => {
      const row = document.createElement('div');
      row.className = 'task-editor-link-row';

      if (linkItem._editing) {
        // Choosing type stage
        if (!linkItem._typeChosen) {
          row.className = 'task-editor-link-row task-editor-link-type-choice';
          const urlBtn = document.createElement('button');
          urlBtn.type = 'button';
          urlBtn.className = 'task-editor-type-btn';
          urlBtn.textContent = 'URL';
          urlBtn.addEventListener('click', () => {
            linkItem._typeChosen = true;
            linkItem.type = 'url';
            renderEditorLinks();
          });
          const fileBtn = document.createElement('button');
          fileBtn.type = 'button';
          fileBtn.className = 'task-editor-type-btn';
          fileBtn.textContent = 'File';
          fileBtn.addEventListener('click', () => {
            linkItem._typeChosen = true;
            linkItem.type = 'file';
            renderEditorLinks();
          });
          row.appendChild(urlBtn);
          row.appendChild(fileBtn);

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'task-editor-link-icon-btn';
          cancelBtn.title = 'Cancel';
          cancelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          cancelBtn.addEventListener('click', () => {
            editorLinks.splice(idx, 1);
            renderEditorLinks();
          });
          row.appendChild(cancelBtn);
        } else if (linkItem.type === 'url') {
          // URL input mode
          const wrap = document.createElement('div');
          wrap.className = 'task-subtask-title-wrap';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'task-subtask-title-input';
          input.placeholder = 'https://example.com';
          input.value = linkItem.value || '';
          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'task-subtask-confirm-btn';
          confirmBtn.title = 'Confirm';
          confirmBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          confirmBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (val) {
              linkItem.value = val;
              delete linkItem._editing;
              delete linkItem._typeChosen;
              renderEditorLinks();
            }
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
          });
          wrap.appendChild(input);
          wrap.appendChild(confirmBtn);
          row.appendChild(wrap);
          setTimeout(() => input.focus(), 0);
        } else if (linkItem.type === 'file') {
          // File upload mode
          const fileRow = document.createElement('div');
          fileRow.className = 'task-editor-file-row';
          const chooseBtn = document.createElement('button');
          chooseBtn.type = 'button';
          chooseBtn.className = 'task-editor-file-btn';
          chooseBtn.textContent = 'Choose File...';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'task-editor-file-name';
          nameSpan.textContent = 'No file selected';
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.hidden = true;
          chooseBtn.addEventListener('click', () => fileInput.click());
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            nameSpan.textContent = 'Uploading...';
            const result = await uploadFile(file, file.name);
            if (result.ok && result.fileId) {
              linkItem.fileId = result.fileId;
              linkItem.fileName = file.name;
              delete linkItem._editing;
              delete linkItem._typeChosen;
              renderEditorLinks();
            } else {
              nameSpan.textContent = 'Upload failed';
              showToast('File upload failed: ' + (result.error || 'Unknown error'));
            }
          });
          fileRow.appendChild(chooseBtn);
          fileRow.appendChild(nameSpan);
          fileRow.appendChild(fileInput);
          row.appendChild(fileRow);

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'task-editor-link-icon-btn';
          cancelBtn.title = 'Cancel';
          cancelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          cancelBtn.addEventListener('click', () => {
            editorLinks.splice(idx, 1);
            renderEditorLinks();
          });
          row.appendChild(cancelBtn);
        }
      } else {
        // Locked/confirmed state
        const wrap = document.createElement('div');
        wrap.className = 'task-subtask-title-wrap';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'task-subtask-title-input locked';
        input.readOnly = true;
        input.value = linkItem.type === 'file' ? (linkItem.fileName || linkItem.fileId) : (linkItem.value || '');
        if (linkItem.type === 'file') {
          input.style.color = 'var(--accent)';
        }
        // Click to copy
        input.addEventListener('click', () => {
          if (linkItem.type === 'url' && linkItem.value) {
            navigator.clipboard.writeText(linkItem.value).then(() => showToast('URL copied'));
          }
        });
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'task-editor-link-inline-btn task-editor-link-edit-btn';
        editBtn.title = 'Edit';
        editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        editBtn.addEventListener('click', () => {
          linkItem._editing = true;
          linkItem._typeChosen = true;
          renderEditorLinks();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'task-editor-link-inline-btn task-editor-link-delete-btn';
        deleteBtn.title = 'Remove';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        deleteBtn.addEventListener('click', () => {
          editorLinks.splice(idx, 1);
          renderEditorLinks();
        });

        wrap.appendChild(input);
        wrap.appendChild(editBtn);
        wrap.appendChild(deleteBtn);
        row.appendChild(wrap);
      }

      list.appendChild(row);
    });
  }

  renderEditorLinks();

  // Add button
  $('#task-editor-links-add').onclick = () => {
    editorLinks.push({ type: 'url', value: '', _editing: true, _typeChosen: false });
    renderEditorLinks();
  };

  // Render color buttons
  const colorsContainer = $('#task-editor-colors');
  colorsContainer.innerHTML = '';
  let selectedColor = taskData.color || 'blue';

  COLOR_CYCLE.forEach(color => {
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = `task-editor-color-btn task-color-btn ${color}${selectedColor === color ? ' active' : ''}`;
    colorBtn.dataset.color = color;
    colorBtn.title = COLOR_LABELS[color];

    colorBtn.addEventListener('click', () => {
      colorsContainer.querySelectorAll('.task-editor-color-btn').forEach(btn => btn.classList.remove('active'));
      colorBtn.classList.add('active');
      selectedColor = color;
    });

    colorsContainer.appendChild(colorBtn);
  });

  // Primary checkbox
  const primaryCheckbox = $('#task-editor-primary-checkbox');
  primaryCheckbox.checked = !!taskData.pinned;

  // Populate description - auto-enter edit mode if empty
  descriptionEditing = false;
  const descViewContent = $('#task-desc-view-content');
  const descView = $('#task-desc-view');
  const descEditBtn = $('#task-desc-edit-btn');
  const descEditorWrap = $('#task-desc-editor-wrap');
  const hasDescription = normalizeDescHtml(taskData.description || '');
  descViewContent.innerHTML = taskData.description || '';

  if (hasDescription) {
    // Has content: show view mode
    descView.hidden = false;
    descEditBtn.hidden = false;
    descEditorWrap.hidden = true;
  } else {
    // Empty: start in edit mode directly
    descView.hidden = true;
    descEditBtn.hidden = true;
    descEditorWrap.hidden = false;
    descriptionEditing = true;
    const editor = $('#task-desc-editor');
    editor.innerHTML = '';
    // Focus after modal is visible
    requestAnimationFrame(() => editor.focus());
  }

  // Linked items (multi) - seeded from task, committed on save
  const itemSelector = $('#task-editor-item-selector');
  const itemText = itemSelector.querySelector('.task-editor-item-text');
  const itemBtn = itemSelector.querySelector('.task-editor-item-btn');
  const linkedItemsContainer = $('#task-editor-linked-items');
  let selectedLinkedItems = getLinkedItems(taskData).map(li => ({ ...li }));

  const renderLinkedItems = () => {
    renderEditorLinkedItems(linkedItemsContainer, itemText, selectedLinkedItems, (index) => {
      selectedLinkedItems.splice(index, 1);
      renderLinkedItems();
    });
  };
  renderLinkedItems();

  itemBtn.onclick = () => {
    openItemSelectorModal((item) => {
      if (!item) {
        selectedLinkedItems = [];
      } else if (!selectedLinkedItems.some(li => sameItemRef(li, item))) {
        selectedLinkedItems.push(item);
      }
      renderLinkedItems();
    });
  };

  // Project link field - show if task has a project highlight
  const projectLinkField = $('#task-editor-project-link-field');
  const projectLinkText = $('#task-editor-project-link-text');
  const projectLinkedCb = $('#task-editor-project-linked-cb');

  if (taskData.projectHighlight && taskData.projectHighlight.projectId) {
    const projectId = taskData.projectHighlight.projectId;
    // Find project title
    const data = currentData();
    const projects = data.projects || [];
    const project = projects.find(p => p.id === projectId);
    const projectTitle = project ? project.title : 'Unknown Project';

    projectLinkField.hidden = false;
    projectLinkText.textContent = projectTitle;
    projectLinkedCb.checked = true;

    // Click link to open project
    projectLinkText.onclick = (e) => {
      e.preventDefault();
      if (window.openProjectsModal) {
        closeTaskEditorModal(true);
        window.openProjectsModal(projectId);
      }
    };

    // Uncheck to unlink
    projectLinkedCb.onchange = () => {
      if (!projectLinkedCb.checked) {
        if (confirm('Unlink this task from its project? The highlighted text will revert to plain text.')) {
          // Remove highlight from project
          if (window.removeProjectTaskHighlight) {
            window.removeProjectTaskHighlight(projectId, taskData.id);
          }
          // Remove projectHighlight from task
          if (currentEditingTaskId) {
            const task = getTaskById(currentEditingTaskId);
            if (task) {
              delete task.projectHighlight;
              saveModel();
            }
          }
          projectLinkField.hidden = true;
          showToast('Task unlinked from project');
        } else {
          projectLinkedCb.checked = true;
        }
      }
    };
  } else if (taskData.meetingHighlight && taskData.meetingHighlight.meetingId) {
    const meetingId = taskData.meetingHighlight.meetingId;
    const data = currentData();
    const meetings = data.meetings || [];
    const meeting = meetings.find(m => m.id === meetingId);
    const meetingTitle = meeting ? (meeting.title || 'Untitled Meeting') : 'Unknown Meeting';

    projectLinkField.hidden = false;
    projectLinkField.querySelector('label').textContent = 'Linked Meeting';
    projectLinkText.textContent = meetingTitle;
    projectLinkedCb.checked = true;

    projectLinkText.onclick = (e) => {
      e.preventDefault();
      if (window.openMeetingsModal) {
        closeTaskEditorModal(true);
        window.openMeetingsModal();
      }
    };

    projectLinkedCb.onchange = () => {
      if (!projectLinkedCb.checked) {
        if (confirm('Unlink this task from its meeting? The highlighted text will revert to plain text.')) {
          if (window.removeMeetingTaskHighlight) {
            window.removeMeetingTaskHighlight(meetingId, taskData.id);
          }
          if (currentEditingTaskId) {
            const task = getTaskById(currentEditingTaskId);
            if (task) {
              delete task.meetingHighlight;
              saveModel();
            }
          }
          projectLinkField.hidden = true;
          showToast('Task unlinked from meeting');
        } else {
          projectLinkedCb.checked = true;
        }
      }
    };
  } else {
    projectLinkField.hidden = true;
  }

  // Populate subtasks
  editorSubtasks = (taskData.subtasks || []).map(s => ({ ...s }));
  renderEditorSubtasks();

  // Wire up buttons
  const cancelBtn = $('#task-editor-cancel');
  cancelBtn.onclick = closeTaskEditorModal;

  const saveBtn = $('#task-editor-save');
  saveBtn.onclick = async () => {
    const title = nameInput.value.trim();
    if (!title) {
      showToast('Please enter a task name');
      nameInput.focus();
      return;
    }

    // Collect confirmed links (filter out editing/empty ones)
    const taskLinks = editorLinks
      .filter(l => !l._editing)
      .filter(l => (l.type === 'url' && l.value) || (l.type === 'file' && l.fileId))
      .map(l => {
        if (l.type === 'file') return { type: 'file', fileId: l.fileId, fileName: l.fileName || '' };
        return { type: 'url', value: l.value };
      });

    // Keep backward compat: set legacy `link` field from first URL link
    const firstUrl = taskLinks.find(l => l.type === 'url');
    const link = firstUrl ? firstUrl.value : null;

    const dueDate = dateInput.value || null;

    // Get description - from editor if editing, from view if not
    const rawDesc = descriptionEditing
      ? $('#task-desc-editor').innerHTML
      : $('#task-desc-view-content').innerHTML;
    const descContent = normalizeDescHtml(rawDesc);
    const description = descContent || null;

    // Clean up subtasks (remove empty titles)
    const subtasks = editorSubtasks.filter(s => s.title && s.title.trim());

    // Linked items (legacy `linkedItem` mirrors the first ref)
    const linkedItems = selectedLinkedItems.map(li => ({ ...li }));

    if (currentEditingTaskId) {
      // Update existing task
      const taskUpdate = {
        title,
        color: selectedColor,
        linkedItem: linkedItems[0] || null,
        linkedItems: linkedItems.length > 0 ? linkedItems : null,
        link: link,
        taskLinks: taskLinks.length > 0 ? taskLinks : null,
        dueDate: dueDate,
        description: description,
        subtasks: subtasks.length > 0 ? subtasks : null,
        pinned: primaryCheckbox.checked
      };
      updateTask(currentEditingTaskId, taskUpdate);
      showToast('Task updated');
    } else {
      // Create new task
      const task = createTask(title, selectedColor, linkedItems[0] || null, link);
      const updates = { pinned: primaryCheckbox.checked };
      if (linkedItems.length > 0) updates.linkedItems = linkedItems;
      if (dueDate) updates.dueDate = dueDate;
      if (description) updates.description = description;
      if (subtasks.length > 0) updates.subtasks = subtasks;
      if (taskLinks.length > 0) updates.taskLinks = taskLinks;
      updateTask(task.id, updates);
      showToast('Task created');

      // Fire callback for Projects module (two-way task linking)
      if (taskCreationCallback) {
        taskCreationCallback(task);
        taskCreationCallback = null;
      }
    }

    closeTaskEditorModal(true);
    renderEisenhowerMatrix();
    // Refresh main view to update task indicators
    if (window.renderAllSections) window.renderAllSections();
  };

  // Delete button (show only when editing existing task)
  const deleteBtn = $('#task-editor-delete');
  if (deleteBtn) {
    deleteBtn.hidden = !currentEditingTaskId;
    deleteBtn.onclick = () => {
      if (confirm('Are you sure you want to delete this task?')) {
        deleteTask(currentEditingTaskId);
        showToast('Task deleted');
        closeTaskEditorModal(true);
        renderEisenhowerMatrix();
        if (window.renderAllSections) window.renderAllSections();
      }
    };
  }

  // Complete button (show only when editing existing task)
  const completeBtn = $('#task-editor-complete');
  if (completeBtn) {
    completeBtn.hidden = !currentEditingTaskId;
    completeBtn.onclick = () => {
      completeTask(currentEditingTaskId);
      showToast('Task completed');
      closeTaskEditorModal(true);
      renderEisenhowerMatrix();
      if (window.renderAllSections) window.renderAllSections();
      if (window.refreshProjectHighlights) window.refreshProjectHighlights();
    };
  }

  modal.hidden = false;
  nameInput.focus();

  // Capture initial state for unsaved changes detection
  taskEditorInitialState = {
    title: taskData.title || '',
    color: taskData.color || 'blue',
    link: taskData.link || '',
    pinned: !!taskData.pinned,
    description: taskData.description || '',
    subtasks: JSON.stringify(taskData.subtasks || [])
  };
}

// --- Check if task editor has unsaved changes
function taskEditorHasChanges() {
  if (!taskEditorInitialState) return false;
  const nameInput = $('#task-editor-name');
  const linkInput = $('#task-editor-link');
  const primaryCheckbox = $('#task-editor-primary-checkbox');
  const colorsContainer = $('#task-editor-colors');
  const activeColor = colorsContainer?.querySelector('.task-editor-color-btn.active');
  const rawDesc = descriptionEditing
    ? ($('#task-desc-editor')?.innerHTML || '')
    : ($('#task-desc-view-content')?.innerHTML || '');
  const desc = normalizeDescHtml(rawDesc) || '';

  if ((nameInput?.value || '') !== taskEditorInitialState.title) return true;
  if ((linkInput?.value || '') !== taskEditorInitialState.link) return true;
  if ((activeColor?.dataset.color || 'blue') !== taskEditorInitialState.color) return true;
  if ((primaryCheckbox?.checked || false) !== taskEditorInitialState.pinned) return true;
  if (desc !== taskEditorInitialState.description) return true;
  if (JSON.stringify(editorSubtasks.filter(s => s.title && s.title.trim())) !== taskEditorInitialState.subtasks) return true;
  return false;
}

// --- Render linked item minis in the task editor
// Display order: reminders, subtasks, copy-paste, icons
const LINKED_ITEM_TYPE_ORDER = ['reminder', 'subtask', 'copyPaste', 'icon'];

function renderEditorLinkedItems(container, textEl, refs, onRemove) {
  if (textEl) {
    if (refs.length === 0) {
      textEl.textContent = 'No item selected';
      textEl.classList.remove('has-item');
    } else {
      textEl.textContent = `${refs.length} item${refs.length !== 1 ? 's' : ''} linked`;
      textEl.classList.add('has-item');
    }
  }

  if (!container) return;
  container.innerHTML = '';

  refs
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => LINKED_ITEM_TYPE_ORDER.indexOf(a.ref.type) - LINKED_ITEM_TYPE_ORDER.indexOf(b.ref.type))
    .forEach(({ ref, index }) => {
      container.appendChild(buildLinkedItemMini(ref, () => onRemove(index)));
    });
}

// --- Open the link/file an item points to
function openLinkedItemTarget(item) {
  if (item.linkType === 'file' && item.fileId) {
    openFile(item.fileId, item.fileName);
  } else if (item.url) {
    openUrl(item.url);
  }
}

// --- Build the mini days/interval badge for a reminder (compact version of the card badge)
function buildMiniReminderBadge(rem) {
  const badge = document.createElement('span');
  badge.className = 'days-badge';

  if (rem.type === 'interval') {
    if (window.calculateIntervalProgress && window.formatIntervalNumber && window.getIntervalColorClass) {
      const progress = window.calculateIntervalProgress(rem);
      const formattedNumber = window.formatIntervalNumber(progress.progress, rem.intervalUnit || 'none');
      const typeText = (rem.intervalType || 'limit') === 'goal' ? 'Before goal' : 'Before limit';
      badge.textContent = `${typeText}: ${formattedNumber}`;
      badge.classList.add(window.getIntervalColorClass(progress.percentage, rem.intervalType || 'limit'));
      return badge;
    }
  } else if (rem.schedule && window.getNextOccurrence && window.daysUntil && window.classForDaysLeft) {
    try {
      const nextDate = window.getNextOccurrence(rem.schedule);
      const days = window.daysUntil(nextDate);
      if (days === 0) {
        badge.textContent = 'Today';
      } else if (days < 0) {
        badge.textContent = `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`;
      } else {
        badge.textContent = `${days} day${days !== 1 ? 's' : ''} left`;
      }
      badge.classList.add(window.classForDaysLeft(days));
      return badge;
    } catch (e) { /* no badge */ }
  }
  return null;
}

// --- Build a functional miniature of a linked item
function buildLinkedItemMini(ref, onRemove) {
  const item = findItemByReference(ref);
  const wrap = document.createElement('div');
  wrap.className = `task-linked-mini task-linked-mini-${ref.type}`;

  if (!item) {
    wrap.classList.add('task-linked-mini-missing');
    const title = document.createElement('span');
    title.className = 'task-linked-mini-title';
    title.textContent = '(deleted item)';
    wrap.appendChild(title);
  } else if (ref.type === 'reminder') {
    const title = document.createElement('span');
    title.className = 'task-linked-mini-title';
    title.textContent = item.title || 'Reminder';
    wrap.appendChild(title);
    const badge = buildMiniReminderBadge(item);
    if (badge) wrap.appendChild(badge);
    wrap.title = item.title || 'Reminder';
    wrap.addEventListener('click', () => openLinkedItemTarget(item));
  } else if (ref.type === 'subtask') {
    const title = document.createElement('span');
    title.className = 'task-linked-mini-title task-linked-mini-link';
    title.textContent = item.text || 'Link';
    wrap.appendChild(title);
    wrap.title = item.text || 'Link';
    wrap.addEventListener('click', () => openLinkedItemTarget(item));
  } else if (ref.type === 'copyPaste') {
    const title = document.createElement('span');
    title.className = 'task-linked-mini-title';
    title.textContent = item.text || '';
    wrap.appendChild(title);
    const copyIcon = document.createElement('span');
    copyIcon.className = 'task-linked-mini-copy';
    copyIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    wrap.appendChild(copyIcon);
    wrap.title = 'Copy to clipboard';
    wrap.addEventListener('click', () => {
      navigator.clipboard.writeText(item.copyText || item.text || '');
      showToast('Copied to clipboard');
    });
  } else if (ref.type === 'icon') {
    const visual = document.createElement('span');
    visual.className = 'task-linked-mini-icon-visual';
    if (item.icon && typeof item.icon === 'string' && !item.icon.includes('/') && !item.icon.includes('.') && !item.icon.startsWith('http') && !item.icon.startsWith('data:') && item.icon.length <= 10) {
      visual.textContent = item.icon; // Emoji icon
    } else {
      const img = document.createElement('img');
      setImageFromRef(img, item.icon);
      img.alt = item.title || item.key || 'Icon';
      visual.appendChild(img);
    }
    wrap.appendChild(visual);
    const title = document.createElement('span');
    title.className = 'task-linked-mini-title';
    title.textContent = item.title || extractDomainFromUrl(item.url) || 'Icon';
    wrap.appendChild(title);
    wrap.title = title.textContent;
    wrap.addEventListener('click', () => openLinkedItemTarget(item));
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'task-linked-mini-remove';
  removeBtn.title = 'Unlink item';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRemove();
  });
  wrap.appendChild(removeBtn);

  return wrap;
}

// --- Normalize contenteditable HTML (strip lone <br>, whitespace-only)

// --- Description editor helpers
function enterDescriptionEditMode() {
  descriptionEditing = true;
  const viewContent = $('#task-desc-view-content');
  const editor = $('#task-desc-editor');
  const descView = $('#task-desc-view');
  const descEditBtn = $('#task-desc-edit-btn');
  const descEditorWrap = $('#task-desc-editor-wrap');

  // Copy current content to editor
  editor.innerHTML = viewContent.innerHTML || '';
  descView.hidden = true;
  descEditBtn.hidden = true;
  descEditorWrap.hidden = false;
  editor.focus();
}

function saveDescriptionFromEditor() {
  const editor = $('#task-desc-editor');
  const viewContent = $('#task-desc-view-content');
  const descView = $('#task-desc-view');
  const descEditBtn = $('#task-desc-edit-btn');
  const descEditorWrap = $('#task-desc-editor-wrap');

  // Save editor content to view (normalize empty contenteditable output)
  viewContent.innerHTML = normalizeDescHtml(editor.innerHTML);
  descriptionEditing = false;
  descView.hidden = false;
  descEditBtn.hidden = false;
  descEditorWrap.hidden = true;
}

function exitDescriptionEditMode() {
  descriptionEditing = false;
  const descView = $('#task-desc-view');
  const descEditBtn = $('#task-desc-edit-btn');
  const descEditorWrap = $('#task-desc-editor-wrap');

  descView.hidden = false;
  descEditBtn.hidden = false;
  descEditorWrap.hidden = true;
}

// ============================================================
// SUBTASK EDITOR (within task editor modal)
// ============================================================

// Editor-local subtask list (committed on save)
let editorSubtasks = [];

function generateSubtaskId() {
  return 'subtask-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function addSubtaskToEditor() {
  editorSubtasks.push({ id: generateSubtaskId(), title: '', description: '', completed: false, important: false });
  renderEditorSubtasks();
  // Focus the new input
  const inputs = document.querySelectorAll('#task-subtasks-list .task-subtask-title-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function sortEditorSubtasks() {
  // Sort: completed first, then important, then regular
  editorSubtasks.sort((a, b) => {
    if (a.completed && !b.completed) return -1;
    if (!a.completed && b.completed) return 1;
    if (a.important && !b.important) return -1;
    if (!a.important && b.important) return 1;
    return 0;
  });
}

function renderEditorSubtasks() {
  const list = $('#task-subtasks-list');
  if (!list) return;
  list.innerHTML = '';

  // Sort before rendering
  sortEditorSubtasks();

  editorSubtasks.forEach((subtask, index) => {
    const row = document.createElement('div');
    row.className = 'task-subtask-row';

    const isNew = !subtask.title;
    const isLocked = !isNew;

    // When locked, add glass-effect bubble class to the row
    if (isLocked) {
      row.classList.add('subtask-bubble');
      if (subtask.completed) row.classList.add('subtask-bubble-completed');
      if (subtask.important) row.classList.add('subtask-bubble-important');
    }

    const titleWrap = document.createElement('div');
    titleWrap.className = 'task-subtask-title-wrap';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'task-subtask-title-input';
    titleInput.placeholder = 'Subtask title';
    titleInput.value = subtask.title || '';
    titleInput.readOnly = isLocked;
    if (isLocked) titleInput.classList.add('locked');
    if (subtask.completed) titleInput.classList.add('subtask-completed');

    titleInput.addEventListener('input', (e) => {
      subtask.title = e.target.value;
    });

    // Confirm button (green check) — inside the input wrapper
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'task-subtask-confirm-btn';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
    if (isLocked) confirmBtn.hidden = true;

    titleWrap.appendChild(titleInput);
    titleWrap.appendChild(confirmBtn);

    // --- Action buttons container (only visible when locked) ---
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'task-subtask-actions';
    if (!isLocked) actionsWrap.style.display = 'none';

    // Complete toggle button
    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = 'task-subtask-complete-btn' + (subtask.completed ? ' is-completed' : '');
    completeBtn.title = subtask.completed ? 'Mark incomplete' : 'Mark complete';
    completeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
    completeBtn.addEventListener('click', () => {
      subtask.completed = !subtask.completed;
      if (subtask.completed) {
        subtask.important = false;
        subtask.dueDate = null;
      }
      if (currentEditingTaskId) {
        const cleanSubtasks = editorSubtasks.filter(s => s.title && s.title.trim());
        updateTask(currentEditingTaskId, { subtasks: cleanSubtasks.length > 0 ? cleanSubtasks : null });
      }
      renderEditorSubtasks();
    });

    // 3-dot menu button
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'task-subtask-menu-btn';
    menuBtn.title = 'More options';
    menuBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <circle cx="12" cy="5" r="2"></circle>
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="12" cy="19" r="2"></circle>
      </svg>`;

    // Dropdown menu
    const menuDropdown = document.createElement('div');
    menuDropdown.className = 'task-subtask-menu-dropdown';
    menuDropdown.style.display = 'none';

    const hasDesc = normalizeDescHtml(subtask.description || '');
    if (hasDesc) menuBtn.classList.add('has-desc');

    const closeDropdown = () => {
      menuDropdown.style.display = 'none';
      row.classList.remove('menu-open');
    };

    const descOption = document.createElement('button');
    descOption.type = 'button';
    descOption.className = 'task-subtask-menu-item';
    descOption.textContent = hasDesc ? 'View description' : 'Add description';
    descOption.addEventListener('click', () => {
      closeDropdown();
      openSubtaskDescriptionModal(subtask);
    });

    const importantOption = document.createElement('button');
    importantOption.type = 'button';
    importantOption.className = 'task-subtask-menu-item';
    importantOption.textContent = subtask.important ? 'Remove importance' : 'Mark as important';
    importantOption.addEventListener('click', () => {
      closeDropdown();
      subtask.important = !subtask.important;
      if (subtask.important) subtask.completed = false;
      if (currentEditingTaskId) {
        const cleanSubtasks = editorSubtasks.filter(s => s.title && s.title.trim());
        updateTask(currentEditingTaskId, { subtasks: cleanSubtasks.length > 0 ? cleanSubtasks : null });
      }
      renderEditorSubtasks();
    });

    const deleteOption = document.createElement('button');
    deleteOption.type = 'button';
    deleteOption.className = 'task-subtask-menu-item task-subtask-menu-item-danger';
    deleteOption.textContent = 'Remove subtask';
    deleteOption.addEventListener('click', () => {
      closeDropdown();
      if (!confirm('Delete this subtask?')) return;
      editorSubtasks.splice(index, 1);
      renderEditorSubtasks();
    });

    menuDropdown.appendChild(descOption);
    menuDropdown.appendChild(importantOption);
    menuDropdown.appendChild(deleteOption);

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open menus
      document.querySelectorAll('.task-subtask-menu-dropdown').forEach(d => {
        if (d !== menuDropdown) {
          d.style.display = 'none';
          const otherRow = d.closest('.task-subtask-row');
          if (otherRow) otherRow.classList.remove('menu-open');
        }
      });
      const isOpen = menuDropdown.style.display !== 'none';
      if (isOpen) {
        closeDropdown();
      } else {
        // Position fixed relative to viewport to escape overflow clipping
        const btnRect = menuBtn.getBoundingClientRect();
        menuDropdown.style.display = '';
        row.classList.add('menu-open');
        menuDropdown.style.position = 'fixed';
        menuDropdown.style.top = (btnRect.bottom + 4) + 'px';
        menuDropdown.style.right = (window.innerWidth - btnRect.right) + 'px';
        menuDropdown.style.left = 'auto';
        // If it would overflow bottom, show above instead
        const dropRect = menuDropdown.getBoundingClientRect();
        if (dropRect.bottom > window.innerHeight - 8) {
          menuDropdown.style.top = (btnRect.top - dropRect.height - 4) + 'px';
        }
      }
    });

    // Close menu on outside click or scroll
    const closeMenu = (e) => {
      if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('click', closeMenu);
    const scrollParent = document.querySelector('.task-editor-content');
    if (scrollParent) {
      scrollParent.addEventListener('scroll', () => {
        closeDropdown();
      }, { passive: true });
    }

    const menuWrap = document.createElement('div');
    menuWrap.className = 'task-subtask-menu-wrap';
    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menuDropdown);

    // Subtask date picker button
    const subtaskDateBtn = document.createElement('button');
    subtaskDateBtn.type = 'button';
    subtaskDateBtn.className = 'task-subtask-date-btn' + (subtask.dueDate ? ' has-date' : '');
    subtaskDateBtn.title = subtask.dueDate ? `Due: ${subtask.dueDate}` : 'Set due date';
    subtaskDateBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>`;

    // Hidden date input for native picker
    const subtaskDateInput = document.createElement('input');
    subtaskDateInput.type = 'date';
    subtaskDateInput.className = 'task-subtask-date-input';
    subtaskDateInput.value = subtask.dueDate || '';
    subtaskDateInput.addEventListener('change', () => {
      subtask.dueDate = subtaskDateInput.value || null;
      subtaskDateBtn.classList.toggle('has-date', !!subtask.dueDate);
      subtaskDateBtn.title = subtask.dueDate ? `Due: ${subtask.dueDate}` : 'Set due date';
      if (currentEditingTaskId) {
        const cleanSubtasks = editorSubtasks.filter(s => s.title && s.title.trim());
        updateTask(currentEditingTaskId, { subtasks: cleanSubtasks.length > 0 ? cleanSubtasks : null });
      }
    });
    subtaskDateBtn.addEventListener('click', () => subtaskDateInput.showPicker());

    const subtaskDateWrap = document.createElement('div');
    subtaskDateWrap.className = 'task-subtask-date-wrap';
    subtaskDateWrap.appendChild(subtaskDateBtn);
    subtaskDateWrap.appendChild(subtaskDateInput);

    actionsWrap.appendChild(completeBtn);
    actionsWrap.appendChild(subtaskDateWrap);
    actionsWrap.appendChild(menuWrap);

    // Click input to enter edit mode
    titleInput.addEventListener('click', () => {
      if (titleInput.readOnly) {
        titleInput.readOnly = false;
        titleInput.classList.remove('locked');
        confirmBtn.hidden = false;
        actionsWrap.style.display = 'none';
        row.classList.remove('subtask-bubble', 'subtask-bubble-completed', 'subtask-bubble-important');
        titleInput.focus();
      }
    });

    // Confirm locks it back
    confirmBtn.addEventListener('click', () => {
      titleInput.readOnly = true;
      titleInput.classList.add('locked');
      confirmBtn.hidden = true;
      if (subtask.title) {
        actionsWrap.style.display = '';
        row.classList.add('subtask-bubble');
        if (subtask.completed) row.classList.add('subtask-bubble-completed');
        if (subtask.important) row.classList.add('subtask-bubble-important');
      }
    });

    row.appendChild(titleWrap);
    row.appendChild(actionsWrap);
    list.appendChild(row);
  });
}

// --- Subtask description modal (separate overlay on top of task editor)
function openSubtaskDescriptionModal(subtask) {
  let modal = $('#subtask-desc-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'subtask-desc-modal';
    modal.className = 'subtask-desc-modal';
    modal.innerHTML = `
      <div class="subtask-desc-backdrop"></div>
      <div class="subtask-desc-dialog">
        <div class="subtask-desc-header">
          <h4 id="subtask-desc-title">Subtask Description</h4>
          <button type="button" class="subtask-desc-close-btn" title="Close">&times;</button>
        </div>
        <div class="subtask-desc-body">
          <div class="task-desc-toolbar">
            <button type="button" class="subtask-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="subtask-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="subtask-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
            <div class="task-desc-toolbar-divider"></div>
            <button type="button" class="subtask-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
            </button>
            <button type="button" class="subtask-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
            </button>
            <button type="button" class="subtask-toolbar-btn checklist-toolbar-btn" title="Checklist">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.5 17 6 18.5 8.5 15.5" stroke-width="1.5"/></svg>
            </button>
          </div>
          <div id="subtask-desc-editor" class="task-desc-editor" contenteditable="true"></div>
        </div>
        <div class="subtask-desc-actions">
          <button type="button" id="subtask-desc-delete" class="btn-secondary subtask-desc-delete-btn">Delete</button>
          <button type="button" id="subtask-desc-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="subtask-desc-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.subtask-desc-backdrop').addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.querySelector('.subtask-desc-close-btn').addEventListener('click', () => {
      modal.hidden = true;
    });

    // Toolbar commands
    modal.querySelectorAll('.subtask-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        if (btn.classList.contains('checklist-toolbar-btn')) {
          toggleChecklist();
          updateSubtaskToolbarState();
          $('#subtask-desc-editor').focus();
          return;
        }
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateSubtaskToolbarState();
        $('#subtask-desc-editor').focus();
      });
    });

    // Highlighter button in subtask description toolbar
    const subtaskToolbar = modal.querySelector('.subtask-desc-body .task-desc-toolbar');
    if (subtaskToolbar) {
      const hlDiv = document.createElement('div');
      hlDiv.className = 'task-desc-toolbar-divider';
      subtaskToolbar.appendChild(hlDiv);
      subtaskToolbar.appendChild(createHighlighterButton());
    }

    // Markdown auto-convert
    const editorEl = modal.querySelector('#subtask-desc-editor');
    attachChecklistHandler(editorEl);
    attachHighlighterContextMenu(editorEl);
    editorEl.addEventListener('input', handleEditorInput);

    editorEl.addEventListener('keydown', (e) => {
      handleEditorKeydown(e);
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateSubtaskToolbarState, 0);
      }
    });

    document.addEventListener('selectionchange', () => {
      const m = $('#subtask-desc-modal');
      if (m && !m.hidden) {
        updateSubtaskToolbarState();
      }
    });
  }

  // Set title
  $('#subtask-desc-title').textContent = subtask.title ? `Subtask: ${subtask.title}` : 'Subtask Description';

  // Populate editor
  const editor = $('#subtask-desc-editor');
  editor.innerHTML = subtask.description || '';
  modal.hidden = false;
  requestAnimationFrame(() => editor.focus());

  // Persist subtasks to the task when editing an existing task
  const persistSubtasks = () => {
    if (currentEditingTaskId) {
      const cleanSubtasks = editorSubtasks.filter(s => s.title && s.title.trim());
      updateTask(currentEditingTaskId, { subtasks: cleanSubtasks.length > 0 ? cleanSubtasks : null });
    }
  };

  // Delete button only shown when a description exists
  const deleteBtn = $('#subtask-desc-delete');
  deleteBtn.hidden = !normalizeDescHtml(subtask.description || '');

  // Wire save/cancel/delete
  $('#subtask-desc-cancel').onclick = () => { modal.hidden = true; };
  $('#subtask-desc-save').onclick = () => {
    subtask.description = normalizeDescHtml(editor.innerHTML) || '';
    persistSubtasks();
    modal.hidden = true;
    renderEditorSubtasks(); // Update indicator
  };
  deleteBtn.onclick = () => {
    if (!confirm('Delete this description?')) return;
    subtask.description = '';
    persistSubtasks();
    modal.hidden = true;
    renderEditorSubtasks();
  };
}

function updateSubtaskToolbarState() {
  const modal = $('#subtask-desc-modal');
  if (!modal) return;
  const inChecklist = isInChecklist();
  modal.querySelectorAll('.subtask-toolbar-btn').forEach(btn => {
    if (btn.classList.contains('checklist-toolbar-btn')) {
      btn.classList.toggle('active', inChecklist);
      return;
    }
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd) && !(cmd === 'insertUnorderedList' && inChecklist));
    }
  });
}

// --- Close task editor modal
function updateTaskToolbarState() {
  const inChecklist = isInChecklist();
  const btns = document.querySelectorAll('.task-desc-toolbar-btn');
  btns.forEach(btn => {
    if (btn.classList.contains('checklist-toolbar-btn')) {
      btn.classList.toggle('active', inChecklist);
      return;
    }
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd) && !(cmd === 'insertUnorderedList' && inChecklist));
    }
  });
}

function closeTaskEditorModal(force) {
  if (!force && taskEditorHasChanges()) {
    if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
      return;
    }
  }
  const modal = $('#task-editor-modal');
  if (modal) {
    modal.hidden = true;
  }
  // Also close subtask description modal if open
  const subtaskModal = $('#subtask-desc-modal');
  if (subtaskModal) subtaskModal.hidden = true;

  currentEditingTaskId = null;
  preLinkedItemContext = null;
  descriptionEditing = false;
  editorSubtasks = [];
  taskEditorInitialState = null;
  taskCreationCallback = null;
  window._projectTaskPending = null;
}

// ============================================================
// IDEAS MODAL - Quick idea capture with title + description
// ============================================================

let ideasEditingId = null;

// Get all ideas from model
function getAllIdeas() {
  const data = currentData();
  return data.ideas || [];
}

// Create a new idea
function createIdea(title, description) {
  const data = currentData();
  data.ideas = data.ideas || [];
  const idea = {
    id: 'idea-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    title: title || '',
    description: description || ''
  };
  data.ideas.push(idea);
  saveModel();
  return idea;
}

// Update an idea
function updateIdea(ideaId, updates) {
  const ideas = getAllIdeas();
  const idea = ideas.find(i => i.id === ideaId);
  if (!idea) return null;
  Object.assign(idea, updates);
  saveModel();
  return idea;
}

// Delete an idea
function deleteIdea(ideaId) {
  const data = currentData();
  const ideas = data.ideas || [];
  const idx = ideas.findIndex(i => i.id === ideaId);
  if (idx === -1) return false;
  ideas.splice(idx, 1);
  saveModel();
  return true;
}

// Update toolbar active states for ideas editor
function updateIdeasToolbarState() {
  const modal = $('#ideas-modal');
  if (!modal || modal.hidden) return;
  const inChecklist = isInChecklist();
  modal.querySelectorAll('.ideas-toolbar-btn').forEach(btn => {
    if (btn.classList.contains('checklist-toolbar-btn')) {
      btn.classList.toggle('active', inChecklist);
      return;
    }
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd) && !(cmd === 'insertUnorderedList' && inChecklist));
    }
  });
}

export function openIdeasModal() {
  let modal = $('#ideas-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ideas-modal';
    modal.className = 'ideas-modal';
    modal.innerHTML = `
      <div class="ideas-backdrop"></div>
      <div class="ideas-dialog">
        <div class="ideas-header">
          <h4 id="ideas-title">Ideas</h4>
          <button type="button" class="ideas-close-btn" title="Close">&times;</button>
        </div>
        <div class="ideas-items" id="ideas-items"></div>
        <div class="ideas-editor-section" id="ideas-editor-section">
          <div class="ideas-editor-field">
            <input type="text" id="ideas-title-input" class="ideas-title-input" placeholder="Idea title..." />
          </div>
          <div class="ideas-editor-toolbar">
            <button type="button" class="ideas-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="ideas-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="ideas-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
            <div class="task-desc-toolbar-divider"></div>
            <button type="button" class="ideas-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
            </button>
            <button type="button" class="ideas-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
            </button>
            <button type="button" class="ideas-toolbar-btn checklist-toolbar-btn" title="Checklist">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.5 17 6 18.5 8.5 15.5" stroke-width="1.5"/></svg>
            </button>
          </div>
          <div id="ideas-editor" class="ideas-editor" contenteditable="true"></div>
          <div class="ideas-editor-actions">
            <div class="ideas-editor-actions-right">
              <button type="button" id="ideas-save-btn" class="btn-primary">Save</button>
            </div>
          </div>
        </div>
        <div class="ideas-view-section" id="ideas-view-section" hidden>
          <h3 class="ideas-view-title" id="ideas-view-title"></h3>
          <div class="ideas-view-content" id="ideas-view-content"></div>
          <div class="ideas-view-actions">
            <button type="button" id="ideas-view-edit" class="ideas-view-icon-btn" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button type="button" id="ideas-view-copy" class="ideas-view-icon-btn" title="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button type="button" id="ideas-view-delete" class="ideas-view-icon-btn ideas-view-icon-danger" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button type="button" id="ideas-view-close" class="ideas-view-icon-btn" title="Close">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.ideas-backdrop').addEventListener('click', closeIdeasModal);
    modal.querySelector('.ideas-close-btn').addEventListener('click', closeIdeasModal);

    // Toolbar commands
    modal.querySelectorAll('.ideas-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        if (btn.classList.contains('checklist-toolbar-btn')) {
          toggleChecklist();
          updateIdeasToolbarState();
          $('#ideas-editor').focus();
          return;
        }
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateIdeasToolbarState();
        $('#ideas-editor').focus();
      });
    });

    // Highlighter button in ideas toolbar
    const ideasToolbar = modal.querySelector('.ideas-editor-toolbar');
    if (ideasToolbar) {
      const hlDiv = document.createElement('div');
      hlDiv.className = 'task-desc-toolbar-divider';
      ideasToolbar.appendChild(hlDiv);
      ideasToolbar.appendChild(createHighlighterButton());
    }

    // Markdown auto-convert + toolbar state update
    const editorEl = modal.querySelector('#ideas-editor');
    attachChecklistHandler(editorEl);
    attachHighlighterContextMenu(editorEl);
    editorEl.addEventListener('input', handleEditorInput);
    editorEl.addEventListener('keydown', (e) => {
      handleEditorKeydown(e);
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateIdeasToolbarState, 0);
      }
    });

    // Update toolbar on selection change
    document.addEventListener('selectionchange', updateIdeasToolbarState);

    $('#ideas-save-btn').addEventListener('click', saveCurrentIdea);

    // View mode buttons
    $('#ideas-view-edit').addEventListener('click', () => {
      const idea = getAllIdeas().find(i => i.id === ideasEditingId);
      if (idea) showIdeasEditorView(idea);
    });

    $('#ideas-view-copy').addEventListener('click', () => {
      const title = $('#ideas-view-title').textContent || '';
      const content = $('#ideas-view-content').innerText || '';
      const text = title + (content ? '\n\n' + content : '');
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
      });
    });

    $('#ideas-view-delete').addEventListener('click', () => {
      if (ideasEditingId && confirm('Delete this idea?')) {
        deleteIdea(ideasEditingId);
        ideasEditingId = null;
        showToast('Idea deleted');
        showIdeasMainView();
      }
    });

    $('#ideas-view-close').addEventListener('click', () => {
      ideasEditingId = null;
      showIdeasMainView();
    });
  }

  ideasEditingId = null;
  showIdeasMainView();
  modal.hidden = false;
}

// Main view: list of saved ideas + editor for new idea below
function showIdeasMainView() {
  $('#ideas-items').hidden = false;
  $('#ideas-editor-section').hidden = false;
  $('#ideas-view-section').hidden = true;
  $('#ideas-title').textContent = 'Ideas';

  // Clear editor for new idea
  $('#ideas-title-input').value = '';
  $('#ideas-editor').innerHTML = '';
  ideasEditingId = null;

  renderIdeasList();
}

// View mode: replaces entire modal content with read-only idea
function showIdeasViewMode(idea) {
  if (!idea) return;
  ideasEditingId = idea.id;

  $('#ideas-items').hidden = true;
  $('#ideas-editor-section').hidden = true;
  $('#ideas-view-section').hidden = false;
  $('#ideas-title').textContent = 'Ideas';

  $('#ideas-view-title').textContent = idea.title || 'Untitled';
  $('#ideas-view-content').innerHTML = idea.description || '<span style="color:var(--muted)">No description</span>';
}

// Editor view for editing an existing idea
function showIdeasEditorView(idea) {
  $('#ideas-items').hidden = false;
  $('#ideas-editor-section').hidden = false;
  $('#ideas-view-section').hidden = true;

  ideasEditingId = idea.id;
  $('#ideas-title').textContent = 'Ideas';
  $('#ideas-title-input').value = idea.title || '';
  $('#ideas-editor').innerHTML = idea.description || '';

  renderIdeasList();
  requestAnimationFrame(() => $('#ideas-title-input').focus());
}

function saveCurrentIdea() {
  const titleInput = $('#ideas-title-input');
  const title = titleInput.value.trim();
  if (!title) {
    showToast('Please enter a title');
    titleInput.focus();
    return;
  }

  const editor = $('#ideas-editor');
  const desc = normalizeDescHtml(editor.innerHTML);

  if (ideasEditingId) {
    updateIdea(ideasEditingId, { title, description: desc });
    showToast('Idea updated');
  } else {
    createIdea(title, desc);
    showToast('Idea saved');
  }

  ideasEditingId = null;
  showIdeasMainView();
}

function renderIdeasList() {
  const container = $('#ideas-items');
  if (!container) return;
  container.innerHTML = '';

  const ideas = getAllIdeas();
  if (ideas.length === 0) return;

  ideas.forEach(idea => {
    const item = document.createElement('div');
    item.className = 'ideas-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ideas-item-title';
    titleSpan.textContent = idea.title || 'Untitled';
    item.appendChild(titleSpan);

    item.addEventListener('click', () => {
      showIdeasViewMode(idea);
    });

    container.appendChild(item);
  });
}

function closeIdeasModal() {
  const modal = $('#ideas-modal');
  if (modal) modal.hidden = true;
  ideasEditingId = null;
}

// ============================================================
// ITEM SELECTOR MODAL
// ============================================================

// --- Open item selector modal
export function openItemSelectorModal(onSelect) {
  currentItemSelectorCallback = onSelect;

  let modal = $('#item-selector-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'item-selector-modal';
    modal.className = 'item-selector-modal';
    modal.innerHTML = `
      <div class="item-selector-backdrop"></div>
      <div class="item-selector-dialog">
        <div class="item-selector-header">
          <h4>Select Item</h4>
          <button type="button" class="item-selector-close-btn" title="Close">&times;</button>
        </div>
        <div class="item-selector-search">
          <input type="text" id="item-selector-search-input" placeholder="Search items..." />
        </div>
        <div class="item-selector-categories" id="item-selector-categories">
          <!-- Populated dynamically -->
        </div>
        <div class="item-selector-footer">
          <button type="button" id="item-selector-clear" class="btn-secondary">Clear Selection</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.item-selector-backdrop').addEventListener('click', closeItemSelectorModal);
    modal.querySelector('.item-selector-close-btn').addEventListener('click', closeItemSelectorModal);

    // Search input
    const searchInput = $('#item-selector-search-input');
    searchInput.addEventListener('input', (e) => {
      renderItemSelectorCategories(e.target.value.trim().toLowerCase());
    });

    // Clear button
    $('#item-selector-clear').addEventListener('click', () => {
      if (currentItemSelectorCallback) {
        currentItemSelectorCallback(null);
      }
      closeItemSelectorModal();
    });
  }

  // Clear search and render
  const searchInput = $('#item-selector-search-input');
  searchInput.value = '';
  renderItemSelectorCategories('');

  modal.hidden = false;
  searchInput.focus();
}

// --- Render item selector categories
function renderItemSelectorCategories(filterQuery) {
  const container = $('#item-selector-categories');
  if (!container) return;

  container.innerHTML = '';

  const items = collectLinkableItems();
  const filteredItems = filterLinkableItems(items, filterQuery);

  // Render Icons
  if (filteredItems.icons.length > 0) {
    const category = createItemSelectorCategory('Icons', filteredItems.icons, 'icon');
    container.appendChild(category);
  }

  // Render Reminders
  if (filteredItems.reminders.length > 0) {
    const category = createItemSelectorCategory('Reminders', filteredItems.reminders, 'reminder');
    container.appendChild(category);
  }

  // Render Subtasks (Links)
  if (filteredItems.subtasks.length > 0) {
    const category = createItemSelectorCategory('Links', filteredItems.subtasks, 'subtask');
    container.appendChild(category);
  }

  // Render Copy-Paste items
  if (filteredItems.copyPaste.length > 0) {
    const category = createItemSelectorCategory('Copy-Paste', filteredItems.copyPaste, 'copyPaste');
    container.appendChild(category);
  }

  if (filteredItems.icons.length === 0 && filteredItems.reminders.length === 0 && filteredItems.subtasks.length === 0 && filteredItems.copyPaste.length === 0) {
    container.innerHTML = '<div class="item-selector-empty">No items found</div>';
  }
}

// --- Create a category section in item selector
function createItemSelectorCategory(title, items, type) {
  const categoryDiv = document.createElement('div');
  categoryDiv.className = 'item-selector-category';

  const headerDiv = document.createElement('div');
  headerDiv.className = 'item-selector-category-title';
  headerDiv.textContent = title;
  categoryDiv.appendChild(headerDiv);

  const itemsDiv = document.createElement('div');
  itemsDiv.className = 'item-selector-items';

  items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'item-selector-item';

    const titleEl = document.createElement('span');
    titleEl.className = 'item-selector-item-title';
    titleEl.textContent = item.title;
    itemEl.appendChild(titleEl);

    const breadcrumbEl = document.createElement('span');
    breadcrumbEl.className = 'item-selector-item-breadcrumb';
    breadcrumbEl.textContent = item.breadcrumb;
    itemEl.appendChild(breadcrumbEl);

    itemEl.addEventListener('click', () => {
      if (currentItemSelectorCallback) {
        currentItemSelectorCallback({
          type: type,
          key: item.key,
          sectionId: item.sectionId,
          subtitle: item.subtitle
        });
      }
      closeItemSelectorModal();
    });

    itemsDiv.appendChild(itemEl);
  });

  categoryDiv.appendChild(itemsDiv);
  return categoryDiv;
}

// --- Collect all linkable items (icons, reminders, subtasks - NOT copy-paste or notes)
export function collectLinkableItems() {
  const data = currentData();
  const sections = currentSections();
  const items = {
    icons: [],
    reminders: [],
    subtasks: [],
    copyPaste: []
  };

  sections.forEach(section => {
    const cardData = data[section.id];
    if (!cardData) return;

    const cardTitle = data.sectionTitles?.[section.id] || section.title || 'Untitled Card';

    Object.entries(cardData).forEach(([subtitle, subtitleData]) => {
      if (!subtitleData) return;

      const breadcrumb = subtitle !== '_default' ? `${cardTitle} > ${subtitle}` : cardTitle;

      // Collect icons (exclude dividers)
      if (subtitleData.icons) {
        subtitleData.icons.forEach(icon => {
          if (!icon.isDivider) {
            items.icons.push({
              type: 'icon',
              key: icon.key,
              title: icon.title || extractDomainFromUrl(icon.url) || 'Icon',
              sectionId: section.id,
              subtitle,
              breadcrumb
            });
          }
        });
      }

      // Collect reminders
      if (subtitleData.reminders) {
        subtitleData.reminders.forEach(rem => {
          items.reminders.push({
            type: 'reminder',
            key: rem.key,
            title: rem.title || 'Reminder',
            sectionId: section.id,
            subtitle,
            breadcrumb
          });
        });
      }

      // Collect subtasks
      if (subtitleData.subtasks) {
        subtitleData.subtasks.forEach(sub => {
          items.subtasks.push({
            type: 'subtask',
            key: sub.key,
            title: sub.text || 'Link',
            sectionId: section.id,
            subtitle,
            breadcrumb
          });
        });
      }

      // Collect copy-paste items
      if (subtitleData.copyPaste) {
        subtitleData.copyPaste.forEach(cp => {
          items.copyPaste.push({
            type: 'copyPaste',
            key: cp.key,
            title: cp.text || 'Copy-Paste',
            sectionId: section.id,
            subtitle,
            breadcrumb
          });
        });
      }
    });
  });

  return items;
}

// --- Filter linkable items by search query
function filterLinkableItems(items, query) {
  if (!query) return items;

  const q = query.toLowerCase();
  return {
    icons: items.icons.filter(i => i.title?.toLowerCase().includes(q) || i.breadcrumb?.toLowerCase().includes(q)),
    reminders: items.reminders.filter(i => i.title?.toLowerCase().includes(q) || i.breadcrumb?.toLowerCase().includes(q)),
    subtasks: items.subtasks.filter(i => i.title?.toLowerCase().includes(q) || i.breadcrumb?.toLowerCase().includes(q)),
    copyPaste: items.copyPaste.filter(i => i.title?.toLowerCase().includes(q) || i.breadcrumb?.toLowerCase().includes(q))
  };
}

// --- Extract domain name from URL (e.g., telcobridges.atlassian.com -> "Telcobridges Atlassian")
function extractDomainFromUrl(url) {
  if (!url) return '';
  try {
    // Remove protocol and www
    let domain = url.replace(/^(https?:\/\/)?(www\.)?/i, '');
    // Get just the domain part (before any path)
    domain = domain.split('/')[0];
    // Split by dots
    const parts = domain.split('.');
    // Remove common TLDs from the end
    const tlds = ['com', 'org', 'net', 'io', 'co', 'edu', 'gov', 'app', 'dev', 'me', 'info', 'biz', 'xyz', 'ai'];
    while (parts.length > 1 && tlds.includes(parts[parts.length - 1].toLowerCase())) {
      parts.pop();
    }
    // Also remove country TLDs if followed by a common TLD (e.g., .co.uk, .com.au)
    const countryTlds = ['uk', 'au', 'ca', 'de', 'fr', 'jp', 'cn', 'in', 'br', 'ru', 'nl', 'it', 'es'];
    if (parts.length > 1 && countryTlds.includes(parts[parts.length - 1].toLowerCase())) {
      parts.pop();
    }
    // Capitalize each remaining part and join with space
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
  } catch (e) {
    return '';
  }
}

// --- Close item selector modal
function closeItemSelectorModal() {
  const modal = $('#item-selector-modal');
  if (modal) {
    modal.hidden = true;
  }
  currentItemSelectorCallback = null;
}

// ============================================================
// COMPLETED TASKS ARCHIVE MODAL
// ============================================================

function openCompletedTasksModal() {
  let modal = $('#completed-tasks-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'completed-tasks-modal';
    modal.className = 'completed-tasks-modal';
    modal.innerHTML = `
      <div class="completed-tasks-backdrop"></div>
      <div class="completed-tasks-dialog">
        <div class="completed-tasks-header">
          <h4>Completed Tasks</h4>
          <button type="button" class="completed-tasks-close-btn" title="Close">&times;</button>
        </div>
        <div class="completed-tasks-list" id="completed-tasks-list"></div>
        <div class="completed-tasks-actions">
          <button type="button" id="completed-tasks-clear-all" class="btn-secondary completed-tasks-danger-btn">Clear All</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.completed-tasks-backdrop').addEventListener('click', () => { modal.hidden = true; });
    modal.querySelector('.completed-tasks-close-btn').addEventListener('click', () => { modal.hidden = true; });

    $('#completed-tasks-clear-all').addEventListener('click', () => {
      if (confirm('Permanently delete all completed tasks?')) {
        clearCompletedTasks();
        renderCompletedTasksList();
        renderEisenhowerMatrix();
        showToast('All completed tasks cleared');
      }
    });
  }

  renderCompletedTasksList();
  modal.hidden = false;
}

function renderCompletedTasksList() {
  const list = $('#completed-tasks-list');
  if (!list) return;

  const tasks = getCompletedTasks();

  if (tasks.length === 0) {
    list.innerHTML = '<div class="completed-tasks-empty">No completed tasks</div>';
    return;
  }

  list.innerHTML = '';
  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = `completed-task-row task-bubble-${task.color}`;

    const title = document.createElement('span');
    title.className = 'completed-task-title';
    title.textContent = task.title || 'Untitled';

    const date = document.createElement('span');
    date.className = 'completed-task-date';
    if (task.completedAt) {
      const d = new Date(task.completedAt);
      date.textContent = d.toLocaleDateString();
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'completed-task-delete';
    deleteBtn.title = 'Delete permanently';
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCompletedTask(task.id);
      renderCompletedTasksList();
      renderEisenhowerMatrix();
    });

    row.appendChild(title);
    row.appendChild(date);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  });
}

// --- Navigate to the source item
export function navigateToTaskSource(linkedItem) {
  if (!linkedItem) return;

  // Close the modal first
  closeTasksSummaryModal();

  // Find the element on the page
  setTimeout(() => {
    let targetElement = null;

    if (linkedItem.type === 'icon') {
      targetElement = document.querySelector(`.icon-btn[data-key="${linkedItem.key}"]`);
    } else if (linkedItem.type === 'reminder') {
      targetElement = document.querySelector(`.unified-reminder-item[data-key="${linkedItem.key}"]`);
      if (!targetElement) {
        targetElement = document.querySelector(`.reminder-item[data-key="${linkedItem.key}"]`);
      }
    } else if (linkedItem.type === 'subtask') {
      targetElement = document.querySelector(`.unified-subtask-item[data-key="${linkedItem.key}"]`);
    }

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetElement.classList.add('task-highlight');
      setTimeout(() => {
        targetElement.classList.remove('task-highlight');
      }, 2000);
    }
  }, 100);
}
