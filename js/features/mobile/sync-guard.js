// Personal Dashboard - Mobile shell: phone sync guard (phones only)
// Phones freeze tabs, skip the 20-minute timer, and iOS wipes storage after a
// week, so a phone pushes its changes quickly and never uploads over a newer
// change from another device without asking:
//   - push: every saved write (model:saved) while signed in → 2.5s debounce →
//     cloudSave(); failures retry after 4s, 8s, 16s, then wait for the next
//     write, coming back online, or the tab showing again
//   - hide (visibilitychange hidden / pagehide): units keep their drafts
//     (the shell's 'hide' event), then a best-effort push when dirty
//   - resume (visible after 60s+ hidden, nothing open): cloudLoad() and
//     decideSync(): idle → nothing (no reload), push, pull (adopt the cloud
//     copy, time log merged), or the conflict sheet
//   - the gate: cloudSave() asks window.__mxPushGate(GET result) before every
//     PUT (sync.js), so EVERY push path (timer, online, item creator, import,
//     startup) is covered: a foreign, unseen cloud stamp with local changes
//     holds the upload and asks once per remote stamp
//   - a second tab on this phone: a 'storage' event reloads the model in place
//   - "dirty" always includes the persisted flag (hasUnsyncedChanges): changes
//     left by an earlier session that started offline still push, still show
//     as pending, and are never pulled over
// Status for the avatar dot and More: status() → { signedIn, dirty, inFlight,
// lastPushAt, conflict, failed }.

import { model, resetModel } from '../../state.js';
import { restoreModel } from '../../core/storage.js';
import { isLoggedIn } from '../../core/auth.js';
import { getActiveStorageKey, hasUnsyncedChanges, markCloudDirty } from '../../core/sync.js';
import { getDeviceId, decideSync, readSeen, writeSeen, sameStamp } from '../../core/mobile-sync.js';
import { mergeTimeLogs, normalizeTimeLog } from '../../core/time-log.js';
import { store } from './ui.js?v=2026-10-mobile-2';
import { anyLayerOpen } from './layers.js?v=2026-10-mobile-2';

const PUSH_DEBOUNCE_MS = 2500;
const RETRY_MS = [4000, 8000, 16000];
const RESUME_AFTER_MS = 60000;
const BUSY_RETRY_MS = 1500;

const prefs = store('sync');
let api = null;
let onStatus = () => {};
let started = false;
let debounceTimer = 0;
let retryTimer = 0;
let retryIndex = 0;
let inFlight = false;
let failed = false;
let conflict = null;          // the remote stamp we are holding against
let conflictSheet = null;
let hiddenAt = 0;
let lastHideFlush = 0;
let lastPushAt = prefs.get('lastPushAt', 0) || 0;

const cloudSave = () => (window.cloudSave ? window.cloudSave() : Promise.resolve({ ok: false, error: 'no cloudSave' }));
const cloudLoad = () => (window.cloudLoad ? window.cloudLoad() : Promise.resolve(null));

function setStatusChanged() {
  try { onStatus(); } catch { /* chrome not ready */ }
}

// Something the user is in the middle of: never reload the model under it
function busy() {
  const root = document.documentElement;
  return !!(api && api.isGestureActive()) || anyLayerOpen() ||
    root.hasAttribute('data-mx-carry') || root.hasAttribute('data-mx-compose');
}

export function status() {
  return {
    signedIn: isLoggedIn(),
    dirty: hasUnsyncedChanges(),
    inFlight,
    lastPushAt,
    conflict: !!conflict,
    failed,
  };
}

// --- Push -------------------------------------------------------------------

function clearTimers() {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  debounceTimer = retryTimer = 0;
}

function schedulePush() {
  if (!started || !isLoggedIn()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { debounceTimer = 0; pushNow(); }, PUSH_DEBOUNCE_MS);
}

function scheduleRetry() {
  if (retryIndex >= RETRY_MS.length) return;     // wait for a write, online or visible
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = 0; pushNow(); }, RETRY_MS[retryIndex++]);
}

