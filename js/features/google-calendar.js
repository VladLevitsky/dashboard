// Personal Dashboard - Google Calendar (connection, task calendar sync, busy times)
// The Worker holds the Google connection (its key is encrypted in D1) and is the
// only thing that talks to Google. This module calls its /gcal/* routes with the
// normal dashboard session, so the browser never sees a Google token.
//
// - Tasks flagged `gcal: true` with a due date are mirrored into the app's own
//   "Dashboard tasks" calendar. The Worker reads them from the CLOUD profile, so
//   a sync runs after every successful upload ('cloud:saved', sync.js) and once
//   after startup; one that fails or stops early is tried again a few times
//   (planSyncRetry). On a computer a flagged-task change uploads after ~3 s
//   (phones already push 2.5 s after every save, sync-guard.js).
// - Busy times come from Google free/busy: start/end only, kept in memory.
// - Status is cached per account in localStorage so the UI shows at once.

import { isLoggedIn, getUsername, getAuthToken } from '../core/auth.js';
import { API_BASE } from '../constants.js';
import { hasUnsyncedChanges } from '../core/sync.js';
import { model, editState } from '../state.js';
import { showToast } from '../utils.js';
import { gcalSignature, busyFetchRange } from '../core/gcal-plan.js';
import { fromDateKey } from '../core/quick-capture-parse.js';

const STATUS_KEY = 'dashboard_gcal_status';
const DEFAULT_KEY = 'dashboard_gcal_default';
const BUSY_TTL_MS = 5 * 60 * 1000;
const BUSY_BACKOFF_MS = 60 * 1000;
const UPLOAD_DELAY_MS = 3000;

let status = null;        // last known /gcal/status for statusUser
let statusUser = null;
let pendingReturn = null; // { ok, reason } after coming back from Google
let syncing = null;
let syncAgain = false;
let lastSyncResult = null;
let seenSig = null;       // flagged-task signature last seen on a save
let uploadedSig = null;   // … and at the last successful upload
let uploadTimer = null;
let retryTimer = null;    // a failed / unfinished calendar sync, tried again later
let retryCount = 0;       // … how many times since the last clean run or upload
let retryOnline = false;  // … or failed offline: the 'online' event retries it
const busyCache = new Map(); // dayKey → { at, calendars, sig, failed }
const busyInflight = new Map();
let busyBackoffUntil = 0;
let busyVersion = 0;
const listeners = new Set();

// --- per-account storage ------------------------------------------------------

function accountKey(base) {
  const user = getUsername();
  return user ? `${base}@${user}` : null;
}

function readJson(key) {
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

function writeJson(key, value) {
  if (!key) return;
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* quota or private mode: memory still has it */ }
}

// A new account (or none) starts from its own cached status and an empty cache
function ensureAccount() {
  const user = isLoggedIn() ? getUsername() : null;
  if (user === statusUser) return;
  statusUser = user;
  status = user ? readJson(accountKey(STATUS_KEY)) : null;
  busyCache.clear();
  busyInflight.clear();
  busyBackoffUntil = 0;
  seenSig = null;
  uploadedSig = null;
  lastSyncResult = null;
  manualPending = false;
  clearSyncRetry(true);
  busyVersion++;
}

// --- change notification ------------------------------------------------------

export function onGcalChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch (e) { console.warn('[gcal] listener failed', e); }
  }
  if (window.refreshTodayView) window.refreshTodayView();
  if (window.renderMobileShell) window.renderMobileShell('gcal');
}

// A short string that changes whenever what the UI shows changes (the mobile
// Today screen puts it in its render signature)
export function gcalStateKey() {
  ensureAccount();
  const s = status || {};
  return [statusUser || '', s.connected ? 1 : 0, s.canTasks ? 1 : 0, s.canBusy ? 1 : 0, s.needsReconnect ? 1 : 0, s.unavailable ? 1 : 0, busyVersion].join('|');
}

// --- status -------------------------------------------------------------------------

export function getGcalStatus() {
  ensureAccount();
  return status;
}

