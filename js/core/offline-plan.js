// Personal Dashboard - Offline copy rules (pure, Node-testable)
// The opt-in "Offline copy" (More → Offline copy on a phone) keeps two things
// in Cache Storage, never in localStorage and never in the model:
//   - the app's own files ('pd-shell-v1'), served by sw.js only when the
//     network throws (network-first), keyed by path without the query
//   - each account's R2 files ('pd-files-v1@<encodeURIComponent(username)>'),
//     one Response per file under 'offline-file/<fileId>' plus a meta entry,
//     read by file-service.js fetchFileBlobUrl when offline / on a 5xx
// sw.js is a classic script and repeats shellKey / isShellRequest;
// Reference/pwa-test.mjs runs it in a vm against these, so they can't drift.
// No DOM access at import time.

export const SHELL_CACHE = 'pd-shell-v1';
export const SHELL_CACHE_PREFIX = 'pd-shell-';
export const FILES_CACHE_PREFIX = 'pd-files-v1@';
export const FILE_KEY_PREFIX = 'offline-file/';
export const META_KEY = 'offline-meta';
export const SHELL_LIST = 'offline-shell.json';
export const VIEWER_PAGE = 'offline-viewer.html';
export const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;   // the quiet refresh, at most this often

// One cache per account: a name that can't be mistaken for another account's
export function filesCacheName(username) {
  if (typeof username !== 'string' || !username) return null;
  return FILES_CACHE_PREFIX + encodeURIComponent(username);
}

export function usernameFromCacheName(name) {
  if (typeof name !== 'string' || !name.startsWith(FILES_CACHE_PREFIX)) return null;
  try { return decodeURIComponent(name.slice(FILES_CACHE_PREFIX.length)) || null; } catch { return null; }
}

export function isFilesCacheName(name) {
  return usernameFromCacheName(name) !== null;
}

// Relative to the page (Cache Storage resolves it against the document URL)
export function fileKey(fileId) {
  return FILE_KEY_PREFIX + encodeURIComponent(String(fileId));
}

// The viewer page for one stored HTML file (it reads the owner's cache itself)
export function viewerHref(fileId) {
  return `${VIEWER_PAGE}#${encodeURIComponent(String(fileId))}`;
}

// The app cache key for a URL: origin + path, no query or fragment; a folder
// ('/dashboard/') is its index.html, so the start URL and index.html are one
export function shellKey(url) {
  const u = new URL(url);
  let path = u.pathname;
  if (path.endsWith('/')) path += 'index.html';
  return u.origin + path;
}

// What sw.js answers from its cache when the network throws: same-origin GETs
// under its scope, no Range. Everything else (the API Worker, the viewer
// Worker, Google, jsdelivr, Turnstile, uploads) is never touched
export function isShellRequest({ method = 'GET', url, range = false } = {}, { origin, scope } = {}) {
  if (method !== 'GET' || range) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== origin) return false;
  if (!scope || !u.href.startsWith(scope)) return false;
  return true;
}

// offline-shell.json → the relative paths it lists (anything odd is dropped)
export function shellFiles(json) {
  const list = json && Array.isArray(json.files) ? json.files : [];
  const out = [];
  const seen = new Set();
  for (const f of list) {
    if (typeof f !== 'string' || !f || seen.has(f)) continue;
    if (/^[a-z]+:|^\/|\\|\?|#|(^|\/)\.\.?(\/|$)/i.test(f)) continue;
    if (f === 'sw.js') continue;   // the browser updates the worker script itself
    seen.add(f);
    out.push(f);
  }
  return out;
}

// Which files the offline copy should hold, and what that costs:
//   referenced: file ids this dashboard uses (getAllReferencedFileIds)
//   listed:     GET /files rows ({ id, original_name, content_type, size_bytes }),
//               only ever the signed-in account's own files
//   saved:      meta.files of the copy already on the phone ({ [id]: { size } })
// Saved = referenced ∩ listed (a reference to a file the account doesn't own,
// or a deleted one, is never fetched). R2 files never change under their id,
// so a saved file is kept as it is; a file no longer wanted is removed.
export function planOfflineFiles({ referenced = [], listed = [], saved = {} } = {}) {
  const want = new Set(referenced);
  const have = saved && typeof saved === 'object' ? saved : {};
  const files = [];
  const download = [];
  const keep = [];
  const seen = new Set();
  for (const row of Array.isArray(listed) ? listed : []) {
    const id = row && row.id != null ? String(row.id) : '';
    if (!id || seen.has(id) || !want.has(id)) continue;
    seen.add(id);
    const file = {
      id,
      name: typeof row.original_name === 'string' ? row.original_name : '',
      type: typeof row.content_type === 'string' ? row.content_type : '',
      size: Math.max(0, Number(row.size_bytes) || 0),
    };
    files.push(file);
    if (Object.prototype.hasOwnProperty.call(have, id)) keep.push(id);
    else download.push(file);
  }
  const remove = Object.keys(have).filter(id => !seen.has(id));
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const downloadBytes = download.reduce((s, f) => s + f.size, 0);
  return { files, download, keep, remove, totalBytes, downloadBytes };
}

// The meta entry of a copy: { v, owner, updatedAt, missing, shellAt, shellBytes,
// files: { [id]: { name, type, size, at } } } (missing = wanted but not saved yet)
export function emptyMeta(owner) {
  return { v: 1, owner, updatedAt: 0, files: {} };
}

export function readMetaJson(json, owner) {
  if (!json || typeof json !== 'object' || json.v !== 1 || json.owner !== owner) return null;
  const files = json.files && typeof json.files === 'object' ? json.files : {};
  return {
    v: 1, owner, updatedAt: Number(json.updatedAt) || 0, files,
    missing: Math.max(0, Number(json.missing) || 0), shellAt: Number(json.shellAt) || 0, shellBytes: Number(json.shellBytes) || 0,
  };
}

export function metaSummary(meta) {
  if (!meta) return { files: 0, bytes: 0, updatedAt: 0 };
  const list = Object.values(meta.files || {});
  return { files: list.length, bytes: list.reduce((s, f) => s + (Number(f && f.size) || 0), 0), updatedAt: meta.updatedAt || 0 };
}

export function needsRefresh(meta, now = Date.now()) {
  if (!meta) return false;   // only an account that saved a copy refreshes
  return !meta.updatedAt || now - meta.updatedAt >= REFRESH_EVERY_MS || now < meta.updatedAt;
}

// Offered everywhere the manifest link is (index.html <script data-pwa-manifest>):
// never on iPhone / iPad (iOS keeps today's behaviour)
export function offlineCopyAllowed(userAgent = '', maxTouchPoints = 0) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/.test(ua)) return false;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return false;
  return true;
}

export function formatBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1000) return `${b} B`;
  if (b < 1000 * 1000) return `${Math.round(b / 1000)} KB`;
  if (b < 1000 * 1000 * 1000) return `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;
  return `${(b / 1e9).toFixed(1)} GB`;
}

export function filesLabel(count) {
  return count === 1 ? '1 file' : `${count} files`;
}
