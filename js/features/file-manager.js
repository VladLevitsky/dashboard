// Personal Dashboard - File Manager Module
// Shows all R2 files, storage usage, orphan detection, and deletion.

import { API_BASE } from '../constants.js';
import { isLoggedIn, getAuthToken } from '../core/auth.js';
import { deleteR2File, fetchFileBlobUrl, getAllReferencedFileIds, classifyImageRef } from '../core/file-service.js';
import { $, showToast } from '../utils.js';
import { model } from '../state.js';
import { saveModel } from '../core/storage.js';

let cachedFiles = null;

// --- Remove all references to a fileId from the model
function removeFileReferences(fileId) {
  if (!model || !fileId) return false;
  let changed = false;

  // Header images
  if (model.header) {
    const logoRef = classifyImageRef(model.header.companyLogoSrc);
    if (logoRef.type === 'r2' && logoRef.value === fileId) {
      model.header.companyLogoSrc = 'assets/icons/placeholder-logo.svg';
      changed = true;
    }
    const profileRef = classifyImageRef(model.header.profilePhotoSrc);
    if (profileRef.type === 'r2' && profileRef.value === fileId) {
      model.header.profilePhotoSrc = 'assets/icons/placeholder-profile.svg';
      changed = true;
    }
  }

  // Card items: icons, reminders, subtasks
  (model.sections || []).forEach(section => {
    const cardData = model[section.id];
    if (!cardData || typeof cardData !== 'object') return;
    Object.values(cardData).forEach(group => {
      if (!group || typeof group !== 'object') return;

      // Icon images
      if (group.icons) {
        group.icons = group.icons.filter(item => {
          const ref = classifyImageRef(item.icon);
          if (ref.type === 'r2' && ref.value === fileId) { changed = true; return false; }
          return true;
        });
      }

      // Direct file links on items (linkType === 'file')
      ['icons', 'reminders', 'subtasks'].forEach(key => {
        if (group[key]) {
          group[key].forEach(item => {
            if (item.linkType === 'file' && item.fileId === fileId) {
              delete item.linkType;
              delete item.fileId;
              delete item.fileName;
              changed = true;
            }
            // File entries inside item.links[]
            if (item.links) {
              const before = item.links.length;
              item.links = item.links.filter(l => !(l.type === 'file' && l.fileId === fileId));
              if (item.links.length < before) changed = true;
            }
          });
        }
      });
    });
  });

  // Task links
  [model.tasks, model.completedTasks].forEach(arr => {
    (arr || []).forEach(task => {
      if (task.taskLinks) {
        const before = task.taskLinks.length;
        task.taskLinks = task.taskLinks.filter(l => !(l.type === 'file' && l.fileId === fileId));
        if (task.taskLinks.length < before) changed = true;
      }
    });
  });

  // Meeting files
  (model.meetings || []).forEach(meeting => {
    if (meeting.files) {
      const before = meeting.files.length;
      meeting.files = meeting.files.filter(f => f.fileId !== fileId);
      if (meeting.files.length < before) changed = true;
    }
  });

  if (changed) {
    saveModel();
    if (window.renderAllSections) window.renderAllSections();
  }

  return changed;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// --- Fetch file list from API (resilient to different response shapes)
async function fetchFileList() {
  if (!isLoggedIn()) {
    console.warn('[File Manager] Not logged in');
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${API_BASE}/files`, {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn('[File Manager] GET /files failed:', res.status);
      return null;
    }
    const data = await res.json();
    console.log('[File Manager] API response keys:', Object.keys(data));
    console.log('[File Manager] storage object:', JSON.stringify(data.storage));
    if (data.files && data.files.length > 0) console.log('[File Manager] first file keys:', Object.keys(data.files[0]));
    // Normalize: API might return { files: [...] } or just [...]
    const files = Array.isArray(data) ? data : (data.files || []);
    const storage = data.storage || {};
    return { files, storage };
  } catch (err) {
    console.warn('[File Manager] Fetch error:', err.name, err.message);
    return null;
  }
}

// --- Build a file row element
function createFileRow(file, isOrphan) {
  const row = document.createElement('div');
  row.className = 'file-manager-row' + (isOrphan ? ' orphan' : '');
  row.dataset.fileId = file.id;

  const isImage = /^image\//.test(file.content_type || '');
  const date = new Date(file.created_at);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const sizeStr = formatBytes(file.size_bytes);

  // Thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'file-manager-thumb' + (isImage ? '' : ' file-icon');
  if (isImage) {
    const img = document.createElement('img');
    img.alt = '';
    thumb.appendChild(img);
    fetchFileBlobUrl(file.id).then(url => { if (url) img.src = url; });
  } else {
    thumb.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
  }

  // Info
  const info = document.createElement('div');
  info.className = 'file-manager-info';
  info.innerHTML = `<div class="file-manager-name">${escapeHtml(file.original_name)}</div><div class="file-manager-meta">${sizeStr} · ${dateStr}</div>`;

  // Delete button
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'file-manager-delete-btn';
  del.title = 'Delete file';
  del.dataset.fileId = file.id;
  del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

  row.appendChild(thumb);
  row.appendChild(info);
  row.appendChild(del);
  return row;
}

// --- Update storage bar
function updateStorageBar(storage) {
  const maxBytes = storage.max_bytes || storage.limit || (100 * 1024 * 1024);
  const usedBytes = storage.used_bytes || storage.used || 0;
  const pct = Math.min(100, (usedBytes / maxBytes) * 100);
  const fillEl = $('#file-manager-storage-fill');
  const textEl = $('#file-manager-storage-text');
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.classList.toggle('warning', pct > 80);
  }
  if (textEl) textEl.textContent = `${formatBytes(usedBytes)} / ${formatBytes(maxBytes)} used`;
}

// --- Render the full file list with separate orphan section
function renderFileList(data) {
  const listEl = $('#file-manager-list');
  if (!listEl) return;

  const files = data.files || [];
  updateStorageBar(data.storage || {});

  if (files.length === 0) {
    listEl.innerHTML = '<div class="file-manager-empty">No files uploaded.</div>';
    return;
  }

  const referencedIds = getAllReferencedFileIds();
  const activeFiles = [];
  const orphanFiles = [];

  files.forEach(f => {
    if (referencedIds.has(f.id)) {
      activeFiles.push(f);
    } else {
      orphanFiles.push(f);
    }
  });

  // Sort each group by date descending
  const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  activeFiles.sort(byDate);
  orphanFiles.sort(byDate);

  listEl.innerHTML = '';

  // --- Orphaned files section (shown first if any exist)
  if (orphanFiles.length > 0) {
    const orphanSection = document.createElement('div');
    orphanSection.className = 'file-manager-section-group';

    const header = document.createElement('div');
    header.className = 'file-manager-section-header orphan-header';
    header.innerHTML = `
      <span>Orphaned Files (${orphanFiles.length})</span>
      <button type="button" class="file-manager-delete-all-btn" id="file-manager-delete-all-orphans">Delete All</button>
    `;
    orphanSection.appendChild(header);

    orphanFiles.forEach(file => {
      orphanSection.appendChild(createFileRow(file, true));
    });

    listEl.appendChild(orphanSection);

    // Wire delete-all button
    const deleteAllBtn = orphanSection.querySelector('#file-manager-delete-all-orphans');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', () => deleteAllOrphans(orphanFiles));
    }
  }

  // --- Active files section
  if (activeFiles.length > 0) {
    if (orphanFiles.length > 0) {
      const header = document.createElement('div');
      header.className = 'file-manager-section-header';
      header.innerHTML = `<span>Active Files (${activeFiles.length})</span>`;
      listEl.appendChild(header);
    }

    activeFiles.forEach(file => {
      listEl.appendChild(createFileRow(file, false));
    });
  }

  // Wire individual delete buttons via delegation
  listEl.addEventListener('click', handleDeleteClick);
}

// --- Handle individual file delete
async function handleDeleteClick(e) {
  const btn = e.target.closest('.file-manager-delete-btn');
  if (!btn) return;
  e.stopPropagation();

  const fileId = btn.dataset.fileId;
  const row = btn.closest('.file-manager-row');
  const nameEl = row ? row.querySelector('.file-manager-name') : null;
  const name = nameEl ? nameEl.textContent : fileId;

  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  btn.disabled = true;
  const result = await deleteR2File(fileId);
  if (result.ok) {
    if (row) row.remove();
    removeFileReferences(fileId);
    showToast('File deleted');
    refreshAfterDelete();
  } else {
    showToast('Failed to delete file');
    btn.disabled = false;
  }
}

// --- Delete all orphaned files
async function deleteAllOrphans(orphanFiles) {
  if (!orphanFiles || orphanFiles.length === 0) return;
  if (!confirm(`Delete ${orphanFiles.length} orphaned file${orphanFiles.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

  const deleteAllBtn = $('#file-manager-delete-all-orphans');
  if (deleteAllBtn) deleteAllBtn.disabled = true;

  let deleted = 0;
  for (const file of orphanFiles) {
    const result = await deleteR2File(file.id);
    if (result.ok) {
      deleted++;
      const row = document.querySelector(`.file-manager-row[data-file-id="${file.id}"]`);
      if (row) row.remove();
    }
  }

  showToast(`Deleted ${deleted} orphaned file${deleted > 1 ? 's' : ''}`);
  refreshAfterDelete();
}

// --- Refresh storage bar and sections after deletions
async function refreshAfterDelete() {
  const freshData = await fetchFileList();
  if (freshData) {
    cachedFiles = freshData;
    renderFileList(freshData);
  }
}

// --- Open File Manager modal
export async function openFileManager() {
  const modal = $('#file-manager-modal');
  if (!modal) return;

  modal.classList.add('active');

  const listEl = $('#file-manager-list');

  if (!isLoggedIn()) {
    if (listEl) listEl.innerHTML = '<div class="file-manager-empty">Sign in to manage your cloud files.</div>';
    updateStorageBar({});
    return;
  }

  if (listEl) listEl.innerHTML = '<div class="file-manager-loading">Loading files...</div>';
  updateStorageBar({});

  const data = await fetchFileList();
  if (!data) {
    if (listEl) listEl.innerHTML = '<div class="file-manager-empty">Failed to load files. Check your connection.</div>';
    return;
  }

  cachedFiles = data;
  renderFileList(data);
}

// --- Close File Manager modal
export function closeFileManager() {
  const modal = $('#file-manager-modal');
  if (modal) modal.classList.remove('active');
  cachedFiles = null;
}

// --- Wire events
export function wireFileManagerEvents() {
  console.log('[File Manager] Wiring events');

  const closeBtn = $('#file-manager-close');
  if (closeBtn) closeBtn.addEventListener('click', closeFileManager);

  const backdrop = document.querySelector('.file-manager-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeFileManager);

  const openBtn = $('#settings-file-manager-btn');
  console.log('[File Manager] Open button found:', !!openBtn);
  if (openBtn) openBtn.addEventListener('click', () => {
    console.log('[File Manager] Button clicked, isLoggedIn:', isLoggedIn());
    openFileManager();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('#file-manager-modal');
      if (modal && modal.classList.contains('active')) closeFileManager();
    }
  });
}

// --- No-op: file manager section is always visible in settings.
// The modal itself shows a sign-in message if not authenticated.
export function updateFileManagerVisibility() {}
