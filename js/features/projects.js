// Personal Dashboard - Projects Module
// Project-based notepad with two-way task linking
// Each project is a rich-text editor; selected text can be promoted to a real task
// with a persistent, color-coded highlight that stays in sync.

import { currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { handleEditorInput } from './edit-mode.js';
import { saveModel } from '../core/storage.js';
import { TASK_COLORS, TASK_COLOR_LABELS } from '../constants.js';

// Module state
let currentProjectId = null;

// ============================================================
// PROJECTS CRUD
// ============================================================

function getAllProjects() {
  const data = currentData();
  return data.projects || [];
}

function getProjectById(id) {
  return getAllProjects().find(p => p.id === id);
}

function createProject(title) {
  const data = currentData();
  data.projects = data.projects || [];
  const project = {
    id: 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    title: title || 'Untitled Project',
    content: ''
  };
  data.projects.push(project);
  saveModel();
  return project;
}

function updateProject(projectId, updates) {
  const project = getProjectById(projectId);
  if (!project) return null;
  Object.assign(project, updates);
  saveModel();
  return project;
}

function deleteProject(projectId) {
  const data = currentData();
  data.projects = data.projects || [];
  const idx = data.projects.findIndex(p => p.id === projectId);
  if (idx === -1) return false;
  data.projects.splice(idx, 1);
  saveModel();
  return true;
}

// ============================================================
// HIGHLIGHT MANAGEMENT (two-way task links)
// ============================================================

// Color mapping for highlights
const HIGHLIGHT_COLORS = {
  blue: 'rgba(59, 130, 246, 0.25)',
  yellow: 'rgba(234, 179, 8, 0.25)',
  orange: 'rgba(249, 115, 22, 0.25)',
  red: 'rgba(239, 68, 68, 0.25)',
  completed: 'rgba(34, 197, 94, 0.3)'
};

const HIGHLIGHT_BORDER_COLORS = {
  blue: 'rgba(59, 130, 246, 0.6)',
  yellow: 'rgba(234, 179, 8, 0.6)',
  orange: 'rgba(249, 115, 22, 0.6)',
  red: 'rgba(239, 68, 68, 0.6)',
  completed: 'rgba(34, 197, 94, 0.6)'
};

// Remove a highlight from project content (revert to plain text)
export function removeProjectTaskHighlight(projectId, taskId) {
  const project = getProjectById(projectId);
  if (!project || !project.content) return;

  // Parse and remove highlight spans for this task
  const temp = document.createElement('div');
  temp.innerHTML = project.content;
  temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
    // Replace span with its text content
    const text = document.createTextNode(span.textContent);
    span.parentNode.replaceChild(text, span);
  });
  project.content = temp.innerHTML;
  saveModel();

  // Update live editor if this project is currently open
  if (currentProjectId === projectId) {
    const editor = $('#project-editor');
    if (editor) {
      editor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
        const text = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(text, span);
      });
    }
  }
}

// Mark a highlight as completed (turns green)
export function markProjectTaskHighlightCompleted(projectId, taskId) {
  const project = getProjectById(projectId);
  if (!project || !project.content) return;

  // Update stored content
  const temp = document.createElement('div');
  temp.innerHTML = project.content;
  temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
    span.dataset.highlightColor = 'completed';
    span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
    span.style.borderBottomColor = HIGHLIGHT_BORDER_COLORS.completed;
    span.classList.add('completed');
  });
  project.content = temp.innerHTML;
  saveModel();

  // Update live editor
  if (currentProjectId === projectId) {
    const editor = $('#project-editor');
    if (editor) {
      editor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
        span.dataset.highlightColor = 'completed';
        span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
        span.style.borderBottomColor = HIGHLIGHT_BORDER_COLORS.completed;
        span.classList.add('completed');
      });
    }
  }
}

