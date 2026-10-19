// Personal Dashboard - Auth UI Module
// Handles login/register modal, user popover, Turnstile widget, and auth UI state.

import { TURNSTILE_SITE_KEY } from '../constants.js';
import { $, showToast } from '../utils.js';
import {
  isLoggedIn,
  getUsername,
  getLapsedUsername,
  login,
  register,
  logout,
  persistSession,
  abandonSignIn,
  initAuth,
  startGoogleSignin,
  finishGoogleSignin,
  registerWithGoogle,
  getGoogleSigninStatus,
  unlinkGoogleSignin,
  takeGoogleSigninReturn
} from '../core/auth.js';
import {
  prepareAccountCopy,
  resetSyncState,
  syncOnLogin,
  startSyncTimer,
  stopSyncTimer,
  immediateCloudSave,
  hasUnsyncedChanges,
  waitForCloudSave,
  beginDashboardLoad,
  endDashboardLoad
} from '../core/sync.js';
import { restoreModel, rerenderDashboard } from '../core/storage.js';
import { resetFileCache } from '../core/file-service.js';
import { scheduleOfflineRefresh } from '../core/offline-copy.js';
import { model, editState, resetModel } from '../state.js';
import { buildGcalPanel, afterSignIn as gcalAfterSignIn, resetGcalState } from './google-calendar.js';

// --- Module state ---
let _isRegisterMode = false;
let _turnstileWidgetId = null;
let _loginChallenge = false; // the server asked sign-in for the security check
let _isSubmitting = false;
let _googleSignup = null; // { code, secret, email }: a new Google account picking its username

// --- Public: render auth button state (logged in vs out) ---
export function renderAuthUI() {
  const btn = $('#auth-toggle');
  if (!btn) return;

  if (isLoggedIn()) {
    btn.classList.add('logged-in');
    btn.title = `Signed in as ${getUsername()}`;
  } else {
    btn.classList.remove('logged-in');
    const lapsed = getLapsedUsername();
    btn.title = lapsed ? `Session ended: sign in as ${lapsed} to sync` : 'Account';
  }
}

// Signing in or out switches the whole dashboard: an edit session's working
// copy belongs to the dashboard it was opened on (Confirm would merge it into
// the other one), so it has to be saved or cancelled first
function editsBlockAccountSwitch(verb) {
  if (!editState.enabled) return false;
  showToast(`Save or cancel your edits before signing ${verb}`);
  return true;
}

// --- Open/close the auth modal ---
function openAuthModal() {
  const modal = $('#auth-modal');
  if (!modal) return;
  if (editsBlockAccountSwitch('in')) return;

  // Reset to login mode
  setAuthMode(false);
  clearAuthError();
  $('#auth-username').value = '';
  $('#auth-password').value = '';

  // A session that ended without a sign-out: its account is offered again
  // (setAuthMode shows the note)
  const lapsed = getLapsedUsername();
  if (lapsed) $('#auth-username').value = lapsed;

  modal.hidden = false;
  setTimeout(() => (lapsed ? $('#auth-password') : $('#auth-username')).focus(), 100);
}

// "Your session as … ended": the dashboard on screen is still that account's
// (its changes wait to sync); signing in again uploads them, "Sign out" leaves
// them waiting and shows the signed-out dashboard
function showLapsedNote(user) {
  const note = $('#auth-lapsed-note');
  if (!note) return;
  note.textContent = '';
  if (!user) { note.hidden = true; return; }
  const text = document.createElement('span');
  text.append('Your session as ');
  const who = document.createElement('strong');
  who.textContent = user;
  text.append(who, ' ended. Sign in again to sync the changes made on this device. ');
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'auth-link-btn';
  out.textContent = 'Sign out instead';
  out.addEventListener('click', endLapsedSession);
  note.append(text, out);
  note.hidden = false;
}

async function endLapsedSession() {
  if (_isSubmitting) return;
  closeAuthModal();
  await logout();
  resetGcalState();
  await showOwnerDashboard();
  renderAuthUI();
  showToast('Signed out');
}

// The dashboard of whoever owns this page now (signed in, a lapsed session,
// or the signed-out dashboard), shown from its own saved copy (and its own
// sticky notes)
async function showOwnerDashboard() {
  resetSyncState();
  resetFileCache();
  resetModel();
  await restoreModel();
  rerenderDashboard({ stickyNotes: true });
}

