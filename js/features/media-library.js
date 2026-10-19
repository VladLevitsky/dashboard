// Personal Dashboard - Media Library Module
// Handles media library storage and UI

import { $, $$, fileToDataURL, showToast } from '../utils.js';
import { MEDIA_STORAGE_KEY, MEDIA_MANIFEST_PATH } from '../constants.js';
import { uploadFile as r2Upload, setImageFromRef, classifyImageRef, isFileMissing, dataURLtoBlob, filenameFromDataUrl, cacheFileBlob } from '../core/file-service.js';
import { isLoggedIn, getDataOwner } from '../core/auth.js';

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

// --- One library per account ---
// Uploads made while signed in are that account's stored files, which no other
// account can open, so each account keeps its own library
// ('…_media_library_v1@<username>'); the signed-out dashboard keeps the
// original key. Before this rule one library served every account on the
// browser: an account's first look copies the entries added before the split
// (stamped once per browser), and a stored file that answers "not found" for
// this account (another account's upload, or a deleted file) drops out of its
// library the first time it fails to load.
const SPLIT_KEY = MEDIA_STORAGE_KEY + '__split';

function libraryKey() {
  const owner = getDataOwner();
  return owner ? `${MEDIA_STORAGE_KEY}@${owner}` : MEDIA_STORAGE_KEY;
}

function splitTime() {
  try {
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    if (stored > 0) return stored;
    const now = Date.now();
    localStorage.setItem(SPLIT_KEY, String(now));
    return now;
  } catch { return 0; }
}
splitTime(); // stamped on the first load of this build

