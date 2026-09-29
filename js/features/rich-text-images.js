// Personal Dashboard - Rich-text images
// Pasting (or dropping) an image into any rich-text editor uploads it to R2
// file storage, so it counts against the 100 MB file quota (not the 2 MB
// profile) and shows up in the File Manager, where it can be deleted. The
// note itself saves only a reference: <img data-r2-file-id> (the string rules
// live in js/core/rich-text-refs.js).
//
// A document-wide MutationObserver fills in src for those references wherever
// rich text is shown (editors, viewers, lists) from the authenticated file
// cache, so no render path has to remember to do it.

import { model, editState } from '../state.js';
import { showToast } from '../utils.js';
import { isLoggedIn } from '../core/auth.js';
import { uploadFile, fetchFileBlobUrl, getBlobUrlForFile, cacheFileBlob, deleteR2File, dataURLtoBlob } from '../core/file-service.js';
import { saveModel } from '../core/storage.js';
import { mapStringsDeep, resolveUploadToken, clearUploadToken, imageFileBase } from '../core/rich-text-refs.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // the Worker's per-file limit
const UPLOAD_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// ============================================================
// SHOWING STORED IMAGES
// ============================================================

const inflight = new Map(); // fileId → Promise<blobUrl|null>, one request per image

function hydrateImage(img) {
  const fileId = img.getAttribute('data-r2-file-id');
  if (!fileId) return;
  const cached = getBlobUrlForFile(fileId);
  if (cached) {
    if (img.getAttribute('src') !== cached) img.setAttribute('src', cached);
    return;
  }
  // A saved src is a dead blob: URL from an earlier visit: drop it so no
  // broken-image icon paints while the real one loads
  if (img.hasAttribute('src')) img.removeAttribute('src');
  if (!isLoggedIn()) return;

  let request = inflight.get(fileId);
  if (!request) {
    request = fetchFileBlobUrl(fileId).finally(() => inflight.delete(fileId));
    inflight.set(fileId, request);
  }
  request.then(url => {
    if (url && img.isConnected && img.getAttribute('data-r2-file-id') === fileId) img.setAttribute('src', url);
  });
}

function hydrateWithin(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.matches('img[data-r2-file-id]')) hydrateImage(node);
  else if (node.firstElementChild) node.querySelectorAll('img[data-r2-file-id]').forEach(hydrateImage);
}

// Fill in every stored image under root (e.g. again after signing in)
export function hydrateRichTextImages(root = document.body) {
  hydrateWithin(root);
}

