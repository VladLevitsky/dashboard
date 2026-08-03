// Personal Dashboard - Meetings Module
// Manages meetings with two categories: one-time and routine
// Each meeting has a name, description, links, and type

import { currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { handleEditorInput } from './edit-mode.js';
import { saveModel } from '../core/storage.js';

// Module state
let meetingsEditingId = null;
let meetingDescriptionEditing = false;

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
  Object.assign(meeting, updates);
  saveModel();
  return meeting;
}

function deleteMeeting(meetingId) {
  const data = currentData();
  const meetings = data.meetings || [];
  const idx = meetings.findIndex(m => m.id === meetingId);
  if (idx === -1) return false;
  meetings.splice(idx, 1);
  saveModel();
  return true;
}

function normalizeDescHtml(html) {
  if (!html) return '';
  const trimmed = html.trim();
  return (trimmed === '<br>' || trimmed === '') ? '' : trimmed;
}

// ============================================================
// MEETINGS LIST MODAL
// ============================================================

export function openMeetingsModal() {
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
          <div class="meetings-view-section" id="meetings-view-section" hidden>
          <div class="meetings-view-type" id="meetings-view-type"></div>
          <h3 class="meetings-view-title" id="meetings-view-title"></h3>
          <div class="meetings-view-content" id="meetings-view-content"></div>
          <div class="meetings-view-links" id="meetings-view-links"></div>
          <div class="meetings-view-actions">
            <button type="button" id="meetings-view-edit" class="meetings-view-icon-btn" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button type="button" id="meetings-view-delete" class="meetings-view-icon-btn meetings-view-icon-danger" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button type="button" id="meetings-view-close" class="meetings-view-icon-btn" title="Back to list">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.meetings-backdrop').addEventListener('click', closeMeetingsModal);
    modal.querySelector('.meetings-close-btn').addEventListener('click', closeMeetingsModal);

    $('#meetings-add-btn').addEventListener('click', () => {
      openMeetingEditorModal({}, 'Add A Meeting');
    });

    // View mode buttons
    $('#meetings-view-edit').addEventListener('click', () => {
      const meeting = getAllMeetings().find(m => m.id === meetingsEditingId);
      if (meeting) {
        closeMeetingsModal();
        openMeetingEditorModal(meeting, 'Edit Meeting');
      }
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

  meetingsEditingId = null;
  showMeetingsMainView();
  modal.hidden = false;
}

function showMeetingsMainView() {
  $('#meetings-columns').hidden = false;
  $('#meetings-view-section').hidden = true;

  $('#meetings-title').textContent = 'Meetings';
  // Clear active highlight
  const items = document.querySelectorAll('#meetings-modal .meetings-item');
  items.forEach(el => el.classList.remove('active'));
  renderMeetingsList();
}

function showMeetingsViewMode(meeting) {
  if (!meeting) return;
  meetingsEditingId = meeting.id;

  // Keep columns visible, show view section below
  $('#meetings-columns').hidden = false;
  $('#meetings-view-section').hidden = false;

  $('#meetings-title').textContent = 'Meetings';

  // Highlight the selected item
  const items = document.querySelectorAll('#meetings-modal .meetings-item');
  items.forEach(el => {
    el.classList.toggle('active', el.dataset.meetingId === meeting.id);
  });

  $('#meetings-view-type').textContent = meeting.type === 'routine' ? 'Recurring' : 'One-Time';
  $('#meetings-view-title').textContent = meeting.title || 'Untitled';
  $('#meetings-view-content').innerHTML = meeting.description || '<span style="color:var(--muted)">No description</span>';

  // Render links
  const linksContainer = $('#meetings-view-links');
  linksContainer.innerHTML = '';
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
        ${link.title || link.url}
      `;
      linksContainer.appendChild(a);
    });
  }
}

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

  // Highlight if currently viewing
  if (meetingsEditingId === meeting.id) {
    item.classList.add('active');
  }

  item.addEventListener('click', () => {
    showMeetingsViewMode(meeting);
  });

  return item;
}

export function closeMeetingsModal() {
  const modal = $('#meetings-modal');
  if (modal) modal.hidden = true;
  meetingsEditingId = null;
}

// ============================================================
// MEETING EDITOR MODAL
// ============================================================

function openMeetingEditorModal(meetingData, titleText) {
  let modal = $('#meeting-editor-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'meeting-editor-modal';
    modal.className = 'meeting-editor-modal';
    modal.innerHTML = `
      <div class="meeting-editor-backdrop"></div>
      <div class="meeting-editor-dialog">
        <div class="meeting-editor-header">
          <h4 id="meeting-editor-title">Add A Meeting</h4>
          <button type="button" class="meeting-editor-close-btn" title="Close">&times;</button>
        </div>
        <div class="meeting-editor-body">
          <div class="meeting-editor-content">
            <div class="meeting-editor-field">
              <label for="meeting-editor-name">Meeting Name</label>
              <input type="text" id="meeting-editor-name" placeholder="Enter meeting name..." />
            </div>
            <div class="meeting-editor-field">
              <label for="meeting-editor-type">Type</label>
              <select id="meeting-editor-type">
                <option value="one-time">One-Time</option>
                <option value="routine">Recurring</option>
              </select>
            </div>
          </div>
          <div class="meeting-links-section">
            <label>Links</label>
            <div class="meeting-link-rows" id="meeting-link-rows"></div>
            <button type="button" class="meeting-add-link-btn" id="meeting-add-link-btn">+ Add Link</button>
          </div>
          <div class="meeting-editor-description">
            <label>Description</label>
            <div class="task-desc-view" id="meeting-desc-view">
              <div class="task-desc-view-content" id="meeting-desc-view-content"></div>
              <div class="task-desc-view-empty">No description</div>
            </div>
            <button type="button" class="task-desc-edit-btn" id="meeting-desc-edit-btn" title="Edit description">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              Edit
            </button>
            <div class="task-desc-editor-wrap" id="meeting-desc-editor-wrap" hidden>
              <div class="task-desc-toolbar" id="meeting-desc-toolbar">
                <button type="button" class="task-desc-toolbar-btn meeting-toolbar-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
                <button type="button" class="task-desc-toolbar-btn meeting-toolbar-btn" data-cmd="italic" title="Italic"><em>I</em></button>
                <button type="button" class="task-desc-toolbar-btn meeting-toolbar-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                <div class="task-desc-toolbar-divider"></div>
                <button type="button" class="task-desc-toolbar-btn meeting-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet List">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                </button>
                <button type="button" class="task-desc-toolbar-btn meeting-toolbar-btn" data-cmd="insertOrderedList" title="Numbered List">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="1" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="1" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
                </button>
              </div>
              <div id="meeting-desc-editor" class="task-desc-editor" contenteditable="true"></div>
              <div class="task-desc-editor-actions">
                <button type="button" id="meeting-desc-cancel" class="task-desc-icon-btn" title="Cancel">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button type="button" id="meeting-desc-save" class="task-desc-icon-btn task-desc-save-btn" title="Save">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="meeting-editor-actions">
          <button type="button" id="meeting-editor-delete" class="meeting-editor-delete-btn" hidden title="Delete meeting">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <div class="meeting-editor-actions-right">
            <button type="button" id="meeting-editor-cancel" class="btn-secondary">Cancel</button>
            <button type="button" id="meeting-editor-save" class="btn-primary">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.meeting-editor-backdrop').addEventListener('click', closeMeetingEditorModal);
    modal.querySelector('.meeting-editor-close-btn').addEventListener('click', closeMeetingEditorModal);

    // Description toolbar commands
    modal.querySelectorAll('.meeting-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        updateMeetingToolbarState();
        $('#meeting-desc-editor').focus();
      });
    });

    // Markdown auto-convert in description editor
    const descEditor = modal.querySelector('#meeting-desc-editor');
    descEditor.addEventListener('input', handleEditorInput);

    descEditor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        setTimeout(updateMeetingToolbarState, 0);
      }
    });

    document.addEventListener('selectionchange', () => {
      const m = $('#meeting-editor-modal');
      if (m && !m.hidden) {
        updateMeetingToolbarState();
      }
    });

    // Description edit button
    $('#meeting-desc-edit-btn').addEventListener('click', () => {
      enterMeetingDescEditMode();
    });

    // Description save button
    $('#meeting-desc-save').addEventListener('click', () => {
      saveMeetingDescFromEditor();
    });

    // Description cancel button
    $('#meeting-desc-cancel').addEventListener('click', () => {
      exitMeetingDescEditMode();
    });

    // Add link button
    $('#meeting-add-link-btn').addEventListener('click', () => {
      addMeetingLinkRow();
    });
  }

  // Update title
  $('#meeting-editor-title').textContent = titleText;

  // Populate name
  const nameInput = $('#meeting-editor-name');
  nameInput.value = meetingData.title || '';

  // Populate type
  const typeSelect = $('#meeting-editor-type');
  typeSelect.value = meetingData.type || 'one-time';

  // Populate links
  const linkRowsContainer = $('#meeting-link-rows');
  linkRowsContainer.innerHTML = '';
  const links = meetingData.links || [];
  if (links.length > 0) {
    links.forEach(link => addMeetingLinkRow(link.title, link.url));
  }

  // Populate description
  meetingDescriptionEditing = false;
  const descViewContent = $('#meeting-desc-view-content');
  const descView = $('#meeting-desc-view');
  const descEditBtn = $('#meeting-desc-edit-btn');
  const descEditorWrap = $('#meeting-desc-editor-wrap');
  const hasDescription = normalizeDescHtml(meetingData.description || '');
  descViewContent.innerHTML = meetingData.description || '';

  if (hasDescription) {
    descView.hidden = false;
    descEditBtn.hidden = false;
    descEditorWrap.hidden = true;
  } else {
    descView.hidden = true;
    descEditBtn.hidden = true;
    descEditorWrap.hidden = false;
    meetingDescriptionEditing = true;
    const editor = $('#meeting-desc-editor');
    editor.innerHTML = '';
    requestAnimationFrame(() => editor.focus());
  }

  // Determine if editing
  const isEditing = !!meetingData.id;
  meetingsEditingId = meetingData.id || null;

  // Delete button
  const deleteBtn = $('#meeting-editor-delete');
  if (deleteBtn) {
    deleteBtn.hidden = !isEditing;
    deleteBtn.onclick = () => {
      if (confirm('Are you sure you want to delete this meeting?')) {
        deleteMeeting(meetingsEditingId);
        showToast('Meeting deleted');
        closeMeetingEditorModal();
        // Reopen list
        openMeetingsModal();
      }
    };
  }

  // Cancel button
  $('#meeting-editor-cancel').onclick = closeMeetingEditorModal;

  // Save button
  $('#meeting-editor-save').onclick = () => {
    const title = nameInput.value.trim();
    if (!title) {
      showToast('Please enter a meeting name');
      nameInput.focus();
      return;
    }

    const type = typeSelect.value;

    // Collect links
    const linkRows = linkRowsContainer.querySelectorAll('.meeting-link-row');
    const meetingLinks = [];
    linkRows.forEach(row => {
      const titleInput = row.querySelector('.meeting-link-title');
      const urlInput = row.querySelector('.meeting-link-url');
      const linkTitle = titleInput ? titleInput.value.trim() : '';
      const linkUrl = urlInput ? urlInput.value.trim() : '';
      if (linkUrl) {
        meetingLinks.push({ title: linkTitle || linkUrl, url: linkUrl });
      }
    });

    // Get description
    const rawDesc = meetingDescriptionEditing
      ? $('#meeting-desc-editor').innerHTML
      : $('#meeting-desc-view-content').innerHTML;
    const description = normalizeDescHtml(rawDesc) || null;

    if (meetingsEditingId) {
      updateMeeting(meetingsEditingId, { title, type, description, links: meetingLinks });
      showToast('Meeting updated');
    } else {
      createMeeting(title, type, description, meetingLinks);
      showToast('Meeting created');
    }

    closeMeetingEditorModal();
    openMeetingsModal();
  };

  modal.hidden = false;
  nameInput.focus();
}

