// Personal Dashboard - File Service Module
// Handles R2 file uploads, authenticated retrieval, blob URL management,
// image reference classification, and Base64-to-R2 migration.

import { API_BASE } from '../constants.js';
import { isLoggedIn, getAuthToken } from './auth.js';

// ============================================================
// BLOB URL LIFECYCLE MANAGEMENT
// ============================================================

const _activeBlobUrls = new Map(); // fileId → blobUrl

export function getBlobUrlForFile(fileId) {
  return _activeBlobUrls.get(fileId) || null;
}

function storeBlobUrl(fileId, blobUrl) {
  // Revoke previous if exists
  const old = _activeBlobUrls.get(fileId);
  if (old) URL.revokeObjectURL(old);
  _activeBlobUrls.set(fileId, blobUrl);
}

export function revokeAllBlobUrls() {
  _activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
  _activeBlobUrls.clear();
}

// ============================================================
// IMAGE REFERENCE CLASSIFICATION
// ============================================================

/**
 * Classify an image reference value.
 * Returns { type: 'r2'|'asset'|'url'|'base64'|'none', value: string }
 */
export function classifyImageRef(ref) {
  if (!ref) return { type: 'none', value: '' };

  // Already in explicit object format
  if (typeof ref === 'object' && ref.type) {
    if (ref.type === 'r2' && ref.fileId) return { type: 'r2', value: ref.fileId };
    if (ref.type === 'asset' && ref.src) return { type: 'asset', value: ref.src };
    if (ref.type === 'url' && ref.url) return { type: 'url', value: ref.url };
    return { type: 'none', value: '' };
  }

  // Legacy string format
  if (typeof ref === 'string') {
    if (ref.startsWith('data:image/')) return { type: 'base64', value: ref };
    if (ref.startsWith('assets/') || ref.startsWith('./assets/')) return { type: 'asset', value: ref };
    if (ref.startsWith('http://') || ref.startsWith('https://')) return { type: 'url', value: ref };
    if (ref.startsWith('data:')) return { type: 'base64', value: ref };
    // Could be a relative asset path
    if (ref && !ref.includes('://')) return { type: 'asset', value: ref };
  }

  return { type: 'none', value: '' };
}

/**
 * Classify a link/URL reference on reminders/subtasks.
 * Returns { linkType: 'url'|'file'|'none', value: string }
 */
export function classifyLinkRef(item) {
  if (!item) return { linkType: 'none', value: '' };

  // Explicit object format
  if (item.linkType === 'file' && item.fileId) {
    return { linkType: 'file', value: item.fileId, fileName: item.fileName || '' };
  }

  // Regular URL (string in url field)
  if (item.url && typeof item.url === 'string') {
    return { linkType: 'url', value: item.url };
  }

  return { linkType: 'none', value: '' };
}

// ============================================================
// RESOLVE IMAGE SRC (for <img> elements)
// ============================================================

/**
 * Set an <img> element's src from an image reference.
 * For R2 refs, fetches authenticated and uses blob URL.
 * For others, sets src directly.
 * @param {HTMLImageElement} img
 * @param {*} ref - Image reference (object or string)
 * @param {string} [placeholder] - Fallback src
 */
export async function setImageFromRef(img, ref, placeholder) {
  const classified = classifyImageRef(ref);

  switch (classified.type) {
    case 'r2': {
      // Check cached blob URL first
      const cached = getBlobUrlForFile(classified.value);
      if (cached) {
        img.src = cached;
        return;
      }
      // Set placeholder while loading
      if (placeholder) img.src = placeholder;
      // Fetch authenticated
      try {
        const blobUrl = await fetchFileBlobUrl(classified.value);
        if (blobUrl) {
          img.src = blobUrl;
        } else if (placeholder) {
          img.src = placeholder;
        }
      } catch {
        if (placeholder) img.src = placeholder;
      }
      break;
    }
    case 'asset':
    case 'url':
    case 'base64':
      img.src = classified.value;
      break;
    case 'none':
    default:
      if (placeholder) img.src = placeholder;
      break;
  }
}

/**
 * Get a displayable src string from an image reference.
 * For R2 refs, returns cached blob URL or fetches.
 * For others, returns the value directly.
 * @returns {Promise<string>}
 */
export async function getDisplaySrc(ref, placeholder) {
  const classified = classifyImageRef(ref);

  switch (classified.type) {
    case 'r2': {
      const cached = getBlobUrlForFile(classified.value);
      if (cached) return cached;
      try {
        const blobUrl = await fetchFileBlobUrl(classified.value);
        return blobUrl || placeholder || '';
      } catch {
        return placeholder || '';
      }
    }
    case 'asset':
    case 'url':
    case 'base64':
      return classified.value;
    case 'none':
    default:
      return placeholder || '';
  }
}

// ============================================================
// AUTHENTICATED FILE OPERATIONS
// ============================================================

/**
 * Upload a file to R2 via POST /files.
 * @param {Blob|File} fileBlob
 * @param {string} fileName
 * @returns {Promise<{ ok: boolean, fileId?: string, error?: string }>}
 */
