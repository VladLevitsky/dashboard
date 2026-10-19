// Personal Dashboard - Cloud Sync Module
// Dirty flag tracking, the one cloud sync (cloudSync), the 20-minute timer,
// login reconciliation and each account's copy on this browser.
//
// Change-based sync (user decision 2026-10-19: "if there is no action on either
// device to delete something, the non-deleted one should win"). The cloud keeps
// ONE profile row and a PUT replaces it whole, so no device ever uploads its copy
// as it is: every upload AND every pull merges three copies (profile-merge.js):
//   base   the last version this browser and the cloud agreed on, kept whole in
//          IndexedDB (sync-base.js) and named by the stored copy's `_base`
//   local  this browser's stored copy of the account (localStorage)
//   cloud  GET /profile now
// A device changes or deletes something only when its own copy changed it since
// the base; everything else comes from the cloud; deleted on one side and changed
// on the other is kept. Modes (mobile-sync.js mergeModeFor):
//   trusted  the cloud descends from the base (the upload stamps' lineage; the
//            Worker's rev / chain only where the stamps can't tell: a rev repeats
//            after a D1 restore or a Worker rollback)
//   guarded  it doesn't (an older client, or a race, wrote it): nothing missing
//            from the cloud is deleted here; its additions and edits still come in
//   union    no base (the first sync after this shipped, cleared site data): both
//            are kept whole; a value both hold differently comes from the cloud copy
//            only when it is a newer upload of this build (an older build's stamp says
//            nothing: it re-stamped every page load), else from this copy
//   replace  a JSON import (`_replace` in the stored copy): this copy as is, only
//            the time log merged (the import's resetAt drops older history)
// cloudSync():
//   GET → read the stored copy (again after every await) → merge → if the merge
//   changes this copy: write it + apply it to the model + re-render, synchronously
//   (unless applying is blocked: edit mode, a dashboard load, an open editor;
//   it then waits and runs again when that ends) → if the merge isn't what the
//   cloud holds: PUT it (?rev=N when the Worker said its rev: a 409 means someone
//   saved meanwhile → again from the GET, at most 3 times) → the base moves only to
//   a version the cloud is known to hold (after the PUT, or the cloud copy itself).
// cloudSave() is cloudSync() (every caller of the old upload goes through it).
// Pages of one browser share the stored copy: a save never writes over another page's
// write it hasn't seen (storage.js saveModel merges into it), a copy taken over from
// another page keeps its base (moveStoredBase), and a meta-only write of another page
// (its base moved, its import done) updates this page's record (refreshStoredMeta).

import { STORAGE_KEY, SCOPED_KEY_PREFIX, SYNC_INTERVAL_MS, DEFAULT_TASK_CATEGORIES } from '../constants.js';
import { isLoggedIn, getDataOwner, apiCall } from './auth.js';
import { editState } from '../state.js';
import { showToast } from '../utils.js';
import { mergeProfiles, profileHash, capTaskCategories, DEVICE_SECTION_KEYS } from './profile-merge.js';
import { getBase, putBase } from './sync-base.js';
import { makeSyncStamp, makeUploadStamp, versionIdOf, mergeModeFor, isSameVersion } from './mobile-sync.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

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

// --- What this page last knew of each saved copy ---
// The exact text this page last wrote to or read from a copy's key (saveModel,
// restoreModel, a cloud copy stored by a sign-in, a sync). A page Chrome brings
// back from its back/forward cache compares it with what is stored now
// (storage.js storedModelChangedElsewhere, init.js): another page of this
// browser changed the dashboard while this one was frozen, so this page's model
// is older and its next save would write over that change.
// The meta fields (_sync, _base, _replace) are left out: every load may re-stamp
// the copy, and a sync moves its base
const _knownCopies = new Map();
const META_FIELDS = ['_sync', '_base', '_replace'];

export function noteStoredCopy(key, raw) {
  if (key) _knownCopies.set(key, typeof raw === 'string' ? raw : null);
}

function withoutMeta(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') META_FIELDS.forEach(k => { delete obj[k]; });
    return JSON.stringify(obj);
  } catch (e) {
    return raw;
  }
}

// Two stored copies hold the same dashboard (their meta fields aside)
export function sameStoredContent(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return withoutMeta(a) === withoutMeta(b);
}

export function storedCopyChangedElsewhere(key) {
  return !!storedCopyIfChangedElsewhere(key);
}

// The same question for a save that is about to write (storage.js saveModel): null when
// the stored copy still holds what this page last knew (its meta fields aside, or this
// page never read the key), else { known, now }: the text this page last knew (null =
// no copy then) and the text stored now (null = removed since)
export function storedCopyIfChangedElsewhere(key) {
  if (!key || !_knownCopies.has(key)) return null;
  let now = null;
  try { now = localStorage.getItem(key); } catch (e) { return null; }
  const known = _knownCopies.get(key);
  if (now === known) return null;
  if (now !== null && known !== null && sameStoredContent(now, known)) return null;
  return { known, now };
}

