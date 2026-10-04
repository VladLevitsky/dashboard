// Personal Dashboard - Projects Module
// Project-based notepad with two-way task linking
// Each project is a rich-text editor; selected text can be promoted to a real task
// with a persistent, color-coded highlight that stays in sync.

import { model, editState, currentData } from '../state.js';
import { $, showToast, moveCursorAfterNode } from '../utils.js';
import { handleEditorInput, handleEditorKeydown, createHighlighterButton, attachHighlighterContextMenu, toggleChecklist, isInChecklist, attachChecklistHandler, attachImageResizeHandler, runFormatCommand, safeRichHtml } from './edit-mode.js';
import { saveModel } from '../core/storage.js';
import { TASK_COLORS, TASK_COLOR_LABELS } from '../constants.js';
import { attachImageUpload } from './rich-text-images.js';
import { attachWritingFeatures } from './writing/editor.js';
import { mentionDateItems, insertDateChipAt, dateRowElement } from './writing/menus.js';
import { positionUnderTrigger } from './writing/ui.js';
import { cleanEditorHtml, isEffectivelyEmpty, restoreRange, isInCode } from './writing/dom.js';

// Module state
let currentProjectId = null;

// ============================================================
// @ MENTION AUTOCOMPLETE (shared by projects + meetings)
// ============================================================

let mentionDropdown = null;       // The dropdown DOM element
let mentionEditor = null;         // The editor the mention is active in
let mentionQuery = '';            // Text typed after @
let mentionAnchorNode = null;     // Text node containing the @
let mentionAnchorOffset = null;   // Offset of @ in that text node
let mentionSelectedIndex = -1;    // Keyboard-selected item index
let mentionOnInsert = null;       // Callback after inserting highlight (e.g. save)
let mentionSuppressInput = false; // Suppress input events during DOM manipulation
let mentionKeysInstalled = false;  // onMentionKeydown is on the document (once)

// Priority order for display rows (most important first)
const MENTION_COLOR_ORDER = ['red', 'orange', 'yellow', 'blue'];
const MENTION_COLOR_ROW_LABELS = {
  red: 'Urgent & Important',
  orange: 'Urgent & Not Important',
  yellow: 'Not Urgent & Important',
  blue: 'Not Urgent & Not Important'
};

function getMentionDropdown() {
  if (mentionDropdown) return mentionDropdown;
  mentionDropdown = document.createElement('div');
  mentionDropdown.className = 'task-mention-dropdown';
  mentionDropdown.style.display = 'none';
  document.body.appendChild(mentionDropdown);
  // Prevent clicks inside dropdown from stealing focus from editor
  mentionDropdown.addEventListener('mousedown', e => e.preventDefault());
  return mentionDropdown;
}

function getAllTasksForMention() {
  if (!window.getAllTasks) return [];
  return window.getAllTasks().filter(t => !t.completed);
}

function filterTasks(query) {
  const tasks = getAllTasksForMention();
  if (!query) return tasks;
  const lower = query.toLowerCase();
  return tasks.filter(t => (t.title || '').toLowerCase().includes(lower));
}

function buildMentionRows(query) {
  const filtered = filterTasks(query);
  const dates = mentionDateItems(query); // a Date row when the query reads as one (@fri, @21/12...)
  const dropdown = getMentionDropdown();
  dropdown.innerHTML = '';
  dropdown.classList.toggle('has-dates', dates.length > 0);

  if (filtered.length === 0 && dates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'task-mention-empty';
    empty.textContent = 'No matching tasks';
    dropdown.appendChild(empty);
    mentionSelectedIndex = -1;
    return;
  }

  let flatIndex = 0;
  let colsHost = dropdown;
  if (dates.length) {
    // Date section on top, picked by default (Enter inserts the date chip)
    const section = document.createElement('div');
    section.className = 'task-mention-dates';
    const head = document.createElement('div');
    head.className = 'task-mention-section-title';
    head.textContent = 'Date';
    section.appendChild(head);
    dates.forEach(d => {
      // The same row as the @ dates list in the other editors (menus.js)
      const item = dateRowElement(d, 'task-mention-date');
      item.dataset.flatIndex = flatIndex++;
      item.querySelector('.wr-menu-label')?.classList.add('task-mention-item-title');
      item.addEventListener('click', () => selectMentionDate(d.key));
      section.appendChild(item);
    });
    dropdown.appendChild(section);
    if (filtered.length) {
      colsHost = document.createElement('div');
      colsHost.className = 'task-mention-cols';
      dropdown.appendChild(colsHost);
    }
  }
  MENTION_COLOR_ORDER.forEach(color => {
    const colorTasks = filtered
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
      item.dataset.flatIndex = flatIndex;

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

      item.addEventListener('click', () => selectMentionTask(task));
      col.appendChild(item);
      flatIndex++;
    });

    colsHost.appendChild(col);
  });

  // Reset selection (a date row starts selected)
  mentionSelectedIndex = dates.length ? 0 : -1;
  if (dates.length) dropdown.querySelector('.task-mention-date').classList.add('selected', 'is-selected');
}

