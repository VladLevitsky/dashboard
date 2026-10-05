// Personal Dashboard - Mobile shell (unit F0)
// On a phone (and in the desktop "Mobile" preview) the dashboard is not a
// shrunken grid: renderAllSections() hands over to this shell, a body-level
// app frame with a top bar (avatar + sync dot, a title slot, Search, the due
// lens), a frosted dock (Tasks · Today · + · Write · Links) and, while a
// timer runs, an emerald now-playing lane above the dock. The static skeleton
// lives in index.html, so the chrome paints before any script runs.
//
// What this module owns:
//   - mount / unmount (phones never unmount; the preview does when switching
//     to Tablet or Desktop) and the <html> attributes everything keys on
//   - ONE render path: renderMobileShell(reason) coalesces every request into
//     a microtask flush (chrome + the active screen, signature-skipped). It is
//     fed by window 'model:saved' (every saveModel), the renderAllSections
//     branch, the refreshTodayView / renderAuthUI wraps, visibility, midnight
//     and tab switches. A render never calls back into renderAllSections /
//     updateNotificationBadge / refreshTaskViews, and saves made during a
//     render are ignored (the seq loop guard), so it can't loop.
//   - the screen and service registries and the unit loader: units (F1-F5)
//     are entry modules imported with ?v=<MOBILE_BUILD>; each gets the frozen
//     `api` (below) in init(api) and registers screens, services and layers
//   - layers + Back (layers.js), sheets (sheet.js), viewport vars
//     (viewport.js), the phone sync guard (sync-guard.js)
// Invariants: the shell never writes layout props, profiles, collapsedCards /
// collapsedSubtitles or timeTrackingExpanded, never gives an element the id
// of a section, never runs with edit mode on, and keeps every fixed layer
// under z-index 1000 (every reused modal stacks above it).

import { model, editState } from '../../state.js';
import { showToast } from '../../utils.js';
import { MOBILE_BUILD, isPhoneDevice, msUntilNextLocalMidnight, readDeviceEnv, shellFrame } from '../../core/mobile-device.js';
import { shortDay } from '../../core/mobile-common.js';
import { countDueItems } from '../../core/agenda.js';
import { getTaskTotalMs } from '../../core/time-log.js';
import { isLoggedIn } from '../../core/auth.js';
import { setImageFromRef } from '../../core/file-service.js';
import { getDueItems } from '../calendar.js';
import { getTaskById } from '../tasks.js';
import { formatClock, renderTimeTrackingPanel } from '../time-tracking.js';
import { showActionToast } from '../quick-capture.js';
import { getActiveMode } from '../grid-engine.js';
import { registerLayer, registerBuiltInLayers, syncHistory, startLayers, stopLayers, anyLayerOpen, openLayers, historyDepth } from './layers.js?v=2026-10-mobile-2';
import { openSheet, pushScreen, closeAllSheets, refreshInert } from './sheet.js?v=2026-10-mobile-2';
import * as ui from './ui.js?v=2026-10-mobile-2';
import { startViewport, stopViewport } from './viewport.js?v=2026-10-mobile-2';
import * as syncGuard from './sync-guard.js?v=2026-10-mobile-2';

// Unit entry modules (stubs until each unit lands; a stub registers a
// placeholder screen). 'compose' has no screen; it provides the composer.
const UNITS = {
  tasks: 'tasks-view.js',
  compose: 'composer.js',
  write: 'write-view.js',
  today: 'today-view.js',
  links: 'links-view.js',
};
const TABS = {
  tasks: { title: 'Tasks', unit: 'tasks' },
  today: { title: 'Today', unit: 'today' },
  write: { title: 'Write', unit: 'write' },
  links: { title: 'Links', unit: 'links' },
};
// Reasons that re-render the active screen even when its signature is unchanged
const FORCE = ['mount', 'tab', 'sections', 'auth', 'storage', 'day', 'visible', 'theme', 'gesture-end', 'lens'];
const RESTORE_TAB_MS = 30 * 60 * 1000;
const THEME_COLORS = {
  'classic-light': '#cfd0d2', 'classic-dark': '#181d25',
  'sunset-light': '#f9be82', 'sunset-dark': '#4a2d1c',
};
const CALENDAR_GLYPH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="16.5" rx="3"></rect><line x1="16" y1="2.5" x2="16" y2="6.5"></line><line x1="8" y1="2.5" x2="8" y2="6.5"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';

const shellStore = ui.store('shell');