// --- Copies this page took over from another page of this browser ---
// A storage listener (init.js, sync-guard.js) reloading another tab's write, or a save
// that merged another tab's write and then re-read it (storage.js). A sync that read
// this browser's copy before one of these never moves the copy's base afterwards
// (moveStoredBase): the copy on screen may lack what that sync uploaded
let _adoptions = 0;

export function noteAdoptedCopy() {
  _adoptions++;
}

// Another page changed only the meta fields of the copy this page shows (its sync moved
// the base, or cleared a done import's _replace): this page's own record of them
// follows, but only while it holds the same dashboard (an older model never pairs with
// a newer base). prev: the text the write replaced, when the caller already knows it
// holds the same dashboard as `raw` (a storage event's oldValue). Returns true when it did
export function refreshStoredMeta(key, raw, prev = null) {
  if (!key || typeof raw !== 'string' || !_knownCopies.has(key)) return false;
  const known = _knownCopies.get(key);
  if (typeof known !== 'string') return false;
  if (known !== prev && !sameStoredContent(known, raw)) return false;
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return false; }
  if (!isObj(obj)) return false;
  noteStoredCopy(key, raw);
  noteStoredBase(key, obj._base);
  noteReplacePending(key, obj._replace === true);
  return true;
}

// --- Each stored copy's base and its pending replace (the meta fields saveModel writes) ---
// _base: the version (sync-base.js record id) the stored copy descends from. A
// copy names its own base, so a stale tab's write never pairs with a newer one.
// _replace: a JSON import waiting to replace the cloud copy (cleared once it did).
// The signed-out dashboard (STORAGE_KEY) has neither
const _storedBase = new Map();
const _replacePending = new Map();

export function noteStoredBase(key, id) {
  if (!key) return;
  if (key !== STORAGE_KEY && typeof id === 'string' && id) _storedBase.set(key, id);
  else _storedBase.delete(key);
}

export function getStoredBase(key) {
  return (key && _storedBase.get(key)) || null;
}

export function noteReplacePending(key, on) {
  if (!key) return;
  if (on && key !== STORAGE_KEY) _replacePending.set(key, true);
  else _replacePending.delete(key);
}

export function isReplacePending(key) {
  return !!key && _replacePending.get(key) === true;
}

// --- The account's dashboard is still being loaded ---
// The startup sync, or a sign-in, may still replace the model with the
// account's (cloud) copy. An edit session opened meanwhile would hold a working
// copy of the dashboard about to be replaced, and its Confirm would write that
// over the newer copy, so edit mode waits (edit-mode.js toggleEditMode)
let _dashboardLoads = 0;

export function beginDashboardLoad() {
  _dashboardLoads++;
}

export function endDashboardLoad() {
  _dashboardLoads = Math.max(0, _dashboardLoads - 1);
}

export function isDashboardLoading() {
  return _dashboardLoads > 0;
}

// --- Applying a merge to the model ---
// storage.js registers the applier (reset the model, read the stored copy, re-render),
// so this module never imports it. Blockers: something the user is in the middle of
// would write whole stale fields back over a merge applied under it (an open task
// editor writes its subtasks, Task Settings its categories), which the next sync
// would read as this device deleting the newer ones. Edit mode and a dashboard load
// always block; init.js adds the editors, the phone shell its gestures and composer
let _applyModel = null;
const _applyBlockers = new Set();

export function setModelApplier(fn) {
  _applyModel = typeof fn === 'function' ? fn : null;
}

export function addApplyBlocker(fn) {
  if (typeof fn !== 'function') return () => {};
  _applyBlockers.add(fn);
  return () => { _applyBlockers.delete(fn); };
}

// duringLoad: the dashboard load that is itself syncing (syncOnLogin) doesn't block itself
export function isApplyBlocked({ duringLoad = false } = {}) {
  if (editState && editState.enabled) return true;
  if (!duringLoad && isDashboardLoading()) return true;
  for (const fn of _applyBlockers) {
    try { if (fn()) return true; } catch (e) { /* a broken check never blocks */ }
  }
  return false;
}

// A sync that couldn't apply its merge runs again once nothing blocks it
const DEFER_POLL_MS = 1500;
let _deferred = false;
let _deferTimer = null;

function later(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();   // Node tests: never keeps the process alive
  return t;
}

export function isSyncDeferred() {
  return _deferred;
}

function scheduleDeferredSync() {
  _deferred = true;
  if (_deferTimer) return;
  const tick = () => {
    _deferTimer = null;
    if (!_deferred) return;
    if (!isLoggedIn()) { _deferred = false; return; }
    if (isApplyBlocked()) { _deferTimer = later(tick, DEFER_POLL_MS); return; }
    _deferred = false;
    cloudSave(null, { quiet: true, reason: 'deferred' }).then((r) => {
      if (r && r.busy) scheduleDeferredSync();     // another sync was running: look again
    }, () => {});
  };
  _deferTimer = later(tick, DEFER_POLL_MS);
}