// Refresh all highlights in the current editor (called after task changes)
export function refreshProjectHighlights() {
  const editor = $('#project-editor');
  if (!editor) return;

  editor.querySelectorAll('span.project-task-highlight').forEach(span => {
    const taskId = span.dataset.taskId;
    if (!taskId) return;

    // Check if the task still exists as active
    const task = window.getTaskById ? window.getTaskById(taskId) : null;
    if (task) {
      // Update color to match current priority
      const color = task.color || 'blue';
      span.dataset.highlightColor = color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[color];
      span.style.borderBottomColor = HIGHLIGHT_BORDER_COLORS[color];
      span.classList.remove('completed');
    }
    // Completed/removed highlights are handled by their respective functions
  });

  // Also save updated content
  if (currentProjectId) {
    const project = getProjectById(currentProjectId);
    if (project) {
      project.content = editor.innerHTML;
      saveModel();
    }
  }
}

// ============================================================
// PROJECTS MODAL
// ============================================================

export function openProjectsModal(openToProjectId) {
  let modal = $('#projects-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'projects-modal';
    modal.className = 'projects-modal';
    modal.innerHTML = `
      <div class="projects-backdrop"></div>
      <div class="projects-dialog">
        <div class="projects-title-bar">
          <h3>Projects</h3>
          <button type="button" class="projects-close-btn" title="Close">&times;</button>
        </div>
        <div class="projects-header">
          <div class="projects-tabs" id="projects-tabs"></div>
        </div>
        <div class="projects-body" id="projects-body">
          <div class="projects-empty-state" id="projects-empty-state">
            <p>No projects yet. Click the <strong>+</strong> tab to create one.</p>
          </div>
          <div class="projects-editor-wrap" id="projects-editor-wrap" hidden>
            <div class="projects-editor-toolbar" id="projects-editor-toolbar">
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
              <div class="task-desc-toolbar-divider"></div>
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
              </button>
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
              </button>
              <div class="projects-toolbar-spacer"></div>
              <span class="project-save-label" id="project-save-label"></span>
              <button type="button" class="project-save-btn" id="project-save-btn" title="Save">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
              </button>
              <button type="button" class="project-convert-task-btn" id="project-convert-btn" title="Select text in the editor, then click to convert it into a linked task" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                Convert to two-way task
              </button>
            </div>
            <div id="project-editor" class="project-editor" contenteditable="true"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('.projects-backdrop').addEventListener('click', closeProjectsModal);
    modal.querySelector('.projects-title-bar .projects-close-btn').addEventListener('click', closeProjectsModal);

    // Toolbar buttons
    modal.querySelectorAll('.projects-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        updateProjectsToolbarState();
        $('#project-editor').focus();
      });
    });

    // Save button
    const saveBtn = modal.querySelector('#project-save-btn');
    saveBtn.addEventListener('click', () => {
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
      doSaveAndFlash();
    });

    // Convert-to-task button (persistent in toolbar)
    const convertBtn = modal.querySelector('#project-convert-btn');
    convertBtn.addEventListener('mousedown', e => e.preventDefault()); // Keep selection
    convertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      convertSelectionToTask();
    });

    // Editor input handler (markdown shortcuts)
    const editor = modal.querySelector('#project-editor');
    editor.addEventListener('input', (e) => {
      handleEditorInput(e);
      markProjectDirty();
    });
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateProjectsToolbarState, 0);
      }
    });

    // Selection change → enable/disable convert button in toolbar
    document.addEventListener('selectionchange', () => {
      if (modal.hidden) return;
      updateProjectsToolbarState();
      updateConvertButtonState();
    });

    // Click on highlights to open linked task
    editor.addEventListener('click', (e) => {
      const highlight = e.target.closest('span.project-task-highlight');
      if (highlight && !highlight.classList.contains('completed')) {
        const taskId = highlight.dataset.taskId;
        if (taskId && window.openEditTaskModal) {
          window.openEditTaskModal(taskId);
        }
      }
    });
  }

  // Open to specific project if requested, otherwise first project
  const projects = getAllProjects();
  if (openToProjectId && projects.find(p => p.id === openToProjectId)) {
    currentProjectId = openToProjectId;
  } else if (projects.length > 0) {
    currentProjectId = projects[0].id;
  } else {
    currentProjectId = null;
  }

  renderProjectsTabs();
  loadCurrentProject();
  modal.hidden = false;
}

export function closeProjectsModal() {
  // Save current project before closing
  saveCurrentProject();
  const modal = $('#projects-modal');
  if (modal) modal.hidden = true;
}

// ============================================================
// TABS
// ============================================================

function renderProjectsTabs() {
  const tabsContainer = $('#projects-tabs');
  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';

  const projects = getAllProjects();

  projects.forEach(project => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `projects-tab${project.id === currentProjectId ? ' active' : ''}`;
    tab.dataset.projectId = project.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'projects-tab-title';
    titleSpan.textContent = project.title;
    tab.appendChild(titleSpan);

    // Delete button (x) on each tab
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'projects-tab-delete';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete project';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete project "${project.title}"?`)) {
        deleteProject(project.id);
        const remaining = getAllProjects();
        currentProjectId = remaining.length > 0 ? remaining[0].id : null;
        renderProjectsTabs();
        loadCurrentProject();
      }
    });
    tab.appendChild(deleteBtn);

    // Double-click to rename
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'projects-tab-rename-input';
      input.value = project.title;
      titleSpan.replaceWith(input);
      input.focus();
      input.select();

      const finishRename = () => {
        const newTitle = input.value.trim() || 'Untitled Project';
        updateProject(project.id, { title: newTitle });
        renderProjectsTabs();
      };
      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = project.title; input.blur(); }
      });
    });

    tab.addEventListener('click', () => {
      if (project.id !== currentProjectId) {
        saveCurrentProject();
        currentProjectId = project.id;
        renderProjectsTabs();
        loadCurrentProject();
      }
    });

    tabsContainer.appendChild(tab);
  });

  // "+" tab to add new project
  const addTab = document.createElement('button');
  addTab.type = 'button';
  addTab.className = 'projects-tab projects-tab-add';
  addTab.title = 'New project';
  addTab.textContent = '+';
  addTab.addEventListener('click', () => {
    const project = createProject('New Project');
    currentProjectId = project.id;
    renderProjectsTabs();
    loadCurrentProject();
    // Auto-focus rename on new tab
    const activeTab = tabsContainer.querySelector('.projects-tab.active .projects-tab-title');
    if (activeTab) activeTab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  tabsContainer.appendChild(addTab);
}

// ============================================================
// EDITOR
// ============================================================

function loadCurrentProject() {
  const editorWrap = $('#projects-editor-wrap');
  const emptyState = $('#projects-empty-state');
  const editor = $('#project-editor');

  if (!currentProjectId) {
    if (editorWrap) editorWrap.hidden = true;
    if (emptyState) emptyState.hidden = false;
    return;
  }

  const project = getProjectById(currentProjectId);
  if (!project) {
    if (editorWrap) editorWrap.hidden = true;
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (editorWrap) editorWrap.hidden = false;
  if (emptyState) emptyState.hidden = true;
  if (editor) {
    editor.innerHTML = project.content || '';
    editor.focus();
  }

  // Reset dirty state for new tab
  projectDirty = false;
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
  const saveBtn = $('#project-save-btn');
  if (saveBtn) saveBtn.classList.remove('dirty', 'saved');
  const saveLabel = $('#project-save-label');
  if (saveLabel) { saveLabel.textContent = ''; saveLabel.classList.remove('visible'); }
}

function saveCurrentProject() {
  if (!currentProjectId) return;
  const editor = $('#project-editor');
  if (!editor) return;
  const project = getProjectById(currentProjectId);
  if (!project) return;
  project.content = editor.innerHTML;
  saveModel();
}

let autoSaveTimer = null;
let projectDirty = false;

function markProjectDirty() {
  projectDirty = true;
  const btn = $('#project-save-btn');
  if (btn) btn.classList.add('dirty');
  // Auto-save after 2 seconds of inactivity
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    doSaveAndFlash();
    autoSaveTimer = null;
  }, 2000);
}

