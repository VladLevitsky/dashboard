// Personal Dashboard - Auth UI Module
// Handles login/register modal, user popover, Turnstile widget, and auth UI state.

import { TURNSTILE_SITE_KEY } from '../constants.js';
import { $, showToast } from '../utils.js';
import { isLoggedIn, getUsername, login, register, logout, initAuth } from '../core/auth.js';
import {
  migrateToScopedStorage,
  syncOnLogin,
  startSyncTimer,
  stopSyncTimer,
  immediateCloudSave,
  isCloudDirty
} from '../core/sync.js';
import { restoreModel, saveModel } from '../core/storage.js';
import { model, editState, resetModel } from '../state.js';

// --- Module state ---
let _isRegisterMode = false;
let _turnstileWidgetId = null;
let _isSubmitting = false;

// --- Public: render auth button state (logged in vs out) ---
export function renderAuthUI() {
  const btn = $('#auth-toggle');
  if (!btn) return;

  if (isLoggedIn()) {
    btn.classList.add('logged-in');
    btn.title = `Signed in as ${getUsername()}`;
  } else {
    btn.classList.remove('logged-in');
    btn.title = 'Account';
  }
}

// --- Open/close the auth modal ---
function openAuthModal() {
  const modal = $('#auth-modal');
  if (!modal) return;

  // Reset to login mode
  setAuthMode(false);
  clearAuthError();
  $('#auth-username').value = '';
  $('#auth-password').value = '';

  modal.hidden = false;
  setTimeout(() => $('#auth-username').focus(), 100);
}

function closeAuthModal() {
  const modal = $('#auth-modal');
  if (modal) modal.hidden = true;
  destroyTurnstile();
  _isSubmitting = false;
  setSubmitEnabled(true);
}

// --- Toggle between login and register modes ---
function setAuthMode(isRegister) {
  _isRegisterMode = isRegister;
  const title = $('#auth-modal-title');
  const submitBtn = $('#auth-submit');
  const footerText = $('#auth-footer-text');
  const toggleBtn = $('#auth-toggle-mode');
  const disclaimer = $('#auth-disclaimer');
  const turnstileContainer = $('#auth-turnstile-container');

  if (isRegister) {
    title.textContent = 'Create Account';
    submitBtn.textContent = 'Create Account';
    footerText.textContent = 'Already have an account?';
    toggleBtn.textContent = 'Sign in';
    disclaimer.hidden = false;
    turnstileContainer.hidden = false;
    renderTurnstile();
  } else {
    title.textContent = 'Sign In';
    submitBtn.textContent = 'Sign In';
    footerText.textContent = "Don't have an account?";
    toggleBtn.textContent = 'Create account';
    disclaimer.hidden = true;
    turnstileContainer.hidden = true;
    destroyTurnstile();
  }

  clearAuthError();
}

// --- Turnstile widget management ---
let _turnstileRetryInterval = null;

function renderTurnstile() {
  destroyTurnstile();
  const container = $('#auth-turnstile-container');
  if (!container) return;

  if (typeof window.turnstile === 'undefined') {
    // Script not yet loaded — show loading placeholder and poll
    container.innerHTML = '<p style="font-size:12px;color:var(--muted);text-align:center;margin:8px 0">Loading security check...</p>';
    _turnstileRetryInterval = setInterval(() => {
      if (typeof window.turnstile !== 'undefined') {
        clearInterval(_turnstileRetryInterval);
        _turnstileRetryInterval = null;
        renderTurnstile();
      }
    }, 300);
    return;
  }

  _turnstileWidgetId = window.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: model.darkMode ? 'dark' : 'light',
    callback: () => {}, // Token captured via getResponse on submit
  });
}

function destroyTurnstile() {
  if (_turnstileRetryInterval) {
    clearInterval(_turnstileRetryInterval);
    _turnstileRetryInterval = null;
  }
  if (_turnstileWidgetId !== null && typeof window.turnstile !== 'undefined') {
    try { window.turnstile.remove(_turnstileWidgetId); } catch {}
    _turnstileWidgetId = null;
  }
  const container = $('#auth-turnstile-container');
  if (container) container.innerHTML = '';
}

function getTurnstileToken() {
  if (_turnstileWidgetId === null || typeof window.turnstile === 'undefined') return null;
  return window.turnstile.getResponse(_turnstileWidgetId) || null;
}

function resetTurnstile() {
  if (_turnstileWidgetId !== null && typeof window.turnstile !== 'undefined') {
    try { window.turnstile.reset(_turnstileWidgetId); } catch {}
  }
}

// --- Error display ---
function showAuthError(msg) {
  const el = $('#auth-error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
  }
}

function clearAuthError() {
  const el = $('#auth-error');
  if (el) {
    el.textContent = '';
    el.hidden = true;
  }
}

// --- Submit state ---
function setSubmitEnabled(enabled) {
  const btn = $('#auth-submit');
  if (btn) btn.disabled = !enabled;
}