function clearDeferredSync() {
  _deferred = false;
  if (_deferTimer) { clearTimeout(_deferTimer); _deferTimer = null; }
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

// The version id a cloud copy is known by: its upload stamp, else a content hash
// (a copy without a stamp: an old client, a server-side edit). null: no profile
function cloudVersionOf(profile) {
  if (!isObj(profile) || !Object.keys(stripMeta(profile)).length) return null;
  return versionIdOf(profile) || 'hash:' + profileHash(profile);
}

const revOf = (data) => (data && Number.isInteger(data.rev) ? data.rev : null);
const chainOf = (data) => (data && typeof data.chain === 'string' ? data.chain : '');

// --- Right after a sign-in, before the account's dashboard is read ---
// Makes this browser's copy for the account the account's own, so nothing of
// the signed-out dashboard or another account is shown, merged or uploaded:
//   · a copy of this account already here → kept (changes it holds that never
//     synced are merged in syncOnLogin, e.g. ones made after its session ended)
//   · else the account's cloud copy, when it has one (also for created: an
//     account that turns out to have a saved copy is never given another one);
//     it is also the copy's base (the next sync is an exact 3-way merge)
//   · else (nothing saved yet) the signed-out dashboard, only for an account
//     created just now on this browser (created), once; otherwise empty
// Returns { ok, source: 'local' | 'cloud' | 'carried' | 'empty', cloud? }
// (cloud: the GET /profile result, for syncOnLogin). ok false: the cloud copy
// couldn't be read for an account this browser has no copy of, or this
// browser's storage couldn't hold the copy (error 'storage'); the sign-in must
// not go on (it would show, and later upload, the wrong dashboard)
export async function prepareAccountCopy(username, { created = false } = {}) {
  const key = scopedStorageKey(username);
  if (localStorage.getItem(key)) return { ok: true, source: 'local' };

  // Writes all of a copy or none of it (a full storage leaves no half copy)
  const store = (entries) => {
    try {
      entries.forEach(([k, v]) => localStorage.setItem(k, v));
      entries.forEach(([k, v]) => { if (k === key) noteStoredCopy(k, v); });
      return true;
    } catch (e) {
      entries.forEach(([k]) => { try { localStorage.removeItem(k); } catch (err) { /* ignore */ } });
      return false;
    }
  };
  const storageFull = { ok: false, error: 'storage' };

  let result = await apiCall('GET', '/profile');
  if (!result.ok) {
    // An account registered just now has nothing saved in the cloud yet, and
    // its username is taken by then (stopping would mean the signed-out
    // dashboard could never go into it): a failed read goes on, and syncOnLogin
    // reads the cloud itself. An ended session (401) stops it all the same
    if (!created || result.status === 401) return { ok: false, status: result.status, error: result.error };
    result = null;
  } else {
    const profile = result.data && result.data.profile;
    if (isSavedProfile(profile)) {
      const id = cloudVersionOf(profile);
      if (!store([[key, JSON.stringify({ ...profile, _base: id || undefined })]])) return storageFull;
      noteStoredBase(key, id);
      noteReplacePending(key, false);
      if (id) await putBase(key, { id, rev: revOf(result.data), chain: chainOf(result.data), raw: stripMeta(profile) });
      return { ok: true, source: 'cloud', cloud: result };
    }
  }

  if (created && signedOutDashboardIsOwn()) {
    const raw = localStorage.getItem(STORAGE_KEY);
    let signedOut = null;
    try { signedOut = raw ? JSON.parse(raw) : null; } catch (e) { signedOut = null; }
    if (isProfileMeaningful(signedOut)) {
      // Uploaded by syncOnLogin (unsynced changes of this account now)
      if (!store([[key, raw], [key + '__dirty', '1'], [CARRIED_KEY, username]])) return storageFull;
      return { ok: true, source: 'carried', cloud: result };
    }
  }
  return { ok: true, source: 'empty', cloud: result };
}

// --- Dirty flag & sync timer ---

let _dirty = false;
let _dirtyGeneration = 0; // bumps on every change, so a sync only clears what it carried
let _syncTimerId = null;
let _isSaving = false;
let _updateRequiredShown = false; // the 'reload to sync' toast, once per page
let _savePromise = null; // the sync in flight (waitForCloudSave)

// Dirty flag is also persisted to localStorage so unsynced changes
// survive a page refresh (the next sync merges them in).
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

// The stored copy holds something the cloud doesn't (a merge written before its
// upload): flagged without counting as a new change, so the upload still clears it
function markUnsynced(key) {
  try { localStorage.setItem(key + '__dirty', '1'); } catch (e) { /* the in-memory flag still says so */ }
  if (key === getActiveStorageKey() && isLoggedIn()) _dirty = true;
}

function clearDirty(key) {
  _dirty = false;
  try { localStorage.removeItem(key + '__dirty'); } catch (e) { /* ignore */ }
}

export function isCloudDirty() {
  return _dirty;
}

// Another account's copy (or the signed-out dashboard) is about to be shown:
// the in-memory flag was the previous copy's (which keeps its stored flag)
export function resetSyncState() {
  _dirty = false;
  _dirtyGeneration++;
  clearDeferredSync();
}

// Unsynced changes in this page OR left by an earlier session (the persisted
// flag). The in-memory flag starts false on every load. Phones (sync-guard.js)
// ask this one, so an offline start never reads as "synced"
export function hasUnsyncedChanges() {
  if (_dirty) return true;
  if (!isLoggedIn()) return false;
  try { return localStorage.getItem(getDirtyFlagKey()) === '1'; } catch (e) { return false; }
}

// --- The stored copy ---

function stripMeta(p) {
  const out = {};
  if (!isObj(p)) return out;
  for (const k of Object.keys(p)) if (!META_FIELDS.includes(k)) out[k] = p[k];
  return out;
}

function readRaw(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// Writes a whole stored copy (its meta fields included) and notes what it now holds
function writeStored(key, obj) {
  const json = JSON.stringify(obj);
  try {
    localStorage.setItem(key, json);
  } catch (e) {
    console.error('[Sync] could not store the merged copy', e);
    return false;
  }
  noteStoredCopy(key, json);
  noteStoredBase(key, obj._base);
  noteReplacePending(key, obj._replace === true);
  return true;
}

// The stored copy and its base record, consistent: read again after the base
// lookup's await (a save meanwhile may have changed the copy, or its base)
async function readLocalWithBase(key) {
  for (let i = 0; i < 3; i++) {
    const raw = readRaw(key);
    if (!raw) return { raw: null, profile: null, baseRec: null };
    let profile;
    try { profile = JSON.parse(raw); } catch (e) { return { error: 'This browser’s copy of the dashboard can’t be read.' }; }
    if (!isObj(profile)) return { error: 'This browser’s copy of the dashboard can’t be read.' };
    const baseId = typeof profile._base === 'string' && profile._base ? profile._base : null;
    const baseRec = baseId ? await getBase(key, baseId) : null;
    if (readRaw(key) === raw) return { raw, profile, baseRec: baseRec && baseRec.id === baseId ? baseRec : null };
  }
  // It keeps changing: as it is now, without a base (a union merge keeps everything)
  const raw = readRaw(key);
  if (!raw) return { raw: null, profile: null, baseRec: null };
  try { return { raw, profile: JSON.parse(raw), baseRec: null }; } catch (e) { return { error: 'This browser’s copy of the dashboard can’t be read.' }; }
}

// After an upload: the stored copy now descends from the version the cloud holds
// (`to`). Only a copy this page wrote or read last, still naming the base it had
// (`from`), and only when this page took over no other page's copy since the sync
// read it (`adoptions`: what _adoptions was then): another page's write names its
// own base and keeps it, and so does a copy this page reloaded from another tab (it
// may lack what was just uploaded; under the newer base that would read as deleted).
// clearReplace: the import this copy asked for is in the cloud now, so it never asks
// again, whatever happens to the base (a copy that still names the import's base is
// the import, or another page's merge into it)
function moveStoredBase(key, from, to, { clearReplace = false, adoptions = null } = {}) {
  const raw = readRaw(key);
  if (!raw) return false;
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return false; }
  if (!isObj(obj) || (obj._base || null) !== (from || null)) return false;
  const known = _knownCopies.get(key);
  const mine = raw === known && (adoptions === null || adoptions === _adoptions);
  if (mine) {
    obj._base = to;
    if (clearReplace) delete obj._replace;
    return writeStored(key, obj);
  }
  if (!clearReplace || obj._replace !== true) return false;
  // Only the replace goes; the copy keeps its base (an ancestor of it and of the upload)
  delete obj._replace;
  const json = JSON.stringify(obj);
  try { localStorage.setItem(key, json); } catch (e) { return false; }
  // What this page knows of the copy moves along only when it holds that dashboard
  if (typeof known === 'string' && sameStoredContent(known, json)) noteStoredCopy(key, json);
  noteReplacePending(key, false);
  return true;
}

// --- The merge, as a sync runs it ---

const stampAt = (p) => (isObj(p) && isObj(p._sync) && Number.isFinite(p._sync.at) ? p._sync.at : 0);
// An upload stamp of this build (it names its version). Older builds' stamps
// ({ device, at }) and every local save's say nothing about recency: older builds
// re-stamped the copy on every page load, so a stale copy that was only opened reads
// as the newest
const hasUploadStamp = (p) => isObj(p) && isObj(p._sync) && typeof p._sync.id === 'string' && p._sync.id !== '';
const stableJson = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
};

