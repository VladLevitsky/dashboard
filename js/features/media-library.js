// Personal Dashboard - Media Library Module
// Handles media library storage and UI

import { $, $$, fileToDataURL, showToast } from '../utils.js';
import { MEDIA_STORAGE_KEY, MEDIA_MANIFEST_PATH } from '../constants.js';
import { uploadFile as r2Upload, setImageFromRef } from '../core/file-service.js';
import { isLoggedIn } from '../core/auth.js';

// --- Load bundled logos dynamically from assets/logos/manifest.json
// To add/remove logos: update the manifest.json file in assets/logos/
export async function loadBundledLogos() {
  try {
    const res = await fetch('assets/logos/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const files = await res.json();
    if (!Array.isArray(files)) return [];
    return files.map(name => ({
      id: `bundled:${name}`,
      name: name,
      src: `assets/logos/${name}`
    }));
  } catch {
    return [];
  }
}

// --- Load media library from localStorage
export function loadMediaLibrary() {
  try {
    const raw = localStorage.getItem(MEDIA_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

// --- Save media library to localStorage
export function saveMediaLibrary(items) {
  try { localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(items)); } catch {}
}

// --- Add files to media library (uploads to R2 when authenticated)
export async function addFilesToMediaLibrary(files) {
  const lib = loadMediaLibrary();
  const now = Date.now();
  const newItems = [];

  for (const file of files) {
    const id = `${now}_${Math.random().toString(36).slice(2)}`;
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');

    if (isLoggedIn() && !isSvg) {
      // Upload to R2
      const result = await r2Upload(file, file.name);
      if (result.ok && result.fileId) {
        newItems.push({
          id,
          name: file.name,
          src: { type: 'r2', fileId: result.fileId }
        });
      } else {
        // R2 failed — fall back to Base64
        showToast('Upload failed for ' + file.name + ', saving locally');
        const dataUrl = await fileToDataURL(file);
        newItems.push({ id, name: file.name, src: dataUrl });
      }
    } else {
      // Not logged in or SVG — store as Base64
      const dataUrl = await fileToDataURL(file);
      newItems.push({ id, name: file.name, src: dataUrl });
    }
  }

  const updated = [...lib, ...newItems];
  saveMediaLibrary(updated);
  return updated;
}

// --- Persist image from library entry
export function persistImageFromLibraryEntry(entry) {
  return entry.src; // use data URL
}

// --- Load manifest media (from Media Library folder)
export async function loadManifestMedia() {
  try {
    const res = await fetch(MEDIA_MANIFEST_PATH, { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = await res.json();
    let files = [];
    if (Array.isArray(json)) files = json;
    else if (Array.isArray(json.files)) files = json.files;
    else if (Array.isArray(json.items)) files = json.items;

    const entries = files.map((f) => {
      if (typeof f === 'string') {
        return { id: `manifest:${f}`, name: f, src: `Media Library/${f}` };
      }
      if (f && typeof f === 'object') {
        const name = f.name || f.path || f.src;
        const src = f.path || f.src || `Media Library/${name}`;
        return { id: `manifest:${name}`, name, src };
      }
      return null;
    }).filter(Boolean);
    return entries;
  } catch { return []; }
}

// --- Open media library modal
export function openMediaLibrary(onSelect) {
  const modal = $('#media-library');
  const grid = $('#media-grid');
  const upload = $('#media-upload-input');
  const selectBtn = $('#media-select');
  const deleteBtn = $('#media-delete');
  const closeBtn = $('#media-close');
  let selectedId = null;

  async function renderGrid() {
    const localItems = loadMediaLibrary();
    const bundledItems = await loadBundledLogos();
    const manifestItems = await loadManifestMedia();
    grid.innerHTML = '';

    const isUserItem = (id) => !id.startsWith('manifest:') && !id.startsWith('bundled:');

    const renderItem = (item) => {
      const div = document.createElement('div');
      div.className = 'media-item';
      div.dataset.id = item.id;
      const img = document.createElement('img');
      img.alt = item.name;
      setImageFromRef(img, item.src);
      const nameDiv = document.createElement('div');
      nameDiv.className = 'name';
      nameDiv.textContent = item.name;
      div.appendChild(img);
      div.appendChild(nameDiv);
      div.addEventListener('click', () => {
        $$('.media-item', grid).forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
        selectedId = item.id;
        selectBtn.disabled = false;
        const canDelete = isUserItem(selectedId);
        deleteBtn.disabled = !canDelete;
        deleteBtn.classList.toggle('media-delete-active', canDelete);
      });
      return div;
    };

    // Default section (bundled + manifest)
    const defaultItems = [...bundledItems, ...manifestItems];
    if (defaultItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'media-section-header';
      header.textContent = 'Default';
      grid.appendChild(header);
      const defaultGrid = document.createElement('div');
      defaultGrid.className = 'media-section-grid';
      defaultItems.forEach(item => defaultGrid.appendChild(renderItem(item)));
      grid.appendChild(defaultGrid);
    }

    // Uploaded section (user items)
    if (localItems.length > 0) {
      const header = document.createElement('div');
      header.className = 'media-section-header';
      header.textContent = 'Uploaded';
      grid.appendChild(header);
      const uploadedGrid = document.createElement('div');
      uploadedGrid.className = 'media-section-grid';
      localItems.forEach(item => uploadedGrid.appendChild(renderItem(item)));
      grid.appendChild(uploadedGrid);
    }
  }

  function close() {
    modal.hidden = true;
    upload.value = '';
    selectBtn.disabled = true;
    deleteBtn.disabled = true;
    selectedId = null;
  }

  modal.hidden = false;
  renderGrid();
  selectBtn.disabled = true;
  deleteBtn.disabled = true;

  upload.onchange = async () => {
    if (upload.files && upload.files.length) {
      await addFilesToMediaLibrary(upload.files);
      renderGrid();
    }
  };

  closeBtn.onclick = () => close();
  modal.querySelector('.media-backdrop').onclick = () => close();

  selectBtn.onclick = async () => {
    if (!selectedId) return;
    const items = loadMediaLibrary();
    const bundledItems = await loadBundledLogos();
    const manifestItems = await loadManifestMedia();
    // Check local items, manifest items, and bundled logos
    let chosen = items.find(i => i.id === selectedId);
    if (!chosen) {
      chosen = manifestItems.find(i => i.id === selectedId);
    }
    if (!chosen) {
      chosen = bundledItems.find(i => i.id === selectedId);
    }
    if (chosen) onSelect(chosen);
    close();
  };

  deleteBtn.onclick = () => {
    if (!selectedId) return;
    // Only delete user-uploaded items
    if (selectedId.startsWith('manifest:') || selectedId.startsWith('bundled:')) return;

    const items = loadMediaLibrary();
    const item = items.find(i => i.id === selectedId);

    // If this item was migrated to R2, clean up the R2 file
    if (item && item.src && typeof item.src === 'object' && item.src.type === 'r2' && item.src.fileId) {
      if (window.cleanupOrphanedR2Files) {
        window.cleanupOrphanedR2Files([item.src.fileId]);
      }
    }

    const updated = items.filter(i => i.id !== selectedId);
    saveMediaLibrary(updated);
    selectedId = null;
    selectBtn.disabled = true;
    deleteBtn.disabled = true;
    deleteBtn.classList.remove('media-delete-active');
    renderGrid();
  };
}
