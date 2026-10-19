// Personal Dashboard - Cloud Sync Module
// Handles dirty flag tracking, cloud save/load via Cloudflare Worker,
// 20-minute background sync, and login reconciliation.

import { STORAGE_KEY, SCOPED_KEY_PREFIX, SYNC_INTERVAL_MS } from '../constants.js';
import { isLoggedIn, getDataOwner, getAuthToken, apiCall } from './auth.js';
import { model } from '../state.js';
import { showToast } from '../utils.js';
import { mergeTimeLogs, normalizeTimeLog } from './time-log.js';
import { makeSyncStamp } from './mobile-sync.js';

// --- Scoped localStorage key management ---

export function scopedStorageKey(username) {
  return `${SCOPED_KEY_PREFIX}${username}_model_v2`;
}

// The copy this page reads and writes: the owner's own (signed in, or a
// session that ended without a sign-out: getDataOwner), else the signed-out
// dashboard (the legacy key)
export function getActiveStorageKey() {
  const owner = getDataOwner();
  if (!owner) return STORAGE_KEY;
  return scopedStorageKey(owner);
}

// The signed-out dashboard went into this account (see prepareAccountCopy)
const CARRIED_KEY = STORAGE_KEY + '__carried';

// The signed-out dashboard may go into a new account only when it is this
// browser's own signed-out work: never once it went into an account, and never
// on a browser where an account was used before this rule (older builds copied
// the signed-out dashboard into the first account and wrote an expired
// account's changes into it, so it may be an account's copy)
function signedOutDashboardIsOwn() {
  try {
    if (localStorage.getItem(CARRIED_KEY)) return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SCOPED_KEY_PREFIX) && key.endsWith('_model_v2')) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// --- Right after a sign-in, before the account's dashboard is read ---
// Makes this browser's copy for the account the account's own, so nothing of
// the signed-out dashboard or another account is shown, merged or uploaded:
//   · a copy of this account already here → kept (changes it holds that never
//     synced go up in syncOnLogin, e.g. ones made after its session ended)
//   · else the account's cloud copy, when it has one
//   · else (nothing saved yet) the signed-out dashboard, only for an account
//     created just now on this browser (created), once; otherwise empty
// Returns { ok, source: 'local' | 'cloud' | 'carried' | 'empty', cloud? }
// (cloud: the GET /profile result, for syncOnLogin). ok false: the cloud copy
// couldn't be read for an account this browser has no copy of; the sign-in
// must not go on (it would show, and later upload, the wrong dashboard)
export async function prepareAccountCopy(username, { created = false } = {}) {
  const key = scopedStorageKey(username);
  if (localStorage.getItem(key)) return { ok: true, source: 'local' };

  const result = await apiCall('GET', '/profile');
  if (!result.ok) return { ok: false, status: result.status, error: result.error };

  const profile = result.data && result.data.profile;
  if (isSavedProfile(profile)) {
    localStorage.setItem(key, JSON.stringify(profile));
    return { ok: true, source: 'cloud', cloud: result };
  }

  if (created && signedOutDashboardIsOwn()) {
    const raw = localStorage.getItem(STORAGE_KEY);
    let signedOut = null;
    try { signedOut = raw ? JSON.parse(raw) : null; } catch (e) { signedOut = null; }
    if (isProfileMeaningful(signedOut)) {
      localStorage.setItem(key, raw);
      // Uploaded by syncOnLogin (unsynced changes of this account now)
      localStorage.setItem(key + '__dirty', '1');
      localStorage.setItem(CARRIED_KEY, username);
      return { ok: true, source: 'carried', cloud: result };
    }
  }
  return { ok: true, source: 'empty', cloud: result };
}

// --- Dirty flag & sync timer ---

let _dirty = false;
let _dirtyGeneration = 0; // bumps on every change, so a save only clears what it uploaded
let _syncTimerId = null;
let _isSaving = false;