let mounted = false;
let bound = false;
let builtInsRegistered = false;
let activeTab = 'tasks';
const screens = new Map();        // tab id -> screen def
const mountedScreens = new Set(); // screens whose mount(host) ran
const renderedOnce = new Set();   // screens rendered since the last mount
const stale = new Set();          // inactive screens to render when shown
const lastSig = new Map();
const services = new Map();
const units = new Map();          // unit name -> { promise, module, error, attempts }
const bus = new Map();            // event -> Set(fn)
let context = {};
const gestureOwners = new Set();   // who holds a finger down (renders wait for all of them)
let deferred = false;
let queued = false;
let rendering = false;
let handledSeq = 0;
const reasons = new Set();
let wraps = null;
let midnightTimer = 0;
let hideHandled = false;
let pendingScroll = null;         // { tab, y } restored after that tab's first render
let shownTab = null;              // the screen whose show() ran last (hide() pairs with it)
const mountReplay = new Set();    // 'mount' listeners added after this mount's 'mount' (units that load late)
let mountReplayQueued = false;
let mountEmitted = false;         // this mount's 'mount' event has gone out
let mountGen = 0;
const tabScroll = {};
let htmlObserver = null;
let themeMeta = null;
let toastObserver = null;
const chrome = { slotKey: null, slotOwner: null, due: null, dot: null, live: null, liveTitle: null, avatarRef: null, themeColor: null };

const $id = (id) => document.getElementById(id);

// --- Small helpers -------------------------------------------------------------

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setText(el, text) {
  if (!el) return;
  const node = el.firstChild;
  if (node && node.nodeType === 3 && !node.nextSibling) {
    if (node.data !== text) node.data = text;
  } else {
    el.textContent = text;
  }
}

function hostFor(tab) {
  return $id(`mx-screen-${tab}`);
}