function doSaveAndFlash() {
  if (!projectDirty) return;
  saveCurrentProject();
  projectDirty = false;
  const btn = $('#project-save-btn');
  if (!btn) return;
  btn.classList.remove('dirty');
  btn.classList.add('saved');
  // Show "Saved!" label
  const label = $('#project-save-label');
  if (label) {
    label.textContent = 'Saved!';
    label.classList.add('visible');
  }
  setTimeout(() => {
    btn.classList.remove('saved');
    if (label) {
      label.classList.remove('visible');
      label.textContent = '';
    }
  }, 1500);
}

function updateProjectsToolbarState() {
  const btns = document.querySelectorAll('.projects-toolbar-btn');
  btns.forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}

// ============================================================
// CONVERT BUTTON STATE (toolbar button, not floating)
// ============================================================

function updateConvertButtonState() {
  const btn = $('#project-convert-btn');
  if (!btn) return;

  const editor = $('#project-editor');
  if (!editor) { btn.disabled = true; return; }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    btn.disabled = true;
    return;
  }

  const range = selection.getRangeAt(0);

  // Selection must be inside the project editor
  if (!editor.contains(range.commonAncestorContainer)) {
    btn.disabled = true;
    return;
  }

  // Don't enable if selection is inside an existing highlight
  const startHighlight = range.startContainer.parentElement?.closest('.project-task-highlight');
  const endHighlight = range.endContainer.parentElement?.closest('.project-task-highlight');
  if (startHighlight || endHighlight) {
    btn.disabled = true;
    return;
  }

  const selectedText = selection.toString().trim();
  btn.disabled = !selectedText;
}