// Dirty flag is also persisted to localStorage so unsynced changes
// survive a page refresh (otherwise syncOnLogin would let stale cloud
// data overwrite local edits made since the last cloud save).
function getDirtyFlagKey() {
  return getActiveStorageKey() + '__dirty';
}

// A change to an account's copy (storageKey: the copy saveModel wrote, which
// stays the shown dashboard's while a sign-in / sign-out is switching). After
// a session ended (signed out, owner kept) only the stored flag is set: the
// change goes up when that account signs in again (syncOnLogin), never to
// another account. The signed-out dashboard has nothing to sync
export function markCloudDirty(storageKey = getActiveStorageKey()) {
  if (!storageKey || storageKey === STORAGE_KEY) return;
  try { localStorage.setItem(storageKey + '__dirty', '1'); } catch (e) { /* quota — in-memory flag still set */ }
  if (storageKey !== getActiveStorageKey()) return;
  _dirtyGeneration++;
  if (isLoggedIn()) _dirty = true;
}

export function isCloudDirty() {
  return _dirty;
}

// Another account's copy (or the signed-out dashboard) is about to be shown:
// the in-memory flag was the previous copy's (which keeps its stored flag)
export function resetSyncState() {
  _dirty = false;
  _dirtyGeneration++;
}

// Unsynced changes in this page OR left by an earlier session (the persisted
// flag). The in-memory flag starts false on every load and only syncOnLogin()
// reads the stored one, which it skips when the cloud can't be reached at
// startup. Phones (sync-guard.js) ask this one, so an offline start never
// reads as "synced" and a resume check never pulls over those changes
export function hasUnsyncedChanges() {
  if (_dirty) return true;
  if (!isLoggedIn()) return false;
  try { return localStorage.getItem(getDirtyFlagKey()) === '1'; } catch (e) { return false; }
}

// --- Time log merge before upload ---
// The profile is saved whole (last write wins), so a device that tracked time
// while another device also did would erase the other's sessions. Before each
// upload, fold the cloud copy of the time log into this device's log.
// `prefetched` is a GET /profile result the caller already has. `owner`: the
// account the upload is for (nothing is merged once another one is shown)
async function mergeCloudTimeLog(prefetched = null, owner = getDataOwner()) {
  const result = prefetched || await apiCall('GET', '/profile');
  if (!result.ok) return result; // offline etc. — the upload below reports the failure
  if (getDataOwner() !== owner) return result;

  const remoteLog = result.data?.profile?.timeTracking;
  if (!remoteLog) return result;

  const localLog = normalizeTimeLog(model.timeTracking);
  const merged = mergeTimeLogs(localLog, remoteLog);
  if (JSON.stringify(merged) !== JSON.stringify(localLog)) {
    model.timeTracking = merged;
    if (window.saveModel) window.saveModel();
    if (window.refreshTimeTrackingUI) window.refreshTimeTrackingUI();
  }
  return result;
}

// --- Cloud save: sends the COMPLETE profile JSON to PUT /profile ---

