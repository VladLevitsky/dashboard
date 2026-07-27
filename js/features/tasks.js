// Personal Dashboard - Tasks Module
// Handles Eisenhower Matrix task management with centralized task storage
// Tasks are color-coded (blue/yellow/orange/red) representing urgency and importance

import { model, editState, currentData, currentSections } from '../state.js';
import { $, showToast, createAnimatedBorder } from '../utils.js';
import { markDirtyAndSave, handleEditorInput } from './edit-mode.js';
import { saveModel } from '../core/storage.js';
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

// Get tasks for a specific item
export function getTasksForItem(type, key, sectionId) {
  const tasks = getAllTasks();
  return tasks.filter(t =>
    t.linkedItem &&
    t.linkedItem.type === type &&
    t.linkedItem.key === key &&
    t.linkedItem.sectionId === sectionId
  );
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

  // If changing color, update order to be last in new color group
  if (updates.color && updates.color !== task.color) {
    updates.order = getTasksByColor(updates.color).length;
  }

  Object.assign(task, updates);
  saveModel();
  return task;
}

// Delete a task
export function deleteTask(taskId) {
  const data = currentData();
  const tasks = data.tasks || [];
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return false;

  const task = tasks[taskIndex];

  // Remove reference from linked item
  if (task.linkedItem) {
    const item = findItemByReference(task.linkedItem);
    if (item?.taskIds) {
      item.taskIds = item.taskIds.filter(id => id !== taskId);
    }
  }

  // Remove from quick access if pinned
  if (task.pinned && window.isItemInQuickAccess) {
    const taskQAData = { type: 'task', taskId: task.id, text: task.title, color: task.color };
    if (window.isItemInQuickAccess(taskQAData) && window.toggleItemQuickAccess) {
      window.toggleItemQuickAccess(taskQAData);
    }
  }

  tasks.splice(taskIndex, 1);
  saveModel();
  return true;
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
  importantHeading.textContent = 'Important';
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

  // Enable drop zone for drag-drop (only on Secondary cards)
  if (!pinnedOnly) {
    initEisenhowerDropZone(tasksContainer, color);
  }

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

      // Toggle quick access
      if (window.toggleItemQuickAccess) {
        const taskQAData = {
          type: 'task',
          taskId: task.id,
          text: task.title,
          color: task.color
        };
        // Sync: add to QA if pinned, remove if unpinned
        const isInQA = window.isItemInQuickAccess && window.isItemInQuickAccess(taskQAData);
        if (isNowPinned && !isInQA) {
          window.toggleItemQuickAccess(taskQAData);
        } else if (!isNowPinned && isInQA) {
          window.toggleItemQuickAccess(taskQAData);
        }
      }

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
function initEisenhowerDropZone(container, targetColor) {
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

    // Move task to new color/position
    const task = getTaskById(taskId);
    if (task) {
      if (task.color !== targetColor) {
        // Moving to different color - update color and order
        moveTaskToColor(taskId, targetColor, newOrder);
      } else {
        // Same color - just reorder
        reorderTaskWithinColor(taskId, newOrder);
      }
      // Re-render the matrix
      renderEisenhowerMatrix();
    }
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

// --- Open modal to add a new task (optionally with a pre-linked item)
export function openAddTaskModal(preLinkedItem = null) {
  currentEditingTaskId = null;
  preLinkedItemContext = preLinkedItem;
  openTaskEditorModal({
    title: '',
    color: 'blue',
    linkedItem: preLinkedItem
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
        // Save context before closing modal (closing clears it)
        const contextToPass = { ...currentItemTasksContext };
        closeItemTasksModal();
        openAddTaskModal(contextToPass);
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

// --- Description editor state
let descriptionEditing = false;

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
            </div>
            <div class="task-editor-field">
              <label for="task-editor-link">Task Link (Optional)</label>
              <input type="url" id="task-editor-link" placeholder="https://example.com" />
            </div>
            <div class="task-editor-field">
              <label>Link to Item (Optional)</label>
              <div class="task-editor-item-selector" id="task-editor-item-selector">
                <span class="task-editor-item-text">No item selected</span>
                <button type="button" class="task-editor-item-btn">Select Item</button>
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
          <button type="button" id="task-editor-delete" class="task-editor-delete-btn" hidden title="Delete task">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
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
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateTaskToolbarState();
        $('#task-desc-editor').focus();
      });
    });

    // Markdown auto-convert in description editor (reuse Card Notes handler)
    const descEditor = modal.querySelector('#task-desc-editor');
    descEditor.addEventListener('input', handleEditorInput);

    // Update toolbar on keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+U)
    descEditor.addEventListener('keydown', (e) => {
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

  // Populate link field
  const linkInput = $('#task-editor-link');
  linkInput.value = taskData.link || '';

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

  // Item selector - hide if opened from an item context
  const itemSelectorField = $('#task-editor-item-selector')?.closest('.task-editor-field');
  const itemSelector = $('#task-editor-item-selector');
  let selectedLinkedItem = taskData.linkedItem ? { ...taskData.linkedItem } : null;

  if (preLinkedItemContext) {
    // Hide the item selector when adding from an item
    if (itemSelectorField) itemSelectorField.style.display = 'none';
  } else {
    // Show the item selector
    if (itemSelectorField) itemSelectorField.style.display = '';
    const itemText = itemSelector.querySelector('.task-editor-item-text');
    const itemBtn = itemSelector.querySelector('.task-editor-item-btn');

    updateItemSelectorText(itemText, selectedLinkedItem);

    itemBtn.onclick = () => {
      openItemSelectorModal((item) => {
        selectedLinkedItem = item;
        updateItemSelectorText(itemText, selectedLinkedItem);
      });
    };
  }

  // Populate subtasks
  editorSubtasks = (taskData.subtasks || []).map(s => ({ ...s }));
  renderEditorSubtasks();

  // Wire up buttons
  const cancelBtn = $('#task-editor-cancel');
  cancelBtn.onclick = closeTaskEditorModal;

  const saveBtn = $('#task-editor-save');
  saveBtn.onclick = () => {
    const title = nameInput.value.trim();
    if (!title) {
      showToast('Please enter a task name');
      nameInput.focus();
      return;
    }

    const link = linkInput.value.trim() || null;

    // Get description - from editor if editing, from view if not
    const rawDesc = descriptionEditing
      ? $('#task-desc-editor').innerHTML
      : $('#task-desc-view-content').innerHTML;
    const descContent = normalizeDescHtml(rawDesc);
    const description = descContent || null;

    // Clean up subtasks (remove empty titles)
    const subtasks = editorSubtasks.filter(s => s.title && s.title.trim());

    if (currentEditingTaskId) {
      // Update existing task
      updateTask(currentEditingTaskId, {
        title,
        color: selectedColor,
        linkedItem: selectedLinkedItem,
        link: link,
        description: description,
        subtasks: subtasks.length > 0 ? subtasks : null
      });
      showToast('Task updated');
    } else {
      // Create new task
      const task = createTask(title, selectedColor, selectedLinkedItem, link);
      const updates = {};
      if (description) updates.description = description;
      if (subtasks.length > 0) updates.subtasks = subtasks;
      if (Object.keys(updates).length > 0) {
        updateTask(task.id, updates);
      }
      showToast('Task created');
    }

    closeTaskEditorModal();
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
        closeTaskEditorModal();
        renderEisenhowerMatrix();
        // Refresh main view to update task indicators
        if (window.renderAllSections) window.renderAllSections();
      }
    };
  }

  modal.hidden = false;
  nameInput.focus();
}