function isDefaultCategoryList(list) {
  if (list === undefined) return true;          // missing: the app shows the defaults
  if (!Array.isArray(list) || list.length !== DEFAULT_TASK_CATEGORIES.length) return false;
  return DEFAULT_TASK_CATEGORIES.every((d, i) => isObj(list[i]) && list[i].id === d.id && String(list[i].name || '').trim() === d.name);
}

// Union mode: a side whose category list is exactly the new-dashboard defaults
// never chose them; the other side's own list stands (a default a task uses stays)
function settleUnionCategories(merged, local, cloud) {
  const lDef = isDefaultCategoryList(local.taskCategories);
  const cDef = isDefaultCategoryList(cloud.taskCategories);
  if (lDef === cDef) return;
  const own = arr(lDef ? cloud.taskCategories : local.taskCategories).filter(isObj);
  const ids = new Set(own.map(c => c.id));
  const used = new Set([...arr(merged.tasks), ...arr(merged.completedTasks)].filter(isObj).map(t => t.categoryId).filter(Boolean));
  const keep = arr(merged.taskCategories).filter(c => isObj(c) && !ids.has(c.id) && used.has(c.id));
  merged.taskCategories = [...JSON.parse(JSON.stringify(own)), ...keep];
  capTaskCategories(merged, { local, cloud });
}

