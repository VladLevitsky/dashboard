// Personal Dashboard - Meetings Module
// Manages meetings with two categories: one-time and routine
// Each meeting has a name, description, links, and type

import { currentData } from '../state.js';
import { $, showToast, moveCursorAfterNode, normalizeDescHtml, escapeAttr } from '../utils.js';
import { handleEditorInput, handleEditorKeydown, createHighlighterButton, attachHighlighterContextMenu } from './edit-mode.js';
import { saveModel } from '../core/storage.js';
import { HIGHLIGHT_COLORS, HIGHLIGHT_BORDER_COLORS, hyperlinkSelection, canHyperlink, attachTaskMention } from './projects.js';
import { uploadFile, openFile } from '../core/file-service.js';

// Module state
let meetingsEditingId = null;
let currentMeetingSelHandler = null;
let meetingsInitialState = null; // For unsaved changes detection
let meetingsInEditMode = false; // Whether the edit/add form is showing

// ============================================================
// MEETINGS CRUD
// ============================================================

function getAllMeetings() {
  const data = currentData();
  return data.meetings || [];
}

function createMeeting(title, type, description, links) {
  const data = currentData();
  data.meetings = data.meetings || [];
  const meeting = {
    id: 'meeting-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    title: title || '',
    type: type || 'one-time',
    description: description || '',
    links: links || []
  };
  data.meetings.push(meeting);
  saveModel();
  return meeting;
}

function updateMeeting(meetingId, updates) {
  const meetings = getAllMeetings();
  const meeting = meetings.find(m => m.id === meetingId);
  if (!meeting) return null;

  // Queue old R2 files for cleanup if files array is being replaced
  if (updates.files !== undefined && meeting.files) {
    const newFileIds = new Set(
      (updates.files || []).filter(f => f.fileId).map(f => f.fileId)
    );
    const removedFileIds = meeting.files
      .filter(f => f.fileId && !newFileIds.has(f.fileId))
      .map(f => f.fileId);
    if (removedFileIds.length > 0 && window.cleanupOrphanedR2Files) {
      window.cleanupOrphanedR2Files(removedFileIds);
    }
  }

  Object.assign(meeting, updates);
  saveModel();
  return meeting;
}

function deleteMeeting(meetingId) {
  const data = currentData();
  const meetings = data.meetings || [];
  const idx = meetings.findIndex(m => m.id === meetingId);
  if (idx === -1) return false;
  // Collect R2 fileIds for deferred cleanup
  const meeting = meetings[idx];
  const orphanFileIds = [];
  if (meeting.files) {
    meeting.files.forEach(f => {
      if (f.fileId) orphanFileIds.push(f.fileId);
    });
  }
  meetings.splice(idx, 1);
  saveModel();

  if (orphanFileIds.length > 0 && window.cleanupOrphanedR2Files) {
    window.cleanupOrphanedR2Files(orphanFileIds);
  }
  return true;
}

// ============================================================
// MEETINGS MODAL
// ============================================================