function isTypingTarget(e) {
  const t = (e.composedPath && e.composedPath()[0]) || e.target;
  const el = t && t.nodeType === 1 ? t : document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function ctx() {
  const now = new Date();
  return {
    data: model,
    now: now.getTime(),
    todayKey: dayKey(now),
    tab: activeTab,
    lens: context.lens,
    context: { ...context },
    theme: document.body.dataset.theme || 'light',
    glassTheme: document.body.dataset.glassTheme || 'classic',
    frame: api.frame,
  };
}

// --- Event bus ---------------------------------------------------------------

function on(event, fn) {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(fn);
  // Units load after mount() emitted 'mount' (their init runs when the import
  // resolves): a 'mount' listener added after that still gets it once, after
  // the render that init queued
  if (event === 'mount' && mounted && mountEmitted) {
    mountReplay.add(fn);
    scheduleMountReplay();
  }
  return () => {
    mountReplay.delete(fn);
    return bus.get(event) && bus.get(event).delete(fn);
  };
}

function scheduleMountReplay() {
  if (mountReplayQueued) return;
  mountReplayQueued = true;
  afterFlush(() => {
    mountReplayQueued = false;
    const fns = [...mountReplay];
    mountReplay.clear();
    if (!mounted) return;
    fns.forEach(fn => {
      try { fn(); } catch (err) { console.error("[mobile] 'mount' listener failed", err); }
    });
  });
}

function emit(event, detail) {
  const fns = bus.get(event);
  if (!fns) return;
  [...fns].forEach(fn => {
    try { fn(detail); } catch (err) { console.error(`[mobile] '${event}' listener failed`, err); }
  });
}

// --- Rendering ---------------------------------------------------------------

export function renderMobileShell(reason = 'external') {
  if (!mounted) return;
  reasons.add(reason);
  if (queued) return;
  queued = true;
  // A synchronous flush in between (tab switch) clears `queued` and cancels this one
  queueMicrotask(() => { if (queued) flush(); });
}

// Run fn once a pending render has happened (microtasks, so still before paint)
function afterFlush(fn) {
  const run = () => { if (queued) { queueMicrotask(run); return; } fn(); };
  queueMicrotask(run);
}

// show() / hide() pair up: the active screen is shown once it is on screen
// (tab switch, the launch tab at mount, a screen registering on the active
// tab) and hidden when another tab takes over or the shell unmounts
function showScreen(tab) {
  if (!mounted || tab !== activeTab || shownTab === tab) return;
  const s = screens.get(tab);
  if (!s) return;
  shownTab = tab;
  if (typeof s.show === 'function') {
    try { s.show(); } catch (err) { console.error('[mobile] show failed', tab, err); }
  }
}

function hideScreen() {
  const tab = shownTab;
  shownTab = null;
  const s = tab && screens.get(tab);
  if (s && typeof s.hide === 'function') {
    try { s.hide(); } catch (err) { console.error('[mobile] hide failed', tab, err); }
  }
}

function flush() {
  queued = false;
  if (!mounted) { reasons.clear(); return; }
  if (gestureOwners.size) { deferred = true; return; }      // never re-render under a finger
  rendering = true;
  const why = [...reasons];
  reasons.clear();
  try {
    renderChrome(why);
    renderScreen(activeTab, why);
    screens.forEach((_, id) => { if (id !== activeTab) stale.add(id); });
  } finally {
    rendering = false;
    handledSeq = window.__modelSaveSeq || 0;              // this render reflects every save so far
    window.__mxRenderCount = (window.__mxRenderCount || 0) + 1;
    const root = $id('mobile-shell');
    if (root && root.dataset.ready !== '1') root.dataset.ready = '1';
  }
}

function renderScreen(tab, why) {
  const s = screens.get(tab);
  if (!s) return;
  const c = ctx();
  let sig;
  try { sig = typeof s.signature === 'function' ? s.signature(c) : undefined; } catch { sig = undefined; }
  const force = FORCE.some(r => why.includes(r)) || stale.has(tab) || !renderedOnce.has(tab);
  if (force || sig === undefined || sig !== lastSig.get(tab)) {
    try {
      s.render(c, why);
    } catch (err) {
      console.error(`[mobile] ${tab} render failed`, err);
    }
    lastSig.set(tab, sig);
    renderedOnce.add(tab);
  }
  stale.delete(tab);
  if (pendingScroll && pendingScroll.tab === tab) {
    const y = pendingScroll.y;
    pendingScroll = null;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

window.addEventListener('model:saved', (e) => {
  if (mounted && !rendering && e.detail && e.detail.seq > handledSeq) renderMobileShell('saved');
});

// --- Chrome: top bar, due lens, sync dot, lane, theme-color ---------------------

function renderChrome(why) {
  const parts = [renderSlot, renderDueLens, renderSyncDot, renderLane, renderAvatar, renderThemeColor, hideUnhostedTimeCard];
  parts.forEach(fn => {
    try { fn(why); } catch (err) { console.error('[mobile] chrome render failed', fn.name, err); }
  });
}

function renderSlot() {
  const slot = $id('mx-topbar-slot');
  if (!slot) return;
  const s = screens.get(activeTab);
  if (s && typeof s.topbar === 'function') {
    if (chrome.slotOwner !== activeTab) { slot.replaceChildren(); chrome.slotKey = null; }
    chrome.slotOwner = activeTab;
    slot.dataset.owner = activeTab;
    s.topbar(slot, ctx());
    return;
  }
  const title = (s && s.title) || TABS[activeTab].title;
  const sub = activeTab === 'today' ? shortDay(dayKey()) : '';
  const key = `${activeTab}|${title}|${sub}`;
  if (chrome.slotKey === key && chrome.slotOwner === null) return;
  chrome.slotKey = key;
  chrome.slotOwner = null;
  if (slot.dataset.owner) delete slot.dataset.owner;
  const h = document.createElement('h1');
  h.className = 'mx-slot-title';
  h.textContent = title;
  const nodes = [h];
  if (sub) {
    const p = document.createElement('p');
    p.className = 'mx-slot-sub';
    p.textContent = sub;
    nodes.push(p);
  }
  slot.replaceChildren(...nodes);
}

function renderDueLens() {
  const lens = $id('mx-due-lens');
  const badge = lens && lens.querySelector('.mx-due-badge');
  if (!badge) return;
  const total = countDueItems(getDueItems());
  if (chrome.due === total) return;
  const wasClear = chrome.due === null || chrome.due === 0;
  chrome.due = total;
  if (total > 0) {
    if (wasClear) {
      badge.classList.remove('is-clear');
      badge.textContent = total > 99 ? '99+' : String(total);
    } else {
      setText(badge, total > 99 ? '99+' : String(total));
    }
  } else {
    badge.classList.add('is-clear');
    badge.innerHTML = CALENDAR_GLYPH;
  }
  const label = total > 0
    ? `${total} item${total === 1 ? '' : 's'} due today or overdue. Open the calendar`
    : 'Nothing due today. Open the calendar';
  lens.setAttribute('aria-label', label);
  lens.title = label;
}

// No dot = synced; amber = changes waiting; red = push failed or a conflict
// is waiting; hollow grey ring = signed out
export function renderSyncDot() {
  const dot = document.querySelector('#mx-avatar-btn .mx-sync-dot');
  if (!dot) return;
  const st = syncGuard.status();
  const state = !st.signedIn ? 'out'
    : (st.conflict || st.failed) ? 'error'
      : (st.dirty || st.inFlight) ? 'pending' : 'ok';
  if (chrome.dot === state) return;
  chrome.dot = state;
  dot.dataset.state = state;
  const btn = $id('mx-avatar-btn');
  const labels = { out: 'Not signed in', error: 'Sync needs attention', pending: 'Changes waiting to sync', ok: 'Synced' };
  if (btn) btn.setAttribute('aria-label', `Account and settings. ${labels[state]}`);
}

function renderLane() {
  const lane = $id('mx-live');
  if (!lane) return;
  const log = model.timeTracking;
  const active = log && log.active ? log.active : null;
  const root = document.documentElement;
  if (!active) {
    if (chrome.live !== null) {
      chrome.live = null;
      chrome.liveTitle = null;
      root.removeAttribute('data-mx-live');
    }
    return;
  }
  const task = getTaskById(active.taskId);
  const title = (task && task.title) || (log.tasks && log.tasks[active.taskId] && log.tasks[active.taskId].title) || 'Task';
  if (chrome.live !== active.taskId) {
    // The lane rises under a stopwatch's double tap: its second tap is not for the lane
    if (chrome.live === null) swallowTaps((e) => !!(e.target.closest && e.target.closest('#mx-live')), performance.now(), 300);
    chrome.live = active.taskId;
    // The clock's text is written once here; the 1s tick of time-tracking.js
    // keeps it current from then on (it writes every [data-live-timer])
    setText(lane.querySelector('[data-live-timer]'), formatClock(getTaskTotalMs(log, active.taskId, Date.now())));
    root.setAttribute('data-mx-live', '');
  }
  if (chrome.liveTitle !== title) {
    chrome.liveTitle = title;
    setText(lane.querySelector('.mx-live-title'), title);
    const body = lane.querySelector('.mx-live-body');
    if (body) body.setAttribute('aria-label', `Timer running on ${title}`);
    const stop = lane.querySelector('.mx-live-stop');
    if (stop) stop.setAttribute('aria-label', `Stop the timer on ${title}`);
  }
}

function renderAvatar() {
  const img = document.querySelector('#mx-avatar-btn .mx-avatar-img');
  if (!img) return;
  const header = model.header || {};
  const ref = header.profilePhotoSrc;
  const key = JSON.stringify(ref || null) + '|' + (header.profilePhotoXPercent || 0) + '|' + (header.profilePhotoYPercent || 0);
  if (chrome.avatarRef === key) return;
  chrome.avatarRef = key;
  setImageFromRef(img, ref, 'assets/icons/placeholder-profile.svg');
  // The editor's offsets are fractions of a 90px frame; scale them to the 32px photo
  const x = (parseFloat(header.profilePhotoXPercent) || 0) * 32;
  const y = (parseFloat(header.profilePhotoYPercent) || 0) * 32;
  img.style.objectPosition = `calc(50% + ${x.toFixed(1)}px) calc(50% + ${y.toFixed(1)}px)`;
}

function renderThemeColor() {
  if (!themeMeta) return;
  const theme = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
  const glass = document.body.dataset.glassTheme === 'sunset' ? 'sunset' : 'classic';
  const color = THEME_COLORS[`${glass}-${theme}`];
  if (chrome.themeColor === color) return;
  chrome.themeColor = color;
  themeMeta.setAttribute('content', color);
}

// The desktop Time Tracking card (reopened at boot from the synced
// timeTrackingExpanded) is hidden while un-hosted; the model is never written
function hideUnhostedTimeCard() {
  const card = $id('time-tracking-card');
  if (card && !card.classList.contains('mx-hosted') && !card.hidden) card.hidden = true;
}

// --- Screens, services, units ------------------------------------------------------

function registerScreen(def) {
  if (!def || !TABS[def.id] || typeof def.render !== 'function') {
    throw new Error(`registerScreen: unknown screen or missing render (${def && def.id})`);
  }
  screens.set(def.id, def);
  const host = hostFor(def.id);
  if (host) {
    host.querySelectorAll(':scope > .mx-skeleton, :scope > .mx-load-fail').forEach(el => el.remove());
    host.setAttribute('aria-label', def.title || TABS[def.id].title);
    if (!mountedScreens.has(def.id) && typeof def.mount === 'function') {
      try { def.mount(host); } catch (err) { console.error(`[mobile] ${def.id} mount failed`, err); }
    }
    mountedScreens.add(def.id);
  }
  lastSig.delete(def.id);
  renderedOnce.delete(def.id);
  stale.add(def.id);
  chrome.slotKey = null;
  chrome.slotOwner = chrome.slotOwner === def.id ? null : chrome.slotOwner;
  if (shownTab === def.id) shownTab = null;          // a replaced screen is shown afresh
  renderMobileShell('screen');
  if (mounted && def.id === activeTab) afterFlush(() => showScreen(def.id));
}

function provide(name, impl) {
  services.set(name, impl);
}

function service(name) {
  return services.get(name);
}

function showLoadFailure(unit) {
  const tab = Object.keys(TABS).find(t => TABS[t].unit === unit);
  if (!tab || screens.has(tab)) return;
  const host = hostFor(tab);
  if (!host || host.querySelector(':scope > .mx-load-fail')) return;
  host.querySelectorAll(':scope > .mx-skeleton').forEach(el => el.remove());
  const box = document.createElement('div');
  box.className = 'mx-load-fail';
  const p = document.createElement('p');
  p.textContent = 'Couldn’t load this tab';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'mx-btn';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => { box.remove(); use(unit).catch(() => {}); });
  box.append(p, retry);
  host.appendChild(box);
}

// Load a unit's entry module once and run its init(api). A failed import
// never instantiated, so Retry re-imports with an extra query
function use(name) {
  const file = UNITS[name];
  if (!file) return Promise.reject(new Error(`unknown unit: ${name}`));
  let u = units.get(name);
  if (!u) { u = { attempts: 0, promise: null, module: null, error: null }; units.set(name, u); }
  if (u.module && !u.error) return Promise.resolve(u.module);
  if (u.promise) return u.promise;
  const runInit = (mod) => {
    const unit = mod.default || mod;
    if (unit && typeof unit.init === 'function') unit.init(api);
  };
  if (u.module) {
    // Imported fine but init threw: run init again
    u.promise = Promise.resolve().then(() => { runInit(u.module); u.error = null; u.promise = null; return u.module; })
      .catch(err => { u.error = err; u.promise = null; console.error(`[mobile] ${name} init failed`, err); showLoadFailure(name); throw err; });
    return u.promise;
  }
  u.attempts++;
  const p = u.attempts > 1
    ? import(`./${file}?v=${MOBILE_BUILD}&retry=${u.attempts - 1}`)
    : import(`./${file}?v=${MOBILE_BUILD}`);
  u.promise = p.then(mod => {
    u.module = mod;
    runInit(mod);
    u.error = null;
    u.promise = null;
    return mod;
  }).catch(err => {
    u.error = err;
    u.promise = null;
    console.error(`[mobile] could not load ${name}`, err);
    showLoadFailure(name);
    throw err;
  });
  return u.promise;
}

// --- Tabs ----------------------------------------------------------------------

function persistShellState() {
  tabScroll[activeTab] = window.scrollY || 0;
  shellStore.set('tab', activeTab);
  shellStore.set('lastVisit', Date.now());
  shellStore.set('scroll', { ...tabScroll });
}

function paintTabs() {
  document.querySelectorAll('#mx-dock .mx-tab').forEach(btn => {
    const on = btn.dataset.tab === activeTab;
    if (btn.getAttribute('aria-selected') !== String(on)) btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
  document.documentElement.setAttribute('data-mx-tab', activeTab);
}

function setTab(tab, { fromBack = false, reveal = null } = {}) {
  if (!TABS[tab]) return;
  if (tab === activeTab && mounted) {
    if (reveal) revealIn(tab, reveal);
    return;
  }
  const prev = activeTab;
  tabScroll[prev] = window.scrollY || 0;
  const prevHost = hostFor(prev);
  const nextHost = hostFor(tab);
  if (prevHost && prevHost !== nextHost) prevHost.hidden = true;
  if (nextHost) nextHost.hidden = false;
  activeTab = tab;
  paintTabs();
  if (shownTab === prev) hideScreen();
  if (mounted) {
    // Rendered right away (one render per tap), then the tab's own scroll
    reasons.add('tab');
    flush();
    window.scrollTo(0, tabScroll[tab] || 0);
    showScreen(tab);
    if (reveal) revealIn(tab, reveal);
    persistShellState();
    emit('tab', { tab, from: prev, fromBack });
    syncHistory();
  }
}

function revealIn(tab, reveal) {
  const s = screens.get(tab);
  if (s && typeof s.reveal === 'function') {
    try { s.reveal(reveal); } catch (err) { console.error('[mobile] reveal failed', tab, err); }
  }
}

function navigate(tab, opts = {}) {
  setTab(tab, { reveal: opts.reveal || null });
}

function launchTab() {
  const last = Number(shellStore.get('lastVisit', 0)) || 0;
  const tab = shellStore.get('tab', 'tasks');
  if (Date.now() - last < RESTORE_TAB_MS && TABS[tab]) {
    const scroll = shellStore.get('scroll', {}) || {};
    Object.assign(tabScroll, scroll);
    return tab;
  }
  return 'tasks';
}

// --- Openers (the + , avatar, search, lane) ------------------------------------

function openComposer(opts = {}) {
  const composer = services.get('composer');
  if (composer && typeof composer.open === 'function') {
    composer.open({ from: activeTab, ...opts });
    return;
  }
  // F2 not loaded: the desktop quick capture (it focuses synchronously too)
  if (window.openQuickCapture) window.openQuickCapture({ restoreFocus: false });
}

function openSearch() {
  const search = services.get('search');
  if (search && typeof search.open === 'function') { search.open(); return; }
  toast('Search is not available yet');
}

function openMore() {
  const more = services.get('more');
  if (more && typeof more.open === 'function') { more.open(); return; }
  openFallbackMore();
}

function openTime() {
  const time = services.get('time');
  if (time && typeof time.openSheet === 'function') { time.openSheet(); return; }
  const active = model.timeTracking && model.timeTracking.active;
  if (active && getTaskById(active.taskId) && window.openEditTaskModal) window.openEditTaskModal(active.taskId);
}

// Until F4's More sheet lands: account, theme and (in the preview) layout
function openFallbackMore() {
  openSheet({
    id: 'more',
    title: 'More',
    build(body, sheet) {
      const st = syncGuard.status();
      const rows = document.createElement('div');
      rows.className = 'mx-list';
      const account = document.createElement('p');
      account.className = 'mx-sheet-text';
      account.textContent = st.signedIn ? (st.dirty ? 'Signed in · Changes waiting to sync' : 'Signed in · Synced') : 'Not signed in';
      rows.appendChild(account);
      const authBtn = document.createElement('button');
      authBtn.type = 'button';
      authBtn.className = 'mx-btn mx-btn-block';
      authBtn.textContent = st.signedIn ? 'Sync now' : 'Sign in';
      authBtn.addEventListener('click', (e) => {
        if (isLoggedIn()) { api.sync.syncNow(); sheet.close(); return; }
        e.stopPropagation();
        sheet.close();
        const toggle = $id('auth-toggle');
        if (toggle) toggle.click();
      });
      rows.appendChild(authBtn);
      const themeSeg = ui.segmented({
        label: 'Theme',
        options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
        value: document.body.dataset.theme === 'dark' ? 'dark' : 'light',
        onChange: (v) => { if (window.setDarkMode) window.setDarkMode(v === 'dark'); },
      });
      rows.appendChild(themeSeg);
      if (!api.frame.phone) {
        const layout = ui.segmented({
          label: 'Layout',
          options: [{ value: 'mobile', label: 'Mobile' }, { value: 'tablet', label: 'Tablet' }, { value: 'desktop', label: 'Desktop' }],
          value: 'mobile',
          onChange: (v) => { sheet.close(); if (window.switchDeviceMode) window.switchDeviceMode(v); },
        });
        rows.appendChild(layout);
      }
      const note = document.createElement('p');
      note.className = 'mx-sheet-note';
      note.textContent = 'Cards are arranged and edited on a larger screen.';
      rows.appendChild(note);
      body.appendChild(rows);
    },
  });
}

// --- Toasts ---------------------------------------------------------------------

function toast(message, actions) {
  if (Array.isArray(actions) && actions.length) showActionToast(message, actions);
  else showToast(message);
}

// #toast has no live role (desktop markup). While the shell is mounted every
// message it shows (the shell's and the reused desktop code's) is read out
// through #mx-live-region; action toasts (#qc-toast) are role=status already
function startToastAnnouncer() {
  const t = $id('toast');
  const region = $id('mx-live-region');
  if (!t || !region || toastObserver) return;
  toastObserver = new MutationObserver(() => {
    const text = t.textContent.trim();
    if (!text) return;
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = text; });
  });
  toastObserver.observe(t, { childList: true, characterData: true, subtree: true });
}

function stopToastAnnouncer() {
  if (toastObserver) { toastObserver.disconnect(); toastObserver = null; }
  const region = $id('mx-live-region');
  if (region) region.textContent = '';
}

// --- Skeleton wiring (once; the static nodes are never removed) -------------------

function bindSkeleton() {
  if (bound) return;
  bound = true;
  document.querySelectorAll('#mx-dock .mx-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  // Arrow keys move between tabs (tablist pattern)
  const dock = $id('mx-dock');
  if (dock) {
    dock.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tabs = [...dock.querySelectorAll('.mx-tab')];
      const i = tabs.findIndex(t => t.dataset.tab === activeTab);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next) { e.preventDefault(); setTab(next.dataset.tab); next.focus(); }
    });
  }
  const plus = $id('mx-plus');
  if (plus) {
    plus.addEventListener('click', () => {
      // Synchronous: the composer's input is focused inside this tap, so iOS raises the keyboard
      openComposer();
      ui.animate(plus.querySelector('.mx-plus-glyph'), [{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }], { duration: 180 });
    });
  }
  const avatar = $id('mx-avatar-btn');
  if (avatar) avatar.addEventListener('click', (e) => { e.stopPropagation(); openMore(); });
  const search = $id('mx-search-btn');
  if (search) search.addEventListener('click', () => openSearch());
  const lens = $id('mx-due-lens');
  if (lens) {
    const open = (e) => { e.preventDefault(); e.stopPropagation(); if (window.openCalendarView) window.openCalendarView(); };
    lens.addEventListener('click', open);
    lens.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  const lane = $id('mx-live');
  if (lane) {
    const body = lane.querySelector('.mx-live-body');
    if (body) body.addEventListener('click', () => openTime());
    const stop = lane.querySelector('.mx-live-stop');
    if (stop) {
      stop.addEventListener('click', (e) => {
        e.stopPropagation();
        // The lane goes away under the finger: a double tap's second tap
        // would land on the row (or its stopwatch) under it
        if (e.isTrusted) {
          const r = lane.getBoundingClientRect();
          swallowTaps((ev) => ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom, e.timeStamp);
        }
        if (window.stopTaskTimer) window.stopTaskTimer();
      });
    }
  }
  document.querySelectorAll('#mx-preview-switch [data-mode]').forEach(btn => {
    btn.addEventListener('click', () => { if (window.switchDeviceMode) window.switchDeviceMode(btn.dataset.mode); });
  });
}

// The user's clicks that match(e) within ms of `from` (an event timeStamp /
// performance.now()) are dropped (window capture): the second tap of a double
// tap on something that just appeared or went away under the finger
function swallowTaps(match, from, ms = 400) {
  const h = (e) => {
    if (!e.isTrusted || e.timeStamp - from > ms || !match(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  window.addEventListener('click', h, true);
  setTimeout(() => window.removeEventListener('click', h, true), ms + 600);   // a late (queued) click still meets it
}

// --- Lifecycle -------------------------------------------------------------------

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    onHidden();
  } else {
    hideHandled = false;
    emit('visible');
    const tookOver = api.frame.phone && syncGuard.onVisible();
    if (!tookOver) renderMobileShell('visible');
    armMidnight();
  }
}

function onHidden() {
  if (hideHandled) return;
  hideHandled = true;
  persistShellState();
  emit('hide');
  if (api.frame.phone) syncGuard.onHide();
}

function onPageHide() {
  onHidden();
}

function armMidnight() {
  clearTimeout(midnightTimer);
  if (!mounted) return;
  midnightTimer = setTimeout(() => {
    midnightTimer = 0;
    emit('day');
    renderMobileShell('day');
    armMidnight();
  }, msUntilNextLocalMidnight(new Date()) + 1000);
}

// Desktop preview: N opens the composer, / opens Search (the old handlers
// would focus the hidden header search). Phones rarely have the keys, but it
// does no harm there. With a layer open the keys are eaten, not passed on:
// the desktop handlers would open the quick capture bar over a writer frame.
function onKeyDown(e) {
  if (!mounted || e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e)) return;
  const isN = e.key === 'n' || e.key === 'N';
  if (!isN && e.key !== '/') return;
  e.preventDefault();
  if (anyLayerOpen()) return;
  if (isN) openComposer({ via: 'key' });
  else openSearch();
}

function startLifecycle() {
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('keydown', onKeyDown, true);
  armMidnight();
  htmlObserver = new MutationObserver(() => refreshInert());
  htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mx-carry'] });
}

function stopLifecycle() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('keydown', onKeyDown, true);
  clearTimeout(midnightTimer);
  midnightTimer = 0;
  if (htmlObserver) htmlObserver.disconnect();
  htmlObserver = null;
}

