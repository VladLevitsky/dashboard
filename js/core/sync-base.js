// Personal Dashboard - Sync bases (IndexedDB; Node-safe)
// A base is the last version of the profile this browser and the cloud agreed on,
// kept whole so the next sync can tell what each side changed since
// (profile-merge.js). One list per stored copy (storageKey: the account's
// pd_user_<username>_model_v2; never the signed-out dashboard), the last BASES_KEPT
// versions, newest first. They double as recovery points.
//   database 'pd-sync', store 'bases', key [storageKey, id],
//   value { storageKey, id, rev, chain, savedAt, raw }
//     id       the version (mobile-sync.js stampId / versionIdOf; never empty)
//     rev      the Worker's revision of that version (null on an older Worker)
//     chain    the Worker's revision chain ('' when none)
//     savedAt  when this browser stored it (epoch ms; strictly increasing per page)
//     raw      the profile as JSON text
//   plus one small index record per storageKey, key [storageKey, ''] =
//   { index: [{ id, savedAt }] newest first }, so a put or a get never reads every
//   stored profile (each can be ~2 MB)
// Every call resolves (never throws), within IDB_TIMEOUT_MS at the latest. Without
// IndexedDB (Node, a private window, blocked storage, an error, or an open /
// transaction that never answers: this page then stops using it) the bases live in
// this page's memory only, so after a reload getBase() answers null and the next
// sync merges in union mode (keeps everything: safe). A sync waits on these calls,
// so one that never settled would hold every later sync and sign-out (sync.js).
// Bases are per browser: never synced, never exported.

export const BASE_DB = 'pd-sync';
export const BASE_STORE = 'bases';
export const BASES_KEPT = 5;
export const IDB_TIMEOUT_MS = 3000;

const INDEX_ID = '';         // the index record's id (a base id is never empty)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- in-memory fallback ----------------------------------------------
const memory = new Map();   // storageKey → records, newest first

function memList(storageKey) {
  return memory.get(storageKey) || [];
}

function memPut(record) {
  const rest = memList(record.storageKey).filter(r => r.id !== record.id);
  memory.set(record.storageKey, sortNewest([record, ...rest]).slice(0, BASES_KEPT));
}

function sortNewest(records) {
  return records.filter(r => isObj(r) && typeof r.id === 'string' && r.id !== INDEX_ID)
    .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
}

// ---------- IndexedDB -------------------------------------------------------
let factoryOverride;          // tests: an IDBFactory, or null = "no IndexedDB"
let dbPromise = null;
let idbGaveUp = false;        // an open or a transaction never answered: memory only, for this page
let timeoutMs = IDB_TIMEOUT_MS;

function idbFactory() {
  if (factoryOverride !== undefined) return factoryOverride;
  try { return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null; } catch { return null; }
}

export function baseStoreAvailable() {
  return !idbGaveUp && !!idbFactory();
}

// (cleared as soon as the call settles; one that never does waits out the timeout)
function timer(fn, ms) {
  return setTimeout(fn, ms);
}

function giveUp() {
  idbGaveUp = true;
  dbPromise = null;
}

function openDb() {
  const factory = idbGaveUp ? null : idbFactory();
  if (!factory) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (db) => {
      if (settled) {
        // Answered after the timeout: this page no longer uses it
        if (db) { try { db.close(); } catch { /* closed */ } }
        return;
      }
      settled = true;
      clearTimeout(t);
      resolve(db);
    };
    const t = timer(() => {
      if (settled) return;
      settled = true;
      giveUp();
      resolve(null);
    }, timeoutMs);
    let req;
    try {
      req = factory.open(BASE_DB, 1);
    } catch {
      done(null);
      return;
    }
    if (!req || typeof req !== 'object') { done(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BASE_STORE)) db.createObjectStore(BASE_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another page upgrading / deleting the database: let go, open again next time
      db.onversionchange = () => { try { db.close(); } catch { /* closed */ } dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      done(db);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
  }).then((db) => {
    if (!db) dbPromise = null;   // try again on the next call (e.g. storage unblocked), unless it gave up
    return db;
  });
  return dbPromise;
}

// Runs fn(store, set) in one transaction; resolves with what set() was given once the
// transaction completed, or `fallback` on any failure, or when it didn't complete
// within the timeout (then this page stops using IndexedDB)
async function withStore(mode, fallback, fn) {
  let db;
  try { db = await openDb(); } catch { db = null; }
  if (!db) return fallback;
  return new Promise((resolve) => {
    let result = fallback;
    let settled = false;
    let tx;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(value);
    };
    const t = timer(() => {
      if (settled) return;
      settled = true;
      try { if (tx) tx.abort(); } catch { /* already finished */ }
      try { db.close(); } catch { /* closed */ }
      giveUp();
      resolve(fallback);
    }, timeoutMs);
    try {
      tx = db.transaction(BASE_STORE, mode);
      fn(tx.objectStore(BASE_STORE), (value) => { result = value; });
    } catch {
      try { if (tx) tx.abort(); } catch { /* already finished */ }
      finish(fallback);
      return;
    }
    tx.oncomplete = () => finish(result);
    tx.onerror = () => finish(fallback);
    tx.onabort = () => finish(fallback);
  });
}

// Every key of one storageKey ([storageKey, <any string id>] sorts between these)
function keyRange(storageKey) {
  return IDBKeyRange.bound([storageKey], [storageKey, []]);
}

