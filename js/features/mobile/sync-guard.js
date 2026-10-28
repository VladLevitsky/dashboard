// Personal Dashboard - Mobile shell: phone sync guard (phones only)
// Phones freeze tabs, skip the 20-minute timer, and iOS wipes storage after a
// week, so a phone syncs quickly. Every sync is the shared change-based merge
// (sync.js cloudSync): another device's changes are merged into this phone's
// copy and this phone's into the cloud's, and nothing either side didn't change
// is overwritten or deleted, so there is nothing to ask about:
//   - push: every saved write (model:saved) while signed in → 2.5s debounce →
//     cloudSave(); failures retry after 4s, 8s, 16s, then wait for the next
//     write, coming back online, or the tab showing again
//   - hide (visibilitychange hidden / pagehide): units keep their drafts
//     (the shell's 'hide' event), then a best-effort push when dirty
//   - resume (visible after 60s+ hidden): one sync (what other devices changed
//     comes in, in place: no reload; a toast says so)
//   - something the user is in the middle of (a gesture, Lift & place, the
//     composer; init.js adds the editors) holds a merge that would change this
//     phone's copy: it runs when that ends (sync.js apply blocker)
//   - a second tab on this phone: a 'storage' event reloads the model in place
//     (a read never writes the copy back: storage.js saveModel unchanged)
//   - "dirty" always includes the persisted flag (hasUnsyncedChanges): changes
//     left by an earlier session that started offline still push and still show
//     as pending
// Status for the avatar dot and More: status() → { signedIn, dirty, inFlight,
// lastPushAt, failed, deferred }.

import { resetModel } from '../../state.js';
import { restoreModel } from '../../core/storage.js';
import { isLoggedIn, getDataOwner } from '../../core/auth.js';
import { getActiveStorageKey, hasUnsyncedChanges, addApplyBlocker, isSyncDeferred, sameStoredContent, waitForCloudSave, refreshStoredMeta, noteAdoptedCopy } from '../../core/sync.js';
import { store } from './ui.js?v=2026-10-mobile-12';
import { anyLayerOpen } from './layers.js?v=2026-10-mobile-12';

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
let hiddenAt = 0;
let lastHideFlush = 0;
let lastPushAt = prefs.get('lastPushAt', 0) || 0;
let removeBlocker = null;

const cloudSave = (opts) => (window.cloudSave ? window.cloudSave(null, opts) : Promise.resolve({ ok: false, error: 'no cloudSave' }));

function setStatusChanged() {
  try { onStatus(); } catch { /* chrome not ready */ }
}

// Something the user is in the middle of: never reload the model under it
function busy() {
  const root = document.documentElement;
  return !!(api && api.isGestureActive()) || anyLayerOpen() ||
    root.hasAttribute('data-mx-carry') || root.hasAttribute('data-mx-compose');
}

// What holds a merge back (sync.js): a finger on a row, a carried task, the
// composer's line. The editors (the writer frames) are init.js's
function holdsMerge() {
  const root = document.documentElement;
  return !!(api && api.isGestureActive()) || root.hasAttribute('data-mx-carry') || root.hasAttribute('data-mx-compose');
}

export function status() {
  return {
    signedIn: isLoggedIn(),
    dirty: hasUnsyncedChanges(),
    inFlight,
    lastPushAt,
    failed,
    deferred: isSyncDeferred(),
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

// One sync. force: also when this phone has nothing unsynced (Sync now, resume:
// other devices' changes come in)
async function runSync({ force = false, reason = 'push' } = {}) {
  if (!isLoggedIn()) { setStatusChanged(); return { ok: false, signedOut: true }; }
  if (!force && !hasUnsyncedChanges()) { setStatusChanged(); return { ok: true, idle: true }; }
  if (inFlight) return { ok: false, busy: true };
  clearTimeout(debounceTimer);
  debounceTimer = 0;
  inFlight = true;
  setStatusChanged();
  let result;
  try {
    result = await cloudSave({ quiet: true, reason });
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  inFlight = false;
  if (result && result.ok) {
    if (result.uploaded || !hasUnsyncedChanges()) {
      lastPushAt = Date.now();
      prefs.set('lastPushAt', lastPushAt);
    }
    failed = false;
    retryIndex = 0;
  } else if (result && result.deferred) {
    failed = false;            // runs by itself once the editor / gesture ends (sync.js)
  } else if (result && result.busy) {
    // Another cloudSave() is syncing (the 20-minute timer, the item creator):
    // not a failure, look again shortly
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = 0; pushNow(); }, BUSY_RETRY_MS);
  } else if (result && result.status === undefined && !result.error) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = 0; pushNow(); }, BUSY_RETRY_MS);
  } else if (isLoggedIn()) {
    failed = true;
    scheduleRetry();
  }
  setStatusChanged();
  return result || { ok: false };
}

export function pushNow() {
  return runSync();
}

// More → Sync now: a sync whether or not this phone changed anything
export function syncNow() {
  return runSync({ force: true, reason: 'manual' });
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
  runSync({ force: true, reason: 'online' });
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
// takes over the render (the resume sync renders 'day' when it is done).
export function onVisible() {
  if (!started) return false;
  const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (hiddenFor >= RESUME_AFTER_MS && isLoggedIn()) {
    resume();
    return true;
  }
  if (isLoggedIn() && (failed || hasUnsyncedChanges())) { retryIndex = 0; pushNow(); }
  return false;
}

// The account a sync was started for is still the one on screen, signed in
const stillOwner = (owner) => !!owner && isLoggedIn() && getDataOwner() === owner;

async function resume() {
  const owner = getDataOwner();
  try {
    if (!stillOwner(owner)) return;
    let r = await runSync({ force: true, reason: 'resume' });
    if (r && r.busy) {
      // Another sync was on its way (the hide flush): this one follows it
      await waitForCloudSave();
      if (!stillOwner(owner)) return;
      r = await runSync({ force: true, reason: 'resume' });
    }
    if (r && r.ok && r.applied && stillOwner(owner) && api) api.toast('Updated from your other device');
  } finally {
    if (api) api.render('day');
  }
}

// Another tab on this phone saved: reload the model in place (only real
// changes; a write that differs by its meta fields alone, e.g. that tab's sync moving
// the base, only updates this page's record of them: sync.js refreshStoredMeta). While
// the user is in the middle of something the page stays as it is, and its next save
// merges into the stored copy (storage.js saveModel)
async function onStorage(e) {
  if (!started || e.storageArea !== localStorage || e.key !== getActiveStorageKey() || !e.newValue) return;
  if (e.oldValue && sameStoredContent(e.oldValue, e.newValue)) { refreshStoredMeta(e.key, e.newValue, e.oldValue); return; }
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
  noteAdoptedCopy();
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
  removeBlocker = addApplyBlocker(holdsMerge);
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
  if (removeBlocker) { removeBlocker(); removeBlocker = null; }
  window.removeEventListener('model:saved', onSaved);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('storage', onStorage);
}
