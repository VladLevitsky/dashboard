// Personal Dashboard - Offline copy (opt-in; More → Offline copy on a phone)
// Keeps the app and this account's files on the phone, so the installed app
// opens and the files open without internet. Rules (cache names, the plan) are
// pure in offline-plan.js; the sheet is js/features/mobile/offline-sheet.js.
//
//   Save / Update now   registers sw.js (the ONLY serviceWorker.register in the
//                       app; nothing registers it unless the user saved a copy),
//                       stores the files listed in offline-shell.json in
//                       'pd-shell-v1', then this account's R2 files in
//                       'pd-files-v1@<user>' (getAllReferencedFileIds ∩ GET /files)
//   reading             file-service.js fetchFileBlobUrl falls back to
//                       readOfflineFile() when offline / on a network error / 5xx
//   quiet refresh       after the startup sync or a sign-in, at most every 6 h,
//                       only for an account that already saved a copy
//   Remove              caches.delete + unregister only: the dashboard (localStorage),
//                       the cloud profile and the R2 files are never touched
//
// Accounts never mix: every cache is named after getDataOwner() at the start of
// a run, a run stops when the account changes, and reads use the owner of the
// dashboard on screen. Nothing here reads or writes localStorage or the model.
//
// Kill switch (page side): OFFLINE_COPY_ENABLED = false hides the feature and,
// on the next load, unregisters sw.js and deletes every offline cache. sw.js has
// its own KILL flag for copies whose page never loads again.

import { API_BASE } from '../constants.js';
import { isLoggedIn, getAuthToken, getDataOwner } from './auth.js';
import { getAllReferencedFileIds } from './file-service.js';
import {
  SHELL_CACHE, SHELL_CACHE_PREFIX, SHELL_LIST, META_KEY,
  filesCacheName, isFilesCacheName, fileKey, shellKey, shellFiles,
  planOfflineFiles, emptyMeta, readMetaJson, metaSummary, needsRefresh, offlineCopyAllowed,
} from './offline-plan.js';

export const OFFLINE_COPY_ENABLED = true;

const WORKER_SCRIPT = 'sw.js';
const SHELL_PARALLEL = 4;
const FILE_PARALLEL = 3;
const REFRESH_DELAY_MS = 6000;   // after the startup sync / a sign-in, so it never competes with them

let job = null;                  // the one running save / update
let refreshTimer = 0;
const listeners = new Set();

function hasCaches() {
  try { return typeof caches !== 'undefined' && !!caches; } catch { return false; }
}

export function isOffline() {
  try { return navigator.onLine === false; } catch { return false; }
}

// Offered where the installed app is (not iPhone / iPad), in a secure context
export function offlineCopySupported() {
  if (!OFFLINE_COPY_ENABLED) return false;
  try {
    return !!(window.isSecureContext && 'serviceWorker' in navigator && hasCaches() &&
      offlineCopyAllowed(navigator.userAgent, navigator.maxTouchPoints || 0));
  } catch { return false; }
}

// Status / progress subscribers (the sheet, the More row). Returns an unsubscribe
export function onOfflineChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach(fn => { try { fn(job ? { ...job.state } : null); } catch { /* a closed sheet */ } });
}

function scopeUrl() {
  return new URL('./', location.href).href;
}

// Never creates a cache (caches.open would): null when there is none
async function openExisting(name) {
  if (!name || !hasCaches()) return null;
  if (!(await caches.has(name))) return null;
  return caches.open(name);
}

export async function readMeta(owner) {
  const cache = await openExisting(filesCacheName(owner));
  if (!cache) return null;
  try {
    const res = await cache.match(META_KEY);
    return res ? readMetaJson(await res.json(), owner) : null;
  } catch { return null; }
}