// List rows in keyboard order: the Date rows, then the task pills
const MENTION_ROWS = '.task-mention-date, .task-mention-item';

// Under the @ like the writing lists (ui.positionPopup): below the line, above it
// only when there is no room below, shortened (it scrolls) rather than covering the line
function positionDropdown(editor) {
  const dropdown = getMentionDropdown();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) { dropdown.style.display = 'none'; return; }

  let range = null;
  const node = mentionAnchorNode;
  if (node && node.isConnected && editor.contains(node) && node.nodeType === 3 && mentionAnchorOffset < node.data.length) {
    range = document.createRange();
    range.setStart(node, mentionAnchorOffset);
    range.setEnd(node, mentionAnchorOffset + 1);
  }
  dropdown.style.bottom = '';
  dropdown.style.display = 'flex';
  positionUnderTrigger(dropdown, range, editor);
}

function showMentionDropdown(editor, query) {
  buildMentionRows(query);
  positionDropdown(editor);
}

function hideMentionDropdown() {
  const dropdown = getMentionDropdown();
  dropdown.style.display = 'none';
  mentionEditor = null;
  mentionQuery = '';
  mentionAnchorNode = null;
  mentionAnchorOffset = null;
  mentionSelectedIndex = -1;
  mentionOnInsert = null;
}

function selectMentionTask(task) {
  if (!mentionAnchorNode || !mentionEditor) { hideMentionDropdown(); return; }

  // Suppress input events during DOM manipulation to prevent dropdown re-showing
  mentionSuppressInput = true;

  // Remove the @query text from the editor
  const textNode = mentionAnchorNode;
  const atOffset = mentionAnchorOffset;
  const endOffset = atOffset + 1 + mentionQuery.length; // @ + query

  try {
    const text = textNode.textContent;
    // Build new text: before @ + after query
    const before = text.substring(0, atOffset);
    const after = text.substring(endOffset);
    textNode.textContent = before + after;

    // Insert the highlight span at the @ position
    const span = document.createElement('span');
    span.className = 'project-task-highlight';
    span.dataset.taskId = task.id;
    span.dataset.highlightColor = task.color;
    span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
    span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
    span.style.cursor = 'pointer';
    span.contentEditable = 'false';
    span.textContent = task.title;

    // Split the text node at atOffset and insert span
    if (atOffset < textNode.textContent.length) {
      const afterNode = textNode.splitText(atOffset);
      textNode.parentNode.insertBefore(span, afterNode);
    } else {
      textNode.parentNode.insertBefore(span, textNode.nextSibling);
    }

    // Move cursor after the span
    moveCursorAfterNode(span);
  } catch (e) {
    // Fallback: just insert at cursor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.className = 'project-task-highlight';
      span.dataset.taskId = task.id;
      span.dataset.highlightColor = task.color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
      span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
      span.style.cursor = 'pointer';
      span.contentEditable = 'false';
      span.textContent = task.title;
      range.insertNode(span);
      moveCursorAfterNode(span);
    }
  }

  const cb = mentionOnInsert;
  hideMentionDropdown();
  if (cb) cb(task);
  // Clear suppression after DOM settles
  setTimeout(() => { mentionSuppressInput = false; }, 50);
}

// Replace @query with a date chip (writing/menus.js, undoable)
function selectMentionDate(dateKey) {
  if (!mentionAnchorNode || !mentionEditor) { hideMentionDropdown(); return; }
  const editor = mentionEditor;
  const node = mentionAnchorNode;
  const start = mentionAnchorOffset;
  const end = start + 1 + mentionQuery.length;
  hideMentionDropdown();
  mentionSuppressInput = true;
  insertDateChipAt(editor, node, start, end, dateKey);
  setTimeout(() => { mentionSuppressInput = false; }, 50);
}