let observer = null;
export function startRichTextImages() {
  if (observer) return;
  hydrateWithin(document.body);
  observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(hydrateWithin);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// PASTE / DROP → FILE STORAGE
// ============================================================

// label: where the image lives ('Task', 'Note', ...); getTitle: that item's
// current title. Both only name the file in the File Manager.
export function attachImageUpload(editor, { label = 'Image', getTitle = null } = {}) {
  if (!editor || editor._imageUploadAttached) return;
  editor._imageUploadAttached = true;
  const opts = { label, getTitle };

  editor.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data) return;
    const files = imageFiles(data);
    if (files.length > 0 && !data.getData('text/plain').trim()) {
      e.preventDefault();
      insertImageFiles(editor, files, opts, false);
      return;
    }
    // Text with images (Word, web pages): let the browser paste, then move any
    // images it embedded into file storage
    setTimeout(() => uploadInlineImages(editor, opts), 0);
  });

  editor.addEventListener('dragover', (e) => {
    if (hasImageFiles(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  editor.addEventListener('drop', (e) => {
    const files = imageFiles(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    placeCaretAt(editor, e.clientX, e.clientY);
    insertImageFiles(editor, files, opts, true);
  });
}

function imageFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const fromItems = [...(dataTransfer.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (fromItems.length > 0) return fromItems;
  return [...(dataTransfer.files || [])].filter(file => file.type.startsWith('image/'));
}

function hasImageFiles(dataTransfer) {
  return !!dataTransfer && [...(dataTransfer.items || [])].some(item => item.kind === 'file' && item.type.startsWith('image/'));
}

function newToken() {
  return 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Insert each image at the caret right away (a local preview), then store it
function insertImageFiles(editor, files, opts, keepFileName) {
  files.forEach(file => {
    const token = newToken();
    const preview = URL.createObjectURL(file);
    insertHtmlAtCaret(editor, `<img src="${preview}" data-r2-uploading="${token}" alt="">`);
    storeImage(file, token, preview, opts, keepFileName);
  });
}

// After a mixed paste: upload images the browser embedded as data: URLs
function uploadInlineImages(editor, opts) {
  if (!isLoggedIn() || !editor.isConnected) return;
  editor.querySelectorAll('img[src^="data:image/"]:not([data-r2-file-id]):not([data-r2-uploading])').forEach(img => {
    const src = img.getAttribute('src');
    if (/^data:image\/svg/i.test(src)) return;
    let blob;
    try { blob = dataURLtoBlob(src); } catch { return; }
    const token = newToken();
    img.setAttribute('data-r2-uploading', token);
    storeImage(blob, token, null, opts, false);
  });
}

async function storeImage(file, token, previewUrl, opts, keepFileName) {
  try {
    const prepared = await prepareImage(file);
    if (prepared.error) {
      liveImages(token).forEach(img => img.remove());
      showToast(prepared.error);
      return;
    }
    // Keep a durable copy in the note while uploading: if it's saved now,
    // the picture survives and the reference replaces it when the upload lands
    const dataUrl = await blobToDataUrl(prepared.blob);
    liveImages(token).forEach(img => img.setAttribute('src', dataUrl));

    if (!isLoggedIn()) {
      finishInline(token);
      showToast('Sign in to keep pasted images in your file storage. This one is saved inside the note.');
      return;
    }

    const result = await uploadFile(prepared.blob, uploadName(file, prepared.ext, opts, keepFileName));
    if (result.ok && result.fileId) {
      finishUpload(token, result.fileId, prepared.blob);
    } else {
      finishInline(token);
      showToast(`Couldn't store the image (${result.error || 'upload failed'}). It's saved inside the note for now.`);
    }
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }
}

function liveImages(token) {
  return document.querySelectorAll(`img[data-r2-uploading="${token}"]`);
}

function finishUpload(token, fileId, blob) {
  const url = cacheFileBlob(fileId, blob);
  const live = liveImages(token);
  live.forEach(img => {
    img.removeAttribute('data-r2-uploading');
    img.setAttribute('data-r2-file-id', fileId);
    img.setAttribute('src', url);
  });

  // A copy may already be saved (autosave, or the note was saved and closed)
  const resolve = (html) => resolveUploadToken(html, token, fileId);
  const inModel = mapStringsDeep(model, resolve);
  const inWorking = editState.working ? mapStringsDeep(editState.working, resolve) : false;
  if (inModel) saveModel();

  // Deleted from the note before the upload finished: nothing refers to it
  if (live.length === 0 && !inModel && !inWorking) deleteR2File(fileId);
}

function finishInline(token) {
  liveImages(token).forEach(img => img.removeAttribute('data-r2-uploading'));
  const clear = (html) => clearUploadToken(html, token);
  if (mapStringsDeep(model, clear)) saveModel();
  if (editState.working) mapStringsDeep(editState.working, clear);
}

// PNG / JPG / GIF / WebP upload as they are; other formats the browser can
// decode become PNG. Over 5 MB, try WebP before giving up.
async function prepareImage(file) {
  let blob = file;
  let ext = UPLOAD_EXT[file.type];
  if (!ext) {
    blob = await reencode(file, 'image/png');
    ext = 'png';
    if (!blob) return { error: 'This image format isn’t supported. Use PNG, JPG, GIF or WebP.' };
  }
  if (blob.size > MAX_UPLOAD_BYTES && ext !== 'gif') {
    const smaller = await reencode(blob, 'image/webp', 0.9);
    if (smaller && smaller.size < blob.size) {
      blob = smaller;
      ext = 'webp';
    }
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    return { error: `Images must be 5 MB or less (this one is ${(blob.size / 1048576).toFixed(1)} MB).` };
  }
  return { blob, ext };
}

async function reencode(blob, type, quality) {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    const out = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    return out && out.type === type ? out : null;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
}

// Dropped files keep their own name; pasted images are named after where
// they were pasted: "Task - Write the blog post 2026-09-29 10.32.15.png"
function uploadName(file, ext, opts, keepFileName) {
  if (keepFileName && file.name) {
    const base = imageFileBase('', file.name.replace(/\.[^.]+$/, '')).replace(/^ - /, '');
    if (base) return `${base}.${ext}`;
  }
  let title = '';
  try { title = opts.getTitle ? opts.getTitle() || '' : ''; } catch { /* no title */ }
  return `${imageFileBase(opts.label, title)} ${timestamp()}.${ext}`;
}

// ============================================================
// CARET HELPERS
// ============================================================

function insertHtmlAtCaret(editor, html) {
  const selection = window.getSelection();
  const inEditor = selection && selection.rangeCount > 0 &&
    editor.contains(selection.getRangeAt(0).commonAncestorContainer);
  if (!inEditor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (document.execCommand('insertHTML', false, html)) return;

  // Fallback without execCommand
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function placeCaretAt(editor, x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (range && editor.contains(range.startContainer)) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
