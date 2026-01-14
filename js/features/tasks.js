// Personal Dashboard - Tasks Module
// Handles reminder and list item tasks modals and toggles
// Tasks are color-coded items (red/yellow/green) that can be reordered and color-changed in view mode

import { currentData, currentSections } from '../state.js';
import { $, showToast } from '../utils.js';
import { markDirtyAndSave } from './edit-mode.js';
import { saveModel } from '../core/storage.js';

// Module state
let currentTasksReminder = null;
let currentTasksListItem = null;
let currentTasksListItemSectionId = null;

// Edit mode drag state (module level for proper sharing)
let dragSrcIndex = null;
let dragTargetIndex = null;

// Color cycle order
const COLOR_CYCLE = ['red', 'yellow', 'green'];

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

    ['red', 'yellow', 'green'].forEach(color => {
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = `task-color-btn ${color}${task.color === color ? ' active' : ''}`;
      colorBtn.title = color.charAt(0).toUpperCase() + color.slice(1);
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
  currentTasksReminder.tasks.push({ title: '', color: 'green' });
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
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData || !cardData[subtitle]) return;

  const subtitleData = cardData[subtitle];
  const remindersArray = subtitleData.reminders || [];
  const reminder = remindersArray.find(r => r.key === reminderKey);

  if (!reminder || !reminder.tasks || reminder.tasks.length === 0) return;

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

    // Create drop indicator line
    const dropIndicator = document.createElement('div');
    dropIndicator.className = 'task-drop-indicator';
    dropIndicator.style.display = 'none';

    let draggedIndex = null;
    let dropTargetIndex = null;

    reminder.tasks.forEach((task, index) => {
      const taskBubble = document.createElement('div');
      taskBubble.className = `reminder-task-bubble task-bubble-${task.color}`;
      taskBubble.textContent = task.title || 'Task';
      taskBubble.style.animationDelay = `${index * 50}ms`;
      taskBubble.draggable = true;
      taskBubble.dataset.index = index;

      // Click to cycle color
      taskBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleTaskColor(task, taskBubble, reminder, sectionId, subtitle);
      });

      // Drag to reorder
      taskBubble.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        taskBubble.classList.add('dragging');
        draggedIndex = index;
        e.dataTransfer.setData('text/plain', index.toString());
        e.dataTransfer.effectAllowed = 'move';
      });

      taskBubble.addEventListener('dragend', (e) => {
        e.stopPropagation();
        taskBubble.classList.remove('dragging');
        dropIndicator.style.display = 'none';
        draggedIndex = null;
        dropTargetIndex = null;
      });

      taskBubble.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedIndex === null || draggedIndex === index) return;

        const rect = taskBubble.getBoundingClientRect();
        const containerRect = tasksContainer.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isAbove = e.clientY < midY;

        // Calculate indicator position relative to container
        let indicatorTop;
        if (isAbove) {
          indicatorTop = rect.top - containerRect.top - 2;
          dropTargetIndex = index;
        } else {
          indicatorTop = rect.bottom - containerRect.top + 2;
          dropTargetIndex = index + 1;
        }

        dropIndicator.style.display = 'block';
        dropIndicator.style.top = `${indicatorTop}px`;
      });

      taskBubble.addEventListener('dragleave', (e) => {
        e.stopPropagation();
      });

      taskBubble.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropIndicator.style.display = 'none';

        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIndex = dropTargetIndex;

        // Adjust target index if dragging down
        if (toIndex !== null && fromIndex < toIndex) {
          toIndex--;
        }

        if (fromIndex !== toIndex && toIndex !== null) {
          reorderTasks(reminder, fromIndex, toIndex, sectionId, buttonEl, subtitle);
        }
      });

      tasksContainer.appendChild(taskBubble);
    });

    // Add drop indicator to container
    tasksContainer.appendChild(dropIndicator);

    // Also handle drop on container itself (for dropping at the end)
    tasksContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    tasksContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      dropIndicator.style.display = 'none';
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

    ['red', 'yellow', 'green'].forEach(color => {
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = `task-color-btn ${color}${task.color === color ? ' active' : ''}`;
      colorBtn.title = color.charAt(0).toUpperCase() + color.slice(1);
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
  currentTasksListItem.tasks.push({ title: '', color: 'green' });
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
export function toggleListItemTasks(item, sectionId, buttonEl) {
  if (!item || !item.tasks || item.tasks.length === 0) return;

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

    // Create drop indicator line
    const dropIndicator = document.createElement('div');
    dropIndicator.className = 'task-drop-indicator';
    dropIndicator.style.display = 'none';

    let draggedIndex = null;
    let dropTargetIndex = null;

    item.tasks.forEach((task, index) => {
      const taskBubble = document.createElement('div');
      taskBubble.className = `reminder-task-bubble task-bubble-${task.color}`;
      taskBubble.textContent = task.title || 'Task';
      taskBubble.style.animationDelay = `${index * 50}ms`;
      taskBubble.draggable = true;
      taskBubble.dataset.index = index;

      // Click to cycle color
      taskBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleListItemTaskColor(task, taskBubble, item, sectionId);
      });

      // Drag to reorder
      taskBubble.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        taskBubble.classList.add('dragging');
        draggedIndex = index;
        e.dataTransfer.setData('text/plain', index.toString());
        e.dataTransfer.effectAllowed = 'move';
      });

      taskBubble.addEventListener('dragend', (e) => {
        e.stopPropagation();
        taskBubble.classList.remove('dragging');
        dropIndicator.style.display = 'none';
        draggedIndex = null;
        dropTargetIndex = null;
      });

      taskBubble.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedIndex === null || draggedIndex === index) return;

        const rect = taskBubble.getBoundingClientRect();
        const containerRect = tasksContainer.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isAbove = e.clientY < midY;

        // Calculate indicator position relative to container
        let indicatorTop;
        if (isAbove) {
          indicatorTop = rect.top - containerRect.top - 2;
          dropTargetIndex = index;
        } else {
          indicatorTop = rect.bottom - containerRect.top + 2;
          dropTargetIndex = index + 1;
        }

        dropIndicator.style.display = 'block';
        dropIndicator.style.top = `${indicatorTop}px`;
      });

      taskBubble.addEventListener('dragleave', (e) => {
        e.stopPropagation();
      });

      taskBubble.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropIndicator.style.display = 'none';

        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIndex = dropTargetIndex;

        // Adjust target index if dragging down
        if (toIndex !== null && fromIndex < toIndex) {
          toIndex--;
        }

        if (fromIndex !== toIndex && toIndex !== null) {
          reorderListItemTasks(item, fromIndex, toIndex, sectionId, buttonEl);
        }
      });

      tasksContainer.appendChild(taskBubble);
    });

    // Add drop indicator to container
    tasksContainer.appendChild(dropIndicator);

    // Also handle drop on container itself (for dropping at the end)
    tasksContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    tasksContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      dropIndicator.style.display = 'none';
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
// TASKS SUMMARY MODAL (Header summary view)
// ============================================================