export function openMeetingsModal() {
  // Clean up old editor modal if it exists from previous version
  const oldEditor = $('#meeting-editor-modal');
  if (oldEditor) oldEditor.remove();

  let modal = $('#meetings-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'meetings-modal';
    modal.className = 'meetings-modal';
    modal.innerHTML = `
      <div class="meetings-backdrop"></div>
      <div class="meetings-dialog">
        <div class="meetings-header">
          <h4 id="meetings-title">Meetings</h4>
          <div class="meetings-header-controls">
            <button type="button" class="meetings-add-circle" id="meetings-add-btn" title="Add new meeting">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
              </svg>
            </button>
            <button type="button" class="meetings-close-btn" title="Close">&times;</button>
          </div>
        </div>
        <div class="meetings-body">
          <div class="meetings-sidebar" id="meetings-columns">
            <div class="meetings-column">
              <div class="meetings-column-title">One-Time</div>
              <div class="meetings-column-items" id="meetings-onetime-items"></div>
            </div>
            <div class="meetings-column">
              <div class="meetings-column-title">Recurring</div>
              <div class="meetings-column-items" id="meetings-recurring-items"></div>
            </div>
          </div>
          <div class="meetings-view-section" id="meetings-view-section" hidden></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.meetings-backdrop').addEventListener('click', closeMeetingsModal);
    modal.querySelector('.meetings-close-btn').addEventListener('click', closeMeetingsModal);

    $('#meetings-add-btn').addEventListener('click', () => {
      if (meetingsHasChanges()) {
        if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
          return;
        }
      }
      showMeetingsEditMode(null);
    });

    // Track toolbar state for inline description editor
    document.addEventListener('selectionchange', () => {
      const editor = $('#meetings-inline-desc-editor');
      if (editor && modal && !modal.hidden) {
        updateInlineToolbarState();
      }
    });
  }

  // Close other slide-out panels
  if (window.closeQuickAccess) window.closeQuickAccess();
  if (window.closeTasksSummaryModal) window.closeTasksSummaryModal();

  meetingsEditingId = null;
  showMeetingsMainView();
  modal.hidden = false;
}

// --- Check if meetings edit form has unsaved changes
function meetingsHasChanges() {
  if (!meetingsInEditMode || !meetingsInitialState) return false;
  const name = ($('#meetings-inline-name')?.value || '').trim();
  const type = $('#meetings-inline-type')?.value || 'one-time';
  const desc = normalizeDescHtml($('#meetings-inline-desc-editor')?.innerHTML || '') || '';
  const linkRows = document.querySelectorAll('#meetings-inline-link-rows .meeting-link-row');
  const links = [];
  linkRows.forEach(row => {
    const t = row.querySelector('.meeting-link-title');
    const u = row.querySelector('.meeting-link-url');
    links.push({ title: (t?.value || '').trim(), url: (u?.value || '').trim() });
  });
  if (name !== meetingsInitialState.name) return true;
  if (type !== meetingsInitialState.type) return true;
  if (desc !== meetingsInitialState.description) return true;
  if (JSON.stringify(links) !== JSON.stringify(meetingsInitialState.links)) return true;
  return false;
}

export function closeMeetingsModal(force) {
  if (!force && meetingsHasChanges()) {
    if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
      return;
    }
  }
  const modal = $('#meetings-modal');
  if (modal) modal.hidden = true;
  meetingsEditingId = null;
  meetingsInEditMode = false;
  meetingsInitialState = null;
  if (currentMeetingSelHandler) {
    document.removeEventListener('selectionchange', currentMeetingSelHandler);
    currentMeetingSelHandler = null;
  }
}

// ============================================================
// MAIN VIEW (list only, no detail)
// ============================================================

function showMeetingsMainView() {
  meetingsInEditMode = false;
  meetingsInitialState = null;
  $('#meetings-columns').hidden = false;
  $('#meetings-view-section').hidden = true;
  $('#meetings-title').textContent = 'Meetings';

  const items = document.querySelectorAll('#meetings-modal .meetings-item');
  items.forEach(el => el.classList.remove('active'));
  renderMeetingsList();
}

// ============================================================
// VIEW MODE (read-only detail in right panel)
// ============================================================

function showMeetingsViewMode(meeting) {
  if (!meeting) return;
  meetingsInEditMode = false;
  meetingsInitialState = null;
  meetingsEditingId = meeting.id;

  $('#meetings-columns').hidden = false;
  $('#meetings-title').textContent = 'Meetings';

  // Highlight selected item
  const items = document.querySelectorAll('#meetings-modal .meetings-item');
  items.forEach(el => el.classList.toggle('active', el.dataset.meetingId === meeting.id));

  const viewSection = $('#meetings-view-section');
  viewSection.hidden = false;
  viewSection.innerHTML = `
    <div class="meetings-view-type">${meeting.type === 'routine' ? 'Recurring' : 'One-Time'}</div>
    <h3 class="meetings-view-title">${escapeAttr(meeting.title || 'Untitled')}</h3>
    <div class="meetings-view-content">${meeting.description || '<span style="color:var(--muted)">No description</span>'}</div>
    <div class="meetings-view-links" id="meetings-view-links"></div>
    <div class="meetings-view-actions">
      <button type="button" class="meetings-view-icon-btn" id="meetings-view-edit" title="Edit">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      <button type="button" class="meetings-view-icon-btn meetings-view-icon-danger" id="meetings-view-delete" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
      <button type="button" class="meetings-view-icon-btn" id="meetings-view-close" title="Back to list">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  // Render links
  const linksContainer = $('#meetings-view-links');
  const links = meeting.links || [];
  if (links.length > 0) {
    links.forEach(link => {
      if (!link.url) return;
      const a = document.createElement('a');
      a.className = 'meetings-view-link';
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        ${escapeAttr(link.title || link.url)}
      `;
      linksContainer.appendChild(a);
    });
  }

  // Reconcile task highlights based on actual task status
  const viewContent = viewSection.querySelector('.meetings-view-content');
  if (viewContent && window.reconcileTaskHighlights) {
    window.reconcileTaskHighlights(viewContent);
    // Persist any changes back
    const reconciled = viewContent.innerHTML;
    if (meeting.description && reconciled !== meeting.description) {
      meeting.description = reconciled;
      saveModel();
    }
  }

  // Click on task highlights in view mode to open linked task
  if (viewContent) {
    viewContent.addEventListener('click', (e) => {
      const highlight = e.target.closest('span.project-task-highlight');
      if (highlight && !highlight.classList.contains('completed')) {
        const taskId = highlight.dataset.taskId;
        if (taskId && window.openEditTaskModal) {
          window.openEditTaskModal(taskId);
        }
      }
    });
  }

  // Wire view mode buttons
  $('#meetings-view-edit').addEventListener('click', () => {
    const m = getAllMeetings().find(x => x.id === meetingsEditingId);
    if (m) showMeetingsEditMode(m);
  });

  $('#meetings-view-delete').addEventListener('click', () => {
    if (meetingsEditingId && confirm('Delete this meeting?')) {
      deleteMeeting(meetingsEditingId);
      meetingsEditingId = null;
      showToast('Meeting deleted');
      showMeetingsMainView();
    }
  });

  $('#meetings-view-close').addEventListener('click', () => {
    meetingsEditingId = null;
    showMeetingsMainView();
  });
}

// ============================================================
// EDIT / ADD MODE (inline form in right panel)
// ============================================================

function showMeetingsEditMode(meeting) {
  const isNew = !meeting;
  const meetingData = meeting || {};
  meetingsEditingId = meetingData.id || null;

  $('#meetings-columns').hidden = false;
  $('#meetings-title').textContent = isNew ? 'Add A Meeting' : 'Meetings';

  // Highlight selected item
  const items = document.querySelectorAll('#meetings-modal .meetings-item');
  items.forEach(el => el.classList.toggle('active', !isNew && el.dataset.meetingId === meetingData.id));

  const viewSection = $('#meetings-view-section');
  viewSection.hidden = false;
  viewSection.innerHTML = `
    <div class="meeting-editor-top-row">
      <div class="meeting-editor-field meeting-editor-name-col">
        <label for="meetings-inline-name">Meeting Name</label>
        <input type="text" id="meetings-inline-name" placeholder="Enter meeting name..." />
      </div>
      <div class="meeting-editor-field meeting-editor-type-col">
        <label for="meetings-inline-type">Type</label>
        <select id="meetings-inline-type">
          <option value="one-time">One-Time</option>
          <option value="routine">Recurring</option>
        </select>
      </div>
      <div class="meeting-editor-field meeting-editor-date-col">
        <label for="meetings-inline-date">Date</label>
        <input type="date" id="meetings-inline-date" />
      </div>
    </div>
    <div class="meeting-editor-recurrence-row">
      <div class="meeting-editor-field" id="meetings-recurrence-section" style="display: none;">
        <label for="meetings-inline-repeat">Repeat</label>
        <select id="meetings-inline-repeat">
          <option value="none">No repeat</option>
          <option value="weekly">Every # of weeks</option>
          <option value="monthly">Every month</option>
        </select>
      </div>
      <div class="meeting-editor-field" id="meetings-weekly-options" style="display: none;">
        <label for="meetings-inline-weekly-type">Weekly option</label>
        <select id="meetings-inline-weekly-type">
          <option value="1">Every 1 week</option>
          <option value="2">Every 2 weeks</option>
          <option value="3">Every 3 weeks</option>
        </select>
      </div>
      <div class="meeting-editor-field" id="meetings-monthly-options" style="display: none;">
        <label for="meetings-inline-monthly-type">Monthly option</label>
        <select id="meetings-inline-monthly-type">
          <option value="sameDay">Same day of month</option>
          <option value="firstWeekday">First weekday of month</option>
        </select>
      </div>
    </div>
    <div class="meeting-links-section">
      <label>Links</label>
      <div class="meeting-link-rows" id="meetings-inline-link-rows"></div>
      <button type="button" class="meeting-add-link-btn" id="meetings-inline-add-link">+ Add Link</button>
    </div>
    <div class="meeting-files-section">
      <label>Files</label>
      <div class="meeting-file-rows" id="meetings-inline-file-rows"></div>
      <div class="meeting-file-add-row">
        <button type="button" class="meeting-add-link-btn" id="meetings-inline-add-file">+ Add File</button>
        <input type="file" id="meetings-inline-file-input" hidden />
      </div>
    </div>
    <div class="meeting-editor-description meeting-editor-description-expanded">
      <label>Description</label>
      <div class="task-desc-editor-wrap" id="meetings-inline-desc-wrap">
        <div class="task-desc-toolbar" id="meetings-inline-toolbar">
          <button type="button" class="task-desc-toolbar-btn meetings-inline-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
          <button type="button" class="task-desc-toolbar-btn meetings-inline-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
          <button type="button" class="task-desc-toolbar-btn meetings-inline-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
          <div class="task-desc-toolbar-divider"></div>
          <button type="button" class="task-desc-toolbar-btn meetings-inline-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
          </button>
          <button type="button" class="task-desc-toolbar-btn meetings-inline-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
          </button>
          <div class="task-desc-toolbar-divider"></div>
          <button type="button" class="meeting-hyperlink-btn" id="meeting-hyperlink-btn" title="Select text, then click to add a hyperlink" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </button>
          <button type="button" class="meeting-convert-task-btn" id="meeting-convert-btn" title="Select text, then click to convert into a linked task" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </button>
        </div>
        <div id="meetings-inline-desc-editor" class="task-desc-editor" contenteditable="true"></div>
      </div>
    </div>
    <div class="meetings-view-actions meetings-edit-actions">
      ${!isNew ? `<button type="button" id="meetings-inline-delete" class="meetings-view-icon-btn meetings-view-icon-danger" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>` : '<div></div>'}
      <div class="meetings-edit-actions-right">
        <button type="button" id="meetings-inline-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="meetings-inline-save" class="btn-primary">Save</button>
      </div>
    </div>
  `;

  // Populate fields
  $('#meetings-inline-name').value = meetingData.title || '';
  $('#meetings-inline-type').value = meetingData.type || 'one-time';

  // Populate date and recurrence
  $('#meetings-inline-date').value = meetingData.date || '';
  const meetingType = meetingData.type || 'one-time';
  const recurrenceSection = $('#meetings-recurrence-section');
  const weeklyOpts = $('#meetings-weekly-options');
  const monthlyOpts = $('#meetings-monthly-options');

  if (meetingType === 'routine') {
    recurrenceSection.style.display = '';
    const repeat = meetingData.repeat || 'none';
    $('#meetings-inline-repeat').value = repeat;
    if (repeat === 'weekly') {
      weeklyOpts.style.display = '';
      $('#meetings-inline-weekly-type').value = (meetingData.repeatWeeks || 1).toString();
    } else if (repeat === 'monthly') {
      monthlyOpts.style.display = '';
      $('#meetings-inline-monthly-type').value = meetingData.repeatMonthlyType || 'sameDay';
    }
  }

  // Type change toggles recurrence visibility
  $('#meetings-inline-type').addEventListener('change', () => {
    const isRecurring = $('#meetings-inline-type').value === 'routine';
    recurrenceSection.style.display = isRecurring ? '' : 'none';
    if (!isRecurring) {
      weeklyOpts.style.display = 'none';
      monthlyOpts.style.display = 'none';
    }
  });

  // Repeat change toggles weekly/monthly options
  $('#meetings-inline-repeat').addEventListener('change', () => {
    const val = $('#meetings-inline-repeat').value;
    weeklyOpts.style.display = val === 'weekly' ? '' : 'none';
    monthlyOpts.style.display = val === 'monthly' ? '' : 'none';
  });

  // Populate links
  (meetingData.links || []).forEach(link => addInlineLinkRow(link.title, link.url));

  // Populate files
  (meetingData.files || []).forEach(f => addInlineFileRow(f.fileId, f.fileName));

  // Wire file add button
  const fileAddBtn = $('#meetings-inline-add-file');
  const fileInput = $('#meetings-inline-file-input');
  if (fileAddBtn && fileInput) {
    fileAddBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const result = await uploadFile(file, file.name);
      if (result.ok && result.fileId) {
        addInlineFileRow(result.fileId, file.name);
        showToast('File attached');
      } else {
        showToast('File upload failed: ' + (result.error || 'Unknown error'));
      }
      fileInput.value = '';
    });
  }

  // Populate description
  const descEditorEl = $('#meetings-inline-desc-editor');
  descEditorEl.innerHTML = meetingData.description || '';
  if (window.reconcileTaskHighlights) {
    window.reconcileTaskHighlights(descEditorEl);
    const reconciled = descEditorEl.innerHTML;
    if (reconciled !== (meetingData.description || '')) {
      const m = getAllMeetings().find(x => x.id === meetingsEditingId);
      if (m) { m.description = reconciled; saveModel(); }
    }
  }

  // Wire toolbar buttons
  viewSection.querySelectorAll('.meetings-inline-toolbar-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      updateInlineToolbarState();
      $('#meetings-inline-desc-editor').focus();
    });
  });

  // Highlighter button — insert before hyperlink button in toolbar
  const meetingsToolbar = $('#meetings-inline-toolbar');
  const meetingHyperlinkRef = $('#meeting-hyperlink-btn');
  if (meetingsToolbar && meetingHyperlinkRef) {
    const hlDiv = document.createElement('div');
    hlDiv.className = 'task-desc-toolbar-divider';
    meetingsToolbar.insertBefore(hlDiv, meetingHyperlinkRef);
    meetingsToolbar.insertBefore(createHighlighterButton(), meetingHyperlinkRef);
  }

  // Highlighter context menu on meetings editor
  attachHighlighterContextMenu($('#meetings-inline-desc-editor'), {
    linkTask: true,
    onTaskLinked: (task) => {
      if (window.updateTask) {
        window.updateTask(task.id, { meetingHighlight: { meetingId: meetingsEditingId } });
      }
      const meeting = getAllMeetings().find(m => m.id === meetingsEditingId);
      if (meeting) {
        meeting.description = $('#meetings-inline-desc-editor').innerHTML;
        saveModel();
      }
    }
  });

  // Hyperlink button
  const hyperlinkBtn = $('#meeting-hyperlink-btn');
  if (hyperlinkBtn) {
    hyperlinkBtn.addEventListener('mousedown', e => e.preventDefault());
    hyperlinkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hyperlinkSelection($('#meetings-inline-desc-editor'));
    });
  }

  // Convert-to-task button
  const convertBtn = $('#meeting-convert-btn');
  if (convertBtn) {
    convertBtn.addEventListener('mousedown', e => e.preventDefault());
    convertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      convertMeetingSelectionToTask(meetingsEditingId);
    });
  }

  // Selection change → enable/disable hyperlink + convert buttons
  // Remove previous listener to prevent accumulation
  if (currentMeetingSelHandler) {
    document.removeEventListener('selectionchange', currentMeetingSelHandler);
  }
  currentMeetingSelHandler = () => {
    const editor = $('#meetings-inline-desc-editor');
    if (!editor) return;
    const hasSelection = canHyperlink(editor);
    if (hyperlinkBtn) hyperlinkBtn.disabled = !hasSelection;
    if (convertBtn) convertBtn.disabled = !hasSelection;
  };
  document.addEventListener('selectionchange', currentMeetingSelHandler);

  // Click on highlights to open linked task
  const descEditor = $('#meetings-inline-desc-editor');
  descEditor.addEventListener('click', (e) => {
    const highlight = e.target.closest('span.project-task-highlight');
    if (highlight && !highlight.classList.contains('completed')) {
      const taskId = highlight.dataset.taskId;
      if (taskId && window.openEditTaskModal) {
        window.openEditTaskModal(taskId);
      }
    }
  });

  // Markdown auto-convert
  descEditor.addEventListener('input', handleEditorInput);
  descEditor.addEventListener('keydown', (e) => {
    handleEditorKeydown(e);
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      setTimeout(updateInlineToolbarState, 0);
    }
  });

  // @ mention autocomplete for linking existing tasks
  attachTaskMention(descEditor, (task) => {
    if (window.updateTask) {
      window.updateTask(task.id, {
        meetingHighlight: { meetingId: meetingsEditingId }
      });
    }
    // Save the updated description
    const meeting = getAllMeetings().find(m => m.id === meetingsEditingId);
    if (meeting) {
      meeting.description = descEditor.innerHTML;
      saveModel();
    }
  });

  // Add link button
  $('#meetings-inline-add-link').addEventListener('click', () => addInlineLinkRow());

  // Delete button
  const deleteBtn = $('#meetings-inline-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (confirm('Delete this meeting?')) {
        deleteMeeting(meetingsEditingId);
        meetingsEditingId = null;
        showToast('Meeting deleted');
        showMeetingsMainView();
      }
    });
  }

  // Cancel button
  $('#meetings-inline-cancel').addEventListener('click', () => {
    if (meetingsHasChanges()) {
      if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
        return;
      }
    }
    if (isNew) {
      showMeetingsMainView();
    } else {
      const m = getAllMeetings().find(x => x.id === meetingsEditingId);
      if (m) showMeetingsViewMode(m);
      else showMeetingsMainView();
    }
  });

  // Save button
  $('#meetings-inline-save').addEventListener('click', () => {
    const nameInput = $('#meetings-inline-name');
    const title = nameInput.value.trim();
    if (!title) {
      showToast('Please enter a meeting name');
      nameInput.focus();
      return;
    }

    const type = $('#meetings-inline-type').value;

    // Collect links
    const linkRows = document.querySelectorAll('#meetings-inline-link-rows .meeting-link-row');
    const meetingLinks = [];
    linkRows.forEach(row => {
      const t = row.querySelector('.meeting-link-title');
      const u = row.querySelector('.meeting-link-url');
      const linkTitle = t ? t.value.trim() : '';
      const linkUrl = u ? u.value.trim() : '';
      if (linkUrl) meetingLinks.push({ title: linkTitle || linkUrl, url: linkUrl });
    });

    const description = normalizeDescHtml($('#meetings-inline-desc-editor').innerHTML) || null;

    // Collect files
    const fileRows = document.querySelectorAll('#meetings-inline-file-rows .meeting-file-row');
    const meetingFiles = [];
    fileRows.forEach(row => {
      const fId = row.dataset.fileId;
      const fName = row.querySelector('.meeting-file-name')?.textContent || '';
      if (fId) meetingFiles.push({ fileId: fId, fileName: fName });
    });

    // Collect date and recurrence
    const date = $('#meetings-inline-date').value || null;
    let repeat = null;
    let repeatWeeks = null;
    let repeatMonthlyType = null;
    if (type === 'routine') {
      repeat = $('#meetings-inline-repeat').value;
      if (repeat === 'weekly') {
        repeatWeeks = parseInt($('#meetings-inline-weekly-type').value) || 1;
      } else if (repeat === 'monthly') {
        repeatMonthlyType = $('#meetings-inline-monthly-type').value || 'sameDay';
      }
      if (repeat === 'none') repeat = null;
    }

    let savedMeeting;
    if (meetingsEditingId) {
      savedMeeting = updateMeeting(meetingsEditingId, { title, type, description, links: meetingLinks, files: meetingFiles, date, repeat, repeatWeeks, repeatMonthlyType });
      showToast('Meeting updated');
    } else {
      savedMeeting = createMeeting(title, type, description, meetingLinks);
      updateMeeting(savedMeeting.id, { files: meetingFiles, date, repeat, repeatWeeks, repeatMonthlyType });
      showToast('Meeting created');
    }

    // Re-render list and show saved meeting in view mode
    renderMeetingsList();
    if (savedMeeting) showMeetingsViewMode(savedMeeting);
    if (window.updateNotificationBadge) window.updateNotificationBadge();
  });

  // Mark edit mode and capture initial state for unsaved changes detection
  meetingsInEditMode = true;
  const initialLinks = (meetingData.links || []).map(l => ({ title: (l.title || '').trim(), url: (l.url || '').trim() }));
  meetingsInitialState = {
    name: meetingData.title || '',
    type: meetingData.type || 'one-time',
    description: normalizeDescHtml(meetingData.description || '') || '',
    links: initialLinks
  };

  // Focus name input
  requestAnimationFrame(() => $('#meetings-inline-name').focus());
}

// ============================================================
// HELPERS
// ============================================================

function renderMeetingsList() {
  const onetimeContainer = $('#meetings-onetime-items');
  const recurringContainer = $('#meetings-recurring-items');
  if (!onetimeContainer || !recurringContainer) return;

  onetimeContainer.innerHTML = '';
  recurringContainer.innerHTML = '';

  const meetings = getAllMeetings();
  const onetime = meetings.filter(m => m.type !== 'routine');
  const recurring = meetings.filter(m => m.type === 'routine');

  if (onetime.length === 0) {
    onetimeContainer.innerHTML = '<div class="meetings-empty">No one-time meetings</div>';
  } else {
    onetime.forEach(meeting => {
      onetimeContainer.appendChild(createMeetingListItem(meeting));
    });
  }

  if (recurring.length === 0) {
    recurringContainer.innerHTML = '<div class="meetings-empty">No recurring meetings</div>';
  } else {
    recurring.forEach(meeting => {
      recurringContainer.appendChild(createMeetingListItem(meeting));
    });
  }
}

function createMeetingListItem(meeting) {
  const item = document.createElement('div');
  item.className = 'meetings-item';
  item.dataset.meetingId = meeting.id;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'meetings-item-title';
  titleSpan.textContent = meeting.title || 'Untitled';
  item.appendChild(titleSpan);

  if (meetingsEditingId === meeting.id) {
    item.classList.add('active');
  }

  item.addEventListener('click', () => {
    if (meetingsHasChanges()) {
      if (!confirm('You have unsaved changes. Are you sure you want to close it?')) {
        return;
      }
    }
    showMeetingsViewMode(meeting);
  });

  return item;
}

function addInlineLinkRow(title, url) {
  const container = $('#meetings-inline-link-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'meeting-link-row';
  row.innerHTML = `
    <input type="text" class="meeting-link-title" placeholder="Link name" value="${escapeAttr(title || '')}" />
    <input type="url" class="meeting-link-url" placeholder="https://..." value="${escapeAttr(url || '')}" />
    <button type="button" class="meeting-link-remove" title="Remove link">&times;</button>
  `;

  row.querySelector('.meeting-link-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addInlineFileRow(fileId, fileName) {
  const container = $('#meetings-inline-file-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'meeting-file-row';
  row.dataset.fileId = fileId;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'meeting-file-name';
  nameSpan.textContent = fileName || fileId;
  nameSpan.title = fileName || fileId;

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'meeting-file-open';
  openBtn.title = 'Open file';
  openBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
  openBtn.addEventListener('click', () => openFile(fileId, fileName));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meeting-link-remove';
  removeBtn.title = 'Remove file';
  removeBtn.textContent = '\u00D7';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(nameSpan);
  row.appendChild(openBtn);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function updateInlineToolbarState() {
  const btns = document.querySelectorAll('.meetings-inline-toolbar-btn');
  btns.forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}

// ============================================================
// CONVERT MEETING SELECTION TO TASK (two-way linking)
// ============================================================


function convertMeetingSelectionToTask(meetingId) {
  if (!meetingId) return;
  const editor = $('#meetings-inline-desc-editor');
  if (!editor) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  const selectedText = sel.toString().trim();
  if (!selectedText) return;

  const savedRange = range.cloneRange();

  if (!window.openAddTaskModalWithCallback) return;

  window.openAddTaskModalWithCallback(selectedText, (task) => {
    if (!task) return;

    try {
      const span = document.createElement('span');
      span.className = 'project-task-highlight';
      span.dataset.taskId = task.id;
      span.dataset.highlightColor = task.color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
      span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
      span.style.cursor = 'pointer';
      span.contentEditable = 'false';

      savedRange.surroundContents(span);
      moveCursorAfterNode(span);
    } catch (e) {
      const contents = savedRange.extractContents();
      const span = document.createElement('span');
      span.className = 'project-task-highlight';
      span.dataset.taskId = task.id;
      span.dataset.highlightColor = task.color;
      span.style.backgroundColor = HIGHLIGHT_COLORS[task.color];
      span.style.borderBottom = `2px solid ${HIGHLIGHT_BORDER_COLORS[task.color]}`;
      span.style.cursor = 'pointer';
      span.contentEditable = 'false';
      span.appendChild(contents);
      savedRange.insertNode(span);
      moveCursorAfterNode(span);
    }

    // Store meeting reference on the task
    if (window.updateTask) {
      window.updateTask(task.id, {
        meetingHighlight: { meetingId }
      });
    }

    // Save the updated description to the meeting
    const meeting = getAllMeetings().find(m => m.id === meetingId);
    if (meeting) {
      meeting.description = editor.innerHTML;
      saveModel();
    }
  });
}