export async function cloudSave(prefetchedProfile = null) {
  if (!isLoggedIn() || _isSaving) return { ok: false };
  _isSaving = true;
  // Signed in or out while waiting: this upload was for the previous copy
  const owner = getDataOwner();
  const switched = () => getDataOwner() !== owner || !isLoggedIn();

  try {
    const mergeResult = await mergeCloudTimeLog(prefetchedProfile, owner);
    if (mergeResult.status !== 401 && switched()) return { ok: false, error: 'Signed in or out meanwhile.' };
    if (mergeResult.status === 401) {
      _dirty = false; // Can't sync without auth
      if (window.renderAuthUI) window.renderAuthUI();
      showToast('Session expired. Please sign in again.');
      return mergeResult;
    }

    // Phones (mobile shell, sync-guard.js) hold the upload when another device
    // saved a newer copy this one has not seen, and ask instead. They also hold
    // it when the GET failed (they can't tell): that is a plain failure, retried
    if (typeof window !== 'undefined' && typeof window.__mxPushGate === 'function' && window.__mxPushGate(mergeResult) === false) {
      return mergeResult && !mergeResult.ok ? mergeResult : { ok: false, held: true };
    }

    // Read the current localStorage payload (same format as what saveModel writes)
    const generation = _dirtyGeneration;
    const raw = localStorage.getItem(getActiveStorageKey());
    if (!raw) {
      return { ok: false, error: 'No local data to save.' };
    }

    // Every upload says which device saved it (phones compare it, sync-guard.js).
    // saveModel() stamps its payload; a copy written another way (a JSON import)
    // is stamped here, and kept stamped locally
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object' && (!payload._sync || typeof payload._sync !== 'object')) {
      payload._sync = makeSyncStamp();
      try { localStorage.setItem(getActiveStorageKey(), JSON.stringify(payload)); } catch (e) { /* the upload still carries it */ }
    }

    const result = await apiCall('PUT', '/profile', payload);

    if (result.ok) {
      // Changes made while the upload was in flight still need a sync
      if (generation === _dirtyGeneration && !switched()) {
        _dirty = false;
        try { localStorage.removeItem(getDirtyFlagKey()); } catch (e) { /* ignore */ }
      }

      // D1 save succeeded — flush any queued R2 file deletions
      if (window.flushPendingR2Deletions) {
        try { await window.flushPendingR2Deletions(); } catch (e) {
          console.warn('[R2 cleanup] Error during flush after cloud save:', e);
        }
      }

      // The cloud copy changed: Google Calendar mirrors it (google-calendar.js).
      // detail.payload is what was uploaded (the model may have moved on since)
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try { window.dispatchEvent(new CustomEvent('cloud:saved', { detail: { payload } })); } catch (e) { /* no listeners to tell */ }
      }

      return { ok: true };
    }

    // 401 = session expired (apiCall already cleared auth state)
    if (result.status === 401) {
      _dirty = false; // Can't sync without auth
      if (window.renderAuthUI) window.renderAuthUI();
      showToast('Session expired. Please sign in again.');
    } else if (result.status === 413) {
      showToast(result.error);
    }

    return result;
  } finally {
    _isSaving = false;
  }
}

// --- Cloud load: GET /profile ---

export async function cloudLoad() {
  if (!isLoggedIn()) return null;

  const result = await apiCall('GET', '/profile');

  if (result.ok && result.data) {
    return result.data; // { profile, updated_at }
  }

  if (result.status === 401) {
    if (window.renderAuthUI) window.renderAuthUI();
  }

  return null;
}

// --- Immediate cloud save (called after edit-mode confirm and import) ---

export async function immediateCloudSave() {
  if (!isLoggedIn()) return { ok: false };

  _dirty = true; // Ensure dirty flag is set
  const result = await cloudSave();

  if (result.ok) {
    showToast('Saved to cloud');
  } else if (result.status !== 401 && result.status !== 413 && !result.held) {
    // Subtle failure notice (non-intrusive)
    showToast("Couldn't sync to cloud. Will retry.");
  }

  return result;
}

// --- 20-minute background sync timer ---

export function startSyncTimer() {
  stopSyncTimer(); // Prevent duplicates
  _syncTimerId = setInterval(async () => {
    if (isLoggedIn() && _dirty) {
      await cloudSave();
    }
  }, SYNC_INTERVAL_MS);
}

export function stopSyncTimer() {
  if (_syncTimerId !== null) {
    clearInterval(_syncTimerId);
    _syncTimerId = null;
  }
}

// --- Login reconciliation: decide whether to use cloud data or upload local ---
// Called after a sign-in (once prepareAccountCopy made the local copy the
// account's own) and at start-up, AFTER restoreModel() has loaded local data.
// `prefetched`: a GET /profile result the caller already has.
//
// Rules (the local copy is always this account's own):
//   1. Local has changes that never synced → upload them
//   2. Cloud has a saved profile → use it (authoritative, even a sparse one)
//   3. Cloud has nothing saved yet AND local has data → upload local
//   4. Both empty → start fresh (default dashboard)