// Repaint hooks that existing modules call through window at call time
function installWraps() {
  if (wraps) return;
  wraps = { refreshTodayView: window.refreshTodayView, renderAuthUI: window.renderAuthUI };
  const today = function () {
    if (typeof wraps.refreshTodayView === 'function') wraps.refreshTodayView.apply(this, arguments);
    renderMobileShell('today');
  };
  const auth = function () {
    const r = typeof wraps.renderAuthUI === 'function' ? wraps.renderAuthUI.apply(this, arguments) : undefined;
    chrome.dot = null;
    renderMobileShell('auth');
    return r;
  };
  wraps.todayWrap = today;
  wraps.authWrap = auth;
  window.refreshTodayView = today;
  window.renderAuthUI = auth;
}

function removeWraps() {
  if (!wraps) return;
  if (window.refreshTodayView === wraps.todayWrap) window.refreshTodayView = wraps.refreshTodayView;
  if (window.renderAuthUI === wraps.authWrap) window.renderAuthUI = wraps.renderAuthUI;
  wraps = null;
}

// --- Mount / unmount --------------------------------------------------------------

function assertRootAttributes(frame) {
  const root = document.documentElement;
  root.setAttribute('data-shell', 'mobile');
  if (frame === 'phone') {
    root.setAttribute('data-phone', '');
    root.removeAttribute('data-shell-frame');
    const vp = document.querySelector('meta[name="viewport"]');
    const content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    if (vp && vp.getAttribute('content') !== content) vp.setAttribute('content', content);
  } else {
    // A touch tablet: full width, no preview frame (mobile-device.js shellFrame)
    if (frame === 'preview') root.setAttribute('data-shell-frame', 'preview');
    else root.removeAttribute('data-shell-frame');
    root.removeAttribute('data-phone');
  }
  if (!themeMeta) {
    themeMeta = document.querySelector('meta[name="theme-color"][data-mx]');
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.name = 'theme-color';
      themeMeta.dataset.mx = '';
      document.head.appendChild(themeMeta);
    }
  }
}

