// Personal Dashboard - Offline copy service worker (classic script)
// Opt-in: registered only by js/core/offline-copy.js when the user saves an
// offline copy (More → Offline copy), and unregistered by its Remove. Without
// it the app has no service worker at all.
//
// Network first, always: a same-origin GET under this worker's scope goes to
// the network as before; only when the network THROWS (offline, DNS, dropped
// connection) is the copy in Cache Storage 'pd-shell-v1' used, keyed by the
// path without the query (so js/main.js?v=… and js/main.js are one entry;
// '/dashboard/' is index.html). A successful answer refreshes that entry.
// Never answered here: other origins (the API Worker, the viewer Worker,
// Google, jsdelivr, Turnstile), non-GET requests and Range requests.
// The account files ('pd-files-v1@<user>') are the page's own business: this
// worker never reads, writes or deletes them.
//
// Kill switch: set KILL = true and deploy. Each installed copy then updates
// (browsers check this script on navigation), drops the app cache, stops
// answering and unregisters itself. js/core/offline-copy.js has the page-side
// switch (OFFLINE_COPY_ENABLED) that hides the feature and cleans up too.
// js/core/offline-plan.js holds the same rules (shellKey, isShellRequest);
// Reference/pwa-test.mjs runs this file in a vm against them.

'use strict';

var KILL = false;
var SHELL_CACHE = 'pd-shell-v1';
var SHELL_CACHE_PREFIX = 'pd-shell-';

function shellKey(url) {
  var u = new URL(url);
  var path = u.pathname;
  if (path.charAt(path.length - 1) === '/') path += 'index.html';
  return u.origin + path;
}

function isShellRequest(request) {
  if (KILL) return false;
  if (request.method !== 'GET') return false;
  if (request.headers && request.headers.has('range')) return false;
  var u;
  try { u = new URL(request.url); } catch (e) { return false; }
  if (u.origin !== self.location.origin) return false;
  return u.href.indexOf(self.registration.scope) === 0;
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names
      .filter(function (n) { return n.indexOf(SHELL_CACHE_PREFIX) === 0 && (KILL || n !== SHELL_CACHE); })
      .map(function (n) { return caches.delete(n); }));
    if (KILL) {
      await self.registration.unregister();
      return;
    }
    await self.clients.claim();
  })());
});

// Only refresh an entry while the app cache exists: after Remove deleted it,
// a page this worker still controls must not bring it back
async function remember(key, response) {
  try {
    if (!(await caches.has(SHELL_CACHE))) return;
    var cache = await caches.open(SHELL_CACHE);
    await cache.put(key, response);
  } catch (e) { /* storage full or gone: the network answer was served anyway */ }
}

async function networkFirst(event) {
  var request = event.request;
  var key = shellKey(request.url);
  var response;
  try {
    response = await fetch(request);
  } catch (err) {
    var hit = null;
    try {
      if (await caches.has(SHELL_CACHE)) {
        var cache = await caches.open(SHELL_CACHE);
        hit = await cache.match(key, { ignoreVary: true });
      }
    } catch (e) { hit = null; }
    if (hit) return hit;
    throw err;
  }
  if (response && response.status === 200 && response.type === 'basic' && !response.redirected) {
    event.waitUntil(remember(key, response.clone()));
  }
  return response;
}

self.addEventListener('fetch', function (event) {
  if (!isShellRequest(event.request)) return;
  event.respondWith(networkFirst(event));
});
