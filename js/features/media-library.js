// Personal Dashboard - Media Library Module
// Handles media library storage and UI

import { $, $$, fileToDataURL } from '../utils.js';
import { MEDIA_STORAGE_KEY, MEDIA_MANIFEST_PATH } from '../constants.js';

// --- Bundled logos from assets/logos folder
const BUNDLED_LOGOS = [
  'telcobridges_tblogo_64.png',
  'atlassian_jira_logo_icon_170511.png',
  'Confluence-Symbol.png',
  'pngimg.com - chatgpt_PNG15.png',
  'Midjourney_logo.svg.png',
  'WordPress.com-Logo.wine.png',
  'Gmail_icon_(2020).svg.png',
  'LinkedIn_logo.svg',
  'Meta_Platforms_Inc._logo.svg.png',
  'X_logo_2023_original.svg',
  'YouTube_full-color_icon_(2017).svg.webp',
  '10691802.png',
  'Google_Ads_icon.svg',
  'google_analytics_icon.png',
  '4709000.png',
  'Google_Drive_icon_(2020).svg.png',
  'Content_creation_divider.svg',
  'Daily_tasks_1.svg',
  'Daily_tasks_2.svg',
  'Daily_tools_1.svg',
  'Daily_tools_2.svg',
  'Daily_tools_3.svg',
  'Daily_tools_4.svg',
  'Content_creation_1.svg',
  'Content_creation_2.svg',
  'Content_creation_3.svg',
  'Content_creation_4.svg',
  'Content_creation_5.svg',
  'Content_creation_6.svg',
  'Ads_1.svg',
  'Ads_2.svg',
  'Ads_3.svg',
  'Ads_4.svg',
  'Ads_5.svg',
  'Ads_divider.svg',
  'Analytics_1.svg',
  'Tools_1.svg',
  'google-tag-manager.svg',
  'canva-logo.webp',
  'Salesforce.com_logo.png',
  'Reports.png',
  'tiktok-icon-free-png.webp',
  'opus-clip.webp',
  'claude-icon-8x.png',
  'Amazon_Web_Services-Logo.wine.png',
  'genesys-scaled.webp',
  'placeholder-logo.svg',
  'placeholder-profile.svg'
];

// --- Bundled button icons from assets/icons folder
const BUNDLED_ICONS = [
  'Link.svg',
  'display.svg',
  'UI_wrench.svg'
];

// --- Load bundled images from assets folder
export function loadBundledIcons() {
  const logos = BUNDLED_LOGOS.map(name => ({
    id: `bundled:logos/${name}`,
    name: name,
    src: `assets/logos/${name}`
  }));
  const icons = BUNDLED_ICONS.map(name => ({
    id: `bundled:icons/${name}`,
    name: name,
    src: `assets/icons/${name}`
  }));
  return [...logos, ...icons];
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

  function renderGrid() {
    const localItems = loadMediaLibrary();
    const bundledItems = loadBundledIcons();
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
    // render bundled icons first, then manifest, then local (user-added)
    loadManifestMedia().then(manifestItems => {
      renderItems(bundledItems);
      renderItems(manifestItems);
      renderItems(localItems);
    });
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

  selectBtn.onclick = () => {
    if (!selectedId) return;
    const items = loadMediaLibrary();
    const bundledItems = loadBundledIcons();
    // Check bundled icons, manifest items, and local items
    loadManifestMedia().then(manifestItems => {
      let chosen = items.find(i => i.id === selectedId);
      if (!chosen) {
        chosen = manifestItems.find(i => i.id === selectedId);
      }
      if (!chosen) {
        chosen = bundledItems.find(i => i.id === selectedId);
      }
      if (chosen) onSelect(chosen);
      close();
    });
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
