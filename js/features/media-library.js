// Personal Dashboard - Media Library Module
// Handles media library storage and UI

import { $, $$, fileToDataURL } from '../utils.js';
import { MEDIA_STORAGE_KEY, MEDIA_MANIFEST_PATH } from '../constants.js';

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

// --- Add files to media library
export function addFilesToMediaLibrary(files) {
  const lib = loadMediaLibrary();
  const now = Date.now();
  const entries = [];
  for (const file of files) {
    entries.push(fileToDataURL(file).then(dataUrl => ({
      id: `${now}_${Math.random().toString(36).slice(2)}`,
      name: file.name,
      src: dataUrl
    })));
  }
  return Promise.all(entries).then(newItems => {
    const updated = [...lib, ...newItems];
    saveMediaLibrary(updated);
    return updated;
  });
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
    const renderItems = (items) => items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'media-item';
      div.dataset.id = item.id;
      div.innerHTML = `<img src="${item.src}" alt="${item.name}"><div class="name">${item.name}</div>`;
      div.addEventListener('click', () => {
        $$('.media-item', grid).forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
        selectedId = item.id;
        selectBtn.disabled = false;
        // Only allow deleting user-uploaded items (not bundled or manifest)
        deleteBtn.disabled = !selectedId || selectedId.startsWith('manifest:') || selectedId.startsWith('bundled:');
      });
      grid.appendChild(div);
    });
    // render bundled logos first, then manifest, then local (user-added)
    renderItems(bundledItems);
    renderItems(manifestItems);
    renderItems(localItems);
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
    // Only delete local items (data-URL entries). Manifest entries are read-only.
    if (selectedId.startsWith('manifest:')) return;
    const items = loadMediaLibrary();
    const updated = items.filter(i => i.id !== selectedId);
    saveMediaLibrary(updated);
    selectedId = null;
    selectBtn.disabled = true;
    deleteBtn.disabled = true;
    renderGrid();
  };
}