// --- Update item selector display text
function updateItemSelectorText(textEl, linkedItem) {
  if (!linkedItem) {
    textEl.textContent = 'No item selected';
    textEl.classList.remove('has-item');
  } else {
    // Try to find the item to get its title
    const item = findItemByReference(linkedItem);
    let displayText = linkedItem.type;

    if (item) {
      if (linkedItem.type === 'icon') {
        displayText = item.title || extractDomainFromUrl(item.url) || 'Icon';
      } else if (linkedItem.type === 'reminder') {
        displayText = item.title || 'Reminder';
      } else if (linkedItem.type === 'subtask') {
        displayText = item.text || 'Subtask';
      }
    }

    textEl.textContent = displayText;
    textEl.classList.add('has-item');
  }
}

// --- Normalize contenteditable HTML (strip lone <br>, whitespace-only)
function normalizeDescHtml(html) {
  if (!html) return '';
  const trimmed = html.trim();
  return (trimmed === '<br>' || trimmed === '') ? '' : trimmed;
}

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
  editorSubtasks.push({ id: generateSubtaskId(), title: '', description: '' });
  renderEditorSubtasks();
  // Focus the new input
  const inputs = document.querySelectorAll('#task-subtasks-list .task-subtask-title-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function renderEditorSubtasks() {
  const list = $('#task-subtasks-list');
  if (!list) return;
  list.innerHTML = '';

  editorSubtasks.forEach((subtask, index) => {
    const row = document.createElement('div');
    row.className = 'task-subtask-row';

    const isNew = !subtask.title;

    const titleWrap = document.createElement('div');
    titleWrap.className = 'task-subtask-title-wrap';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'task-subtask-title-input';
    titleInput.placeholder = 'Subtask title';
    titleInput.value = subtask.title || '';
    titleInput.readOnly = !isNew;
    if (!isNew) titleInput.classList.add('locked');

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
    if (!isNew) confirmBtn.hidden = true;

    titleWrap.appendChild(titleInput);
    titleWrap.appendChild(confirmBtn);

    // Click input to enter edit mode
    titleInput.addEventListener('click', () => {
      if (titleInput.readOnly) {
        titleInput.readOnly = false;
        titleInput.classList.remove('locked');
        confirmBtn.hidden = false;
        titleInput.focus();
      }
    });

    // Confirm locks it back
    confirmBtn.addEventListener('click', () => {
      titleInput.readOnly = true;
      titleInput.classList.add('locked');
      confirmBtn.hidden = true;
    });

    // Description indicator / edit button
    const descBtn = document.createElement('button');
    descBtn.type = 'button';
    descBtn.className = 'task-subtask-desc-btn';
    const hasDesc = normalizeDescHtml(subtask.description || '');
    descBtn.title = hasDesc ? 'Edit description' : 'Add description';
    descBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`;
    if (hasDesc) descBtn.classList.add('has-content');
    descBtn.addEventListener('click', () => {
      openSubtaskDescriptionModal(subtask);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'task-subtask-delete-btn';
    deleteBtn.title = 'Remove subtask';
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>`;
    deleteBtn.addEventListener('click', () => {
      editorSubtasks.splice(index, 1);
      renderEditorSubtasks();
    });

    row.appendChild(titleWrap);
    row.appendChild(descBtn);
    row.appendChild(deleteBtn);
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
          </div>
          <div id="subtask-desc-editor" class="task-desc-editor" contenteditable="true"></div>
        </div>
        <div class="subtask-desc-actions">
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
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateSubtaskToolbarState();
        $('#subtask-desc-editor').focus();
      });
    });

    // Markdown auto-convert
    const editorEl = modal.querySelector('#subtask-desc-editor');
    editorEl.addEventListener('input', handleEditorInput);

    editorEl.addEventListener('keydown', (e) => {
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

  // Wire save/cancel
  $('#subtask-desc-cancel').onclick = () => { modal.hidden = true; };
  $('#subtask-desc-save').onclick = () => {
    subtask.description = normalizeDescHtml(editor.innerHTML) || '';
    modal.hidden = true;
    renderEditorSubtasks(); // Update indicator
  };
}

function updateSubtaskToolbarState() {
  const modal = $('#subtask-desc-modal');
  if (!modal) return;
  modal.querySelectorAll('.subtask-toolbar-btn').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

// --- Close task editor modal
function updateTaskToolbarState() {
  const btns = document.querySelectorAll('.task-desc-toolbar-btn');
  btns.forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
      const isActive = document.queryCommandState(cmd);
      btn.classList.toggle('active', isActive);
    }
  });
}

function closeTaskEditorModal() {
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
  modal.querySelectorAll('.ideas-toolbar-btn').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd));
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
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateIdeasToolbarState();
        $('#ideas-editor').focus();
      });
    });

    // Markdown auto-convert + toolbar state update
    const editorEl = modal.querySelector('#ideas-editor');
    editorEl.addEventListener('input', handleEditorInput);
    editorEl.addEventListener('keydown', (e) => {
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

  if (filteredItems.icons.length === 0 && filteredItems.reminders.length === 0 && filteredItems.subtasks.length === 0) {
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
    subtasks: []
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
    subtasks: items.subtasks.filter(i => i.title?.toLowerCase().includes(q) || i.breadcrumb?.toLowerCase().includes(q))
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