// Tasks can go to the calendar from this device
export function isGcalTasksReady() {
  const s = getGcalStatus();
  return !!(s && s.connected && s.canTasks && !s.needsReconnect);
}

export function isGcalBusyReady() {
  const s = getGcalStatus();
  return !!(s && s.connected && s.canBusy && !s.needsReconnect);
}

function setStatus(next) {
  ensureAccount();
  const before = JSON.stringify(status);
  status = next;
  writeJson(accountKey(STATUS_KEY), next);
  if (!isGcalBusyReady()) busyCache.clear();
  if (JSON.stringify(next) !== before) {
    busyVersion++;
    emit();
  }
}

// Like apiCall ({ ok, data?, error?, status }), but a 401 here never signs out:
// a Worker without the /gcal routes yet (or any other surprise) must not end
// the session. A really expired session is caught by the next profile sync
async function gcalCall(method, path, body = null) {
  const token = getAuthToken();
  if (!token) return { ok: false, status: 401, error: 'Not signed in' };
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API_BASE}${path}`, opts);
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) return { ok: false, status: res.status, error: (data && (data.error || data.message)) || `Request failed (${res.status})` };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: 'Network error' };
  }
}

// True when the account this answer was asked for is still the one signed in
function sameAccount(user) {
  ensureAccount();
  return statusUser === user;
}

export async function refreshGcalStatus() {
  ensureAccount();
  if (!isLoggedIn()) return null;
  const user = statusUser;
  const r = await gcalCall('GET', '/gcal/status');
  if (!sameAccount(user)) return status;
  if (r.ok && r.data && typeof r.data.connected === 'boolean') setStatus(r.data);
  // Not allowed for this account, or not set up on the server: nothing to offer
  else if (r.status === 403 || r.status === 503) setStatus({ connected: false, unavailable: true });
  return status;
}

// --- the checkbox's remembered choice (per account, per device) ------------------

// Read on every keystroke of quick capture / the composer: kept in memory
let defaultCache = { user: undefined, value: false };

export function getGcalDefault() {
  const user = isLoggedIn() ? getUsername() : null;
  if (defaultCache.user !== user) defaultCache = { user, value: readJson(accountKey(DEFAULT_KEY)) === true };
  return defaultCache.value;
}

export function setGcalDefault(on) {
  writeJson(accountKey(DEFAULT_KEY), on ? true : null);
  defaultCache = { user: isLoggedIn() ? getUsername() : null, value: !!on };
}

// --- connect / disconnect ---------------------------------------------------------

const RETURN_MESSAGES = {
  denied: 'Google Calendar wasn’t connected: it was cancelled on Google’s page',
  expired: 'The Google sign-in took too long. Try Connect again',
  no_permission: 'Google Calendar needs at least one of its permissions. Try again and keep them ticked',
  no_refresh_token: 'Google didn’t give lasting access. Try Connect again',
  forbidden: 'Google Calendar isn’t available for this account',
  not_configured: 'Google Calendar isn’t set up on the server yet'
};

// Read ?gcal=… from the address the Worker sent us back to, and drop it right
// away (keeping history.state: the phone Back handling reads it)
export function readGcalReturn() {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const value = params.get('gcal');
  if (!value) return;
  const reason = params.get('reason') || '';
  params.delete('gcal');
  params.delete('reason');
  const query = params.toString();
  try {
    history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
  } catch (e) { /* the parameter just stays visible */ }
  pendingReturn = { ok: value === 'connected', reason };
}

export async function connectGoogleCalendar() {
  if (!isLoggedIn()) { showToast('Sign in first to connect Google Calendar'); return; }
  if (editState.enabled) { showToast('Save or cancel your edits first'); return; }
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* UTC */ }
  const r = await gcalCall('POST', '/gcal/connect', { tz });
  const url = r.ok && r.data && typeof r.data.url === 'string' ? r.data.url : '';
  if (!url.startsWith('https://accounts.google.com/')) {
    showToast(r.status === 403 ? RETURN_MESSAGES.forbidden : r.status === 503 ? RETURN_MESSAGES.not_configured : 'Couldn’t reach the server. Try again');
    return;
  }
  location.assign(url);
}

export async function disconnectGoogleCalendar({ deleteCalendar = false } = {}) {
  ensureAccount();
  const user = statusUser;
  const r = await gcalCall('POST', '/gcal/disconnect', { deleteCalendar: !!deleteCalendar });
  if (!sameAccount(user)) return false;
  if (!r.ok || !r.data) { showToast('Couldn’t disconnect. Try again'); return false; }
  const { revoked, calendarDeleted, ...next } = r.data;
  setStatus(next);
  showToast(deleteCalendar && calendarDeleted ? 'Disconnected, and the Dashboard tasks calendar was deleted' : 'Google Calendar disconnected');
  return true;
}

export async function saveBusyCalendars(ids) {
  ensureAccount();
  const user = statusUser;
  const r = await gcalCall('PUT', '/gcal/settings', { busyCalendars: ids });
  if (!sameAccount(user)) return false;
  if (!r.ok || !r.data || typeof r.data.connected !== 'boolean') {
    showToast(r.status === 400 ? 'That doesn’t look like a Calendar ID' : 'Couldn’t save. Try again');
    return false;
  }
  busyCache.clear();
  setStatus(r.data);
  busyVersion++;
  emit();
  return true;
}

// --- task calendar sync ---------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ask the Worker to make the calendar match the cloud profile. Runs again
// (up to 8 rounds) while it reports more to do; one sync at a time here, and
// the Worker holds a lease so two devices can't interleave
// A manual sync (Sync now) that joins a running one is reported when the last
// run ends, so the toast always says how it actually went
let manualPending = false;

// A run that failed for a passing reason (no network, a Worker or Google
// hiccup, another device's sync holding the lease) or that stopped with work
// left (failed events, more than 8 rounds, Google said slow down) is tried
// again on its own: 30 s, 2 min, 10 min (10 min after a slow down). Capped,
// so an event Google always refuses can't loop; a clean run, a fresh upload,
// Sync now or another account starts the count over. Back online, a waiting
// retry goes at once
const RETRY_DELAYS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];

function clearSyncRetry(resetCount = false) {
  clearTimeout(retryTimer);
  retryTimer = null;
  retryOnline = false;
  if (resetCount) retryCount = 0;
}

function syncNeedsRetry(result) {
  if (!result) return false;
  if (result.ok === false) {
    return result.status === 0 || result.error === 'gcal_busy'
      || (result.status >= 500 && result.error !== 'gcal_not_configured');
  }
  return !!(result.failed || result.remaining);
}

function planSyncRetry(result, user) {
  if (!sameAccount(user)) return;
  if (!syncNeedsRetry(result) || !isGcalTasksReady()) { retryCount = 0; return; }
  // Offline: going back online retries, without using up a try
  if (result.ok === false && result.status === 0 && navigator.onLine === false) { clearSyncRetry(); retryOnline = true; return; }
  if (retryCount >= RETRY_DELAYS_MS.length) return;
  const delay = result.rateLimited ? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] : RETRY_DELAYS_MS[retryCount];
  retryCount++;
  clearSyncRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (sameAccount(user)) syncGoogleCalendar();
  }, delay);
}

function onOnline() {
  if (!retryTimer && !retryOnline) return;
  clearSyncRetry();
  syncGoogleCalendar();
}

export async function syncGoogleCalendar({ manual = false } = {}) {
  if (!isGcalTasksReady()) {
    if (manual || manualPending) { manualPending = false; showToast('Google Calendar isn’t connected'); }
    return null;
  }
  if (manual) { manualPending = true; retryCount = 0; }
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    let result = null;
    const user = statusUser;
    // This run replaces a retry that was waiting (it plans the next one itself)
    clearSyncRetry();
    // A manual sync also asks the Worker to confirm the calendar still exists
    const check = manualPending;
    for (let round = 0; round < 8; round++) {
      const r = await gcalCall('POST', '/gcal/sync', round === 0 && check ? { check: true } : null);
      if (!r.ok) {
        if (r.error === 'gcal_busy' && round < 2) { await wait(3000); continue; }
        if (r.error === 'gcal_reconnect' || r.error === 'gcal_not_connected' || r.status === 403) refreshGcalStatus();
        result = { ok: false, error: r.error || 'failed', status: r.status };
        break;
      }
      result = r.data || {};
      // Google said slow down: the retry (or the next upload / Sync now) carries on
      if (!result.remaining || result.rateLimited) break;
    }
    lastSyncResult = { at: Date.now(), ...(result || {}) };
    // Another run follows right away when one was asked for meanwhile
    if (!syncAgain) planSyncRetry(result, user);
    if (manualPending && !syncAgain) {
      manualPending = false;
      const done = result && result.ok !== false && !result.failed && !result.remaining;
      showToast(done ? 'Google Calendar is up to date'
        : result && result.ok !== false ? 'Google Calendar is partly synced: the rest follows on the next sync'
          : 'Couldn’t sync with Google Calendar. Try again later');
    }
    return result;
  })();
  try {
    return await syncing;
  } finally {
    syncing = null;
    if (syncAgain) {
      syncAgain = false;
      syncGoogleCalendar();
    }
  }
}

export function getLastGcalSync() {
  return lastSyncResult;
}

// "Sync now": upload first, so the calendar mirrors what this device shows
export async function syncGoogleCalendarNow() {
  if (!isGcalTasksReady()) { showToast('Google Calendar isn’t connected'); return; }
  // Upload only this device's own unsynced changes: a clean device's copy is
  // already in the cloud, and uploading an old one would overwrite newer data
  if (window.cloudSave && isLoggedIn() && hasUnsyncedChanges()) {
    const r = await window.cloudSave();
    if (r && r.held) {
      // Phones: another device saved a newer copy; settle that first
      const sync = window.mobileShell && window.mobileShell.api && window.mobileShell.api.sync;
      if (sync && typeof sync.resolveConflict === 'function') sync.resolveConflict();
      else showToast('Choose which device’s changes to keep first');
      return;
    }
    if (r && r.ok === false && (r.status || r.error)) {
      // cloudSave already explained a 401 (signed out) or a 413 (too big)
      if (r.status !== 401 && r.status !== 413) showToast('Couldn’t upload your changes, so Google Calendar wasn’t updated. Try again');
      return;
    }
    // Uploaded (its 'cloud:saved' sync is running) or another upload was in flight
  }
  await syncGoogleCalendar({ manual: true });
}

function onCloudSaved(e) {
  ensureAccount();
  // What the cloud now holds: the uploaded payload, not the model (it may have
  // moved on while the upload was in flight)
  const payload = e && e.detail && e.detail.payload;
  uploadedSig = gcalSignature(payload || model);
  // A fresh upload starts a fresh set of retries
  clearSyncRetry(true);
  if (isGcalTasksReady()) syncGoogleCalendar();
}

// Computers upload on a 20-minute timer, so a flagged-task change uploads on
// its own after a few seconds (silently, like the item creator). Phones push
// after every save already. Edit mode writes the working copy, not `model`,
// so nothing here moves until its confirm (which uploads)
function onModelSaved() {
  ensureAccount();
  if (!isGcalTasksReady() || !isLoggedIn()) return;
  const sig = gcalSignature(model);
  if (seenSig === null) { seenSig = sig; return; }
  if (sig === seenSig) return;
  seenSig = sig;
  if (document.documentElement.dataset.mxSync === 'phone') return;
  scheduleUpload(UPLOAD_DELAY_MS);
}

function scheduleUpload(delay) {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    uploadTimer = null;
    if (!isLoggedIn() || !window.cloudSave) return;
    // Editing, or still loading: try again in a moment (edit-mode Cancel uploads nothing)
    if (editState.enabled || window.isInitialLoad) { scheduleUpload(UPLOAD_DELAY_MS); return; }
    if (gcalSignature(model) === uploadedSig) return; // an upload already carried it
    // Nothing of this device's own to send: the change came from the cloud
    // (a sign-in or start-up that adopted another device's copy)
    if (!hasUnsyncedChanges()) return;
    const r = await window.cloudSave();
    // A bare { ok: false } = another upload was running: try again shortly
    if (r && r.ok === false && !r.status && !r.held && !r.error) scheduleUpload(4000);
  }, delay);
}

// --- busy times -------------------------------------------------------------------------

// The local day's real start and end (23 or 25 hours on DST days)
export function dayBounds(dayKey) {
  const start = fromDateKey(dayKey);
  if (!start) return null;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}

export function getBusyVersion() {
  ensureAccount();
  return busyVersion;
}

// What is known for a day: { calendars, failed, at } or null (never fetched)
export function getBusyDay(dayKey) {
  ensureAccount();
  return busyCache.get(dayKey) || null;
}

// Fetch a day's busy times unless a fresh copy is cached. The version (and the
// listeners) move only when what Google says actually changed
export function requestBusyDay(dayKey, { force = false } = {}) {
  ensureAccount();
  if (!isGcalBusyReady() || busyInflight.has(dayKey)) return;
  const hit = busyCache.get(dayKey);
  const now = Date.now();
  if (!force && hit && !hit.failed && now - hit.at < BUSY_TTL_MS) return;
  if (!force && now < busyBackoffUntil) return;
  const bounds = dayBounds(dayKey);
  if (!bounds) return;
  const { from, to } = busyFetchRange(bounds.dayStart, bounds.dayEnd);
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* UTC */ }
  const user = statusUser;
  const path = `/gcal/busy?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}&tz=${encodeURIComponent(tz)}`;
  const request = gcalCall('GET', path).then((r) => {
    busyInflight.delete(dayKey);
    if (statusUser !== user) return; // signed out or switched account meanwhile
    const prev = busyCache.get(dayKey);
    if (r.ok && r.data && Array.isArray(r.data.calendars)) {
      const sig = JSON.stringify(r.data.calendars);
      busyCache.set(dayKey, { at: Date.now(), calendars: r.data.calendars, sig, failed: false });
      if (!prev || prev.sig !== sig || prev.failed) { busyVersion++; emit(); }
      return;
    }
    busyBackoffUntil = Date.now() + BUSY_BACKOFF_MS;
    if (r.error === 'gcal_reconnect' || r.error === 'gcal_not_connected' || r.error === 'gcal_no_permission') refreshGcalStatus();
    if (!prev) {
      busyCache.set(dayKey, { at: Date.now(), calendars: null, sig: '', failed: true });
      busyVersion++;
      emit();
    }
  });
  busyInflight.set(dayKey, request);
}

// --- the management panel (account popover on computers, a sheet on phones) ------

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, cls, onClick, action) {
  const b = el('button', 'gcal-btn' + (cls ? ' ' + cls : ''), label);
  b.type = 'button';
  if (action) b.dataset.gcalAction = action;
  b.addEventListener('click', onClick);
  return b;
}

function touchOnly() {
  try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { return false; }
}

function calendarLabel(id) {
  return id === 'primary' ? 'Main calendar' : id;
}

// The busy calendars as the server last said (read at click time too, so
// another device's change is never overwritten by an old copy)
function currentBusyIds() {
  const s = getGcalStatus();
  return s && Array.isArray(s.busyCalendars) && s.busyCalendars.length ? s.busyCalendars.slice() : ['primary'];
}

// Busy-calendar edits run one at a time, each from the list the previous one
// left (two quick taps can't undo each other). change(ids) → new ids or null
let busyEditChain = Promise.resolve(true);
function queueBusyEdit(change) {
  busyEditChain = busyEditChain.catch(() => false).then(() => {
    const next = change(currentBusyIds());
    return next ? saveBusyCalendars(next) : false;
  });
  return busyEditChain;
}

// Fills `host` and keeps it current while it stays in the page
// (title: false when the host already says "Google Calendar", like a sheet).
// Repaints rebuild the controls, so the focused control (by data-gcal-action)
// and a Calendar ID being typed are carried over
export function buildGcalPanel(host, { title = true } = {}) {
  if (!host) return;
  let confirming = false;
  let shownSig = null;
  let focusNext = null; // the action to focus after the next paint
  const statusSig = () => JSON.stringify([isLoggedIn(), getGcalStatus()]);

  const restoreFocus = (action) => {
    if (!action) return;
    const target = [...host.querySelectorAll('[data-gcal-action]')].find((n) => n.dataset.gcalAction === action);
    if (target) target.focus({ preventScroll: true });
  };

  const paint = () => {
    shownSig = statusSig();
    const typing = host.querySelector('.gcal-cal-add input');
    const typed = typing ? typing.value : '';
    const active = document.activeElement;
    const activeAction = active && host.contains(active) ? (active.dataset.gcalAction || null) : null;
    // Only while focus is still here (or lost with a removed control): never pull it back from elsewhere
    const free = !active || active === document.body || !active.isConnected || host.contains(active);
    const want = free ? (focusNext || activeAction) : null;
    focusNext = null;
    host.textContent = '';
    host.classList.add('gcal-panel');
    const s = getGcalStatus();
    if (title) host.append(el('div', 'gcal-panel-title', 'Google Calendar'));

    if (!isLoggedIn()) {
      host.append(el('p', 'gcal-note', 'Sign in to connect Google Calendar.'));
      return;
    }
    if (s && s.unavailable) {
      host.append(el('p', 'gcal-note', 'Google Calendar isn’t available for this account.'));
      return;
    }
    if (!s || !s.connected) {
      host.append(
        el('p', 'gcal-note', 'Put tasks on their own Google calendar and see when you’re busy. The dashboard can’t read or change your other events.'),
        button('Connect Google Calendar', 'gcal-btn-primary', connectGoogleCalendar, 'connect')
      );
      restoreFocus(want);
      return;
    }

    const who = el('p', 'gcal-who');
    who.append('Connected', s.email ? el('span', 'gcal-email', s.email) : '');
    host.append(who);
    if (s.needsReconnect) {
      host.append(
        el('p', 'gcal-note gcal-warn', 'Google access was removed or ran out. Reconnect to keep syncing.'),
        button('Reconnect', 'gcal-btn-primary', connectGoogleCalendar, 'connect')
      );
    }

    const perms = el('ul', 'gcal-perms');
    perms.append(
      el('li', s.canTasks ? 'is-on' : 'is-off', s.canTasks ? 'Tasks go to the “Dashboard tasks” calendar' : 'Tasks: permission not given'),
      el('li', s.canBusy ? 'is-on' : 'is-off', s.canBusy ? 'Busy times show in Today' : 'Busy times: permission not given')
    );
    host.append(perms);

    if (s.canBusy && !s.needsReconnect) {
      const ids = currentBusyIds();
      const box = el('div', 'gcal-busy-cals');
      box.append(el('div', 'gcal-sub', 'Busy times from'));
      const list = el('ul', 'gcal-cal-list');
      for (const id of ids) {
        const li = el('li', 'gcal-cal');
        li.append(el('span', 'gcal-cal-name', calendarLabel(id)));
        if (id !== 'primary') {
          const remove = button('×', 'gcal-cal-remove', async () => {
            // Keyboard users land in the field; a touch tap must not raise the keyboard
            if (!touchOnly()) focusNext = 'add-input';
            await queueBusyEdit((now) => now.filter((x) => x !== id));
          }, `remove:${id}`);
          remove.setAttribute('aria-label', `Stop showing busy times from ${id}`);
          li.append(remove);
        }
        list.append(li);
      }
      box.append(list);
      if (ids.length < 10) {
        const form = el('form', 'gcal-cal-add');
        const input = el('input');
        input.type = 'text';
        input.placeholder = 'Add another calendar’s ID';
        input.setAttribute('aria-label', 'Calendar ID (Google Calendar → Settings → Integrate calendar)');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.dataset.gcalAction = 'add-input';
        if (typed) input.value = typed;
        const add = el('button', 'gcal-btn', 'Add');
        add.type = 'submit';
        add.dataset.gcalAction = 'add';
        form.append(input, add);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const id = input.value.trim();
          if (!id || currentBusyIds().includes(id)) return;
          focusNext = 'add-input';
          if (await queueBusyEdit((now) => (now.includes(id) ? null : now.concat(id)))) {
            // The panel may have been rebuilt meanwhile: clear the live field
            const live = host.querySelector('.gcal-cal-add input');
            if (live) live.value = '';
          }
        });
        box.append(form, el('p', 'gcal-hint', 'Find it in Google Calendar → the calendar’s Settings → Integrate calendar.'));
      }
      host.append(box);
    }

    const actions = el('div', 'gcal-actions');
    if (confirming) {
      const label = el('label', 'gcal-check');
      const check = el('input');
      check.type = 'checkbox';
      label.append(check, ' Also delete the “Dashboard tasks” calendar from Google');
      actions.append(
        el('p', 'gcal-note', 'Disconnect Google Calendar? Tasks stay in the dashboard.'),
        label,
        button('Disconnect', 'gcal-btn-danger', async () => {
          focusNext = 'connect';
          if (await disconnectGoogleCalendar({ deleteCalendar: check.checked })) { confirming = false; paint(); }
        }, 'confirm-disconnect'),
        button('Cancel', '', () => { confirming = false; focusNext = 'disconnect'; paint(); }, 'cancel')
      );
    } else {
      if (s.canTasks && !s.needsReconnect) actions.append(button('Sync now', '', syncGoogleCalendarNow, 'sync'));
      actions.append(button('Disconnect', 'gcal-btn-quiet', () => { confirming = true; focusNext = 'confirm-disconnect'; paint(); }, 'disconnect'));
    }
    host.append(actions);
    restoreFocus(want);
  };

  if (host._gcalOff) host._gcalOff();
  // Busy data arriving also notifies: repaint only when the status changed
  const off = onGcalChange(() => {
    if (!host.isConnected) { off(); return; }
    if (statusSig() !== shownSig) paint();
  });
  host._gcalOff = off;
  paint();
  refreshGcalStatus();
}

// --- start-up ---------------------------------------------------------------------------

let started = false;

export function initGoogleCalendar() {
  if (started) return;
  started = true;
  window.addEventListener('cloud:saved', onCloudSaved);
  window.addEventListener('model:saved', onModelSaved);
  window.addEventListener('online', onOnline);
  afterSignIn();
}

// After start-up and after a sign-in: fresh status, a word about the trip to
// Google if there was one, then one sync (catches anything a closed page missed)
export async function afterSignIn() {
  ensureAccount();
  const back = pendingReturn;
  pendingReturn = null;
  if (!isLoggedIn()) {
    if (back) showToast('Sign in again, then connect Google Calendar');
    return;
  }
  await refreshGcalStatus();
  if (back) {
    if (back.ok && status && status.connected) showToast('Google Calendar connected');
    // 'invalid' while the connection is healthy = a Back into Google's page
    // after the trip came back again with the used state: say nothing (a
    // Reconnect that fails while needsReconnect still says so)
    else if (!back.ok && !(back.reason === 'invalid' && status && status.connected && !status.needsReconnect)) showToast(RETURN_MESSAGES[back.reason] || 'Couldn’t connect Google Calendar. Try again');
  }
  seenSig = gcalSignature(model);
  if (isGcalTasksReady()) syncGoogleCalendar();
}

// Signing out: forget the account's state in memory (its cache stays per account)
export function resetGcalState() {
  clearTimeout(uploadTimer);
  uploadTimer = null;
  clearSyncRetry(true);
  statusUser = undefined;
  ensureAccount();
  busyVersion++;
  emit();
}