// Desktop panels close without writing the model
function closeDesktopPanels() {
  const eis = $id('eisenhower-card');
  if (eis && !eis.hidden && window.toggleTasksSummary) window.toggleTasksSummary();
  const today = $id('today-modal');
  if (today && !today.hidden && window.closeTodayView) window.closeTodayView();
  hideUnhostedTimeCard();
}

function mount() {
  if (mounted) return;
  const phone = isPhoneDevice();
  const frame = shellFrame({ phone, ...readDeviceEnv() });
  api.frame.phone = phone;
  api.frame.preview = frame === 'preview';
  assertRootAttributes(frame);
  closeDesktopPanels();
  bindSkeleton();
  mounted = true;
  Object.keys(chrome).forEach(k => { chrome[k] = null; });
  renderedOnce.clear();
  if (!builtInsRegistered) { builtInsRegistered = true; registerBuiltInLayers(); }
  startViewport();
  startLayers({ phone, getTab: () => activeTab, setTab });
  startLifecycle();
  if (phone) syncGuard.startSyncGuard(api, { onStatusChange: renderSyncDot });
  installWraps();
  startToastAnnouncer();

  // Launch tab: the last one if the last visit was under 30 minutes ago
  const tab = launchTab();
  Object.keys(TABS).forEach(t => { const host = hostFor(t); if (host) host.hidden = t !== tab; });
  activeTab = tab;
  if (tabScroll[tab] > 0) pendingScroll = { tab, y: tabScroll[tab] };
  paintTabs();

  Object.keys(UNITS).forEach(name => { use(name).catch(() => {}); });
  renderMobileShell('mount');
  syncHistory();
  shellStore.set('lastVisit', Date.now());
  // After the first render: show the launch screen (when it is registered
  // already, as on a re-mount in the preview), then emit 'mount'
  mountEmitted = false;
  const gen = ++mountGen;
  afterFlush(() => {
    if (!mounted || gen !== mountGen) return;
    showScreen(activeTab);
    mountEmitted = true;
    emit('mount');
  });
}