async function writeMeta(cache, meta) {
  await cache.put(META_KEY, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
}

// A file from the offline copy of the dashboard on screen (null when it isn't there)
export async function readOfflineFile(fileId) {
  const owner = getDataOwner();
  if (!owner || !fileId) return null;
  try {
    const cache = await openExisting(filesCacheName(owner));
    if (!cache) return null;
    const res = await cache.match(fileKey(fileId));
    if (!res) return null;
    const blob = await res.blob();
    return getDataOwner() === owner ? blob : null;
  } catch { return null; }
}

export async function hasOfflineFile(fileId) {
  const owner = getDataOwner();
  if (!owner || !fileId) return false;
  try {
    const cache = await openExisting(filesCacheName(owner));
    return !!(cache && await cache.match(fileKey(fileId)));
  } catch { return false; }
}

async function ourRegistration() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.find(r => r.scope === scopeUrl()) || null;
  } catch { return null; }
}

// Ask Android to keep this site's storage when space runs low. Call it inside
// the tap that saves (the request is tied to it)
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(() => false);
  } catch { /* not available */ }
  return Promise.resolve(false);
}

export async function getOfflineStatus() {
  const owner = getDataOwner();
  const st = {
    supported: offlineCopySupported(), owner, signedIn: isLoggedIn(), offline: isOffline(),
    app: false, worker: false, saved: false, files: 0, bytes: 0, updatedAt: 0, missing: 0,
    otherCopies: false, anyCopy: false, persisted: null, usage: null, quota: null,
    running: job ? { ...job.state } : null,
  };
  if (!st.supported) return st;
  try {
    const names = await caches.keys();
    const mine = filesCacheName(owner);
    st.app = names.includes(SHELL_CACHE);
    st.anyCopy = names.some(isFilesCacheName);
    st.otherCopies = names.some(n => isFilesCacheName(n) && n !== mine);
    st.worker = !!(await ourRegistration());
    const meta = owner ? await readMeta(owner) : null;
    if (meta) {
      const sum = metaSummary(meta);
      Object.assign(st, { saved: true, files: sum.files, bytes: sum.bytes, updatedAt: sum.updatedAt, missing: Number(meta.missing) || 0 });
    }
  } catch { /* Cache Storage unavailable */ }
  try { if (navigator.storage && navigator.storage.persisted) st.persisted = await navigator.storage.persisted(); } catch { /* unknown */ }
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      st.usage = Number(e.usage) || 0;
      st.quota = Number(e.quota) || 0;
    }
  } catch { /* unknown */ }
  return st;
}