function highlightSelectedItem(index) {
  const dropdown = getMentionDropdown();
  const items = dropdown.querySelectorAll(MENTION_ROWS);
  items.forEach(el => el.classList.remove('selected', 'is-selected'));
  if (index >= 0 && index < items.length) {
    // is-selected: the date rows' writing-menu look (pills read .selected)
    items[index].classList.add('selected', 'is-selected');
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

function getMentionContext(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (!editor.contains(node)) return null;
  if (isInCode(node, editor)) return null; // no task pills inside code

  const text = node.textContent;
  const cursor = sel.anchorOffset;

  // Search backwards from cursor for @
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      // Check that @ is at start of text or preceded by a space/newline
      if (i === 0 || /\s/.test(text[i - 1])) {
        return {
          node: node,
          atOffset: i,
          query: text.substring(i + 1, cursor)
        };
      }
      return null; // @ is mid-word
    }
    // Stop searching if we hit a space (no @ in this word segment)
    // Actually we should keep going - the query can contain spaces
    // But if we hit a newline, stop
    if (ch === '\n') return null;
  }
  return null;
}

/**
 * Attach @ mention autocomplete to a contenteditable editor.
 * Call this once per editor setup.
 * @param {HTMLElement} editor - The contenteditable element
 * @param {Function} onInsert - Called after a task mention is inserted (for saving)
 */
export function attachTaskMention(editor, onInsert) {
  editor._taskMention = true; // writing/menus.js: @ dates live in this list here
  editor.addEventListener('input', () => {
    if (mentionSuppressInput) return;
    const ctx = getMentionContext(editor);
    if (ctx) {
      mentionEditor = editor;
      mentionAnchorNode = ctx.node;
      mentionAnchorOffset = ctx.atOffset;
      mentionQuery = ctx.query;
      mentionOnInsert = onInsert || null;
      showMentionDropdown(editor, ctx.query);
    } else {
      if (mentionEditor === editor) hideMentionDropdown();
    }
  });

  // List keys: one document capture listener for every editor (see onMentionKeydown)
  if (!mentionKeysInstalled) {
    mentionKeysInstalled = true;
    document.addEventListener('keydown', onMentionKeydown, true);
  }

  // Hide dropdown if editor loses focus
  editor.addEventListener('blur', () => {
    // Small delay to allow click on dropdown items; keep it when focus came
    // back in the meantime (a closed popover hands the caret back)
    setTimeout(() => {
      if (mentionEditor !== editor) return;
      const active = document.activeElement;
      if (active && (active === editor || editor.contains(active))) return;
      if (!getMentionDropdown().matches(':hover')) hideMentionDropdown();
    }, 200);
  });
}

// Keys for the open list. Capture on the document runs before the editor's own
// listeners (the writing key hooks), so table cells, toggle titles and boxes
// that end the doc can't take Enter / Tab / arrows from the list, and Esc closes
// the list (even "No matching tasks") before focus mode or a notepad prompt hear it
function onMentionKeydown(e) {
  const dropdown = mentionDropdown;
  if (!dropdown || dropdown.style.display === 'none' || !mentionEditor) return;
  if (e.isComposing || e.keyCode === 229) return;
  const target = e.target;
  if (!(target instanceof Node) || !mentionEditor.contains(target)) return;
  const consume = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

  if (e.key === 'Escape') {
    consume();
    hideMentionDropdown();
    return;
  }

  const items = dropdown.querySelectorAll(MENTION_ROWS);
  const count = items.length;
  if (count === 0) return;

  if (e.key === 'ArrowDown') {
    consume();
    mentionSelectedIndex = (mentionSelectedIndex + 1) % count;
    highlightSelectedItem(mentionSelectedIndex);
  } else if (e.key === 'ArrowUp') {
    consume();
    mentionSelectedIndex = mentionSelectedIndex <= 0 ? count - 1 : mentionSelectedIndex - 1;
    highlightSelectedItem(mentionSelectedIndex);
  } else if ((e.key === 'Enter' || e.key === 'Tab') && mentionSelectedIndex >= 0 && mentionSelectedIndex < count) {
    consume();
    const item = items[mentionSelectedIndex];
    if (item.dataset.date) { selectMentionDate(item.dataset.date); return; }
    const task = getAllTasksForMention().find(t => t.id === item.dataset.taskId);
    if (task) selectMentionTask(task);
  }
}

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