export async function uploadFile(fileBlob, fileName) {
  if (!isLoggedIn()) return { ok: false, error: 'Not authenticated' };

  const formData = new FormData();
  formData.append('file', fileBlob, fileName);

  try {
    const res = await fetch(`${API_BASE}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      body: formData
    });

    if (res.status === 401) {
      return { ok: false, error: 'Session expired', status: 401 };
    }

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data.error || 'Upload failed', status: res.status };
    }

    return { ok: true, fileId: data.file.id, file: data.file, storage: data.storage };
  } catch (err) {
    return { ok: false, error: 'Network error during upload' };
  }
}

/**
 * Fetch a file's bytes as a blob URL (for images, PDFs, etc.)
 * Caches the blob URL for reuse.
 * @param {string} fileId
 * @returns {Promise<string|null>} blob URL or null
 */
export async function fetchFileBlobUrl(fileId) {
  if (!isLoggedIn()) return null;

  // Return cached if available
  const cached = getBlobUrlForFile(fileId);
  if (cached) return cached;

  try {
    const res = await fetch(`${API_BASE}/files/${fileId}`, {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });

    if (!res.ok) return null;

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    storeBlobUrl(fileId, blobUrl);
    return blobUrl;
  } catch {
    return null;
  }
}

/**
 * Open a file: for HTML uses viewer, for others fetches and opens blob URL.
 * @param {string} fileId
 * @param {string} [fileName] - Original filename for extension detection
 */
export async function openFile(fileId, fileName) {
  if (!isLoggedIn()) return;

  const ext = fileName ? getExtension(fileName) : '';
  const isHtml = ext === 'html' || ext === 'htm';

  if (isHtml) {
    // Use the isolated viewer
    try {
      const res = await fetch(`${API_BASE}/files/${fileId}/view-link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank');
    } catch { /* silently fail */ }
  } else {
    // Fetch and open as blob URL
    const blobUrl = await fetchFileBlobUrl(fileId);
    if (blobUrl) window.open(blobUrl, '_blank');
  }
}

/**
 * Delete a file from R2.
 * @param {string} fileId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteR2File(fileId) {
  if (!isLoggedIn()) return { ok: false, error: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });

    // Revoke cached blob URL
    const cached = _activeBlobUrls.get(fileId);
    if (cached) {
      URL.revokeObjectURL(cached);
      _activeBlobUrls.delete(fileId);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || 'Delete failed' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error during deletion' };
  }
}

// ============================================================
// BASE64 CONVERSION UTILITIES
// ============================================================

/**
 * Convert a data: URL to a Blob.
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataURLtoBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Get file extension from filename.
 */
function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * Derive a filename from a data URL's MIME type.
 */
export function filenameFromDataUrl(dataUrl, prefix) {
  const match = dataUrl.match(/^data:image\/(\w+)/);
  const ext = match ? match[1].replace('jpeg', 'jpg') : 'png';
  return `${prefix || 'image'}.${ext}`;
}

// ============================================================
// BASE64-TO-R2 MIGRATION
// ============================================================

/**
 * Migrate legacy Base64 images to R2 storage.
 * Called once after authenticated profile load.
 * Safe, idempotent, non-blocking.
 */
export async function migrateBase64ToR2() {
  if (!isLoggedIn()) return;

  const model = window.model;
  if (!model) return;

  let migrated = false;
  const migrations = [];

  // Check header images
  if (model.header) {
    if (isBase64Image(model.header.profilePhotoSrc)) {
      migrations.push({
        field: 'profilePhotoSrc',
        parent: model.header,
        value: model.header.profilePhotoSrc,
        prefix: 'profile-photo'
      });
    }
    if (isBase64Image(model.header.companyLogoSrc)) {
      migrations.push({
        field: 'companyLogoSrc',
        parent: model.header,
        value: model.header.companyLogoSrc,
        prefix: 'company-logo'
      });
    }
  }

  // Check all card icons
  const sections = model.sections || [];
  sections.forEach(section => {
    const cardData = model[section.id];
    if (!cardData || typeof cardData !== 'object') return;
    Object.values(cardData).forEach(group => {
      if (!group || !group.icons) return;
      group.icons.forEach((icon, idx) => {
        if (isBase64Image(icon.icon)) {
          migrations.push({
            field: 'icon',
            parent: icon,
            value: icon.icon,
            prefix: `icon-${section.id}-${idx}`
          });
        }
      });
    });
  });

  if (migrations.length === 0) return;

  // Migrate sequentially for reliability
  for (const m of migrations) {
    try {
      const blob = dataURLtoBlob(m.value);
      const fileName = filenameFromDataUrl(m.value, m.prefix);
      const result = await uploadFile(blob, fileName);

      if (result.ok && result.fileId) {
        m.parent[m.field] = { type: 'r2', fileId: result.fileId };
        migrated = true;
      }
      // If upload fails, leave the Base64 value intact
    } catch {
      // Skip this image, try the rest
    }
  }

  if (migrated) {
    // Save to localStorage
    if (window.saveModel) window.saveModel();
    // Sync to cloud
    if (window.immediateCloudSave) {
      try { await window.immediateCloudSave(); } catch { /* best effort */ }
    }
    // Re-render to use new R2 refs
    if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
    if (window.renderAllSections) window.renderAllSections();
  }
}

function isBase64Image(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}
