// Personal Dashboard - Authentication Module
// Handles login, registration, logout, session persistence, and API communication.
// Never stores passwords. Session token + username stored in localStorage.

import { API_BASE, AUTH_TOKEN_KEY, AUTH_USERNAME_KEY } from '../constants.js';

// --- Internal auth state (mirrors localStorage for fast access)
const _auth = {
  token: null,
  username: null
};

// --- Initialize auth state from localStorage on app load
export function initAuth() {
  _auth.token = localStorage.getItem(AUTH_TOKEN_KEY) || null;
  _auth.username = localStorage.getItem(AUTH_USERNAME_KEY) || null;
  return { isLoggedIn: isLoggedIn(), username: _auth.username };
}

export function isLoggedIn() {
  return !!_auth.token;
}

export function getUsername() {
  return _auth.username;
}

export function getAuthToken() {
  return _auth.token;
}

// --- Centralized API call helper
// Returns { ok, data?, error?, status? }
export async function apiCall(method, path, body = null) {
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

    // Session expired / invalid token
    if (res.status === 401) {
      clearAuthState();
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
      return { ok: false, error: msg, status: res.status };
    }

    return { ok: true, data };
  } catch (err) {
    // Network error (offline, DNS failure, CORS, etc.)
    return { ok: false, error: 'Network error. Check your connection.', status: 0 };
  }
}

// --- Store auth credentials after successful login/register
function setAuthState(token, username) {
  _auth.token = token;
  _auth.username = username;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USERNAME_KEY, username);
}

// --- Clear auth state (logout or expired session)
function clearAuthState() {
  _auth.token = null;
  _auth.username = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USERNAME_KEY);
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
// Returns { ok, username?, error? }
export async function login(username, password) {
  const result = await apiCall('POST', '/login', { username, password });
  if (result.ok && result.data) {
    setAuthState(result.data.token, result.data.username);
    return { ok: true, username: result.data.username };
  }
  return { ok: false, error: result.error || 'Login failed.' };
}

// --- Log out (fire-and-forget the API call, always clear local state)
export async function logout() {
  // Attempt server-side logout but don't block on it
  if (_auth.token) {
    apiCall('POST', '/logout').catch(() => {});
  }
  clearAuthState();
}