function closeAuthModal() {
  const modal = $('#auth-modal');
  if (modal) modal.hidden = true;
  destroyTurnstile();
  _loginChallenge = false;
  _isSubmitting = false;
  setSubmitEnabled(true);
  // A trip to Google that never left (the navigation was stopped) leaves it off
  setGoogleButtonEnabled(true);
  _googleTrip++;
}

// --- Toggle between login and register modes ---
function setAuthMode(isRegister) {
  _isRegisterMode = isRegister;
  _loginChallenge = false;
  _googleSignup = null;
  showGoogleSignupLook(false);
  showLapsedNote(isRegister ? null : getLapsedUsername());
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
  if (editState.enabled) { showAuthError('Save or cancel your edits first.'); return; }
  if (_googleSignup) { await handleGoogleSignupSubmit(); return; }

  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;

  if (!username || !password) {
    showAuthError('Please fill in all fields.');
    return;
  }

  clearAuthError();
  _isSubmitting = true;
  setSubmitEnabled(false);

  // Read once, before the request: the Sign in / Create account switch still
  // works while it runs, and only an account this request made may take the
  // signed-out dashboard (a sign-in answered after a switch is never "created")
  const created = _isRegisterMode;
  // Edit mode waits from here (sync.js): an edit session opened while the
  // request runs would hold the dashboard about to be replaced, and its Confirm
  // would merge it into the account. completeSignIn holds it on its own too
  beginDashboardLoad();
  try {
    let result;

    if (created) {
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
      // After many attempts on this account the server asks for the same
      // security check as registration (it never locks the owner out)
      const turnstileToken = _loginChallenge ? getTurnstileToken() : null;
      if (_loginChallenge && !turnstileToken) {
        showAuthError('Please complete the security check.');
        _isSubmitting = false;
        setSubmitEnabled(true);
        return;
      }

      result = await login(username, password, turnstileToken);

      if (!result.ok) {
        if (result.turnstileRequired && !_loginChallenge) {
          _loginChallenge = true;
          $('#auth-turnstile-container').hidden = false;
          renderTurnstile();
        } else if (_loginChallenge) {
          resetTurnstile();
        }
        showAuthError(result.error);
        _isSubmitting = false;
        setSubmitEnabled(true);
        return;
      }
    }

    await completeSignIn(result.username, { created });
  } catch (err) {
    console.error('[Auth] Sign-in failed:', err);
    showAuthError('Sign-in failed. Try again.');
    _isSubmitting = false;
    setSubmitEnabled(true);
  } finally {
    endDashboardLoad();
  }
}