// ============================================================
// CONVERT SELECTION TO TASK
// ============================================================

// Move cursor to just after a given node (outside it)
function moveCursorAfterNode(node) {
  const sel = window.getSelection();
  if (!sel) return;
  // Insert a zero-width space after the span so the cursor has somewhere to land
  const spacer = document.createTextNode('\u200B');
  if (node.nextSibling) {
    node.parentNode.insertBefore(spacer, node.nextSibling);
  } else {
    node.parentNode.appendChild(spacer);
  }
  const range = document.createRange();
  range.setStartAfter(spacer);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function convertSelectionToTask() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const editor = $('#project-editor');
  if (!editor) return;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  // Save the range for later wrapping
  const savedRange = range.cloneRange();

  // Open the existing task creation modal with prefilled title
  // We need to intercept the save to add our highlight
  if (!window.openAddTaskModal) return;

  // Store the selection info for the save callback
  window._projectTaskPending = {
    projectId: currentProjectId,
    range: savedRange,
    text: selectedText,
    editor: editor
  };

  // Open the modal with pre-filled title
  window.openAddTaskModalWithCallback(selectedText, (task) => {
    if (!task || !window._projectTaskPending) return;

    const pending = window._projectTaskPending;
    window._projectTaskPending = null;

    // Wrap the selection in a highlight span
    try {
      const span = document.createElement('span');
      span.className = 'project-task-highlight';
      span.dataset.taskId = task.id;
      span.dataset.highlightColor = task.color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
      span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
      span.style.cursor = 'pointer';
      span.contentEditable = 'false';

      pending.range.surroundContents(span);
      moveCursorAfterNode(span);

      // Store project reference on the task
      if (window.updateTask) {
        window.updateTask(task.id, {
          projectHighlight: {
            projectId: pending.projectId
          }
        });
      }

      // Save the updated content
      saveCurrentProject();
    } catch (e) {
      // surroundContents can fail if selection crosses element boundaries
      // Fall back to simple text replacement approach
      const contents = pending.range.extractContents();
      const span = document.createElement('span');
      span.className = 'project-task-highlight';
      span.dataset.taskId = task.id;
      span.dataset.highlightColor = task.color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
      span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
      span.style.cursor = 'pointer';
      span.contentEditable = 'false';
      span.appendChild(contents);
      pending.range.insertNode(span);
      moveCursorAfterNode(span);

      if (window.updateTask) {
        window.updateTask(task.id, {
          projectHighlight: {
            projectId: pending.projectId
          }
        });
      }

      saveCurrentProject();
    }
  });
}