// What a save would store: this account's files the dashboard uses (and the
// account owns), the ones already on the phone, and the download size
export async function planOfflineCopy() {
  const owner = getDataOwner();
  if (!isLoggedIn() || !owner) return { ok: false, reason: 'signed-out' };
  if (isOffline()) return { ok: false, reason: 'offline' };
  let res;
  try {
    res = await fetch(`${API_BASE}/files`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
  } catch { return { ok: false, reason: 'network' }; }
  if (getDataOwner() !== owner) return { ok: false, reason: 'account' };
  if (res.status === 401) return { ok: false, reason: 'auth' };   // the next profile sync ends the session
  if (!res.ok) return { ok: false, reason: 'server' };
  const data = await res.json().catch(() => null);
  const listed = data && Array.isArray(data.files) ? data.files : [];
  const meta = await readMeta(owner);
  const plan = planOfflineFiles({ referenced: getAllReferencedFileIds(), listed, saved: meta ? meta.files : {} });
  return { ok: true, owner, plan, meta };
}

export function getRunningJob() {
  return job;
}

// Runs fn over items, `limit` at a time; stops taking new ones once stopped() is true
async function eachLimited(items, limit, stopped, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stopped()) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const isQuota = (err) => !!err && (err.name === 'QuotaExceededError' || err.code === 22);
const isAbort = (err) => !!err && err.name === 'AbortError';

// Save or update the copy. Returns the job { promise, cancel(), state }; the
// promise resolves to { ok, reason?, saved, total, failed, bytes }.
// reason: 'signed-out' | 'offline' | 'network' | 'auth' | 'server' | 'account'
//         | 'cancelled' | 'quota' | 'worker' | 'partial' (some files failed: next run)
export function startOfflineSave({ quiet = false } = {}) {
  if (job) return job;
  const owner = getDataOwner();
  const ctrl = new AbortController();
  const state = { phase: 'plan', done: 0, total: 0, bytes: 0, totalBytes: 0, quiet };
  let reason = null;
  const stop = (why) => { if (!reason) reason = why; ctrl.abort(); };
  const stopped = () => !!reason;
  // The account changed (sign-out, another sign-in, an expired session): stop at once
  const watch = setInterval(() => { if (getDataOwner() !== owner || !isLoggedIn()) stop('account'); }, 300);
  const progress = (patch) => { Object.assign(state, patch); emit(); };

  const run = async () => {
    if (!owner || !isLoggedIn()) return { ok: false, reason: 'signed-out', saved: 0, total: 0, failed: 0, bytes: 0 };
    const planned = await planOfflineCopy();
    if (!planned.ok) return { ok: false, reason: planned.reason, saved: 0, total: 0, failed: 0, bytes: 0 };
    if (stopped()) return { ok: false, reason, saved: 0, total: 0, failed: 0, bytes: 0 };
    const { plan } = planned;

    // 1. The worker (it only answers once its app cache exists)
    try {
      await navigator.serviceWorker.register(WORKER_SCRIPT, { scope: './' });
    } catch {
      return { ok: false, reason: 'worker', saved: 0, total: plan.files.length, failed: 0, bytes: 0 };
    }

    // 2. The app's own files (conditional requests: unchanged files cost a 304)
    let shellBytes = 0;
    let shellOk = false;
    try {
      const listRes = await fetch(SHELL_LIST, { cache: 'no-cache', signal: ctrl.signal });
      if (!listRes.ok) throw new Error('shell list ' + listRes.status);
      const files = shellFiles(await listRes.json());
      progress({ phase: 'app', done: 0, total: files.length, bytes: 0, totalBytes: 0 });
      const shell = await caches.open(SHELL_CACHE);
      let done = 0;
      let missingIndex = true;
      await eachLimited(files, SHELL_PARALLEL, stopped, async (rel) => {
        const url = new URL(rel, location.href).href;
        const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
        if (res.status === 200 && !res.redirected) {
          shellBytes += Number(res.headers.get('Content-Length')) || 0;
          await shell.put(shellKey(url), res);
          if (rel === 'index.html') missingIndex = false;
        }
        progress({ done: ++done });
      });
      shellOk = !stopped() && !missingIndex;
      if (!stopped() && missingIndex) stop('server');
    } catch (err) {
      if (isQuota(err)) stop('quota');
      else if (!isAbort(err)) stop(isOffline() ? 'offline' : 'network');
    }
    if (!shellOk) return { ok: false, reason: reason || 'network', saved: 0, total: plan.files.length, failed: 0, bytes: 0 };

    // 3. This account's files, into its own cache
    const name = filesCacheName(owner);
    const cache = await caches.open(name);
    const prev = (await readMeta(owner)) || emptyMeta(owner);
    const meta = { ...prev, files: { ...prev.files } };
    for (const id of plan.remove) {
      await cache.delete(fileKey(id)).catch(() => false);
      delete meta.files[id];
    }
    let saved = 0;
    let failed = 0;
    let bytes = 0;
    let sinceWrite = 0;
    progress({ phase: 'files', done: 0, total: plan.download.length, bytes: 0, totalBytes: plan.downloadBytes });
    await eachLimited(plan.download, FILE_PARALLEL, stopped, async (file) => {
      try {
        const res = await fetch(`${API_BASE}/files/${encodeURIComponent(file.id)}`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` }, signal: ctrl.signal,
        });
        if (res.status === 401) { stop('auth'); return; }
        if (!res.ok) { failed++; return; }   // 404: deleted since the list; 5xx: next time
        const blob = await res.blob();
        if (stopped() || getDataOwner() !== owner) return;
        await cache.put(fileKey(file.id), new Response(blob, {
          headers: {
            'Content-Type': file.type || blob.type || 'application/octet-stream',
            'Content-Length': String(blob.size),
            'X-Offline-Name': encodeURIComponent(file.name || ''),
          },
        }));
        meta.files[file.id] = { name: file.name, type: file.type, size: blob.size, at: Date.now() };
        saved++;
        bytes += blob.size;
        if (++sinceWrite >= 5) { sinceWrite = 0; await writeMeta(cache, meta); }
        progress({ done: saved + failed, bytes });
      } catch (err) {
        if (isQuota(err)) stop('quota');
        else if (isAbort(err)) { /* cancelled or the account changed */ }
        else if (isOffline()) stop('offline');
        else failed++;
      }
    });

    // What is on the phone now (also after a cancel, a full disk or a lost
    // connection): the next run fills in the rest. A Remove waits for this run,
    // so the cache can't come back after it
    const total = plan.files.length;
    meta.updatedAt = Date.now();
    meta.missing = Math.max(0, total - Object.keys(meta.files).length);
    meta.shellAt = Date.now();
    if (shellBytes) meta.shellBytes = shellBytes;
    try {
      if (await caches.has(name)) await writeMeta(cache, meta);
    } catch (err) {
      if (isQuota(err)) stop('quota');
    }
    const ok = !reason && failed === 0;
    return { ok, reason: reason || (failed ? 'partial' : undefined), saved, total, failed, bytes };
  };

  const promise = run()
    .catch((err) => ({ ok: false, reason: isQuota(err) ? 'quota' : (reason || 'network'), saved: 0, total: 0, failed: 0, bytes: 0 }))
    .finally(() => {
      clearInterval(watch);
      if (job && job.promise === promise) job = null;
      emit();
    });
  job = { owner, promise, cancel: () => stop('cancelled'), state };
  emit();
  return job;
}

// Remove this account's offline copy from the phone. When no other account's
// copy is left, the app copy goes too and sw.js is unregistered. Only
// caches.delete and unregister: never localStorage, never the API
export async function removeOfflineCopy() {
  if (job) {
    job.cancel();
    try { await job.promise; } catch { /* settled */ }
  }
  if (!hasCaches()) return { ok: false, appRemoved: false, othersLeft: false };
  const mine = filesCacheName(getDataOwner());
  if (mine) await caches.delete(mine);
  const others = (await caches.keys()).filter(isFilesCacheName);
  let appRemoved = false;
  if (!others.length) {
    await removeAppCopy();
    appRemoved = true;
  }
  emit();
  return { ok: true, appRemoved, othersLeft: others.length > 0 };
}

async function deleteShellCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith(SHELL_CACHE_PREFIX)).map(n => caches.delete(n)));
}

async function removeAppCopy() {
  const reg = await ourRegistration();
  if (reg) { try { await reg.unregister(); } catch { /* gone */ } }
  await deleteShellCaches();
  // A page the old worker still controls may have been mid-refresh: sweep once more
  setTimeout(() => { ourRegistration().then(r => { if (!r) deleteShellCaches().catch(() => {}); }); }, 2000);
}

// After the startup sync / a sign-in: refresh this account's copy quietly when
// it has one and it is 6 h old (never starts a copy by itself)
export function scheduleOfflineRefresh(delay = REFRESH_DELAY_MS) {
  if (!offlineCopySupported()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    quietRefresh().catch(() => { /* next time */ });
  }, delay);
}

async function quietRefresh() {
  if (job || isOffline() || !isLoggedIn()) return null;
  const owner = getDataOwner();
  const meta = await readMeta(owner);
  if (!meta || !needsRefresh(meta) || getDataOwner() !== owner || job) return null;
  return startOfflineSave({ quiet: true }).promise;
}

// On every load: with the page-side switch off, undo every copy on this phone
export function initOfflineCopy() {
  if (OFFLINE_COPY_ENABLED || !hasCaches()) return;
  (async () => {
    const reg = await ourRegistration();
    if (reg) await reg.unregister().catch(() => false);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith(SHELL_CACHE_PREFIX) || isFilesCacheName(n)).map(n => caches.delete(n)));
  })().catch(() => { /* next load */ });
}