// --- After any successful sign-in (password, Google, a new account) ---
// Make this browser's copy the account's own (prepareAccountCopy), restore
// the account's model, sync with the cloud. created: the account was made just
// now on this browser (the only case the signed-out dashboard may go into it)
async function completeSignIn(username, { created = false } = {}) {
  let persisted = false;
  // Edit mode waits until the account's dashboard is on screen (sync.js)
  beginDashboardLoad();
  try {
    // Edit mode on anyway (it can't open while a sign-in loads): its working
    // copy is the dashboard on screen, and Confirm would merge it into the
    // account. The sign-in stops before anything of the account is stored
    if (editState.enabled) {
      abandonSignIn();
      renderAuthUI();
      const msg = 'Save or cancel your edits, then sign in again.';
      showAuthError(msg);
      if ($('#auth-modal').hidden) showToast(msg);
      return;
    }
    const prep = await prepareAccountCopy(username, { created });
    if (!prep.ok) {
      // This browser has no copy of the account and the cloud copy couldn't be
      // read (or stored): going on would show (and later upload) another dashboard
      abandonSignIn();
      renderAuthUI();
      const msg = prep.error === 'storage'
        ? 'Signed in, but this browser’s storage is full, so your dashboard couldn’t be loaded.'
        : 'Signed in, but your dashboard couldn’t be loaded. Check your connection and try again.';
      showAuthError(msg);
      if ($('#auth-modal').hidden) showToast(msg);
      return;
    }
    // The account's copy is ready: the session is saved from here on
    persistSession();
    persisted = true;

    // Reset the model (and this page's sync flag) so nothing leaks between
    // accounts, then read the account's own copy
    resetSyncState();
    resetFileCache();
    resetModel();
    await restoreModel();

    // Reconcile with cloud data (a copy just taken from the cloud needs nothing
    // more). One merge: changes this copy holds that never synced (made after its
    // session ended, an offline start) and the cloud's both stay; a merge that
    // changes this copy is applied to the model by the sync itself
    if (prep.source !== 'cloud') {
      await syncOnLogin(prep.cloud || null, { render: false });
    }

    // Re-render the entire dashboard with the correct data, the account's own
    // sticky notes (this browser only) and stored images included
    rerenderDashboard({ stickyNotes: true });

    // Start background sync timer
    startSyncTimer();

    closeAuthModal();
    renderAuthUI();
    showToast(prep.source === 'carried'
      ? `Signed in as ${username}. This dashboard was uploaded to your account.`
      : `Signed in as ${username}`);
    gcalAfterSignIn();
    // This account's offline copy on this phone, if it saved one: a quiet update
    scheduleOfflineRefresh();
  } catch (err) {
    console.error('[Auth] Post-login flow failed:', err);
    if (!persisted) {
      // Nothing of the account is on screen yet: the sign-in is undone, so the
      // dashboard shown is not used (uploads, merges) with the new session
      abandonSignIn();
      renderAuthUI();
      showAuthError('Signed in, but your dashboard couldn’t be loaded. Try again.');
      if ($('#auth-modal').hidden) showToast('Signed in, but your dashboard couldn’t be loaded. Try again.');
      return;
    }
    showAuthError('Sign-in succeeded but loading data failed. Please refresh.');
    // Back from Google the dialog may be closed: say it where it shows
    if ($('#auth-modal').hidden) showToast('Signed in, but loading data failed. Please refresh.');
  } finally {
    endDashboardLoad();
    _isSubmitting = false;
    setSubmitEnabled(true);
  }
}

// --- Handle logout ---
let _signingOut = false;
async function handleLogout() {
  closeUserPopover();
  if (_signingOut) return;
  if (editsBlockAccountSwitch('out')) return;
  _signingOut = true;
  stopSyncTimer();

  try {
    // One last sync before logout: a sync already on its way finishes first
    // (signing out under it would drop it), then whatever is still unsynced is
    // merged in, this page's changes or ones an earlier page left (the stored
    // flag). A merge never uploads an older copy over newer changes
    if (hasUnsyncedChanges()) showToast('Syncing your changes before signing out…');
    await waitForCloudSave();
    if (isLoggedIn() && hasUnsyncedChanges()) {
      await immediateCloudSave({ quiet: true });
    }
    const unsynced = isLoggedIn() && hasUnsyncedChanges();
    // Edit mode opened while that upload ran: the sign-out waits for it too
    if (editsBlockAccountSwitch('out')) {
      if (isLoggedIn()) startSyncTimer();
      return;
    }

    await logout();
    resetGcalState();

    // The signed-out dashboard (legacy key), from its own copy: nothing of the
    // account's model stays in memory
    await showOwnerDashboard();

    renderAuthUI();
    // What didn't sync stays in the account's copy on this browser, and goes
    // up when the account signs in here again
    showToast(unsynced ? 'Signed out. Changes that didn’t sync wait on this browser until you sign in again' : 'Signed out');
  } finally {
    _signingOut = false;
  }
}

// --- Google sign-in ---
const GOOGLE_RETURN_MESSAGES = {
  denied: 'Google sign-in was cancelled.',
  expired: 'Google sign-in took too long. Try again.',
  invalid: 'That Google sign-in was already used. Try again.',
  identity: 'Google didn’t confirm a verified email for that account.',
  exchange_failed: 'Google didn’t finish the sign-in. Try again.',
  not_configured: 'Google sign-in isn’t set up on the server yet.'
};

function setGoogleButtonEnabled(enabled) {
  const btn = $('#auth-google-btn');
  if (btn) btn.disabled = !enabled;
}