function readLibrary(key) {
  try {
    const raw = localStorage.getItem(key);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}

// --- Load media library from localStorage
export function loadMediaLibrary() {
  const key = libraryKey();
  if (key === MEDIA_STORAGE_KEY) return readLibrary(key);
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { /* private mode */ }
  if (raw !== null) return readLibrary(key);
  // This account's first look: the shared library's entries from before the split
  const split = splitTime();
  const inherited = readLibrary(MEDIA_STORAGE_KEY).filter(item => {
    const added = parseInt(String(item && item.id), 10);
    return !(added > 0) || added < split;
  });
  saveMediaLibrary(inherited);
  return inherited;
}

// --- Save media library to localStorage
export function saveMediaLibrary(items) {
  try { localStorage.setItem(libraryKey(), JSON.stringify(items)); } catch {}
}

// Stored files this account's library holds: never deleted as unused
// (getAllReferencedFileIds), so a library image keeps working after the icon
// or photo that used it changes
export function libraryFileIds() {
  const ids = [];
  loadMediaLibrary().forEach(item => {
    const ref = classifyImageRef(item && item.src);
    if (ref.type === 'r2') ids.push(ref.value);
  });
  return ids;
}

function dropLibraryEntry(id) {
  const items = loadMediaLibrary();
  const next = items.filter(i => i.id !== id);
  if (next.length !== items.length) saveMediaLibrary(next);
}

// A picked image that is still inline (added while signed out, or an upload
// that failed) goes to file storage first when signed in, once: the library
// entry then holds the stored-file reference, and whatever uses the image gets
// a reference that never needs an upload after the editor closed
async function storeEntryImage(entry) {
  if (!isLoggedIn() || !entry || typeof entry.src !== 'string') return entry;
  if (!entry.src.startsWith('data:image/') || entry.src.startsWith('data:image/svg')) return entry;
  let blob;
  try { blob = dataURLtoBlob(entry.src); } catch { return entry; }
  const owner = getDataOwner();
  const result = await r2Upload(blob, entry.name || filenameFromDataUrl(entry.src, 'image'));
  if (!result.ok || !result.fileId || getDataOwner() !== owner) return entry;
  cacheFileBlob(result.fileId, blob);
  const stored = { ...entry, src: { type: 'r2', fileId: result.fileId } };
  const items = loadMediaLibrary();
  const idx = items.findIndex(i => i.id === entry.id);
  if (idx !== -1) {
    items[idx] = stored;
    saveMediaLibrary(items);
  }
  return stored;
}

// --- Add files to media library (uploads to R2 when authenticated)
export async function addFilesToMediaLibrary(files) {
  const owner = getDataOwner();
  const now = Date.now();
  const newItems = [];

  for (const file of files) {
    const id = `${now}_${Math.random().toString(36).slice(2)}`;
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');

    if (isLoggedIn() && !isSvg) {
      // Upload to R2
      const result = await r2Upload(file, file.name);
      if (result.ok && result.fileId) {
        cacheFileBlob(result.fileId, file); // shown at once, no second download
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

  // Signed in or out while uploading: the new images were the previous owner's
  if (getDataOwner() !== owner) return loadMediaLibrary();
  const updated = [...loadMediaLibrary(), ...newItems];
  saveMediaLibrary(updated);
  return updated;
}

// --- Persist image from library entry: the image as stored (an R2
// reference, a data: URL, an asset path), never a display address
export function persistImageFromLibraryEntry(entry) {
  return entry.src;
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
  // This opening of the library: work still running from an earlier one
  // (an upload, a grid render) leaves the grid and the selection alone
  const session = (modal._mlSession = (modal._mlSession || 0) + 1);
  const current = () => modal._mlSession === session;

  const isUserItem = (id) => !id.startsWith('manifest:') && !id.startsWith('bundled:');

  function pick(id) {
    selectedId = id;
    selectBtn.disabled = false;
    const canDelete = isUserItem(id);
    deleteBtn.disabled = !canDelete;
    deleteBtn.classList.toggle('media-delete-active', canDelete);
  }

  async function renderGrid() {
    const localItems = loadMediaLibrary();
    const bundledItems = await loadBundledLogos();
    const manifestItems = await loadManifestMedia();
    if (!current()) return;
    grid.innerHTML = '';

    const renderItem = (item) => {
      const div = document.createElement('div');
      div.className = 'media-item';
      div.dataset.id = item.id;
      if (item.id === selectedId) div.classList.add('selected');
      const img = document.createElement('img');
      img.alt = item.name;
      const stored = isUserItem(item.id) ? classifyImageRef(item.src) : null;
      setImageFromRef(img, item.src).then(() => {
        // Not this account's file (or deleted): it leaves this library
        if (stored && stored.type === 'r2' && isFileMissing(stored.value)) {
          dropLibraryEntry(item.id);
          if (selectedId === item.id) {
            selectedId = null;
            selectBtn.disabled = true;
            deleteBtn.disabled = true;
            deleteBtn.classList.remove('media-delete-active');
          }
          const section = div.parentElement;
          div.remove();
          if (section && !section.children.length) {
            if (section.previousElementSibling && section.previousElementSibling.classList.contains('media-section-header')) section.previousElementSibling.remove();
            section.remove();
          }
        }
      });
      const nameDiv = document.createElement('div');
      nameDiv.className = 'name';
      nameDiv.textContent = item.name;
      div.appendChild(img);
      div.appendChild(nameDiv);
      div.addEventListener('click', () => {
        $$('.media-item', grid).forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
        pick(item.id);
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

  // Uploading says so (signed in, each image goes to file storage first), and
  // the new image comes back picked: Use Selected takes it
  upload.onchange = async () => {
    if (!upload.files || !upload.files.length) return;
    const files = [...upload.files];
    const label = upload.closest('label');
    const text = label ? label.querySelector('span') : null;
    const idle = text ? text.textContent : '';
    upload.disabled = true;
    if (label) label.setAttribute('aria-busy', 'true');
    if (text) text.textContent = files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading…';
    let added = [];
    try {
      const before = new Set(loadMediaLibrary().map(i => i.id));
      added = (await addFilesToMediaLibrary(files)).filter(i => !before.has(i.id));
    } finally {
      upload.disabled = false;
      if (label) label.removeAttribute('aria-busy');
      if (text) text.textContent = idle;
      upload.value = '';
    }
    if (!current()) return;
    if (added.length) pick(added[added.length - 1].id);
    await renderGrid();
  };

  closeBtn.onclick = () => close();
  modal.querySelector('.media-backdrop').onclick = () => close();

  selectBtn.onclick = async () => {
    if (!selectedId || selectBtn.dataset.busy) return;
    const items = loadMediaLibrary();
    const bundledItems = await loadBundledLogos();
    const manifestItems = await loadManifestMedia();
    // Check local items, manifest items, and bundled logos
    let chosen = items.find(i => i.id === selectedId);
    if (chosen) {
      // An inline image goes to file storage before it is used (once)
      const label = selectBtn.textContent;
      selectBtn.dataset.busy = '1';
      selectBtn.disabled = true;
      selectBtn.textContent = 'Uploading…';
      try { chosen = await storeEntryImage(chosen); } finally {
        delete selectBtn.dataset.busy;
        selectBtn.textContent = label;
      }
    }
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