export async function pushNow() {
  if (!isLoggedIn()) { setStatusChanged(); return { ok: false, signedOut: true }; }
  if (!hasUnsyncedChanges()) { setStatusChanged(); return { ok: true, idle: true }; }
  if (inFlight) return { ok: false, busy: true };
  clearTimeout(debounceTimer);
  debounceTimer = 0;
  inFlight = true;
  setStatusChanged();
  let result;
  try {
    result = await cloudSave();
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  inFlight = false;
  if (result && result.ok) {
    lastPushAt = Date.now();
    prefs.set('lastPushAt', lastPushAt);
    failed = false;
    retryIndex = 0;
    conflict = null;
  } else if (result && result.held) {
    failed = false;            // the gate set the conflict state
  } else if (result && result.status === undefined && !result.error) {
    // A bare { ok: false }: another cloudSave() is uploading (the 20-minute
    // timer, the item creator). Not a failure: look again shortly
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = 0; pushNow(); }, BUSY_RETRY_MS);
  } else if (isLoggedIn()) {
    failed = true;
    scheduleRetry();
  }
  setStatusChanged();
  return result || { ok: false };
}

// --- The gate (called by cloudSave between its GET and its PUT) --------------

// Fails closed: when the GET failed (5xx, a dropped connection) this phone
// can't tell whether another device saved, so it doesn't upload blind.
// cloudSave() then returns that GET failure, which pushNow() retries like any
// failed upload (a 404 = no cloud profile yet, nothing to overwrite)
function pushGate(mergeResult) {
  if (!mergeResult) return false;
  if (!mergeResult.ok) return mergeResult.status === 404;
  const remote = mergeResult.data && mergeResult.data.profile ? mergeResult.data.profile._sync : null;
  const decision = decideSync({ dirty: true, remote, me: getDeviceId(), seen: readSeen(getActiveStorageKey()) });
  if (decision !== 'conflict') return true;
  conflict = remote;
  setStatusChanged();
  const askedFor = prefs.get('askedFor', null);
  if (!sameStamp(askedFor, remote)) {
    prefs.set('askedFor', remote);
    queueMicrotask(() => openConflictSheet());
  }
  return false;
}

// --- Adopt the cloud copy ---------------------------------------------------

async function adopt(profile) {
  if (!profile || !Array.isArray(profile.sections)) return false;
  const copy = { ...profile };
  const remoteLog = copy.timeTracking;
  copy.timeTracking = mergeTimeLogs(normalizeTimeLog(model.timeTracking), remoteLog);
  try {
    localStorage.setItem(getActiveStorageKey(), JSON.stringify(copy));
  } catch (err) {
    console.error('[mobile] could not store the cloud copy', err);
    return false;
  }
  resetModel();
  await restoreModel();
  ['renderHeaderAndTitles', 'renderAllSections', 'applyDarkMode', 'applyGlassMode', 'applyGlassTheme',
    'applyCellSize', 'refreshTimeTrackingUI', 'hydrateRichTextImages'].forEach(fn => {
    if (typeof window[fn] === 'function') {
      try { window[fn](); } catch (err) { console.error('[mobile] re-render failed', fn, err); }
    }
  });
  conflict = null;
  if (api) api.toast('Updated from your other device');
  if (JSON.stringify(normalizeTimeLog(remoteLog)) !== JSON.stringify(copy.timeTracking)) markCloudDirty();
  setStatusChanged();
  return true;
}

// --- Conflict sheet (W19) -----------------------------------------------------