// "Continue with Google": signs in, or creates an account (username step after)
async function handleGoogleButton() {
  if (_isSubmitting) return;
  // Leaving for Google's page would drop unsaved edits
  if (editState.enabled) { showAuthError('Save or cancel your edits first.'); return; }
  clearAuthError();
  _isSubmitting = true;
  setSubmitEnabled(false);
  setGoogleButtonEnabled(false);
  const r = await startGoogleSignin('signin');
  if (r.ok) { leaveForGoogle(r.url); return; }
  showAuthError(r.error);
  _isSubmitting = false;
  setSubmitEnabled(true);
  setGoogleButtonEnabled(true);
}

// Off to Google's page. A navigation that never happens (stopped while it
// loads: Esc, the browser's ✕) leaves this page as it was, so the form works
// again after a while instead of staying disabled
const GOOGLE_LEAVE_GRACE_MS = 8000;
let _googleTrip = 0; // closing the dialog (which re-enables the form) cancels the wait
function leaveForGoogle(url) {
  const trip = ++_googleTrip;
  let left = false;
  const onHide = () => { left = true; };
  window.addEventListener('pagehide', onHide, { once: true });
  location.assign(url);
  setTimeout(() => {
    window.removeEventListener('pagehide', onHide);
    if (left || trip !== _googleTrip) return;
    _isSubmitting = false;
    setSubmitEnabled(true);
    setGoogleButtonEnabled(true);
  }, GOOGLE_LEAVE_GRACE_MS);
}

// The username step for a new Google account: the Create account form
// without the password, with the security check
function showGoogleSignupLook(on, email = '') {
  const area = $('#auth-google-area');
  if (area) area.hidden = on;
  const note = $('#auth-google-note');
  if (note) {
    note.hidden = !on;
    note.textContent = on ? `Signed in to Google as ${email}. Choose a username for your dashboard.` : '';
  }
  const pw = $('#auth-password-field');
  if (pw) pw.hidden = on;
  const pwInput = $('#auth-password');
  if (pwInput) pwInput.required = !on;
  const footer = document.querySelector('#auth-modal .auth-footer');
  if (footer) footer.hidden = on;
  if (on) {
    const disclaimer = $('#auth-disclaimer');
    if (disclaimer) disclaimer.hidden = true;
  }
}

function openGoogleSignup({ code, secret, email, suggestion }) {
  const modal = $('#auth-modal');
  if (!modal) return;
  setAuthMode(true);
  _googleSignup = { code, secret, email };
  showGoogleSignupLook(true, email);
  $('#auth-username').value = suggestion || '';
  $('#auth-password').value = '';
  modal.hidden = false;
  setTimeout(() => { const u = $('#auth-username'); u.focus(); u.select(); }, 100);
}

async function handleGoogleSignupSubmit() {
  if (editState.enabled) { showAuthError('Save or cancel your edits first.'); return; }
  const username = $('#auth-username').value.trim();
  if (!username) { showAuthError('Choose a username.'); return; }
  const turnstileToken = getTurnstileToken();
  if (!turnstileToken) { showAuthError('Please complete the security check.'); return; }
  clearAuthError();
  _isSubmitting = true;
  setSubmitEnabled(false);
  const g = _googleSignup;
  // Edit mode waits while the request runs (see handleAuthSubmit)
  beginDashboardLoad();
  try {
    const result = await registerWithGoogle(g.code, g.secret, username, turnstileToken);
    if (!result.ok) {
      // Used up, or from another tab: back to the start, where Google can be tried again
      if (result.reason === 'invalid_code' || result.reason === 'wrong_browser') setAuthMode(false);
      else resetTurnstile();
      showAuthError(result.error);
      _isSubmitting = false;
      setSubmitEnabled(true);
      return;
    }
    // Only an account the Worker made just now may take the signed-out
    // dashboard: a Google login linked to an existing account meanwhile (on
    // another device) signs in to that account, which keeps its own
    await completeSignIn(result.username, { created: result.created === true });
  } catch (err) {
    console.error('[Auth] Google sign-up failed:', err);
    showAuthError('Couldn’t create the account. Try again.');
    _isSubmitting = false;
    setSubmitEnabled(true);
  } finally {
    endDashboardLoad();
  }
}

// Called at the end of init(): finishes a sign-in / link that came back from
// Google (readGoogleSigninReturn() took the fragment off the URL first).
// startupSync: the signed-in startup sync, if any (a link waits for it)
export async function resumeGoogleSignin(startupSync = null) {
  const back = takeGoogleSigninReturn();
  if (!back) return;
  // A sign-in coming back may replace the dashboard on screen: edit mode waits
  beginDashboardLoad();
  try {
    await finishGoogleReturn(back, startupSync);
  } finally {
    endDashboardLoad();
  }
}