function unmount() {
  if (!mounted) return;
  hideScreen();
  mountReplay.clear();
  mountEmitted = false;
  emit('unmount');
  closeAllSheets();
  removeWraps();
  stopToastAnnouncer();
  stopLifecycle();
  stopLayers();
  stopViewport();
  syncGuard.stopSyncGuard();
  persistShellState();
  mounted = false;
  queued = false;
  reasons.clear();
  const root = document.documentElement;
  ['data-shell', 'data-shell-frame', 'data-phone'].forEach(a => root.removeAttribute(a));
  [...root.attributes].map(a => a.name).filter(n => n.startsWith('data-mx-')).forEach(n => root.removeAttribute(n));
  if (themeMeta) { themeMeta.remove(); themeMeta = null; }
  const card = $id('time-tracking-card');
  if (card && !card.classList.contains('mx-hosted')) {
    const expanded = !!model.timeTrackingExpanded;
    card.hidden = !expanded;
    if (expanded) {
      card.classList.add('active');
      try { renderTimeTrackingPanel(); } catch { /* panel renders on its next refresh */ }
    }
  }
}

// mode = 'mobile' mounts (unless edit mode is on); anything else unmounts.
// Returns true while the shell is (now) mounted.
export function syncMobileShell(mode = getActiveMode()) {
  if (mode === 'mobile' && !editState.enabled) {
    if (!mounted) mount();
    return true;
  }
  if (mounted) unmount();
  return false;
}