// --- Handle form submission (login or register) ---
async function handleAuthSubmit(e) {
  e.preventDefault();
  if (_isSubmitting) return;

  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;

  if (!username || !password) {
    showAuthError('Please fill in all fields.');
    return;
  }

  clearAuthError();
  _isSubmitting = true;
  setSubmitEnabled(false);

  let result;

  if (_isRegisterMode) {
    // Validate Turnstile token before registration
    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      showAuthError('Please complete the security check.');
      _isSubmitting = false;
      setSubmitEnabled(true);
      return;
    }

    result = await register(username, password, turnstileToken);

    if (!result.ok) {
      showAuthError(result.error);
      resetTurnstile();
      _isSubmitting = false;
      setSubmitEnabled(true);
      return;
    }
  } else {
    result = await login(username, password);

    if (!result.ok) {
      showAuthError(result.error);
      _isSubmitting = false;
      setSubmitEnabled(true);
      return;
    }
  }

  // Success — migrate localStorage, restore model, sync with cloud
  try {
    migrateToScopedStorage(result.username);

    // Reset model to prevent data leaking between accounts
    resetModel();

    // Reload model from the user-scoped localStorage key
    await restoreModel();

    // Reconcile with cloud data
    const syncResult = await syncOnLogin();

    if (syncResult && syncResult.action === 'loaded_cloud') {
      // Cloud data was loaded — need to re-restore model from updated localStorage
      resetModel();
      await restoreModel();
    }

    // Re-render the entire dashboard with the correct data
    if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
    if (window.renderAllSections) window.renderAllSections();
    if (window.applyDarkMode) window.applyDarkMode();
    if (window.applyGlassMode) window.applyGlassMode();
    if (window.applyGlassTheme) window.applyGlassTheme();
    if (window.applyCursorShadow) window.applyCursorShadow();
    if (window.applyDisplayMode) window.applyDisplayMode();
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();

    // Start background sync timer
    startSyncTimer();

    closeAuthModal();
    renderAuthUI();
    showToast(`Signed in as ${result.username}`);
  } catch (err) {
    console.error('[Auth] Post-login flow failed:', err);
    showAuthError('Sign-in succeeded but loading data failed. Please refresh.');
  } finally {
    _isSubmitting = false;
    setSubmitEnabled(true);
  }
}

// --- Handle logout ---
async function handleLogout() {
  closeUserPopover();
  stopSyncTimer();

  // If dirty, try one last save before logout
  if (isCloudDirty()) {
    await immediateCloudSave();
  }

  await logout();

  // Reset model to prevent data leaking between accounts
  resetModel();

  // Reload model from legacy (anonymous) key
  await restoreModel();

  // Re-render dashboard with anonymous/legacy data
  if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
  if (window.renderAllSections) window.renderAllSections();
  if (window.applyDarkMode) window.applyDarkMode();
  if (window.applyGlassMode) window.applyGlassMode();
  if (window.applyGlassTheme) window.applyGlassTheme();
  if (window.applyCursorShadow) window.applyCursorShadow();
  if (window.applyDisplayMode) window.applyDisplayMode();
  if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();

  renderAuthUI();
  showToast('Signed out');
}

// --- User popover ---
function toggleUserPopover() {
  const popover = $('#auth-user-popover');
  if (!popover) return;

  if (!popover.hidden) {
    closeUserPopover();
    return;
  }

  // Position below the auth toggle button
  const btn = $('#auth-toggle');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();

  popover.style.top = `${rect.bottom + 8}px`;
  popover.style.right = `${window.innerWidth - rect.right}px`;
  popover.style.left = 'auto';

  // Set username
  const label = $('#auth-user-label');
  if (label) label.textContent = getUsername();

  // Set sync status
  const syncStatus = $('#auth-sync-status');
  if (syncStatus) {
    syncStatus.textContent = isCloudDirty() ? 'Changes pending sync' : 'Synced';
  }

  popover.hidden = false;
}

function closeUserPopover() {
  const popover = $('#auth-user-popover');
  if (popover) popover.hidden = true;
}

// --- Wire all auth UI events ---
export function wireAuthEvents() {
  // Auth toggle button (in header)
  const authToggle = $('#auth-toggle');
  if (authToggle) {
    authToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isLoggedIn()) {
        toggleUserPopover();
      } else {
        openAuthModal();
      }
    });
  }

  // Modal close button and backdrop
  const closeBtn = $('#auth-close');
  if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);

  const backdrop = document.querySelector('#auth-modal .auth-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeAuthModal);

  // Toggle login/register mode
  const toggleMode = $('#auth-toggle-mode');
  if (toggleMode) {
    toggleMode.addEventListener('click', () => {
      setAuthMode(!_isRegisterMode);
    });
  }

  // Form submission
  const form = $('#auth-form');
  if (form) form.addEventListener('submit', handleAuthSubmit);

  // Logout button
  const logoutBtn = $('#auth-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Close user popover on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#auth-user-popover') && !e.target.closest('#auth-toggle')) {
      closeUserPopover();
    }
  });
}

// --- Initialize auth on app startup ---
// Called from init() before restoreModel()
export async function initAuthOnStartup() {
  const { isLoggedIn: loggedIn } = initAuth();

  // Wire UI events
  wireAuthEvents();
  renderAuthUI();

  return loggedIn;
}

// --- Post-restore auth sync (called after restoreModel in init) ---
export async function postRestoreAuthSync() {
  if (!isLoggedIn()) return;

  // Reconcile with cloud data (async, non-blocking for UI)
  try {
    const syncResult = await syncOnLogin();

    if (syncResult && syncResult.action === 'loaded_cloud') {
      // Do NOT re-render if user is actively editing — they would lose unsaved changes
      if (editState.enabled) {
        showToast('Cloud has newer data. Save or cancel edits to sync.');
        return;
      }
      // Cloud data was newer — reset and reload model
      resetModel();
      await restoreModel();
      if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
      if (window.renderAllSections) window.renderAllSections();
      if (window.applyDarkMode) window.applyDarkMode();
      if (window.applyGlassMode) window.applyGlassMode();
      if (window.applyGlassTheme) window.applyGlassTheme();
      if (window.applyCursorShadow) window.applyCursorShadow();
      if (window.applyDisplayMode) window.applyDisplayMode();
      if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    }
  } catch (err) {
    // Cloud sync failed — proceed with local data
    console.warn('Cloud sync on startup failed:', err);
  }

  // Start background sync timer
  startSyncTimer();
}