// --- Open tasks summary modal
export function openTasksSummaryModal() {
  const modal = $('#tasks-summary-modal');
  const content = $('#tasks-summary-content');
  if (!modal || !content) return;

  content.innerHTML = '';
  const data = currentData();
  const sections = currentSections();
  let hasAnyTasks = false;

  sections.forEach(section => {
    if (section.type !== 'unified') return;
    const cardData = data[section.id];
    if (!cardData) return;

    for (const [subtitle, subtitleData] of Object.entries(cardData)) {
      if (!subtitleData) continue;

      // Check reminders
      if (subtitleData.reminders) {
        subtitleData.reminders.forEach(rem => {
          if (rem.tasks && rem.tasks.length > 0) {
            hasAnyTasks = true;
            renderTaskSummaryGroup(content, rem.title || rem.key, rem.tasks, 'reminder', rem.key, section.id);
          }
        });
      }

      // Check subtasks
      if (subtitleData.subtasks) {
        subtitleData.subtasks.forEach(item => {
          if (item.tasks && item.tasks.length > 0) {
            hasAnyTasks = true;
            renderTaskSummaryGroup(content, item.text || item.key, item.tasks, 'subtask', item.key, section.id);
          }
        });
      }
    }
  });

  if (!hasAnyTasks) {
    content.innerHTML = '<div class="tasks-summary-empty">No tasks found</div>';
  }

  modal.hidden = false;
}