// Color mapping for highlights (exported for meetings module)
export const HIGHLIGHT_COLORS = {
  blue: 'rgba(59, 130, 246, 0.25)',
  yellow: 'rgba(234, 179, 8, 0.25)',
  orange: 'rgba(249, 115, 22, 0.25)',
  red: 'rgba(239, 68, 68, 0.25)',
  completed: 'rgba(34, 197, 94, 0.3)'
};

export const HIGHLIGHT_BORDER_COLORS = {
  blue: 'rgba(59, 130, 246, 0.6)',
  yellow: 'rgba(234, 179, 8, 0.6)',
  orange: 'rgba(249, 115, 22, 0.6)',
  red: 'rgba(239, 68, 68, 0.6)',
  completed: 'rgba(34, 197, 94, 0.6)'
};

// Remove a highlight from project content (revert to plain text)
export function removeProjectTaskHighlight(projectId, taskId) {
  // Helper to strip highlight spans from HTML content
  function stripHighlight(content) {
    if (!content) return content;
    const temp = document.createElement('div');
    temp.innerHTML = safeRichHtml(content);
    temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
    return temp.innerHTML;
  }

  // Always update the real model so saveModel() persists the change
  const realProject = (model.projects || []).find(p => p.id === projectId);
  if (realProject && realProject.content) {
    realProject.content = stripHighlight(realProject.content);
  }

  // Also update working copy if in edit mode
  if (editState.enabled && editState.working) {
    const wProject = (editState.working.projects || []).find(p => p.id === projectId);
    if (wProject && wProject.content) {
      wProject.content = stripHighlight(wProject.content);
    }
  }

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
  temp.innerHTML = safeRichHtml(project.content);
  temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
    span.dataset.highlightColor = 'completed';
    span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
    span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS.completed;
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
        span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS.completed;
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
      span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS[color];
      span.classList.remove('completed');
    }
    // Completed/removed highlights are handled by their respective functions
  });

  // Also save updated content
  if (currentProjectId) {
    const project = getProjectById(currentProjectId);
    if (project) {
      project.content = projectEditorHtml(editor);
      saveModel();
    }
  }
}

// ============================================================
// PROJECTS MODAL
// ============================================================