export async function syncOnLogin(prefetched = null) {
  const owner = getDataOwner();
  const cloudResult = prefetched ? (prefetched.ok ? prefetched.data : null) : await cloudLoad();

  if (!cloudResult || getDataOwner() !== owner) {
    // Network error or session expired — proceed with local data
    return;
  }

  const cloudProfile = cloudResult.profile;
  const cloudSaved = isSavedProfile(cloudProfile);
  const localRaw = localStorage.getItem(getActiveStorageKey());
  let localHasData = false;
  try { localHasData = localRaw ? isProfileMeaningful(JSON.parse(localRaw)) : false; } catch (e) { localHasData = false; }

  // Local has unsynced changes from a previous session (persisted dirty flag)
  // → local is authoritative: upload it instead of letting stale cloud data overwrite it
  const localDirty = localStorage.getItem(getDirtyFlagKey()) === '1';
  if (localDirty && localHasData) {
    _dirty = true;
    // Reuse the profile just fetched for the time-log merge
    const saveResult = await cloudSave({ ok: true, data: cloudResult });
    if (saveResult.ok) {
      return { action: 'uploaded_local' };
    }
    // Upload failed — keep local data and the dirty flag; retry via sync timer
    return { action: 'none' };
  }

  if (cloudSaved) {
    // Cloud is authoritative — load it
    localStorage.setItem(getActiveStorageKey(), JSON.stringify(cloudProfile));
    // Signal that a reload is needed
    return { action: 'loaded_cloud' };
  }
  if (cloudProfile && typeof cloudProfile === 'object' && Object.keys(cloudProfile).length > 0) {
    // Something is stored but it isn't a dashboard: never overwrite it blindly
    console.warn('[Sync] Cloud profile missing sections array — skipping cloud load');
    return { action: 'none' };
  }

  if (localHasData) {
    // Nothing saved in the cloud yet: this account's local copy goes up
    _dirty = true;
    const saveResult = await cloudSave({ ok: true, data: cloudResult });
    if (saveResult.ok) {
      showToast('Local dashboard uploaded to your account');
    }
    return { action: 'uploaded_local' };
  }

  // Both empty — nothing to do
  return { action: 'none' };
}

// A profile the cloud has saved (the Worker answers {} when there is none)
function isSavedProfile(profile) {
  return !!profile && typeof profile === 'object' && Array.isArray(profile.sections);
}

// --- Helper: determine if a profile object has meaningful user data ---
// A profile is "meaningful" if it has at least one section with data.
function isProfileMeaningful(profile) {
  if (!profile || typeof profile !== 'object') return false;

  // Check if there are any sections defined
  if (Array.isArray(profile.sections) && profile.sections.length > 0) {
    // Check if any section has actual card data
    for (const section of profile.sections) {
      const sectionData = profile[section.id];
      if (sectionData && typeof sectionData === 'object') {
        // Check if any subtitle has items
        for (const subtitle of Object.keys(sectionData)) {
          const sub = sectionData[subtitle];
          if (!sub) continue;
          if ((sub.icons && sub.icons.length > 0) ||
              (sub.reminders && sub.reminders.length > 0) ||
              (sub.subtasks && sub.subtasks.length > 0) ||
              (sub.copyPaste && sub.copyPaste.length > 0)) {
            return true;
          }
        }
      }
    }
  }

  // Also check for tasks, meetings, projects, ideas
  if (Array.isArray(profile.tasks) && profile.tasks.length > 0) return true;
  if (Array.isArray(profile.meetings) && profile.meetings.length > 0) return true;
  if (Array.isArray(profile.projects) && profile.projects.length > 0) return true;
  if (Array.isArray(profile.ideas) && profile.ideas.length > 0) return true;

  // Check if header has been customized from defaults
  if (profile.header) {
    if (profile.header.profileName && profile.header.profileName !== 'Your Name') return true;
    if (profile.header.profileTitle && profile.header.profileTitle !== 'Your Title') return true;
  }

  return false;
}