// Union mode with the cloud copy known to be newer than this one (an upload of this
// build, while this copy has no such stamp or an older one): the cloud's value wins
// where the two differ, so the merge runs with the sides swapped and this device's
// own fields are put back (lastActiveMode, the flat grid props: this device's, unless
// the cloud changed this mode's layout profile)
function keepDeviceFields(merged, local, cloud) {
  const mode = local.lastActiveMode !== undefined ? local.lastActiveMode : cloud.lastActiveMode;
  if (mode !== undefined) merged.lastActiveMode = mode; else delete merged.lastActiveMode;
  const localSections = new Map(arr(local.sections).filter(isObj).map(s => [s.id, s]));
  const profileOf = (s) => (mode && isObj(s.layouts) && isObj(s.layouts[mode]) ? s.layouts[mode] : null);
  const valid = (p) => p && Number.isFinite(p.col) && Number.isFinite(p.row);
  const setFlat = (s, p) => {
    s.gridCol = p.col;
    s.gridRow = p.row;
    if (Number.isFinite(p.colSpan)) s.gridColSpan = p.colSpan; else delete s.gridColSpan;
    if (Number.isFinite(p.rowSpan)) s.gridRowSpan = p.rowSpan; else delete s.gridRowSpan;
  };
  for (const s of arr(merged.sections)) {
    if (!isObj(s)) continue;
    const ls = localSections.get(s.id);
    const p = profileOf(s);
    if (ls) {
      if (valid(p) && stableJson(p) !== stableJson(profileOf(ls))) setFlat(s, p);
      else DEVICE_SECTION_KEYS.forEach(k => { if (k in ls) s[k] = ls[k]; else delete s[k]; });
    } else if (mode && cloud.lastActiveMode !== mode) {
      if (valid(p)) setFlat(s, p);
      else ['gridCol', 'gridRow', 'gridColSpan', 'gridRowSpan'].forEach(k => { delete s[k]; });
    }
  }
}

// Union: which copy is newer is known only from an upload stamp of this build. Without
// one on the cloud copy (two older stamps), nothing tells, so a value both hold
// differently keeps the merge's own rule (this device's, unless it is empty or a
// default and the cloud's isn't) and counts as a conflict (stats.legacyStamps)
function unionCloudIsNewer(local, cloud) {
  if (!hasUploadStamp(cloud)) return false;
  return !hasUploadStamp(local) || stampAt(cloud) > stampAt(local);
}

function mergeForSync({ base, local, cloud, mode }) {
  if (mode !== 'union') return mergeProfiles({ base, local, cloud, mode });
  const swap = unionCloudIsNewer(local, cloud) && isSavedProfile(cloud) && isSavedProfile(local);
  const r = swap
    ? mergeProfiles({ local: cloud, cloud: local, mode: 'union' })
    : mergeProfiles({ local, cloud, mode: 'union' });
  if (swap) keepDeviceFields(r.merged, local, cloud);
  else if (r.stats && !hasUploadStamp(cloud)) r.stats.legacyStamps = true;
  settleUnionCategories(r.merged, local, cloud);
  const mh = profileHash(r.merged);
  return { ...r, localChanged: mh !== profileHash(local), cloudChanged: mh !== profileHash(cloud) };
}

// --- The one cloud sync ---
// cloudSave(prefetched?, opts?) / cloudSync(opts?). One at a time: while one is in
// flight the answer is { ok: false, busy: true } (not a failure, look again).
//   prefetched  a GET /profile result the caller already has ({ ok, data })
//   opts        { quiet, render (re-render after applying, default true),
//                 duringLoad (the dashboard load itself is syncing), reason }
// Answers { ok: true, idle?, applied?, uploaded?, cloudWasEmpty? } or
// { ok: false, deferred | busy | status, error }