export function openProjectsModal(openToProjectId) {
  let modal = $('#projects-modal');
  const wasOpen = !!(modal && !modal.hidden);

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
              <button type="button" class="task-desc-toolbar-btn projects-toolbar-btn projects-checklist-btn" title="Checklist">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="3.5"/><line x1="14" y1="6.5" x2="21" y2="6.5"/><rect x="3" y="14" width="7" height="7" rx="3.5"/><line x1="14" y1="17.5" x2="21" y2="17.5"/><polyline points="4.5 17 6 18.5 8.5 15.5" stroke-width="1.5"/></svg>
              </button>
              <div class="projects-toolbar-spacer"></div>
              <span class="project-save-label" id="project-save-label"></span>
              <button type="button" class="project-save-btn" id="project-save-btn" title="Save">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
              </button>
              <button type="button" class="project-hyperlink-btn" id="project-hyperlink-btn" title="Hyperlink selected text" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </button>
              <button type="button" class="project-convert-task-btn" id="project-convert-btn" title="Convert selected text to a linked task" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
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
        if (btn.classList.contains('projects-checklist-btn')) {
          runFormatCommand($('#project-editor'), 'checklist');
          updateProjectsToolbarState();
          $('#project-editor').focus();
          return;
        }
        runFormatCommand($('#project-editor'), btn.dataset.cmd);
        updateProjectsToolbarState();
        $('#project-editor').focus();
      });
    });

    // Highlighter button — insert after the checklist button, before spacer
    const projectsToolbar = modal.querySelector('#projects-editor-toolbar');
    const toolbarSpacer = projectsToolbar.querySelector('.projects-toolbar-spacer');
    const hlDivider = document.createElement('div');
    hlDivider.className = 'task-desc-toolbar-divider';
    projectsToolbar.insertBefore(hlDivider, toolbarSpacer);
    projectsToolbar.insertBefore(createHighlighterButton(), toolbarSpacer);

    // Checklist click handler on project editor
    const projectEditor = modal.querySelector('#project-editor');
    attachChecklistHandler(projectEditor);
    attachImageResizeHandler(projectEditor);
    attachImageUpload(projectEditor, { label: 'Project', getTitle: () => getProjectById(currentProjectId)?.title });

    // Highlighter context menu on project editor
    attachHighlighterContextMenu(projectEditor, {
      linkTask: true,
      onTaskLinked: (task) => {
        if (window.updateTask) {
          window.updateTask(task.id, { projectHighlight: { projectId: currentProjectId } });
        }
        markProjectDirty();
      }
    });

    // Save button
    const saveBtn = modal.querySelector('#project-save-btn');
    saveBtn.addEventListener('click', () => {
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
      doSaveAndFlash();
    });

    // Hyperlink button
    const hyperlinkBtn = modal.querySelector('#project-hyperlink-btn');
    hyperlinkBtn.addEventListener('mousedown', e => e.preventDefault());
    hyperlinkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hyperlinkSelection($('#project-editor'));
      markProjectDirty();
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
      handleEditorKeydown(e);
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateProjectsToolbarState, 0);
      }
    });

    // @ mention autocomplete for linking existing tasks
    attachTaskMention(editor, (task) => {
      if (window.updateTask) {
        window.updateTask(task.id, {
          projectHighlight: { projectId: currentProjectId }
        });
      }
      markProjectDirty();
    });

    // Selection change → enable/disable convert button in toolbar
    document.addEventListener('selectionchange', () => {
      if (modal.hidden) return;
      updateProjectsToolbarState();
      updateConvertButtonState();
    });

    // Writing features (FULL tier). Ctrl+S saves right away (with the flash)
    attachWritingFeatures(editor, {
      id: 'projects',
      tier: 'full',
      toolbar: projectsToolbar,
      getTitle: () => getProjectById(currentProjectId)?.title || 'Untitled project',
      getDocMeta: () => ({ kind: 'Project', title: getProjectById(currentProjectId)?.title || 'Untitled project' }),
      getDocId: () => currentProjectId,
      onChange: () => markProjectDirty(),
      onSave: () => {
        if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
        projectDirty = true;
        doSaveAndFlash();
      },
      linkTask: true,
      makeTask: (text, range) => {
        restoreRange(range, editor);
        convertSelectionToTask();
      }
    });

    // Click on highlights to open linked task, click on links to open URL
    editor.addEventListener('click', (e) => {
      // Hyperlinks — open in new tab
      const link = e.target.closest('a[href]');
      if (link && editor.contains(link)) {
        e.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
        return;
      }
      // Task highlights
      const highlight = e.target.closest('span.project-task-highlight');
      if (highlight && !highlight.classList.contains('completed')) {
        const taskId = highlight.dataset.taskId;
        if (taskId && window.openEditTaskModal) {
          window.openEditTaskModal(taskId);
        }
      }
    });
  }

  // Already open (a [[ link from inside it): keep the open project's edits before reloading
  if (wasOpen && currentProjectId) saveCurrentProject();

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
    editor.innerHTML = safeRichHtml(project.content);
    // Reconcile task highlights based on actual task status
    if (window.reconcileTaskHighlights) {
      window.reconcileTaskHighlights(editor);
      const reconciled = editor.innerHTML;
      if (reconciled !== (project.content || '')) {
        project.content = reconciled;
        saveModel();
      }
    }
    if (editor._wr) editor._wr.loaded();
    editor.focus();
    // The old doc's caret went with it (no selectionchange): B / I / U follow the new one
    updateProjectsToolbarState();
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
  project.content = projectEditorHtml(editor);
  saveModel();
}

// Canonical HTML: no image-resize wrapper, no writing UI, R2 images keep only
// their reference; '' when nothing is in it (<div><br></div>, NBSP...)
function projectEditorHtml(editor) {
  const html = cleanEditorHtml(editor);
  return isEffectivelyEmpty(html) ? '' : html;
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
    if (btn.classList.contains('projects-checklist-btn')) {
      btn.classList.toggle('active', isInChecklist());
      return;
    }
    const cmd = btn.dataset.cmd;
    if (cmd) btn.classList.toggle('active', document.queryCommandState(cmd) && !(cmd === 'insertUnorderedList' && isInChecklist()));
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

  // Also update hyperlink button
  const hlBtn = $('#project-hyperlink-btn');
  if (hlBtn) hlBtn.disabled = !selectedText;
}

