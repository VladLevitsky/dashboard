// Personal Dashboard - Authentication Module
// Handles login, registration, logout, session persistence, and API communication.
// Never stores passwords. Session token + username stored in localStorage.

import { API_BASE, AUTH_TOKEN_KEY, AUTH_USERNAME_KEY, AUTH_LAPSED_KEY } from '../constants.js';

// --- Internal auth state (mirrors localStorage for fast access)
const _auth = {
  token: null,
  username: null,
  lapsed: null,     // the account whose session ended (401) without a sign-out
  persisted: false  // the session is saved (a sign-in in progress is not yet)
};

// --- Initialize auth state from localStorage on app load
export function initAuth() {
  _auth.token = localStorage.getItem(AUTH_TOKEN_KEY) || null;
  _auth.username = localStorage.getItem(AUTH_USERNAME_KEY) || null;
  _auth.persisted = !!_auth.token;
  _auth.lapsed = _auth.token ? null : (localStorage.getItem(AUTH_LAPSED_KEY) || null);
  return { isLoggedIn: isLoggedIn(), username: _auth.username };
}

export function isLoggedIn() {
  return !!_auth.token;
}

export function getUsername() {
  return _auth.username;
}

// Whose dashboard this page holds: the signed-in account, or the one whose
// session ended (a 401) without signing out. Its own saved copy stays in use,
// and its changes wait to sync, until someone signs in or out; nothing of it
// ever lands in the signed-out dashboard. Null = the signed-out dashboard
export function getDataOwner() {
  return _auth.username || (_auth.token ? null : _auth.lapsed) || null;
}

// The account whose session ended (shown by the sign-in dialog), else null
export function getLapsedUsername() {
  return _auth.token ? null : _auth.lapsed;
}

export function getAuthToken() {
  return _auth.token;
}

// --- Centralized API call helper
// Returns { ok, data?, error?, status? }
// keepSession: a 401 is just an answer (the Google sign-in routes: a Worker
// without them yet, or a link step, must never end the session)
export async function apiCall(method, path, body = null, { keepSession = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (_auth.token) {
    headers['Authorization'] = `Bearer ${_auth.token}`;
  }

  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, opts);

    // Session expired / invalid token: signed out, but the account's
    // dashboard stays this page's (getDataOwner) until a sign-in or sign-out
    if (res.status === 401 && !keepSession) {
      clearAuthState({ lapsed: true });
      return { ok: false, error: 'Session expired. Please sign in again.', status: 401 };
    }

    // Profile too large
    if (res.status === 413) {
      return { ok: false, error: 'Profile exceeds the 2 MB cloud storage limit. Try removing large images.', status: 413 };
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `Request failed (${res.status})`;
      return { ok: false, error: msg, status: res.status, data };
    }

    return { ok: true, data };
  } catch (err) {
    // Network error (offline, DNS failure, CORS, etc.)
    return { ok: false, error: 'Network error. Check your connection.', status: 0 };
  }
}

// --- Store auth credentials after successful login/register
// In memory only until the account's dashboard copy is ready (persistSession,
// auth-ui.js completeSignIn): a reload before that comes back as it was,
// never signed in over a copy that isn't the account's
function setAuthState(token, username) {
  _auth.token = token;
  _auth.username = username;
  _auth.persisted = false;
}

// The sign-in is complete: the session is saved, and a session that had
// ended before it is forgotten
export function persistSession() {
  if (!_auth.token || !_auth.username) return;
  localStorage.setItem(AUTH_TOKEN_KEY, _auth.token);
  localStorage.setItem(AUTH_USERNAME_KEY, _auth.username);
  _auth.persisted = true;
  _auth.lapsed = null;
  try { localStorage.removeItem(AUTH_LAPSED_KEY); } catch (e) { /* ignore */ }
}

// A sign-in that could not finish (the account's dashboard couldn't be read):
// the server session ends and everything is as before it (a session that had
// ended stays the owner of what is on screen)
export function abandonSignIn() {
  if (_auth.token) apiCall('POST', '/logout').catch(() => {});
  if (_auth.persisted) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
  }
  _auth.token = null;
  _auth.username = null;
  _auth.persisted = false;
}

// --- Clear auth state (logout or expired session)
// lapsed: an expired session (a 401), not a sign-out: the account is
// remembered as the owner of what is on screen. A 401 to a sign-in still in
// progress, or while signed out (a wrong password), keeps whatever was remembered
function clearAuthState({ lapsed = false } = {}) {
  const established = _auth.persisted ? _auth.username : null;
  _auth.lapsed = lapsed ? (established || _auth.lapsed) : null;
  _auth.token = null;
  _auth.username = null;
  _auth.persisted = false;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USERNAME_KEY);
  try {
    if (_auth.lapsed) localStorage.setItem(AUTH_LAPSED_KEY, _auth.lapsed);
    else localStorage.removeItem(AUTH_LAPSED_KEY);
  } catch (e) { /* the in-memory owner still holds for this page */ }
}

// --- Register a new account
// Returns { ok, username?, error? }
export async function register(username, password, turnstileToken) {
  const result = await apiCall('POST', '/register', { username, password, turnstileToken });
  if (result.ok && result.data) {
    setAuthState(result.data.token, result.data.username);
    return { ok: true, username: result.data.username };
  }
  return { ok: false, error: result.error || 'Registration failed.' };
}