function whenLabel(at) {
  if (!Number.isFinite(at)) return 'recently';
  const d = new Date(at);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `at ${time}`;
  return `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

function openConflictSheet() {
  if (!api || !conflict) return null;
  if (conflictSheet) return conflictSheet;
  const remote = conflict;
  conflictSheet = api.openSheet({
    id: 'sync-conflict',
    title: 'Changes on two devices',
    onClose: () => { conflictSheet = null; setStatusChanged(); },
    build(body, sheet) {
      body.classList.add('mx-conflict');
      const p = document.createElement('p');
      p.className = 'mx-sheet-text';
      p.textContent = `This phone has changes that are not synced, and another device saved ${whenLabel(remote.at)}.`;
      const p2 = document.createElement('p');
      p2.className = 'mx-sheet-note';
      p2.textContent = 'Time tracking is merged either way.';
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'mx-btn mx-btn-primary mx-btn-block';
      keep.dataset.action = 'keep';
      keep.textContent = "Keep this phone's version";
      keep.addEventListener('click', () => {
        writeSeen(getActiveStorageKey(), remote);
        conflict = null;
        sheet.close();
        pushNow();
      });
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'mx-btn mx-btn-block';
      use.dataset.action = 'use';
      use.textContent = "Use the other device's version";
      use.addEventListener('click', async () => {
        sheet.close();
        const res = await cloudLoad();
        if (!res || !(await adopt(res.profile))) api.toast("Couldn't load the other version. Try again later");
      });
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'mx-btn mx-btn-quiet mx-btn-block';
      later.dataset.action = 'later';
      later.textContent = 'Decide later';
      later.addEventListener('click', () => sheet.close());
      body.append(p, p2, keep, use, later);
    },
  });
  return conflictSheet;
}

export function resolveConflict() {
  if (conflict) return openConflictSheet();
  return pushNow();
}

// --- Lifecycle --------------------------------------------------------------

function onSaved() {
  if (!isLoggedIn()) return;
  retryIndex = 0;
  schedulePush();
  setStatusChanged();
}

function onOnline() {
  retryIndex = 0;
  pushNow();
}

// Called by the shell on visibilitychange → hidden and on pagehide (after it
// emitted 'hide' to the units)
export function onHide() {
  if (!started) return;
  hiddenAt = Date.now();
  if (Date.now() - lastHideFlush < 1000) return;
  lastHideFlush = Date.now();
  clearTimeout(debounceTimer);
  debounceTimer = 0;
  // The same push as any other: marked in flight, so coming back mid-upload
  // doesn't start a second one that cloudSave() would turn away
  if (isLoggedIn() && hasUnsyncedChanges() && !inFlight) pushNow().catch(() => {});
}

// Called by the shell on visibilitychange → visible. Returns true when it
// takes over the render (the resume check renders 'day' when it is done).
export function onVisible() {
  if (!started) return false;
  const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (hiddenFor >= RESUME_AFTER_MS && isLoggedIn() && !busy()) {
    resume();
    return true;
  }
  if (isLoggedIn() && (failed || hasUnsyncedChanges())) { retryIndex = 0; pushNow(); }
  return false;
}

async function resume() {
  let res = null;
  try { res = await cloudLoad(); } catch { res = null; }
  try {
    if (!res || busy()) return;
    const remote = res.profile ? res.profile._sync : null;
    const decision = decideSync({ dirty: hasUnsyncedChanges(), remote, me: getDeviceId(), seen: readSeen(getActiveStorageKey()) });
    if (decision === 'push') pushNow();
    else if (decision === 'pull') await adopt(res.profile);
    else if (decision === 'conflict') {
      conflict = remote;
      prefs.set('askedFor', remote);
      openConflictSheet();
    }
  } finally {
    if (api) api.render('day');
  }
}

// Another tab on this phone saved: reload the model in place (only real
// changes; a payload that differs by its stamp alone is our own echo)
function withoutStamp(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') delete obj._sync;
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
}

async function onStorage(e) {
  if (!started || e.storageArea !== localStorage || e.key !== getActiveStorageKey() || !e.newValue) return;
  if (e.oldValue && withoutStamp(e.oldValue) === withoutStamp(e.newValue)) return;
  if (busy()) {
    api.openSheet({
      id: 'other-tab',
      title: 'Changed in another tab',
      build(body) {
        const p = document.createElement('p');
        p.className = 'mx-sheet-text';
        p.textContent = 'This dashboard was changed in another tab. Reload to see the latest version.';
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.className = 'mx-btn mx-btn-primary mx-btn-block';
        reload.textContent = 'Reload';
        reload.addEventListener('click', () => location.reload());
        body.append(p, reload);
      },
    });
    return;
  }
  resetModel();
  await restoreModel();
  if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();
  api.render('storage');
}

export function startSyncGuard(shellApi, { onStatusChange } = {}) {
  if (started) return;
  started = true;
  api = shellApi;
  onStatus = onStatusChange || (() => {});
  document.documentElement.setAttribute('data-mx-sync', 'phone');
  window.__mxPushGate = pushGate;
  window.addEventListener('model:saved', onSaved);
  window.addEventListener('online', onOnline);
  window.addEventListener('storage', onStorage);
  // Changes an earlier session left unsynced (it may have started offline):
  // push them now rather than waiting for the next write
  if (isLoggedIn() && hasUnsyncedChanges()) schedulePush();
}

export function stopSyncGuard() {
  if (!started) return;
  started = false;
  clearTimers();
  document.documentElement.removeAttribute('data-mx-sync');
  if (window.__mxPushGate === pushGate) delete window.__mxPushGate;
  window.removeEventListener('model:saved', onSaved);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('storage', onStorage);
}