async function finishGoogleReturn(back, startupSync) {
  const linking = back.mode === 'link';
  // A link's toasts wait for the startup sync, whose own toast would cover them
  const afterStartupSync = async () => {
    if (startupSync) { try { await startupSync; } catch (e) { /* its own problem */ } }
  };
  // Signed in (a link, or a return that landed in another signed-in window):
  // a toast, never the Sign In dialog over the account
  const fail = async (msg) => {
    if (linking || isLoggedIn()) { await afterStartupSync(); showToast(msg); return; }
    openAuthModal();
    showAuthError(msg);
  };
  // The used state, no secret, signed in: a Back into Google's page after a
  // finished trip (an installed app keeps Google's pages in its history) came
  // back again. Nothing to say
  if (!back.ok && back.reason === 'invalid' && !back.secret && isLoggedIn()) return;
  if (!back.ok) { await fail(GOOGLE_RETURN_MESSAGES[back.reason] || 'Google sign-in failed. Try again.'); return; }
  if (!back.secret) { await fail('Finish the Google sign-in in the tab that started it.'); return; }
  const r = await finishGoogleSignin(back.code, back.secret);
  if (!r.ok) { await fail(r.error); return; }
  if (r.kind === 'session') { _isSubmitting = true; await completeSignIn(r.username); return; }
  if (r.kind === 'signup') { openGoogleSignup({ code: back.code, secret: back.secret, email: r.email, suggestion: r.suggestion }); return; }
  _googleStatus = { user: null, data: null };
  await afterStartupSync();
  showToast(r.email ? `Google sign-in linked (${r.email})` : 'Google sign-in linked');
}