export async function cloudSave(prefetchedProfile = null, opts = null) {
  if (!isLoggedIn()) return { ok: false };
  if (_isSaving) return { ok: false, busy: true };
  _isSaving = true;
  _savePromise = runCloudSync(prefetchedProfile, opts || {}).finally(() => {
    _isSaving = false;
    _savePromise = null;
  });
  return _savePromise;
}

export function cloudSync(opts = {}) {
  return cloudSave(opts && opts.prefetched ? opts.prefetched : null, opts || {});
}

// Settles when the sync in flight (if any) is done, whatever its outcome
export function waitForCloudSave() {
  return _savePromise ? _savePromise.then(() => {}, () => {}) : Promise.resolve();
}

const MAX_ATTEMPTS = 3;

async function runCloudSync(prefetched, opts) {
  // Signed in or out while waiting: this sync was for the previous copy
  const owner = getDataOwner();
  const key = getActiveStorageKey();
  const switched = () => getDataOwner() !== owner || !isLoggedIn();
  try {
    let pre = prefetched;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await syncAttempt(pre, opts, { key, switched });
      pre = null;
      if (!result || !result.retry) return result;
    }
    return { ok: false, status: 409, error: 'The cloud copy kept changing. Will retry.' };
  } catch (err) {
    console.error('[Sync] failed:', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function sessionExpired(result) {
  _dirty = false; // Can't sync without auth (the stored flag keeps the changes waiting)
  if (window.renderAuthUI) window.renderAuthUI();
  showToast('Session expired. Please sign in again.');
  return result;
}

function applyToModel(opts) {
  if (_applyModel) _applyModel({ render: opts.render !== false });
}

async function syncAttempt(prefetched, opts, { key, switched }) {
  const res = prefetched || await apiCall('GET', '/profile');
  if (res.status === 401) return sessionExpired(res);
  if (switched()) return { ok: false, error: 'Signed in or out meanwhile.' };
  // Can't see the cloud copy: never upload blind (a 404 = nothing saved yet)
  if (!res.ok && res.status !== 404) return res;
  const data = (res.ok && isObj(res.data)) ? res.data : {};
  const cloud = isObj(data.profile) ? data.profile : {};
  const rev = Number.isInteger(data.rev) ? data.rev : undefined;
  const chain = typeof data.chain === 'string' ? data.chain : undefined;
  const cloudEmpty = !Object.keys(stripMeta(cloud)).length;

  // (checked again here: other code may have saved between that read and now)
  let local = await readLocalWithBase(key);
  for (let i = 0; i < 2 && !local.error && readRaw(key) !== local.raw; i++) local = await readLocalWithBase(key);
  if (switched()) return { ok: false, error: 'Signed in or out meanwhile.' };
  if (local.error) return { ok: false, error: local.error };
  if (readRaw(key) !== local.raw) return { ok: false, busy: true };   // still changing: look again shortly

  // ---- From here to the PUT: no await (the stored copy can't change under the merge)
  const generation = _dirtyGeneration;
  const adoptions = _adoptions;      // a copy taken over from another tab after this keeps its base

  // No copy here yet (a sign-in with nothing saved, nothing changed since): the cloud's
  if (!local.raw) {
    if (!isSavedProfile(cloud)) return { ok: true, idle: true };
    if (isApplyBlocked(opts)) { scheduleDeferredSync(); return { ok: false, deferred: true }; }
    const id = cloudVersionOf(cloud);
    if (!writeStored(key, { ...cloud, _base: id || undefined })) return { ok: false, error: 'storage' };
    const basePut = id ? putBase(key, { id, rev: rev ?? null, chain: chain || '', raw: stripMeta(cloud) }) : null;
    applyToModel(opts);
    if (generation === _dirtyGeneration) clearDirty(key);
    if (basePut) await basePut;
    return { ok: true, applied: true };
  }

  const L = local.profile;
  const B = local.baseRec;
  const unsynced = hasUnsyncedChanges();
  let mode;
  if (L._replace === true) mode = 'replace';
  else if (!cloudEmpty && !isSavedProfile(cloud)) mode = 'union';     // not a dashboard: keep both
  else if (B) mode = mergeModeFor(B, cloud, { rev, chain });
  else mode = 'union';

  const cloudId = cloudVersionOf(cloud);
  let merged;
  let localChanged;
  let cloudChanged;
  // (the cloud's own version id too: a rev on the same chain repeats after a restore)
  if (mode !== 'replace' && B && isSameVersion(cloud, B, { rev, chain }) && cloudId === B.id) {
    // Nothing changed in the cloud since the base: this copy is the merge
    if (!unsynced) return { ok: true, idle: true };
    merged = stripMeta(L);
    localChanged = false;
    cloudChanged = profileHash(merged) !== profileHash(cloud);
  } else {
    ({ merged, localChanged, cloudChanged } = mergeForSync({ base: B ? B.raw : null, local: L, cloud, mode }));
  }
  // Nothing saved in the cloud and nothing of this account's own here: no blank
  // dashboard goes up (it would only add defaults to the next device's first sync)
  if (cloudEmpty && cloudChanged && !hasOwnContent(merged)) cloudChanged = false;

  let applied = false;
  let deferApply = false;
  let expectedBase = B ? B.id : (typeof L._base === 'string' && L._base ? L._base : null);
  let basePut = null;

  if (localChanged) {
    if (isApplyBlocked(opts)) {
      scheduleDeferredSync();
      if (!cloudChanged) {
        // The cloud already holds the import: it never replaces again (a later replace
        // would delete what other devices add meanwhile)
        if (mode === 'replace') moveStoredBase(key, expectedBase, expectedBase, { clearReplace: true, adoptions });
        return { ok: false, deferred: true };
      }
      // Upload what both hold now; this copy (and its base) stay as they are until
      // the apply (its base is still an ancestor of it, and of the upload)
      deferApply = true;
    } else {
      // The merge holds every change of the cloud copy, so that copy is its base
      const keepReplace = mode === 'replace' && cloudChanged;
      const stored = { ...merged, _sync: makeSyncStamp(), _base: cloudId || undefined, _replace: keepReplace ? true : undefined };
      if (!writeStored(key, stored)) return { ok: false, error: 'storage' };
      expectedBase = cloudId;
      if (cloudId) basePut = putBase(key, { id: cloudId, rev: rev ?? null, chain: chain || '', raw: stripMeta(cloud) });
      if (cloudChanged) markUnsynced(key);
      applyToModel(opts);
      applied = true;
    }
  }

  if (!cloudChanged) {
    // The cloud already holds all of it: the cloud copy is the base
    if (basePut) await basePut;
    else if (cloudId && !deferApply && cloudId !== expectedBase) {
      await putBase(key, { id: cloudId, rev: rev ?? null, chain: chain || '', raw: stripMeta(cloud) });
      if (!switched()) moveStoredBase(key, expectedBase, cloudId, { clearReplace: mode === 'replace', adoptions });
    } else if (mode === 'replace' && !switched()) {
      moveStoredBase(key, expectedBase, expectedBase, { clearReplace: true, adoptions });
    }
    if (!switched() && generation === _dirtyGeneration) clearDirty(key);
    return { ok: true, applied, idle: !applied };
  }

  // ---- Upload the merge. The dashboard on screen is final now (a startup sync lets
  // edit mode open from here: opts.onLocalReady)
  if (typeof opts.onLocalReady === 'function') {
    try { opts.onLocalReady(); } catch (e) { /* the caller's own problem */ }
  }
  const stamp = makeUploadStamp({ parent: isObj(cloud._sync) ? cloud._sync : null, parentId: cloudId, baseId: B ? B.id : null });
  const payload = { ...merged, _sync: stamp };
  if (basePut) await basePut;
  if (switched()) return { ok: false, error: 'Signed in or out meanwhile.' };
  const put = await apiCall('PUT', rev !== undefined ? `/profile?rev=${rev}` : '/profile', payload);

  if (put.ok) {
    const stillHere = !switched();
    if (stillHere) {
      if (!deferApply) {
        const newRev = revOf(put.data);
        const newChain = put.data && typeof put.data.chain === 'string' ? put.data.chain : (newRev !== null ? (chain || '') : '');
        await putBase(key, { id: stamp.id, rev: newRev, chain: newChain, raw: merged });
        if (!switched()) moveStoredBase(key, expectedBase, stamp.id, { clearReplace: mode === 'replace', adoptions });
      } else if (mode === 'replace') {
        // The import is in the cloud: this copy (applied later) keeps its base, an
        // ancestor of the import and of the upload, and never replaces again, so the
        // next sync is an ordinary merge (edit mode's Confirm, a closed tab's next start)
        moveStoredBase(key, expectedBase, expectedBase, { clearReplace: true, adoptions });
      }
      // Changes made while the sync was in flight still need one
      if (!switched() && generation === _dirtyGeneration) clearDirty(key);
      // D1 save succeeded: flush any queued R2 file deletions (after the merge was
      // applied, so files it brought back count as used)
      if (window.flushPendingR2Deletions) {
        try { await window.flushPendingR2Deletions(); } catch (e) {
          console.warn('[R2 cleanup] Error during flush after cloud save:', e);
        }
      }
    }
    // The cloud copy changed: Google Calendar mirrors it (google-calendar.js).
    // detail.payload is what was uploaded (the merge)
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try { window.dispatchEvent(new CustomEvent('cloud:saved', { detail: { payload } })); } catch (e) { /* no listeners to tell */ }
    }
    return { ok: true, uploaded: true, applied, cloudWasEmpty: cloudEmpty };
  }

  // A Worker that requires a revision this (old) page didn't send: not a race, so
  // retrying can't help; say it once (the phone guard retries quietly after that)
  if (put.status === 409 && put.data && put.data.error === 'update_required') {
    if (!_updateRequiredShown) {
      _updateRequiredShown = true;
      showToast('This page is out of date. Reload it to sync your changes.');
    }
    return { ok: false, status: 409, error: 'update_required' };
  }
  // Someone saved between the GET and the PUT: again from the GET
  if (put.status === 409) return { retry: true };
  if (put.status === 401) return sessionExpired(put);
  if (put.status === 413) showToast(put.error);
  return put;
}

// --- Cloud load: GET /profile ---

export async function cloudLoad() {
  if (!isLoggedIn()) return null;

  const result = await apiCall('GET', '/profile');

  if (result.ok && result.data) {
    return result.data; // { profile, updated_at, rev?, chain? }
  }

  if (result.status === 401) {
    if (window.renderAuthUI) window.renderAuthUI();
  }

  return null;
}

// --- Immediate sync (edit-mode confirm, import, sign-out, the item creator) ---
// A sync, now. Nothing changed on either side: nothing is uploaded.
// opts.quiet: no toast (the caller says how it went)
export async function immediateCloudSave(opts = null) {
  const quiet = !!(opts && opts.quiet === true);
  if (!isLoggedIn()) return { ok: false };

  const owner = getDataOwner();
  let result = await cloudSave(null, { quiet });

  if (result.busy) {
    // Another sync was on its way: it may have read the copy before this
    // change, so this one follows it (unless it carried everything)
    await waitForCloudSave();
    if (!isLoggedIn() || getDataOwner() !== owner) return { ok: false };
    result = hasUnsyncedChanges() ? await cloudSave(null, { quiet }) : { ok: true };
  }

  if (quiet) return result;
  if (result.ok) {
    showToast('Saved to cloud');
  } else if (result.status !== 401 && result.status !== 413 && !result.busy && !result.deferred) {
    // Subtle failure notice (non-intrusive)
    showToast("Couldn't sync to cloud. Will retry.");
  }

  return result;
}

// --- 20-minute background sync timer ---
// Unsynced changes go up; a page on screen also picks up other devices' changes

export function startSyncTimer() {
  stopSyncTimer(); // Prevent duplicates
  _syncTimerId = setInterval(() => {
    if (!isLoggedIn()) return;
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (_dirty || hasUnsyncedChanges() || visible) cloudSave(null, { quiet: true, reason: 'timer' });
  }, SYNC_INTERVAL_MS);
}

export function stopSyncTimer() {
  if (_syncTimerId !== null) {
    clearInterval(_syncTimerId);
    _syncTimerId = null;
  }
}

// --- Login reconciliation ---
// Called after a sign-in (once prepareAccountCopy made the local copy the
// account's own) and at start-up, AFTER restoreModel() has loaded local data.
// `prefetched`: a GET /profile result the caller already has. One sync: this
// copy's unsynced changes and the cloud's are merged (a copy with no base yet
// keeps everything from both); nothing saved in the cloud yet → this account's
// copy goes up (unless it holds nothing of its own).
// Returns { action: 'loaded_cloud' (the model was replaced with the merge) |
// 'uploaded_local' | 'none', result }, or nothing when signed out / switched.
// render: re-render after applying (completeSignIn renders itself);
// onLocalReady: called once the dashboard on screen is final, before the upload

export async function syncOnLogin(prefetched = null, { render = true, onLocalReady = null } = {}) {
  const owner = getDataOwner();
  if (!isLoggedIn()) return;
  await waitForCloudSave();
  if (!isLoggedIn() || getDataOwner() !== owner) return;
  const opts = { duringLoad: true, render, quiet: true, reason: 'login', onLocalReady };
  let result = await cloudSave(prefetched, opts);
  if (result && result.busy) {
    await waitForCloudSave();
    if (!isLoggedIn() || getDataOwner() !== owner) return;
    result = await cloudSave(null, opts);
  }
  if (!result || getDataOwner() !== owner) return;
  if (result.ok && result.uploaded && result.cloudWasEmpty) showToast('Local dashboard uploaded to your account');
  return {
    action: result.applied ? 'loaded_cloud' : (result.uploaded ? 'uploaded_local' : 'none'),
    result,
  };
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

// Anything of the account's own (more than isProfileMeaningful: an empty card,
// completed tasks, its own categories, notes, templates, tracked time)
function hasOwnContent(p) {
  if (!isObj(p)) return false;
  if (isProfileMeaningful(p)) return true;
  if (arr(p.sections).length) return true;
  if (arr(p.completedTasks).length || arr(p.subtaskTemplates).length) return true;
  if (Array.isArray(p.taskCategories) && !isDefaultCategoryList(p.taskCategories)) return true;
  for (const k of ['cardNotes', 'subtaskNotes']) {
    if (isObj(p[k]) && Object.values(p[k]).some(v => (Array.isArray(v) ? v.length > 0 : !!v))) return true;
  }
  return !!(isObj(p.timeTracking) && isObj(p.timeTracking.tasks) && Object.keys(p.timeTracking.tasks).length);
}
