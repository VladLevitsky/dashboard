// Personal Dashboard - Cloud Sync Module
// Handles dirty flag tracking, cloud save/load via Cloudflare Worker,
// 20-minute background sync, and login reconciliation.

import { STORAGE_KEY, SCOPED_KEY_PREFIX, SYNC_INTERVAL_MS } from '../constants.js';
import { isLoggedIn, getUsername, getAuthToken, apiCall } from './auth.js';
import { model } from '../state.js';
import { showToast } from '../utils.js';
import { mergeTimeLogs, normalizeTimeLog } from './time-log.js';
import { makeSyncStamp } from './mobile-sync.js';

// --- Scoped localStorage key management ---

// Returns the localStorage key for the given username, or the legacy key if anonymous
export function getActiveStorageKey() {
  const username = getUsername();
  if (!username) return STORAGE_KEY;
  return `${SCOPED_KEY_PREFIX}${username}_model_v2`;
}

// Migrate legacy (anonymous) localStorage data to a user-scoped key.
// Called once on first login/register on this browser.
// Does NOT delete the legacy key — it remains for anonymous fallback.
export function migrateToScopedStorage(username) {
  const scopedKey = `${SCOPED_KEY_PREFIX}${username}_model_v2`;

  // If scoped data already exists, user has logged in on this browser before — no migration needed
  if (localStorage.getItem(scopedKey)) return;

  // Copy legacy data to the scoped key (first-time migration)
  const legacyData = localStorage.getItem(STORAGE_KEY);
  if (legacyData) {
    localStorage.setItem(scopedKey, legacyData);
  }
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

export function markCloudDirty() {
  if (isLoggedIn()) {
    _dirty = true;
    _dirtyGeneration++;
    try { localStorage.setItem(getDirtyFlagKey(), '1'); } catch (e) { /* quota — in-memory flag still set */ }
  }
}

export function isCloudDirty() {
  return _dirty;
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
// `prefetched` is a GET /profile result the caller already has.
async function mergeCloudTimeLog(prefetched = null) {
  const result = prefetched || await apiCall('GET', '/profile');
  if (!result.ok) return result; // offline etc. — the upload below reports the failure

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

  try {
    const mergeResult = await mergeCloudTimeLog(prefetchedProfile);
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
      if (generation === _dirtyGeneration) {
        _dirty = false;
        try { localStorage.removeItem(getDirtyFlagKey()); } catch (e) { /* ignore */ }
      }

      // D1 save succeeded — flush any queued R2 file deletions
      if (window.flushPendingR2Deletions) {
        try { await window.flushPendingR2Deletions(); } catch (e) {
          console.warn('[R2 cleanup] Error during flush after cloud save:', e);
        }
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
// Called after successful login/register, AFTER restoreModel() has loaded local data.
//
// Rules:
//   1. Cloud has meaningful data → use cloud (authoritative)
//   2. Cloud is empty AND local has data → upload local (first-time migration)
//   3. Both empty → start fresh (default dashboard)

export async function syncOnLogin() {
  const cloudResult = await cloudLoad();

  if (!cloudResult) {
    // Network error or session expired — proceed with local data
    return;
  }

  const cloudProfile = cloudResult.profile;
  const cloudHasData = isProfileMeaningful(cloudProfile);
  const localRaw = localStorage.getItem(getActiveStorageKey());
  const localHasData = localRaw ? isProfileMeaningful(JSON.parse(localRaw)) : false;

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

  if (cloudHasData) {
    // Validate that cloud data looks like a dashboard model before trusting it
    if (!cloudProfile.sections || !Array.isArray(cloudProfile.sections)) {
      console.warn('[Sync] Cloud profile missing sections array — skipping cloud load');
      return { action: 'none' };
    }
    // Cloud is authoritative — load it
    localStorage.setItem(getActiveStorageKey(), JSON.stringify(cloudProfile));
    // Signal that a reload is needed
    return { action: 'loaded_cloud' };
  }

  if (!cloudHasData && localHasData) {
    // First-time migration: upload existing local data to cloud
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