const readIndex = (value) => (isObj(value) && Array.isArray(value.index)
  ? value.index.filter(e => isObj(e) && typeof e.id === 'string' && e.id !== INDEX_ID) : null);

// Strictly increasing within this page, so "newest" never ties
let lastSavedAt = 0;
function nextSavedAt(now) {
  lastSavedAt = Math.max(Number(now) || Date.now(), lastSavedAt + 1);
  return lastSavedAt;
}

function normalizeRecord(storageKey, rec, now) {
  if (!isObj(rec) || typeof rec.id !== 'string' || !rec.id) return null;
  let raw = rec.raw;
  if (raw !== undefined && typeof raw !== 'string') {
    try { raw = JSON.stringify(raw); } catch { return null; }
  }
  if (typeof raw !== 'string') return null;
  return {
    storageKey,
    id: rec.id,
    rev: Number.isInteger(rec.rev) ? rec.rev : null,
    chain: typeof rec.chain === 'string' ? rec.chain : '',
    savedAt: Number.isFinite(rec.savedAt) ? rec.savedAt : nextSavedAt(now),
    raw,
  };
}

// ---------- API -------------------------------------------------------------
// The base with this id, or the newest base of a stored copy (no id); null when none
export async function getBase(storageKey, id) {
  if (!storageKey) return null;
  const mem = memList(storageKey);
  if (id) {
    const stored = await withStore('readonly', null, (store, set) => {
      const req = store.get([storageKey, id]);
      req.onsuccess = () => set(isObj(req.result) && req.result.id === id ? req.result : null);
    });
    return stored || mem.find(r => r.id === id) || null;
  }
  const stored = await withStore('readonly', null, (store, set) => {
    const ireq = store.get([storageKey, INDEX_ID]);
    ireq.onsuccess = () => {
      const index = readIndex(ireq.result);
      if (!index || !index.length) return;
      const req = store.get([storageKey, index[0].id]);
      req.onsuccess = () => set(isObj(req.result) ? req.result : null);
    };
  });
  return sortNewest([stored, ...mem])[0] || null;
}

// Store a base { id, rev?, chain?, raw (JSON text or the profile object), savedAt? }
// and keep the last BASES_KEPT of that stored copy. Resolves the stored record (the
// in-memory one when IndexedDB failed), or null for an unusable record
export async function putBase(storageKey, base, now = Date.now()) {
  if (!storageKey) return null;
  const record = normalizeRecord(storageKey, base, now);
  if (!record) return null;
  const ok = await withStore('readwrite', false, (store, set) => {
    // The index, plus any record it doesn't list (written while an index write failed)
    let index = null, keys = null;
    const finish = () => {
      if (index === null || keys === null) return;
      const listed = new Set(index.map(e => e.id));
      const all = [
        ...index.filter(e => e.id !== record.id),
        ...keys.filter(id => !listed.has(id) && id !== record.id).map(id => ({ id, savedAt: 0 })),
      ];
      const ordered = [{ id: record.id, savedAt: record.savedAt }, ...all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))];
      ordered.slice(BASES_KEPT).forEach(e => store.delete([storageKey, e.id]));
      store.put(record, [storageKey, record.id]);
      store.put({ storageKey, id: INDEX_ID, index: ordered.slice(0, BASES_KEPT) }, [storageKey, INDEX_ID]);
      set(true);
    };
    const ireq = store.get([storageKey, INDEX_ID]);
    ireq.onsuccess = () => { index = readIndex(ireq.result) || []; finish(); };
    const kreq = store.getAllKeys(keyRange(storageKey));
    kreq.onsuccess = () => {
      keys = (kreq.result || []).map(k => (Array.isArray(k) ? k[1] : null)).filter(id => typeof id === 'string' && id !== INDEX_ID);
      finish();
    };
  });
  if (ok) {
    // IndexedDB holds it now: an in-memory copy (from an earlier failure) would only go stale
    memory.set(storageKey, memList(storageKey).filter(r => r.id !== record.id));
  } else {
    memPut(record);
  }
  return record;
}

// Every base of a stored copy, newest first (e.g. a "Restore earlier version" list)
export async function listBases(storageKey) {
  if (!storageKey) return [];
  const stored = (await withStore('readonly', null, (store, set) => {
    const req = store.getAll(keyRange(storageKey));
    req.onsuccess = () => set(req.result || []);
  })) || [];
  const recs = sortNewest(stored);
  const ids = new Set(recs.map(r => r.id));
  return sortNewest([...recs, ...memList(storageKey).filter(r => !ids.has(r.id))]).slice(0, BASES_KEPT);
}

// Forget the bases of one stored copy, or every base (no storageKey)
export async function clearBases(storageKey) {
  if (storageKey) memory.delete(storageKey); else memory.clear();
  if (idbGaveUp || !idbFactory()) return true;
  return withStore('readwrite', false, (store, set) => {
    if (storageKey) store.delete(keyRange(storageKey));
    else store.clear();
    set(true);
  });
}

// Tests: use this IDBFactory (null = behave as if there were no IndexedDB;
// undefined = the real one again), and optionally a shorter timeout. Also forgets the
// in-memory bases, and that IndexedDB was given up on
export function _setBaseStoreForTests(factory, { timeout = IDB_TIMEOUT_MS } = {}) {
  factoryOverride = factory;
  dbPromise = null;
  idbGaveUp = false;
  timeoutMs = timeout;
  memory.clear();
}