// --- Log in to an existing account
// turnstileToken: only when the server asked for the security check (after
// many attempts on this account from different places)
// Returns { ok, username?, error?, turnstileRequired? }
export async function login(username, password, turnstileToken = null) {
  const body = { username, password };
  if (turnstileToken) body.turnstileToken = turnstileToken;
  const result = await apiCall('POST', '/login', body);
  if (result.ok && result.data) {
    setAuthState(result.data.token, result.data.username);
    return { ok: true, username: result.data.username };
  }
  return {
    ok: false,
    error: result.error || 'Login failed.',
    turnstileRequired: !!(result.data && result.data.turnstile_required === true)
  };
}

// --- Google sign-in ("Continue with Google", linking from the account menu)
// The Worker sends Google back to the dashboard with a single-use code in the
// URL FRAGMENT (#google-signin=ok&code=… or =error&reason=…), never a session
// token. The code only works with a secret this tab made before leaving
// (sessionStorage), so a code that reaches another browser is useless there.

const GOOGLE_SIGNIN_KEY = 'dashboard_google_signin';
let _googleReturn = null; // { ok, code, reason, secret, mode } after coming back

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Key(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// First thing in init(): read and drop the fragment before anything (the
// phone shell's history) uses the URL
export function readGoogleSigninReturn() {
  let params;
  try { params = new URLSearchParams((location.hash || '').replace(/^#/, '')); } catch (e) { return; }
  const value = params.get('google-signin');
  if (!value) return;
  try {
    history.replaceState(history.state, '', location.pathname + location.search);
  } catch (e) { /* the fragment just stays visible */ }
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(GOOGLE_SIGNIN_KEY) || 'null');
    sessionStorage.removeItem(GOOGLE_SIGNIN_KEY);
  } catch (e) { saved = null; }
  _googleReturn = {
    ok: value === 'ok',
    code: params.get('code') || '',
    reason: params.get('reason') || '',
    secret: (saved && typeof saved.secret === 'string') ? saved.secret : '',
    mode: (saved && saved.mode === 'link') ? 'link' : 'signin'
  };
}

export function takeGoogleSigninReturn() {
  const r = _googleReturn;
  _googleReturn = null;
  return r;
}

// mode 'signin' (signed out) | 'link' (signed in: add Google to this account)
// Returns { ok, url? , error?, status? }; the caller goes to url
export async function startGoogleSignin(mode = 'signin') {
  const secret = randomKey();
  const r = await apiCall('POST', '/auth/google/start', { mode, proof: await sha256Key(secret) }, { keepSession: true });
  const url = r.ok && r.data && typeof r.data.url === 'string' ? r.data.url : '';
  if (!url.startsWith('https://accounts.google.com/')) {
    const error = r.status === 404 ? 'Google sign-in isn’t available yet.' : (r.error || 'Couldn’t reach the server. Try again.');
    return { ok: false, error, status: r.status };
  }
  try {
    sessionStorage.setItem(GOOGLE_SIGNIN_KEY, JSON.stringify({ secret, mode, at: Date.now() }));
  } catch (e) {
    return { ok: false, error: 'This browser blocks the storage Google sign-in needs.' };
  }
  return { ok: true, url };
}

// Back from Google. Returns one of:
//   { ok, kind: 'session', username }               signed in (same session as /login)
//   { ok, kind: 'signup', email, suggestion }       a new Google account: pick a username
//   { ok, kind: 'link', email }                     linked to the signed-in account
//   { ok: false, error, reason }
export async function finishGoogleSignin(code, secret) {
  const r = await apiCall('POST', '/auth/google/finish', { code, secret }, { keepSession: true });
  const d = r.data || {};
  if (r.ok && d.token && d.username) {
    setAuthState(d.token, d.username);
    return { ok: true, kind: 'session', username: d.username };
  }
  if (r.ok && d.needsUsername) return { ok: true, kind: 'signup', email: d.email || '', suggestion: d.suggestion || '' };
  if (r.ok && d.linked) return { ok: true, kind: 'link', email: d.email || '' };
  return { ok: false, error: r.status === 401 ? 'Sign in again, then link Google from the account menu.' : (r.error || 'Google sign-in failed. Try again.'), reason: d.reason || '' };
}

// A new account for a Google login (after the security check)
// Returns { ok, username?, error?, reason? }
export async function registerWithGoogle(code, secret, username, turnstileToken) {
  const r = await apiCall('POST', '/auth/google/register', { code, secret, username, turnstileToken }, { keepSession: true });
  const d = r.data || {};
  if (r.ok && d.token && d.username) {
    setAuthState(d.token, d.username);
    return { ok: true, username: d.username };
  }
  return { ok: false, error: r.error || 'Couldn’t create the account. Try again.', reason: d.reason || '' };
}

// { ok, linked, email, hasPassword } | { ok: false, status }
export async function getGoogleSigninStatus() {
  const r = await apiCall('GET', '/auth/google/status', null, { keepSession: true });
  if (r.ok && r.data && typeof r.data.linked === 'boolean') return { ok: true, ...r.data };
  return { ok: false, status: r.status, error: r.error };
}

export async function unlinkGoogleSignin() {
  const r = await apiCall('POST', '/auth/google/unlink', null, { keepSession: true });
  if (r.ok && r.data) return { ok: true, ...r.data };
  return { ok: false, error: r.error || 'Couldn’t unlink. Try again.' };
}

// --- Log out (fire-and-forget the API call, always clear local state)
export async function logout() {
  // Attempt server-side logout but don't block on it
  if (_auth.token) {
    apiCall('POST', '/logout').catch(() => {});
  }
  clearAuthState();
}