// --- Google sign-in panel: the account popover (computer), More → Google sign-in (phone)
let _googleStatus = { user: null, data: null }; // the last answer, per account

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// fallback: say so when the status can't be read (the phone sheet); the
// popover just leaves its slot empty (hidden)
export function buildGoogleSigninPanel(host, { title = true, fallback = false } = {}) {
  if (!host) return;
  const user = getUsername();
  let confirming = false;
  let busy = false;

  const btn = (label, cls, onClick, action) => {
    const b = el('button', `gcal-btn ${cls || ''}`.trim(), label);
    b.type = 'button';
    b.dataset.gsiAction = action;
    b.addEventListener('click', onClick);
    return b;
  };

  const paint = (loaded) => {
    const active = document.activeElement;
    const focused = active && host.contains(active) ? active.dataset.gsiAction || null : null;
    host.textContent = '';
    if (!isLoggedIn()) return;
    const s = _googleStatus.user === user ? _googleStatus.data : null;
    if (!s) {
      if (loaded && fallback) {
        host.classList.add('gcal-panel');
        host.append(el('p', 'gcal-note', 'Google sign-in isn’t available right now.'));
      }
      return;
    }
    host.classList.add('gcal-panel');
    if (title) host.append(el('div', 'gcal-panel-title', 'Google sign-in'));
    if (s.linked) {
      const who = el('p', 'gcal-who', 'Linked');
      if (s.email) who.append(el('span', 'gcal-email', s.email));
      host.append(who, el('p', 'gcal-note', s.hasPassword
        ? 'Google opens this account. Your password still works too.'
        : 'This account signs in with Google only.'));
      if (s.hasPassword) {
        const row = el('div', 'gcal-actions');
        if (confirming) {
          row.append(
            el('p', 'gcal-note', 'Stop opening this account with Google?'),
            btn('Unlink', 'gcal-btn-danger', unlink, 'unlink-yes'),
            btn('Cancel', 'gcal-btn-quiet', () => { confirming = false; paint(true); }, 'unlink-no')
          );
        } else {
          row.append(btn('Unlink', '', () => { confirming = true; paint(true); }, 'unlink'));
        }
        host.append(row);
      }
    } else {
      host.append(
        el('p', 'gcal-note', 'Also open this account with your Google account. Your password keeps working.'),
        btn('Link Google account', 'gcal-btn-primary', link, 'link')
      );
    }
    // Keyboard users stay in place: Unlink → Cancel, Cancel → Unlink
    const next = { unlink: 'unlink-no', 'unlink-no': 'unlink' }[focused] || focused;
    const target = next && [...host.querySelectorAll('[data-gsi-action]')].find((n) => n.dataset.gsiAction === next);
    if (target) target.focus({ preventScroll: true });
  };

  async function link() {
    if (busy) return;
    if (editState.enabled) { showToast('Save or cancel your edits first'); return; }
    busy = true;
    const r = await startGoogleSignin('link');
    if (r.ok) { location.assign(r.url); return; }
    busy = false;
    showToast(r.error);
  }

  async function unlink() {
    if (busy) return;
    busy = true;
    const r = await unlinkGoogleSignin();
    busy = false;
    confirming = false;
    if (getUsername() !== user) return;
    if (!r.ok) { showToast(r.error); paint(true); return; }
    _googleStatus = { user, data: { linked: false, email: null, hasPassword: r.hasPassword !== false } };
    showToast('Google sign-in unlinked');
    paint(true);
  }

  const load = () => getGoogleSigninStatus().then((r) => {
    if (getUsername() !== user || !host.isConnected) return;
    _googleStatus = { user, data: r.ok ? { linked: r.linked, email: r.email || null, hasPassword: r.hasPassword !== false } : null };
    paint(true);
  });
  // Back from Google's page (the page comes back from the back/forward cache):
  // Link works again, and the status is read again (a finished link shows)
  host.dataset.gsiPanel = '';
  host._gsiRestore = () => {
    busy = false;
    confirming = false;
    if (host.isConnected && getUsername() === user) load();
  };
  paint(false);
  load();
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
  // The Google Calendar panel can make it tall: it scrolls instead of leaving the screen
  popover.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - 20)}px`;

  // Set username
  const label = $('#auth-user-label');
  if (label) label.textContent = getUsername();

  // Set sync status
  const syncStatus = $('#auth-sync-status');
  if (syncStatus) {
    syncStatus.textContent = hasUnsyncedChanges() ? 'Changes pending sync' : 'Synced';
  }

  buildGoogleSigninPanel($('#auth-google'));
  buildGcalPanel($('#auth-gcal'));

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

  // Continue with Google
  const googleBtn = $('#auth-google-btn');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleButton);
  // Back from Google's page with the browser's Back button (the page comes
  // back from the back/forward cache): the form is usable again
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    _isSubmitting = false;
    setSubmitEnabled(true);
    setGoogleButtonEnabled(true);
    // …and so do the Google sign-in panels (account popover, phone sheet)
    _googleStatus = { user: null, data: null };
    document.querySelectorAll('[data-gsi-panel]').forEach((h) => { if (typeof h._gsiRestore === 'function') h._gsiRestore(); });
  });

  // Logout button
  const logoutBtn = $('#auth-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Close user popover on outside click
  // (the path is fixed at dispatch: a button the Google Calendar panel just
  // replaced is detached by now, yet it was inside the popover)
  document.addEventListener('click', (e) => {
    const inside = e.composedPath().some((n) => n.id === 'auth-user-popover' || n.id === 'auth-toggle');
    if (!inside) {
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

  // Edit mode waits for this (sync.js beginDashboardLoad): the model may be
  // replaced with the merge below. It may open once the dashboard on screen is
  // final, while the merge is still uploading
  beginDashboardLoad();
  let loading = true;
  const loaded = () => { if (loading) { loading = false; endDashboardLoad(); } };
  // Reconcile with cloud data (async, non-blocking for UI): one merge of this
  // copy and the cloud's, applied to the model on screen by the sync itself (a
  // copy this page holds an editor open on waits until it closes: sync.js)
  try {
    await syncOnLogin(null, { onLocalReady: loaded });
  } catch (err) {
    // Cloud sync failed — proceed with local data
    console.warn('Cloud sync on startup failed:', err);
  } finally {
    loaded();
  }

  // Start background sync timer
  startSyncTimer();

  // Auto-migrate Base64 images to R2 (safe, idempotent, non-blocking)
  try {
    if (window.migrateBase64ToR2) {
      window.migrateBase64ToR2();
    }
  } catch {
    // Migration failure should not break the app
  }
}