// --- Render a task group in the summary modal
function renderTaskSummaryGroup(container, title, tasks, itemType, itemKey, sectionId) {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'tasks-summary-group';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'tasks-summary-group-title';
  titleDiv.textContent = title;
  groupDiv.appendChild(titleDiv);

  const bubblesDiv = document.createElement('div');
  bubblesDiv.className = 'tasks-summary-bubbles';

  tasks.forEach((task, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'tasks-summary-row';

    const bubble = document.createElement('div');
    bubble.className = `tasks-summary-bubble task-bubble-${task.color}`;
    bubble.textContent = task.title || 'Task';
    bubble.dataset.index = index;
    bubble.dataset.itemType = itemType;
    bubble.dataset.itemKey = itemKey;
    bubble.dataset.sectionId = sectionId;

    // Click to cycle color
    bubble.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      cycleTaskColorInSummary(bubble, itemType, itemKey, sectionId, index);
    });

    // Arrow button to navigate to source
    const arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.className = 'tasks-summary-goto-btn';
    arrowBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>`;
    arrowBtn.title = 'Go to item';
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      navigateToTaskSource(itemType, itemKey, sectionId);
    });

    rowDiv.appendChild(bubble);
    rowDiv.appendChild(arrowBtn);
    bubblesDiv.appendChild(rowDiv);
  });

  groupDiv.appendChild(bubblesDiv);
  container.appendChild(groupDiv);
}

// --- Navigate to the source reminder/subtask
function navigateToTaskSource(itemType, itemKey, sectionId) {
  // Close the modal first
  closeTasksSummaryModal();

  // Find the element on the page
  setTimeout(() => {
    let targetElement = null;

    if (itemType === 'reminder') {
      // Look for reminder item with this key (unified or legacy)
      targetElement = document.querySelector(`.unified-reminder-item[data-key="${itemKey}"]`);
      if (!targetElement) {
        targetElement = document.querySelector(`.reminder-item[data-key="${itemKey}"]`);
      }
    } else if (itemType === 'subtask') {
      // Look for subtask item with this key
      targetElement = document.querySelector(`.unified-subtask-item[data-key="${itemKey}"]`);
    }

    if (targetElement) {
      // Scroll to the element
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add a brief highlight effect
      targetElement.classList.add('task-highlight');
      setTimeout(() => {
        targetElement.classList.remove('task-highlight');
      }, 2000);
    }
  }, 100);
}

// --- Cycle task color from summary modal
function cycleTaskColorInSummary(bubbleEl, itemType, itemKey, sectionId, taskIndex) {
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData) return;

  let actualItem = null;

  // Find the item (reminder or subtask)
  for (const [subtitle, subtitleData] of Object.entries(cardData)) {
    if (!subtitleData) continue;

    if (itemType === 'reminder' && subtitleData.reminders) {
      const found = subtitleData.reminders.find(r => r.key === itemKey);
      if (found) {
        actualItem = found;
        break;
      }
    } else if (itemType === 'subtask' && subtitleData.subtasks) {
      const found = subtitleData.subtasks.find(s => s.key === itemKey);
      if (found) {
        actualItem = found;
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

  // Update bubble class in summary modal
  bubbleEl.className = `tasks-summary-bubble task-bubble-${newColor}`;

  // Save the change
  saveModel();
}

// --- Close tasks summary modal
export function closeTasksSummaryModal() {
  const modal = $('#tasks-summary-modal');
  if (modal) {
    modal.hidden = true;
  }
}