function closeMeetingEditorModal() {
  const modal = $('#meeting-editor-modal');
  if (modal) modal.hidden = true;
  meetingDescriptionEditing = false;
}

// Link row helpers
function addMeetingLinkRow(title, url) {
  const container = $('#meeting-link-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'meeting-link-row';
  row.innerHTML = `
    <input type="text" class="meeting-link-title" placeholder="Link name" value="${escapeAttr(title || '')}" />
    <input type="url" class="meeting-link-url" placeholder="https://..." value="${escapeAttr(url || '')}" />
    <button type="button" class="meeting-link-remove" title="Remove link">&times;</button>
  `;

  row.querySelector('.meeting-link-remove').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Description edit helpers
function updateMeetingToolbarState() {
  const btns = document.querySelectorAll('.meeting-toolbar-btn');
  btns.forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

function enterMeetingDescEditMode() {
  meetingDescriptionEditing = true;
  const viewContent = $('#meeting-desc-view-content');
  const editor = $('#meeting-desc-editor');
  const descView = $('#meeting-desc-view');
  const descEditBtn = $('#meeting-desc-edit-btn');
  const descEditorWrap = $('#meeting-desc-editor-wrap');

  editor.innerHTML = viewContent.innerHTML || '';
  descView.hidden = true;
  descEditBtn.hidden = true;
  descEditorWrap.hidden = false;
  editor.focus();
}

function saveMeetingDescFromEditor() {
  const editor = $('#meeting-desc-editor');
  const viewContent = $('#meeting-desc-view-content');
  const descView = $('#meeting-desc-view');
  const descEditBtn = $('#meeting-desc-edit-btn');
  const descEditorWrap = $('#meeting-desc-editor-wrap');

  viewContent.innerHTML = normalizeDescHtml(editor.innerHTML);
  meetingDescriptionEditing = false;
  descView.hidden = false;
  descEditBtn.hidden = false;
  descEditorWrap.hidden = true;
}

function exitMeetingDescEditMode() {
  meetingDescriptionEditing = false;
  const descView = $('#meeting-desc-view');
  const descEditBtn = $('#meeting-desc-edit-btn');
  const descEditorWrap = $('#meeting-desc-editor-wrap');

  descView.hidden = false;
  descEditBtn.hidden = false;
  descEditorWrap.hidden = true;
}