// ============================================================
// CONVERT SELECTION TO TASK
// ============================================================


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

// ============================================================
// HYPERLINK (shared utility for projects + meetings)
// ============================================================

// Wraps the current selection in an <a> tag. `editor` is the contenteditable element.
export function hyperlinkSelection(editor) {
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  const selectedText = sel.toString().trim();
  if (!selectedText) return;

  // Check if already inside a link
  let node = range.startContainer;
  while (node && node !== editor) {
    if (node.tagName === 'A') {
      // Already a link — offer to remove
      const remove = confirm('This text is already a link. Remove the hyperlink?');
      if (remove) {
        const text = document.createTextNode(node.textContent);
        node.parentNode.replaceChild(text, node);
      }
      return;
    }
    node = node.parentNode;
  }

  const url = prompt('Enter URL:', 'https://');
  if (!url || url === 'https://') return;

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  try {
    range.surroundContents(a);
  } catch (e) {
    const contents = range.extractContents();
    a.appendChild(contents);
    range.insertNode(a);
  }

  // Move cursor after the link
  moveCursorAfterNode(a);
}

// Check if selection is valid for hyperlinking inside a given editor
export function canHyperlink(editor) {
  if (!editor) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  return !!sel.toString().trim();
}

// ============================================================
// MEETING HIGHLIGHT MANAGEMENT (parallel to project highlights)
// ============================================================

function getMeetingById(id) {
  const data = currentData();
  return (data.meetings || []).find(m => m.id === id);
}

export function removeMeetingTaskHighlight(meetingId, taskId) {
  function stripHighlight(desc) {
    if (!desc) return desc;
    const temp = document.createElement('div');
    temp.innerHTML = safeRichHtml(desc);
    temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
    return temp.innerHTML;
  }

  // Always update the real model
  const realMeeting = (model.meetings || []).find(m => m.id === meetingId);
  if (realMeeting && realMeeting.description) {
    realMeeting.description = stripHighlight(realMeeting.description);
  }

  // Also update working copy if in edit mode
  if (editState.enabled && editState.working) {
    const wMeeting = (editState.working.meetings || []).find(m => m.id === meetingId);
    if (wMeeting && wMeeting.description) {
      wMeeting.description = stripHighlight(wMeeting.description);
    }
  }

  saveModel();

  // Update live editor if this meeting is currently being edited
  const liveEditor = document.querySelector('#meetings-inline-desc-editor');
  if (liveEditor) {
    liveEditor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
  }

  // Update view mode panel if visible
  const viewContent = document.querySelector('#meetings-view-section .meetings-view-content');
  if (viewContent) {
    viewContent.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
  }
}

export function markMeetingTaskHighlightCompleted(meetingId, taskId) {
  const meeting = getMeetingById(meetingId);
  if (!meeting || !meeting.description) return;

  const temp = document.createElement('div');
  temp.innerHTML = safeRichHtml(meeting.description);
  temp.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
    span.dataset.highlightColor = 'completed';
    span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
    span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS.completed;
    span.classList.add('completed');
  });
  meeting.description = temp.innerHTML;
  saveModel();

  const liveEditor = document.querySelector('#meetings-inline-desc-editor');
  if (liveEditor) {
    liveEditor.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      span.dataset.highlightColor = 'completed';
      span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
      span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS.completed;
      span.classList.add('completed');
    });
  }

  // Update view mode panel if visible
  const viewContent = document.querySelector('#meetings-view-section .meetings-view-content');
  if (viewContent) {
    viewContent.querySelectorAll(`span.project-task-highlight[data-task-id="${taskId}"]`).forEach(span => {
      span.dataset.highlightColor = 'completed';
      span.style.backgroundColor = HIGHLIGHT_COLORS.completed;
      span.style.borderBottom = '2px solid ' + HIGHLIGHT_BORDER_COLORS.completed;
      span.classList.add('completed');
    });
  }
}