export function isShellMounted() {
  return mounted;
}

// --- Gesture guard ------------------------------------------------------------------

// One flag per owner, so two gesture owners can overlap (a Today swipe that
// starts on a Links item: both end on the same touchend, in either order) and
// the first to finish never lets a render land under the other's finger.
// Units pass their own owner; calls without one share a single owner.
function setGestureActive(on, owner = 'shared') {
  const was = gestureOwners.size > 0;
  if (on) gestureOwners.add(owner); else gestureOwners.delete(owner);
  if (was && !gestureOwners.size && deferred) {
    deferred = false;
    renderMobileShell('gesture-end');
  }
}

// --- The frozen api (§9.9; passed to every unit's init(api)) ----------------------------

const api = {
  version: MOBILE_BUILD,
  frame: { phone: false, preview: true },
  registerScreen,
  navigate,
  getTab: () => activeTab,
  getContext: () => ({ ...context }),
  setContext: (patch) => { if (patch && typeof patch === 'object') context = { ...context, ...patch }; },
  provide,
  service,
  use,
  registerLayer,
  syncHistory,
  openSheet,
  pushScreen,
  toast,
  haptic: ui.haptic,
  animate: ui.animate,
  createMover: ui.createMover,
  reduceMotion: ui.reduceMotion,
  patchList: ui.patchList,
  store: ui.store,
  setGestureActive,
  isGestureActive: () => gestureOwners.size > 0,
  on,
  emit,
  render: renderMobileShell,
  sync: {
    status: () => syncGuard.status(),
    syncNow: () => syncGuard.pushNow(),
    resolveConflict: () => syncGuard.resolveConflict(),
  },
  // Additions beyond §9.9 (see Reference/mobile/notes/F0.md)
  isMounted: () => mounted,
  anyLayerOpen: (kind) => anyLayerOpen(kind),
  ui,
};

// Test / debugging handle (window.mobileShell)
export const mobileShellDebug = {
  api,
  state: () => ({
    mounted,
    tab: activeTab,
    frame: { ...api.frame },
    screens: [...screens.keys()],
    services: [...services.keys()],
    units: Object.fromEntries([...units].map(([k, u]) => [k, u.error ? 'failed' : u.module ? 'loaded' : 'loading'])),
    layers: openLayers().map(l => l.id),
    historyDepth: historyDepth(),
    renderCount: window.__mxRenderCount || 0,
    context: { ...context },
  }),
  openTestSheet: () => openSheet({
    id: 'test',
    title: 'Test sheet',
    build(body) {
      const p = document.createElement('p');
      p.className = 'mx-sheet-text';
      p.textContent = 'A test sheet. Back or a drag down closes it.';
      body.appendChild(p);
    },
  }),
};
